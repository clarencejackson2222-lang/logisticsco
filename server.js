const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const port = Number(process.env.PORT || 4173);
const root = __dirname;
const dataDirectory = path.join(root, 'data');
const databaseFile = path.join(dataDirectory, 'commandos.sqlite');
const sessions = new Map();
const defaultUsers = [
  { id: 'USR-001', name: 'Clarence Jackson', email: process.env.COMMANDOS_ADMIN_EMAIL || 'owner@jackson.local', password: process.env.COMMANDOS_ADMIN_PASSWORD || 'commandos-demo', role: 'Owner / Admin' },
  { id: 'USR-002', name: 'Tasha Green', email: 'dispatch@jackson.local', password: 'dispatch-demo', role: 'Dispatcher' },
  { id: 'USR-003', name: 'Renee Hayes', email: 'safety@jackson.local', password: 'safety-demo', role: 'Safety' }
];
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password, storedHash) { const [salt, key] = storedHash.split(':'); if (!salt || !key) return false; const derived = crypto.scryptSync(password, salt, 64); return crypto.timingSafeEqual(derived, Buffer.from(key, 'hex')); }
const defaultLoads = [
  ['JL-8051', 'Memphis, TN', 'Atlanta, GA', 'Delta Supply Co.', '204', 'M. Turner', '$4,280', 'In transit'],
  ['JL-8042', 'Dallas, TX', 'Little Rock, AR', 'Arkansas Foods', '218', 'A. Brooks', '$3,940', 'At risk'],
  ['JL-8038', 'St. Louis, MO', 'Memphis, TN', 'MidSouth Retail', '197', 'J. Carter', '$2,860', 'In transit'],
  ['JL-8029', 'Atlanta, GA', 'Birmingham, AL', 'Pioneer Materials', '221', 'Unassigned', '$1,920', 'Booked']
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
`);
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

function readLoads() { return database.prepare('SELECT id, origin, destination, customer, unit, driver, revenue, status FROM loads ORDER BY id DESC').all(); }
function readIncidents() { return database.prepare('SELECT id, type, severity, unit, location, description, status, time, created_at AS createdAt FROM incidents ORDER BY created_at DESC').all(); }
function readUsers() { return database.prepare('SELECT id, name, email, role, active, created_at AS createdAt FROM users ORDER BY name').all(); }
function recordAudit(user, action, entityType, entityId, details) { database.prepare('INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, user.name, user.role, action, entityType, entityId, details, new Date().toISOString()); }

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
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
  const permissions = { 'Owner / Admin': ['incident:create', 'load:update'], Dispatcher: ['incident:create', 'load:update'], Safety: ['incident:create'] };
  return permissions[user.role]?.includes(permission) || false;
}

function sendFile(response, requestPath) {
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
    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok', service: 'jackson-commandos-api', time: new Date().toISOString() });
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
      const allowedRoles = ['Owner / Admin', 'Dispatcher', 'Safety', 'Maintenance', 'Accounting', 'Warehouse'];
      if (payload.role && !allowedRoles.includes(payload.role)) { sendJson(response, 400, { error: 'Invalid role' }); return; }
      if (target.id === actor.id && payload.active === false) { sendJson(response, 400, { error: 'You cannot deactivate your own account' }); return; }
      const nextRole = payload.role || target.role;
      const nextActive = typeof payload.active === 'boolean' ? Number(payload.active) : Number(target.active);
      database.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(nextRole, nextActive, target.id);
      recordAudit(actor, 'Updated user', 'user', target.id, `role=${nextRole}; active=${Boolean(nextActive)}`);
      sendJson(response, 200, { ...target, role: nextRole, active: nextActive });
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
    if (request.method === 'GET') { sendFile(response, requestUrl.pathname); return; }
    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(port, () => console.log(`Jackson CommandOS running at http://localhost:${port}`));
