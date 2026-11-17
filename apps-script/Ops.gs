/**
 * Romualdo's Operations API — purchasing, stock, requisitions (Google Apps Script)
 * -----------------------------------------------------------------------------
 * Lives in the SAME Apps Script project as Code.gs and uses the same staff logins
 * ("Romualdos Staff Logins" file). Records are kept in a Google Sheet called
 * "Romualdo's Ops Data" that this script creates in the Romualdo's Inquiry App folder.
 *
 * One row per record: path | coll | data (JSON) | createdAt | createdBy | updatedAt | updatedBy
 * Records are never deleted — they are voided (Admin only).
 *
 * After adding this file: run "testOps" once from the editor, then
 * Deploy > Manage deployments > ✏️ > Version: New version > Deploy.
 */

const OPS = {
  SS_PROP: 'OPS_SPREADSHEET_ID',
  SHEET: 'docs',
  HEAD: ['path', 'coll', 'data', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  STAFF_RECHECK_SECONDS: 120,      // how often an active session is re-checked against the staff file
  COLLS: ['config', 'items', 'events', 'advances', 'purchases', 'expenses', 'moves', 'counts', 'sales', 'prs', 'recipes', 'bills', 'sc', 'kinv', 'kdraft'],
  MAX_OPS: 50,
  MAX_DOC_CHARS: 45000
};

/* ---------------- entry ---------------- */
function handleOps(req) {
  const me = requireOps(req.token);
  switch (req.action) {
    case 'opsSync':  return opsSync(me, req);
    case 'opsWrite': return opsWrite(me, req.ops);
    case 'sheetSync': return sheetSync(me, req);
    case 'archiveSync': return archiveSync(me);
    case 'opsUpload': return opsUpload(me, req);
    case 'opsFile': return opsFile(me, req);
    case 'opsOcr': return opsOcr(me, req);
    case 'scAttendance': return scAttendance(me, req);
    case 'scFile': return scFile(me, req);
    case 'kinvSync': return kinvSync(me);
    case 'kinvMail': return kinvMailSend(me, req);
    default:         return { ok: false, error: 'Unknown action.' };
  }
}

/** Like requireStaff, but re-reads the staff file at most every 2 minutes (the app polls often). */
function requireOps(token) {
  token = String(token || '');
  if (!token) throw authError('Please log in.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('s_' + token);
  if (!raw) throw authError('Your session has ended. Please log in again.');
  const s = JSON.parse(raw);
  const ck = 'ok_' + token;
  const fresh = cache.get(ck);
  if (fresh) { s.role = fresh; return s; }
  const rec = loadStaff().find(function (x) { return x.username === s.username; });
  if (!rec || !rec.active) { cache.remove('s_' + token); throw authError('This account is no longer active.'); }
  s.role = rec.role;
  cache.put(ck, rec.role, OPS.STAFF_RECHECK_SECONDS);
  return s;
}

function forbid(msg) { const e = new Error(msg); e.isForbidden = true; throw e; }

/* ---------------- storage ---------------- */
function opsSheet() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(OPS.SS_PROP);
  if (id) {
    try { const sh = SpreadsheetApp.openById(id).getSheetByName(OPS.SHEET); if (sh) return sh; } catch (e) {}
  }
  const ss = SpreadsheetApp.create("Romualdo's Ops Data");
  try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(CONFIG.APP_FOLDER_ID)); } catch (e) {}
  const sh = ss.getSheets()[0];
  sh.setName(OPS.SHEET);
  sh.getRange(1, 1, 1, OPS.HEAD.length).setValues([OPS.HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(3, 500);
  props.setProperty(OPS.SS_PROP, ss.getId());
  return sh;
}
function readAll(sh) {
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, OPS.HEAD.length).getValues().map(function (r, i) {
    return { row: i + 2, path: String(r[0]), coll: String(r[1]), json: String(r[2]), createdAt: Number(r[3]) || 0, createdBy: String(r[4]), updatedAt: Number(r[5]) || 0, updatedBy: String(r[6]) };
  });
}
function toDoc(r) {
  let data = {};
  try { data = JSON.parse(r.json || '{}'); } catch (e) {}
  return { path: r.path, data: data, updatedAt: r.updatedAt };
}
function opsVersion() { return Number(PropertiesService.getScriptProperties().getProperty('OPS_VER') || 0); }
function bumpVersion() {
  const v = opsVersion() + 1;
  PropertiesService.getScriptProperties().setProperty('OPS_VER', String(v));
  CacheService.getScriptCache().put('ops_ver', String(v), 21600);
  return v;
}

/* ---------------- sync ---------------- */
function opsSync(me, req) {
  const cache = CacheService.getScriptCache();
  let ver = Number(cache.get('ops_ver'));
  if (!ver) { ver = opsVersion(); cache.put('ops_ver', String(ver), 21600); }
  const base = { ok: true, ver: ver, me: { username: me.username, name: me.name, role: me.role }, now: Date.now() };
  if (req.ver && Number(req.ver) === ver) { base.unchanged = true; return base; }
  const after = Number(req.after) || 0;
  const canBill = me.role === 'Admin' || me.role === 'Finance';
  base.docs = readAll(opsSheet()).filter(function (r) { return r.updatedAt > after && (canBill || (r.coll !== 'bills' && r.coll !== 'sc')); }).map(toDoc);
  base.users = opsUsers();
  return base;
}
function opsUsers() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('ops_users');
  if (c) return JSON.parse(c);
  const list = loadStaff().map(function (s) { return { username: s.username, name: s.name || s.username, role: s.role, active: s.active }; });
  cache.put('ops_users', JSON.stringify(list), 300);
  return list;
}

/* ---------------- write ---------------- */
function validPath(p) {
  const seg = String(p || '').split('/');
  return seg.length === 2 && OPS.COLLS.indexOf(seg[0]) >= 0 && /^[A-Za-z0-9_.:@+~-]{1,120}$/.test(seg[1]);
}
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function deepMerge(a, b) {
  const o = JSON.parse(JSON.stringify(a || {}));
  Object.keys(b || {}).forEach(function (k) { o[k] = isObj(b[k]) && isObj(o[k]) ? deepMerge(o[k], b[k]) : b[k]; });
  return o;
}
const same = function (a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); };

/** What a Staff account may NOT do. Admin may do everything.
 *  fin = a Finance account: Staff rights plus billing (statements, contract prices, event-sheet prices, amounts billed and paid). */
function checkStaff(coll, before, after, fin) {
  if (coll === 'config') forbid('Only Admin accounts can change the setup lists.');
  if (coll === 'bills') {
    if (!fin) forbid('Only Admin and Finance accounts can make or change billing statements.');
    if (after.status === 'void' && (!before || before.status !== 'void')) forbid('Only Admin accounts can delete billing statements.');
    if (before && before.status === 'void' && after.status !== 'void') forbid('Only Admin accounts can restore billing statements.');
    return;
  }
  if (coll === 'sc') forbid('Only Admin and Finance accounts can work on the service charge.');
  if (coll === 'kdraft') return;
  if (coll === 'kinv') { if (after.status === 'void' && (!before || before.status !== 'void')) forbid('Only Admin accounts can void records.'); return; }
  if (coll === 'sales') {                          // daily sales: Staff enter, Finance/Admin verify, verified days are locked
    if (before && before.verified) forbid('This day is already verified. Only an Admin can change it.');
    if (after.verified && !fin) forbid('Only Finance and Admin accounts can verify a day.');
    if ((after.cat || []).some(function (c) { return c.applied; }) && !fin) forbid('Only Finance and Admin accounts can apply payments to statements.');
    if (after.status === 'void' && (!before || before.status !== 'void')) forbid('Only Admin accounts can void records.');
    return;
  }
  if (coll === 'events' && !fin) {
    const sb = (before || {}).sheet || {}, sa = after.sheet || {}, prices = function (sh) { return (sh.menu || []).filter(function (m) { return m.price; }).map(function (m) { return m.dish + '=' + m.price; }).sort().join('|'); };
    if (!same(sb.bill || null, sa.bill || null) || prices(sb) !== prices(sa)) forbid('Only Admin and Finance accounts can change billing and prices on an event sheet.');
  }
  if (!before) {                                   // creating
    if (after.status === 'void') forbid('Only Admin accounts can void records.');
    if (coll === 'prs' && after.status !== 'submitted') forbid('New requisitions must be submitted for approval.');
    return;
  }
  if (coll === 'items') {
    const keys = Object.keys(after).concat(Object.keys(before)).filter(function (k) { return k !== 'lastCost' && k.indexOf('updated') !== 0; });
    if (keys.some(function (k) { return !same(before[k], after[k]); })) forbid('Only Admin accounts can edit items (Staff can add new items).');
    return;
  }
  if (after.status === 'void' && before.status !== 'void') forbid('Only Admin accounts can void records.');
  if (before.status === 'void' && after.status !== 'void') forbid('Only Admin accounts can restore voided records.');
  if (coll === 'prs') {
    if (after.status !== before.status && ['approved', 'rejected'].indexOf(after.status) >= 0) forbid('Only Admin accounts can approve or reject requisitions.');
    if (before.status === 'approved' && after.status === 'cancelled') forbid('Only Admin accounts can cancel an approved requisition.');
  }
  if (coll === 'events') {
    if (!fin && (!same(before.contract, after.contract) || !same(before.pricing, after.pricing))) forbid('Only Admin and Finance accounts can set the contract price.');
    const rb = before.receipts || {}, ra = after.receipts || {};
    Object.keys(rb).concat(Object.keys(ra)).forEach(function (k) {
      const b = rb[k] || null, a = ra[k] || null;
      if (!same(b && b.verified, a && a.verified)) forbid('Only Admin accounts can verify receipts.');
      if (b && b.verified && !same(b, a)) forbid('A verified receipt can only be changed or removed by an Admin.');
    });
  }
  if (coll === 'events' && before.archive && !after.archive) forbid('Only Admin accounts can take an event out of the archive.');
  if (coll === 'events' && !fin && !same((before.archive || {}).billed, (after.archive || {}).billed)) forbid('Only Admin and Finance accounts can record the amount billed.');
  if (coll === 'events' && !fin && !same((before.archive || {}).payment, (after.archive || {}).payment)) forbid('Only Admin and Finance accounts can record payments.');
  if (coll === 'recipes') return;                 // the small team keeps recipes up to date together
  if (coll === 'advances' && before.status === 'liquidated' && !same(before, after)) forbid('A liquidated advance can only be changed by an Admin.');
  if (coll === 'counts' && !same(before.lines, after.lines)) forbid('Posted counts cannot be changed.');
  ['lines', 'total', 'amount', 'book', 'date', 'createdBy', 'createdAt', 'prNo'].forEach(function (k) {
    if (coll === 'events') return;
    if (!same(before[k], after[k])) forbid('Only Admin accounts can change amounts, quantities or dates on saved records. Ask an Admin to void it and enter it again.');
  });
}

