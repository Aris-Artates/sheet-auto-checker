#!/usr/bin/env node
/**
 * npm run qa:retest-failed -- [options]   Retest every test whose latest result in the sheet is Fail
 * (what the Retest tab does with "Failed", for both kinds, without the clicks). Made for running unattended,
 * e.g. from the Windows Startup folder.
 *   --env vercel|dotnet|both   which environment's failures (default vercel). Data tests only ever run on Vercel.
 *   --kind access|data|both    which tests (default both)
 *   --no-push                  do not write the new results to the sheet's Check Log (default: write them)
 *   --wait-online 300          wait up to N seconds for the network / sheet first (default 300; 0 = don't wait)
 *   --dry                      only list what would be retested
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';
import { loadStatus } from './sheet.js';
import { notify, summaryLine } from './notify.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const envs = { vercel: ['vercel'], dotnet: ['dotnet'], both: ['vercel', 'dotnet'] }[opt('env', 'vercel')];
const kinds = { access: ['access'], data: ['data'], both: ['access', 'data'] }[opt('kind', 'both')];
if (!envs || !kinds) { console.error('--env must be vercel, dotnet or both; --kind access, data or both'); process.exit(1); }
const push = !opt('no-push');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- latest results from the sheet (waiting for the network after a fresh boot)
const waitFor = Number(opt('wait-online', 300)) || 0;
let status = null, lastErr = '';
for (const deadline = Date.now() + waitFor * 1000; ;) {
  try { status = await loadStatus(); break; } catch (e) { lastErr = String(e.message || e); }
  if (Date.now() > deadline) break;
  console.log(`  (sheet not reachable yet: ${lastErr.slice(0, 80)}; trying again in 20 s)`);
  await sleep(20000);
}
if (!status) { console.error('Could not load the latest results from the sheet: ' + lastErr); await notify('QA retest did not start', 'The sheet could not be reached.'); process.exit(1); }

const plan = [];
for (const kind of kinds) for (const env of envs) {
  if (kind === 'data' && env !== 'vercel') continue; // data tests write records: Vercel only
  const ids = status.filter(r => (kind === 'data' ? /^DP - /.test(r.sheet) : /^TC - /.test(r.sheet)) && r[env] === 'Fail').map(r => r.id);
  if (ids.length) plan.push({ kind, env, ids });
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
console.log(`\nRetest failed tests (${stamp}): ${plan.length ? plan.map(p => `${p.ids.length} ${p.kind} on ${p.env}`).join(', ') : 'nothing failed'}. Results ${push ? 'go to' : 'are NOT written to'} the sheet.`);
if (!plan.length) { await notify('QA retest', 'No failed tests to retest.'); process.exit(0); }
if (opt('dry')) { for (const p of plan) console.log(`  ${p.kind}/${p.env}: ${p.ids.join(', ')}`); process.exit(0); }

// ---- run each batch through the normal runners (same as the Retest tab)
const run = (script, scriptArgs) => new Promise(resolve => {
  let summary = null;
  const child = spawn(process.execPath, [path.join(ROOT, 'src', script), ...scriptArgs], { cwd: ROOT });
  const onData = d => { const s = d.toString(); process.stdout.write(s); const m = s.match(/__SUMMARY__ (.+)/); if (m) try { summary = JSON.parse(m[1]); } catch (_) {} };
  child.stdout.on('data', onData); child.stderr.on('data', d => process.stderr.write(d));
  child.on('close', code => resolve({ code, summary }));
});
const totals = { pass: 0, fail: 0, blocked: 0 };
for (const p of plan) {
  const file = path.join(ROOT, 'results', `retest-${stamp}-${p.kind}-${p.env}.txt`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, p.ids.map(id => (p.kind === 'access' ? `${id}@${p.env}` : id)).join('\n'));
  console.log(`\n=== Retesting ${p.ids.length} failed ${p.kind} tests on ${p.env} ===`);
  const r = p.kind === 'access'
    ? await run('run.js', ['--ids-file', file, '--env', p.env, ...(push ? ['--push'] : [])])
    : await run('run-dp.js', ['--ids-file', file, '--yes', ...(push ? ['--push'] : [])]);
  for (const k of Object.keys(totals)) totals[k] += Number(r.summary?.[k]) || 0;
  if (r.code !== 0) console.log(`  (${p.kind} run ended with code ${r.code})`);
}
const msg = `${totals.pass} now pass, ${totals.fail} still fail${totals.blocked ? `, ${totals.blocked} blocked` : ''}`;
console.log(`\nRetest done: ${msg}.`);
console.log(summaryLine({ kind: 'retest-failed', ...totals }));
await notify('QA retest of failed tests finished', msg);
