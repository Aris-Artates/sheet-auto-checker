# Sheet Auto Checker (QA Runner)

Runs the QA team's test sheet automatically in a real browser and writes the results back
into the sheet's **Check Log**, the same way a tester would. No AI is involved when it runs:
every check is a fixed rule.

- **Role access tests** (read-only): logs in as each role and checks every page opens, or is
  blocked, exactly as the sheet expects. Also checks the sidebar, logout, the dashboard
  selector, leftover pages and API bypass attempts.
- **Data tests**: fills the add forms with each data option from the sheet, saves, finds the
  record in its list and deletes it again. Records go to one test employee only.
- **Retest** failed or passed tests from the sheet's latest results, and a **summary** of
  pass / fail per sheet and module.
- A Windows notification pops up when a run finishes.

Nothing sensitive is in this repository. Every address, link, token and account lives in a
local `.env` file that git ignores.

## Quick start (Windows)

1. Install **Node.js LTS** from https://nodejs.org (once).
2. Double-click **`QA Runner.bat`**. The first start installs everything it needs
   (a few minutes, including a ~150 MB test browser), then opens the UI in your browser.
3. Open the **Settings** tab and fill in the values from your QA lead, or paste a whole
   `.env` they sent you in **Copy / paste**. Click **Save**.
4. Read the **How to use** tab.

Keep the black launcher window open while you use the tool; closing it stops the tool.
The UI only listens on this computer (`127.0.0.1`); nobody else on the network can open it.

## The UI

| Tab | What it does |
|---|---|
| Run tests | Pick roles, modules and environment, then run the role access tests with a live log |
| Retest | Load the sheet's latest results and re-run all **failed**, **passed** or **blocked** tests |
| Results summary | Pass / fail / blocked / not started per sheet or module; click a row for its failures |
| Data tests | Create-and-delete tests per page group, with a confirmation before anything is written |
| Settings (.env) | Edit settings as a form, add a variable, or copy / paste the whole file |
| How to use | Step-by-step guide |

Every tab also shows the equivalent terminal command (`npm run qa -- ...`, `npm run qa:dp -- ...`).

## Safety rules for data tests

- Test data is written to the **Vercel (dev)** deployment only.
- Writing on **.NET (main)** is locked. It needs `ALLOW_DATA_ON_DOTNET=true` in `.env`, and
  every run then shows a red warning and asks you to type `DOTNET`.
- Page groups that can affect everyone (rates, gov tables, payments, users, settings) are off
  unless `ALLOW_RISKY_PAGES=true`.
- While either of those is unlocked, the UI switches to **Evil QA Runner** (red theme) so it
  cannot be missed.
- Every run lists the pages and the test employee and asks for confirmation first.
- Every record's description starts with `QA-AUTO` and is deleted after its check;
  **Clean up leftovers** removes any that an interrupted run left behind.

## Status of the data tests

| Page group | Automated |
|---|---|
| Payroll Deductions (17 pages) | Yes, not yet verified on a live run |
| Payroll Additions (3 pages) | Yes, not yet verified on a live run |
| Benefits (6 pages) | Yes, not yet verified on a live run |
| Boom Truck, Longevity, SSS / PhilHealth / HDMF contributions | Not yet |
| Employees + master data | Not yet |
| Rates + Gov tables (risky) | Not yet |
| Payments, Leave, Users, Officers, Settings (risky) | Not yet |

Data-test results currently check save, list and delete; they are marked `PARTIAL` until the
payroll cutoff / payslip checks are added.

## Connecting the sheet (one time, by the sheet owner)

1. In the sheet: **Extensions > Apps Script**, add a file and paste `apps-script/QaRunnerApi.gs`.
2. **Project Settings > Script Properties**: add `QA_TOKEN` = a long random string
   (the same value goes in `.env` as `SHEET_TOKEN`).
3. **Deploy > New deployment > Web app**, Execute as **Me**, Who has access **Anyone**.
   Copy the Web app URL into `.env` as `SHEET_WEBAPP_URL`. "Anyone" only means the URL works
   without a Google sign-in; every request still needs the token.
4. After changing the script: **Deploy > Manage deployments > Edit > New version**.
5. Add the checker name (default `QA Bot`) to the sheet's **Team** tab.

## Project layout

| Path | What |
|---|---|
| `QA Runner.bat` | Launcher |
| `src/ui/` | Local UI server and page |
| `src/run.js` | Role access tests |
| `src/run-dp.js`, `src/dp.js` | Data tests |
| `src/app.js` | Everything the tests know about the app's screens |
| `src/rules.js` | Which sheet rows map to which check |
| `apps-script/` | Google Apps Script for the sheet |
| `test-files/` | Sample upload files (large ones are generated locally) |
| `results/` | Run logs, CSVs and screenshots (git-ignored) |
