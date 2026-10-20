/**
 * Employees + master data: a throw-away TEST employee, department, branch, employment type and pay
 * group, each named QA-AUTO..., then deleted. Nothing here touches existing employees.
 */
import { config } from '../config.js';
import { pathOf } from '../app.js';
import { pass, fail, PARTIAL, sleep, toastOutcome, deleteViaRow, expectRefused } from './common.js';

const blocked = notes => ({ result: 'Blocked', notes });
const sc = row => String(row.raw?.Scenario || '');
const num = row => String(row.id).replace(/\D/g, '').slice(-4);
async function open(page, url, waitFor) {
  await page.goto(url, { waitUntil: 'load' });
  if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: config.pageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}
const finish = async (ctx, keep, done) => {
  if (keep) { ctx.created = null; return pass(PARTIAL + 'Saved (kept, --keep). ' + done.join('; ')); }
  await ctx.created.cleanup(); ctx.created = null;
  return pass(PARTIAL + 'Saved and deleted. ' + done.join('; '));
};
async function searchAndDelete(page, url, searchPh, text, action) {
  await open(page, url);
  const box = page.locator(`input[placeholder="${searchPh}"]`).first();
  if (await box.isVisible().catch(() => false)) await box.fill(text);
  const tr = page.locator('table tbody tr').filter({ hasText: text }).first();
  await tr.waitFor({ timeout: 12000 });
  const d = await deleteViaRow(page, tr, { action });
  if (!d.ok) throw new Error(d.note);
}

// ---------------------------------------------------------------- employee
const AUTOMATED_EMP = /^(Required fields only|All fields filled|Names only spaces|Rate type|Salary 0|Attendance toggles off|Duplicate Employee ID|Payment method Cash|Payment method Bank)/;

