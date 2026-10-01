const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 4187;
const database = path.join(os.tmpdir(), `commandos-test-${process.pid}.sqlite`);
let server;
let ownerCookie;
let safetyCookie;
let hrCookie;

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 5000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('Jackson CommandOS running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('error', reject);
  });
}

async function request(pathname, options = {}, cookie = '') {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { ...options, headers });
  const body = await response.json();
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

before(async () => {
  fs.rmSync(database, { force: true });
  server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), COMMANDOS_DATABASE: database } });
  await waitForServer();
});

after(() => {
  server.kill();
  fs.rmSync(database, { force: true });
});

test('health endpoint is public', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('head requests are supported for the app shell and health endpoint', async () => {
  const page = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'HEAD' });
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type') || '', /application\/json/);
});

test('owner can read loads and create incidents', async () => {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@jackson.local', password: 'commandos-demo' }) });
  assert.equal(login.response.status, 200);
  ownerCookie = login.cookie;
  const loads = await request('/api/loads', {}, ownerCookie);
  assert.equal(loads.response.status, 200);
  assert.equal(loads.body.length, 4);
  const incident = await request('/api/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'Test incident', severity: 'Watch', unit: '204', location: 'Memphis, TN', description: 'Automated test' }) }, ownerCookie);
  assert.equal(incident.response.status, 201);
});

test('safety can create incidents but cannot update loads', async () => {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'safety@jackson.local', password: 'safety-demo' }) });
  assert.equal(login.response.status, 200);
  safetyCookie = login.cookie;
  const update = await request('/api/loads/JL-8051', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Delivered' }) }, safetyCookie);
  assert.equal(update.response.status, 403);
});

