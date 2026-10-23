/**
 * Pure rules for the Payroll Summary verifier (ticket 2168): no browser, no fetch, so they are tested
 * offline (npm run test:summary-check).
 *
 * The summary's breakdown lists every record of a type for EVERY employee, with `amount_this_period` = that
 * employee's share for the cutoff (0 = not due, or not theirs). So the check is on amounts, both ways:
 *   - a record due this cutoff must show its amount for each employee on its list ("missing" otherwise);
 *   - it must show 0 for everyone else, and 0 in cutoffs where it is not due.
 */

const money = v => Number(String(v ?? '').replace(/,/g, '')) || 0;
const day = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based
const pad = n => String(n).padStart(2, '0');

/** The pay dates (15th / month-end) inside a cutoff, as YYYY-MM-DD. */
export function payDatesIn(period, payEvery) {
  const out = [];
  let [y, m] = period.from.split('-').map(Number);
  while (`${y}-${pad(m)}-01` <= period.to) {
    const d15 = `${y}-${pad(m)}-15`, dEnd = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
    for (const [d, kind] of [[d15, '15'], [dEnd, 'end']]) if (d >= period.from && d <= period.to && (payEvery === 'semi' || payEvery === kind)) out.push(d);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** One source record in a shape the checks can use. `cat` is its CATEGORIES entry. */
export function normalise(cat, r) {
  const parseList = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
  if (cat.kind === 'benefit') {
    const freq = String(r.frequency || r.tbldata?.frequency || '').toLowerCase();
    return {
      id: String(r.reference || r.tbldata?.approval_reference || r.benefitID), ref: String(r.reference || ''), type: cat.benefitKey,
      label: r.tbldata?.description || r.reference, freq: freq === 'semi-monthly' ? 'regular' : freq,
      from: day(r.effectiveFrom || r.tbldata?.effective_from), to: day(r.effectiveTo || r.tbldata?.effective_to),
      oneTimeDate: day(r.tbldata?.date_of_addition) || day(r.effectiveTo) || day(r.effectiveFrom),
      payEvery: String(r.type || '').toLowerCase() === 'semi-monthly' || freq === 'semi-monthly' ? 'semi' : String(r.every || '').toLowerCase() === 'end' ? 'end' : '15',
      total: money(r.amount ?? r.tbldata?.total_amount),
      schedule: (Array.isArray(r.installments) ? r.installments : []).map(s => ({ date: day(s.installment_date || s.date), amount: money(s.amount) })).filter(s => s.date),
      employees: new Set(parseList(r.empList).map(String)),
      inactive: /inactive|cancel/i.test(String(r.status || '')) || String(r.tbldata?.status ?? '1') === '0',
      inPayslip: /^yes$/i.test(String(r.includedInPayslip || '')) || String(r.tbldata?.include_in_payslip) === '1',
    };
  }
  const t = r.tbldata || {};
  const freq = String(r.frequencyOfApplication || t.frequency || '').toLowerCase();
  const typeOfPay = String(t.type_of_pay || '').toLowerCase();
  return {
    id: String(r.payrollDeductionId || r.payrollAdditionId || t.payroll_deduction_id || t.payroll_addition_id || t.id),
    ref: String(r.referenceNo || ''), type: String(t.type_of_deduction || t.type_of_addition || ''),
    label: r.nameOfDeduction || r.nameOfAddition || r.description || t.description || '',
    // Longevity stores its cadence in `frequency` ("semi-monthly"): it is a regular record.
    freq: freq === 'semi-monthly' || freq === 'monthly' ? 'regular' : freq,
    from: day(r.effectiveDate || t.effective_from), to: day(r.dueDate || t.effective_to),
    oneTimeDate: day(r.dueDate) || day(t.effective_to) || day(r.effectiveDate),
    payEvery: typeOfPay === 'semi-monthly' || freq === 'semi-monthly' ? 'semi' : String(t.pay_every || '').toLowerCase() === 'end' ? 'end' : '15',
    total: money(r.totalAmount ?? t.total_amount),
    schedule: (Array.isArray(r.breakdown) ? r.breakdown : []).map(s => ({ date: day(s.transactionDate), amount: money(s.amount) })).filter(s => s.date),
    employees: new Set(parseList(r.list).map(e => String(e.eid ?? e))),
    inactive: /inactive|cancel|delete/i.test(String(r.status || '')),
    inPayslip: true,
  };
}

/**
 * What the summary should show for this record in this cutoff (per employee on its list):
 * { due, amount } with amount null when only "more than 0" can be said (semi-monthly regular).
 */
export function expected(rec, period) {
  const inEffect = d => (!rec.from || d >= rec.from) && (!rec.to || d <= rec.to);
  if (rec.freq === 'onetime') {
    const d = rec.oneTimeDate;
    const due = !!d && d >= period.from && d <= period.to;
    return { due, amount: due ? rec.total : 0, why: d ? `One Time on ${d}` : 'One Time with no date' };
  }
  if (rec.freq === 'installment') {
    const rows = rec.schedule.filter(s => s.date >= period.from && s.date <= period.to);
    const amount = Math.round(rows.reduce((a, s) => a + s.amount, 0) * 100) / 100;
    return { due: rows.length > 0, amount, why: rows.length ? `installment row(s) ${rows.map(s => s.date).join(', ')}` : 'no installment row in this cutoff' };
  }
  if (rec.freq === 'regular') {
    const dates = payDatesIn(period, rec.payEvery).filter(inEffect);
    const semi = rec.payEvery === 'semi';
    return { due: dates.length > 0, amount: dates.length ? (semi ? null : rec.total * dates.length) : 0, why: dates.length ? `Regular (${semi ? 'semi-monthly' : rec.payEvery === 'end' ? 'monthly, end' : 'monthly, 15th'}) on ${dates.join(', ')}` : `Regular, not due (${rec.payEvery === 'semi' ? 'semi-monthly' : rec.payEvery}${rec.from ? `, effective ${rec.from}..${rec.to || 'indefinite'}` : ''})` };
  }
  return { due: false, amount: 0, unknown: true, why: `unknown frequency "${rec.freq}"` };
}

/**
 * Group breakdowns that REPEAT items of other columns (non-taxable deductions etc.). A type is read from them
 * only when it has no column of its own (Union Dues, Provident Fund): otherwise a record dropped from its own
 * column (fuel_) would still be "found" in the group and the check would miss it.
 */
const GROUP_FIELDS = /^(deductionsNonTaxable|deductionsTaxableNotInTaxBase|deductionsIgnored|grossAmount|grossPay|taxableIncome|netPay|totalDeductions)_$/;
/** Types whose items exist ONLY in a group breakdown (the summary shows them as plain totals). Named, not
 * guessed from the data: a type whose own column is empty for everyone must still count as missing. */
const GROUP_ONLY_TYPES = /^(union-dues|provident-funds?)$/;

/**
 * Index the summary rows: `${type}|${id}` -> Map(entryId -> amount this cutoff).
 * Deduction/addition items come from each type's own `*_` column; benefits from
 * payslipBenefits.benefits[key].records (keyed by reference).
 */
export function indexSummary(rows) {
  const idx = new Map();
  const put = (idx, key, eid, amt) => { if (!idx.has(key)) idx.set(key, new Map()); const m = idx.get(key); if (!m.has(eid) || money(amt)) m.set(eid, money(amt)); };
  for (const row of rows) {
    const eid = String(row.entryId);
    for (const [k, v] of Object.entries(row)) {
      if (k === 'payslipBenefits') {
        for (const [bk, b] of Object.entries(v?.benefits || {})) for (const rec of b?.records || []) put(idx, `${bk}|${rec.reference}`, eid, rec.amount);
        continue;
      }
      if (!k.endsWith('_') || !v || typeof v !== 'object' || !Array.isArray(v.breakdown)) continue;
      for (const it of v.breakdown) {
        const type = it?.type_of_deduction || it?.type_of_addition || it?.type;
        if (!it?.id || !type) continue;
        if (GROUP_FIELDS.test(k) && !GROUP_ONLY_TYPES.test(type)) continue;
        put(idx, `${type}|${it.id}`, eid, it.amount_this_period ?? it.amount);
      }
    }
  }
  return idx;
}

/**
 * Compare one category. Returns { findings[], counts }. A finding is
 * { verdict: 'Fail'|'Warn', category, ref, id, label, employee, entryId, expected, got, why }.
 */
export function checkCategory(cat, records, rowsByEntry, idx, period) {
  const findings = [], counts = { records: records.length, checked: 0, due: 0, pairsOk: 0, skippedInactive: 0, skippedExited: 0, notPerRecord: 0 };
  const name = eid => rowsByEntry.get(eid)?.employeeName || `entry ${eid}`;
  const f = (rec, eid, verdict, exp, got, why) => findings.push({ verdict, category: cat.label, ref: rec.ref || rec.id, id: rec.id, label: rec.label, employee: name(eid), entryId: eid, expected: exp, got, why });
  for (const raw of records) {
    const rec = normalise(cat, raw);
    if (rec.inactive) { counts.skippedInactive++; continue; }
    // Benefits not shown on the payslip have no per-record entry in the summary (only a taxable total).
    if (cat.kind === 'benefit' && !rec.inPayslip) { counts.notPerRecord++; continue; }
    const exp = expected(rec, period);
    counts.checked++;
    if (exp.due) counts.due++;
    const got = idx.get(`${rec.type}|${rec.id}`) || new Map();
    for (const eid of rec.employees) {
      const row = rowsByEntry.get(eid);
      if (!row) { if (exp.due) f(rec, eid, 'Warn', exp.amount ?? '> 0', '-', `employee is not in the Payroll Summary at all (${exp.why})`); continue; }
      if (row.isInactive || /inactive|exited/i.test(String(row.status || ''))) { counts.skippedExited++; continue; }
      const g = got.has(eid) ? got.get(eid) : null;
      if (exp.due && cat.computedAmount) counts.pairsOk++; // any amount (0 included) can be right
      else if (exp.due) {
        if (g == null || g === 0) f(rec, eid, 'Fail', exp.amount ?? '> 0', g == null ? 'not listed' : '0.00', `missing from the Payroll Summary: due this cutoff (${exp.why})`);
        else if (exp.amount != null && Math.abs(g - exp.amount) > 0.01) f(rec, eid, 'Fail', exp.amount, g, `wrong amount (${exp.why})`);
        else counts.pairsOk++;
      } else if (g) f(rec, eid, 'Fail', 0, g, `in the summary but not due this cutoff (${exp.why})`);
      else counts.pairsOk++;
    }
    // Charged to someone who is not on the record's employee list.
    for (const [eid, g] of got) if (g && !rec.employees.has(eid)) f(rec, eid, 'Fail', 0, g, 'charged to an employee who is not on this record');
  }
  return { findings, counts };
}

/** Summary items whose record is on no source list (a deleted record still charged, or a list the check lacks). */
export function orphanItems(idx, knownKeys, rowsByEntry) {
  const out = [];
  for (const [key, m] of idx) {
    if (knownKeys.has(key)) continue;
    for (const [eid, g] of m) if (g) out.push({ verdict: 'Warn', category: key.split('|')[0], ref: key.split('|')[1], id: key.split('|')[1], label: '', employee: rowsByEntry.get(eid)?.employeeName || eid, entryId: eid, expected: '-', got: g, why: 'in the Payroll Summary but on none of the checked source lists' });
  }
  return out;
}
