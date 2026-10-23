/**
 * Edit test cases for the shared V2 form: 17 payroll deduction pages, 3 payroll addition pages and
 * 6 benefits. One profile per page says what its edit form allows (read from the app's code and
 * checked on a live edit form, 2026-10-23); the same list of edits is then built for every page
 * with the expected result that profile implies.
 *
 * `auto` is what the runner does for the row (src/dp/edit-v2.js):
 *   base   the record created first (FOA code, see BASE_FOA)
 *   act    the edit applied on the edit page
 *   expect 'saved' | 'refused' | 'dialog' | 'locked' | 'capped' | 'corrected' | 'manual'
 *   re     what the toast / dialog / state must match
 */

const D = '/payroll/deduction/', A = '/payroll/addition/', B = '/benefits/';

// name: free = any text | prefix = combobox with a fixed "<Page> - " prefix | locked = read-only
//       lockedTab = not clickable but not read-only either (keyboard may still reach it)
// tax:  lockedNo / lockedYes = the other option is disabled | free = both selectable
export const V2_PAGES = [
  { list: D + 'accounts-receivable', page: 'Accounts Receivable', name: 'prefix', dup: true, tax: 'lockedNo', payGroup: true },
  { list: D + 'fuel', page: 'Fuel', name: 'prefix', dup: true, tax: 'lockedNo' },
  { list: D + 'motorcycle', page: 'Motorcycle', name: 'prefix', dup: true, tax: 'lockedNo' },
  { list: D + 'power-bill', page: 'Power Bill', name: 'prefix', dup: true, tax: 'lockedNo' },
  { list: D + 'provident-fund', page: 'Provident Fund', name: 'locked', tax: 'lockedNo' },
  { list: D + 'union-dues', page: 'Union Dues', name: 'lockedTab', tax: 'lockedNo' },
  { list: D + 'klcc/canteen-grocery', page: 'KLCC - Canteen/Grocery', name: 'locked', tax: 'lockedNo' },
  { list: D + 'klcc/cash-advance', page: 'KLCC - Cash Advance', name: 'locked', tax: 'lockedNo' },
  { list: D + 'klcc/health-care-premium', page: 'KLCC - Health Care Premium', name: 'locked', tax: 'lockedNo' },
  { list: D + 'loan/dbp', page: 'Loans - DBP', name: 'locked', tax: 'lockedNo' },
  { list: D + 'loan/hdmf-calamity', page: 'Loans - HDMF (Calamity)', name: 'locked', tax: 'lockedNo' },
  { list: D + 'loan/hdmf-mpl', page: 'Loans - HDMF (MPL)', name: 'locked', tax: 'lockedNo' },
  { list: D + 'loan/lbp', page: 'Loans - LBP', name: 'locked', tax: 'lockedNo' },
  { list: D + 'loan/sss-calamity', page: 'Loans - SSS (Calamity)', name: 'lockedTab', tax: 'lockedNo', noAmountCheck: true },
  { list: D + 'loan/sss', page: 'Loans - SSS', name: 'lockedTab', tax: 'lockedNo', noAmountCheck: true },
  { list: D + 'other', page: 'Other Deductions', name: 'free', dup: true, tax: 'free' },
  { list: D + 'salary-adjustment', page: 'Salary Adjustment', name: 'free', dup: true, tax: 'lockedYes' },
  { list: A + 'other', page: 'Other Addition', name: 'free', nameStuck: true, dup: true, tax: 'free' },
  { list: A + 'refund', page: 'Refunds', name: 'prefix', nameRequired: 'Refund Title is required.', dup: true, tax: 'lockedNo' },
  { list: A + 'salary-adjustment', page: 'Salary Adjustment', name: 'free', nameStuck: true, dup: true, tax: 'lockedYes' },
  ...[['rice-allowance', 'Rice Allowance'], ['hazard-pay', 'Hazard Pay'], ['water-subsidy', 'Water Subsidy'], ['cola', 'COLA'], ['lighting-allowance', 'Lighting Allowance'], ['meal-allowance', 'Meal Allowance']]
    .map(([p, page]) => ({ list: B + p, page, benefit: true, name: 'locked', tax: 'free', payslip: true })),
];

