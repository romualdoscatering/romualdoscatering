/**
 * Romualdo's Catering — Inquiry API (Google Apps Script)
 * ------------------------------------------------------
 * Runs under Romualdo's Google account. It:
 *   • saves customer inquiries into a JSON file in Google Drive (the database)
 *   • checks staff logins against the "Romualdos Staff Logins" Excel file
 *     kept in the same Drive folder (passwords never leave Google)
 *   • lets only logged-in staff read, update, delete or export inquiries
 *
 * Deploy: Deploy > New deployment > Web app
 *         Execute as: Me    Who has access: Anyone
 */

const CONFIG = {
  DB_FILE_ID: '1jYTMfnYb6PWnU3Su_WZoRTxBHbgMqung',     // romualdos_inquiries.json
  APP_FOLDER_ID: '17SQVAGYVJfBrQKz-HF4-IO6V6qmXSNrj',  // "Romualdo's Inquiry App" folder
  STAFF_FILE_KEYWORD: 'staff logins',                  // file name must contain this
  STAFF_SHEET_NAME: 'Staff Logins',
  SESSION_SECONDS: 6 * 60 * 60,                        // staff stay logged in up to 6 hours
  MAX_LOGIN_FAILS: 5,                                  // wrong passwords before a lock
  LOCK_SECONDS: 15 * 60,                               // lock length
  MAX_SUBMITS_PER_HOUR: 60                             // spam guard for the public form
};

const STATUSES = ['New', 'Contacted', 'Quoted', 'Booked', 'Declined'];

