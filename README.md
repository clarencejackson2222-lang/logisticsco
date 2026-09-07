# Jackson CommandOS

Jackson CommandOS is the operations control center prototype for Jackson Logistics. It is designed to connect transportation, safety, SOPs, fleet, drivers, finance, people, warehousing, and future maintenance operations in one system.

## Run Locally

The prototype has no external dependency installation. Node.js 20 or newer is required for the local API server.

```bash
npm start
```

Open `http://localhost:4173/index.html` in a browser.

The server also exposes the first shared-data API surface:

- `GET /api/health`
- `GET /api/auth/me`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/audit` (Owner/Admin only)
- `GET /api/users` (Owner/Admin only)
- `PATCH /api/users/:id` (Owner/Admin only)
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
```

Owner/Admin and Dispatcher can create incidents and update loads. Safety can create incidents and read shared data. Owner/Admin can view the audit feed at `/api/audit` and manage users in the Users workspace. Passwords are salted and hashed in SQLite. These development accounts are not production authentication; production still needs a proper identity provider, session rotation, rate limits, and account recovery.

## Current Prototype

The single-page CommandOS cockpit currently includes:

- Operations dashboard with fleet, revenue, delivery, and exception metrics
- Persistent incident reporting using browser `localStorage`
- Searchable SOP Center with Standard and Extreme procedure filters
- Load Board with search, status filters, delivery updates, and assignment state
- Fleet and Driver workspace with qualification and maintenance visibility
- Finance, People, and Warehousing management workspaces
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