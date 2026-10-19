/**
 * DP (data permutation) tests: create -> find in list -> delete, driven by the DP sheets.
 *
 * SAFETY RULES (enforced here, not just documented):
 *   - Writes go to APP_URL_VERCEL. APP_URL_DOTNET is refused unless ALLOW_DATA_ON_DOTNET=true
 *     AND the run was started with the typed confirmation (see run-dp.js).
 *   - Every record is applied to the test employee (QA_EMPLOYEE_EID) only, whatever the sheet
 *     row's "Applicable To" says, and is deleted again at the end of the check (unless --keep).
 *   - Every record's Description starts with "QA-AUTO" so leftovers are easy to find.
 *   - Page groups that can affect EVERYONE (rates, gov tables, payments, users, settings...)
 *     are RISKY: off unless ALLOW_RISKY_PAGES=true, and confirmed again before each run.
 */
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { pathOf, origin } from './app.js';

// ---- page groups ---------------------------------------------------------------------------
// `filler: 'v2'` = the shared add form (ApplicableToV2 + FrequencyOfApplicationV2 + footer).
// Groups without a filler are listed in the coverage report as "not automated yet".
const D = '/payroll/deduction/', A = '/payroll/addition/', B = '/benefits/';
export const GROUPS = [
  { key: 'deductions', label: 'Payroll Deductions', risky: false, filler: 'v2', pages: [
    D + 'accounts-receivable', D + 'fuel', D + 'motorcycle', D + 'power-bill', D + 'provident-fund', D + 'union-dues',
    D + 'klcc/canteen-grocery', D + 'klcc/cash-advance', D + 'klcc/health-care-premium', D + 'loan/dbp', D + 'loan/hdmf-calamity',
    D + 'loan/hdmf-mpl', D + 'loan/lbp', D + 'loan/sss-calamity', D + 'loan/sss', D + 'other', D + 'salary-adjustment'] },
  { key: 'additions', label: 'Payroll Additions', risky: false, filler: 'v2', pages: [A + 'other', A + 'refund', A + 'salary-adjustment'] },
  { key: 'benefits', label: 'Benefits', risky: false, filler: 'v2', pages: [B + 'rice-allowance', B + 'hazard-pay', B + 'water-subsidy', B + 'cola', B + 'lighting-allowance', B + 'meal-allowance'] },
  { key: 'special', label: 'Boom Truck, Longevity, SSS/PhilHealth/HDMF contributions', risky: false, filler: null, pages: [
    A + 'boom-truck-premium', A + 'longevity-pay', D + 'sss', D + 'philhealth', D + 'hdmf'] },
  { key: 'employees', label: 'Employees + master data', risky: false, filler: null, pages: ['/employees', '/employees/department', '/employees/branch', '/employees/employment', '/employees/paygroup'] },
  { key: 'rates', label: 'Rates + Gov tables', risky: true, filler: null, pages: ['/payroll/rates', '/payroll/sss', '/payroll/philhealth-table', '/payroll/hdmf-table', '/payroll/withholding-tax'] },
  { key: 'other', label: 'Payments, Leave, Users, Officers, Settings', risky: true, filler: null, pages: [
    '/payroll/payments', '/payroll/bank-payments', '/payroll/settings', '/leave/request', '/leave/types', '/leave/tardiness-charged',
    '/leave/undertimes-absences-charged', '/leave/request/monetization', '/users', '/approving/officers', '/approval-requests/payroll', '/approval-requests/leave'] },
];

const listPathOf = url => pathOf(url).replace(/\/(add|edit|view)(\/.*)?$/, '');
export const groupOf = row => GROUPS.find(g => g.pages.includes(listPathOf(row.vercel || 'https://x/')));

/** Can this DP row run automatically today? */
export function dpAutomatable(row) {
  const g = groupOf(row);
  return !!(g && g.filler && /^Add: /.test(row.raw?.Scenario || ''));
}

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

// ---- helpers --------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pass = notes => ({ result: 'Pass', notes });
const fail = notes => ({ result: 'Fail', notes });
const PARTIAL = 'PARTIAL (save + list + delete; payroll cutoff/payslip effects not checked yet). ';

function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function nextCutoff(kind) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  for (let m = 0; m < 3; m++) {
    const y = t.getFullYear(), mo = t.getMonth() + m;
    const d = kind === '15' ? new Date(y, mo, 15) : new Date(y, mo + 1, 0);
    if (d >= t) return d;
  }
}

async function pickDate(page, trigger, date) {
  await trigger.click();
  const cell = page.locator(`[data-slot="calendar"] td[data-day="${ymd(date)}"] button`);
  for (let i = 0; i < 4 && !(await cell.isVisible().catch(() => false)); i++) {
    await page.getByRole('button', { name: /next month/i }).last().click().catch(() => {});
    await sleep(250);
  }
  await cell.click({ timeout: 5000 });
}

