/**
 * "Edit: ..." rows of the shared V2 form (Deductions / Additions / Benefits), ticket 2161.
 * Each row: create a QA-AUTO base record on the add form, open its edit page from the list,
 * apply the one edit the catalog names (src/edit-catalog/v2-pages.js), save, check the outcome
 * (for "saved", reopen the edit page and check the change stuck), then delete what it made.
 */
import path from 'node:path';
import { config, accountFor } from '../config.js';
import { origin, login, listPathOf } from '../app.js';
import { editCaseFor } from '../edit-catalog/index.js';
import { V2_PAGES, BASE_FOA } from '../edit-catalog/v2-pages.js';
import { pass, fail, sleep, ymd, findInList, deleteRow, EDIT_LINK, pickDate, setFrequency, setIndefinite, pickDateAnywhere } from './common.js';
import { fillV2 } from './v2.js';

const blocked = notes => ({ result: 'Blocked', notes });
const listOf = url => origin(url) + listPathOf(url);
const FILE = n => path.join(config.data.filesDir, n);
const BAD = '[data-sonner-toast][data-type="warning"], [data-sonner-toast][data-type="error"]';
const monthsAfter = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));

// ---- edit-page fields (the edit form names fewer inputs than the add form)
const F = {
  desc: p => p.locator('main textarea:not(#reason):not([name="reason"])').first(),
  amount: p => p.locator('main input[name="amount"], main input[placeholder="0.00"]').first(),
  // The label is a <label> on some pages and a <p> on others; the input sits next to it.
  name: p => p.locator('main').locator('label, p').filter({ hasText: /^\s*(Name\/Type of|Refund Title)/ }).first().locator('xpath=..').locator('input').first(),
  reason: p => p.locator('main textarea#reason, main textarea[name="reason"]').first(),
  ref: p => p.locator('main input[placeholder="Approval reference..."]').first(),
  submit: p => p.locator('main form button[type="submit"]').last(),
  noDoc: p => p.locator('main #noDocAttached').first(),
  radio: (p, n, v) => p.locator(`main input[type=radio][name="${n}"][value="${v}"]`).first(),
  checked: (p, n) => p.locator(`main input[type=radio][name="${n}"]:checked`).first().getAttribute('value', { timeout: 2000 }).catch(() => null),
  from: p => p.getByRole('button', { name: /^From:/ }).first(),
  to: p => p.getByRole('button', { name: /^To:/ }).first(),
  created: p => p.locator('main div').filter({ has: p.locator('label, p').filter({ hasText: /^Date Created/ }) }).last().locator('button').first(),
};
/** The taxable radio group: "atti" on most pages, "taxable" on Other Addition. */
const taxName = async p => ((await p.locator('main input[type=radio][name="atti"]').count()) ? 'atti' : 'taxable');
const noDocChecked = p => F.noDoc(p).getAttribute('aria-checked').then(v => v === 'true').catch(() => false);
/** The benefits' clickable Active / Inactive badge. */
const statusBadge = p => p.locator('main button').filter({ hasText: /^\s*(Active|Inactive)\s*$/ }).first();

/** Replace a text box's value so React sees every keystroke (select all + type). */
async function retype(loc, text) {
  await loc.click();
  await loc.press('Control+A');
  if (text === '') await loc.press('Backspace'); else await loc.pressSequentially(text, { delay: 5 });
  await loc.blur();
}

async function waitToast(page, re, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const t = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
    if (re.test(t)) return t.slice(0, 160);
    await sleep(250);
  }
  return null;
}

// ---- the base record(s)
async function setTo(page, date) {
  await setIndefinite(page, false);
  await pickDateAnywhere(page, F.to(page), date);
}

