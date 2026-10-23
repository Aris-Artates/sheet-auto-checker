/**
 * DP (data permutation) tests: create -> find -> delete, driven by the DP sheets.
 *
 * SAFETY RULES (enforced here, not just documented):
 *   - Writes go to APP_URL_VERCEL. APP_URL_DOTNET is refused unless ALLOW_DATA_ON_DOTNET=true
 *     AND the run was started with the typed confirmation (see run-dp.js).
 *   - Records are applied to the test employee (QA_EMPLOYEE_EID) only, whatever the sheet row's
 *     "Applicable To" says, and are deleted again at the end of each check (unless --keep).
 *   - Every record this tool creates carries "QA-AUTO" in a name/description so leftovers are findable.
 *   - Groups that can affect EVERYONE are RISKY: off unless ALLOW_RISKY_PAGES=true, confirmed per run.
 *
 * Each group lists its pages and a set of handlers (src/dp/*.js). A handler says which DP rows it
 * can run (match) and runs one: fill, save, verify, and register a cleanup in ctx.created.
 */
import { config } from './config.js';
import { pathOf, origin, listPathOf } from './app.js';
import { pass, fail } from './dp/common.js';
import { v2Handlers, v2Cleanup } from './dp/v2-handler.js';
import { editV2Handlers } from './dp/edit-v2.js';
import { editLockHandlers } from './dp/edit-locks.js';
import { editMasterHandlers } from './dp/edit-master.js';
import { specialHandlers } from './dp/special.js';
import { employeeHandlers } from './dp/employees.js';
import { rateHandlers } from './dp/rates.js';
import { otherHandlers } from './dp/other.js';

const D = '/payroll/deduction/', A = '/payroll/addition/', B = '/benefits/';
export const GROUPS = [
  { key: 'deductions', label: 'Payroll Deductions', risky: false, handlers: [...v2Handlers, ...editV2Handlers], pages: [
    D + 'accounts-receivable', D + 'fuel', D + 'motorcycle', D + 'power-bill', D + 'provident-fund', D + 'union-dues',
    D + 'klcc/canteen-grocery', D + 'klcc/cash-advance', D + 'klcc/health-care-premium', D + 'loan/dbp', D + 'loan/hdmf-calamity',
    D + 'loan/hdmf-mpl', D + 'loan/lbp', D + 'loan/sss-calamity', D + 'loan/sss', D + 'other', D + 'salary-adjustment'] },
  { key: 'additions', label: 'Payroll Additions', risky: false, handlers: [...v2Handlers, ...editV2Handlers], pages: [A + 'other', A + 'refund', A + 'salary-adjustment'] },
  { key: 'benefits', label: 'Benefits', risky: false, handlers: [...v2Handlers, ...editV2Handlers], pages: [B + 'rice-allowance', B + 'hazard-pay', B + 'water-subsidy', B + 'cola', B + 'lighting-allowance', B + 'meal-allowance'] },
  { key: 'special', label: 'Boom Truck, Longevity, SSS/PhilHealth/HDMF contributions', risky: false, handlers: [...specialHandlers, ...editLockHandlers], pages: [
    A + 'boom-truck-premium', A + 'longevity-pay', D + 'sss', D + 'philhealth', D + 'hdmf'] },
  // Read-only: computed pages that must offer no edit (OT, holiday, night shift, absences, withholding tax due).
  { key: 'computed', label: 'Computed pages (edit locks only)', risky: false, handlers: editLockHandlers, pages: [
    A + 'overtime', A + 'holiday-pay', A + 'night-shift-premium', D + 'absences-undertime-late', D + 'withholdingtaxdue'] },
  { key: 'employees', label: 'Employees + master data', risky: false, handlers: [...employeeHandlers, ...editMasterHandlers, ...editLockHandlers], pages: ['/employees', '/employees/department', '/employees/branch', '/employees/employment', '/employees/paygroup'] },
  { key: 'rates', label: 'Rates + Gov tables', risky: true, handlers: [...rateHandlers, ...editLockHandlers], pages: ['/payroll/rates', '/payroll/sss', '/payroll/philhealth-table', '/payroll/hdmf-table', '/payroll/withholding-tax'] },
  { key: 'other', label: 'Payments, Leave, Users, Officers, Settings', risky: true, handlers: [...otherHandlers, ...editLockHandlers], pages: [
    '/payroll/payments', '/payroll/payments/processor', '/payroll/bank-payments', '/payroll/settings', '/leave/request', '/leave/types', '/leave/tardiness-charged',
    '/leave/undertimes-absences-charged', '/leave/request/monetization', '/users', '/approving/officers', '/approval-requests/payroll', '/approval-requests/leave'] },
];
for (const g of GROUPS) g.automated = g.handlers.length > 0;

