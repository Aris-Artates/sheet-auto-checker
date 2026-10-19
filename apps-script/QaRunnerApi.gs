/**
 * QA Runner API - paste into the sheet's Apps Script (Extensions > Apps Script) as a new file,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 *
 * Set a Script Property QA_TOKEN (Project Settings > Script Properties) to the same value as
 * SHEET_TOKEN in the runner's .env. Every request must carry it; anything else is refused.
 *
 *   GET  ?token=..&action=tests[&sheets=TC - payroll_officer,TC - employee]
 *        -> { sheets: { "<name>": [ {header: value, ...}, ... ] } }   (rows from row 5, headers on row 4)
 *   POST { token, rows: [ { tcId, checker, env, result, notes, screenshot: { name, base64 } } ] }
 *        -> appends one Check Log row per item; screenshots go to a "QA Screenshots" Drive folder.
 */
const QA_LOG = 'Check Log';
// Drive folder for failure screenshots. Override with the Script Property QA_SHOT_FOLDER.
const QA_SHOT_FOLDER = PropertiesService.getScriptProperties().getProperty('QA_SHOT_FOLDER') || 'QA Screenshots';

function qaAuth_(token) {
  const want = PropertiesService.getScriptProperties().getProperty('QA_TOKEN');
  if (!want || token !== want) throw new Error('Bad or missing token');
}

function qaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    qaAuth_(e.parameter.token);
    if (e.parameter.action === 'status') {
      // Gzipped: the plain answer (~600 KB) is too big for Google's web-app hand-off and comes back as a 404.
      const gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(qaStatus_()), 'application/json'));
      return qaJson_({ ok: true, gz: Utilities.base64Encode(gz.getBytes()) });
    }
    // Small answer: just the test sheet names, so the runner can fetch one sheet per request.
    if (e.parameter.action === 'list') {
      return qaJson_({ ok: true, sheets: SpreadsheetApp.getActive().getSheets().map(s => s.getName()).filter(n => /^(TC|DP) - /.test(n)) });
    }
    if (e.parameter.action !== 'tests') throw new Error('Unknown action');
    // The long free-text columns are for people, not the runner; leaving them out keeps answers small.
    const skip = e.parameter.full ? /\(auto\)/ : /\(auto\)|^Steps to Test$|^Expected Result$/;
    const ss = SpreadsheetApp.getActive();
    const want = e.parameter.sheets ? e.parameter.sheets.split(',').map(s => s.trim()) : null;
    const out = {};
    for (const sh of ss.getSheets()) {
      const name = sh.getName();
      if (!/^(TC|DP) - /.test(name)) continue;
      if (want && want.indexOf(name) < 0) continue;
      const last = sh.getLastRow(), cols = sh.getLastColumn();
      if (last < 5) { out[name] = []; continue; }
      const head = sh.getRange(4, 1, 1, cols).getValues()[0].map(String);
      const vals = sh.getRange(5, 1, last - 4, cols).getValues();
      out[name] = vals.filter(r => r[0]).map(r => {
        const o = {};
        head.forEach((h, i) => { if (h && !skip.test(h)) o[h] = r[i]; });
        return o;
      });
    }
    // Gzipped for the same reason as status: big plain answers fail Google's hand-off.
    const gz = Utilities.gzip(Utilities.newBlob(JSON.stringify({ sheets: out }), 'application/json'));
    return qaJson_({ ok: true, gz: Utilities.base64Encode(gz.getBytes()) });
  } catch (err) {
    return qaJson_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * Latest result of every test row. Computed straight from the Check Log rows (one read),
 * NOT from the sheets' (auto) formula columns: reading thousands of FILTER formulas forces
 * Google to recalculate them and runs past the 6-minute limit once the log grows.
 * Used by the runner UI for "retest failed / passed" and the summary.
 */
function qaStatus_() {
  const ss = SpreadsheetApp.getActive();
  // 1. latest result per TC ID per environment, from the Check Log
  const latest = {};
  const log = ss.getSheetByName(QA_LOG);
  if (log && log.getLastRow() > 1) {
    const head = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].map(h => String(h).toLowerCase());
    const find = (...n) => head.findIndex(h => n.some(x => h.startsWith(x)));
    const cId = find('tc id'), cAt = find('checked at', 'timestamp'), cEnv = find('environment'), cRes = find('result');
    const width = Math.max(cId, cAt, cEnv, cRes) + 1;
    const rows = log.getRange(2, 1, log.getLastRow() - 1, width).getValues();
    for (const r of rows) {
      const id = r[cId]; if (!id) continue;
      const at = r[cAt] instanceof Date ? r[cAt].getTime() : 0;
      const envs = r[cEnv] === 'Both' ? ['vercel', 'dotnet'] : r[cEnv] === '.NET' ? ['dotnet'] : r[cEnv] === 'Vercel' ? ['vercel'] : [];
      const e = latest[id] || (latest[id] = { checks: 0 });
      e.checks++;
      for (const k of envs) if (!e[k] || at >= e[k].at) e[k] = { at, res: r[cRes] };
    }
  }
  // 2. the test rows themselves: only the plain columns, never the (auto) formula columns
  const out = [];
  for (const sh of ss.getSheets()) {
    const name = sh.getName();
    if (!/^(TC|DP) - /.test(name) || sh.getLastRow() < 5) continue;
    const head = sh.getRange(4, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const c = h => head.indexOf(h);
    const iId = c('TC ID'), iMod = c('Module'), iPage = c('Page'), iFn = c('Function / Test') >= 0 ? c('Function / Test') : c('Scenario');
    if (iId < 0) continue;
    const width = Math.max(iId, iMod, iPage, iFn) + 1;
    const vals = sh.getRange(5, 1, sh.getLastRow() - 4, width).getValues();
    for (const r of vals) {
      const id = r[iId]; if (!id) continue;
      const e = latest[id] || {};
      out.push({ sheet: name, id, module: r[iMod], page: r[iPage], test: r[iFn],
        vercel: (e.vercel && e.vercel.res) || 'Not Started', dotnet: (e.dotnet && e.dotnet.res) || 'Not Started', checks: e.checks || 0 });
    }
  }
  return out;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    qaAuth_(body.token);
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActive();
    const log = ss.getSheetByName(QA_LOG);
    if (!log) throw new Error('No sheet named ' + QA_LOG);
    const head = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].map(h => String(h).toLowerCase());
    const find = (...names) => head.findIndex(h => names.some(n => h.startsWith(n)));
    const C = {
      id: find('tc id'), who: find('checker', 'email'), at: find('checked at', 'timestamp'),
      env: find('environment'), res: find('result'), notes: find('notes'), shot: find('screenshot'),
    };
    if (C.id < 0 || C.res < 0) throw new Error('Check Log headers not recognised');
    // First empty TC ID cell: the sheet has helper formulas pre-filled far down, so getLastRow() is useless.
    const ids = log.getRange(2, C.id + 1, log.getMaxRows() - 1, 1).getValues();
    let row = 2 + ids.findIndex(r => r[0] === '');
    if (row < 2) row = log.getMaxRows() + 1;
    const now = new Date();
    let folder = null;
    const items = body.rows || [];
    const cols = { id: [], who: [], at: [], env: [], res: [], notes: [], shot: [] };
    for (const item of items) {
      let link = '';
      if (item.screenshot && item.screenshot.base64) {
        if (!folder) {
          const it = DriveApp.getFoldersByName(QA_SHOT_FOLDER);
          folder = it.hasNext() ? it.next() : DriveApp.createFolder(QA_SHOT_FOLDER);
        }
        const blob = Utilities.newBlob(Utilities.base64Decode(item.screenshot.base64), 'image/png', item.screenshot.name);
        link = folder.createFile(blob).getUrl();
      }
      cols.id.push([item.tcId]); cols.who.push([item.checker || 'QA Bot']); cols.at.push([now]);
      cols.env.push([item.env]); cols.res.push([item.result]); cols.notes.push([item.notes || '']); cols.shot.push([link]);
    }
    if (items.length) {
      if (row + items.length - 1 > log.getMaxRows()) log.insertRowsAfter(log.getMaxRows(), row + items.length - log.getMaxRows());
      // One write per column: the log's hidden helper columns sit next to these and must not be overwritten.
      for (const k of Object.keys(cols)) if (C[k] >= 0) log.getRange(row, C[k] + 1, items.length, 1).setValues(cols[k]);
    }
    return qaJson_({ ok: true, written: items.length, firstRow: row });
  } catch (err) {
    return qaJson_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