function opsWrite(me, ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > OPS.MAX_OPS) return { ok: false, error: 'Nothing to save.' };
  const admin = me.role === 'Admin';
  return withLock(function () {
    const sh = opsSheet();
    const rows = readAll(sh), byPath = {};
    rows.forEach(function (r) { byPath[r.path] = r; });
    const now = Date.now(), changed = [], appends = [], updates = [];
    ops.forEach(function (o) {
      if (!o || !validPath(o.path)) forbid('Invalid record.');
      if (!isObj(o.data)) forbid('Invalid record.');
      const coll = o.path.split('/')[0];
      const ex = byPath[o.path] || null;
      const before = ex ? toDoc(ex).data : null;
      let after;
      if (o.op === 'add') { if (ex) forbid('That record already exists.'); after = JSON.parse(JSON.stringify(o.data)); }
      else if (o.op === 'set') after = JSON.parse(JSON.stringify(o.data));
      else if (o.op === 'update') { if (!ex) forbid('Record not found.'); after = deepMerge(before, o.data); }
      else forbid('Unknown operation.');
      // server-controlled fields
      after.createdAt = before ? before.createdAt : now;
      after.createdBy = before ? before.createdBy : me.username;
      after.updatedAt = now; after.updatedBy = me.username;
      if (!before && coll === 'prs') after.prNo = nextPrNo();
      if (!before && coll === 'prs') after.requestedByUser = me.username;
      if (coll === 'prs' && before && after.status !== before.status && (after.status === 'approved' || after.status === 'rejected')) { after.approverUser = me.username; after.approvedAt = now; }
      if (after.status === 'void' && (!before || before.status !== 'void')) { after.voidBy = me.username; after.voidAt = now; }
      if (coll === 'events' && isObj(after.receipts)) {
        Object.keys(after.receipts).forEach(function (k) {
          const a = after.receipts[k], b = before && isObj(before.receipts) ? before.receipts[k] : null;
          if (!a) { delete after.receipts[k]; return; }
          if (a.verified && !(b && b.verified)) { a.verified.user = me.username; a.verified.at = now; }
          if (!b) { a.addedBy = me.username; a.at = now; }
        });
      }
      if (!admin) checkStaff(coll, before, after, me.role === 'Finance');
      const json = JSON.stringify(after);
      if (json.length > OPS.MAX_DOC_CHARS) forbid('This record is too large. Split it into smaller ones.');
      const row = [o.path, coll, json, after.createdAt, after.createdBy, now, me.username];
      if (ex) { updates.push({ row: ex.row, vals: row }); ex.json = json; }
      else { appends.push(row); byPath[o.path] = { path: o.path, json: json, row: -1 }; }
      changed.push({ path: o.path, data: after, updatedAt: now });
    });
    updates.forEach(function (u) { sh.getRange(u.row, 1, 1, u.vals.length).setValues([u.vals]); });
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, OPS.HEAD.length).setValues(appends);
    const ver = bumpVersion();
    return { ok: true, docs: changed, ver: ver };
  });
}

function nextPrNo() {
  const props = PropertiesService.getScriptProperties();
  const yr = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy');
  const key = 'PR_SEQ_' + yr;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return 'PR-' + yr + '-' + ('000' + n).slice(-4);
}

/* ---------------- setup ---------------- */
/** Run once from the editor: creates the "Romualdo's Ops Data" sheet and adds starter items. */
function testOps() {
  const sh = opsSheet();
  const rows = readAll(sh);
  console.log('Ops sheet OK — ' + rows.length + ' record(s). ' + sh.getParent().getUrl());
  if (!rows.some(function (r) { return r.coll === 'items'; })) {
    const now = Date.now();
    const seed = [['chicken-breast','Chicken Breast','Poultry','kg'],['special-cut-thigh','Special Cut Thigh','Poultry','kg'],['whole-chicken','Whole Chicken','Poultry','kg'],['chicken-thigh','Chicken Thigh Fillet','Poultry','kg'],
      ['pork-belly','Pork Belly','Pork','kg'],['pork-liempo','Pork Liempo','Pork','kg'],['pork-kasim','Pork Kasim','Pork','kg'],['pork-pata','Pork Pata','Pork','kg'],['ground-pork','Ground Pork','Pork','kg'],
      ['beef-oxtail','Beef Oxtail','Beef','kg'],['beef-brisket','Beef Brisket','Beef','kg'],
      ['bangus','Bangus','Fish/Seafood','kg'],['shrimp','Shrimp','Fish/Seafood','kg'],
      ['onion-red','Red Onion','Vegetables','kg'],['garlic','Garlic','Vegetables','kg'],['tomato','Tomato','Vegetables','kg'],['ginger','Ginger','Vegetables','kg'],['potato','Potato','Vegetables','kg'],
      ['carrot','Carrot','Vegetables','kg'],['cabbage','Cabbage','Vegetables','kg'],['pechay','Pechay','Vegetables','bundle'],['sitaw','Sitaw','Vegetables','bundle'],['kalamansi','Kalamansi','Vegetables','kg'],
      ['eggs','Eggs','Eggs/Dairy','tray'],['evap-milk','Evaporated Milk','Eggs/Dairy','can'],
      ['rice','Rice','Pantry Essentials','sack'],['cooking-oil','Cooking Oil','Pantry Essentials','L'],['soy-sauce','Soy Sauce','Pantry Essentials','L'],['vinegar','Vinegar','Pantry Essentials','L'],
      ['fish-sauce','Fish Sauce (Patis)','Pantry Essentials','L'],['sugar','Sugar','Pantry Essentials','kg'],['salt','Salt','Pantry Essentials','kg'],['black-pepper','Black Pepper (Ground)','Pantry Essentials','pack'],
      ['bihon','Bihon Noodles','Pantry Essentials','pack']];
    const vals = seed.map(function (s) {
      const d = { name: s[1], cat: s[2], unit: s[3], lastCost: 0, par: { R: 0, C: 0 }, active: true, createdAt: now, createdBy: 'setup' };
      return ['items/' + s[0], 'items', JSON.stringify(d), now, 'setup', now, 'setup'];
    });
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, OPS.HEAD.length).setValues(vals);
    bumpVersion();
    console.log('Added ' + vals.length + ' starter items.');
  }
  const staff = loadStaff();
  console.log('Staff file OK — ' + staff.length + ' account(s). Admins: ' + staff.filter(function (s) { return s.role === 'Admin'; }).map(function (s) { return s.username; }).join(', '));
}


/* =====================================================================
   BOOKINGS: Google Calendar + emailed booking copy + 2-day alert
   ---------------------------------------------------------------------
   • Every event sheet (catering, food trays, food packs) is put on the
     "Catering and Events" calendar and kept up to date.
   • When staff press Save, a copy of the booking details (with a PDF)
     goes to BOOK.EMAILS — only if something changed since the last copy.
   • Every day at about 12:00 noon (Manila) everyone in BOOK.EMAILS gets an
     alert for bookings 2 days away. Calendar events also carry a pop-up
     reminder at exactly 12:00 noon two days before.
   Run setupBookings() once from the editor (and approve access).
   ===================================================================== */
const BOOK = {
  CAL_ID: '514003536ae4e0052290f7d416657b97df67ed53cb6ac667f072f8c23cd93a34@group.calendar.google.com',
  CAL_NAME: 'Catering and Events',
  EMAILS: ['events@romualdos.ph', 'romualdoscatering@gmail.com', 'jasperpatrickdomingo@gmail.com'],
  TZ: 'Asia/Manila',
  ALERT_HOUR: 12,
  DAYS_BEFORE: 2,
  OPS_URL: 'https://romualdos.ph/ops/#sheets',
  LOGO_URL: 'https://romualdos.ph/assets/logo.png'
};

/** Run once from the editor: approves Calendar access and creates the daily noon job. */
function setupBookings() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBookingJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBookingJob').timeBased().atHour(BOOK.ALERT_HOUR).nearMinute(0).everyDays(1).inTimezone(BOOK.TZ).create();
  Logger.log('Calendar: ' + bookCal().getName());
  const n = syncAllBookings(true);
  Logger.log('Daily 12 noon job set. Calendar entries checked: ' + n);
}