async function createRecord(page, listUrl, { row, runId, base, marker, amount, tax, payslip, file }) {
  await page.goto(listUrl + '/add', { waitUntil: 'load' });
  await page.locator('textarea[name="description"]').waitFor({ timeout: config.pageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const raw = {
    'Frequency (FOA)': BASE_FOA[base === 'RegTo' ? 'RegM15' : base] || BASE_FOA.RegM15,
    'Reference File': file ? 'valid-document.pdf' : 'No Document Attached', Name: 'Named - QA', 'Other Inputs': `Amount ${amount}`,
    Taxable: tax ? (tax === 'yes' ? 'Yes' : 'No') : '-', 'Include in Payslip': payslip ? (payslip === 'yes' ? 'Yes' : 'No') : '-',
  };
  await fillV2(page, { id: row.id, raw }, runId, []);
  await page.fill('textarea[name="description"]', marker); // fillV2 writes the row's marker; each record here has its own
  // ...and its own approval reference: two records of one row must not share it (the server refuses the second).
  if (file) await page.fill('input[placeholder="Approval reference..."]', `QA-${runId}-${row.id}${marker.endsWith(' B') ? '-B' : ''}`.slice(0, 100));
  if (base === 'RegTo') await setTo(page, monthsAfter(new Date(), 3));
  await page.locator('form button[type="submit"]').last().click();
  const deadline = Date.now() + config.pageTimeoutMs;
  while (Date.now() < deadline) {
    if (await page.getByRole('dialog').filter({ hasText: 'Possible Duplicate Record' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Yes, Continue' }).click();
    const t = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
    if (/added|success/i.test(t) || !/\/add$/.test(new URL(page.url()).pathname)) return;
    const bad = await page.locator(BAD).allInnerTexts().catch(() => []);
    if (bad.length) throw new Error('could not create the base record: ' + bad.join(' | ').replace(/\s+/g, ' ').slice(0, 200));
    await sleep(300);
  }
  throw new Error('could not create the base record: no confirmation after saving');
}

/** Open a record's edit page from its list row; wait until the record is loaded into the form. */
async function openEdit(page, listUrl, marker) {
  const row = await findInList(page, listUrl, marker, { need: EDIT_LINK });
  // Open the pencil's own link: right after the search redraws the table, a click on the new row can do nothing
  // (seen on Other Addition), while the address always opens the same edit page.
  const href = await row.locator(EDIT_LINK).first().getAttribute('href');
  await page.goto(new URL(href, listUrl).href, { waitUntil: 'load' });
  const loaded = await page.waitForFunction(m => [...document.querySelectorAll('main textarea')].some(t => t.value === m), marker, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!loaded) throw new Error(`the edit page did not load the record (its description never showed "${marker}")`);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await sleep(500);
}

/** After Save on an edit page: { state: 'saved' | 'refused' | 'dialog' | 'none', note, dlg }. */
async function editOutcome(page) {
  const deadline = Date.now() + config.pageTimeoutMs;
  while (Date.now() < deadline) {
    const dlg = page.getByRole('dialog').filter({ hasText: /Possible Duplicate Record/i });
    if (await dlg.isVisible().catch(() => false)) return { state: 'dialog', note: (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 200), dlg };
    const bad = await page.locator(BAD).allInnerTexts().catch(() => []);
    if (bad.length) return { state: 'refused', note: bad.join(' | ').replace(/\s+/g, ' ').slice(0, 200) };
    const t = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ');
    // Some pages show their "no changes" message as a plain info toast.
    const same = t.match(/No Changes?[^|]*|Nothing (was )?modified[^|]*|No new data to save[^|]*/i);
    if (same) return { state: 'refused', note: same[0].trim().slice(0, 200) };
    // "Updated" only: a leftover "Data loaded successfully" toast must not count as a save.
    if (/\bupdated\b/i.test(t) || !/\/edit/.test(new URL(page.url()).pathname)) return { state: 'saved', note: t.slice(0, 160) || 'left the edit page' };
    await sleep(300);
  }
  // Say what WAS on screen, so a silent save is easy to tell apart from an unexpected dialog.
  const dlg = await page.getByRole('dialog').first().innerText().catch(() => '');
  const toasts = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ');
  return { state: 'none', note: `no message within ${config.pageTimeoutMs / 1000} s${dlg ? `; open dialog: ${dlg.replace(/\s+/g, ' ').slice(0, 120)}` : ''}${toasts ? `; toasts: ${toasts.replace(/\s+/g, ' ').slice(0, 120)}` : ''}` };
}

// ---- the edits (one per catalog `act`)
async function setFoa(page, code) {
  if (code === 'RegTo') { await setTo(page, monthsAfter(new Date(), 3)); return 'Effective To in 3 months'; }
  if (code === 'RegIndef') { await setIndefinite(page, true); return 'Indefinite'; }
  return setFrequency(page, BASE_FOA[code]);
}

/** Remove every attached file (the x next to a file name). */
async function removeFiles(page) {
  for (let i = 0; i < 5; i++) {
    const x = page.locator('main').locator('div, span').filter({ hasText: /\.(pdf|docx?|png|jpe?g)$/i }).locator('button').last();
    if (!(await x.count())) return;
    await x.click().catch(() => {});
    await sleep(300);
  }
}

async function applyEdit(page, act, st) {
  const [op, arg] = act.split(':');
  switch (op) {
    case 'foa': return setFoa(page, arg);
    case 'inst-count': await retype(page.locator('input[placeholder="Min. 2"]'), '6'); return 'installments 3 -> 6';
    case 'inst-semi': await page.locator('input[name="installFreq"][value="semi-monthly"]').check(); return 'installment Semi-Monthly';
    case 'inst-rate':
      await retype(page.locator('fieldset input[placeholder="0"]').first(), '12');
      await page.locator('fieldset [role="combobox"]').first().click();
      await page.getByRole('option', { name: 'Annually' }).click();
      return 'interest 12% annually';
    case 'inst-mismatch': {
      // A schedule row's amount (the editable cells of the schedule table): +1.00 so the rows no longer add up.
      const cells = page.locator('main table input[type="text"]:not([readonly]):not([disabled])');
      const n = await cells.count();
      if (!n) throw new Error('no editable schedule row found');
      const cell = cells.nth(n > 1 ? 1 : 0);
      const v = Number((await cell.inputValue()).replace(/,/g, '')) || 0;
      await retype(cell, (v + 1).toFixed(2));
      return `schedule row ${v.toFixed(2)} -> ${(v + 1).toFixed(2)}`;
    }
    case 'name+': {
      st.newName = (await F.name(page).inputValue()) + 'X';
      await retype(F.name(page), st.newName);
      await page.keyboard.press('Escape');
      const now = await F.name(page).inputValue();
      if (now !== st.newName) st.rejected = `the name box does not keep what is typed: it went back to "${now}"`;
      return `name -> "${st.newName}"`;
    }
    case 'name-clear': await retype(F.name(page), ''); await page.keyboard.press('Escape'); return 'name cleared';
    case 'desc+': st.newMarker = st.marker + 'X'; await retype(F.desc(page), st.newMarker); return 'description + "X"';
    case 'desc-clear': await retype(F.desc(page), ''); return 'description cleared';
    case 'amount': await retype(F.amount(page), '2345.67'); return 'amount -> 2,345.67';
    case 'amount0': await retype(F.amount(page), '0'); return 'amount -> 0.00';
    case 'amount-neg': await retype(F.amount(page), '-500'); return 'amount -> -500.00';
    case 'tax': await F.radio(page, await taxName(page), arg).check(); return 'taxable ' + arg;
    case 'payslip': await F.radio(page, 'includeInPayslip', arg).check(); return 'payslip ' + arg;
    case 'from-later': st.newFrom = monthsAfter(new Date(), 1); await pickDateAnywhere(page, F.from(page), st.newFrom); return 'effective from ' + ymd(st.newFrom);
    case 'created': { const y = new Date(); y.setDate(y.getDate() - 1); await pickDateAnywhere(page, F.created(page), y); return 'date created ' + ymd(y); }
    case 'ot-before-from': {
      // The last pay date (15th / end of month) before Effective From (today), picked in the One Time date picker.
      const t = new Date(), d = t.getDate() > 15 ? new Date(t.getFullYear(), t.getMonth(), 15) : new Date(t.getFullYear(), t.getMonth(), 0);
      try { await pickDate(page, page.locator('div.w-45 button').first(), d); }
      catch (e) { if (!/greyed out/.test(e.message)) throw e; st.greyed = ymd(d); }
      return `One Time date ${ymd(d)} (before Effective From)`;
    }
    case 'to-before-from': { const d = new Date(); d.setDate(d.getDate() - 10); await pickDateAnywhere(page, F.to(page), d); return `effective to ${ymd(d)} (before From)`; }
    case 'reason+': st.newReason = 'QA automated testX'; await retype(F.reason(page), st.newReason); return 'reason + "X"';
    case 'reason-clear': await retype(F.reason(page), ''); return 'reason cleared';
    case 'ref+': st.newRef = (await F.ref(page).inputValue()) + 'X'; await retype(F.ref(page), st.newRef); return `approval ref -> ${st.newRef}`;
    case 'ref-dup': await retype(F.ref(page), st.secondRef); return `approval ref -> ${st.secondRef} (the other record's)`;
    case 'file-replace': await removeFiles(page); await page.setInputFiles('#uploadAttachment', FILE('valid-image.png')); return 'file -> valid-image.png';
    case 'to-nodoc': await F.noDoc(page).click(); return 'ticked No Document Attached';
    case 'nodoc-to-file':
      await F.noDoc(page).click();
      st.newRef = `QA-${st.runId}-${st.row.id}-F`.slice(0, 100);
      await retype(F.ref(page), st.newRef);
      await page.setInputFiles('#uploadAttachment', FILE('valid-document.pdf'));
      return 'No Document -> valid-document.pdf';
    case 'untick-nodoc': await F.noDoc(page).click(); await retype(F.ref(page), `QA-${st.runId}-${st.row.id}-N`.slice(0, 100)); return 'unticked No Document Attached, no file';
    case 'file-big': await page.setInputFiles('#uploadAttachment', FILE('too-large-3MB.pdf')); return 'attached too-large-3MB.pdf';
    case 'file-type': await page.setInputFiles('#uploadAttachment', FILE('invalid-type.txt')); return 'attached invalid-type.txt';
    case 'dup-copy': case 'dup-cancel': await retype(F.amount(page), st.secondAmount.replace(/,/g, '')); return `amount -> ${st.secondAmount} (same as the other record)`;
    case 'emp2': {
      // Swap the test employee for the second one in the employee picker.
      await page.getByRole('combobox').filter({ hasText: /\S/ }).filter({ has: page.locator('svg') }).first().click().catch(() => {});
      const input = page.locator('input[cmdk-input]').last();
      await input.fill(config.data.employeeEid);
      await page.locator(`[cmdk-item][data-value$=" ${config.data.employeeEid}" i]`).first().click({ timeout: 8000 });
      await input.fill(config.data.employeeEid2);
      await page.locator(`[cmdk-item][data-value$=" ${config.data.employeeEid2}" i]`).first().click({ timeout: 8000 });
      await page.keyboard.press('Escape');
      return `employee ${config.data.employeeEid} -> ${config.data.employeeEid2}`;
    }
    case 'none': return 'no change';
    case 'status': await statusBadge(page).click(); return 'status -> ' + arg;
    default: throw new Error('unknown edit: ' + act);
  }
}

// ---- after a save: reopen the edit page and read the field back
async function verifySaved(page, listUrl, st, act) {
  await openEdit(page, listUrl, st.newMarker || st.marker);
  const [op, arg] = act.split(':');
  const val = async l => l.inputValue().catch(() => '');
  switch (op) {
    case 'foa': {
      const want = { OT15: ['onetime'], OTEnd: ['onetime'], RegM15: ['regular', 'monthly', '15'], RegMEnd: ['regular', 'monthly', 'end'], RegSemi: ['regular', 'semi-monthly'], Inst: ['installment'], RegTo: ['regular'], RegIndef: ['regular'] }[arg];
      const got = [await F.checked(page, 'freq'), await F.checked(page, 'regularFreq'), await F.checked(page, 'monthlyOption')].slice(0, want.length);
      if (want.some((w, i) => w !== got[i])) return `frequency reads back as ${got.filter(Boolean).join(' / ') || 'nothing'}, wanted ${want.join(' / ')}`;
      if (arg === 'RegTo' && /--/.test(await F.to(page).innerText())) return 'Effective To is still empty';
      if (arg === 'RegIndef' && !/--/.test(await F.to(page).innerText())) return 'Effective To is still set';
      return null;
    }
    case 'name+': return (await val(F.name(page))) === st.newName ? null : `name reads back as "${await val(F.name(page))}"`;
    case 'amount': return /2,?345\.67/.test(await val(F.amount(page))) ? null : `amount reads back as ${await val(F.amount(page))}`;
    case 'amount-neg': return /-\s?500/.test(await val(F.amount(page))) ? null : `amount reads back as ${await val(F.amount(page))}`;
    case 'tax': { const t = await F.checked(page, await taxName(page)); return t === arg ? null : `taxable reads back as ${t}`; }
    case 'payslip': return (await F.checked(page, 'includeInPayslip')) === arg ? null : `payslip reads back as ${await F.checked(page, 'includeInPayslip')}`;
    case 'reason+': return (await val(F.reason(page))) === st.newReason ? null : `reason reads back as "${await val(F.reason(page))}"`;
    case 'ref+': case 'nodoc-to-file': return (await val(F.ref(page))) === st.newRef ? null : `approval ref reads back as "${await val(F.ref(page))}"`;
    case 'to-nodoc': return (await noDocChecked(page)) ? null : 'No Document Attached is not ticked';
    case 'file-replace': return (await page.locator('main').getByText(/valid-image\.png/).count()) ? null : 'valid-image.png is not shown as the attachment';
    case 'from-later': {
      const want = st.newFrom.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return (await F.from(page).innerText()).includes(want) ? null : `From reads back as ${await F.from(page).innerText()}, wanted ${want}`;
    }
    case 'inst-count': return (await val(page.locator('input[placeholder="Min. 2"]'))) === '6' ? null : 'the installment count did not stick';
    case 'inst-semi': return (await F.checked(page, 'installFreq')) === 'semi-monthly' ? null : 'the installment frequency did not stick';
    case 'status': { const s = (await statusBadge(page).innerText().catch(() => '')).trim(); return s === arg ? null : `status reads back as "${s}"`; }
    default: return null; // desc+ was reopened by its new description, so it stuck; the rest has nothing to read back
  }
}

// ---- checks that only look at the form
async function lockedCheck(page, spec) {
  if (spec.act === 'inst-absent') {
    return (await page.locator('main input[name="freq"][value="installment"]').count())
      ? fail('An Installment option is offered on edit.') : pass('Only One Time and Regular are offered.');
  }
  if (spec.act === 'tax-locked') {
    const want = spec.re, other = want === 'yes' ? 'no' : 'yes';
    const tn = await taxName(page), dis = await F.radio(page, tn, other).isDisabled().catch(() => false), cur = await F.checked(page, tn);
    return dis && cur === want ? pass(`Taxable stays ${want}; ${other} is disabled.`) : fail(`Taxable is ${cur}; the ${other} option is ${dis ? 'disabled' : 'selectable'}.`);
  }
  if (spec.act === 'name-locked') {
    const n = F.name(page), before = await n.inputValue();
    const how = await n.evaluate(e => (e.readOnly || e.disabled ? 'read-only' : `not read-only, pointer-events ${getComputedStyle(e).pointerEvents}`));
    await n.focus().catch(() => {}); // the way Tab reaches it
    await page.keyboard.type('Z');
    const after = await n.inputValue();
    return after === before ? pass(`Name stays "${before}" (${how}).`) : fail(`Name changed from "${before}" to "${after}" by focusing it and typing (${how}).`);
  }
  return fail('unknown locked check ' + spec.act);
}

async function cappedCheck(page) {
  await F.desc(page).fill('D'.repeat(600));
  await F.reason(page).fill('R'.repeat(120));
  const ref = F.ref(page), refRO = await ref.evaluate(e => e.readOnly).catch(() => true);
  if (!refRO) await ref.fill('A'.repeat(120));
  const d = (await F.desc(page).inputValue()).length, r = (await F.reason(page).inputValue()).length, a = refRO ? 0 : (await ref.inputValue()).length;
  const note = `description ${d}, reason ${r}${refRO ? '' : `, approval ref ${a}`} characters`;
  return d <= 500 && r <= 100 && a <= 100 ? pass(`Capped: ${note}.`) : fail(`Not capped: ${note}.`);
}

// ---- other roles
async function asRole(page, listUrl, acc, fn) {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const p2 = await context.newPage();
    const r = await login(p2, listUrl, acc);
    if (!r.ok) return fail(`Login as ${acc.username} failed: ${r.message}`);
    return await fn(p2);
  } finally { await context.close().catch(() => {}); }
}

/** payroll_mgmt (view-only) must not get into an edit page. */
export const viewOnly = (page, listUrl) => {
  const acc = accountFor('payroll_mgmt') || accountFor('payroll_approving_officer');
  if (!acc) return blocked('Set ACCOUNT_PAYROLL_MGMT (or ACCOUNT_PAYROLL_APPROVING_OFFICER) in .env.');
  return asRole(page, listUrl, acc, async p2 => {
    // The page's default view may be the by-employee one (no pencils): try the record views too.
    const pen = p2.locator('table tbody tr').locator('a[href*="/edit"], i.fa-pen-to-square').first();
    let found = false;
    for (const q of ['', '?filter=by-trans', '?filter=by-eligibility']) {
      await p2.goto(listUrl + q, { waitUntil: 'load' });
      await p2.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      if ((found = await pen.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) break;
    }
    if (!found) return blocked('No record in the list to try the edit icon on.');
    await pen.click({ force: true }).catch(() => {});
    const t = await waitToast(p2, /view-only|view only|can view records/i, 6000);
    await sleep(1000);
    if (/\/edit/.test(new URL(p2.url()).pathname)) return fail(`${acc.username} (view-only) opened the edit page.`);
    return pass(t ? `Blocked as expected for ${acc.username}: ${t}` : `The edit page did not open for ${acc.username} (no message shown).`);
  });
};

/** An employee account pasting a record's edit link must be refused. */
async function employeeDenied(page, listUrl, marker) {
  const acc = accountFor('employee');
  if (!acc) return blocked('Set ACCOUNT_EMPLOYEE in .env.');
  const href = await (await findInList(page, listUrl, marker, { need: EDIT_LINK })).locator(EDIT_LINK).first().getAttribute('href');
  return asRole(page, listUrl, acc, async p2 => {
    await p2.goto(origin(listUrl) + href, { waitUntil: 'load' });
    await p2.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const text = (await p2.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const form = await p2.locator('main form button[type="submit"]').count();
    const away = !/\/edit/.test(new URL(p2.url()).pathname);
    if (form && !away) return fail(`${acc.username} (employee) can open the edit form.`);
    return pass(/access denied/i.test(text) ? `'Access Denied' for ${acc.username}.` : `${acc.username} was sent to ${new URL(p2.url()).pathname} instead.`);
  });
}

// ---- one row
async function run(ctx, row, { runId, keep, url, done }) {
  const page = ctx.page, list = listPathOf(url), listUrl = listOf(url);
  const spec = editCaseFor(list, String(row.raw?.Scenario || ''))?.auto;
  if (!spec) return blocked('No automation for this edit yet; check by hand.');
  if (spec.expect === 'manual') return blocked(`Not automated (${spec.why}); check by hand.`);
  if (spec.act === 'viewonly') return viewOnly(page, listUrl);
  if (spec.act === 'emp2' && !config.data.employeeEid2) return blocked('Needs a second test employee: set QA_EMPLOYEE_EID_2 in .env.');

  const st = { row, runId, marker: `QA-AUTO ${runId} ${row.id}` };
  const made = [];
  // Delete what this row made; an edited description is tried too ("...X").
  const cleanup = async () => {
    for (const m of made.reverse()) {
      const r = await findInList(page, listUrl, m).catch(() => null) || await findInList(page, listUrl, m + 'X').catch(() => null);
      if (!r) throw new Error(`"${m}" not found for cleanup`);
      await deleteRow(page, r);
    }
  };
  ctx.created = { label: st.marker, cleanup };
  const finish = async result => {
    if (keep) { ctx.created = null; return { ...result, notes: result.notes + ' (kept, --keep)' }; }
    return result; // runDpRow's finally runs ctx.created.cleanup()
  };
  const with_ = r => ({ ...r, notes: r.result === 'Pass' ? `${r.notes} ${done.join('; ')}` : `${r.notes} | ${done.join('; ')}` });

  // Amounts unique to the row, so a base record never looks like a duplicate of another test record.
  const n = Number(String(row.id).replace(/\D/g, '').slice(-3)) || 0;
  const baseAmount = `1,${String(100 + (n % 900)).padStart(3, '0')}.00`;
  // The other record first (copy / duplicate-reference tests), so the base can be edited against it.
  if (spec.second) {
    st.secondAmount = `2,${String(100 + (n % 900)).padStart(3, '0')}.00`;
    await createRecord(page, listUrl, { row, runId, base: spec.base, marker: st.marker + ' B', amount: st.secondAmount, tax: spec.baseTax, payslip: spec.basePayslip, file: spec.file });
    made.push(st.marker + ' B');
    if (spec.act === 'ref-dup') { await openEdit(page, listUrl, st.marker + ' B'); st.secondRef = await F.ref(page).inputValue(); }
  }
  await createRecord(page, listUrl, { row, runId, base: spec.base, marker: st.marker, amount: baseAmount, tax: spec.baseTax, payslip: spec.basePayslip, file: spec.file });
  made.push(st.marker);
  done.push(`base ${spec.base}${spec.file ? ' + file' : ''}${spec.second ? ' + a second record' : ''}`);

  if (spec.act === 'employee-denied') return finish(await employeeDenied(page, listUrl, st.marker));
  await openEdit(page, listUrl, st.marker);
  st.refNo = await page.locator('main input#referenceNo, main input[name="referenceNo"]').first().inputValue().catch(() => '');
  if (spec.expect === 'locked') return finish(with_(await lockedCheck(page, spec)));
  if (spec.act === 'status:Active') {
    // "Set Active again" needs an Inactive record first.
    await statusBadge(page).click();
    await F.submit(page).click();
    const first = await editOutcome(page);
    if (first.state !== 'saved') return finish(with_(fail('Could not make the record Inactive first: ' + first.note)));
    await openEdit(page, listUrl, st.marker);
    done.push('made Inactive first');
  }

  if (spec.expect === 'capped') return finish(with_(await cappedCheck(page))); // types its own texts
  done.push(await applyEdit(page, spec.act, st));
  if (st.rejected) return finish(with_(fail('Cannot be edited: ' + st.rejected + '.')));
  const re = spec.re && new RegExp(spec.re, 'i');
  if (spec.expect === 'corrected') {
    const t = await waitToast(page, re);
    return finish(with_(t ? pass('Corrected as expected: ' + t) : fail('No "Invalid Date Range" message.')));
  }
  // Refused on the field itself, before any Save: file checks, a negative amount on Installment, a One Time date before From.
  if (st.greyed) return finish(with_(pass(`The date ${st.greyed} is greyed out in the One Time date picker.`)));
  if (/^(file-big|file-type|ot-before-from)$/.test(spec.act) || (spec.act === 'amount-neg' && spec.expect === 'refused')) {
    const t = await waitToast(page, re, 6000);
    if (t) return finish(with_(pass('Refused as expected: ' + t)));
    if (spec.act === 'amount-neg' && (await F.checked(page, 'freq')) !== 'installment') return finish(with_(pass('Installment was switched off for the negative amount.')));
    if (spec.act === 'amount-neg') {
      const v = await F.amount(page).inputValue();
      if (!v.includes('-')) return finish(with_(pass(`The minus sign is not accepted while Installment is selected (the box shows "${v}").`)));
    }
  }

  await F.submit(page).click();
  let out = await editOutcome(page);
  if (spec.expect === 'refused' && out.state === 'dialog') {
    // A near-duplicate warning (the two records differ only in amount) comes first: continue past it to the real check.
    done.push('passed the duplicate warning');
    await out.dlg.getByRole('button', { name: 'Yes, Continue' }).click();
    await out.dlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    out = await editOutcome(page);
  }
  if (spec.expect === 'refused') {
    if (out.state === 'refused') return finish(with_(re.test(out.note) ? pass('Refused as expected: ' + out.note) : fail('Refused, but with an unexpected message: ' + out.note)));
    if (out.state === 'none') return finish(with_(pass("Not saved (no success message; the browser's required-field check stopped it).")));
    return finish(with_(fail(`It SAVED, but should have been refused (${out.note}).`)));
  }
  if (spec.expect === 'dialog') {
    if (out.state !== 'dialog') return finish(with_(fail(out.state === 'saved' ? "Saved with no duplicate warning (expected 'Possible Duplicate Record')." : `No duplicate warning: ${out.note}`)));
    if (spec.act === 'dup-cancel') {
      await out.dlg.getByRole('button', { name: /^Cancel$/ }).click();
      const saved = await waitToast(page, /\bupdated\b/i, 2500);
      return finish(with_(!saved && /\/edit/.test(new URL(page.url()).pathname) ? pass(`Warning shown (${out.note.slice(0, 90)}); Cancel kept the record unchanged.`) : fail('Cancel on the warning still saved.')));
    }
    await out.dlg.getByRole('button', { name: 'Yes, Continue' }).click();
    await out.dlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    const after = await editOutcome(page);
    return finish(with_(after.state === 'saved' ? pass(`Warning shown (${out.note.slice(0, 90)}); Yes, Continue saved it.`) : fail(`Warning shown, but Yes, Continue did not save: ${after.note}`)));
  }
  // expect: saved
  if (out.state === 'dialog') {
    // Compared with itself is the bug; a warning about some OTHER record with the same settings is the page working.
    if (st.refNo && out.note.includes(st.refNo)) return finish(with_(fail(`Duplicate warning against the record itself: ${out.note}`)));
    done.push(`accepted a duplicate warning about another record (${(out.note.match(/Record (\S+) already/) || [])[1] || '?'})`);
    await out.dlg.getByRole('button', { name: 'Yes, Continue' }).click();
    await out.dlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    out = await editOutcome(page);
  }
  if (out.state !== 'saved') return finish(with_(fail('Not saved: ' + out.note)));
  if (spec.act === 'emp2') return finish(with_(pass('Saved with the second test employee.')));
  const wrong = await verifySaved(page, listUrl, st, spec.act).catch(e => 'could not reopen the record: ' + String(e.message).split('\n')[0]);
  return finish(with_(wrong ? fail(`Saved, but ${wrong}.`) : pass('Saved and read back.')));
}

export const editV2Handlers = [
  { edit: true, pages: V2_PAGES.map(p => p.list), match: row => /^Edit: /.test(row.raw?.Scenario || '') && !!editCaseFor(listPathOf(row.vercel || 'https://x/'), String(row.raw.Scenario))?.auto, run },
];