/* ===================== ENTRY POINTS ===================== */
function doGet() {
  return out({ ok: true, service: "Romualdo's Inquiry API" });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out({ ok: false, error: 'Bad request.' }); }
  try {
    switch (req.action) {
      // ---- public ----
      case 'config':    { const db = readDb(); return out({ ok: true, rates: db.rates || null, menu: db.menu || null }); }
      case 'submit':    return out(submitInquiry(req.inquiry, 'web', req.website));
      case 'login':     return out(login(req.username, req.password));
      // ---- staff ----
      case 'me':        { const s = requireStaff(req.token); return out({ ok: true, user: s }); }
      case 'logout':    CacheService.getScriptCache().remove('s_' + String(req.token || '')); return out({ ok: true });
      case 'list':      requireStaff(req.token); return out({ ok: true, inquiries: readDb().inquiries });
      case 'add':       requireStaff(req.token); return out(submitInquiry(req.inquiry, 'message'));
      case 'status':    requireStaff(req.token); return out(setStatus(req.ref, req.status));
      // ---- admin ----
      case 'delete':    requireAdmin(req.token); return out(deleteInquiry(req.ref));
      case 'saveRates': requireAdmin(req.token); return out(saveRates(req.rates));
      case 'saveMenu':  requireAdmin(req.token); return out(saveMenu(req.menu));
      default:          return out({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    if (err && err.isForbidden) return out({ ok: false, error: err.message });
    if (err && err.isAuth) return out({ ok: false, auth: true, error: err.message });
    console.error(err);
    return out({ ok: false, error: 'Server error. Please try again.' });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function authError(msg) { const e = new Error(msg); e.isAuth = true; return e; }

/* ===================== JSON DATABASE ===================== */
function dbFile() { return DriveApp.getFileById(CONFIG.DB_FILE_ID); }
function readDb() {
  const txt = dbFile().getBlob().getDataAsString('UTF-8');
  let db;
  try { db = JSON.parse(txt || '{}'); } catch (e) { throw new Error('Database file is not valid JSON.'); }
  if (!Array.isArray(db.inquiries)) db.inquiries = [];
  return db;
}
function writeDb(db) {
  db.updatedAt = new Date().toISOString();
  dbFile().setContent(JSON.stringify(db, null, 1));
}
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== INQUIRIES ===================== */
function str(v, max) { return String(v == null ? '' : v).slice(0, max || 200).trim(); }
function num(v) { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
function newRef() {
  const d = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyMMdd');
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = '';
  for (let i = 0; i < 4; i++) r += a[Math.floor(Math.random() * a.length)];
  return 'RCS-' + d + '-' + r;
}

function cleanInquiry(q, source) {
  q = q || {};
  const c = q.customer || {}, ev = q.event || {}, p = q.plan || {}, es = q.estimate || {};
  const clean = {
    ref: /^RCS-[0-9A-Z-]{6,20}$/.test(String(q.ref || '')) ? String(q.ref) : newRef(),
    createdAt: new Date().toISOString(),
    status: 'New',
    source: source,
    customer: { name: str(c.name, 120), phone: str(c.phone, 40), email: str(c.email, 120) },
    event: { date: str(ev.date, 10), time: str(ev.time, 5), type: str(ev.type, 60), venue: str(ev.venue, 200), pax: Math.floor(num(ev.pax)) },
    notes: str(q.notes, 2000),
    plan: {
      kind: p.kind === 'package' ? 'package' : 'custom',
      packageId: str(p.packageId, 20), packageName: str(p.packageName, 40),
      pricePerHead: num(p.pricePerHead), basePerHead: num(p.basePerHead), chefPick: !!p.chefPick
    },
    items: (Array.isArray(q.items) ? q.items : []).slice(0, 80).map(function (i) {
      return { cat: str(i.cat, 20), dish: str(i.dish, 120), tier: str(i.tier, 10), perHead: num(i.perHead) };
    }),
    estimate: { perHead: num(es.perHead), total: num(es.total) }
  };
  if (source === 'message' && q.createdAt && !isNaN(new Date(q.createdAt))) clean.createdAt = new Date(q.createdAt).toISOString();
  if (!clean.customer.name || !clean.customer.phone || !clean.event.date) throw new Error('Name, mobile number and event date are required.');
  return clean;
}

function submitInquiry(q, source, honeypot) {
  if (honeypot) return { ok: true, ref: newRef() };            // silently ignore bots
  if (source === 'web') {
    const cache = CacheService.getScriptCache();
    const key = 'sub_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
    const n = Number(cache.get(key) || 0);
    if (n >= CONFIG.MAX_SUBMITS_PER_HOUR) return { ok: false, error: 'We are receiving many inquiries right now. Please try again in a little while or call us.' };
    cache.put(key, String(n + 1), 3600);
  }
  let inq;
  try { inq = cleanInquiry(q, source); } catch (e) { return { ok: false, error: e.message }; }
  return withLock(function () {
    const db = readDb();
    if (source === 'message' && db.inquiries.some(function (x) { return x.ref === inq.ref; }))
      return { ok: false, error: inq.ref + ' is already in the list.' };
    while (db.inquiries.some(function (x) { return x.ref === inq.ref; })) inq.ref = newRef();
    db.inquiries.unshift(inq);
    writeDb(db);
    return { ok: true, ref: inq.ref, inquiry: inq };
  });
}

function setStatus(ref, status) {
  if (STATUSES.indexOf(status) < 0) return { ok: false, error: 'Invalid status.' };
  return withLock(function () {
    const db = readDb();
    const q = db.inquiries.find(function (x) { return x.ref === ref; });
    if (!q) return { ok: false, error: 'Inquiry not found.' };
    q.status = status; q.updatedAt = new Date().toISOString();
    writeDb(db);
    return { ok: true };
  });
}

function deleteInquiry(ref) {
  return withLock(function () {
    const db = readDb();
    const before = db.inquiries.length;
    db.inquiries = db.inquiries.filter(function (x) { return x.ref !== ref; });
    if (db.inquiries.length === before) return { ok: false, error: 'Inquiry not found.' };
    writeDb(db);
    return { ok: true };
  });
}

function saveRates(r) {
  r = r || {};
  const courses = ['soup', 'appetizer', 'chicken', 'pork', 'beef', 'fish', 'veg', 'pasta', 'dessert'];
  const clean = { base: num(r.base), minPax: Math.max(1, Math.floor(num(r.minPax)) || 50), standard: {}, premium: {} };
  courses.forEach(function (c) {
    clean.standard[c] = num(r.standard && r.standard[c]);
    clean.premium[c] = num(r.premium && r.premium[c]);
  });
  return withLock(function () {
    const db = readDb(); db.rates = clean; writeDb(db);
    return { ok: true, rates: clean };
  });
}

/** Menu items edited by Admins. Shape: { standard: { soup: [{name, price?}], ... }, premium: {...} } */
function saveMenu(m) {
  m = m || {};
  const courses = ['soup', 'appetizer', 'chicken', 'pork', 'beef', 'fish', 'veg', 'pasta', 'dessert'];
  const clean = { standard: {}, premium: {} };
  for (const t of ['standard', 'premium']) {
    for (const c of courses) {
      const seen = {}; const list = [];
      ((m[t] && Array.isArray(m[t][c])) ? m[t][c] : []).slice(0, 100).forEach(function (it) {
        const name = str(it && it.name, 100).replace(/[|]/g, ' ').replace(/\s+/g, ' ');
        if (!name || seen[name.toLowerCase()]) return;
        seen[name.toLowerCase()] = true;
        const item = { name: name };
        if (it.price !== null && it.price !== undefined && it.price !== '' && isFinite(Number(it.price))) item.price = num(it.price);
        list.push(item);
      });
      if (!list.length) return { ok: false, error: 'Every course needs at least one dish (' + c + ', ' + t + ' list).' };
      clean[t][c] = list;
    }
  }
  return withLock(function () {
    const db = readDb(); db.menu = clean; writeDb(db);
    return { ok: true, menu: clean };
  });
}

/* ===================== STAFF LOGIN ===================== */
function login(username, password) {
  const u = str(username, 80).toLowerCase();
  const pw = str(password, 200);
  if (!u || !pw) return { ok: false, error: 'Enter your username and password.' };
  const cache = CacheService.getScriptCache();
  const failKey = 'f_' + u;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= CONFIG.MAX_LOGIN_FAILS) return { ok: false, error: 'Too many attempts. Please wait 15 minutes and try again.' };

  const staff = loadStaff();
  const rec = staff.find(function (s) { return s.username === u; });
  const good = rec && rec.active && safeEqual(rec.password, pw);
  if (!good) {
    cache.put(failKey, String(fails + 1), CONFIG.LOCK_SECONDS);
    return { ok: false, error: rec && !rec.active ? 'This account is inactive. Please contact the owner.' : 'Incorrect username or password.' };
  }
  cache.remove(failKey);
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const session = { username: rec.username, name: rec.name || rec.username, role: rec.role };
  cache.put('s_' + token, JSON.stringify(session), CONFIG.SESSION_SECONDS);
  return { ok: true, token: token, user: session };
}

function requireStaff(token) {
  token = String(token || '');
  if (!token) throw authError('Please log in.');
  const raw = CacheService.getScriptCache().get('s_' + token);
  if (!raw) throw authError('Your session has ended. Please log in again.');
  const s = JSON.parse(raw);
  // re-check that the account is still active in the staff file
  const rec = loadStaff().find(function (x) { return x.username === s.username; });
  if (!rec || !rec.active) { CacheService.getScriptCache().remove('s_' + token); throw authError('This account is no longer active.'); }
  s.role = rec.role;
  return s;
}
function requireAdmin(token) {
  const s = requireStaff(token);
  if (s.role !== 'Admin') { const e = new Error('Only Admin accounts can do this.'); e.isForbidden = true; throw e; }
  return s;
}

function safeEqual(a, b) {
  const h = function (x) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(x), Utilities.Charset.UTF_8)); };
  return h(a) === h(b);
}

/** Reads the newest file in the app folder whose name contains "Staff Logins".
 *  Works with an uploaded Excel file (.xlsx) or a Google Sheet. */
function loadStaff() {
  const folder = DriveApp.getFolderById(CONFIG.APP_FOLDER_ID);
  const it = folder.getFiles(); let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (f.getName().toLowerCase().indexOf(CONFIG.STAFF_FILE_KEYWORD) < 0) continue;
    const mt = f.getMimeType();
    if (mt !== MimeType.GOOGLE_SHEETS && mt !== MimeType.MICROSOFT_EXCEL) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw authError('Staff login file not found. Upload "Romualdos Staff Logins.xlsx" to the Romualdo\'s Inquiry App folder in Google Drive.');

  let rows;
  if (best.getMimeType() === MimeType.GOOGLE_SHEETS) {
    const ss = SpreadsheetApp.openById(best.getId());
    const sh = ss.getSheetByName(CONFIG.STAFF_SHEET_NAME) || ss.getSheets()[0];
    rows = sh.getDataRange().getDisplayValues();
  } else {
    const blob = best.getBlob().setContentType('application/zip');
    const parts = {};
    Utilities.unzip(blob).forEach(function (p) { parts[p.getName()] = p; });
    rows = parseXlsxRows(function (name) { return parts[name] ? parts[name].getDataAsString('UTF-8') : null; }, CONFIG.STAFF_SHEET_NAME);
  }
  return staffFromRows(rows);
}

function staffFromRows(rows) {
  let h = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i].map(function (v) { return String(v || '').trim().toLowerCase(); });
    if (r.indexOf('username') >= 0 && r.indexOf('password') >= 0) {
      h = i;
      r.forEach(function (v, j) { col[v] = j; });
      break;
    }
  }
  if (h < 0) throw authError('The staff login file is missing its "Username" and "Password" header row.');
  const pick = function (row, key) { const j = col[key]; return j == null ? '' : String(row[j] == null ? '' : row[j]).trim(); };
  const list = [];
  for (let i = h + 1; i < rows.length; i++) {
    const row = rows[i];
    const username = pick(row, 'username').toLowerCase();
    const password = pick(row, 'password');
    if (!username || !password) continue;
    const role = /^admin/i.test(pick(row, 'role')) ? 'Admin' : 'Staff';
    const act = pick(row, 'active').toLowerCase();
    list.push({ name: pick(row, 'full name'), username: username, password: password, role: role,
                active: !(act === 'no' || act === 'n' || act === 'inactive' || act === 'false') });
  }
  return list;
}