function bookCal() {
  let c = null;
  try { c = CalendarApp.getCalendarById(BOOK.CAL_ID); } catch (e) {}
  if (!c) { const l = CalendarApp.getCalendarsByName(BOOK.CAL_NAME); c = l.length ? l[0] : CalendarApp.getDefaultCalendar(); }
  return c;
}
function bookProps() { return PropertiesService.getScriptProperties(); }
function readEventDoc(id) {
  const r = readAll(opsSheet()).filter(function (x) { return x.path === 'events/' + id; })[0];
  return r ? toDoc(r).data : null;
}
function bookKind(sh) { return sh.kind === 'trays' ? 'Food trays' : sh.kind === 'packs' ? 'Food packs' : 'Catering'; }
function bookHash(o) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(o), Utilities.Charset.UTF_8)); }
function bookContent(ev) { const sh = ev.sheet || {}; const c = JSON.parse(JSON.stringify(sh)); delete c.savedAt; c._v = ev.status; return c; }
function clock12(t) { if (!t) return ''; const p = String(t).split(':'); const h = Number(p[0]), m = p[1] || '00'; return ((h % 12) || 12) + ':' + m + (h < 12 ? ' AM' : ' PM'); }
/* Trays/packs: only 'main' lines (the meal pack or tray itself) are counted; drinks and add-ons are listed separately. */
const DRINK_RE = /\b(water|juice|soda|soft ?drinks?|coke|sprite|royal|pepsi|7.?up|mountain dew|iced tea|tea|coffee|lemonade|drinks?|beverages?|c2|zesto|milk ?tea|shakes?|calamansi)\b/i;
function lineType(m, k) { return m.t || (DRINK_RE.test(m.dish || '') ? 'drink' : (k === 'packs' && /\btrays?\b/i.test(m.dish || '')) ? 'addon' : 'main'); }
function orderSum(sh) {
  const k = sh.kind || 'catering', L = (sh.menu || []).filter(function (m) { return m.dish; });
  const o = { mains: [], drinks: [], addons: [], main: 0, drink: 0, addon: 0 };
  L.forEach(function (m) { const t = lineType(m, k), q = parseFloat(m.qty) || 1; o[t + 's'].push(m); o[t] += q; });
  return o;
}
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
function orderLabel(sh) { const o = orderSum(sh); return (o.main ? plural(o.main, sh.kind === 'packs' ? 'pack' : 'tray') : '') + (o.addon ? (o.main ? ' + ' : '') + plural(o.addon, 'add-on') : ''); }
function bookTitle(sh) {
  const k = sh.kind || 'catering';
  if (k === 'catering') return 'Catering: ' + sh.client + (sh.type ? ' – ' + sh.type : '') + (sh.pax ? ' (' + sh.pax + ' pax)' : '');
  const lab = orderLabel(sh);
  return bookKind(sh) + (sh.fulfil ? ' (' + sh.fulfil + ')' : '') + ': ' + sh.client + (lab ? ' – ' + lab : '');
}
/** Plain-text booking details (calendar description + email text). */
function bookText(sh, ref) {
  const k = sh.kind || 'catering', cat = k === 'catering', L = [];
  const add = function (l, v) { if (v) L.push(l + ': ' + v); };
  add('Type', bookKind(sh)); add('Ref', ref); add('Status', ({draft: 'Draft', approval: 'For client approval', approved: 'Approved by client', cancelled: 'Cancelled'})[sh.status] || sh.status);
  add('Client', sh.client); add('Contact person', sh.contact); add('Mobile', sh.mobile); add('Email', sh.email);
  add(cat ? 'Date' : (sh.fulfil === 'Delivery' ? 'Delivery date' : 'Pick-up date'), niceDate(sh.date));
  if (cat) { add('Event type', sh.type); add('Guests', sh.pax ? sh.pax + ' pax' : ''); add('Call time', clock12(sh.call)); add('Serving time', clock12(sh.serve)); add('Pull-out', clock12(sh.pull)); add('Venue', sh.venue); add('Venue coordinator', sh.coord); add('Package', sh.pkg); }
  else { add('Pick-up / delivery', sh.fulfil); add(sh.fulfil === 'Delivery' ? 'Delivery time' : 'Ready by', clock12(sh.serve)); add(sh.fulfil === 'Delivery' ? 'Deliver to' : 'Pick-up at', sh.venue); add('Good for', sh.pax ? sh.pax + ' pax' : ''); }
  const menu = (sh.menu || []).filter(function (m) { return m.dish; });
  const line = function (m) { L.push('• ' + (cat ? (m.course ? m.course + ': ' : '') : (m.qty || 1) + ' × ') + m.dish + (m.note ? ' (' + m.note + ')' : '')); };
  if (menu.length && cat) { L.push(''); L.push('MENU'); menu.forEach(line); }
  else if (menu.length) {
    const o = orderSum(sh);
    [[o.mains, k === 'packs' ? 'MEAL PACKS' : 'TRAYS', o.main], [o.drinks, 'DRINKS', o.drink], [o.addons, 'ADD-ONS', o.addon]].forEach(function (g) { if (g[0].length) { L.push(''); L.push(g[1] + ' (' + g[2] + ')'); g[0].forEach(line); } });
  }
  if (cat && (sh.motif || sh.setup || sh.staff || sh.equip)) { L.push(''); L.push('SETUP & SERVICE'); add('Motif / theme', sh.motif); add('Table setup', sh.setup); add('Staff', sh.staff); add('Equipment', sh.equip); }
  if (sh.allergy || sh.special) { L.push(''); add('Allergies / dietary', sh.allergy); add('Special requests', sh.special); }
  add('Prepared by', sh.preparedBy);
  return L.join('\n');
}
/** Start/end Dates for the calendar entry, or null for an all-day entry. */
function bookTimes(sh) {
  const k = sh.kind || 'catering';
  const at = function (t) { return new Date(sh.date + 'T' + t + ':00+08:00'); };
  if (k === 'catering') {
    const s = sh.call || sh.serve; if (!s) return null;
    const start = at(s); let end = sh.pull ? at(sh.pull) : new Date(start.getTime() + 5 * 36e5);
    if (end <= start) end = new Date(end.getTime() + 864e5);
    return { start: start, end: end };
  }
  if (!sh.serve) return null;
  const st = at(sh.serve); return { start: new Date(st.getTime() - 30 * 6e4), end: st };
}
/** Minutes before the event start that equals 12:00 noon, two days before the event date (drafts, for-approval and approved alike). */
function alertMinutes(sh, start) {
  const alertAt = new Date(new Date(sh.date + 'T00:00:00+08:00').getTime() - BOOK.DAYS_BEFORE * 864e5 + BOOK.ALERT_HOUR * 36e5);
  return Math.max(0, Math.round((start.getTime() - alertAt.getTime()) / 6e4));
}

/** Creates, updates or removes the calendar entry for one event. Returns 'created' | 'updated' | 'removed' | 'same' | 'skip'. */
function syncCalendar(id, ev, force) {
  const P = bookProps(), key = 'cal_' + id, hkey = 'calh_' + id;
  const sh = ev && ev.sheet ? ev.sheet : null;
  const cal = bookCal();
  let ce = null; const cid = P.getProperty(key);
  if (cid) { try { ce = cal.getEventById(cid); } catch (e) { ce = null; } }
  if (!ev || ev.status === 'void' || !sh || !sh.date || !sh.client) {
    if (ce) { try { ce.deleteEvent(); } catch (e) {} }
    P.deleteProperty(key); P.deleteProperty(hkey);
    return ce ? 'removed' : 'skip';
  }
  const h = bookHash(bookContent(ev));
  if (ce && !force && P.getProperty(hkey) === h) return 'same';
  if (!ce) ce = adoptCalendarEvent(cal, sh);          // an entry typed in by hand earlier for the same client and date
  const ref = sh.ref || id;
  const title = (sh.status === 'cancelled' ? 'CANCELLED – ' : '') + bookTitle(sh);
  const desc = bookText(sh, ref) + '\n\nOpen in Romualdo\'s Ops: ' + BOOK.OPS_URL;
  const t = bookTimes(sh), day = new Date(sh.date + 'T00:00:00+08:00');
  const was = !!ce;
  if (ce) {
    if (t) ce.setTime(t.start, t.end); else ce.setAllDayDate(day);
    ce.setTitle(title); ce.setDescription(desc); ce.setLocation(sh.venue || '');
  } else {
    ce = t ? cal.createEvent(title, t.start, t.end, { description: desc, location: sh.venue || '' })
           : cal.createAllDayEvent(title, day, { description: desc, location: sh.venue || '' });
  }
  ce.setTag('rcs_id', id);
  ce.removeAllReminders();
  if (sh.status !== 'cancelled') { const m = alertMinutes(sh, t ? t.start : day); ce.addPopupReminder(m); ce.addEmailReminder(m); }
  P.setProperty(key, ce.getId()); P.setProperty(hkey, h);
  return was ? 'updated' : 'created';
}
function adoptCalendarEvent(cal, sh) {
  const words = String(sh.client || '').split(/[\s&,]+/).filter(function (w) { return w.length > 3 && !/^(and|don|dona|mr|mrs|ms)$/i.test(w); });
  if (!words.length) return null;
  const day = new Date(sh.date + 'T00:00:00+08:00');
  const list = cal.getEventsForDay(day).filter(function (e) {
    if (e.getTag('rcs_id')) return false;
    const t = e.getTitle().toLowerCase();
    return words.some(function (w) { return t.indexOf(w.toLowerCase()) >= 0; });
  });
  return list.length === 1 ? list[0] : null;
}

/** Called by the Ops app after Save (notify=true) or Delete. */
function sheetSync(me, req) {
  const id = String(req.id || '');
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return { ok: false, error: 'Invalid event.' };
  const ev = readEventDoc(id);
  const res = { ok: true, calendar: 'skip', emailed: false };
  try { res.calendar = syncCalendar(id, ev, false); } catch (e) { res.calendar = 'error'; res.calError = String(e.message || e).slice(0, 120); }
  if (req.notify && ev && ev.status !== 'void' && ev.sheet && ev.sheet.client && ev.sheet.date) {
    try { res.emailed = emailBooking(id, ev, me); } catch (e) { res.mailError = String(e.message || e).slice(0, 120); }
  }
  return res;
}