export { listPathOf };
export const groupOf = row => GROUPS.find(g => g.pages.includes(listPathOf(row.vercel || 'https://x/')));

/** The handler that can run this DP row, or null (= manual). */
export function handlerFor(row) {
  if (!row.sheet?.startsWith('DP - ')) return null;
  const g = groupOf(row);
  if (!g) return null;
  const page = listPathOf(row.vercel);
  // "Edit: ..." rows only go to edit handlers (ticket 2161): several add handlers match every row of their page.
  const isEdit = /^Edit: /.test(String(row.raw?.Scenario || ''));
  return g.handlers.find(h => !!h.edit === isEdit && (!h.pages || h.pages.includes(page)) && h.match(row)) || null;
}
export const dpAutomatable = row => !!handlerFor(row);

/** Throws unless writing to `url` is allowed by the safety rules. */
export function assertWritable(url, { dotnetConfirmed = false } = {}) {
  const host = new URL(url).host;
  const vercel = config.urls.vercel && new URL(config.urls.vercel).host;
  const dotnet = config.urls.dotnet && new URL(config.urls.dotnet).host;
  if (host === vercel) return;
  if (host === dotnet && config.data.allowDotnet && dotnetConfirmed) return;
  if (host === dotnet) throw new Error('Refusing to write data on the .NET deployment (set ALLOW_DATA_ON_DOTNET=true and confirm the warning to override).');
  throw new Error(`Refusing to write data on ${host}: not the configured Vercel deployment.`);
}

/** One DP row: the handler fills, saves and verifies; whatever it created is cleaned up here. */
export async function runDpRow(ctx, row, { runId, keep, base, dotnetConfirmed }) {
  const h = handlerFor(row);
  if (!h) return fail('No automation for this row yet');
  const url = base + pathOf(row.vercel);
  assertWritable(url, { dotnetConfirmed });
  if (h.needsEmployee !== false && !config.data.employeeEid) return fail('QA_EMPLOYEE_EID is empty in .env');
  const done = [];
  ctx.created = null;
  try {
    const out = await h.run(ctx, row, { runId, keep, base, url, done });
    if (out.result === 'Pass' && keep) ctx.created = null;
    return out;
  } catch (e) {
    return fail('Runner error: ' + String(e.message || e).split('\n')[0] + (done.length ? ' | ' + done.join('; ') : ''));
  } finally {
    // Saved but not cleaned up (failure mid-check, or the handler's own delete failed): try once more.
    if (ctx.created && !keep) {
      const c = ctx.created; ctx.created = null;
      await c.cleanup().catch(() => console.log(`  !! could not remove "${c.label}". Remove it by hand or run Cleanup.`));
    }
  }
}

/** Delete every leftover "QA-AUTO" record the automated groups know how to find. */
export async function cleanupLeftovers(ctx, base, { dotnetConfirmed, groups } = {}) {
  assertWritable(base, { dotnetConfirmed });
  let removed = 0;
  for (const g of GROUPS.filter(x => x.automated && (!groups || groups.includes(x.key)))) {
    const seen = new Set();
    for (const h of g.handlers) {
      if (!h.cleanupAll || seen.has(h.cleanupAll)) continue;
      seen.add(h.cleanupAll);
      removed += await h.cleanupAll(ctx, base, g.pages).catch(e => { console.log(`  cleanup ${g.label}: ${e.message}`); return 0; });
    }
  }
  return removed;
}
export { pass, fail };