/* ---------- minimal .xlsx reader (no add-ons needed) ---------- */
function xmlDecode(s) {
  return String(s).replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function xmlTexts(fragment) {
  // join every <t>…</t> run, skipping phonetic <rPh> blocks
  const s = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g;
  let m, outText = '';
  while ((m = re.exec(s))) outText += m[1] ? xmlDecode(m[1]) : '';
  return outText;
}
function attr(tag, name) {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
  return m ? xmlDecode(m[1]) : null;
}
function colIndex(ref) {
  const letters = String(ref).replace(/[^A-Z]/gi, '').toUpperCase(); let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}
function parseXlsxRows(getText, wantSheet) {
  const wb = getText('xl/workbook.xml');
  if (!wb) throw authError('The staff login file is not a valid Excel file.');
  const rels = getText('xl/_rels/workbook.xml.rels') || '';
  const sheets = [];
  (wb.match(/<(?:\w+:)?sheet\b[^>]*\/?>/g) || []).forEach(function (tag) {
    sheets.push({ name: attr(tag, 'name'), rid: attr(tag, 'r:id') || attr(tag, '[\\w]+:id') });
  });
  const sheet = sheets.find(function (s) { return s.name && s.name.toLowerCase() === String(wantSheet).toLowerCase(); }) || sheets[0];
  let target = 'worksheets/sheet1.xml';
  (rels.match(/<(?:\w+:)?Relationship\b[^>]*\/?>/g) || []).forEach(function (tag) {
    if (sheet && attr(tag, 'Id') === sheet.rid) target = attr(tag, 'Target');
  });
  const path = target.charAt(0) === '/' ? target.slice(1) : (target.indexOf('xl/') === 0 ? target : 'xl/' + target);
  const xml = getText(path);
  if (!xml) throw authError('Could not read the "Staff Logins" sheet.');

  const shared = [];
  const ssXml = getText('xl/sharedStrings.xml');
  if (ssXml) (ssXml.match(/<(?:\w+:)?si\b[^>]*>[\s\S]*?<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g) || []).forEach(function (si) { shared.push(xmlTexts(si)); });

  const rows = [];
  (xml.match(/<(?:\w+:)?row\b[^>]*>[\s\S]*?<\/(?:\w+:)?row>/g) || []).forEach(function (rowXml) {
    const rIdx = Number(attr(rowXml.slice(0, rowXml.indexOf('>') + 1), 'r')) - 1;
    const row = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g; let m;
    while ((m = cellRe.exec(rowXml))) {
      const head = ' ' + m[1], body = m[2] || '';
      const ref = attr(head, 'r'), t = attr(head, 't');
      const vm = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
      let val = '';
      if (t === 's') val = vm ? (shared[Number(vm[1])] || '') : '';
      else if (t === 'inlineStr') val = xmlTexts(body);
      else val = vm ? xmlDecode(vm[1]) : '';
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows[isNaN(rIdx) ? rows.length : rIdx] = row;
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/* ===================== SETUP CHECK ===================== */
/** Run this once from the editor (select "testSetup" > Run) to grant access and check everything. */
function testSetup() {
  const db = readDb();
  console.log('Database OK — ' + db.inquiries.length + ' inquiries.');
  const staff = loadStaff();
  console.log('Staff file OK — ' + staff.length + ' account(s): ' + staff.map(function (s) { return s.username + ' (' + s.role + (s.active ? '' : ', inactive') + ')'; }).join(', '));
}
