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
  COLLS: ['config', 'items', 'events', 'advances', 'purchases', 'expenses', 'moves', 'counts', 'sales', 'prs', 'recipes'],
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
  base.docs = readAll(opsSheet()).filter(function (r) { return r.updatedAt > after; }).map(toDoc);
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

/** What a Staff account may NOT do. Admin may do everything. */
function checkStaff(coll, before, after) {
  if (coll === 'config') forbid('Only Admin accounts can change the setup lists.');
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
      if (!admin) checkStaff(coll, before, after);
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
   • Every day at about 3:00 PM (Manila) everyone in BOOK.EMAILS gets an
     alert for bookings 2 days away. Calendar events also carry a pop-up
     reminder at exactly 3:00 PM two days before.
   Run setupBookings() once from the editor (and approve access).
   ===================================================================== */
const BOOK = {
  CAL_ID: '514003536ae4e0052290f7d416657b97df67ed53cb6ac667f072f8c23cd93a34@group.calendar.google.com',
  CAL_NAME: 'Catering and Events',
  EMAILS: ['events@romualdos.ph', 'romualdoscatering@gmail.com', 'jasperpatrickdomingo@gmail.com'],
  TZ: 'Asia/Manila',
  ALERT_HOUR: 15,
  DAYS_BEFORE: 2,
  OPS_URL: 'https://romualdos.ph/ops/#sheets',
  LOGO_URL: 'https://romualdos.ph/assets/logo.png'
};

/** Run once from the editor: approves Calendar access and creates the daily 3 PM job. */
function setupBookings() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBookingJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBookingJob').timeBased().atHour(BOOK.ALERT_HOUR).nearMinute(0).everyDays(1).inTimezone(BOOK.TZ).create();
  Logger.log('Calendar: ' + bookCal().getName());
  const n = syncAllBookings(true);
  Logger.log('Daily 3 PM job set. Calendar entries checked: ' + n);
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
/** Minutes before the event start that equals 3:00 PM, two days before the event date. */
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

/* ---------- daily job (about 3:00 PM Manila) ---------- */
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
