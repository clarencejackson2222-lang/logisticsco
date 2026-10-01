const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const dataDirectory = path.join(root, 'data');
const databaseFile = process.env.COMMANDOS_DATABASE || path.join(dataDirectory, 'commandos.sqlite');
const sessions = new Map();
const defaultUsers = [
  { id: 'USR-001', name: 'Clarence Jackson', email: process.env.COMMANDOS_ADMIN_EMAIL || 'owner@jackson.local', password: process.env.COMMANDOS_ADMIN_PASSWORD || 'commandos-demo', role: 'Owner / Admin' },
  { id: 'USR-002', name: 'Tasha Green', email: 'dispatch@jackson.local', password: 'dispatch-demo', role: 'Dispatcher' },
  { id: 'USR-003', name: 'Renee Hayes', email: 'safety@jackson.local', password: 'safety-demo', role: 'Safety' },
  { id: 'USR-004', name: 'Monica Hayes', email: 'hr@jackson.local', password: 'hr-demo', role: 'HR' }
];
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password, storedHash) { const [salt, key] = storedHash.split(':'); if (!salt || !key) return false; const derived = crypto.scryptSync(password, salt, 64); return crypto.timingSafeEqual(derived, Buffer.from(key, 'hex')); }
const defaultLoads = [
  ['JL-8051', 'Memphis, TN', 'Atlanta, GA', 'Delta Supply Co.', '204', 'M. Turner', '$4,280', 'In transit'],
  ['JL-8042', 'Dallas, TX', 'Little Rock, AR', 'Arkansas Foods', '218', 'A. Brooks', '$3,940', 'At risk'],
  ['JL-8038', 'St. Louis, MO', 'Memphis, TN', 'MidSouth Retail', '197', 'J. Carter', '$2,860', 'In transit'],
  ['JL-8029', 'Atlanta, GA', 'Birmingham, AL', 'Pioneer Materials', '221', 'Unassigned', '$1,920', 'Booked']
];
const defaultFleet = [
  ['204', '...7K42', 'Marcus Turner', 'CDL-A · Current', '2023 Freightliner Cascadia', 'Memphis, TN', 'Clear · 1,240 mi', 0, 'Moving', 'Semi tractor'],
  ['218', '...9P18', 'Andre Brooks', 'CDL-A · Current', '2022 Peterbilt 579', 'Little Rock, AR', 'Due in 180 mi', 1, 'Moving', 'Semi tractor'],
  ['197', '...3M77', 'James Carter', 'CDL-A · Current', '2021 Volvo VNL', 'West Memphis, AR', 'Clear · 2,890 mi', 0, 'Moving', 'Semi tractor'],
  ['221', '...2T64', 'Unassigned', 'No driver', '2024 Kenworth T680', 'Atlanta, GA', 'Clear · 4,120 mi', 0, 'Available', 'Dry van'],
  ['203', '...5B90', 'Renee Hayes', 'CDL-A · Current', '2020 International LT', 'Jackson, TN', 'Inspection due', 1, 'In service', 'Box truck'],
  ['215', '...1D38', 'Darius Wright', 'Medical card renewal', '2022 Freightliner Cascadia', 'Dallas, TX', 'Due in 420 mi', 1, 'In service', 'Reefer']
];
const defaultSops = [
  ['SAF-X01', 'Major truck accident', 'Safety response', 'extreme'],
  ['SAF-X04', 'Vehicle fire response', 'Safety response', 'extreme'],
  ['DSP-014', 'Driver check-in procedure', 'Dispatch', 'standard'],
  ['OPS-011', 'Detention documentation', 'Operations', 'standard'],
  ['SEC-X02', 'Cargo theft response', 'Security', 'extreme'],
  ['DRV-002', 'Pre-trip inspection', 'Drivers', 'standard'],
  ['DSP-012', 'Breakdown dispatch procedure', 'Dispatch', 'standard'],
  ['CMP-X04', 'Out-of-service order', 'Compliance', 'extreme']
];
const defaultFinance = [
  ['FIN-001', 'Load billing · JL-8051', 'Accounting', '$4,280', 'Ready'],
  ['FIN-002', 'Fuel spend · Week 36', 'Operations', '$6,940', 'Review'],
  ['FIN-003', 'Driver payroll · Sep 07', 'Payroll', '$12,480', 'Scheduled'],
  ['FIN-004', 'Broker receivable · 8042', 'Collections', '$3,940', 'Pending']
];
const defaultCashAccounts = [
  ['ACC-001', 'Operating Cash', 'Operating', 'cash', 500000, 150000],
  ['ACC-002', 'Fuel Allocation', 'Fuel', 'fuel', 120000, 35000],
  ['ACC-003', 'Maintenance Buffer', 'Maintenance', 'reserve', 95000, 20000],
  ['ACC-004', 'Insurance Reserve', 'Insurance', 'reserve', 80000, 15000],
  ['ACC-005', 'Payroll Reserve', 'Payroll', 'reserve', 150000, 40000]
];
const defaultWarehouses = [
  ['WH-001', 'Jackson Central', 'Memphis, TN', '82% occupied', 'Operating'],
  ['WH-002', 'Delta Crossdock', 'Little Rock, AR', '64% occupied', 'Operating'],
  ['WH-003', 'South Terminal', 'Atlanta, GA', '88% occupied', 'Watch'],
  ['WH-004', 'New site review', 'Birmingham, AL', 'Planning', 'Pipeline']
];
const defaultDocuments = [
  ['DOC-001', 'Rate confirmation · JL-8051', 'Rate confirmation', 'JL-8051', 'Accounting', 'Ready'],
  ['DOC-002', 'Bill of lading · JL-8042', 'BOL', 'JL-8042', 'Dispatch', 'Needs review'],
  ['DOC-003', 'Proof of delivery · JL-8038', 'POD', 'JL-8038', 'Operations', 'Filed'],
  ['DOC-004', 'Medical card · Darius Wright', 'Driver file', '215', 'Safety', 'Expiring soon'],
  ['DOC-005', 'Annual inspection · Unit 203', 'Maintenance', '203', 'Maintenance', 'Filed']
];
const defaultReadiness = [
  ['entity-registration', 'Legal and financial', 'Register business entity', 'Confirm the LLC or corporation filing and state record.'],
  ['ein', 'Legal and financial', 'Obtain EIN', 'Record the EIN application and confirmation securely outside this checklist.'],
  ['business-bank', 'Legal and financial', 'Separate business banking', 'Confirm a dedicated business checking account and opening balance.'],
  ['business-plan', 'Legal and financial', 'Document operating plan', 'Track startup costs, target freight, and recurring expenses.'],
  ['authority', 'Authority and compliance', 'USDOT and operating authority', 'Record the applicable USDOT and MC authority status and source.'],
  ['boc3-ucr', 'Authority and compliance', 'BOC-3 and UCR', 'Track filings and renewal dates; verify requirements with FMCSA/state sources.'],
  ['insurance', 'Authority and compliance', 'Commercial insurance', 'Track policy documents, coverage, broker requirements, and expiration.'],
  ['permits', 'Authority and compliance', 'IRP, IFTA, permits, and plates', 'Track jurisdictions, account references, and renewal dates.'],
  ['drug-consortium', 'Safety and operations', 'Drug and alcohol program', 'Record consortium enrollment and responsible contact.'],
  ['clearinghouse', 'Safety and operations', 'FMCSA Clearinghouse', 'Record registration and authorized query process.'],
  ['dot-inspection', 'Safety and operations', 'Annual equipment inspection', 'Track inspection date, report, defects, and next due date.'],
  ['scac', 'Safety and operations', 'SCAC code', 'Track application status and assigned code if applicable.'],
  ['load-platforms', 'Operations setup', 'Load boards, factoring, and dispatch', 'Record provider, account owner, payment terms, and support contact.'],
  ['domain-email', 'Business presence', 'Business domain and email', 'Track domain renewal and business email ownership.'],
  ['website', 'Business presence', 'Website and service profile', 'Document equipment types, service lanes, and safety contact.'],
  ['sops-maintenance', 'Operations setup', 'Driver, detention, maintenance, and DVIR procedures', 'Keep current procedures and acknowledgment records together.']
];

