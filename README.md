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
| Data tests | Create-and-delete tests per page group (or one page picked from the list), with a confirmation before anything is written |
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

All groups are automated; none has been verified on a live run yet.

| Page group | Automated | Notes |
|---|---|---|
| Payroll Deductions (17 pages) | "Add" rows | test employee only |
| Payroll Additions (3 pages) | "Add" rows | test employee only |
| Benefits (6 pages) | "Add" rows | test employee only |
| Boom Truck, Longevity, SSS / PhilHealth / HDMF contributions | Yes | contribution "Compensation" boxes are not wired to the save (reported as a known bug) |
| Employees + master data | Yes (gov-ID / email / social-link rows stay manual) | creates and deletes throw-away `QA-AUTO...` / `QAAUTO...` records |
| Computed pages (OT, Holiday, Night Shift, Absences, WTax Due) | Edit locks only | read-only: checks there is no edit |
| Rates + Gov tables (risky) | Yes | gov tables dated Dec 2030 so they are never active today; salary-rate conflicts are cancelled, never proceeded |
| Payments, Leave, Users, Officers (risky) | Yes, partly | see below |

**Left manual on purpose** (the tool cannot undo them):
- Leave monetization, tardiness charged, undertime/absence charged: the app has no delete for these.
- Payroll Settings: saving rewrites everyone's settings and there is no undo.
- Payroll and leave approval requests: they act on real payroll cutoffs / wait on the leave-decision endpoint.

**Known app bugs the tests report as Fail:** Approving Officers "Save Changes" and Bank Payment
"Generate" send nothing to the server; the Payment Processor "Employee Accounts" form can't be opened.

Data-test results check save, list and delete; they are marked `PARTIAL` until the payroll
cutoff / payslip checks are added.

## Edit tests (ticket 2161)

`src/edit-catalog/` holds every "Edit: ..." test case: each page's frequency switches
(15th <-> end of month, One Time <-> Regular <-> Installment, Indefinite <-> an end date), one
extra letter in each text field, cleared required fields, attachment swaps, editing a record into
a copy of another one, and the pages / roles that must **block** an edit (protected gov tables,
locked names and taxable flags, view-only roles, pages with no edit at all). Each row's Expected
Result says what the app should do; a `Known gap:` note says where it does something else today.

**Adding the rows to the sheet** (once, by the sheet owner):

1. `npm run make-edit-rows` writes `apps-script/AddEditRows.gs` from the catalog.
2. In the sheet: **Extensions > Apps Script**, add a file, paste it, and run `addEditRows()`.
   It appends the rows to each DP tab with the next TC IDs (DPPD-0559...). Running it again
   only adds rows whose Page + Scenario are not in the tab yet.

**What the runner does with them:**

| Rows | Automated |
|---|---|
| Deductions, Additions, Benefits (the shared V2 form) | Yes: create a QA-AUTO record, edit it, save, reopen it and check the change stuck, delete it. Switching to All Employees / a branch / a department stays manual (Blocked): it would write to other employees. |
| Department, Branch, Employment Type, Pay Group | Yes (renames, duplicates, blanks, no-changes) |
| Pages with no edit, protected gov tables, view-only roles | Yes, read-only |
| Boom Truck, Longevity, contributions, rates, gov-table data, employees, payments, leave, users, approvals | Not yet: the rows are in the sheet for manual testing |

Optional settings: `QA_EMPLOYEE_EID_2` (a second test employee, for "Applicable To another
employee"), `ACCOUNT_PAYROLL_MGMT` and `ACCOUNT_EMPLOYEE` (the view-only / access-denied checks).

## Payroll Summary check (ticket 2168)

`npm run qa:summary -- --period 2026-10-16..2026-10-31` (or the **Payroll Summary check** tab) is a
read-only audit: for one cutoff it reads every record on 27 source pages (all deductions and loans,
Other Addition, Refunds, Salary Adjustment, Longevity Pay, the 6 benefits) through the app's own
API, works out which records are due that cutoff, and checks the Payroll Summary shows each one:

- the right amount for every employee on the record when it is due (One Time on its date, Regular on
  its 15th / end of month, Installment = its schedule rows in the cutoff);
- 0 for everyone not on the record, and 0 in cutoffs where it is not due.

Problems go to `results/summary-<time>/findings.csv` (record, employee, expected vs summary
amount, why); `--dump` also saves the raw data. Rules: `src/summary-check/rules.js`, tested offline
by `npm run test:summary-check`.

Not checked (yet): benefits not shown on the payslip (the summary has no per-record entry for
them, only a taxable total), the exact amount of Semi-Monthly regular records (only "more than 0"),
Longevity Pay amounts (computed from years of service), and pages computed from attendance or
tables: SSS / PhilHealth / HDMF contributions, overtime, holiday, night shift, boom truck,
absences and withholding tax.

## Picking tests by ID

`--only` (both runners, and the Data tests tab) takes single IDs and ranges in sheet order:
`DPPD-0559..DPPD-0600` (inclusive), `DPB-0241..` (to the end of that tab), `..DPB-0020`
(from the start). Separate several with commas. In the UI: **Load test IDs**, click a row to
start a range, click another to end it; leave it open to run to the end of the tab.

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
