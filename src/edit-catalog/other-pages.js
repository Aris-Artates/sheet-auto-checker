/**
 * Edit test cases for the pages that are not the shared V2 add/edit form: Boom Truck, Longevity,
 * contributions, rates, gov tables, employees & setup, payments, leave, users and approvals.
 * Every rule below comes from the app's code (leyeco3-payroll) as of 2026-10-23; where the app
 * is known to behave differently from what it should, the Expected Result says what it SHOULD do
 * and "Known gap:" says what it does today.
 *
 * Each entry: [scenario, steps (after the login line), expected, extra columns?]
 */

const NO_EDIT = (what = 'rows') => [
  ['Edit: page has no edit', ['Open the link.', `Look at the ${what} for an edit (pencil) icon.`],
    'No edit icon or edit page exists for these records; nothing can be changed after saving (delete and re-add instead).'],
];

const VIEW_ONLY = [
  ['Edit: view-only role cannot edit', ['Log in as payroll_mgmt (or payroll_approving_officer) instead.', 'Open the link and click the edit (pencil) icon of any record.'],
    "The icon is greyed out; clicking shows 'View-only access - Your account can view records but can't create, edit, or delete them.' Nothing opens or saves."],
];

const FOOTER = page => [
  ['Edit: Reason and Approval Reference cleared', ['Edit a TEST record.', 'Clear Reason and Approval Reference; Save.'],
    page === 'boom' ? "Refused: 'Reason and Approval Reference are required.'" : "Refused with a '... is required.' message. Nothing saved."],
  ['Edit: Approval Reference of another record', ['Edit a TEST record.', "Set its Approval Reference to another TEST record's reference; Save."],
    'Refused (the approval reference must be unique). Nothing saved.'],
  ['Edit: no changes', ['Open Edit on a TEST record and click Save without changing anything.'], "'No changes detected.' Nothing is re-saved."],
];

