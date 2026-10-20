/** Helpers shared by every DP form filler. */
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { pathOf } from '../app.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const pass = notes => ({ result: 'Pass', notes });
export const fail = notes => ({ result: 'Fail', notes });
export const PARTIAL = 'PARTIAL (save + list + delete; payroll cutoff/payslip effects not checked yet). ';

export function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function nextCutoff(kind) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  for (let m = 0; m < 3; m++) {
    const y = t.getFullYear(), mo = t.getMonth() + m;
    const d = kind === '15' ? new Date(y, mo, 15) : new Date(y, mo + 1, 0);
    if (d >= t) return d;
  }
}

export async function pickDate(page, trigger, date) {
  await trigger.click();
  const cell = page.locator(`[data-slot="calendar"] td[data-day="${ymd(date)}"] button`);
  for (let i = 0; i < 4 && !(await cell.isVisible().catch(() => false)); i++) {
    await page.getByRole('button', { name: /next month/i }).last().click().catch(() => {});
    await sleep(250);
  }
  await cell.click({ timeout: 5000 });
}

/** Check the radio in group `name` whose value is `value`, if that group exists and it is enabled. */
export async function setRadio(page, names, value) {
  for (const n of names) {
    const r = page.locator(`input[type=radio][name="${n}"][value="${value}"]`);
    if (await r.count()) {
      if (await r.isDisabled()) return `${n}=${value} is locked`;
      await r.check();
      return `${n}=${value}`;
    }
  }
  return null;
}

export async function setFrequency(page, foa) {
  const f = v => page.locator(`input[type=radio][name="freq"][value="${v}"]`);
  if (/^One Time/.test(foa)) {
    await f('onetime').check();
    const when = nextCutoff(/End/i.test(foa) ? 'end' : '15');
    await pickDate(page, page.locator('div.w-45 button').first(), when);
    return `One Time on ${ymd(when)}`;
  }
  if (/^Regular/.test(foa)) {
    await f('regular').check();
    if (/Semi/i.test(foa)) await page.locator('input[name="regularFreq"][value="semi-monthly"]').check();
    else {
      await page.locator('input[name="regularFreq"][value="monthly"]').check();
      await page.locator(`input[name="monthlyOption"][value="${/end/i.test(foa) ? 'end' : '15'}"]`).check();
    }
    return 'Regular, Indefinite';
  }
  if (/^Installment/.test(foa)) {
    const inst = f('installment');
    if (!(await inst.count())) throw new Error('This page has no Installment option');
    if (await inst.isDisabled()) throw new Error('Installment radio is disabled for this account');
    await inst.check();
    const n = /Semi/i.test(foa) ? 6 : /end/i.test(foa) ? 4 : 3;
    const count = page.locator('input[placeholder="Min. 2"]');
    await count.waitFor({ state: 'visible' });
    await count.fill(String(n));
    await count.blur();
    if (/Semi/i.test(foa)) await page.locator('input[name="installFreq"][value="semi-monthly"]').check();
    else {
      await page.locator('input[name="installFreq"][value="monthly"]').check();
      await page.locator(`input[name="installMonthlyOption"][value="${/end/i.test(foa) ? 'end' : '15'}"]`).check();
    }
    const rate = /no interest/i.test(foa) ? '0' : /monthly interest/i.test(foa) ? '1.5' : '12';
    await page.locator('fieldset input[placeholder="0"]').fill(rate);
    if (/annual/i.test(foa)) {
      await page.locator('fieldset [role="combobox"]').first().click();
      await page.getByRole('option', { name: 'Annually' }).click();
    }
    return `Installment x${n}, interest ${rate}%${/annual/i.test(foa) ? ' annually' : ''}`;
  }
  throw new Error('Unknown frequency: ' + foa);
}

export async function pickTestEmployee(page) {
  const eid = config.data.employeeEid;
  await page.locator('input[type=radio][name="applicable"][value="employee"]').check();
  await page.getByRole('combobox').filter({ hasText: /Select employee|\+\d+ more|,/ }).first().click();
  await page.locator('input[cmdk-input]').last().fill(eid);
  await page.locator(`[cmdk-item][data-value$=" ${eid}" i]`).first().click({ timeout: 8000 });
  await page.keyboard.press('Escape');
}

