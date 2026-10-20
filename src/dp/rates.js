/**
 * Rates (/payroll/rates/add/*) and contribution tables (SSS / PhilHealth / HDMF / Withholding Tax).
 *
 * Safety:
 *  - Rates are applied to the test employee only (Applicable To forced, noted in the result).
 *  - A salary rate that conflicts with the test employee's existing rate is CANCELLED (proceeding
 *    would close their real rate) and reported as Blocked.
 *  - Contribution tables are dated December 2030 so they are never the active table today; an overlap
 *    prompt is answered "Continue with Multiple Active" (never "Set Prev Table to Inactive").
 *  - Records are only deleted when their row shows this run's QA-AUTO text (or unique rate value).
 */
import { config } from '../config.js';
import { pathOf } from '../app.js';
import {
  pass, fail, PARTIAL, markerFor, toastOutcome, deleteViaRow, selectOption, setIndefinite,
  pickDateAnywhere, pickTestEmployeeAny, pickTime, expectRefused, rowAcrossPages,
} from './common.js';
import path from 'node:path';

const blocked = notes => ({ result: 'Blocked', notes });
const sc = row => String(row.raw?.Scenario || '');
const other = row => String(row.raw?.['Other Inputs'] || '');
const pageIs = (row, p) => pathOf(row.vercel).endsWith(p);
const shortName = row => `QA-AUTO-${row.id}`.slice(0, 30);
const file = name => path.join(config.data.filesDir, name);

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

async function deleteOnRatesTab(page, base, tab, text, action, { search = true, pages = false } = {}) {
  await open(page, `${base}/payroll/rates?tab=${tab}`);
  if (search) { const box = page.locator('input[placeholder="Search records..."]').first(); if (await box.isVisible().catch(() => false)) await box.fill(text); }
  const row = pages ? await rowAcrossPages(page, text) : page.locator('table tbody tr').filter({ hasText: text }).first();
  await row.waitFor({ timeout: 15000 });
  const r = await deleteViaRow(page, row, { action: `[data-action="${action}"]` });
  if (!r.ok) throw new Error('delete failed: ' + r.note);
}

