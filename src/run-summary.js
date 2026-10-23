#!/usr/bin/env node
/**
 * npm run qa:summary -- [options]     Payroll Summary verifier (ticket 2168). READ-ONLY: changes nothing.
 * For one cutoff, reads every record on the source pages (deductions, loans, additions, benefits) and checks
 * the Payroll Summary picked each one up: the right amount for every employee on the record when it is due,
 * and 0 for everyone else / in cutoffs where it is not due.
 *   --period 2026-10-16..2026-10-31   the cutoff (default: the cutoff holding today: 1-15 or 16-end)
 *   --target vercel|dotnet            which deployment (default vercel); read-only, so .NET is allowed
 *   --only fuel,refund,hazard         only these categories (keys in src/summary-check/categories.js)
 *   --list                            print the category keys, then stop
 *   --dump                            also save the raw summary rows and source lists (raw.json) next to the CSV
 *   --headed                          show the browser
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, accountFor, ROOT } from './config.js';
import { login } from './app.js';
import { notify, summaryLine } from './notify.js';
import { CATEGORIES } from './summary-check/categories.js';
import { normalise, indexSummary, checkCategory, orphanItems } from './summary-check/rules.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const die = msg => { console.error('\n' + msg); process.exit(1); };

if (opt('list')) { for (const c of CATEGORIES) console.log(c.key.padEnd(30), c.label); process.exit(0); }

const pad = n => String(n).padStart(2, '0');
function currentCutoff() {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth() + 1;
  return t.getDate() <= 15 ? { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-15` } : { from: `${y}-${pad(m)}-16`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
}
let period = currentCutoff();
if (typeof opt('period') === 'string') {
  const m = opt('period').match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!m || m[1] > m[2]) die('--period must look like 2026-10-16..2026-10-31');
  period = { from: m[1], to: m[2] };
}
const target = typeof opt('target') === 'string' ? opt('target') : 'vercel';
const base = config.urls[target];
if (!base) die(`APP_URL_${target.toUpperCase()} is not set in .env`);
const want = typeof opt('only') === 'string' ? opt('only').split(',').map(s => s.trim()) : null;
const cats = CATEGORIES.filter(c => !want || want.includes(c.key));
if (want && cats.length !== want.length) die(`Unknown category: ${want.filter(k => !CATEGORIES.some(c => c.key === k)).join(', ')} (see --list)`);
const account = accountFor('TC - payroll_officer');
if (!account) die('ACCOUNT_PAYROLL_OFFICER is empty in .env.');

console.log(`\nPayroll Summary check on ${target === 'dotnet' ? '.NET' : 'Vercel'}, cutoff ${period.from} to ${period.to}: ${cats.length} source lists. Read-only.`);
const browser = await chromium.launch({ headless: !opt('headed') });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const r = await login(page, base + '/', account);
if (!r.ok) die('Login failed: ' + r.message);
// Same-origin page, so /api/request carries the session cookie and the referer the proxy expects.
await page.goto(base + '/payroll/summary', { waitUntil: 'load' });

// ---- the summary: pages of 25, 4 at a time (one length:-1 request takes ~24 s and can time out)
const summary = await page.evaluate(async ({ from, to }) => {
  const get = start => fetch('/api/request?source=summary-paged', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date_from: from, date_to: to, start, length: 25, order_by: '', order_dir: 'asc' }),
  }).then(async res => { if (!res.ok) throw new Error(`summary-paged HTTP ${res.status}`); return res.json(); });
  const first = await get(0);
  const rows = [...(first.data || [])], total = first.recordsTotal || rows.length;
  const starts = []; for (let s = 25; s < total; s += 25) starts.push(s);
  for (let i = 0; i < starts.length; i += 4) (await Promise.all(starts.slice(i, i + 4).map(get))).forEach(g => rows.push(...(g.data || [])));
  return { rows, total };
}, period).catch(e => die('Could not load the Payroll Summary: ' + e.message));
console.log(`  Payroll Summary: ${summary.rows.length} employee rows${summary.rows.length !== summary.total ? ` (of ${summary.total}!)` : ''}.`);

// ---- the source lists, through the same proxy the list pages use
const sources = await page.evaluate(async list => {
  const out = {};
  for (const { key, source } of list) {
    try {
      const res = await fetch('/api/request?source=' + source);
      const j = await res.json();
      out[key] = { status: res.status, data: Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null };
    } catch (e) { out[key] = { status: 0, error: String(e.message || e) }; }
  }
  return out;
}, cats.map(c => ({ key: c.key, source: c.source })));
await browser.close();

// ---- check
const rowsByEntry = new Map(summary.rows.map(row => [String(row.entryId), row]));
const idx = indexSummary(summary.rows);
const findings = [], knownKeys = new Set(), perCat = [];
for (const c of cats) {
  const s = sources[c.key];
  if (!s?.data) { perCat.push({ cat: c, error: s?.error || `HTTP ${s?.status}, no list` }); continue; }
  for (const raw of s.data) { const n = normalise(c, raw); knownKeys.add(`${n.type}|${n.id}`); }
  const res = checkCategory(c, s.data, rowsByEntry, idx, period);
  findings.push(...res.findings);
  perCat.push({ cat: c, ...res });
}
// Only look for orphans among the checked types: other summary types (contributions, attendance) are out of scope.
const checkedTypes = new Set([...knownKeys].map(k => k.split('|')[0]));
const orphans = orphanItems(new Map([...idx].filter(([k]) => checkedTypes.has(k.split('|')[0]))), knownKeys, rowsByEntry);
findings.push(...orphans);

// ---- report
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(ROOT, 'results', 'summary-' + stamp);
fs.mkdirSync(outDir, { recursive: true });
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [['Verdict', 'Category', 'Reference', 'Record id', 'Record', 'Employee', 'Entry id', 'Expected', 'In summary', 'Why'].map(csvCell).join(',')]
  .concat(findings.map(x => [x.verdict, x.category, x.ref, x.id, x.label, x.employee, x.entryId, x.expected, x.got, x.why].map(csvCell).join(',')));
const csvFile = path.join(outDir, 'findings.csv');
fs.writeFileSync(csvFile, '﻿' + csv.join('\r\n'));
if (opt('dump')) fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify({ period, rows: summary.rows, sources }));

console.log('');
for (const p of perCat) {
  if (p.error) { console.log(`  ERROR ${p.cat.label}: ${p.error}`); continue; }
  const bad = p.findings.filter(x => x.verdict === 'Fail').length, warn = p.findings.length - bad;
  const c = p.counts;
  console.log(`  ${(bad ? 'FAIL' : warn ? 'WARN' : 'OK').padEnd(5)} ${p.cat.label.padEnd(30)} ${String(c.records).padStart(4)} records, ${String(c.due).padStart(3)} due this cutoff, ${c.pairsOk} employee checks ok${bad ? `, ${bad} problems` : ''}${warn ? `, ${warn} warnings` : ''}${c.skippedInactive ? `, ${c.skippedInactive} inactive skipped` : ''}${c.notPerRecord ? `, ${c.notPerRecord} not on payslip (no per-record entry to check)` : ''}`);
}
const fails = findings.filter(x => x.verdict === 'Fail'), warns = findings.filter(x => x.verdict === 'Warn');
if (orphans.length) console.log(`  WARN  ${orphans.length} summary amount(s) belong to records on none of the checked lists`);
const show = [...fails, ...warns].slice(0, 60);
if (show.length) {
  console.log(`\nFirst ${show.length} of ${findings.length} findings:`);
  for (const x of show) console.log(`  ${x.verdict.padEnd(4)} ${x.category} ${x.ref} -> ${x.employee}: expected ${x.expected}, summary ${x.got}. ${x.why}`);
}
const errs = perCat.filter(p => p.error).length;
const counts = `${fails.length} problems, ${warns.length} warnings${errs ? `, ${errs} lists could not be read` : ''}`;
console.log(`\nDone: ${counts}. CSV: ${csvFile}`);
console.log(summaryLine({ kind: 'summary-check', period, fail: fails.length, warn: warns.length, errors: errs, csv: csvFile, categories: perCat.map(p => ({ key: p.cat.key, label: p.cat.label, error: p.error || null, fail: (p.findings || []).filter(x => x.verdict === 'Fail').length, warn: (p.findings || []).filter(x => x.verdict === 'Warn').length, ...(p.counts || {}) })) }));
await notify('Payroll Summary check finished', counts);
