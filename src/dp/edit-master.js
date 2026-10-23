/**
 * "Edit: ..." rows for Department / Branch / Employment Type / Pay Group (ticket 2161): create a QA-AUTO
 * record, edit it through the page's own edit dialog, check the outcome, then delete what was made.
 */
import { pathOf, listPathOf } from '../app.js';
import { pass, fail, sleep, toastOutcome, deleteViaRow, expectRefused } from './common.js';

const blocked = notes => ({ result: 'Blocked', notes });
const ENTITY = {
  '/employees/department': { btn: 'Department', add: /Department added successfully/i, upd: /Department updated successfully/i, search: 'Search departments...', del: '[data-action="delete-dept"]', empty: /Department name is empty/i, noChanges: false },
  '/employees/branch': { btn: 'Branch', add: /Branch added successfully/i, upd: /Branch updated successfully/i, search: 'Search branches...', del: '[data-action="delete-branch"]', empty: /Branch name is empty/i, noChanges: true },
  '/employees/employment': { btn: 'Employment Type', add: /Employment Type added successfully/i, upd: /Employment Type updated successfully/i, search: 'Search employment types...', del: '[data-action="delete-emp"]', empty: /Employment type is empty/i, noChanges: false },
  '/employees/paygroup': { btn: 'Pay Group', add: /Pay Group Saved/i, upd: /Pay group updated successfully/i, search: 'Search pay groups...', del: '[data-action="delete-branch"]', empty: /proper group name/i, noChanges: true, payGroup: true },
};
const input = e => (e.payGroup ? '#payGroupName' : 'input#entityName');

async function open(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}
async function rowOf(page, url, e, name) {
  await open(page, url);
  const box = page.locator(`input[placeholder="${e.search}"]`).first();
  if (await box.isVisible().catch(() => false)) await box.fill(name);
  const tr = page.locator('table tbody tr').filter({ hasText: name }).first();
  await tr.waitFor({ timeout: 12000 });
  return tr;
}

async function create(page, url, e, name, by = 'Sex') {
  await open(page, url);
  await page.getByRole('button', { name: e.btn, exact: true }).last().click();
  await page.locator(input(e)).waitFor({ timeout: 8000 });
  if (e.payGroup) {
    await page.locator('#groupBy').click();
    await page.getByRole('option', { name: by, exact: true }).click();
    if (by === 'Pay Period') {
      const trig = page.locator('[role=dialog] [role=combobox]').filter({ hasText: /payroll period|Select/i }).last();
      if (await trig.count()) { await trig.click(); await page.getByRole('option').first().click().catch(() => page.keyboard.press('Escape')); }
    } else {
      await page.locator(by === 'Sex' ? '#sexSelect' : '#employmentTypeSelect').click();
      await page.getByRole('option').first().click();
    }
    await page.fill('textarea#description', 'QA-AUTO ' + name);
  }
  await page.fill(input(e), name);
  await page.locator('[role=dialog] button[type=submit]').click();
  const r = await toastOutcome(page, e.add);
  if (!r.ok) throw new Error(`could not create ${name}: ${r.note}`);
}

async function openEdit(page, url, e, name) {
  const tr = await rowOf(page, url, e, name);
  await tr.locator('i.fa-pen-to-square, [data-action^="edit"]').first().click();
  await page.locator(input(e)).waitFor({ timeout: 8000 });
  await sleep(500);
}
const update = page => page.getByRole('button', { name: 'Update', exact: true }).last().click();