// ---------------------------------------------------------------- salary
async function salary(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  const marker = markerFor(runId, row);
  await open(page, `${base}/payroll/rates/add/salary`, 'input#description');
  await page.fill('input#description', marker);
  await page.getByRole('combobox').filter({ hasText: /Select employee/i }).first().click();
  await page.locator('input[cmdk-input]').last().fill(config.data.employeeEid);
  await page.locator(`[cmdk-item][data-value$=" ${config.data.employeeEid}" i]`).first().click({ timeout: 8000 });
  done.push('employee ' + config.data.employeeEid);

  const type = (s.match(/(Monthly|Weekly|Daily)/) || [])[1] || 'Monthly';
  await selectOption(page, 'New Rate Type', type, { exact: true });
  done.push('rate type ' + type);
  const amount = /Amount 0/.test(s) ? '0' : '25000';
  await page.locator('input[placeholder="0.00"]').last().fill(amount);
  await page.locator('input[placeholder="0.00"]').last().blur();
  const period = (s.match(/\/ (Semi-Monthly|Monthly|Weekly|Daily) \//) || [])[1];
  if (period) await selectOption(page, 'New Payroll Period', period).then(() => done.push('period ' + period)).catch(() => done.push('default period'));

  const startPath = pathOf(page.url());
  if (/File over 2MB/.test(s)) {
    await page.setInputFiles('#uploadAttachment', file('too-large-3MB.pdf'));
    const r = await expectRefused(page, /large|exceed|size/i, startPath);
    return r.ok ? pass(r.note) : fail(r.note);
  }
  if (/URL not http/.test(s) || /doc URL/.test(s)) {
    await page.fill('input[placeholder="Enter approval reference"]', `QA-${runId}-${row.id}`);
    await page.getByRole('button', { name: 'URL', exact: true }).click();
    await page.fill('input[name=url]', /not http/.test(s) ? 'ftp://example.com/x.pdf' : 'https://example.com/qa-memo.pdf');
  } else if (/No Document/.test(s)) {
    await page.locator('#noDocAttached').click();
  } else {
    await page.fill('input[placeholder="Enter approval reference"]', `QA-${runId}-${row.id}`);
    await page.setInputFiles('#uploadAttachment', file('valid-document.pdf'));
  }
  await submit(page, 'Save Salary Rate');
  if (/Amount 0|URL not http/.test(s)) {
    const r = await expectRefused(page, /Invalid Amount|valid URL/i, startPath);
    return r.ok ? pass(r.note) : fail(r.note);
  }
  // Conflict with the test employee's current rate: never proceed (it would close their real rate).
  const conflict = page.getByRole('dialog').filter({ hasText: 'Rate Conflict Detected' });
  const outcome = await Promise.race([
    conflict.waitFor({ timeout: 20000 }).then(() => 'conflict').catch(() => null),
    toastOutcome(page, /Salary Rates Saved/i, { timeout: 20000 }),
  ]);
  if (outcome === 'conflict' || (await conflict.isVisible().catch(() => false))) {
    await conflict.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    return /Overlapping/.test(s)
      ? pass('Rate Conflict dialog shown, as expected; cancelled so the existing rate was not touched.')
      : blocked('The test employee already has an overlapping salary rate. Cancelled: proceeding would close their real rate.');
  }
  if (!outcome || !outcome.ok) return fail((outcome?.note || 'No confirmation') + ' | ' + done.join('; '));
  if (/Overlapping/.test(s)) done.push('NOTE: no conflict dialog appeared');
  ctx.created = { label: marker, cleanup: () => deleteOnRatesTab(page, base, 'salary', marker, 'delete-salary-rate') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- overtime
const OT_SWITCH = { 'Regular Day': '#regular-day', 'Rest Day': '#rest-day', 'Regular Holiday': '#regular-holiday', 'Special Holiday': '#special-holiday', 'Night Shift': '#night-shift' };
async function overtime(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  const name = shortName(row);
  await open(page, `${base}/payroll/rates/add/overtime`, 'input[placeholder="Enter overtime name"]');
  await page.fill('input[placeholder="Enter overtime name"]', name);
  await page.fill('input[placeholder="Enter percentage rate"]', '125');
  await page.fill('textarea#description', markerFor(runId, row));
  const want = /All switches/i.test(s) ? Object.keys(OT_SWITCH) : Object.keys(OT_SWITCH).filter(k => s.includes(k));
  for (const k of want) { const sw = page.locator(OT_SWITCH[k]); if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click(); }
  done.push('switches: ' + (want.join(', ') || 'none'));
  await setIndefinite(page, true);
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only`);
  const startPath = pathOf(page.url());
  await submit(page, 'Save Overtime Rate');
  if (/No work-day switch/.test(s)) { const r = await expectRefused(page, /Work Day/i, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  const r = await toastOutcome(page, /Overtime Rates Saved/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  ctx.created = { label: name, cleanup: () => deleteOnRatesTab(page, base, 'overtime_rates', name, 'd-ot') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- night differential
async function nightshift(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  const name = shortName(row);
  await open(page, `${base}/payroll/rates/add/nightshift`, 'input[placeholder="Enter Differential name"]');
  await page.fill('input[placeholder="Enter Differential name"]', name);
  await page.fill('input[name=ndRate]', '10');
  await page.fill('textarea#description', `QA-AUTO ${runId} ${row.id}`);
  const custom = /20:00/.test(s);
  await pickTime(page, 'Start Time', custom ? '8:00 PM' : '10:00 PM');
  await pickTime(page, 'End Time', custom ? '4:00 AM' : '6:00 AM');
  done.push('window ' + (custom ? '8 PM-4 AM' : '10 PM-6 AM'));
  const sw = page.locator('#regular-day'); if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await setIndefinite(page, true);
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only (sheet said "${(s.split('/ ')[1] || '-').trim()}")`);
  await submit(page, 'Save Night Differential Rate');
  const r = await toastOutcome(page, /Night Differential Saved/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  ctx.created = { label: name, cleanup: () => deleteOnRatesTab(page, base, 'night_differential', name, 'd-nd') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- holiday
const DAY_TYPE = { 'Regular': 'Regular Holiday', 'Special non-working': 'Special Non-working Holiday', 'Special working': 'Special Working Holiday', 'Local holiday': 'Local Holiday' };
async function holiday(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row), o = other(row);
  const name = shortName(row);
  await open(page, `${base}/payroll/rates/add/holiday`, 'input[placeholder="e.g. Regular Holiday, Rest Day"]');
  const nameBox = page.locator('input[placeholder="e.g. Regular Holiday, Rest Day"]');
  if (/name over 30/.test(s)) {
    await nameBox.fill('X'.repeat(31));
    const len = (await nameBox.inputValue()).length;
    return len <= 30 ? pass(`Name capped at ${len} characters.`) : fail(`Name accepted ${len} characters.`);
  }
  await nameBox.fill(name);
  const rates = page.locator('input[placeholder="e.g. 100 (= 1.00x)"]');
  const startPath = pathOf(page.url());
  if (/Required rates empty/.test(s)) {
    await page.fill('textarea#description', markerFor(runId, row));
    await submit(page, 'Save Holiday Rate');
    const r = await expectRefused(page, /Missing/i, startPath); return r.ok ? pass(r.note) : fail(r.note);
  }
  await rates.nth(0).fill('200'); await rates.nth(1).fill('260');
  if (/Rest day rates filled/i.test(o)) { await rates.nth(2).fill('130'); await rates.nth(3).fill('169'); }
  await page.fill('textarea#description', markerFor(runId, row));
  const [dayKey, setup] = s.split(' / ');
  await selectOption(page, 'Pay Setup', setup.trim(), { exact: true });
  await selectOption(page, 'Day Type', DAY_TYPE[dayKey.trim()] || 'Regular Holiday', { exact: true });
  const req = /Required to work (Yes|No)/.exec(o)?.[1];
  if (req) await selectOption(page, 'Required to Work', req, { exact: true }).catch(() => {});
  if (/Must be present/i.test(o)) await page.locator('input[type=radio][name=cred_requirement]').nth(1).check().catch(() => {});
  done.push(`${dayKey.trim()} / ${setup.trim()}${req ? ' / required ' + req : ''}`);
  await setIndefinite(page, true);
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`applied to ${config.data.employeeEid} only`);
  await submit(page, 'Save Holiday Rate');
  const r = await toastOutcome(page, /Holiday Rate Saved/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  ctx.created = { label: name, cleanup: () => deleteOnRatesTab(page, base, 'holiday_rates', name, 'd-holiday', { search: false, pages: true }) };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- boom truck rate
async function boomRate(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page;
  // No name column on this list: a unique rate value identifies our record.
  const n = Number(String(row.id).replace(/\D/g, '')) % 100;
  const rate = `${700 + n}.${String(runId).slice(-2)}`;
  await open(page, `${base}/payroll/rates/add/boomtruck`, 'input[name=ndRate]');
  await page.fill('input[name=ndRate]', rate);
  await page.locator('input[name=ndRate]').blur();
  await setIndefinite(page, true);
  await pickTestEmployeeAny(page, { value: 'employees' });
  done.push(`rate ${rate}/hour, applied to ${config.data.employeeEid} only (sheet said "${(sc(row).split('/ ')[1] || '-').trim()}")`);
  await submit(page, 'Save Boom Truck Premium');
  const r = await toastOutcome(page, /Boom Truck Premium Saved/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  const shown = Number(rate).toLocaleString('en-US', { minimumFractionDigits: 2 });
  ctx.created = { label: 'boom truck rate ' + rate, cleanup: () => deleteOnRatesTab(page, base, 'boom_truck_premium', shown, 'd-bt') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- contribution tables
const GOV = {
  '/payroll/sss': { save: 'Save SSS Table', ok: /SSS Table Saved/i, del: 'delete-sss', rows: [['1000', '1999.99', '1000', '0', '95', '0', '10', '45', '0']] },
  '/payroll/philhealth-table': { save: 'Save Philhealth Table', ok: /PhilHealth contribution table added/i, del: 'delete-philhealth', rows: [['0', '9999.99', '5'], ['10000', '250', '250']] },
  '/payroll/hdmf-table': { save: 'Save HDMF Table', ok: /HDMF\) Table Added/i, del: 'delete-hdmf', rows: [['0', '1500', '1', '2'], ['1500.01', '100', '100']] },
  '/payroll/withholding-tax': { save: 'Save Witholding-Tax Table', ok: /Withholding Tax Added/i, del: 'delete-wtax', rows: [['0', '20833', '0', '0'], ['20833.01', '15', '0']] },
};
const govOf = row => Object.keys(GOV).find(p => pathOf(row.vercel).startsWith(p));

async function fillMatrix(page, rows) {
  const trs = page.locator('table tbody tr');
  for (let i = 0; i < rows.length; i++) {
    const inputs = trs.nth(i).locator('input:visible:not([type=checkbox]):not([type=radio]):not([type=file])');
    const count = await inputs.count();
    for (let j = 0; j < rows[i].length && j < count; j++) { await inputs.nth(j).fill(rows[i][j]); await inputs.nth(j).blur(); }
  }
}

async function govTable(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row), listPath = govOf(row), g = GOV[listPath];
  if (/Protected default record/.test(s)) {
    await open(page, base + listPath);
    const locked = page.locator('[title^="Protected payroll table"]');
    const n = await locked.count();
    const leak = await page.locator('[title^="Protected payroll table"][data-action]').count();
    return n && !leak ? pass(`${n} protected controls shown greyed out with no action.`) : fail(n ? 'A protected record still has an active edit/delete control.' : 'No protected record found on this page.');
  }
  if (/Overlaps an existing table/.test(s)) return blocked('Needs current dates, which would make a test table active for everyone. Check by hand.');
  const marker = markerFor(runId, row);
  await open(page, `${base}${listPath}/add`, 'textarea#description');
  await page.fill('textarea#description', marker);
  const editor = page.locator('.simple-editor[contenteditable=true]').first();
  await editor.click(); await page.keyboard.type('QA automated test - safe to delete');
  // December 2030: never the active table today.
  await pickDateAnywhere(page, page.getByRole('button', { name: /^From:/ }).first(), new Date(2030, 11, 1));
  if (/with end date/.test(s)) { await setIndefinite(page, false); await pickDateAnywhere(page, page.getByRole('button', { name: /^To:/ }).first(), new Date(2030, 11, 31)); }
  else await setIndefinite(page, true);
  done.push('effectivity Dec 2030' + (/with end date/.test(s) ? ' to Dec 31 2030' : ', indefinite'));
  const startPath = pathOf(page.url());

  if (/^Bulk upload/.test(s)) {
    const f = String(row.raw['Reference File'] || '');
    await page.setInputFiles('#spreadsheet-upload', file(f));
    const parsed = await toastOutcome(page, /Parsed Successfully/i, { timeout: 20000 });
    const shouldWork = /sample template|visual layout/i.test(s);
    if (!shouldWork) return parsed.ok ? fail('File was accepted but should be refused: ' + parsed.note) : pass('Refused as expected: ' + parsed.note);
    if (!parsed.ok) return fail('Valid file was not accepted: ' + parsed.note);
    done.push('uploaded ' + f);
  } else if (/Ranges out of order/.test(s)) {
    await fillMatrix(page, [g.rows[0].map((v, i) => (i === 0 ? '5000' : i === 1 ? '1000' : v))]);
    await submit(page, g.save).catch(() => {});
    const r = await expectRefused(page, /Invalid|range|order/i, startPath); return r.ok ? pass(r.note) : fail(r.note);
  } else if (/Empty table/.test(s)) {
    await submit(page, g.save).catch(() => {});
    const r = await expectRefused(page, null, startPath); return r.ok ? pass(r.note) : fail(r.note);
  } else {
    await fillMatrix(page, g.rows);
    done.push('matrix filled');
  }
  await submit(page, g.save);
  const overlap = page.getByRole('dialog').filter({ hasText: /Effectivity Overlaps/i });
  if (await overlap.waitFor({ timeout: 6000 }).then(() => true).catch(() => false)) {
    await overlap.getByRole('button', { name: 'Continue with Multiple Active' }).click();
    done.push('overlap prompt: kept existing tables active');
  }
  const r = await toastOutcome(page, g.ok);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  ctx.created = { label: marker, cleanup: () => deleteGovRow(page, base, listPath, marker) };
  return finish(ctx, keep, done);
}

async function deleteGovRow(page, base, listPath, text) {
  await open(page, base + listPath);
  const box = page.locator('input[placeholder="Search"]').first(); if (await box.isVisible().catch(() => false)) await box.fill(text);
  const tr = page.locator('table tbody tr').filter({ hasText: text }).first();
  await tr.waitFor({ timeout: 12000 });
  const d = await deleteViaRow(page, tr, { action: `[data-action="${GOV[listPath].del}"]` });
  if (!d.ok) throw new Error(d.note);
}

async function cleanupAll(ctx, base) {
  let n = 0;
  const page = ctx.page;
  const loop = async fn => { for (let i = 0; i < 50; i++) { try { await fn(); n++; } catch (_) { break; } } };
  for (const [tab, action] of [['salary', 'delete-salary-rate'], ['overtime_rates', 'd-ot'], ['night_differential', 'd-nd']]) await loop(() => deleteOnRatesTab(page, base, tab, 'QA-AUTO', action));
  await loop(() => deleteOnRatesTab(page, base, 'holiday_rates', 'QA-AUTO', 'd-holiday', { search: false, pages: true }));
  for (const p of Object.keys(GOV)) await loop(() => deleteGovRow(page, base, p, 'QA-AUTO'));
  return n;
}

export const rateHandlers = [
  { pages: ['/payroll/rates'], match: row => pageIs(row, '/add/salary') && !/^Second employee/.test(sc(row)), run: salary, cleanupAll },
  { pages: ['/payroll/rates'], match: row => pageIs(row, '/add/overtime'), run: overtime, cleanupAll },
  { pages: ['/payroll/rates'], match: row => pageIs(row, '/add/nightshift'), run: nightshift, cleanupAll },
  { pages: ['/payroll/rates'], match: row => pageIs(row, '/add/holiday'), run: holiday, cleanupAll },
  { pages: ['/payroll/rates'], match: row => pageIs(row, '/add/boomtruck'), run: boomRate, cleanupAll },
  { pages: ['/payroll/sss', '/payroll/philhealth-table', '/payroll/hdmf-table', '/payroll/withholding-tax'], match: row => !!govOf(row), run: govTable, cleanupAll, needsEmployee: false },
];
