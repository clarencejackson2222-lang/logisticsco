# Jackson CommandOS

Jackson CommandOS is the operations control center prototype for Jackson Logistics. It is designed to connect transportation, safety, SOPs, fleet, drivers, finance, people, warehousing, and future maintenance operations in one system.

## Run Locally

The prototype has no external dependency installation. Node.js 20 or newer is required for the local API server.

```bash
npm start
```

Open `http://localhost:4173/index.html` in a browser.

Run the automated API checks with:

```bash
npm test
```

The tests use a temporary SQLite database and cover finance, billing/reconciliation, fleet profiles, trip estimates, DVIRs, advisor insights, readiness tracking, performance scorecards, role restrictions, audit history, and notifications.

The server also exposes the first shared-data API surface:

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/audit` (Owner/Admin only)
- `GET /api/users` (Owner/Admin only)
- `PATCH /api/users/:id` (Owner/Admin only)
- `GET /api/fleet`
- `PATCH /api/fleet/:unit` (Owner/Admin or Maintenance)
- `GET /api/sops`
- `POST /api/sops/:code/acknowledge`
- `GET /api/finance` (Owner/Admin or Accounting)
- `GET /api/warehouses` (Owner/Admin, Warehouse, or Dispatcher)
- `GET /api/documents`
- `POST /api/documents`
- `GET /api/notifications`
- `GET /api/loads`
- `PATCH /api/loads/:id`
- `GET /api/incidents`
- `POST /api/incidents`

Data is stored in `data/commandos.sqlite` for local development. The SQLite file is ignored by Git and should be backed up and migrated to a managed production database before deployment.

### Local Development Login

The local server includes one development owner account:

```text
Email: owner@jackson.local
Password: commandos-demo
```

Additional development roles:

```text
Dispatcher: dispatch@jackson.local / dispatch-demo
Safety:     safety@jackson.local / safety-demo
HR:         hr@jackson.local / hr-demo
```

Owner/Admin and Dispatcher can create incidents and update loads. Safety can create incidents and read shared data. Owner/Admin can view the audit feed at `/api/audit` and manage users in the Users workspace. Passwords are salted and hashed in SQLite. These development accounts are not production authentication; production still needs a proper identity provider, session rotation, rate limits, and account recovery.

## Current Prototype

The single-page CommandOS cockpit currently includes:

- Operations dashboard with fleet, revenue, delivery, and exception metrics
- Persistent incident reporting using browser `localStorage`
- Searchable SOP Center with Standard and Extreme procedure filters
- Load Board with search, status filters, delivery updates, and assignment state
- Fleet and Driver workspace with qualification and maintenance visibility
- Finance ledger, budgets, reserve estimates, load profitability, and cash forecast
- Customer/vendor profiles, receivables/payables, invoice generation, and reconciliation flags
- Equipment profiles, estimate-only trip planning, and digital DVIR records
- Rules-based business advisor, readiness checklist, and HR-restricted weighted scorecards
- People and Warehousing management workspaces
- Responsive layouts for desktop and mobile screens

## Important Limitation

The existing browser workflows still use `localStorage` when the app is opened without the server. When running through `npm start`, loads and incidents use the shared SQLite API store.

## Production Direction

The next application phase should introduce:

1. A real frontend application structure with reusable views and components.
2. A backend API and relational database for users, roles, loads, units, drivers, incidents, SOPs, documents, and facilities.
3. Authentication and role-based access for owners, dispatchers, drivers, safety, maintenance, accounting, HR, and warehouse teams.
4. Audit history for status changes, incident actions, SOP versions, and sensitive records.
5. Secure document storage for BOLs, PODs, rate confirmations, insurance, driver files, and maintenance records.
6. Notifications and escalation workflows for late loads, safety incidents, expiring credentials, and maintenance exposure.

## Suggested Domain Model

```text
Organization
	├── Users and Roles
	├── Employees / Drivers
	├── Vehicles / Trailers
	├── Loads / Stops / Documents
	├── Incidents / Actions / Escalations
	├── SOPs / Versions / Acknowledgments
	├── Customers / Brokers / Vendors
	├── Facilities / Appointments / Inventory
	└── Financial Transactions / Invoices / Payments