/** Check the radio in group `name` whose value is `value`, if that group exists and it is enabled. */
async function setRadio(page, names, value) {
  for (const n of names) {
    const r = page.locator(`input[type=radio][name="${n}"][value="${value}"]`);
    if (await r.count()) {
      if (await r.isDisabled()) return `${n}=${value} is locked`;
      await r.check();
      return `${n}=${value}`;
    }
  }
  return null;
}

async function setFrequency(page, foa) {
  const f = v => page.locator(`input[type=radio][name="freq"][value="${v}"]`);
  if (/^One Time/.test(foa)) {
    await f('onetime').check();
    const when = nextCutoff(/End/i.test(foa) ? 'end' : '15');
    await pickDate(page, page.locator('div.w-45 button').first(), when);
    return `One Time on ${ymd(when)}`;
  }
  if (/^Regular/.test(foa)) {
    await f('regular').check();
    if (/Semi/i.test(foa)) await page.locator('input[name="regularFreq"][value="semi-monthly"]').check();
    else {
      await page.locator('input[name="regularFreq"][value="monthly"]').check();
      await page.locator(`input[name="monthlyOption"][value="${/end/i.test(foa) ? 'end' : '15'}"]`).check();
    }
    return 'Regular, Indefinite';
  }
  if (/^Installment/.test(foa)) {
    const inst = f('installment');
    if (!(await inst.count())) throw new Error('This page has no Installment option');
    if (await inst.isDisabled()) throw new Error('Installment radio is disabled for this account');
    await inst.check();
    const n = /Semi/i.test(foa) ? 6 : /end/i.test(foa) ? 4 : 3;
    const count = page.locator('input[placeholder="Min. 2"]');
    await count.waitFor({ state: 'visible' });
    await count.fill(String(n));
    await count.blur();
    if (/Semi/i.test(foa)) await page.locator('input[name="installFreq"][value="semi-monthly"]').check();
    else {
      await page.locator('input[name="installFreq"][value="monthly"]').check();
      await page.locator(`input[name="installMonthlyOption"][value="${/end/i.test(foa) ? 'end' : '15'}"]`).check();
    }
    const rate = /no interest/i.test(foa) ? '0' : /monthly interest/i.test(foa) ? '1.5' : '12';
    await page.locator('fieldset input[placeholder="0"]').fill(rate);
    if (/annual/i.test(foa)) {
      await page.locator('fieldset [role="combobox"]').first().click();
      await page.getByRole('option', { name: 'Annually' }).click();
    }
    return `Installment x${n}, interest ${rate}%${/annual/i.test(foa) ? ' annually' : ''}`;
  }
  throw new Error('Unknown frequency: ' + foa);
}

async function pickTestEmployee(page) {
  const eid = config.data.employeeEid;
  await page.locator('input[type=radio][name="applicable"][value="employee"]').check();
  await page.getByRole('combobox').filter({ hasText: /Select employee|\+\d+ more|,/ }).first().click();
  await page.locator('input[cmdk-input]').last().fill(eid);
  await page.locator(`[cmdk-item][data-value$=" ${eid}" i]`).first().click({ timeout: 8000 });
  await page.keyboard.press('Escape');
}

