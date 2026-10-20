#!/usr/bin/env node
/**
 * npm run qa:dp -- [options]      DP data tests: CREATE and DELETE real records.
 *   --groups deductions,additions,benefits   page groups (default: every automated, non-risky group)
 *   --page fuel                    only list pages whose path ends with this
 *   --only DPPD-0001,DPPD-0002     only these TC IDs     --ids-file ids.txt   IDs from a file
 *   --limit 5                      stop after N rows
 *   --keep                         do not delete the records afterwards (for inspection)
 *   --cleanup                      only delete leftover "QA-AUTO" records, then stop
 *   --coverage                     show which pages are automated, then stop (no browser, no data)
 *   --target vercel|dotnet         where to write (default vercel). dotnet needs ALLOW_DATA_ON_DOTNET=true
 *                                  and the typed confirmation.
 *   --yes                          skip the "create test data?" prompt (the UI passes this after its own dialog)
 *   --confirm-dotnet DOTNET        the typed .NET confirmation (UI passes it after its red warning)
 *   --push / --shots / --headed / --xlsx / --dry   as in npm run qa
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import { config, accountFor, ROOT } from './config.js';
import { loadFromWebapp, loadFromXlsx, pushResults, writeCsv } from './sheet.js';
import { login, pathOf, waitForSplash } from './app.js';
import { GROUPS, groupOf, dpAutomatable, runDpRow, cleanupLeftovers, assertWritable } from './dp.js';
import { notify, summaryLine } from './notify.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const die = msg => { console.error('\n' + msg); process.exit(1); };
const ask = async q => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(q); rl.close(); return a.trim(); };

// ---- coverage report (no data, no browser)
if (opt('coverage')) {
  for (const g of GROUPS) console.log(`${g.automated ? 'AUTOMATED ' : 'NOT YET   '} ${g.risky ? 'RISKY ' : '      '} ${g.label} (${g.pages.length} pages)`);
  console.log(summaryLine({ kind: 'coverage', groups: GROUPS.map(g => ({ key: g.key, label: g.label, risky: g.risky, automated: !!g.automated, pages: g.pages })) }));
  process.exit(0);
}

const target = typeof opt('target') === 'string' ? opt('target') : 'vercel';
if (!['vercel', 'dotnet'].includes(target)) die('--target must be vercel or dotnet');
const base = config.urls[target];
if (!base) die(`APP_URL_${target.toUpperCase()} is not set in .env`);

const account = accountFor('TC - payroll_officer');
if (!account) die('ACCOUNT_PAYROLL_OFFICER is empty in .env: test records are created by that account.');
if (!config.data.employeeEid && !opt('dry')) die('Set QA_EMPLOYEE_EID in .env: the test employee every record is applied to.');

// ---- .NET lock
let dotnetConfirmed = false;
if (target === 'dotnet') {
  if (!config.data.allowDotnet) die('Writing test data on .NET is locked. Set ALLOW_DATA_ON_DOTNET=true in .env only if you really mean it.');
  console.log('\n' + '!'.repeat(78) + '\n  WARNING: this will CREATE and DELETE records on the .NET deployment:\n  ' + base +
    '\n  This may be the live / main system. Records go to employee ' + config.data.employeeEid + '.\n' + '!'.repeat(78));
  const typed = typeof opt('confirm-dotnet') === 'string' ? opt('confirm-dotnet') : await ask('Type DOTNET to continue: ');
  if (typed !== 'DOTNET') die('Not confirmed. Nothing was written.');
  dotnetConfirmed = true;
}

const browser = opt('dry') ? null : await chromium.launch({ headless: !opt('headed') });
const ctx = browser ? { page: await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage() } : null;

if (opt('cleanup')) {
  const r = await login(ctx.page, base + '/', account);
  if (!r.ok) die('Login failed: ' + r.message);
  const n = await cleanupLeftovers(ctx, base, { dotnetConfirmed });
  console.log(`Deleted ${n} leftover QA-AUTO records.`);
  console.log(summaryLine({ kind: 'cleanup', removed: n }));
  await browser.close();
  process.exit(0);
}

// ---- which rows
const wantGroups = typeof opt('groups') === 'string' ? opt('groups').split(',').map(s => s.trim()) : null;
const chosen = GROUPS.filter(g => g.automated && (wantGroups ? wantGroups.includes(g.key) : !g.risky));
const risky = chosen.filter(g => g.risky);
if (risky.length && !config.data.risky) die(`These groups can affect EVERYONE's payroll: ${risky.map(g => g.label).join(', ')}.\nSet ALLOW_RISKY_PAGES=true in .env to allow them.`);

let only = typeof opt('only') === 'string' ? opt('only').split(',').map(s => s.trim()) : null;
if (typeof opt('ids-file') === 'string') only = fs.readFileSync(opt('ids-file'), 'utf8').split(/\r?\n/).map(l => l.trim().split('@')[0]).filter(Boolean);
const pageFilter = typeof opt('page') === 'string' ? opt('page').replace(/^\/+/, '') : null;

const xlsx = opt('xlsx');
const all = typeof xlsx === 'string' ? await loadFromXlsx(xlsx) : await loadFromWebapp();
let rows = all.filter(r => r.sheet.startsWith('DP - ') && dpAutomatable(r))
  .filter(r => chosen.includes(groupOf(r)))
  .filter(r => !only || only.includes(r.id))
  .filter(r => !pageFilter || pathOf(r.vercel).replace(/\/add$/, '').endsWith('/' + pageFilter));
rows = rows.slice(0, Number(opt('limit', 0)) || Infinity);
const pages = [...new Set(rows.map(r => r.page + ' (' + pathOf(r.vercel).replace(/\/add$/, '') + ')'))];

console.log(`\nDP test data plan on ${target === 'dotnet' ? '.NET' : 'Vercel'}: ${rows.length} records to create and ${opt('keep') ? 'KEEP' : 'delete'}.`);
console.log(`  Groups: ${chosen.map(g => g.label).join(', ') || '-'}`);
console.log(`  Test employee: ${config.data.employeeEid || '(not set)'}   Logged in as: ${account.username}`);
console.log(`  Pages (${pages.length}): ${pages.slice(0, 12).join(', ')}${pages.length > 12 ? ', ...' : ''}`);
if (opt('dry') || !rows.length) process.exit(0);

if (!opt('yes')) {
  const a = await ask('\nCreate this test data now? Type "yes" to continue: ');
  if (a.toLowerCase() !== 'yes') die('Cancelled. Nothing was written.');
}
for (const r of rows) assertWritable(base + pathOf(r.vercel), { dotnetConfirmed });

const r = await login(ctx.page, base + '/', account);
if (!r.ok) die('Login failed: ' + r.message);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runId = stamp.slice(5, 16).replace(/[-T]/g, '');
const outDir = path.join(ROOT, 'results', 'dp-' + stamp);
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
const results = [];
let pushedUpTo = 0;
async function flush() {
  writeCsv(path.join(outDir, 'results.csv'), results);
  if (!opt('push') || pushedUpTo >= results.length) return;
  try { const n = await pushResults(results.slice(pushedUpTo)); pushedUpTo = results.length; console.log(`  -> pushed ${n} rows to the Check Log`); }
  catch (e) { console.log('  -> PUSH FAILED: ' + e.message + ' (kept in CSV, retried next batch)'); }
}

const shots = opt('shots', 'fail');
const envLabel = target === 'dotnet' ? '.NET' : 'Vercel';
for (const row of rows) {
  const out = await runDpRow(ctx, row, { runId, keep: !!opt('keep'), base, dotnetConfirmed });
  const res = { id: row.id, env: envLabel, result: out.result, notes: out.notes, at: new Date().toLocaleString() };
  if (shots === 'all' || (shots === 'fail' && out.result !== 'Pass')) {
    const file = path.join(outDir, 'screenshots', `${row.id}.png`);
    await waitForSplash(ctx.page);
    await ctx.page.screenshot({ path: file, fullPage: true }).then(() => { res.screenshot = file; }).catch(() => {});
  }
  results.push(res);
  console.log(`  ${out.result.padEnd(5)} ${row.id.padEnd(10)} ${row.page} | ${row.raw.Scenario}\n        ${out.notes}`);
  if (results.length % 10 === 0) await flush();
}
await flush();
await browser.close();
const fails = results.filter(x => x.result !== 'Pass').length;
const csv = path.join(outDir, 'results.csv');
console.log(`\nDone: ${results.length - fails} Pass, ${fails} Fail. CSV: ${csv}`);
console.log(summaryLine({ kind: 'data', pass: results.length - fails, fail: fails, csv, pushed: opt('push') ? pushedUpTo : 0 }));
await notify('QA data run finished', `${results.length - fails} Pass, ${fails} Fail`);