export async function saveOutcome(page) {
  const deadline = Date.now() + config.pageTimeoutMs;
  while (Date.now() < deadline) {
    if (await page.getByRole('dialog').filter({ hasText: 'Possible Duplicate Record' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Yes, Continue' }).click();
    }
    const toasts = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
    if (/added|success/i.test(toasts)) return { ok: true, note: toasts.replace(/\s+/g, ' ').slice(0, 120) };
    if (!/\/add$/.test(pathOf(page.url()))) return { ok: true, note: 'Left the add page' };
    const bad = await page.locator('[data-sonner-toast][data-type="warning"], [data-sonner-toast][data-type="error"]').allInnerTexts().catch(() => []);
    if (bad.length) return { ok: false, note: 'Form refused: ' + bad.join(' | ').replace(/\s+/g, ' ').slice(0, 200) };
    await sleep(300);
  }
  return { ok: false, note: 'No success or error message after ' + config.pageTimeoutMs / 1000 + 's' };
}

/** The "by record" view of a list page: deductions call it by-trans, additions/benefits by-eligibility. */
export async function findInList(page, listUrl, marker) {
  for (const view of ['by-trans', 'by-eligibility']) {
    await page.goto(`${listUrl}?filter=${view}`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const search = page.locator('input[placeholder="Search"]').first();
    if (await search.isVisible().catch(() => false)) await search.fill(marker);
    const row = page.locator('table tbody tr').filter({ hasText: marker }).filter({ has: page.locator('[data-action^="delete"]') }).first();
    if (await row.waitFor({ timeout: 12000 }).then(() => true).catch(() => false)) return row;
  }
  throw new Error('not found');
}

export async function deleteRow(page, row) {
  await row.locator('[data-action^="delete"]').first().click();
  await page.getByRole('button', { name: 'Yes, Delete' }).click({ timeout: 10000 });
  await page.locator('[data-sonner-toast]').filter({ hasText: /deleted/i }).first().waitFor({ timeout: config.pageTimeoutMs });
}

/** Unique, searchable text put in every record this tool creates. */
export const markerFor = (runId, row) => `QA-AUTO ${runId} ${row.id}`;

/** Fill the shared footer: reason + either an attachment (with approval ref) or "No Document Attached". */
export async function fillFooter(page, row, runId, done, refFile) {
  const ref = String(refFile ?? row.raw['Reference File'] ?? '');
  if (await page.locator('textarea#reason').count()) await page.fill('textarea#reason', 'QA automated test');
  if (/No Document/i.test(ref) || !ref || ref === '-') {
    if (await page.locator('#noDocAttached').count()) { await page.locator('#noDocAttached').click(); done.push('No Document Attached'); }
    return;
  }
  const file = path.join(config.data.filesDir, ref);
  if (!fs.existsSync(file)) throw new Error(`Reference file not found: ${file} (check QA_FILES_DIR)`);
  const appref = page.locator('input[placeholder="Approval reference..."]');
  if (await appref.count()) await appref.fill(`QA-${runId}-${row.id}`.slice(0, 100));
  await page.setInputFiles('#uploadAttachment', file);
  done.push('attached ' + ref);
}

/** Wait for a toast matching `re` (success) or any error/warning toast; returns { ok, note }. */
export async function toastOutcome(page, re, { timeout = config.pageTimeoutMs } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const all = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
    if (re.test(all)) return { ok: true, note: all.slice(0, 140) };
    const bad = await page.locator('[data-sonner-toast][data-type="warning"], [data-sonner-toast][data-type="error"]').allInnerTexts().catch(() => []);
    if (bad.length) return { ok: false, note: 'Refused: ' + bad.join(' | ').replace(/\s+/g, ' ').slice(0, 200) };
    await sleep(300);
  }
  return { ok: false, note: 'No confirmation after ' + timeout / 1000 + 's' };
}

/** Find a table row containing `text` on the current page (optionally typing it in a Search box first). */
export async function rowWithText(page, text, { search = true, timeout = 15000 } = {}) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  if (search) {
    const box = page.locator('input[placeholder="Search"], input[placeholder^="Search"]').first();
    if (await box.isVisible().catch(() => false)) await box.fill(text);
  }
  const row = page.locator('table tbody tr').filter({ hasText: text }).first();
  await row.waitFor({ timeout });
  return row;
}

/** Click a row's delete control, confirm the dialog, and wait for a "deleted/removed" toast. */
export async function deleteViaRow(page, row, { action = '[data-action^="delete"], [title*="Delete" i], [aria-label*="Delete" i]', confirm = /^(Yes, Delete|Delete|Yes|Confirm|Remove)$/ } = {}) {
  await row.locator(action).first().click();
  await page.getByRole('button', { name: confirm }).last().click({ timeout: 10000 });
  return toastOutcome(page, /deleted|removed|success/i);
}

// ---- form helpers used by the rates / gov / employees / other fillers ---------------------------

/** The element that holds a label with this text (label, p or span), for scoping fields that have no name/id. */
export const fieldBox = (page, labelText) =>
  page.locator('div').filter({ has: page.locator(`label, p, span`).filter({ hasText: labelText }) }).last();

/** Open the Radix Select / combobox inside the box labelled `labelText` and choose `optionText`. */
export async function selectOption(page, labelText, optionText, { exact = false } = {}) {
  const box = page.locator('div').filter({ has: page.locator('label, p').filter({ hasText: labelText }) })
    .filter({ has: page.locator('[role=combobox]') }).last();
  await box.locator('[role=combobox]').first().click();
  const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opt = page.getByRole('option', exact ? { name: optionText, exact: true } : { name: new RegExp(escRe(optionText), 'i') });
  await opt.first().click({ timeout: 8000 });
}

/** Tick or untick the "Indefinite" checkbox (Radix) next to an effectivity range. */
export async function setIndefinite(page, on) {
  const cb = page.locator('label:has-text("Indefinite")').locator('xpath=..').locator('button[role=checkbox]').first();
  const box = (await cb.count()) ? cb : page.locator('button[role=checkbox]').filter({ has: page.locator('xpath=..').filter({ hasText: 'Indefinite' }) }).first();
  if (!(await box.count())) return false;
  const now = (await box.getAttribute('aria-checked')) === 'true';
  if (now !== on && !(await box.isDisabled())) await box.click();
  return true;
}

/**
 * Pick any date in a date popover (DateSinglePicker / DateRangeIndefinite): uses the Month and Year
 * selects inside the popover, so dates years away work too.
 */
export async function pickDateAnywhere(page, trigger, date) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  await trigger.click();
  const pop = page.locator('[data-radix-popper-content-wrapper]').last();
  await pop.waitFor({ timeout: 5000 });
  const combos = pop.locator('[role=combobox]');
  if (await combos.count() >= 2) {
    await combos.nth(0).click(); await page.getByRole('option', { name: MONTHS[date.getMonth()], exact: true }).click();
    await combos.nth(1).click(); await page.getByRole('option', { name: String(date.getFullYear()), exact: true }).click();
  }
  await pop.locator(`td[data-day="${ymd(date)}"]:not([data-outside]) button`).first().click({ timeout: 5000 });
  // Some date popovers stay open after a pick; close it so it can't cover the next field.
  if (await pop.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

/** Set the From / To of a DateRangeIndefinite. `to` null = leave it (or Indefinite). */
export async function setEffectivity(page, from, to) {
  if (from) await pickDateAnywhere(page, page.getByRole('button', { name: /^From:/ }).first(), from);
  if (to) {
    await setIndefinite(page, false);
    await pickDateAnywhere(page, page.getByRole('button', { name: /^To:/ }).first(), to);
  }
}

/** ApplicableToV2 / V1: choose the "employee(s)" radio and pick the test employee by Employee ID. */
export async function pickTestEmployeeAny(page, { value } = {}) {
  const eid = config.data.employeeEid;
  const radio = value ? page.locator(`input[type=radio][name="applicable"][value="${value}"]`)
    : page.locator('input[type=radio][name="applicable"][value="employee"], input[type=radio][name="applicable"][value="employees"]');
  if (await radio.count()) await radio.first().check();
  await page.getByRole('combobox').filter({ hasText: /Select employee|\+\d+ more|,/i }).first().click();
  await page.locator('input[cmdk-input]').last().fill(eid);
  await page.locator(`[cmdk-item][data-value$=" ${eid}" i]`).first().click({ timeout: 8000 });
  await page.keyboard.press('Escape');
}

/** TimePicker (hour / minute / AM-PM columns) inside the box labelled `labelText`. `time` like "10:00 PM". */
export async function pickTime(page, labelText, time) {
  const [, hh, mm, ap] = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const box = page.locator('div').filter({ has: page.locator('label, p').filter({ hasText: labelText }) }).last();
  await box.getByRole('button').first().click();
  const pop = page.locator('[data-slot=popover-content], [data-radix-popper-content-wrapper]').last();
  // Three scroll columns: hours, minutes, AM/PM (hour labels 10-12 also exist as minutes, so scope by column).
  let cols = pop.locator('[data-slot=scroll-area]');
  if (await cols.count() < 3) cols = pop.locator('div.flex.p-2');
  await cols.nth(0).getByRole('button', { name: String(Number(hh)), exact: true }).click();
  await cols.nth(1).getByRole('button', { name: mm, exact: true }).click();
  await cols.nth(2).getByRole('button', { name: ap.toUpperCase(), exact: true }).click();
  await page.keyboard.press('Escape');
}

/**
 * For negative tests: after submitting, the form must be refused. Pass when a warning/error toast
 * (optionally matching `re`) appears and the page did not move on; Fail if it saved.
 */
export async function expectRefused(page, re, startPath) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const bad = (await page.locator('[data-sonner-toast][data-type="warning"], [data-sonner-toast][data-type="error"]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
    if (bad && (!re || re.test(bad))) return { ok: true, note: 'Refused as expected: ' + bad.slice(0, 160) };
    const good = (await page.locator('[data-sonner-toast][data-type="success"]').allInnerTexts().catch(() => [])).join(' ');
    if (good || (startPath && pathOf(page.url()) !== startPath)) return { ok: false, note: 'It SAVED, but should have been refused. ' + good.slice(0, 120) };
    await sleep(300);
  }
  return { ok: true, note: 'Not saved (no success within 15 s; the button may be disabled).' };
}

/** Click through numbered DataTables-style pagination until a row with `text` shows (no search box pages). */
export async function rowAcrossPages(page, text, { maxPages = 30 } = {}) {
  for (let i = 0; i < maxPages; i++) {
    const row = page.locator('table tbody tr').filter({ hasText: text }).first();
    if (await row.isVisible().catch(() => false)) return row;
    const next = page.getByRole('button', { name: /^(Next|›|»|>)$/ }).last();
    if (!(await next.count()) || await next.isDisabled().catch(() => true)) break;
    await next.click(); await sleep(600);
  }
  throw new Error('row not found: ' + text);
}
