/**
 * Edit test cases (ticket 2161): one source for the sheet rows (apps-script/AddEditRows.gs is generated
 * from this by `npm run make-edit-rows`) and for the runner's edit handlers, so the two cannot drift.
 */
import { V2_PAGES, v2Cases, sheetOf, moduleOf } from './v2-pages.js';
import { OTHER_PAGES } from './other-pages.js';

const LOGIN = 'Log in as payroll_officer (repeat a sample with payroll_staff).';

const numbered = steps => (/^Log in as/.test(steps[0]) ? steps : [LOGIN, 'Open the link.', ...steps]).map((s, i) => `${i + 1}. ${s}`).join('\n');

/**
 * Every edit row, in sheet order: { sheet, module, page, list, scenario, foa, ..., steps, expected, auto }.
 * `existing` rows are already in the sheet (from before 2161): they carry automation only and are not added again.
 */
export function editCatalog({ withExisting = false } = {}) {
  const rows = [];
  const push = (sheet, module, page, list, { scenario, steps, expected, cols = {}, auto = null, existing = false }) => (existing && !withExisting) || rows.push({
    sheet, module, page, list, scenario, existing,
    foa: cols.foa || '-', taxable: cols.taxable || '-', payslip: cols.payslip || '-', name: cols.name || '-',
    ref: cols.ref || '-', applicable: cols.applicable || '-', other: cols.other || '-',
    steps: numbered(steps), expected, auto,
  });
  for (const p of V2_PAGES) for (const c of v2Cases(p)) push(sheetOf(p), moduleOf(p), p.page, p.list, c);
  for (const g of OTHER_PAGES) for (const [scenario, steps, expected, cols] of g.cases) push(g.sheet, g.module, g.page, g.list, { scenario, steps, expected, cols });
  return rows;
}

let byKey;
/** The catalog entry for a sheet row (matched on its list page + scenario), or null. */
export function editCaseFor(listPath, scenario) {
  if (!byKey) byKey = new Map(editCatalog({ withExisting: true }).map(r => [r.list + '|' + r.scenario, r]));
  return byKey.get(listPath + '|' + scenario) || null;
}
