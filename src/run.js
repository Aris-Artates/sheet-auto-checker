#!/usr/bin/env node
/**
 * npm run qa -- [options]
 *   --roles payroll_officer,employee   only these TC sheets (default: every TC sheet with an account in .env)
 *   --env vercel|dotnet|both           which environment (default vercel)
 *   --only PO-0001,PO-0042             only these TC IDs
 *   --ids-file ids.txt                 only the IDs in this file (one per line; "PO-0001@vercel" limits to one environment)
 *   --module "Payroll Deduction,Benefits"  only rows of these modules (comma-separated)
 *   --limit 20                         stop after N checks per role
 *   --xlsx path\to\download.xlsx       read tests from a downloaded copy instead of the web app
 *   --push                             append results to the sheet's Check Log
 *   --shots fail|all|none              screenshots (default fail)
 *   --headed                           show the browser
 *   --dry                              list what would run; no browser
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, accountFor, isRefusedRole, ENVS, rebase, ROOT } from './config.js';
import { notify, summaryLine } from './notify.js';
import { loadFromWebapp, loadFromXlsx, pushResults, writeCsv } from './sheet.js';
import { login, logout, open, origin, waitForSplash } from './app.js';
import { ruleFor, checkSidebar } from './rules.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const list = v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : null);

const envKeys = opt('env', 'vercel') === 'both' ? ['vercel', 'dotnet'] : [opt('env', 'vercel')];
if (envKeys.some(k => !ENVS[k])) throw new Error('--env must be vercel, dotnet or both');
const wantRoles = list(opt('roles'))?.map(r => 'TC - ' + r);
let only = list(opt('only'));
// --ids-file: "PO-0001" (both environments) or "PO-0001@vercel" / "PO-0001@dotnet" (one).
const idEnvs = new Map();
if (typeof opt('ids-file') === 'string') {
  for (const line of fs.readFileSync(opt('ids-file'), 'utf8').split(/\r?\n/)) {
    const [id, e] = line.trim().split('@');
    if (!id) continue;
    if (!idEnvs.has(id)) idEnvs.set(id, new Set());
    if (e) idEnvs.get(id).add(e); else Object.keys(ENVS).forEach(k => idEnvs.get(id).add(k));
  }
  only = [...idEnvs.keys()];
}
const wantedOn = (id, env) => !idEnvs.size || idEnvs.get(id)?.has(env);
const modules = list(opt('module'));
const limit = Number(opt('limit', 0)) || Infinity;
const shots = opt('shots', 'fail');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(ROOT, 'results', 'run-' + stamp);

const xlsx = opt('xlsx');
const all = typeof xlsx === 'string' ? await loadFromXlsx(xlsx, wantRoles) : await loadFromWebapp(wantRoles);
const tcRows = all.filter(r => r.sheet.startsWith('TC - '))
  .filter(r => !only || only.includes(r.id))
  .filter(r => !modules || modules.includes(r.module));

const bySheet = new Map();
for (const r of tcRows) (bySheet.get(r.sheet) || bySheet.set(r.sheet, []).get(r.sheet)).push(r);

// ---- plan
let planned = 0, manual = 0;
const plan = [];
for (const [sheet, rows] of bySheet) {
  const account = accountFor(sheet);
  const auto = rows.filter(r => ruleFor(r));
  manual += rows.length - auto.length;
  if (!account && !isRefusedRole(sheet)) { console.log(`SKIP ${sheet}: no ACCOUNT_ line in .env (${auto.length} automatable rows)`); continue; }
  plan.push({ sheet, account, rows, auto: auto.slice(0, limit) });
  planned += Math.min(auto.length, limit) * envKeys.length;
}
console.log(`\n${tcRows.length} TC rows read. ${planned} checks to run on ${envKeys.map(k => ENVS[k].label).join(' + ')}; ${manual} rows need a human (not touched).`);
for (const p of plan) console.log(`  ${p.sheet}: ${p.auto.length} automatic / ${p.rows.length}`);
if (opt('dry')) process.exit(0);

// ---- run
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
const browser = await chromium.launch({ headless: !opt('headed') });
const results = [];
const counts = { Pass: 0, Fail: 0, Blocked: 0 };

async function record(ctx, row, env, outcome) {
  const res = { id: row.id, env: ENVS[env].label, result: outcome.result, notes: outcome.notes, at: new Date().toLocaleString() };
  if (shots === 'all' || (shots === 'fail' && outcome.result !== 'Pass')) {
    const file = path.join(outDir, 'screenshots', `${row.id}-${env}.png`);
    await waitForSplash(ctx.page);
    await ctx.page.screenshot({ path: file, fullPage: false }).then(() => { res.screenshot = file; }).catch(() => {});
  }
  results.push(res); counts[res.result]++;
  console.log(`  ${res.result.padEnd(7)} ${row.id.padEnd(9)} ${ENVS[env].label.padEnd(6)} ${row.fn} - ${outcome.result === 'Pass' ? outcome.notes.slice(0, 110) : outcome.notes}`);
}

// With --push, results go to the Check Log after EACH role on each environment, so they show
// up while the run is still going and an interrupted run keeps what it already checked.
let pushedUpTo = 0, pushedTotal = 0;
async function flush(label) {
  writeCsv(path.join(outDir, 'results.csv'), results);
  if (!opt('push') || pushedUpTo >= results.length) return;
  const batch = results.slice(pushedUpTo);
  try {
    const n = await pushResults(batch);
    pushedUpTo = results.length; pushedTotal += n;
    console.log(`  -> pushed ${n} rows to the Check Log (${label})`);
  } catch (e) {
    console.log(`  -> PUSH FAILED (${label}): ${e.message}. They stay in the CSV and are retried with the next batch.`);
  }
}

for (const { sheet, account, auto } of plan) {
  for (const env of envKeys) {
    console.log(`\n== ${sheet} on ${ENVS[env].label}`);
    if (!config.urls[env]) { console.log(`  SKIP: APP_URL_${env.toUpperCase()} is not set in .env`); continue; }
    const rows = auto.filter(r => wantedOn(r.id, env)).map(r => ({ ...r, url: rebase(r[ENVS[env].col], env) })).filter(r => r.url);
    if (!rows.length) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctx = { page: await context.newPage() };
    const base = rows[0].url;
    try {
      const loginRow = rows.find(r => ruleFor(r).special === 'login');
      if (isRefusedRole(sheet)) {
        if (loginRow) {
          if (!account) console.log(`  (no ACCOUNT_ for ${sheet}; login-refusal row skipped)`);
          else {
            const r = await login(ctx.page, base, account);
            await record(ctx, loginRow, env, r.ok ? { result: 'Fail', notes: 'Account was LET IN: ' + r.message } : { result: 'Pass', notes: r.message });
            if (r.ok) await logout(ctx.page).catch(() => {});
          }
        }
      } else {
        const r = await login(ctx.page, base, account);
        if (loginRow) await record(ctx, loginRow, env, r.ok ? { result: 'Pass', notes: r.message } : { result: 'Fail', notes: r.message });
        if (!r.ok) { console.log('  Login failed; skipping the rest of this role on this environment.'); continue; }
        const sidebarRow = rows.find(r => ruleFor(r).special === 'sidebar');
        await open(ctx.page, origin(base) + '/dashboard').catch(() => {});
        const sb = await checkSidebar(ctx, rows);
        if (sidebarRow) await record(ctx, sidebarRow, env, sb);
      }
      for (const row of rows) {
        const rule = ruleFor(row);
        if (rule.special) continue;
        let outcome;
        try {
          outcome = await rule.run(ctx, row);
          // Session dropped mid-run: log in again once and retry, so one expiry doesn't fail everything after it.
          if (outcome?.result === 'Fail' && /logged-out/.test(outcome.notes) && account && !isRefusedRole(sheet)) {
            if ((await login(ctx.page, base, account)).ok) outcome = await rule.run(ctx, row);
          }
        } catch (e) {
          outcome = { result: 'Fail', notes: 'Runner error: ' + String(e.message || e).split('\n')[0] };
        }
        if (outcome) await record(ctx, row, env, outcome);
      }
      const logoutRow = rows.find(r => ruleFor(r).special === 'logout');
      if (logoutRow && !isRefusedRole(sheet)) {
        try {
          await logout(ctx.page);
          await ctx.page.goBack().catch(() => {});
          const r = await open(ctx.page, ctx.page.url());
          await record(ctx, logoutRow, env, r.state === 'logged-out' || r.state === 'denied'
            ? { result: 'Pass', notes: 'Signed out; Back shows: ' + r.detail } : { result: 'Fail', notes: 'After sign-out, Back still shows: ' + r.detail });
        } catch (e) {
          await record(ctx, logoutRow, env, { result: 'Fail', notes: 'Could not sign out: ' + String(e.message).split('\n')[0] });
        }
      }
    } finally {
      await context.close().catch(() => {});
      await flush(`${sheet} on ${ENVS[env].label}`);
    }
  }
}
await browser.close();

// ---- output
const csv = path.join(outDir, 'results.csv');
await flush('final retry');
console.log(`\nDone: ${counts.Pass} Pass, ${counts.Fail} Fail, ${counts.Blocked} Blocked. CSV: ${csv}`);
if (opt('push')) {
  console.log(`Pushed ${pushedTotal} of ${results.length} rows to the Check Log.`);
} else {
  console.log('Not pushed. Re-run with --push, or paste the CSV rows into the Check Log.');
}
console.log(summaryLine({ kind: 'access', pass: counts.Pass, fail: counts.Fail, blocked: counts.Blocked, csv, pushed: opt('push') ? pushedTotal : 0 }));
await notify('QA access run finished', `${counts.Pass} Pass, ${counts.Fail} Fail${opt('push') ? `, ${pushedTotal} pushed` : ''}`);
