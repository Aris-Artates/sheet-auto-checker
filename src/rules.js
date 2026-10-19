/**
 * Which sheet rows the runner can decide by itself, and how.
 *
 * A rule is chosen from the row's "Function / Test" text (and Expected Access). Each returns
 * { result: 'Pass' | 'Fail' | 'Blocked', notes } or null when the row needs a human.
 * Rows with no rule are reported as MANUAL and never written to the Check Log.
 */
import { open, sidebarPaths, hasDashboardSelector, writeControls, apiStatus, describeApi, pathOf, origin } from './app.js';

const pass = notes => ({ result: 'Pass', notes });
const fail = notes => ({ result: 'Fail', notes });

const VIEW_FNS = new Set([
  'View list + filters', 'View list (read-only)', 'View dashboard', 'View own records', 'View list + employee details',
  'View request list + pending badge', 'View leave approval list', 'View + filter by pay group / period',
]);
const DENIED_OK = new Set(['denied', 'notfound']);

async function expectAllowed(ctx, url) {
  const r = await open(ctx.page, url);
  if (r.state === 'allowed' && !r.moved) return pass(r.detail);
  return fail(`Expected the page to open. Got: ${r.state} - ${r.detail}`);
}

async function expectBlocked(ctx, url, { loggedOutOk = false } = {}) {
  const r = await open(ctx.page, url);
  if (DENIED_OK.has(r.state)) return pass(r.detail);
  if (loggedOutOk && r.state === 'logged-out') return pass(r.detail);
  if (r.state === 'allowed' && r.moved) return pass(r.detail + ' (redirected away)');
  return fail(`Expected Access Denied / not found. Got: ${r.state} - ${r.detail}`);
}