const CASES = {
  'Edit: name + one letter': { edit: async (page, e, st) => { st.newName = st.name + 'X'; await page.fill(input(e), st.newName); }, expect: 'saved' },
  'Edit: rename to an existing name': { second: true, edit: (page, e, st) => page.fill(input(e), st.other), expect: 'refused' },
  'Edit: rename to an existing pay group name': { second: true, edit: (page, e, st) => page.fill(input(e), st.other.toLowerCase()), expect: 'refused', re: /already exists/i },
  'Edit: rename to the same name in another case': { edit: async (page, e, st) => { st.newName = st.name.toLowerCase(); await page.fill(input(e), st.newName); }, expect: 'saved' },
  'Edit: rename to its own name in another case': { edit: async (page, e, st) => { st.newName = st.name.toLowerCase(); await page.fill(input(e), st.newName); }, expect: 'saved' },
  'Edit: name cleared': { edit: (page, e) => page.fill(input(e), ''), expect: 'refused', re: 'empty' },
  'Edit: symbols in the name': { edit: async (page, e) => { await page.fill(input(e), ''); await page.locator(input(e)).pressSequentially('  QA-AUTO #@!$', { delay: 10 }); }, expect: 'sanitised' },
  'Edit: no changes': { edit: async () => {}, expect: 'refused', re: /no changes/i },
  'Edit: Group By Pay Period to Sex': { by: 'Pay Period', edit: async page => { await page.locator('#groupBy').click(); await page.getByRole('option', { name: 'Sex', exact: true }).click(); await page.locator('#sexSelect').click(); await page.getByRole('option', { name: 'Male' }).first().click(); }, expect: 'saved' },
  'Edit: Group By to Employment Type': { edit: async page => { await page.locator('#groupBy').click(); await page.getByRole('option', { name: 'Employment Type', exact: true }).click(); await page.locator('#employmentTypeSelect').click(); await page.getByRole('option').first().click(); }, expect: 'saved' },
};

async function run(ctx, row, { base, keep, done }) {
  const page = ctx.page, list = listPathOf(row.vercel), e = ENTITY[list], c = CASES[row.raw?.Scenario];
  if (!e || !c) return blocked('No automation for this edit yet; check by hand.');
  const url = base + list;
  const st = { name: `QA-AUTO-${row.id}`.slice(0, 30) };
  const made = [];
  ctx.created = { label: st.name, cleanup: async () => { for (const n of made.reverse()) { const tr = await rowOf(page, url, e, n); const d = await deleteViaRow(page, tr, { action: e.del }); if (!d.ok) throw new Error(d.note); } } };
  if (c.second) { st.other = `QA-AUTO-${row.id}B`.slice(0, 30); await create(page, url, e, st.other); made.push(st.other); }
  await create(page, url, e, st.name, c.by);
  made.push(st.name);
  done.push(`created ${made.join(' + ')}`);

  await openEdit(page, url, e, st.name);
  await c.edit(page, e, st);
  if (c.expect === 'sanitised') {
    const v = await page.inputValue(input(e));
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click().catch(() => {});
    return /^[A-Za-z0-9 -]*$/.test(v) &&!/^\s/.test(v) && v.length <= 30 ? pass(`Kept "${v}" (symbols and leading spaces dropped).`) : fail(`The name box holds "${v}".`);
  }
  await update(page);
  if (c.expect === 'refused') {
    const re = c.re instanceof RegExp ? c.re : c.re === 'empty' ? e.empty : null;
    const r = await expectRefused(page, re, pathOf(page.url()));
    const note = row.raw.Scenario === 'Edit: no changes' && !e.noChanges && !r.ok ? ' (known gap: this page has no no-changes check)' : '';
    return r.ok ? pass(r.note) : fail(r.note + note + ' | ' + done.join('; '));
  }
  const r = await toastOutcome(page, e.upd);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  if (st.newName) {
    made[made.length - 1] = st.newName; // delete it by its new name
    const seen = await rowOf(page, url, e, st.newName).then(tr => tr.innerText()).catch(() => '');
    if (!seen.includes(st.newName)) return fail(`Saved, but "${st.newName}" is not in the list | ${done.join('; ')}`);
  }
  if (keep) { ctx.created = null; return pass(`Saved. ${done.join('; ')} (kept, --keep)`); }
  return pass(`Saved${st.newName ? ` as "${st.newName}"` : ''}. ${done.join('; ')}`);
}

export const editMasterHandlers = [{ edit: true, pages: Object.keys(ENTITY), match: row => !!CASES[row.raw?.Scenario], needsEmployee: false, run }];
