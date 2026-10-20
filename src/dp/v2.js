/** The shared add form used by Additions, Deductions and Benefits (ApplicableToV2 + FOA V2 + footer). */
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { setRadio, pickTestEmployee, setFrequency } from './common.js';

export async function fillV2(page, row, runId, done) {
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