export const OTHER_PAGES = [
  // ------------------------------------------------------------------ Payroll Addition
  { sheet: 'DP - Payroll Addition', module: 'Payroll Addition', page: 'Boom Truck Operator Premium', list: '/payroll/addition/boom-truck-premium', cases: [
    ['Edit: One Time 15th to One Time End of month', ['Edit a TEST One Time (15th) record.', 'Pick the end-of-month date; move the operation rows into that half; Save.'], 'Saved; it now appears only in the 16th-end cutoff.', { foa: 'One Time - 15th -> One Time - End' }],
    ['Edit: One Time to Regular Monthly 15th', ['Edit a TEST One Time record.', 'Regular Amount, Monthly, Every 15th; Save.'], 'Saved as Regular Monthly (15th).', { foa: 'One Time -> Regular - Monthly 15th' }],
    ['Edit: Regular Monthly to Semi-Monthly', ['Edit a TEST Regular Monthly record.', 'Semi-Monthly; Save.'], 'Saved as Semi-Monthly.', { foa: 'Regular Monthly -> Semi-Monthly' }],
    ['Edit: Regular Indefinite to an Effective To date', ['Edit a TEST Regular, Indefinite record.', 'Untick Indefinite; Effective To = 3 months after From; Save.'], 'Saved with that end date; no premium after it.', { foa: 'Regular Indefinite -> Effective To' }],
    ['Edit: Description + one letter', ['Edit a TEST record.', "Add one letter to the end of Description; Save."], "'Boom Truck Premium Updated'; the list shows the new description."],
    ['Edit: Name is locked', ['Edit a TEST record.', 'Try to click and type in Name/Type of Addition.'], 'Cannot be changed (it is always Boom Truck Operator Premium).'],
    ['Edit: Taxable is locked', ['Edit a TEST record.', 'Try to pick Taxable No.'], "Disabled; tooltip 'Boom Truck Operator Premium is set to Taxable by default'."],
    ['Edit: Applicable To limited to Selected Employee/s', ['Edit a TEST record.', 'Look at Applicable To.'], 'Only Selected Employee/s is offered (All, Branch and Department are hidden).'],
    ['Edit: change a time row', ['Edit a TEST record with one 8:00 AM - 12:00 PM row.', 'Change it to 1:00 PM - 5:00 PM; Save.'], 'Saved; Hours stay 4.00 and Premium = hours x rate.'],
    ['Edit: add a second time row', ['Edit a TEST record.', 'Click +, add a row on another day in the same half; Save.'], 'Saved with both rows; Premium is the sum of both.'],
    ['Edit: delete a time row', ['Edit a TEST record with two rows.', 'Delete one row; Save.'], 'Saved with one row; Premium recalculated.'],
    ['Edit: overnight row', ['Edit a TEST record.', 'Change a row to 10:00 PM - 6:00 AM (next day).'], "'Shift split at midnight': the entry becomes two rows split at 12:00 AM; Save works."],
    ['Edit: rows overlap inside the record', ['Edit a TEST record.', 'Add a second row on the same day overlapping the first (11:00 AM - 2:00 PM).'], "'Time Conflict - This time range overlaps with another existing entry on the same date.' The overlap cannot be saved."],
    ['Edit: row overlaps another record', ['Have two TEST records for the same employee on the same date at different times.', "Edit one; change its row to overlap the other record's times; Save."], "'Time Conflict' and the save is refused. Known gap: the warning is shown but Save still goes through."],
    ['Edit: row kept on its own saved times', ['Edit a TEST record.', 'Re-pick the same start/end time on its row (no real change to the time); change Description; Save.'], "No 'Time Conflict' against its own saved entry; saved. Known gap: the overlap check does not exclude the record being edited."],
    ['Edit: incomplete row', ['Edit a TEST record.', 'Clear a row\'s Time End; Save.'], "'Incomplete Entries - Please fill in all Date & Time fields for every row completely.'"],
    ['Edit: operation date outside the pay period', ['Edit a TEST record.', 'Open a row date picker and look at last month.'], 'Dates outside the record\'s pay period are greyed out and cannot be picked.'],
    ['Edit: keep the existing attachment', ['Edit a TEST record that has a file attached.', 'Change only Description; Save without uploading again.'], "Saved; the existing file stays attached. Known gap: refused with 'Please upload attachment.' because the kept file is not counted."],
    ...FOOTER('boom'), ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Payroll Addition', module: 'Payroll Addition', page: 'Longevity Pay', list: '/payroll/addition/longevity-pay', cases: [
    ['Edit: Name + one letter', ['Edit a TEST record.', 'Add one letter to the end of Name/Type of Addition; Save.'], 'Saved; the list shows the new name.'],
    ['Edit: Name cleared', ['Edit a TEST record.', 'Clear Name/Type of Addition; Save.'], "Refused: 'Name/Type of Addition is required.'"],
    ['Edit: Description + one letter', ['Edit a TEST record.', 'Add one letter to Description; Save.'], 'Saved with the new description.'],
    ['Edit: Monthly 15th to Monthly End of month', ['Edit a TEST Monthly (15th) record.', 'Every End of the month; Save.'], 'Saved; paid in the 16th-end cutoff from now on.', { foa: 'Monthly 15th -> Monthly End' }],
    ['Edit: Monthly to Semi-Monthly', ['Edit a TEST Monthly record.', 'Semi-Monthly; Save.'], 'Saved; paid in both cutoffs.', { foa: 'Monthly -> Semi-Monthly' }],
    ['Edit: Semi-Monthly to Monthly 15th', ['Edit a TEST Semi-Monthly record.', 'Monthly, Every 15th; Save.'], 'Saved; paid in the 1st-15th cutoff only.', { foa: 'Semi-Monthly -> Monthly 15th' }],
    ['Edit: Indefinite to an Effective To date', ['Edit a TEST Indefinite record.', 'Untick Indefinite; set Effective To; Save.'], 'Saved with the end date.'],
    ['Edit: Effective To before From', ['Edit a TEST record.', 'Set Effective To earlier than From.'], "'Invalid Date Range - The 'To' date cannot be earlier than the 'From' date.' and To is reset."],
    ['Edit: Taxable is locked', ['Edit a TEST record.', 'Try to pick Taxable No.'], "Disabled; tooltip 'Longevity Pay is set to Taxable by default'."],
    ['Edit: Rate is view-only', ['Edit a TEST record.', 'Look at the rate.'], 'The rate cannot be typed; the button only opens the Longevity Pay Table.'],
    ['Edit: Branch with no employees', ['Edit a TEST record.', 'Applicable To: a Branch that has no employees; Save.'], "Refused: 'Selected Branch has no employees.'"],
    ['Edit: overlaps another record of the same employee', ['Have two TEST records for the same employee with different dates.', "Edit one so its dates overlap the other's; Save."], "Dialog 'Are you sure you want to proceed?' (replace / adjust N records). Cancel = nothing saved; Proceed = the other record is trimmed or removed."],
    ['Edit: dates overlap only itself', ['Edit a TEST record.', 'Move its Effective From one day later (still inside its own old range); Save.'], 'No overlap dialog (the record is not compared with itself); saved.'],
    ...FOOTER(), ...VIEW_ONLY,
  ] },
  ...['Overtime Pay', 'Holiday Pay', 'Night Shift Premium'].map(page => ({ sheet: 'DP - Payroll Addition', module: 'Payroll Addition', page,
    list: { 'Overtime Pay': '/payroll/addition/overtime', 'Holiday Pay': '/payroll/addition/holiday-pay', 'Night Shift Premium': '/payroll/addition/night-shift-premium' }[page],
    cases: NO_EDIT('computed rows') })),

  // ------------------------------------------------------------------ Payroll Deduction (contributions + computed pages)
  ...[['SSS Contribution', '/payroll/deduction/sss', 'SSS'], ['PhilHealth Contribution', '/payroll/deduction/philhealth', 'PhilHealth'], ['HDMF Contribution', '/payroll/deduction/hdmf', 'HDMF']].map(([page, list, short]) => ({
    sheet: 'DP - Payroll Deduction', module: 'Payroll Deduction', page, list, cases: [
      ['Edit: Monthly 15th to Monthly End of month', ['Edit a TEST record.', 'Every End of the month; Save.'], 'Saved; deducted in the 16th-end cutoff.', { foa: 'Monthly 15th -> Monthly End' }],
      ['Edit: Monthly to Semi-Monthly', ['Edit a TEST Monthly record.', 'Semi-Monthly; Save.'], 'Saved; deducted in both cutoffs (split).', { foa: 'Monthly -> Semi-Monthly' }],
      ['Edit: Semi-Monthly to Monthly 15th', ['Edit a TEST Semi-Monthly record.', 'Monthly, Every 15th; Save.'], 'Saved; deducted in the 1st-15th cutoff only.', { foa: 'Semi-Monthly -> Monthly 15th' }],
      ['Edit: Indefinite to an Effective To date', ['Edit a TEST Indefinite record.', 'Untick Indefinite; set Effective To; Save.'], 'Saved with the end date.'],
      ['Edit: Effective To before From', ['Edit a TEST record.', 'Set Effective To earlier than From.'], "'Invalid Date Range'; To is reset."],
      ['Edit: set Inactive', ['Edit a TEST Active record.', 'Switch Status to Inactive; Save.'], 'Saved as Inactive; Indefinite is turned off and Effective To becomes today.'],
      ['Edit: set Active again', ['Edit a TEST Inactive record.', 'Switch Status back to Active; Save.'], 'Saved as Active; the previous end date / Indefinite setting is restored.'],
      ['Edit: another active contribution table', ['Edit a TEST record.', `Pick a different Active ${short} table; Save.`], 'Saved; the contribution is computed from that table.'],
      ['Edit: inactive contribution table', ['Edit a TEST record.', `Pick an Inactive ${short} table.`], "'Inactive Table Warning' dialog. Cancel keeps the old table; Continue assigns it."],
      ['Edit: Compensation changed', ['Edit a TEST record; click Show.', "Change the employee's Compensation; Save."], 'Saved; the contribution follows the new compensation. Known gap: the Compensation boxes are not connected to the save, so the monthly rate is still used.'],
      ['Edit: Compensation cleared', ['Edit a TEST record; click Show.', "Clear the employee's Compensation; Save."], "Refused: 'Compensation Required - Please enter compensation for all selected employees.' Known gap: it saves with the monthly rate."],
      ['Edit: Description + one letter', ['Edit a TEST record.', 'Add one letter to Description; Save.'], 'Saved with the new description.'],
      ['Edit: Description cleared', ['Edit a TEST record.', 'Clear Description; Save.'], "Refused: 'Description is required.'"],
      ['Edit: Taxable is locked', ['Edit a TEST record.', 'Try to pick Taxable No.'], `Disabled; tooltip '${short} Contribution is set to Taxable by default'.`],
      ...FOOTER(), ...VIEW_ONLY,
    ] })),
  ...[['Absences/Undertime/Late', '/payroll/deduction/absences-undertime-late'], ['Withholding Tax Due', '/payroll/deduction/withholdingtaxdue']].map(([page, list]) => ({
    sheet: 'DP - Payroll Deduction', module: 'Payroll Deduction', page, list, cases: NO_EDIT('computed rows') })),

  // ------------------------------------------------------------------ Rates
  { sheet: 'DP - Rates', module: 'Payroll', page: 'Rates - Salary', list: '/payroll/rates', cases: [
    ['Edit: Rate Type Monthly to Weekly', ['Edit a TEST salary rate (Monthly).', 'Rate Type: Weekly; pick a Payroll Period again; Save.'], "Saved as Weekly. Changing the rate type clears Payroll Period, so it must be picked again (else 'No Payroll Period Selected')."],
    ['Edit: Rate Type Weekly to Daily', ['Edit a TEST Weekly rate.', 'Rate Type: Daily; pick a Payroll Period; Save.'], 'Saved as Daily.'],
    ['Edit: Rate Type Daily to Monthly', ['Edit a TEST Daily rate.', 'Rate Type: Monthly; pick a Payroll Period; Save.'], 'Saved as Monthly.'],
    ['Edit: Payroll Period Semi-Monthly to Monthly', ['Edit a TEST rate.', 'Change Payroll Period; Save.'], 'Saved with the new payroll period.'],
    ['Edit: Amount changed', ['Edit a TEST rate.', 'Change the amount; Save.'], "'Salary Rates Updated'; payroll uses the new amount from the effective date."],
    ['Edit: Amount 0', ['Edit a TEST rate.', 'Amount 0.00; Save.'], "Refused: 'Invalid Amount - Salary Rate Amount cannot be 0.00 or empty.'"],
    ['Edit: Effective dates overlap another rate', ['Have two TEST rates for one employee, one after the other.', "Edit the later one so it starts inside the earlier one's dates; Save."], "'Rate Conflict Detected' dialog. Cancel = nothing saved; Yes, Proceed = the other rate is closed ('Conflicting Rate Closed') and this one saves."],
    ['Edit: Indefinite to an Effective To date', ['Edit a TEST Indefinite rate.', 'Untick Indefinite; set an end date; Save.'], 'Saved with the end date.'],
    ['Edit: Document File to URL', ['Edit a TEST rate with a file.', 'Switch to URL; https://example.com/doc; Save.'], 'Saved with the URL.'],
    ['Edit: URL not http(s)', ['Edit a TEST rate.', 'URL: ftp://x; Save.'], "Refused: 'Valid URL Required'."],
    ['Edit: Document to No Document Attached', ['Edit a TEST rate.', 'Tick No Document Attached; Save.'], 'Saved; File and URL are disabled.'],
    ['Edit: Approval Reference cleared', ['Edit a TEST rate.', 'Clear Approval Reference; Save.'], "Refused: 'No Approval Reference'."],
    ['Edit: no changes', ['Open Edit on a TEST rate and click Save.'], "'No Changes - No new data to save. Please make changes before updating.'"],
    ['Edit: Position and Employment Type are read-only', ['Edit a TEST rate.', 'Try to type in Position / Employment Type.'], 'Both are read-only (they come from the employee).'],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Rates', module: 'Payroll', page: 'Rates - Overtime', list: '/payroll/rates', cases: [
    ['Edit: Name + one letter', ['Edit a TEST overtime rate.', 'Add one letter to Name; Save.'], 'Saved with the new name.'],
    ['Edit: Percentage Rate changed', ['Edit a TEST overtime rate.', 'Change Percentage Rate; Save.'], 'Saved; OT pay uses the new rate.'],
    ...['Regular Day', 'Rest Day', 'Regular Holiday', 'Special Holiday', 'Night Shift'].map(d => [`Edit: switch ${d} on/off`, ['Edit a TEST overtime rate.', `Toggle ${d}; Save.`], `Saved; the rate applies (or no longer applies) to ${d} overtime.`]),
    ['Edit: every work-day switch off', ['Edit a TEST overtime rate.', 'Turn every work-day switch off; Save.'], "Refused: 'Missing Work Day Type'."],
    ['Edit: Indefinite to an Effective To date', ['Edit a TEST overtime rate.', 'Untick Indefinite; set an end date; Save.'], 'Saved with the end date.'],
    ['Edit: no changes', ['Open Edit on a TEST overtime rate and click Save.'], "'No changes' message. Known gap: this page has no no-changes check and re-saves."],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Rates', module: 'Payroll', page: 'Rates - Night Differential', list: '/payroll/rates', cases: [
    ['Edit: Name + one letter', ['Edit a TEST night differential rate.', 'Add one letter to Name; Save.'], 'Saved with the new name.'],
    ['Edit: time window 22:00-06:00 to 21:00-05:00', ['Edit a TEST night differential rate.', 'Change Start/End time; Save.'], 'Saved; night premium counts the new window.'],
    ['Edit: Percentage Rate cleared', ['Edit a TEST night differential rate.', 'Clear the rate; Save.'], "Refused: 'Missing Percentage Rate'."],
    ['Edit: every day-type switch off', ['Edit a TEST night differential rate.', 'Turn every day-type switch off; Save.'], "Refused: 'Missing Work Day Type'."],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Rates', module: 'Payroll', page: 'Rates - Holiday', list: '/payroll/rates', cases: [
    ['Edit: Name + one letter', ['Edit a TEST holiday rate.', 'Add one letter to Name; Save.'], 'Saved with the new name.'],
    ['Edit: Pay Setup With Pay If Present to With Pay Even Absent', ['Edit a TEST holiday rate.', 'Pay Setup: With Pay Even Present or Absent; Save.'], 'Saved; absent employees are also paid for the holiday.'],
    ['Edit: Pay Setup to No Pay', ['Edit a TEST holiday rate.', 'Pay Setup: No Pay; Save.'], 'Saved; no holiday pay.'],
    ['Edit: Day Type Regular to Special Non-working', ['Edit a TEST holiday rate.', 'Day Type: Special Non-working; Save.'], 'Saved; special non-working rules apply.'],
    ['Edit: Day Type to Special Working', ['Edit a TEST holiday rate.', 'Day Type: Special Working; Save.'], 'Saved.'],
    ['Edit: Day Type to Local', ['Edit a TEST holiday rate.', 'Day Type: Local; Save.'], 'Saved; only the chosen branch/department gets it.'],
    ['Edit: Required to Work Yes to No', ['Edit a TEST holiday rate.', 'Required to Work: No; Save.'], 'Saved.'],
    ['Edit: credit rates changed', ['Edit a TEST holiday rate.', 'Change the four credit rates; Save.'], 'Saved; holiday pay uses the new rates.'],
    ['Edit: Name cleared', ['Edit a TEST holiday rate.', 'Clear Name; Save.'], "Refused: 'Missing Fields'."],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Rates', module: 'Payroll', page: 'Rates - Boom Truck', list: '/payroll/rates', cases: [
    ['Edit: Rate Per Hour changed', ['Edit a TEST boom truck rate.', 'Change Rate Per Hour; Save.'], 'Saved; new boom truck premiums use it.'],
    ['Edit: Rate Per Hour 0', ['Edit a TEST boom truck rate.', 'Rate Per Hour 0; Save.'], "Refused: 'Missing Fields - Please enter a valid rate per hour.'"],
    ['Edit: time window changed', ['Edit a TEST boom truck rate.', 'Change Time Start / End; Save.'], 'Saved.'],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Rates', module: 'Payroll', page: 'Rates - Longevity Pay', list: '/payroll/rates', cases: [
    ['Edit: Monthly Add-on changed', ['Open the Longevity tab; Edit Rates.', 'Change Monthly Add-on; Save Changes.'], 'Saved; new longevity pay uses it.'],
    ['Edit: Eligibility Year changed', ['Edit Rates.', 'Change Eligibility Year (max 2 digits); Save Changes.'], 'Saved.'],
    ['Edit: identical values', ['Edit Rates; Save Changes without changing anything.'], "'No changes made - Value might be identical'."],
    ['Edit: Cancel', ['Edit Rates; change a value; Cancel.'], 'The old values come back; nothing saved.'],
  ] },

  // ------------------------------------------------------------------ Gov tables
  ...[['SSS Table', '/payroll/sss', 'SSS'], ['PhilHealth Table', '/payroll/philhealth-table', 'PhilHealth'], ['HDMF Table', '/payroll/hdmf-table', 'HDMF'], ['Withholding Tax Table', '/payroll/withholding-tax', 'Withholding Tax']].map(([page, list, short]) => ({
    sheet: 'DP - Gov Tables', module: 'Payroll', page, list, cases: [
      ['Edit: protected table cannot be edited', ['Find the protected (system) table in the list.', 'Look at its edit icon; then paste its /edit link in the address bar.'], "Edit and delete icons are grey ('Protected payroll table - cannot be edited or deleted'); the /edit link shows 'Protected payroll table' and opens the read-only view instead."],
      ['Edit: protected table can still be made default', ['Click the default star on the protected table (when it is Active and not default).'], "'Default Table Updated'; only is_default changes."],
      ['Edit: Description + one letter', [`Edit a TEST ${short} table (dated in the future).`, 'Add one letter to Description; Save.'], 'Saved with the new description.'],
      ['Edit: Effectivity moved', [`Edit a TEST ${short} table.`, 'Move Effectivity From; Save.'], 'Saved; the table applies from the new date.'],
      ['Edit: Indefinite to an Effectivity To date', [`Edit a TEST ${short} table.`, 'Untick Indefinite; set an end date; Save.'], 'Saved with the end date.'],
      ['Edit: bracket amount changed', [`Edit a TEST ${short} table.`, 'Change one value in a bracket row; Save.'], 'Saved; contributions/tax use the new value.'],
      ['Edit: add a bracket row', [`Edit a TEST ${short} table.`, 'Add a row at the end; Save.'], 'Saved with the extra bracket.'],
      ['Edit: remove a bracket row', [`Edit a TEST ${short} table.`, 'Remove a row; Save.'], 'Saved without that bracket.'],
      ['Edit: overlapping bracket rows', [`Edit a TEST ${short} table.`, "Make a row's From lower than the previous row's To; Save."], short === 'SSS' ? "Refused: 'Overlap detected: 'From' (x) cannot be lower than previous 'To' (y).'" : "Refused with an 'Invalid ... Range' / 'Invalid ... Order' message."],
      ['Edit: effectivity overlaps the active table', [`Edit a TEST ${short} table.`, "Move its dates so they overlap the current Active table's; Save."], "'Effectivity Overlaps / Active Table Found' with Cancel, Continue with Multiple Active, Set Prev Table to Inactive."],
      ['Edit: no changes', [`Open Edit on a TEST ${short} table and click Save.`], "'No Changes Detected'."],
      ['Edit: required field cleared', [`Edit a TEST ${short} table.`, 'Clear Description; Save.'], "Refused: 'Missing Field' / 'Missing Description'."],
      ...VIEW_ONLY,
    ] })),

  // ------------------------------------------------------------------ Employees & setup
  { sheet: 'DP - Employees & Setup', module: 'Employees', page: 'Employee', list: '/employees', cases: [
    ['Edit: First Name + one letter', ['Open a TEST employee (Employee ID starts with QAAUTO).', 'Add one letter to First Name; Save.'], 'Saved; the list and profile show the new name.'],
    ['Edit: Last Name + one letter', ['Open a TEST employee.', 'Add one letter to Last Name; Save.'], 'Saved with the new last name.'],
    ['Edit: Employee ID of another employee', ['Open a TEST employee.', "Set its Employee ID to another TEST employee's ID; Save."], 'Refused (Employee IDs must be unique). Nothing saved.'],
    ['Edit: email of another employee', ['Open a TEST employee.', "Set its email to another TEST employee's email; Save."], 'Refused (emails must be unique).'],
    ['Edit: invalid email', ['Open a TEST employee.', 'Email: abc@; Save.'], "Refused: '\"abc@\" is not a valid email address.'"],
    ['Edit: same email twice', ['Open a TEST employee.', 'Add a second email equal to the first; Save.'], "Refused: 'Duplicate email!'"],
    ['Edit: TIN with 8 digits', ['Open a TEST employee.', 'TIN: 12345678; Save.'], 'Refused (TIN must have 9 or 12 digits).'],
    ['Edit: SSS number with 9 digits', ['Open a TEST employee.', 'SSS: 123456789; Save.'], 'Refused (SSS must have 10 digits).'],
    ['Edit: Job Status Active to Inactive', ['Open a TEST employee.', 'Job Status: Inactive; Save.'], 'Saved; Exit Date is set to today automatically.'],
    ['Edit: Department switched', ['Open a TEST employee.', 'Pick another Department; Save.'], 'Saved; the employee moves to that department.'],
    ['Edit: Branch switched', ['Open a TEST employee.', 'Pick another Branch; Save.'], 'Saved.'],
    ['Edit: Employment Type switched', ['Open a TEST employee.', 'Pick another Employment Type; Save.'], 'Saved.'],
    ['Edit: Rate Type Monthly to Daily', ['Open a TEST employee; Work Details tab.', 'Rate Type: Daily; pick a Payroll Period; Save.'], 'Saved; payroll computes daily.'],
    ['Edit: Sex switched', ['Open a TEST employee.', 'Sex: the other value; Save.'], 'Saved; gender-only leave types follow the new value.'],
    ['Edit: required field cleared', ['Open a TEST employee.', 'Clear First Name; Save.'], "Refused: 'Unable to update employee - Please fill required fields'."],
    ['Edit: Track Attendance cannot be unchecked', ['Open a TEST employee; Work Schedule tab.', 'Try to untick Track Attendance.'], "Locked; tooltip 'This Attendance has been tracked and cannot be unchecked'."],
    ['Edit: Overtime tracking toggled', ['Open a TEST employee; Work Schedule tab.', 'Toggle Overtime.'], "'Settings Saved' immediately (no Save button needed)."],
    ['Edit: no changes', ['Open a TEST employee and click Save.'], "'No Changes'."],
    ...VIEW_ONLY,
  ] },
  ...[['Department', '/employees/department', 'Department name is empty', false], ['Branch', '/employees/branch', 'Branch name is empty', true], ['Employment Type', '/employees/employment', 'Employment type is empty', false]].map(([page, list, emptyMsg, noChanges]) => ({
    sheet: 'DP - Employees & Setup', module: 'Employees', page, list, cases: [
      ['Edit: name + one letter', [`Click edit on a TEST ${page.toLowerCase()} (name starts with QA-AUTO).`, 'Add one letter; Save.'], `'${page} updated successfully'; the list shows the new name.`],
      ['Edit: rename to an existing name', [`Edit a TEST ${page.toLowerCase()}.`, `Rename it to another existing ${page.toLowerCase()}'s name; Save.`], 'Refused (names must be unique). Nothing renamed.'],
      ['Edit: rename to the same name in another case', [`Edit a TEST ${page.toLowerCase()}.`, 'Change only upper/lower case of its own name; Save.'], 'Saved (it is not a duplicate of itself).'],
      ['Edit: name cleared', [`Edit a TEST ${page.toLowerCase()}.`, 'Clear the name; Save.'], `Refused: '${emptyMsg}'.`],
      ['Edit: symbols in the name', [`Edit a TEST ${page.toLowerCase()}.`, 'Type QA-AUTO #@!$.'], 'Only letters, numbers, spaces and dashes are kept; a leading space is dropped (trailing spaces are trimmed on save); max 30 characters.'],
      ['Edit: no changes', [`Edit a TEST ${page.toLowerCase()} and click Save without changing it.`], noChanges ? "'No Changes Detected'." : "'No changes' message. Known gap: this page has no no-changes check and re-saves."],
      ...VIEW_ONLY,
    ] })),
  { sheet: 'DP - Employees & Setup', module: 'Employees', page: 'Pay Group', list: '/employees/paygroup', cases: [
    ['Edit: name + one letter', ['Click edit on a TEST pay group (QA-AUTO...).', 'Add one letter to Name; Save.'], "'Pay group updated successfully!'"],
    ['Edit: rename to an existing pay group name', ['Edit a TEST pay group.', "Rename it to another pay group's name (any case); Save."], "Refused: 'Failed updating paygroup name. - This pay group name already exists.'"],
    ['Edit: rename to its own name in another case', ['Edit a TEST pay group.', 'Change only the case of its own name; Save.'], 'Saved (its own name is not a duplicate).'],
    ['Edit: Group By Pay Period to Sex', ['Edit a TEST pay group.', 'Group By: Sex, Male; Save.'], 'Saved; members are all male employees.'],
    ['Edit: Group By to Employment Type', ['Edit a TEST pay group.', 'Group By: Employment Type; pick one; Save.'], 'Saved; members follow that employment type.'],
    ['Edit: name cleared', ['Edit a TEST pay group.', 'Clear Name; Save.'], "Refused: 'Please input a proper group name'."],
    ['Edit: no changes', ['Edit a TEST pay group; Save without changing it.'], "'No changes detected.'"],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Employees & Setup', module: 'Payroll', page: 'Payroll Settings', list: '/payroll/settings', cases: [
    ['Edit: working days over the month length', ['Open Payroll Settings.', 'Set a month\'s working days above its days; Save.'], "Refused: 'Invalid Input - Working days cannot exceed N days for <Month>.'"],
    ['Edit: same pay day picked twice', ['Open Payroll Settings.', 'Pick the same day for both semi-monthly cutoffs; Save.'], "Refused: 'Duplicate Day Selection'."],
    ['Edit: confirm dialog Cancel', ['Open Payroll Settings; change a value; Save.', 'Cancel in Confirm Changes.'], 'Nothing applied.'],
    ...VIEW_ONLY,
  ] },

  // ------------------------------------------------------------------ Payments & bank
  { sheet: 'DP - Payments & Bank', module: 'Payroll', page: 'Payroll Payments', list: '/payroll/payments', cases: [
    ['Edit: only Paid rows can be edited', ['Open Payroll Payments for a period.', 'Hover the edit icon of an unpaid row.'], "Greyed out with 'No payment to edit'; only Paid rows open Edit Payment."],
    ['Edit: Payment Method switched', ['Edit a TEST Paid payment.', 'Pick another Payment Method; Save.'], "'Payment Updated Successfully'; the new method shows."],
    ['Edit: Date Paid changed', ['Edit a TEST Paid payment.', 'Change Date Paid; Save.'], 'Saved with the new date.'],
    ['Edit: Reference No + one letter', ['Edit a TEST Paid payment.', 'Add one letter to Reference No; Save.'], 'Saved with the new reference.'],
    ['Edit: Reference No cleared', ['Edit a TEST Paid payment.', 'Clear Reference No; Save.'], "Refused: 'Reference No is required.'"],
    ['Edit: Reference No of another payment', ['Edit a TEST Paid payment.', "Use another payment's Reference No; Save."], 'Refused (reference numbers must be unique). Known gap: no duplicate check; it saves.'],
    ['Edit: proof of payment replaced', ['Edit a TEST Paid payment.', 'Remove the proof; attach valid-image.png; Save.'], 'Saved with the new proof.'],
    ['Edit: Payroll Period and Employee are fixed', ['Edit a TEST Paid payment.', 'Look at Payroll Period and the employee list.'], "Payroll Period is plain text; only the 'Employee Being Edited' is listed."],
    ['Edit: no changes', ['Edit a TEST Paid payment; Save without changes.'], "'No changes' message. Known gap: no check; it re-submits."],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Payments & Bank', module: 'Payroll', page: 'Payment Processor', list: '/payroll/payments/processor', cases: [
    ['Edit: Processor Type + one letter', ['Types tab: edit a TEST type (QA-AUTO...).', 'Add one letter; Save.'], "'Processor Type Updated'."],
    ['Edit: rename to an existing type', ['Types tab: edit a TEST type.', "Rename it to another type's name; Save."], 'Refused (type names must be unique).'],
    ['Edit: Processor Type cleared', ['Types tab: edit a TEST type.', 'Clear the name; Save.'], "Refused: 'Payment Methods Type is required.'"],
    ['Edit: no changes', ['Types tab: edit a TEST type; Save without changes.'], "'No changes detected.'"],
    ['Edit: Employee Accounts edit icon', ['Employee Accounts tab: click an edit icon.'], 'Opens Update Employee Accounts. Known gap: the icon does nothing.'],
    ...VIEW_ONLY,
  ] },
  { sheet: 'DP - Payments & Bank', module: 'Payroll', page: 'Bank Payment Files', list: '/payroll/bank-payments', cases: NO_EDIT() },

  // ------------------------------------------------------------------ Leave, users, approvals
  { sheet: 'DP - Leave Users Approvals', module: 'Leave', page: 'Leave Request', list: '/leave/request', cases: [
    ['Edit: Leave Type Vacation to Sick', ['Edit a TEST leave request (reason starts with QA-AUTO).', 'Leave Type: Sick Leave; fill In Hospital / Out Patient; Save.'], "'Leave Request Updated'; Vacation-only fields are cleared."],
    ['Edit: Leave Type to a female-only type on a male employee', ['Edit a TEST leave of a male employee.', 'Open Leave Type.'], "Maternity / Special Leave Benefits for Women are disabled ('This employee is not female')."],
    ['Edit: Leave Type to Solo Parent without SPIC', ['Edit a TEST leave.', 'Leave Type: Solo Parent; leave the SPIC number empty; Save.'], "Refused: 'Missing Solo Parent ID'."],
    ['Edit: inclusive dates moved', ['Edit a TEST leave.', 'Move From and To one day later; Save.'], 'Saved with the new dates.'],
    ['Edit: To before From', ['Edit a TEST leave.', 'Set To earlier than From.'], "'Invalid Date Range' (corrected while editing; refused on Save)."],
    ['Edit: half day by narrowing the times', ['Edit a TEST one-day leave.', 'Set the times to half a day; Save.'], 'Saved as a half day.'],
    ['Edit: With Pay on to off', ['Edit a TEST leave with pay.', 'Turn With Pay off; Save.'], 'Saved without pay.'],
    ['Edit: Commutation Requested', ['Edit a TEST leave.', 'Commutation: Requested; Save.'], 'Saved.'],
    ['Edit: Vacation Within the Philippines to Abroad', ['Edit a TEST vacation leave.', 'Abroad; type a country; Save.'], 'Saved.'],
    ['Edit: Approval Reference + one letter', ['Edit a TEST leave.', 'Add one letter to Approval Reference; Save.'], 'Saved.'],
    ['Edit: Approval Reference over 30 characters', ['Edit a TEST leave.', 'Approval Reference of 31 characters; Save.'], "Refused: 'Approval Reference Too Long'."],
    ['Edit: Approval Reference of another leave', ['Edit a TEST leave.', "Use another leave's approval reference; Save."], 'Refused (the reference is unique).'],
    ['Edit: dates overlap another leave of the same employee', ['Have two TEST leaves for one employee.', "Edit one so its dates overlap the other's; Save."], 'Refused (an employee cannot be on two leaves at once). Known gap: no check; it saves.'],
    ['Edit: approved leave', ['Edit a TEST leave that is already Approved.', 'Change its dates; Save.'], 'Refused (approved leaves are locked). Known gap: approved/disapproved leaves can still be edited.'],
    ['Edit: no changes', ['Edit a TEST leave; Save without changes.'], "'No Changes - Nothing on this leave request was changed.'"],
    ['Edit: leave approvers cannot open edit', ['Log in as leave_immediate_head or leave_campus_admin.', 'Paste a /leave/request/edit link.'], "'Access Denied'; the Leave Monitor is read-only for them."],
    ...VIEW_ONLY,
  ] },
  ...['Request for Monetization', 'Leave Types', 'Tardiness Charged to VL/SL', 'Undertime/Absence Charged to VSC'].map(page => ({
    sheet: 'DP - Leave Users Approvals', module: 'Leave', page,
    list: { 'Request for Monetization': '/leave/request/monetization', 'Leave Types': '/leave/types', 'Tardiness Charged to VL/SL': '/leave/tardiness-charged', 'Undertime/Absence Charged to VSC': '/leave/undertimes-absences-charged' }[page],
    cases: NO_EDIT() })),
  { sheet: 'DP - Leave Users Approvals', module: 'Users', page: 'Approving Officers', list: '/approving/officers', cases: NO_EDIT() },
  { sheet: 'DP - Leave Users Approvals', module: 'Users', page: 'Users', list: '/users', cases: [
    ['Edit: First Name + one letter', ['Edit a TEST user (username starts with qaauto).', 'Add one letter to First Name; Save.'], "'Profile Updated'."],
    ['Edit: Email is locked', ['Edit a TEST user.', 'Try to type in Email.'], "Read-only: 'Email is managed by the account service and cannot be changed here.'"],
    ['Edit: Username is locked', ['Edit a TEST user.', 'Try to type in Username.'], "Read-only: 'Username cannot be changed after the account is created.'"],
    ['Edit: System Role cannot be changed', ['Edit a TEST user.', 'Look for the role.'], 'The role is not editable here.'],
    ['Edit: password under 8 characters', ['Edit a TEST user.', 'Password: abc12; Save.'], "Refused: 'Password too short - Use at least 8 characters.'"],
    ['Edit: weak password', ['Edit a TEST user.', 'Password: password; Save.'], "'Weak password': saving needs the 'I acknowledge this password is weak' box."],
    ['Edit: link an employee already linked to another user', ['Edit a TEST user.', 'Link an employee that another user is linked to; Save.'], 'Refused (one employee, one user). Known gap: no check in the page.'],
    ['Edit: unlink the employee', ['Edit a TEST user with a linked employee.', 'Click the selected employee again; Save.'], 'Saved; no employee linked.'],
    ['Edit: no changes', ['Edit a TEST user; Save without changes.'], "'Nothing to update - No changes have been made yet.'"],
    ['Edit: payroll_staff cannot open user edit', ['Log in as payroll_staff.', 'Paste a /users/edit link.'], "'Access Denied'."],
    ['Edit: leave approver edits only their own profile', ['Log in as leave_immediate_head.', "Open /users/edit for another user's id."], "'Your account can only open its own profile.'"],
  ] },
  { sheet: 'DP - Leave Users Approvals', module: 'Approval Requests', page: 'Payroll Approval Requests', list: '/approval-requests/payroll', cases: [
    ['Edit: decided request offers Undo only', ['Open an Approved or Rejected TEST request.'], "Only 'Undo' is offered ('Undo This Decision'); it goes back to Pending."],
    ['Edit: approved request cannot be deleted', ['Hover Delete on an Approved TEST request.'], "Disabled: undo the approval before deleting it."],
    ['Edit: approve twice', ['Approve a TEST request in two tabs at once.'], 'The second approval is refused or changes nothing. Known gap: the server writes the new status without checking the current one.'],
  ] },
  { sheet: 'DP - Leave Users Approvals', module: 'Approval Requests', page: 'Leave Approval Requests', list: '/approval-requests/leave', cases: [
    ['Edit: decided leave approval has no Undo', ['Open an approved TEST leave approval.'], 'No Undo; the decision is final.'],
    ['Edit: superadmin cannot decide', ['Log in as superadmin; try Approve on a pending leave.'], 'Refused by the server; only the leave head of the waiting stage can decide.'],
  ] },
];