```

The prototype intentionally keeps these concerns visible in one cockpit. Production implementation should separate them behind stable APIs while preserving the same operating workflows.

## Finance Workspace

The Finance workspace stores income and expense records in SQLite and is available to Owner / Admin and Accounting users. Amounts are sent to the API as integer cents. Records include a category, counterparty, payment date, paid/scheduled state, optional load reference, and optional mileage. Income entries can include fuel cost and driver pay per mile; expenses can be flagged as tax deductible. Paid deductible expenses are totaled for bookkeeping review, but the application does not determine tax eligibility or provide tax advice.

Load profit is estimated as income minus fuel and driver-pay mileage costs and separately entered expenses with the same load reference. Avoid entering the same fuel or driver pay both as a per-mile rate and as another expense. Cost per mile is calculated from recorded direct expenses and per-mile costs divided by miles entered on income records. Category budgets compare their cap against paid expenses for the current month.

The rolling forecast covers 13 weeks. It starts from the current business cash snapshot entered in Finance and applies scheduled future income and expenses, per-mile load costs, and the configured tax, insurance, maintenance, and scaling reserve percentages to positive weekly margin. Refresh the snapshot manually as real payments clear. The remaining profit allocation stays in projected cash. A warning appears when projected cash falls below the configured weekly cash floor. It is an estimate based only on entered records, not a bank balance or guaranteed weekly cash amount. Allocation proposals can be approved and simulated locally; they do not call a bank or payment provider. Tax reserves are estimates, not tax advice.

Finance API endpoints (all require authentication and Owner / Admin or Accounting access):

- `GET /api/finance/entries` and `POST /api/finance/entries` — read or create income and expense records.
- `PATCH /api/finance/entries/:id` — update a record's paid/scheduled state or payment date.
- `GET /api/finance/summary` — current totals, deductible spending, cost per mile, load profit, allocations, and budget progress.
- `GET /api/finance/forecast` — 13-week estimate and weekly cash-floor flags.
- `GET /api/finance/settings` and `PATCH /api/finance/settings` — current cash, weekly floor, and reserve percentages. Percentages must total 100%.
- `GET /api/finance/budgets` and `PUT /api/finance/budgets/:category` — monthly category budgets.
- `GET /api/finance/allocations` and `POST /api/finance/allocations` — list or create paid-margin allocation proposals mapped to configured tax, insurance, maintenance, savings, and cash accounts.
- `PATCH /api/finance/allocations/:id` — Owner/Admin approval or cancellation of a proposal. Approval is recorded and audited but does not move money yet.
- `POST /api/finance/allocations/:id/execute` — Owner/Admin-only simulated execution using an idempotency key. It updates local cash-account balances atomically, protects the configured cash floor, and safely replays the same result on retry. It does not call a bank or payment provider.
- `GET /api/finance/counterparties` and `POST /api/finance/counterparties` — customer, broker, and vendor contact profiles.
- `GET /api/finance/invoices` and `POST /api/finance/invoices` — receivable invoices and payable bills.
- `POST /api/finance/invoices/from-load/:id` — create a single open receivable from a delivered load and its customer.
- `POST /api/finance/invoices/:id/payments` — record a partial or final payment with date, reference, and notes. The invoice closes only when cumulative payments equal the invoice total.
- `PATCH /api/finance/invoices/:id` — record invoice status and payment reference. Receivables require a reference note before they can be marked paid.
- `GET /api/finance/collections/tasks`, `POST /api/finance/collections/tasks`, and `PATCH /api/finance/collections/tasks/:id` — create and complete auditable collection follow-up tasks linked to invoices.
- `GET /api/finance/reconciliation` — match suggestions and review findings; it never marks a record paid or reconciled.

Reconciliation compares invoice kind, counterparty, amount, optional load reference, and payment state with ledger entries. It reports `matched`, `status_conflict`, `duplicate_matches`, `mismatch`, or `missing_payment`. Suggestions do not modify either record. Bank transfers, accounting imports, invoice/document extraction, receipt uploads, ELD and dash-cam feeds, and mapping are not connected. Add records manually; review and confirm their status yourself.

Counterparty and invoice records are available only to Owner / Admin and Accounting users. Delivered-load invoice generation uses the load's saved customer and revenue, creates a minimal customer profile if needed, and applies that profile's payment terms (30 days for an automatically created profile). Add contact details before relying on collection reminders.

## Fleet, Trips, and DVIR

Fleet profiles let authorized users set equipment type (semi tractor, dry van, box truck, reefer, flatbed, tanker, or other), assigned driver, truck model, MPG, tank size, current fuel, and driver-entered remaining hours. `PATCH /api/fleet/:unit` updates these fields; Owner / Admin, Dispatcher, and Maintenance roles may update profiles.

`GET /api/fleet/drivers`, `POST /api/fleet/drivers`, and `PATCH /api/fleet/drivers/:id` manage normalized driver profiles with CDL class, endorsements, preferred equipment, availability, medical-expiry date, and notes. Legacy fleet records can continue carrying an embedded driver name while profiles are introduced and matched through the dispatch workflow.

`POST /api/fleet/assignments` matches a load to a compatible unit and records an assignment with an explainable match score. Active assignments cannot reuse the same unit or load. `PATCH /api/fleet/assignments/:id` advances the workflow through states such as `dispatched`, `accepted`, `in_progress`, `completed`, `cancelled`, or `rejected`; terminal states cannot be changed. `GET /api/fleet/assignments` lists assignments and `GET /api/fleet/assignments/:id/history` returns the auditable status history. These controls prevent conflicting dispatch records, but they do not replace dispatcher confirmation or verified ELD data.

`POST /api/fleet/trips` saves an estimate using entered route miles, average speed, fuel onboard, MPG, tank capacity, and remaining hours. It estimates refueling windows using a 20% tank reserve and suggests one overnight stop when estimated driving time exceeds the entered hours. Plans start as `draft`; `PATCH /api/fleet/trips/:id` lets an authorized dispatcher or owner confirm, start, complete, or cancel a plan. `GET /api/fleet/trips/:id/stops` lists materialized origin, fuel, rest, and destination stops, and `PATCH /api/fleet/trips/:id/stops/:stopId` records `en_route`, `arrived`, `completed`, or `skipped` progress. There is no map, traffic, truck restriction, fuel-station, safe-parking, or ELD integration. Estimates do not validate FMCSA Hours of Service or a legal/safe route; verify before dispatch.

`POST /api/fleet/:unit/dvir` records pre-trip or post-trip checks for brakes, tires, lights, steering, coupling, visibility, emergency equipment, and leaks/fluids. Failed checks set the unit's maintenance-due flag and create an auditable `Needs repair` record. Owner / Admin or Maintenance may close a defect as `Repair complete`; doing so does not clear other unit maintenance flags. `GET /api/fleet/dvir` returns inspection history. The checklist is a recordkeeping aid, not a substitute for required inspection procedures or a provider-certified DVIR system.

`POST /api/fleet/eld/logs` records normalized duty-status intervals with driving and on-duty hours. `GET /api/fleet/eld/logs` returns the log history and `GET /api/fleet/eld/status` reports the latest record and stale-data state for each unit. Records identify themselves as `simulated`, `imported`, or `verified`; no ELD vendor is connected yet, so these records must not be treated as legal HOS certification.

`POST /api/fleet/cameras/events` records dash-cam event metadata and an external clip reference without storing video in SQLite. `GET /api/fleet/cameras/events` lists events and `PATCH /api/fleet/cameras/events/:id` supports `reviewed`, `escalated`, or `dismissed` safety review states. A real provider adapter, signed clip delivery, object storage, retention policy, and redaction workflow are still required for production video evidence.

## Advisor and Readiness

`GET /api/advisor` is Owner / Admin-only rules-based decision support. It surfaces cash-floor risks, past-due receivables, at-risk loads, and maintenance follow-up, with the source invoice, load, vehicle, or forecast week listed for each signal. `GET /api/advisor/actions`, `POST /api/advisor/actions`, and `PATCH /api/advisor/actions/:id` provide a human-owned action queue with source IDs, due dates, outcomes, and audit history. The advisor is not generative AI and does not include live ELD, bank, map, or camera data; it never takes operational action on its own. Debt-to-income is explicitly unavailable until debt records exist.

`GET /api/readiness` returns the startup and compliance follow-up checklist. `PATCH /api/readiness/:id` updates status, due date, and notes; only Owner / Admin and Safety may edit it. The checklist tracks items such as entity registration, EIN, authority, insurance, permits, drug/alcohol program, Clearinghouse, inspections, SCAC, load platforms, website/email, and SOPs. It is not a compliance determination. Verify obligations and dates with the relevant authority or qualified professional, and do not put sensitive identifiers in notes.

## Performance Scorecards

The Performance workspace is restricted to Owner / Admin and HR (`GET` and `POST /api/people/scorecards`; `PATCH /api/people/scorecards/:id`). It computes a draft score using the visible weights: quantitative KPIs 40%, strategic goals 30%, qualitative feedback 20%, and reliability/growth 10%. The resulting bands follow the configured thresholds: A/A+ 90–100, B/B+ 80–89, C/C+ 70–79, D 60–69, and F below 60. Each draft requires evidence notes and is auditable when reviewed.

Scores are decision support only. They do not automatically make hiring, termination, promotion, pay, or disciplinary decisions. Managers/HR must review the underlying evidence and follow company policy and applicable law. Intern-potential and mentor classifications are not inferred from this score because their required evidence is not captured.

## Documents and Analytics

`POST /api/documents` accepts optional base64 attachments up to 512 KB. Only signature-verified PDF, PNG, and JPEG files are stored; attachments are held as SQLite BLOBs in this local prototype. `GET /api/documents/:id/file` downloads an attachment after document-type authorization. Document listings, uploads, and downloads follow least-privilege type rules: for example, HR can view driver files but not receipts, Accounting can access freight/finance documents, and Maintenance can access maintenance/DVIR documents. Downloads are audited. This is not a production file vault; production should use managed encrypted object storage, malware scanning, retention controls, and per-driver access rules.

The Document Center's print studio provides service brochure, rate-sheet, driver-handbook, and recruitment-flyer layouts from user-entered content. It opens a print-ready browser page; use the browser's Print / Save as PDF command. Templates are not legal-reviewed documents, fillable PDFs, or publishing-quality graphic files. Verify all company claims, rates, policies, and contact information before distribution.

The Advisor also reports customer/lane known-profit groups, active-load assignment rate, manual HOS warnings, and per-driver fuel cost per mile when source entries exist. Costs not entered are not inferred; groups expose a cost-coverage count and may overstate profit. Dispatcher-specific ratios, verified MPG, dwell time, debt-to-income, and live fleet/provider analytics remain unavailable until those source records or integrations are added.