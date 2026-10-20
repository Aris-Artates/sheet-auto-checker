/**
 * Payments, payment types, bank files, leave requests / types, users, approving officers.
 *
 * Left MANUAL on purpose (no handler):
 *  - Leave monetization, tardiness charged, undertime/absence charged: no delete exists, records would stay.
 *  - Payroll Settings: saving rewrites the whole settings object for everyone; no safe automatic undo.
 *  - Payroll / leave approval requests: act on real payroll cutoffs; leave decisions wait on ticket 2110.
 *  - Payment Processor "Employee Accounts": its dialog can never be opened (no code path opens it).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { pathOf, login } from '../app.js';
import { pass, fail, PARTIAL, sleep, toastOutcome, deleteViaRow, expectRefused, pickTestEmployeeAny, fillFooter, ymd } from './common.js';

const blocked = notes => ({ result: 'Blocked', notes });
const sc = row => String(row.raw?.Scenario || '');
const other = row => String(row.raw?.['Other Inputs'] || '');
const num = row => String(row.id).replace(/\D/g, '').slice(-4);
const file = name => path.join(config.data.filesDir, name);
async function open(page, url, waitFor) {
  await page.goto(url, { waitUntil: 'load' });
  if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: config.pageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}
const finish = async (ctx, keep, done) => {
  if (keep) { ctx.created = null; return pass(PARTIAL + 'Saved (kept, --keep). ' + done.join('; ')); }
  await ctx.created.cleanup(); ctx.created = null;
  return pass(PARTIAL + 'Saved and deleted. ' + done.join('; '));
};
async function searchAndDelete(page, url, text, action, { search = 'input[placeholder="Search"]', confirm } = {}) {
  await open(page, url);
  const box = page.locator(search).first();
  if (await box.isVisible().catch(() => false)) { await box.fill(text); await box.press('Enter').catch(() => {}); }
  const tr = page.locator('table tbody tr').filter({ hasText: text }).first();
  await tr.waitFor({ timeout: 12000 });
  const d = await deleteViaRow(page, tr, confirm ? { action, confirm } : { action });
  if (!d.ok) throw new Error(d.note);
}

/** Does clicking `button` send anything to the server within 8 s? Used for pages whose save is not wired. */
async function sendsRequest(page, clickFn) {
  const req = page.waitForRequest(r => r.method() === 'POST' && r.url().includes('/api/request'), { timeout: 8000 }).then(() => true).catch(() => false);
  await clickFn();
  return req;
}

