/**
 * QA Runner UI - a small local web app (http://127.0.0.1:4317) around the CLI scripts.
 * Listens on 127.0.0.1 only: nothing on the network can reach it, because it can read .env.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../config.js';

const portArg = process.argv.indexOf('--port');
const PORT = Number((portArg > 0 && process.argv[portArg + 1]) || process.env.QA_UI_PORT || 4317);
const ENV_FILE = path.join(ROOT, '.env');
const HTML = path.join(ROOT, 'src', 'ui', 'index.html');

// ---- .env schema: what the Settings tab shows ---------------------------------------------
export const SCHEMA = [
  { group: 'Sheet connection', key: 'SHEET_URL', label: 'Google Sheet link', help: 'Link to the QA sheet (only used for the "Open sheet" button).' },
  { group: 'Sheet connection', key: 'SHEET_WEBAPP_URL', label: 'Apps Script web app URL', help: 'Deploy > Manage deployments > Web app URL (ends in /exec).', secret: true },
  { group: 'Sheet connection', key: 'SHEET_TOKEN', label: 'Sheet token', help: 'Same value as the QA_TOKEN Script Property.', secret: true },
  { group: 'Sheet connection', key: 'CHECKER_NAME', label: 'Checker name', help: 'Name written in the Check Log. Add it to the Team tab.', placeholder: 'QA Bot' },
  { group: 'App addresses', key: 'APP_URL_VERCEL', label: 'Vercel (dev) app URL', help: 'Base URL, no trailing slash.', secret: true },
  { group: 'App addresses', key: 'APP_URL_DOTNET', label: '.NET (main) app URL', help: 'Base URL, no trailing slash.', secret: true },
  ...['NEWQRPHOADMIN', 'PAYROLL_OFFICER', 'PAYROLL_STAFF', 'PAYROLL_APPROVING_OFFICER', 'PAYROLL_MGMT', 'LEAVE_IMMEDIATE_HEAD', 'LEAVE_CAMPUS_ADMIN', 'EMPLOYEE', 'INVALID_ROLES', 'NO_ROLES']
    .map(r => ({ group: 'Test accounts', key: 'ACCOUNT_' + r, label: r.toLowerCase(), help: 'username:password', secret: true })),
  { group: 'Test data', key: 'QA_EMPLOYEE_EID', label: 'Test employee ID', help: 'Every test record is applied to this employee only.' },
  { group: 'Test data', key: 'QA_EMPLOYEE_EID_2', label: 'Second test employee ID', help: 'Optional. Only for the edit tests that move a record to another employee.' },
  { group: 'Test data', key: 'QA_FILES_DIR', label: 'Reference files folder', help: 'Folder with valid-document.pdf etc.', placeholder: 'test-files' },
  { group: 'Test data', key: 'ALLOW_RISKY_PAGES', label: 'Allow risky pages', help: 'true = allow Rates, Gov tables, Payments, Users, Settings... (can affect everyone).', placeholder: 'false' },
  { group: 'Test data', key: 'ALLOW_DATA_ON_DOTNET', label: 'Allow test data on .NET', help: 'true = unlock writing on .NET. Every run still asks you to type DOTNET.', placeholder: 'false' },
  { group: 'Timing', key: 'SETTLE_MS', label: 'Settle time (ms)', help: 'How long a page must stay loaded before it counts as allowed.', placeholder: '3000' },
  { group: 'Timing', key: 'PAGE_TIMEOUT_MS', label: 'Page timeout (ms)', help: 'Max wait for one page.', placeholder: '30000' },
  { group: 'Timing', key: 'QA_NOTIFY', label: 'Windows notifications', help: '"off" to disable the pop-up when a run ends.', placeholder: 'on' },
];

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function formatEnv(values) {
  const quote = v => (/[#\s"'=]/.test(v) ? `"${String(v).replace(/"/g, '\\"')}"` : v);
  const lines = ['# QA Runner settings. Never commit this file.'];
  let group = '';
  const known = new Set();
  for (const f of SCHEMA) {
    if (f.group !== group) { group = f.group; lines.push('', `# --- ${group}`); }
    known.add(f.key);
    lines.push(`${f.key}=${quote(values[f.key] ?? '')}`);
  }
  const extra = Object.keys(values).filter(k => !known.has(k) && values[k] !== '');
  if (extra.length) { lines.push('', '# --- Other'); for (const k of extra) lines.push(`${k}=${quote(values[k])}`); }
  return lines.join('\n') + '\n';
}

const readEnv = () => (fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) : {});

// ---- jobs -----------------------------------------------------------------------------------
const jobs = new Map();
let nextId = 1;
function startJob(script, args, title) {
  const id = String(nextId++);
  const child = spawn(process.execPath, [path.join(ROOT, 'src', script), ...args], { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } });
  const job = { id, title, args, lines: [], listeners: new Set(), done: false, code: null, summary: null, child, started: Date.now() };
  const emit = line => {
    if (!line) return;
    if (line.startsWith('__SUMMARY__ ')) { try { job.summary = JSON.parse(line.slice(12)); } catch (_) {} return; }
    job.lines.push(line);
    for (const l of job.listeners) l.write(`data: ${JSON.stringify({ line })}\n\n`);
  };
  // Output arrives in chunks that can split a line (the status summary is one very long line),
  // so keep the unfinished tail of each stream until its newline arrives.
  const lineReader = () => {
    let buf = '';
    return {
      data: chunk => { buf += String(chunk); const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(emit); },
      end: () => { emit(buf); buf = ''; },
    };
  };
  const out = lineReader(), err = lineReader();
  child.stdout.on('data', out.data);
  child.stderr.on('data', err.data);
  child.on('close', code => {
    out.end(); err.end();
    job.done = true; job.code = code;
    for (const l of job.listeners) { l.write(`event: done\ndata: ${JSON.stringify({ code, summary: job.summary })}\n\n`); l.end(); }
    job.listeners.clear();
  });
  jobs.set(id, job);
  return job;
}

/** Run a script to completion and return its summary line (used for status / coverage). */
function runForSummary(script, args) {
  return new Promise(resolve => {
    const job = startJob(script, args, 'internal');
    const t = setInterval(() => { if (job.done) { clearInterval(t); jobs.delete(job.id); resolve({ summary: job.summary, lines: job.lines, code: job.code }); } }, 200);
  });
}