async function employee(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  const eid = `QAAUTO${runId}${num(row)}`.slice(0, 50);
  const last = `AUTO-${row.id}`;
  const delEmp = (who) => searchAndDelete(page, `${base}/employees`, 'Search employees...', who, 'i.fa-trash.delete-btn, .delete-btn');
  const create = async (opts = {}) => {
    await open(page, `${base}/employees/add`, 'input[name=employeeID]');
    await page.fill('input[name=employeeID]', opts.eid || eid);
    await page.fill('input[name=firstname]', opts.first ?? 'QA');
    await page.fill('input[name=lastname]', opts.last ?? last);
    if (opts.allFields) await page.fill('input[name=middlename]', 'Test');
    await page.getByRole('button', { name: 'Work Details', exact: true }).click();
    await page.locator('input[name=currentSalaryRate]').waitFor({ timeout: 15000 });
    if (opts.rateType) {
      const box = page.locator('div').filter({ has: page.locator('label, p').filter({ hasText: /Rate Type/i }) }).filter({ has: page.locator('[role=combobox]') }).last();
      await box.locator('[role=combobox]').first().click();
      await page.getByRole('option', { name: opts.rateType, exact: true }).click();
    }
    await page.fill('input[name=currentSalaryRate]', opts.salary ?? '15000');
    if (opts.payment) {
      await page.getByRole('button', { name: 'Add', exact: true }).first().click();
      await page.getByRole('combobox').filter({ hasText: /Select payment method/ }).last().click();
      const want = opts.payment === 'cash' ? page.getByRole('option', { name: /cash/i }) : page.getByRole('option').filter({ hasNotText: /cash/i });
      if (!(await want.count())) { await page.keyboard.press('Escape'); return 'no-method'; }
      await want.first().click();
    }
    if (opts.attendanceOff) {
      await page.getByRole('button', { name: 'Work Schedule', exact: true }).click();
      for (const l of ['Undertime/Tardiness', 'Absences', 'Overtime']) {
        const cb = page.locator(`div:has(> label:text-is("${l}")) [role=checkbox]`).first();
        if ((await cb.getAttribute('aria-checked').catch(() => 'false')) === 'true') await cb.click();
      }
    }
    await page.getByRole('button', { name: /^Save Employee/ }).last().click();
    return null;
  };

  if (/Names only spaces/.test(s)) {
    await create({ first: '   ', last: '   ' });
    const r = await expectRefused(page, /required|Unable to create/i, '/employees/add'); return r.ok ? pass(r.note) : fail(r.note);
  }
  if (/Salary 0/.test(s)) {
    await create({ salary: '0' });
    const r = await expectRefused(page, /Salary/i, '/employees/add'); return r.ok ? pass(r.note) : fail(r.note);
  }
  if (/Payment method Bank/.test(s)) {
    if ((await create({ payment: 'bank' })) === 'no-method') return blocked('No non-cash payment method exists to pick.');
    const r = await expectRefused(page, /Account Number|Payment Method/i, '/employees/add'); return r.ok ? pass(r.note) : fail(r.note);
  }
  const rateType = (s.match(/Rate type (Monthly|Weekly|Daily)/) || [])[1] || (/Rate type/.test(s) ? 'Daily' : null);
  const res = await create({ allFields: /All fields/.test(s), rateType, payment: /Cash/.test(s) ? 'cash' : null, attendanceOff: /Attendance toggles off/.test(s) });
  if (res === 'no-method') return blocked('No Cash payment method exists to pick.');
  const saved = await toastOutcome(page, /Employee Added/i);
  if (!saved.ok) return fail(saved.note);
  done.push(`test employee ${eid} (${last}, QA)`);
  ctx.created = { label: 'employee ' + eid, cleanup: () => delEmp(last) };
  if (/Duplicate Employee ID/.test(s)) {
    await create({ eid, last: last + 'B' });
    const r = await expectRefused(page, null, '/employees/add');
    if (!r.ok) ctx.created = { label: 'employees ' + eid, cleanup: async () => { await delEmp(last + 'B').catch(() => {}); await delEmp(last); } };
    if (!keep) { await ctx.created.cleanup(); ctx.created = null; }
    return r.ok ? pass('Duplicate refused. ' + r.note) : fail(r.note);
  }
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- department / branch / employment type
const ENTITY = {
  '/employees/department': { btn: 'Department', ok: /Department added successfully/i, search: 'Search departments...', del: '[data-action="delete-dept"]', empty: /empty/i },
  '/employees/branch': { btn: 'Branch', ok: /Branch added successfully/i, search: 'Search branches...', del: '[data-action="delete-branch"]', empty: /empty/i },
  '/employees/employment': { btn: 'Employment Type', ok: /Employment Type added successfully/i, search: 'Search employment types...', del: '[data-action="delete-emp"]', empty: /empty/i },
};
async function entity(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row), p = pathOf(row.vercel), e = ENTITY[p];
  const name = `QA-AUTO-${row.id}`.slice(0, 30);
  const openDialog = async () => {
    await open(page, base + p);
    await page.getByRole('button', { name: e.btn, exact: true }).last().click();
    await page.locator('input#entityName').waitFor({ timeout: 8000 });
  };
  await openDialog();
  if (/Name over 30/.test(s)) {
    await page.fill('input#entityName', 'A'.repeat(31));
    const len = (await page.inputValue('input#entityName')).length;
    return len <= 30 ? pass(`Capped at ${len} characters.`) : fail(`Accepted ${len} characters.`);
  }
  if (/Blank name/.test(s)) {
    await page.locator('[role=dialog] button[type=submit]').click();
    const r = await expectRefused(page, e.empty, p); return r.ok ? pass(r.note) : fail(r.note);
  }
  await page.fill('input#entityName', name);
  await page.locator('[role=dialog] button[type=submit]').click();
  const r = await toastOutcome(page, e.ok);
  if (!r.ok) return fail(r.note);
  done.push('created ' + name);
  ctx.created = { label: name, cleanup: () => searchAndDelete(page, base + p, e.search, name, e.del) };
  if (/Duplicate/.test(s)) {
    await openDialog();
    await page.fill('input#entityName', name);
    await page.locator('[role=dialog] button[type=submit]').click();
    const dup = await expectRefused(page, null, p);
    if (!keep) { await ctx.created.cleanup(); ctx.created = null; }
    return dup.ok ? pass('Duplicate refused. ' + dup.note) : fail('Duplicate name was accepted. ' + dup.note);
  }
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- pay group
const GROUP_VALUE = {
  'Country': '#countrySelect', 'Sex': '#sexSelect', 'Employment Type': '#employmentTypeSelect', 'Marital Status': '#maritalStatusSelect',
};
async function payGroup(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  const name = `QA-AUTO-${row.id}`.slice(0, 30);
  await open(page, base + '/employees/paygroup');
  await page.getByRole('button', { name: 'Pay Group', exact: true }).last().click();
  await page.locator('#payGroupName').waitFor({ timeout: 8000 });
  const by = (s.match(/Group by (.+)$/) || [])[1] || 'Sex';
  await page.locator('#groupBy').click();
  await page.getByRole('option', { name: by, exact: true }).click();
  if (GROUP_VALUE[by]) {
    await page.locator(GROUP_VALUE[by]).click();
    await page.getByRole('option').first().click();
  } else if (by === 'Location') {
    const inp = page.locator('input[placeholder="Type to search..."]');
    await inp.fill('a'); await sleep(800);
    await page.locator('[role=dialog] li').first().click().catch(() => {});
  } else if (by === 'Pay Period') {
    const trig = page.locator('[role=dialog] [role=combobox]').filter({ hasText: /payroll period|Select/i }).last();
    if (await trig.count()) { await trig.click(); await page.getByRole('option').first().click().catch(() => page.keyboard.press('Escape')); }
  }
  done.push('group by ' + by);
  await page.fill('#payGroupName', name);
  if (!/no description/.test(s)) await page.fill('textarea#description', `QA-AUTO ${runId} ${row.id}`);
  await page.locator('[role=dialog] button[type=submit]').click();
  if (/no description/.test(s)) { const r = await expectRefused(page, /description/i, '/employees/paygroup'); return r.ok ? pass(r.note) : fail(r.note); }
  const r = await toastOutcome(page, /Pay Group Saved/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  ctx.created = { label: name, cleanup: () => searchAndDelete(page, base + '/employees/paygroup', 'Search pay groups...', name, '[data-action="delete-branch"]') };
  return finish(ctx, keep, done);
}

async function cleanupAll(ctx, base) {
  const page = ctx.page;
  let n = 0;
  const loop = async fn => { for (let i = 0; i < 50; i++) { try { await fn(); n++; } catch (_) { break; } } };
  // Test employees are always last-named "AUTO-DP<sheet>-<n>": narrow enough never to match a real person.
  await loop(() => searchAndDelete(page, `${base}/employees`, 'Search employees...', 'AUTO-DP', 'i.fa-trash.delete-btn, .delete-btn'));
  for (const [p, e] of Object.entries(ENTITY)) await loop(() => searchAndDelete(page, base + p, e.search, 'QA-AUTO', e.del));
  await loop(() => searchAndDelete(page, base + '/employees/paygroup', 'Search pay groups...', 'QA-AUTO', '[data-action="delete-branch"]'));
  return n;
}

export const employeeHandlers = [
  { pages: ['/employees'], match: row => pathOf(row.vercel).endsWith('/employees/add') && AUTOMATED_EMP.test(sc(row)), run: employee, cleanupAll, needsEmployee: false },
  { pages: Object.keys(ENTITY), match: () => true, run: entity, cleanupAll, needsEmployee: false },
  { pages: ['/employees/paygroup'], match: () => true, run: payGroup, cleanupAll, needsEmployee: false },
];
