import fs from 'node:fs';
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

/** Test rows from the live sheet through the Apps Script web app. */
export async function loadFromWebapp(sheetNames) {
  if (!config.webappUrl || !config.token) throw new Error('SHEET_WEBAPP_URL / SHEET_TOKEN missing in .env (or use --xlsx).');
  const u = new URL(config.webappUrl);
  u.searchParams.set('token', config.token);
  u.searchParams.set('action', 'tests');
  if (sheetNames?.length) u.searchParams.set('sheets', sheetNames.join(','));
  const res = await fetch(u, { redirect: 'follow' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  if (!body) throw new Error(explainHtml(text, res));
  if (!body.ok) throw new Error('Web app refused: ' + body.error);
  return Object.entries(body.sheets).flatMap(([name, rows]) => rows.map(r => normalise(name, r)));
}

/** Google answers with an HTML page (still HTTP 200) when the deployment is wrong. Say which. */
function explainHtml(text, res) {
  const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const where = `(HTTP ${res.status}, page "${title.trim() || 'untitled'}", ended at ${res.url.split('?')[0]})`;
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
  if (!config.webappUrl || !config.token) throw new Error('SHEET_WEBAPP_URL / SHEET_TOKEN missing in .env.');
  const u = new URL(config.webappUrl);
  u.searchParams.set('token', config.token);
  u.searchParams.set('action', 'status');
  const res = await fetch(u, { redirect: 'follow' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  if (!body) throw new Error(explainHtml(text, res));
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
