// npm run test:summary-check - offline checks of the Payroll Summary verifier's rules (fixtures shaped like the
// live records seen on Vercel, 2026-10-23: hdmf 3508, refund 862, hazard HP-0277).
import assert from 'node:assert/strict';
import { payDatesIn, normalise, expected, indexSummary, checkCategory } from './rules.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const P1 = { from: '2026-10-01', to: '2026-10-15' }, P2 = { from: '2026-10-16', to: '2026-10-31' };
const ded = { key: 'hdmf-mpl', label: 'Loans - HDMF (MPL)', kind: 'deduction' };
const add = { key: 'refund', label: 'Refunds', kind: 'addition' };
const ben = { key: 'hazard', label: 'Hazard Pay', kind: 'benefit', benefitKey: 'hazardPay' };
const list = (...eids) => JSON.stringify(eids.map(e => ({ eid: e, id: '9' + e, name: 'E' + e })));

const regularEnd = { payrollDeductionId: '3508', referenceNo: 'MPL-3508', totalAmount: '5,000.00', frequencyOfApplication: 'regular', effectiveDate: '2026-08-13', dueDate: 'Indefinite', status: 'Ongoing', list: list('5', '6'), tbldata: { type_of_deduction: 'loans-hdmf-mpl', type_of_pay: 'monthly', pay_every: 'end' } };
const installment = { payrollAdditionId: '862', referenceNo: 'RFD-0862', totalAmount: '1000.00', frequencyOfApplication: 'installment', effectiveDate: '2026-01-15', dueDate: '2028-01-15', status: 'Pending', list: list('2'),
  breakdown: [{ transactionDate: '2026-10-15', amount: '41.67' }, { transactionDate: '2026-11-15', amount: '41.67' }], tbldata: { type_of_addition: 'refund', type_of_pay: 'monthly', pay_every: '15' } };
const oneTime = { payrollDeductionId: '563', referenceNo: '-0563', totalAmount: '324.41', frequencyOfApplication: 'onetime', effectiveDate: '2026-10-01', dueDate: '2026-10-15', status: 'Ongoing', list: list('4'), tbldata: { type_of_deduction: 'fuel' } };
const benefit = { benefitID: '277', reference: 'HP-0277', amount: '1000.00', frequency: 'regular', type: 'monthly', every: 'end', effectiveFrom: '2025-11-30', effectiveTo: 'Indefinite', includedInPayslip: 'Yes', status: 'Active', empList: ['5', '6'], tbldata: {} };

t('pay dates: 15th / end / semi', () => {
  assert.deepEqual(payDatesIn(P1, '15'), ['2026-10-15']);
  assert.deepEqual(payDatesIn(P1, 'end'), []);
  assert.deepEqual(payDatesIn(P2, 'end'), ['2026-10-31']);
  assert.deepEqual(payDatesIn({ from: '2026-10-01', to: '2026-10-31' }, 'semi'), ['2026-10-15', '2026-10-31']);
  assert.deepEqual(payDatesIn({ from: '2026-02-16', to: '2026-02-28' }, 'end'), ['2026-02-28']);
});
t('expected: regular monthly end is due only in the 16-end cutoff, full amount', () => {
  const r = normalise(ded, regularEnd);
  assert.deepEqual([expected(r, P2).due, expected(r, P2).amount], [true, 5000]);
  assert.equal(expected(r, P1).due, false);
  assert.equal(expected(r, { from: '2026-07-16', to: '2026-07-31' }).due, false, 'before Effective From');
});
t('expected: installment = its schedule rows in the cutoff', () => {
  const r = normalise(add, installment);
  assert.deepEqual([expected(r, P1).due, expected(r, P1).amount], [true, 41.67]);
  assert.equal(expected(r, P2).due, false);
});
t('expected: one time only in the cutoff holding its date', () => {
  const r = normalise(ded, oneTime);
  assert.equal(expected(r, P1).amount, 324.41);
  assert.equal(expected(r, P2).due, false);
});
t('expected: semi-monthly says "more than 0", not an amount', () => {
  const r = normalise(ded, { ...regularEnd, tbldata: { ...regularEnd.tbldata, type_of_pay: 'semi-monthly' } });
  assert.deepEqual([expected(r, P1).due, expected(r, P1).amount], [true, null]);
});

