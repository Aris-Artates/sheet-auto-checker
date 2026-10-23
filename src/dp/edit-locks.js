/**
 * Read-only "Edit:" checks (ticket 2161): pages that must have no edit, protected gov tables that
 * must refuse an edit, and view-only roles that must not get into an edit page. Nothing is written.
 */
import { pathOf, listPathOf } from '../app.js';
import { pass, fail, sleep } from './common.js';
import { viewOnly } from './edit-v2.js';
import { OTHER_PAGES } from '../edit-catalog/other-pages.js';

const blocked = notes => ({ result: 'Blocked', notes });
const tripleEncode = v => encodeURIComponent(btoa(btoa(btoa(v))));
// The 5 protected records (leyeco3-payroll src/lib/authz/protectedTables.ts) and each table's edit link.
const PROTECTED = {
  '/payroll/sss': { key: 'sss-id', id: '86' }, '/payroll/philhealth-table': { key: 'id', id: '24' },
  '/payroll/hdmf-table': { key: 'id', id: '9' }, '/payroll/withholding-tax': { key: 'id', id: '14' },
};
const EDIT_CONTROL = 'a[href*="/edit"], i.fa-pen-to-square, [data-action^="e-"], [data-action="edit"], [data-action^="edit-"]';

async function noEdit(page, listUrl) {
  await page.goto(listUrl, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  const rows = await page.locator('table tbody tr').count();
  const icons = await page.locator('table tbody tr').locator(EDIT_CONTROL).count();
  if (icons) return fail(`${icons} edit control(s) found in the list rows.`);
  // No edit page either: <list>/edit must not open a form.
  await page.goto(listUrl + '/edit', { waitUntil: 'load' }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const form = await page.locator('main form button[type="submit"]').count();
  const where = pathOf(page.url());
  if (form && /\/edit$/.test(where)) return fail(`${where} opens a form.`);
  return pass(`No edit icon in ${rows} list row(s); ${listUrl.replace(/^https?:\/\/[^/]+/, '')}/edit opens no form.`);
}

async function protectedEdit(page, listUrl) {
  const t = PROTECTED[listPathOf(listUrl)];
  if (!t) return blocked('Not a protected gov table page.');
  // The list: the protected row's edit control is greyed (no data-action, tooltip says protected).
  await page.goto(listUrl, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  const tips = await page.locator('[title*="Protected payroll table" i], [data-tooltip*="Protected payroll table" i]').count();
  // The deep link: must bounce to the read-only view with the protected message.
  await page.goto(`${listUrl}/edit?${tripleEncode(t.key)}=${tripleEncode(t.id)}`, { waitUntil: 'load' });
  let toast = null;
  for (let i = 0; i < 40 && !toast; i++) {
    toast = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ').match(/Protected payroll table[^|]*/i)?.[0] || null;
    await sleep(250);
  }
  // The page loads the edit form first, then sends a protected id on to /view: give it time to leave.
  await page.waitForURL(u => !/\/edit$/.test(pathOf(u.toString())), { timeout: 15000 }).catch(() => {});
  await sleep(1000);
  const where = pathOf(page.url());
  if (/\/edit$/.test(where) && (await page.locator('main form button[type="submit"]').count())) return fail(`The protected table (id ${t.id}) stayed in its edit form for 15 s.`);
  return toast ? pass(`'${toast.trim()}'; sent to ${where}. Greyed list icon(s): ${tips}.`) : fail(`No 'Protected payroll table' message (now on ${where}); greyed list icon(s): ${tips}.`);
}

const CHECKS = {
  'Edit: page has no edit': (page, listUrl) => noEdit(page, listUrl),
  'Edit: protected table cannot be edited': (page, listUrl) => protectedEdit(page, listUrl),
  'Edit: view-only role cannot edit': (page, listUrl) => viewOnly(page, listUrl),
};

async function run(ctx, row, { url }) {
  const check = CHECKS[row.raw?.Scenario];
  return check(ctx.page, url.replace(/\/(add|edit|view)(\/.*)?$/, '').replace(/\/file\/generate$/, ''));
}

/** For every non-V2 page the catalog has these checks on. */
export const editLockHandlers = [{
  edit: true,
  pages: [...new Set(OTHER_PAGES.filter(g => g.cases.some(c => CHECKS[c[0]])).map(g => g.list))],
  match: row => !!CHECKS[row.raw?.Scenario],
  needsEmployee: false,
  run,
}];