fs.mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(databaseFile);
database.exec(`
  CREATE TABLE IF NOT EXISTS loads (
    id TEXT PRIMARY KEY, origin TEXT NOT NULL, destination TEXT NOT NULL, customer TEXT NOT NULL,
    unit TEXT NOT NULL, driver TEXT NOT NULL, revenue TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL, unit TEXT NOT NULL,
    location TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, time TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fleet (
    unit TEXT PRIMARY KEY, vin TEXT NOT NULL, driver TEXT NOT NULL, qualification TEXT NOT NULL,
    vehicle TEXT NOT NULL, location TEXT NOT NULL, maintenance TEXT NOT NULL,
    maintenance_due INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
    equipment_type TEXT NOT NULL DEFAULT 'Semi tractor', mpg REAL NOT NULL DEFAULT 6.5,
    tank_gallons REAL NOT NULL DEFAULT 150, fuel_gallons REAL NOT NULL DEFAULT 75,
    hos_remaining_hours REAL NOT NULL DEFAULT 8
  );
  CREATE TABLE IF NOT EXISTS driver_profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, cdl_class TEXT NOT NULL CHECK (cdl_class IN ('A', 'B', 'C', 'none')),
    endorsements_json TEXT NOT NULL, preferred_equipment_json TEXT NOT NULL, availability TEXT NOT NULL CHECK (availability IN ('available', 'assigned', 'on_leave', 'unavailable')),
    medical_expiry TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sops (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL,
    type TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sop_acknowledgments (
    sop_code TEXT NOT NULL, user_id TEXT NOT NULL, acknowledged_at TEXT NOT NULL,
    PRIMARY KEY (sop_code, user_id), FOREIGN KEY (sop_code) REFERENCES sops(code), FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS finance_records (
    id TEXT PRIMARY KEY, item TEXT NOT NULL, owner TEXT NOT NULL,
    amount TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finance_entries (
    id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
    category TEXT NOT NULL, description TEXT NOT NULL, counterparty TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), payment_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('paid', 'scheduled')), load_ref TEXT NOT NULL DEFAULT '',
    miles REAL, fuel_cents_per_mile INTEGER NOT NULL DEFAULT 0, driver_pay_cents_per_mile INTEGER NOT NULL DEFAULT 0,
    tax_deductible INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finance_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), current_cash_cents INTEGER NOT NULL DEFAULT 0,
    weekly_cash_floor_cents INTEGER NOT NULL DEFAULT 0, tax_percent REAL NOT NULL DEFAULT 25,
    insurance_percent REAL NOT NULL DEFAULT 10, maintenance_percent REAL NOT NULL DEFAULT 20,
    scaling_percent REAL NOT NULL DEFAULT 10, profit_percent REAL NOT NULL DEFAULT 35,
    updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS cash_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, category TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('cash', 'reserve', 'tax', 'insurance', 'maintenance', 'payroll', 'savings', 'fuel', 'gas')),
    balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0), reserved_cents INTEGER NOT NULL CHECK (reserved_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finance_allocations (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, source_cents INTEGER NOT NULL CHECK (source_cents >= 0),
    cash_floor_cents INTEGER NOT NULL CHECK (cash_floor_cents >= 0), available_cash_cents INTEGER NOT NULL CHECK (available_cash_cents >= 0),
    allocations_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'cancelled', 'executed')),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS finance_allocation_executions (
    id TEXT PRIMARY KEY, allocation_id TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
    source_account_id TEXT NOT NULL, transfers_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (allocation_id) REFERENCES finance_allocations(id), FOREIGN KEY (source_account_id) REFERENCES cash_accounts(id)
  );
  CREATE TABLE IF NOT EXISTS finance_budgets (
    category TEXT PRIMARY KEY, budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS counterparties (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('customer', 'vendor', 'both')),
    contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '', terms_days INTEGER NOT NULL DEFAULT 30 CHECK (terms_days >= 0),
    notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('receivable', 'payable')),
    invoice_number TEXT NOT NULL, counterparty_id TEXT NOT NULL, load_ref TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), issued_date TEXT NOT NULL, due_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'void')),
    payment_reference TEXT NOT NULL DEFAULT '', paid_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (kind, invoice_number), FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
  );
  CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    payment_date TEXT NOT NULL, reference TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  );
  CREATE TABLE IF NOT EXISTS collection_tasks (
    id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, counterparty_id TEXT NOT NULL,
    action_type TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    completed_by TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (invoice_id) REFERENCES invoices(id), FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
  );
  CREATE TABLE IF NOT EXISTS trip_plans (
    id TEXT PRIMARY KEY, unit TEXT NOT NULL, load_ref TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL, destination TEXT NOT NULL, distance_miles REAL NOT NULL,
    average_speed_mph REAL NOT NULL, estimated_driving_hours REAL NOT NULL,
    current_fuel_gallons REAL NOT NULL, mpg REAL NOT NULL, tank_gallons REAL NOT NULL,
    hos_remaining_hours REAL NOT NULL, stops_json TEXT NOT NULL, dispatch_status TEXT NOT NULL DEFAULT 'draft',
    dispatch_notes TEXT NOT NULL DEFAULT '', confirmed_by TEXT NOT NULL DEFAULT '', confirmed_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (unit) REFERENCES fleet(unit)
  );
  CREATE TABLE IF NOT EXISTS trip_stops (
    id TEXT PRIMARY KEY, trip_plan_id TEXT NOT NULL, sequence INTEGER NOT NULL,
    stop_type TEXT NOT NULL, location TEXT NOT NULL, planned_mile REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('planned', 'en_route', 'arrived', 'completed', 'skipped')),
    eta TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (trip_plan_id) REFERENCES trip_plans(id)
  );
  CREATE TABLE IF NOT EXISTS load_assignments (
    id TEXT PRIMARY KEY, unit TEXT NOT NULL, load_ref TEXT NOT NULL DEFAULT '',
    driver_name TEXT NOT NULL DEFAULT '', equipment_type TEXT NOT NULL,
    route TEXT NOT NULL DEFAULT '', assign_status TEXT NOT NULL CHECK (assign_status IN ('assigned', 'pending', 'rejected')),
    match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100), notes TEXT NOT NULL DEFAULT '', workflow_status TEXT NOT NULL DEFAULT 'assigned',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (unit) REFERENCES fleet(unit)
  );
  CREATE TABLE IF NOT EXISTS assignment_history (
    id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '', changed_by TEXT NOT NULL, changed_at TEXT NOT NULL,
    FOREIGN KEY (assignment_id) REFERENCES load_assignments(id)
  );
  CREATE TABLE IF NOT EXISTS dvir_records (
    id TEXT PRIMARY KEY, unit TEXT NOT NULL, driver TEXT NOT NULL,
    inspection_type TEXT NOT NULL CHECK (inspection_type IN ('pre-trip', 'post-trip')),
    odometer_miles REAL NOT NULL, checks_json TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('No defects', 'Needs repair', 'Repair complete')),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (unit) REFERENCES fleet(unit)
  );
  CREATE TABLE IF NOT EXISTS eld_logs (
    id TEXT PRIMARY KEY, unit TEXT NOT NULL, driver TEXT NOT NULL,
    duty_status TEXT NOT NULL CHECK (duty_status IN ('driving', 'on_duty', 'off_duty', 'sleeper', 'yard_move')),
    start_at TEXT NOT NULL, end_at TEXT NOT NULL, driving_hours REAL NOT NULL CHECK (driving_hours >= 0 AND driving_hours <= 11),
    on_duty_hours REAL NOT NULL CHECK (on_duty_hours >= 0 AND on_duty_hours <= 14), source TEXT NOT NULL,
    verification_status TEXT NOT NULL CHECK (verification_status IN ('simulated', 'imported', 'verified')),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (unit) REFERENCES fleet(unit)
  );
  CREATE TABLE IF NOT EXISTS camera_events (
    id TEXT PRIMARY KEY, unit TEXT NOT NULL, driver TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('collision', 'harsh_braking', 'lane_departure', 'distraction', 'manual')),
    occurred_at TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    clip_reference TEXT NOT NULL DEFAULT '', review_status TEXT NOT NULL CHECK (review_status IN ('new', 'reviewed', 'escalated', 'dismissed')),
    notes TEXT NOT NULL DEFAULT '', review_notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (unit) REFERENCES fleet(unit)
  );
  CREATE TABLE IF NOT EXISTS readiness_items (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, guidance TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started', 'In progress', 'Complete', 'Not applicable')),
    due_date TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS employee_scorecards (
    id TEXT PRIMARY KEY, employee_name TEXT NOT NULL, job_role TEXT NOT NULL,
    quantitative_score INTEGER NOT NULL CHECK (quantitative_score BETWEEN 0 AND 100),
    strategic_score INTEGER NOT NULL CHECK (strategic_score BETWEEN 0 AND 100),
    qualitative_score INTEGER NOT NULL CHECK (qualitative_score BETWEEN 0 AND 100),
    reliability_score INTEGER NOT NULL CHECK (reliability_score BETWEEN 0 AND 100),
    overall_score REAL NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
    grade TEXT NOT NULL, evidence_notes TEXT NOT NULL, reviewer_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Reviewed')),
    reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS advisor_actions (
    id TEXT PRIMARY KEY, area TEXT NOT NULL, priority TEXT NOT NULL CHECK (priority IN ('Low', 'Review', 'High', 'Critical')),
    title TEXT NOT NULL, detail TEXT NOT NULL, sources_json TEXT NOT NULL, due_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'completed', 'dismissed')),
    outcome TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    completed_by TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY, facility TEXT NOT NULL, location TEXT NOT NULL,
    capacity TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
    reference TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS document_files (
    document_id TEXT PRIMARY KEY, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 524288),
    file_data BLOB NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );
`);
const financeEntryColumns = new Set(database.prepare('PRAGMA table_info(finance_entries)').all().map(column => column.name));
if (!financeEntryColumns.has('fuel_cents_per_mile')) database.exec('ALTER TABLE finance_entries ADD COLUMN fuel_cents_per_mile INTEGER NOT NULL DEFAULT 0');
if (!financeEntryColumns.has('driver_pay_cents_per_mile')) database.exec('ALTER TABLE finance_entries ADD COLUMN driver_pay_cents_per_mile INTEGER NOT NULL DEFAULT 0');
if (!financeEntryColumns.has('tax_deductible')) database.exec('ALTER TABLE finance_entries ADD COLUMN tax_deductible INTEGER NOT NULL DEFAULT 0');
const fleetColumns = new Set(database.prepare('PRAGMA table_info(fleet)').all().map(column => column.name));
if (!fleetColumns.has('equipment_type')) database.exec("ALTER TABLE fleet ADD COLUMN equipment_type TEXT NOT NULL DEFAULT 'Semi tractor'");
if (!fleetColumns.has('mpg')) database.exec('ALTER TABLE fleet ADD COLUMN mpg REAL NOT NULL DEFAULT 6.5');
if (!fleetColumns.has('tank_gallons')) database.exec('ALTER TABLE fleet ADD COLUMN tank_gallons REAL NOT NULL DEFAULT 150');
if (!fleetColumns.has('fuel_gallons')) database.exec('ALTER TABLE fleet ADD COLUMN fuel_gallons REAL NOT NULL DEFAULT 75');
if (!fleetColumns.has('hos_remaining_hours')) database.exec('ALTER TABLE fleet ADD COLUMN hos_remaining_hours REAL NOT NULL DEFAULT 8');
const assignmentColumns = new Set(database.prepare('PRAGMA table_info(load_assignments)').all().map(column => column.name));
if (!assignmentColumns.has('workflow_status')) database.exec("ALTER TABLE load_assignments ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'assigned'");
const tripColumns = new Set(database.prepare('PRAGMA table_info(trip_plans)').all().map(column => column.name));
if (!tripColumns.has('dispatch_status')) database.exec("ALTER TABLE trip_plans ADD COLUMN dispatch_status TEXT NOT NULL DEFAULT 'draft'");
if (!tripColumns.has('dispatch_notes')) database.exec("ALTER TABLE trip_plans ADD COLUMN dispatch_notes TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has('confirmed_by')) database.exec("ALTER TABLE trip_plans ADD COLUMN confirmed_by TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has('confirmed_at')) database.exec("ALTER TABLE trip_plans ADD COLUMN confirmed_at TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has('updated_at')) database.exec("ALTER TABLE trip_plans ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
const cashAccountDefinition = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cash_accounts'").get();
if (cashAccountDefinition && cashAccountDefinition.sql && !cashAccountDefinition.sql.includes("'fuel'")) {
  database.exec(`
    ALTER TABLE cash_accounts RENAME TO cash_accounts_legacy;
    CREATE TABLE cash_accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, category TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('cash', 'reserve', 'tax', 'insurance', 'maintenance', 'payroll', 'savings', 'fuel', 'gas')),
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0), reserved_cents INTEGER NOT NULL CHECK (reserved_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO cash_accounts (id, name, category, account_type, balance_cents, reserved_cents, active, created_by, created_at, updated_at)
    SELECT id, name, category,
      CASE
        WHEN account_type = 'fuel' THEN 'fuel'
        WHEN account_type = 'gas' THEN 'gas'
        ELSE account_type
      END,
      balance_cents, reserved_cents, active, created_by, created_at, updated_at
    FROM cash_accounts_legacy;
    DROP TABLE cash_accounts_legacy;
  `);
}
database.prepare('INSERT OR IGNORE INTO finance_settings (id) VALUES (1)').run();
if (database.prepare('SELECT COUNT(*) AS count FROM readiness_items').get().count === 0) {
  const insertReadiness = database.prepare('INSERT INTO readiness_items (id, category, title, guidance) VALUES (?, ?, ?, ?)');
  for (const item of defaultReadiness) insertReadiness.run(...item);
}
const loadCount = database.prepare('SELECT COUNT(*) AS count FROM loads').get().count;
if (loadCount === 0) {
  const insertLoad = database.prepare('INSERT INTO loads (id, origin, destination, customer, unit, driver, revenue, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const load of defaultLoads) insertLoad.run(...load);
}
const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  const insertUser = database.prepare('INSERT INTO users (id, name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
  const createdAt = new Date().toISOString();
  for (const user of defaultUsers) insertUser.run(user.id, user.name, user.email, hashPassword(user.password), user.role, createdAt);
}
if (!database.prepare('SELECT id FROM users WHERE email = ?').get(defaultUsers[3].email)) {
  database.prepare('INSERT INTO users (id, name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(defaultUsers[3].id, defaultUsers[3].name, defaultUsers[3].email, hashPassword(defaultUsers[3].password), defaultUsers[3].role, new Date().toISOString());
}
const fleetCount = database.prepare('SELECT COUNT(*) AS count FROM fleet').get().count;
if (fleetCount === 0) {
  const insertFleet = database.prepare('INSERT INTO fleet (unit, vin, driver, qualification, vehicle, location, maintenance, maintenance_due, status, equipment_type, mpg, tank_gallons, fuel_gallons, hos_remaining_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const vehicle of defaultFleet) insertFleet.run(vehicle[0], vehicle[1], vehicle[2], vehicle[3], vehicle[4], vehicle[5], vehicle[6], vehicle[7], vehicle[8], vehicle[9], 6.5, 150, 75, 8);
}
const sopCount = database.prepare('SELECT COUNT(*) AS count FROM sops').get().count;
if (sopCount === 0) {
  const insertSop = database.prepare('INSERT INTO sops (code, name, department, type) VALUES (?, ?, ?, ?)');
  for (const sop of defaultSops) insertSop.run(...sop);
}
const financeCount = database.prepare('SELECT COUNT(*) AS count FROM finance_records').get().count;
if (financeCount === 0) {
  const insertFinance = database.prepare('INSERT INTO finance_records (id, item, owner, amount, status) VALUES (?, ?, ?, ?, ?)');
  for (const record of defaultFinance) insertFinance.run(...record);
}
const cashAccountCount = database.prepare('SELECT COUNT(*) AS count FROM cash_accounts').get().count;
if (cashAccountCount === 0) {
  const insertCashAccount = database.prepare('INSERT INTO cash_accounts (id, name, category, account_type, balance_cents, reserved_cents, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)');
  const createdAt = new Date().toISOString();
  for (const account of defaultCashAccounts) insertCashAccount.run(account[0], account[1], account[2], account[3], account[4], account[5], 'System', createdAt, createdAt);
}
const warehouseCount = database.prepare('SELECT COUNT(*) AS count FROM warehouses').get().count;
if (warehouseCount === 0) {
  const insertWarehouse = database.prepare('INSERT INTO warehouses (id, facility, location, capacity, status) VALUES (?, ?, ?, ?, ?)');
  for (const warehouse of defaultWarehouses) insertWarehouse.run(...warehouse);
}
const documentCount = database.prepare('SELECT COUNT(*) AS count FROM documents').get().count;
if (documentCount === 0) {
  const insertDocument = database.prepare('INSERT INTO documents (id, name, type, reference, owner, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const createdAt = new Date().toISOString();
  for (const document of defaultDocuments) insertDocument.run(...document, createdAt);
}

function readLoads() { return database.prepare('SELECT id, origin, destination, customer, unit, driver, revenue, status FROM loads ORDER BY id DESC').all(); }
function readIncidents() { return database.prepare('SELECT id, type, severity, unit, location, description, status, time, created_at AS createdAt FROM incidents ORDER BY created_at DESC').all(); }
function readUsers() { return database.prepare('SELECT id, name, email, role, active, created_at AS createdAt FROM users ORDER BY name').all(); }
function readFleet() { return database.prepare('SELECT unit, vin, driver, qualification, vehicle, location, maintenance, maintenance_due AS maintenanceDue, status, equipment_type AS equipmentType, mpg, tank_gallons AS tankGallons, fuel_gallons AS fuelGallons, hos_remaining_hours AS hosRemainingHours FROM fleet ORDER BY unit').all(); }
function readDrivers() { return database.prepare('SELECT id, name, cdl_class AS cdlClass, endorsements_json AS endorsementsJson, preferred_equipment_json AS preferredEquipmentJson, availability, medical_expiry AS medicalExpiry, notes, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM driver_profiles ORDER BY name').all().map(driver => ({ ...driver, endorsements: JSON.parse(driver.endorsementsJson), preferredEquipment: JSON.parse(driver.preferredEquipmentJson) })); }
function readSops(userId) { return database.prepare('SELECT s.code, s.name, s.department, s.type, s.version, CASE WHEN a.user_id IS NULL THEN 0 ELSE 1 END AS acknowledged, a.acknowledged_at AS acknowledgedAt FROM sops s LEFT JOIN sop_acknowledgments a ON a.sop_code = s.code AND a.user_id = ? WHERE s.active = 1 ORDER BY s.type DESC, s.name').all(userId); }
function readFinance() { return database.prepare('SELECT id, item, owner, amount, status FROM finance_records ORDER BY id').all(); }
function readFinanceEntries() { return database.prepare('SELECT id, direction, category, description, counterparty, amount_cents AS amountCents, payment_date AS paymentDate, status, load_ref AS loadRef, miles, fuel_cents_per_mile AS fuelCostPerMileCents, driver_pay_cents_per_mile AS driverPayPerMileCents, tax_deductible AS taxDeductible, created_by AS createdBy, created_at AS createdAt FROM finance_entries ORDER BY payment_date DESC, created_at DESC').all(); }
function readFinanceSettings() { return database.prepare('SELECT current_cash_cents AS currentCashCents, weekly_cash_floor_cents AS weeklyCashFloorCents, tax_percent AS taxPercent, insurance_percent AS insurancePercent, maintenance_percent AS maintenancePercent, scaling_percent AS scalingPercent, profit_percent AS profitPercent, updated_at AS updatedAt FROM finance_settings WHERE id = 1').get(); }
function readCashAccounts() { return database.prepare('SELECT id, name, category, account_type AS accountType, balance_cents AS balanceCents, reserved_cents AS reservedCents, active, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt FROM cash_accounts ORDER BY category, name').all(); }
function readAllocations() {
  return database.prepare('SELECT id, source, source_cents AS sourceCents, cash_floor_cents AS cashFloorCents, available_cash_cents AS availableCashCents, allocations_json AS allocationsJson, status, created_by AS createdBy, created_at AS createdAt, approved_by AS approvedBy, approved_at AS approvedAt FROM finance_allocations ORDER BY created_at DESC').all().map(allocation => ({ ...allocation, allocations: JSON.parse(allocation.allocationsJson), cashFloorWarning: allocation.availableCashCents < allocation.cashFloorCents }));
}
function buildAllocationProposal(source = 'paid-margin') {
  const summary = calculateFinanceSummary();
  const accountTypes = { Tax: 'tax', Insurance: 'insurance', Maintenance: 'maintenance', Scaling: 'savings', Profit: 'cash' };
  const allocations = summary.allocations.map(item => {
    const account = summary.cashAccounts.find(candidate => candidate.active && candidate.accountType === accountTypes[item.category]);
    return { category: item.category, percent: item.percent, amountCents: item.amountCents, accountId: account?.id || null, accountName: account?.name || null, accountType: accountTypes[item.category], status: account ? 'ready' : 'unmapped' };
  });
  const fuelAccounts = summary.cashAccounts.filter(candidate => candidate.active && ['fuel', 'gas'].includes(candidate.accountType));
  if (fuelAccounts.length > 0) {
    const fuelShareCents = Math.max(1, Math.floor(summary.allocationBasisCents * 0.1));
    const perAccountCents = Math.max(1, Math.floor(fuelShareCents / fuelAccounts.length));
    for (const account of fuelAccounts) {
      allocations.push({ category: account.category || (account.accountType === 'gas' ? 'Gas' : 'Fuel'), percent: 0, amountCents: perAccountCents, accountId: account.id, accountName: account.name, accountType: account.accountType, status: 'ready' });
    }
  }
  return { source, sourceCents: summary.allocationBasisCents, cashFloorCents: summary.settings.weeklyCashFloorCents, availableCashCents: summary.settings.currentCashCents, allocations, cashFloorWarning: summary.settings.currentCashCents < summary.settings.weeklyCashFloorCents };
}
function readCollectionsOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const customers = database.prepare('SELECT id, name, kind FROM counterparties WHERE kind IN (\'customer\', \'both\') ORDER BY name').all();
  return customers.map(customer => {
    const invoices = database.prepare("SELECT i.id, i.kind, i.status, i.due_date AS dueDate, i.amount_cents AS amountCents, COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) AS paidCents, i.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) AS balanceCents FROM invoices i WHERE i.counterparty_id = ? AND i.kind = 'receivable'").all(customer.id);
    const openCents = invoices.filter(invoice => invoice.status === 'open').reduce((total, invoice) => total + invoice.balanceCents, 0);
    const overdueCents = invoices.filter(invoice => invoice.status === 'open' && invoice.dueDate < today).reduce((total, invoice) => total + invoice.balanceCents, 0);
    const paidCents = invoices.reduce((total, invoice) => total + invoice.paidCents, 0);
    let status = 'paid';
    if (overdueCents > 0) status = 'overdue';
    else if (openCents > 0) status = 'review';
    else if (paidCents > 0) status = 'paid';
    return { customerId: customer.id, customer: customer.name, kind: customer.kind, openCents, overdueCents, paidCents, status, invoiceCount: invoices.length, dueDate: invoices.filter(invoice => invoice.status === 'open').sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate || null };
  }).filter(item => item.invoiceCount > 0 || item.openCents > 0 || item.paidCents > 0);
}
function readCounterparties() { return database.prepare('SELECT id, name, kind, contact_name AS contactName, email, phone, address, terms_days AS termsDays, notes, created_by AS createdBy, created_at AS createdAt FROM counterparties ORDER BY name').all(); }
function readInvoices() { return database.prepare("SELECT i.id, i.kind, i.invoice_number AS invoiceNumber, i.counterparty_id AS counterpartyId, c.name AS counterparty, c.contact_name AS contactName, c.email, c.phone, c.address, i.load_ref AS loadRef, i.amount_cents AS amountCents, COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) AS paidCents, i.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) AS balanceCents, i.issued_date AS issuedDate, i.due_date AS dueDate, i.status, i.payment_reference AS paymentReference, i.paid_at AS paidAt, i.created_by AS createdBy, i.created_at AS createdAt FROM invoices i JOIN counterparties c ON c.id = i.counterparty_id ORDER BY i.due_date, i.created_at").all(); }
function readCollectionTasks() { return database.prepare('SELECT t.id, t.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, t.counterparty_id AS counterpartyId, c.name AS counterparty, t.action_type AS actionType, t.due_date AS dueDate, t.status, t.notes, t.created_by AS createdBy, t.created_at AS createdAt, t.completed_by AS completedBy, t.completed_at AS completedAt FROM collection_tasks t JOIN invoices i ON i.id = t.invoice_id JOIN counterparties c ON c.id = t.counterparty_id ORDER BY CASE WHEN t.status = \'open\' THEN 0 ELSE 1 END, t.due_date, t.created_at').all(); }
function readReconciliation() {
  return readInvoices().filter(invoice => invoice.status !== 'void').map(invoice => {
    const direction = invoice.kind === 'receivable' ? 'income' : 'expense';
    const partyKey = invoice.counterparty.trim().toLowerCase();
    const entries = database.prepare('SELECT id, direction, category, description, counterparty, amount_cents AS amountCents, payment_date AS paymentDate, status, load_ref AS loadRef FROM finance_entries WHERE direction = ? ORDER BY created_at DESC').all(direction);
    const partyMatches = entries.filter(entry => entry.counterparty.trim().toLowerCase() === partyKey);
    const referenceMatches = entries.filter(entry => invoice.loadRef && entry.loadRef === invoice.loadRef);
    const candidates = entries.filter(entry => (entry.counterparty.trim().toLowerCase() === partyKey || (invoice.loadRef && entry.loadRef === invoice.loadRef)));
    const exact = candidates.filter(entry => entry.counterparty.trim().toLowerCase() === partyKey && entry.amountCents === invoice.amountCents && (!invoice.loadRef || entry.loadRef === invoice.loadRef));
    let matchStatus = 'missing_payment';
    let detail = 'No related ledger payment was found.';
    let matchedEntry = null;
    if (exact.length === 1) {
      matchedEntry = exact[0];
      matchStatus = matchedEntry.status === invoice.status ? 'matched' : 'status_conflict';
      detail = matchStatus === 'matched' ? 'Party, amount, reference, and payment state agree.' : `Invoice is ${invoice.status}; ledger entry is ${matchedEntry.status}. Review both records.`;
    } else if (exact.length > 1) {
      matchStatus = 'duplicate_matches';
      detail = `${exact.length} exact ledger candidates found. Review for duplicate payments.`;
    } else if (candidates.length > 0) {
      matchStatus = 'mismatch';
      detail = 'Related ledger entries exist, but party, amount, or load reference does not fully agree.';
    }
    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, kind: invoice.kind, counterparty: invoice.counterparty, amountCents: invoice.amountCents, invoiceStatus: invoice.status, loadRef: invoice.loadRef, matchStatus, detail, candidateCount: candidates.length, partyCandidateCount: partyMatches.length, referenceCandidateCount: referenceMatches.length, matchedEntry };
  });
}
const equipmentTypes = ['Semi tractor', 'Dry van', 'Box truck', 'Reefer', 'Flatbed', 'Tanker', 'Other'];
const dvirChecklist = ['Service brakes', 'Tires and wheels', 'Lights and reflectors', 'Steering', 'Coupling devices', 'Mirrors and windshield', 'Emergency equipment', 'Leaks and fluid levels'];
function calculateTripPlan(vehicle, payload) {
  const distanceMiles = Number(payload.distanceMiles);
  const averageSpeedMph = Number(payload.averageSpeedMph);
  const currentFuelGallons = payload.currentFuelGallons === undefined ? vehicle.fuelGallons : Number(payload.currentFuelGallons);
  const hosRemainingHours = payload.hosRemainingHours === undefined ? vehicle.hosRemainingHours : Number(payload.hosRemainingHours);
  const estimatedDrivingHours = distanceMiles / averageSpeedMph;
  const reserveGallons = vehicle.tankGallons * 0.2;
  const firstRangeMiles = Math.max(0, currentFuelGallons - reserveGallons) * vehicle.mpg;
  const fullRangeMiles = Math.max(0, vehicle.tankGallons - reserveGallons) * vehicle.mpg;
  const fuelStops = [];
  let nextFuelStop = firstRangeMiles;
  while (nextFuelStop < distanceMiles && fuelStops.length < 50) {
    fuelStops.push({ atMile: Math.round(nextFuelStop), reason: fuelStops.length === 0 && currentFuelGallons <= reserveGallons ? 'Fuel before departure' : 'Estimated refuel window', location: '' });
    nextFuelStop += fullRangeMiles;
    if (fullRangeMiles <= 0) break;
  }
  const overnightStop = estimatedDrivingHours > hosRemainingHours ? {
    atMile: Math.min(distanceMiles, Math.max(0, Math.round(hosRemainingHours * averageSpeedMph))),
    suggestedLocation: typeof payload.overnightStopLocation === 'string' ? payload.overnightStopLocation.trim().slice(0, 120) : '',
    note: 'Estimate from entered remaining driving hours only. Confirm current HOS, rest requirements, truck access, and stop availability before dispatch.'
  } : null;
  return { distanceMiles, averageSpeedMph, estimatedDrivingHours: Number(estimatedDrivingHours.toFixed(1)), currentFuelGallons, mpg: vehicle.mpg, tankGallons: vehicle.tankGallons, hosRemainingHours, fuelStops, overnightStop };
}
function readTripPlans() {
  return database.prepare('SELECT id, unit, load_ref AS loadRef, origin, destination, distance_miles AS distanceMiles, average_speed_mph AS averageSpeedMph, estimated_driving_hours AS estimatedDrivingHours, current_fuel_gallons AS currentFuelGallons, mpg, tank_gallons AS tankGallons, hos_remaining_hours AS hosRemainingHours, stops_json AS stopsJson, dispatch_status AS dispatchStatus, dispatch_notes AS dispatchNotes, confirmed_by AS confirmedBy, confirmed_at AS confirmedAt, updated_at AS updatedAt, created_by AS createdBy, created_at AS createdAt FROM trip_plans ORDER BY created_at DESC').all().map(plan => ({ ...plan, stops: JSON.parse(plan.stopsJson) }));
}
function readTripStops(tripPlanId) {
  return database.prepare('SELECT id, trip_plan_id AS tripPlanId, sequence, stop_type AS stopType, location, planned_mile AS plannedMile, status, eta, notes, updated_by AS updatedBy, updated_at AS updatedAt FROM trip_stops WHERE trip_plan_id = ? ORDER BY sequence').all(tripPlanId);
}
function readAssignments() {
  return database.prepare('SELECT id, unit, load_ref AS loadRef, driver_name AS driverName, equipment_type AS equipmentType, route, assign_status AS assignStatus, workflow_status AS workflowStatus, match_score AS matchScore, notes, created_by AS createdBy, created_at AS createdAt FROM load_assignments ORDER BY created_at DESC').all();
}
function readAssignmentHistory(assignmentId) {
  return database.prepare('SELECT id, assignment_id AS assignmentId, status, notes, changed_by AS changedBy, changed_at AS changedAt FROM assignment_history WHERE assignment_id = ? ORDER BY changed_at').all(assignmentId);
}
function readDvirRecords() {
  return database.prepare('SELECT id, unit, driver, inspection_type AS inspectionType, odometer_miles AS odometerMiles, checks_json AS checksJson, notes, status, created_by AS createdBy, created_at AS createdAt FROM dvir_records ORDER BY created_at DESC').all().map(record => ({ ...record, checks: JSON.parse(record.checksJson) }));
}
function readEldLogs() {
  return database.prepare('SELECT id, unit, driver, duty_status AS dutyStatus, start_at AS startAt, end_at AS endAt, driving_hours AS drivingHours, on_duty_hours AS onDutyHours, source, verification_status AS verificationStatus, created_by AS createdBy, created_at AS createdAt FROM eld_logs ORDER BY end_at DESC').all();
}
function readEldStatus() {
  const latest = database.prepare('SELECT id, unit, driver, duty_status AS dutyStatus, end_at AS endAt, driving_hours AS drivingHours, on_duty_hours AS onDutyHours, verification_status AS verificationStatus FROM eld_logs ORDER BY end_at DESC').all();
  return readFleet().map(vehicle => {
    const log = latest.find(item => item.unit === vehicle.unit);
    const lastSyncAt = log?.endAt || null;
    return { unit: vehicle.unit, driver: log?.driver || vehicle.driver, lastLogId: log?.id || null, dutyStatus: log?.dutyStatus || null, drivingHours: log?.drivingHours ?? null, onDutyHours: log?.onDutyHours ?? null, verificationStatus: log?.verificationStatus || 'manual', lastSyncAt, stale: !lastSyncAt || Date.now() - new Date(lastSyncAt).getTime() > 24 * 60 * 60 * 1000 };
  });
}
function readCameraEvents() {
  return database.prepare('SELECT id, unit, driver, event_type AS eventType, occurred_at AS occurredAt, severity, clip_reference AS clipReference, review_status AS reviewStatus, notes, review_notes AS reviewNotes, created_by AS createdBy, created_at AS createdAt, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt FROM camera_events ORDER BY occurred_at DESC').all();
}
function readReadiness() { return database.prepare('SELECT id, category, title, guidance, status, due_date AS dueDate, notes, updated_by AS updatedBy, updated_at AS updatedAt FROM readiness_items ORDER BY category, title').all(); }
function scorecardGrade(score) {
  if (score >= 90) return 'A to A+';
  if (score >= 80) return 'B to B+';
  if (score >= 70) return 'C to C+';
  if (score >= 60) return 'D';
  return 'F';
}
function readScorecards() {
  return database.prepare('SELECT id, employee_name AS employeeName, job_role AS jobRole, quantitative_score AS quantitativeScore, strategic_score AS strategicScore, qualitative_score AS qualitativeScore, reliability_score AS reliabilityScore, overall_score AS overallScore, grade, evidence_notes AS evidenceNotes, reviewer_notes AS reviewerNotes, status, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, created_by AS createdBy, created_at AS createdAt FROM employee_scorecards ORDER BY created_at DESC').all();
}
function readAdvisorActions() {
  return database.prepare('SELECT id, area, priority, title, detail, sources_json AS sourcesJson, due_date AS dueDate, status, outcome, created_by AS createdBy, created_at AS createdAt, completed_by AS completedBy, completed_at AS completedAt FROM advisor_actions ORDER BY CASE WHEN status = \'open\' THEN 0 WHEN status = \'acknowledged\' THEN 1 ELSE 2 END, due_date, created_at DESC').all().map(action => ({ ...action, sources: JSON.parse(action.sourcesJson) }));
}
function readBusinessAdvisor() {
  const finance = calculateFinanceSummary();
  const forecast = calculateCashForecast();
  const fleet = readFleet();
  const loads = readLoads();
  const invoices = readInvoices();
  const financeEntries = readFinanceEntries();
  const today = new Date().toISOString().slice(0, 10);
  const overdueInvoices = invoices.filter(invoice => invoice.kind === 'receivable' && invoice.status === 'open' && invoice.dueDate < today);
  const openReceivables = invoices.filter(invoice => invoice.kind === 'receivable' && invoice.status === 'open');
  const atRiskLoads = loads.filter(load => load.status === 'At risk');
  const maintenanceUnits = fleet.filter(vehicle => vehicle.maintenanceDue || ['In service', 'Out of service'].includes(vehicle.status));
  const activeLoads = loads.filter(load => load.status !== 'Delivered');
  const unassignedLoads = activeLoads.filter(load => !load.driver || ['Unassigned', 'Pending assignment'].includes(load.driver));
  const hosWarningUnits = fleet.filter(vehicle => vehicle.status === 'Moving' && vehicle.hosRemainingHours <= 2);
  const loadProfitability = loads.map(load => {
    const entries = financeEntries.filter(entry => entry.loadRef === load.id);
    const incomeEntries = entries.filter(entry => entry.direction === 'income');
    const expenseEntries = entries.filter(entry => entry.direction === 'expense');
    const parsedRevenue = Number(String(load.revenue).replace(/[^0-9.]/g, ''));
    const revenueCents = incomeEntries.length ? incomeEntries.reduce((sum, entry) => sum + entry.amountCents, 0) : Number.isFinite(parsedRevenue) ? Math.round(parsedRevenue * 100) : 0;
    const mileageCostsCents = incomeEntries.reduce((sum, entry) => sum + Math.round((entry.fuelCostPerMileCents + entry.driverPayPerMileCents) * (entry.miles || 0)), 0);
    const expenseCents = expenseEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
    return { loadRef: load.id, customer: load.customer, origin: load.origin, destination: load.destination, revenueCents, knownCostsCents: mileageCostsCents + expenseCents, knownProfitCents: revenueCents - mileageCostsCents - expenseCents, hasCostInputs: mileageCostsCents + expenseCents > 0, status: load.status };
  });
  const aggregateProfitability = (keySelector) => {
    const groups = new Map();
    for (const load of loadProfitability) {
      const key = keySelector(load);
      const current = groups.get(key) || { name: key, loads: 0, revenueCents: 0, knownCostsCents: 0, knownProfitCents: 0, loadsWithCostInputs: 0 };
      current.loads += 1;
      current.revenueCents += load.revenueCents;
      current.knownCostsCents += load.knownCostsCents;
      current.knownProfitCents += load.knownProfitCents;
      if (load.hasCostInputs) current.loadsWithCostInputs += 1;
      groups.set(key, current);
    }
    return [...groups.values()].sort((left, right) => right.knownProfitCents - left.knownProfitCents);
  };
  const customerProfitability = aggregateProfitability(load => load.customer);
  const laneProfitability = aggregateProfitability(load => `${load.origin} → ${load.destination}`);
  const fuelCostByDriver = new Map();
  for (const entry of financeEntries.filter(item => item.direction === 'income' && item.fuelCostPerMileCents > 0 && item.miles > 0)) {
    const load = loads.find(item => item.id === entry.loadRef);
    if (!load) continue;
    const current = fuelCostByDriver.get(load.driver) || { driver: load.driver, miles: 0, fuelCostCents: 0 };
    current.miles += entry.miles;
    current.fuelCostCents += entry.fuelCostPerMileCents * entry.miles;
    fuelCostByDriver.set(load.driver, current);
  }
  const fuelCostPerMileByDriver = [...fuelCostByDriver.values()].map(item => ({ ...item, fuelCostPerMileCents: Math.round(item.fuelCostCents / item.miles) })).sort((left, right) => left.fuelCostPerMileCents - right.fuelCostPerMileCents);
  const firstShortfall = forecast.weeks.find(week => week.belowCashFloor);
  const insights = [];
  if (firstShortfall) insights.push({ area: 'CFO · Margin', priority: 'High', title: `Cash floor at risk in week ${firstShortfall.week}`, detail: `Projected close is ${firstShortfall.closingCashCents} cents against a ${forecast.weeklyCashFloorCents} cent floor. Review collections and scheduled spending.`, sources: [`cash-week-${firstShortfall.week}`] });
  if (overdueInvoices.length) insights.push({ area: 'Network · Collections', priority: 'High', title: `${overdueInvoices.length} receivable(s) are past due`, detail: `Open past-due balance is ${overdueInvoices.reduce((total, invoice) => total + invoice.amountCents, 0)} cents. Review payer contact and payment evidence.`, sources: overdueInvoices.map(invoice => invoice.invoiceNumber) });
  if (atRiskLoads.length) insights.push({ area: 'COO · Dispatch', priority: 'High', title: `${atRiskLoads.length} load(s) are marked at risk`, detail: 'Confirm appointment status, customer updates, and the next driver check-in.', sources: atRiskLoads.map(load => load.id) });
  if (maintenanceUnits.length) insights.push({ area: 'Risk · Fleet', priority: 'Review', title: `${maintenanceUnits.length} unit(s) need maintenance review`, detail: 'Check open DVIR defects, due mileage, and vehicle availability before assigning another load.', sources: maintenanceUnits.map(vehicle => vehicle.unit) });
  if (unassignedLoads.length) insights.push({ area: 'Network · Capacity', priority: 'Review', title: `${unassignedLoads.length} active load(s) are unassigned`, detail: 'Review capacity and dispatcher workload before accepting additional freight.', sources: unassignedLoads.map(load => load.id) });
  if (hosWarningUnits.length) insights.push({ area: 'Safety · Driver hours', priority: 'Review', title: `${hosWarningUnits.length} moving unit(s) have low entered hours`, detail: 'Manually entered HOS values are not synchronized or verified; confirm current ELD records before dispatch decisions.', sources: hosWarningUnits.map(vehicle => vehicle.unit) });
  if (!insights.length) insights.push({ area: 'Operations', priority: 'Review', title: 'No rule-triggered exceptions from current records', detail: 'The advisor only evaluates data entered in CommandOS. Missing provider or operating data can hide risk.', sources: [] });
  return {
    generatedAt: new Date().toISOString(), mode: 'rules-based decision support',
    metrics: {
      currentCashCents: finance.settings.currentCashCents, weeklyCashFloorCents: finance.settings.weeklyCashFloorCents,
      estimatedNetCents: finance.netCents, costPerMileCents: finance.costPerMileCents,
      openReceivableCents: openReceivables.reduce((total, invoice) => total + invoice.amountCents, 0),
      overdueInvoiceCount: overdueInvoices.length, atRiskLoadCount: atRiskLoads.length,
      fleetUtilizationPercent: fleet.length ? Math.round(fleet.filter(vehicle => vehicle.status === 'Moving').length / fleet.length * 100) : null,
      maintenanceReviewCount: maintenanceUnits.length, manualHosWarningCount: hosWarningUnits.length,
      activeLoadCount: activeLoads.length, unassignedLoadCount: unassignedLoads.length,
      loadAssignmentRatePercent: activeLoads.length ? Math.round((activeLoads.length - unassignedLoads.length) / activeLoads.length * 100) : null,
      debtToIncomeCents: null, dwellTime: null, verifiedFuelEfficiency: null,
      customerProfitability, laneProfitability, fuelCostPerMileByDriver,
      dataQualityNote: 'Profitability is based only on saved load revenue and costs linked by load reference. Missing cost entries can make known-profit figures too high.'
    }, insights
  };
}
function financeAccess(user) { return ['Owner / Admin', 'Accounting'].includes(user.role); }
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}
function dateAtUtcOffset(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function calculateFinanceSummary() {
  const totals = database.prepare("SELECT direction, status, SUM(amount_cents) AS total FROM finance_entries GROUP BY direction, status").all();
  const totalFor = (direction, status) => Number(totals.find(item => item.direction === direction && item.status === status)?.total || 0);
  const incomeCents = totalFor('income', 'paid') + totalFor('income', 'scheduled');
  const expenseCents = totalFor('expense', 'paid') + totalFor('expense', 'scheduled');
  const totalMiles = Number(database.prepare("SELECT COALESCE(SUM(miles), 0) AS total FROM finance_entries WHERE direction = 'income'").get().total);
  const mileageCosts = Number(database.prepare("SELECT COALESCE(SUM((fuel_cents_per_mile + driver_pay_cents_per_mile) * COALESCE(miles, 0)), 0) AS total FROM finance_entries WHERE direction = 'income'").get().total);
  const netCents = incomeCents - expenseCents - mileageCosts;
  const paidMileageCosts = Number(database.prepare("SELECT COALESCE(SUM((fuel_cents_per_mile + driver_pay_cents_per_mile) * COALESCE(miles, 0)), 0) AS total FROM finance_entries WHERE direction = 'income' AND status = 'paid'").get().total);
  const deductibleExpenseCents = Number(database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_entries WHERE direction = 'expense' AND status = 'paid' AND tax_deductible = 1").get().total);
  const settings = readFinanceSettings();
  const allocationBasisCents = Math.max(0, totalFor('income', 'paid') - totalFor('expense', 'paid') - paidMileageCosts);
  const allocatableCents = allocationBasisCents;
  const allocations = [
    ['Tax', settings.taxPercent], ['Insurance', settings.insurancePercent],
    ['Maintenance', settings.maintenancePercent], ['Scaling', settings.scalingPercent], ['Profit', settings.profitPercent]
  ].map(([category, percent]) => ({ category, percent, amountCents: Math.floor(allocatableCents * percent / 100) }));
  const month = new Date().toISOString().slice(0, 7);
  const budgets = database.prepare('SELECT category, budget_cents AS budgetCents FROM finance_budgets ORDER BY category').all().map(budget => {
    const spentCents = Number(database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_entries WHERE direction = 'expense' AND category = ? AND status = 'paid' AND substr(payment_date, 1, 7) = ?").get(budget.category, month).total);
    return { ...budget, spentCents, remainingCents: budget.budgetCents - spentCents };
  });
  const loadProfits = database.prepare("SELECT id, load_ref AS loadRef, amount_cents AS revenueCents, miles, fuel_cents_per_mile AS fuelCostPerMileCents, driver_pay_cents_per_mile AS driverPayPerMileCents FROM finance_entries WHERE direction = 'income' AND (load_ref != '' OR miles IS NOT NULL) ORDER BY payment_date DESC").all().map(load => {
    const linkedExpensesCents = load.loadRef ? Number(database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_entries WHERE direction = 'expense' AND load_ref = ?").get(load.loadRef).total) : 0;
    const fuelCents = Math.round(Number(load.miles || 0) * load.fuelCostPerMileCents);
    const driverPayCents = Math.round(Number(load.miles || 0) * load.driverPayPerMileCents);
    return { id: load.id, loadRef: load.loadRef || load.id, revenueCents: load.revenueCents, miles: load.miles, fuelCents, driverPayCents, linkedExpensesCents, profitCents: load.revenueCents - fuelCents - driverPayCents - linkedExpensesCents };
  });
  const cashAccounts = readCashAccounts();
  const collectionsRisk = readCollectionsOverview();
  const availableCashCents = cashAccounts.reduce((sum, account) => sum + (account.accountType === 'cash' ? account.balanceCents : 0), 0);
  return {
    paidIncomeCents: totalFor('income', 'paid'), scheduledIncomeCents: totalFor('income', 'scheduled'),
    paidExpenseCents: totalFor('expense', 'paid'), scheduledExpenseCents: totalFor('expense', 'scheduled'),
    netCents, totalMiles, mileageCostsCents: mileageCosts, deductibleExpenseCents, allocationBasisCents,
    costPerMileCents: totalMiles > 0 ? Math.round((expenseCents + mileageCosts) / totalMiles) : null,
    allocations, budgets, loadProfits, settings, cashAccounts, collectionsRisk, availableCashCents
  };
}
function calculateCashForecast() {
  const settings = readFinanceSettings();
  const today = new Date().toISOString().slice(0, 10);
  const current = new Date(`${today}T00:00:00.000Z`);
  const daysSinceMonday = (current.getUTCDay() + 6) % 7;
  const firstWeek = dateAtUtcOffset(today, -daysSinceMonday);
  const scheduled = database.prepare("SELECT direction, amount_cents AS amountCents, payment_date AS paymentDate, COALESCE(miles, 0) AS miles, fuel_cents_per_mile AS fuelCostPerMileCents, driver_pay_cents_per_mile AS driverPayPerMileCents FROM finance_entries WHERE status = 'scheduled' AND payment_date >= ? AND payment_date < ?").all(today, dateAtUtcOffset(firstWeek, 91));
  let closingCashCents = settings.currentCashCents;
  const reservePercent = settings.taxPercent + settings.insurancePercent + settings.maintenancePercent + settings.scalingPercent;
  const weeks = Array.from({ length: 13 }, (_, index) => {
    const startDate = dateAtUtcOffset(firstWeek, index * 7);
    const endDate = dateAtUtcOffset(startDate, 6);
    const entries = scheduled.filter(entry => entry.paymentDate >= startDate && entry.paymentDate <= endDate);
    const incomeCents = entries.filter(entry => entry.direction === 'income').reduce((sum, entry) => sum + entry.amountCents, 0);
    const expenseCents = entries.filter(entry => entry.direction === 'expense').reduce((sum, entry) => sum + entry.amountCents, 0);
    const mileageCostsCents = entries.filter(entry => entry.direction === 'income').reduce((sum, entry) => sum + Math.round(entry.miles * (entry.fuelCostPerMileCents + entry.driverPayPerMileCents)), 0);
    const positiveMarginCents = Math.max(0, incomeCents - expenseCents - mileageCostsCents);
    const reserveCents = Math.round(positiveMarginCents * reservePercent / 100);
    closingCashCents += incomeCents - expenseCents - mileageCostsCents - reserveCents;
    return { week: index + 1, startDate, endDate, incomeCents, expenseCents, mileageCostsCents, reserveCents, closingCashCents, belowCashFloor: closingCashCents < settings.weeklyCashFloorCents };
  });
  return { currentCashCents: settings.currentCashCents, weeklyCashFloorCents: settings.weeklyCashFloorCents, reservePercent, weeks };
}
function readWarehouses() { return database.prepare('SELECT id, facility, location, capacity, status FROM warehouses ORDER BY id').all(); }
function canAccessDocumentType(user, type) {
  if (user.role === 'Owner / Admin') return true;
  const allowedTypes = {
    Dispatcher: ['BOL', 'POD', 'Rate confirmation'],
    Safety: ['Driver file', 'DVIR', 'Maintenance', 'Incident report'],
    Maintenance: ['DVIR', 'Maintenance'],
    Accounting: ['Receipt', 'BOL', 'POD', 'Rate confirmation', 'Invoice', 'Bill'],
    Warehouse: ['BOL', 'POD'],
    HR: ['Driver file', 'Employee file']
  };
  return allowedTypes[user.role]?.includes(type) || false;
}
function readDocuments(user) { return database.prepare('SELECT d.id, d.name, d.type, d.reference, d.owner, d.status, d.created_at AS createdAt, CASE WHEN f.document_id IS NULL THEN 0 ELSE 1 END AS hasFile, f.original_name AS fileName, f.mime_type AS mimeType, f.byte_size AS fileSize FROM documents d LEFT JOIN document_files f ON f.document_id = d.id ORDER BY d.created_at DESC').all().filter(document => canAccessDocumentType(user, document.type)); }
function readNotifications() {
  const notifications = [];
  for (const incident of database.prepare("SELECT id, type, unit, location, severity, created_at AS createdAt FROM incidents WHERE status != 'Resolved' ORDER BY created_at DESC LIMIT 20").all()) notifications.push({ id: `incident-${incident.id}`, kind: 'Incident', title: `${incident.unit} · ${incident.type}`, detail: `${incident.location} · ${incident.severity}`, createdAt: incident.createdAt });
  for (const load of database.prepare("SELECT id, origin, destination, customer FROM loads WHERE status = 'At risk'").all()) notifications.push({ id: `load-${load.id}`, kind: 'Load', title: `Load #${load.id} at risk`, detail: `${load.origin} → ${load.destination} · ${load.customer}`, createdAt: new Date().toISOString() });
  for (const document of database.prepare("SELECT id, name, reference FROM documents WHERE status = 'Expiring soon'").all()) notifications.push({ id: `document-${document.id}`, kind: 'Document', title: `${document.name} expiring soon`, detail: `Reference ${document.reference}`, createdAt: new Date().toISOString() });
  return notifications;
}
function recordAudit(user, action, entityType, entityId, details) { database.prepare('INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, user.name, user.role, action, entityType, entityId, details, new Date().toISOString()); }

function sendJson(response, status, body, headers = {}, options = {}) {
  const { skipBody = false } = options;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  if (skipBody) {
    response.end();
    return;
  }
  response.end(JSON.stringify(body));
}

function getCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(cookie => cookie.trim().split('=').map(decodeURIComponent)));
}

function authenticatedUser(request) {
  const sessionId = getCookies(request).commandos_session;
  return sessionId ? sessions.get(sessionId) : null;
}

function can(user, permission) {
  const permissions = { 'Owner / Admin': ['incident:create', 'load:update', 'fleet:update', 'fleet:profile', 'trip:create', 'dvir:create', 'dvir:repair', 'readiness:update', 'eld:create', 'camera:create', 'camera:review', 'driver:profile'], Dispatcher: ['incident:create', 'load:update', 'fleet:profile', 'trip:create', 'dvir:create', 'eld:create', 'camera:create', 'driver:profile'], Safety: ['incident:create', 'readiness:update', 'eld:create', 'camera:create', 'camera:review'], Maintenance: ['fleet:update', 'fleet:profile', 'dvir:create', 'dvir:repair'], Driver: ['incident:create', 'trip:create', 'dvir:create', 'eld:create'] };
  return permissions[user.role]?.includes(permission) || false;
}

function sendFile(response, requestPath, options = {}) {
  const { skipBody = false } = options;
  const requested = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'File not found' });
      return;
    }
    const extension = path.extname(filePath);
    const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
    if (skipBody) {
      response.end();
      return;
    }
    response.end(content);
  });
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 1000000) request.destroy(); });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if ((request.method === 'GET' || request.method === 'HEAD') && requestUrl.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok', service: 'jackson-commandos-api', time: new Date().toISOString() }, {}, { skipBody: request.method === 'HEAD' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/auth/me') {
      const user = authenticatedUser(request);
      if (!user) { sendJson(response, 401, { error: 'Authentication required' }); return; }
      sendJson(response, 200, { user });
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
      const payload = await collectBody(request);
      const account = database.prepare('SELECT id, name, email, password_hash AS passwordHash, role, active FROM users WHERE email = ?').get(payload.email);
      if (!account || !account.active || typeof payload.password !== 'string' || !verifyPassword(payload.password, account.passwordHash)) { sendJson(response, 401, { error: 'Invalid email or password' }); return; }
      const user = { id: account.id, name: account.name, email: account.email, role: account.role };
      const sessionId = crypto.randomBytes(24).toString('hex');
      sessions.set(sessionId, user);
      sendJson(response, 200, { user }, { 'Set-Cookie': `commandos_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` });
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
      const sessionId = getCookies(request).commandos_session;
      if (sessionId) sessions.delete(sessionId);
      sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'commandos_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      return;
    }
    if (requestUrl.pathname.startsWith('/api/') && !authenticatedUser(request)) {
      sendJson(response, 401, { error: 'Authentication required' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/audit') {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can view audit history' }); return; }
      sendJson(response, 200, database.prepare('SELECT id, actor_name AS actor, actor_role AS role, action, entity_type AS entityType, entity_id AS entityId, details, created_at AS createdAt FROM audit_logs ORDER BY id DESC LIMIT 100').all());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/users') {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can view users' }); return; }
      sendJson(response, 200, readUsers());
      return;
    }
    const userMatch = requestUrl.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (request.method === 'PATCH' && userMatch) {
      const actor = authenticatedUser(request);
      if (actor.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can manage users' }); return; }
      const target = database.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(userMatch[1]);
      if (!target) { sendJson(response, 404, { error: 'User not found' }); return; }
      const payload = await collectBody(request);
      const allowedRoles = ['Owner / Admin', 'Dispatcher', 'Safety', 'Maintenance', 'Accounting', 'Warehouse', 'Driver', 'HR'];
      if (payload.role && !allowedRoles.includes(payload.role)) { sendJson(response, 400, { error: 'Invalid role' }); return; }
      if (target.id === actor.id && payload.active === false) { sendJson(response, 400, { error: 'You cannot deactivate your own account' }); return; }
      const nextRole = payload.role || target.role;
      const nextActive = typeof payload.active === 'boolean' ? Number(payload.active) : Number(target.active);
      database.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(nextRole, nextActive, target.id);
      recordAudit(actor, 'Updated user', 'user', target.id, `role=${nextRole}; active=${Boolean(nextActive)}`);
      sendJson(response, 200, { ...target, role: nextRole, active: nextActive });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet') {
      sendJson(response, 200, readFleet());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/sops') {
      const user = authenticatedUser(request);
      sendJson(response, 200, readSops(user.id));
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance') {
      const user = authenticatedUser(request);
      if (!['Owner / Admin', 'Accounting'].includes(user.role)) { sendJson(response, 403, { error: 'Your role cannot view finance records' }); return; }
      sendJson(response, 200, readFinance());
      return;
    }
    if (requestUrl.pathname.startsWith('/api/finance/')) {
      const user = authenticatedUser(request);
      if (!financeAccess(user)) { sendJson(response, 403, { error: 'Your role cannot access finance records' }); return; }
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/entries') {
      sendJson(response, 200, readFinanceEntries());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/finance/entries') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const textFields = ['direction', 'category', 'description', 'paymentDate', 'status'];
      if (textFields.some(field => typeof payload[field] !== 'string' || !payload[field].trim())) { sendJson(response, 400, { error: 'direction, category, description, paymentDate, and status are required' }); return; }
      if (!['income', 'expense'].includes(payload.direction)) { sendJson(response, 400, { error: 'direction must be income or expense' }); return; }
      if (!['paid', 'scheduled'].includes(payload.status)) { sendJson(response, 400, { error: 'status must be paid or scheduled' }); return; }
      if (!Number.isSafeInteger(payload.amountCents) || payload.amountCents <= 0) { sendJson(response, 400, { error: 'amountCents must be a positive integer' }); return; }
      if (!validDate(payload.paymentDate)) { sendJson(response, 400, { error: 'paymentDate must be a valid YYYY-MM-DD date' }); return; }
      const category = payload.category.trim();
      const description = payload.description.trim();
      const counterparty = typeof payload.counterparty === 'string' ? payload.counterparty.trim() : '';
      const loadRef = typeof payload.loadRef === 'string' ? payload.loadRef.trim() : '';
      if (category.length > 50 || description.length > 200 || counterparty.length > 100 || loadRef.length > 80) { sendJson(response, 400, { error: 'category, description, counterparty, or loadRef is too long' }); return; }
      const miles = payload.miles === undefined || payload.miles === null || payload.miles === '' ? null : Number(payload.miles);
      if (miles !== null && (!Number.isFinite(miles) || miles <= 0 || miles > 1000000)) { sendJson(response, 400, { error: 'miles must be a positive number no greater than 1000000' }); return; }
      const fuelCostPerMileCents = payload.fuelCostPerMileCents === undefined ? 0 : payload.fuelCostPerMileCents;
      const driverPayPerMileCents = payload.driverPayPerMileCents === undefined ? 0 : payload.driverPayPerMileCents;
      if (!Number.isSafeInteger(fuelCostPerMileCents) || fuelCostPerMileCents < 0 || !Number.isSafeInteger(driverPayPerMileCents) || driverPayPerMileCents < 0) { sendJson(response, 400, { error: 'Per-mile costs must be non-negative integer cents' }); return; }
      if ((fuelCostPerMileCents > 0 || driverPayPerMileCents > 0) && miles === null) { sendJson(response, 400, { error: 'miles are required when entering per-mile costs' }); return; }
      if (payload.taxDeductible !== undefined && typeof payload.taxDeductible !== 'boolean') { sendJson(response, 400, { error: 'taxDeductible must be a boolean' }); return; }
      if (payload.taxDeductible === true && payload.direction !== 'expense') { sendJson(response, 400, { error: 'Only expense entries can be marked tax deductible' }); return; }
      const entry = {
        id: `FE-${crypto.randomBytes(10).toString('hex')}`, direction: payload.direction, category,
        description, counterparty, amountCents: payload.amountCents, paymentDate: payload.paymentDate,
        status: payload.status, loadRef, miles, fuelCostPerMileCents, driverPayPerMileCents,
        taxDeductible: payload.taxDeductible === true, createdBy: user.name, createdAt: new Date().toISOString()
      };
      database.prepare('INSERT INTO finance_entries (id, direction, category, description, counterparty, amount_cents, payment_date, status, load_ref, miles, fuel_cents_per_mile, driver_pay_cents_per_mile, tax_deductible, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(entry.id, entry.direction, entry.category, entry.description, entry.counterparty, entry.amountCents, entry.paymentDate, entry.status, entry.loadRef, entry.miles, entry.fuelCostPerMileCents, entry.driverPayPerMileCents, Number(entry.taxDeductible), entry.createdBy, entry.createdAt);
      recordAudit(user, 'Created finance entry', 'finance_entry', entry.id, `${entry.direction} · ${entry.category} · ${entry.amountCents} cents · ${entry.status}`);
      sendJson(response, 201, entry);
      return;
    }
    const financeEntryMatch = requestUrl.pathname.match(/^\/api\/finance\/entries\/([^/]+)$/);
    if (request.method === 'PATCH' && financeEntryMatch) {
      const user = authenticatedUser(request);
      const entry = database.prepare('SELECT id, direction, category, description, counterparty, amount_cents AS amountCents, payment_date AS paymentDate, status, load_ref AS loadRef, miles, created_by AS createdBy, created_at AS createdAt FROM finance_entries WHERE id = ?').get(financeEntryMatch[1]);
      if (!entry) { sendJson(response, 404, { error: 'Finance entry not found' }); return; }
      const payload = await collectBody(request);
      if (Object.keys(payload).some(field => !['status', 'paymentDate'].includes(field)) || !Object.keys(payload).length) { sendJson(response, 400, { error: 'Only status and paymentDate can be updated' }); return; }
      const status = payload.status === undefined ? entry.status : payload.status;
      const paymentDate = payload.paymentDate === undefined ? entry.paymentDate : payload.paymentDate;
      if (!['paid', 'scheduled'].includes(status)) { sendJson(response, 400, { error: 'status must be paid or scheduled' }); return; }
      if (!validDate(paymentDate)) { sendJson(response, 400, { error: 'paymentDate must be a valid YYYY-MM-DD date' }); return; }
      database.prepare('UPDATE finance_entries SET status = ?, payment_date = ? WHERE id = ?').run(status, paymentDate, entry.id);
      recordAudit(user, 'Updated finance entry', 'finance_entry', entry.id, `status=${status}; paymentDate=${paymentDate}`);
      sendJson(response, 200, { ...entry, status, paymentDate });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/summary') {
      sendJson(response, 200, calculateFinanceSummary());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/forecast') {
      sendJson(response, 200, calculateCashForecast());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/settings') {
      sendJson(response, 200, readFinanceSettings());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/accounts') {
      sendJson(response, 200, readCashAccounts());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/allocations') {
      sendJson(response, 200, readAllocations());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/finance/allocations') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const requestedSource = typeof payload.source === 'string' ? payload.source.trim().toLowerCase() : 'paid-margin';
      if (!['paid-margin', 'auto', 'cash-sweep'].includes(requestedSource)) { sendJson(response, 400, { error: 'source must be paid-margin, auto, or cash-sweep' }); return; }
      const proposal = buildAllocationProposal(requestedSource);
      const allocation = { id: `ALLOC-${crypto.randomBytes(8).toString('hex')}`, ...proposal, status: 'proposed', createdBy: user.name, createdAt: new Date().toISOString(), approvedBy: '', approvedAt: '' };
      database.prepare('INSERT INTO finance_allocations (id, source, source_cents, cash_floor_cents, available_cash_cents, allocations_json, status, created_by, created_at, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(allocation.id, allocation.source, allocation.sourceCents, allocation.cashFloorCents, allocation.availableCashCents, JSON.stringify(allocation.allocations), allocation.status, allocation.createdBy, allocation.createdAt, allocation.approvedBy, allocation.approvedAt);
      recordAudit(user, 'Created finance allocation proposal', 'finance_allocation', allocation.id, `${allocation.sourceCents} cents across ${allocation.allocations.length} categories from ${allocation.source}`);
      sendJson(response, 201, allocation);
      return;
    }
    const allocationMatch = requestUrl.pathname.match(/^\/api\/finance\/allocations\/([^/]+)$/);
    if (request.method === 'PATCH' && allocationMatch) {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can approve finance allocations' }); return; }
      const allocation = database.prepare('SELECT id, source, source_cents AS sourceCents, cash_floor_cents AS cashFloorCents, available_cash_cents AS availableCashCents, allocations_json AS allocationsJson, status, created_by AS createdBy, created_at AS createdAt, approved_by AS approvedBy, approved_at AS approvedAt FROM finance_allocations WHERE id = ?').get(allocationMatch[1]);
      if (!allocation) { sendJson(response, 404, { error: 'Finance allocation not found' }); return; }
      const payload = await collectBody(request);
      if (!['approved', 'cancelled'].includes(payload.status)) { sendJson(response, 400, { error: 'status must be approved or cancelled' }); return; }
      if (allocation.status !== 'proposed') { sendJson(response, 409, { error: 'Only proposed allocations can be approved or cancelled' }); return; }
      const approvedBy = payload.status === 'approved' ? user.name : '';
      const approvedAt = payload.status === 'approved' ? new Date().toISOString() : '';
      database.prepare('UPDATE finance_allocations SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?').run(payload.status, approvedBy, approvedAt, allocation.id);
      recordAudit(user, `${payload.status === 'approved' ? 'Approved' : 'Cancelled'} finance allocation proposal`, 'finance_allocation', allocation.id, `${allocation.sourceCents} cents; execution remains pending`);
      sendJson(response, 200, { ...allocation, allocations: JSON.parse(allocation.allocationsJson), cashFloorWarning: allocation.availableCashCents < allocation.cashFloorCents, status: payload.status, approvedBy, approvedAt });
      return;
    }
    const allocationExecutionMatch = requestUrl.pathname.match(/^\/api\/finance\/allocations\/([^/]+)\/execute$/);
    if (request.method === 'POST' && allocationExecutionMatch) {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can execute finance allocations' }); return; }
      const payload = await collectBody(request);
      const idempotencyKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : '';
      if (!idempotencyKey || idempotencyKey.length > 120) { sendJson(response, 400, { error: 'A unique idempotencyKey up to 120 characters is required' }); return; }
      const existingKey = database.prepare('SELECT id, allocation_id AS allocationId, transfers_json AS transfersJson, source_account_id AS sourceAccountId, created_by AS createdBy, created_at AS createdAt FROM finance_allocation_executions WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingKey && existingKey.allocationId !== allocationExecutionMatch[1]) { sendJson(response, 409, { error: 'This idempotencyKey was already used for another allocation' }); return; }
      if (existingKey) {
        sendJson(response, 200, { id: existingKey.id, allocationId: existingKey.allocationId, status: 'executed', idempotencyKey, sourceAccountId: existingKey.sourceAccountId, transfers: JSON.parse(existingKey.transfersJson), createdBy: existingKey.createdBy, createdAt: existingKey.createdAt, replayed: true });
        return;
      }
      const allocation = database.prepare('SELECT id, source, source_cents AS sourceCents, cash_floor_cents AS cashFloorCents, allocations_json AS allocationsJson, status, created_by AS createdBy, created_at AS createdAt FROM finance_allocations WHERE id = ?').get(allocationExecutionMatch[1]);
      if (!allocation) { sendJson(response, 404, { error: 'Finance allocation not found' }); return; }
      if (allocation.status !== 'approved') { sendJson(response, 409, { error: 'Only approved allocations can be executed' }); return; }
      const sourceAccount = database.prepare("SELECT id, name, balance_cents AS balanceCents, reserved_cents AS reservedCents FROM cash_accounts WHERE active = 1 AND account_type = 'cash' ORDER BY id LIMIT 1").get();
      if (!sourceAccount) { sendJson(response, 409, { error: 'An active cash source account is required' }); return; }
      const planned = JSON.parse(allocation.allocationsJson);
      const transfers = planned.filter(item => item.accountType !== 'cash' && item.accountId && item.amountCents > 0).map(item => ({ accountId: item.accountId, accountName: item.accountName, category: item.category, amountCents: item.amountCents }));
      if (transfers.length !== planned.filter(item => item.amountCents > 0 && item.accountType !== 'cash').length) { sendJson(response, 409, { error: 'Every non-cash allocation must still map to an active account' }); return; }
      const outgoingCents = transfers.reduce((total, transfer) => total + transfer.amountCents, 0);
      if (sourceAccount.balanceCents - outgoingCents < allocation.cashFloorCents) { sendJson(response, 409, { error: 'Execution would reduce the source account below the configured cash floor' }); return; }
      const execution = { id: `ALLEX-${crypto.randomBytes(8).toString('hex')}`, allocationId: allocation.id, status: 'executed', idempotencyKey, sourceAccountId: sourceAccount.id, transfers, createdBy: user.name, createdAt: new Date().toISOString(), replayed: false };
      try {
        database.exec('BEGIN IMMEDIATE');
        database.prepare('UPDATE cash_accounts SET balance_cents = balance_cents - ?, updated_at = ? WHERE id = ?').run(outgoingCents, execution.createdAt, sourceAccount.id);
        for (const transfer of transfers) database.prepare('UPDATE cash_accounts SET balance_cents = balance_cents + ?, reserved_cents = MIN(balance_cents + ?, reserved_cents + ?), updated_at = ? WHERE id = ? AND active = 1').run(transfer.amountCents, transfer.amountCents, transfer.amountCents, execution.createdAt, transfer.accountId);
        database.prepare('UPDATE finance_allocations SET status = ? WHERE id = ?').run('executed', allocation.id);
        database.prepare('INSERT INTO finance_allocation_executions (id, allocation_id, idempotency_key, source_account_id, transfers_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(execution.id, execution.allocationId, execution.idempotencyKey, execution.sourceAccountId, JSON.stringify(execution.transfers), execution.createdBy, execution.createdAt);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      recordAudit(user, 'Executed simulated finance allocation', 'finance_allocation', allocation.id, `${outgoingCents} cents from ${sourceAccount.name}; idempotency=${idempotencyKey}`);
      sendJson(response, 200, execution);
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/finance/accounts') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const category = typeof payload.category === 'string' ? payload.category.trim() : '';
      const accountType = typeof payload.accountType === 'string' ? payload.accountType.trim() : '';
      if (!name || !category || !accountType) { sendJson(response, 400, { error: 'name, category, and accountType are required' }); return; }
      if (!['cash', 'reserve', 'tax', 'insurance', 'maintenance', 'payroll', 'savings', 'fuel', 'gas'].includes(accountType)) { sendJson(response, 400, { error: 'accountType must be cash, reserve, tax, insurance, maintenance, payroll, savings, fuel, or gas' }); return; }
      if (!Number.isSafeInteger(payload.balanceCents) || payload.balanceCents < 0) { sendJson(response, 400, { error: 'balanceCents must be a non-negative integer' }); return; }
      if (!Number.isSafeInteger(payload.reservedCents) || payload.reservedCents < 0 || payload.reservedCents > payload.balanceCents) { sendJson(response, 400, { error: 'reservedCents must be a non-negative integer no greater than balanceCents' }); return; }
      const existing = database.prepare('SELECT id FROM cash_accounts WHERE name = ? COLLATE NOCASE').get(name);
      if (existing) { sendJson(response, 409, { error: 'A cash account with this name already exists' }); return; }
      const account = { id: `ACC-${crypto.randomBytes(8).toString('hex')}`, name, category, accountType, balanceCents: payload.balanceCents, reservedCents: payload.reservedCents, active: payload.active !== false, createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO cash_accounts (id, name, category, account_type, balance_cents, reserved_cents, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(account.id, account.name, account.category, account.accountType, account.balanceCents, account.reservedCents, Number(account.active), account.createdBy, account.createdAt, account.createdAt);
      recordAudit(user, 'Created cash account', 'cash_account', account.id, `${account.category} · ${account.name} · ${account.balanceCents} cents`);
      sendJson(response, 201, { ...account, updatedAt: account.createdAt });
      return;
    }
    const cashAccountMatch = requestUrl.pathname.match(/^\/api\/finance\/accounts\/([^/]+)$/);
    if (request.method === 'PATCH' && cashAccountMatch) {
      const user = authenticatedUser(request);
      const account = database.prepare('SELECT id, name, category, account_type AS accountType, balance_cents AS balanceCents, reserved_cents AS reservedCents, active FROM cash_accounts WHERE id = ?').get(cashAccountMatch[1]);
      if (!account) { sendJson(response, 404, { error: 'Cash account not found' }); return; }
      const payload = await collectBody(request);
      const next = { ...account, ...payload };
      const name = typeof payload.name === 'string' ? payload.name.trim() : account.name;
      const category = typeof payload.category === 'string' ? payload.category.trim() : account.category;
      const accountType = typeof payload.accountType === 'string' ? payload.accountType.trim() : account.accountType;
      if (!name || !category || !accountType) { sendJson(response, 400, { error: 'name, category, and accountType are required' }); return; }
      if (!['cash', 'reserve', 'tax', 'insurance', 'maintenance', 'payroll', 'savings', 'fuel', 'gas'].includes(accountType)) { sendJson(response, 400, { error: 'accountType must be a supported bucket type' }); return; }
      const balanceCents = payload.balanceCents === undefined ? account.balanceCents : payload.balanceCents;
      const reservedCents = payload.reservedCents === undefined ? account.reservedCents : payload.reservedCents;
      if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) { sendJson(response, 400, { error: 'balanceCents must be a non-negative integer' }); return; }
      if (!Number.isSafeInteger(reservedCents) || reservedCents < 0 || reservedCents > balanceCents) { sendJson(response, 400, { error: 'reservedCents must be a non-negative integer no greater than balanceCents' }); return; }
      const active = payload.active === undefined ? Number(account.active) : Number(payload.active === true);
      const updatedAt = new Date().toISOString();
      database.prepare('UPDATE cash_accounts SET name = ?, category = ?, account_type = ?, balance_cents = ?, reserved_cents = ?, active = ?, updated_at = ? WHERE id = ?').run(name, category, accountType, balanceCents, reservedCents, active, updatedAt, account.id);
      recordAudit(user, 'Updated cash account', 'cash_account', account.id, `${category} · ${name} · ${balanceCents} cents`);
      sendJson(response, 200, { id: account.id, name, category, accountType, balanceCents, reservedCents, active: Boolean(active), updatedAt });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/collections') {
      sendJson(response, 200, readCollectionsOverview());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/collections/tasks') {
      sendJson(response, 200, readCollectionTasks());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/finance/collections/tasks') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId.trim() : '';
      const actionType = typeof payload.actionType === 'string' ? payload.actionType.trim() : '';
      const dueDate = typeof payload.dueDate === 'string' ? payload.dueDate.trim() : '';
      const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
      if (!invoiceId || !actionType || !dueDate || actionType.length > 80 || notes.length > 1000 || !validDate(dueDate)) { sendJson(response, 400, { error: 'invoiceId, actionType, a valid dueDate, and notes up to 1000 characters are required' }); return; }
      const invoice = database.prepare('SELECT id, counterparty_id AS counterpartyId FROM invoices WHERE id = ?').get(invoiceId);
      if (!invoice) { sendJson(response, 404, { error: 'Invoice not found' }); return; }
      const task = { id: `COL-${crypto.randomBytes(8).toString('hex')}`, invoiceId, counterpartyId: invoice.counterpartyId, actionType, dueDate, status: 'open', notes, createdBy: user.name, createdAt: new Date().toISOString(), completedBy: '', completedAt: '' };
      database.prepare('INSERT INTO collection_tasks (id, invoice_id, counterparty_id, action_type, due_date, status, notes, created_by, created_at, completed_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, task.invoiceId, task.counterpartyId, task.actionType, task.dueDate, task.status, task.notes, task.createdBy, task.createdAt, task.completedBy, task.completedAt);
      recordAudit(user, 'Created collection follow-up task', 'collection_task', task.id, `${task.invoiceId} · ${task.actionType} · due ${task.dueDate}`);
      sendJson(response, 201, task);
      return;
    }
    const collectionTaskMatch = requestUrl.pathname.match(/^\/api\/finance\/collections\/tasks\/([^/]+)$/);
    if (request.method === 'PATCH' && collectionTaskMatch) {
      const user = authenticatedUser(request);
      const task = database.prepare('SELECT id, invoice_id AS invoiceId, counterparty_id AS counterpartyId, action_type AS actionType, due_date AS dueDate, status, notes, created_by AS createdBy, created_at AS createdAt, completed_by AS completedBy, completed_at AS completedAt FROM collection_tasks WHERE id = ?').get(collectionTaskMatch[1]);
      if (!task) { sendJson(response, 404, { error: 'Collection task not found' }); return; }
      const payload = await collectBody(request);
      if (!Object.keys(payload).length || Object.keys(payload).some(field => !['status', 'dueDate', 'notes'].includes(field))) { sendJson(response, 400, { error: 'Only status, dueDate, and notes can be updated' }); return; }
      const status = payload.status === undefined ? task.status : payload.status;
      const dueDate = payload.dueDate === undefined ? task.dueDate : payload.dueDate;
      const notes = payload.notes === undefined ? task.notes : payload.notes;
      if (!['open', 'completed', 'cancelled'].includes(status) || !validDate(dueDate) || typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'Provide a valid task status, dueDate, and notes up to 1000 characters' }); return; }
      const completedBy = status === 'completed' ? user.name : '';
      const completedAt = status === 'completed' ? new Date().toISOString() : '';
      database.prepare('UPDATE collection_tasks SET status = ?, due_date = ?, notes = ?, completed_by = ?, completed_at = ? WHERE id = ?').run(status, dueDate, notes.trim(), completedBy, completedAt, task.id);
      recordAudit(user, 'Updated collection follow-up task', 'collection_task', task.id, `status=${status}; due=${dueDate}`);
      sendJson(response, 200, { ...task, status, dueDate, notes: notes.trim(), completedBy, completedAt });
      return;
    }
    if (request.method === 'PATCH' && requestUrl.pathname === '/api/finance/settings') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const current = readFinanceSettings();
      const allowed = ['currentCashCents', 'weeklyCashFloorCents', 'taxPercent', 'insurancePercent', 'maintenancePercent', 'scalingPercent', 'profitPercent'];
      if (!Object.keys(payload).length || Object.keys(payload).some(field => !allowed.includes(field))) { sendJson(response, 400, { error: 'Provide one or more supported finance settings' }); return; }
      const next = { ...current, ...payload };
      for (const field of ['currentCashCents', 'weeklyCashFloorCents']) {
        if (!Number.isSafeInteger(next[field]) || next[field] < 0) { sendJson(response, 400, { error: `${field} must be a non-negative integer` }); return; }
      }
      const percentageFields = ['taxPercent', 'insurancePercent', 'maintenancePercent', 'scalingPercent', 'profitPercent'];
      if (percentageFields.some(field => typeof next[field] !== 'number' || !Number.isFinite(next[field]) || next[field] < 0 || next[field] > 100)) { sendJson(response, 400, { error: 'Reserve percentages must be numbers from 0 to 100' }); return; }
      if (Math.abs(percentageFields.reduce((total, field) => total + next[field], 0) - 100) > 0.01) { sendJson(response, 400, { error: 'Reserve percentages must total 100' }); return; }
      const updatedAt = new Date().toISOString();
      database.prepare('UPDATE finance_settings SET current_cash_cents = ?, weekly_cash_floor_cents = ?, tax_percent = ?, insurance_percent = ?, maintenance_percent = ?, scaling_percent = ?, profit_percent = ?, updated_by = ?, updated_at = ? WHERE id = 1').run(next.currentCashCents, next.weeklyCashFloorCents, next.taxPercent, next.insurancePercent, next.maintenancePercent, next.scalingPercent, next.profitPercent, user.name, updatedAt);
      recordAudit(user, 'Updated finance settings', 'finance_settings', '1', `cash=${next.currentCashCents}; weeklyFloor=${next.weeklyCashFloorCents}; reserveTotal=100%`);
      sendJson(response, 200, readFinanceSettings());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/budgets') {
      const month = new Date().toISOString().slice(0, 7);
      const budgets = database.prepare('SELECT category, budget_cents AS budgetCents, updated_at AS updatedAt FROM finance_budgets ORDER BY category').all();
      sendJson(response, 200, budgets.map(budget => {
        const spentCents = Number(database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_entries WHERE direction = 'expense' AND category = ? AND status = 'paid' AND substr(payment_date, 1, 7) = ?").get(budget.category, month).total);
        return { ...budget, spentCents, remainingCents: budget.budgetCents - spentCents };
      }));
      return;
    }
    const budgetMatch = requestUrl.pathname.match(/^\/api\/finance\/budgets\/([^/]+)$/);
    if (request.method === 'PUT' && budgetMatch) {
      const user = authenticatedUser(request);
      const category = decodeURIComponent(budgetMatch[1]).trim();
      const payload = await collectBody(request);
      if (!category || category.length > 50 || !Number.isSafeInteger(payload.budgetCents) || payload.budgetCents < 0) { sendJson(response, 400, { error: 'A category up to 50 characters and non-negative integer budgetCents are required' }); return; }
      const updatedAt = new Date().toISOString();
      database.prepare('INSERT INTO finance_budgets (category, budget_cents, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET budget_cents = excluded.budget_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at').run(category, payload.budgetCents, user.name, updatedAt);
      recordAudit(user, 'Updated finance budget', 'finance_budget', category, `${payload.budgetCents} cents for ${new Date().toISOString().slice(0, 7)}`);
      const spentCents = Number(database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_entries WHERE direction = 'expense' AND category = ? AND status = 'paid' AND substr(payment_date, 1, 7) = ?").get(category, new Date().toISOString().slice(0, 7)).total);
      sendJson(response, 200, { category, budgetCents: payload.budgetCents, spentCents, remainingCents: payload.budgetCents - spentCents, updatedAt });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/counterparties') {
      sendJson(response, 200, readCounterparties());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/finance/counterparties') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 120) { sendJson(response, 400, { error: 'A counterparty name up to 120 characters is required' }); return; }
      if (!['customer', 'vendor', 'both'].includes(payload.kind)) { sendJson(response, 400, { error: 'kind must be customer, vendor, or both' }); return; }
      const termsDays = payload.termsDays === undefined ? 30 : payload.termsDays;
      if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 120) { sendJson(response, 400, { error: 'termsDays must be an integer from 0 to 120' }); return; }
      const fields = { contactName: 100, email: 254, phone: 40, address: 300, notes: 1000 };
      for (const [field, maxLength] of Object.entries(fields)) if (payload[field] !== undefined && (typeof payload[field] !== 'string' || payload[field].length > maxLength)) { sendJson(response, 400, { error: `${field} must be text up to ${maxLength} characters` }); return; }
      const name = payload.name.trim();
      if (database.prepare('SELECT id FROM counterparties WHERE name = ? COLLATE NOCASE').get(name)) { sendJson(response, 409, { error: 'A counterparty with this name already exists' }); return; }
      const counterparty = { id: `PTY-${crypto.randomBytes(8).toString('hex')}`, name, kind: payload.kind, contactName: (payload.contactName || '').trim(), email: (payload.email || '').trim(), phone: (payload.phone || '').trim(), address: (payload.address || '').trim(), termsDays, notes: (payload.notes || '').trim(), createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO counterparties (id, name, kind, contact_name, email, phone, address, terms_days, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(counterparty.id, counterparty.name, counterparty.kind, counterparty.contactName, counterparty.email, counterparty.phone, counterparty.address, counterparty.termsDays, counterparty.notes, counterparty.createdBy, counterparty.createdAt);
      recordAudit(user, 'Created finance counterparty', 'counterparty', counterparty.id, `${counterparty.kind} · ${counterparty.name}`);
      sendJson(response, 201, counterparty);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/invoices') {
      sendJson(response, 200, readInvoices());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/finance/invoices') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const required = ['kind', 'invoiceNumber', 'counterpartyId', 'amountCents', 'issuedDate', 'dueDate'];
      if (required.some(field => payload[field] === undefined || payload[field] === null || payload[field] === '')) { sendJson(response, 400, { error: 'kind, invoiceNumber, counterpartyId, amountCents, issuedDate, and dueDate are required' }); return; }
      if (!['receivable', 'payable'].includes(payload.kind)) { sendJson(response, 400, { error: 'kind must be receivable or payable' }); return; }
      if (typeof payload.invoiceNumber !== 'string' || payload.invoiceNumber.trim().length > 80) { sendJson(response, 400, { error: 'invoiceNumber must be text up to 80 characters' }); return; }
      if (!Number.isSafeInteger(payload.amountCents) || payload.amountCents <= 0) { sendJson(response, 400, { error: 'amountCents must be a positive integer' }); return; }
      if (!validDate(payload.issuedDate) || !validDate(payload.dueDate) || payload.dueDate < payload.issuedDate) { sendJson(response, 400, { error: 'issuedDate and dueDate must be valid dates, and dueDate cannot precede issuedDate' }); return; }
      const counterparty = database.prepare('SELECT id, name, kind, terms_days AS termsDays FROM counterparties WHERE id = ?').get(payload.counterpartyId);
      if (!counterparty) { sendJson(response, 404, { error: 'Counterparty not found' }); return; }
      if (counterparty.kind !== 'both' && counterparty.kind !== (payload.kind === 'receivable' ? 'customer' : 'vendor')) { sendJson(response, 400, { error: 'Counterparty type does not match invoice type' }); return; }
      const invoiceNumber = payload.invoiceNumber.trim();
      if (!invoiceNumber) { sendJson(response, 400, { error: 'invoiceNumber cannot be empty' }); return; }
      const loadRef = typeof payload.loadRef === 'string' ? payload.loadRef.trim() : '';
      if (loadRef.length > 80) { sendJson(response, 400, { error: 'loadRef must be up to 80 characters' }); return; }
      if (database.prepare('SELECT id FROM invoices WHERE kind = ? AND invoice_number = ?').get(payload.kind, invoiceNumber)) { sendJson(response, 409, { error: 'Invoice number already exists for this record type' }); return; }
      const invoice = { id: `INV-${crypto.randomBytes(8).toString('hex')}`, kind: payload.kind, invoiceNumber, counterpartyId: counterparty.id, counterparty: counterparty.name, contactName: '', email: '', phone: '', address: '', loadRef, amountCents: payload.amountCents, issuedDate: payload.issuedDate, dueDate: payload.dueDate, status: 'open', paymentReference: '', paidAt: '', createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO invoices (id, kind, invoice_number, counterparty_id, load_ref, amount_cents, issued_date, due_date, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invoice.id, invoice.kind, invoice.invoiceNumber, invoice.counterpartyId, invoice.loadRef, invoice.amountCents, invoice.issuedDate, invoice.dueDate, invoice.status, invoice.createdBy, invoice.createdAt);
      recordAudit(user, `Created ${invoice.kind}`, 'invoice', invoice.id, `${invoice.invoiceNumber} · ${invoice.counterparty} · ${invoice.amountCents} cents`);
      sendJson(response, 201, invoice);
      return;
    }
    const invoiceFromLoadMatch = requestUrl.pathname.match(/^\/api\/finance\/invoices\/from-load\/([^/]+)$/);
    if (request.method === 'POST' && invoiceFromLoadMatch) {
      const user = authenticatedUser(request);
      const load = database.prepare('SELECT id, customer, revenue, status FROM loads WHERE id = ?').get(invoiceFromLoadMatch[1]);
      if (!load) { sendJson(response, 404, { error: 'Load not found' }); return; }
      if (load.status !== 'Delivered') { sendJson(response, 409, { error: 'Only delivered loads can generate an invoice' }); return; }
      const existing = database.prepare("SELECT id FROM invoices WHERE kind = 'receivable' AND load_ref = ? AND status != 'void'").get(load.id);
      if (existing) { sendJson(response, 409, { error: 'An open or paid invoice already exists for this load' }); return; }
      const amount = Number(String(load.revenue).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) { sendJson(response, 400, { error: 'Load revenue is not a valid invoice amount' }); return; }
      let counterparty = database.prepare('SELECT id, name, terms_days AS termsDays FROM counterparties WHERE name = ? COLLATE NOCASE').get(load.customer);
      if (!counterparty) {
        const now = new Date().toISOString();
        counterparty = { id: `PTY-${crypto.randomBytes(8).toString('hex')}`, name: load.customer, termsDays: 30 };
        database.prepare("INSERT INTO counterparties (id, name, kind, terms_days, created_by, created_at) VALUES (?, ?, 'customer', ?, ?, ?)").run(counterparty.id, counterparty.name, counterparty.termsDays, user.name, now);
        recordAudit(user, 'Created finance counterparty', 'counterparty', counterparty.id, `customer · ${counterparty.name} · created from delivered load`);
      }
      const issuedDate = new Date().toISOString().slice(0, 10);
      const invoice = { id: `INV-${crypto.randomBytes(8).toString('hex')}`, kind: 'receivable', invoiceNumber: `INV-${load.id}`, counterpartyId: counterparty.id, counterparty: counterparty.name, loadRef: load.id, amountCents: Math.round(amount * 100), issuedDate, dueDate: dateAtUtcOffset(issuedDate, counterparty.termsDays), status: 'open', paymentReference: '', paidAt: '', createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO invoices (id, kind, invoice_number, counterparty_id, load_ref, amount_cents, issued_date, due_date, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invoice.id, invoice.kind, invoice.invoiceNumber, invoice.counterpartyId, invoice.loadRef, invoice.amountCents, invoice.issuedDate, invoice.dueDate, invoice.status, invoice.createdBy, invoice.createdAt);
      recordAudit(user, 'Generated receivable from load', 'invoice', invoice.id, `${invoice.invoiceNumber} · ${invoice.amountCents} cents · due ${invoice.dueDate}`);
      sendJson(response, 201, invoice);
      return;
    }
    const invoicePaymentMatch = requestUrl.pathname.match(/^\/api\/finance\/invoices\/([^/]+)\/payments$/);
    if (request.method === 'POST' && invoicePaymentMatch) {
      const user = authenticatedUser(request);
      const invoice = database.prepare('SELECT id, kind, amount_cents AS amountCents, status FROM invoices WHERE id = ?').get(invoicePaymentMatch[1]);
      if (!invoice) { sendJson(response, 404, { error: 'Invoice not found' }); return; }
      if (invoice.status === 'void') { sendJson(response, 409, { error: 'Void invoices cannot receive payments' }); return; }
      if (invoice.status === 'paid') { sendJson(response, 409, { error: 'Paid invoices cannot receive additional payments' }); return; }
      const payload = await collectBody(request);
      const paymentDate = typeof payload.paymentDate === 'string' ? payload.paymentDate.trim() : '';
      const reference = typeof payload.reference === 'string' ? payload.reference.trim() : '';
      const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
      if (!Number.isSafeInteger(payload.amountCents) || payload.amountCents <= 0 || !validDate(paymentDate) || !reference || reference.length > 100 || notes.length > 1000) { sendJson(response, 400, { error: 'amountCents, valid paymentDate, reference, and notes up to 1000 characters are required' }); return; }
      const paidCents = Number(database.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_payments WHERE invoice_id = ?').get(invoice.id).total);
      const balanceCents = invoice.amountCents - paidCents;
      if (payload.amountCents > balanceCents) { sendJson(response, 400, { error: `Payment cannot exceed the remaining invoice balance of ${balanceCents} cents` }); return; }
      const nextPaidCents = paidCents + payload.amountCents;
      const invoiceStatus = nextPaidCents === invoice.amountCents ? 'paid' : 'open';
      const createdAt = new Date().toISOString();
      const payment = { id: `PAY-${crypto.randomBytes(8).toString('hex')}`, invoiceId: invoice.id, amountCents: payload.amountCents, paymentDate, reference, notes, createdBy: user.name, createdAt, invoiceStatus, paidCents: nextPaidCents, balanceCents: invoice.amountCents - nextPaidCents };
      database.prepare('INSERT INTO invoice_payments (id, invoice_id, amount_cents, payment_date, reference, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(payment.id, payment.invoiceId, payment.amountCents, payment.paymentDate, payment.reference, payment.notes, payment.createdBy, payment.createdAt);
      if (invoiceStatus === 'paid') database.prepare("UPDATE invoices SET status = 'paid', payment_reference = ?, paid_at = ? WHERE id = ?").run(reference, createdAt, invoice.id);
      recordAudit(user, 'Recorded invoice payment', 'invoice_payment', payment.id, `${payment.invoiceId} · ${payment.amountCents} cents · balance ${payment.balanceCents} cents`);
      sendJson(response, 201, payment);
      return;
    }
    const invoiceMatch = requestUrl.pathname.match(/^\/api\/finance\/invoices\/([^/]+)$/);
    if (request.method === 'PATCH' && invoiceMatch) {
      const user = authenticatedUser(request);
      const invoice = database.prepare('SELECT id, kind, invoice_number AS invoiceNumber, status, payment_reference AS paymentReference FROM invoices WHERE id = ?').get(invoiceMatch[1]);
      if (!invoice) { sendJson(response, 404, { error: 'Invoice not found' }); return; }
      const payload = await collectBody(request);
      if (!Object.keys(payload).length || Object.keys(payload).some(field => !['status', 'paymentReference'].includes(field))) { sendJson(response, 400, { error: 'Only status and paymentReference can be updated' }); return; }
      const status = payload.status === undefined ? invoice.status : payload.status;
      const paymentReference = payload.paymentReference === undefined ? invoice.paymentReference : payload.paymentReference;
      if (!['open', 'paid', 'void'].includes(status)) { sendJson(response, 400, { error: 'status must be open, paid, or void' }); return; }
      if (typeof paymentReference !== 'string' || paymentReference.length > 100) { sendJson(response, 400, { error: 'paymentReference must be text up to 100 characters' }); return; }
      if (status === 'paid' && invoice.kind === 'receivable' && !paymentReference.trim()) { sendJson(response, 400, { error: 'Enter the payment reference or receipt note before marking a receivable paid' }); return; }
      const paidAt = status === 'paid' ? new Date().toISOString() : '';
      database.prepare('UPDATE invoices SET status = ?, payment_reference = ?, paid_at = ? WHERE id = ?').run(status, paymentReference.trim(), paidAt, invoice.id);
      recordAudit(user, 'Updated invoice status', 'invoice', invoice.id, `status=${status}; paymentReference=${paymentReference.trim()}`);
      sendJson(response, 200, { ...invoice, status, paymentReference: paymentReference.trim(), paidAt });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/finance/reconciliation') {
      sendJson(response, 200, readReconciliation());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/warehouses') {
      const user = authenticatedUser(request);
      if (!['Owner / Admin', 'Warehouse', 'Dispatcher'].includes(user.role)) { sendJson(response, 403, { error: 'Your role cannot view warehouse records' }); return; }
      sendJson(response, 200, readWarehouses());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/documents') {
      const user = authenticatedUser(request);
      sendJson(response, 200, readDocuments(user));
      return;
    }
    const documentFileMatch = requestUrl.pathname.match(/^\/api\/documents\/([^/]+)\/file$/);
    if (request.method === 'GET' && documentFileMatch) {
      const user = authenticatedUser(request);
      const document = database.prepare('SELECT id, type FROM documents WHERE id = ?').get(documentFileMatch[1]);
      if (!document) { sendJson(response, 404, { error: 'Document attachment not found' }); return; }
      if (!canAccessDocumentType(user, document.type)) { sendJson(response, 403, { error: 'Your role cannot access this document type' }); return; }
      const file = database.prepare('SELECT d.id, f.original_name AS originalName, f.mime_type AS mimeType, f.file_data AS fileData FROM document_files f JOIN documents d ON d.id = f.document_id WHERE d.id = ?').get(documentFileMatch[1]);
      if (!file) { sendJson(response, 404, { error: 'Document attachment not found' }); return; }
      const safeFileName = file.originalName.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'attachment';
      recordAudit(user, 'Downloaded document attachment', 'document', file.id, `file=${safeFileName}`);
      response.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Length': file.fileData.length, 'Content-Disposition': `attachment; filename="${safeFileName}"`, 'X-Content-Type-Options': 'nosniff' });
      response.end(file.fileData);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/notifications') {
      sendJson(response, 200, readNotifications());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/documents') {
      const user = authenticatedUser(request);
      const payload = await collectBody(request);
      const required = ['name', 'type', 'reference', 'status'];
      if (required.some(field => typeof payload[field] !== 'string' || !payload[field].trim())) { sendJson(response, 400, { error: 'name, type, reference, and status are required' }); return; }
      if (!canAccessDocumentType(user, payload.type.trim())) { sendJson(response, 403, { error: 'Your role cannot add this document type' }); return; }
      const hasFileFields = ['fileName', 'mimeType', 'fileBase64'].some(field => payload[field] !== undefined);
      let fileData = null;
      if (hasFileFields) {
        if (typeof payload.fileName !== 'string' || !payload.fileName.trim() || payload.fileName.length > 180 || typeof payload.mimeType !== 'string' || typeof payload.fileBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.fileBase64)) { sendJson(response, 400, { error: 'fileName, a supported mimeType, and valid fileBase64 are required together' }); return; }
        fileData = Buffer.from(payload.fileBase64, 'base64');
        if (!fileData.length || fileData.length > 524288) { sendJson(response, 413, { error: 'Attachment size must be between 1 byte and 512 KB' }); return; }
        const signatures = {
          'application/pdf': fileData.subarray(0, 5).toString('ascii') === '%PDF-',
          'image/png': fileData.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          'image/jpeg': fileData.length >= 3 && fileData[0] === 0xff && fileData[1] === 0xd8 && fileData[2] === 0xff
        };
        if (!signatures[payload.mimeType]) { sendJson(response, 400, { error: 'Only signature-verified PDF, PNG, and JPEG attachments are accepted' }); return; }
      }
      const document = { id: `DOC-${crypto.randomBytes(8).toString('hex')}`, ...Object.fromEntries(required.map(field => [field, payload[field].trim()])), owner: user.role, createdAt: new Date().toISOString(), hasFile: Boolean(fileData), fileName: fileData ? payload.fileName.trim() : null, mimeType: fileData ? payload.mimeType : null, fileSize: fileData ? fileData.length : null };
      database.prepare('INSERT INTO documents (id, name, type, reference, owner, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(document.id, document.name, document.type, document.reference, document.owner, document.status, document.createdAt);
      if (fileData) database.prepare('INSERT INTO document_files (document_id, original_name, mime_type, byte_size, file_data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(document.id, document.fileName, document.mimeType, fileData.length, fileData, document.createdAt);
      recordAudit(user, 'Added document metadata', 'document', document.id, `${document.type} · ${document.reference}`);
      if (fileData) recordAudit(user, 'Uploaded document attachment', 'document', document.id, `${document.fileName} · ${document.mimeType} · ${document.fileSize} bytes`);
      sendJson(response, 201, document);
      return;
    }
    const sopMatch = requestUrl.pathname.match(/^\/api\/sops\/([^/]+)\/acknowledge$/);
    if (request.method === 'POST' && sopMatch) {
      const user = authenticatedUser(request);
      const sop = database.prepare('SELECT code, name, version FROM sops WHERE code = ? AND active = 1').get(sopMatch[1]);
      if (!sop) { sendJson(response, 404, { error: 'SOP not found' }); return; }
      const acknowledgedAt = new Date().toISOString();
      database.prepare('INSERT INTO sop_acknowledgments (sop_code, user_id, acknowledged_at) VALUES (?, ?, ?) ON CONFLICT(sop_code, user_id) DO UPDATE SET acknowledged_at = excluded.acknowledged_at').run(sop.code, user.id, acknowledgedAt);
      recordAudit(user, 'Acknowledged SOP', 'sop', sop.code, `${sop.name} · version ${sop.version}`);
      sendJson(response, 200, { code: sop.code, acknowledged: true, acknowledgedAt });
      return;
    }
    const tripRouteMatch = requestUrl.pathname.match(/^\/api\/fleet\/trips\/([^/]+)$/);
    if (request.method === 'PATCH' && tripRouteMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'trip:create')) { sendJson(response, 403, { error: 'Your role cannot update trip plans' }); return; }
      const plan = database.prepare('SELECT id, dispatch_status AS dispatchStatus, dispatch_notes AS dispatchNotes, confirmed_by AS confirmedBy, confirmed_at AS confirmedAt FROM trip_plans WHERE id = ?').get(tripRouteMatch[1]);
      if (!plan) { sendJson(response, 404, { error: 'Trip plan not found' }); return; }
      const payload = await collectBody(request);
      const status = typeof payload.status === 'string' ? payload.status.trim() : '';
      const notes = payload.notes === undefined ? plan.dispatchNotes : payload.notes;
      if (!['draft', 'confirmed', 'in_progress', 'completed', 'cancelled'].includes(status) || typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'Provide a supported trip status and notes up to 1000 characters' }); return; }
      if (['completed', 'cancelled'].includes(plan.dispatchStatus)) { sendJson(response, 409, { error: 'Completed or cancelled trip plans cannot be changed' }); return; }
      if (status === 'completed') {
        const incomplete = database.prepare("SELECT COUNT(*) AS count FROM trip_stops WHERE trip_plan_id = ? AND status NOT IN ('completed', 'skipped')").get(plan.id).count;
        if (incomplete > 0) { sendJson(response, 409, { error: 'Complete every route stop or mark it skipped before completing the trip' }); return; }
      }
      const updatedAt = new Date().toISOString();
      const confirmedBy = status === 'confirmed' ? user.name : plan.confirmedBy;
      const confirmedAt = status === 'confirmed' ? updatedAt : plan.confirmedAt;
      database.prepare('UPDATE trip_plans SET dispatch_status = ?, dispatch_notes = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?').run(status, notes.trim(), confirmedBy, confirmedAt, updatedAt, plan.id);
      recordAudit(user, 'Updated trip plan dispatch status', 'trip_plan', plan.id, `status=${status}`);
      sendJson(response, 200, { ...plan, dispatchStatus: status, dispatchNotes: notes.trim(), confirmedBy, confirmedAt, updatedAt });
      return;
    }
    const tripStopsMatch = requestUrl.pathname.match(/^\/api\/fleet\/trips\/([^/]+)\/stops$/);
    if (request.method === 'GET' && tripStopsMatch) {
      const plan = database.prepare('SELECT id FROM trip_plans WHERE id = ?').get(tripStopsMatch[1]);
      if (!plan) { sendJson(response, 404, { error: 'Trip plan not found' }); return; }
      sendJson(response, 200, readTripStops(plan.id));
      return;
    }
    const tripStopMatch = requestUrl.pathname.match(/^\/api\/fleet\/trips\/([^/]+)\/stops\/([^/]+)$/);
    if (request.method === 'PATCH' && tripStopMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'trip:create')) { sendJson(response, 403, { error: 'Your role cannot update route stops' }); return; }
      const plan = database.prepare('SELECT id, dispatch_status AS dispatchStatus FROM trip_plans WHERE id = ?').get(tripStopMatch[1]);
      if (!plan) { sendJson(response, 404, { error: 'Trip plan not found' }); return; }
      if (['completed', 'cancelled'].includes(plan.dispatchStatus)) { sendJson(response, 409, { error: 'Stops on completed or cancelled trips cannot be changed' }); return; }
      const stop = database.prepare('SELECT id, trip_plan_id AS tripPlanId, sequence, stop_type AS stopType, location, planned_mile AS plannedMile, status, eta, notes, updated_by AS updatedBy, updated_at AS updatedAt FROM trip_stops WHERE id = ? AND trip_plan_id = ?').get(tripStopMatch[2], plan.id);
      if (!stop) { sendJson(response, 404, { error: 'Trip stop not found' }); return; }
      const payload = await collectBody(request);
      const status = typeof payload.status === 'string' ? payload.status.trim() : '';
      const eta = payload.eta === undefined ? stop.eta : payload.eta;
      const notes = payload.notes === undefined ? stop.notes : payload.notes;
      if (!['planned', 'en_route', 'arrived', 'completed', 'skipped'].includes(status) || typeof eta !== 'string' || eta.length > 60 || typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'Provide a supported stop status, ETA text up to 60 characters, and notes up to 1000 characters' }); return; }
      const updatedAt = new Date().toISOString();
      database.prepare('UPDATE trip_stops SET status = ?, eta = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(status, eta.trim(), notes.trim(), user.name, updatedAt, stop.id);
      recordAudit(user, 'Updated trip route stop', 'trip_stop', stop.id, `trip=${plan.id}; status=${status}`);
      sendJson(response, 200, { ...stop, status, eta: eta.trim(), notes: notes.trim(), updatedBy: user.name, updatedAt });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/drivers') {
      sendJson(response, 200, readDrivers());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/fleet/drivers') {
      const user = authenticatedUser(request);
      if (!can(user, 'driver:profile')) { sendJson(response, 403, { error: 'Your role cannot create driver profiles' }); return; }
      const payload = await collectBody(request);
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const cdlClass = typeof payload.cdlClass === 'string' ? payload.cdlClass.trim() : '';
      const endorsements = Array.isArray(payload.endorsements) ? payload.endorsements : [];
      const preferredEquipment = Array.isArray(payload.preferredEquipment) ? payload.preferredEquipment : [];
      const availability = typeof payload.availability === 'string' ? payload.availability.trim() : '';
      const medicalExpiry = payload.medicalExpiry === undefined ? '' : payload.medicalExpiry;
      const notes = payload.notes === undefined ? '' : payload.notes;
      if (!name || name.length > 120 || !['A', 'B', 'C', 'none'].includes(cdlClass) || !['available', 'assigned', 'on_leave', 'unavailable'].includes(availability) || !Array.isArray(endorsements) || endorsements.length > 10 || endorsements.some(item => typeof item !== 'string' || item.length > 60) || !Array.isArray(preferredEquipment) || preferredEquipment.length > 10 || preferredEquipment.some(item => !equipmentTypes.includes(item)) || (medicalExpiry !== '' && !validDate(medicalExpiry)) || typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'Provide valid name, CDL class, endorsements, equipment preferences, availability, medicalExpiry, and notes' }); return; }
      if (database.prepare('SELECT id FROM driver_profiles WHERE name = ? COLLATE NOCASE').get(name)) { sendJson(response, 409, { error: 'A driver profile with this name already exists' }); return; }
      const now = new Date().toISOString();
      const driver = { id: `DRV-${crypto.randomBytes(8).toString('hex')}`, name, cdlClass, endorsements, preferredEquipment, availability, medicalExpiry, notes: notes.trim(), createdBy: user.name, createdAt: now, updatedAt: now };
      database.prepare('INSERT INTO driver_profiles (id, name, cdl_class, endorsements_json, preferred_equipment_json, availability, medical_expiry, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(driver.id, driver.name, driver.cdlClass, JSON.stringify(driver.endorsements), JSON.stringify(driver.preferredEquipment), driver.availability, driver.medicalExpiry, driver.notes, driver.createdBy, driver.createdAt, driver.updatedAt);
      recordAudit(user, 'Created driver profile', 'driver_profile', driver.id, `${driver.name} · CDL-${driver.cdlClass} · ${driver.availability}`);
      sendJson(response, 201, driver);
      return;
    }
    const driverMatch = requestUrl.pathname.match(/^\/api\/fleet\/drivers\/([^/]+)$/);
    if (request.method === 'PATCH' && driverMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'driver:profile')) { sendJson(response, 403, { error: 'Your role cannot update driver profiles' }); return; }
      const current = database.prepare('SELECT id, name, cdl_class AS cdlClass, endorsements_json AS endorsementsJson, preferred_equipment_json AS preferredEquipmentJson, availability, medical_expiry AS medicalExpiry, notes FROM driver_profiles WHERE id = ?').get(driverMatch[1]);
      if (!current) { sendJson(response, 404, { error: 'Driver profile not found' }); return; }
      const payload = await collectBody(request);
      const name = payload.name === undefined ? current.name : payload.name;
      const cdlClass = payload.cdlClass === undefined ? current.cdlClass : payload.cdlClass;
      const endorsements = payload.endorsements === undefined ? JSON.parse(current.endorsementsJson) : payload.endorsements;
      const preferredEquipment = payload.preferredEquipment === undefined ? JSON.parse(current.preferredEquipmentJson) : payload.preferredEquipment;
      const availability = payload.availability === undefined ? current.availability : payload.availability;
      const medicalExpiry = payload.medicalExpiry === undefined ? current.medicalExpiry : payload.medicalExpiry;
      const notes = payload.notes === undefined ? current.notes : payload.notes;
      if (typeof name !== 'string' || !name.trim() || name.length > 120 || !['A', 'B', 'C', 'none'].includes(cdlClass) || !['available', 'assigned', 'on_leave', 'unavailable'].includes(availability) || !Array.isArray(endorsements) || endorsements.length > 10 || endorsements.some(item => typeof item !== 'string' || item.length > 60) || !Array.isArray(preferredEquipment) || preferredEquipment.length > 10 || preferredEquipment.some(item => !equipmentTypes.includes(item)) || (medicalExpiry !== '' && !validDate(medicalExpiry)) || typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'Provide valid driver profile fields' }); return; }
      const updatedAt = new Date().toISOString();
      database.prepare('UPDATE driver_profiles SET name = ?, cdl_class = ?, endorsements_json = ?, preferred_equipment_json = ?, availability = ?, medical_expiry = ?, notes = ?, updated_at = ? WHERE id = ?').run(name.trim(), cdlClass, JSON.stringify(endorsements), JSON.stringify(preferredEquipment), availability, medicalExpiry, notes.trim(), updatedAt, current.id);
      recordAudit(user, 'Updated driver profile', 'driver_profile', current.id, `${name.trim()} · availability=${availability}`);
      sendJson(response, 200, { id: current.id, name: name.trim(), cdlClass, endorsements, preferredEquipment, availability, medicalExpiry, notes: notes.trim(), updatedAt });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/eld/logs') {
      sendJson(response, 200, readEldLogs());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/eld/status') {
      sendJson(response, 200, readEldStatus());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/fleet/eld/logs') {
      const user = authenticatedUser(request);
      if (!can(user, 'eld:create')) { sendJson(response, 403, { error: 'Your role cannot submit ELD records' }); return; }
      const payload = await collectBody(request);
      const unit = typeof payload.unit === 'string' ? payload.unit.trim() : '';
      const driver = typeof payload.driver === 'string' ? payload.driver.trim() : '';
      const dutyStatus = typeof payload.dutyStatus === 'string' ? payload.dutyStatus.trim() : '';
      const source = typeof payload.source === 'string' ? payload.source.trim() : 'simulated';
      const startAt = typeof payload.startAt === 'string' ? payload.startAt.trim() : '';
      const endAt = typeof payload.endAt === 'string' ? payload.endAt.trim() : '';
      const drivingHours = Number(payload.drivingHours);
      const onDutyHours = Number(payload.onDutyHours);
      if (!unit || !driver || !['driving', 'on_duty', 'off_duty', 'sleeper', 'yard_move'].includes(dutyStatus) || !['simulated', 'imported', 'provider'].includes(source) || !validTimestamp(startAt) || !validTimestamp(endAt) || new Date(endAt) <= new Date(startAt) || !Number.isFinite(drivingHours) || drivingHours < 0 || drivingHours > 11 || !Number.isFinite(onDutyHours) || onDutyHours < 0 || onDutyHours > 14) { sendJson(response, 400, { error: 'unit, driver, dutyStatus, valid timestamps, source, and supported HOS hours are required' }); return; }
      const vehicle = database.prepare('SELECT unit FROM fleet WHERE unit = ?').get(unit);
      if (!vehicle) { sendJson(response, 404, { error: 'Fleet unit not found' }); return; }
      const createdAt = new Date().toISOString();
      const record = { id: `ELD-${crypto.randomBytes(8).toString('hex')}`, unit, driver, dutyStatus, startAt, endAt, drivingHours, onDutyHours, source, verificationStatus: source === 'provider' ? 'verified' : source, createdBy: user.name, createdAt };
      database.prepare('INSERT INTO eld_logs (id, unit, driver, duty_status, start_at, end_at, driving_hours, on_duty_hours, source, verification_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.unit, record.driver, record.dutyStatus, record.startAt, record.endAt, record.drivingHours, record.onDutyHours, record.source, record.verificationStatus, record.createdBy, record.createdAt);
      recordAudit(user, 'Recorded ELD duty log', 'eld_log', record.id, `${record.unit} · ${record.dutyStatus} · ${record.drivingHours} driving hours · ${record.verificationStatus}`);
      sendJson(response, 201, record);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/cameras/events') {
      sendJson(response, 200, readCameraEvents());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/fleet/cameras/events') {
      const user = authenticatedUser(request);
      if (!can(user, 'camera:create')) { sendJson(response, 403, { error: 'Your role cannot submit camera events' }); return; }
      const payload = await collectBody(request);
      const unit = typeof payload.unit === 'string' ? payload.unit.trim() : '';
      const driver = typeof payload.driver === 'string' ? payload.driver.trim() : '';
      const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim() : '';
      const occurredAt = typeof payload.occurredAt === 'string' ? payload.occurredAt.trim() : '';
      const severity = typeof payload.severity === 'string' ? payload.severity.trim() : '';
      const clipReference = typeof payload.clipReference === 'string' ? payload.clipReference.trim().slice(0, 300) : '';
      const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
      if (!unit || !driver || !['collision', 'harsh_braking', 'lane_departure', 'distraction', 'manual'].includes(eventType) || !validTimestamp(occurredAt) || !['low', 'medium', 'high', 'critical'].includes(severity) || notes.length > 1000) { sendJson(response, 400, { error: 'unit, driver, eventType, valid occurredAt, severity, and notes up to 1000 characters are required' }); return; }
      if (!database.prepare('SELECT unit FROM fleet WHERE unit = ?').get(unit)) { sendJson(response, 404, { error: 'Fleet unit not found' }); return; }
      const createdAt = new Date().toISOString();
      const event = { id: `CAM-${crypto.randomBytes(8).toString('hex')}`, unit, driver, eventType, occurredAt, severity, clipReference, reviewStatus: 'new', notes, reviewNotes: '', createdBy: user.name, createdAt, reviewedBy: '', reviewedAt: '' };
      database.prepare('INSERT INTO camera_events (id, unit, driver, event_type, occurred_at, severity, clip_reference, review_status, notes, review_notes, created_by, created_at, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(event.id, event.unit, event.driver, event.eventType, event.occurredAt, event.severity, event.clipReference, event.reviewStatus, event.notes, event.reviewNotes, event.createdBy, event.createdAt, event.reviewedBy, event.reviewedAt);
      recordAudit(user, 'Recorded dash-cam event', 'camera_event', event.id, `${event.unit} · ${event.eventType} · ${event.severity}`);
      sendJson(response, 201, event);
      return;
    }
    const cameraEventMatch = requestUrl.pathname.match(/^\/api\/fleet\/cameras\/events\/([^/]+)$/);
    if (request.method === 'PATCH' && cameraEventMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'camera:review')) { sendJson(response, 403, { error: 'Your role cannot review camera events' }); return; }
      const event = database.prepare('SELECT id, review_status AS reviewStatus, review_notes AS reviewNotes FROM camera_events WHERE id = ?').get(cameraEventMatch[1]);
      if (!event) { sendJson(response, 404, { error: 'Camera event not found' }); return; }
      const payload = await collectBody(request);
      const reviewStatus = typeof payload.reviewStatus === 'string' ? payload.reviewStatus.trim() : '';
      const reviewNotes = payload.reviewNotes === undefined ? event.reviewNotes : payload.reviewNotes;
      if (!['new', 'reviewed', 'escalated', 'dismissed'].includes(reviewStatus) || typeof reviewNotes !== 'string' || reviewNotes.length > 1000) { sendJson(response, 400, { error: 'Provide a supported reviewStatus and reviewNotes up to 1000 characters' }); return; }
      const reviewedBy = reviewStatus === 'new' ? '' : user.name;
      const reviewedAt = reviewStatus === 'new' ? '' : new Date().toISOString();
      database.prepare('UPDATE camera_events SET review_status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(reviewStatus, reviewNotes.trim(), reviewedBy, reviewedAt, event.id);
      recordAudit(user, 'Reviewed dash-cam event', 'camera_event', event.id, `status=${reviewStatus}`);
      sendJson(response, 200, { ...event, reviewStatus, reviewNotes: reviewNotes.trim(), reviewedBy, reviewedAt });
      return;
    }
    const fleetMatch = requestUrl.pathname.match(/^\/api\/fleet\/([^/]+)$/);
    if (request.method === 'PATCH' && fleetMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'fleet:update') && !can(user, 'fleet:profile')) { sendJson(response, 403, { error: 'Your role cannot update fleet records' }); return; }
      const vehicle = database.prepare('SELECT unit, vin, driver, qualification, vehicle, location, maintenance, maintenance_due AS maintenanceDue, status, equipment_type AS equipmentType, mpg, tank_gallons AS tankGallons, fuel_gallons AS fuelGallons, hos_remaining_hours AS hosRemainingHours FROM fleet WHERE unit = ?').get(fleetMatch[1]);
      if (!vehicle) { sendJson(response, 404, { error: 'Fleet unit not found' }); return; }
      const payload = await collectBody(request);
      const allowedFields = ['status', 'maintenanceDue', 'equipmentType', 'vehicle', 'driver', 'mpg', 'tankGallons', 'fuelGallons', 'hosRemainingHours'];
      if (!Object.keys(payload).length || Object.keys(payload).some(field => !allowedFields.includes(field))) { sendJson(response, 400, { error: 'Provide supported fleet profile fields' }); return; }
      const allowedStatuses = ['Moving', 'In service', 'Available', 'Out of service'];
      if (payload.status && !allowedStatuses.includes(payload.status)) { sendJson(response, 400, { error: 'Invalid fleet status' }); return; }
      const equipmentType = payload.equipmentType === undefined ? vehicle.equipmentType : payload.equipmentType;
      if (!equipmentTypes.includes(equipmentType)) { sendJson(response, 400, { error: 'Invalid equipment type' }); return; }
      const next = {
        status: payload.status === undefined ? vehicle.status : payload.status,
        maintenanceDue: payload.maintenanceDue === undefined ? Number(vehicle.maintenanceDue) : Number(payload.maintenanceDue === true),
        equipmentType,
        vehicle: payload.vehicle === undefined ? vehicle.vehicle : payload.vehicle,
        driver: payload.driver === undefined ? vehicle.driver : payload.driver,
        mpg: payload.mpg === undefined ? vehicle.mpg : Number(payload.mpg),
        tankGallons: payload.tankGallons === undefined ? vehicle.tankGallons : Number(payload.tankGallons),
        fuelGallons: payload.fuelGallons === undefined ? vehicle.fuelGallons : Number(payload.fuelGallons),
        hosRemainingHours: payload.hosRemainingHours === undefined ? vehicle.hosRemainingHours : Number(payload.hosRemainingHours)
      };
      if (typeof next.vehicle !== 'string' || !next.vehicle.trim() || next.vehicle.trim().length > 120 || typeof next.driver !== 'string' || next.driver.trim().length > 100) { sendJson(response, 400, { error: 'Vehicle model and driver assignment must be valid text' }); return; }
      if (!Number.isFinite(next.mpg) || next.mpg < 1 || next.mpg > 25 || !Number.isFinite(next.tankGallons) || next.tankGallons < 1 || next.tankGallons > 500 || !Number.isFinite(next.fuelGallons) || next.fuelGallons < 0 || next.fuelGallons > next.tankGallons || !Number.isFinite(next.hosRemainingHours) || next.hosRemainingHours < 0 || next.hosRemainingHours > 11) { sendJson(response, 400, { error: 'MPG, tank capacity, current fuel, or entered remaining driving hours are outside supported limits' }); return; }
      database.prepare('UPDATE fleet SET status = ?, maintenance_due = ?, equipment_type = ?, vehicle = ?, driver = ?, mpg = ?, tank_gallons = ?, fuel_gallons = ?, hos_remaining_hours = ? WHERE unit = ?').run(next.status, next.maintenanceDue, next.equipmentType, next.vehicle.trim(), next.driver.trim(), next.mpg, next.tankGallons, next.fuelGallons, next.hosRemainingHours, vehicle.unit);
      Object.assign(vehicle, next);
      recordAudit(user, 'Updated fleet profile', 'fleet', vehicle.unit, `equipment=${next.equipmentType}; model=${next.vehicle}; mpg=${next.mpg}; tank=${next.tankGallons}; fuel=${next.fuelGallons}; enteredHos=${next.hosRemainingHours}`);
      sendJson(response, 200, vehicle);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/trips') {
      sendJson(response, 200, readTripPlans());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/assignments') {
      sendJson(response, 200, readAssignments());
      return;
    }
    const assignmentHistoryMatch = requestUrl.pathname.match(/^\/api\/fleet\/assignments\/([^/]+)\/history$/);
    if (request.method === 'GET' && assignmentHistoryMatch) {
      const assignment = database.prepare('SELECT id FROM load_assignments WHERE id = ?').get(assignmentHistoryMatch[1]);
      if (!assignment) { sendJson(response, 404, { error: 'Assignment not found' }); return; }
      sendJson(response, 200, readAssignmentHistory(assignment.id));
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/fleet/assignments') {
      const user = authenticatedUser(request);
      if (!can(user, 'fleet:update') && !can(user, 'fleet:profile')) { sendJson(response, 403, { error: 'Your role cannot assign fleet units' }); return; }
      const payload = await collectBody(request);
      const unit = typeof payload.unit === 'string' ? payload.unit.trim() : '';
      const loadRef = typeof payload.loadRef === 'string' ? payload.loadRef.trim() : '';
      const equipmentType = typeof payload.equipmentType === 'string' ? payload.equipmentType.trim() : '';
      const route = typeof payload.route === 'string' ? payload.route.trim().slice(0, 200) : '';
      if (!unit || !loadRef || !equipmentType) { sendJson(response, 400, { error: 'unit, loadRef, and equipmentType are required' }); return; }
      if (!equipmentTypes.includes(equipmentType)) { sendJson(response, 400, { error: 'Invalid equipment type' }); return; }
      const vehicle = database.prepare('SELECT unit, driver, equipment_type AS equipmentType, status FROM fleet WHERE unit = ?').get(unit);
      if (!vehicle) { sendJson(response, 404, { error: 'Fleet unit not found' }); return; }
      if (vehicle.status === 'Out of service') { sendJson(response, 400, { error: 'This unit is out of service and cannot be assigned' }); return; }
      if (vehicle.equipmentType !== equipmentType) { sendJson(response, 400, { error: 'This unit is not a match for the requested equipment type' }); return; }
      const requestedDriver = typeof payload.driverName === 'string' ? payload.driverName.trim() : (vehicle.driver || 'Unassigned');
      const driverProfile = database.prepare('SELECT id, availability FROM driver_profiles WHERE name = ? COLLATE NOCASE').get(requestedDriver);
      if (driverProfile && ['on_leave', 'unavailable'].includes(driverProfile.availability)) { sendJson(response, 409, { error: `Driver ${requestedDriver} is ${driverProfile.availability} and cannot be assigned` }); return; }
      const conflictingAssignment = database.prepare("SELECT id, unit, load_ref AS loadRef FROM load_assignments WHERE (unit = ? OR load_ref = ?) AND workflow_status IN ('assigned', 'proposed', 'approved', 'dispatched', 'accepted', 'in_progress') LIMIT 1").get(unit, loadRef);
      if (conflictingAssignment) { sendJson(response, 409, { error: `Active assignment ${conflictingAssignment.id} already uses this unit or load` }); return; }
      const driverName = requestedDriver;
      const matchScore = 100;
      const assignment = { id: `ASSIGN-${crypto.randomBytes(8).toString('hex')}`, unit, loadRef, driverName, equipmentType, route, assignStatus: 'assigned', workflowStatus: 'assigned', matchScore, notes: `Matched ${vehicle.equipmentType} equipment to ${loadRef} with ${driverName} assigned.`, createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO load_assignments (id, unit, load_ref, driver_name, equipment_type, route, assign_status, match_score, notes, workflow_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(assignment.id, assignment.unit, assignment.loadRef, assignment.driverName, assignment.equipmentType, assignment.route, assignment.assignStatus, assignment.matchScore, assignment.notes, assignment.workflowStatus, assignment.createdBy, assignment.createdAt);
      database.prepare('INSERT INTO assignment_history (id, assignment_id, status, notes, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)').run(`ASG-H-${crypto.randomBytes(8).toString('hex')}`, assignment.id, assignment.workflowStatus, assignment.notes, user.name, assignment.createdAt);
      if (driverName && driverName.toLowerCase() !== 'unassigned') {
        database.prepare('UPDATE loads SET driver = ? WHERE id = ?').run(driverName, loadRef);
      }
      recordAudit(user, 'Assigned fleet unit to load', 'load_assignment', assignment.id, `${assignment.unit} · ${assignment.loadRef} · ${assignment.equipmentType}`);
      sendJson(response, 201, assignment);
      return;
    }
    const assignmentMatch = requestUrl.pathname.match(/^\/api\/fleet\/assignments\/([^/]+)$/);
    if (request.method === 'PATCH' && assignmentMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'fleet:update') && !can(user, 'fleet:profile')) { sendJson(response, 403, { error: 'Your role cannot update fleet assignments' }); return; }
      const assignment = database.prepare('SELECT id, workflow_status AS workflowStatus, notes FROM load_assignments WHERE id = ?').get(assignmentMatch[1]);
      if (!assignment) { sendJson(response, 404, { error: 'Assignment not found' }); return; }
      const payload = await collectBody(request);
      const status = typeof payload.status === 'string' ? payload.status.trim() : '';
      const notes = payload.notes === undefined ? assignment.notes : payload.notes;
      const allowedStatuses = ['assigned', 'proposed', 'approved', 'dispatched', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected'];
      if (!allowedStatuses.includes(status) || typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'Provide a supported assignment status and notes up to 1000 characters' }); return; }
      if (['completed', 'cancelled', 'rejected'].includes(assignment.workflowStatus)) { sendJson(response, 409, { error: 'Terminal assignments cannot be changed' }); return; }
      const changedAt = new Date().toISOString();
      database.prepare('UPDATE load_assignments SET workflow_status = ?, notes = ? WHERE id = ?').run(status, notes.trim(), assignment.id);
      database.prepare('INSERT INTO assignment_history (id, assignment_id, status, notes, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)').run(`ASG-H-${crypto.randomBytes(8).toString('hex')}`, assignment.id, status, notes.trim(), user.name, changedAt);
      recordAudit(user, 'Updated fleet assignment status', 'load_assignment', assignment.id, `status=${status}`);
      sendJson(response, 200, { ...assignment, workflowStatus: status, notes: notes.trim(), updatedBy: user.name, updatedAt: changedAt });
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/fleet/trips') {
      const user = authenticatedUser(request);
      if (!can(user, 'trip:create')) { sendJson(response, 403, { error: 'Your role cannot create trip plans' }); return; }
      const payload = await collectBody(request);
      const requiredText = ['unit', 'origin', 'destination'];
      if (requiredText.some(field => typeof payload[field] !== 'string' || !payload[field].trim())) { sendJson(response, 400, { error: 'unit, origin, and destination are required' }); return; }
      const vehicle = database.prepare('SELECT unit, vehicle, mpg, tank_gallons AS tankGallons, fuel_gallons AS fuelGallons, hos_remaining_hours AS hosRemainingHours FROM fleet WHERE unit = ?').get(payload.unit.trim());
      if (!vehicle) { sendJson(response, 404, { error: 'Fleet unit not found' }); return; }
      const distanceMiles = Number(payload.distanceMiles);
      const averageSpeedMph = Number(payload.averageSpeedMph);
      const currentFuelGallons = payload.currentFuelGallons === undefined ? vehicle.fuelGallons : Number(payload.currentFuelGallons);
      const hosRemainingHours = payload.hosRemainingHours === undefined ? vehicle.hosRemainingHours : Number(payload.hosRemainingHours);
      if (!Number.isFinite(distanceMiles) || distanceMiles <= 0 || distanceMiles > 5000 || !Number.isFinite(averageSpeedMph) || averageSpeedMph < 10 || averageSpeedMph > 75 || !Number.isFinite(currentFuelGallons) || currentFuelGallons < 0 || currentFuelGallons > vehicle.tankGallons || !Number.isFinite(hosRemainingHours) || hosRemainingHours < 0 || hosRemainingHours > 11) { sendJson(response, 400, { error: 'Distance, average speed, fuel, and entered HOS values are outside supported limits' }); return; }
      const result = calculateTripPlan(vehicle, { ...payload, distanceMiles, averageSpeedMph, currentFuelGallons, hosRemainingHours });
      const plan = { id: `TRIP-${crypto.randomBytes(8).toString('hex')}`, unit: vehicle.unit, loadRef: typeof payload.loadRef === 'string' ? payload.loadRef.trim().slice(0, 80) : '', origin: payload.origin.trim().slice(0, 120), destination: payload.destination.trim().slice(0, 120), ...result, dispatchStatus: 'draft', dispatchNotes: '', confirmedBy: '', confirmedAt: '', updatedAt: new Date().toISOString(), createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO trip_plans (id, unit, load_ref, origin, destination, distance_miles, average_speed_mph, estimated_driving_hours, current_fuel_gallons, mpg, tank_gallons, hos_remaining_hours, stops_json, dispatch_status, dispatch_notes, confirmed_by, confirmed_at, updated_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(plan.id, plan.unit, plan.loadRef, plan.origin, plan.destination, plan.distanceMiles, plan.averageSpeedMph, plan.estimatedDrivingHours, plan.currentFuelGallons, plan.mpg, plan.tankGallons, plan.hosRemainingHours, JSON.stringify({ fuelStops: plan.fuelStops, overnightStop: plan.overnightStop }), plan.dispatchStatus, plan.dispatchNotes, plan.confirmedBy, plan.confirmedAt, plan.updatedAt, plan.createdBy, plan.createdAt);
      const stopDefinitions = [
        { stopType: 'origin', location: plan.origin, plannedMile: 0 },
        ...plan.fuelStops.map(stop => ({ stopType: 'fuel', location: stop.location || 'Estimated fuel stop', plannedMile: stop.atMile })),
        ...(plan.overnightStop ? [{ stopType: 'rest', location: plan.overnightStop.suggestedLocation || 'Driver-selected rest stop', plannedMile: plan.overnightStop.atMile }] : []),
        { stopType: 'destination', location: plan.destination, plannedMile: plan.distanceMiles }
      ].sort((left, right) => left.plannedMile - right.plannedMile || (left.stopType === 'destination' ? 1 : -1));
      const insertStop = database.prepare('INSERT INTO trip_stops (id, trip_plan_id, sequence, stop_type, location, planned_mile, status, eta, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      stopDefinitions.forEach((stop, index) => insertStop.run(`STOP-${crypto.randomBytes(8).toString('hex')}`, plan.id, index + 1, stop.stopType, stop.location, stop.plannedMile, 'planned', '', '', user.name, plan.updatedAt));
      recordAudit(user, 'Created estimate-only trip plan', 'trip_plan', plan.id, `${plan.unit} · ${plan.origin} to ${plan.destination} · ${plan.distanceMiles} miles`);
      sendJson(response, 201, plan);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/fleet/dvir') {
      sendJson(response, 200, readDvirRecords());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/advisor/actions') {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can view advisor actions' }); return; }
      sendJson(response, 200, readAdvisorActions());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/advisor/actions') {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can create advisor actions' }); return; }
      const payload = await collectBody(request);
      const area = typeof payload.area === 'string' ? payload.area.trim() : '';
      const priority = typeof payload.priority === 'string' ? payload.priority.trim() : '';
      const title = typeof payload.title === 'string' ? payload.title.trim() : '';
      const detail = typeof payload.detail === 'string' ? payload.detail.trim() : '';
      const dueDate = typeof payload.dueDate === 'string' ? payload.dueDate.trim() : '';
      const sources = Array.isArray(payload.sources) ? payload.sources : [];
      if (!area || area.length > 80 || !['Low', 'Review', 'High', 'Critical'].includes(priority) || !title || title.length > 160 || !detail || detail.length > 1000 || !validDate(dueDate) || sources.length > 20 || sources.some(source => typeof source !== 'string' || source.length > 120)) { sendJson(response, 400, { error: 'area, priority, title, detail, valid dueDate, and up to 20 text sources are required' }); return; }
      const action = { id: `ADV-${crypto.randomBytes(8).toString('hex')}`, area, priority, title, detail, sources, dueDate, status: 'open', outcome: '', createdBy: user.name, createdAt: new Date().toISOString(), completedBy: '', completedAt: '' };
      database.prepare('INSERT INTO advisor_actions (id, area, priority, title, detail, sources_json, due_date, status, outcome, created_by, created_at, completed_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(action.id, action.area, action.priority, action.title, action.detail, JSON.stringify(action.sources), action.dueDate, action.status, action.outcome, action.createdBy, action.createdAt, action.completedBy, action.completedAt);
      recordAudit(user, 'Created advisor action', 'advisor_action', action.id, `${action.priority} · ${action.title} · sources=${action.sources.join(',')}`);
      sendJson(response, 201, action);
      return;
    }
    const advisorActionMatch = requestUrl.pathname.match(/^\/api\/advisor\/actions\/([^/]+)$/);
    if (request.method === 'PATCH' && advisorActionMatch) {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can update advisor actions' }); return; }
      const action = database.prepare('SELECT id, status, outcome FROM advisor_actions WHERE id = ?').get(advisorActionMatch[1]);
      if (!action) { sendJson(response, 404, { error: 'Advisor action not found' }); return; }
      const payload = await collectBody(request);
      const status = typeof payload.status === 'string' ? payload.status.trim() : '';
      const outcome = payload.outcome === undefined ? action.outcome : payload.outcome;
      if (!['open', 'acknowledged', 'completed', 'dismissed'].includes(status) || typeof outcome !== 'string' || outcome.length > 1000) { sendJson(response, 400, { error: 'Provide a supported status and outcome up to 1000 characters' }); return; }
      const completedBy = ['completed', 'dismissed'].includes(status) ? user.name : '';
      const completedAt = ['completed', 'dismissed'].includes(status) ? new Date().toISOString() : '';
      database.prepare('UPDATE advisor_actions SET status = ?, outcome = ?, completed_by = ?, completed_at = ? WHERE id = ?').run(status, outcome.trim(), completedBy, completedAt, action.id);
      recordAudit(user, 'Updated advisor action', 'advisor_action', action.id, `status=${status}`);
      sendJson(response, 200, { ...action, status, outcome: outcome.trim(), completedBy, completedAt });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/advisor') {
      const user = authenticatedUser(request);
      if (user.role !== 'Owner / Admin') { sendJson(response, 403, { error: 'Only Owner / Admin can view business advisor insights' }); return; }
      sendJson(response, 200, readBusinessAdvisor());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/readiness') {
      const user = authenticatedUser(request);
      if (!['Owner / Admin', 'Safety', 'Maintenance', 'Accounting'].includes(user.role)) { sendJson(response, 403, { error: 'Your role cannot view readiness records' }); return; }
      sendJson(response, 200, readReadiness());
      return;
    }
    const readinessMatch = requestUrl.pathname.match(/^\/api\/readiness\/([^/]+)$/);
    if (request.method === 'PATCH' && readinessMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'readiness:update')) { sendJson(response, 403, { error: 'Your role cannot update readiness records' }); return; }
      const item = database.prepare('SELECT id, status, due_date AS dueDate, notes FROM readiness_items WHERE id = ?').get(readinessMatch[1]);
      if (!item) { sendJson(response, 404, { error: 'Readiness item not found' }); return; }
      const payload = await collectBody(request);
      const allowed = ['status', 'dueDate', 'notes'];
      if (!Object.keys(payload).length || Object.keys(payload).some(field => !allowed.includes(field))) { sendJson(response, 400, { error: 'Provide status, dueDate, or notes' }); return; }
      const status = payload.status === undefined ? item.status : payload.status;
      const dueDate = payload.dueDate === undefined ? item.dueDate : payload.dueDate;
      const notes = payload.notes === undefined ? item.notes : payload.notes;
      if (!['Not started', 'In progress', 'Complete', 'Not applicable'].includes(status)) { sendJson(response, 400, { error: 'Invalid readiness status' }); return; }
      if (dueDate !== '' && !validDate(dueDate)) { sendJson(response, 400, { error: 'dueDate must be empty or a valid YYYY-MM-DD date' }); return; }
      if (typeof notes !== 'string' || notes.length > 1000) { sendJson(response, 400, { error: 'notes must be text up to 1000 characters' }); return; }
      const updatedAt = new Date().toISOString();
      database.prepare('UPDATE readiness_items SET status = ?, due_date = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(status, dueDate, notes.trim(), user.name, updatedAt, item.id);
      recordAudit(user, 'Updated readiness item', 'readiness', item.id, `status=${status}; dueDate=${dueDate}`);
      sendJson(response, 200, { ...item, status, dueDate, notes: notes.trim(), updatedBy: user.name, updatedAt });
      return;
    }
    if (requestUrl.pathname === '/api/people/scorecards' && request.method === 'GET') {
      const user = authenticatedUser(request);
      if (!['Owner / Admin', 'HR'].includes(user.role)) { sendJson(response, 403, { error: 'Scorecards are restricted to Owner / Admin and HR' }); return; }
      sendJson(response, 200, readScorecards());
      return;
    }
    if (requestUrl.pathname === '/api/people/scorecards' && request.method === 'POST') {
      const user = authenticatedUser(request);
      if (!['Owner / Admin', 'HR'].includes(user.role)) { sendJson(response, 403, { error: 'Scorecards are restricted to Owner / Admin and HR' }); return; }
      const payload = await collectBody(request);
      if (typeof payload.employeeName !== 'string' || !payload.employeeName.trim() || payload.employeeName.trim().length > 120 || typeof payload.jobRole !== 'string' || !payload.jobRole.trim() || payload.jobRole.trim().length > 80) { sendJson(response, 400, { error: 'employeeName and jobRole are required and must fit their limits' }); return; }
      const scoreFields = ['quantitativeScore', 'strategicScore', 'qualitativeScore', 'reliabilityScore'];
      if (scoreFields.some(field => !Number.isInteger(payload[field]) || payload[field] < 0 || payload[field] > 100)) { sendJson(response, 400, { error: 'Each performance metric must be an integer from 0 to 100' }); return; }
      if (typeof payload.evidenceNotes !== 'string' || payload.evidenceNotes.trim().length < 5 || payload.evidenceNotes.length > 1000) { sendJson(response, 400, { error: 'Evidence notes are required and must be no more than 1000 characters' }); return; }
      const reviewerNotes = payload.reviewerNotes === undefined ? '' : payload.reviewerNotes;
      if (typeof reviewerNotes !== 'string' || reviewerNotes.length > 1000) { sendJson(response, 400, { error: 'reviewerNotes must be text up to 1000 characters' }); return; }
      const overallScore = Math.round((payload.quantitativeScore * 0.4 + payload.strategicScore * 0.3 + payload.qualitativeScore * 0.2 + payload.reliabilityScore * 0.1) * 10) / 10;
      const scorecard = { id: `PERF-${crypto.randomBytes(8).toString('hex')}`, employeeName: payload.employeeName.trim(), jobRole: payload.jobRole.trim(), quantitativeScore: payload.quantitativeScore, strategicScore: payload.strategicScore, qualitativeScore: payload.qualitativeScore, reliabilityScore: payload.reliabilityScore, overallScore, grade: scorecardGrade(overallScore), evidenceNotes: payload.evidenceNotes.trim(), reviewerNotes: reviewerNotes.trim(), status: 'Draft', reviewedBy: '', reviewedAt: '', createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO employee_scorecards (id, employee_name, job_role, quantitative_score, strategic_score, qualitative_score, reliability_score, overall_score, grade, evidence_notes, reviewer_notes, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(scorecard.id, scorecard.employeeName, scorecard.jobRole, scorecard.quantitativeScore, scorecard.strategicScore, scorecard.qualitativeScore, scorecard.reliabilityScore, scorecard.overallScore, scorecard.grade, scorecard.evidenceNotes, scorecard.reviewerNotes, scorecard.status, scorecard.createdBy, scorecard.createdAt);
      recordAudit(user, 'Created employee scorecard draft', 'employee_scorecard', scorecard.id, `${scorecard.employeeName} · ${scorecard.grade} · ${scorecard.overallScore}%`);
      sendJson(response, 201, scorecard);
      return;
    }
    const scorecardMatch = requestUrl.pathname.match(/^\/api\/people\/scorecards\/([^/]+)$/);
    if (request.method === 'PATCH' && scorecardMatch) {
      const user = authenticatedUser(request);
      if (!['Owner / Admin', 'HR'].includes(user.role)) { sendJson(response, 403, { error: 'Scorecards are restricted to Owner / Admin and HR' }); return; }
      const scorecard = database.prepare('SELECT id, status, reviewer_notes AS reviewerNotes, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt FROM employee_scorecards WHERE id = ?').get(scorecardMatch[1]);
      if (!scorecard) { sendJson(response, 404, { error: 'Scorecard not found' }); return; }
      const payload = await collectBody(request);
      if (Object.keys(payload).some(field => !['status', 'reviewerNotes'].includes(field)) || !Object.keys(payload).length) { sendJson(response, 400, { error: 'Only status and reviewerNotes can be updated' }); return; }
      const status = payload.status === undefined ? scorecard.status : payload.status;
      const reviewerNotes = payload.reviewerNotes === undefined ? scorecard.reviewerNotes : payload.reviewerNotes;
      if (!['Draft', 'Reviewed'].includes(status) || typeof reviewerNotes !== 'string' || reviewerNotes.length > 1000) { sendJson(response, 400, { error: 'Provide a valid status and reviewerNotes up to 1000 characters' }); return; }
      const reviewedAt = status === 'Reviewed' ? new Date().toISOString() : '';
      const reviewedBy = status === 'Reviewed' ? user.name : '';
      database.prepare('UPDATE employee_scorecards SET status = ?, reviewer_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(status, reviewerNotes.trim(), reviewedBy, reviewedAt, scorecard.id);
      recordAudit(user, 'Updated employee scorecard review', 'employee_scorecard', scorecard.id, `status=${status}`);
      sendJson(response, 200, { ...scorecard, status, reviewerNotes: reviewerNotes.trim(), reviewedBy, reviewedAt });
      return;
    }
    const dvirCreateMatch = requestUrl.pathname.match(/^\/api\/fleet\/([^/]+)\/dvir$/);
    if (request.method === 'POST' && dvirCreateMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'dvir:create')) { sendJson(response, 403, { error: 'Your role cannot create DVIR records' }); return; }
      const unit = decodeURIComponent(dvirCreateMatch[1]);
      const vehicle = database.prepare('SELECT unit, driver FROM fleet WHERE unit = ?').get(unit);
      if (!vehicle) { sendJson(response, 404, { error: 'Fleet unit not found' }); return; }
      const payload = await collectBody(request);
      if (!['pre-trip', 'post-trip'].includes(payload.inspectionType)) { sendJson(response, 400, { error: 'inspectionType must be pre-trip or post-trip' }); return; }
      if (!Number.isFinite(payload.odometerMiles) || payload.odometerMiles < 0 || payload.odometerMiles > 10000000) { sendJson(response, 400, { error: 'odometerMiles must be a non-negative number' }); return; }
      if (!Array.isArray(payload.checks) || payload.checks.length !== dvirChecklist.length || dvirChecklist.some(item => !payload.checks.some(check => check?.item === item && ['pass', 'fail'].includes(check.status)))) { sendJson(response, 400, { error: 'Mark each required DVIR checklist item pass or fail before submitting' }); return; }
      const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
      if (notes.length > 1000) { sendJson(response, 400, { error: 'DVIR notes must be no more than 1000 characters' }); return; }
      const status = payload.checks.some(check => check.status === 'fail') ? 'Needs repair' : 'No defects';
      const record = { id: `DVIR-${crypto.randomBytes(8).toString('hex')}`, unit, driver: vehicle.driver, inspectionType: payload.inspectionType, odometerMiles: payload.odometerMiles, checks: dvirChecklist.map(item => payload.checks.find(check => check.item === item)), notes, status, createdBy: user.name, createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO dvir_records (id, unit, driver, inspection_type, odometer_miles, checks_json, notes, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.unit, record.driver, record.inspectionType, record.odometerMiles, JSON.stringify(record.checks), record.notes, record.status, record.createdBy, record.createdAt);
      if (status === 'Needs repair') database.prepare("UPDATE fleet SET maintenance_due = 1, maintenance = 'DVIR defect reported' WHERE unit = ?").run(unit);
      recordAudit(user, 'Created digital vehicle inspection', 'dvir', record.id, `${record.inspectionType} · Unit ${unit} · ${status}`);
      sendJson(response, 201, record);
      return;
    }
    const dvirRepairMatch = requestUrl.pathname.match(/^\/api\/fleet\/dvir\/([^/]+)$/);
    if (request.method === 'PATCH' && dvirRepairMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'dvir:repair')) { sendJson(response, 403, { error: 'Your role cannot close DVIR defects' }); return; }
      const record = database.prepare('SELECT id, unit, status FROM dvir_records WHERE id = ?').get(dvirRepairMatch[1]);
      if (!record) { sendJson(response, 404, { error: 'DVIR record not found' }); return; }
      if (record.status !== 'Needs repair') { sendJson(response, 409, { error: 'Only DVIR records with reported defects can be closed' }); return; }
      const payload = await collectBody(request);
      if (payload.status !== 'Repair complete') { sendJson(response, 400, { error: 'status must be Repair complete' }); return; }
      database.prepare("UPDATE dvir_records SET status = 'Repair complete' WHERE id = ?").run(record.id);
      recordAudit(user, 'Closed DVIR defect', 'dvir', record.id, `Unit ${record.unit} repair marked complete`);
      sendJson(response, 200, { ...record, status: 'Repair complete' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/loads') {
      sendJson(response, 200, readLoads());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/api/incidents') {
      sendJson(response, 200, readIncidents());
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/api/incidents') {
      const user = authenticatedUser(request);
      if (!can(user, 'incident:create')) { sendJson(response, 403, { error: 'Your role cannot create incidents' }); return; }
      const payload = await collectBody(request);
      const required = ['type', 'severity', 'unit', 'location', 'description'];
      if (required.some(field => typeof payload[field] !== 'string' || !payload[field].trim())) {
        sendJson(response, 400, { error: 'type, severity, unit, location, and description are required' });
        return;
      }
      const incident = { id: `INC-${Date.now()}`, ...Object.fromEntries(required.map(field => [field, payload[field].trim()])), status: 'Open', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), createdAt: new Date().toISOString() };
      database.prepare('INSERT INTO incidents (id, type, severity, unit, location, description, status, time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(incident.id, incident.type, incident.severity, incident.unit, incident.location, incident.description, incident.status, incident.time, incident.createdAt);
      recordAudit(user, 'Created incident', 'incident', incident.id, `${incident.type} · ${incident.unit}`);
      sendJson(response, 201, incident);
      return;
    }
    const loadMatch = requestUrl.pathname.match(/^\/api\/loads\/([^/]+)$/);
    if (request.method === 'PATCH' && loadMatch) {
      const user = authenticatedUser(request);
      if (!can(user, 'load:update')) { sendJson(response, 403, { error: 'Your role cannot update loads' }); return; }
      const load = database.prepare('SELECT id, origin, destination, customer, unit, driver, revenue, status FROM loads WHERE id = ?').get(loadMatch[1]);
      if (!load) { sendJson(response, 404, { error: 'Load not found' }); return; }
      const payload = await collectBody(request);
      const allowedStatuses = ['Booked', 'In transit', 'At risk', 'Delivered'];
      if (payload.status && !allowedStatuses.includes(payload.status)) { sendJson(response, 400, { error: 'Invalid load status' }); return; }
      const nextStatus = typeof payload.status === 'string' ? payload.status : load.status;
      const nextDriver = typeof payload.driver === 'string' ? payload.driver.trim() : load.driver;
      database.prepare('UPDATE loads SET status = ?, driver = ? WHERE id = ?').run(nextStatus, nextDriver, load.id);
      load.status = nextStatus;
      load.driver = nextDriver;
      recordAudit(user, 'Updated load', 'load', load.id, `status=${nextStatus}; driver=${nextDriver}`);
      sendJson(response, 200, load);
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') { sendFile(response, requestUrl.pathname, { skipBody: request.method === 'HEAD' }); return; }
    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(port, () => console.log(`Jackson CommandOS running at http://localhost:${port}`));