export const sheetOf = p => (p.benefit ? 'DP - Benefits' : p.list.startsWith(A) ? 'DP - Payroll Addition' : 'DP - Payroll Deduction');
export const moduleOf = p => (p.benefit ? 'Benefits' : p.list.startsWith(A) ? 'Payroll Addition' : 'Payroll Deduction');

/** Frequency of the record created before each edit. */
export const BASE_FOA = {
  OT15: 'One Time - 15th', OTEnd: 'One Time - End of month', RegM15: 'Regular - Monthly, every 15th', RegMEnd: 'Regular - Monthly, every end of month',
  RegSemi: 'Regular - Semi-Monthly', Inst: 'Installment - Monthly 15th x3, no interest',
};

const kind = p => (p.benefit ? 'benefit' : p.list.startsWith(A) ? 'addition' : 'deduction');
const cut = p => (p.list.startsWith(A) || p.benefit ? 'paid' : 'deducted');

export function v2Cases(p) {
  const K = kind(p), paid = cut(p), dupWarn = p.dup;
  const c = [];
  const add = (scenario, steps, expected, auto, cols = {}) => c.push({ scenario, steps, expected, auto, cols });
  const edit = (from, ...more) => [`Edit a TEST ${from ? from + ' ' : ''}record (description starts with QA-AUTO).`, ...more];

  // ---- frequency switches
  const FOA = [
    ['OT15', 'OTEnd', 'One Time 15th to One Time End of month', 'One Time (15th)', 'Pick the end-of-month date; Save.', `Saved; now ${paid} only in the 16th-end cutoff of that month.`],
    ['OTEnd', 'OT15', 'One Time End of month to One Time 15th', 'One Time (end of month)', 'Pick the 15th; Save.', `Saved; now ${paid} only in the 1st-15th cutoff.`],
    ['OT15', 'RegM15', 'One Time to Regular Monthly 15th', 'One Time', 'Regular Amount, Monthly, Every 15th; Save.', `Saved as Regular; ${paid} every 1st-15th cutoff from Effective From.`],
    ['OT15', 'RegMEnd', 'One Time to Regular Monthly End of month', 'One Time', 'Regular Amount, Monthly, Every End of the month; Save.', `Saved as Regular; ${paid} every 16th-end cutoff.`],
    ['OT15', 'RegSemi', 'One Time to Regular Semi-Monthly', 'One Time', 'Regular Amount, Semi-Monthly; Save.', `Saved as Semi-Monthly; ${paid} in both cutoffs.`],
    ['RegM15', 'RegMEnd', 'Regular Monthly 15th to Monthly End of month', 'Regular Monthly (15th)', 'Every End of the month; Save.', `Saved; from now on ${paid} in the 16th-end cutoff instead of the 1st-15th.`],
    ['RegMEnd', 'RegSemi', 'Regular Monthly End of month to Semi-Monthly', 'Regular Monthly (end of month)', 'Semi-Monthly; Save.', `Saved; ${paid} in both cutoffs.`],
    ['RegSemi', 'RegM15', 'Regular Semi-Monthly to Monthly 15th', 'Regular Semi-Monthly', 'Monthly, Every 15th; Save.', `Saved; ${paid} in the 1st-15th cutoff only.`],
    ['RegM15', 'RegTo', 'Regular Indefinite to an Effective To date', 'Regular, Indefinite', 'Untick Indefinite; Effective To = 3 months after From; Save.', `Saved with that end date; not ${paid} after it.`],
    ['RegTo', 'RegIndef', 'Regular Effective To back to Indefinite', 'Regular with an Effective To', 'Tick Indefinite; Save.', 'Saved as Indefinite (no end date).'],
  ];
  for (const [base, to, label, from, step, exp] of FOA) add(`Edit: ${label}`, edit(from, step), exp, { base, act: 'foa:' + to, expect: 'saved' }, { foa: label.replace(/ to /, ' -> ') });

  if (p.benefit) {
    add('Edit: Installment not offered on edit', edit('Regular', 'Look at Frequency of Application.'), 'Only One Time and Regular are offered; there is no Installment option.', { base: 'RegM15', act: 'inst-absent', expect: 'locked' });
  } else {
    add('Edit: Regular to Installment', edit('Regular', 'Installment, 3 installments, Monthly 15th, no interest; Save.'), 'Saved as Installment; the schedule has 3 rows that add up to the Total Amount.', { base: 'RegM15', act: 'foa:Inst', expect: 'saved' }, { foa: 'Regular -> Installment' });
    add('Edit: One Time to Installment', edit('One Time', 'Installment, 3 installments, Monthly 15th; Save.'), 'Saved as Installment with a 3-row schedule.', { base: 'OT15', act: 'foa:Inst', expect: 'saved' }, { foa: 'One Time -> Installment' });
    add('Edit: Installment to Regular', edit('Installment', 'Regular Amount, Monthly, Every 15th; Save.'), 'Saved as Regular; the installment schedule is gone.', { base: 'Inst', act: 'foa:RegM15', expect: 'saved' }, { foa: 'Installment -> Regular' });
    add('Edit: Installment to One Time', edit('Installment', 'One Time on a 15th; Save.'), 'Saved as One Time; the schedule is gone.', { base: 'Inst', act: 'foa:OT15', expect: 'saved' }, { foa: 'Installment -> One Time' });
    add('Edit: Installment count 3 to 6', edit('Installment (3)', 'No. of Installments 6; Save.'), 'Saved with 6 schedule rows that add up to the Total Amount.', { base: 'Inst', act: 'inst-count', expect: 'saved' }, { foa: 'Installment x3 -> x6' });
    add('Edit: Installment Monthly to Semi-Monthly', edit('Installment (Monthly 15th)', 'Installment frequency Semi-Monthly; Save.'), 'Saved; the schedule dates fall on both cutoffs.', { base: 'Inst', act: 'inst-semi', expect: 'saved' }, { foa: 'Installment Monthly -> Semi-Monthly' });
    add('Edit: Installment interest rate added', edit('Installment (no interest)', 'Interest 12% Annually; Save.'), 'Saved; the schedule amounts include the interest.', { base: 'Inst', act: 'inst-rate', expect: 'saved' }, { foa: 'Installment 0% -> 12% annually' });
    add('Edit: Installment rows no longer add up', edit('Installment', 'Change one schedule row amount so the rows no longer add up to the Total; Save.'),
      'Refused until the rows add up (the short/over banner shows). Known gap: the page saves anyway with the leftover balance.', { base: 'Inst', act: 'inst-mismatch', expect: 'refused', re: 'add up|balance|installment' });
    add('Edit: negative amount on an Installment', edit('Installment', 'Total Amount -500.00.'), "Installment cannot stay selected: 'Amount can't be negative for installment.'", { base: 'Inst', act: 'amount-neg', expect: 'refused', re: "can't be negative|negative" });
  }

  // ---- name
  if (p.name === 'free' || p.name === 'prefix') {
    add('Edit: Name + one letter', edit('', p.name === 'prefix' ? `Add one letter to the end of the name (after the fixed "${p.page} - " part); Save.` : 'Add one letter to the end of Name; Save.'),
      `Saved; the list shows the new name.${dupWarn ? ' No duplicate warning (the record is not compared with itself).' : ''}${p.nameStuck ? ' Known gap: the box puts the saved name back on every keystroke, so the name cannot be changed.' : ''}`, { base: 'RegM15', act: 'name+', expect: 'saved' }, { name: 'Name + 1 letter' });
    if (p.nameRequired) add('Edit: Name cleared', edit('', 'Clear the title; Save.'), `Refused: '${p.nameRequired}'`, { base: 'RegM15', act: 'name-clear', expect: 'refused', re: p.nameRequired }, { name: '(blank)' });
  } else {
    add('Edit: Name is locked', edit('', 'Try to click in Name/Type and type a letter (also try Tab into it).'),
      `Cannot be changed; it stays "${p.page}".${p.name === 'lockedTab' ? ' Known gap: the field is only made unclickable, not read-only, so Tab + typing may still change it.' : ''}`, { base: 'RegM15', act: 'name-locked', expect: 'locked' }, { name: 'locked' });
  }

  // ---- description and amount
  add('Edit: Description + one letter', edit('', 'Add one letter to the end of Description; Save.'), 'Saved; the list shows the new description.', { base: 'RegM15', act: 'desc+', expect: 'saved' });
  add('Edit: Description cleared', edit('', 'Clear Description; Save.'), p.benefit ? "Refused: 'Description is required.'" : 'Refused (Description is required). Nothing saved.', { base: 'RegM15', act: 'desc-clear', expect: 'refused', re: 'description|required|fill' });
  add('Edit: long texts', edit('', 'Paste 600 characters in Description, 120 in Reason and 120 in Approval Reference.'), 'Each is capped (500 / 100 / 100).', { base: 'RegM15', act: 'long', expect: 'capped' });
  add('Edit: Total Amount changed', edit('', 'Total Amount 2,345.67; Save.'), `Saved; the new amount is ${paid} from the next cutoff.`, { base: 'RegM15', act: 'amount', expect: 'saved' }, { other: 'Amount 1,000.00 -> 2,345.67' });
  add('Edit: Total Amount 0', edit('', 'Total Amount 0.00; Save.'), `Refused ('Total Amount is required.' or similar). Nothing saved.${p.noAmountCheck ? ' Known gap: this page only has the browser\'s required check, so 0.00 may save.' : ''}`,
    { base: 'RegM15', act: 'amount0', expect: 'refused', re: 'amount|required' }, { other: 'Amount 0.00' });
  add('Edit: negative amount on Regular', edit('Regular', 'Total Amount -500.00; Save.'), 'Behaves as on Add (current rule: allowed for One Time/Regular and reduces the total). Confirm with BA if unsure.',
    { base: 'RegM15', act: 'amount-neg', expect: 'saved' }, { other: 'Amount -500.00' });

  // ---- taxable / payslip
  if (p.tax === 'free') {
    add('Edit: Taxable Yes to No', edit('Taxable Yes', 'Taxable No; Save.'), `Saved; it no longer ${K === 'deduction' ? 'reduces' : 'adds to'} Taxable Income.`, { base: 'RegM15', baseTax: 'yes', act: 'tax:no', expect: 'saved' }, { taxable: 'Yes -> No' });
    add('Edit: Taxable No to Yes', edit('Taxable No', 'Taxable Yes; Save.'), `Saved; it now ${K === 'deduction' ? 'reduces' : 'adds to'} Taxable Income.`, { base: 'RegM15', baseTax: 'no', act: 'tax:yes', expect: 'saved' }, { taxable: 'No -> Yes' });
  } else {
    const locked = p.tax === 'lockedYes' ? 'Yes' : 'No';
    add('Edit: Taxable is locked', edit('', `Try to pick Taxable ${locked === 'Yes' ? 'No' : 'Yes'}.`), `The other option is disabled; Taxable stays ${locked}.`, { base: 'RegM15', act: 'tax-locked', expect: 'locked', re: locked.toLowerCase() }, { taxable: `locked ${locked}` });
  }
  if (p.payslip) {
    add('Edit: Include in Payslip Yes to No', edit('Include in Payslip Yes', 'Include in Payslip No; Save.'), 'Saved; it no longer shows on the payslip (still paid).', { base: 'RegM15', basePayslip: 'yes', act: 'payslip:no', expect: 'saved' }, { payslip: 'Yes -> No' });
    add('Edit: Include in Payslip No to Yes', edit('Include in Payslip No', 'Include in Payslip Yes; Save.'), 'Saved; it shows on the payslip.', { base: 'RegM15', basePayslip: 'no', act: 'payslip:yes', expect: 'saved' }, { payslip: 'No -> Yes' });
  }

  // ---- dates
  add('Edit: Effective From moved later', edit('Regular', 'Move Effective From one month later; Save.'), `Saved; ${paid} only from the new date.`, { base: 'RegM15', act: 'from-later', expect: 'saved' });
  add('Edit: Date Created changed', edit('', 'Change Date Created to yesterday; Save.'), 'Saved; the list shows the new date.', { base: 'RegM15', act: 'created', expect: 'saved' });
  add('Edit: One Time date before Effective From', edit('One Time', 'Open the One Time date picker and pick a 15th / end of month that is earlier than Effective From.'),
    `Refused: 'Invalid Date of ${K === 'deduction' ? 'Deduction' : 'Addition'} - Date cannot be earlier than the Effective Date From.' (or that date is greyed out).`, { base: 'OT15', act: 'ot-before-from', expect: 'refused', re: 'earlier than the effective|invalid date of' });
  add('Edit: Effective To before From', edit('Regular with an Effective To', 'Set Effective To earlier than Effective From.'), "'Invalid Date Range - The 'To' date cannot be earlier than the 'From' date.' and To is corrected.", { base: 'RegTo', act: 'to-before-from', expect: 'corrected', re: 'invalid date range|earlier' });

  // ---- applicable to
  add('Edit: Applicable To another employee', edit('', 'Remove the employee; pick a different TEST employee; Save.'), 'Saved; only the new employee gets it; the old one no longer does.', { base: 'RegM15', act: 'emp2', expect: 'saved' }, { applicable: 'Employee A -> Employee B' });
  for (const [to, label] of [['branch', 'Branch'], ['department', 'Department'], ['all', 'All Employees'], ...(p.payGroup ? [['paygroup', 'Pay Group']] : [])]) {
    add(`Edit: Applicable To Selected Employee/s to ${label}`, edit('Selected Employee/s', `Applicable To: ${label}${to === 'all' ? '' : ' (pick one)'}; Save.`),
      `Saved; every employee of that ${to === 'all' ? 'company' : label.toLowerCase()} gets it.`, { act: 'applicable:' + to, expect: 'manual', why: 'writes to employees other than the test employee' }, { applicable: `Selected Employee/s -> ${label}` });
  }
  add('Edit: exclude an employee', edit('Branch or Department', 'Exclude one employee; then try to exclude all but the last; Save.'), "The excluded employee no longer gets it; 'Cannot exclude the last employee'.", { act: 'exclude', expect: 'manual', why: 'needs a branch/department record (more than the test employee)' }, { applicable: 'exclude' });

  // ---- footer
  add('Edit: Reason + one letter', edit('', 'Add one letter to Reason; Save.'), 'Saved with the new reason.', { base: 'RegM15', act: 'reason+', expect: 'saved' });
  add('Edit: Reason cleared', edit('', 'Clear Reason; Save.'), "Refused: 'Reason and Approval Reference are required.' (or '... is required.').", { base: 'RegM15', act: 'reason-clear', expect: 'refused', re: 'reason|required' });
  add('Edit: Approval Reference + one letter', edit('record with a file attached', 'Add one letter to Approval Reference; Save.'), 'Saved with the new reference.', { base: 'RegM15', file: true, act: 'ref+', expect: 'saved' }, { ref: 'valid-document.pdf' });
  add('Edit: Approval Reference of another record', edit('record with a file attached', "Set Approval Reference to another TEST record's reference (same page); Save."),
    'Refused (the approval reference must be unique). Nothing saved.', { base: 'RegM15', file: true, second: true, act: 'ref-dup', expect: 'refused', re: 'reference|exist|unique|already' }, { ref: 'valid-document.pdf' });
  add('Edit: replace the attachment', edit('record with a file attached', 'Remove the file; attach valid-image.png; Save.'), 'Saved; the new file is attached and the old one is gone.', { base: 'RegM15', file: true, act: 'file-replace', expect: 'saved' }, { ref: 'valid-document.pdf -> valid-image.png' });
  add('Edit: attachment to No Document Attached', edit('record with a file attached', 'Tick No Document Attached; Save.'), 'Saved; no file; the reference becomes NO_REF_... (read-only).', { base: 'RegM15', file: true, act: 'to-nodoc', expect: 'saved' }, { ref: 'file -> No Document Attached' });
  add('Edit: No Document Attached to a file', edit('No Document Attached', 'Untick No Document Attached; type an Approval Reference; attach valid-document.pdf; Save.'), 'Saved with the file and reference.', { base: 'RegM15', act: 'nodoc-to-file', expect: 'saved' }, { ref: 'No Document Attached -> valid-document.pdf' });
  add('Edit: No Document Attached unticked, no file', edit('No Document Attached', 'Untick No Document Attached; type an Approval Reference; attach nothing; Save.'), "Refused: 'Please upload attachment.'", { base: 'RegM15', act: 'untick-nodoc', expect: 'refused', re: 'upload attachment|attachment' });
  add('Edit: attachment over 2MB', edit('', 'Attach too-large-3MB.pdf.'), "'File Size Exceeded'. File not attached.", { base: 'RegM15', act: 'file-big', expect: 'refused', re: 'exceed|2mb|size' }, { ref: 'too-large-3MB.pdf' });
  add('Edit: attachment wrong type', edit('', 'Attach invalid-type.txt.'), "'Invalid File Type'. File not attached.", { base: 'RegM15', act: 'file-type', expect: 'refused', re: 'invalid file type|not allowed' }, { ref: 'invalid-type.txt' });

  // ---- duplicating another record through edit
  if (dupWarn) {
    add('Edit: make it a copy of another record', ['Have two TEST records on this page that differ only in amount.', 'Edit one; set its amount equal to the other; Save.'],
      "'Possible Duplicate Record' (Record ... already has the exact same settings). 'Yes, Continue' saves it.", { base: 'RegM15', second: true, act: 'dup-copy', expect: 'dialog', re: 'Possible Duplicate Record' });
    add('Edit: copy of another record, Cancel on the warning', ['Have two TEST records that differ only in amount.', 'Edit one to match the other; Save; click Cancel on the warning.'],
      'Nothing saved; the record keeps its old amount.', { base: 'RegM15', second: true, act: 'dup-cancel', expect: 'dialog', re: 'Possible Duplicate Record' });
  } else {
    add('Edit: make it a copy of another record', ['Have two TEST records on this page that differ only in amount.', 'Edit one; set its amount equal to the other; Save.'],
      'A duplicate warning before saving (as on the pages that have one). Known gap: this page has no duplicate check, so the copy saves without a warning.', { base: 'RegM15', second: true, act: 'dup-copy', expect: 'dialog', re: 'Possible Duplicate Record' });
  }

  // ---- rows the sheet already has (before 2161): automated here, not added again (`existing`)
  const have = (scenario, auto) => c.push({ scenario, steps: [], expected: '', auto, cols: {}, existing: true });
  have('Edit: switch Regular to One Time', { base: 'RegM15', act: 'foa:OT15', expect: 'saved' });
  have('Edit: no changes', { base: 'RegM15', act: 'none', expect: 'refused', re: 'no change|nothing (was )?modified|not sent|no new data' });
  if (p.benefit) {
    have('Edit: set Inactive', { base: 'RegM15', act: 'status:Inactive', expect: 'saved' });
    have('Edit: set Active again', { base: 'RegM15', act: 'status:Active', expect: 'saved' });
  }

  // ---- who may edit
  add('Edit: view-only role cannot edit', ['Log in as payroll_mgmt (or payroll_approving_officer) instead.', 'Open the link; click the edit (pencil) icon of a record.'],
    "The icon is greyed out; clicking shows 'View-only access - Your account can view records but can't create, edit, or delete them.' Nothing opens.", { act: 'viewonly', expect: 'locked', re: 'view-only|view only' });
  add('Edit: employee role cannot open the edit link', ['Log in as an employee account.', "Paste this page's edit link (copied from a payroll_officer session) in the address bar."],
    "'Access Denied - Your account does not have permission to access this page.'", { act: 'employee-denied', expect: 'locked', re: 'access denied|permission' });
  return c;
}