// ---- http -----------------------------------------------------------------------------------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (_) { r({}); } }); });

const server = http.createServer(async (req, res) => {
  // Same-origin only: a web page elsewhere must not be able to drive this server.
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) return send(res, 403, { error: 'origin' });
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(HTML, 'utf8'), 'text/html; charset=utf-8');
    // Optional local-only picture for Evil mode (git-ignored); 404 when a teammate doesn't have it.
    if (req.method === 'GET' && url.pathname === '/evil.png') {
      const img = path.join(ROOT, 'src', 'ui', 'evil.png');
      if (!fs.existsSync(img)) return send(res, 404, { error: 'none' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(img));
    }
    if (req.method === 'GET' && url.pathname === '/api/env') {
      return send(res, 200, { schema: SCHEMA, values: readEnv(), exists: fs.existsSync(ENV_FILE) });
    }
    if (req.method === 'POST' && url.pathname === '/api/env') {
      const body = await readBody(req);
      const values = typeof body.raw === 'string' ? parseEnv(body.raw) : (body.values || {});
      fs.writeFileSync(ENV_FILE, formatEnv(values));
      return send(res, 200, { ok: true, saved: Object.keys(values).length });
    }
    if (req.method === 'GET' && url.pathname === '/api/env/format') return send(res, 200, formatEnv(readEnv()), 'text/plain; charset=utf-8');
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { kind, args = [], title } = await readBody(req);
      if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) return send(res, 400, { error: 'bad args' });
      let script = kind === 'data' ? 'run-dp.js' : 'run.js';
      const extra = [];
      if (kind === 'ids') {
        // args[0] = ids text; written to a file so long lists don't hit command-line limits.
        const file = path.join(ROOT, 'results', `ids-${Date.now()}.txt`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, args.shift());
        script = args.shift() === 'data' ? 'run-dp.js' : 'run.js';
        extra.push('--ids-file', file);
      }
      const job = startJob(script, [...args, ...extra], title || 'Run');
      return send(res, 200, { id: job.id, cmd: `npm run ${script === 'run-dp.js' ? 'qa:dp' : 'qa'} -- ${[...args, ...extra].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}` });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/stream/')) {
      const job = jobs.get(url.pathname.split('/').pop());
      if (!job) return send(res, 404, { error: 'no job' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      for (const line of job.lines) res.write(`data: ${JSON.stringify({ line })}\n\n`);
      if (job.done) { res.write(`event: done\ndata: ${JSON.stringify({ code: job.code, summary: job.summary })}\n\n`); return res.end(); }
      job.listeners.add(res);
      req.on('close', () => job.listeners.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/stop/')) {
      const job = jobs.get(url.pathname.split('/').pop());
      if (job && !job.done) job.child.kill();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      // A child process, so it always reads the .env as currently saved.
      const r = await runForSummary('status.js', []);
      if (!r.summary || r.summary.error) return send(res, 500, { error: r.summary?.error || r.lines.slice(-3).join(' ') });
      return send(res, 200, { rows: r.summary.rows });
    }
    if (req.method === 'GET' && url.pathname === '/api/coverage') {
      const r = await runForSummary('run-dp.js', ['--coverage']);
      return send(res, 200, r.summary || { groups: [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/dp-ids') {
      // The automated DP rows (ID, page, scenario) for the Data tab's range picker.
      const r = await runForSummary('run-dp.js', ['--list-ids']);
      if (!r.summary || r.summary.error) return send(res, 500, { error: r.summary?.error || r.lines.slice(-3).join(' ') });
      return send(res, 200, { ids: r.summary.ids });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

const openBrowser = link => { if (!process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', link], { detached: true, stdio: 'ignore' }).unref(); };

// Port taken: if it is already a QA Runner, just open it; otherwise say what to do.
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  const link = `http://127.0.0.1:${PORT}`;
  const ours = await fetch(link + '/api/env').then(r => r.ok).catch(() => false);
  if (ours) {
    console.log(`The QA Runner is already running at ${link}. Opening it.`);
    openBrowser(link);
    setTimeout(() => process.exit(0), 1500);
  } else {
    console.log(`Port ${PORT} is used by another program. Set QA_UI_PORT=4318 (or any free port) in .env and start again.`);
    process.exitCode = 1;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}`;
  console.log(`QA Runner UI: ${link}  (close this window to stop it)`);
  openBrowser(link);
});
