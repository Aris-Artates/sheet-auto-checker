import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Always read the .env next to the project, wherever the tool is started from.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: true });

// An empty line in .env ("KEY=") counts as not set, so the default applies.
const env = (k, d = '') => (process.env[k] || d).trim();
const bool = k => /^(1|true|yes|on)$/i.test(env(k));
const stripSlash = u => u.replace(/\/+$/, '');

export const config = {
  webappUrl: env('SHEET_WEBAPP_URL'),
  token: env('SHEET_TOKEN'),
  sheetUrl: env('SHEET_URL'),
  checker: env('CHECKER_NAME', 'QA Bot'),
  settleMs: Number(env('SETTLE_MS', '3000')),
  pageTimeoutMs: Number(env('PAGE_TIMEOUT_MS', '30000')),
  // Base URLs of the two deployments. The sheet's links only supply the PATH; the host
  // always comes from here, so no environment address lives in the code or the repo.
  urls: { vercel: stripSlash(env('APP_URL_VERCEL')), dotnet: stripSlash(env('APP_URL_DOTNET')) },
  data: {
    employeeEid: env('QA_EMPLOYEE_EID'),
    // Optional: a second test employee, for the "Applicable To another employee" edit rows.
    employeeEid2: env('QA_EMPLOYEE_EID_2'),
    filesDir: path.resolve(ROOT, env('QA_FILES_DIR', 'test-files')),
    allowDotnet: bool('ALLOW_DATA_ON_DOTNET'),
    risky: bool('ALLOW_RISKY_PAGES'),
  },
};

export const ENVS = { vercel: { label: 'Vercel', col: 'vercel' }, dotnet: { label: '.NET', col: 'dotnet' } };

/** Rebuild a sheet link on the configured host for `envKey`; null when that host is not set. */
export function rebase(link, envKey) {
  const base = config.urls[envKey];
  if (!base || !link) return null;
  let u;
  try { u = new URL(link); } catch (_) { u = new URL(link, 'https://placeholder.invalid'); }
  return base + u.pathname + u.search;
}

/** "TC - payroll_officer" -> "PAYROLL_OFFICER", "TC - Invalid Roles" -> "INVALID_ROLES" */
export function roleKey(sheetName) {
  return sheetName.replace(/^TC - /, '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/** { username, password } for a TC sheet, or null when .env has no account for it. */
export function accountFor(sheetName) {
  const raw = env('ACCOUNT_' + roleKey(sheetName));
  const i = raw.indexOf(':');
  if (i < 1) return null;
  return { username: raw.slice(0, i), password: raw.slice(i + 1) };
}

/** Roles whose accounts must be refused at login; their pages are tested logged-out. */
export const isRefusedRole = sheetName => /^TC - (Invalid Roles|No Roles)$/.test(sheetName);
