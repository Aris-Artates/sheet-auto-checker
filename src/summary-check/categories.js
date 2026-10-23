/**
 * The source lists the Payroll Summary must pick up (ticket 2168). Each one is read through the app's own
 * proxy (`/api/request?source=...`, the same call the list page makes) and its records are matched to the
 * summary's breakdown items by `type_of_deduction` / `type_of_addition` + the record id.
 *
 * kind: deduction | addition  -> record id = payrollDeductionId / payrollAdditionId, employees = list[] (eid)
 *       benefit               -> record = reference (RA-0276), employees = empList (eid), only payslip benefits
 *                                carry per-record entries (payslipBenefits.benefits[key].records)
 */
export const CATEGORIES = [
  // ---- payroll deductions
  { key: 'fuel', label: 'Fuel', kind: 'deduction', source: 'deduction-data&type=fuel', page: '/payroll/deduction/fuel' },
  { key: 'motorcycle', label: 'Motorcycle', kind: 'deduction', source: 'deduction-data&type=motorcycle', page: '/payroll/deduction/motorcycle' },
  { key: 'power-bill', label: 'Power Bill', kind: 'deduction', source: 'deduction-data&type=power-bill', page: '/payroll/deduction/power-bill' },
  { key: 'accounts-receivable', label: 'Accounts Receivable', kind: 'deduction', source: 'deduction-data&type=accounts-receivable', page: '/payroll/deduction/accounts-receivable' },
  { key: 'other-deduction', label: 'Other Deductions', kind: 'deduction', source: 'deduction-data&type=other-deduction', page: '/payroll/deduction/other' },
  { key: 'salary-adjustment-deduction', label: 'Salary Adjustment (deduction)', kind: 'deduction', source: 'deduction-data&type=salary-adjustment', page: '/payroll/deduction/salary-adjustment' },
  { key: 'union-dues', label: 'Union Dues', kind: 'deduction', source: 'deduction-data&type=union-dues', page: '/payroll/deduction/union-dues' },
  { key: 'provident-fund', label: 'Provident Fund', kind: 'deduction', source: 'deduction-data&type=provident-funds', page: '/payroll/deduction/provident-fund' },
  { key: 'klcc-cash-advance', label: 'KLCC - Cash Advance', kind: 'deduction', source: 'deduction-data&type=klcc-cash-advance', page: '/payroll/deduction/klcc/cash-advance' },
  { key: 'klcc-hcp', label: 'KLCC - Health Care Premium', kind: 'deduction', source: 'deduction-data&type=klcc-hcp', page: '/payroll/deduction/klcc/health-care-premium' },
  { key: 'klcc-canteen-grocery', label: 'KLCC - Canteen/Grocery', kind: 'deduction', source: 'deduction-data&type=klcc-canteen-grocery', page: '/payroll/deduction/klcc/canteen-grocery' },
  { key: 'loans-sss', label: 'Loans - SSS', kind: 'deduction', source: 'deduction-data&type=loans-sss', page: '/payroll/deduction/loan/sss' },
  { key: 'sss-calamity', label: 'Loans - SSS (Calamity)', kind: 'deduction', source: 'deduction-data&type=sss-loan-calamity', page: '/payroll/deduction/loan/sss-calamity' },
  { key: 'loans-lbp', label: 'Loans - LBP', kind: 'deduction', source: 'deduction-data&type=loans-lbp', page: '/payroll/deduction/loan/lbp' },
  { key: 'loans-dbp', label: 'Loans - DBP', kind: 'deduction', source: 'dbp-loans', page: '/payroll/deduction/loan/dbp' },
  { key: 'hdmf-mpl', label: 'Loans - HDMF (MPL)', kind: 'deduction', source: 'hmpl-loans', page: '/payroll/deduction/loan/hdmf-mpl' },
  { key: 'hdmf-calamity', label: 'Loans - HDMF (Calamity)', kind: 'deduction', source: 'hcalamity-loans', page: '/payroll/deduction/loan/hdmf-calamity' },
  // ---- payroll additions
  { key: 'other-addition', label: 'Other Addition', kind: 'addition', source: 'addition-data&type=other-addition', page: '/payroll/addition/other' },
  { key: 'refund', label: 'Refunds', kind: 'addition', source: 'addition-data&type=refund', page: '/payroll/addition/refund' },
  { key: 'salary-adjustment-addition', label: 'Salary Adjustment (addition)', kind: 'addition', source: 'addition-data&type=salary-adjustment', page: '/payroll/addition/salary-adjustment' },
  // The amount comes from the Longevity Pay rate table and each employee's years of service (the record holds
  // 0.00), so 0 is right for anyone not yet eligible: only "not due" and "not on the record" charges are checked.
  { key: 'longevity-pay', label: 'Longevity Pay', kind: 'addition', source: 'addition-data&type=longevity-pay', page: '/payroll/addition/longevity-pay', computedAmount: true },
  // ---- benefits (benefitKey = the summary's payslipBenefits key; note "lightning" for Lighting Allowance)
  { key: 'rice', label: 'Rice Allowance', kind: 'benefit', benefitKey: 'riceAllowance', source: 'benefits&benefit_name=Rice%20Allowance', page: '/benefits/rice-allowance' },
  { key: 'hazard', label: 'Hazard Pay', kind: 'benefit', benefitKey: 'hazardPay', source: 'benefits&benefit_name=Hazard%20Pay', page: '/benefits/hazard-pay' },
  { key: 'water', label: 'Water Subsidy', kind: 'benefit', benefitKey: 'waterBill', source: 'benefits&benefit_name=Water%20Subsidy', page: '/benefits/water-subsidy' },
  { key: 'cola', label: 'COLA', kind: 'benefit', benefitKey: 'cola', source: 'benefits&benefit_name=Cost%20of%20Living%20Allowance%20(COLA)', page: '/benefits/cola' },
  { key: 'lighting', label: 'Lighting Allowance', kind: 'benefit', benefitKey: 'lightning', source: 'benefits&benefit_name=Lighting%20Allowance', page: '/benefits/lighting-allowance' },
  { key: 'meal', label: 'Meal Allowance', kind: 'benefit', benefitKey: 'meal', source: 'benefits&benefit_name=Meal%20Allowance', page: '/benefits/meal-allowance' },
];
