/**
 * TC ID selection shared by both runners (--only / --ids-file):
 *   DPPD-0012                 one test
 *   DPPD-0559..DPPD-0600      a range, in sheet order (inclusive; swapped if given backwards)
 *   DPB-0241..                from DPB-0241 to the end of its sheet
 *   ..DPB-0020                from the start of DPB-0020's sheet up to it
 * Separate several with commas, spaces or new lines. A range never crosses sheets.
 */

/** Parse selection text into [{ id }] / [{ from, to }] items (from/to null = open end). */
export function parseSelection(text) {
  if (text == null) return null;
  const items = [];
  for (const tok of String(text).split(/[\s,;]+/).map(t => t.trim()).filter(Boolean)) {
    const m = tok.match(/^([^.]*)\.\.([^.]*)$/);
    if (!m) { items.push({ id: tok }); continue; }
    const [, from, to] = m;
    if (!from && !to) throw new Error(`"${tok}" is not a range: give a start, an end or both (e.g. DPB-0241..).`);
    items.push({ from: from || null, to: to || null });
  }
  return items.length ? items : null;
}

/**
 * The IDs a selection picks out of `rows` (every row of the sheets in play, in sheet order).
 * Throws when an ID in the selection is not in any loaded sheet, so a typo never runs nothing quietly.
 */
export function selectIds(rows, items) {
  if (!items) return null;
  const bySheet = new Map(), where = new Map();
  for (const r of rows) {
    if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []);
    where.set(r.id, { sheet: r.sheet, i: bySheet.get(r.sheet).push(r) - 1 });
  }
  const missing = [], out = new Set();
  for (const it of items) {
    if (it.id) { if (where.has(it.id)) out.add(it.id); else missing.push(it.id); continue; }
    const a = it.from && where.get(it.from), b = it.to && where.get(it.to);
    if (it.from && !a) { missing.push(it.from); continue; }
    if (it.to && !b) { missing.push(it.to); continue; }
    const sheet = (a || b).sheet;
    if (a && b && a.sheet !== b.sheet) throw new Error(`Range ${it.from}..${it.to} spans two sheets (${a.sheet} / ${b.sheet}); split it into one range per sheet.`);
    const list = bySheet.get(sheet);
    let lo = a ? a.i : 0, hi = b ? b.i : list.length - 1;
    if (lo > hi) [lo, hi] = [hi, lo];
    for (let i = lo; i <= hi; i++) out.add(list[i].id);
  }
  if (missing.length) throw new Error(`Not found in the loaded sheets: ${missing.join(', ')}`);
  return out;
}