const RULES = [
  // ---- runs on its own, outside the per-row loop (see run.js)
  { match: row => row.fn === 'Log in' || /^Log in with/.test(row.fn), special: 'login' },
  { match: row => row.fn === 'Log out', special: 'logout' },
  { match: row => row.fn === 'Sidebar shows only allowed menus', special: 'sidebar' },

  // ---- page access
  { match: row => VIEW_FNS.has(row.fn), run: (ctx, row) => expectAllowed(ctx, row.url) },
  {
    match: row => row.fn === 'Blocked: menu hidden + direct URL',
    run: async (ctx, row) => {
      const res = await expectBlocked(ctx, row.url);
      const target = pathOf(row.url);
      if (ctx.sidebar?.has(target)) return fail(`Sidebar still links to ${target}. ` + res.notes);
      return res;
    },
  },
  { match: row => row.fn === 'Unused page must not open', run: (ctx, row) => expectBlocked(ctx, row.url) },
  { match: row => row.fn === 'Direct URL to Add page' && row.access === 'Blocked', run: (ctx, row) => expectBlocked(ctx, row.url) },
  { match: row => row.fn === 'Open page without a valid session', run: (ctx, row) => expectBlocked(ctx, row.url, { loggedOutOk: true }) },

  // ---- things on the page
  {
    match: row => row.fn === 'Dashboard view selector',
    run: async (ctx, row) => {
      const r = await open(ctx.page, row.url);
      if (r.state !== 'allowed') return fail(`Dashboard did not load: ${r.state} - ${r.detail}`);
      const has = await hasDashboardSelector(ctx.page);
      const want = row.access === 'Allowed';
      return has === want ? pass(has ? 'View switcher shown' : 'No view switcher') : fail(has ? 'View switcher is shown but this role should be locked' : 'View switcher missing');
    },
  },
  {
    match: row => row.fn === 'Write controls blocked' || row.fn === 'No Add / Edit / View / Print controls',
    run: async (ctx, row) => {
      const r = await open(ctx.page, row.url);
      if (r.state !== 'allowed') return fail(`Page did not load: ${r.state} - ${r.detail}`);
      const found = await writeControls(ctx.page);
      return found.length ? fail('Write controls still visible and enabled: ' + [...new Set(found)].join(', '))
        : pass('No enabled Add/Edit/Delete/Save/Print controls on the page (text match).');
    },
  },

  // ---- bypass attempts that are plain requests
  {
    match: row => row.fn === 'Read Activity Log via API',
    run: async (ctx, row) => {
      const pageRes = await expectBlocked(ctx, origin(row.url) + '/activity-log');
      const api = await apiStatus(ctx.page, '/api/request?source=activity-logs');
      const note = `Page: ${pageRes.notes}. API: ${describeApi(api)}.`;
      return pageRes.result === 'Pass' && (api.refused || api.rows === 0) ? pass(note) : fail(note);
    },
  },
  {
    match: row => row.fn === 'Payroll data via API (endpoint allowlist)',
    run: async ctx => {
      const api = await apiStatus(ctx.page, '/api/request?source=employees');
      return api.refused ? pass(describeApi(api)) : fail('Expected a refusal, got ' + describeApi(api));
    },
  },
  {
    match: row => row.fn === 'Call the API without a session',
    run: async (ctx, row) => {
      await ctx.page.goto(origin(row.url) + '/', { waitUntil: 'domcontentloaded' });
      const api = await apiStatus(ctx.page, '/api/request?source=employees');
      return api.refused ? pass(describeApi(api)) : fail('Expected a refusal, got ' + describeApi(api));
    },
  },
  {
    match: row => row.fn === 'Open closed leave pages directly' || row.fn === 'Admin sub-pages directly' || row.fn === 'Open My Account page directly',
    run: async (ctx, row) => {
      const base = origin(row.url);
      const paths = {
        'Open closed leave pages directly': ['/leave/summary', '/leave/request/add', '/leave/types/add'],
        'Admin sub-pages directly': ['/payroll/deduction/klcc/canteen-grocery/add', '/payroll/addition/other/add', '/benefits/cola/add'],
        'Open My Account page directly': ['/profile/account'],
      }[row.fn];
      const bad = [];
      for (const p of paths) {
        const r = await expectBlocked(ctx, base + p);
        if (r.result !== 'Pass') bad.push(`${p}: ${r.notes}`);
      }
      return bad.length ? fail(bad.join(' | ')) : pass('All refused: ' + paths.join(', '));
    },
  },
];

export function ruleFor(row) {
  return RULES.find(r => r.match(row)) || null;
}

/** Sidebar check derived from the same sheet: pages the role must open vs pages it must not. */
export async function checkSidebar(ctx, rows) {
  const links = await sidebarPaths(ctx.page);
  ctx.sidebar = links;
  // Activity Log and My Account live in the header menu, not the sidebar.
  const mustHave = rows.filter(r => VIEW_FNS.has(r.fn) && !['Dashboard', 'Activity Log', 'Profile'].includes(r.module)).map(r => pathOf(r.url));
  // Something missing? Read the whole sidebar once more before calling it a failure:
  // a slow group animation can hide a link from the first pass.
  if (mustHave.some(p => !links.has(p))) for (const p of await sidebarPaths(ctx.page)) links.add(p);
  const mustNot = rows.filter(r => r.fn === 'Blocked: menu hidden + direct URL' || r.fn === 'Unused page must not open').map(r => pathOf(r.url));
  const missing = [...new Set(mustHave.filter(p => !links.has(p)))];
  const extra = [...new Set(mustNot.filter(p => links.has(p)))];
  if (!links.size) return fail('No sidebar links found (layout changed? see src/app.js sidebarPaths).');
  if (!missing.length && !extra.length) return pass(`${links.size} sidebar links; every allowed page present, no blocked page linked.`);
  return fail([missing.length && 'Missing: ' + missing.join(', '), extra.length && 'Should be hidden: ' + extra.join(', ')].filter(Boolean).join(' | '));
}