const row = (entryId, items = {}, extra = {}) => ({ entryId, id: '9' + entryId, employeeName: 'E' + entryId, ...items, ...extra });
const item = (type, id, amt, k = 'type_of_deduction') => ({ id, [k]: type, amount_this_period: amt });
t('check: due and present with the right amount = no findings', () => {
  const rows = [row('5', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 5000)] } }), row('6', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 5000)] } })];
  const res = checkCategory(ded, [regularEnd], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2);
  assert.equal(res.findings.length, 0);
  assert.equal(res.counts.pairsOk, 2);
});
t('check: missing, wrong amount, outsider and not-due charges are all reported', () => {
  const rows = [
    row('5', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 0)] } }),                  // missing (0)
    row('6', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 4999)] } }),               // wrong amount
    row('7', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 5000)] } }),               // not on the record
  ];
  const res = checkCategory(ded, [regularEnd], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2);
  assert.deepEqual(res.findings.map(f => [f.entryId, f.why.split(':')[0].split(' (')[0]]), [['5', 'missing from the Payroll Summary'], ['6', 'wrong amount'], ['7', 'charged to an employee who is not on this record']]);
  const notDue = checkCategory(ded, [regularEnd], new Map(rows.map(r => [r.entryId, r])), indexSummary([row('5', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 5000)] } })]), P1);
  assert.equal(notDue.findings[0].why.startsWith('in the summary but not due'), true);
});
t('index: an item left only in a group breakdown counts as missing from its own column', () => {
  const rows = [row('5', { hdmfMPL_: { breakdown: [] }, deductionsNonTaxable_: { breakdown: [{ id: '3508', type: 'loans-hdmf-mpl', amount: 5000 }] } }),
    row('6', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 5000)] } })];
  const res = checkCategory(ded, [regularEnd], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2);
  assert.deepEqual(res.findings.map(f => [f.entryId, f.got]), [['5', 'not listed']]);
});
t('index: union dues (no column of its own) is read from the group breakdown', () => {
  const ud = { ...regularEnd, payrollDeductionId: '3517', tbldata: { ...regularEnd.tbldata, type_of_deduction: 'union-dues' } };
  const rows = ['5', '6'].map(e => row(e, { deductionsNonTaxable_: { breakdown: [{ id: '3517', type: 'union-dues', amount: 5000 }] } }));
  assert.equal(checkCategory(ded, [ud], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2).findings.length, 0);
});
t('check: exited employees and inactive records are skipped, not failed', () => {
  const rows = [row('5', {}, { isInactive: true }), row('6', { hdmfMPL_: { breakdown: [item('loans-hdmf-mpl', '3508', 5000)] } })];
  const res = checkCategory(ded, [regularEnd, { ...regularEnd, payrollDeductionId: '1', status: 'Inactive' }], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2);
  assert.equal(res.findings.length, 0);
  assert.deepEqual([res.counts.skippedExited, res.counts.skippedInactive], [1, 1]);
});
t('check: benefits match payslipBenefits records by reference, keyed on entryId', () => {
  const rec = r => ({ payslipBenefits: { benefits: { hazardPay: { records: r } } } });
  const rows = [row('5', rec([{ reference: 'HP-0277', amount: '1000.00' }])), row('6', rec([]))];
  const res = checkCategory(ben, [benefit], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2);
  assert.deepEqual(res.findings.map(f => [f.entryId, f.got]), [['6', 'not listed']]);
  const off = checkCategory(ben, [{ ...benefit, includedInPayslip: 'No' }], new Map(rows.map(r => [r.entryId, r])), indexSummary(rows), P2);
  assert.deepEqual([off.findings.length, off.counts.notPerRecord], [0, 1]);
});
console.log(`\n${n} checks passed.`);
