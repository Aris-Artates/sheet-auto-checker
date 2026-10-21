/**
 * Boom Truck Premium (V2 form + date/time-of-operation rows), Longevity Pay (V1 form) and the
 * SSS / PhilHealth / HDMF contribution deductions (V1 frequency + contribution table).
 * Everything is applied to the test employee only and deleted after its check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { pathOf, origin } from '../app.js';
import {
  pass, fail, PARTIAL, markerFor, ymd, nextCutoff, pickDate, setFrequency, saveOutcome, findInList, deleteRow,
  fillFooter, toastOutcome, deleteViaRow, rowWithText, setIndefinite, setEffectivity, pickTestEmployeeAny, expectRefused,
} from './common.js';

const blocked = notes => ({ result: 'Blocked', notes });
const sc = row => String(row.raw?.Scenario || '');
const listOf = url => origin(url) + pathOf(url).replace(/\/add$/, '');
async function open(page, url, waitFor) {
  await page.goto(url, { waitUntil: 'load' });
  if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: config.pageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}
const submit = (page, text) => page.getByRole('button', { name: new RegExp('^' + text) }).last().click();
const finish = async (ctx, keep, done) => {
  if (keep) { ctx.created = null; return pass(PARTIAL + 'Saved (kept, --keep). ' + done.join('; ')); }
  await ctx.created.cleanup(); ctx.created = null;
  return pass(PARTIAL + 'Saved and deleted. ' + done.join('; '));
};

// ---------------------------------------------------------------- boom truck premium
/** Set the time picker inside one operation row (label "Time Start" / "Time End"). */
async function rowTime(page, rowBox, label, time) {
  const [, hh, mm, ap] = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  await rowBox.locator('div').filter({ has: page.locator('label, p, span').filter({ hasText: label }) }).last().getByRole('button').first().click();
  const pop = page.locator('[data-slot=popover-content], [data-radix-popper-content-wrapper]').last();
  let cols = pop.locator('[data-slot=scroll-area]');
  if (await cols.count() < 3) cols = pop.locator('div.flex.p-2');
  await cols.nth(0).getByRole('button', { name: String(Number(hh)), exact: true }).click();
  await cols.nth(1).getByRole('button', { name: mm, exact: true }).click();
  await cols.nth(2).getByRole('button', { name: ap.toUpperCase(), exact: true }).click();
  await page.keyboard.press('Escape');
}
/** A one-hour operation slot for a TC ("DPPA-0105" -> 3:00 PM - 4:00 PM): 7 AM, then 12 PM to 9 PM. */
const BOOM_HOURS = [7, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
function boomSlot(id) {
  const h = BOOM_HOURS[Number(String(id).match(/(\d+)$/)?.[1] || 0) % BOOM_HOURS.length];
  const fmt = x => `${x % 12 || 12}:00 ${x < 12 ? 'AM' : 'PM'}`;
  return [fmt(h), fmt(h + 1)];
}
const opRows = page => page.locator('div.border.border-gray-300.rounded-md').filter({ has: page.locator('text=/Date Start|Time Start/') });

async function fillOpRow(page, i, day, start, end, endDay) {
  const r = opRows(page).nth(i);
  await pickDate(page, r.getByRole('button').first(), day);
  await rowTime(page, r, 'Time Start', start);
  if (endDay) await pickDate(page, r.locator('div').filter({ has: page.locator('label, p, span').filter({ hasText: 'Date End' }) }).last().getByRole('button').first(), endDay);
  if (end) await rowTime(page, r, 'Time End', end);
}

// Scenarios this form has nothing for: say so, never save a normal record and call it a pass.
const BOOM_MANUAL = [
  [/^Different rates/, 'Needs a test employee with two Boom Truck rates; check by hand.'],
  [/^(Total Amount = 0|Negative amount)/, 'Boom Truck has no amount field (premium = hours x rate); check by hand.'],
  [/^Near-duplicate/, 'The name is locked and this page has no near-duplicate check; check by hand.'],
  [/^Exclude employees/, 'Excluding employees is not automated yet; check by hand.'],
  [/^Effective From after To/, 'An Effective To before From is not automated yet; check by hand.'],
];
const BOOM_HANDLED = /^(Add: |Save with required|Name is locked|Long texts|No attachment and box unticked|Attachment over|Attachment wrong type|No Document Attached|Same-day|Overnight|Overlapping rows|Incomplete row|Date outside pay period|Multiple rows)/;

async function boomTruck(ctx, row, { url, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  for (const [re, why] of BOOM_MANUAL) if (re.test(s)) return blocked(why);
  if (!BOOM_HANDLED.test(s)) return blocked(`"${s}" is not automated yet; check by hand.`);
  const listUrl = listOf(url);
  await open(page, listUrl + '/add', 'textarea[name="description"]');
  const formPath = pathOf(page.url());
  const verdict = r => (r.ok ? pass(r.note) : fail(r.note));
  // Checks that need no saved record.
  if (/^Save with required/.test(s)) { await submit(page, 'Save Boom Truck Premium'); return verdict(await expectRefused(page, null, formPath)); }
  if (/^Name is locked/.test(s)) {
    const n = page.locator('input[name="nameOfAddition"]');
    const locked = await n.evaluate(e => e.readOnly || e.disabled || getComputedStyle(e).pointerEvents === 'none');
    return locked ? pass(`Name is locked: "${await n.inputValue()}".`) : fail('The name field can be edited.');
  }
  if (/^Long texts/.test(s)) {
    const d = page.locator('textarea[name="description"]');
    await d.fill('A'.repeat(600));
    const len = (await d.inputValue()).length;
    return len <= 500 ? pass(`Description capped at ${len} characters.`) : fail(`Description accepted ${len} characters.`);
  }
  if (/^Attachment (over|wrong type)/.test(s)) {
    const name = String(row.raw['Reference File'] || '').split(',')[0].trim();
    const file = path.join(config.data.filesDir, name);
    if (!fs.existsSync(file)) return blocked(`Test file ${name} is missing; run npm run make-test-files.`);
    await page.setInputFiles('#uploadAttachment', file);
    const r = await expectRefused(page, /exceeds|not allowed|accepted/i, formPath);
    return r.ok ? pass(`${r.note} (${name})`) : fail(r.note);
  }
  const marker = markerFor(runId, row);
  await page.fill('textarea[name="description"]', marker);
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only`);
  const foaRaw = String(row.raw['Frequency (FOA)'] || '');
  const foa = /^(One Time|Regular)/.test(foaRaw) ? foaRaw : 'One Time - 15th';
  done.push(await setFrequency(page, foa));
  // Work dates must sit in the half-month the form allows: the One Time date's half, or for Regular the half
  // holding the effectivity start (today). The 3rd for a 1st-15th half, the 20th for a 16th-end one.
  const anchor = /^One Time/.test(foa) ? nextCutoff(/End/i.test(foa) ? 'end' : '15') : new Date();
  const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() <= 15 ? 3 : 20);
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const startPath = pathOf(page.url());
  if (/^Date outside pay period/.test(s)) {
    const r = opRows(page).nth(0);
    await r.getByRole('button').first().click();
    const prev = new Date(day.getFullYear(), day.getMonth() - 1, 10);
    const btn = page.locator(`[data-slot="calendar"] td[data-day="${ymd(prev)}"] button`);
    const disabled = !(await btn.isVisible().catch(() => false)) || await btn.isDisabled().catch(() => true);
    await page.keyboard.press('Escape');
    return disabled ? pass('Dates outside the pay period cannot be picked.') : fail('A date outside the pay period is selectable.');
  }
  // Each test gets its own one-hour slot, picked from its TC number: records kept with --keep (or left over) sit
  // on the same dates for the same employee, and a shared 8-12 slot made every later save a "Time Conflict".
  // 8 AM-12 PM is skipped (older runs used it) and so is 6 AM (where the Overnight row ends).
  const [from, to] = boomSlot(row.id);
  if (/Overnight/.test(s)) await fillOpRow(page, 0, day, '10:00 PM', '6:00 AM', next);
  else if (/Incomplete row/.test(s)) await fillOpRow(page, 0, day, from, null);
  else if (/Overlapping rows/.test(s)) await fillOpRow(page, 0, day, '8:00 AM', '12:00 PM');
  else await fillOpRow(page, 0, day, from, to);
  if (/Overlapping rows|Multiple rows/.test(s)) {
    await opRows(page).last().locator('button.bg-green-100, button:has(svg.lucide-plus)').last().click();
    if (/Overlapping/.test(s)) await fillOpRow(page, 1, day, '11:00 AM', '2:00 PM');
    else await fillOpRow(page, 1, next, from, to);
  }
  if (!/Overnight|Incomplete row|Overlapping rows/.test(s)) done.push(`time ${from} - ${to}`);
  done.push('operation rows filled');
  if (/^No attachment and box unticked/.test(s)) {
    // Reason only: no file and "No Document Attached" left unticked must be refused.
    await page.fill('textarea#reason', 'QA automated test');
    await submit(page, 'Save Boom Truck Premium');
    return verdict(await expectRefused(page, /attachment|approval reference/i, startPath));
  }
  const ref = String(row.raw['Reference File'] || '');
  await fillFooter(page, row, runId, done, ref && ref !== '-' ? ref : 'valid-document.pdf');
  await submit(page, 'Save Boom Truck Premium');
  if (/Overlapping rows/.test(s)) { const r = await expectRefused(page, /Time Conflict/i, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  if (/Incomplete row/.test(s)) { const r = await expectRefused(page, /Incomplete/i, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  const saved = await saveOutcome(page);
  if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
  ctx.created = { label: marker, cleanup: () => findInList(page, listUrl, marker).then(r => deleteRow(page, r)) };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- longevity pay (V1)
async function v1Frequency(page, foa) {
  if (/Semi/i.test(foa)) { await page.locator('input[name=frequency][value="semi-monthly"]').check(); return 'Semi-Monthly'; }
  await page.locator('input[name=frequency][value="monthly"]').check();
  const end = /End/i.test(foa);
  await page.locator(`input[name=monthlyDay][value="${end ? 'end' : '15'}"]`).check();
  return 'Monthly, ' + (end ? 'end of month' : '15th');
}

async function longevity(ctx, row, { url, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  if (/no employees/i.test(s)) return blocked('Needs a branch/department with no employees; check by hand.');
  const listUrl = listOf(url);
  await open(page, listUrl + '/add', 'textarea#description');
  const startPath = pathOf(page.url());
  // The list shows the name, not the description, and the reference number is only assigned on save: name it with the marker.
  const marker = markerFor(runId, row);
  if (!/Name blank/.test(s)) await page.fill('input[name=nameOfAddition]', marker);
  await page.fill('textarea#description', marker);
  if (/Effective To set/.test(s)) {
    // A real end date three months out (was: always Indefinite, so these rows never set one).
    const now = new Date(), to = new Date(now.getFullYear(), now.getMonth() + 3, 28);
    await setEffectivity(page, null, to);
    done.push('Effective To ' + ymd(to));
  } else if (/Effective To missing/.test(s)) {
    // Unticking Indefinite fills Effective To with today, so the field can't be left empty: check that, save nothing.
    await setIndefinite(page, false);
    const to = (await page.getByRole('button', { name: /^To:/ }).first().innerText().catch(() => '')).replace(/^To:\s*/, '').trim();
    return to && !/pick|select/i.test(to) ? pass(`Effective To cannot be left empty: unticking Indefinite filled it with ${to}.`)
      : fail('Indefinite unticked and Effective To left empty.');
  } else await setIndefinite(page, true);
  done.push(await v1Frequency(page, String(row.raw['Frequency (FOA)'] || '')));
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only`);
  await fillFooter(page, row, runId, done);
  await submit(page, 'Save Longevity Pay');
  if (/Name blank/.test(s)) { const r = await expectRefused(page, null, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  // Watch for the overlap dialog, the success toast and the redirect together: waiting 6 s for the dialog first
  // let the toast vanish with the redirect, so a saved record was reported as unconfirmed and never deleted.
  const overlap = page.getByRole('alertdialog').filter({ hasText: 'Please remove the following records' });
  let saved = { ok: false, note: 'No confirmation after ' + config.pageTimeoutMs / 1000 + 's' };
  for (const end = Date.now() + config.pageTimeoutMs; Date.now() < end;) {
    if (await overlap.isVisible().catch(() => false)) {
      // "Adjust the Records" only closes the dialog; nothing is changed.
      await overlap.getByRole('button', { name: 'Adjust the Records' }).click().catch(() => {});
      return blocked('The test employee already has a longevity record in this range; the app blocks overlapping records.');
    }
    const t = await toastOutcome(page, /Longevity Pay Added/i, { timeout: 300 });
    if (t.ok || /^Refused/.test(t.note)) { saved = t; break; }
    if (pathOf(page.url()) !== startPath) { saved = { ok: true, note: 'Saved (back on the list)' }; break; }
  }
  if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
  ctx.created = { label: marker, cleanup: () => findInList(page, listUrl, marker).then(r => deleteRow(page, r)) };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- SSS / PhilHealth / HDMF contributions
const CONTRIB = {
  sss: { save: 'Save SSS Contribution', ok: /SSS Contribution Added/i, del: 'd-pdSSS', table: 'SSS Contribution Table' },
  philhealth: { save: 'Save Philhealth Contribution', ok: /PhilHealth Contribution Added/i, del: 'd-phic', table: 'PhilHealth Contribution Table' },
  hdmf: { save: 'Save HDMF Contribution', ok: /HDMF Contribution Added/i, del: 'd-hdmf', table: 'HDMF Contribution Table' },
};
const contribOf = url => (pathOf(url).match(/\/payroll\/deduction\/(sss|philhealth|hdmf)(\/|$)/) || [])[1];

async function contribution(ctx, row, { url, runId, keep, done }) {
  const page = ctx.page, s = sc(row), key = contribOf(url), c = CONTRIB[key];
  if (/No contribution table/.test(s)) return blocked('The default table is pre-selected and cannot be cleared; check by hand.');
  const listUrl = listOf(url);
  await open(page, listUrl + '/add', 'textarea#description');
  const marker = markerFor(runId, row);
  const startPath = pathOf(page.url());
  if (/required/.test(s)) {
    await submit(page, c.save);
    const r = await expectRefused(page, /required/i, startPath); return r.ok ? pass(r.note) : fail(r.note);
  }
  if (/Older table/.test(s)) {
    const box = page.locator('div').filter({ has: page.locator('label, p').filter({ hasText: c.table }) }).filter({ has: page.locator('[role=combobox]') }).last();
    await box.locator('[role=combobox]').first().click();
    const inactive = page.getByRole('option').filter({ hasText: 'Inactive' }).first();
    if (!(await inactive.count())) { await page.keyboard.press('Escape'); return blocked('No inactive contribution table exists to pick.'); }
    await inactive.click();
    const warn = page.getByRole('dialog').filter({ hasText: 'Inactive Table Warning' });
    if (await warn.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) { await warn.getByRole('button', { name: 'Continue' }).click(); done.push('inactive-table warning shown and accepted'); }
    else done.push('NOTE: no inactive-table warning appeared');
  }
  await page.fill('textarea#description', marker);
  // The start date starts empty and is required ("Effectivity Start date is required.").
  const today = new Date();
  await setEffectivity(page, today, null);
  await setIndefinite(page, true);
  done.push('effective from ' + ymd(today) + ', indefinite');
  done.push(await v1Frequency(page, String(row.raw['Frequency (FOA)'] || '')));
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only`);
  const cleanup = async () => {
    await open(page, listUrl + '?filter=by-trans');
    const tr = await rowWithText(page, marker);
    const d = await deleteViaRow(page, tr, { action: `[data-action="${c.del}"]` });
    if (!d.ok) throw new Error(d.note);
  };
  if (/Compensation missing/.test(s)) {
    // The employee table (behind "Show") holds one Compensation box per employee, pre-filled with the monthly rate.
    // Known bug: the add pages never hand ApplicableToV2 their compensations / onCompensationChange, so the boxes are
    // not connected to the save and an emptied box still saves with the monthly rate. This checks it for real.
    await page.getByRole('button', { name: /^Show$/ }).first().click();
    const comp = page.locator('table input[placeholder="0.00"]').first();
    await comp.waitFor({ timeout: 8000 });
    await comp.fill('');
    await comp.blur();
    await fillFooter(page, row, runId, done, 'No Document Attached');
    await submit(page, c.save);
    const r = await expectRefused(page, /Compensation Required/i, startPath);
    if (!r.ok) ctx.created = { label: marker, cleanup };
    return r.ok ? pass(r.note) : fail(r.note + ' | Compensation emptied but ignored: the boxes are not connected to the save (known bug). | ' + done.join('; '));
  }
  await fillFooter(page, row, runId, done);
  await submit(page, c.save);
  const saved = await toastOutcome(page, c.ok);
  if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
  ctx.created = { label: marker, cleanup };
  return finish(ctx, keep, done);
}

async function cleanupAll(ctx, base) {
  const page = ctx.page;
  let n = 0;
  const loop = async fn => { for (let i = 0; i < 50; i++) { try { await fn(); n++; } catch (_) { break; } } };
  await loop(() => findInList(page, base + '/payroll/addition/boom-truck-premium', 'QA-AUTO').then(r => deleteRow(page, r)));
  for (const [k, c] of Object.entries(CONTRIB)) {
    await loop(async () => {
      await open(page, `${base}/payroll/deduction/${k}?filter=by-trans`);
      const tr = await rowWithText(page, 'QA-AUTO', { timeout: 8000 });
      const d = await deleteViaRow(page, tr, { action: `[data-action="${c.del}"]` });
      if (!d.ok) throw new Error(d.note);
    });
  }
  // Longevity rows show the name, which this tool sets to "QA-AUTO <TC ID>" (a leftover blocks every later add: overlap).
  await loop(() => findInList(page, base + '/payroll/addition/longevity-pay', 'QA-AUTO').then(r => deleteRow(page, r)));
  return n;
}

export const specialHandlers = [
  { pages: ['/payroll/addition/boom-truck-premium'], match: row => pathOf(row.vercel).endsWith('/add'), run: boomTruck, cleanupAll },
  { pages: ['/payroll/addition/longevity-pay'], match: row => pathOf(row.vercel).endsWith('/add'), run: longevity, cleanupAll },
  { pages: ['/payroll/deduction/sss', '/payroll/deduction/philhealth', '/payroll/deduction/hdmf'], match: row => pathOf(row.vercel).endsWith('/add'), run: contribution, cleanupAll },
];
