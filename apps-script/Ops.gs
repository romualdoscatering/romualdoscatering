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
  COLLS: ['config', 'items', 'events', 'advances', 'purchases', 'expenses', 'moves', 'counts', 'sales', 'prs'],
  MAX_OPS: 50,
  MAX_DOC_CHARS: 45000
};

/* ---------------- entry ---------------- */
function handleOps(req) {
  const me = requireOps(req.token);
  switch (req.action) {
    case 'opsSync':  return opsSync(me, req);
    case 'opsWrite': return opsWrite(me, req.ops);
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
    const seed = [['pork-liempo','Pork liempo','Pork','kg'],['pork-kasim','Pork kasim','Pork','kg'],['pork-pata','Pork pata','Pork','kg'],['ground-pork','Ground pork','Pork','kg'],
      ['beef-brisket','Beef brisket','Beef','kg'],['whole-chicken','Whole chicken','Chicken & poultry','kg'],['chicken-thigh','Chicken thigh fillet','Chicken & poultry','kg'],
      ['bangus','Bangus','Seafood','kg'],['shrimp','Shrimp','Seafood','kg'],['onion-red','Red onion','Vegetables','kg'],['garlic','Garlic','Vegetables','kg'],['tomato','Tomato','Vegetables','kg'],
      ['ginger','Ginger','Vegetables','kg'],['potato','Potato','Vegetables','kg'],['carrot','Carrot','Vegetables','kg'],['cabbage','Cabbage','Vegetables','kg'],['pechay','Pechay','Vegetables','bundle'],
      ['sitaw','Sitaw','Vegetables','bundle'],['kalamansi','Kalamansi','Fruits','kg'],['rice','Rice','Rice & grains','sack'],['eggs','Eggs','Dairy & eggs','tray'],['cooking-oil','Cooking oil','Oil & fats','L'],
      ['soy-sauce','Soy sauce','Condiments & spices','L'],['vinegar','Vinegar','Condiments & spices','L'],['fish-sauce','Fish sauce (patis)','Condiments & spices','L'],['sugar','Sugar','Dry goods / grocery','kg'],
      ['salt','Salt','Condiments & spices','kg'],['black-pepper','Black pepper (ground)','Condiments & spices','pack'],['bihon','Bihon noodles','Dry goods / grocery','pack'],['evap-milk','Evaporated milk','Dairy & eggs','can']];
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
