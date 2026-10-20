/** Handler for the shared Additions / Deductions / Benefits add form ("Add: ..." rows). */
import { config } from '../config.js';
import { origin } from '../app.js';
import { pass, fail, PARTIAL, saveOutcome, findInList, deleteRow } from './common.js';
import { fillV2 } from './v2.js';

const listOf = url => origin(url) + new URL(url).pathname.replace(/\/add$/, '');

async function run(ctx, row, { runId, keep, url, done }) {
  const page = ctx.page;
  const listUrl = listOf(url);
  await page.goto(listUrl + '/add', { waitUntil: 'load' });
  await page.locator('textarea[name="description"]').waitFor({ timeout: config.pageTimeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const marker = await fillV2(page, row, runId, done);

  await page.locator('form button[type="submit"]').last().click();
  const saved = await saveOutcome(page);
  if (!saved.ok) return fail(saved.note + ' | ' + done.join('; '));
  ctx.created = { label: marker, cleanup: () => findInList(page, listUrl, marker).then(r => deleteRow(page, r)) };

  const listRow = await findInList(page, listUrl, marker).catch(() => null);
  if (!listRow) return fail('Saved, but the record was not found in the list | ' + done.join('; '));
  if (keep) return pass(PARTIAL + 'Saved and listed (kept, --keep). ' + done.join('; '));
  await deleteRow(page, listRow);
  ctx.created = null;
  return pass(PARTIAL + 'Saved, listed and deleted. ' + done.join('; '));
}

/** Remove every QA-AUTO record on these list pages. */
export async function v2Cleanup(ctx, base, pages) {
  let n = 0;
  for (const p of pages) {
    for (let i = 0; i < 200; i++) {
      const row = await findInList(ctx.page, base + p, 'QA-AUTO').catch(() => null);
      if (!row) break;
      await deleteRow(ctx.page, row);
      n++;
    }
  }
  return n;
}

export const v2Handlers = [
  { match: row => /^Add: /.test(row.raw?.Scenario || ''), run, cleanupAll: v2Cleanup },
];
