import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { config } from './config.js';

const COLS = {
  id: 'TC ID', module: 'Module', page: 'Page', fn: 'Function / Test', access: 'Expected Access',
  vercel: 'Vercel Link', dotnet: '.NET Link', steps: 'Steps to Test', expected: 'Expected Result',
};

function normalise(sheetName, raw) {
  // `raw` keeps every column by header name (DP sheets have more columns than TC sheets).
  const o = { sheet: sheetName, raw };
  for (const [k, h] of Object.entries(COLS)) o[k] = raw[h] == null ? '' : String(raw[h]).trim();
  return o;
}

/**
 * GET the web app. Google hands a web app's answer over through a second address, and that
 * hand-off sometimes fails with an HTML "not found" page (worse for big answers). So: large
 * answers come gzipped, and a non-JSON page is retried up to 3 times before giving up.
 */
async function getJson(params) {
  if (!config.webappUrl || !config.token) throw new Error('SHEET_WEBAPP_URL / SHEET_TOKEN missing in .env (or use --xlsx).');
  const u = new URL(config.webappUrl);
  u.searchParams.set('token', config.token);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  let lastErr = '';
  const TRIES = 4;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    // Google sometimes hangs ~2 minutes before failing; give up on a stuck request after 45 s.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    let res, text;
    try {
      res = await fetch(u, { redirect: 'follow', signal: ctl.signal });
      text = await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = `No answer from the web app (${e.name === 'AbortError' ? 'timed out after 45 s' : e.message}).`;
      if (attempt < TRIES) { console.log(`  (web app did not answer; retrying ${attempt}/${TRIES - 1}...)`); await new Promise(r => setTimeout(r, 3000 * attempt)); }
      continue;
    }
    clearTimeout(timer);
    let body = null;
    try { body = JSON.parse(text); } catch (_) {}
    if (body) {
      if (body.gz) {
        const data = JSON.parse(zlib.gunzipSync(Buffer.from(body.gz, 'base64')).toString('utf8'));
        Object.assign(body, Array.isArray(data) ? { rows: data } : data);
        delete body.gz;
      }
      return body;
    }
    lastErr = explainHtml(text, res);
    // A deployment mistake (sign-in page, missing doGet, /dev URL) will not fix itself: stop now.
    if (!/did not return JSON/.test(lastErr)) break;
    if (attempt < TRIES) { console.log(`  (Google sent an error page; retrying ${attempt}/${TRIES - 1}...)`); await new Promise(r => setTimeout(r, 3000 * attempt)); }
  }
  throw new Error(lastErr);
}

// Last successfully loaded tests per sheet, so a Google hiccup doesn't stop a run.
const CACHE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'results', 'tests-cache.json');
const readCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (_) { return {}; } };
function writeCache(name, rows) {
  const c = readCache(); c[name] = { at: new Date().toISOString(), rows };
  fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(c));
}

/** Test rows from the live sheet through the Apps Script web app. */
export async function loadFromWebapp(sheetNames) {
  // One sheet per request: big answers fail Google's hand-off, small ones don't.
  let names = sheetNames?.length ? sheetNames : null;
  if (!names) {
    try {
      const list = await getJson({ action: 'list' });
      if (!list.ok) throw new Error(/Unknown action/.test(list.error)
        ? 'The web app is an old version: paste the new apps-script/QaRunnerApi.gs and deploy a New version.' : 'Web app refused: ' + list.error);
      names = list.sheets;
    } catch (e) {
      names = Object.keys(readCache());
      if (!names.length) throw e;
      console.log(`  Could not list the sheets (${e.message.slice(0, 80)}); using the ${names.length} sheets from the last good load.`);
    }
  }
  const loadOne = async name => {
    try {
      const body = await getJson({ action: 'tests', sheets: name });
      if (!body.ok) throw new Error('Web app refused: ' + body.error);
      return { name, rows: body.sheets[name] || [], fresh: true };
    } catch (e) {
      const cached = readCache()[name];
      if (!cached) throw e;
      console.log(`  ${name}: the sheet could not be read just now; using the copy from ${cached.at.slice(0, 16).replace('T', ' ')}.`);
      return { name, rows: cached.rows, fresh: false };
    }
  };
  // 4 sheets at a time: much faster than one by one, gentle enough for Apps Script.
  const results = new Array(names.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
    while (next < names.length) { const i = next++; results[i] = await loadOne(names[i]); }
  }));
  const out = [];
  for (const { name, rows, fresh } of results) {
    if (fresh) writeCache(name, rows);
    for (const r of rows) out.push(normalise(name, r));
  }
  return out;
}