// ---------------------------------------------------------------- payment types (Types tab)
async function processorType(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  const name = `QA-AUTO-${row.id}`.slice(0, 30);
  await open(page, base + '/payroll/payments/processor');
  await page.getByRole('button', { name: 'Add Types', exact: true }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'Add Type' });
  await dlg.waitFor({ timeout: 8000 });
  if (/Required fields empty/.test(s)) {
    await dlg.getByRole('button', { name: /^Save/ }).click();
    const r = await expectRefused(page, /required/i, '/payroll/payments/processor'); return r.ok ? pass(r.note) : fail(r.note);
  }
  await dlg.locator('input[placeholder="e.g. Direct Deposit"]').fill(name);
  await dlg.locator('textarea').fill(`QA-AUTO ${runId} ${row.id}`);
  await dlg.getByRole('button', { name: /^Save/ }).click();
  const r = await toastOutcome(page, /Processor Type Added/i);
  if (!r.ok) return fail(r.note);
  done.push('payment type ' + name + ' (the "Employee Accounts" form cannot be opened in the app - known bug)');
  ctx.created = { label: name, cleanup: () => searchAndDelete(page, base + '/payroll/payments/processor', name, 'button.delete-btn') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- pages whose save is not wired (known bugs)
async function bankGenerate(ctx, row, { base }) {
  const page = ctx.page;
  await open(page, base + '/payroll/bank-payments/file/generate');
  const sent = await sendsRequest(page, () => page.getByRole('button', { name: /^Generate Bank Payment/ }).last().click());
  return sent ? pass('Generate sent a request to the server.') : fail('Known bug: "Generate Bank Payment" sends nothing (no form or click handler in the code). The list also shows static test data.');
}
async function officersAdd(ctx, row, { base }) {
  const page = ctx.page;
  await open(page, base + '/approving/officers/add');
  const sent = await sendsRequest(page, () => page.getByRole('button', { name: /^Save Changes/ }).last().click());
  return sent ? pass('Save Changes sent a request to the server.') : fail('Known bug: "Save Changes" never saves (its click handler is never called, and the save sends no request). Officers cannot be added.');
}

// ---------------------------------------------------------------- users
const ROLE_LABEL = {
  payroll_officer: 'Payroll Admin', payroll_staff: 'Payroll Staff', payroll_mgmt: 'Payroll Checker', payroll_approving_officer: 'Payroll Approving Officer',
  leave_immediate_head: 'Leave Immediate Head', leave_campus_admin: 'Leave Agency Head', qrpho_employee: 'Employee', qrpho_approve_officer: 'Approving Officer',
};
async function users(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  if (/Username cannot change/.test(s)) return blocked('Check by hand on the edit page.');
  const username = `qaauto${runId}${num(row)}`.slice(0, 60);
  const password = crypto.randomBytes(12).toString('base64url') + 'Aa1!';
  await open(page, base + '/users/add', '#firstName');
  const startPath = pathOf(page.url());
  if (/Field limits/.test(s)) {
    const checks = [['#firstName', 51, 50], ['#email', 101, 100], ['#username', 61, 60]];
    const bad = [];
    for (const [sel, typed, max] of checks) { await page.fill(sel, 'a'.repeat(typed)); const len = (await page.inputValue(sel)).length; if (len > max) bad.push(`${sel} took ${len}`); }
    return bad.length ? fail('Not capped: ' + bad.join(', ')) : pass('First name 50, email 100, username 60: all capped.');
  }
  await page.fill('#firstName', 'QA');
  await page.fill('#lastName', `AUTO-${row.id}`);
  await page.fill('#email', `${username}@example.com`);
  await page.fill('#username', username);
  const roleKey = (s.match(/role (\w+)/) || [])[1] || (/Employee role/.test(s) ? 'qrpho_employee' : 'payroll_staff');
  const box = page.locator('div').filter({ has: page.locator('label, p').filter({ hasText: /Role/ }) }).filter({ has: page.locator('[role=combobox]') }).last();
  await box.locator('[role=combobox]').first().click();
  await page.getByRole('option', { name: ROLE_LABEL[roleKey] || 'Payroll Staff', exact: true }).click();
  if (/Password under 8/.test(s)) await page.fill('#password', 'Ab1!xyz');
  else if (/Weak password/.test(s)) await page.fill('#password', 'password1');
  else await page.fill('#password', password);
  if (/Weak password/.test(s)) {
    const ack = page.locator('#confirmWeakPassword');
    return (await ack.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) ? pass('Weak password needs the acknowledgement checkbox.') : fail('No weak-password acknowledgement appeared.');
  }
  if (roleKey === 'qrpho_employee' && !/without employee/.test(s)) return blocked('The Employee role needs a linked employee picked by name; check by hand.');
  await page.getByRole('button', { name: /^Save User/ }).last().click();
  if (/Password under 8|without employee/.test(s)) { const r = await expectRefused(page, /password|linked employee/i, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  const r = await toastOutcome(page, /Created New User/i);
  if (!r.ok) return fail(r.note);
  done.push(`user ${username} as ${roleKey}`);
  ctx.created = { label: 'user ' + username, cleanup: () => searchAndDelete(page, base + '/users', username, 'i[data-action="d-users"]') };
  // Log in as the new user in a separate browser context: it should get in, except the unmapped role.
  const other = await page.context().browser().newContext();
  try {
    const p2 = await other.newPage();
    const li = await login(p2, base + '/', { username, password });
    if (roleKey === 'qrpho_approve_officer') {
      if (li.ok) { await finish(ctx, keep, done).catch(() => {}); return fail('An account with qrpho_approve_officer (not a recognised app role) WAS let in.'); }
      done.push('login refused as expected for an unrecognised role');
    } else done.push(li.ok ? 'new user can log in' : 'NOTE: new user could not log in: ' + li.message);
  } finally { await other.close(); }
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- leave request
const LEAVE = [
  [/^Vacation - within/, 'Vacation', 'Within the Philippines', 'detailsOfLeaveDetail', 'Manila'],
  [/^Vacation - abroad/, 'Vacation', 'Abroad', 'detailsOfLeaveDetail', 'Tokyo'],
  [/^Sick - in hospital/, 'Sick', 'In Hospital', 'sickLeaveOtherDetail', 'QA test'],
  [/^Sick - out patient/, 'Sick', 'Out Patient', 'sickLeaveOtherDetail', 'QA test'],
  [/^Special Leave Benefits for Women \(female\)/, 'Sick', 'Special Leave Benefits for Women', null, null],
  [/^Study - Master/, 'Study', "Completion of Master's Degree", null, null],
  [/^Study - Bar/, 'Study', 'Bar/Board Examination Review', null, null],
  [/^Monetization/, 'Monetization', 'Monetization of Leave Credits', null, null],
  [/^Terminal/, 'Terminal', 'Terminal Leave', null, null],
  [/^Solo Parent/, 'Solo Parent', null, 'detailsOfLeaveDetail', null],
];
async function leaveRequest(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  if (/\(male\)/.test(s)) return blocked('Needs a male test employee; check by hand that the type is not offered.');
  if (/To before From/.test(s)) return blocked('The date-time picker cannot be driven reliably for this case yet; check by hand.');
  await open(page, base + '/leave/request/add', 'textarea[name=reason]');
  const startPath = pathOf(page.url());
  if (/All Employees not offered/.test(s)) {
    const all = await page.locator('input[type=radio][name=applicable][value=all]').count();
    return all ? fail('"All" is offered on Applicable To.') : pass('"All" is not offered.');
  }
  await pickTestEmployeeAny(page, { value: 'employee' });
  done.push(`for ${config.data.employeeEid} only`);
  const spec = LEAVE.find(([re]) => re.test(s)) || [null, 'Vacation', 'Within the Philippines', 'detailsOfLeaveDetail', 'Manila'];
  await page.getByRole('combobox').filter({ hasText: /Select Leave Type/ }).first().click();
  await page.locator('input[placeholder="Search leave type..."]').fill(spec[1]);
  const item = page.locator('[cmdk-item]:not([data-disabled])').first();
  if (!(await item.waitFor({ timeout: 6000 }).then(() => true).catch(() => false))) { await page.keyboard.press('Escape'); return blocked(`No "${spec[1]}" leave type is available for the test employee.`); }
  await item.click();
  if (spec[2]) await page.locator('label').filter({ hasText: spec[2] }).first().click().catch(() => {});
  if (spec[3]) {
    const v = /Solo Parent/.test(s) ? (/without SPIC/.test(s) ? '' : `SPIC-QA-${num(row)}`) : spec[4];
    if (v) await page.locator(`input[name=${spec[3]}]`).fill(v).catch(() => {});
  }
  if (/With Pay Yes/.test(other(row))) { const sw = page.locator('#withPay'); if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click(); }
  const comm = /Commutation Requested/.test(other(row)) ? 'Requested' : 'Not Requested';
  await page.locator('label').filter({ has: page.locator(`input[name=commutation][value="${comm}"]`) }).first().click().catch(() => {});
  done.push(`${spec[1]}${spec[2] ? ' / ' + spec[2] : ''}, commutation ${comm}`);
  await page.fill('textarea[name=reason]', `QA-AUTO ${runId} ${row.id}`);
  const appref = /over 30/.test(s) ? 'Q'.repeat(31) : `QA${runId}${num(row)}`.slice(0, 20);
  const ref = String(row.raw['Reference File'] || '');
  if (/No Document/i.test(ref) || !ref || ref === '-') await page.locator('#noDocAttached').click();
  else { await page.fill('input[placeholder="Approval reference..."]', appref); await page.setInputFiles('#uploadAttachment', file(ref)); }
  if (/over 30/.test(s)) await page.fill('input[placeholder="Approval reference..."]', appref).catch(() => {});
  const used = await page.inputValue('input[placeholder="Approval reference..."]').catch(() => appref);
  await page.getByRole('button', { name: /^Submit Leave Request/ }).last().click();
  if (/without SPIC|over 30/.test(s)) { const r = await expectRefused(page, /Solo Parent|Too Long|Approval Reference/i, startPath); return r.ok ? pass(r.note) : fail(r.note); }
  const r = await toastOutcome(page, /Leave Request Added/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  done.push('reference ' + used);
  ctx.created = { label: used, cleanup: () => searchAndDelete(page, base + '/leave/request', used, '[data-action="delete"]') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- leave types
async function leaveType(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row), o = other(row);
  const name = `QA-AUTO-${row.id}`.slice(0, 50);
  await open(page, base + '/leave/types/add', 'input[name=leaveType]');
  const radio = async (group, text) => page.locator('label').filter({ has: page.locator(`input[name=${group}]`) }).filter({ hasText: text }).first().click();
  await page.fill('input[name=leaveType]', name);
  await page.fill('input[name=cdpy]', '5');
  await page.fill('input[name=requestDateApproval]', '3');
  await page.fill('input[name=forceLeave]', '0');
  const [cat, eff] = s.split(' / ').map(x => x.trim());
  await radio('leaveCategory', cat.startsWith('Other') ? 'Other' : cat);
  if (cat.startsWith('Other')) await page.fill('input[name=leaveCategoryDetail]', 'QA');
  await radio('effectivity', eff);
  const yn = /With Pay (Yes|No)/.exec(o)?.[1] || 'No';
  await radio('withPay', yn); await radio('cumulative', /Cumulative (Yes|No)/.exec(o)?.[1] || 'No');
  await radio('postInLeaveMonitor', 'No').catch(() => {});
  await radio('leaveAppliedCondition', /on or after/i.test(o) ? 'On Or After' : 'On Or Before').catch(() => {});
  await radio('creditEffectivity', /Expiry/i.test(o) ? 'Expiry Date' : 'Carry Forward').catch(() => {});
  // Entitled: always only the test employee, whatever the row says.
  await page.locator('label').filter({ has: page.locator('input[name=employeesEntitled][value="Select Employee"]') }).first().click();
  await page.getByRole('combobox').filter({ hasText: /Select employee/i }).last().click();
  await page.locator('input[cmdk-input]').last().fill(config.data.employeeEid);
  await page.locator(`[cmdk-item][data-value*="${config.data.employeeEid}" i]`).first().click({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.fill('textarea[name=leaveNotes]', `QA-AUTO ${runId} ${row.id}`).catch(() => {});
  done.push(`${cat} / ${eff}, entitled: ${config.data.employeeEid} only (sheet said "${row.raw['Applicable To'] || '-'}")`);
  await page.getByRole('button', { name: /^Submit Leave Type/ }).last().click();
  const r = await toastOutcome(page, /Leave Type Added/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  ctx.created = { label: name, cleanup: () => searchAndDelete(page, base + '/leave/types', name, 'button.delete-btn') };
  return finish(ctx, keep, done);
}

// ---------------------------------------------------------------- payroll payments
async function payment(ctx, row, { base, runId, keep, done }) {
  const page = ctx.page, s = sc(row);
  if (/Pending request|Rejected request|covers a wider|not fully cover|^Filter:/.test(s)) return blocked('Depends on specific approval states / payroll data; check by hand.');
  await open(page, base + '/payroll/payments');
  await page.getByRole('button', { name: 'Mark As Paid', exact: true }).last().click();
  const gate = page.locator('text=Payment blocked');
  const dlg = page.getByRole('dialog').filter({ hasText: /Mark Payroll As Paid/ });
  const which = await Promise.race([
    dlg.waitFor({ timeout: 15000 }).then(() => 'dialog').catch(() => null),
    gate.waitFor({ timeout: 15000 }).then(() => 'gate').catch(() => null),
  ]);
  if (which !== 'dialog') return blocked('The current payroll period is not approved for payment, so nothing can be marked paid.');
  const proof = (s.match(/proof (PNG|JPG|WEBP|PDF)/) || [])[1];
  const proofFile = { PNG: 'valid-image.png', JPG: 'valid-image.jpg', WEBP: 'valid-proof.webp', PDF: 'valid-document.pdf' }[proof];
  if (/Proof over 8MB|Proof wrong type/.test(s)) {
    await dlg.locator('input[type=file]').setInputFiles(file(/8MB/.test(s) ? 'too-large-9MB.pdf' : 'invalid-type.txt'));
    const r = await expectRefused(page, /Proof|Invalid|large/i, '/payroll/payments');
    await dlg.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    return r.ok ? pass(r.note) : fail(r.note);
  }
  if (/Reference No over 100/.test(s)) {
    const inp = dlg.locator('input[placeholder="Enter reference no."]');
    await inp.fill('R'.repeat(101)); const len = (await inp.inputValue()).length;
    await dlg.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
    return len <= 100 ? pass(`Capped at ${len}.`) : fail(`Accepted ${len} characters.`);
  }
  await dlg.locator('[role=combobox]').first().click();
  await page.getByRole('option').first().click();
  await dlg.getByRole('button', { name: /Select date/ }).click();
  await page.locator(`[data-slot="calendar"] td[data-day="${ymd(new Date())}"] button, td[data-day="${ymd(new Date())}"] button`).first().click();
  const refNo = `QA-AUTO-${runId}-${num(row)}`;
  await dlg.locator('input[placeholder="Enter reference no."]').fill(refNo);
  if (proofFile) await dlg.locator('input[type=file]').setInputFiles(file(proofFile));
  const empRow = dlg.locator('tr').filter({ hasText: `ID: ${config.data.employeeEid}` }).first();
  if (!(await empRow.isVisible({ timeout: 8000 }).catch(() => false))) { await dlg.getByRole('button', { name: 'Cancel' }).click().catch(() => {}); return blocked('The test employee is not payable in this period (or uses another payment method).'); }
  await empRow.locator('input[type=checkbox]').check();
  done.push(`marked ${config.data.employeeEid} paid, reference ${refNo}${proofFile ? ', proof ' + proofFile : ''}`);
  await dlg.getByRole('button', { name: /^Submit Payment/ }).click();
  const r = await toastOutcome(page, /Payment Submitted Successfully/i);
  if (!r.ok) return fail(r.note + ' | ' + done.join('; '));
  const cleanup = async () => {
    await open(page, base + '/payroll/payments');
    const box = page.locator('input[placeholder="Search"]').first();
    if (await box.isVisible().catch(() => false)) { await box.fill(config.data.employeeEid); await box.press('Enter'); }
    const tr = page.locator('table tbody tr').filter({ hasText: config.data.employeeEid }).first();
    await tr.waitFor({ timeout: 12000 });
    const d = await deleteViaRow(page, tr, { action: 'i[data-action="remove"]', confirm: /^Yes, Clear$/ });
    if (!d.ok) throw new Error(d.note);
  };
  ctx.created = { label: 'payment ' + refNo, cleanup };
  return finish(ctx, keep, done);
}

async function cleanupAll(ctx, base) {
  const page = ctx.page;
  let n = 0;
  const loop = async fn => { for (let i = 0; i < 50; i++) { try { await fn(); n++; } catch (_) { break; } } };
  await loop(() => searchAndDelete(page, base + '/payroll/payments/processor', 'QA-AUTO', 'button.delete-btn'));
  await loop(() => searchAndDelete(page, base + '/users', 'qaauto', 'i[data-action="d-users"]'));
  await loop(() => searchAndDelete(page, base + '/leave/types', 'QA-AUTO', 'button.delete-btn'));
  // Leave requests and payments are found by their reference only during the run that made them.
  return n;
}

export const otherHandlers = [
  { pages: ['/payroll/payments/processor'], match: () => true, run: processorType, cleanupAll, needsEmployee: false },
  { pages: ['/payroll/bank-payments'], match: row => pathOf(row.vercel).includes('/file/generate'), run: bankGenerate, cleanupAll, needsEmployee: false },
  { pages: ['/approving/officers'], match: row => pathOf(row.vercel).endsWith('/add'), run: officersAdd, cleanupAll, needsEmployee: false },
  { pages: ['/users'], match: row => pathOf(row.vercel).endsWith('/users/add'), run: users, cleanupAll, needsEmployee: false },
  { pages: ['/leave/request'], match: row => pathOf(row.vercel).endsWith('/leave/request/add'), run: leaveRequest, cleanupAll },
  { pages: ['/leave/types'], match: row => pathOf(row.vercel).endsWith('/leave/types/add'), run: leaveType, cleanupAll },
  { pages: ['/payroll/payments'], match: row => pathOf(row.vercel) === '/payroll/payments', run: payment, cleanupAll },
];