/* ---------- emailed copy with PDF ---------- */
function emailBooking(id, ev, me) {
  const P = bookProps(), mkey = 'mail_' + id, h = bookHash(bookContent(ev));
  if (P.getProperty(mkey) === h) return false;                        // nothing changed since the last copy
  if (MailApp.getRemainingDailyQuota() < BOOK.EMAILS.length) throw new Error('Daily email limit reached');
  const sh = ev.sheet, ref = sh.ref || id, first = !P.getProperty(mkey);
  const subject = (first ? 'New booking: ' : 'Updated booking: ') + bookTitle(sh) + ' · ' + niceDate(sh.date);
  const pdf = bookPdf(sh, ref);
  const body = 'Booking details' + (first ? '' : ' (updated)') + ' saved by ' + (me.name || me.username) + ' in Romualdo\'s Ops.\n\n' + bookText(sh, ref) + '\n\nThe event sheet PDF is attached. Open in Ops: ' + BOOK.OPS_URL;
  MailApp.sendEmail({ to: BOOK.EMAILS.join(','), subject: subject, body: body, htmlBody: bookHtmlEmail(sh, ref, first, me), attachments: [pdf], name: 'Romualdo\'s Bookings' });
  P.setProperty(mkey, h);
  return true;
}
function hx(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function bookRows(sh) {
  const k = sh.kind || 'catering', cat = k === 'catering', R = [];
  const add = function (l, v) { if (v) R.push([l, v]); };
  add('Client', sh.client); add('Contact person', sh.contact); add('Mobile', sh.mobile); add('Email', sh.email);
  if (cat) { add('Date', niceDate(sh.date)); add('Event type', sh.type); add('Guests', sh.pax ? sh.pax + ' pax' : ''); add('Call time', clock12(sh.call)); add('Serving time', clock12(sh.serve)); add('Pull-out', clock12(sh.pull)); add('Venue', sh.venue); add('Venue coordinator', sh.coord); add('Package', sh.pkg); add('Motif / theme', sh.motif); add('Table setup', sh.setup); add('Service staff', sh.staff); add('Equipment', sh.equip); }
  else { add(sh.fulfil === 'Delivery' ? 'Delivery date' : 'Pick-up date', niceDate(sh.date)); add('Pick-up / delivery', sh.fulfil); add(sh.fulfil === 'Delivery' ? 'Delivery time' : 'Ready by', clock12(sh.serve)); add(sh.fulfil === 'Delivery' ? 'Deliver to' : 'Pick-up at', sh.venue); add('Good for', sh.pax ? sh.pax + ' pax' : ''); }
  add('Allergies / dietary', sh.allergy); add('Special requests', sh.special);
  return R;
}
function bookMenuHtml(sh) {
  const cat = (sh.kind || 'catering') === 'catering', menu = (sh.menu || []).filter(function (m) { return m.dish; });
  if (!menu.length) return '';
  if (!cat) {
    const o = orderSum(sh), row = function (m) { return '<tr><td style="border-bottom:1px solid #E4DFC8;font-weight:bold;width:14%;text-align:center">' + hx(m.qty || 1) + '</td><td style="border-bottom:1px solid #E4DFC8;font-family:Georgia,serif;font-style:italic;font-size:14px">' + hx(m.dish) + (m.note ? '<br><span style="font-size:11px;color:#631B1C">' + hx(m.note) + '</span>' : '') + '</td></tr>'; };
    return '<table width="100%" cellpadding="5" style="border-collapse:collapse;font-size:12px">' + [[o.mains, sh.kind === 'packs' ? 'Meal packs' : 'Trays', o.main], [o.drinks, 'Drinks', o.drink], [o.addons, 'Add-ons', o.addon]].filter(function (g) { return g[0].length; }).map(function (g) {
      return '<tr><td colspan="2" style="color:#8A5A00;font-weight:bold;font-size:10px;letter-spacing:1px;text-transform:uppercase;padding-top:9px">' + g[1] + ' · ' + g[2] + '</td></tr>' + g[0].map(row).join('');
    }).join('') + '</table>';
  }
  return '<table width="100%" cellpadding="5" style="border-collapse:collapse;font-size:12px">' + menu.map(function (m) {
    return '<tr><td style="border-bottom:1px solid #E4DFC8;color:#8A5A00;font-weight:bold;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:32%">' + hx(cat ? m.course : (m.qty || 1) + ' ×') + '</td><td style="border-bottom:1px solid #E4DFC8;font-family:Georgia,serif;font-style:italic;font-size:14px">' + hx(m.dish) + (m.note ? '<br><span style="font-size:11px;color:#631B1C">' + hx(m.note) + '</span>' : '') + '</td></tr>';
  }).join('') + '</table>';
}
function bookHtmlEmail(sh, ref, first, me) {
  const cat = (sh.kind || 'catering') === 'catering';
  return '<div style="font-family:Arial,sans-serif;color:#1A2C54;max-width:640px">' +
    '<div style="background:#1A2C54;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0"><div style="font-size:11px;letter-spacing:2px;color:#E5DEB2">' + (first ? 'NEW BOOKING' : 'UPDATED BOOKING') + ' · ' + hx(bookKind(sh).toUpperCase()) + '</div>' +
    '<div style="font-family:Georgia,serif;font-size:21px;margin-top:4px">' + hx(sh.client) + '</div><div style="font-size:13px;color:#E5DEB2">' + hx(niceDate(sh.date)) + ' · Ref. ' + hx(ref) + '</div></div>' +
    '<div style="border:1px solid #E4DFC8;border-top:0;padding:14px 18px;border-radius:0 0 8px 8px">' +
    '<table cellpadding="4" style="border-collapse:collapse;font-size:13px">' + bookRows(sh).map(function (r) { return '<tr><td style="color:#8A8F9C;font-size:11px;text-transform:uppercase;letter-spacing:1px;vertical-align:top;padding-right:14px;white-space:nowrap">' + hx(r[0]) + '</td><td style="white-space:pre-wrap">' + hx(r[1]) + '</td></tr>'; }).join('') + '</table>' +
    ((sh.menu || []).some(function (m) { return m.dish; }) ? '<h3 style="font-family:Georgia,serif;font-weight:normal;font-style:italic;margin:16px 0 4px">' + (cat ? 'The Menu' : 'The Order') + '</h3>' + bookMenuHtml(sh) : '') +
    '<p style="font-size:12px;color:#5B6478;margin-top:16px">Saved by ' + hx(me.name || me.username) + '. The event sheet PDF is attached. <a href="' + BOOK.OPS_URL + '" style="color:#631B1C">Open in Romualdo\'s Ops</a></p></div></div>';
}
function logoData() {
  const c = CacheService.getScriptCache(), k = 'logo_b64';
  let b = c.get(k);
  if (!b) { try { b = Utilities.base64Encode(UrlFetchApp.fetch(BOOK.LOGO_URL).getBlob().getBytes()); if (b.length < 90000) c.put(k, b, 21600); } catch (e) { b = ''; } }
  return b ? 'data:image/png;base64,' + b : '';
}
/** PDF copy of the event sheet (simple layout that Google's PDF converter renders reliably). */
function bookPdf(sh, ref) {
  const cat = (sh.kind || 'catering') === 'catering', logo = logoData();
  const title = cat ? 'Event Details' : (sh.kind === 'packs' ? 'Food Pack Order' : 'Food Tray Order');
  const st = ({draft: 'Draft', approval: 'For client approval', approved: 'Approved by client', cancelled: 'Cancelled'})[sh.status] || '';
  const html = '<html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}body{font-family:Georgia,serif;color:#1F2433;font-size:12px}td{vertical-align:top}</style></head><body>' +
    '<table width="100%"><tr><td width="40%">' + (logo ? '<img src="' + logo + '" style="height:52px">' : '<b style="font-size:22px">Romualdo\'s</b>') + '</td>' +
    '<td><div style="font-size:9px;letter-spacing:2px;color:#8A5A00;font-weight:bold;white-space:nowrap">CATERING SERVICES · DAVAO CITY</div><div style="font-size:24px;font-style:italic">' + title + '</div><div style="font-size:14px">' + hx(sh.client) + '</div></td>' +
    '<td align="right" style="font-size:10px;color:#4A5265;font-family:Arial">Ref. ' + hx(ref) + '<br>' + hx(st) + '<br>Issued ' + Utilities.formatDate(new Date(), BOOK.TZ, 'MMMM d, yyyy') + '</td></tr></table>' +
    '<hr style="border:0;border-top:1px solid #9C9479;margin:8px 0 10px">' +
    '<table width="100%" cellspacing="0" cellpadding="8" style="border-top:2px solid #14213F;border-bottom:2px solid #14213F;color:#14213F;text-align:center"><tr><td><span style="font-size:8px;letter-spacing:2px;color:#8A5A00;font-weight:bold;font-family:Arial">DATE</span><br><span style="font-size:14px">' + hx(niceDate(sh.date)) + '</span></td>' +
    (cat ? '<td><span style="font-size:8px;letter-spacing:2px;color:#8A5A00;font-weight:bold;font-family:Arial">GUESTS</span><br><span style="font-size:14px">' + hx(sh.pax ? sh.pax + ' pax' : 'TBC') + '</span></td><td><span style="font-size:8px;letter-spacing:2px;color:#8A5A00;font-weight:bold;font-family:Arial">OCCASION</span><br><span style="font-size:14px">' + hx(sh.type || 'TBC') + '</span></td>'
      : '<td><span style="font-size:8px;letter-spacing:2px;color:#8A5A00;font-weight:bold;font-family:Arial">' + (sh.fulfil === 'Delivery' ? 'DELIVERY TIME' : 'READY BY') + '</span><br><span style="font-size:14px">' + hx(clock12(sh.serve) || 'TBC') + '</span></td><td><span style="font-size:8px;letter-spacing:2px;color:#8A5A00;font-weight:bold;font-family:Arial">ORDER</span><br><span style="font-size:14px">' + hx((orderLabel(sh) || bookKind(sh)) + (sh.fulfil ? ' · ' + sh.fulfil : '')) + '</span></td>') +
    '</tr></table><br>' +
    '<table width="100%"><tr><td width="54%" style="padding-right:14px"><table width="100%" cellpadding="3" style="font-family:Arial;font-size:10.5px">' +
    bookRows(sh).map(function (r) { return '<tr><td width="34%" style="color:#4A5265;font-size:8.5px;letter-spacing:1px;border-bottom:1px solid #CFC8B0">' + hx(r[0].toUpperCase()) + '</td><td style="border-bottom:1px solid #CFC8B0;white-space:pre-wrap">' + hx(r[1]) + '</td></tr>'; }).join('') +
    '</table></td><td style="background:#FCFBF6;border:1px solid #E4DFC8;padding:10px"><div style="text-align:center;font-size:17px;font-style:italic;margin-bottom:4px">' + (cat ? 'The Menu' : 'The Order') + '</div>' + bookMenuHtml(sh) + '</td></tr></table>' +
    '<br><br><p style="text-align:center;font-family:Arial;font-size:9.5px;color:#4A5265">By signing below, the client confirms the ' + (cat ? 'event details and menu' : 'order details') + ' above.</p><br><br>' +
    '<table width="100%" style="font-family:Arial;font-size:9.5px;color:#4A5265"><tr><td width="45%" style="border-top:1px solid #1A2C54;padding-top:3px"><b style="color:#1A2C54">' + hx(sh.client) + '</b><br>Client signature over printed name · Date</td><td width="10%"></td><td style="border-top:1px solid #1A2C54;padding-top:3px"><b style="color:#1A2C54">' + hx(sh.preparedBy || 'Romualdo\'s Catering Services') + '</b><br>Prepared by · Romualdo\'s Catering Services</td></tr></table>' +
    '<p style="text-align:center;font-family:Arial;font-size:8.5px;color:#4A5265;border-top:1px solid #E4DFC8;padding-top:5px;margin-top:18px">Romualdo\'s Catering Services · 13 Juna Avenue, Juna Subdivision, Davao City · 0945 542 5300 · romualdoscatering@gmail.com · romualdos.ph</p></body></html>';
  const name = (cat ? 'Event Sheet' : title) + ' - ' + String(sh.client).replace(/[\\\/:*?"<>|]/g, '') + ' - ' + Utilities.formatDate(new Date(sh.date + 'T00:00:00+08:00'), BOOK.TZ, 'd MMM yyyy') + '.pdf';
  return HtmlService.createHtmlOutput(html).getAs('application/pdf').setName(name);
}

/* ---------- daily job (about 12:00 noon Manila) ---------- */
function syncAllBookings(force) {
  const rows = readAll(opsSheet()).filter(function (r) { return r.coll === 'events'; });
  let n = 0;
  rows.forEach(function (r) {
    const id = r.path.split('/')[1], ev = toDoc(r).data;
    if (!ev.sheet && !bookProps().getProperty('cal_' + id)) return;
    try { if (syncCalendar(id, ev, !!force) !== 'same') n++; } catch (e) { Logger.log('calendar ' + id + ': ' + e); }
  });
  return n;
}
function dailyBookingJob() {
  try { syncAllBookings(false); } catch (e) { Logger.log(e); }
  const target = Utilities.formatDate(new Date(Date.now() + BOOK.DAYS_BEFORE * 864e5), BOOK.TZ, 'yyyy-MM-dd');
  const P = bookProps(), dkey = 'alert_' + target;
  if (P.getProperty(dkey)) return;
  const list = readAll(opsSheet()).filter(function (r) { return r.coll === 'events'; }).map(function (r) { return { id: r.path.split('/')[1], ev: toDoc(r).data }; })
    .filter(function (x) { const sh = x.ev.sheet; return sh && x.ev.status !== 'void' && sh.status !== 'cancelled' && (sh.date || x.ev.date) === target; });
  if (!list.length) { P.setProperty(dkey, 'none'); return; }
  if (MailApp.getRemainingDailyQuota() < BOOK.EMAILS.length) return;
  const subject = 'Reminder: ' + list.length + ' booking' + (list.length > 1 ? 's' : '') + ' in 2 days · ' + niceDate(target);
  const text = 'Heads up! These bookings are on ' + niceDate(target) + ':\n\n' + list.map(function (x) { return bookText(x.ev.sheet, x.ev.sheet.ref || x.id); }).join('\n\n────────────\n\n') + '\n\nOpen in Ops: ' + BOOK.OPS_URL;
  const html = '<div style="font-family:Arial,sans-serif;color:#1A2C54;max-width:640px"><h2 style="font-family:Georgia,serif;font-weight:normal">Reminder: bookings in 2 days</h2><p>' + hx(niceDate(target)) + ' · ' + list.length + ' booking' + (list.length > 1 ? 's' : '') + '</p>' +
    list.map(function (x) { const sh = x.ev.sheet; return '<div style="border:1px solid #E4DFC8;border-radius:8px;padding:12px 16px;margin:10px 0"><div style="font-size:11px;letter-spacing:2px;color:#B07A0A">' + hx(bookKind(sh).toUpperCase()) + ' · REF. ' + hx(sh.ref || x.id) + '</div><div style="font-family:Georgia,serif;font-size:18px;margin:3px 0 8px">' + hx(sh.client) + '</div><table cellpadding="3" style="font-size:13px">' + bookRows(sh).map(function (r) { return '<tr><td style="color:#8A8F9C;font-size:11px;text-transform:uppercase;vertical-align:top;padding-right:12px">' + hx(r[0]) + '</td><td style="white-space:pre-wrap">' + hx(r[1]) + '</td></tr>'; }).join('') + '</table>' + bookMenuHtml(sh) + '</div>'; }).join('') +
    '<p style="font-size:12px"><a href="' + BOOK.OPS_URL + '" style="color:#631B1C">Open in Romualdo\'s Ops</a></p></div>';
  MailApp.sendEmail({ to: BOOK.EMAILS.join(','), subject: subject, body: text, htmlBody: html, name: 'Romualdo\'s Bookings' });
  P.setProperty(dkey, String(Date.now()));
}


/* ---------------- Event archive: Excel-ready copy in the Ops spreadsheet ---------------- */
const ARCHIVE_SHEET = 'Event Archive';
const ARCHIVE_ITEMS_SHEET = 'Event Archive - Menu';
const ARCHIVE_HEAD = ['Reference no.', 'Event / order date', 'Service', 'Event type / pick-up or delivery', 'Client', 'Contact person', 'Mobile', 'Email', 'How they found us',
  'Venue / address', 'Package / order', 'Guests booked', 'Guests served', 'Menu / items', 'Allergies / dietary', 'Special requests', 'Event sheet status', 'Prepared by',
  'Contract price (₱)', 'Price per guest (₱)', 'Pricing notes', 'Receipts total (₱)', 'Receipts checked', 'Other recorded costs (₱)', 'Total cost (₱)', 'Gross margin (₱)', 'Margin %', 'Cost per guest (₱)',
  'Outcome', 'Fulfilled on', 'Amount billed (₱)', 'Payment', 'Remarks / client feedback', 'Archived on', 'Archived by', 'Record id'];
function archRef(sh, id) { return sh.ref || ('EV-' + String(sh.date || '').replace(/-/g, '').slice(0, 8) + '-' + String(id || '').slice(-3).toUpperCase()); }
function archiveSync(me) {
  return withLock(function () {
    const sh = opsSheet(), ss = sh.getParent();
    const all = readAll(sh), live = function (d) { return d.status !== 'void'; };
    const other = {};
    all.forEach(function (r) {
      if (r.coll !== 'expenses' && r.coll !== 'moves') return; const d = toDoc(r).data; if (!live(d) || !d.eventId) return;
      let v = 0; if (r.coll === 'expenses') v = Number(d.amount) || 0;
      else if (d.type === 'issue' || d.type === 'return') v = (d.lines || []).reduce(function (a, l) { return a + (Number(l.qty) || 0) * (Number(l.cost) || 0); }, 0) * (d.type === 'return' ? -1 : 1);
      other[d.eventId] = (other[d.eventId] || 0) + v;
    });
    const rcRows = [];
    const evs = all.filter(function (r) { return r.coll === 'events'; }).map(function (r) { const d = toDoc(r).data; d._id = r.path.split('/')[1]; return d; })
      .filter(function (e) { return e.status !== 'void' && e.archive; });
    const ST = { draft: 'Draft', approval: 'For client approval', approved: 'Approved by client', cancelled: 'Cancelled' };
    const OUT = { fulfilled: 'Fulfilled', cancelled: 'Cancelled', noshow: 'Did not push through' };
    const rows = [], items = [];
    evs.forEach(function (e) {
      const s = e.sheet || {}, k = s.kind || 'catering', a = e.archive || {}, date = s.date || e.date || '', ref = archRef(s, e._id);
      const menu = (s.menu || []).filter(function (m) { return String(m.dish || '').trim(); });
      const mt = menu.map(function (m) { return (k !== 'catering' && m.qty ? m.qty + ' × ' : '') + m.dish + (k === 'catering' && m.course ? ' (' + m.course + ')' : '') + (m.note ? ' [' + m.note + ']' : ''); }).join('; ');
      const paxB = Number(s.pax || e.pax) || '';
      const rec = Object.keys(e.receipts || {}).map(function (k) { return e.receipts[k]; }).filter(Boolean);
      const rTot = Math.round(rec.reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0) * 100) / 100, rTodo = rec.filter(function (x) { return !x.verified; }).length;
      const oth = Math.round((other[e._id] || 0) * 100) / 100, cost = Math.round((rTot + oth) * 100) / 100, contract = Number(e.contract) || 0, pr = e.pricing || {};
      const paxC = Number(pr.pax || e.pax || s.pax) || 0;
      const money = [contract || '', pr.perHead ? Number(pr.perHead) : (contract && paxC ? Math.round(contract / paxC * 100) / 100 : ''), pr.note || '', rTot,
        rec.length ? (rTodo ? (rec.length - rTodo) + ' of ' + rec.length + ' verified' : 'all ' + rec.length + ' verified') : 'no receipts', oth || '', cost,
        contract ? Math.round((contract - cost) * 100) / 100 : '', contract ? Math.round((contract - cost) / contract * 1000) / 10 : '', paxC ? Math.round(cost / paxC * 100) / 100 : ''];
      rec.forEach(function (x) { rcRows.push([archRef(s, e._id), date, s.client || e.client || e.name || '', x.date || '', x.store || '', Number(x.amount) || 0, x.ocrAmount === '' || x.ocrAmount == null ? '' : Number(x.ocrAmount), x.by || '',
        x.verified ? (x.verified.name || x.verified.user || '') : 'not yet verified', (x.items || []).map(function (i) { return i.name + ' ' + i.amount; }).join('; '), x.note || '']); });
      rows.push([ref, date, bookKind(s), k === 'catering' ? (s.type || '') : (s.fulfil || ''), s.client || e.client || e.name || '', s.contact || '', s.mobile ? "'" + s.mobile : '', s.email || '', s.source || '',
        s.venue || e.venue || '', k === 'catering' ? (s.pkg || '') : orderLabel(s), paxB, a.servedPax !== undefined && a.servedPax !== '' ? Number(a.servedPax) : paxB, mt, s.allergy || '', s.special || '',
        ST[s.status] || 'Draft', s.preparedBy || ''].concat(money).concat([OUT[a.outcome] || 'Fulfilled', a.fulfilledOn || '', a.billed !== undefined && a.billed !== '' ? Number(a.billed) : '', a.payment || '', a.remarks || '',
        a.at ? Utilities.formatDate(new Date(a.at), 'Asia/Manila', 'yyyy-MM-dd HH:mm') : '', a.by || '', e._id]));
      menu.forEach(function (m) {
        const t = lineType(m, k);
        items.push([ref, date, s.client || e.client || e.name || '', bookKind(s), k === 'catering' ? (m.course || '') : (t === 'drink' ? 'Drink' : t === 'addon' ? 'Add-on' : k === 'packs' ? 'Meal pack' : 'Tray'), m.dish, k === 'catering' ? '' : (parseFloat(m.qty) || 1), m.note || '']);
      });
    });
    rows.sort(function (a, b) { return String(b[1]).localeCompare(String(a[1])); });
    items.sort(function (a, b) { return String(b[1]).localeCompare(String(a[1])); });
    const write = function (name, head, data, widths) {
      let t = ss.getSheetByName(name); if (!t) t = ss.insertSheet(name);
      t.clear(); const all = [head].concat(data);
      t.getRange(1, 1, all.length, head.length).setValues(all);
      t.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1A2C54').setFontColor('#FFFFFF');
      t.setFrozenRows(1);
      if (data.length) t.getRange(2, 1, data.length, head.length).setVerticalAlignment('top').setWrap(true);
      (widths || []).forEach(function (w, i) { t.setColumnWidth(i + 1, w); });
      return t;
    };
    const main = write(ARCHIVE_SHEET, ARCHIVE_HEAD, rows, [120, 95, 85, 130, 180, 140, 110, 170, 120, 200, 160, 70, 70, 360, 150, 170, 120, 110, 110, 100, 200, 110, 120, 120, 110, 110, 80, 100, 100, 95, 100, 130, 260, 120, 110, 90]);
    write('Event Archive - Receipts', ['Reference no.', 'Event date', 'Client', 'Receipt date', 'Store / supplier', 'Amount (₱)', 'Auto-read (₱)', 'Uploaded by', 'Verified by', 'Items on the receipt', 'Note'], rcRows, [120, 95, 180, 95, 160, 100, 100, 110, 130, 360, 200]);
    write(ARCHIVE_ITEMS_SHEET, ['Reference no.', 'Date', 'Client', 'Service', 'Course / type', 'Dish / item', 'Qty', 'Note'], items, [120, 95, 180, 85, 130, 260, 60, 180]);
    try { if (rows.length) [19, 20, 22, 24, 25, 26, 28, 31].forEach(function (c) { main.getRange(2, c, rows.length, 1).setNumberFormat('₱#,##0.00'); }); } catch (e) {}
    return { ok: true, count: rows.length, url: ss.getUrl() + '#gid=' + main.getSheetId() };
  });
}


/* ---------------- Event receipts (private files in Drive, viewed through the app) ---------------- */
function receiptsFolder() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('RECEIPTS_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const parent = DriveApp.getFolderById(CONFIG.APP_FOLDER_ID), it = parent.getFoldersByName('Event Receipts');
  const f = it.hasNext() ? it.next() : parent.createFolder('Event Receipts');
  props.setProperty('RECEIPTS_FOLDER_ID', f.getId());
  return f;
}
function opsUpload(me, req) {
  const b64 = String(req.data || ''), mime = req.mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
  if (!b64 || b64.length > 20 * 1024 * 1024) return { ok: false, error: 'The file is missing or too large.' };
  let bytes; try { bytes = Utilities.base64Decode(b64); } catch (e) { return { ok: false, error: 'The file could not be read.' }; }
  const jpg = bytes.length > 3 && (bytes[0] & 255) === 0xFF && (bytes[1] & 255) === 0xD8;
  const pdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (mime === 'image/jpeg' ? !jpg : !pdf) return { ok: false, error: 'Only photos (JPEG) and PDF receipts are accepted.' };
  const safe = String(req.name || 'receipt').replace(/[^\w &'.,()-]/g, '').slice(0, 60).trim() || 'receipt';
  const name = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HHmmss') + ' ' + safe + (mime === 'application/pdf' ? '.pdf' : '.jpg');
  const file = receiptsFolder().createFile(Utilities.newBlob(bytes, mime, name));
  try { file.setDescription('Event ' + String(req.eventId || '').slice(0, 40) + ' · uploaded by ' + me.username); } catch (e) {}
  return { ok: true, id: file.getId() };
}
function opsFile(me, req) {
  const id = String(req.id || '');
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(id)) return { ok: false, error: 'Invalid file.' };
  let f; try { f = DriveApp.getFileById(id); } catch (e) { return { ok: false, error: 'File not found.' }; }
  const folderId = receiptsFolder().getId(), ps = f.getParents(); let inside = false;
  while (ps.hasNext()) { if (ps.next().getId() === folderId) { inside = true; break; } }
  if (!inside) return { ok: false, error: 'Not a receipt file.' };
  const blob = f.getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/** Reads the text of a receipt photo or PDF (printed or handwritten) with Google's OCR:
 *  the file is converted to a temporary Google Doc in the receipts folder, its text is read, and the temporary Doc is deleted. */
function opsOcr(me, req) {
  const b64 = String(req.data || ''), mime = req.mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
  if (!b64 || b64.length > 20 * 1024 * 1024) return { ok: false, error: 'The file is missing or too large.' };
  let bytes; try { bytes = Utilities.base64Decode(b64); } catch (e) { return { ok: false, error: 'The file could not be read.' }; }
  const token = ScriptApp.getOAuthToken(), boundary = 'rcs' + Utilities.getUuid().replace(/-/g, '');
  const meta = JSON.stringify({ name: 'OCR temp ' + Utilities.getUuid().slice(0, 8), mimeType: 'application/vnd.google-apps.document', parents: [receiptsFolder().getId()] });
  const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n';
  const body = Utilities.newBlob(head).getBytes().concat(bytes).concat(Utilities.newBlob('\r\n--' + boundary + '--').getBytes());
  const up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=en&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: body, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (up.getResponseCode() >= 300) return { ok: false, error: 'OCR upload failed (' + up.getResponseCode() + ')', detail: up.getContentText().slice(0, 300) };
  const id = JSON.parse(up.getContentText()).id;
  let text = '';
  try {
    const ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (ex.getResponseCode() < 300) text = ex.getContentText();
  } finally {
    try { UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }); } catch (e) {}
  }
  return { ok: true, text: String(text || '').replace(/^﻿/, '').slice(0, 20000) };
}


/* ---------------- service charge: attendance from the HR time clock + the SC file for payroll ---------------- */
const HR = {
  DB_ID: '1JlkxQ2kJaloueZ1a3ZgONyua91yNXWC7RTA6uIZKDT0',          // Romualdo's HR Database (time clock)
  SC_FOLDER_ID: '1LJGXhQdZ8d--CsFu9GTkEGXDjzogLiDj'               // Payroll and Service Charges folder
};
function needFin(me) { if (me.role !== 'Admin' && me.role !== 'Finance') forbid('Only Admin and Finance accounts can work on the service charge.'); }
function hrTab(ss, name) {
  const sh = ss.getSheetByName(name); if (!sh || sh.getLastRow() < 2) return { head: [], rows: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  return { head: v[0].map(function (x) { return String(x).trim(); }), rows: v.slice(1) };
}
function hcol(head, re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; }
function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function dayOf(v) { const s = String(v || '').trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : ''; }
function scAttendance(me, req) {
  needFin(me);
  const from = String(req.from || ''), to = String(req.to || '');
  if (!isDay(from) || !isDay(to) || from > to) return { ok: false, error: 'Choose a valid cut-off.' };
  const ss = SpreadsheetApp.openById(HR.DB_ID), present = {}, mark = function (code, d) { if (!code || d < from || d > to) return; (present[code] = present[code] || {})[d] = 1; };
  const st = hrTab(ss, 'Staff'), cC = hcol(st.head, /^staff\s*code/i), cN = hcol(st.head, /^name/i), cP = hcol(st.head, /^position/i), cA = hcol(st.head, /^active/i), cD = hcol(st.head, /^department/i);
  const staff = st.rows.filter(function (r) { return String(r[cC]).trim(); }).map(function (r) {
    return { code: String(r[cC]).trim(), name: String(r[cN]).trim(), position: cP >= 0 ? r[cP] : '', dept: cD >= 0 ? r[cD] : '', active: cA < 0 || !/^(no|false|inactive)$/i.test(String(r[cA]).trim()) };
  });
  // a time-in on a day = worked that day
  const pu = hrTab(ss, 'Punches'), pC = hcol(pu.head, /^staff\s*code/i), pT = hcol(pu.head, /^timestamp/i), pP = hcol(pu.head, /^punch/i), pN = hcol(pu.head, /^note/i);
  let punches = 0;
  pu.rows.forEach(function (r) { if (!/^in$/i.test(String(r[pP]).trim())) return; if (pN >= 0 && /^demo$/i.test(String(r[pN]).trim())) return; const d = dayOf(r[pT]); if (d >= from && d <= to) { punches++; mark(String(r[pC]).trim(), d); } });
  // approved corrections (forgot to time in) count too
  const co = hrTab(ss, 'Corrections'), kC = hcol(co.head, /^staff\s*code/i), kD = hcol(co.head, /^shift\s*date/i), kP = hcol(co.head, /^punch/i), kS = hcol(co.head, /^status/i);
  let corrections = 0;
  co.rows.forEach(function (r) { if (!/^approved/i.test(String(r[kS]).trim())) return; const d = dayOf(r[kD]); if (d < from || d > to) return; corrections++; mark(String(r[kC]).trim(), d); });
  return { ok: true, staff: staff, present: present, punches: punches, corrections: corrections };
}
function scFile(me, req) {
  needFin(me);
  const c = req.cut || {}; if (!isDay(c.from) || !isDay(c.to) || !Array.isArray(c.days) || !Array.isArray(c.people) || !c.people.length) return { ok: false, error: 'Nothing to put in the file.' };
  const days = c.days.slice(0, 16), P = c.people.slice(0, 80), nD = days.length, nP = P.length;
  const name = 'Romualdos Service Charge - ' + String(c.label || (c.from + ' to ' + c.to)).replace(/[\/\\]/g, '-');
  const folder = DriveApp.getFolderById(HR.SC_FOLDER_ID), it = folder.getFilesByName(name);
  let ss;
  if (it.hasNext()) { ss = SpreadsheetApp.openById(it.next().getId()); }
  else { ss = SpreadsheetApp.create(name); DriveApp.getFileById(ss.getId()).moveTo(folder); }
  const tabs = ['Daily SC & Attendance', 'SC Computation', 'SC Release'];
  tabs.forEach(function (t) { if (!ss.getSheetByName(t)) ss.insertSheet(t); });
  ss.getSheets().forEach(function (s) { if (tabs.indexOf(s.getName()) < 0) ss.deleteSheet(s); });
  const A1 = function (r, col) { let s = '', n = col; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s + (r || ''); };
  const L = function (col) { return A1(0, col); }, first = 3, last = 2 + nD, top = 'ROMUALDO\'S RESTAURANT – SERVICE CHARGE', sub = 'Cut-off: ' + c.label + (c.release ? '   ·   Release: ' + c.release : '');
  const dateCell = function (d) { return new Date(d + 'T00:00:00+08:00'); };
  // 1) Daily SC & attendance: SC per day, ✓ = worked (from the time clock, corrected in /ops)
  const a = ss.getSheetByName(tabs[0]); a.clear();
  const pStart = 8, pEnd = pStart + nP - 1;
  const aRows = [[top], [sub], ['Generated from the Daily sales page and the HR time clock. ✓ = worked that day. Change ticks in /ops (Daily sales → Service charge) and press Update SC file.'], [''],
    ['DATE', ''].concat(days.map(function (x) { return dateCell(x.d); })).concat(['TOTAL']),
    ['Service charge', ''].concat(days.map(function (x) { return Number(x.sc) || 0; })).concat(['=SUM(' + A1(6, first) + ':' + A1(6, last) + ')']),
    ['Shares present', ''].concat(days.map(function (x, i) { const col = L(first + i); return '=SUMIF(' + col + pStart + ':' + col + pEnd + ',"✓",$B$' + pStart + ':$B$' + pEnd + ')'; })).concat([''])];
  const perRow = 8 + nP; // "per full share" goes under the people
  const width = 3 + nD;
  const pad = function (r) { while (r.length < width) r.push(''); return r.slice(0, width); };
  P.forEach(function (p) { aRows.push(pad([p.name, Number(p.share) || 0].concat(p.present.slice(0, nD).map(function (x) { return x ? '✓' : ''; })).concat(['=COUNTIF(' + A1(aRows.length + 1, first) + ':' + A1(aRows.length + 1, last) + ',"✓")']))); });
  aRows.push(pad(['Per full share', ''].concat(days.map(function (x, i) { const col = L(first + i); return '=IF(' + col + '7>0,' + col + '6/' + col + '7,0)'; })).concat([''])));
  a.getRange(1, 1, aRows.length, width).setValues(aRows.map(pad));
  a.getRange(5, first, 1, nD).setNumberFormat('ddd mmm d'); a.getRange(6, first, 1, nD + 1).setNumberFormat('#,##0.00'); a.getRange(perRow, first, 1, nD).setNumberFormat('#,##0.00');
  a.getRange(1, 1).setFontWeight('bold').setFontSize(13); a.getRange(5, 1, 3, width).setFontWeight('bold'); a.getRange(pStart, first, nP, nD).setHorizontalAlignment('center');
  a.setColumnWidth(1, 210); a.setColumnWidths(first, nD, 78); a.setFrozenRows(5); a.setFrozenColumns(2);
  // 2) SC per person per day
  const b = ss.getSheetByName(tabs[1]); b.clear();
  const bRows = [['SC per person per day (automatic)'], [sub], [''], pad(['NAME', 'Share'].concat(days.map(function (x) { return dateCell(x.d); })).concat(['TOTAL']))];
  P.forEach(function (p, i) { const r = pStart + i, br = 5 + i;
    bRows.push(pad([p.name, "='" + tabs[0] + "'!B" + r].concat(days.map(function (x, j) { const col = L(first + j); return "=IF('" + tabs[0] + "'!" + col + r + '="✓",\'' + tabs[0] + "'!" + col + '$' + perRow + '*$B' + br + ',0)'; })).concat(['=ROUND(SUM(' + A1(br, first) + ':' + A1(br, last) + '),2)']))); });
  bRows.push(pad(['TOTAL', ''].concat(days.map(function (x, j) { const col = L(first + j); return '=SUM(' + col + '5:' + col + (4 + nP) + ')'; })).concat(['=SUM(' + A1(5, last + 1) + ':' + A1(4 + nP, last + 1) + ')'])));
  b.getRange(1, 1, bRows.length, width).setValues(bRows.map(pad));
  b.getRange(4, first, 1, nD).setNumberFormat('mmm d'); b.getRange(5, first, nP + 1, nD + 1).setNumberFormat('#,##0.00');
  b.getRange(1, 1).setFontWeight('bold').setFontSize(13); b.getRange(4, 1, 1, width).setFontWeight('bold'); b.getRange(5 + nP, 1, 1, width).setFontWeight('bold');
  b.setColumnWidth(1, 210); b.setColumnWidths(first, nD + 1, 74); b.setFrozenRows(4); b.setFrozenColumns(2);
  // 3) Release sheet with signatures
  const r3 = ss.getSheetByName(tabs[2]); r3.clear();
  const rRows = [['ROMUALDO\'S RESTAURANT', '', '', '', '', '', '', '', '', '', ''], ['SERVICE CHARGE RELEASE  •  Cut-off: ' + c.label, '', '', '', '', '', '', '', '', '', ''], ['Release date: ' + (c.release || ''), '', '', '', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '', '', ''],
    ['No.', 'Full Name', 'Share', 'Days Present', 'SC Earned', 'Less: Deductions (breakages, etc.)', 'Less: Advance already given', 'NET SC TO RECEIVE', 'Remarks', 'Signature', 'Date Received']];
  P.forEach(function (p, i) { const rr = 6 + i;
    rRows.push([i + 1, p.name, "='" + tabs[0] + "'!B" + (pStart + i), "='" + tabs[0] + "'!" + A1(pStart + i, last + 1), "='" + tabs[1] + "'!" + A1(5 + i, last + 1), Number(p.ded) || 0, Number(p.adv) || 0, '=E' + rr + '-F' + rr + '-G' + rr, '', '', '']); });
  const tr = 6 + nP; rRows.push(['', 'TOTAL', '', '', '=SUM(E6:E' + (tr - 1) + ')', '=SUM(F6:F' + (tr - 1) + ')', '=SUM(G6:G' + (tr - 1) + ')', '=SUM(H6:H' + (tr - 1) + ')', '', '', '']);
  rRows.push(['', '', '', '', '', '', '', '', '', '', '']); rRows.push(['', 'Prepared by: ' + (me.name || me.username), '', '', '', 'Approved by:', '', '', '', '', '']);
  r3.getRange(1, 1, rRows.length, 11).setValues(rRows);
  r3.getRange(6, 5, nP + 1, 4).setNumberFormat('#,##0.00'); r3.getRange(1, 1).setFontWeight('bold').setFontSize(13); r3.getRange(5, 1, 1, 11).setFontWeight('bold').setWrap(true); r3.getRange(tr, 1, 1, 11).setFontWeight('bold');
  r3.setColumnWidth(2, 210); r3.setColumnWidths(6, 2, 120); r3.setColumnWidths(10, 2, 130); r3.setRowHeights(6, nP, 30); r3.setFrozenRows(5);
  ss.setActiveSheet(r3); SpreadsheetApp.flush();
  // also leave a copy of the release next to the payroll in the HR Database, so HR sees both together
  try {
    const hr = SpreadsheetApp.openById(HR.DB_ID), tn = 'SC ' + c.from + ' to ' + c.to;
    let t = hr.getSheetByName(tn); if (!t) t = hr.insertSheet(tn, hr.getSheets().length); t.clear();
    const vals = r3.getRange(1, 1, rRows.length, 11).getDisplayValues();
    vals.splice(3, 1, ['SC file: ' + ss.getUrl(), '', '', '', '', '', '', '', '', '', '']);
    t.getRange(1, 1, vals.length, 11).setValues(vals); t.getRange(5, 1, 1, 11).setFontWeight('bold'); t.setColumnWidth(2, 210);
  } catch (e) { console.log('HR copy skipped: ' + e); }
  return { ok: true, url: ss.getUrl(), id: ss.getId() };
}


/* ---------------- Kitchen stocks: daily counts + weekly report copied to the Ops spreadsheet ---------------- */
function kinvSync(me) {
  return withLock(function () {
    const sh = opsSheet(), ss = sh.getParent(), all = readAll(sh);
    const cfg = all.filter(function (r) { return r.path === 'config/main'; }).map(function (r) { return toDoc(r).data; })[0] || {};
    const names = {}; (cfg.kitchenItems || []).forEach(function (x) { names[x.id] = x.name; });
    const days = all.filter(function (r) { return r.coll === 'kinv'; }).map(function (r) { return toDoc(r).data; }).filter(function (d) { return d.status !== 'void' && d.date; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    const nm = function (d, id) { return names[id] || (d.names || {})[id] || id; };
    const n = function (v) { return v === '' || v == null ? '' : Number(v) || 0; };
    const daily = [], weeks = {};
    const monday = function (s) { const d = new Date(s + 'T00:00:00Z'), w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); };
    days.forEach(function (d) {
      const wk = monday(d.date); weeks[wk] = weeks[wk] || {};
      Object.keys(d.rows || {}).forEach(function (id) { const r = d.rows[id];
        daily.push([d.date, d.by || '', nm(d, id), n(r.b), n(r.i), n(r.o), n(r.s), n(r.e), r.n || '']);
        const w = weeks[wk][id] = weeks[wk][id] || { name: nm(d, id), start: Number(r.b) || 0, i: 0, o: 0, s: 0, e: 0, days: 0 };
        w.i += Number(r.i) || 0; w.o += Number(r.o) || 0; w.s += Number(r.s) || 0; w.e = Number(r.e) || 0; w.days++; });
    });
    const weekly = [];
    Object.keys(weeks).sort().reverse().forEach(function (wk) {
      const end = new Date(wk + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 6);
      const label = wk + ' to ' + Utilities.formatDate(end, 'UTC', 'yyyy-MM-dd');
      Object.keys(weeks[wk]).map(function (id) { return weeks[wk][id]; }).sort(function (a, b) { return b.s - a.s; })
        .forEach(function (w) { weekly.push([label, w.name, w.start, w.i, w.o, w.s, w.e, w.days]); });
    });
    daily.reverse();
    const write = function (name, head, data) {
      let t = ss.getSheetByName(name); if (!t) t = ss.insertSheet(name); t.clear();
      const rows = [head].concat(data); t.getRange(1, 1, rows.length, head.length).setValues(rows);
      t.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1A2C54').setFontColor('#FFFFFF'); t.setFrozenRows(1); t.setColumnWidth(head.length === 9 ? 3 : 2, 240); return t;
    };
    write('Kitchen Stocks - Daily', ['Date', 'Encoded by', 'Dish', 'Beginning', 'Stock in', 'Pull-out', 'Sold', 'Ending', 'Notes'], daily);
    const t = write('Kitchen Stocks - Weekly', ['Week (Mon to Sun)', 'Dish', 'Beginning', 'Stock in', 'Pull-out', 'Sold', 'Ending', 'Days counted'], weekly);
    return { ok: true, url: ss.getUrl() + '#gid=' + t.getSheetId() };
  });
}

const KINV_MAIL_TO = 'romualdoscatering@gmail.com';
const KINV_CAT_ORDER = ['Magandang Umaga!', 'Kakatakam', 'Para Masigla, Sabi ni Mama', 'Sabaw Na?', 'Pampahaba ng Buhay', 'Uy, Patikim!', 'Tara, Dagat', 'Mag-isa Ngunit Masaya', 'Oh, Maiba Naman', 'Para sa Paborito Kong Apo', 'Merienda-serye', 'Others'];
function kinvMail(d, updated, cfg, me) {
  if (MailApp.getRemainingDailyQuota() < 1) return;
  const items = (cfg && cfg.kitchenItems) || [], esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const groups = {}, notes = [], R = [];
  Object.keys(d.rows || {}).forEach(function (id) {
    const r = d.rows[id], it = items.filter(function (x) { return x.id === id; })[0], cat = it ? it.cat : ((d.cats || {})[id] || 'Others'), name = it ? it.name : ((d.names || {})[id] || id);
    (groups[cat] = groups[cat] || []).push({ name: name, r: r, ord: it ? items.indexOf(it) : 999 }); R.push(r); if (r.n) notes.push(name + ': ' + r.n);
  });
  const S = function (k) { return Math.round(R.reduce(function (a, r) { return a + (Number(r[k]) || 0); }, 0) * 100) / 100; };
  const low = []; Object.keys(d.rows || {}).forEach(function (id) { const it = items.filter(function (x) { return x.id === id; })[0], mn = it && it.min !== undefined && it.min !== '' ? Number(it.min) : ((d.mins || {})[id] !== undefined ? Number(d.mins[id]) : 5);
    if (Number(d.rows[id].e) < mn) low.push(esc(it ? it.name : ((d.names || {})[id] || id)) + ' <b>' + esc(d.rows[id].e) + '</b>'); });
  const neg = R.filter(function (r) { return Number(r.e) < 0; }).length;
  const day = Utilities.formatDate(new Date(d.date + 'T00:00:00+08:00'), 'Asia/Manila', 'EEEE, MMMM d, yyyy');
  const cats = Object.keys(groups).sort(function (a, b) { const x = KINV_CAT_ORDER.indexOf(a), y = KINV_CAT_ORDER.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
  const td = 'padding:3px 6px;border-bottom:1px solid #E4DFC8;text-align:right', tdl = 'padding:3px 6px;border-bottom:1px solid #E4DFC8';
  const table = '<table style="border-collapse:collapse;width:100%;font-size:12.5px"><tr style="color:#5B6478;font-size:11px"><th style="' + tdl + ';text-align:left">Dish</th><th style="' + td + '">Beg</th><th style="' + td + '">In</th><th style="' + td + '">Out</th><th style="' + td + '">Sold</th><th style="' + td + '">End</th></tr>' +
    cats.map(function (c) { return '<tr><td colspan="6" style="background:#F6E3B4;border-left:4px solid #E89908;font-weight:700;padding:4px 6px">' + esc(c) + '</td></tr>' +
      groups[c].sort(function (a, b) { return a.ord - b.ord; }).map(function (g) { const r = g.r;
        return '<tr><td style="' + tdl + '">' + esc(g.name) + (r.n ? ' *' : '') + '</td><td style="' + td + '">' + esc(r.b) + '</td><td style="' + td + '">' + esc(r.i) + '</td><td style="' + td + '">' + esc(r.o) + '</td><td style="' + td + '"><b>' + esc(r.s) + '</b></td><td style="' + td + (Number(r.e) < 0 ? ';color:#A3271F' : '') + '"><b>' + esc(r.e) + '</b></td></tr>'; }).join(''); }).join('') + '</table>';
  const stat = function (l, v) { return '<td style="background:#F3EFE2;border-radius:6px;padding:6px 10px"><div style="font-size:10px;color:#5B6478;text-transform:uppercase">' + l + '</div><div style="font-size:17px;font-weight:700">' + v + '</div></td>'; };
  const html = '<div style="font-family:Arial,sans-serif;color:#14213F;max-width:640px">' +
    '<div style="background:#1A2C54;color:#fff;padding:12px 16px;border-radius:10px 10px 0 0"><b style="font-size:16px">Kitchen stocks · daily report' + (updated ? ' (updated)' : '') + '</b><div style="font-size:12px;color:#E5DEB2">' + esc(day) + ' · encoded by ' + esc(d.by || me.username) + '</div></div>' +
    (low.length ? '<div style="background:#FCEBC2;border-left:4px solid #E89908;padding:8px 10px;margin:8px 0;font-size:13px"><b>⚠ Low stock (' + low.length + '):</b> ' + low.join(' · ') + '<br><span style="font-size:11.5px;color:#5B6478">Print the restock list in Ops → Kitchen stocks → Restock list.</span></div>' : '') + '<table style="border-spacing:6px;margin:6px -6px"><tr>' + stat('Dishes', R.length) + stat('Stock in', S('i')) + stat('Pulled out', S('o')) + stat('Sold', S('s')) + stat('Ending', S('e')) + (neg ? stat('Below zero', neg) : '') + '</tr></table>' + table +
    (notes.length ? '<p style="font-size:12.5px;margin:10px 0 4px"><b>Notes</b></p>' + notes.map(function (n) { return '<div style="font-size:12.5px">* ' + esc(n) + '</div>'; }).join('') : '') +
    '<p style="font-size:11px;color:#5B6478;margin-top:14px">Sent automatically when the day is saved in Romualdo\'s Ops (Kitchen stocks). The PDF copy is attached.</p></div>';
  const pdf = Utilities.newBlob('<html><body>' + html + '</body></html>', 'text/html', 'k.html').getAs('application/pdf').setName('Kitchen Stocks ' + d.date + (updated ? ' (updated)' : '') + '.pdf');
  MailApp.sendEmail(KINV_MAIL_TO, 'Kitchen stocks · ' + Utilities.formatDate(new Date(d.date + 'T00:00:00+08:00'), 'Asia/Manila', 'EEE, MMM d, yyyy') + ' · ' + S('s') + ' sold' + (low.length ? ' · ' + low.length + ' low' : '') + (updated ? ' (updated)' : ''),
    'Kitchen stocks daily report for ' + day + ', encoded by ' + (d.by || me.username) + '. Sold: ' + S('s') + '. Pulled out: ' + S('o') + '. See the attached PDF.', { name: "Romualdo's Ops", htmlBody: html, attachments: [pdf] });
}

/* the app sends the same report it prints; it is attached as a PDF and shown in the email body */
function kinvMailSend(me, req) {
  const date = String(req.date || ''), html0 = String(req.html || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || html0.length < 200 || html0.length > 400000) return { ok: false, error: 'Nothing to send.' };
  if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, error: 'Daily email limit reached.' };
  const html = html0.replace(/<script[\s\S]*?<\/script>/gi, '');
  const day = Utilities.formatDate(new Date(date + 'T00:00:00+08:00'), 'Asia/Manila', 'EEE, MMM d, yyyy'), upd = req.updated ? ' (updated)' : '';
  const low = Number(req.low) || 0, sold = Number(req.sold) || 0;
  const pdf = Utilities.newBlob(html, 'text/html', 'report.html').getAs('application/pdf').setName('Kitchen Stocks ' + date + upd + '.pdf');
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  MailApp.sendEmail(KINV_MAIL_TO, 'Kitchen stocks · ' + day + ' · ' + sold + ' sold' + (low ? ' · ' + low + ' for production' : '') + upd,
    'Kitchen stocks daily report for ' + day + '. The PDF is attached.', { name: "Romualdo's Ops", attachments: [pdf],
      htmlBody: '<div style="font-family:Arial,sans-serif;color:#14213F;max-width:760px">' + body + '<p style="font-size:11px;color:#5B6478;margin-top:12px">Sent automatically when the day was saved in Romualdo\'s Ops (Kitchen stocks) by ' + (me.name || me.username) + '. Same copy as the PDF attached.</p></div>' });
  return { ok: true };
}
