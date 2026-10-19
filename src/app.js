/**
 * Everything the runner knows about the LEYECO payroll app's screens.
 * If the UI changes, this is the only file that should need edits.
 */
import { config } from './config.js';

const DENIED_TEXT = /Access Denied|Not in your subscription/i;
const NOT_FOUND_TEXT = /This page could not be found|404/i;
const CRASH_TEXT = /Application error|Unhandled Runtime Error|Internal Server Error/i;
const LOGIN_USER = 'input[placeholder="Enter your username"]';
const LOGIN_PASS = 'input[placeholder="Enter your password"]';
const PRELOADER = '.animate-spin-reverse';
// Buttons/links that create, change or remove data. Matched on their visible text.
const WRITE_TEXT = /^\s*(\+\s*)?(add|add new|create|new|edit|update|delete|remove|save|print)\b/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const origin = url => new URL(url).origin;
export const pathOf = url => new URL(url).pathname.replace(/\/+$/, '') || '/';

/**
 * Wait until the app's full-screen loading splash (PreLoader) and any skeleton placeholders
 * are gone, so a screenshot shows the page, not the spinner. Gives up after `maxMs`.
 */
export async function waitForSplash(page, maxMs = 15000) {
  const deadline = Date.now() + maxMs;
  let clearSince = 0;
  while (Date.now() < deadline) {
    const busy = await page.evaluate(sel => {
      const visible = el => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
      return [...document.querySelectorAll(sel)].some(visible);
    }, `${PRELOADER}, .animate-pulse`).catch(() => false);
    if (busy) clearSince = 0;
    else if ((clearSince ||= Date.now()) && Date.now() - clearSince > 600) return true;
    await sleep(200);
  }
  return false;
}

/** Log in through the real form (same fields as the bookmarklet). Returns { ok, message }. */
export async function login(page, baseUrl, account) {
  await page.goto(origin(baseUrl) + '/', { waitUntil: 'load', timeout: config.pageTimeoutMs });
  // The form is React-controlled: text typed before the page's scripts finish loading is
  // dropped and an empty form is submitted. Wait for the page to go quiet first.
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.locator(LOGIN_USER).waitFor({ timeout: config.pageTimeoutMs });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.fill(LOGIN_USER, account.username);
    await page.fill(LOGIN_PASS, account.password);
    await sleep(300);
    if ((await page.inputValue(LOGIN_USER)) === account.username) break;
    await sleep(1000);
  }
  const answer = page.waitForResponse(r => r.url().includes('/api/request/login'), { timeout: config.pageTimeoutMs }).catch(() => null);
  await page.click('button[type="submit"]');
  const resp = await answer;
  if (!resp) return { ok: false, message: 'Submit did not send a login request (form not ready?). Still on ' + pathOf(page.url()) };
  const body = await resp.json().catch(() => ({}));
  if (body.status !== 200) {
    const said = String(body.message || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    // Username and password LENGTH only, so a bad .env line is easy to spot without printing the password.
    const sent = `sent username "${account.username}", password of ${account.password.length} characters`;
    return { ok: false, message: `Login refused: HTTP ${resp.status()} - ${said} (${sent})` };
  }
  try {
    await page.waitForURL(u => pathOf(u.toString()) !== '/', { timeout: config.pageTimeoutMs });
  } catch (_) {
    return { ok: false, message: 'Login accepted by the server but the app stayed on /' };
  }
  return { ok: true, message: 'Logged in; landed on ' + pathOf(page.url()) };
}

export async function logout(page) {
  await page.click('[aria-label="User menu"]', { timeout: 10000 });
  await page.getByText('Sign Out', { exact: true }).click({ timeout: 10000 });
  await page.waitForURL(u => pathOf(u.toString()) === '/', { timeout: config.pageTimeoutMs });
}

/**
 * Open a URL and decide what the user actually got:
 *   allowed | denied | notfound | crashed | logged-out
 * "allowed" means the page finished loading and stayed free of the Access Denied card for SETTLE_MS.
 */