test('finance ledger validates access and forecasts scheduled cash after reserves', async () => {
  const denied = await request('/api/finance/entries', {}, safetyCookie);
  assert.equal(denied.response.status, 403);

  const invalidAmount = await request('/api/finance/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: 'income', category: 'Freight', description: 'Load payment', amountCents: 0, paymentDate: '2026-10-15', status: 'scheduled' }) }, ownerCookie);
  assert.equal(invalidAmount.response.status, 400);
  const invalidDate = await request('/api/finance/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: 'income', category: 'Freight', description: 'Load payment', amountCents: 100000, paymentDate: '2026-02-30', status: 'scheduled' }) }, ownerCookie);
  assert.equal(invalidDate.response.status, 400);

  const settings = await request('/api/finance/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentCashCents: 1000000, weeklyCashFloorCents: 1250000 }) }, ownerCookie);
  assert.equal(settings.response.status, 200);
  const invalidSettings = await request('/api/finance/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taxPercent: 20 }) }, ownerCookie);
  assert.equal(invalidSettings.response.status, 400);

  const paymentDate = new Date();
  paymentDate.setUTCDate(paymentDate.getUTCDate() + 10);
  const date = paymentDate.toISOString().slice(0, 10);
  const income = await request('/api/finance/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: 'income', category: 'Freight', description: 'Load payment', counterparty: 'Delta Supply Co.', amountCents: 100000, paymentDate: date, status: 'scheduled', loadRef: 'JL-8051', miles: 1000, fuelCostPerMileCents: 10, driverPayPerMileCents: 20 }) }, ownerCookie);
  assert.equal(income.response.status, 201);
  const expense = await request('/api/finance/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: 'expense', category: 'Fuel', description: 'Fuel stop', amountCents: 20000, paymentDate: date, status: 'scheduled', loadRef: 'JL-8051' }) }, ownerCookie);
  assert.equal(expense.response.status, 201);

  const entries = await request('/api/finance/entries', {}, ownerCookie);
  assert.equal(entries.body.length, 2);
  const summary = await request('/api/finance/summary', {}, ownerCookie);
  assert.equal(summary.body.netCents, 50000);
  assert.equal(summary.body.costPerMileCents, 50);
  assert.equal(summary.body.loadProfits[0].profitCents, 50000);
  assert.equal(summary.body.allocations.reduce((total, allocation) => total + allocation.percent, 0), 100);
  assert.ok(summary.body.allocations.reduce((total, allocation) => total + allocation.amountCents, 0) <= summary.body.allocationBasisCents);

  const forecast = await request('/api/finance/forecast', {}, ownerCookie);
  const week = forecast.body.weeks.find(item => item.startDate <= date && item.endDate >= date);
  assert.ok(week);
  assert.equal(week.incomeCents, 100000);
  assert.equal(week.expenseCents, 20000);
  assert.equal(week.mileageCostsCents, 30000);
  assert.equal(week.reserveCents, 32500);
  assert.equal(week.closingCashCents, 1017500);
  assert.equal(week.belowCashFloor, true);

  const markedPaid = await request(`/api/finance/entries/${encodeURIComponent(income.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paid' }) }, ownerCookie);
  assert.equal(markedPaid.response.status, 200);
  assert.equal(markedPaid.body.status, 'paid');
  const updatedEntries = await request('/api/finance/entries', {}, ownerCookie);
  assert.equal(updatedEntries.body.find(entry => entry.id === income.body.id).status, 'paid');
  const settledSummary = await request('/api/finance/summary', {}, ownerCookie);
  assert.ok(settledSummary.body.allocations.reduce((total, allocation) => total + allocation.amountCents, 0) <= settledSummary.body.allocationBasisCents);
});

test('finance budgets report actual spending against the configured monthly cap', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const expense = await request('/api/finance/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction: 'expense', category: 'Fuel', description: 'Paid fuel', amountCents: 15000, paymentDate: today, status: 'paid', taxDeductible: true }) }, ownerCookie);
  assert.equal(expense.response.status, 201);
  const budget = await request('/api/finance/budgets/Fuel', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budgetCents: 10000 }) }, ownerCookie);
  assert.equal(budget.response.status, 200);
  assert.equal(budget.body.spentCents, 15000);
  assert.equal(budget.body.remainingCents, -5000);
  const summary = await request('/api/finance/summary', {}, ownerCookie);
  assert.equal(summary.body.deductibleExpenseCents, 15000);
});

test('operating cash accounts and customer payment risk are tracked by bucket and aging state', async () => {
  const available = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Available Cash', category: 'Operating', accountType: 'cash', balanceCents: 500000, reservedCents: 150000 }) }, ownerCookie);
  assert.equal(available.response.status, 201);
  assert.equal(available.body.accountType, 'cash');
  const maintenance = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Maintenance Reserve', category: 'Maintenance', accountType: 'reserve', balanceCents: 125000, reservedCents: 25000 }) }, ownerCookie);
  assert.equal(maintenance.response.status, 201);
  const accounts = await request('/api/finance/accounts', {}, ownerCookie);
  assert.ok(accounts.body.some(account => account.name === 'Available Cash'));

  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() + 25);
  const customer = await request('/api/finance/counterparties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Northline Foods', kind: 'customer', contactName: 'M. Hall', email: 'm.hall@northline.example', phone: '555-0201', termsDays: 30 }) }, ownerCookie);
  assert.equal(customer.response.status, 201);
  const invoice = await request('/api/finance/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'receivable', invoiceNumber: 'AR-CASH-001', counterpartyId: customer.body.id, amountCents: 250000, issuedDate: today, dueDate: dueDate.toISOString().slice(0, 10) }) }, ownerCookie);
  assert.equal(invoice.response.status, 201);

  const collections = await request('/api/finance/collections', {}, ownerCookie);
  assert.ok(Array.isArray(collections.body));
  assert.ok(collections.body.some(item => item.customer === 'Northline Foods'));
  const summary = await request('/api/finance/summary', {}, ownerCookie);
  assert.ok(summary.body.cashAccounts.some(account => account.name === 'Available Cash'));
  assert.ok(summary.body.collectionsRisk.some(item => item.customer === 'Northline Foods'));
});

test('cash allocation proposals map paid margin to reserve accounts and require owner approval', async () => {
  const financeSettings = await request('/api/finance/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentCashCents: 1000000, weeklyCashFloorCents: 100000 }) }, ownerCookie);
  assert.equal(financeSettings.response.status, 200);
  const tax = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tax Reserve', category: 'Tax', accountType: 'tax', balanceCents: 0, reservedCents: 0 }) }, ownerCookie);
  assert.equal(tax.response.status, 201);
  const insurance = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Insurance Allocation', category: 'Insurance', accountType: 'insurance', balanceCents: 0, reservedCents: 0 }) }, ownerCookie);
  assert.equal(insurance.response.status, 201);
  const maintenance = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Maintenance Allocation', category: 'Maintenance', accountType: 'maintenance', balanceCents: 0, reservedCents: 0 }) }, ownerCookie);
  assert.equal(maintenance.response.status, 201);
  const scaling = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Scaling Savings', category: 'Scaling', accountType: 'savings', balanceCents: 0, reservedCents: 0 }) }, ownerCookie);
  assert.equal(scaling.response.status, 201);
  const proposal = await request('/api/finance/allocations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'paid-margin' }) }, ownerCookie);
  assert.equal(proposal.response.status, 201);
  assert.equal(proposal.body.status, 'proposed');
  assert.ok(proposal.body.sourceCents > 0);
  assert.ok(proposal.body.allocations.some(item => item.accountType === 'tax' && item.amountCents > 0));
  assert.equal((await request('/api/finance/allocations', {}, ownerCookie)).body[0].id, proposal.body.id);

  const denied = await request(`/api/finance/allocations/${encodeURIComponent(proposal.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) }, safetyCookie);
  assert.equal(denied.response.status, 403);
  const approved = await request(`/api/finance/allocations/${encodeURIComponent(proposal.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) }, ownerCookie);
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, 'approved');
  assert.equal(approved.body.approvedBy, 'Clarence Jackson');
  assert.equal((await request('/api/finance/accounts', {}, ownerCookie)).body.find(account => account.id === tax.body.id).balanceCents, 0);

  const executed = await request(`/api/finance/allocations/${encodeURIComponent(proposal.body.id)}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'allocation-execution-001' }) }, ownerCookie);
  assert.equal(executed.response.status, 200, JSON.stringify({ proposal: proposal.body.allocations, execution: executed.body }));
  assert.equal(executed.body.status, 'executed');
  assert.ok(executed.body.transfers.some(transfer => transfer.accountId === tax.body.id && transfer.amountCents > 0));
  const taxAfterExecution = (await request('/api/finance/accounts', {}, ownerCookie)).body.find(account => account.id === tax.body.id);
  assert.equal(taxAfterExecution.balanceCents, executed.body.transfers.find(transfer => transfer.accountId === tax.body.id).amountCents);
  const replay = await request(`/api/finance/allocations/${encodeURIComponent(proposal.body.id)}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'allocation-execution-001' }) }, ownerCookie);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.id, executed.body.id);
  assert.equal((await request('/api/finance/accounts', {}, ownerCookie)).body.find(account => account.id === tax.body.id).balanceCents, taxAfterExecution.balanceCents);
});

test('automatic cash sweeps accept the auto source and preserve the configured cash floor', async () => {
  const financeSettings = await request('/api/finance/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentCashCents: 1500000, weeklyCashFloorCents: 200000 }) }, ownerCookie);
  assert.equal(financeSettings.response.status, 200);
  const automatic = await request('/api/finance/allocations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'auto' }) }, ownerCookie);
  assert.equal(automatic.response.status, 201);
  assert.equal(automatic.body.source, 'auto');
  assert.ok(automatic.body.allocations.length > 0);
  assert.ok(automatic.body.allocations.some(item => item.accountType === 'tax' || item.accountType === 'insurance' || item.accountType === 'maintenance' || item.accountType === 'savings'));
});

test('automatic allocations can route money into fuel and maintenance buckets', async () => {
  const financeSettings = await request('/api/finance/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentCashCents: 1800000, weeklyCashFloorCents: 250000 }) }, ownerCookie);
  assert.equal(financeSettings.response.status, 200);
  const fuel = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fuel Sweep Reserve', category: 'Fuel', accountType: 'fuel', balanceCents: 0, reservedCents: 0 }) }, ownerCookie);
  assert.equal(fuel.response.status, 201);
  const maintenance = await request('/api/finance/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Maintenance Sweep Reserve', category: 'Maintenance', accountType: 'maintenance', balanceCents: 0, reservedCents: 0 }) }, ownerCookie);
  assert.equal(maintenance.response.status, 201);
  const sweep = await request('/api/finance/allocations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'cash-sweep' }) }, ownerCookie);
  assert.equal(sweep.response.status, 201, JSON.stringify(sweep.body));
  assert.equal(sweep.body.source, 'cash-sweep');
  assert.ok(sweep.body.allocations.some(item => item.accountType === 'fuel'));
  assert.ok(sweep.body.allocations.some(item => item.accountType === 'maintenance'));
});

test('billing tracks counterparties and exposes reconciliation exceptions without auto-settling', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() + 30);
  const customer = await request('/api/finance/counterparties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Delta Supply Co.', kind: 'customer', contactName: 'Casey Morgan', email: 'ap@delta.example', phone: '555-0102', termsDays: 30, notes: 'Call before resending statements.' }) }, ownerCookie);
  assert.equal(customer.response.status, 201);
  assert.equal(customer.body.contactName, 'Casey Morgan');
  const duplicateParty = await request('/api/finance/counterparties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'delta supply co.', kind: 'customer' }) }, ownerCookie);
  assert.equal(duplicateParty.response.status, 409);

  const invoice = await request('/api/finance/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'receivable', invoiceNumber: 'INV-JL-8051', counterpartyId: customer.body.id, amountCents: 100000, issuedDate: today, dueDate: dueDate.toISOString().slice(0, 10), loadRef: 'JL-8051' }) }, ownerCookie);
  assert.equal(invoice.response.status, 201);
  const reconciliation = await request('/api/finance/reconciliation', {}, ownerCookie);
  assert.equal(reconciliation.body.find(item => item.invoiceId === invoice.body.id).matchStatus, 'status_conflict');
  const unpaidInvoice = await request(`/api/finance/invoices/${encodeURIComponent(invoice.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paid' }) }, ownerCookie);
  assert.equal(unpaidInvoice.response.status, 400);
  const paidInvoice = await request(`/api/finance/invoices/${encodeURIComponent(invoice.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paid', paymentReference: 'ACH trace 8824' }) }, ownerCookie);
  assert.equal(paidInvoice.response.status, 200);
  const matched = await request('/api/finance/reconciliation', {}, ownerCookie);
  assert.equal(matched.body.find(item => item.invoiceId === invoice.body.id).matchStatus, 'matched');

  const mismatch = await request('/api/finance/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'receivable', invoiceNumber: 'INV-JL-8051-REV', counterpartyId: customer.body.id, amountCents: 90000, issuedDate: today, dueDate: dueDate.toISOString().slice(0, 10), loadRef: 'JL-8051' }) }, ownerCookie);
  assert.equal(mismatch.response.status, 201);
  const vendor = await request('/api/finance/counterparties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Roadside Parts LLC', kind: 'vendor' }) }, ownerCookie);
  assert.equal(vendor.response.status, 201);
  const bill = await request('/api/finance/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'payable', invoiceNumber: 'BILL-209', counterpartyId: vendor.body.id, amountCents: 50000, issuedDate: today, dueDate: dueDate.toISOString().slice(0, 10) }) }, ownerCookie);
  assert.equal(bill.response.status, 201);
  const exceptions = await request('/api/finance/reconciliation', {}, ownerCookie);
  assert.equal(exceptions.body.find(item => item.invoiceId === mismatch.body.id).matchStatus, 'mismatch');
  assert.equal(exceptions.body.find(item => item.invoiceId === bill.body.id).matchStatus, 'missing_payment');
  assert.equal((await request('/api/finance/invoices', {}, ownerCookie)).body.find(item => item.id === mismatch.body.id).status, 'open');

  const delivered = await request('/api/loads/JL-8038', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Delivered' }) }, ownerCookie);
  assert.equal(delivered.response.status, 200);
  const generated = await request('/api/finance/invoices/from-load/JL-8038', { method: 'POST' }, ownerCookie);
  assert.equal(generated.response.status, 201);
  assert.equal(generated.body.amountCents, 286000);
  assert.equal(generated.body.loadRef, 'JL-8038');
  const duplicateInvoice = await request('/api/finance/invoices/from-load/JL-8038', { method: 'POST' }, ownerCookie);
  assert.equal(duplicateInvoice.response.status, 409);
});

test('partial invoice payments preserve balance and create auditable collection follow-up', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const customer = await request('/api/finance/counterparties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Collections Test Customer', kind: 'customer', termsDays: 15 }) }, ownerCookie);
  assert.equal(customer.response.status, 201);
  const invoice = await request('/api/finance/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'receivable', invoiceNumber: 'AR-PARTIAL-001', counterpartyId: customer.body.id, amountCents: 120000, issuedDate: '2026-09-01', dueDate: '2026-09-15' }) }, ownerCookie);
  assert.equal(invoice.response.status, 201);
  const payment = await request(`/api/finance/invoices/${encodeURIComponent(invoice.body.id)}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents: 50000, paymentDate: today, reference: 'ACH partial 4401', notes: 'Customer paid first installment.' }) }, ownerCookie);
  assert.equal(payment.response.status, 201);
  assert.equal(payment.body.amountCents, 50000);
  assert.equal(payment.body.invoiceStatus, 'open');
  assert.equal(payment.body.paidCents, 50000);
  assert.equal(payment.body.balanceCents, 70000);
  const invoiceAfterPayment = (await request('/api/finance/invoices', {}, ownerCookie)).body.find(item => item.id === invoice.body.id);
  assert.equal(invoiceAfterPayment.paidCents, 50000);
  assert.equal(invoiceAfterPayment.balanceCents, 70000);
  const collectionRisk = (await request('/api/finance/collections', {}, ownerCookie)).body.find(item => item.customer === 'Collections Test Customer');
  assert.equal(collectionRisk.openCents, 70000);
  assert.equal(collectionRisk.paidCents, 50000);

  const task = await request('/api/finance/collections/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: invoice.body.id, actionType: 'Call customer', dueDate: '2026-10-05', notes: 'Confirm date for remaining balance.' }) }, ownerCookie);
  assert.equal(task.response.status, 201);
  assert.equal(task.body.status, 'open');
  assert.equal((await request('/api/finance/collections/tasks', {}, ownerCookie)).body.some(item => item.invoiceId === invoice.body.id), true);
  const completed = await request(`/api/finance/collections/tasks/${encodeURIComponent(task.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed', notes: 'Customer confirmed payment next week.' }) }, ownerCookie);
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.status, 'completed');
});

test('fleet profiles drive estimate-only trip plans and DVIR defects require repair follow-up', async () => {
  const profile = await request('/api/fleet/204', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipmentType: 'Semi tractor', vehicle: '2023 Freightliner Cascadia', mpg: 7, tankGallons: 100, fuelGallons: 20, hosRemainingHours: 5 }) }, ownerCookie);
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.equipmentType, 'Semi tractor');
  assert.equal(profile.body.mpg, 7);
  const invalidProfile = await request('/api/fleet/204', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipmentType: 'Space truck' }) }, ownerCookie);
  assert.equal(invalidProfile.response.status, 400);

  const trip = await request('/api/fleet/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '204', loadRef: 'JL-8051', origin: 'Memphis, TN', destination: 'Atlanta, GA', distanceMiles: 1000, averageSpeedMph: 50, currentFuelGallons: 20, hosRemainingHours: 5, overnightStopLocation: 'Driver-selected stop' }) }, ownerCookie);
  assert.equal(trip.response.status, 201);
  assert.equal(trip.body.estimatedDrivingHours, 20);
  assert.equal(trip.body.dispatchStatus, 'draft');
  assert.deepEqual(trip.body.fuelStops.map(stop => stop.atMile), [0, 560]);
  assert.equal(trip.body.overnightStop.atMile, 250);
  assert.match(trip.body.overnightStop.note, /Confirm current HOS/);
  assert.equal((await request('/api/fleet/trips', {}, ownerCookie)).body.length, 1);
  const confirmedTrip = await request(`/api/fleet/trips/${encodeURIComponent(trip.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed', notes: 'Dispatcher reviewed appointments and route assumptions.' }) }, ownerCookie);
  assert.equal(confirmedTrip.response.status, 200);
  assert.equal(confirmedTrip.body.dispatchStatus, 'confirmed');
  const stops = await request(`/api/fleet/trips/${encodeURIComponent(trip.body.id)}/stops`, {}, ownerCookie);
  assert.equal(stops.response.status, 200);
  assert.ok(stops.body.some(stop => stop.stopType === 'fuel'));
  const fuelStop = stops.body.find(stop => stop.stopType === 'fuel');
  const arrivedStop = await request(`/api/fleet/trips/${encodeURIComponent(trip.body.id)}/stops/${encodeURIComponent(fuelStop.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'arrived', notes: 'Fuel stop reached.' }) }, ownerCookie);
  assert.equal(arrivedStop.response.status, 200);
  assert.equal(arrivedStop.body.status, 'arrived');
  const eld = await request('/api/fleet/eld/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '204', driver: 'Marcus Turner', dutyStatus: 'driving', startAt: '2026-10-01T08:00:00.000Z', endAt: '2026-10-01T12:00:00.000Z', drivingHours: 4, onDutyHours: 5, source: 'simulated' }) }, ownerCookie);
  assert.equal(eld.response.status, 201);
  assert.equal(eld.body.verificationStatus, 'simulated');
  assert.equal((await request('/api/fleet/eld/logs', {}, ownerCookie)).body.some(item => item.id === eld.body.id), true);
  const eldStatus = await request('/api/fleet/eld/status', {}, ownerCookie);
  assert.equal(eldStatus.response.status, 200);
  assert.ok(eldStatus.body.some(item => item.unit === '204' && item.lastLogId === eld.body.id));
  const invalidEld = await request('/api/fleet/eld/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '204', driver: 'Marcus Turner', dutyStatus: 'driving', startAt: '2026-10-01T08:00:00.000Z', endAt: '2026-10-01T12:00:00.000Z', drivingHours: 12, onDutyHours: 12, source: 'simulated' }) }, ownerCookie);
  assert.equal(invalidEld.response.status, 400);
  const cameraEvent = await request('/api/fleet/cameras/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '204', driver: 'Marcus Turner', eventType: 'harsh_braking', occurredAt: '2026-10-01T11:30:00.000Z', severity: 'high', clipReference: 'sim://camera-204/event-001', notes: 'Event generated by a simulated camera provider.' }) }, ownerCookie);
  assert.equal(cameraEvent.response.status, 201);
  assert.equal(cameraEvent.body.reviewStatus, 'new');
  assert.equal((await request('/api/fleet/cameras/events', {}, ownerCookie)).body.some(item => item.id === cameraEvent.body.id), true);
  const reviewedCameraEvent = await request(`/api/fleet/cameras/events/${encodeURIComponent(cameraEvent.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewStatus: 'reviewed', reviewNotes: 'Reviewed with driver; coaching assigned.' }) }, ownerCookie);
  assert.equal(reviewedCameraEvent.response.status, 200);
  assert.equal(reviewedCameraEvent.body.reviewStatus, 'reviewed');
  const driver = await request('/api/fleet/drivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Marcus Turner', cdlClass: 'A', endorsements: ['Doubles/Triples'], preferredEquipment: ['Semi tractor'], availability: 'available', medicalExpiry: '2027-10-01', notes: 'Primary Memphis lane driver.' }) }, ownerCookie);
  assert.equal(driver.response.status, 201);
  assert.equal(driver.body.availability, 'available');
  assert.deepEqual(driver.body.preferredEquipment, ['Semi tractor']);
  const driverUpdate = await request(`/api/fleet/drivers/${encodeURIComponent(driver.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ availability: 'on_leave', notes: 'Scheduled leave.' }) }, ownerCookie);
  assert.equal(driverUpdate.response.status, 200);
  assert.equal(driverUpdate.body.availability, 'on_leave');
  assert.ok((await request('/api/fleet/drivers', {}, ownerCookie)).body.some(item => item.id === driver.body.id));
  const unavailableDriverAssignment = await request('/api/fleet/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '203', loadRef: 'JL-8038', equipmentType: 'Box truck', driverName: 'Marcus Turner', route: 'St. Louis, MO → Memphis, TN' }) }, ownerCookie);
  assert.equal(unavailableDriverAssignment.response.status, 409);

  const assignment = await request('/api/fleet/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '221', loadRef: 'JL-8051', equipmentType: 'Dry van', driverName: 'Unassigned', route: 'Memphis, TN → Atlanta, GA' }) }, ownerCookie);
  assert.equal(assignment.response.status, 201);
  assert.equal(assignment.body.assignStatus, 'assigned');
  assert.equal(assignment.body.workflowStatus, 'assigned');
  assert.ok(assignment.body.matchScore >= 80);
  const dispatched = await request(`/api/fleet/assignments/${encodeURIComponent(assignment.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'dispatched', notes: 'Dispatcher released the load to the driver.' }) }, ownerCookie);
  assert.equal(dispatched.response.status, 200);
  assert.equal(dispatched.body.workflowStatus, 'dispatched');
  assert.ok((await request(`/api/fleet/assignments/${encodeURIComponent(assignment.body.id)}/history`, {}, ownerCookie)).body.some(item => item.status === 'dispatched'));
  const duplicateUnit = await request('/api/fleet/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '221', loadRef: 'JL-8038', equipmentType: 'Dry van', driverName: 'Unassigned', route: 'St. Louis, MO → Memphis, TN' }) }, ownerCookie);
  assert.equal(duplicateUnit.response.status, 409);
  const mismatched = await request('/api/fleet/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit: '204', loadRef: 'JL-8042', equipmentType: 'Dry van', driverName: 'Marcus Turner', route: 'Dallas, TX → Little Rock, AR' }) }, ownerCookie);
  assert.equal(mismatched.response.status, 400);
  const assignments = await request('/api/fleet/assignments', {}, ownerCookie);
  assert.ok(assignments.body.some(item => item.unit === '221'));

  const deniedDvir = await request('/api/fleet/204/dvir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionType: 'pre-trip', odometerMiles: 50000, checks: [] }) }, safetyCookie);
  assert.equal(deniedDvir.response.status, 403);
  const checklist = ['Service brakes', 'Tires and wheels', 'Lights and reflectors', 'Steering', 'Coupling devices', 'Mirrors and windshield', 'Emergency equipment', 'Leaks and fluid levels'].map(item => ({ item, status: item === 'Tires and wheels' ? 'fail' : 'pass' }));
  const incompleteChecklist = checklist.map(check => ({ ...check }));
  incompleteChecklist[0].status = 'not_checked';
  const incompleteDvir = await request('/api/fleet/204/dvir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionType: 'pre-trip', odometerMiles: 50000, checks: incompleteChecklist }) }, ownerCookie);
  assert.equal(incompleteDvir.response.status, 400);
  const dvir = await request('/api/fleet/204/dvir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionType: 'pre-trip', odometerMiles: 50000, checks: checklist, notes: 'Right rear tire has low pressure.' }) }, ownerCookie);
  assert.equal(dvir.response.status, 201);
  assert.equal(dvir.body.status, 'Needs repair');
  assert.equal((await request('/api/fleet', {}, ownerCookie)).body.find(unit => unit.unit === '204').maintenanceDue, 1);
  const deniedRepair = await request(`/api/fleet/dvir/${encodeURIComponent(dvir.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Repair complete' }) }, safetyCookie);
  assert.equal(deniedRepair.response.status, 403);
  const repaired = await request(`/api/fleet/dvir/${encodeURIComponent(dvir.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Repair complete' }) }, ownerCookie);
  assert.equal(repaired.response.status, 200);
  assert.equal(repaired.body.status, 'Repair complete');
});

test('advisor explains record-backed alerts and readiness checklist updates are audited', async () => {
  const deniedAdvisor = await request('/api/advisor', {}, safetyCookie);
  assert.equal(deniedAdvisor.response.status, 403);
  const advisor = await request('/api/advisor', {}, ownerCookie);
  assert.equal(advisor.response.status, 200);
  assert.equal(advisor.body.mode, 'rules-based decision support');
  assert.equal(advisor.body.metrics.atRiskLoadCount, 1);
  assert.ok(advisor.body.insights.some(insight => insight.sources.includes('JL-8042')));
  assert.equal(advisor.body.metrics.unassignedLoadCount, 1);
  assert.equal(advisor.body.metrics.loadAssignmentRatePercent, 67);
  assert.ok(advisor.body.metrics.customerProfitability.some(group => group.name === 'Delta Supply Co.'));
  assert.ok(advisor.body.metrics.laneProfitability.some(group => group.name === 'Memphis, TN → Atlanta, GA'));
  assert.ok(advisor.body.metrics.fuelCostPerMileByDriver.some(driver => driver.driver === 'M. Turner'));
  assert.match(advisor.body.metrics.dataQualityNote, /Missing cost entries/);
  assert.equal(advisor.body.metrics.debtToIncomeCents, null);
  const advisorAction = await request('/api/advisor/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area: 'COO · Dispatch', priority: 'High', title: 'Review at-risk load', detail: 'Confirm appointment status and next driver check-in.', sources: ['JL-8042'], dueDate: '2026-10-02' }) }, ownerCookie);
  assert.equal(advisorAction.response.status, 201);
  assert.equal(advisorAction.body.status, 'open');
  assert.equal((await request('/api/advisor/actions', {}, ownerCookie)).body.some(item => item.id === advisorAction.body.id && item.sources.includes('JL-8042')), true);
  const completedAction = await request(`/api/advisor/actions/${encodeURIComponent(advisorAction.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed', outcome: 'Dispatcher confirmed the appointment and driver check-in.' }) }, ownerCookie);
  assert.equal(completedAction.response.status, 200);
  assert.equal(completedAction.body.status, 'completed');

  const checklist = await request('/api/readiness', {}, ownerCookie);
  assert.equal(checklist.response.status, 200);
  assert.ok(checklist.body.length >= 15);
  const invalidDate = await request('/api/readiness/ein', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate: '2026-02-30' }) }, ownerCookie);
  assert.equal(invalidDate.response.status, 400);
  const updated = await request('/api/readiness/ein', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'In progress', dueDate: '2026-10-31', notes: 'Application submitted; confirmation pending.' }) }, safetyCookie);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.status, 'In progress');
  assert.equal((await request('/api/readiness', {}, ownerCookie)).body.find(item => item.id === 'ein').notes, 'Application submitted; confirmation pending.');
});

test('weighted employee scorecards are HR-restricted and require human review', async () => {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'hr@jackson.local', password: 'hr-demo' }) });
  assert.equal(login.response.status, 200);
  hrCookie = login.cookie;
  assert.equal((await request('/api/people/scorecards', {}, safetyCookie)).response.status, 403);
  assert.equal((await request('/api/people/scorecards', {}, hrCookie)).response.status, 200);

  const payload = { employeeName: 'Jordan Lee', jobRole: 'Driver', quantitativeScore: 100, strategicScore: 80, qualitativeScore: 70, reliabilityScore: 90, evidenceNotes: 'Quarterly KPI report and reviewed OKR evidence.' };
  const invalid = await request('/api/people/scorecards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, qualitativeScore: 101 }) }, hrCookie);
  assert.equal(invalid.response.status, 400);
  const scorecard = await request('/api/people/scorecards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, hrCookie);
  assert.equal(scorecard.response.status, 201);
  assert.equal(scorecard.body.overallScore, 87);
  assert.equal(scorecard.body.grade, 'B to B+');
  assert.equal(scorecard.body.status, 'Draft');

  const reviewed = await request(`/api/people/scorecards/${encodeURIComponent(scorecard.body.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Reviewed', reviewerNotes: 'Discussed evidence and employee response.' }) }, hrCookie);
  assert.equal(reviewed.response.status, 200);
  assert.equal(reviewed.body.status, 'Reviewed');
  assert.equal(reviewed.body.reviewedBy, 'Monica Hayes');
  assert.ok(reviewed.body.reviewedAt);
});

test('document attachments validate signatures and enforce download permissions', async () => {
  const pdf = Buffer.from('%PDF-1.4\nJackson receipt attachment\n%%EOF', 'ascii').toString('base64');
  const document = await request('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fuel receipt', type: 'Receipt', reference: 'JL-8051', status: 'Filed', fileName: 'fuel-receipt.pdf', mimeType: 'application/pdf', fileBase64: pdf }) }, ownerCookie);
  assert.equal(document.response.status, 201);
  assert.equal(document.body.hasFile, true);
  assert.equal(document.body.fileName, 'fuel-receipt.pdf');
  const listing = await request('/api/documents', {}, ownerCookie);
  assert.equal(listing.body.find(item => item.id === document.body.id).fileSize, Buffer.from(pdf, 'base64').length);
  const hrListing = await request('/api/documents', {}, hrCookie);
  assert.equal(hrListing.body.some(item => item.id === document.body.id), false);
  const driverFile = await request('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Medical card record', type: 'Driver file', reference: '215', status: 'Expiring soon' }) }, ownerCookie);
  assert.equal(driverFile.response.status, 201);
  assert.ok((await request('/api/documents', {}, hrCookie)).body.some(item => item.id === driverFile.body.id));

  const badSignature = await request('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fake PDF', type: 'Receipt', reference: 'JL-8051', status: 'Filed', fileName: 'fake.pdf', mimeType: 'application/pdf', fileBase64: Buffer.from('not a pdf', 'ascii').toString('base64') }) }, ownerCookie);
  assert.equal(badSignature.response.status, 400);

  const download = await fetch(`http://127.0.0.1:${port}/api/documents/${encodeURIComponent(document.body.id)}/file`, { headers: { Cookie: ownerCookie } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await download.arrayBuffer()).toString('ascii'), '%PDF-1.4\nJackson receipt attachment\n%%EOF');
  const denied = await request(`/api/documents/${encodeURIComponent(document.body.id)}/file`, {}, hrCookie);
  assert.equal(denied.response.status, 403);
});

test('owner can view audit and notification feeds', async () => {
  const audit = await request('/api/audit', {}, ownerCookie);
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.some(entry => entry.action === 'Created incident'));
  assert.ok(audit.body.some(entry => entry.entityType === 'finance_entry'));
  assert.ok(audit.body.some(entry => entry.entityType === 'employee_scorecard'));
  const notifications = await request('/api/notifications', {}, ownerCookie);
  assert.equal(notifications.response.status, 200);
  assert.ok(Array.isArray(notifications.body));
});
