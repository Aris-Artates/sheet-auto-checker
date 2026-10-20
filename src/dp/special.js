/**
 * Boom Truck Premium (V2 form + date/time-of-operation rows), Longevity Pay (V1 form) and the
 * SSS / PhilHealth / HDMF contribution deductions (V1 frequency + contribution table).
 * Everything is applied to the test employee only and deleted after its check.
 */
import { config } from '../config.js';
import { pathOf, origin } from '../app.js';
import {
  pass, fail, PARTIAL, markerFor, ymd, nextCutoff, pickDate, setFrequency, saveOutcome, findInList, deleteRow,
  fillFooter, toastOutcome, deleteViaRow, rowWithText, setIndefinite, pickTestEmployeeAny, expectRefused,
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
const opRows = page => page.locator('div.border.border-gray-300.rounded-md').filter({ has: page.locator('text=/Date Start|Time Start/') });

async function fillOpRow(page, i, day, start, end, endDay) {
  const r = opRows(page).nth(i);
  await pickDate(page, r.getByRole('button').first(), day);
  await rowTime(page, r, 'Time Start', start);
  if (endDay) await pickDate(page, r.locator('div').filter({ has: page.locator('label, p, span').filter({ hasText: 'Date End' }) }).last().getByRole('button').first(), endDay);
  if (end) await rowTime(page, r, 'Time End', end);
}

async function boomTruck(ctx, row, { url, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  if (/^Different rates/.test(s)) return blocked('Needs a test employee with two Boom Truck rates; check by hand.');
  const listUrl = listOf(url);
  await open(page, listUrl + '/add', 'textarea[name="description"]');
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
  if (/Overnight/.test(s)) await fillOpRow(page, 0, day, '10:00 PM', '6:00 AM', next);
  else if (/Incomplete row/.test(s)) await fillOpRow(page, 0, day, '8:00 AM', null);
  else await fillOpRow(page, 0, day, '8:00 AM', '12:00 PM');
  if (/Overlapping rows|Multiple rows/.test(s)) {
    await opRows(page).last().locator('button.bg-green-100, button:has(svg.lucide-plus)').last().click();
    if (/Overlapping/.test(s)) await fillOpRow(page, 1, day, '11:00 AM', '2:00 PM');
    else await fillOpRow(page, 1, next, '8:00 AM', '12:00 PM');
  }
  done.push('operation rows filled');
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
  const ref = await page.locator('input[name=referenceNo]').inputValue().catch(() => '');
  const startPath = pathOf(page.url());
  if (!/Name blank/.test(s)) await page.fill('input[name=nameOfAddition]', `QA-AUTO ${row.id}`);
  await page.fill('textarea#description', markerFor(runId, row));
  await setIndefinite(page, !/Effective To missing/.test(s));
  done.push(await v1Frequency(page, String(row.raw['Frequency (FOA)'] || '')));
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only`);
  await fillFooter(page, row, runId, done);
  await submit(page, 'Save Longevity Pay');
  if (/Name blank|Effective To missing/.test(s)) { const r = await expectRefused(page, null, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  const overlap = page.getByRole('alertdialog').filter({ hasText: 'Please remove the following records' });
  if (await overlap.waitFor({ timeout: 6000 }).then(() => true).catch(() => false)) {
    await overlap.getByRole('button', { name: 'Adjust the Records' }).click().catch(() => {});
    return blocked('The test employee already has a longevity record in this range; the app blocks overlapping records.');
  }
  const saved = await toastOutcome(page, /Longevity Pay Added/i);
  if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
  done.push('reference ' + ref);
  ctx.created = { label: ref, cleanup: () => findInList(page, listUrl, ref).then(r => deleteRow(page, r)) };
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
  if (/Compensation missing/.test(s)) return fail('Known bug (from the code): the Compensation boxes are not connected to the save; the monthly rate is always used, so clearing it changes nothing.');
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
  await setIndefinite(page, true);
  done.push(await v1Frequency(page, String(row.raw['Frequency (FOA)'] || '')));
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only (compensation boxes are not used by the save - known bug)`);
  await fillFooter(page, row, runId, done);
  await submit(page, c.save);
  const saved = await toastOutcome(page, c.ok);
  if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
  const cleanup = async () => {
    await open(page, listUrl + '?filter=by-trans');
    const tr = await rowWithText(page, marker);
    const d = await deleteViaRow(page, tr, { action: `[data-action="${c.del}"]` });
    if (!d.ok) throw new Error(d.note);
  };
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
  // Longevity rows show the reference number, not the description: those are removed per run only.
  return n;
}

export const specialHandlers = [
  { pages: ['/payroll/addition/boom-truck-premium'], match: row => pathOf(row.vercel).endsWith('/add'), run: boomTruck, cleanupAll },
  { pages: ['/payroll/addition/longevity-pay'], match: row => pathOf(row.vercel).endsWith('/add'), run: longevity, cleanupAll },
  { pages: ['/payroll/deduction/sss', '/payroll/deduction/philhealth', '/payroll/deduction/hdmf'], match: row => pathOf(row.vercel).endsWith('/add'), run: contribution, cleanupAll },
];