/** Google answers with an HTML page (still HTTP 200) when the deployment is wrong. Say which. */
function explainHtml(text, res) {
  const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  // Host only: the full web app URL is a secret and must not end up in logs or screenshots.
  const where = `(HTTP ${res.status}, page "${title.trim() || 'untitled'}", from ${new URL(res.url).host})`;
  if (/Script function not found: doGet/i.test(text))
    return `The web app has no doGet: QaRunnerApi.gs was not saved, or the deployment is an old version. Save it, then Deploy > Manage deployments > Edit > Version: New version. ${where}`;
  if (/accounts\.google\.com|Sign in|ServiceLogin/i.test(text + res.url))
    return `Google asked for a sign-in: the deployment's "Who has access" must be "Anyone" (not "Only myself" / "Anyone with Google account"). ${where}`;
  if (/\/dev(\?|$)/.test(config.webappUrl))
    return `SHEET_WEBAPP_URL ends in /dev (the test URL, which needs a sign-in). Use the Web app URL that ends in /exec. ${where}`;
  return `The web app did not return JSON. First 200 characters: ${text.replace(/\s+/g, ' ').slice(0, 200)} ${where}`;
}

/** Latest Vercel / .NET result of every test row (from the sheet's auto status columns). */
export async function loadStatus() {
  const body = await getJson({ action: 'status' });
  if (!body.ok) throw new Error(/Unknown action/.test(body.error)
    ? 'The web app is an old version: paste the new apps-script/QaRunnerApi.gs and deploy a New version.' : 'Web app refused: ' + body.error);
  return body.rows;
}

/** Test rows from a downloaded copy (File > Download > Microsoft Excel). */
export async function loadFromXlsx(file, sheetNames) {
  const XLSX = await import('xlsx');
  XLSX.set_fs(fs);
  const wb = XLSX.readFile(file);
  const out = [];
  for (const name of wb.SheetNames) {
    if (!/^(TC|DP) - /.test(name)) continue;
    if (sheetNames?.length && !sheetNames.includes(name)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { range: 3, defval: '' });
    for (const r of rows) if (r['TC ID']) out.push(normalise(name, r));
  }
  return out;
}

/** Append results to the Check Log. Sent in chunks so one request never gets too large. */
export async function pushResults(results) {
  const rows = results.map(r => ({
    tcId: r.id, checker: config.checker, env: r.env, result: r.result, notes: r.notes,
    screenshot: r.screenshot && fs.existsSync(r.screenshot)
      ? { name: path.basename(r.screenshot), base64: fs.readFileSync(r.screenshot).toString('base64') } : null,
  }));
  let sent = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const res = await fetch(config.webappUrl, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ token: config.token, rows: chunk }),
    });
    const body = await res.json().catch(() => null);
    if (!body?.ok) throw new Error(`Push failed after ${sent} rows: ` + (body?.error || res.status));
    sent += chunk.length;
  }
  return sent;
}

/** Same columns as the Check Log, for pasting by hand when not pushing. */
export function writeCsv(file, results) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['TC ID', 'Checker', 'Checked At', 'Environment', 'Result', 'Notes', 'Screenshot / Photo'].map(esc).join(',')];
  for (const r of results) lines.push([r.id, config.checker, r.at, r.env, r.result, r.notes, r.screenshot || ''].map(esc).join(','));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'));
}