export async function open(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }).catch(e => ({ error: e }));
  if (resp?.error) return { state: 'crashed', detail: 'Navigation failed: ' + resp.error.message.split('\n')[0] };
  if (resp && resp.status() === 404) return { state: 'notfound', detail: 'HTTP 404' };
  const deadline = Date.now() + config.pageTimeoutMs;
  let quietSince = 0;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (DENIED_TEXT.test(body)) return { state: 'denied', detail: 'Access Denied card shown' };
    if (await page.locator(LOGIN_USER).isVisible().catch(() => false)) return { state: 'logged-out', detail: 'Login form shown (' + pathOf(page.url()) + ')' };
    if (CRASH_TEXT.test(body)) return { state: 'crashed', detail: 'Error page: ' + (body.match(CRASH_TEXT) || [''])[0] };
    if (NOT_FOUND_TEXT.test(body) && body.length < 400) return { state: 'notfound', detail: 'Not-found page' };
    const busy = await page.locator(PRELOADER).first().isVisible().catch(() => false);
    if (busy) { quietSince = 0; } else {
      quietSince ||= Date.now();
      if (Date.now() - quietSince >= config.settleMs) {
        const moved = pathOf(page.url()) !== pathOf(url);
        return { state: 'allowed', detail: moved ? 'Loaded, but ended on ' + pathOf(page.url()) : 'Page loaded', moved };
      }
    }
    await sleep(250);
  }
  return { state: 'crashed', detail: 'Still loading after ' + config.pageTimeoutMs / 1000 + 's' };
}

/**
 * Every link path in the sidebar, including links inside collapsed groups.
 * The sidebar is an accordion that only renders the OPEN group's links, so each
 * group trigger is opened in turn and its links collected.
 */
export async function sidebarPaths(page) {
  const norm = h => h.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const found = new Set();
  const collect = async () => {
    const hrefs = await page.locator('nav:visible a[href]').evaluateAll(as => as.map(a => a.getAttribute('href')));
    for (const h of hrefs) if (h && h.startsWith('/')) found.add(norm(h));
    return hrefs.length;
  };
  // A group's links appear while it animates open: read until the count stops changing.
  const collectSettled = async () => {
    let prev = -1;
    for (let i = 0; i < 10; i++) {
      const n = await collect();
      if (n === prev) return;
      prev = n;
      await sleep(250);
    }
  };
  await collectSettled();
  const triggers = page.locator('nav:visible button[aria-expanded]');
  const n = await triggers.count();
  for (let i = 0; i < n; i++) {
    const t = triggers.nth(i);
    if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click({ timeout: 5000 }).catch(() => {});
    await collectSettled();
  }
  return found;
}

export async function hasDashboardSelector(page) {
  return page.locator('[aria-label="Dashboard view"]').first().isVisible().catch(() => false);
}

/** Visible, enabled buttons/links in the page body (not header/sidebar) whose text means "write". */
export async function writeControls(page) {
  return page.evaluate(src => {
    const re = new RegExp(src, 'i');
    const inChrome = el => el.closest('nav, aside, header, [role="dialog"]');
    return [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(el => !inChrome(el) && el.offsetParent !== null && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
      .map(el => (el.innerText || el.getAttribute('aria-label') || '').trim())
      .filter(t => t && t.length < 40 && re.test(t));
  }, WRITE_TEXT.source);
}

/**
 * Call the app's own API from inside the page, like a curious user in DevTools would.
 * `refused` is true when the app said no in any of its shapes: an HTTP error, the
 * {"redirect":true} answer it gives a missing session (HTTP 200!), or {"error":true}.
 */
export async function apiStatus(page, path) {
  return page.evaluate(async p => {
    try {
      const r = await fetch(p, { credentials: 'include' });
      const text = await r.text();
      let rows = null, said = '';
      try {
        const j = JSON.parse(text); const d = j?.data ?? j;
        rows = Array.isArray(d) ? d.length : (Array.isArray(d?.data) ? d.data.length : null);
        if (j?.redirect) said = 'redirect to login';
        else if (j?.error === true || j?.status === false || j?.success === false) said = j.message || 'error';
      } catch (_) { said = text.slice(0, 60); }
      const refused = r.status >= 400 || (!!said && !rows);
      return { status: r.status, rows, refused, said };
    } catch (e) { return { status: 0, rows: null, refused: false, said: String(e) }; }
  }, path);
}

export const describeApi = a => `HTTP ${a.status}${a.said ? ` (${a.said})` : ''}${a.rows != null ? `, ${a.rows} rows` : ''}`;
