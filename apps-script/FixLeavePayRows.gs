/**
 * One-off fix: Leave Pay (/payroll/addition/leave-pay) is commented out of the sidebar, so it
 * is a remnant page. Turns its rows on every TC sheet into "must not open" checks, and its
 * DP row into a note. Run once from the Apps Script editor; safe to run again.
 */
function fixLeavePayRows() {
  const ss = SpreadsheetApp.getActive();
  let changed = 0;
  for (const sh of ss.getSheets()) {
    const name = sh.getName();
    if (!/^(TC|DP) - /.test(name) || sh.getLastRow() < 5) continue;
    const head = sh.getRange(4, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const c = h => head.indexOf(h) + 1;
    const cMod = c('Module'), cPage = c('Page'), cFn = c('Function / Test'), cAcc = c('Expected Access'),
      cSteps = c('Steps to Test'), cExp = c('Expected Result'), cScen = c('Scenario');
    const n = sh.getLastRow() - 4;
    const pages = sh.getRange(5, cPage, n, 1).getValues();
    const seen = {};
    for (let i = 0; i < n; i++) {
      if (pages[i][0] !== 'Leave Pay') continue;
      const r = 5 + i;
      if (name.startsWith('DP - ')) {
        if (cScen) sh.getRange(r, cScen).setValue('Page is a remnant (not in the sidebar)');
        sh.getRange(r, cExp).setValue('Leave Pay is commented out of the sidebar. Skip; covered by the Remnant Pages rows on the TC sheets.');
        changed++;
        continue;
      }
      // One remnant check per role is enough; extra Leave Pay rows become N/A notes.
      if (!seen[name]) {
        seen[name] = true;
        sh.getRange(r, cMod).setValue('Remnant Pages');
        sh.getRange(r, cFn).setValue('Unused page must not open');
        sh.getRange(r, cAcc).setValue('No Access');
        sh.getRange(r, cSteps).setValue('1. Log in with this role.\n2. Paste the link into the address bar and press Enter.');
        sh.getRange(r, cExp).setValue('Not reachable (Access Denied / not found). Leave Pay is commented out of the sidebar, so it should not be usable.');
      } else {
        sh.getRange(r, cMod).setValue('Remnant Pages');
        sh.getRange(r, cFn).setValue('(Leave Pay is a remnant - nothing to test)');
        sh.getRange(r, cAcc).setValue('N/A');
        sh.getRange(r, cExp).setValue('Skip. Covered by the "Unused page must not open" row above.');
      }
      changed++;
    }
  }
  Logger.log('Leave Pay rows updated: ' + changed);
}