async function saveOutcome(page) {
  const deadline = Date.now() + config.pageTimeoutMs;
  while (Date.now() < deadline) {
    if (await page.getByRole('dialog').filter({ hasText: 'Possible Duplicate Record' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Yes, Continue' }).click();
    }
    const toasts = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
    if (/added|success/i.test(toasts)) return { ok: true, note: toasts.replace(/\s+/g, ' ').slice(0, 120) };
    if (!/\/add$/.test(pathOf(page.url()))) return { ok: true, note: 'Left the add page' };
    const bad = await page.locator('[data-sonner-toast][data-type="warning"], [data-sonner-toast][data-type="error"]').allInnerTexts().catch(() => []);
    if (bad.length) return { ok: false, note: 'Form refused: ' + bad.join(' | ').replace(/\s+/g, ' ').slice(0, 200) };
    await sleep(300);
  }
  return { ok: false, note: 'No success or error message after ' + config.pageTimeoutMs / 1000 + 's' };
}

/** The "by record" view of a list page: deductions call it by-trans, additions/benefits by-eligibility. */
async function findInList(page, listUrl, marker) {
  for (const view of ['by-trans', 'by-eligibility']) {
    await page.goto(`${listUrl}?filter=${view}`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const search = page.locator('input[placeholder="Search"]').first();
    if (await search.isVisible().catch(() => false)) await search.fill(marker);
    const row = page.locator('table tbody tr').filter({ hasText: marker }).filter({ has: page.locator('[data-action^="delete"]') }).first();
    if (await row.waitFor({ timeout: 12000 }).then(() => true).catch(() => false)) return row;
  }
  throw new Error('not found');
}

async function deleteRow(page, row) {
  await row.locator('[data-action^="delete"]').first().click();
  await page.getByRole('button', { name: 'Yes, Delete' }).click({ timeout: 10000 });
  await page.locator('[data-sonner-toast]').filter({ hasText: /deleted/i }).first().waitFor({ timeout: config.pageTimeoutMs });
}

// ---- the shared add form ------------------------------------------------------------------------
async function fillV2(page, row, runId, done) {
  const raw = row.raw;
  const marker = `QA-AUTO ${runId} ${row.id}`;
  // Name: a free-text name field (Name/Type of ...) that is not read-only.
  const nameInput = page.locator('div:has(> label:text-matches("^Name/Type of")) input:not([readonly])');
  if (await nameInput.count()) {
    const want = String(raw.Name || '');
    const suffix = /\(blank\)|locked/i.test(want) ? '' : (want.includes(' - ') ? want.split(' - ').pop() : 'QA');
    if (suffix && !/\(blank\)/.test(suffix)) { await nameInput.first().fill(suffix); done.push('name "' + suffix + '"'); }
    await page.locator('textarea[name="description"]').click();
  }
  await page.fill('textarea[name="description"]', marker);
  const amount = (String(raw['Other Inputs'] || '').match(/Amount\s+(-?[\d,.]+)/) || [])[1] || '1,000.00';
  await page.fill('input[name="amount"]', amount);
  await page.locator('input[name="amount"]').blur();

  const tax = String(raw.Taxable || '').match(/^(Yes|No)/i)?.[1]?.toLowerCase();
  if (tax) { const r = await setRadio(page, ['taxable', 'atti'], tax); if (r) done.push('taxable ' + r); }
  const slip = String(raw['Include in Payslip'] || '').match(/^(Yes|No)/i)?.[1]?.toLowerCase();
  if (slip) { const r = await setRadio(page, ['includeInPayslip'], slip); if (r) done.push('payslip ' + r); }

  await pickTestEmployee(page);
  done.push(`applied to ${config.data.employeeEid} only (sheet said "${raw['Applicable To'] || '-'}")`);
  done.push(await setFrequency(page, raw['Frequency (FOA)'] || ''));

  const ref = String(raw['Reference File'] || '');
  await page.fill('textarea#reason', 'QA automated test');
  if (/No Document/i.test(ref) || !ref || ref === '-') {
    await page.locator('#noDocAttached').click();
    done.push('No Document Attached');
  } else {
    const file = path.join(config.data.filesDir, ref);
    if (!fs.existsSync(file)) throw new Error(`Reference file not found: ${file} (check QA_FILES_DIR)`);
    await page.fill('input[placeholder="Approval reference..."]', `QA-${runId}-${row.id}`.slice(0, 100));
    await page.setInputFiles('#uploadAttachment', file);
    done.push('attached ' + ref);
  }
  return marker;
}

/** One DP row: fill, save, find, delete. */
export async function runDpRow(ctx, row, { runId, keep, base, dotnetConfirmed }) {
  const url = base + pathOf(row.vercel) ;
  assertWritable(url, { dotnetConfirmed });
  if (!config.data.employeeEid) return fail('QA_EMPLOYEE_EID is empty in .env');
  const page = ctx.page;
  const listUrl = origin(url) + listPathOf(url);
  const done = [];
  try {
    await page.goto(listUrl + '/add', { waitUntil: 'load' });
    await page.locator('textarea[name="description"]').waitFor({ timeout: config.pageTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const marker = await fillV2(page, row, runId, done);

    await page.locator('form button[type="submit"]').last().click();
    const saved = await saveOutcome(page);
    if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
    ctx.created = { listUrl, marker };

    const listRow = await findInList(page, listUrl, marker).catch(() => null);
    if (!listRow) return fail('Saved, but the record was not found in the list | ' + done.join('; '));
    if (keep) { ctx.created = null; return pass(PARTIAL + 'Saved and listed (kept, --keep). ' + done.join('; ')); }
    await deleteRow(page, listRow);
    ctx.created = null;
    return pass(PARTIAL + 'Saved, listed and deleted. ' + done.join('; '));
  } catch (e) {
    return fail('Runner error: ' + String(e.message || e).split('\n')[0] + (done.length ? ' | ' + done.join('; ') : ''));
  } finally {
    if (ctx.created && !keep) {
      const { listUrl: l, marker: m } = ctx.created; ctx.created = null;
      await findInList(page, l, m).then(r => deleteRow(page, r)).catch(() =>
        console.log(`  !! could not delete "${m}". Remove it by hand or run the Cleanup action.`));
    }
  }
}

/** Delete every leftover "QA-AUTO" record on all automated list pages. */
export async function cleanupLeftovers(ctx, base, { dotnetConfirmed } = {}) {
  assertWritable(base, { dotnetConfirmed });
  let removed = 0;
  for (const g of GROUPS.filter(x => x.filler)) {
    for (const p of g.pages) {
      for (let i = 0; i < 200; i++) {
        const row = await findInList(ctx.page, base + p, 'QA-AUTO').catch(() => null);
        if (!row) break;
        await deleteRow(ctx.page, row);
        removed++;
      }
    }
  }
  return removed;
}
