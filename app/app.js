// Romualdo's staff app · Restaurant & Catering
import { db, posDevice } from './db.js';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const peso = n => (num(n) < 0 ? '−' : '') + '₱' + Math.abs(num(n)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = n => (Math.round(num(n) * 1000) / 1000).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // Manila date
const fmtD = s => s ? new Date(s.slice(0, 10) + 'T00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtT = s => s ? new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtClock = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
let toastT;
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', bad ? 6000 : 3000); }

const EVENT_STATUS = { inquiry: 'Inquiry', draft: 'Draft', for_client_approval: 'For client approval', confirmed: 'Confirmed', in_prep: 'In preparation', done: 'Done', closed: 'Closed', cancelled: 'Cancelled' };
const PR_STATUS = { draft: 'Draft', submitted: 'To approve', approved: 'Approved', rejected: 'Rejected', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' };
const PO_STATUS = { open: 'Open', partly_received: 'Partly received', received: 'Received', closed: 'Closed', cancelled: 'Cancelled' };
const KIND = { buffet: 'Buffet', trays: 'Food trays', packs: 'Packed meals' };
const COURSES = ['Soup', 'Salad / appetizer', 'Main', 'Pasta / noodles', 'Vegetables', 'Rice', 'Dessert', 'Drinks', 'Station'];
const EV_TYPES = ['Anniversary', 'Birthday', 'Christening / Baptism', 'Christmas Party', 'Corporate Event', 'Debut', 'Funeral / Wake', 'Graduation', 'Retirement Party', 'Reunion', 'Seminar', 'Training', 'Wedding', 'Other'];
const ROLES = [['manager', 'Manager', 'Runs the workspace: approvals, events, billing'], ['finance', 'Finance', 'Billing, payments, contract prices, costing'],
  ['event_specialist', 'Event specialist', 'Bookings, inquiries and events: creates events'], ['coordinator', 'Coordinator', 'Runs events: menu, details, print (cannot create events)'],
  ['purchaser', 'Purchaser', 'Orders and buying'], ['storekeeper', 'Storekeeper', 'Stockist: receiving, stock counts, Kitchen stocks daily count'],
  ['head_chef', 'Head chef', 'Recipes, dish details and costing'], ['rnd_chef', 'R&D chef', 'Writes and costs recipes only'], ['chef', 'Chef', 'Kitchen work: event menus, prep (reads recipes)'],
  ['driver', 'Driver', 'Delivery runs: loads, leaves, arrives, hands over'], ['cashier', 'Cashier', 'POS payments and Z-reading'], ['waiter', 'Waiter', 'View only: events, reservations, 86 list; marks guests arrived'], ['staff', 'Staff', 'POS orders; sees the 86 / running-low list']];
const roleName = k => (ROLES.find(r => r[0] === k) || [k, k])[1];
const chip = (label, tone) => `<span class="chip ${tone || ''}">${esc(label)}</span>`;
const statusTone = s => ({ draft: 'mut', inquiry: 'mut', for_client_approval: 'warn', submitted: 'warn', confirmed: 'ok', approved: 'ok', in_prep: 'info', ordered: 'info', open: 'info', partly_received: 'warn', done: 'ok', received: 'ok', closed: 'mut', rejected: 'bad', cancelled: 'bad' }[s] || '');

// The Edge Function's web address name (Supabase → Edge Functions → URL ends in /functions/v1/<this>). Set in config.js.
const PUSH_FN = window.ROM_PUSH_FN || 'poke-push';

/* ================= Line icons (used instead of emoji) ================= */
const SV = (d, w = 16) => `<svg class="ico" viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  bell: w => SV('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', w),
  cal: w => SV('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', w),
  clock: w => SV('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', w),
  repeat: w => SV('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>', w),
  note: w => SV('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>', w),
  msg: w => SV('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', w),
  check: w => SV('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>', w),
  pin: w => SV('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>', w),
  cam: w => SV('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>', w),
  plate: w => SV('<circle cx="12" cy="13" r="7"/><circle cx="12" cy="13" r="3.5"/><path d="M3 4v5M21 4v5"/>', w),
  bag: w => SV('<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>', w),
  bike: w => SV('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h6l3-7h3M12 17 9 9H6"/>', w),
  users: w => SV('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', w),
};

/* ================= Night mode: dark from 9 PM to 6 AM (Manila time), or always light / always dark, per phone ================= */
const THEME_KEY = 'rom-theme';   // 'auto' | 'light' | 'dark'
const themePref = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } };
const isNightHour = () => { const h = new Date(Date.now() + 8 * 3600e3).getUTCHours(); return h >= 21 || h < 6; };
function applyTheme() {
  const p = themePref(), dark = p === 'dark' || (p === 'auto' && isNightHour());
  const pos = document.body?.classList.contains('pos-mode');   // the POS is dark already
  document.documentElement.classList.toggle('night', dark && !pos);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark && !pos ? '#0f1524' : '#fbf8ee');
}
applyTheme(); setInterval(applyTheme, 60000); document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTheme(); });

/* ================= state ================= */
const S = { user: null, me: null, items: [], itemsById: {}, dishes: [], dishById: {}, aliasMap: {}, packs: [] };
const isAdmin = () => !!S.me?.is_admin;
const member = ws => isAdmin() || (S.me?.roles || []).some(r => r.ws === ws);
const resFront = () => !can('restaurant', 'manager', 'finance', 'purchaser', 'storekeeper', 'head_chef', 'chef');   // Restaurant Staff / Cashier only
const kCounts = () => can('restaurant', 'storekeeper', 'manager');   // the stockist (Storekeeper) and Manager enter the daily count
const can = (ws, ...roles) => isAdmin() || (S.me?.roles || []).some(r => r.ws === ws && roles.includes(r.role));
const canAny = (...roles) => isAdmin() || (S.me?.roles || []).some(r => roles.includes(r.role));
const who = () => S.me?.full_name || S.me?.username || '';
const nick = () => (S.me?.nickname || '').trim() || (S.me?.full_name || '').split(' ')[0] || S.me?.username || 'team';   // what the app calls them

async function loadMaster() {
  const [items, dishes, aliases, packs] = await Promise.all([
    db.select('items', { cols: 'id,name,category,stock_unit,purchase_unit,units_per_purchase,last_cost,waste_pct,active', eq: { active: true }, order: [['category'], ['name']] }),
    db.select('dishes', { cols: 'id,name,category,course,tray_price,tray_serves,standard,times_booked,active,sold_as,tier', order: [['times_booked', false], ['name']] })
      .catch(() => db.select('dishes', { cols: 'id,name,category,course,tray_price,tray_serves,standard,times_booked,active,sold_as', order: [['times_booked', false], ['name']] })),
    db.select('dish_aliases', { cols: 'alias,dish_id' }),
    db.select('pack_sets', { cols: 'id,name,price,active', eq: { active: true }, order: [['name']] }),
  ]);
  S.items = items; S.itemsById = Object.fromEntries(items.map(i => [i.id, i]));
  S.dishes = dishes; S.dishById = Object.fromEntries(dishes.map(d => [d.id, d]));
  S.aliasMap = Object.fromEntries(aliases.map(a => [a.alias, a.dish_id]));
  S.packs = packs;
}
const itemName = id => S.itemsById[id]?.name || '(item)';
const itemUnit = id => S.itemsById[id]?.stock_unit || '';
const itemDatalist = () => `<datalist id="dl-items">${S.items.map(i => `<option value="${esc(i.name)}">${esc(i.category)} · ${esc(i.stock_unit)}</option>`).join('')}</datalist>`;
const cateringDish = d => !(d.sold_as && d.sold_as.length === 1 && d.sold_as[0] === 'restaurant');
const dishOptions = (course, cat) => S.dishes.filter(d => d.active && cateringDish(d) && (!course || d.course === course) && (!cat || d.category === cat))
  .map(d => `<option value="${esc(d.name)}"${course === 'Main' && !cat ? ` label="${esc(d.category)}"` : ''}>`).join('');
const mainCats = () => [...new Set(S.dishes.filter(d => d.active && cateringDish(d) && d.course === 'Main').map(d => d.category))].sort();
// The dish suggestions follow the course (and, for Main, the meat) picked on the add-dish line
document.addEventListener('change', e => {
  const f = e.target.closest('form[data-form="addMenu"]'); if (!f || !['course', 'cat'].includes(e.target.name)) return;
  const course = f.course.value, catSel = f.querySelector('[name="cat"]');
  if (catSel) { catSel.hidden = course !== 'Main'; if (course !== 'Main') catSel.value = ''; }
  const dl = document.getElementById('dl-dishes'); if (dl) dl.innerHTML = dishOptions(course, catSel?.value || '');
  f.dish.value = ''; f.dish.focus();
});
// Ingredient names match whatever the spacing, capitals or punctuation ("aji-ginisa" = "Aji Ginisa")
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9ñ]+/g, '');
function itemIdFromName(name) { const n = normName(name); return n ? S.items.find(i => normName(i.name) === n)?.id || null : null; }
// One ingredient that contains what was typed (or the other way round) → offered as "Did you mean …?"
function itemGuess(name) {
  const n = normName(name); if (n.length < 3) return null;
  const c = S.items.filter(i => { const m = normName(i.name); return m.includes(n) || (m.length >= 4 && n.includes(m)); });
  return c.length === 1 ? c[0] : null;
}

// Shopping order: proteins first (chicken, beef, pork, fish & seafood — biggest quantity first),
// then the wet market (vegetables, fruit, eggs, rice), then grocery, then everything else — A–Z after proteins
const SHOP = [['Chicken', ['Poultry']], ['Beef', ['Beef']], ['Pork', ['Pork']], ['Fish & seafood', ['Seafood']],
  ['Vegetables & wet market (Bankerohan)', ['Vegetables', 'Fruits', 'Rice & grains']],
  ['Grocery', ['Dairy & eggs', 'Pantry', 'Dry goods', 'Oil & fats', 'Condiments & spices', 'Beverages', 'Processed meat', 'Frozen']]];
function shopRank(itemId) {
  const it = S.itemsById[itemId] || {};
  if (/^eggs?\b/i.test(it.name || '')) return 4;                       // eggs are bought at the market
  const i = SHOP.findIndex(([, cats]) => cats.includes(it.category)); return i < 0 ? SHOP.length : i;
}
const SHOP_HEADS = [...SHOP.map(([h]) => h), 'Miscellaneous'];
// rows: any objects; idOf(row) → item id; qtyOf(row) → quantity; cols: table width; render(row) → <tr>
function shopRows(rows, idOf, qtyOf, cols, render) {
  const sorted = [...rows].sort((a, b) => { const ra = shopRank(idOf(a)), rb = shopRank(idOf(b));
    return ra - rb || (ra < 4 ? num(qtyOf(b)) - num(qtyOf(a)) : 0) || itemName(idOf(a)).localeCompare(itemName(idOf(b))); });
  let last = -1;
  return sorted.map(r => { const g = shopRank(idOf(r)); const head = g !== last ? `<tr class="grp"><td colspan="${cols}">${g < 4 ? 'Protein · ' : ''}${esc(SHOP_HEADS[g])}</td></tr>` : ''; last = g; return head + render(r); }).join('');
}
// Countable items are bought whole; items sold by the tray/pack/sack also show how that splits:
// 77 eggs → "2 trays + 17 pc", 0.06 kg pepper → "2 packs"
const COUNTABLE = ['pc', 'pack', 'can', 'bundle', 'bottle', 'tray', 'box', 'case', 'sack'];
const buyRound = (itemId, q) => COUNTABLE.includes(S.itemsById[itemId]?.stock_unit) ? Math.ceil(num(q) - 1e-9) : num(q);
const plural = (n, u) => `${fq(n)} ${u}${n > 1 && !/s$/.test(u) && !['kg', 'g', 'L', 'ml'].includes(u) ? 's' : ''}`;
function packSplit(itemId, q) {
  const it = S.itemsById[itemId]; q = buyRound(itemId, q); if (!it || !(q > 0)) return '';
  const upp = num(it.units_per_purchase); if (it.purchase_unit === it.stock_unit || !(upp > 0) || upp === 1) return '';
  if (upp < 1) return plural(Math.ceil(q / upp - 1e-9), it.purchase_unit);
  const whole = Math.floor(q / upp + 1e-9), rest = Math.round((q - whole * upp) * 1000) / 1000;
  if (!whole) return '';
  return plural(whole, it.purchase_unit) + (rest > 0 ? ` + ${fq(rest)} ${it.stock_unit}` : '');
}
const buyCell = (itemId, q) => { const r = buyRound(itemId, q), sp = packSplit(itemId, q); return `${fq(r)}${sp ? `<div class="small mut">${esc(sp)}</div>` : ''}`; };
// Mains listed chicken → beef → pork → seafood → others, then A–Z
const MEAT_ORDER = ['Chicken', 'Beef', 'Pork', 'Seafood'];
const sortMenu = l => [...l].sort((a, b) => { const da = S.dishById[a.dish_id], db_ = S.dishById[b.dish_id];
  const ra = MEAT_ORDER.indexOf(da?.category), rb = MEAT_ORDER.indexOf(db_?.category);
  return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || String(da?.name || a.custom_name || '').localeCompare(String(db_?.name || b.custom_name || '')); });
/* ================= router ================= */
const routes = {};
let current = '';
// Which workspace the page belongs to: #/r/… = restaurant, #/c/… = catering (shared pages read this)
const WS = () => current.startsWith('r/') ? 'restaurant' : 'catering';
const P = () => current.startsWith('r/') ? 'r' : 'c';
const STORE = () => WS() === 'restaurant' ? 'restaurant store' : 'catering store';
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!S.user) return renderLogin();
  const [page, ...rest] = hash.split('/');
  const pre = page === 'c' || page === 'r';
  const key = pre ? page + '/' + (rest[0] || (page === 'c' ? (driverOnly() ? 'runs' : 'events') : 'kitchen')) : (page || 'home');
  const arg = pre ? rest.slice(1).join('/') : rest.join('/');
  const r = routes[key] || routes.home;
  current = key;
  document.body.classList.toggle('pos-mode', key === 'r/pos'); applyTheme();
  renderShell(key);
  $('#main').innerHTML = '<div class="loading">Loading…</div>';
  try { $('#main').innerHTML = await r(arg); afterRender(); }
  catch (e) { console.error(e); $('#main').innerHTML = `<div class="card"><p class="bad-t">${esc(e.message)}</p><button data-act="reload">Try again</button></div>`; }
  window.scrollTo(0, 0);
}
async function refresh() { const y = scrollY; await route(); window.scrollTo(0, y); }
window.addEventListener('hashchange', route);
function go(h) { if (location.hash === h) refresh(); else location.hash = h; }
function afterRender() {
  recalcCosting(); recalcCostTab();
  document.querySelectorAll('form[data-form="buyReport"]').forEach(brTotals);
  evBarWatch();
  try { draftRestore(); } catch (e) { console.error(e); }
  document.querySelectorAll('[data-show-if]').forEach(el => { const [name, val] = el.dataset.showIf.split('='); const src = document.querySelector(`[name="${name}"]`); const upd = () => el.hidden = src?.value !== val; src?.addEventListener('change', upd); upd(); });
}

/* ================= shell ================= */
function renderShell(key) {
  requestAnimationFrame(fitHeader);
  const resPg = key === 'reservations', inRes = key.startsWith('r/') || (resPg && member('restaurant')), inCat = key.startsWith('c/') || (resPg && !inRes && member('catering'));
  const nav = inCat ? (waiterOnly() ? [['reservations', 'Reservations'], ['events', 'Events']] : driverOnly() ? [['c/runs', 'Runs'], ['c/equipment', 'Equipment'], ['c/production', 'Production']] : [['c/events', 'Events'], ...(runTeam() ? [['c/runs', 'Runs']] : []), ['c/production', 'Production'], ['c/inquiries', 'Inquiries'], ['c/requests', 'Requests'], ['c/orders', 'Orders & receiving'], ['c/stock', 'Stock'], ['c/equipment', 'Equipment'], ['c/recipes', 'Recipes'], ...(can('catering', 'manager', 'finance') ? [['c/billing', 'Billing']] : [])])
    : inRes ? (waiterOnly() ? [['reservations', 'Reservations'], ['r/kitchen', '86 & running low']]
      : resFront() ? [...(can('restaurant', 'cashier', 'staff') ? [['r/pos', 'POS']] : []), ...(can('restaurant', 'cashier') ? [['r/sales', 'Sales']] : []), ['reservations', 'Reservations'], ['r/kitchen', '86 & running low'], ...(can('restaurant', 'cashier', 'staff') ? [['r/requests', 'Requests']] : [])]
      : [['r/pos', 'POS'], ['r/sales', 'Sales'], ['reservations', 'Reservations'], ['r/kitchen', 'Kitchen stocks'], ...(canProd() ? [['c/production', 'Production']] : []), ['r/requests', 'Requests'], ['r/orders', 'Orders & receiving'], ['r/stock', 'Store & par']]) : [];
  $('#top').innerHTML = `<div class="bar"><a class="brand" href="#/"><img src="../assets/logo.png" alt="Romualdo's"><em>${inCat ? 'Catering' : inRes ? 'Restaurant' : 'Staff'}</em></a>
    <div class="who">${[['tasks', 'Tasks'], ['pokes', 'Pokes'], ['events', 'Events']].map(([k, l]) => `<a href="#/${k}" class="hn${key === k ? ' on' : ''}">${l}</a>`).join('')}<span class="bell-slot">${bellHtml()}</span>${acctMenu(key)}</div>
    ${mobileMenu(key, nav, inCat, inRes)}</div>
    ${nav.length ? `<nav>${nav.map(([k, l]) => `<a href="#/${k}" class="${navOf(key) === k ? 'on' : ''}">${l}</a>`).join('')}${member('catering') && member('restaurant') ? `<a href="#/${inCat ? 'r' : 'c'}" class="sw">⇄ ${inCat ? 'Restaurant' : 'Catering'}</a>` : ''}</nav>` : ''}`;
}
// Computer: your photo opens a small menu with your account and the owner's pages
function acctMenu(key) {
  const role = S.me?.is_admin ? 'Owner' : [...new Set((S.me?.roles || []).map(r => roleName(r.role)))].join(', ');
  return `<details class="acct"><summary title="My account">${av(S.me?.id, S.me?.full_name, 'sm')}<span class="acct-n">${esc(nick())}</span><span class="acct-car">▾</span></summary>
    <div class="acct-p"><div class="acct-h">${av(S.me?.id, S.me?.full_name, 'md')}<div><b>${esc(S.me?.full_name || '')}</b><small>${esc(role)}</small></div></div>
      <a href="#/me"${key === 'me' ? ' class="on"' : ''}>My account</a>
      ${canDash() ? `<a href="#/dash"${key === 'dash' ? ' class="on"' : ''}>Dashboard</a>` : ''}${canInbox() ? `<a href="#/approvals"${key === 'approvals' ? ' class="on"' : ''}>Approvals${INBOX.n ? ` <i class="acct-n2">${INBOX.n}</i>` : ''}</a>` : ''}
      ${isAdmin() ? `<a href="#/people"${key === 'people' ? ' class="on"' : ''}>People & roles</a><a href="#/activity"${key === 'activity' ? ' class="on"' : ''}>Activity</a>` : ''}
      ${canInstall() ? '<button type="button" data-act="install">Get the app</button>' : ''}
      <button type="button" class="acct-out" data-act="logout">Log out</button></div></details>`;
}
// Phones: one "☰ Menu" button opens a dropdown with every page and account action (pills and header links are hidden there).
function mobileMenu(key, nav, inCat, inRes) {
  const cur = nav.find(([k]) => navOf(key) === k)?.[1] || { events: 'Events board', activity: 'Activity', people: 'People', me: 'My account', pokes: 'Pokes', tasks: 'My tasks', dash: 'Dashboard', approvals: 'Approvals', reservations: 'Reservations' }[key.split('/')[0]] || 'Home';
  const a = (href, label, on) => `<a href="#/${href}"${on ? ' class="on"' : ''}>${label}</a>`;
  const sect = nav.length ? `<div class="mn-h">${inCat ? 'Catering' : 'Restaurant'}</div><div class="mn-g">${nav.map(([k, l]) => a(k, l, navOf(key) === k)).join('')}</div>` : '';
  const go = [a('', 'Home', key === '' || key === 'home'), a('tasks', 'My tasks', key === 'tasks'), a('events', 'Events board', key === 'events'),
    ...(runTeam() && !inCat ? [a('c/runs', 'Runs', key === 'c/runs')] : []), ...(canDash() ? [a('dash', 'Dashboard', key === 'dash')] : []), ...(canInbox() ? [a('approvals', 'Approvals' + (INBOX.n ? ` (${INBOX.n})` : ''), key === 'approvals')] : []),
    ...(inCat ? [a('r', 'Switch to Restaurant')] : inRes ? [a('c', 'Switch to Catering')] : []),
    ...(isAdmin() ? [a('people', 'People & roles', key === 'people'), a('activity', 'Activity', key.startsWith('activity'))] : [])].join('');
  return `<span class="bell-slot mob">${bellHtml()}</span><details class="mnav"><summary aria-label="Menu"><span class="mn-cur">${esc(cur)}</span><span class="mn-ic">☰</span></summary>
    <div class="mn-p">${sect}<div class="mn-l">${go}</div>
      <div class="mn-q">${esc(nick())} · <a href="#/me">My account</a>${canInstall() ? ' · <button type="button" data-act="install">Get the app</button>' : ''} · <button type="button" data-act="logout">Log out</button></div></div></details>`;
}
// close the menu after picking something, or when tapping outside it
document.addEventListener('click', e => {
  document.querySelectorAll('details.mnav[open], details.acct[open]').forEach(m => {
    if (!m.contains(e.target) || e.target.closest('.mn-p a, .mn-p button, .acct-p a, .acct-p button')) m.open = false;
  });
});
function navOf(key) {
  return { 'c/event': 'c/events', 'c/event-new': 'c/events', 'c/duplicates': 'c/events', 'c/pr': 'c/requests', 'c/po': 'c/orders', 'c/count': 'c/stock', 'c/recipe': 'c/recipes', 'c/inquiry': 'c/inquiries',
    'r/pr': 'r/requests', 'r/po': 'r/orders', 'r/count': 'r/stock' }[key] || key;
}

/* ================= login ================= */
function renderLogin(msg) {
  $('#top').innerHTML = `<div class="bar"><span class="brand"><img src="../assets/logo.png" alt="Romualdo's"><em>Staff</em></span></div>`;
  $('#main').innerHTML = `<form class="card login" id="loginForm"><h1>Log in</h1>
    ${msg ? `<p class="alert warn">${esc(msg)}</p>` : ''}
    <label>Email or username<input name="login" autocomplete="username" autocapitalize="none" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="pri wide">Log in</button>
    ${installTip()}
    <p class="mut small">Forgot your password or need an account? Ask the owner.</p></form>`;
}
/* ---- home-screen app (same as /ops): icon, full-screen launch, install button ---- */
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const UA = navigator.userAgent, ANDROID = /android/i.test(UA);
// Messenger, Facebook, Instagram etc. open links in their own browser, where "Add to Home Screen" doesn't exist
const INAPP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat/i.test(UA);
const IOS_OTHER = IOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(UA);   // Chrome/Firefox/Google app on iPhone
const APP_URL = 'https://romualdos.ph/app/';
let INSTALL_EVT = null;
const canInstall = () => !STANDALONE && (INSTALL_EVT || IOS || ANDROID);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); INSTALL_EVT = e; if (S.user) renderShell(current); else renderLogin(); });
window.addEventListener('appinstalled', () => { INSTALL_EVT = null; toast("Romualdo's is on your home screen"); if (S.user) renderShell(current); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
function installTip() {
  if (STANDALONE || !(INSTALL_EVT || IOS || ANDROID)) return '';
  return `<button type="button" class="ghost wide" data-act="install">Add the staff app to this phone's home screen</button>`;
}
async function doInstall() {
  if (INSTALL_EVT && !INAPP) {   // Android Chrome: the phone's own install prompt
    INSTALL_EVT.prompt(); try { await INSTALL_EVT.userChoice; } catch (e) {} INSTALL_EVT = null; if (S.user) renderShell(current); else renderLogin(); return;
  }
  installGuide();
}
// Step-by-step help for putting the app on the home screen (iPhone has no one-tap install for web apps)
const IG = {
  dots: '<span class="ig-key" aria-label="three dots">•••</span>',
  share: '<span class="ig-key" aria-label="Share"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg></span>',
  add: '<span class="ig-key" aria-label="Add to Home Screen"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg></span>',
  kebab: '<span class="ig-key" aria-label="menu">⋮</span>'
};
function installGuide() {
  const app = INAPP ? (/Messenger|MESSENGER/.test(UA) ? 'Messenger' : /Instagram/.test(UA) ? 'Instagram' : /FBAN|FBAV|FB_IAB|FBIOS/.test(UA) ? 'Facebook' : 'this app') : '';
  const steps = (list) => `<ol class="ig-steps">${list.map(x => `<li>${x}</li>`).join('')}</ol>`;
  const copy = `<div class="ig-link"><input readonly value="${APP_URL}" aria-label="Staff app link"><button type="button" class="ghost" data-igcopy>Copy link</button></div>`;
  let body;
  if (INAPP) body = `<div class="alert warn small">You're inside <b>${app}</b>. The app can't be added to the home screen from here — open the page in ${IOS ? 'Safari' : 'Chrome'} first.</div>
    ${steps([`Tap ${IG.dots} or ${IG.kebab} at the ${IOS ? 'bottom or top right' : 'top right'} of this screen.`,
      `Tap <b>${IOS ? 'Open in Safari' : 'Open in Chrome'}</b> (it may say <b>Open in browser</b> or <b>Open in external browser</b>).`,
      `Then tap <b>Get the app</b> again — the steps for ${IOS ? 'Safari' : 'Chrome'} will show.`])}
    <p class="small mut">No “Open in” option? Copy the link, open ${IOS ? 'Safari' : 'Chrome'} and paste it in the address bar.</p>${copy}`;
  else if (IOS_OTHER) body = `<div class="alert warn small">On iPhone, use <b>Safari</b> to add the app — it gives the full-screen app.</div>
    ${steps(['Tap <b>Copy link</b> below.', 'Open <b>Safari</b>, tap the address bar and paste the link.', 'Tap <b>Get the app</b> there and follow the steps.'])}${copy}`;
  else if (IOS) body = steps([
      `Tap ${IG.dots} at the bottom of Safari, next to the address bar.<br><span class="small mut">Older iPhones: skip this — the ${IG.share} Share button is already at the bottom.</span>`,
      `Tap ${IG.share} <b>Share</b>.`,
      `Scroll down and tap ${IG.add} <b>Add to Home Screen</b>.`,
      `Keep <b>Open as Web App</b> on, then tap <b>Add</b> (top right).`])
    + `<p class="small mut">The <b>Romualdo's</b> icon appears on your home screen. Open the app from that icon from now on — you stay signed in.</p>`;
  else body = steps([`Tap ${IG.kebab} at the top right of Chrome.`, `Tap <b>Add to Home screen</b> or <b>Install app</b>.`, `Tap <b>Install</b> / <b>Add</b>.`])
    + `<p class="small mut">The <b>Romualdo's</b> icon appears on your home screen.</p>`;
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="card ig"><div class="row"><h2>Get the staff app</h2><span class="sp"></span><button type="button" class="x" data-close aria-label="Close">✕</button></div>${body}
    <div class="row end"><button type="button" class="pri" data-close>Got it</button></div></div>`;
  document.body.appendChild(box);
  box.addEventListener('click', async ev => {
    if (ev.target.closest('[data-close]') || ev.target === box) return box.remove();
    const c = ev.target.closest('[data-igcopy]'); if (!c) return;
    const inp = box.querySelector('.ig-link input');
    try { await navigator.clipboard.writeText(APP_URL); } catch (e) { inp.select(); try { document.execCommand('copy'); } catch (e2) {} }
    c.textContent = 'Copied ✓';
  });
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Checking…';
  try { S.user = await db.signIn(f.get('login'), f.get('password')); await afterLogin(); }
  catch (err) { renderLogin(err.message); }
});
async function afterLogin() {
  S.me = await db.rpc('my_access');
  if (!S.me || S.me.active === false) { await db.signOut(); S.user = null; return renderLogin(!S.me ? 'Your login is not set up yet. Ask the owner to add you on the People page.' : 'This account is switched off. Ask the owner.'); }
  await Promise.all([loadMaster(), loadAvatars()]);
  route(); pokePoll(); inboxCount();
}

/* ================= home ================= */
// Home: a warm welcome, today at a glance, then the three ways in
const GREET = h => h < 4 ? ['Magandang gabi', 'Good evening'] : h < 11 ? ['Magandang umaga', 'Good morning'] : h < 13 ? ['Magandang tanghali', 'Good noon'] : h < 18 ? ['Magandang hapon', 'Good afternoon'] : ['Magandang gabi', 'Good evening'];
const DAILY_LINES = [
  'Every plate that leaves the kitchen carries our name. Let\'s make it one worth remembering.',
  'Ready stations, calm service. A good day starts with good prep.',
  'Serve every guest like family coming home for Sunday lunch.',
  'Small things done well — a hot plate, a warm greeting, a clean table — are what guests remember.',
  'Taste, check, then send. Pride is in the details.',
  'We feed celebrations. Somebody\'s best day depends on our work today.',
  'Help each other out. A strong kitchen is a team that has each other\'s back.',
  'Clean as you go, count what you use, say something when something\'s short.',
  'Masarap, mainit, maayos — delicious, hot and well served, every time.',
  'Our food goes to birthdays, weddings and offices across Davao. Let\'s make them proud.'
];
const ICONS = {
  res: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M11 3v6a2 2 0 0 1-2 2"/><path d="M7 3v6"/><path d="M17 21V3c-2 1.5-3 4-3 7v3h3"/></svg>',
  cat: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18h18"/><path d="M4 18a8 8 0 0 1 16 0"/><path d="M12 10V8"/><path d="M10.5 8h3"/><path d="M2 21h20"/></svg>',
  evs: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h3v3H8z"/></svg>'
};
routes.home = async () => {
  const t = today(), tm = addDays(t, 1), hour = new Date(Date.now() + 8 * 3600e3).getUTCHours();
  const [fil, en] = GREET(hour), first = esc(nick());
  const doy = Math.floor((Date.parse(t) - Date.parse(t.slice(0, 4) + '-01-01')) / 864e5);
  const [ev, pk, tk, , rn, ib, rs] = await Promise.all([db.rpc('events_board', { p_from: t, p_to: tm }).catch(() => null), homePokes(), homeTasks(), appCfg().catch(() => null), homeRuns(), homeInbox(), homeRes()]);
  const nextGo = ev && CFG.v ? ev.map(e => ({ e, p: sendOff(e, e.travel_mins != null ? { mins: e.travel_mins, km: e.travel_km, source: e.travel_source } : null, CFG.v) })).filter(x => x.p?.leave && x.p.leave > Date.now() - 15 * 60000 && mnlParts(x.p.leave)[0] === t).sort((a, b) => a.p.leave - b.p.leave)[0] : null;
  const nToday = ev ? ev.filter(e => e.event_date === t).length : null, nTmr = ev ? ev.filter(e => e.event_date === tm).length : null;
  const next = ev?.find(e => e.event_date === t && e.serve_time && e.serve_time.slice(0, 5) >= new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16));
  const cards = [];
  if (member('restaurant')) cards.push(`<a class="hw-card res" href="#/r/${can('restaurant', 'cashier', 'staff') && !can('restaurant', 'manager', 'chef') ? 'pos' : 'kitchen'}"><span class="hw-ic">${ICONS.res}</span><div class="hw-tx"><b>Restaurant</b><span>POS, sales, kitchen stocks & the 86 list</span></div><em>→</em></a>`);
  if (member('catering')) cards.push(`<a class="hw-card cat" href="#/c/events"><span class="hw-ic">${ICONS.cat}</span><div class="hw-tx"><b>Catering</b><span>Events, menus, purchasing & recipes</span></div><em>→</em></a>`);
  cards.push(`<a class="hw-card evs" href="#/events"><span class="hw-ic">${ICONS.evs}</span><div class="hw-tx"><b>Events board</b><span>What's coming up for the whole team</span></div><em>→</em></a>`);
  return `<section class="hw-hero">
      <div class="hw-date">${esc(fmtLong(t))}</div>
      <h1>${fil}, ${first}!</h1>
      <blockquote class="hw-line">${esc(DAILY_LINES[doy % DAILY_LINES.length])}</blockquote>
      ${ev ? `<div class="hw-glance">
        <a href="#/events"><b>${nToday}</b><span>event${nToday === 1 ? '' : 's'} today</span></a>
        <a href="#/events"><b>${nTmr}</b><span>event${nTmr === 1 ? '' : 's'} tomorrow</span></a>
        ${nextGo ? `<a href="#/events"><b>${esc(clk(nextGo.p.leave))}</b><span>send-off: ${esc(nextGo.e.client || nextGo.e.title)}</span></a>` : next ? `<a href="#/events"><b>${esc(fmtClock(next.serve_time))}</b><span>next: ${esc(next.client || next.title)}</span></a>` : ''}
      </div>` : ''}
    </section>
    ${ib}
    <div class="hw-today${[pk, tk, rn, rs].filter(Boolean).length === 2 ? '' : ' one'}${[pk, tk, rn, rs].filter(Boolean).length >= 3 ? ' three' : ''}">${rs}${rn}${pk}${tk}</div>
    <h2 class="hw-where">Where are you working today?</h2>
    <div class="hw-grid">${cards.join('')}</div>
    ${!member('restaurant') && !member('catering') ? `<div class="card mt"><p>You don't have a workspace yet — ask the owner to give you a role. Meanwhile you can see the Events board.</p></div>` : ''}
    `;
};

/* ================= EVENTS BOARD (everyone, read-only) ================= */
// The whole team sees what's coming (like the 86 board); only catering roles open and edit events.
const BOARD_DAYS = 45;
function boardSendOff(e) {
  const pl = CFG.v ? sendOff(e, e.travel_mins != null ? { mins: e.travel_mins, km: e.travel_km, source: e.travel_source } : null, CFG.v) : null;
  if (!pl) return '';
  if (!pl.out) return `<div class="evb-go">Ready for pick-up by <b>${esc(clk(pl.ready))}</b></div>`;
  const from = (CFG.v.kitchens || []).filter(k => k.lat != null).length > 1 && pl.kitchen ? esc(pl.kitchen.name || 'the kitchen') : 'the kitchen';
  if (pl.leave) return `<div class="evb-go">Leave ${from} by <b>${esc(clk(pl.leave))}</b><span> · ${pl.mins} min drive${pl.source === 'google' ? '' : ' (rough)'} · load by ${esc(clk(pl.load))}</span></div>`;
  return `<div class="evb-go mut">Arrive by <b>${esc(clk(pl.arrive))}</b><span> · pin the location for a send-off time</span></div>`;
}
function boardCard(e, open) {
  const cat = e.kind === 'buffet', fulfil = e.fulfil || 'Pick-up', del = fulfil === 'Delivery';
  const t = e.serve_time ? fmtClock(e.serve_time).split(' ') : null;
  const v = (e.venue || '').trim(), vOk = v && !/^(pick[\s-]?up|delivery|tba|tbc|-+)$/i.test(v);
  const where = cat ? v : del ? (vOk ? 'Deliver to ' + v : 'Delivery') : 'Pick-up ' + (vOk && !/romualdo/i.test(v) ? '· ' + v : 'at Romualdo\'s');
  const facts = [e.event_type, e.pax ? e.pax + ' guests' : '', KIND[e.kind] || '', e.pkg ? 'Package: ' + e.pkg : '', e.call ? 'Call time ' + e.call : ''].filter(Boolean);
  const unit = e.kind === 'trays' ? ' tray' : e.kind === 'packs' ? ' pack' : '';
  const qty = m => num(m.qty) ? ` <span class="evb-q">× ${fq(m.qty)}${unit}${num(m.qty) > 1 && unit ? 's' : ''}</span>` : '';
  const byCourse = {}; (e.menu || []).forEach(m => (byCourse[cat ? (m.course || 'Menu') : 'Menu'] ||= []).push(m));
  const menu = (e.menu || []).length ? Object.entries(byCourse).map(([c, ms]) => `${cat && Object.keys(byCourse).length > 1 ? `<div class="evb-course">${esc(c)}</div>` : ''}<ul class="evb-menu">${ms.map(m => `<li>${esc(m.name || '—')}${qty(m)}${m.note ? ` <span class="mut small">(${esc(m.note)})</span>` : ''}</li>`).join('')}</ul>`).join('')
    : '<p class="small mut">Menu not set yet.</p>';
  return `<article class="evb${NOT_APPROVED.includes(e.status) ? ' tent' : ''}">
    <div class="evb-time">${t ? `<b>${t[0]}</b><span>${t[1]}</span>` : '<span>Time<br>TBC</span>'}</div>
    <div class="evb-main">
      <div class="evb-head"><h3>${esc(e.client || e.title)}</h3>${chip(EVENT_STATUS[e.status], statusTone(e.status))}</div>
      ${evName({ title: e.title }, { name: e.client }) ? `<div class="evb-sub">${esc(e.title)}</div>` : ''}
      <div class="evb-facts">${facts.map(esc).join(' · ')}</div>
      ${where ? `<div class="evb-where">${IC.pin(15)} ${esc(where)}</div>` : ''}
      ${boardSendOff(e)}${runLine(e.run_status, e.run_left_at, e.run_arrived_at, e.run_done_at, CFG.v ? sendOff(e, e.travel_mins != null ? { mins: e.travel_mins } : null, CFG.v) : null)}
      ${e.allergy ? `<div class="evb-warn">Allergies: ${esc(e.allergy)}</div>` : ''}
      ${e.special ? `<div class="evb-note">Special requests: ${esc(e.special)}</div>` : ''}
      <details class="evb-det"${open ? ' open' : ''}><summary>Menu${(e.menu || []).length ? ` (${e.menu.length})` : ''}</summary>${menu}</details>
      <div class="evb-foot"><span class="mut small">${esc(e.ref)}${NOT_APPROVED.includes(e.status) ? ' · not yet confirmed by the client' : ''}</span>${member('catering') ? `<a href="#/c/event/${e.id}">Open event →</a>` : ''}</div>
    </div></article>`;
}
routes.events = async () => {
  clearTimeout(S.evTimer); S.evTimer = setTimeout(() => { if (location.hash.startsWith('#/events') && !document.querySelector('.modal')) refresh(); }, 60000);   // new bookings show up within a minute
  const t = today(), tm = addDays(t, 1);
  const [rows] = await Promise.all([db.rpc('events_board', { p_from: t, p_to: addDays(t, BOARD_DAYS) }), appCfg()]);
  const on = d => rows.filter(e => e.event_date === d), later = rows.filter(e => e.event_date > tm);
  const sec = (cls, title, sub, list, open, empty) => `<section class="evb-sec ${cls}"><h2>${title} <span class="evb-n">${list.length}</span><span class="evb-d">${sub}</span></h2>
    ${list.length ? list.map(e => boardCard(e, open)).join('') : `<div class="evb-empty">${empty}</div>`}</section>`;
  const days = [...new Set(later.map(e => e.event_date))];
  return `<div class="row"><h1>Events</h1><span class="sp"></span>${member('catering') ? '<a class="btn ghost" href="#/c/events">Catering list</a>' : ''}</div>
    <p class="mut small" style="margin-top:-6px">What's coming up for the whole team — updates by itself every minute. Prices and client contact details aren't shown here.</p>
    ${sec('today', 'Today', fmtLong(t), on(t), true, 'No events today.')}
    ${sec('tmr', 'Tomorrow', fmtLong(tm), on(tm), true, 'No events tomorrow.')}
    <section class="evb-sec later"><h2>Upcoming <span class="evb-n">${later.length}</span><span class="evb-d">next ${BOARD_DAYS - 1} days</span></h2>
    ${later.length ? days.map(d => `<h4 class="evb-day">${esc(fmtLong(d))}</h4>${later.filter(e => e.event_date === d).map(e => boardCard(e, false)).join('')}`).join('') : '<div class="evb-empty">Nothing booked yet.</div>'}</section>`;
};

/* ================= EVENTS ================= */
// The client is the headline; the event name is optional (shown only when it adds something)
const evClient = (e, c) => c?.name || e.sheet?.client || e.title;
const evName = (e, c) => { const n = (e.title || '').trim(), cl = evClient(e, c); return n && n !== cl && !n.startsWith(cl + ' · ') ? n : ''; };
const evSub = (e, c) => evName(e, c) || e.event_type || '';
// Money (contract price) lives in event_finance, readable only by finance, catering managers and the owner
async function contractOf(ids) { const m = {}; if (ids.length && can('catering', 'manager', 'finance')) (await db.select('event_finance', { cols: 'event_id,contract_price', in: { event_id: ids } })).forEach(r => m[r.event_id] = r.contract_price); return m; }
async function saveContract(id, f) { if (!('contract_price' in f) || !can('catering', 'manager', 'finance')) return; await db.upsert('event_finance', { event_id: id, contract_price: f.contract_price === '' ? null : num(f.contract_price), updated_at: new Date().toISOString() }, 'event_id'); }
const autoTitle = (client, type) => [client, type].filter(Boolean).join(' · ');
// Delete (as in /ops): anyone in catering while the client hasn't approved yet; after that only the owner
const NOT_APPROVED = ['inquiry', 'draft', 'for_client_approval'];
const canDelEvent = e => isAdmin() || can('catering', 'manager', 'event_specialist') || (member('catering') && NOT_APPROVED.includes(e.status));
const delEvBtn = (e, label, cls = 'x') => canDelEvent(e) ? `<button type="button" class="${cls}" data-act="delEvent" data-id="${e.id}" data-name="${esc(e._name || e.title || '')}" data-ref="${esc(e.ref || '')}" title="Delete this event">${label}</button>` : '';
async function saveClient(f, current) {
  const name = (f.client_name || '').trim(), phone = (f.client_phone || '').trim() || null, email = (f.client_email || '').trim() || null;
  if (!name) return current?.id || null;
  if (current && current.name === name) { if (phone !== (current.phone || null) || (email && email !== current.email)) await db.update('clients', { phone, ...(email ? { email } : {}) }, { id: current.id }); return current.id; }
  return (await db.insert('clients', { name, phone, email }))[0].id;
}
routes['c/events'] = async arg => {
  const tab = arg || 'upcoming', t = today();
  const opts = { cols: 'id,ref,title,kind,event_type,event_date,serve_time,pax,status,venue,client_id,sheet', order: [['event_date', tab !== 'past']] };
  if (tab === 'upcoming') opts.gte = { event_date: t }; if (tab === 'past') opts.lte = { event_date: t };
  let ev = await db.select('events', opts);
  if (tab === 'upcoming') ev = ev.filter(e => !['cancelled', 'closed'].includes(e.status));
  const cids = [...new Set(ev.map(e => e.client_id).filter(Boolean))], cl = {};
  if (cids.length) (await db.select('clients', { cols: 'id,name', in: { id: cids } })).forEach(c => cl[c.id] = c);
  const MM = canBill() ? await moneyOf(ev.map(e => e.id)) : {};
  const tabs = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']];
  const dups = eventAdmin() ? await db.rpc('event_duplicates').catch(() => []) : [];
  return `<div class="row"><h1>Events</h1><span class="sp"></span>${can('catering', 'event_specialist', 'manager') ? '<a class="btn pri" href="#/c/event-new">＋ New event</a>' : ''}</div>
   ${dups.length ? `<a class="hw-inbox" href="#/c/duplicates"><b>${dups.length}</b><span>possible duplicate event${dups.length > 1 ? 's' : ''} (same client, same day)</span><em>Review →</em></a>` : ''}
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/events/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${ev.length ? (tab === 'upcoming' ? [['Today', ev.filter(e => e.event_date === t)], ['Tomorrow', ev.filter(e => e.event_date === addDays(t, 1))], ['Upcoming', ev.filter(e => e.event_date > addDays(t, 1))]] : [['', ev]])
      .filter(([h, g]) => g.length || h === 'Today').map(([h, g]) => `${h ? `<h2 class="ev-grp">${h} <span class="evb-n">${g.length}</span></h2>` : ''}${g.length ? `<div class="list">${g.map(e => `<a class="li" href="#/c/event/${e.id}"><div class="li-date"><b>${esc(fmtD(e.event_date).split(',')[0])}</b><span>${esc(fmtD(e.event_date).split(',').slice(1).join(','))}</span></div>
      <div class="li-main"><b>${esc(evClient(e, cl[e.client_id]))}</b><span class="mut small">${evSub(e, cl[e.client_id]) ? esc(evSub(e, cl[e.client_id])) + ' · ' : ''}${esc(e.ref)} · ${KIND[e.kind]}${e.pax ? ' · ' + e.pax + ' guests' : ''}${e.serve_time ? ' · ' + fmtClock(e.serve_time) : ''}${e.venue ? ' · ' + esc(e.venue) : ''}</span></div>
      <span class="li-act"><span class="li-st">${['partial', 'paid', 'over'].includes(MM[e.id]?.status) ? payChip(MM[e.id]) : ''}${chip(EVENT_STATUS[e.status], statusTone(e.status))}</span><button class="pdf sm" data-act="evPdf" data-id="${e.id}" title="Print the event sheet">PDF</button>${delEvBtn({ ...e, _name: evClient(e, cl[e.client_id]) }, '') || '<span class="x-ph"></span>'}</span></a>`).join('')}</div>` : '<div class="empty small">No events today.</div>'}`).join('') : '<div class="empty">No events here.</div>'}`;
};

routes['c/event-new'] = async () => {
  if (!can('catering', 'event_specialist', 'manager')) return '<div class="card">Only the owner, managers and event specialists can create events.</div>';
  return `<h1>New event</h1><form class="card" data-form="newEvent">
    <h3 style="margin-top:0">Client</h3>
    <div class="grid">
     <label>Client name *<input name="client_name" required placeholder="e.g. Maria Santos, or UNILAB" autocapitalize="words"></label>
     <label>Mobile<input name="client_phone" inputmode="tel" placeholder="09XX XXX XXXX"></label>
     <label>Email<input name="client_email" type="email"></label>
    </div>
    <h3>Event</h3>
    <div class="grid">
     <label>Order type<select name="kind">${Object.entries(KIND).map(([k, l]) => opt(k, l)).join('')}</select></label>
     <label>Occasion<select name="event_type">${opt('', '—')}${EV_TYPES.map(x => opt(x, x)).join('')}</select></label>
     <label>Date *<input name="event_date" type="date" required value="${today()}"></label>
     <label>Serving / ready time<input name="serve_time" type="time"></label>
     <label>Guests<input name="pax" type="number" min="0" inputmode="numeric"></label>
     <label>Venue / delivery address<input name="venue"></label>
     ${can('catering', 'manager', 'finance') ? '<label>Contract price ₱<input name="contract_price" type="number" step="any" min="0"></label>' : ''}
     <label>Event name (optional)<input name="title" placeholder="e.g. 100th Anniversary"></label>
    </div><p class="small mut">Leave the event name blank and the client's name is used. Next, the event page opens and you add the menu there.</p>
    <div class="row end"><a class="btn ghost" href="#/c/events">Cancel</a><button class="pri">Create event</button></div></form>`;
};
const FORMS = {};
FORMS.newEvent = async f => {
  if (!(f.client_name || '').trim()) return toast('Enter the client name.', true);
  const client_id = await saveClient(f, null);
  const row = { kind: f.kind, title: (f.title || '').trim() || autoTitle(f.client_name.trim(), f.event_type), event_type: f.event_type || null, event_date: f.event_date, serve_time: f.serve_time || null,
    pax: f.pax ? parseInt(f.pax) : null, venue: f.venue || null, client_id, status: 'draft' };
  const ev = (await db.insert('events', row))[0];
  if (f.contract_price) await saveContract(ev.id, f);
  toast(`Event ${ev.ref} created — now add the menu.`); go('#/c/event/' + ev.id);
};

/* ================= who changed an event, live refresh, no silent overwrites (same as /ops Event sheets) ================= */
const whenFull = t => t ? new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const clockOf = t => new Date(t || Date.now()).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
const NAMES = {};
async function namesOf(ids) {
  const want = [...new Set(ids.filter(x => x && !(x in NAMES)))];
  if (want.length) (await db.select('profiles', { cols: 'id,full_name', in: { id: want } }).catch(() => [])).forEach(p => NAMES[p.id] = p.full_name);
  return NAMES;
}
const nameOf = id => id === S.me?.id ? 'You' : (NAMES[id] || 'Someone');
function changedLine(ev) {
  const t = ev.updated_at && ev.updated_at !== ev.created_at ? `Last changed by <b>${esc(nameOf(ev.updated_by))}</b> · ${esc(whenFull(ev.updated_at))}` : '';
  const c = ev.created_at ? `${t ? ' <span class="mut">· ' : ''}created by ${esc(nameOf(ev.created_by))}, ${esc(whenFull(ev.created_at))}${t ? '</span>' : ''}` : '';
  return t || c ? `<div class="small mut changed">✎ ${t}${c}</div>` : '';
}
// What each form was showing when the page opened: a save only stops if someone else changed that same part since.
const DETAIL_KEYS = [['status', 'Status'], ['client_id', 'Client'], ['title', 'Event name'], ['kind', 'Order type'], ['event_type', 'Occasion'], ['event_date', 'Date'], ['serve_time', 'Serving time'], ['pax', 'Guests'], ['venue', 'Venue']];
const SHEET_LABELS = { contact: 'Contact person', mobile: 'Mobile', email: 'Email', source: 'How they found us', call: 'Call time', pull: 'Pull-out time', coord: 'Venue coordinator', pkg: 'Package', motif: 'Motif', setup: 'Table setup', staff: 'Service staff', equip: 'Equipment', fulfil: 'Pick-up or delivery', allergy: 'Allergies', special: 'Special requests', approvedOn: 'Approved on', preparedBy: 'Prepared by' };
const EVW = { id: null, at: null, snap: null, dirty: false, busy: false, off: false, told: null };
function watchEvent(ev) {
  EVW.id = ev.id; EVW.at = ev.updated_at || null; EVW.dirty = false; EVW.told = null; EVW.off = !('updated_at' in ev);
  EVW.snap = { details: Object.fromEntries(DETAIL_KEYS.map(([k]) => [k, ev[k] ?? null])), sheet: ev.sheet || {} };
}
function changedParts(ev, part) {
  if (!EVW.snap || EVW.id !== ev.id) return [];
  if (part === 'details') return DETAIL_KEYS.filter(([k]) => String(ev[k] ?? '') !== String(EVW.snap.details[k] ?? '')).map(([, l]) => l);
  const a = EVW.snap.sheet, b = ev.sheet || {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map(k => SHEET_LABELS[k] || k);
}
async function overwriteCheck(form, ev, part) {
  if (form.dataset.force === '1' || !ev) return false;
  const diff = changedParts(ev, part); if (!diff.length) return false;
  await namesOf([ev.updated_by]);
  form.querySelector('.conflict')?.remove();
  form.insertAdjacentHTML('afterbegin', `<div class="alert bad conflict"><b>${esc(nameOf(ev.updated_by))} changed this event${ev.updated_at ? ' at ' + esc(clockOf(ev.updated_at)) : ''} while you were editing</b> (${esc(diff.join(', '))}).
    Your typing is still in the boxes below but has <b>not been saved</b>.
    <div class="row mt"><button type="button" class="pri" data-act="keepMine">Save mine (replace theirs)</button><button type="button" class="ghost" data-act="showTheirs">Show their version</button></div></div>`);
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Not saved: someone else changed this event — choose which version to keep.', true);
  return true;
}
// typing in any form on the event page counts as unsaved work
document.addEventListener('input', e => { if (current === 'c/event' && e.target.closest('#main form[data-form]')) EVW.dirty = true; });
window.addEventListener('beforeunload', () => { try { draftFlushAll(); } catch (e) {} });   // typing is kept on this phone (see AUTO-SAVE), so no 'leave page?' prompt
// re-render the page but keep the open sections open
async function refreshKeep() {
  const open = [...document.querySelectorAll('#main details')].map(d => d.open);
  await refresh();
  document.querySelectorAll('#main details').forEach((d, i) => { if (open[i]) d.open = true; });
}
async function eventFreshCheck() {
  if (current !== 'c/event' || !EVW.id || EVW.off || EVW.busy || document.visibilityState !== 'visible') return;
  EVW.busy = true;
  try {
    const [r] = await db.select('events', { cols: 'updated_at,updated_by', eq: { id: EVW.id } });
    if (!r || !r.updated_at || r.updated_at === EVW.at || r.updated_at === EVW.told) return;
    if (r.updated_by === S.me?.id) { EVW.at = r.updated_at; return; }
    await namesOf([r.updated_by]);
    if (!EVW.dirty) { await refreshKeep(); toast(`This event was just updated by ${nameOf(r.updated_by)}`); return; }
    EVW.told = r.updated_at;   // they're typing: don't wipe it, just tell them
    const box = document.getElementById('evlive');
    if (box) box.innerHTML = `<div class="alert warn"><b>${esc(nameOf(r.updated_by))} just changed this event (${esc(clockOf(r.updated_at))}).</b> What you've typed is kept. When you save, you'll be asked which version to keep if you both changed the same part.
      <div class="row mt"><button type="button" class="ghost" data-act="showTheirs">Show the latest (drops what I typed)</button></div></div>`;
  } catch (e) { if (/updated_at|column/i.test(e.message || '')) EVW.off = true; }
  finally { EVW.busy = false; }
}
setInterval(eventFreshCheck, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') eventFreshCheck(); });

/* client name bar that stays at the top while scrolling the event page (like /ops) */
function evBar(ev, client) {
  const meta = [ev.event_type || KIND[ev.kind], fmtD(ev.event_date), ev.serve_time ? fmtClock(ev.serve_time) : '', ev.pax ? ev.pax + ' guests' : '', ev.venue].filter(Boolean).map(esc).join(' · ');
  return `<div class="evbar" id="evbar" aria-hidden="true"><div><b>${esc(evClient(ev, client))}</b><span>${meta}</span></div></div>`;
}
function fitHeader() { const h = document.getElementById('top'); if (h) document.documentElement.style.setProperty('--hdrH', h.offsetHeight + 'px'); }
window.addEventListener('resize', fitHeader);
let evBarObs = null;
function evBarWatch() {
  evBarObs?.disconnect(); evBarObs = null;
  const bar = document.getElementById('evbar'), head = document.getElementById('evhead'); if (!bar || !head) return;
  fitHeader();
  evBarObs = new IntersectionObserver(([x]) => bar.classList.toggle('show', !x.isIntersecting && x.boundingClientRect.top < 200), { rootMargin: `-${document.getElementById('top')?.offsetHeight || 0}px 0px 0px 0px` });
  evBarObs.observe(head);
}

routes['c/event'] = async id => {
  const [ev] = await db.select('events', { eq: { id } }); if (!ev) return '<div class="card">Event not found.</div>';
  const [menu, client, warnings, needs, prs, pick, cost, extras] = await Promise.all([
    db.select('event_menu', { eq: { event_id: id }, order: [['sort'], ['course']] }),
    ev.client_id ? db.select('clients', { eq: { id: ev.client_id } }).then(r => r[0]) : null,
    db.rpc('event_warnings', { p_event: id }),
    db.rpc('event_requirements', { p_event: id }),
    db.select('pr_overview', { eq: { event_id: id }, order: [['created_at', false]] }),
    db.select('event_pick_list', { eq: { event_id: id } }),
    db.select('event_costing', { eq: { event_id: id } }).then(r => r[0]),
    db.select('event_extra_needs', { eq: { event_id: id } }),
  ]);
  ev.contract_price = (await contractOf([ev.id]))[ev.id] ?? null;
  const B = await billBundle(ev, client);
  const names = await namesOf([ev.updated_by, ev.created_by]);
  watchEvent(ev, names);
  const recipeState = {}; const dishIds = [...new Set(menu.map(m => m.dish_id).filter(Boolean))];
  if (dishIds.length) (await db.select('recipes', { cols: 'dish_id,status', in: { dish_id: dishIds } })).forEach(r => recipeState[r.dish_id] = r.status);
  const open = !['done', 'closed', 'cancelled'].includes(ev.status);
  const canMenu = open && can('catering', 'event_specialist', 'coordinator', 'manager', 'chef', 'head_chef');
  const canEdit = ev.status !== 'closed' && can('catering', 'event_specialist', 'coordinator', 'manager', 'finance');
  const byCourse = COURSES.map(c => [c, menu.filter(m => m.course === c)]).concat([['Other', menu.filter(m => !COURSES.includes(m.course))]]).filter(([, l]) => l.length);
  const lineName = m => m.dish_id ? S.dishById[m.dish_id]?.name : m.pack_id ? (S.packs.find(p => p.id === m.pack_id)?.name || 'Packed meal set') : m.custom_name;
  const lineChip = m => m.custom_name && !m.dish_id && !m.pack_id ? chip('off-menu', 'warn') : m.dish_id ? (recipeState[m.dish_id] === 'verified' ? '' : chip(recipeState[m.dish_id] ? 'recipe draft' : 'no recipe', 'warn')) : '';
  const toBuy = needs.filter(n => num(n.to_buy) > 0);
  const margin = cost && ev.contract_price ? num(ev.contract_price) - num(cost.total_cost) : null;
  return `${evBar(ev, client)}<div class="row"><a href="#/c/events" class="back">‹ Events</a></div>
  <div id="evlive"></div>
  <div class="row" id="evhead"><h1>${esc(evClient(ev, client))}</h1>${chip(EVENT_STATUS[ev.status], statusTone(ev.status))}<span class="sp"></span><button class="pdf lg" data-act="evPdf" data-id="${ev.id}" title="Print the one-page event sheet: works at any status, for the team's hard copy">Print event sheet (PDF)</button>${delEvBtn({ ...ev, _name: evClient(ev, client) }, 'Delete', 'ghost')}</div>
  ${evHero(ev, client)}
  ${await evAssist(ev, client, { menu, prs, run: runTeam() && goesOut(ev) ? (await db.rpc('runs_for', { p_date: ev.event_date }).catch(() => [])).find(r => r.id === ev.id) : null })}
  ${changedLine(ev, names)}

  ${canEdit ? `<details class="card"><summary>Edit details & status</summary><form data-form="editEvent" data-id="${ev.id}" class="mt">
    <div class="grid">
     <label>Status<select name="status">${Object.entries(EVENT_STATUS).filter(([k]) => k !== 'closed').map(([k, l]) => opt(k, l, ev.status === k)).join('')}</select></label>
     <label>Client name<input name="client_name" value="${esc(client?.name || '')}" required></label>
     <label>Client mobile<input name="client_phone" value="${esc(client?.phone || '')}" inputmode="tel"></label>
     <label>Event name (optional)<input name="title" value="${esc(evName(ev, client))}" placeholder="Blank = client name"></label>
     <label>Order type<select name="kind">${Object.entries(KIND).map(([k, l]) => opt(k, l, ev.kind === k)).join('')}</select></label>
     <label>Occasion<select name="event_type">${opt('', '—')}${EV_TYPES.map(x => opt(x, x, ev.event_type === x)).join('')}</select></label>
     <label>Date<input name="event_date" type="date" value="${esc(ev.event_date)}" required></label>
     <label>Serving time<input name="serve_time" type="time" value="${esc((ev.serve_time || '').slice(0, 5))}"></label>
     <label>Guests<input name="pax" type="number" min="0" value="${esc(ev.pax ?? '')}"></label>
     <label>Venue<input name="venue" value="${esc(ev.venue || '')}"></label>
     ${canBill() ? `<label>Contract price ₱<input name="contract_price" type="number" step="any" min="0" value="${esc(ev.contract_price ?? '')}"></label>` : ''}
    </div><div class="row end">${can('catering', 'manager', 'finance') && ev.status === 'done' ? `<button type="button" class="ghost" data-act="closeEvent" data-id="${ev.id}">Close event (releases leftover stock)</button>` : ''}<button class="pri">Save</button></div></form></details>` : ''}

  ${canEdit ? sheetForm(ev, client) : ''}
  ${ev.ops_id ? `<p class="small mut" style="margin:0 0 8px">Moved from /ops${ev.sheet?.ops_ref ? ' (' + esc(ev.sheet.ops_ref) + ')' : ''} on Nov 28. Its billing and payments stay in /ops Billing.</p>` : ''}
  ${ev.booking_id || ev.sheet?.website_ref ? `<div class="alert info"><b>From a website inquiry</b>${ev.sheet?.website_ref ? ' (' + esc(ev.sheet.website_ref) + ')' : ''} · <a href="#/c/inquiry/${ev.booking_id}">see what the client sent</a>${ev.sheet?.date_missing ? '<br><b>The client gave no date</b> — a date two weeks ahead was used; set the real one under Edit details.' : ''}${ev.sheet?.notes ? `<br>Client notes: ${esc(ev.sheet.notes)}` : ''}${num(ev.sheet?.estimate?.total) ? `<br>Estimate shown to the client: ${peso(ev.sheet.estimate.total)}` : ''}</div>` : ''}
  <section class="card"><div class="row"><h2>Menu</h2><span class="sp"></span><span class="small mut">${menu.length} ${menu.length === 1 ? 'dish' : 'dishes'}${ev.kind === 'buffet' && ev.pax ? ` · buffet for ${ev.pax} guests` : ''}</span></div>
   ${byCourse.length ? `<div class="menu-grid">${byCourse.map(([c, l]) => `<div class="mcourse"><div class="mc-label">${esc(c)}</div><div class="mc-items">${sortMenu(l).map(m => { const d = S.dishById[m.dish_id];
     return `<div class="mline"><span class="mname">${esc(lineName(m))}</span>${c === 'Main' && d ? `<span class="mtag">${esc(d.category)}</span>` : ''} ${lineChip(m)}${m.note ? `<span class="mut small"> · ${esc(m.note)}</span>` : ''}<span class="sp"></span>${m.qty ? `<b>${fq(m.qty)} ${ev.kind === 'packs' ? 'packs' : 'trays'}</b>` : ''}${canMenu ? `<button class="x" title="Remove" data-act="rmMenu" data-id="${m.id}">✕</button>` : ''}</div>`; }).join('')}</div></div>`).join('')}</div>` : '<p class="mut">No dishes yet.</p>'}
   ${canMenu ? `<div class="addbox"><div class="small"><b>Add a dish</b></div><form data-form="addMenu" data-id="${ev.id}" class="addline">
     <select name="course" aria-label="Course">${COURSES.map(c => opt(c, c, c === (S.lastCourse || 'Main'))).join('')}</select>
     ${ev.kind === 'packs' && S.packs.length ? `<select name="pack_id">${opt('', 'Dish (type below)')}${S.packs.map(p => opt(p.id, p.name)).join('')}</select>` : ''}
     <select name="cat" aria-label="Main dish type"${(S.lastCourse || 'Main') !== 'Main' ? ' hidden' : ''}>${opt('', 'All mains')}${mainCats().map(c => opt(c, c, c === S.lastCat)).join('')}</select>
     <input name="dish" list="dl-dishes" placeholder="Type or pick a dish" autocomplete="off">
     ${ev.kind !== 'buffet' ? `<input name="qty" type="number" step="any" min="0" placeholder="${ev.kind === 'packs' ? 'packs' : 'trays'}" class="qty">` : ''}
     <button class="pri">Add</button></form><datalist id="dl-dishes">${dishOptions(S.lastCourse || 'Main', (S.lastCourse || 'Main') === 'Main' ? S.lastCat || '' : '')}</datalist>
     <p class="small mut">Pick the course first to shorten the list. Unknown dishes are kept as off-menu for the chef.${ev.kind === 'buffet' ? ' Buffet quantities come from the guest count.' : ''}</p></div>` : ''}
  </section>

  ${(menu.some(m => m.custom_name && !m.dish_id && !m.pack_id) || extras.length) ? `<section class="card"><h2>Off-menu ingredients</h2>
    <p class="small mut">For off-menu dishes the chef lists the extra ingredients to buy.</p>
    ${extras.length ? `<table><tbody>${extras.map(x => `<tr><td>${esc(itemName(x.item_id))}</td><td class="n">${fq(x.qty)} ${esc(itemUnit(x.item_id))}</td><td class="mut small">${esc(x.note || '')}</td><td>${can('catering', 'chef', 'head_chef', 'manager') && open ? `<button class="x" data-act="rmExtra" data-ev="${ev.id}" data-item="${x.item_id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    ${can('catering', 'chef', 'head_chef', 'manager') && open ? `<form data-form="addExtra" data-id="${ev.id}" class="addline"><input name="item" list="dl-items" placeholder="Ingredient" autocomplete="off"><input name="qty" type="number" step="any" min="0" placeholder="qty" class="qty"><input name="note" placeholder="for which dish"><button class="pri">Add</button></form>${itemDatalist()}` : ''}
  </section>` : ''}

  <section class="card"><div class="row"><h2>Purchasing</h2><span class="sp"></span>${open && can('catering', 'event_specialist', 'coordinator', 'manager', 'chef', 'head_chef') && menu.length ? `<button class="pri" data-act="genPR" data-id="${ev.id}">${prs.some(p => p.status === 'draft' && p.source === 'event_auto') ? 'Update purchase request' : 'Create purchase request'}</button>` : ''}</div>
   ${warnings.length ? `<div class="alert warn"><b>Not included yet:</b><ul>${warnings.map(w => `<li>${esc(w.dish)} — ${esc(w.problem)}</li>`).join('')}</ul></div>` : ''}
   ${needs.length ? `<details ${toBuy.length ? 'open' : ''}><summary>What this event needs (${needs.length} ingredients, ${toBuy.length} to buy · est. ${peso(needs.reduce((s, n) => s + num(n.est_cost), 0))})</summary>
     <div class="tw"><table><thead><tr><th>Ingredient</th><th class="n">Needed</th><th class="n">In store</th><th class="n">To buy</th><th class="n">Est. cost</th></tr></thead><tbody>
     ${shopRows(needs, n => n.item_id, n => n.needed, 5, n => `<tr><td>${esc(n.item)}<div class="small mut">${esc(n.from_dishes || '')}</div></td><td class="n">${fq(n.needed)} ${esc(n.unit)}</td><td class="n mut">${fq(n.free_stock)}</td><td class="n"><b>${num(n.to_buy) > 0 ? buyCell(n.item_id, n.to_buy) : '—'}</b></td><td class="n">${num(n.est_cost) ? peso(n.est_cost) : '<span class="mut small">no price yet</span>'}</td></tr>`)}
     </tbody></table></div></details>` : '<p class="mut">Add dishes with verified recipes to see what to buy.</p>'}
   ${prs.length ? `<h3 class="mt">Requests for this event</h3><div class="list">${prs.map(p => `<a class="li" href="#/c/pr/${p.id}"><div class="li-main"><b>${esc(p.pr_no)}</b><span class="mut small">${p.line_count} items · ${peso(p.est_total)} · ${esc(fmtT(p.created_at))}</span></div>${chip(PR_STATUS[p.status], statusTone(p.status))}</a>`).join('')}</div>` : ''}
  </section>

  ${['inquiry', 'cancelled'].includes(ev.status) ? '' : await evEquipCard(ev)}
  ${(pick.length || ['confirmed', 'in_prep', 'done'].includes(ev.status)) && can('catering', 'storekeeper', 'manager', 'chef', 'head_chef') ? `<section class="card"><h2>Prep day</h2>
   ${pick.length ? `<form data-form="issue" data-id="${ev.id}"><p class="small mut">Stock set aside for this event in the catering store. Issue it to the cook in charge.</p>
     <div class="tw"><table><thead><tr><th>Item</th><th class="n">Set aside</th><th class="n">Issue now</th></tr></thead><tbody>
     ${shopRows(pick, p => p.item_id, p => p.reserved, 3, p => `<tr><td>${esc(p.name)}</td><td class="n">${fq(p.reserved)} ${esc(p.stock_unit)}</td><td class="n"><input name="q_${p.item_id}" type="number" step="any" min="0" value="${num(p.reserved)}" class="qty"></td></tr>`)}
     </tbody></table></div><div class="row end"><input name="received_by" placeholder="Received by (cook in charge)" required><button class="pri">Issue to event</button></div></form>` : '<p class="mut">Nothing set aside for this event right now.</p>'}
   <details class="mt"><summary>Return leftovers to the store</summary><form data-form="returnLeft" data-id="${ev.id}" class="addline"><input name="item" list="dl-items" placeholder="Item" autocomplete="off"><input name="qty" type="number" step="any" min="0" placeholder="qty" class="qty"><input name="by" placeholder="Returned by" required><button>Return</button></form>${itemDatalist()}</details>
  </section>` : ''}

  ${billCard(ev, B)}
  ${cost && canBill() ? `<section class="card"><h2>Costing</h2><div class="kpis">
    <div class="kpi"><span>Contract</span><b>${ev.contract_price ? peso(ev.contract_price) : '—'}</b></div>
    <div class="kpi"><span>Ingredients used</span><b>${peso(cost.ingredients_used)}</b></div>
    <div class="kpi"><span>Event expenses</span><b>${peso(cost.expenses)}</b></div>
    <div class="kpi"><span>Total cost</span><b>${peso(cost.total_cost)}</b></div>
    <div class="kpi ${margin != null && margin < 0 ? 'bad' : ''}"><span>Margin</span><b>${margin != null ? peso(margin) + (num(ev.contract_price) ? ` <small>${Math.round(margin / num(ev.contract_price) * 100)}%</small>` : '') : '—'}</b></div>
    <div class="kpi"><span>Cost per guest</span><b>${ev.pax ? peso(num(cost.total_cost) / ev.pax) : '—'}</b></div></div>
    <p class="small mut">Ingredients used = stock issued to the event minus leftovers returned, at purchase prices.</p></section>` : ''}
  ${eventAdmin() ? `<div class="ev-danger"><a class="lnk" href="#/c/duplicates">Find duplicate events</a></div>` : ''}`;
};
FORMS.editEvent = async (f, el) => {
  const [ev] = await db.select('events', { eq: { id: el.dataset.id } });
  if (await overwriteCheck(el, ev, 'details')) return;
  const cur = ev?.client_id ? (await db.select('clients', { eq: { id: ev.client_id } }))[0] : null;
  const client_id = await saveClient(f, cur), cname = (f.client_name || cur?.name || '').trim();
  await db.update('events', { status: f.status, client_id, title: (f.title || '').trim() || autoTitle(cname, f.event_type), kind: f.kind, event_type: f.event_type || null, event_date: f.event_date, serve_time: f.serve_time || null,
    pax: f.pax ? parseInt(f.pax) : null, venue: f.venue || null }, { id: el.dataset.id });
  await saveContract(el.dataset.id, f);
  toast('Saved'); refresh();
};
/* ================= EVENT SHEET (1-page PDF for the kitchen and the client — same layout as /ops) ================= */
const SHEET_ST = { inquiry: 'Inquiry', draft: 'Draft', for_client_approval: 'For client approval', confirmed: 'Approved by client', in_prep: 'Approved by client', done: 'Approved by client', closed: 'Approved by client', cancelled: 'Cancelled' };
const DRINK_RE = /\b(water|juice|soda|soft ?drinks?|coke|sprite|royal|pepsi|7.?up|mountain dew|iced tea|tea|coffee|lemonade|drinks?|beverages?|c2|zesto|milk ?tea|shakes?|calamansi)\b/i;
const fmtLong = s => s ? new Date(s.slice(0, 10) + 'T00:00').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
function sheetForm(ev, client) {
  const s = ev.sheet || {}, cat = ev.kind === 'buffet', v = k => esc(s[k] ?? '');
  const inp = (k, l, ph = '', t = 'text') => `<label>${l}<input name="${k}" type="${t}" value="${v(k)}" placeholder="${esc(ph)}"></label>`;
  const ta = (k, l, ph = '') => `<label>${l}<textarea name="${k}" rows="2" placeholder="${esc(ph)}">${v(k)}</textarea></label>`;
  return `<details class="card"><summary>Event sheet details <span class="small mut">— printed on the PDF</span></summary><form data-form="evSheet" data-id="${ev.id}" class="mt">
   <h3>Client</h3><div class="grid">${inp('contact', 'Contact person')}<label>Mobile<input name="mobile" value="${esc(s.mobile ?? client?.phone ?? '')}" inputmode="tel" placeholder="09XX XXX XXXX"></label><label>Email<input name="email" type="email" value="${esc(s.email ?? client?.email ?? '')}"></label>${inp('source', 'How they found us', 'Facebook, website, referral…')}</div>
   ${cat ? `<h3>Event</h3><div class="grid">${inp('call', 'Call time (team at venue)', '', 'time')}${inp('pull', 'Pull-out time', '', 'time')}${inp('coord', 'Venue coordinator & contact')}${inp('pkg', 'Package', 'Classic / Signature / Premium / Custom')}</div>
   <h3>Setup &amp; service</h3><div class="grid">${inp('motif', 'Motif / theme')}${inp('setup', 'Table setup', 'Buffet, plated; no. of tables')}${inp('staff', 'Service staff', 'e.g. 1 head waiter, 8 servers')}</div>${ta('equip', 'Equipment', 'Chafing dishes, tables, linens, tent…')}`
   : `<h3>Pick-up or delivery</h3><div class="grid"><label>Pick-up or delivery<select name="fulfil">${['Pick-up', 'Delivery'].map(x => opt(x, x, (s.fulfil || 'Pick-up') === x)).join('')}</select></label></div><p class="small mut">The date, time, address (Venue) and guests are under Edit details. Quantities come from the menu.</p>`}
   <h3>Notes</h3><div class="grid">${ta('allergy', 'Allergies / dietary needs')}${ta('special', 'Special requests')}</div>
   <h3>Approval</h3><div class="grid">${inp('approvedOn', 'Approved by the client on', '', 'date')}<label>Prepared by<input name="preparedBy" value="${esc(s.preparedBy || S.me.full_name)}"></label></div>
   <p class="small mut">The status on the PDF follows the event status (set it under Edit details).</p>
   <div class="row end"><button type="button" class="pdf" data-act="evPdf" data-id="${ev.id}">Print PDF</button><button class="pri">Save</button></div></form></details>`;
}
FORMS.evSheet = async (f, el) => {
  const [ev] = await db.select('events', { eq: { id: el.dataset.id } });
  if (await overwriteCheck(el, ev, 'sheet')) return;
  const keys = ['contact', 'mobile', 'email', 'source', 'call', 'pull', 'coord', 'pkg', 'motif', 'setup', 'staff', 'equip', 'fulfil', 'allergy', 'special', 'approvedOn', 'preparedBy'];
  const sheet = { ...(ev?.sheet || {}) }; keys.forEach(k => { if (k in f) { const x = String(f[k] ?? '').trim(); if (x) sheet[k] = x; else delete sheet[k]; } });
  await db.update('events', { sheet }, { id: el.dataset.id }); toast('Event sheet saved'); refresh();
};
function sheetHtml(ev, menuRows, client, money) {
  const d = ev.sheet || {}, k = ev.kind, cat = k === 'buffet', st = SHEET_ST[ev.status] || 'Draft', logo = S.logoData || new URL('../assets/logo.png', location.href).href;
  const who = client?.name || ev.title, mobile = d.mobile || client?.phone, email = d.email || client?.email, fulfil = d.fulfil || 'Pick-up', del = fulfil === 'Delivery';
  const name = m => m.dish_id ? S.dishById[m.dish_id]?.name : m.pack_id ? (S.packs.find(p => p.id === m.pack_id)?.name || 'Packed meal set') : m.custom_name;
  const row = (l, v) => v ? `<tr><th>${esc(l)}</th><td>${esc(v)}</td></tr>` : '';
  const courses = COURSES.map(c => [c, sortMenu(menuRows.filter(m => m.course === c))]).concat([['Other', menuRows.filter(m => !COURSES.includes(m.course))]]).filter(([, l]) => l.length);
  const lines = menuRows.map(m => ({ ...m, n: name(m), t: m.course === 'Drinks' || DRINK_RE.test(name(m) || '') ? 'drink' : k === 'packs' && !m.pack_id && /\btrays?\b/i.test(name(m) || '') ? 'addon' : 'main', q: num(m.qty) || 1 }));
  const grp = t => lines.filter(l => l.t === t), sum = t => grp(t).reduce((a, l) => a + l.q, 0);
  const unit = k === 'packs' ? 'pack' : 'tray', orderTxt = [sum('main') ? plural(sum('main'), unit) : '', sum('addon') ? plural(sum('addon'), 'add-on') : ''].filter(Boolean).join(' + ');
  const docTitle = cat ? 'Event Details' : k === 'packs' ? 'Food Pack Order' : 'Food Tray Order';
  const hero = cat ? [['Date', fmtLong(ev.event_date)], ['Guests', ev.pax ? ev.pax + ' pax' : 'To be confirmed'], ['Occasion', ev.event_type || 'To be confirmed']]
    : [[del ? 'Delivery date' : 'Pick-up date', fmtLong(ev.event_date)], [del ? 'Delivery time' : 'Ready by', ev.serve_time ? fmtClock(ev.serve_time) : 'To be confirmed'], ['Order', (orderTxt || docTitle) + ' · ' + fulfil]];
  const times = cat ? [['Call time', d.call], ['Serving', ev.serve_time], ['Pull-out', d.pull]].filter(x => x[1]) : [];
  const setup = cat ? [['Motif / theme', d.motif], ['Table setup', d.setup], ['Service staff', d.staff], ['Equipment', d.equip]] : [];
  const notes = [['Allergies & dietary', d.allergy], ['Special requests', d.special]];
  const issued = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
  const menuHtml = !menuRows.length ? '' : cat
    ? `<div class="menu"><h2>The Menu</h2>${courses.map(([c, l]) => `<div class="c">${esc(c === 'Main' ? (l.length > 1 ? 'Main dishes' : 'Main dish') : c)}</div>${l.map(m => `<div class="d">${esc(name(m))}</div>${m.note ? `<div class="n">${esc(m.note)}</div>` : ''}`).join('')}`).join('')}</div>`
    : `<div class="menu" style="text-align:left"><h2>The Order</h2><table class="items"><thead><tr><th>Item</th><th class="q">Qty</th></tr></thead><tbody>${[['main', k === 'packs' ? 'Meal packs' : 'Trays'], ['drink', 'Drinks'], ['addon', 'Add-ons']].filter(([t]) => grp(t).length).map(([t, h]) => `<tr><td colspan="2" class="gh">${h} · ${fq(sum(t))}</td></tr>` + grp(t).map(l => `<tr><td><div class="d">${esc(l.n)}</div>${l.note ? `<div class="n">${esc(l.note)}</div>` : ''}</td><td class="q">${fq(l.q)}</td></tr>`).join('')).join('')}</tbody></table></div>`;
  const title = `${cat ? 'Event Sheet' : docTitle} - ${who} - ${fmtLong(ev.event_date).replace(/^\w+, /, '')}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400;1,500&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
:root{--ink:#14213F;--txt:#1F2433;--lab:#4A5265;--acc:#8A5A00;--rule:#9C9479;--wine:#631B1C}
body{font-family:Montserrat,Arial,sans-serif;color:var(--txt);font-size:9.6pt;line-height:1.42;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#ECE8DA}
h1,h2,.who,.hero b,.times b,.menu .d,.items .d{font-family:'Playfair Display',Georgia,serif}
.page{width:210mm;min-height:297mm;margin:0 auto;padding:11mm 13mm 9mm;background:#fff;display:flex;flex-direction:column}
.bar{display:flex;gap:10px;justify-content:center;padding:12px;background:#F7F4EA;border-bottom:1px solid #E4DFC8}
.bar button{font:600 13px Montserrat;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;background:#1A2C54;color:#fff}.bar button.alt{background:#fff;color:#1A2C54;border:1px solid #CFC9B0}.bar span{align-self:center;font-size:12px;color:#5B6478}
header{display:flex;align-items:center;gap:6mm;padding-bottom:3.5mm;border-bottom:1pt solid var(--rule)}header img{height:17mm}
.hd{flex:1;min-width:0}.tag{font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--acc);white-space:nowrap}
h1{font-weight:400;font-style:italic;font-size:22pt;line-height:1.1;margin:.8mm 0 .6mm;color:var(--ink)}.who{font-size:12.5pt;color:var(--ink)}
.meta{text-align:right;font-size:8pt;color:var(--lab);line-height:1.75;white-space:nowrap}
.status{display:inline-block;border:.8pt solid var(--wine);color:var(--wine);border-radius:20px;padding:0 2.5mm;font-size:7pt;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.hero{border-top:1.6pt solid var(--ink);border-bottom:1.6pt solid var(--ink);padding:3mm 4mm;display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:4mm;text-align:center;margin:4mm 0;color:var(--ink)}
.hero div+div{border-left:.6pt solid var(--rule)}.hero span{display:block;font-size:6.8pt;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--acc)}.hero b{font-weight:400;font-size:13pt;color:var(--ink)}
.cols{display:grid;grid-template-columns:1.12fr 1fr;gap:7mm;align-items:start}
h2{font-weight:600;font-size:11.5pt;margin:0 0 1.5mm;letter-spacing:.02em;border-bottom:.8pt solid var(--rule);padding-bottom:1mm;color:var(--ink)}
h2 small{font-family:Montserrat,Arial,sans-serif;font-weight:600;font-size:6.5pt;letter-spacing:.24em;text-transform:uppercase;color:var(--acc);margin-left:2mm}
section{margin:0 0 3.5mm}table.kv{width:100%;border-collapse:collapse}
.kv th{width:31mm;text-align:left;vertical-align:top;font-weight:600;font-size:7pt;letter-spacing:.1em;text-transform:uppercase;color:var(--lab);padding:1mm 2mm 1mm 0}
.kv td{font-weight:500;padding:.8mm 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--txt)}
.times{display:flex;gap:3mm}.times div{flex:1;border:.8pt solid var(--rule);border-radius:2mm;text-align:center;padding:1.3mm 0}
.times span{display:block;font-size:6.6pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--lab)}.times b{font-size:12pt;font-weight:400;color:var(--ink)}
.menu{text-align:center;border:1pt solid var(--rule);border-radius:2.5mm;padding:4mm 5mm 3.5mm;background:#FBF9F2}
.menu h2{border:0;text-align:center;font-size:14pt;font-style:italic;font-weight:400;margin-bottom:1mm}
.menu .c{font-size:6.6pt;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--acc);margin-top:2mm}
.menu .d{font-style:italic;font-size:11.5pt;line-height:1.22;color:var(--ink)}.menu .n{font-size:7.6pt;color:var(--wine);font-style:italic;font-weight:500}
.items{width:100%;border-collapse:collapse;text-align:left}.items th{font-size:6.6pt;letter-spacing:.18em;text-transform:uppercase;color:var(--lab);font-weight:600;border-bottom:.8pt solid var(--rule);padding:1mm}
.items td{padding:1.4mm 1mm;border-bottom:.6pt solid #CFC8B0;vertical-align:top}.items .d{font-size:11pt}.items .q{text-align:center;width:16mm;font-weight:700;color:var(--ink)}
.items td.gh{font-size:6.6pt;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#8A5A00;padding-top:2.5mm;border:0}
.foot{margin-top:auto;padding-top:4mm}.ack{font-size:8pt;color:var(--lab);text-align:center;margin:0 0 7mm}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:14mm}.sign div{border-top:.8pt solid var(--ink);padding-top:1.2mm;font-size:7.4pt;color:var(--lab)}.sign b{display:block;color:var(--ink);font-weight:600;font-size:8.6pt}
footer{margin-top:4mm;text-align:center;font-size:7.2pt;color:var(--lab);letter-spacing:.03em;border-top:.8pt solid var(--rule);padding-top:2mm}
@media screen{.page{margin:16px auto;box-shadow:0 2px 14px rgba(0,0,0,.12)}}@media print{body{background:#fff}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Save as PDF / Print</button><button class="alt" onclick="window.close()">Close</button><span>Choose <b>Save as PDF</b> as the destination.</span></div>
<div class="page" id="pg">
<header><img src="${logo}" alt="Romualdo's"><div class="hd"><div class="tag">Catering Services · Davao City</div><h1>${esc(docTitle)}</h1><div class="who">${esc(who)}</div></div>
<div class="meta">Ref. ${esc(ev.ref)}<br><span class="status">${esc(st)}</span><br>${money && money.status !== 'none' ? `<span class="status" style="border-color:${money.status === 'paid' ? '#2F6B3A;color:#2F6B3A' : '#8A5A00;color:#8A5A00'}">${esc(PAY_ST[money.status][0])}</span><br>` : ''}Issued ${esc(issued)}</div></header>
<div class="hero">${hero.map(([l, v]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
<div class="cols"><div>
<section><h2>Client${cat ? ' &amp; venue' : ''}<small>Details</small></h2><table class="kv">
${row('Client', who)}${row('Contact person', d.contact)}${row('Mobile', mobile)}${row('Email', email)}${cat ? row('Event', evName(ev, client)) + row('Venue', ev.venue) + row('Coordinator', d.coord) + row('Package', d.pkg) : row(del ? 'Deliver to' : 'Pick-up at', del ? ev.venue : (ev.venue || "Romualdo's, 13 Juna Ave., Juna Subd.")) + row('Good for', ev.pax ? ev.pax + ' pax' : '')}
</table></section>
${times.length ? `<section><h2>Timeline<small>Schedule</small></h2><div class="times">${times.map(([l, t]) => `<div><span>${l}</span><b>${esc(fmtClock(t))}</b></div>`).join('')}</div></section>` : ''}
${setup.some(x => x[1]) ? `<section><h2>Setup &amp; service<small>On site</small></h2><table class="kv">${setup.map(([l, v]) => row(l, v)).join('')}</table></section>` : ''}
${notes.some(x => x[1]) ? `<section><h2>Notes<small>Please note</small></h2><table class="kv">${notes.map(([l, v]) => row(l, v)).join('')}</table></section>` : ''}
</div><div>${menuHtml}</div></div>
<div class="foot"><p class="ack">By signing below, the client confirms the ${cat ? 'event details and menu' : 'order details'} above.${d.approvedOn ? ` Approved on ${esc(fmtLong(d.approvedOn).replace(/^\w+, /, ''))}.` : ''}</p>
<div class="sign"><div><b>${esc(who)}</b>Client signature over printed name · Date</div><div><b>${esc(d.preparedBy || S.me.full_name || "Romualdo's Catering Services")}</b>Prepared by · Romualdo's Catering Services</div></div>
<footer>${esc(contactLine())}</footer></div>
</div><script>
function fit(){var p=document.getElementById('pg'),H=p.offsetWidth*297/210;p.style.zoom=1;p.style.minHeight='0';var h=p.scrollHeight,z=h>H?Math.max(.55,(H-2)/h):1;p.style.zoom=z;p.style.minHeight=((H-2)/z)+'px';}
window.addEventListener('load',function(){(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){fit();setTimeout(function(){window.print()},400)})});
<\/script></body></html>`;
}

// Business contact line for PDF footers — the details live in config.js (window.ROM_CONTACT)
function contactLine() {
  const c = window.ROM_CONTACT || {};
  return [c.name || "Romualdo's Catering Services", c.address, c.phone, c.email, c.web].filter(Boolean).join(' · ');
}
function evHero(ev, client) {
  const s = ev.sheet || {}, cat = ev.kind === "buffet", del = s.fulfil === "Delivery", sub = evName(ev, client);
  const cells = [[cat ? 'Date' : del ? 'Delivery' : 'Pick-up', fmtD(ev.event_date)], [cat ? 'Serving' : 'Ready by', ev.serve_time ? fmtClock(ev.serve_time) : '—'],
    ['Guests', ev.pax ? ev.pax + ' pax' : '—'], ['Occasion', ev.event_type || '—'], [cat ? 'Venue' : del ? 'Deliver to' : 'Pick-up at', ev.venue || (cat || del ? '—' : "Romualdo's")]];
  const contact = [s.contact, s.mobile || client?.phone, s.email || client?.email].filter(Boolean);
  return `<div class="ev-sub">${sub ? `<b>${esc(sub)}</b> · ` : ''}${esc(ev.ref)} · ${KIND[ev.kind]}${contact.length ? ' · ' + contact.map(esc).join(' · ') : ''}${ev.contract_price ? ` · Contract <b>${peso(ev.contract_price)}</b>` : ''}</div>
   <div class="ev-hero">${cells.map(([l, v]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}
FORMS.addMenu = async (f, el) => {
  const id = el.dataset.id, qty = f.qty ? num(f.qty) : null;
  if (f.pack_id) { await db.insert('event_menu', { event_id: id, course: f.course, pack_id: f.pack_id, qty }); return refresh(); }
  S.lastCourse = f.course; S.lastCat = f.cat || '';
  if (!f.dish?.trim()) return toast('Type a dish name.', true);
  const n = await db.rpc('add_menu_text', { p_event: id, p_course: f.course, p_text: f.dish, p_qty: qty });
  toast(n > 1 ? `Added as ${n} dishes` : 'Added'); refresh();
};
FORMS.addExtra = async (f, el) => {
  const item = itemIdFromName(f.item); if (!item) return toast('Pick an ingredient from the list (or add it on a recipe page).', true);
  if (!(num(f.qty) > 0)) return toast('Enter a quantity.', true);
  await db.upsert('event_extra_needs', { event_id: el.dataset.id, item_id: item, qty: num(f.qty), note: f.note || null }, 'event_id,item_id'); refresh();
};
FORMS.issue = async (f, el) => {
  const lines = Object.entries(f).filter(([k, v]) => k.startsWith('q_') && num(v) > 0).map(([k, v]) => ({ item_id: k.slice(2), qty: num(v) }));
  if (!lines.length) return toast('Nothing to issue.', true);
  const n = await db.rpc('issue_to_event', { p_event: el.dataset.id, p_lines: lines, p_received_by: f.received_by });
  toast(`${n} items issued to the event`); refresh();
};
FORMS.returnLeft = async (f, el) => {
  const item = itemIdFromName(f.item); if (!item) return toast('Pick an item from the list.', true);
  await db.rpc('issue_to_event', { p_event: el.dataset.id, p_lines: [{ item_id: item, qty: num(f.qty) }], p_received_by: f.by, p_return: true });
  toast('Leftovers returned to the catering store'); refresh();
};
const ACT = {};
ACT.install = () => doInstall();
ACT.delEvent = async el => {
  const what = [el.dataset.name, el.dataset.ref].filter(Boolean).join(' · ');
  if (!confirm(`Delete this event?\n\n${what}\n\nIts menu and draft purchase requests are deleted too. This can't be undone.`)) return;
  try { const ref = await db.rpc('delete_event', { p_event: el.dataset.id }); EVW.dirty = false; toast(`${ref || 'Event'} deleted`); go('#/c/events'); }
  catch (err) { toast(/delete_event|function/i.test(err.message) && /not find|exist/i.test(err.message) ? 'Deleting needs the latest database update — ask the owner to run it.' : err.message, true); }
};
ACT.delInquiry = async el => {
  if (!confirm(`Delete this inquiry${el.dataset.name ? ' from ' + el.dataset.name : ''}?\n\nUse this for spam, tests and duplicates. A copy is kept in Activity. Any event made from it stays.`)) return;
  const ref = await db.rpc('delete_booking', { p_id: el.dataset.id }); toast(`${ref} deleted`); go('#/c/inquiries');
};
ACT.keepMine = el => { const f = el.closest('form'); f.dataset.force = '1'; f.requestSubmit(); };
ACT.showTheirs = () => { EVW.dirty = false; refreshKeep(); toast('Showing the latest saved version'); };
async function loadLogo() {
  if (!S.logoData) S.logoData = await fetch(new URL('../assets/logo.png', location.href)).then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); })).catch(() => '');
}
ACT.evPdf = async el => {
  const w = window.open('', '_blank');   // open now, while it still counts as a tap, so the browser doesn't block it
  if (!w) return toast('The browser blocked the PDF window. Allow pop-ups for romualdos.ph and try again.', true);
  w.document.write('<!DOCTYPE html><title>Preparing PDF…</title><body style="font:15px Montserrat,Arial,sans-serif;color:#1A2C54;display:grid;place-items:center;height:90vh;margin:0">Preparing the event sheet…</body>');
  try {
    const id = el.dataset.id, [ev] = await db.select('events', { eq: { id } });
    const [menu, client] = await Promise.all([db.select('event_menu', { eq: { event_id: id }, order: [['sort'], ['course']] }), ev.client_id ? db.select('clients', { eq: { id: ev.client_id } }).then(r => r[0]) : null]);
    await loadLogo();
    w.document.open(); w.document.write(sheetHtml(ev, menu, client)); w.document.close();
  } catch (e) { w.close(); throw e; }
};
ACT.rmMenu = async el => { await db.remove('event_menu', { id: el.dataset.id }); refresh(); };
ACT.rmExtra = async el => { await db.remove('event_extra_needs', { event_id: el.dataset.ev, item_id: el.dataset.item }); refresh(); };
ACT.genPR = async el => {
  const r = await db.rpc('generate_event_pr', { p_event: el.dataset.id });
  if (r.pr) { toast(`${r.pr}: ${r.lines} items to buy${r.warnings?.length ? ` · ${r.warnings.length} dish(es) not included yet` : ''}`); go('#/c/pr/' + r.pr_id); }
  else { toast(r.message, !!r.warnings?.length); refresh(); }
};
ACT.closeEvent = async el => { if (!confirm('Close this event? Leftover stock set aside for it will be released.')) return; await db.rpc('close_event', { p_event: el.dataset.id }); toast('Event closed'); refresh(); };

/* ================= REQUESTS ================= */
routes['c/requests'] = async arg => {
  const tab = arg || (can(WS(), 'manager') ? 'approve' : 'open');
  const tabs = [['approve', 'To approve'], ['open', 'In progress'], ['draft', 'Drafts'], ['all', 'All']];
  const st = { approve: ['submitted'], open: ['submitted', 'approved', 'ordered'], draft: ['draft'] }[tab];
  let rows = await db.select('pr_overview', { eq: { ws: WS() }, ...(st ? { in: { status: st } } : {}), order: [['created_at', false]], limit: 200 });
  const waitRep = new Set((await db.select('purchase_reports', { cols: 'pr_id', eq: { ws: WS(), status: 'submitted' } }).catch(() => [])).map(r => r.pr_id));
  if (tab === 'approve' && waitRep.size) { const have = new Set(rows.map(r => r.id)), more = [...waitRep].filter(x => !have.has(x));
    if (more.length) rows = [...rows, ...await db.select('pr_overview', { in: { id: more } })]; }
  return `<div class="row"><h1>Purchase requests</h1><span class="sp"></span>${rows.length ? '<button class="ghost" data-act="delPRs" title="Delete the ticked requests">Delete ticked</button>' : ''}${rows.length > 1 ? '<button class="ghost" data-act="combinePR">Combine into one list</button>' : ''}<button class="pri" data-act="newPR">＋ New request</button></div>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/${P()}/requests/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${rows.length ? `<p class="small mut">Tick requests to <b>combine</b> them into one buying list, or to <b>delete</b> ones made by mistake, duplicated, or replaced by a revised order.</p>` : ''}
   ${rows.length ? `<div class="list">${rows.map(p => `<div class="pick"><label class="pk" title="Tick to combine or delete"><input type="checkbox" data-pr="${p.id}" data-no="${esc(p.pr_no)}"></label><a class="li" href="#/${P()}/pr/${p.id}"><div class="li-main"><b>${esc(p.pr_no)}${p.priority === 'urgent' ? ' ' + chip('urgent', 'bad') : ''}</b>
     <span class="mut small">${esc([p.event_title ? p.event_ref + ' · ' + p.event_title : '', prPurpose(p)].filter(Boolean).join(' · '))}</span>
     <span class="mut small">${p.line_count} items · est. ${peso(p.est_total)} · ${esc(p.requested_by_name || '')}${p.needed_by ? ' · needed ' + esc(fmtD(p.needed_by)) : ''}</span></div>${waitRep.has(p.id) ? chip('Bought — to check', 'warn') : chip(PR_STATUS[p.status], statusTone(p.status))}</a></div>`).join('')}</div>` : '<div class="empty">No requests here.</div>'}`;
};
// "Auto from EV-… · client · type" repeats the event already shown — only show a purpose that adds something
const prPurpose = p => p.event_title && /^auto from/i.test(p.purpose || '') ? '' : (p.purpose || '');
const prCanDel = p => !['ordered', 'received'].includes(p.status) && (isAdmin() || can(p.ws, 'manager') || (p.requested_by === S.user.id && p.status !== 'approved'));
async function deletePRs(ids, nos) {
  if (!ids.length) return toast('Tick the requests to delete first.', true);
  const what = nos.length === 1 ? nos[0] : `${nos.length} requests (${nos.join(', ')})`;
  if (!confirm(`Delete ${what}?\n\nUse this for requests made by mistake, duplicates, or ones replaced by a revised event or client order. This can't be undone.`)) return false;
  try { const n = await db.rpc('delete_prs', { p_ids: ids }); toast(`${n} request${n === 1 ? '' : 's'} deleted`); return true; }
  catch (err) { toast(/delete_prs/.test(err.message) ? 'Deleting needs the latest database update — ask the owner to run it.' : err.message, true); return false; }
}
ACT.delPRs = async () => { const t = [...document.querySelectorAll('input[data-pr]:checked')]; if (await deletePRs(t.map(x => x.dataset.pr), t.map(x => x.dataset.no))) refresh(); };
ACT.delPR = async el => { if (await deletePRs([el.dataset.id], [el.dataset.no])) go(`#/${P()}/requests`); };
ACT.newPR = async () => { const r = (await db.insert('purchase_requests', { ws: WS(), purpose: WS() === 'restaurant' ? 'Restaurant restock' : 'Catering store restock', requested_by: S.user.id }))[0]; go(`#/${P()}/pr/${r.id}`); };

/* ---- "Record what was bought": one form on the request → approval → stock ---- */
function buyReportForm(p, toBuy, remaining) {
  let ticks = null; try { const t = JSON.parse(localStorage.getItem('prl-' + p.id) || 'null'); if (t && Object.values(t).some(Boolean)) ticks = t; } catch (e) {}
  const row = l => { const on = ticks ? !!ticks[l.id] : true, u = esc(itemUnit(l.item_id)), q = remaining(l), c = num(l.est_unit_cost);
    return `<tr class="br${on ? '' : ' off'}" data-br="${l.id}"><td class="ck"><input type="checkbox" name="b_${l.id}" ${on ? 'checked' : ''} aria-label="Bought"></td>
     <td class="nm"><span class="t">${esc(itemName(l.item_id))}</span>${l.note ? `<span class="d">${esc(l.note.replace(/^for:\s*/i, ''))}</span>` : ''}<span class="nb">not bought</span></td>
     <td class="n nowrap"><input name="bq_${l.id}" data-asked="${q}" type="number" step="any" min="0" value="${q}" class="qty" title="Asked ${fq(q)} ${u}"><span class="u">${u}</span></td>
     <td class="n nowrap"><span class="u">₱</span><input name="bc_${l.id}" data-est="${c}" type="number" step="any" min="0" value="${c || ''}" placeholder="0" class="qty" title="Estimated ${peso(c)} per ${u}"><span class="u">/${u}</span></td>
     <td class="n amt" data-bamt>${peso(q * c)}</td></tr>`; };
  return `<form class="card buyrep" data-form="buyReport" data-id="${p.id}"><h2>Record what was bought</h2>
   <p class="small mut">Untick what you couldn't buy; fix quantities or prices that differ. Stock updates after a manager or storekeeper approves.${ticks ? ' <b>Pre-ticked from your purchase list.</b>' : ''}</p>
   <div class="tw"><table class="brt"><thead><tr><th></th><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>
   ${shopRows(toBuy, l => l.item_id, l => remaining(l), 5, row)}</tbody>
   <tfoot><tr><td colspan="5"><div id="brSum" class="brsum"></div></td></tr></tfoot></table></div>
   <div class="brf"><input name="supplier" placeholder="Where bought (e.g. Bankerohan)"><input name="or_no" placeholder="OR / receipt no."><input name="note" placeholder="Note (optional)"><button class="pri">Submit for approval</button></div></form>`;
}
function brTotals(f) {
  let tot = 0, nb = 0, n = 0;
  f.querySelectorAll('tr[data-br]').forEach(tr => { const id = tr.dataset.br, on = f.elements['b_' + id].checked, a = num(f.elements['bq_' + id].value) * num(f.elements['bc_' + id].value);
    tr.classList.toggle('off', !on); tr.querySelector('[data-bamt]').textContent = on ? peso(a) : '—'; n++; if (on) tot += a; else nb++;
    const q = f.elements['bq_' + id], c = f.elements['bc_' + id];
    q.classList.toggle('chg', num(q.value) !== num(q.dataset.asked)); c.classList.toggle('chg', num(c.value) !== num(c.dataset.est)); });
  const s = f.querySelector('#brSum'); if (s) s.innerHTML = `<span>${n - nb} of ${n} bought${nb ? ` · <span class="bad-t">${nb} not bought</span>` : ''}</span><b>${peso(tot)}</b>`;
}
document.addEventListener('input', e => { const f = e.target.closest('form[data-form="buyReport"]'); if (f) brTotals(f); });
document.addEventListener('change', e => { const f = e.target.closest('form[data-form="buyReport"]'); if (f) brTotals(f); });
FORMS.buyReport = async (f, el) => {
  const ids = [...el.querySelectorAll('tr[data-br]')].map(tr => tr.dataset.br);
  const lines = ids.map(id => ({ pr_line_id: id, bought: !!el.elements['b_' + id].checked, qty: num(f['bq_' + id]), unit_cost: num(f['bc_' + id]) }));
  if (lines.some(l => l.bought && !(l.qty > 0))) return toast('Enter how much was bought for each ticked item, or untick it.', true);
  const nb = lines.filter(l => !l.bought).length;
  if (!confirm(`Submit for approval?\n\n${lines.length - nb} bought${nb ? `, ${nb} not bought` : ''}. Stock changes only after a manager or storekeeper approves.`)) return;
  try { await db.rpc('submit_purchase_report', { p_pr: el.dataset.id, p_lines: lines, p_supplier: f.supplier, p_or_no: f.or_no, p_note: f.note });
    try { localStorage.removeItem('prl-' + el.dataset.id); } catch (e) {}
    toast('Sent for approval'); refresh(); }
  catch (err) { toast(err.message, true); }
};
function reportCard(r, ls, prLines, p) {
  const byId = Object.fromEntries(prLines.map(l => [l.id, l])), me = S.user.id;
  const approver = can(p.ws, 'manager', 'storekeeper') && (r.submitted_by !== me || isAdmin());
  const nb = ls.filter(x => !x.bought), tot = ls.reduce((a, x) => a + (x.bought ? num(x.qty) * num(x.unit_cost) : 0), 0);
  const rows = ls.map(x => ({ ...x, item_id: byId[x.pr_line_id]?.item_id, est: num(byId[x.pr_line_id]?.est_unit_cost), note: byId[x.pr_line_id]?.note }));
  return `<section class="card buyrep pend"><div class="row"><h2>Bought — waiting for approval</h2><span class="sp"></span>${chip('To check', 'warn')}</div>
   <p class="small mut">Recorded by <b>${esc(nameOf(r.submitted_by))}</b> · ${esc(fmtT(r.submitted_at))}${r.supplier_text ? ' · ' + esc(r.supplier_text) : ''}${r.or_no ? ' · OR ' + esc(r.or_no) : ''}${r.note ? `<br>“${esc(r.note)}”` : ''}</p>
   <div class="tw"><table class="brt"><thead><tr><th>Item</th><th class="n">Bought</th><th class="n">Price paid</th><th class="n">Amount</th></tr></thead><tbody>
   ${shopRows(rows, x => x.item_id, x => x.qty, 4, x => `<tr class="${x.bought ? '' : 'off'}"><td>${esc(itemName(x.item_id))}${x.bought ? '' : '<div class="small bad-t">Not bought</div>'}</td>
     <td class="n">${x.bought ? `${fq(x.qty)} ${esc(itemUnit(x.item_id))}` : '—'}</td><td class="n">${x.bought ? `${peso(x.unit_cost)}${x.est && Math.abs(num(x.unit_cost) - x.est) > 0.009 ? `<div class="small ${num(x.unit_cost) > x.est ? 'bad-t' : 'ok-t'}">est. ${peso(x.est)}</div>` : ''}` : ''}</td><td class="n">${x.bought ? peso(num(x.qty) * num(x.unit_cost)) : ''}</td></tr>`)}
   </tbody><tfoot><tr><td colspan="4"><b>${ls.length - nb.length} of ${ls.length} bought · ${peso(tot)}</b>${nb.length ? ` · <span class="bad-t">${nb.length} not bought</span>` : ''}</td></tr></tfoot></table></div>
   ${approver ? `<div class="grid mt"><label>Note (optional, or reason for rejecting)<input id="repNote"></label></div>
     ${nb.length ? `<label class="tick mt"><input type="checkbox" id="repClose"> The ${nb.length} unbought item${nb.length > 1 ? 's' : ''} won't be bought — close this request</label>` : ''}
     <div class="row end mt"><button type="button" class="ghost danger" data-act="decideReport" data-id="${r.id}" data-ok="0">Reject</button><button type="button" class="pri" data-act="decideReport" data-id="${r.id}" data-ok="1">Approve — add to stock</button></div>`
     : `<p class="alert info">${r.submitted_by === me ? 'You recorded these purchases, so a manager or storekeeper will check and approve them.' : 'Waiting for a manager or storekeeper to check and approve.'}</p>`}
   ${r.submitted_by === me || can(p.ws, 'manager') ? `<div class="row end"><button type="button" class="lnk" data-act="withdrawReport" data-id="${r.id}">Withdraw to fix it</button></div>` : ''}</section>`;
}
ACT.decideReport = async el => {
  const ok = el.dataset.ok === '1', note = document.getElementById('repNote')?.value || '', close = !!document.getElementById('repClose')?.checked;
  if (!ok && !note.trim()) return toast('Write the reason for rejecting, so the buyer can fix it.', true);
  if (ok && !confirm('Approve these purchases? The bought items go into stock at the prices paid.')) return;
  try { const r = await db.rpc('decide_purchase_report', { p_report: el.dataset.id, p_approve: ok, p_note: note, p_close: close });
    toast(ok ? `Added to stock${r.request_status === 'received' ? ' · request complete' : ' · unbought items are still to buy'}` : 'Rejected — the buyer can fix it and submit again'); await loadMaster(); refresh(); }
  catch (err) { toast(err.message, true); }
};
ACT.withdrawReport = async el => { if (!confirm('Withdraw this purchase report? You can fix it and submit it again.')) return;
  try { await db.rpc('withdraw_purchase_report', { p_report: el.dataset.id }); toast('Withdrawn'); refresh(); } catch (err) { toast(err.message, true); } };
routes['c/pr'] = async id => {
  const [p] = await db.select('pr_overview', { eq: { id } }); if (!p) return '<div class="card">Request not found.</div>';
  const [lines, orders] = await Promise.all([db.select('pr_lines', { eq: { pr_id: id } }), db.select('po_overview', { eq: { pr_id: id }, order: [['ordered_at']] })]);
  const mine = p.requested_by === S.user.id;
  const editable = p.status === 'draft' && (mine || can(p.ws, 'manager'));
  const approver = p.status === 'submitted' && can(p.ws, 'manager') && (!mine || isAdmin());
  const buyer = ['approved', 'ordered'].includes(p.status) && can(p.ws, 'purchaser', 'manager', 'finance');
  let ordered = {};
  if (orders.length) { const pl = await db.select('po_lines', { in: { po_id: orders.filter(o => o.status !== 'cancelled').map(o => o.id) } }); pl.forEach(x => ordered[x.pr_line_id] = (ordered[x.pr_line_id] || 0) + num(x.qty)); }
  const remaining = l => Math.max(num(l.approved_qty) - (ordered[l.id] || 0), 0);
  const advances = buyer ? await db.select('cash_advances', { eq: { ws: p.ws, status: 'open' }, order: [['released_at', false]] }) : [];
  // purchase reports ("Record what was bought")
  let reports = [], rLines = [], repOff = false;
  try { reports = await db.select('purchase_reports', { eq: { pr_id: id }, order: [['submitted_at', false]] });
    if (reports.length) rLines = await db.select('purchase_report_lines', { in: { report_id: reports.map(r => r.id) } }); }
  catch (e) { repOff = true; }
  await namesOf(reports.flatMap(r => [r.submitted_by, r.decided_by]));
  const pending = reports.find(r => r.status === 'submitted');
  const canReport = ['approved', 'ordered'].includes(p.status) && can(p.ws, 'purchaser', 'manager', 'finance', 'storekeeper', 'chef', 'coordinator');
  const toBuy = lines.filter(l => remaining(l) > 0);
  const total = lines.reduce((s, l) => s + num(l.approved_qty ?? l.qty) * num(l.est_unit_cost), 0);
  return `<div class="row"><a href="#/${P()}/requests" class="back">‹ Requests</a></div>
  <div class="row"><h1>${esc(p.pr_no)}</h1>${chip(PR_STATUS[p.status], statusTone(p.status))}<span class="sp"></span>${lines.length ? `<button type="button" class="ghost" data-act="prPreview" data-id="${id}">Preview list</button>` : ''}${prCanDel(p) ? `<button type="button" class="ghost danger" data-act="delPR" data-id="${id}" data-no="${esc(p.pr_no)}" title="Delete this request (mistake, duplicate, or revised order)">Delete</button>` : ''}</div>
  <p class="lede">${p.event_id ? `<a href="#/c/event/${p.event_id}">${esc(p.event_ref + ' · ' + p.event_title)}</a>${prPurpose(p) ? ' · ' : ''}` : ''}${esc(prPurpose(p))}<br><span class="small mut">Requested by ${esc(p.requested_by_name || '')} · ${esc(fmtT(p.created_at))}${p.needed_by ? ' · needed by ' + esc(fmtD(p.needed_by)) : ''}${p.approved_by_name ? ` · ${p.status === 'rejected' ? 'rejected' : 'approved'} by ${esc(p.approved_by_name)} ${esc(fmtT(p.approved_at))}` : ''}</span></p>
  ${p.decision_note ? `<div class="alert ${p.status === 'rejected' ? 'bad' : 'info'}">${esc(p.decision_note)}</div>` : ''}
  ${(fold => `${fold ? `<details class="card prfold"><summary><b>Requested items</b> <span class="mut">${lines.length} items · est. ${peso(total)}</span></summary>` : ''}<form class="${fold ? 'mt' : 'card'}" data-form="${approver ? 'approvePR' : editable ? 'saveDraft' : 'none'}" data-id="${id}">
   <div class="tw"><table class="prt"><thead><tr><th>Item</th><th class="n">Requested</th>${p.status !== 'draft' ? '<th class="n">Approved</th>' : ''}<th class="n">Est. price</th><th class="n">In store then</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
   ${shopRows(lines, l => l.item_id, l => l.approved_qty ?? l.qty, 7, l => `<tr><td>${esc(itemName(l.item_id))}${l.note ? `<div class="small mut">${esc(l.note)}</div>` : ''}</td>
     <td class="n">${editable ? `<input name="q_${l.id}" type="number" step="any" min="0" value="${num(l.qty)}" class="qty">` : fq(l.qty)} ${esc(itemUnit(l.item_id))}${packSplit(l.item_id, l.qty) ? `<div class="small mut">${esc(packSplit(l.item_id, l.qty))}</div>` : ''}</td>
     ${p.status !== 'draft' ? `<td class="n">${approver ? `<input name="a_${l.id}" type="number" step="any" min="0" max="${num(l.qty)}" value="${num(l.qty)}" class="qty">` : l.approved_qty != null ? buyCell(l.item_id, l.approved_qty) : '—'}</td>` : ''}
     <td class="n">${num(l.est_unit_cost) ? peso(l.est_unit_cost) : '<span class="mut small">—</span>'}</td><td class="n mut">${l.on_hand_then != null ? fq(l.on_hand_then) : ''}</td>
     ${editable ? `<td><button type="button" class="x" data-act="rmLine" data-id="${l.id}">✕</button></td>` : ''}</tr>`)}
   </tbody><tfoot><tr><td colspan="9">Estimated total ${peso(total)} <span class="small mut">(items without a price yet count as ₱0)</span></td></tr></tfoot></table></div>
   ${editable ? `<div class="addline mt"><input name="new_item" list="dl-items" placeholder="Add item" autocomplete="off"><input name="new_qty" type="number" step="any" min="0" placeholder="qty" class="qty"><button type="button" data-act="addLine" data-id="${id}">Add</button></div>${itemDatalist()}
     <div class="grid mt"><label>Purpose<input name="purpose" value="${esc(p.purpose || '')}"></label><label>Needed by<input name="needed_by" type="date" value="${esc(p.needed_by || '')}"></label>
     <label>Priority<select name="priority">${opt('normal', 'Normal', p.priority === 'normal')}${opt('urgent', 'Urgent', p.priority === 'urgent')}</select></label></div>
     <div class="row end"><button class="ghost">Save draft</button><button type="button" class="pri" data-act="submitPR" data-id="${id}">Submit for approval</button></div>` : ''}
   ${approver ? `<label class="mt">Note to the buyer, or reason for rejecting<input name="note"></label>
     <div class="row end"><button type="button" class="danger" data-act="rejectPR" data-id="${id}">Reject</button><button class="pri">Approve</button></div>` : ''}
   ${p.status === 'submitted' && can(p.ws, 'manager') && mine && !isAdmin() ? '<p class="alert warn">You filed this request, so another manager or the owner must approve it.</p>' : ''}
  </form>${fold ? '</details>' : ''}`)(['approved', 'ordered', 'received'].includes(p.status) && !approver && !editable)}
  ${pending ? reportCard(pending, rLines.filter(x => x.report_id === pending.id), lines, p) : ''}
  ${canReport && !pending && toBuy.length ? (repOff ? '<div class="alert warn">Recording purchases needs the latest database update — ask the owner to run it.</div>' : buyReportForm(p, toBuy, remaining)) : ''}
  ${buyer && lines.some(l => remaining(l) > 0) ? `<details class="card"><summary><b>Ordering from a supplier for delivery instead?</b> <span class="small mut">Create an order, then receive it in Orders &amp; receiving</span></summary><form class="mt" id="orderForm" data-form="createPO" data-id="${id}">
    <p class="small mut">One order per supplier. Tick what this supplier delivers.</p>
    <div class="otick">${lines.filter(l => remaining(l) > 0).map(l => `<label class="tick"><input type="checkbox" name="o_${l.id}" checked> ${esc(itemName(l.item_id))} <span class="mut">${fq(remaining(l))} ${esc(itemUnit(l.item_id))}</span></label>`).join('')}</div>
    <div class="grid"><label>Supplier / stall<input name="supplier" required placeholder="e.g. Agdao market — stall 12"></label>
    <label>Cash advance used<select name="advance">${opt('', 'None / paid directly')}${advances.map(a => opt(a.id, `${peso(a.amount)} · ${fmtT(a.released_at)}`)).join('')}</select></label></div>
    <div class="row end"><button class="pri">Create order</button></div></form></details>` : ''}
  ${reports.filter(r => r.status !== 'submitted').length ? `<section class="card"><h2>Purchase reports</h2><div class="list">${reports.filter(r => r.status !== 'submitted').map(r => { const ls = rLines.filter(x => x.report_id === r.id), nb = ls.filter(x => !x.bought).length;
    return `<div class="li"><div class="li-main"><b>${esc(nameOf(r.submitted_by))} · ${esc(fmtT(r.submitted_at))}</b><span class="mut small">${ls.filter(x => x.bought).length} bought${nb ? ` · ${nb} not bought` : ''} · ${peso(ls.reduce((a, x) => a + num(x.qty) * num(x.unit_cost), 0))}${r.or_no ? ' · OR ' + esc(r.or_no) : ''} · ${r.status === 'approved' ? 'approved' : 'rejected'} by ${esc(nameOf(r.decided_by))}${r.decision_note ? ' — “' + esc(r.decision_note) + '”' : ''}</span></div>${chip(r.status === 'approved' ? 'In stock' : 'Rejected', r.status === 'approved' ? 'ok' : 'bad')}</div>`; }).join('')}</div></section>` : ''}
  ${orders.length ? `<section class="card"><h2>Orders</h2><div class="list">${orders.map(o => `<a class="li" href="#/${P()}/po/${o.id}"><div class="li-main"><b>${esc(o.po_no)}</b><span class="mut small">${esc(o.supplier || '')} · ${o.line_count} items · by ${esc(o.buyer_name || '')}</span></div>${chip(PO_STATUS[o.status], statusTone(o.status))}</a>`).join('')}</div></section>` : ''}`;
};
// Printable purchase list — opens in a new tab, grouped the way the buyer shops (proteins → market → grocery)
ACT.prPreview = async el => {
  const w = window.open('', '_blank');   // open while it still counts as a tap, so pop-up blockers allow it
  if (!w) return toast('The browser blocked the preview. Allow pop-ups for romualdos.ph and try again.', true);
  w.document.write('<!DOCTYPE html><title>Preparing list…</title><body style="font:15px Montserrat,Arial,sans-serif;color:#1A2C54;display:grid;place-items:center;height:90vh;margin:0">Preparing the purchase list…</body>');
  try {
    const id = el.dataset.id, [[p], lines] = await Promise.all([db.select('pr_overview', { eq: { id } }), db.select('pr_lines', { eq: { pr_id: id } })]);
    // a draft being edited: show the quantities on screen, even if not saved yet
    const f = document.querySelector(`form[data-id="${id}"]`);
    const typed = l => { const v = f?.elements['q_' + l.id]?.value; return v != null && v !== '' ? num(v) : null; };
    const rows = lines.map(l => ({ ...l, q: typed(l) ?? num(l.approved_qty ?? l.qty) })).filter(l => l.q > 0);
    await loadLogo();
    w.document.open(); w.document.write(prListHtml(p, rows)); w.document.close();
  } catch (e) { w.close(); throw e; }
};
// Printable buying list. One request, or several events merged (evs = [{key:'A', ref, title, date, pax}], rows carry parts:[{ev, q, dish}]).
// Two columns on paper and tablets, one on phones; printing shrinks it to a single A4 page. Tap a line to tick it off.
// Several requests (usually one per event) merged into one buying list: same items added up, split shown per event
ACT.combinePR = async () => {
  const ids = [...document.querySelectorAll('input[data-pr]:checked')].map(x => x.dataset.pr);
  if (!ids.length) return toast('Tick the requests to combine first.', true);
  const w = window.open('', '_blank');
  if (!w) return toast('The browser blocked the list. Allow pop-ups for romualdos.ph and try again.', true);
  w.document.write('<!DOCTYPE html><title>Preparing list…</title><body style="font:15px Montserrat,Arial,sans-serif;color:#1A2C54;display:grid;place-items:center;height:90vh;margin:0">Combining the requests…</body>');
  try {
    const [prs, lines] = await Promise.all([db.select('pr_overview', { in: { id: ids } }), db.select('pr_lines', { in: { pr_id: ids } })]);
    const evIds = [...new Set(prs.map(p => p.event_id).filter(Boolean))];
    const evRows = evIds.length ? await db.select('events', { cols: 'id,event_date,pax,kind', in: { id: evIds } }) : [];
    const evById = Object.fromEntries(evRows.map(e => [e.id, e]));
    prs.sort((a, b) => (evById[a.event_id]?.event_date || a.needed_by || '9').localeCompare(evById[b.event_id]?.event_date || b.needed_by || '9') || a.pr_no.localeCompare(b.pr_no));
    const evs = prs.map((p, i) => { const e = evById[p.event_id];
      return { key: String.fromCharCode(65 + i), pr: p.id, ref: p.event_ref || p.pr_no, title: p.event_title || p.purpose || p.pr_no,
        date: e?.event_date || p.needed_by, pax: e?.pax ? `${e.pax} ${e.kind === 'packs' ? 'packs' : 'pax'}` : p.event_ref ? p.pr_no : '' }; });
    const keyOf = Object.fromEntries(evs.map(e => [e.pr, e.key]));
    const m = new Map();
    lines.forEach(l => { const q = num(l.approved_qty ?? l.qty); if (!(q > 0)) return;
      if (!m.has(l.item_id)) m.set(l.item_id, { id: l.item_id, item_id: l.item_id, q: 0, est_unit_cost: 0, parts: [] });
      const r = m.get(l.item_id), k = keyOf[l.pr_id], dish = (l.note || '').replace(/^for:\s*/i, '');
      r.q += q; if (num(l.est_unit_cost)) r.est_unit_cost = num(l.est_unit_cost);
      const pt = r.parts.find(x => x.ev === k); if (pt) { pt.q += q; if (dish && !pt.dish.includes(dish)) pt.dish = [pt.dish, dish].filter(Boolean).join(', '); } else r.parts.push({ ev: k, q, dish }); });
    for (const r of m.values()) r.parts.sort((a, b) => a.ev.localeCompare(b.ev));
    const sts = [...new Set(prs.map(p => p.status))], dates = prs.map(p => p.needed_by).filter(Boolean).sort(), names = [...new Set(prs.map(p => p.requested_by_name).filter(Boolean))];
    const allEv = prs.every(p => p.event_id), apprs = [...new Set(prs.map(p => p.approved_by_name).filter(Boolean))];
    const p = { id: 'combo-' + [...ids].sort().join('-').slice(0, 80), ws: prs[0]?.ws, pr_no: prs.length > 1 ? `${prs.length} requests combined` : prs[0]?.pr_no,
      status: sts.length === 1 ? sts[0] : 'Mixed', needed_by: dates[0], priority: prs.some(p => p.priority === 'urgent') ? 'urgent' : 'normal',
      requested_by_name: names.join(', '), approved_by_name: apprs.join(', '), purpose: `${prs.length} ${allEv ? 'events' : 'requests'} · ${prs.map(p => p.pr_no.replace(/^PR-\d{4}-/, '#')).join(' ')}` };
    await loadLogo();
    w.document.open(); w.document.write(prListHtml(p, [...m.values()], prs.length > 1 ? evs : [])); w.document.close();
  } catch (e) { w.close(); throw e; }
};
function prListHtml(p, rows, evs = []) {
  const logo = S.logoData || new URL('../assets/logo.png', location.href).href, multi = evs.length > 1;
  const EVC = ['#1A2C54', '#8C2F39', '#7A5A00', '#2F6B4F', '#5B3F8C'], evc = k => EVC[Math.max(0, evs.findIndex(e => e.key === k))];
  const amt = l => buyRound(l.item_id, l.q) * num(l.est_unit_cost), short = n => peso(n).replace(/\.00$/, '');
  const groups = new Map();
  [...rows].sort((a, b) => { const ra = shopRank(a.item_id), rb = shopRank(b.item_id);
    return ra - rb || (ra < 4 ? b.q - a.q : 0) || itemName(a.item_id).localeCompare(itemName(b.item_id)); })
    .forEach(l => { const g = shopRank(l.item_id); groups.has(g) || groups.set(g, []); groups.get(g).push(l); });
  const total = rows.reduce((s, l) => s + amt(l), 0), noPrice = rows.filter(l => !num(l.est_unit_cost)).length;
  const tag = k => `<em class="ev" style="background:${evc(k)}">${esc(k)}</em>`;
  const line = l => { const u = itemUnit(l.item_id), sp = packSplit(l.item_id, l.q), c = num(l.est_unit_cost);
    const dish = multi ? (l.parts || []).map(x => tag(x.ev) + esc(x.dish || '')).join(' ') : esc((l.note || '').replace(/^for:\s*/i, ''));
    const split = multi && (l.parts || []).length > 1 ? l.parts.map(x => `${x.ev} ${fq(x.q)}`).join(' + ') : sp;
    return `<div class="r" data-k="${esc(l.id || l.item_id)}"><i></i><div class="nm">${esc(itemName(l.item_id))}${dish ? `<small>${dish}</small>` : ''}</div>
     <div class="q">${fq(buyRound(l.item_id, l.q))} ${esc(u)}${split ? `<small>${esc(split)}</small>` : ''}</div>
     <div class="a">${c ? `${short(amt(l))}<small>@ ${short(c)}/${esc(u)}</small>` : '<small>no price</small>'}</div></div>`; };
  const body = [...groups].map(([g, ls]) => { const sub = ls.reduce((s, l) => s + amt(l), 0);
    return `<div class="g"><div class="gh">${g < 4 ? 'Protein · ' : ''}${esc(SHOP_HEADS[g])}<span>${ls.length} item${ls.length > 1 ? 's' : ''}${sub ? ' · ' + short(sub) : ''}</span></div>${ls.map(line).join('')}</div>`; }).join('');
  const info = [['For', multi ? (p.purpose || `${evs.length} events`) : p.event_title ? `${p.event_ref} · ${p.event_title}` : (p.purpose || '—')], ['Needed by', p.needed_by ? fmtD(p.needed_by) : 'Not set'],
    ['Priority', p.priority === 'urgent' ? 'Urgent' : 'Normal'], ['Requested by', p.requested_by_name || '—'], ['Est. total', peso(total)]];
  const approved = ['approved', 'ordered', 'received'].includes(p.status) || (p.status === 'Mixed' && p.approved_by_name);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`Purchase List - ${p.pr_no}${p.needed_by ? ' - ' + fmtD(p.needed_by) : ''}`)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital@1&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:9mm}*{box-sizing:border-box}html,body{margin:0}
body{font:400 13px/1.3 Montserrat,Arial,sans-serif;color:#1B1F2A;background:#ECE8DA;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;padding:8px 12px;background:#F7F4EA;border-bottom:1px solid #E0DAC4;font-size:12px;color:#4A5265}
.bar .sp{flex:1}.bar button{font:500 13px Montserrat,Arial;border:0;border-radius:7px;padding:8px 14px;background:#1A2C54;color:#fff}.bar button.alt{background:#fff;color:#1A2C54;border:1px solid #CFC9B0}
.page{background:#fff;max-width:192mm;margin:14px auto;padding:9mm;box-shadow:0 2px 12px rgba(0,0,0,.1)}
header{display:flex;align-items:center;gap:4mm;padding-bottom:2.5mm;border-bottom:1.3px solid #1A2C54}header img{height:11mm}
.hd{flex:1}.tag{font-size:9px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:#7A5A00}
h1{font:italic 400 22px/1.1 'Playfair Display',Georgia,serif;margin:1px 0 0;color:#1A2C54}
.meta{text-align:right;font-size:11px;line-height:1.5;color:#4A5265}.meta b{display:block;font-weight:600;font-size:14px;color:#1A2C54}
.st{display:inline-block;border:1px solid #1A2C54;color:#1A2C54;border-radius:20px;padding:0 7px;font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase}
.info{display:grid;grid-template-columns:1.4fr 1fr .7fr 1fr 1fr;border:1px solid #B5AE95;border-radius:6px;margin:3mm 0 2.5mm}
.info div{padding:4px 8px}.info div+div{border-left:1px solid #B5AE95}.info span{display:block;font-size:8.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#6B7280}
.info b{font-weight:500}.info .urg{color:#9B1C1C}.info .tot{font-weight:600;color:#1A2C54}
.evs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 10px;margin:0 0 2.5mm;font-size:11.5px}
.evs div{display:flex;gap:6px;align-items:baseline}.evs small{display:block;color:#5B6478;font-size:10.5px}
.ev{display:inline-grid;place-items:center;min-width:15px;height:15px;border-radius:3px;color:#fff;font:normal 500 9.5px/1 Montserrat,Arial;margin-right:3px;vertical-align:1px}
.cols{column-count:2;column-gap:6mm}
.g{margin-bottom:3mm;border:1px solid #E3DDCF;border-radius:5px;overflow:hidden;break-inside:avoid-column}
.gh{display:flex;justify-content:space-between;background:#F3EFE3;border-bottom:1px solid #E0D8C4;padding:5px 8px;font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#14213F;break-after:avoid}
.gh span{white-space:nowrap;margin-left:8px;letter-spacing:.02em;font-weight:500;text-transform:none;color:#5B6170}
.r{display:grid;grid-template-columns:13px 1fr auto 64px;gap:0 8px;padding:5px 8px;border-bottom:1px solid #E3DDCF;break-inside:avoid;cursor:pointer}.r:last-child{border-bottom:0}
.r i{width:11px;height:11px;border:1px solid #8A8577;border-radius:2px;margin-top:3px}
.nm{min-width:0;color:#1F2433}.q{text-align:right;white-space:nowrap;color:#1F2433}.a{text-align:right;white-space:nowrap;color:#1F2433}
.r small{display:block;font-size:10.5px;color:#5B6170;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4}
.nm small .ev{min-width:13px;height:13px;font-size:8.5px}
.r.done{background:#F1F7F2}.r.done i{background:#2F6B4F;border-color:#2F6B4F}.r.done .nm{text-decoration:line-through;color:#6B7280}
.end{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;border-top:1.3px solid #1A2C54;margin-top:1mm;padding-top:2mm;font-size:11.5px;color:#4A5265}
.end .sp{flex:1}.end b{font-weight:600;font-size:16px;color:#1A2C54}
.sig{display:grid;grid-template-columns:repeat(4,1fr);gap:7mm;margin-top:8mm;break-inside:avoid;font-size:10px;color:#5B6478}.sig div{border-top:1px solid #1A2C54;padding-top:2px}.sig b{display:block;font-weight:500;color:#1B1F2A;font-size:11px;min-height:1.3em}
@media (max-width:640px){.page{margin:0;padding:12px;box-shadow:none}.cols{column-count:1}body{font-size:15px}.r{padding:9px 10px;grid-template-columns:17px 1fr auto 72px}.r i{width:15px;height:15px}
 .info{grid-template-columns:1fr 1fr}.info div:nth-child(odd){border-left:0}.info div:nth-child(n+3){border-top:1px solid #B5AE95}.sig{grid-template-columns:1fr 1fr}header{flex-wrap:wrap}header img{height:9mm}.meta{width:100%;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;text-align:left}.meta b{display:inline}.meta br{display:none}.evs{grid-template-columns:1fr}}
@media print{body{background:#fff}.bar{display:none}}
body.pp{font-size:11.5px}.pp .page{width:192mm;max-width:none;margin:0;padding:0;box-shadow:none}.pp .cols{column-count:2}
.pp .r{grid-template-columns:11px 1fr auto 66px;padding:3px 6px}.pp .r small{font-size:9.5px}.pp .r.done{background:none}
.pp .info{grid-template-columns:1.4fr 1fr .7fr 1fr 1fr}.pp .info div{border-top:0!important;border-left:1px solid #B5AE95}.pp .info div:first-child{border-left:0}.pp .sig{grid-template-columns:repeat(4,1fr)}
</style></head><body>
<div class="bar"><span>Tap an item to tick it off</span><span class="sp"></span><button onclick="window.print()">Print / PDF</button><button class="alt" onclick="window.close()">Close</button></div>
<div class="page" id="pg">
<header><img src="${logo}" alt="Romualdo's"><div class="hd"><div class="tag">${p.ws === 'restaurant' ? 'Restaurant' : 'Catering'} · Purchasing</div><h1>Purchase List</h1></div>
<div class="meta"><b>${esc(p.pr_no)}</b><span class="st">${esc(PR_STATUS[p.status] || p.status)}</span><br>${rows.length} items · printed ${esc(new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }))}</div></header>
<div class="info">${info.map(([l, v]) => `<div><span>${l}</span><b class="${v === 'Urgent' ? 'urg' : l === 'Est. total' ? 'tot' : ''}">${esc(v)}</b></div>`).join('')}</div>
${multi ? `<div class="evs">${evs.map(e => `<div>${tag(e.key)}<span>${esc(e.ref)} · ${esc(e.title)}<small>${esc([e.date ? fmtD(e.date) : '', e.pax].filter(Boolean).join(' · '))}</small></span></div>`).join('')}</div>` : ''}
${rows.length ? `<div class="cols">${body}</div>` : '<p>No items on this request yet.</p>'}
<div class="end"><span>${noPrice ? `${noPrice} item${noPrice > 1 ? 's' : ''} without a price, not in the total` : 'All items priced'}${p.decision_note ? ` · Note: ${esc(p.decision_note)}` : ''}</span><span class="sp"></span><span>Estimated total &nbsp;<b>${peso(total)}</b></span><span>Actual spent ₱ ______________</span></div>
<div class="sig"><div><b>${esc(p.requested_by_name || '')}</b>Requested by</div><div><b>${approved ? esc(p.approved_by_name || '') : ''}</b>Approved by</div><div><b></b>Purchased by · date</div><div><b></b>Received by · date</div></div>
</div><script>
var K='prl-${esc(p.id || p.pr_no)}',done={};try{done=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}
document.querySelectorAll('.r').forEach(function(r){if(done[r.dataset.k])r.classList.add('done');r.onclick=function(){r.classList.toggle('done');done[r.dataset.k]=r.classList.contains('done');try{localStorage.setItem(K,JSON.stringify(done))}catch(e){}}});
var pg=document.getElementById('pg');
function fit(){document.body.classList.add('pp');pg.style.zoom=1;var H=274*96/25.4,h=pg.scrollHeight;pg.style.zoom=h>H?Math.max(.6,(H-4)/h):1}
function unfit(){document.body.classList.remove('pp');pg.style.zoom=1}
window.addEventListener('beforeprint',fit);window.addEventListener('afterprint',unfit);
try{matchMedia('print').addEventListener('change',function(m){m.matches?fit():unfit()})}catch(e){}
if(/[?#]print/.test(location.href))fit();
<\/script></body></html>`;
}
async function saveDraftLines(f, id) {
  const lines = Object.entries(f).filter(([k]) => k.startsWith('q_'));
  for (const [k, v] of lines) { if (num(v) > 0) await db.update('pr_lines', { qty: num(v) }, { id: k.slice(2) }); }
  await db.update('purchase_requests', { purpose: f.purpose || null, needed_by: f.needed_by || null, priority: f.priority || 'normal' }, { id });
}
FORMS.saveDraft = async (f, el) => { await saveDraftLines(f, el.dataset.id); toast('Draft saved'); refresh(); };
FORMS.approvePR = async (f, el) => {
  const q = {}; Object.entries(f).filter(([k]) => k.startsWith('a_')).forEach(([k, v]) => q[k.slice(2)] = num(v));
  await db.rpc('decide_pr', { p_pr: el.dataset.id, p_approve: true, p_note: f.note || null, p_qtys: q }); toast('Approved'); refresh();
};
FORMS.createPO = async (f, el) => {
  const ids = Object.keys(f).filter(k => k.startsWith('o_')).map(k => k.slice(2));
  if (!ids.length) return toast('Tick at least one line.', true);
  const no = await db.rpc('create_po', { p_pr: el.dataset.id, p_supplier_text: f.supplier, p_line_ids: ids, p_advance: f.advance || null });
  toast(`Order ${no} created`); refresh();
};
ACT.rejectPR = async el => {
  const f = formData(el.closest('form')); if (!f.note) return toast('Write the reason for rejecting in the note.', true);
  await db.rpc('decide_pr', { p_pr: el.dataset.id, p_approve: false, p_note: f.note }); toast('Rejected'); refresh();
};
ACT.submitPR = async el => { const f = formData(el.closest('form')); await saveDraftLines(f, el.dataset.id); await db.rpc('submit_pr', { p_pr: el.dataset.id }); toast('Sent for approval'); refresh(); };
ACT.rmLine = async el => { await db.remove('pr_lines', { id: el.dataset.id }); refresh(); };
ACT.addLine = async el => {
  const f = formData(el.closest('form')); const item = itemIdFromName(f.new_item);
  if (!item) return toast('Pick an item from the list.', true); if (!(num(f.new_qty) > 0)) return toast('Enter a quantity.', true);
  await db.upsert('pr_lines', { pr_id: el.dataset.id, item_id: item, qty: num(f.new_qty), est_unit_cost: num(S.itemsById[item]?.last_cost) }, 'pr_id,item_id'); refresh();
};

/* ================= ORDERS & RECEIVING ================= */
routes['c/orders'] = async arg => {
  const tab = arg || 'open', tabs = [['open', 'To receive'], ['received', 'Received'], ['all', 'All']];
  const st = { open: ['open', 'partly_received'], received: ['received', 'closed'] }[tab];
  const rows = await db.select('po_overview', { eq: { ws: WS() }, ...(st ? { in: { status: st } } : {}), order: [['ordered_at', false]], limit: 200 });
  return `<h1>Orders & receiving</h1><div class="seg">${tabs.map(([k, l]) => `<a href="#/${P()}/orders/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${rows.length ? `<div class="list">${rows.map(o => `<a class="li" href="#/${P()}/po/${o.id}"><div class="li-main"><b>${esc(o.po_no)}</b><span class="mut small">${esc(o.supplier || '')} · ${esc(o.pr_no || '')}${o.event_title ? ' · ' + esc(o.event_title) : ''}</span><span class="mut small">${o.line_count} items · bought by ${esc(o.buyer_name || '')} · ${esc(fmtT(o.ordered_at))}${num(o.received_value) ? ' · received ' + peso(o.received_value) : ''}</span></div>${chip(PO_STATUS[o.status], statusTone(o.status))}</a>`).join('')}</div>` : '<div class="empty">Nothing here.</div>'}`;
};
routes['c/po'] = async id => {
  const [o] = await db.select('po_overview', { eq: { id } }); if (!o) return '<div class="card">Order not found.</div>';
  const [lines, receipts] = await Promise.all([db.select('po_line_progress', { eq: { po_id: id } }), db.select('receipts', { eq: { po_id: id }, order: [['received_at', false]] })]);
  const canRecv = ['open', 'partly_received'].includes(o.status) && can(o.ws, 'storekeeper', 'manager', 'chef');
  const people = receipts.length ? Object.fromEntries((await db.select('profiles', { cols: 'id,full_name', in: { id: [...new Set(receipts.map(r => r.received_by))] } })).map(p => [p.id, p.full_name])) : {};
  return `<div class="row"><a href="#/${P()}/orders" class="back">‹ Orders</a></div>
  <div class="row"><h1>${esc(o.po_no)}</h1>${chip(PO_STATUS[o.status], statusTone(o.status))}</div>
  <p class="lede">${esc(o.supplier || '')} · from <a href="#/${P()}/pr/${o.pr_id}">${esc(o.pr_no)}</a>${o.event_id ? ` · <a href="#/c/event/${o.event_id}">${esc(o.event_title)}</a>` : ''} · bought by ${esc(o.buyer_name || '')}</p>
  <form class="card" data-form="${canRecv ? 'receive' : 'none'}" data-id="${id}"><h2>${canRecv ? 'Receive' : 'Items'}</h2>
   ${canRecv ? `<p class="small mut">Weigh or count what actually arrived. Only what you enter goes into the ${STORE()}.${o.buyer === S.user.id ? ' <b class="warn-t">You are the buyer on this order — it will be flagged if you receive it yourself.</b>' : ''}</p>` : ''}
   <div class="tw"><table><thead><tr><th>Item</th><th class="n">Ordered</th><th class="n">Received so far</th>${canRecv ? '<th class="n">Received now</th><th class="n">Actual unit price ₱</th>' : '<th class="n">Unit price</th>'}</tr></thead><tbody>
   ${shopRows(lines, l => l.item_id, l => l.ordered, 5, l => { const left = Math.max(num(l.ordered) - num(l.received), 0); return `<tr><td>${esc(l.name)}</td><td class="n">${fq(l.ordered)} ${esc(l.stock_unit)}${packSplit(l.item_id, l.ordered) ? `<div class="small mut">${esc(packSplit(l.item_id, l.ordered))}</div>` : ''}</td><td class="n ${num(l.received) < num(l.ordered) && o.status !== 'open' ? 'warn-t' : ''}">${fq(l.received)}</td>
     ${canRecv ? `<td class="n"><input name="q_${l.id}" type="number" step="any" min="0" value="${left}" class="qty"></td><td class="n"><input name="c_${l.id}" type="number" step="any" min="0" value="${num(l.unit_cost) || ''}" class="qty" placeholder="price"></td>` : `<td class="n">${peso(l.unit_cost)}</td>`}</tr>`; })}
   </tbody></table></div>
   ${canRecv && o.ws === 'catering' && ((await appCfg()).kitchens || []).length > 1 ? `<label class="mt">Received at<select name="loc">${(CFG.v.kitchens || []).map((k, i) => opt(k.id, k.name, o.event_id ? false : i === 0)).join('')}${o.event_id ? opt('', "The event's kitchen", true) : ''}</select></label>` : ''}
   ${canRecv ? `<div class="grid mt"><label>Official receipt / invoice no.<input name="or_no"></label><label>Note<input name="note" placeholder="e.g. 0.5 kg short, wilted pechay"></label></div><div class="row end"><button class="pri">Receive into store</button></div>` : ''}
  </form>
  ${receipts.length ? `<section class="card"><h2>Receipts</h2><table><tbody>${receipts.map(r => `<tr><td>${esc(fmtT(r.received_at))}<div class="small mut">by ${esc(people[r.received_by] || '')}${r.or_no ? ' · OR ' + esc(r.or_no) : ''}${r.note ? ' · ' + esc(r.note) : ''}</div></td>
     <td>${num(r.short_value) > 0 ? chip('short ' + peso(r.short_value), 'bad') : chip('complete', 'ok')} ${num(r.price_var) ? chip('price ' + (num(r.price_var) > 0 ? '+' : '') + peso(r.price_var), num(r.price_var) > 0 ? 'warn' : 'info') : ''} ${r.same_person ? chip('received by buyer', 'warn') : ''}</td></tr>`).join('')}</tbody></table></section>` : ''}`;
};
FORMS.receive = async (f, el) => {
  const lines = Object.keys(f).filter(k => k.startsWith('q_')).map(k => ({ po_line_id: k.slice(2), qty: num(f[k]), unit_cost: f['c_' + k.slice(2)] === '' ? undefined : num(f['c_' + k.slice(2)]) }));
  if (lines.some(l => l.qty > 0 && !(l.unit_cost > 0))) return toast('Enter the actual unit price for each item received.', true);
  const r = f.loc !== undefined ? await db.rpc('receive_po_at', { p_loc: f.loc || null, p_po: el.dataset.id, p_lines: lines, p_or_no: f.or_no || null, p_note: f.note || null })
    : await db.rpc('receive_po', { p_po: el.dataset.id, p_lines: lines, p_or_no: f.or_no || null, p_note: f.note || null });
  toast(num(r.short_value) > 0 ? `Received — short by ${peso(r.short_value)}` : 'Received into the ' + STORE(), num(r.short_value) > 0);
  await loadMaster(); refresh();
};

/* ================= STOCK & COUNTS ================= */
routes['c/stock'] = async arg => {
  if (arg === 'par') return parView();
  if (arg === 'transfer') return transferView();
  const kits = WS() === 'catering' ? ((await appCfg()).kitchens || []) : [], multi = kits.length > 1;
  const kit = multi && (arg || '').startsWith('k:') ? kits.find(k => k.id === arg.slice(2))?.id || '' : '';
  const [all, counts, byK] = await Promise.all([db.select('stock_on_hand', { eq: { ws: WS() }, order: [['category'], ['name']] }), db.select('stock_counts', { eq: { ws: WS() }, order: [['counted_at', false]], limit: 15 }),
    multi ? db.select('stock_by_kitchen', { order: [['name']] }) : []]);
  const atK = {}; for (const r of byK) (atK[r.item_id] ||= {})[r.loc] = num(r.on_hand);
  const stock = kit ? byK.filter(r => r.loc === kit && Math.abs(num(r.on_hand)) > 0.0005).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) : all;
  const kName = id => kits.find(k => k.id === id)?.name || 'Main kitchen';
  const val = stock.reduce((s, x) => s + Math.max(num(x.value), 0), 0);
  return `<div class="row"><h1>${WS() === 'restaurant' ? 'Restaurant store' : 'Catering store'}</h1><span class="sp"></span><a class="btn ghost" href="#/${P()}/stock/par">Par levels &amp; restock</a>${multi && canTransfer() ? `<a class="btn" href="#/c/stock/transfer">Transfer between kitchens</a>` : ''}${can(WS(), 'storekeeper', 'manager', 'chef') ? `<button class="pri" data-act="startCount"${kit ? ` data-loc="${esc(kit)}"` : ''}>${kit ? 'Count ' + esc(kName(kit)) : 'Start a count'}</button>` : ''}</div>
   ${multi ? `<div class="seg"><a href="#/c/stock" class="${kit ? '' : 'on'}">Both kitchens</a>${kits.map(k => `<a href="#/c/stock/k:${esc(k.id)}" class="${kit === k.id ? 'on' : ''}">${esc(k.name)}</a>`).join('')}</div>` : ''}
   <div class="kpis"><div class="kpi"><span>Items in stock</span><b>${stock.filter(s => num(s.on_hand) > 0).length}</b></div><div class="kpi"><span>Stock value (last prices)</span><b>${peso(val)}</b></div></div>
   <input class="search" placeholder="Search…" data-filter="#stockTable tbody tr">
   ${stock.length ? `<div class="card tw"><table id="stockTable"><thead><tr><th>Item</th>${multi && !kit ? kits.map(k => `<th class="n">${esc(k.name)}</th>`).join('') : ''}<th class="n">${multi && !kit ? 'Total' : 'On hand'}</th><th class="n">Value</th></tr></thead><tbody>
     ${stock.map(s => `<tr><td>${esc(s.name)}<div class="small mut">${esc(s.category)}</div></td>${multi && !kit ? kits.map(k => { const v = atK[s.item_id]?.[k.id] || 0; return `<td class="n ${v < 0 ? 'bad-t' : v ? '' : 'mut'}">${v ? fq(v) : '—'}</td>`; }).join('') : ''}<td class="n ${num(s.on_hand) < 0 ? 'bad-t' : ''}">${fq(s.on_hand)} ${esc(s.stock_unit)}</td><td class="n">${peso(s.value)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">The ${STORE()} is empty. Receive an order or do an opening count.</div>`}
   ${counts.length ? `<h2>Counts</h2><div class="list">${counts.map(c => `<a class="li" href="#/${P()}/count/${c.id}"><div class="li-main"><b>${esc(fmtT(c.counted_at))}${multi ? ' · ' + esc(kName(c.loc)) : ''}</b><span class="mut small">${c.status === 'posted' ? `missing ${peso(Math.abs(num(c.loss_value)))} · excess ${peso(c.gain_value)}` : 'not posted yet'}</span></div>${chip(c.status === 'posted' ? 'Posted' : 'Open', c.status === 'posted' ? (num(c.loss_value) < -1 ? 'bad' : 'ok') : 'warn')}</a>`).join('')}</div>` : ''}`;
};
const canTransfer = () => isAdmin() || can('catering', 'storekeeper', 'manager', 'chef', 'head_chef', 'purchaser');
async function transferView() {
  const kits = (await appCfg()).kitchens || [];
  if (kits.length < 2) return '<div class="card">Add a second kitchen in Delivery settings first.</div>';
  const [byK, hist] = await Promise.all([db.select('stock_by_kitchen', { order: [['category'], ['name']] }), db.rpc('kitchen_transfers', { p_limit: 15 })]);
  const kn = id => kits.find(k => k.id === id)?.name || 'Main kitchen';
  const from = S.trFrom && kits.some(k => k.id === S.trFrom) ? S.trFrom : kits[0].id, to = kits.find(k => k.id !== from).id;
  const here = byK.filter(r => r.loc === from && num(r.on_hand) > 0.0005);
  const cats = [...new Set(here.map(r => r.category))];
  return `<div class="row"><a href="#/c/stock" class="back">‹ Stock</a></div><h1>Transfer between kitchens</h1>
   <p class="lede">Moving ingredients from one kitchen to the other. Each kitchen's stock goes down and up by the same amount; the catering total stays the same.</p>
   ${canTransfer() ? `<form class="card" data-form="transfer">
     <div class="grid"><label>From<select name="from" data-trfrom>${kits.map(k => opt(k.id, k.name, k.id === from)).join('')}</select></label>
       <label>To<select name="to">${kits.filter(k => k.id !== from).map(k => opt(k.id, k.name, k.id === to)).join('')}</select></label></div>
     <input class="search mt" placeholder="Find item…" data-filter=".tr-row">
     ${here.length ? cats.map(c => `<h3>${esc(c)}</h3>${here.filter(r => r.category === c).map(r => `<div class="tr-row mline"><span>${esc(r.name)}<small class="mut"> · ${fq(r.on_hand)} ${esc(r.stock_unit)} here</small></span><span class="sp"></span><input name="q_${r.item_id}" type="number" step="any" min="0" max="${num(r.on_hand)}" class="qty"> <span class="unit">${esc(r.stock_unit)}</span></div>`).join('')}`).join('')
       : `<p class="mut">${esc(kn(from))} has nothing in stock to send.</p>`}
     <div class="grid mt"><label>Received by<input name="received_by" placeholder="Who took it at the other kitchen"></label><label>Note<input name="note" placeholder="e.g. for Santos buffet"></label></div>
     <div class="row end sticky"><button class="pri">Transfer</button></div></form>` : ''}
   <h2>Recent transfers</h2>
   ${hist.length ? `<div class="list">${hist.map(t => `<div class="li"><div class="li-main"><b>${esc(kn(t.from_loc))} → ${esc(kn(t.to_loc))} · ${t.items} item${t.items > 1 ? 's' : ''}${num(t.value) ? ' · ' + peso(t.value) : ''}</b>
     <span class="mut small">${esc(fmtT(t.at))}${t.who ? ' · by ' + esc(t.who) : ''}${(t.note || '').includes('received by') ? ' · ' + esc(t.note.split(' · ').filter(x => x.startsWith('received by')).join('')) : ''}</span>
     <span class="small">${(t.lines || []).map(l => `${esc(l.name)} ${fq(l.qty)} ${esc(l.unit)}`).join(' · ')}</span></div></div>`).join('')}</div>` : '<p class="mut small">No transfers yet.</p>'}`;
}
document.addEventListener('change', e => { if (e.target.matches('[data-trfrom]')) { S.trFrom = e.target.value; refresh(); } });
FORMS.transfer = async f => {
  const lines = Object.entries(f).filter(([k, v]) => k.startsWith('q_') && num(v) > 0).map(([k, v]) => ({ item_id: k.slice(2), qty: num(v) }));
  if (!lines.length) return toast('Enter how much of at least one item.', true);
  const r = await db.rpc('kitchen_transfer', { p_from: f.from, p_to: f.to, p_lines: lines, p_received_by: f.received_by || null, p_note: f.note || null });
  toast(r.short ? `Transferred. More than recorded was sent of: ${r.short}. Count that kitchen soon.` : `${r.items} item${r.items > 1 ? 's' : ''} transferred`, !!r.short); refresh();
};
ACT.startCount = async el => {
  let loc = el.dataset.loc || null;
  if (!loc && WS() === 'catering') { const kits = (await appCfg()).kitchens || []; if (kits.length > 1) return toast('Open one kitchen first (the tabs above), then count it.', true); }
  const c = (await db.insert('stock_counts', { ws: WS(), counted_by: S.user.id, ...(loc ? { loc } : {}) }))[0]; go(`#/${P()}/count/${c.id}`);
};
routes['c/count'] = async id => {
  if (!id) { location.hash = '#/' + P() + '/stock'; return ''; }
  const [c] = await db.select('stock_counts', { eq: { id } }); if (!c) return '<div class="card">Count not found.</div>';
  const lines = await db.select('stock_count_lines', { eq: { count_id: id } }); const got = Object.fromEntries(lines.map(l => [l.item_id, l]));
  if (c.status === 'posted') {
    const diff = lines.map(l => ({ ...l, d: num(l.counted) - num(l.expected) })).filter(l => Math.abs(l.d) > 0.0005).sort((a, b) => a.d * num(S.itemsById[a.item_id]?.last_cost) - b.d * num(S.itemsById[b.item_id]?.last_cost));
    return `<div class="row"><a href="#/${P()}/stock" class="back">‹ Stock</a></div><h1>Count · ${esc(fmtT(c.counted_at))}</h1>
     <div class="kpis"><div class="kpi bad"><span>Missing</span><b>${peso(Math.abs(num(c.loss_value)))}</b></div><div class="kpi"><span>Excess</span><b>${peso(c.gain_value)}</b></div><div class="kpi"><span>Items counted</span><b>${lines.length}</b></div></div>
     ${diff.length ? `<div class="card tw"><table><thead><tr><th>Item</th><th class="n">Expected</th><th class="n">Counted</th><th class="n">Difference</th></tr></thead><tbody>${diff.map(l => `<tr><td>${esc(itemName(l.item_id))}</td><td class="n">${fq(l.expected)}</td><td class="n">${fq(l.counted)}</td><td class="n ${l.d < 0 ? 'bad-t' : 'ok-t'}">${l.d > 0 ? '+' : ''}${fq(l.d)} ${esc(itemUnit(l.item_id))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="alert ok">Everything matched.</div>'}
     <p class="small mut">Missing stock left the store without an issue or waste record. Recount big differences and ask who had access.</p>`;
  }
  const cats = [...new Set(S.items.map(i => i.category))], kc = c.loc ? ((await appCfg()).kitchens || []).find(k => k.id === c.loc) : null;
  return `<div class="row"><a href="#/${P()}/stock" class="back">‹ Stock</a></div><h1>Count ${kc ? esc(kc.name) : 'the ' + STORE()}</h1>
   <p class="lede">Count what is physically on the shelves, chiller and freezer. Expected quantities are hidden so nobody copies them. Leave items you didn't count blank.</p>
   <form class="card" data-form="saveCount" data-id="${id}"><label>Witness<input name="witness" value="${esc(c.witness || '')}" placeholder="Second person present"></label>
   <input class="search mt" placeholder="Find item…" data-filter=".count-row">
   ${cats.map(cat => `<h3>${esc(cat)}</h3>${S.items.filter(i => i.category === cat).map(i => `<div class="count-row mline"><span>${esc(i.name)}</span><span class="sp"></span><input name="n_${i.id}" type="number" step="any" min="0" class="qty" value="${got[i.id] ? num(got[i.id].counted) : ''}"> <span class="unit">${esc(i.stock_unit)}</span></div>`).join('')}`).join('')}
   <div class="row end sticky"><button class="ghost">Save</button><button type="button" class="pri" data-act="postCount" data-id="${id}">Post count</button></div></form>`;
};
async function saveCount(f, id) {
  const rows = Object.entries(f).filter(([k, v]) => k.startsWith('n_') && v !== '').map(([k, v]) => ({ count_id: id, item_id: k.slice(2), counted: num(v) }));
  if (rows.length) await db.upsert('stock_count_lines', rows, 'count_id,item_id');
  if (f.witness) await db.update('stock_counts', { witness: f.witness }, { id });
  return rows.length;
}
FORMS.saveCount = async (f, el) => { const n = await saveCount(f, el.dataset.id); toast(`${n} items saved`); };
ACT.postCount = async el => {
  const f = formData(el.closest('form')); const n = await saveCount(f, el.dataset.id);
  if (!n) return toast('Enter at least one counted quantity.', true);
  if (!confirm(`Post the count of ${n} items? Differences become stock adjustments and can't be undone.`)) return;
  const r = await db.rpc('post_count', { p_count: el.dataset.id }); toast(`Posted · missing ${peso(Math.abs(num(r.loss_value)))}`, num(r.loss_value) < -1); refresh();
};

/* ================= RECIPES ================= */
// Dishes grouped the way a menu reads: by course, Main split by meat, A–Z inside each group
const MAIN_ORDER = ['Chicken', 'Pork', 'Beef', 'Seafood', 'Vegetables'];
function dishGroups(list) {
  const key = d => d.course === 'Main' ? `Main · ${d.category}` : d.course;
  const rank = d => { const c = COURSES.indexOf(d.course); const m = d.course === 'Main' ? (MAIN_ORDER.indexOf(d.category) + 1 || 9) : 0; return (c < 0 ? 99 : c) * 10 + m; };
  const g = new Map();
  [...list].sort((a, b) => rank(a) - rank(b) || (a.course === 'Main' ? a.category.localeCompare(b.category) : 0) || a.name.localeCompare(b.name)).forEach(d => { const k = key(d); g.has(k) || g.set(k, []); g.get(k).push(d); });
  return [...g];
}
/* ================= Recipes → Clean-up: duplicates, unused and archived dishes and ingredients ================= */
// Spelling key that treats common variants as the same: Kalamansi/Calamansi, Lechon/Litson, double letters, plurals
const looseKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\b(the|and|at|sa|na|ng|with|w)\b/g, ' ').replace(/k/g, 'c').replace(/ph/g, 'f').replace(/z/g, 's').replace(/(.)\1+/g, '$1')
  .split(/\s+/).filter(Boolean).map(w => w.length > 3 ? w.replace(/(es|s)$/, '') : w);
function likelyPairs(list, name) {   // pairs of rows whose names are the same, or one is the other plus extra words
  const keys = list.map(x => ({ x, w: looseKey(name(x)) })).filter(k => k.w.length), out = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j], A = new Set(a.w), B = new Set(b.w), common = [...A].filter(w => B.has(w)).length;
    const same = a.w.join(' ') === b.w.join(' '), sub = common >= 2 && common === Math.min(A.size, B.size), close = common / Math.max(A.size, B.size) >= .75 && common >= 2;
    if (same || sub || close) out.push([a.x, b.x, same]);
  }
  return out.sort((p, q) => (q[2] - p[2]) || name(p[0]).localeCompare(name(q[0])));
}
// Pairs → groups: Beef Broccoli / Beef with Brocolli / Beef with Broccoli are one card, not three
function likelyGroups(list, name, skip) {
  const par = new Map(list.map(x => [x.id, x.id])), find = a => par.get(a) === a ? a : (par.set(a, find(par.get(a))), par.get(a));
  likelyPairs(list, name).filter(([a, b]) => !skip.has([a.id, b.id].sort().join('|'))).forEach(([a, b]) => par.set(find(a.id), find(b.id)));
  const g = new Map(); list.forEach(x => { const r = find(x.id); g.has(r) || g.set(r, []); g.get(r).push(x); });
  return [...g.values()].filter(x => x.length > 1);
}
const CLEAN_SKIP = () => { try { return JSON.parse(localStorage.getItem('rom-clean-skip') || '[]'); } catch (e) { return []; } };
async function cleanupHtml() {
  if (!canEditMenu()) return '<div class="card">Clean-up is for managers and chefs.</div>';
  const [rs, rl, rm, oldItems] = await Promise.all([db.select('recipes', { cols: 'dish_id,status' }), db.select('recipe_lines', { cols: 'dish_id,item_id' }),
    db.select('restaurant_menu', { cols: 'dish_id,on_pos,price' }).catch(() => []), db.select('items', { cols: 'id,name,category,stock_unit', eq: { active: false }, order: [['name']] })]);
  const rec = Object.fromEntries(rs.map(r => [r.dish_id, r])), nLines = {}, uses = {}, pos = Object.fromEntries(rm.map(r => [r.dish_id, r]));
  rl.forEach(l => { nLines[l.dish_id] = (nLines[l.dish_id] || 0) + 1; uses[l.item_id] = (uses[l.item_id] || 0) + 1; });
  const skip = new Set(CLEAN_SKIP()), pk = (a, b) => [a.id, b.id].sort().join('|');
  const live = S.dishes.filter(d => d.active), archived = S.dishes.filter(d => !d.active);
  const where = d => [d.sold_as?.includes('restaurant') && pos[d.id]?.on_pos ? `POS ₱${fq(pos[d.id].price ?? 0)}` : d.sold_as?.includes('restaurant') ? 'restaurant' : '', cateringDish(d) ? (d.tray_price ? `catering tray ${peso(d.tray_price).replace('.00', '')}` : 'catering') : '',
    `chosen ${d.times_booked}×`, rec[d.id] ? `recipe: ${nLines[d.id] || 0} ingredients${rec[d.id].status === 'verified' ? ' ✓' : ''}` : 'no recipe'].filter(Boolean).join(' · ');
  // the one to keep: most used, has a recipe, a price, on the POS — then the shorter, plainer name
  const dScore = d => d.times_booked * 100 + (nLines[d.id] || 0) * 10 + (rec[d.id]?.status === 'verified' ? 50 : 0) + (pos[d.id] ? 40 : 0) + (d.tray_price ? 20 : 0) - d.name.length / 100;
  const iScore = i => (uses[i.id] || 0) * 10 + (num(i.last_cost) ? 5 : 0) + (/^others?$/i.test(i.category) ? 0 : 2) - i.name.length / 100;
  const dGroups = likelyGroups(live, d => d.name, skip).map(g => g.sort((a, b) => dScore(b) - dScore(a))).sort((a, b) => a[0].name.localeCompare(b[0].name));
  const iGroups = likelyGroups(S.items, i => i.name, skip).map(g => g.sort((a, b) => iScore(b) - iScore(a))).sort((a, b) => a[0].name.localeCompare(b[0].name));
  const gIds = g => g.map(x => x.id).join(','), gNames = g => g.map(x => x.name).join('|');
  const unusedDish = live.filter(d => !d.times_booked && !rec[d.id] && !pos[d.id] && !d.sold_as?.includes('restaurant'));   // restaurant dishes are on the POS menu
  const unusedItem = S.items.filter(i => !uses[i.id]);
  const noPrice = S.items.filter(i => uses[i.id] && !num(i.last_cost)), noCat = S.items.filter(i => /^others?$/i.test(i.category || ''));
  const dishCard = (d, g, i) => `<div class="cu-side${i === 0 ? ' best' : ''}">${i === 0 ? '<em class="cu-best">Suggested</em>' : ''}<a href="#/c/recipe/${d.id}"><b>${esc(d.name)}</b></a><small>${esc(d.category)} · ${esc(d.course)} · ${esc(where(d))}</small>
    <div class="cu-acts"><button type="button" class="${i === 0 ? 'pri' : 'ghost'} sm" data-act="mergeDish" data-into="${d.id}" data-ids="${gIds(g)}" data-names="${esc(gNames(g))}" title="Merge the others into this one">Keep this one</button>
    <button type="button" class="lnk" data-act="cleanSkip" data-k="${esc(g.filter(o => o.id !== d.id).map(o => [d.id, o.id].sort().join('|')).join(','))}" title="This dish is different from the others">Not a duplicate</button><button type="button" class="lnk bad-t" data-act="delDish" data-id="${d.id}" data-name="${esc(d.name)}" title="Delete this dish">Delete</button></div></div>`;
  const itemCard = (it, g, i) => { const odd = g.some(o => normName(o.stock_unit) !== normName(it.stock_unit));
    return `<div class="cu-side${i === 0 ? ' best' : ''}">${i === 0 ? '<em class="cu-best">Suggested</em>' : ''}<b>${esc(it.name)}</b><small>${esc(it.category)} · per ${esc(it.stock_unit)} · ${num(it.last_cost) ? peso(it.last_cost) : 'no price'} · in ${uses[it.id] || 0} recipe${uses[it.id] === 1 ? '' : 's'}</small>
    <div class="cu-acts">${odd ? '<small class="warn-t">Units differ in this group — set them all to the same unit first (✎ on a recipe page)</small>' : `<button type="button" class="${i === 0 ? 'pri' : 'ghost'} sm" data-act="mergeItem" data-into="${it.id}" data-ids="${gIds(g)}" data-names="${esc(gNames(g))}" title="Merge the others into this one">Keep this one</button>`}
    <button type="button" class="lnk" data-act="cleanSkip" data-k="${esc(g.filter(o => o.id !== it.id).map(o => [it.id, o.id].sort().join('|')).join(','))}" title="This ingredient is different from the others">Not a duplicate</button><button type="button" class="lnk bad-t" data-act="delItem" data-id="${it.id}" data-name="${esc(it.name)}" title="Delete this ingredient">Delete</button></div></div>`; };
  const groupBox = (g, card) => `<div class="cu-group"><div class="cu-row">${g.map((x, i) => card(x, g, i)).join('')}</div><button type="button" class="x cu-skip" title="None of these are the same" data-act="cleanSkip" data-k="${esc(g.map((a, i) => g.slice(i + 1).map(b => [a.id, b.id].sort().join('|'))).flat().join(','))}" title="They're different">None are the same</button></div>`;
  const sec = (title, n, help, body, open) => `<details class="card cu"${open ? ' open' : ''}><summary><h2>${title}</h2><span class="chip ${n ? 'warn' : 'ok'}">${n || '✓ none'}</span></summary><p class="small mut">${help}</p>${n ? body : ''}</details>`;
  return `${sec('Possible duplicate dishes', dGroups.length, 'Same dish under two names, often one from the catering tray menu and one from the restaurant menu. <b>Keep this one</b> moves events, POS sales, kitchen counts, the recipe and the menu listing to the dish you keep, and the other name keeps working. If they really are different dishes, tap <b>Not the same</b>. The <b>Suggested</b> one is the most used (events, recipe, POS, tray price).',
      `<div class="cu-list">${dGroups.map(g => groupBox(g, dishCard)).join('')}</div>`, true)}
   ${sec('Possible duplicate ingredients', iGroups.length, 'Two spellings of one ingredient (Kalamansi / Calamansi) split the shopping list and the stock count. Merging moves recipes, stock, requests and orders to the one kept; amounts in the same recipe are added together. Both must use the same unit.',
      `<div class="cu-list">${iGroups.map(g => groupBox(g, itemCard)).join('')}</div>`, true)}
   ${sec('Dishes never used', unusedDish.length, 'Catering dishes never on an event and with no recipe: usually typos or old menu items. (Restaurant dishes are managed from the POS menu.) <b>Delete</b> removes them for good; <b>Archive</b> just hides them.',
      `<div class="list">${unusedDish.map(d => `<div class="li"><div class="li-main"><a href="#/c/recipe/${d.id}"><b>${esc(d.name)}</b></a><span class="mut small">${esc(d.category)} · ${esc(d.course)}</span></div><button type="button" class="ghost sm" data-act="archDish" data-id="${d.id}" data-on="1">Archive</button><button type="button" class="ghost sm danger" data-act="delDish" data-id="${d.id}" data-name="${esc(d.name)}">Delete</button></div>`).join('')}</div>`)}
   ${sec('Ingredients not in any recipe', unusedItem.length, 'Not used by any recipe. Some are fine (bought for the store only). Delete works only if it was never bought or counted; otherwise it is archived instead.',
      `<div class="list">${unusedItem.map(i => `<div class="li"><div class="li-main"><b>${esc(i.name)}</b><span class="mut small">${esc(i.category)} · per ${esc(i.stock_unit)}${num(i.last_cost) ? ' · ' + peso(i.last_cost) : ''}</span></div><button type="button" class="ghost sm danger" data-act="delItem" data-id="${i.id}" data-name="${esc(i.name)}">Delete</button></div>`).join('')}</div>`)}
   ${sec('Ingredients with no price', noPrice.length, 'Used in recipes but priced at ₱0, so recipe costs and purchase estimates come out low. Open a recipe that uses them and type the price in the table.',
      `<div class="cu-tags">${noPrice.map(i => `<span class="chip">${esc(i.name)} · ${esc(i.stock_unit)}</span>`).join('')}</div>`)}
   ${sec('Ingredients with no category', noCat.length, 'Category "Other" puts them at the end of purchase lists instead of with the market or grocery items. Set it with ✎ on any recipe that uses them.',
      `<div class="cu-tags">${noCat.map(i => `<span class="chip">${esc(i.name)}</span>`).join('')}</div>`)}
   ${sec('Archived (off the menu)', archived.length + oldItems.length, 'Dishes and ingredients taken off the menu. Their history stays; restore them if they come back.',
      `<div class="list">${archived.map(d => `<div class="li"><div class="li-main"><b>${esc(d.name)}</b><span class="mut small">dish · ${esc(d.category)}</span></div><button type="button" class="ghost sm" data-act="archDish" data-id="${d.id}" data-on="0">Restore</button></div>`).join('')}
       ${oldItems.map(i => `<div class="li"><div class="li-main"><b>${esc(i.name)}</b><span class="mut small">ingredient · ${esc(i.category)} · ${esc(i.stock_unit)}</span></div><button type="button" class="ghost sm" data-act="restoreItem" data-id="${i.id}">Restore</button></div>`).join('')}</div>`)}`;
}
const canEditMenu = () => canAny('head_chef', 'rnd_chef');
const canSeeCost = () => canAny('head_chef', 'rnd_chef', 'finance');   // ingredient costs, recipe costs, Costing tab
const needsUpdate = err => /merge_dishes|delete_dish|archive_dish|merge_items|delete_item|function/i.test(err.message || '') && /find|exist|schema cache/i.test(err.message || '');
async function cleanRun(fn, args, ok) {
  try { const r = await db.rpc(fn, args); await loadMaster(); toast(ok(r)); refresh(); }
  catch (err) { toast(needsUpdate(err) ? 'Clean-up needs the latest database update — ask the owner to run it.' : err.message, true); }
}
async function mergeGroup(el, fn, what) {
  const ids = el.dataset.ids.split(','), names = el.dataset.names.split('|'), into = el.dataset.into, keep = names[ids.indexOf(into)];
  const others = ids.map((id, i) => [id, names[i]]).filter(([id]) => id !== into);
  if (!confirm(`Keep "${keep}" and merge ${others.map(o => `"${o[1]}"`).join(', ')} into it?\n\n${what(keep)}\n\nThis can't be undone.`)) return;
  let n = 0;
  try { for (const [id] of others) { await db.rpc(fn, { p_from: id, p_into: into }); n++; } toast(`${n} merged into ${keep}`); }
  catch (err) { toast(needsUpdate(err) ? 'Clean-up needs the latest database update — ask the owner to run it.' : (n ? `${n} merged; then: ` : '') + err.message, true); }
  await loadMaster(); refresh();
}
ACT.mergeDish = el => mergeGroup(el, 'merge_dishes', k => `Events, POS sales, kitchen counts, recipes and menu listings move to "${k}". The other names still work when typed.`);
ACT.mergeItem = el => mergeGroup(el, 'merge_items', k => `Recipes, stock, requests and orders move to "${k}"; amounts in the same recipe are added together.`);
ACT.delDish = async el => {
  if (!confirm(`Delete "${el.dataset.name}" for good?`)) return;
  try { await db.rpc('delete_dish', { p_dish: el.dataset.id }); await loadMaster(); toast(`${el.dataset.name} deleted`); current === 'c/recipe' ? go('#/c/recipes') : refresh(); }
  catch (err) {
    if (needsUpdate(err)) return toast('Clean-up needs the latest database update — ask the owner to run it.', true);
    if (/archive it instead/i.test(err.message) && confirm(`"${el.dataset.name}" can't be deleted: it's on the restaurant menu or was used on events, POS sales or kitchen counts.\n\nTake it off the menu (archive) instead? Its history is kept.`)) {
      await db.rpc('archive_dish', { p_dish: el.dataset.id, p_archive: true }); await loadMaster(); toast(`${el.dataset.name} archived`); refresh(); }
    else if (!/archive it instead/i.test(err.message)) toast(err.message, true);
  }
};
ACT.archDish = el => cleanRun('archive_dish', { p_dish: el.dataset.id, p_archive: el.dataset.on === '1' }, () => el.dataset.on === '1' ? 'Archived — off the POS and new menus' : 'Restored');
ACT.delItem = async el => {
  if (!confirm(`Delete "${el.dataset.name}" from the ingredient list?`)) return;
  try { await db.rpc('delete_item', { p_item: el.dataset.id }); await loadMaster(); toast(`${el.dataset.name} deleted`); refresh(); }
  catch (err) {
    if (needsUpdate(err)) return toast('Clean-up needs the latest database update — ask the owner to run it.', true);
    if (/history/i.test(err.message) && confirm(`${err.message}\n\nArchive "${el.dataset.name}" now?`)) { await db.update('items', { active: false }, { id: el.dataset.id }); await loadMaster(); toast('Archived'); refresh(); }
    else if (!/history/i.test(err.message)) toast(err.message, true);
  }
};
ACT.restoreItem = async el => { await db.update('items', { active: true }, { id: el.dataset.id }); await loadMaster(); toast('Restored'); refresh(); };
ACT.cleanSkip = el => { const s = CLEAN_SKIP(); s.push(...el.dataset.k.split(',')); try { localStorage.setItem('rom-clean-skip', JSON.stringify(s)); } catch (e) {} refresh(); };

routes['c/recipes'] = async arg => {
  const tab = arg || 'standard';
  const [rs, rl] = await Promise.all([db.select('recipes', { cols: 'dish_id,status,batch_serves' }), db.select('recipe_lines', { cols: 'dish_id,item_id,qty' })]);
  const recipes = Object.fromEntries(rs.map(r => [r.dish_id, r]));
  const costOf = {}; rl.forEach(l => costOf[l.dish_id] = (costOf[l.dish_id] || 0) + num(l.qty) * num(S.itemsById[l.item_id]?.last_cost));
  const costTag = d => { const r = recipes[d.id]; if (!r || !costOf[d.id] || !canSeeCost()) return ''; const c = costOf[d.id], pct = d.tray_price && num(r.batch_serves) > 1 ? Math.round(c / num(d.tray_price) * 100) : null;
    return ` · cost ${peso(c)}${pct !== null ? ` · <span class="${pct > 45 ? 'bad-t' : pct > 35 ? 'warn-t' : 'ok-t'}">${pct}%</span>` : ''}`; };
  const tabs = [['standard', 'Standard list'], ['draft', 'Draft recipes'], ['verified', 'Verified'], ['none', 'No recipe'], ['all', 'All dishes'], ...(canSeeCost() ? [['costing', 'Costing']] : []), ...(canEditMenu() ? [['cleanup', 'Clean-up']] : [])];
  const list = S.dishes.filter(d => d.active).filter(d => tab === 'all' || (tab === 'standard' ? d.standard : tab === 'none' ? !recipes[d.id] && d.standard : recipes[d.id]?.status === tab));
  return `<h1>Dishes & recipes</h1><p class="lede">A dish's recipe lists what to buy for one batch: one large tray (10–12 guests, planned at 10), or one guest for rice, drinks and fruit. Only <b>verified</b> recipes are used for purchase requests.</p>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/recipes/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${tab === 'cleanup' ? await cleanupHtml() : tab === 'costing' ? costingTab(recipes, rl) : `<input class="search" placeholder="Search dishes…" data-filter=".dgroup .li">
   ${(g => g.length > 2 ? `<div class="jump">${g.map(([head], i) => `<button type="button" data-jump="g${i}">${esc(head.replace('Main · ', ''))}</button>`).join('')}</div>` : '')(dishGroups(list))}
   ${dishGroups(list).map(([head, ds], i) => `<section class="dgroup" data-group id="g${i}"><h3>${esc(head)} <span class="cnt">${ds.length}</span></h3><div class="list">${ds.map(d => `<a class="li" href="#/c/recipe/${d.id}"><div class="li-main"><b>${esc(d.name)}</b><span class="mut small">chosen ${d.times_booked}×${d.tray_price ? ' · tray ' + peso(d.tray_price) : ''}${costTag(d)}</span></div>${recipes[d.id] ? chip(recipes[d.id].status === 'verified' ? 'Verified' : 'Draft', recipes[d.id].status === 'verified' ? 'ok' : 'warn') : chip('No recipe', 'mut')}</a>`).join('')}</div></section>`).join('') || '<div class="empty">None.</div>'}`}`;
};
// Recipe order, the way recipes are written: main item (protein, or the pasta/noodles/rice the dish is built on),
// then supporting ingredients, then sauces, seasonings and oil — salt and pepper last
const RECIPE_HEADS = ['Main', 'Supporting ingredients', 'Sauces, seasonings & others'];
const SUPPORT_PANTRY = /tomato sauce|coconut milk|liver spread|pineapple|peanut butter|mayonnaise|gulaman|anchov|peanuts|condensed|evaporated/i;
function recipeRank(itemId) {
  const it = S.itemsById[itemId] || {}, c = it.category || '', n = it.name || '';
  if (['Poultry', 'Beef', 'Pork', 'Seafood', 'Processed meat', 'Beverages'].includes(c) || c === 'Rice & grains' || /pasta|spaghetti|penne|lasagna|noodles|bihon|sotanghon/i.test(n)) return 0;
  if (['Condiments & spices', 'Oil & fats'].includes(c) || (c === 'Pantry' && !SUPPORT_PANTRY.test(n))) return 2;
  return 1;
}
const isToTaste = itemId => /^(salt|black pepper|whole peppercorns)/i.test(S.itemsById[itemId]?.name || '') ? 1 : 0;
// Recipe cost line: total, per guest, share of tray price (with a warning colour when the margin is thin)
function recipeTotalText(cost, tray, serves) {
  const pct = tray > HOUSE.trayCost ? Math.round(cost / (tray - HOUSE.trayCost) * 100) : null;   // food part of the tray price
  return `Ingredient cost per batch <b>${peso(cost)}</b> · ${peso(cost / (serves || 1))} per guest${pct !== null ? ` · <span class="${fcTone(pct)}">${pct}% of the tray price</span>` : ''}`;
}
// Live recompute while quantities are typed; each change is saved on its own
document.addEventListener('input', e => {
  const m = /^q_(.+)$/.exec(e.target.name || ''); if (!m || !e.target.closest('form[data-form="saveRecipe"]')) return;
  const cell = document.querySelector(`[data-linecost="${m[1]}"]`); if (!cell) return;
  const price = num(cell.dataset.price); if (price) cell.textContent = peso(num(e.target.value) * price);
  let total = 0; document.querySelectorAll('[data-linecost]').forEach(c => { const q = document.querySelector(`[name="q_${c.dataset.linecost}"]`); total += num(q?.value) * num(c.dataset.price); });
  const t = $('#recipeTotal'); if (t) t.innerHTML = recipeTotalText(total, num(t.dataset.tray), num(t.dataset.serves));
});
document.addEventListener('change', async e => {
  const m = /^q_(.+)$/.exec(e.target.name || ''); const form = e.target.closest('form[data-form="saveRecipe"]'); if (!m || !form) return;
  if (num(e.target.value) < 0) return toast('Quantity cannot be negative (use ✕ to remove an ingredient).', true);
  try { await db.update('recipe_lines', { qty: num(e.target.value) }, { dish_id: form.dataset.id, item_id: m[1] }); toast(num(e.target.value) ? 'Saved' : 'Saved — quantity still to fill in'); } catch (err) { toast(qtyErr(err), true); }
});
routes['c/recipe'] = async id => {
  const d = S.dishById[id]; if (!d) return '<div class="card">Dish not found.</div>';
  const [[r], lines] = await Promise.all([db.select('recipes', { eq: { dish_id: id } }), db.select('recipe_lines', { eq: { dish_id: id } })]);
  const edit = canAny('head_chef', 'rnd_chef'), sc = edit || canSeeCost();   // sc: may see ingredient prices and costs
  const cost = lines.reduce((s, l) => s + num(l.qty) * num(S.itemsById[l.item_id]?.last_cost), 0);
  // No meat, pasta or rice (desserts, soups, salads)? The ingredient named in the dish is the main one — Buko Pandan → buko
  const words = d.name.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
  const named = itemId => { const n = (S.itemsById[itemId]?.name || '').toLowerCase(); return words.some(w => n.includes(w)); };
  const noMain = !lines.some(l => recipeRank(l.item_id) === 0);
  const rank0 = recipeRank; const recipeRankD = itemId => noMain && named(itemId) ? 0 : rank0(itemId);
  lines.sort((a, b) => recipeRankD(a.item_id) - recipeRankD(b.item_id) || (isToTaste(a.item_id) - isToTaste(b.item_id)) || num(b.qty) - num(a.qty) || itemName(a.item_id).localeCompare(itemName(b.item_id)));
  let lastG = -1; const head = itemId => { const g = recipeRankD(itemId); if (g === lastG) return ''; lastG = g; return `<tr class="grp"><td colspan="5">${g === 1 && !lines.some(l => recipeRankD(l.item_id) === 0) ? 'Ingredients' : RECIPE_HEADS[g]}</td></tr>`; };
  const batchSel = (cur) => `<select name="serves" data-recipeserves="${id}" aria-label="One batch is for">${opt('10', 'one large tray (10–12 guests)', String(cur) === '10')}${opt('1', 'one guest (rice, drinks, fruit)', String(cur) === '1')}${cur && !['1', '10'].includes(String(cur)) ? opt(String(cur), `one batch (${fq(cur)} guests)`, true) : ''}</select>`;
  const serves = r ? num(r.batch_serves) : 10, trayP = d.tray_price && serves > 1 ? num(d.tray_price) : 0;
  const DISH_CATS = [...new Set(['Chicken', 'Pork', 'Beef', 'Seafood', 'Vegetables', 'Pasta & noodles', 'Salads', 'Soup', 'Rice', 'Desserts', 'Drinks', ...Object.values(S.dishById).map(x => x.category)])];
  return `<div class="row"><a href="#/c/recipes" class="back">‹ Dishes</a></div>
  <div class="row"><h1>${esc(d.name)}</h1>${r ? chip(r.status === 'verified' ? 'Verified' : 'Draft', r.status === 'verified' ? 'ok' : 'warn') : chip('No recipe yet', 'mut')}${d.active ? '' : ' ' + chip('Archived', 'bad')}<span class="sp"></span>${canEditDish() ? `<button type="button" class="ghost" data-act="toggleDishEdit">✎ Edit dish</button>` : ''}</div>
  <p class="lede">${esc(d.category)} · ${esc(d.course)}${d.tier ? ` · ${TIER_LBL[d.tier]}` : ''} · chosen ${d.times_booked}× ${d.tray_price ? '· tray price ' + peso(d.tray_price) : ''}</p>
  ${canEditDish() ? `<form class="card" data-form="editDish" data-id="${id}" id="dishEdit" hidden><h2>Dish details</h2><div class="grid">
    <label>Dish name<input name="name" value="${esc(d.name)}" required data-cap></label>
    <label>Category<input name="category" list="dl-dishcats" value="${esc(d.category)}" required></label>
    <label>Course on the event sheet<select name="course">${COURSES.map(c => opt(c, c, c === d.course)).join('')}</select></label>
    <label>Tray price ₱<input name="tray_price" type="number" step="any" min="0" value="${d.tray_price ?? ''}" placeholder="not sold by the tray"></label>
    ${'tier' in d ? `<label>Package menu<select name="tier">${opt('', '— not on a package menu', !d.tier)}${opt('standard', 'Standard selection', d.tier === 'standard')}${opt('premium', 'Premium selection', d.tier === 'premium')}${opt('both', 'Both selections', d.tier === 'both')}</select></label>` : ''}</div>
    <datalist id="dl-dishcats">${DISH_CATS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <p class="small mut">The new name shows everywhere this dish is used: event menus, the POS, Kitchen stocks and purchase requests.</p>
    <div class="row end">${canEditMenu() ? `<button type="button" class="ghost danger" data-act="archDish" data-id="${id}" data-on="${d.active ? 1 : 0}" title="${d.active ? 'Hide from the POS and new event menus; history is kept' : ''}">${d.active ? 'Take off the menu' : 'Put back on the menu'}</button><button type="button" class="ghost danger" data-act="delDish" data-id="${id}" data-name="${esc(d.name)}">Delete dish</button><span class="sp"></span>` : ''}<button type="button" class="ghost" data-act="toggleDishEdit">Cancel</button><button class="pri">Save dish</button></div></form>` : ''}
  ${!edit && !r ? '<div class="card">No recipe yet. The head chef or R&D chef can add it.</div>' : `
  <form class="card" data-form="${edit ? 'saveRecipe' : 'none'}" data-id="${id}">
   <div class="row rhead"><h2>Ingredients for</h2>${edit ? batchSel(serves) : `<b>${serves === 1 ? 'one guest' : serves === 10 ? 'one tray (10–12 guests)' : `one batch (${fq(serves)} guests)`}</b>`}</div>
   ${lines.length ? `<div class="tw"><table class="rtable"><thead><tr><th>Ingredient</th><th class="n">Qty</th>${sc ? '<th class="n">Price per unit</th><th class="n">Cost</th>' : ''}${edit ? '<th></th>' : ''}</tr></thead><tbody>
   ${lines.map(l => { const it = S.itemsById[l.item_id] || {}, u = esc(itemUnit(l.item_id)); return `${head(l.item_id)}<tr><td>${esc(itemName(l.item_id))}</td>
     <td class="n nowrap">${edit ? `<input name="q_${l.item_id}" type="number" step="any" min="0" value="${num(l.qty) || ''}" placeholder="qty?" class="qty${num(l.qty) ? '' : ' need'}">` : num(l.qty) ? fq(l.qty) : '<span class="warn-t small">qty?</span>'} ${u}</td>
     ${sc ? `<td class="n nowrap">${edit ? `₱<input name="p_${l.item_id}" type="number" step="any" min="0" value="${num(it.last_cost) || ''}" placeholder="—" class="qty price" title="Price per ${u}: changes it for every recipe using ${esc(it.name || '')}"> /${u}` : num(it.last_cost) ? `${peso(it.last_cost)} /${u}` : '<span class="mut small">no price</span>'}</td>
     <td class="n" data-linecost="${l.item_id}" data-price="${num(it.last_cost)}" data-qty="${num(l.qty)}">${num(it.last_cost) && num(l.qty) ? peso(num(l.qty) * num(it.last_cost)) : '<span class="mut small">—</span>'}</td>` : ''}${edit ? `<td class="nowrap"><button type="button" class="x" title="Rename, change unit, or replace" data-act="editIng" data-item="${l.item_id}">✎</button><button type="button" class="x" title="Remove" data-act="rmIng" data-dish="${id}" data-item="${l.item_id}">✕</button></td>` : ''}</tr>
   ${edit ? `<tr class="ing-edit" id="ie_${l.item_id}" hidden><td colspan="5"><div class="grid">
     <label>Ingredient name<input name="e_name_${l.item_id}" value="${esc(it.name || '')}" data-cap></label>
     <label>Unit used in recipes<input name="e_unit_${l.item_id}" list="dl-units" value="${esc(it.stock_unit || '')}"></label>
     <label>Price per unit ₱<input name="e_cost_${l.item_id}" type="number" step="any" min="0" value="${num(it.last_cost) || ''}"></label>
     <label>Or replace with another ingredient (this recipe only)<input name="e_swap_${l.item_id}" list="dl-items" placeholder="leave empty to keep ${esc(it.name || '')}" autocomplete="off"></label></div>
     <p class="small mut">Name, unit and price belong to the ingredient, so they change in every recipe that uses it. Price is updated again automatically when goods are received.</p>
     <div class="row end"><button type="button" class="ghost" data-act="editIng" data-item="${l.item_id}">Cancel</button><button type="button" class="pri" data-act="saveIng" data-dish="${id}" data-item="${l.item_id}">Save ingredient</button></div></td></tr>` : ''}`; }).join('')}
   </tbody>${sc ? `<tfoot><tr><td colspan="5" id="recipeTotal" data-tray="${trayP}" data-serves="${serves}">${recipeTotalText(cost, trayP, serves)}</td></tr></tfoot>` : ''}</table></div>` : `<p class="mut">No ingredients yet${edit ? ' — add the first one below. The recipe is saved as you go.' : '.'}</p>`}
   ${edit ? `<div class="addrow mt" id="addRow"><label class="an">Ingredient<input name="new_item" list="dl-items" placeholder="Type or pick an ingredient" autocomplete="off" data-newitem></label>
     <label>Qty <span class="mut">(can wait)</span><input name="new_qty" type="number" step="any" min="0" placeholder="later" class="qty"></label>
     <label>Unit<input name="new_unit" list="dl-units" placeholder="kg" class="qty"></label>
     <label>Price per unit ₱<input name="new_price" type="number" step="any" min="0" placeholder="0.00" class="qty"></label>
     <label class="ncat" hidden>Category (new ingredient)<input name="new_cat" list="dl-cats" placeholder="e.g. Vegetables"></label>
     <button type="button" class="pri" data-act="addIng" data-id="${id}">＋ Add</button></div>
     <p class="small mut" id="addHint">Pick an ingredient and its unit and last price fill in. A new name is added to the ingredient list too.</p>
     ${itemDatalist()}<datalist id="dl-cats">${[...new Set(S.items.map(i => i.category))].sort().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
     <datalist id="dl-units">${['kg', 'g', 'L', 'ml', 'pc', 'pack', 'can', 'bundle', 'bottle', 'tray', 'sack', 'box'].map(u => `<option value="${u}">`).join('')}</datalist>
     ${r && lines.length ? `<div class="row end mt">${r.status !== 'verified' ? `<button type="button" class="pri" data-act="verify" data-id="${id}">Mark verified</button>` : ''}</div>
     <p class="small mut">Every change saves by itself. ${r.status === 'verified' ? 'Any change puts this recipe back to draft until the head chef or R&D chef verifies it again.' : 'Check each quantity against how the kitchen really cooks this dish, then mark it verified so it can be used for purchase requests.'}</p>` : ''}
     <details class="copyr mt"><summary>Copy ingredients from another dish</summary><div class="addline mt"><input id="copyFrom" list="dl-recipes" placeholder="Dish with a recipe, e.g. Tuna Bicol Express" autocomplete="off"><button type="button" data-act="copyRecipe" data-id="${id}">Copy</button></div>
       <p class="small mut">Adds the other recipe's ingredients that aren't here yet (quantities you already have stay). Good for variants of the same dish.</p>
       <datalist id="dl-recipes">${S.dishes.filter(x => x.id !== id && x.active).map(x => `<option value="${esc(x.name)}">`).join('')}</datalist></details>` : ''}
  </form>
  ${lines.length && sc ? costingCard(d, r, lines, serves, edit) : ''}
  ${edit || r?.method ? `<section class="card"><h2>Method &amp; notes</h2>${edit ? `<textarea id="recipeMethod" data-dish="${id}" rows="5" placeholder="Prep and cooking steps, yields, plating, what to watch out for…">${esc(r?.method || '')}</textarea><p class="small mut">Saves when you click away. Printed on the recipe card.</p>` : `<p class="pre">${esc(r.method)}</p>`}</section>` : ''}`}`;
};
/* ---- House pricing (Romualdo's) ----
   S = ingredient cost for one large tray (10–12 guests, planned at 10)
   Tray price        = S × 3
   Buffet per head   = (tray price − 35% of S) ÷ 10
   Restaurant serving (3–4 guests ≈ ⅓ of a tray) = tray price ÷ 3
   Shown inside the app only (chef, manager, finance). Change the numbers here and every screen follows. */
// trayCost: the large disposable tray, added on top of every tray price (not to buffet or restaurant prices)
const HOUSE = { markup: 3, pax: 10, servingsPerTray: 3, trayCost: 45, get buffetLess() { return buffetLessPct() / 100; } };
// Buffet deduction: 35% by default, up to 50% for volume events (kept per device)
const buffetLessPct = () => { try { const v = num(localStorage.getItem('rom-buffet-less')); return v >= 35 && v <= 50 ? v : 35; } catch (e) { return 35; } };
const portionPct = () => { try { const v = num(localStorage.getItem('rom-buffet-portion')); return v >= 20 && v <= 100 ? v : 60; } catch (e) { return 60; } };
const FC_TARGET = 100 / HOUSE.markup;                       // 33.3% food cost on a tray
const fcTone = pct => pct > FC_TARGET + 10 ? 'bad-t' : pct > FC_TARGET + 2 ? 'warn-t' : 'ok-t';
const roundUp = (n, step) => n > 0 ? Math.ceil(n / step - 1e-9) * step : 0;
const roundUp10 = n => roundUp(n, 10);
const pesoR = n => n ? peso(n).replace('.00', '') : '—';
const TIER_LBL = { standard: 'Standard', premium: 'Premium', both: 'Standard + Premium' };
const tierChip = t => t ? `<span class="tier t-${t}">${t === 'both' ? 'Std + Prem' : TIER_LBL[t]}</span>` : '';
const qtyErr = err => /qty_check|violates check/i.test(err?.message || '') ? 'The database update for blank quantities isn\'t installed yet (20261126000700). Enter a quantity for now.' : err?.message || String(err);
function housePrices(S) {
  const tray = S * HOUSE.markup, head = (tray - HOUSE.buffetLess * S) / HOUSE.pax, serving = tray / HOUSE.servingsPerTray;
  return { S, tray, head, serving, trayR: roundUp(tray, 10) + HOUSE.trayCost, headR: roundUp(head, 1), servingR: roundUp(serving, 5) };
}
// cost of a recipe scaled to one tray of 10, from its lines (qty 0 = not filled in yet)
function recipeS(lines, serves, priceOf = id => num(S.itemsById[id]?.last_cost)) {
  const cost = lines.reduce((a, l) => a + num(l.qty) * priceOf(l.item_id), 0);
  return cost * HOUSE.pax / (num(serves) || HOUSE.pax);
}

/* ---- Recipes → Costing tab: every dish with a recipe at house prices, filters, price-change simulator, package check ---- */
const PACKAGES = [
  { k: 'cv500', tier: 'standard', price: 500, slots: ['Salad / soup', 'Chicken', 'Beef / pork', 'Pasta / noodles', 'Rice', 'Dessert'], note: 'Casa Vieja · + drinks' },
  { k: 's450', tier: 'standard', price: 450, slots: ['Soup', 'Chicken', 'Veggies / noodles', 'Rice', 'Dessert'], note: '+ softdrinks · min. 100 pax' },
  { k: 's550', tier: 'standard', price: 550, slots: ['Soup', 'Appetizer', 'Chicken', '2nd viand', 'Veggie', 'Pasta / noodle', 'Rice', 'Dessert'], note: 'min. 50 pax' },
  { k: 's650', tier: 'standard', price: 650, slots: ['Soup', 'Appetizer', 'Chicken', 'Pork', 'Beef / fish', 'Veggies', 'Pasta / noodle', 'Rice', 'Dessert'], note: 'min. 50 pax' },
  { k: 'm700', tier: 'premium', price: 700, slots: ['Soup', 'Salad / appetizer', 'Chicken', 'Beef', 'Pork', 'Fish / seafood', 'Pasta / noodles', 'Rice', 'Dessert'], note: 'regular-to-premium set menu' },
  { k: 'p750', tier: 'premium', price: 750, slots: ['Soup', 'Chicken', '2nd viand', 'Veggies', 'Rice', 'Dessert'], note: '+ softdrinks · min. 50 pax' },
  { k: 'p850', tier: 'premium', price: 850, slots: ['Soup', 'Appetizer', 'Chicken', 'Beef', 'Pork / fish', 'Pasta / noodle', 'Rice', 'Dessert'], note: '+ softdrinks · min. 50 pax' },
  { k: 'p990', tier: 'premium', price: 990, slots: ['Soup', 'Assorted appetizers', 'Chicken', 'Pork', 'Beef / fish', 'Veggies', 'Pasta / noodle', 'Rice', 'Dessert'], note: '2–3 desserts · min. 50 pax' },
];
let COST_ROWS = [], KSORT = ['name', true], KFILT = 'all';
function costingTab(recipes, rl) {
  const by = {}; rl.forEach(l => (by[l.dish_id] = by[l.dish_id] || []).push(l));
  COST_ROWS = S.dishes.filter(d => d.active && recipes[d.id] && by[d.id]).map(d => {
    const r = recipes[d.id], ls = by[d.id];
    return { d, serves: num(r.batch_serves) || HOUSE.pax, ls, status: r.status, now: num(d.tray_price),
      missing: ls.filter(l => !num(S.itemsById[l.item_id]?.last_cost)).length, noQty: ls.filter(l => !num(l.qty)).length };
  });
  const usedItems = [...new Set(rl.map(l => l.item_id))].filter(i => S.itemsById[i]).sort((a, b) => itemName(a).localeCompare(itemName(b)));
  const hasTier = S.dishes.some(d => 'tier' in d);
  return `<div class="card ctools">
    <p class="small mut hf1"><b>House formula</b> · tray = ingredient cost (10–12 pax) × ${HOUSE.markup} + ₱${HOUSE.trayCost} large tray · buffet per head = (tray − 35 to 50% of the cost) ÷ ${HOUSE.pax} · restaurant serving (3–4 pax) = tray ÷ ${HOUSE.servingsPerTray}, both without the ₱${HOUSE.trayCost} tray. Rounded up: food part of the tray to ₱10, serving to ₱5, per head to ₱1.</p>
    <div class="ct-row"><label>Buffet deduction<span><input id="ktLess" type="number" min="35" max="50" step="1" value="${buffetLessPct()}"> % of cost (35–50)</span></label>
     <label>All ingredient prices<span><input id="ktInfl" type="number" step="1" value="0"> % change</span></label>
     <label class="wide">One ingredient's new price<span><input id="ktItem" list="dl-citems" placeholder="e.g. Pork kasim" autocomplete="off"> ₱<input id="ktPrice" type="number" step="any" min="0" placeholder="new price"></span></label></div>
    <datalist id="dl-citems">${usedItems.map(i => `<option value="${esc(itemName(i))}">`).join('')}</datalist>
    <div class="ct-row filt"><span class="mut small">Show</span>${[['all', 'All'], ...(hasTier ? [['standard', 'Standard'], ['premium', 'Premium'], ['untiered', 'Not on a package']] : []), ['under', 'Priced below formula'], ['incomplete', 'Missing price / qty'], ['affected', 'Affected by the price change']].map(([k, l]) => `<button type="button" class="chipbtn${k === KFILT ? ' on' : ''}" data-kfilt="${k}">${l}</button>`).join('')}<span class="sp"></span><span id="ktSum" class="small"></span></div>
   </div>
   <div class="card tw"><table class="ktable"><thead><tr>${[['name', 'Dish'], ['S', 'Cost · 10 pax'], ['tray', 'Tray ×3'], ['head', 'Buffet / head'], ['serving', 'Restaurant serving'], ['now', 'Tray price now'], ['new', 'After change']].map(([k, l], i) => `<th class="${i ? 'n' : ''}" data-ksort="${k}">${l}</th>`).join('')}</tr></thead><tbody id="ktBody"></tbody></table></div>
   ${packageCheck()}`;
}
function costRowsCalc() {
  const infl = num($('#ktInfl')?.value), itemId = itemIdFromName($('#ktItem')?.value || ''), np = ($('#ktPrice')?.value ?? '') === '' ? null : num($('#ktPrice').value);
  const sim = !!(infl || (itemId && np !== null));
  return { sim, rows: COST_ROWS.map(x => {
    const Sv = recipeS(x.ls, x.serves), nS = recipeS(x.ls, x.serves, id => id === itemId && np !== null ? np : num(S.itemsById[id]?.last_cost)) * (1 + infl / 100);
    const h = housePrices(Sv), nh = housePrices(nS);
    return { ...x, S: Sv, h, nh, tray: h.trayR, head: h.headR, serving: h.servingR, fcNow: x.now > HOUSE.trayCost && Sv ? Sv / (x.now - HOUSE.trayCost) * 100 : null, affected: sim && Math.abs(nS - Sv) > 0.005 };
  }) };
}
function recalcCostTab() {
  const body = $('#ktBody'); if (!body) return;
  const { sim, rows: all } = costRowsCalc();
  const rows = all.filter(x => KFILT === 'all' || (KFILT === 'standard' && ['standard', 'both'].includes(x.d.tier)) || (KFILT === 'premium' && ['premium', 'both'].includes(x.d.tier)) || (KFILT === 'untiered' && !x.d.tier)
    || (KFILT === 'under' && x.now && x.tray > x.now) || (KFILT === 'incomplete' && (x.missing || x.noQty)) || (KFILT === 'affected' && x.affected));
  const [k, asc] = KSORT, val = x => k === 'name' ? x.d.name : k === 'new' ? x.nh.trayR : x[k] ?? -1;
  rows.sort((a, b) => { const A = val(a), B = val(b); return (typeof A === 'string' ? A.localeCompare(B) : A - B) * (asc ? 1 : -1); });
  document.querySelectorAll('[data-ksort]').forEach(th => th.classList.toggle('sorted', th.dataset.ksort === k));
  body.innerHTML = rows.map(x => `<tr${x.affected ? ' class="aff"' : ''}><td><a href="#/c/recipe/${x.d.id}">${esc(x.d.name)}</a> ${tierChip(x.d.tier)}<div class="small mut">${x.status === 'verified' ? '✓ verified' : 'draft'}${x.missing ? ` · <span class="warn-t">${x.missing} without price</span>` : ''}${x.noQty ? ` · <span class="warn-t">${x.noQty} without qty</span>` : ''}</div></td>
    <td class="n">${peso(x.S)}</td><td class="n"><b>${pesoR(x.tray)}</b></td><td class="n">${pesoR(x.head)}</td><td class="n">${pesoR(x.serving)}</td>
    <td class="n">${x.now ? `${pesoR(x.now)}<div class="small ${fcTone(x.fcNow)}">${x.fcNow.toFixed(0)}% food cost${x.tray > x.now ? ' ▲' : ''}</div>` : '<span class="mut">—</span>'}</td>
    <td class="n">${sim ? (x.affected ? `tray ${pesoR(x.nh.trayR)}<div class="small mut">head ${pesoR(x.nh.headR)}</div>` : '<span class="mut">same</span>') : '<span class="mut">—</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="mut">No dishes here.</td></tr>';
  const under = rows.filter(x => x.now && x.tray > x.now).length, inc = rows.filter(x => x.missing || x.noQty).length;
  $('#ktSum').innerHTML = `${rows.length} dishes · <b>${under}</b> priced below the formula${inc ? ` · <b class="warn-t">${inc}</b> incomplete` : ''}${sim ? ` · <b>${rows.filter(x => x.affected).length}</b> affected` : ''}`;
  recalcPackage(all);
}
// Package check: pick a dish per course and compare with the package price
const pkgPicks = () => { try { return JSON.parse(localStorage.getItem('rom-pkg-picks') || '{}'); } catch (e) { return {}; } };
function packageCheck() {
  const cur = (() => { try { return localStorage.getItem('rom-pkg') || 's650'; } catch (e) { return 's650'; } })(), P = PACKAGES.find(x => x.k === cur) || PACKAGES[2], picks = pkgPicks()[P.k] || [];
  return `<section class="card pkg" id="pkg"><div class="row"><h2>Package check</h2><select id="pkgSel">${PACKAGES.map(x => opt(x.k, `${TIER_LBL[x.tier]} ₱${x.price} per head`, x.k === P.k)).join('')}</select><span class="small mut">${esc(P.note)}</span></div>
   <p class="small mut">Pick one dish per course. Only dishes with a recipe can be priced. With several dishes on the table, each guest takes about <input id="pkPortion" type="number" min="20" max="100" step="5" value="${portionPct()}">% of a tray portion of each dish.</p>
   <datalist id="dl-pkgdish">${COST_ROWS.map(x => `<option value="${esc(x.d.name)}">${x.d.tier ? TIER_LBL[x.d.tier] : ''}</option>`).join('')}</datalist>
   <table class="pkt"><thead><tr><th>Course</th><th>Dish</th><th class="n">Buffet price share</th><th class="n">Ingredients / head</th></tr></thead><tbody>
   ${P.slots.map((sl, i) => `<tr><td>${esc(sl)}</td><td><input data-pkslot="${i}" list="dl-pkgdish" value="${esc(picks[i] || '')}" placeholder="pick a dish" autocomplete="off"></td><td class="n" id="pkh${i}">—</td><td class="n" id="pkc${i}">—</td></tr>`).join('')}
   </tbody><tfoot><tr><td colspan="2">Total</td><td class="n" id="pkH">—</td><td class="n" id="pkC">—</td></tr></tfoot></table>
   <div id="pkOut" class="pkout"></div></section>`;
}
function recalcPackage(all) {
  const box = $('#pkg'); if (!box) return;
  all = all || costRowsCalc().rows;
  const P = PACKAGES.find(x => x.k === $('#pkgSel').value), byName = Object.fromEntries(all.map(x => [normName(x.d.name), x]));
  let H = 0, C = 0, n = 0, off = [];
  box.querySelectorAll('[data-pkslot]').forEach(inp => {
    const i = inp.dataset.pkslot, x = byName[normName(inp.value)];
    $('#pkh' + i).textContent = x ? pesoR(x.head) : '—'; $('#pkc' + i).textContent = x ? peso(x.S / HOUSE.pax) : '—';
    const sh = portionPct() / 100;
    if (x) { $('#pkh' + i).textContent = pesoR(roundUp(x.head * sh, 1)); $('#pkc' + i).textContent = peso(x.S / HOUSE.pax * sh); H += x.head * sh; C += x.S / HOUSE.pax * sh; n++; if (x.d.tier && !(x.d.tier === P.tier || x.d.tier === 'both')) off.push(x.d.name); }
  });
  H = roundUp(H, 1); $('#pkH').textContent = n ? pesoR(H) : '—'; $('#pkC').textContent = n ? peso(C) : '—';
  if (!n) { $('#pkOut').innerHTML = '<p class="small mut">Pick dishes to see if the package price covers them.</p>'; return; }
  const gap = P.price - H, fc = C / P.price * 100;
  $('#pkOut').innerHTML = `<div class="kpis kp3"><div><span>Package price</span><b>${pesoR(P.price)}</b><small>${n} of ${P.slots.length} courses picked</small></div>
    <div><span>Dishes at buffet prices</span><b class="${gap < 0 ? 'bad-t' : 'ok-t'}">${pesoR(H)}</b><small>${gap < 0 ? `${pesoR(-gap)} more than the package` : `${pesoR(gap)} left for service &amp; setup`}</small></div>
    <div><span>Food cost per head</span><b class="${fcTone(fc)}">${fc.toFixed(0)}%</b><small>${peso(C)} of ${pesoR(P.price)} at ${portionPct()}% portions</small></div></div>
    ${off.length ? `<p class="small warn-t">Not on the ${TIER_LBL[P.tier]} list: ${off.map(esc).join(', ')}</p>` : ''}`;
}
document.addEventListener('input', e => {
  if (e.target.id === 'ktLess' || e.target.id === 'cLess' || e.target.id === 'pkPortion') {
    const v = num(e.target.value), [key, lo, hi] = e.target.id === 'pkPortion' ? ['rom-buffet-portion', 20, 100] : ['rom-buffet-less', 35, 50];
    if (v >= lo && v <= hi) try { localStorage.setItem(key, v); } catch (er) {}
  }
  if (e.target.closest('.ctools') || e.target.id === 'pkPortion') recalcCostTab();
  if (e.target.dataset?.pkslot !== undefined) {
    const k = $('#pkgSel').value, all = pkgPicks(); all[k] = [...document.querySelectorAll('[data-pkslot]')].map(i => i.value);
    try { localStorage.setItem('rom-pkg-picks', JSON.stringify(all)); } catch (er) {}
    recalcPackage();
  }
});
document.addEventListener('change', e => {
  if (e.target.id !== 'pkgSel') return;
  try { localStorage.setItem('rom-pkg', e.target.value); } catch (er) {}
  $('#pkg').outerHTML = packageCheck(); recalcPackage();
});
document.addEventListener('click', e => {
  const th = e.target.closest('[data-ksort]'); if (th) { KSORT = [th.dataset.ksort, KSORT[0] === th.dataset.ksort ? !KSORT[1] : th.dataset.ksort === 'name']; return recalcCostTab(); }
  const f = e.target.closest('[data-kfilt]'); if (f) { KFILT = f.dataset.kfilt; document.querySelectorAll('[data-kfilt]').forEach(b => b.classList.toggle('on', b === f)); recalcCostTab(); }
});

/* ---- Costing on the recipe page: house prices, what-ifs, and a check for swapped quantity/price ---- */
function costingCard(d, r, lines, serves, edit) {
  return `<section class="card costing" id="costing" data-dish="${d.id}" data-serves="${serves}" data-now="${num(d.tray_price)}">
   <div class="row"><h2>Costing</h2><span class="small mut">house formula · inside the app only</span><span class="sp"></span><button type="button" class="ghost sm" data-act="recipeCard" data-id="${d.id}">Recipe card</button></div>
   <div class="kpis">
    <div><span>Ingredient cost · 10–12 pax</span><b id="hS">—</b><small id="hSg"></small></div>
    <div><span>Tray price</span><b id="hTray">—</b><small id="hTrayNow"></small></div>
    <div><span>Buffet · per head</span><b id="hHead">—</b><small>(tray − <input id="cLess" type="number" min="35" max="50" step="1" value="${buffetLessPct()}">% of cost) ÷ ${HOUSE.pax}</small></div>
    <div><span>Restaurant serving · 3–4 pax</span><b id="hServ">—</b><small>tray ÷ ${HOUSE.servingsPerTray}</small></div>
   </div>
   <div id="hWarn"></div>
   ${edit && canEditDish() ? `<div class="row end"><button type="button" class="lnk" data-act="useSuggested" data-id="${d.id}" id="cUse" hidden></button></div>` : ''}
   <div class="cgrid">
    <div><h3>Biggest costs</h3><div id="cDrivers" class="drivers"></div></div>
    <div><h3>What if…</h3>
     <label class="wi">We charge ₱<input id="cPrice" type="number" step="any" min="0" value="${num(d.tray_price) || ''}" placeholder="tray"> per tray</label><p class="small" id="cPriceOut"></p>
     <label class="wi">Ingredient prices go up <input id="cInfl" type="number" step="1" value="0"> %</label><p class="small" id="cInflOut"></p>
     <label class="wi">Make <input id="cScale" type="number" step="any" min="0" value="1"> trays</label><p class="small" id="cScaleOut"></p>
     <details class="small"><summary>Quantities for that amount</summary><div id="cScaled" class="scaled"></div></details>
    </div>
   </div></section>`;
}
const isBulkUnit = u => /^(kg|l|liters?|litres?)$/i.test((u || '').trim());
function recalcCosting() {
  const box = document.getElementById('costing'); if (!box) return;
  const serves = num(box.dataset.serves) || HOUSE.pax, now = num(box.dataset.now), toTray = HOUSE.pax / serves;
  const rows = [...document.querySelectorAll('[data-linecost]')].map(c => {
    const id = c.dataset.linecost, q = document.querySelector(`[name="q_${id}"]`), pr = document.querySelector(`[name="p_${id}"]`);
    const qty = q ? num(q.value) : num(c.dataset.qty), price = pr ? num(pr.value) : num(c.dataset.price);
    q?.classList.toggle('need', !qty);
    c.innerHTML = qty && price ? peso(qty * price) : '<span class="mut small">—</span>';
    lineCheck(c, id, qty, price, serves, !!q);
    return { id, qty, price, cost: qty * price };
  });
  const cost = rows.reduce((a, x) => a + x.cost, 0), Sv = cost * toTray, h = housePrices(Sv);
  const noQty = rows.filter(x => !x.qty), noPrice = rows.filter(x => x.qty && !x.price);
  $('#hS').textContent = peso(Sv); $('#hSg').textContent = `${peso(Sv / HOUSE.pax)} per guest${serves !== HOUSE.pax ? ` · recipe is for ${fq(serves)}` : ''}`;
  $('#hTray').textContent = pesoR(h.trayR); $('#hHead').textContent = pesoR(h.headR); $('#hServ').textContent = pesoR(h.servingR);
  const T = HOUSE.trayCost, fcOf = pr => pr > T ? Sv / (pr - T) * 100 : null, fcNow = fcOf(now);
  $('#hTrayNow').innerHTML = now ? `cost × ${HOUSE.markup} + ₱${T} tray · now ${pesoR(now)}${fcNow !== null ? ` <span class="${fcTone(fcNow)}">(${fcNow.toFixed(0)}% food cost)</span>` : ''}` : `cost × ${HOUSE.markup} + ₱${T} tray · no tray price set yet`;
  $('#hWarn').innerHTML = [noQty.length ? `<b>${noQty.length}</b> ingredient${noQty.length > 1 ? 's' : ''} still without a quantity (${noQty.map(x => esc(itemName(x.id))).join(', ')}): the prices above leave ${noQty.length > 1 ? 'them' : 'it'} out.` : '',
    noPrice.length ? `No price yet for ${noPrice.map(x => `<b>${esc(itemName(x.id))}</b>`).join(', ')}.` : ''].filter(Boolean).map(t => `<p class="alert warn small">${t}</p>`).join('');
  const use = $('#cUse'); if (use) { use.hidden = !h.trayR || Math.abs(h.trayR - now) < 1 || noQty.length > 0; use.dataset.v = h.trayR; use.textContent = `Set the tray price to ${pesoR(h.trayR)}`; }
  const tot = cost || 1;
  $('#cDrivers').innerHTML = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 5).filter(x => x.cost > 0).map(x => `<div class="drv"><span>${esc(itemName(x.id))}</span><i><em style="width:${Math.max(2, x.cost / tot * 100)}%"></em></i><b>${Math.round(x.cost / tot * 100)}%</b><small>${peso(x.cost * toTray)}</small></div>`).join('') || '<p class="small mut">Add quantities and prices to see what drives the cost.</p>';
  const price = num($('#cPrice').value);
  const fcP = fcOf(price);
  $('#cPriceOut').innerHTML = price && Sv && fcP !== null ? `Food cost <b class="${fcTone(fcP)}">${fcP.toFixed(1)}%</b> · profit <b>${peso(price - T - Sv)}</b> per tray after the ₱${T} tray · buffet per head would be <b>${pesoR(roundUp((price - T - HOUSE.buffetLess * Sv) / HOUSE.pax, 1))}</b>` : '<span class="mut">Type a tray price to test it.</span>';
  const infl = num($('#cInfl').value), nh = housePrices(Sv * (1 + infl / 100));
  $('#cInflOut').innerHTML = infl ? `Cost becomes <b>${peso(nh.S)}</b> · tray <b>${pesoR(nh.trayR)}</b> · per head <b>${pesoR(nh.headR)}</b> · serving <b>${pesoR(nh.servingR)}</b>` : '<span class="mut">Type a % to see the effect of a price increase.</span>';
  const sc = num($('#cScale').value) || 0, sell = price || h.trayR;
  $('#cScaleOut').innerHTML = sc ? `Ingredients cost <b>${peso(Sv * sc)}</b> + trays ${peso(T * sc)} · sales ${peso(sell * sc)} · profit <b>${peso((sell - T - Sv) * sc)}</b>` : '';
  $('#cScaled').innerHTML = rows.map(x => `<div><span>${esc(itemName(x.id))}</span><b>${x.qty ? `${fq(+(x.qty * toTray * sc).toFixed(3))} ${esc(itemUnit(x.id))}` : '<span class="warn-t">qty?</span>'}</b></div>`).join('');
}
// Catch quantity/price typed the wrong way round (250 kg at ₱0.25/kg instead of 0.25 kg at ₱250/kg) before it reaches the ingredient list
function lineCheck(cell, id, qty, price, serves, editable) {
  const td = cell.closest('tr')?.querySelector('td'); if (!td) return;
  let el = td.querySelector('.lchk'); const u = itemUnit(id), perGuest = qty / (serves || 1);
  let msg = '';
  if (isBulkUnit(u) && qty && perGuest > 1.5) {
    msg = price && price < 5
      ? `Looks swapped: ${fq(qty)} ${esc(u)} at ₱${fq(price)}/${esc(u)}. ${editable ? `<button type="button" data-act="fixLine" data-item="${id}" data-mode="swap">Make it ${fq(price)} ${esc(u)} at ₱${fq(qty)}/${esc(u)}</button>` : ''}`
      : `${fq(qty)} ${esc(u)} for ${fq(serves)} guest${serves > 1 ? 's' : ''} is a lot. Grams? ${editable ? `<button type="button" data-act="fixLine" data-item="${id}" data-mode="g">Make it ${fq(qty / 1000)} ${esc(u)}</button>` : ''}`;
  } else if (isBulkUnit(u) && price && price < 5) msg = `₱${fq(price)} per ${esc(u)} looks low — the price is for a whole ${esc(u)}.`;
  if (!msg) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'lchk small'; td.appendChild(el); }
  if (el.dataset.m !== msg) { el.innerHTML = '' + msg; el.dataset.m = msg; }
}
ACT.fixLine = el => {
  const id = el.dataset.item, q = document.querySelector(`[name="q_${id}"]`), p = document.querySelector(`[name="p_${id}"]`); if (!q) return;
  const qty = num(q.value), price = num(p?.value);
  if (el.dataset.mode === 'swap' && p) { q.value = price; p.value = qty; p.dispatchEvent(new Event('input', { bubbles: true })); p.dispatchEvent(new Event('change', { bubbles: true })); }
  else q.value = +(qty / 1000).toFixed(4);
  q.dispatchEvent(new Event('input', { bubbles: true })); q.dispatchEvent(new Event('change', { bubbles: true }));
};
document.addEventListener('input', e => { if (e.target.closest('#costing') || e.target.closest('form[data-form="saveRecipe"]')) recalcCosting(); });
ACT.useSuggested = async el => {
  const v = num(el.dataset.v);
  if (!v || !confirm(`Set the tray price of this dish to ${peso(v)}?\n\nThis is the price shown on the catering menu and used for new event costing.`)) return;
  try { await db.update('dishes', { tray_price: v }, { id: el.dataset.id }); await loadMaster(); toast('Tray price updated'); refresh(); } catch (err) { toast(err.message, true); }
};
// Method & notes: saved when they leave the box
document.addEventListener('change', async e => {
  if (e.target.id !== 'recipeMethod') return;
  const id = e.target.dataset.dish;
  try { await ensureRecipe(id); await db.update('recipes', { method: e.target.value.trim() || null }, { dish_id: id }); toast('Method saved'); } catch (err) { toast(err.message, true); }
});
ACT.copyRecipe = async el => {
  const name = ($('#copyFrom')?.value || '').trim(), src = S.dishes.find(x => normName(x.name) === normName(name));
  if (!src) return toast('Pick a dish from the list.', true);
  const [from, mine] = await Promise.all([db.select('recipe_lines', { eq: { dish_id: src.id } }), db.select('recipe_lines', { cols: 'item_id', eq: { dish_id: el.dataset.id } })]);
  if (!from.length) return toast(`${src.name} has no recipe to copy.`, true);
  const have = new Set(mine.map(x => x.item_id)), add = from.filter(x => !have.has(x.item_id));
  if (!add.length) return toast('All of those ingredients are already here.');
  const [srcR] = await db.select('recipes', { cols: 'batch_serves', eq: { dish_id: src.id } });
  const [r] = await db.select('recipes', { cols: 'dish_id', eq: { dish_id: el.dataset.id } });
  if (!r) await db.insert('recipes', { dish_id: el.dataset.id, batch_serves: num(srcR?.batch_serves) || 10, status: 'draft' });
  await db.insert('recipe_lines', add.map(x => ({ dish_id: el.dataset.id, item_id: x.item_id, qty: x.qty })));
  toast(`${add.length} ingredient${add.length > 1 ? 's' : ''} copied from ${src.name} — adjust the quantities`); refresh();
};
// Printable recipe card (kitchen copy): ingredients at the chosen amount, method, cost summary
ACT.recipeCard = el => {
  const d = S.dishById[el.dataset.id], box = $('#costing'), serves = num(box.dataset.serves) || 1, sc = num($('#cScale').value) || 1;
  const rows = [...document.querySelectorAll('[data-linecost]')].map(c => { const id = c.dataset.linecost, q = document.querySelector(`[name="q_${id}"]`), pr = document.querySelector(`[name="p_${id}"]`);
    return { id, qty: (q ? num(q.value) : num(c.dataset.qty)) * sc, price: pr ? num(pr.value) : num(c.dataset.price) }; });
  const cost = rows.reduce((a, x) => a + x.qty * x.price, 0), price = num($('#cPrice').value) * sc, method = $('#recipeMethod')?.value ?? document.querySelector('.card .pre')?.textContent ?? '';
  const amt = serves > 1 ? `${fq(sc)} tray${sc === 1 ? '' : 's'} (${fq(sc * serves)} guests)` : `${fq(sc)} guest${sc === 1 ? '' : 's'}`;
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the recipe card.', true);
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recipe - ${esc(d.name)}</title><style>
   @page{size:A5;margin:10mm}body{font:11pt/1.4 Montserrat,Arial,sans-serif;color:#1b1f2a;margin:0}h1{font:italic 22pt 'Playfair Display',Georgia,serif;color:#14213f;margin:0}
   .m{color:#5b6170;font-size:9.5pt;margin:2px 0 10px}table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:.6pt solid #ddd}td.n{text-align:right;white-space:nowrap}
   h2{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:#8a5a00;margin:14px 0 4px}.pre{white-space:pre-wrap}.c{display:flex;gap:16px;font-size:9.5pt;color:#5b6170;margin-top:12px;border-top:1pt solid #14213f;padding-top:6px}
   .bar{margin-bottom:8px}@media print{.bar{display:none}}</style></head><body>
   <div class="bar"><button onclick="print()">Print</button></div>
   <h1>${esc(d.name)}</h1><div class="m">${esc(d.category)} · ${esc(d.course)} · for ${amt}</div>
   <h2>Ingredients</h2><table>${rows.map(x => `<tr><td>${esc(itemName(x.id))}</td><td class="n">${fq(+x.qty.toFixed(3))} ${esc(itemUnit(x.id))}</td></tr>`).join('')}</table>
   ${method.trim() ? `<h2>Method</h2><div class="pre">${esc(method)}</div>` : ''}
   <div class="c"><span>Ingredient cost ${peso(cost)}</span>${price ? `<span>Price ${peso(price)}</span><span>Food cost ${(cost / price * 100).toFixed(1)}%</span>` : ''}<span>Printed ${esc(new Date().toLocaleDateString('en-PH'))}</span></div></body></html>`);
  w.document.close();
};
// The recipe row is made the first time something is added — no separate "Start recipe" step
async function ensureRecipe(dishId) {
  const [r] = await db.select('recipes', { cols: 'dish_id', eq: { dish_id: dishId } }); if (r) return;
  await db.insert('recipes', { dish_id: dishId, batch_serves: num(document.querySelector(`[data-recipeserves="${dishId}"]`)?.value) || 10, status: 'draft' });
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('#addRow') && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.closest('#addRow').querySelector('[data-act=addIng]').click(); } });
const canEditDish = () => canAny('head_chef', 'rnd_chef');
ACT.toggleDishEdit = () => { const f = document.getElementById('dishEdit'); if (f) { f.hidden = !f.hidden; if (!f.hidden) f.name.focus(); } };
FORMS.editDish = async (f, el) => {
  const name = f.name.trim().replace(/\s+/g, ' '), id = el.dataset.id;
  const clash = Object.values(S.dishById).find(x => x.id !== id && normName(x.name) === normName(name)); if (clash) return toast(`Another dish is already called "${clash.name}".`, true);
  const patch = { name, category: f.category.trim() || 'Others', course: f.course, tray_price: f.tray_price === '' ? null : num(f.tray_price) };
  if ('tier' in (S.dishById[id] || {})) patch.tier = f.tier || null;
  await db.update('dishes', patch, { id });
  await loadMaster(); toast('Dish saved'); refresh();
};
// Batch size: saved straight away (makes the recipe if there isn't one yet)
document.addEventListener('change', async e => {
  const d = e.target.dataset?.recipeserves; if (!d) return;
  try { const [r] = await db.select('recipes', { cols: 'dish_id', eq: { dish_id: d } });
    if (r) await db.update('recipes', { batch_serves: num(e.target.value) }, { dish_id: d }); else await ensureRecipe(d);
    toast('Saved'); refresh(); } catch (err) { toast(err.message, true); }
});
// Picking an ingredient in the add row fills in its unit and last price; a new name asks for a category
document.addEventListener('input', e => {
  if (!e.target.matches('[data-newitem]')) return;
  const row = e.target.closest('#addRow'), id = itemIdFromName(e.target.value), it = id && S.itemsById[id], typed = e.target.value.trim();
  const u = row.querySelector('[name=new_unit]'), p = row.querySelector('[name=new_price]'), cat = row.querySelector('.ncat'), hint = $('#addHint');
  if (it) { u.value = it.stock_unit || ''; u.readOnly = true; p.value = num(it.last_cost) || ''; cat.hidden = true;
    hint.innerHTML = `<b>${esc(it.name)}</b> · priced per ${esc(it.stock_unit)}. Changing the price here updates it for every recipe. To change its unit, use ✎ after adding.`; }
  else { if (u.readOnly) { u.value = ''; p.value = ''; } u.readOnly = false; cat.hidden = !typed;
    hint.innerHTML = typed ? `<b>${esc(typed)}</b> is new — it will be added to the ingredient list with this unit and price.` : 'Pick an ingredient and its unit and last price fill in. A new name is added to the ingredient list too.'; }
});
// Price typed in the table: live cost now, saved to the ingredient (all recipes) when they leave the box
document.addEventListener('input', e => {
  const m = /^p_(.+)$/.exec(e.target.name || ''); if (!m || !e.target.closest('form[data-form="saveRecipe"]')) return;
  const cell = document.querySelector(`[data-linecost="${m[1]}"]`); if (!cell) return; cell.dataset.price = num(e.target.value);
  const q = document.querySelector(`[name="q_${m[1]}"]`); cell.textContent = num(e.target.value) ? peso(num(q?.value) * num(e.target.value)) : '—';
  let total = 0; document.querySelectorAll('[data-linecost]').forEach(c => { const qq = document.querySelector(`[name="q_${c.dataset.linecost}"]`); total += num(qq?.value) * num(c.dataset.price); });
  const t = $('#recipeTotal'); if (t) t.innerHTML = recipeTotalText(total, num(t.dataset.tray), num(t.dataset.serves));
});
document.addEventListener('change', async e => {
  const m = /^p_(.+)$/.exec(e.target.name || ''); if (!m || !e.target.closest('form[data-form="saveRecipe"]')) return;
  if (e.target.value === '' || num(e.target.value) < 0) return toast('Enter a price of 0 or more.', true);
  try { await db.update('items', { last_cost: num(e.target.value) }, { id: m[1] }); S.itemsById[m[1]] && (S.itemsById[m[1]].last_cost = num(e.target.value)); toast(`Price saved for ${itemName(m[1])} (all recipes)`); }
  catch (err) { toast(err.message, true); }
});
FORMS.startRecipe = async (f, el) => { await db.insert('recipes', { dish_id: el.dataset.id, batch_serves: num(f.serves), status: 'draft' }); refresh(); };
FORMS.saveRecipe = async (f, el) => {
  for (const [k, v] of Object.entries(f).filter(([k]) => k.startsWith('q_'))) if (v !== '' && num(v) >= 0) await db.update('recipe_lines', { qty: num(v) }, { dish_id: el.dataset.id, item_id: k.slice(2) });
  toast('Saved'); refresh();
};
FORMS.newItem = async (f, el) => {
  const name = f.name.trim().replace(/\s+/g, ' ');
  if (itemIdFromName(name)) return toast('An item with that name exists already.', true);
  const row = { name, category: f.category.trim(), stock_unit: f.stock_unit.trim(), purchase_unit: f.purchase_unit.trim(), units_per_purchase: num(f.units_per_purchase) || 1, last_cost: num(f.last_cost) };
  let id;
  try { id = (await db.insert('items', row))[0]?.id; }
  catch (err) {   // same name as an item that was switched off earlier → switch it back on with these details
    if (!/duplicate|unique/i.test(err.message || '')) throw err;
    const [old] = await db.select('items', { cols: 'id,active', eq: { name } });
    if (!old) throw new Error('An item with that name exists already.');
    id = (await db.update('items', { ...row, active: true }, { id: old.id }))[0]?.id;
  }
  const qty = num(el?.dataset.qty);
  if (id && el?.dataset.dish && qty > 0) { await db.upsert('recipe_lines', { dish_id: el.dataset.dish, item_id: id, qty }, 'dish_id,item_id'); delete el.dataset.qty; }
  await loadMaster(); toast(qty > 0 ? `${name} added to the list and to this recipe` : `${name} added to the ingredient list`); refresh();
};
ACT.addIng = async el => {
  const f = formData(el.closest('form')), typed = (f.new_item || '').trim().replace(/\s+/g, ' '), dish = el.dataset.id, qty = num(f.new_qty);
  if (!typed) return toast('Type or pick an ingredient.', true);
  if (qty < 0) return toast('Quantity cannot be negative.', true);
  let item = itemIdFromName(typed);
  if (!item) { const g = itemGuess(typed); if (g && confirm(`"${typed}" isn't on the ingredient list.\n\nDid you mean "${g.name}" (${g.stock_unit})?\n\nOK = use ${g.name} · Cancel = add "${typed}" as a new ingredient`)) item = g.id; }
  const price = f.new_price === '' || f.new_price == null ? null : num(f.new_price);
  if (price !== null && price < 0) return toast('Price cannot be negative.', true);
  if (!item) {   // new ingredient, made right here with the unit and price typed
    const unit = (f.new_unit || '').trim(); if (!unit) return toast(`Enter the unit for ${typed} (kg, g, L, pc…).`, true);
    const row = { name: typed, category: (f.new_cat || '').trim() || 'Others', stock_unit: unit, purchase_unit: unit, units_per_purchase: 1, last_cost: price || 0 };
    try { item = (await db.insert('items', row))[0]?.id; }
    catch (err) {
      if (!/duplicate|unique/i.test(err.message || '')) throw err;   // switched off earlier → back on with these details
      const [old] = await db.select('items', { cols: 'id', eq: { name: typed } }); if (!old) throw err;
      item = (await db.update('items', { ...row, active: true }, { id: old.id }))[0]?.id || old.id;
    }
    await loadMaster();
  } else if (price !== null && price !== num(S.itemsById[item]?.last_cost)) {
    await db.update('items', { last_cost: price }, { id: item }); await loadMaster();
  }
  await ensureRecipe(dish);
  try { await db.upsert('recipe_lines', { dish_id: dish, item_id: item, qty }, 'dish_id,item_id'); } catch (err) { return toast(qtyErr(err), true); }
  toast(qty ? `${itemName(item)} added` : `${itemName(item)} listed — fill in the quantity later`); await refresh();
  document.querySelector('[data-newitem]')?.focus();
};
ACT.editIng = async el => { const r = document.getElementById('ie_' + el.dataset.item); if (r) r.hidden = !r.hidden; };
ACT.saveIng = async el => {
  const f = formData(el.closest('form')), id = el.dataset.item, dish = el.dataset.dish, it = S.itemsById[id];
  let swap = (f['e_swap_' + id] || '').trim(), name = (f['e_name_' + id] || '').trim().replace(/\s+/g, ' ');
  const unit = (f['e_unit_' + id] || '').trim(), cost = f['e_cost_' + id];
  if (swap && (normName(swap) === normName(it?.name) || normName(swap) === normName(name))) swap = '';   // same ingredient: just save the edits
  let to = null;
  if (swap) {
    to = itemIdFromName(swap);
    if (!to) { const g = itemGuess(swap); if (g && g.id !== id && confirm(`"${swap}" isn't on the ingredient list.\n\nReplace with "${g.name}" (${g.stock_unit}) in this recipe?`)) to = g.id; }
    if (!to) {   // not an ingredient yet: most likely they meant to rename this one
      if (!confirm(`There's no ingredient called "${swap}".\n\nRename "${it?.name || 'this ingredient'}" to "${swap}" instead?\n(Unit and price changes are saved too. The new name shows in every recipe.)`))
        return toast('Nothing saved. To only change the name, unit or price, leave "Replace with" empty.', true);
      name = swap;
    }
    if (to === id) to = null;
  }
  if (to) {
    const qty = num(f['q_' + id]) || num((await db.select('recipe_lines', { eq: { dish_id: dish, item_id: id } }))[0]?.qty);
    await db.upsert('recipe_lines', { dish_id: dish, item_id: to, qty }, 'dish_id,item_id');
    await db.remove('recipe_lines', { dish_id: dish, item_id: id });
    toast(`Replaced with ${itemName(to)}`); return refresh();
  }
  if (!name || !unit) return toast('Name and unit cannot be empty.', true);
  const other = itemIdFromName(name); if (other && other !== id) return toast('Another ingredient already has that name. Use "Replace with" instead.', true);
  const patch = { name, stock_unit: unit };
  if (it && it.purchase_unit === it.stock_unit && num(it.units_per_purchase) === 1) patch.purchase_unit = unit;
  if (cost !== '' && cost != null) { if (num(cost) < 0) return toast('Price cannot be negative.', true); patch.last_cost = num(cost); }
  await db.update('items', patch, { id });
  await loadMaster(); toast('Ingredient saved'); refresh();
};
ACT.rmIng = async el => { await db.remove('recipe_lines', { dish_id: el.dataset.dish, item_id: el.dataset.item }); refresh(); };
ACT.verify = async el => { const f = formData(el.closest('form'));
  const blank = Object.entries(f).filter(([k, v]) => k.startsWith('q_') && !(num(v) > 0)).map(([k]) => itemName(k.slice(2)));
  if (blank.length) return toast(`Fill in the quantity for ${blank.join(', ')} before verifying.`, true);
  await FORMS.saveRecipe(f, el.closest('form')); await db.rpc('verify_recipe', { p_dish: el.dataset.id }); toast('Recipe verified — it will now be used for purchase requests'); refresh(); };


/* ================= INQUIRIES (from the website) ================= */
const BK_STATUS = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost', spam: 'Spam' };
const BK_TONE = { new: 'info', contacted: 'warn', quoted: 'warn', won: 'ok', lost: 'mut', spam: 'mut' };
const BK_KIND = { package: 'Package', custom: 'Custom menu', tray: 'Food trays', corporate: 'Corporate lead' };
const COURSE_OF = { soup: 'Soup', appetizer: 'Appetizer', chicken: 'Chicken', pork: 'Pork', beef: 'Beef', fish: 'Fish / seafood', veg: 'Vegetables', pasta: 'Pasta / noodles', dessert: 'Dessert', drinks: 'Drinks', rice: 'Rice' };
routes['c/inquiries'] = async arg => {
  const tab = arg || 'open';
  const rows = await db.select('bookings', { cols: 'id,ref,website_ref,kind,status,received_at,client_name,phone,event_date,pax,event_type,event_id', order: [['received_at', false]], limit: 300 });
  const groups = { open: ['new', 'contacted', 'quoted'], won: ['won'], closed: ['lost', 'spam'], all: null };
  const list = rows.filter(r => !groups[tab] || groups[tab].includes(r.status));
  const nNew = rows.filter(r => r.status === 'new').length;
  const tabs = [['open', `Open${nNew ? ` (${nNew} new)` : ''}`], ['won', 'Won'], ['closed', 'Lost / spam'], ['all', 'All']];
  return `<h1>Inquiries</h1><p class="lede">Bookings and quote requests sent from romualdos.ph. Turn one into an event to plan the menu and purchasing.</p>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/inquiries/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${list.length ? `<div class="list">${list.map(b => `<a class="li" href="#/c/inquiry/${b.id}"><div class="li-date"><b>${b.event_date ? esc(fmtD(b.event_date).split(',')[0]) : '—'}</b><span>${b.event_date ? esc(fmtD(b.event_date).split(',').slice(1).join(',')) : 'no date'}</span></div>
      <div class="li-main"><b>${esc(b.client_name || 'No name')}${b.event_type ? ' · ' + esc(b.event_type) : ''}</b><span class="mut small">${esc(BK_KIND[b.kind] || 'Inquiry')}${b.pax ? ' · ' + b.pax + ' guests' : ''} · received ${esc(fmtT(b.received_at))}${b.event_id ? ' · event made' : ''}</span></div>
      ${chip(BK_STATUS[b.status], BK_TONE[b.status])}</a>`).join('')}</div>` : '<div class="empty">Nothing here.</div>'}`;
};
routes['c/inquiry'] = async id => {
  const [b] = await db.select('bookings', { eq: { id } }); if (!b) return '<div class="card">Inquiry not found.</div>';
  const p = b.payload || {}, c = p.customer || {}, ev = p.event || {}, pl = p.plan || {}, es = p.estimate || {}, k = p.corp || {};
  const canAct = can('catering', 'event_specialist', 'manager');
  const items = (p.items || []).filter(i => i.dish);
  const row = (l, v) => v ? `<tr><td class="mut">${l}</td><td>${v}</td></tr>` : '';
  const plan = pl.kind === 'package' ? `${esc(pl.packageName || 'Package')}${canBill() && num(pl.pricePerHead) ? ` · ${peso(pl.pricePerHead)} per head` : ''}` : esc(BK_KIND[pl.kind] || pl.kind || '');
  return `<div class="row"><a href="#/c/inquiries" class="back">‹ Inquiries</a></div>
  <div class="row"><h1>${esc(b.client_name || 'Inquiry')}</h1>${chip(BK_STATUS[b.status], BK_TONE[b.status])}<span class="sp"></span>${eventAdmin() ? `<button class="ghost danger" data-act="delInquiry" data-id="${b.id}" data-name="${esc(b.client_name || '')}">Delete</button>` : ''}</div>
  <p class="lede">${esc(b.ref)}${b.website_ref ? ' · website ref ' + esc(b.website_ref) : ''} · received ${esc(fmtT(b.received_at))}</p>
  <section class="card"><h2>Customer and event</h2><table class="kv"><tbody>
   ${row('Mobile', c.phone ? `<a href="tel:${esc(String(c.phone).replace(/\s+/g, ''))}">${esc(c.phone)}</a>` : '')}${row('Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')}
   ${row('Company', esc([k.company, k.position].filter(Boolean).join(' · ')))}
   ${row('Event', esc([ev.type, ev.date ? fmtD(ev.date) : '', ev.time ? fmtClock(ev.time) : ''].filter(Boolean).join(' · ')))}${row('Venue', esc(ev.venue || ''))}${row('Guests', ev.pax ? esc(ev.pax) : '')}
   ${row('Plan', plan)}${row('Fulfilment', esc([pl.fulfil, pl.payment].filter(Boolean).join(' · ')))}
   ${row('Estimate', canBill() && num(es.total) ? `${peso(es.total)}${num(es.perHead) ? ` (${peso(es.perHead)} per head)` : ''} <span class="mut small">— estimate shown to the customer</span>` : '')}
   ${row('Notes', p.notes ? esc(p.notes).replace(/\n/g, '<br>') : '')}
  </tbody></table></section>
  ${items.length || pl.chefPick ? `<section class="card"><h2>Menu picked</h2>${pl.chefPick ? '<p>Chef to recommend the menu.</p>' : ''}
   ${items.map(i => `<div class="mline"><span class="mut small" style="min-width:120px">${esc(COURSE_OF[i.cat] || i.cat || '')}</span><span>${esc(i.dish)}</span>${i.tier === 'request' ? chip('special request', 'warn') : ''}<span class="sp"></span>${i.qty ? `<b>${esc(i.qty)}${pl.kind === 'tray' ? ' tray' + (num(i.qty) > 1 ? 's' : '') : ''}</b>` : ''}</div>`).join('')}</section>` : ''}
  ${canAct ? `<section class="card"><div class="row"><h2>Next step</h2></div>
   <div class="row">${b.event_id ? `<a class="btn pri" href="#/c/event/${b.event_id}">Open the event</a> <button class="pdf" data-act="evPdf" data-id="${b.event_id}">Print event sheet (PDF)</button>` : `<button class="pri" data-act="bkEvent" data-id="${b.id}">Create event from this inquiry</button>`}
    <span class="sp"></span><label class="inline">Status <select data-bkstatus="${b.id}">${Object.entries(BK_STATUS).map(([v, l]) => opt(v, l, v === b.status)).join('')}</select></label></div>
   <p class="small mut">${b.event_id ? 'The event was made from this inquiry. Set the status to Won once the client confirms.' : 'Makes an event (status: Inquiry) with the customer, date, guests and the dishes they picked. Unknown dishes are kept as off-menu for the chef.'}</p></section>` : ''}`;
};
ACT.bkEvent = async el => {
  el.disabled = true; el.textContent = 'Making the event…';
  try { const e = await db.rpc('create_event_from_booking', { p_booking: el.dataset.id }); toast('Event made — check the date, guests and menu'); go('#/c/event/' + e); }
  catch (err) { el.disabled = false; el.textContent = 'Create event from this inquiry'; toast(err.message, true); }
};
document.addEventListener('change', async e => {
  const id = e.target.dataset?.bkstatus; if (!id) return;
  try { await db.update('bookings', { status: e.target.value, handled_by: S.user.id }, { id }); toast('Status saved'); refresh(); } catch (err) { toast(err.message, true); }
});


/* ================= PAR LEVELS (both stores) ================= */
// Par = the least the store should hold. "Make restock request" lists everything below par, topped up to par.
async function parView() {
  const [par, stock] = await Promise.all([db.select('item_par', { eq: { ws: WS() } }), db.select('stock_on_hand', { eq: { ws: WS() } })]);
  const parOf = Object.fromEntries(par.map(x => [x.item_id, num(x.par_qty)])), oh = Object.fromEntries(stock.map(x => [x.item_id, num(x.on_hand)]));
  const edit = can(WS(), 'manager', 'chef'), mayReq = can(WS(), 'storekeeper', 'manager', 'chef');
  const items = S.items.filter(i => i.active !== false);
  const low = items.filter(i => parOf[i.id] > 0 && (oh[i.id] || 0) < parOf[i.id]);
  return `<div class="row"><a href="#/${P()}/stock" class="back">‹ Store</a></div>
   <div class="row"><h1>Par levels</h1><span class="sp"></span>${mayReq ? `<button class="pri" data-act="parPR"${low.length ? '' : ' disabled'}>Make restock request${low.length ? ` (${low.length})` : ''}</button>` : ''}</div>
   <p class="lede">Set the least the ${STORE()} should hold of each item. When stock falls below par, one tap makes a purchase request that tops everything back up — in market order. Leave par blank for items you only buy when needed.</p>
   ${low.length ? `<div class="alert warn"><b>${low.length} item${low.length > 1 ? 's are' : ' is'} below par:</b> ${low.slice(0, 12).map(i => esc(i.name)).join(', ')}${low.length > 12 ? '…' : ''}</div>` : ''}
   <input class="search" placeholder="Find item…" data-filter="#parTable tbody tr:not(.grp)">
   <div class="card tw"><table id="parTable"><thead><tr><th>Item</th><th class="n">On hand</th><th class="n">Par</th></tr></thead><tbody>
   ${shopRows(items, i => i.id, i => parOf[i.id] || 0, 3, i => { const o = oh[i.id] || 0, pq = parOf[i.id];
     return `<tr><td>${esc(i.name)}</td><td class="n ${pq > 0 && o < pq ? 'warn-t' : ''}">${fq(o)} ${esc(i.stock_unit)}</td><td class="n">${edit ? `<input class="qty" type="number" min="0" step="any" data-par="${i.id}" value="${pq || ''}" placeholder="—">` : pq ? fq(pq) : '—'} <span class="unit">${esc(i.stock_unit)}</span></td></tr>`; })}
   </tbody></table></div>
   <p class="small mut">Changes save by themselves. Only a manager or chef can change par levels.</p>`;
}
document.addEventListener('change', async e => {
  const id = e.target.dataset?.par; if (!id) return;
  const v = e.target.value === '' ? 0 : num(e.target.value);
  try { if (v > 0) await db.upsert('item_par', { item_id: id, ws: WS(), par_qty: v }, 'item_id,ws'); else await db.remove('item_par', { item_id: id, ws: WS() }); toast('Par saved'); }
  catch (err) { toast(err.message, true); }
});
ACT.parPR = async el => {
  el.disabled = true;
  try { const r = await db.rpc('generate_par_pr', { p_ws: WS() }); if (!r.pr) { toast('Nothing is below par.'); return refresh(); } toast(`${r.pr}: ${r.lines} items to buy`); go(`#/${P()}/pr/${r.pr_id}`); }
  catch (err) { el.disabled = false; toast(err.message, true); }
};

/* ================= RESTAURANT · KITCHEN STOCKS ================= */
// Daily count of cooked portions per menu dish: Beginning (yesterday's ending) + Cooked − Pull-out − Sold = Ending.
// Each box saves by itself, under the logged-in person's name. Below the low level → on the restock list.
const KFIELDS = [['produced', 'Cooked'], ['pulled_out', 'Pull-out'], ['sold', 'Sold']];
const KPROT_ORDER = ['Chicken', 'Pork', 'Beef', 'Fish & Seafood', 'Veggies and Produce', 'Noodles & Pasta', 'Rice', 'Others'];
const kEnd = r => num(r.beginning) + num(r.produced) - num(r.pulled_out) - num(r.sold);
const kGroups = (rows, by) => { const g = new Map(); const order = by === 'protein' ? KPROT_ORDER : [...new Set(rows.map(r => r.section))];
  rows.forEach(r => { const k = by === 'protein' ? r.protein : r.section; g.has(k) || g.set(k, []); g.get(k).push(r); });
  return [...g].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99)); };
routes['r/kitchen'] = async arg => {
  if (!kCounts()) return `<h1>86 &amp; running low</h1>${await kOut()}`;
  const [tab, dArg] = (arg || 'day').split('/');
  const tabs = [['day', 'Daily count'], ['restock', 'Restock list'], ['week', 'Weekly report'], ...(can('restaurant', 'manager', 'head_chef', 'chef') ? [['dishes', 'Menu, prices & par']] : [])];
  const seg = `<div class="seg">${tabs.map(([k, l]) => `<a href="#/r/kitchen/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const body = tab === 'restock' ? await kRestock(dArg) : tab === 'week' ? await kWeek(dArg) : tab === 'dishes' ? await kDishes() : await kDay(dArg);
  return `<h1>Kitchen stocks</h1>${seg}${body}`;
};
/* Staff, Cashier, Chef and others: the stockist's latest count, as a read-only 86 / running-low list (POS sales today included) */
async function kOut() {
  const d = today(), [rows, days] = await Promise.all([db.rpc('kitchen_sheet', { p_date: d }), db.select('kitchen_days', { cols: 'count_date,saved_by,saved_at,note', order: [['count_date', false]], limit: 1 })]);
  const last = days[0], who = last?.saved_by ? (await db.select('profiles', { cols: 'full_name', eq: { id: last.saved_by } }))[0]?.full_name : (last?.note || '').replace(/^Counted by /, '').replace(/ \(copied from \/ops\)$/, '');
  return k86Html(rows, last, who, d);
}
/* The 86 board: big, colour-coded tiles that read at a glance from across the counter. Refreshes itself every minute. */
function k86Html(rows, last, who, d) {
  const out = rows.filter(r => kEnd(r) <= 0), low = rows.filter(r => kEnd(r) > 0 && kEnd(r) < num(r.min_level)).sort((a, b) => kEnd(a) - kEnd(b));
  const tile = (r, isOut) => `<div class="k86t ${isOut ? 'out' : 'low'}"><span class="k86n">${esc(r.name)}</span><span class="k86v">${isOut ? '86' : fq(kEnd(r))}<small>${isOut ? 'out' : 'left'}</small></span></div>`;
  const when = last ? `${fmtD(last.count_date)}${last.saved_at && last.count_date === d ? ', ' + new Date(last.saved_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''}` : '';
  clearTimeout(S.k86Timer); S.k86Timer = setTimeout(() => { if (location.hash.startsWith('#/r/kitchen')) refresh(); }, 60000);
  return `<div class="k86sum"><span class="k86c out"><b>${out.length}</b> out</span><span class="k86c low"><b>${low.length}</b> running low</span><span class="k86c ok"><b>${rows.length - out.length - low.length}</b> OK</span></div>
   <p class="small mut k86when">Stockist's count${when ? ` · ${esc(when)}` : ''}${who ? ` · ${esc(who)}` : ''}${last && d !== last.count_date ? ' · plus today\'s POS sales' : ''} · updates every minute</p>
   ${out.length ? `<h2 class="k86h out">86 — don't take orders</h2><div class="k86g">${out.map(r => tile(r, true)).join('')}</div>` : '<div class="k86none">Nothing is 86 right now </div>'}
   ${low.length ? `<h2 class="k86h low">Running low — tell the guest it may run out</h2><div class="k86g">${low.map(r => tile(r, false)).join('')}</div>` : ''}`;
}
async function kDay(d) {
  d = d || S.kDate || today(); S.kDate = d;
  const [rows, [day], posDay] = await Promise.all([db.rpc('kitchen_sheet', { p_date: d }), db.select('kitchen_days', { eq: { count_date: d } }), db.select('pos_daily', { eq: { biz_date: d } }).catch(() => [])]);
  const fromPos = num(posDay[0]?.orders) > 0 && !can('restaurant', 'manager');
  S.kRows = Object.fromEntries(rows.map(r => [r.dish_id, r]));
  const by = S.kGroup || 'section', mayEdit = kCounts();
  const low = rows.filter(r => kEnd(r) < num(r.min_level));
  const saver = day?.saved_by ? (await db.select('profiles', { cols: 'full_name', eq: { id: day.saved_by } }))[0]?.full_name : '';
  return `<div class="card"><div class="row wrap"><label class="inline">Date <input type="date" value="${d}" data-kdate max="${today()}"></label>
     <label class="inline">Group by <select data-kgroup>${opt('section', 'Menu section', by === 'section')}${opt('protein', 'Main ingredient', by === 'protein')}</select></label><span class="sp"></span>
     ${day ? `<button class="pdf" data-act="kDayPdf" data-d="${d}" title="One A4 page: counts by menu section, totals and the dishes to cook">Daily report (PDF)</button>` : ''}
     <span class="small mut">${day ? `Started ${saver ? 'by ' + esc(saver) : ''} ${day.note ? '· ' + esc(day.note) : ''}` : 'Not started yet — beginning stock is yesterday\'s ending.'}</span></div></div>
   ${low.length ? `<div class="alert warn"><b>${low.length} dish${low.length > 1 ? 'es are' : ' is'} low</b> (ending below the low level). <a href="#/r/kitchen/restock/${d}">Open the restock list →</a></div>` : ''}
   <input class="search" placeholder="Find a dish…" data-filter=".krow">
   ${kGroups(rows, by).map(([g, list]) => `<section class="card kcard" data-group><h3>${esc(g)}</h3>
     <div class="khead"><span></span><span>Beg</span>${KFIELDS.map(([, l]) => `<span>${l}</span>`).join('')}<span>End</span></div>
     ${list.map(r => { const e = kEnd(r), lowR = e < num(r.min_level);
       return `<div class="krow li" data-kid="${r.dish_id}"><span class="kname">${esc(r.name)}${r.note ? `<small class="mut"> · ${esc(r.note)}</small>` : ''}</span>
         <span class="kbeg">${fq(r.beginning)}</span>
         ${KFIELDS.map(([k]) => `<input type="number" inputmode="numeric" min="0" step="any" class="qty" data-kf="${k}" value="${num(r[k]) || ''}" placeholder="0"${mayEdit && !(k === 'sold' && fromPos) ? '' : ' disabled'}>`).join('')}
         <b class="kend ${e < 0 ? 'bad-t' : lowR ? 'warn-t' : ''}" data-kend>${fq(e)}</b></div>`; }).join('')}</section>`).join('')}
   <p class="small mut">${fromPos ? '<b>Sold comes from the POS today</b> — every paid order adds its dishes here. ' : ''}Each box saves by itself. Beginning comes from the last saved day. Write pull-outs (spoiled, staff meal, tasting) with a note — tap the dish name to add one.</p>`;
}
document.addEventListener('input', e => {
  const k = e.target.dataset?.kf; if (!k) return; const row = e.target.closest('[data-kid]'), r = S.kRows?.[row.dataset.kid]; if (!r) return;
  r[k] = e.target.value; const el = row.querySelector('[data-kend]'), v = kEnd(r); el.textContent = fq(v);
  el.className = 'kend ' + (v < 0 ? 'bad-t' : v < num(r.min_level) ? 'warn-t' : '');
});
document.addEventListener('change', async e => {
  if (e.target.dataset?.kdate !== undefined && e.target.matches('[data-kdate]')) { S.kDate = e.target.value; return go('#/r/kitchen/day/' + e.target.value); }
  if (e.target.matches('[data-kgroup]')) { S.kGroup = e.target.value; return refresh(); }
  const k = e.target.dataset?.kf; if (!k) return;
  const id = e.target.closest('[data-kid]').dataset.kid, r = S.kRows[id];
  try { await kSave(r, k); toast('Saved'); } catch (err) { toast(err.message, true); }
});
// Save only the box that changed, so a sale rung on the POS meanwhile is never overwritten by an older screen
async function kSave(r, field) {
  if (!S.kDayMade?.[S.kDate]) { await db.insert('kitchen_days', { count_date: S.kDate, saved_by: S.user.id }).catch(() => {}); (S.kDayMade ||= {})[S.kDate] = 1; }
  const patch = field === 'note' ? { note: r.note || null } : { [field]: num(r[field]) };
  if (r.saved) await db.update('dish_day_counts', { ...patch, counted_by: S.user.id, updated_at: new Date().toISOString() }, { count_date: S.kDate, dish_id: r.dish_id });
  else { await db.insert('dish_day_counts', { count_date: S.kDate, dish_id: r.dish_id, beginning: num(r.beginning), ...patch, counted_by: S.user.id }).catch(async () =>
    db.update('dish_day_counts', { ...patch, counted_by: S.user.id, updated_at: new Date().toISOString() }, { count_date: S.kDate, dish_id: r.dish_id })); }
  r.saved = true;
}
document.addEventListener('click', async e => {
  const n = e.target.closest('.kname'); if (!n || !kCounts()) return;
  const row = n.closest('[data-kid]'), r = S.kRows?.[row.dataset.kid]; if (!r) return;
  const note = prompt(`Note for ${r.name} (e.g. 2 burnt, staff meal):`, r.note || ''); if (note === null) return;
  r.note = note.trim(); try { await kSave(r, 'note'); toast('Note saved'); refresh(); } catch (err) { toast(err.message, true); }
});
async function kRestock(d) {
  d = d || S.kDate || today();
  const rows = await db.rpc('kitchen_sheet', { p_date: d });
  const need = rows.map(r => ({ ...r, end: kEnd(r) })).filter(r => r.end < num(r.min_level)).map(r => ({ ...r, need: Math.max(num(r.par) - r.end, 0) }));
  return `<div class="card"><div class="row wrap"><label class="inline">Date <input type="date" value="${d}" onchange="location.hash='#/r/kitchen/restock/'+this.value" max="${today()}"></label><span class="sp"></span><button class="pdf" data-act="kDayPdf" data-d="${d}">Daily report (PDF)</button><button class="ghost" onclick="window.print()">Print this list</button></div></div>
   ${need.length ? `<div class="card tw"><h2>To cook — ${esc(fmtD(d))}</h2><p class="small mut">Dishes that ended below their low level. Cook back up to par.</p>
     <table><thead><tr><th>Dish</th><th class="n">Ending</th><th class="n">Par</th><th class="n">Cook</th></tr></thead><tbody>
     ${kGroups(need, 'protein').map(([g, l]) => `<tr class="grp"><td colspan="4">${esc(g)}</td></tr>${l.sort((a, b) => b.need - a.need).map(r => `<tr><td>${esc(r.name)}</td><td class="n ${r.end <= 0 ? 'bad-t' : ''}">${fq(r.end)}</td><td class="n">${fq(r.par)}</td><td class="n"><b>${fq(r.need)}</b></td></tr>`).join('')}`).join('')}
     </tbody></table></div>` : '<div class="empty">Nothing is low. </div>'}`;
}
// date-only arithmetic in UTC so the phone's time zone can't shift the day
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekStart = d => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));   // Monday
async function kWeek(w) {
  const from = weekStart(w || today()), to = addDays(from, 6);
  const rows = await db.select('dish_day_counts', { gte: { count_date: from }, lte: { count_date: to }, order: [['count_date']] });
  const menu = Object.fromEntries((await db.select('restaurant_menu', { cols: 'dish_id,section,protein' })).map(m => [m.dish_id, m]));
  const by = {}; rows.forEach(r => { const x = by[r.dish_id] ||= { id: r.dish_id, start: num(r.beginning), in: 0, out: 0, sold: 0, end: 0, notes: [] };
    x.in += num(r.produced); x.out += num(r.pulled_out); x.sold += num(r.sold); x.end = num(r.ending); if (r.note) x.notes.push(fmtD(r.count_date).split(',')[0] + ': ' + r.note); });
  const list = Object.values(by).map(x => ({ ...x, name: S.dishById[x.id]?.name || '?', section: menu[x.id]?.section || '' })).sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name));
  const days = new Set(rows.map(r => r.count_date)).size, T = k => list.reduce((s, x) => s + x[k], 0);
  const top = list.filter(x => x.sold > 0).slice(0, 5), pulled = list.filter(x => x.out > 0).sort((a, b) => b.out - a.out).slice(0, 5), idle = list.filter(x => !x.sold && (x.start || x.in));
  return `<div class="card"><div class="row wrap"><a class="btn ghost" href="#/r/kitchen/week/${addDays(from, -7)}">‹ Previous</a><b>${esc(fmtD(from))} – ${esc(fmtD(to))}</b>${from < weekStart(today()) ? `<a class="btn ghost" href="#/r/kitchen/week/${addDays(from, 7)}">Next ›</a>` : ''}<span class="sp"></span><span class="small mut">${days} of 7 days counted</span>${days ? `<button class="pdf" data-act="kWeekPdf" data-w="${from}">Weekly report (PDF)</button>` : ''}</div></div>
   ${list.length ? `<div class="kpis"><div class="kpi"><span>Portions sold</span><b>${fq(T('sold'))}</b></div><div class="kpi"><span>Cooked</span><b>${fq(T('in'))}</b></div><div class="kpi ${T('out') ? 'bad' : ''}"><span>Pulled out</span><b>${fq(T('out'))}</b></div></div>
   <div class="two"><div class="card"><h3>Best sellers</h3>${top.map((x, i) => `<div class="mline"><span>${i + 1}. ${esc(x.name)}</span><span class="sp"></span><b>${fq(x.sold)}</b></div>`).join('') || '<span class="mut small">No sales recorded.</span>'}</div>
     <div class="card"><h3>Pulled out — check waste</h3>${pulled.map(x => `<div class="mline"><span>${esc(x.name)}</span><span class="sp"></span><b class="warn-t">${fq(x.out)}</b></div>`).join('') || '<span class="mut small">None.</span>'}</div></div>
   ${idle.length ? `<p class="small mut">In stock but not sold this week: ${idle.map(x => esc(x.name)).join(', ')}</p>` : ''}
   <div class="card tw"><table><thead><tr><th>Dish</th><th class="n">Beg</th><th class="n">Cooked</th><th class="n">Pull-out</th><th class="n">Sold</th><th class="n">End</th></tr></thead><tbody>
   ${list.map(x => `<tr><td>${esc(x.name)}<div class="small mut">${esc(x.section)}${x.notes.length ? ' · ' + esc(x.notes.join(' · ')) : ''}</div></td><td class="n">${fq(x.start)}</td><td class="n">${x.in ? fq(x.in) : ''}</td><td class="n ${x.out ? 'warn-t' : ''}">${x.out ? fq(x.out) : ''}</td><td class="n"><b>${fq(x.sold)}</b></td><td class="n">${fq(x.end)}</td></tr>`).join('')}
   </tbody></table></div>` : '<div class="empty">No counts this week.</div>'}`;
}
/* ================= Kitchen stocks reports (PDF): one A4 page, same layout as the /ops daily and weekly reports ================= */
function kReportHtml(title, sub, stats, groups, notes, extra, needs) {
  const C = { navy: '#1A2C54', gold: '#F6E3B4', orange: '#E89908', cream: '#F3EFE2', line: '#E4DFC8', mut: '#4A5265', red: '#A3271F' };
  const th = 'font-size:7pt;color:' + C.mut + ';text-align:right;font-weight:600;padding:1px 3px;border-bottom:.6pt solid #9C9479';
  const td = 'padding:1.4px 3px;text-align:right;border-bottom:.4pt solid ' + C.line + ';font-size:8.4pt';
  const v = x => x === 0 || x === '' || x == null ? '' : fq(x);
  const tbl = g => `<table style="width:100%;border-collapse:collapse;margin-bottom:5px"><tr><td colspan="6" style="background:${C.gold};border-left:3pt solid ${C.orange};font-weight:700;padding:2px 5px;font-size:8.8pt">${esc(g.cat)}</td></tr>
    <tr><th style="${th};text-align:left;width:44%">Dish</th><th style="${th}">Beg</th><th style="${th}">In</th><th style="${th}">Out</th><th style="${th}">Sold</th><th style="${th}">End</th></tr>
    ${g.rows.map(r => `<tr><td style="${td};text-align:left">${esc(r.name)}${r.n ? ' *' : ''}</td><td style="${td}">${fq(r.b)}</td><td style="${td}">${v(r.i)}</td><td style="${td}">${v(r.o)}</td><td style="${td}"><b>${v(r.s)}</b></td><td style="${td}${r.e < 0 ? ';color:' + C.red : ''}"><b>${fq(r.e)}</b></td></tr>`).join('')}</table>`;
  const hOf = g => g.rows.length + 2.2, prodH = needs?.length ? needs.length + 3 : 0, noteH = notes.length ? notes.length + 1.5 : 0;
  const total = groups.reduce((a, g) => a + hOf(g), 0) + prodH + noteH; let acc = 0; const L = [], R = [];
  groups.forEach(g => { const left = acc + hOf(g) / 2 <= total / 2; (left ? L : R).push(g); if (left) acc += hOf(g); });
  const lh = L.reduce((a, g) => a + hOf(g), 0), rh = R.reduce((a, g) => a + hOf(g), 0), prodLeft = lh <= rh;
  const prod = needs?.length ? `<table style="width:100%;border-collapse:collapse;border:.8pt solid ${C.orange};background:#FFFBF0"><tr><td colspan="4" style="font-weight:700;color:#7A4E00;font-size:8.6pt;padding:3px 5px">For production / purchase request</td></tr>
      <tr><th style="${th};text-align:left">Dish</th><th style="${th}">End</th><th style="${th}">Par</th><th style="${th}">Need</th></tr>
      ${needs.map(r => `<tr><td style="${td};font-size:7.8pt;text-align:left">${esc(r.name)}</td><td style="${td};font-size:7.8pt${r.e <= 0 ? ';color:' + C.red : ''}">${fq(r.e)}</td><td style="${td};font-size:7.8pt">${fq(r.par)}</td><td style="${td};font-size:7.8pt"><b>${fq(r.need)}</b></td></tr>`).join('')}
      <tr><td colspan="4" style="font-size:6.8pt;color:#5B6478;padding:2px 5px">Need = Par − End (dishes below their low level).</td></tr></table>` : '';
  const nts = notes.length ? `<div style="font-size:9pt;font-weight:700;margin:0 0 2px">Notes / remarks</div>${notes.map(n => `<div style="font-size:8.2pt;margin:1px 0">* ${esc(n)}</div>`).join('')}` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,sans-serif;color:#14213F;margin:0}
    .bar{text-align:center;padding:10px;background:#F7F4EA}.bar button{font:600 13px Arial;border:0;border-radius:8px;padding:10px 18px;background:#1A2C54;color:#fff;cursor:pointer;margin:0 4px}.bar .alt{background:#E4DFC8;color:#14213F}@media print{.bar{display:none}}</style></head><body>
    <div class="bar"><button onclick="print()">Save as PDF / Print</button><button class="alt" onclick="close()">Close</button></div>
    <div style="font-size:8.5pt;color:${C.mut};border-bottom:1.5pt solid ${C.navy};padding-bottom:4px;margin-bottom:6px">${sub}</div>
    <table style="width:100%;border-collapse:separate;border-spacing:4px 0;margin:0 -4px 7px"><tr>${stats.map(([l, x]) => `<td style="background:${C.cream};padding:4px 6px"><div style="font-size:7.5pt;color:${C.mut};text-transform:uppercase">${l}</div><div style="font-size:11.5pt;font-weight:700">${x}</div></td>`).join('')}</tr></table>
    ${extra || ''}
    <table style="width:100%;border-collapse:collapse"><tr><td style="width:50%;vertical-align:top;padding-right:3.5mm">${L.map(tbl).join('')}${prodLeft ? prod : ''}${prodLeft ? '' : nts}</td>
      <td style="width:50%;vertical-align:top;padding-left:3.5mm">${R.map(tbl).join('')}${prodLeft ? '' : prod}<div style="margin-top:6px">${prodLeft ? nts : ''}</div></td></tr></table>
    <table style="width:100%;margin-top:14px;font-size:7.5pt;color:${C.mut}"><tr><td style="width:46%;border-top:.7pt solid #14213F;padding-top:2px">Prepared by</td><td style="width:8%"></td><td style="width:46%;border-top:.7pt solid #14213F;padding-top:2px">Checked by</td></tr></table>
    <script>window.onload=function(){setTimeout(function(){print()},400)}<\/script></body></html>`;
}
function kOpenWin() { const w = window.open('', '_blank'); if (!w) toast('Your browser blocked the report window. Allow pop-ups for romualdos.ph.', true); else w.document.write('<p style="font:14px Arial;padding:20px">Preparing the report…</p>'); return w; }
function kShow(w, html) { if (!w) return; w.document.open(); w.document.write(html); w.document.close(); }
const kSecGroups = rows => kGroups(rows, 'section').map(([cat, list]) => ({ cat: cat || 'Others', rows: list }));
ACT.kDayPdf = async el => {
  const d = el.dataset.d || S.kDate || today(), w = kOpenWin(); if (!w) return;
  try {
    const [rows, [day]] = await Promise.all([db.rpc('kitchen_sheet', { p_date: d }), db.select('kitchen_days', { eq: { count_date: d } })]);
    const used = rows.filter(r => r.saved || [r.beginning, r.produced, r.pulled_out, r.sold].some(x => num(x)));
    if (!day && !rows.some(r => r.saved)) { w.close(); return toast(`No count was saved for ${fmtD(d)}.`, true); }
    const whoId = day?.saved_by || (await db.select('dish_day_counts', { cols: 'counted_by', eq: { count_date: d }, order: [['updated_at', false]], limit: 1 }).catch(() => []))[0]?.counted_by;
    const by = (whoId ? (await db.select('profiles', { cols: 'full_name', eq: { id: whoId } }))[0]?.full_name : '') || (day?.note || '').replace(/^Counted by /, '').replace(/ \(copied from \/ops\)$/, '');
    const R = used.map(r => ({ ...r, b: num(r.beginning), i: num(r.produced), o: num(r.pulled_out), s: num(r.sold), e: kEnd(r), n: r.note || '' }));
    const needs = R.filter(r => r.e < num(r.min_level)).map(r => ({ name: r.name, e: r.e, min: num(r.min_level), par: num(r.par), need: Math.max(0, Math.ceil(num(r.par) - r.e)), sort: r.sort }))
      .sort((a, b) => (a.e - a.min) - (b.e - b.min) || a.sort - b.sort);
    const T = k => Math.round(R.reduce((a, r) => a + r[k], 0) * 100) / 100, neg = R.filter(r => r.e < 0).length;
    kShow(w, kReportHtml('Kitchen stocks · ' + d, `${esc(fmtLong(d))} · Encoded by: <b>${esc(by || '—')}</b>`,
      [['Dishes counted', R.length], ['Stock in', T('i')], ['Pulled out', T('o')], ['Sold', T('s')], ['Ending stock', T('e')], ...(neg ? [['Below zero', neg]] : [])],
      kSecGroups(R), R.filter(r => r.n).map(r => r.name + ': ' + r.n), '', needs));
  } catch (err) { w.close(); toast(err.message, true); }
};
ACT.kWeekPdf = async el => {
  const from = weekStart(el.dataset.w || today()), to = addDays(from, 6), w = kOpenWin(); if (!w) return;
  try {
    const [rows, menu] = await Promise.all([db.select('dish_day_counts', { gte: { count_date: from }, lte: { count_date: to }, order: [['count_date']] }), db.select('restaurant_menu', { cols: 'dish_id,section,protein,sort' })]);
    if (!rows.length) { w.close(); return toast('No daily counts saved for this week.', true); }
    const M = Object.fromEntries(menu.map(m => [m.dish_id, m])), by = {};
    rows.forEach(r => { const x = by[r.dish_id] ||= { b: num(r.beginning), i: 0, o: 0, s: 0, e: 0, notes: [] };
      x.i += num(r.produced); x.o += num(r.pulled_out); x.s += num(r.sold); x.e = num(r.ending); if (r.note) x.notes.push(fmtD(r.count_date).split(',')[0] + ': ' + r.note); });
    const list = Object.entries(by).map(([id, x]) => ({ ...x, name: S.dishById[id]?.name || '?', section: M[id]?.section || 'Others', sort: M[id]?.sort ?? 999, n: x.notes.join('; ') }));
    const days = [...new Set(rows.map(r => r.count_date))], missing = []; for (let d = from; d <= to && d <= today(); d = addDays(d, 1)) if (!days.includes(d)) missing.push(d);
    const top = [...list].filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 5), po = list.filter(r => r.o > 0).sort((a, b) => b.o - a.o).slice(0, 5), slow = list.filter(r => !r.s && (r.b || r.i));
    const T = k => Math.round(list.reduce((a, r) => a + r[k], 0) * 100) / 100;
    const extra = `<table style="width:100%;border-collapse:collapse;margin-bottom:6px;font-size:8.4pt"><tr><td style="width:50%;vertical-align:top;padding-right:3.5mm"><div style="font-size:9pt;font-weight:700">Best sellers</div>${top.map((r, i) => `<div>${i + 1}. ${esc(r.name)} — <b>${fq(r.s)}</b></div>`).join('') || '<div>None</div>'}</td>
      <td style="width:50%;vertical-align:top;padding-left:3.5mm"><div style="font-size:9pt;font-weight:700">Most pulled out</div>${po.map((r, i) => `<div>${i + 1}. ${esc(r.name)} — <b>${fq(r.o)}</b></div>`).join('') || '<div>None</div>'}${slow.length ? `<div style="margin-top:3px"><b>Not sold this week:</b> ${slow.map(r => esc(r.name)).join(', ')}</div>` : ''}</td></tr></table>`;
    kShow(w, kReportHtml('KITCHEN STOCKS · WEEKLY REPORT', `<b>Kitchen stocks · weekly report</b> · ${esc(fmtD(from))} – ${esc(fmtD(to))} · ${days.length} day${days.length === 1 ? '' : 's'} counted${missing.length ? ' · missing ' + missing.map(x => esc(fmtD(x).split(', ').slice(0, 2).join(' '))).join(', ') : ''}`,
      [['Dishes', list.length], ['Stock in', T('i')], ['Pulled out', T('o')], ['Sold', T('s')], ['Ending stock', T('e')]],
      kSecGroups(list.sort((a, b) => a.sort - b.sort)), list.filter(r => r.n).map(r => r.name + ' — ' + r.n), extra, null));
  } catch (err) { w.close(); toast(err.message, true); }
};

async function kDishes() {
  const rows = await db.select('restaurant_menu', { order: [['sort']] });
  const sections = [...new Set(rows.map(r => r.section))];
  const noPrice = rows.filter(r => r.on_pos && r.price == null).length;
  return `<p class="lede">Everything sold at the restaurant. <b>Price</b> is what the POS charges. <b>Counted</b> = included in the daily Kitchen stocks count (cooked dishes); drinks, rice and add-ons are usually on the POS but not counted. <b>Par</b> = cook back up to this many portions; <b>Low</b> = below this it goes on the restock list. Changes save by themselves.</p>
   ${noPrice ? `<div class="alert warn"><b>${noPrice} item${noPrice > 1 ? 's have' : ' has'} no price yet</b> — they can't be rung up on the POS until a price is set.</div>` : ''}
   <input class="search" placeholder="Find…" data-filter="#rmTable tbody tr">
   <div class="card tw"><table id="rmTable"><thead><tr><th>Item</th><th>Menu section</th><th>Main ingredient</th><th class="n">Price ₱</th><th class="n">On POS</th><th class="n">Counted</th><th class="n">Par</th><th class="n">Low</th></tr></thead><tbody>
   ${rows.map(r => `<tr data-rm="${r.dish_id}"><td>${esc(S.dishById[r.dish_id]?.name || '?')}</td>
     <td><input list="dl-sec" data-rmf="section" value="${esc(r.section)}"></td><td><select data-rmf="protein">${KPROT_ORDER.map(p => opt(p, p, p === r.protein)).join('')}</select></td>
     <td class="n"><input class="qty ${r.on_pos && r.price == null ? 'need' : ''}" type="number" min="0" step="any" data-rmf="price" value="${r.price ?? ''}" placeholder="—"></td>
     <td class="n"><input type="checkbox" data-rmf="on_pos" ${r.on_pos ? 'checked' : ''}></td><td class="n"><input type="checkbox" data-rmf="active" ${r.active ? 'checked' : ''}></td>
     <td class="n"><input class="qty" type="number" min="0" step="1" data-rmf="par" value="${num(r.par)}"></td><td class="n"><input class="qty" type="number" min="0" step="1" data-rmf="min_level" value="${num(r.min_level)}"></td></tr>`).join('')}
   </tbody></table><datalist id="dl-sec">${sections.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
   <form class="card addline" data-form="addKDish"><input name="name" placeholder="Add an item (dish, drink, rice, add-on)" list="dl-dishes-all" required><input name="section" list="dl-sec" placeholder="Menu section" required><input name="price" type="number" min="0" step="any" placeholder="Price ₱" class="qty"><label class="tick"><input type="checkbox" name="counted" checked> Counted daily</label><button class="pri">Add</button></form>
   <datalist id="dl-dishes-all">${S.dishes.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist>`;
}
document.addEventListener('change', async e => {
  const f = e.target.dataset?.rmf; if (!f) return; const id = e.target.closest('[data-rm]').dataset.rm;
  const v = ['active', 'on_pos'].includes(f) ? e.target.checked : f === 'price' ? (e.target.value === '' ? null : num(e.target.value)) : ['par', 'min_level'].includes(f) ? num(e.target.value) : e.target.value.trim();
  try { await db.update('restaurant_menu', { [f]: v }, { dish_id: id }); toast('Saved'); } catch (err) { toast(err.message, true); }
});
FORMS.addKDish = async f => {
  let id = S.dishes.find(d => d.name.toLowerCase() === f.name.trim().toLowerCase())?.id;
  if (!id) id = (await db.insert('dishes', { name: f.name.trim(), category: 'Others', course: 'Main', sold_as: ['restaurant'] }))[0].id;
  const max = (await db.select('restaurant_menu', { cols: 'sort', order: [['sort', false]], limit: 1 }))[0]?.sort || 0;
  await db.upsert('restaurant_menu', { dish_id: id, section: f.section.trim(), sort: max + 10, active: !!f.counted, on_pos: true, price: f.price === '' || f.price == null ? null : num(f.price) }, 'dish_id');
  await loadMaster(); toast('Added to the daily count'); refresh();
};

/* ================= RESTAURANT · POS (order taking) ================= */
// Tablet POS laid out like the common café POS: dark menu grid on the left, the bill on the right.
// Tap dishes → tap cash notes → Charge. Each tile shows the portions left from today's kitchen count.
// Prices, service charge and Senior/PWD discounts are worked out by the database; paying adds the dishes to the kitchen's Sold.
// The BIR invoice still comes from the registered POS — the slip printed here says so.
const POS = { order: null, menu: [], sec: 'All', q: '', t: null, busy: false, settings: null, shift: null, tab: undefined, cash: 0, left: {}, drawer: false, search: false, ver: 0, saved: 0 };   // ver/saved: edits made vs. edits stored
const KIND_L = { dine_in: 'Dine-in', take_out: 'Take-out', delivery: 'Delivery' };
const KIND_I = { dine_in: IC.plate(16), take_out: IC.bag(16), delivery: IC.bike(16) };
const PROT_C = { Chicken: '#e8a33d', Pork: '#d9577a', Beef: '#c2412d', 'Fish & Seafood': '#3b8fd9', 'Veggies and Produce': '#46a35a', 'Noodles & Pasta': '#9b6ad8', Rice: '#b8ab8a', Others: '#7d8597' };
const posCan = () => can('restaurant', 'cashier', 'manager', 'staff');
const posCash = () => can('restaurant', 'cashier', 'manager');
function posBlank() { return { id: null, kind: 'dine_in', table_no: '', pax: 1, seniors: 0, customer: '', note: '', lines: [], subtotal: 0, sc_amount: 0, discount: 0, total: 0, order_no: null }; }
function posTotals(o) {   // preview while tapping; the database recalculates on every save
  const st = POS.settings || { sc_rate: 10, senior_pct: 20 }, sub = o.lines.reduce((a, l) => a + num(l.qty) * num(l.price), 0);
  const sc = o.kind === 'dine_in' ? Math.round(sub * num(st.sc_rate)) / 100 : 0;
  const disc = o.seniors > 0 ? Math.round(sub * Math.min(o.seniors, o.pax) / Math.max(o.pax, 1) * num(st.senior_pct)) / 100 : 0;
  return { sub, sc, disc, total: Math.round((sub + sc - disc) * 100) / 100 };
}
routes['r/pos'] = async arg => {
  if (!can('restaurant', 'cashier', 'manager', 'staff')) return '<div class="card">The POS is for cashiers and restaurant staff. <a href="#/reservations">Reservations</a> · <a href="#/r/kitchen">86 &amp; running low</a></div>';
  if (!posCan()) return '<div class="card">The POS is for cashiers, servers and managers. Ask the owner to add the Cashier or Staff job in Restaurant.</div>';
  const dev = await db.rpc('pos_device_status').catch(() => ({ registered: true }));   // before the database update: no lock yet
  if (!dev.registered && !isAdmin()) return `<div class="card"><h2>This device isn't a POS tablet</h2>
    <p>The POS works only on the restaurant's registered tablet, so sales can't be rung up from personal phones.</p>
    <p class="small mut">Owner: to make this tablet a POS, open <b>People → POS tablets</b> on this tablet and tap <b>Register this device</b>.</p>
    <div class="row" style="flex-wrap:wrap;gap:8px"><a class="btn" href="#/r/sales">Sales today</a><a class="btn ghost" href="#/r/kitchen">Kitchen stocks</a><a class="btn ghost" href="#/">Home</a></div></div>`;
  if (!dev.registered && !POS.ownerNoted) { POS.ownerNoted = true; setTimeout(() => toast('Owner access: this device isn\'t a registered POS tablet.'), 300); }
  const [menu, [st], [shift], open, sheet] = await Promise.all([
    db.select('restaurant_menu', { eq: { on_pos: true }, order: [['sort']] }), db.select('pos_settings'),
    db.select('pos_shifts', { order: [['opened_at', false]], limit: 1 }), db.select('pos_orders', { eq: { status: 'open' }, order: [['opened_at']] }),
    db.rpc('kitchen_sheet', { p_date: today() }).catch(() => [])]);
  POS.menu = menu.map(m => ({ ...m, name: S.dishById[m.dish_id]?.name || '?' })); POS.settings = st; POS.shift = shift && !shift.closed_at ? shift : null; POS.open = open;
  POS.left = Object.fromEntries(sheet.map(r => [r.dish_id, num(r.ending)]));      // portions left per counted dish
  if (arg && arg !== 'new') { const [o] = await db.select('pos_orders', { eq: { id: arg } }); POS.order = o && o.status === 'open' ? { ...o, lines: await db.select('pos_lines', { eq: { order_id: arg }, order: [['created_at']] }) } : posBlank(); POS.cash = 0; POS.saved = POS.ver; }
  else if (arg === 'new' || !POS.order || (POS.order.id && !open.some(o => o.id === POS.order.id))) { POS.order = posBlank(); POS.cash = 0; POS.saved = POS.ver; }
  POS.drawer = false;
  return posHtml();
};
function posLeft(m) {   // portions left after what is already on this order (null = dish not counted)
  if (!(m.dish_id in POS.left) || !m.active) return null;
  const onOrder = POS.order.lines.filter(l => l.dish_id === m.dish_id).reduce((a, l) => a + num(l.qty), 0);
  return POS.left[m.dish_id] - onOrder;
}
function posSum(o) {
  const T = posTotals(o), change = POS.cash - T.total, short = POS.cash && change < 0;
  return `<div class="p-sum">
    <div class="ps-row"><span>Subtotal</span><span>${peso(T.sub)}</span></div>
    ${T.sc ? `<div class="ps-row"><span>Service charge ${fq(POS.settings?.sc_rate ?? 10)}%</span><span>${peso(T.sc)}</span></div>` : ''}
    ${T.disc ? `<div class="ps-row disc"><span>Senior / PWD (${o.seniors} of ${o.pax})</span><span>−${peso(T.disc)}</span></div>` : ''}
    <div class="ps-total"><span>Total</span><b>${peso(T.total)}</b></div>
    ${POS.cash ? `<div class="ps-cash ${short ? 'short' : ''}"><span>Cash ${peso(POS.cash)}</span><b>${short ? 'Still due ' + peso(-change) : 'Change ' + peso(change)}</b></div>` : ''}
  </div>`;
}
const POS_LOW = 3;   // "only a few left" warning on the tile
function posTile(m, o) {
  const left = posLeft(m), inO = o.lines.filter(l => l.dish_id === m.dish_id).reduce((a, l) => a + num(l.qty), 0);
  const out = left !== null && left <= 0, low = left !== null && left > 0 && left <= POS_LOW;
  const stock = left === null ? '' : out ? '<span class="st out">Sold out</span>' : `<span class="st ${low ? 'low' : ''}">${fq(left)} left</span>`;
  return `<button type="button" class="p-tile${out ? ' out' : ''}${inO ? ' in' : ''}" style="--c:${PROT_C[m.protein] || PROT_C.Others}" data-posadd="${m.dish_id}" title="${esc(m.name)}">
    ${inO ? `<i class="q">${fq(inO)}</i>` : ''}<b class="nm">${esc(m.name)}</b><span class="ft"><span class="pr">${peso(m.price).replace('.00', '')}</span>${stock}</span></button>`;
}
function posHtml() {
  const o = POS.order, T = posTotals(o), first = nick();
  if (POS.tab === 'service') POS.tab = 'change';
  if (POS.tab === undefined) POS.tab = innerHeight > 820 ? 'change' : null;   // short tablets: keypad folded until Cash is tapped
  const priced = POS.menu.filter(m => m.price != null), unpriced = POS.menu.length - priced.length;
  const secs = [...new Set(priced.map(m => m.section))];
  const q = POS.q.trim().toLowerCase();
  const items = priced.filter(m => (q ? m.name.toLowerCase().includes(q) : POS.sec === 'All' || m.section === POS.sec));
  const nItems = o.lines.reduce((a, l) => a + num(l.qty), 0), unsent = o.lines.filter(l => !l.sent_at).reduce((a, l) => a + num(l.qty), 0);
  const nextNo = o.order_no || (POS.open.reduce((a, x) => Math.max(a, x.order_no), 0) + 1);
  // All, no search: the menu's own sections as headings, in menu order (staff find dishes where the printed menu has them)
  const grid = q || POS.sec !== 'All' ? items.map(m => posTile(m, o)).join('')
    : secs.map(s => { const l = items.filter(m => m.section === s); return l.length ? `<h4 class="p-sec">${esc(s)}<span>${l.length}</span></h4>${l.map(m => posTile(m, o)).join('')}` : ''; }).join('');
  const tabBody = {
    change: `<div class="notes">${[20, 50, 100, 200, 500, 1000].map((v, i) => `<button type="button" class="note n${i}" data-posnote-cash="${v}">₱${v.toLocaleString()}</button>`).join('')}
       <button type="button" class="note exact" data-posnote-cash="exact">Exact</button><button type="button" class="note clr" data-posnote-cash="0" title="Clear the cash">Clear</button>
       <label class="note-in"><span>₱</span><input type="text" inputmode="decimal" autocomplete="off" placeholder="Type the cash received" data-poscashin value="${POS.cash ? String(+POS.cash.toFixed(2)) : ''}"></label></div>`,
    discount: `<div class="ptab-grid"><label>Guests<span class="step"><button type="button" data-posstep="pax|-1">−</button><b>${o.pax}</b><button type="button" data-posstep="pax|1">＋</button></span></label>
       <label>Senior / PWD<span class="step"><button type="button" data-posstep="seniors|-1">−</button><b>${o.seniors}</b><button type="button" data-posstep="seniors|1">＋</button></span></label>
       <p class="small mut">${fq(POS.settings?.senior_pct ?? 20)}% off each Senior/PWD's share of the bill. Check their ID.</p></div>`,
    print: `<div class="ptab-grid two"><button type="button" class="pbtn" data-act="posPreBill"${o.lines.length ? '' : ' disabled'}>Print bill</button>
       <button type="button" class="pbtn" data-act="posBill"${o.lines.length && posCash() ? '' : ' disabled'}>Card / split</button>${o.id && (!o.lines.some(l => l.sent_at) || can('restaurant', 'manager')) ? '<button type="button" class="pbtn danger" data-act="posVoid">✕ Void order</button>' : ''}</div>`
  }[POS.tab] || '';
  return `<div class="pos2 pos3">
   <div class="p-left">
    <div class="p-bar"><button type="button" class="ic" data-posdrawer title="Open orders and menu">☰</button><span class="p-brand">R</span>
     <div class="p-tabs">${['All', ...secs].map(x => `<button type="button" class="${!q && POS.sec === x ? 'on' : ''}" data-possec="${esc(x)}">${esc(x)}<em>${x === 'All' ? priced.length : priced.filter(m => m.section === x).length}</em></button>`).join('')}</div>
     <label class="p-find${q ? ' on' : ''}"><span>⌕</span><input placeholder="Find a dish  ( / )" value="${esc(POS.q)}" data-posq autocomplete="off">${q ? '<button type="button" class="clrq" data-posqclear title="Clear">✕</button>' : ''}</label></div>
    <div class="p-grid">${grid || (posEditor() ? '' : `<div class="p-empty">${q ? `No dish matches “${esc(POS.q)}”.` : 'No dishes here.'}</div>`)}
     ${posEditor() && !q ? '<button type="button" class="p-tile add" data-act="posNewItem"><b>＋</b><small>Add item</small></button>' : ''}</div>
    <div class="p-foot"><span class="lg"><i style="--c:${PROT_C.Chicken}"></i>Chicken<i style="--c:${PROT_C.Pork}"></i>Pork<i style="--c:${PROT_C.Beef}"></i>Beef<i style="--c:${PROT_C['Fish & Seafood']}"></i>Seafood<i style="--c:${PROT_C['Veggies and Produce']}"></i>Veggies<i style="--c:${PROT_C['Noodles & Pasta']}"></i>Noodles</span>
     <span class="sp"></span>${unpriced ? `<span>${unpriced} hidden — no price yet${can('restaurant', 'manager', 'chef') ? ' · <a href="#/r/kitchen/dishes">set prices</a>' : ''}</span>` : ''}</div>
   </div>
   <div class="p-right">
    <div class="p-head"><div class="p-ono"><small>${o.id ? 'Order' : 'New order'}</small><b>#${nextNo}</b></div>
     <div class="p-kind">${Object.entries(KIND_L).map(([k, l]) => `<button type="button" class="${o.kind === k ? 'on' : ''}" data-poskind="${k}"><span>${KIND_I[k]}</span>${l}</button>`).join('')}</div></div>
    <div class="p-meta">${o.kind === 'dine_in' ? `<label>Table<input data-posf="table_no" value="${esc(o.table_no || '')}" inputmode="numeric" placeholder="—"></label>` : `<label class="wide">Name<input data-posf="customer" value="${esc(o.customer || '')}" placeholder="Customer"></label>`}
     <span class="who">${esc(first)}</span>${POS.shift ? '<span class="dr ok">Drawer open</span>' : posCash() ? '<button type="button" class="dr btn" data-act="posShift">Open drawer</button>' : '<span class="dr">Drawer closed</span>'}</div>
    ${POS.open.filter(x => x.id !== o.id).length ? `<div class="p-open">${POS.open.filter(x => x.id !== o.id).map(x => `<a href="#/r/pos/${x.id}" title="Switch to this order"><b>${x.table_no ? 'T' + esc(x.table_no) : '#' + x.order_no}</b>${KIND_I[x.kind]} ${peso(x.total).replace('.00', '')}</a>`).join('')}<a href="#/r/pos/new" class="new" title="New order">＋</a></div>` : ''}
    <div class="p-items"><span>${fq(nItems)} item${nItems === 1 ? '' : 's'}</span>${unsent && o.lines.some(l => l.sent_at) ? `<span class="chip warn">${fq(unsent)} not sent yet</span>` : ''}<span class="sp"></span>${o.lines.length && !o.lines.some(l => l.sent_at) ? '<button type="button" class="lnk" data-posclear>Clear order</button>' : ''}</div>
    <div class="p-lines">${o.lines.length ? o.lines.map((l, i) => `<div class="pl ${l.sent_at ? 'sent' : ''}${POS.flash === l.dish_id && !l.sent_at ? ' flash' : ''}"><div class="pl-n" data-posnote="${i}"><b>${esc(l.name)}</b><small class="u">${peso(l.price).replace('.00', '')} each${l.sent_at ? ' · <span class="k">sent</span>' : ''}</small>${l.note ? `<small class="nt">✎ ${esc(l.note)}</small>` : '<small class="add">+ note</small>'}</div>
       <span class="step sm"><button type="button" data-posqty="${i}|-1" aria-label="One less">−</button><b>${fq(l.qty)}</b><button type="button" data-posqty="${i}|1" aria-label="One more">＋</button></span><span class="pl-a">${peso(num(l.qty) * num(l.price)).replace('.00', '')}</span></div>`).join('')
      : `<div class="p-tap"><div class="p-circle">${IC.plate(34)}</div><b>Tap a dish to start order #${nextNo}</b><span>${KIND_L[o.kind]}${o.kind === 'dine_in' ? ' · set the table above' : ''}</span></div>`}</div>
    ${posSum(o)}
    <div class="p-tabs2">${[['change', 'Cash'], ['discount', 'Senior / PWD'], ['print', '⋯ More']].map(([k, l]) => `<button type="button" class="${POS.tab === k ? 'on' : ''}" data-postab="${k}">${l}${k === 'discount' && o.seniors ? ` <em>${o.seniors}</em>` : ''}</button>`).join('')}</div>
    ${tabBody ? `<div class="p-tabbody">${tabBody}</div>` : ''}
    <div class="p-act"><button type="button" class="send" data-act="posSend"${unsent ? '' : ' disabled'}>Send${unsent ? ` <em>${fq(unsent)}</em>` : ''}</button>
     <button type="button" class="charge" data-act="posCharge"${o.lines.length && posCash() ? '' : ' disabled'}>Charge <b>${peso(T.total).replace('.00', '')}</b></button><button type="button" class="gcash" data-act="posGcash"${o.lines.length && posCash() ? '' : ' disabled'}>GCash</button></div>
   </div>
   ${POS.drawer ? `<div class="p-drawer" data-posdrawer-bg><div class="p-dpanel"><h2>Open orders</h2>
     ${POS.open.map(x => `<a class="otab ${x.id === o.id ? 'on' : ''}" href="#/r/pos/${x.id}"><b>${x.table_no ? 'Table ' + esc(x.table_no) : '#' + x.order_no + ' · ' + KIND_L[x.kind]}</b><small>${peso(x.total)}</small></a>`).join('') || '<p class="mut small">No open orders.</p>'}
     <a class="btn pri" href="#/r/pos/new">＋ New order</a><hr>
     ${posEditor() ? '<a href="javascript:void 0" data-act="posNewItem">＋ Add an item to the POS</a>' : ''}<a href="#/r/sales">Sales today</a><a href="#/r/kitchen">Kitchen stocks</a>${POS.shift && posCash() ? '<a href="#/r/sales">Close the cash drawer</a>' : ''}<a href="#/">Exit POS</a></div></div>` : ''}
  </div>`;
}
// Re-draw without losing the menu or bill scroll position; a just-added line glows for a moment
function posPaint() {
  const g = $('.p-grid')?.scrollTop || 0, l = $('.p-lines')?.scrollTop || 0;
  $('#main').innerHTML = posHtml();
  const G = $('.p-grid'), L = $('.p-lines'); if (G) G.scrollTop = g;
  if (L) { const f = L.querySelector('.pl.flash'); if (f && POS.flashNew) f.scrollIntoView({ block: 'nearest' }); else L.scrollTop = l; }
  POS.flashNew = false;
}
function posQueueSave() { POS.ver++; clearTimeout(POS.t); POS.t = setTimeout(() => posSave().catch(err => toast(err.message, true)), 700); }
async function posSave() {
  clearTimeout(POS.t); const o = POS.order; if (!o.id && !o.lines.length) return o;
  while (POS.busy) await new Promise(r => setTimeout(r, 120));
  POS.busy = true; const v = POS.ver;
  try {
    const r = await db.rpc('pos_save', { p: { id: o.id, kind: o.kind, table_no: o.table_no, pax: o.pax, seniors: o.seniors, customer: o.customer, note: o.note,
      lines: o.lines.map(l => ({ id: l.id || null, dish_id: l.dish_id, qty: num(l.qty), note: l.note || '' })) } });
    const lines = await db.select('pos_lines', { eq: { order_id: r.id }, order: [['created_at']] });
    const wasNew = !o.id; POS.order = { ...r, lines }; POS.saved = Math.max(POS.saved, v);
    if (wasNew) { history.replaceState(null, '', '#/r/pos/' + r.id); POS.open = await db.select('pos_orders', { eq: { status: 'open' }, order: [['opened_at']] }); }
    else POS.open = POS.open.map(x => x.id === r.id ? r : x);
    if (!$('[data-posq]') || document.activeElement !== $('[data-posq]')) posPaint();
    return POS.order;
  } finally { POS.busy = false; }
}
document.addEventListener('click', async e => {
  if (!current.startsWith('r/pos')) return;
  if (e.target.matches('[data-posdrawer-bg]')) { POS.drawer = false; return posPaint(); }
  const b = e.target.closest('button,[data-posnote]'); if (!b) return; const o = POS.order;
  if (b.dataset.posdrawer !== undefined) { POS.drawer = true; return posPaint(); }
  if (b.dataset.possearch !== undefined) { POS.search = !POS.search; if (!POS.search) POS.q = ''; posPaint(); return $('[data-posq]')?.focus(); }
  if (b.dataset.possec) { POS.sec = b.dataset.possec; POS.q = ''; $('.p-grid') && ($('.p-grid').scrollTop = 0); posPaint(); $('.p-grid').scrollTop = 0; return; }
  if (b.dataset.posqclear !== undefined) { POS.q = ''; posPaint(); return $('[data-posq]')?.focus(); }
  if (b.dataset.postab) { POS.tab = POS.tab === b.dataset.postab ? null : b.dataset.postab; return posPaint(); }
  if (b.dataset.posclear !== undefined) { if (!confirm('Clear this order?')) return; o.lines = []; POS.cash = 0; posPaint(); return o.id ? posQueueSave() : null; }
  if (b.dataset.posnoteCash !== undefined) { const v = b.dataset.posnoteCash; POS.cash = v === 'exact' ? posTotals(o).total : v === '0' ? 0 : POS.cash + Number(v); return posPaint(); }
  if (b.dataset.posadd) { const m = POS.menu.find(x => x.dish_id === b.dataset.posadd), left = posLeft(m);
    if (left !== null && left <= 0 && !confirm(`${m.name} shows 0 portions left in the kitchen count. Add it anyway?`)) return;
    const l = o.lines.find(x => x.dish_id === m.dish_id && !x.sent_at && !x.note);
    if (l) l.qty = num(l.qty) + 1; else o.lines.push({ dish_id: m.dish_id, name: m.name, price: m.price, qty: 1 }); POS.flash = m.dish_id; POS.flashNew = true; clearTimeout(POS.ft); POS.ft = setTimeout(() => { POS.flash = null; document.querySelector('.pl.flash')?.classList.remove('flash'); }, 900); posPaint(); return posQueueSave(); }
  if (b.dataset.posqty) { const [i, d] = b.dataset.posqty.split('|').map(Number), l = o.lines[i]; const nq = num(l.qty) + d;
    if (l.sent_at && d < 0 && !can('restaurant', 'manager')) return toast('This dish is already with the kitchen — ask a manager to reduce it.', true);
    if (nq <= 0) o.lines.splice(i, 1); else l.qty = nq; posPaint(); return posQueueSave(); }
  if (b.dataset.posstep) { const [f, d] = b.dataset.posstep.split('|'); o[f] = Math.max(num(o[f]) + Number(d), f === 'pax' ? 1 : 0); if (o.seniors > o.pax) o.seniors = o.pax; posPaint(); return posQueueSave(); }
  if (b.dataset.poskind) { o.kind = b.dataset.poskind; posPaint(); return posQueueSave(); }
  if (b.dataset.posnote !== undefined) { const l = o.lines[b.dataset.posnote]; const n = prompt(`Note for ${l.name} (no onions, extra sauce…):`, l.note || ''); if (n === null) return; l.note = n.trim(); posPaint(); return posQueueSave(); }
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-posq]')) { POS.q = e.target.value; const pos = e.target.selectionStart; posPaint(); const i = $('[data-posq]'); i.focus(); i.setSelectionRange(pos, pos); }
  if (e.target.matches('[data-poscashin]')) {
    const i = e.target; let v = i.value.replace(/[^0-9.]/g, '').replace(/^0+(?=\d)/, ''); const d = v.indexOf('.'); if (d >= 0) v = v.slice(0, d + 1) + v.slice(d + 1).replace(/\./g, '').slice(0, 2);
    if (v !== i.value) i.value = v; POS.cash = num(v); const sum = $('.p-sum'); if (sum) sum.outerHTML = posSum(POS.order); }
});
document.addEventListener('keydown', e => {
  if (!current.startsWith('r/pos')) return;
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === '/' && !inField) { e.preventDefault(); $('[data-posq]')?.focus(); }
  if (e.key === 'Escape' && document.activeElement?.matches('[data-posq]')) { POS.q = ''; posPaint(); }
  if (e.key === 'Enter' && document.activeElement?.matches('[data-posq]')) { const t = $('.p-grid .p-tile:not(.out):not(.add)'); if (t) { t.click(); POS.q = ''; posPaint(); $('[data-posq]')?.focus(); } }
});
document.addEventListener('change', e => { const f = e.target.dataset?.posf; if (f && POS.order) { POS.order[f] = e.target.value.trim(); posQueueSave(); } });

// ---- add an item (or change a price) straight from the POS — managers and chefs ----
const posEditor = () => can('restaurant', 'manager', 'chef');
const PROT_CAT = { Chicken: 'Chicken', Pork: 'Pork', Beef: 'Beef', 'Fish & Seafood': 'Seafood', 'Veggies and Produce': 'Vegetables', Rice: 'Rice', 'Noodles & Pasta': 'Pasta & noodles', Others: 'Others' };
ACT.posNewItem = async (el, e) => {
  if (!posEditor()) return toast('Only a manager or chef can add items.', true);
  POS.drawer = false; posPaint();
  const secs = [...new Set(POS.menu.map(m => m.section))], sec0 = POS.sec !== 'All' ? POS.sec : '';
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<form class="card" id="newItemForm"><div class="row"><h2>Add an item</h2><span class="sp"></span><button type="button" class="x" data-close>✕</button></div>
    <div class="grid"><label>Name<input name="name" list="dl-allitems" required autocomplete="off" placeholder="e.g. Extra Rice"></label><label>Price ₱<input name="price" type="number" min="0" step="any" inputmode="decimal" required></label>
     <label>Menu section<select name="section">${secs.map(x => opt(x, x, x === sec0)).join('')}${opt('__new', '＋ New section…')}</select></label><label class="newsec" hidden>New section name<input name="newsec" placeholder="e.g. Add-ons"></label>
     <label>Main ingredient<select name="protein">${KPROT_ORDER.map(x => opt(x, x, x === 'Others')).join('')}</select></label>
     <label class="tick"><input type="checkbox" name="counted"> Count it in the daily Kitchen stocks (cooked dishes; leave off for drinks, rice, add-ons)</label></div>
    <p class="small mut" id="niHint"></p>
    <div class="row end"><button type="button" class="ghost" data-close>Cancel</button><button class="pri big">Save</button></div></form>
    <datalist id="dl-allitems">${S.dishes.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist>`;
  document.body.appendChild(box);
  const f = box.querySelector('form'); f.name.focus();
  const hint = () => { const n = f.name.value.trim().toLowerCase(), m = POS.menu.find(x => x.name.toLowerCase() === n);
    $('#niHint').innerHTML = m ? `<b>${esc(m.name)}</b> is already on the POS at ${peso(m.price ?? 0)} (${esc(m.section)}). Saving changes its price and section.` : ''; };
  f.name.addEventListener('input', hint);
  f.section.addEventListener('change', () => { box.querySelector('.newsec').hidden = f.section.value !== '__new'; if (f.section.value === '__new') f.newsec.focus(); });
  box.addEventListener('click', ev => { if (ev.target.dataset.close !== undefined) box.remove(); });
  f.addEventListener('submit', async ev => {
    ev.preventDefault(); const name = f.name.value.trim().replace(/\s+/g, ' '), price = num(f.price.value);
    const section = f.section.value === '__new' ? f.newsec.value.trim() : f.section.value;
    if (!name || !(price >= 0) || f.price.value === '') return toast('Type the name and the price.', true);
    if (!section) return toast('Choose or type the menu section.', true);
    try {
      let id = S.dishes.find(d => d.name.toLowerCase() === name.toLowerCase())?.id;
      if (!id) id = (await db.insert('dishes', { name, category: PROT_CAT[f.protein.value] || 'Others', course: 'Main', sold_as: ['restaurant'] }))[0].id;
      const existing = POS.menu.find(m => m.dish_id === id);
      const inSec = POS.menu.filter(m => m.section === section).map(m => m.sort);
      const sort = existing ? existing.sort : inSec.length ? Math.max(...inSec) + 1 : Math.max(0, ...POS.menu.map(m => m.sort)) + 1000;   // end of its section, or a new section last
      await db.upsert('restaurant_menu', { dish_id: id, section, protein: f.protein.value, price, on_pos: true, active: !!f.counted.checked, sort }, 'dish_id');
      box.remove(); await loadMaster(); POS.sec = section;
      toast(existing ? `${name}: price updated to ${peso(price)}` : `${name} added — tap it to ring it up`);
      const keep = POS.order; await route(); if (keep?.id) POS.order = keep;
    } catch (err) { toast(err.message, true); }
  });
};
// Ready for the next customer straight away: the bill panel clears locally and the
// open orders and "X left" counts refresh quietly behind it (no full POS reload).
function posNext(doneId) {
  POS.open = (POS.open || []).filter(x => x.id !== doneId);
  POS.order = posBlank(); POS.cash = 0; POS.tab = undefined; POS.saved = POS.ver;
  history.replaceState(null, '', '#/r/pos/new'); posPaint(); posRefreshQuiet();
}
async function posRefreshQuiet() {
  try {
    const [open, sheet] = await Promise.all([db.select('pos_orders', { eq: { status: 'open' }, order: [['opened_at']] }),
      db.rpc('kitchen_sheet', { p_date: today() }).catch(() => null)]);
    if (!current.startsWith('r/pos')) return;
    POS.open = open; if (sheet) POS.left = Object.fromEntries(sheet.map(r => [r.dish_id, num(r.ending)]));
    if (!document.activeElement?.closest('#main input, #main textarea')) posPaint();   // don't interrupt someone typing
  } catch (e) { /* the next full load picks it up */ }
}
async function posPayNow(pay) {
  try {
    const o = !POS.order.id || POS.ver !== POS.saved ? await posSave() : POS.order;   // skip the save when nothing changed
    const r = await db.rpc('pos_pay', { p_order: o.id, p_cash: pay.cash || 0, p_card: pay.card || 0, p_gcash: pay.gcash || 0, p_charge: pay.charge || 0, p_ref: pay.ref || '', p_invoice: pay.invoice || '' });
    const lines = POS.order.lines;
    lines.forEach(l => { if (l.dish_id in POS.left) POS.left[l.dish_id] -= num(l.qty); });   // tiles show the sale before the refresh lands
    posNext(r.id); toast(num(r.change_due) ? `Paid · change ${peso(r.change_due)}` : 'Paid');
    if (confirm(`Paid${num(r.change_due) ? ' — change ' + peso(r.change_due) : ''}. Print the order slip?`)) posSlip(r, lines);
  } catch (err) { toast(err.message, true); }
}
ACT.posCharge = async () => {
  const T = posTotals(POS.order);
  if (!POS.cash) { if (POS.tab !== 'change') { POS.tab = 'change'; posPaint(); } return toast('Tap the cash received (₱20 … ₱1,000 or Exact), then Charge.'); }
  if (POS.cash < T.total) return toast(`Cash is short by ${peso(T.total - POS.cash)}.`, true);
  posPayNow({ cash: POS.cash });
};
ACT.posGcash = async () => {
  const ref = prompt(`GCash payment of ${peso(posTotals(POS.order).total)}. Reference number (from the customer's GCash receipt):`); if (ref === null) return;
  const o = await posSave(); posPayNow({ gcash: num(o.total), ref: ref.trim() ? 'GCash ' + ref.trim() : null });
};
ACT.posPreBill = async () => {
  const o = await posSave();
  posPrint(`<h2>Romualdo's</h2><p>BILL · Order #${o.order_no}${o.table_no ? ' · Table ' + esc(o.table_no) : ''}</p><hr>
   ${POS.order.lines.map(l => `<div class="tl"><span>${fq(l.qty)} × ${esc(l.name)}</span><span>${peso(num(l.qty) * num(l.price))}</span></div>`).join('')}<hr>
   <div class="tl"><span>Subtotal</span><span>${peso(o.subtotal)}</span></div>${num(o.sc_amount) ? `<div class="tl"><span>Service charge</span><span>${peso(o.sc_amount)}</span></div>` : ''}${num(o.discount) ? `<div class="tl"><span>Senior/PWD discount</span><span>−${peso(o.discount)}</span></div>` : ''}
   <div class="tl big"><span>TOTAL</span><span>${peso(o.total)}</span></div><hr><p class="foot">${esc(POS.settings?.slip_footer || '')}</p>`);
};
ACT.posSend = async () => {
  const o = await posSave(); const lines = await db.rpc('pos_send', { p_order: o.id });
  if (lines.length) posPrint(`<h2>KITCHEN · ${o.table_no ? 'Table ' + esc(o.table_no) : KIND_L[o.kind]}</h2><p>Order #${o.order_no} · ${new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })} · ${esc(who())}</p><hr>
    ${lines.map(l => `<div class="tk"><b>${fq(l.qty)} × ${esc(l.name)}</b>${l.note ? `<div>→ ${esc(l.note)}</div>` : ''}</div>`).join('')}`);
  toast(lines.length ? `Sent ${lines.length} item${lines.length === 1 ? '' : 's'} to the kitchen` : 'Nothing new to send'); POS.order.lines.forEach(l => l.sent_at = l.sent_at || new Date().toISOString()); posPaint();
};
ACT.posBill = async () => {
  const o = await posSave(), t = num(o.total);
  const quick = [...new Set([t, Math.ceil(t / 100) * 100, Math.ceil(t / 500) * 500, Math.ceil(t / 1000) * 1000])].filter(x => x >= t).slice(0, 4);
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<form class="card" id="payForm"><div class="row"><h2>Bill out · Order #${o.order_no}</h2><span class="sp"></span><button type="button" class="x" data-close>✕</button></div>
    <div class="pay-total">${peso(t)}</div><p class="small mut" style="text-align:center">Subtotal ${peso(o.subtotal)}${num(o.sc_amount) ? ' · SC ' + peso(o.sc_amount) : ''}${num(o.discount) ? ' · Senior/PWD −' + peso(o.discount) : ''}</p>
    <div class="quick">${quick.map(v => `<button type="button" data-cash="${v}">${v === t ? 'Exact' : peso(v)}</button>`).join('')}</div>
    <div class="grid"><label>Cash ₱<input name="cash" type="number" step="any" min="0" inputmode="decimal"></label><label>GCash ₱<input name="gcash" type="number" step="any" min="0" inputmode="decimal"></label>
     <label>Card ₱<input name="card" type="number" step="any" min="0" inputmode="decimal"></label><label>Charge ₱<input name="charge" type="number" step="any" min="0" inputmode="decimal"></label>
     <label>Reference / charged to<input name="ref" placeholder="GCash ref, card approval, or who pays later"></label><label>Invoice no. (registered POS)<input name="invoice" placeholder="optional"></label></div>
    <div class="pay-change" id="payChange"></div>
    <div class="row end"><button type="button" class="ghost" data-close>Back</button><button class="pri big">Paid</button></div></form>`;
  document.body.appendChild(box);
  const f = box.querySelector('form'), upd = () => { const v = k => num(f[k].value), paid = v('cash') + v('gcash') + v('card') + v('charge'), d = paid - t;
    $('#payChange').innerHTML = paid ? (d >= 0 ? `Change <b>${peso(d)}</b>` : `<span class="bad-t">Short ${peso(-d)}</span>`) : ''; };
  box.addEventListener('click', ev => { if (ev.target.dataset.close !== undefined) box.remove(); if (ev.target.dataset.cash) { f.cash.value = ev.target.dataset.cash; upd(); } });
  f.addEventListener('input', upd); f.cash.focus();
  f.addEventListener('submit', async ev => { ev.preventDefault(); const v = k => f[k].value === '' ? 0 : num(f[k].value);
    box.remove(); posPayNow({ cash: v('cash'), card: v('card'), gcash: v('gcash'), charge: v('charge'), ref: f.ref.value, invoice: f.invoice.value }); });
};
ACT.posVoid = async () => {
  const reason = prompt('Why is this order being voided? (Paid or already-cooking orders need a manager.)'); if (!reason) return;
  try { const id = POS.order.id; await db.rpc('pos_void', { p_order: id, p_reason: reason }); posNext(id); toast('Order voided'); } catch (err) { toast(err.message, true); }
};
ACT.posShift = async () => {
  const v = prompt('Opening cash in the drawer (₱):', '0'); if (v === null) return;
  try { await db.rpc('pos_open_shift', { p_cash: num(v) }); toast('Cash drawer open'); refresh(); } catch (err) { toast(err.message, true); }
};
function posSlip(o, lines) {
  posPrint(`<h2>Romualdo's</h2><p>Order #${o.order_no} · ${o.table_no ? 'Table ' + esc(o.table_no) + ' · ' : ''}${KIND_L[o.kind]} · ${new Date(o.paid_at || Date.now()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</p><hr>
   ${lines.map(l => `<div class="tl"><span>${fq(l.qty)} × ${esc(l.name)}</span><span>${peso(num(l.qty) * num(l.price))}</span></div>`).join('')}<hr>
   <div class="tl"><span>Subtotal</span><span>${peso(o.subtotal)}</span></div>${num(o.sc_amount) ? `<div class="tl"><span>Service charge</span><span>${peso(o.sc_amount)}</span></div>` : ''}${num(o.discount) ? `<div class="tl"><span>Senior/PWD discount</span><span>−${peso(o.discount)}</span></div>` : ''}
   <div class="tl big"><span>TOTAL</span><span>${peso(o.total)}</span></div>${num(o.change_due) ? `<div class="tl"><span>Change</span><span>${peso(o.change_due)}</span></div>` : ''}<hr><p class="foot">${esc(POS.settings?.slip_footer || '')}</p>`);
}
// 80 mm receipt printing through the tablet's print dialog (works with Bluetooth/Wi-Fi printers set up on the device)
function posPrint(html) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'; document.body.appendChild(f);
  f.contentDocument.write(`<!doctype html><html><head><style>@page{size:80mm auto;margin:3mm}body{font:13px/1.35 monospace;width:72mm;margin:0}h2{font-size:16px;margin:0 0 4px;text-align:center}p{margin:2px 0;text-align:center}hr{border:0;border-top:1px dashed #000;margin:6px 0}.tk{font-size:15px;margin:4px 0}.tl{display:flex;justify-content:space-between}.big{font-weight:700;font-size:15px}.foot{font-size:11px}</style></head><body>${html}</body></html>`);
  f.contentDocument.close(); setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(() => f.remove(), 2000); }, 250);
}

/* ================= RESTAURANT · SALES (daily report) ================= */
routes['r/sales'] = async arg => {
  const d = arg || today();
  const [[day], orders, shifts, [reg]] = await Promise.all([db.select('pos_daily', { eq: { biz_date: d } }), db.select('pos_orders', { eq: { biz_date: d }, order: [['order_no']] }),
    db.select('pos_shifts', { order: [['opened_at', false]], limit: 10 }), db.select('daily_sales', { eq: { sale_date: d } })]);
  const paid = orders.filter(o => o.status === 'paid'), voids = orders.filter(o => o.status === 'void'), open = orders.filter(o => o.status === 'open');
  const lines = paid.length ? await db.select('pos_lines', { in: { order_id: paid.map(o => o.id) } }) : [];
  const items = {}; lines.forEach(l => { const x = items[l.name] ||= { name: l.name, qty: 0, amt: 0 }; x.qty += num(l.qty); x.amt += num(l.qty) * num(l.price); });
  const top = Object.values(items).sort((a, b) => b.amt - a.amt);
  const people = {}; (await db.select('profiles', { cols: 'id,full_name' }).catch(() => [])).forEach(p => people[p.id] = p.full_name);
  const z = day || { orders: 0, guests: 0, gross: 0, service_charge: 0, discounts: 0, net: 0, cash: 0, card: 0, gcash: 0, charge: 0 };
  const dayShifts = shifts.filter(s => (s.opened_at || '').slice(0, 10) <= d && (!s.closed_at || s.closed_at.slice(0, 10) >= addDays(d, -1)));
  const openShift = shifts.find(s => !s.closed_at), canVoidPaid = can('restaurant', 'manager');
  const diff = (a, b) => { const x = num(a) - num(b); return Math.abs(x) < 0.5 ? '<span class="ok-t">matches</span>' : `<span class="bad-t">${x > 0 ? '+' : ''}${peso(x)}</span>`; };
  return `<div class="row wrap"><h1>Sales</h1><span class="sp"></span><label class="inline">Date <input type="date" value="${d}" max="${today()}" onchange="location.hash='#/r/sales/'+this.value"></label><button class="ghost" onclick="window.print()">Print</button></div>
   ${open.length ? `<div class="alert warn"><b>${open.length} order${open.length > 1 ? 's are' : ' is'} still open:</b> ${open.map(o => `<a href="#/r/pos/${o.id}">#${o.order_no}${o.table_no ? ' (T' + esc(o.table_no) + ')' : ''}</a>`).join(', ')}</div>` : ''}
   <div class="kpis"><div class="kpi"><span>Net sales</span><b>${peso(z.net)}</b></div><div class="kpi"><span>Service charge (staff)</span><b>${peso(z.service_charge)}</b></div><div class="kpi"><span>Orders · guests</span><b>${z.orders} · ${z.guests}</b></div><div class="kpi"><span>Average per guest</span><b>${z.guests ? peso(num(z.net) / z.guests) : '—'}</b></div></div>
   <div class="two"><section class="card"><h2>Summary</h2><table class="kv"><tbody>
     <tr><td>Gross sales (before SC)</td><td class="n">${peso(z.gross)}</td></tr><tr><td class="mut">· take-out / delivery (no SC)</td><td class="n">${peso(z.gross_no_sc || 0)}</td></tr>
     <tr><td>Service charge</td><td class="n">${peso(z.service_charge)}</td></tr><tr><td>Senior/PWD discounts</td><td class="n">−${peso(z.discounts)}</td></tr><tr><td><b>Net sales</b></td><td class="n"><b>${peso(z.net)}</b></td></tr>
     <tr><td>Cash</td><td class="n">${peso(z.cash)}</td></tr><tr><td>GCash</td><td class="n">${peso(z.gcash)}</td></tr><tr><td>Card</td><td class="n">${peso(z.card)}</td></tr><tr><td>Charge (to collect)</td><td class="n">${peso(z.charge)}</td></tr>
     <tr><td>Voids</td><td class="n ${voids.length ? 'warn-t' : ''}">${voids.length}</td></tr></tbody></table></section>
    <section class="card"><h2>Cash drawer</h2>${dayShifts.length ? dayShifts.map(s => `<div class="mline"><span>${esc(fmtT(s.opened_at))}${s.closed_at ? ' – ' + esc(new Date(s.closed_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })) : ' · <b>open</b>'}<br><small class="mut">by ${esc(people[s.opened_by] || '')}${s.closed_by ? ' · closed by ' + esc(people[s.closed_by] || '') : ''}</small></span><span class="sp"></span>
       ${s.closed_at ? `<span class="n">expected ${peso(s.expected_cash)}<br>counted ${peso(s.counted_cash)} · ${num(s.over_short) === 0 ? '<span class="ok-t">exact</span>' : `<b class="${num(s.over_short) < 0 ? 'bad-t' : 'warn-t'}">${num(s.over_short) < 0 ? 'short' : 'over'} ${peso(Math.abs(num(s.over_short)))}</b>`}</span>` : `start ${peso(s.opening_cash)}`}</div>`).join('') : '<p class="mut">No drawer opened.</p>'}
     ${openShift && can('restaurant', 'cashier', 'manager') ? '<div class="row end"><button class="pri" data-act="posCloseShift">Close the drawer (count cash)</button></div>' : ''}</section></div>
   ${top.length ? `<section class="card tw"><h2>Sold today</h2><table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Amount</th></tr></thead><tbody>${top.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${fq(x.qty)}</td><td class="n">${peso(x.amt)}</td></tr>`).join('')}</tbody></table><p class="small mut">Counted dishes were added to Kitchen stocks → Sold automatically.</p></section>` : ''}
   ${voids.length ? `<section class="card"><h2>Voided orders</h2>${voids.map(o => `<div class="mline"><span>#${o.order_no} · ${peso(o.total)}${o.paid_at ? ' <b class="bad-t">(was paid)</b>' : ''}<br><small class="mut">${esc(o.void_reason || '')} · by ${esc(people[o.voided_by] || '')}</small></span></div>`).join('')}</section>` : ''}
   ${can('restaurant', 'cashier', 'manager', 'finance') ? `<form class="card" data-form="saveZ" data-date="${d}"><h2>Registered POS Z-reading</h2><p class="small mut">At closing, copy the totals from the registered POS's Z-reading. The app compares them with its own orders — a difference means a sale was rung on one system but not the other.</p>
     <div class="grid">${[['gross', 'Gross sales (before SC)', z.gross], ['service_charge', 'Service charge', z.service_charge], ['discounts', 'Discounts', z.discounts], ['cash', 'Cash', z.cash], ['card', 'Card', z.card], ['gcash', 'GCash / other', z.gcash], ['charge', 'Charge / AR', z.charge]].map(([k, l, mine]) => `<label>${l}<input name="${k}" type="number" step="any" min="0" value="${reg && reg[k] != null ? num(reg[k]) : ''}"><small>${reg && reg[k] != null ? diff(reg[k], mine) : 'app: ' + peso(mine)}</small></label>`).join('')}
      <label>Guests<input name="guests" type="number" min="0" value="${reg?.guests ?? ''}"></label><label>Beginning invoice no.<input name="or_from" value="${esc(reg?.or_from || '')}"></label><label>Ending invoice no.<input name="or_to" value="${esc(reg?.or_to || '')}"></label></div>
     <div class="row end"><button class="pri">Save Z-reading</button></div></form>` : ''}
   ${orders.length ? `<details class="card"${canVoidPaid && paid.length ? ' open' : ''}><summary>All orders (${orders.length})</summary>${canVoidPaid && paid.length ? '<p class="small mut">To undo a paid sale (wrong item, customer cancelled), tap <b>Void</b> on its row.</p>' : ''}<div class="tw"><table><thead><tr><th>#</th><th>Type</th><th>Time</th><th class="n">Total</th><th>Paid by</th><th>Status</th>${canVoidPaid ? '<th></th>' : ''}</tr></thead><tbody>
     ${orders.map(o => `<tr><td>${o.order_no}</td><td>${KIND_L[o.kind]}${o.table_no ? ' · T' + esc(o.table_no) : ''}</td><td>${o.paid_at ? esc(new Date(o.paid_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })) : ''}</td><td class="n">${peso(o.total)}</td><td>${['cash', 'gcash', 'card', 'charge'].filter(k => num(o['paid_' + k])).join(' + ')}${o.invoice_no ? `<div class="small mut">inv ${esc(o.invoice_no)}</div>` : ''}</td><td>${chip(o.status, o.status === 'paid' ? 'ok' : o.status === 'void' ? 'bad' : 'warn')}</td>${canVoidPaid ? `<td>${o.status === 'paid' ? `<button type="button" class="ghost sm danger" data-act="salesVoid" data-id="${o.id}" data-no="${o.order_no}" data-total="${num(o.total)}" data-cash="${num(o.paid_cash)}" data-open="${o.shift_id && o.shift_id === openShift?.id ? 1 : ''}">Void</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>` : ''}`;
};
FORMS.saveZ = async (f, el) => {
  const n = k => f[k] === '' ? null : num(f[k]);
  await db.upsert('daily_sales', { sale_date: el.dataset.date, gross: n('gross') ?? 0, discounts: n('discounts') ?? 0, service_charge: n('service_charge') ?? 0, cash: n('cash'), card: n('card'), gcash: n('gcash'), charge: n('charge'),
    guests: f.guests === '' ? null : Math.round(num(f.guests)), or_from: f.or_from || null, or_to: f.or_to || null, source: 'registered_pos', verified_by: S.user.id }, 'sale_date');
  toast('Z-reading saved'); refresh();
};
ACT.salesVoid = async el => {   // managers: undo a paid sale (the database also allows only managers)
  const { id, no, total, cash, open } = el.dataset;
  const money = num(cash) ? open ? `\nIf you refund the customer, take ${peso(cash)} out of the drawer — it is no longer expected at closing.` : `\nThis order's drawer is already closed, so its count stays as it was.` : '';
  const reason = prompt(`Void paid order #${no} (${peso(total)})? It comes off today's sales and Kitchen stocks.${money}\n\nReason:`);
  if (!reason?.trim()) return;
  await db.rpc('pos_void', { p_order: id, p_reason: reason.trim() }); toast(`Order #${no} voided`); refreshKeep();
};
ACT.posCloseShift = async () => {
  const v = prompt('Count all the cash in the drawer. Total cash (₱):'); if (v === null || v === '') return;
  try { const s = await db.rpc('pos_close_shift', { p_counted: num(v), p_note: null });
    toast(num(s.over_short) === 0 ? 'Drawer closed — cash is exact' : `Drawer closed — ${num(s.over_short) < 0 ? 'short' : 'over'} ${peso(Math.abs(num(s.over_short)))}`, num(s.over_short) < 0); refresh(); }
  catch (err) { toast(err.message, true); }
};

// Restaurant reuses the purchasing, receiving and store pages; they read the workspace from the address (#/r/…)
['requests', 'pr', 'orders', 'po', 'stock', 'count'].forEach(k => routes['r/' + k] = (...a) => routes['c/' + k](...a));

/* ================= PEOPLE (owner) ================= */
routes.people = async arg => {
  if (!isAdmin()) return '<div class="card">Only the owner can manage people.</div>';
  const [people, tabs, dev, vk] = await Promise.all([db.rpc('admin_people'),
    db.select('pos_devices', { order: [['registered_at']] }).catch(() => null), db.rpc('pos_device_status').catch(() => null), vapidKey()]);
  const sel = people.find(p => p.id === arg);
  const has = (ws, role) => (sel?.roles || []).some(r => r.ws === ws && r.role === role);
  return `<h1>People & roles</h1>
  <div class="alert info"><b>Adding someone new:</b> first create their login in Supabase → <b>Authentication → Users → Add user</b> (their email, or <code>username@staff.romualdos.ph</code> if they have none, and a starting password). Then they appear below — open them and give them roles.</div>
  <div class="list">${people.map(p => `<a class="li" href="#/people/${p.id}">${av(p.id, p.full_name || p.email, "sm")}<div class="li-main"><b>${esc(p.full_name || p.email)}${p.nickname ? ` <span class="mut">“${esc(p.nickname)}”</span>` : ''}</b><span class="mut small">${esc(p.email)}${p.username ? ' · ' + esc(p.username) : ''}</span>
    <span class="small">${p.is_admin ? chip('Owner', 'info') + ' ' : ''}${(p.roles || []).map(r => chip(`${r.ws === 'catering' ? 'Catering' : 'Restaurant'} · ${roleName(r.role)}`)).join(' ')}${!p.username ? chip('not set up', 'warn') : ''}${p.username && !p.active ? chip('switched off', 'bad') : ''}</span></div></a>`).join('')}</div>
  ${sel ? `<form class="card mt" data-form="savePerson" data-email="${esc(sel.email)}" data-id="${sel.id}"><div class="row" style="gap:12px">${av(sel.id, sel.full_name || sel.email, "md")}<h2 style="margin:0">${esc(sel.full_name || sel.email)}</h2>${AV.img[sel.id] ? `<span class="sp"></span><button type="button" class="lnk" data-act="avatarClear" data-id="${sel.id}">Remove photo</button>` : ""}</div>
    <div class="grid"><label>Full name<input name="full_name" value="${esc(sel.full_name || '')}" required></label><label>Username<input name="username" value="${esc(sel.username || sel.email.split('@')[0])}" required pattern="[a-z0-9._\\-]{2,40}" title="lower-case letters, numbers, . _ -"></label>
      <label>Nickname<input name="nickname" value="${esc(sel.nickname || '')}" maxlength="30" placeholder="${esc((sel.full_name || '').split(' ')[0] || 'e.g. Chef Jas')}"><span class="small mut">What the app calls them — on their home screen (“Magandang umaga, …!”) and at the top. Leave blank to use their first name.</span></label></div>
    <table class="roles"><thead><tr><th></th><th>Catering</th><th>Restaurant</th></tr></thead><tbody>
    ${ROLES.map(([k, l, h]) => `<tr><td>${l}<div class="small mut">${esc(h || '')}</div></td><td><input type="checkbox" name="r_catering_${k}" ${has('catering', k) ? 'checked' : ''}></td><td><input type="checkbox" name="r_restaurant_${k}" ${has('restaurant', k) ? 'checked' : ''}></td></tr>`).join('')}
    </tbody></table>
    <label class="tick"><input type="checkbox" name="is_admin" ${sel.is_admin ? 'checked' : ''}> Owner (everything, both workspaces)</label>
    <label class="tick"><input type="checkbox" name="active" ${!sel.username || sel.active ? 'checked' : ''}> Can log in</label>
    <div class="row end"><a class="btn ghost" href="#/people">Close</a><button class="pri">Save</button></div></form>` : ''}
  ${tabletsHtml(tabs, dev)}${deliveryCfgHtml(await appCfg(true))}${pushSetupHtml(!!vk)}`;
};
/* ================= activity log (owner) ================= */
// Every change in the database is stamped with who and when (audit_log). This page reads it in plain words.
const AUD_AREA = {
  'Catering events': ['events', 'event_menu', 'event_extra_needs', 'event_finance', 'stock_reservations', 'clients', 'bookings'],
  'Purchasing': ['purchase_requests', 'pr_lines', 'purchase_orders', 'po_lines', 'receipts', 'receipt_lines', 'suppliers', 'cash_advances', 'expenses', 'purchase_report_lines'],
  'Stock': ['items', 'item_par', 'stock_moves', 'stock_counts', 'stock_count_lines'],
  'Menu & recipes': ['dishes', 'dish_aliases', 'recipes', 'recipe_lines', 'restaurant_menu', 'course_rules', 'pack_sets', 'pack_components'],
  'POS & sales': ['pos_orders', 'pos_lines', 'pos_shifts', 'pos_settings', 'pos_devices', 'daily_sales', 'kitchen_days', 'dish_day_counts'],
  'Billing': ['bills', 'bill_lines', 'payments', 'bill_settings'],
  'Pokes': ['pokes', 'poke_to', 'app_config'],
  'People & HR': ['profiles', 'avatars', 'memberships', 'employees', 'time_punches', 'auth.users']
};
const AUD_NOUN = { events: 'event', event_menu: 'event menu dish', event_extra_needs: 'off-menu ingredient', event_finance: 'contract price', stock_reservations: 'stock set aside',
  clients: 'client', bookings: 'website inquiry', purchase_requests: 'purchase request', pr_lines: 'request line', purchase_orders: 'purchase order', po_lines: 'order line',
  receipts: 'delivery', receipt_lines: 'delivery line', suppliers: 'supplier', cash_advances: 'cash advance', expenses: 'expense', items: 'ingredient', item_par: 'par level',
  stock_moves: 'stock movement', stock_counts: 'stock count', stock_count_lines: 'count line', dishes: 'dish', dish_aliases: 'dish name', recipes: 'recipe', recipe_lines: 'recipe line',
  restaurant_menu: 'POS menu item', course_rules: 'course rule', pack_sets: 'pack set', pack_components: 'pack item', pos_orders: 'POS order', pos_lines: 'POS order line',
  pos_shifts: 'cash drawer', pos_settings: 'POS settings', pos_devices: 'POS tablet', daily_sales: 'daily sales / Z-reading', kitchen_days: 'kitchen day', dish_day_counts: 'kitchen count',
  bills: 'billing statement', bill_lines: 'statement line', payments: 'payment', bill_settings: 'statement settings', profiles: 'person', memberships: 'role',
  pokes: 'poke', poke_to: 'poke', avatars: 'profile photo', app_config: 'app setting', employees: 'employee', time_punches: 'time punch', 'auth.users': 'login' };
const AUD_SKIP = new Set(['updated_at', 'created_at', 'last_seen', 'token_hash']);
function audLabel(e, row, evById) {
  const r = row || {}, dish = S.dishById[r.dish_id]?.name, item = S.itemsById?.[r.item_id]?.name, ev = evById[r.event_id];
  const own = r.ref || r.pr_no || r.po_no || r.bill_no || (r.order_no != null && e.tbl.startsWith('pos_') ? '#' + r.order_no : '') || r.title || r.name || r.full_name || r.username || '';
  const bits = [own, dish && dish !== own ? dish : '', item && item !== own ? item : '', e.tbl === 'memberships' && r.role ? `${r.ws} · ${r.role}` : '',
    ev && e.tbl !== 'events' ? `for ${ev.ref || ''} ${ev.title || ''}`.trim() : ''].filter(Boolean);
  return bits.join(' · ');
}
const audVal = v => v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function audWhat(e, nameOf) {
  const o = e.old_row || {}, n = e.new_row || {};
  if (e.action === 'PASSWORD_RESET') return { verb: 'reset the password of', changes: [] };
  if (e.action === 'INSERT') return { verb: 'created', changes: [] };
  if (e.action === 'DELETE') return { verb: 'deleted', changes: [] };
  // what a person changed: names for *_by, no internal codes or timestamps (the entry already has its time)
  const shown = (k, v) => k.endsWith('_by') ? (v ? nameOf[v] || 'someone' : '—') : audVal(v);
  const changes = Object.keys(n).filter(k => !AUD_SKIP.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])
    && !k.endsWith('_at') && k !== 'id' && !(k.endsWith('_id') || UUID_RE.test(String(n[k] ?? o[k] ?? ''))) || (k.endsWith('_by') && JSON.stringify(o[k]) !== JSON.stringify(n[k])));
  let verb = 'changed';
  if (n.status !== o.status && n.status === 'void') verb = 'voided';
  else if (n.voided_at && !o.voided_at) verb = 'voided';
  else if (n.approved_by && !o.approved_by) verb = n.status === 'rejected' ? 'rejected' : 'approved';
  else if (n.status === 'paid' && o.status !== 'paid') verb = 'took payment for';
  else if (n.revoked_at && !o.revoked_at) verb = 'removed';
  else if (n.closed_at && !o.closed_at) verb = 'closed';
  else if (n.posted_at && !o.posted_at) verb = 'posted';
  else if (n.verified_at && !o.verified_at) verb = 'verified';
  else if (n.sent_at && !o.sent_at && changes.length === 1) verb = 'sent to the kitchen';
  return { verb, changes: changes.map(k => `${k.replace(/_/g, ' ')}: ${shown(k, o[k])} → ${shown(k, n[k])}`) };
}
const dayIso = (d, end) => new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}+08:00`).toISOString();
routes.activity = async arg => {
  if (!isAdmin()) return '<div class="card">Only the owner can see the activity log.</div>';
  const [d0, who0, area0, tbl0, row0] = decodeURIComponent(arg || '').split('|');
  const day = d0 || today(), area = area0 || '', actor = who0 || '', tbl = tbl0 || '', rowId = row0 || '';
  const opts = { order: [['at', false]], limit: 400 };
  if (rowId) opts.eq = { tbl, row_id: rowId }; else { opts.gte = { at: dayIso(day) }; opts.lte = { at: dayIso(day, true) }; }
  if (actor) opts.eq = { ...(opts.eq || {}), actor };
  if (area && !rowId) opts.in = { tbl: AUD_AREA[area] || [] };
  const [rows, people] = await Promise.all([db.select('audit_log', opts), db.rpc('admin_people')]);
  const nameOf = Object.fromEntries(people.map(p => [p.id, p.full_name || p.email]));
  const evIds = [...new Set(rows.map(e => (e.new_row || e.old_row || {}).event_id).filter(Boolean))];
  const evs = evIds.length ? await db.select('events', { cols: 'id,ref,title', in: { id: evIds } }).catch(() => []) : [];
  const evById = Object.fromEntries(evs.map(x => [x.id, x]));
  const list = rows.map(e => {
    const row = e.new_row || e.old_row, w = audWhat(e, nameOf), lbl = audLabel(e, row, evById);
    if (e.action === 'UPDATE' && w.verb === 'changed' && !w.changes.length) return '';   // system recalculation, nothing a person changed
    return `<div class="li"><div class="li-main"><span><b>${esc(e.actor ? nameOf[e.actor] || 'Someone (removed account)' : 'Supabase dashboard / system')}</b> ${esc(w.verb)} ${esc(AUD_NOUN[e.tbl] || e.tbl)}${lbl ? ' <b>' + esc(lbl) + '</b>' : ''}</span>
      ${w.changes.length ? `<span class="small">${w.changes.slice(0, 6).map(esc).join(' · ')}${w.changes.length > 6 ? ` · +${w.changes.length - 6} more` : ''}</span>` : ''}
      ${n0(row?.void_reason) ? `<span class="small">Reason: ${esc(row.void_reason)}</span>` : ''}${n0(row?.decision_note) && w.verb !== 'changed' ? `<span class="small">Note: ${esc(row.decision_note)}</span>` : ''}
      <span class="mut small">${fmtT(e.at)} · <a href="#/activity/${encodeURIComponent(['', '', '', e.tbl, e.row_id].join('|'))}">history of this record</a></span></div></div>`;
  }).join('');
  return `<h1>Activity</h1>
  <p class="mut small">Every creation, change, approval, void and deletion in the app is recorded here with who did it and when. Entries can't be edited or deleted.</p>
  ${rowId ? `<div class="alert info small">History of one ${esc(AUD_NOUN[tbl] || tbl)} — <a href="#/activity">back to all activity</a></div>`
    : `<form class="card row" data-form="audFilter" style="flex-wrap:wrap;gap:10px;align-items:end">
      <label>Day<input type="date" name="day" value="${day}" max="${today()}"></label>
      <label>Person<select name="actor">${opt('', 'Everyone')}${people.map(p => opt(p.id, p.full_name || p.email, p.id === actor)).join('')}</select></label>
      <label>Area<select name="area">${opt('', 'Everything')}${Object.keys(AUD_AREA).map(a => opt(a, a, a === area)).join('')}</select></label>
      <button class="pri">Show</button></form>`}
  ${rows.length ? `<input class="search mt" placeholder="Search these entries…" data-filter="#audList .li"><div class="list" id="audList">${list}</div>${rows.length === 400 ? '<p class="small mut">Showing the latest 400 — narrow it with Person or Area.</p>' : ''}`
    : '<div class="card mt">Nothing recorded for this choice.</div>'}`;
};
const n0 = v => v != null && String(v).trim() !== '';
FORMS.audFilter = async f => go('#/activity/' + encodeURIComponent([f.day, f.actor, f.area].join('|')));

/* ================= MY TASKS (private to-do list for each person) ================= */
// Quick add understands: "Order eggs tomorrow 8am !" → tomorrow 8:00 AM, important. "#Prep" puts it in your Prep list.
// Reminders ping the phone (when phone notifications are on) and pop up in the app when it's open.
const TK = { prefs: null, edit: null, gear: false, justDone: null, list: '' };
const TK_DEF = { view: 'today', morning: '08:00', defRemind: 'at', home: true };
const TK_COLORS = ['#c9a44c', '#2f7a45', '#294074', '#b42318', '#8a5a00', '#6b4fa0', '#1d8a99', '#555555'];
const REPEAT = { none: 'Never', daily: 'Every day', weekdays: 'Every weekday (Mon–Fri)', weekly: 'Every week', monthly: 'Every month' };
// (lists, not objects: number-like keys would otherwise jump to the front)
const REMIND_T = [['none', 'No reminder'], ['at', 'At the time'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'], ['custom', 'Pick a time…']];
const REMIND_D = [['none', 'No reminder'], ['at', 'Morning of'], ['1440', 'Morning before'], ['custom', 'Pick a time…']];
const hasOpt = (list, k) => list.some(o => o[0] === k);
const tkPrefs = () => ({ ...TK_DEF, ...(TK.prefs || {}) });
async function tkLoadPrefs() { if (TK.prefs) return; const r = await db.select('task_prefs').catch(() => []); TK.prefs = r[0]?.prefs || {}; }
async function tkSavePrefs(patch) { TK.prefs = { ...(TK.prefs || {}), ...patch }; await db.upsert('task_prefs', { user_id: S.me.id, prefs: TK.prefs, updated_at: new Date().toISOString() }, 'user_id'); }
const mnl = (d, t) => new Date(`${d}T${(t || '00:00').slice(0, 5)}:00+08:00`);
const mnlParts = dt => { const x = new Date(new Date(dt).getTime() + 8 * 3600e3).toISOString(); return [x.slice(0, 10), x.slice(11, 16)]; };
// When the reminder goes off
function remindAt(t, custom) {
  const r = t.remind || 'none';
  if (r === 'none') return null;
  if (r === 'custom') return custom ? new Date(custom + ':00+08:00').toISOString() : null;
  if (!t.due_date) return null;
  if (!t.due_time) return mnl(r === '1440' ? addDays(t.due_date, -1) : t.due_date, tkPrefs().morning).toISOString();
  return new Date(mnl(t.due_date, t.due_time).getTime() - (r === 'at' ? 0 : Number(r)) * 60000).toISOString();
}
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "Order eggs tomorrow 8am ! #Purchasing" → { title, due_date, due_time, priority, list_id }
function tkParse(text, lists) {
  let s = ' ' + text + ' ', due_date = null, due_time = null, priority = 0, list_id = null;
  const t0 = today(), dowToday = new Date(t0 + 'T00:00:00Z').getUTCDay();
  const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  if (cut(/\s!+(?=\s)/)) priority = 1;
  const lm = s.match(/\s#([^\s#]+)/);
  if (lm) { const key = lm[1].toLowerCase(), l = lists.find(x => x.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').startsWith(key.replace(/[^\p{L}\p{N}]/gu, ''))); if (l) { list_id = l.id; s = s.replace(lm[0], ' '); } }
  if (cut(/\s(today|ngayon)(?=\s)/i)) due_date = t0;
  else if (cut(/\s(tonight|mamaya)(?=\s)/i)) { due_date = t0; due_time = '19:00'; }
  else if (cut(/\s(tomorrow|tmrw|tom|bukas)(?=\s)/i)) due_date = addDays(t0, 1);
  else { let m = cut(/\s(?:on\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?(?=\s)/i);
    if (m) { const d = DOW.indexOf(m[1].slice(0, 3).toLowerCase()); due_date = addDays(t0, ((d - dowToday) + 7) % 7); }
    else if ((m = cut(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s(\d{1,2})(?=\s)/i))) {
      const mo = MON.indexOf(m[1].slice(0, 3).toLowerCase()), y = Number(t0.slice(0, 4)); let d = `${y}-${String(mo + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      if (d < t0) d = `${y + 1}${d.slice(4)}`; due_date = d; }
    else if ((m = cut(/\s(\d{1,2})\/(\d{1,2})(?=\s)/))) { const y = Number(t0.slice(0, 4)); let d = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; if (d < t0) d = `${y + 1}${d.slice(4)}`; due_date = d; } }
  let m = cut(/\s(?:at\s|@)?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a|p)(?=\s)/i);
  if (m) { let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12; due_time = `${String(h).padStart(2, '0')}:${m[2] || '00'}`; }
  else if ((m = cut(/\s(?:at\s|@)(\d{1,2}):(\d{2})(?=\s)/i)) || (m = cut(/\s(\d{1,2}):(\d{2})(?=\s)/))) due_time = `${String(m[1]).padStart(2, '0')}:${m[2]}`;
  else if (cut(/\s(noon|tanghali)(?=\s)/i)) due_time = '12:00';
  if (due_time && !due_date) due_date = due_time > new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16) ? t0 : addDays(t0, 1);
  return { title: s.replace(/\s+/g, ' ').trim(), due_date, due_time, priority, list_id };
}
const tkWhen = t => {
  if (!t.due_date) return '';
  const t0 = today(), d = t.due_date, tm = t.due_time ? ' ' + fmtClock(t.due_time) : '';
  const day = d === t0 ? 'Today' : d === addDays(t0, 1) ? 'Tomorrow' : d === addDays(t0, -1) ? 'Yesterday'
    : new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
  return day + tm;
};
const tkLate = t => !t.done_at && t.due_date && (t.due_date < today() || (t.due_date === today() && t.due_time && mnl(t.due_date, t.due_time) < new Date()));
function tkRow(t, lists, opts = {}) {
  const l = lists.find(x => x.id === t.list_id), rem = t.remind_at && !t.done_at ? mnlParts(t.remind_at) : null;
  const chips = [t.due_date ? `<span class="tkc ${tkLate(t) ? 'late' : t.due_date === today() ? 'today' : ''}">${IC.cal(12)} ${esc(tkWhen(t))}${tkLate(t) ? ' · late' : ''}</span>` : '',
    rem ? `<span class="tkc">${IC.bell(12)} ${esc(rem[0] === today() ? fmtClock(rem[1]) : tkWhen({ due_date: rem[0], due_time: rem[1] }))}</span>` : '',
    t.repeat !== 'none' ? `<span class="tkc">${IC.repeat(12)} ${esc(REPEAT[t.repeat].replace('Every ', '').replace(' (Mon–Fri)', ''))}</span>` : '',
    l && !opts.hideList ? `<span class="tkc" style="--lc:${esc(l.color || '#c9a44c')}"><i class="tkdot"></i>${esc(l.name)}</span>` : '',
    t.notes ? `<span class="tkc">${IC.note(12)} note</span>` : '', t.from_poke ? `<span class="tkc">${IC.msg(12)} from a poke</span>` : ''].filter(Boolean).join('');
  return `<div class="tk${t.done_at ? ' done' : ''}${t.priority ? ' imp' : ''}" style="--lc:${esc(l?.color || 'transparent')}">
    <button class="tk-chk" data-act="${t.done_at ? 'tkUndone' : 'tkDone'}" data-id="${t.id}" aria-label="${t.done_at ? 'Mark not done' : 'Mark done'}">${t.done_at ? '✓' : ''}</button>
    <button class="tk-main" data-act="tkEdit" data-id="${t.id}"><span class="tk-t">${t.priority ? '<b class="tk-imp">!</b> ' : ''}${esc(t.title)}</span>${chips ? `<span class="tk-m">${chips}</span>` : ''}</button></div>`;
}
function tkForm(t, lists) {
  const p = tkPrefs(), isNew = !t.id, rem = t.remind || (isNew ? (t.due_time ? p.defRemind : t.due_date ? (p.defRemind === 'none' ? 'none' : 'at') : 'none') : 'none');
  const custom = t.remind === 'custom' && t.remind_at ? mnlParts(t.remind_at).join('T') : '';
  const remOpts = (t.due_time ? REMIND_T : REMIND_D);
  return `<form class="card tk-form" data-form="tkSave" data-id="${t.id || ''}" data-poke="${esc(t.from_poke || '')}">
    <div class="row"><h2>${isNew ? 'New task' : 'Edit task'}</h2><span class="sp"></span><button type="button" class="lnk" data-act="tkClose">Close</button></div>
    <label>Task<input name="title" maxlength="200" required value="${esc(t.title || '')}" placeholder="What needs doing?" autocomplete="off"></label>
    <label>Notes<textarea name="notes" maxlength="1000" rows="2" placeholder="Optional">${esc(t.notes || '')}</textarea></label>
    <div class="tk-grid">
      <label>Date<input type="date" name="due_date" value="${t.due_date || ''}" data-tkre></label>
      <label>Time<input type="time" name="due_time" value="${(t.due_time || '').slice(0, 5)}" data-tkre></label>
      <label>Reminder<select name="remind" data-tkrem>${remOpts.map(([k, v]) => opt(k, v, k === rem)).join('')}</select></label>
      <label class="tk-cust"${rem === 'custom' ? '' : ' hidden'}>Remind me at<input type="datetime-local" name="custom" value="${custom}"></label>
      <label>Repeat<select name="repeat">${Object.entries(REPEAT).map(([k, v]) => opt(k, v, k === (t.repeat || 'none'))).join('')}</select></label>
      <label>List<select name="list_id">${opt('', 'No list')}${lists.map(l => opt(l.id, l.name, l.id === (t.list_id ?? (isNew ? (TK.list || p.defaultList || '') : '')))).join('')}</select></label>
    </div>
    <label class="tk-impl"><input type="checkbox" name="priority" ${t.priority ? 'checked' : ''}> <span>Important</span></label>
    <div class="row end">${isNew ? '' : `<button type="button" class="lnk bad-t" data-act="tkDelete" data-id="${t.id}">Delete</button><span class="sp"></span>`}<button class="pri">${isNew ? 'Add task' : 'Save'}</button></div>
  </form>`;
}
// Date/time changes switch the reminder choices (a task with a time can remind "10 minutes before"; a date-only task reminds in the morning)
document.addEventListener('change', e => {
  const f = e.target.closest('form[data-form="tkSave"]'); if (!f) return;
  if (e.target.matches('[data-tkrem]')) f.querySelector('.tk-cust').hidden = e.target.value !== 'custom';
  if (e.target.matches('[data-tkre]')) {
    const sel = f.querySelector('[data-tkrem]'), cur = sel.value, src = f.due_time.value ? REMIND_T : REMIND_D, p = tkPrefs();
    let pick = hasOpt(src, cur) ? cur : (f.due_time.value ? p.defRemind : 'at');
    if (cur === 'none' && !f.dataset.touched) pick = f.due_date.value ? (f.due_time.value ? p.defRemind : (p.defRemind === 'none' ? 'none' : 'at')) : 'none';
    sel.innerHTML = src.map(([k, v]) => opt(k, v, k === pick)).join('');
    f.querySelector('.tk-cust').hidden = pick !== 'custom';
  }
  if (e.target.matches('[data-tkrem]')) f.dataset.touched = '1';
});

routes.tasks = async arg => {
  await tkLoadPrefs();
  const p = tkPrefs(), view = arg && ['today', 'upcoming', 'anytime', 'all', 'done'].includes(arg) ? arg : p.view;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [lists, open, done] = await Promise.all([db.select('task_lists', { order: [['sort'], ['created_at']] }), db.select('tasks', { eq: { done_at: null }, order: [['due_date'], ['due_time'], ['created_at']] }),
    view === 'done' ? db.select('tasks', { gte: { done_at: since }, order: [['done_at', false]], limit: 100 }) : []]);
  TK.lists = lists;
  const t0 = today(), inList = t => !TK.list || t.list_id === TK.list;
  const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.due_time || '99').localeCompare(b.due_time || '99') || b.priority - a.priority;
  const sets = { today: open.filter(t => t.due_date && t.due_date <= t0), upcoming: open.filter(t => t.due_date > t0), anytime: open.filter(t => !t.due_date), all: open, done };
  const cnt = k => sets[k].filter(inList).length;
  const shown = sets[view].filter(inList).sort(view === 'done' ? () => 0 : byDue);
  // groups
  let body = '';
  if (view === 'today') {
    const late = shown.filter(tkLate), rest = shown.filter(t => !tkLate(t)).sort((a, b) => b.priority - a.priority || (a.due_time || '99').localeCompare(b.due_time || '99'));
    body = (late.length ? `<h3 class="tk-g late">Late</h3>${late.map(t => tkRow(t, lists)).join('')}` : '') + (rest.length ? `<h3 class="tk-g">Today</h3>${rest.map(t => tkRow(t, lists)).join('')}` : '');
  } else if (view === 'upcoming' || view === 'all') {
    const g = {}; for (const t of shown) (g[t.due_date ? (t.due_date < t0 ? 'late' : t.due_date) : 'none'] ||= []).push(t);
    body = Object.keys(g).sort((a, b) => (a === 'late' ? '0' : a === 'none' ? 'z' : a).localeCompare(b === 'late' ? '0' : b === 'none' ? 'z' : b))
      .map(k => `<h3 class="tk-g${k === 'late' ? ' late' : ''}">${k === 'late' ? 'Late' : k === 'none' ? 'Anytime' : esc(tkWhen({ due_date: k }))}</h3>${g[k].map(t => tkRow(t, lists)).join('')}`).join('');
  } else body = shown.map(t => tkRow(t, lists)).join('');
  const empty = { today: 'Nothing due today. Add one above, or check Upcoming.', upcoming: 'Nothing planned for the coming days.', anytime: 'No tasks without a date.', all: 'No open tasks. ', done: 'Nothing finished in the last 7 days yet.' }[view];
  const editT = TK.edit === 'new' ? { title: '', due_date: view === 'today' ? t0 : null } : TK.edit ? [...open, ...done].find(t => t.id === TK.edit) : null;
  const jd = TK.justDone;
  return `<div class="row"><h1>My tasks</h1><span class="sp"></span><button class="ghost tk-gear${TK.gear ? ' on' : ''}" data-act="tkGear" title="Customize">︎ Customize</button></div>
  <p class="mut small" style="margin-top:-4px">Only you can see your tasks.</p>
  ${TK.gear ? await tkSettings(lists) : ''}
  <form class="tk-quick" data-form="tkQuick" autocomplete="off"><input name="q" placeholder="Add a task… e.g. Order eggs tomorrow 8am !" maxlength="240" data-tkq><button class="pri" aria-label="Add">＋</button>
    <button type="button" class="ghost" data-act="tkNew" title="More details">⋯</button><div class="tk-prev" hidden></div></form>
  ${editT ? tkForm(editT, lists) : ''}
  ${jd ? `<div class="tk-undo">✓ Done: <b>${esc(jd.title)}</b>${jd.next ? ' · next one added' : ''}<button class="lnk" data-act="tkUndo">Undo</button></div>` : ''}
  <div class="seg tk-views">${[['today', 'Today'], ['upcoming', 'Upcoming'], ['anytime', 'Anytime'], ['all', 'All'], ['done', 'Done']].map(([k, l]) => `<a href="#/tasks/${k}" class="${view === k ? 'on' : ''}">${l}${k !== 'done' && cnt(k) ? ` <i>${cnt(k)}</i>` : ''}</a>`).join('')}</div>
  ${lists.length ? `<div class="tk-lists"><button class="${!TK.list ? 'on' : ''}" data-act="tkList" data-id="">All lists</button>${lists.map(l => `<button class="${TK.list === l.id ? 'on' : ''}" data-act="tkList" data-id="${l.id}" style="--lc:${esc(l.color || '#c9a44c')}"><i class="tkdot"></i>${esc(l.name)}</button>`).join('')}</div>` : ''}
  <div class="tk-list">${body || `<div class="tk-empty">${empty}</div>`}</div>
  <p class="small mut mt">Tip: type <b>today</b>, <b>tomorrow</b>, a day (<b>fri</b>), a date (<b>dec 5</b>), a time (<b>8am</b>, <b>3:30pm</b>), <b>!</b> for important${lists.length ? ' and <b>#' + esc(lists[0].name.split(' ')[0]) + '</b> for a list' : ''}.</p>`;
};
async function tkSettings(lists) {
  const p = tkPrefs();
  return `<section class="card tk-set"><h2>Customize my tasks</h2>
    <h3>My lists</h3><p class="small mut">Group your tasks your way — e.g. Purchasing, Prep, Personal.</p>
    <div class="tk-ls">${lists.map(l => `<form class="tk-l" data-form="tkListSave" data-id="${l.id}"><input name="name" value="${esc(l.name)}" maxlength="40" required><input type="color" name="color" value="${esc(l.color || '#c9a44c')}"><button class="ghost">Save</button><button type="button" class="lnk bad-t" data-act="tkListDel" data-id="${l.id}" title="Delete list">✕</button></form>`).join('')}
      <form class="tk-l" data-form="tkListSave" data-id=""><input name="name" maxlength="40" required placeholder="New list name"><input type="color" name="color" value="${TK_COLORS[lists.length % TK_COLORS.length]}"><button class="pri">Add list</button></form></div>
    <form data-form="tkPrefs" class="tk-pf">
      <label>Open on<select name="view">${[['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All']].map(([k, l]) => opt(k, l, p.view === k)).join('')}</select></label>
      <label>My morning time <span class="small mut">(reminders for tasks with a date but no time)</span><input type="time" name="morning" value="${esc(p.morning)}"></label>
      <label>Default reminder for tasks with a time<select name="defRemind">${REMIND_T.filter(o => ['none', 'at', '10', '30', '60'].includes(o[0])).map(([k, v]) => opt(k, v, p.defRemind === k)).join('')}</select></label>
      <label>New tasks go to<select name="defaultList">${opt('', 'No list')}${lists.map(l => opt(l.id, l.name, p.defaultList === l.id)).join('')}</select></label>
      <label class="tk-impl"><input type="checkbox" name="home" ${p.home !== false ? 'checked' : ''}> <span>Show my tasks for today on the home screen</span></label>
      <div class="row end"><button class="pri">Save settings</button></div></form>
    ${await pushCard(null)}</section>`;
}
// Live preview of what quick add understood
document.addEventListener('input', e => {
  if (!e.target.matches('[data-tkq]')) return;
  const box = e.target.form.querySelector('.tk-prev'), v = e.target.value.trim(); if (!v) { box.hidden = true; return; }
  const r = tkParse(v, TK.lists || []), l = (TK.lists || []).find(x => x.id === r.list_id);
  const bits = [r.due_date && tkWhen(r), r.priority && 'Important', l && 'List: ' + l.name].filter(Boolean);
  box.hidden = !bits.length; box.innerHTML = bits.map(b => `<span class="tkc">${esc(b)}</span>`).join('') + (bits.length ? `<span class="small mut">“${esc(r.title)}”</span>` : '');
});
FORMS.tkQuick = async (f, form) => {
  if (!f.q) return;
  const p = tkPrefs(), r = tkParse(f.q, TK.lists || []); if (!r.title) return toast('Write the task first.', true);
  const t = { ...r, list_id: r.list_id || TK.list || p.defaultList || null, due_date: r.due_date || null, remind: r.due_time ? p.defRemind : r.due_date ? (p.defRemind === 'none' ? 'none' : 'at') : 'none' };
  if (t.list_id && !(TK.lists || []).some(l => l.id === t.list_id)) t.list_id = null;
  t.remind_at = remindAt(t);
  if (t.remind_at && new Date(t.remind_at) < new Date()) { t.remind_at = null; t.remind = 'none'; }
  await db.insert('tasks', t); form.reset(); toast('Added' + (t.due_date ? ' · ' + tkWhen(t) : '') + (t.remind_at ? ' · ' : ''));
  refresh(); setTimeout(() => $('[data-tkq]')?.focus(), 150);
};
FORMS.tkSave = async (f, form) => {
  const t = { title: f.title, notes: f.notes || null, due_date: f.due_date || null, due_time: f.due_date && f.due_time ? f.due_time : null, remind: f.remind || 'none',
    repeat: f.due_date ? f.repeat : 'none', list_id: f.list_id || null, priority: f.priority ? 1 : 0 };
  if (t.remind === 'custom' && !f.custom) return toast('Pick when to remind you.', true);
  if (!t.due_date && !['none', 'custom'].includes(t.remind)) t.remind = 'none';
  t.remind_at = remindAt(t, f.custom);
  if (t.remind_at && new Date(t.remind_at) < new Date(Date.now() - 60000) && t.remind !== 'none') toast('Note: that reminder time has already passed.');
  if (form.dataset.id) await db.update('tasks', t, { id: form.dataset.id });
  else await db.insert('tasks', { ...t, from_poke: form.dataset.poke || null });
  TK.edit = null; toast(form.dataset.id ? 'Saved' : 'Task added'); refresh();
};
FORMS.tkListSave = async (f, form) => {
  const row = { name: f.name, color: f.color || null };
  if (form.dataset.id) await db.update('task_lists', row, { id: form.dataset.id }); else await db.insert('task_lists', { ...row, sort: (TK.lists || []).length });
  toast('List saved'); refresh();
};
FORMS.tkPrefs = async f => { await tkSavePrefs({ view: f.view, morning: f.morning || '08:00', defRemind: f.defRemind, defaultList: f.defaultList || null, home: !!f.home }); toast('Settings saved'); TK.gear = false; refresh(); };
ACT.tkListDel = async el => { if (!confirm('Delete this list? Its tasks stay, without a list.')) return; await db.remove('task_lists', { id: el.dataset.id }); if (TK.list === el.dataset.id) TK.list = ''; refresh(); };
ACT.tkGear = async () => { TK.gear = !TK.gear; refresh(); };
ACT.tkList = async el => { TK.list = el.dataset.id; refresh(); };
ACT.tkNew = async () => { TK.edit = 'new'; await refresh(); $('.tk-form [name=title]')?.focus(); };
ACT.tkEdit = async el => { TK.edit = TK.edit === el.dataset.id ? null : el.dataset.id; await refresh(); if (TK.edit) $('.tk-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
ACT.tkClose = async () => { TK.edit = null; refresh(); };
ACT.tkDelete = async el => { if (!confirm('Delete this task?')) return; await db.remove('tasks', { id: el.dataset.id }); TK.edit = null; toast('Deleted'); refresh(); };
ACT.tkDone = async el => {
  el.closest('.tk')?.classList.add('done', 'pop');
  const [t] = await db.select('tasks', { eq: { id: el.dataset.id } });
  const next = await db.rpc('task_done', { p_id: el.dataset.id });
  TK.justDone = { id: el.dataset.id, title: t?.title || '', next }; if (TK.edit === el.dataset.id) TK.edit = null;
  setTimeout(() => { if (TK.justDone?.id === el.dataset.id) { TK.justDone = null; if (current.startsWith('tasks')) refresh(); } }, 8000);
  setTimeout(refresh, 350);
};
ACT.tkUndo = async () => { const j = TK.justDone; if (!j) return; await db.update('tasks', { done_at: null }, { id: j.id }); if (j.next) await db.remove('tasks', { id: j.next }).catch(() => {}); TK.justDone = null; toast('Undone'); refresh(); };
ACT.tkUndone = async el => { await db.update('tasks', { done_at: null }, { id: el.dataset.id }); toast('Back on your list'); refresh(); };
// A poke → my task (keeps its due time; reminder at that time)
ACT.pokeToTask = async el => {
  const d = JSON.parse(el.dataset.poke); await tkLoadPrefs();
  const t = { title: d.body.slice(0, 200), from_poke: d.id, due_date: null, due_time: null, remind: 'none' };
  if (d.due) { const [dd, tt] = mnlParts(d.due); t.due_date = dd; t.due_time = tt; t.remind = tkPrefs().defRemind === 'none' ? 'at' : tkPrefs().defRemind; }
  t.remind_at = remindAt(t);
  await db.insert('tasks', t); el.textContent = '✓ In My tasks'; el.disabled = true; toast('Added to My tasks' + (t.due_date ? ' · ' + tkWhen(t) : ''));
};
// Home screen: today's tasks
async function homeTasks() {
  try {
    await tkLoadPrefs(); if (tkPrefs().home === false) return '';
    const t0 = today(), [lists, rows] = await Promise.all([db.select('task_lists'), db.select('tasks', { eq: { done_at: null }, lte: { due_date: t0 }, order: [['due_date'], ['due_time']], limit: 30 })]);
    TK.lists = lists;
    const list = rows.sort((a, b) => tkLate(b) - tkLate(a) || b.priority - a.priority || (a.due_time || '99').localeCompare(b.due_time || '99'));
    return `<section class="hw-panel"><div class="hp-h"><span class="hp-ic hp-tk">${IC.check(18)}</span><h2>My tasks today</h2>${list.length ? `<span class="hp-n hp-dark">${list.length}</span>` : ''}<span class="sp"></span>
        <a class="hp-a" href="#/tasks">Open</a></div>
      <form class="hp-quick" data-form="tkQuick" autocomplete="off"><input name="q" placeholder="＋ Add a task… e.g. Count the rice 3pm" maxlength="240" data-tkq><div class="tk-prev" hidden></div></form>
      ${list.length ? `<div class="tk-list">${list.slice(0, 5).map(t => tkRow(t, lists)).join('')}</div>${list.length > 5 ? `<a class="hp-more" href="#/tasks/today">+ ${list.length - 5} more today →</a>` : ''}`
        : `<div class="hp-empty"><div><b>Nothing due today</b><small>Type above to add one — try “tomorrow 8am”.</small></div></div>`}</section>`;
  } catch (e) { return ''; }
}
// In-app reminder pop-ups while the app is open (the phone notification comes from the server)
const TK_SHOWN = new Set(JSON.parse(sessionStorage.getItem('rom-tk-shown') || '[]'));
async function tkReminderCheck() {
  const now = Date.now(), rows = await db.select('tasks', { cols: 'id,title,priority,remind_at', eq: { done_at: null }, lte: { remind_at: new Date(now).toISOString() }, gte: { remind_at: new Date(now - 15 * 60000).toISOString() } }).catch(() => []);
  for (const t of rows) {
    if (TK_SHOWN.has(t.id + t.remind_at)) continue; TK_SHOWN.add(t.id + t.remind_at);
    toast(`${t.priority ? 'Important reminder' : 'Reminder'}: ${t.title}`);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !(await pushSub())) {
      const reg = await navigator.serviceWorker?.getRegistration(); reg?.showNotification(`Reminder: ${t.title}`, { body: 'From My tasks', tag: 'task-' + t.id, icon: './icons/icon-192.png', data: { url: './#/tasks' } });
    }
  }
  try { sessionStorage.setItem('rom-tk-shown', JSON.stringify([...TK_SHOWN].slice(-200))); } catch (e) {}
}

/* ================= EVENT ASSISTANT: pin the venue, drive time (Google Maps), send-off time ================= */
// Send-off = serve time − set-up buffer (30 min) − drive (Google Maps, with traffic for that time of day) ; loading starts before that.
const CFG = { at: 0, v: null };
async function appCfg(force) {
  if (!force && CFG.v && Date.now() - CFG.at < 5 * 60000) return CFG.v;
  const rows = await db.select('app_config').catch(() => []), m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  let kitchens = []; try { kitchens = JSON.parse(m.kitchens || '[]') || []; } catch (e) {}
  if (!kitchens.length) { try { const o = JSON.parse(m.origin || 'null'); if (o?.lat != null) kitchens = [{ id: 'k1', name: 'Main kitchen', ...o }]; } catch (e) {} }
  CFG.v = { gmaps: m.gmaps_key || '', kitchens, setup: Number(m.setup_mins || 30), load: Number(m.load_mins || 15) }; CFG.at = Date.now(); return CFG.v;
}
const hav = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const rush = d => { const h = new Date(d.getTime() + 8 * 3600e3).getUTCHours(); return (h >= 7 && h < 9) || (h >= 16 && h < 19) || (h >= 11 && h < 13); };
// Rough drive when Google Maps isn't connected: straight line × 1.4 for roads, 20 km/h at rush hour, 28 km/h otherwise, +5 min
function roughDrive(origin, dest, around) { const km = hav(origin, dest) * 1.4; return { mins: Math.ceil((km / (rush(around) ? 20 : 28) * 60 + 5) / 5) * 5, km: Math.round(km * 10) / 10, source: 'rough' }; }
// Which kitchen the food leaves from: the event's choice, else the first kitchen
const kitchenOf = (e, cfg) => (cfg.kitchens || []).find(k => k.id === e.kitchen) || (cfg.kitchens || []).filter(k => k.lat != null)[0] || null;
const goesOut = e => e.kind === 'buffet' || (e.fulfil || e.sheet?.fulfil) === 'Delivery';
// The plan for one event: { out, serve, leave, load, arrive, mins, km, source } (times as Date)
function sendOff(e, travel, cfg) {
  if (!e.serve_time) return null;
  const serve = mnl(e.event_date, e.serve_time);
  if (!goesOut(e)) return { out: false, serve, ready: new Date(serve.getTime() - 15 * 60000) };
  const pinned = e.venue_lat != null && e.venue_lng != null;
  let t = travel && travel.mins != null ? { mins: travel.mins, km: travel.km, source: travel.source || 'google', at: travel.computed_at } : null;
  const K = kitchenOf(e, cfg);
  if (!t && pinned && K?.lat != null) t = roughDrive(K, { lat: e.venue_lat, lng: e.venue_lng }, new Date(serve.getTime() - 90 * 60000));
  if (!t) return { out: true, serve, pinned, kitchen: K, arrive: new Date(serve.getTime() - cfg.setup * 60000) };
  const arrive = new Date(serve.getTime() - cfg.setup * 60000), leave = new Date(arrive.getTime() - t.mins * 60000);
  return { out: true, serve, pinned, kitchen: K, arrive, leave, load: new Date(leave.getTime() - cfg.load * 60000), ...t };
}
const clk = d => d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const dayWord = (d, ref) => { const a = mnlParts(d)[0]; return a === ref ? '' : a === addDays(ref, -1) ? ' (day before)' : ' (' + new Date(a + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) + ')'; };
const gmapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const gmapsDir = (o, d) => `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&travelmode=driving`;

async function evAssist(ev, client, ctx) {
  const cfg = await appCfg(), [tr] = await db.select('event_travel', { eq: { event_id: ev.id } }).catch(() => []);
  const s = ev.sheet || {}, plan = sendOff(ev, tr, cfg), canPin = can('catering', 'event_specialist', 'coordinator', 'manager', 'finance');
  const pinned = ev.venue_lat != null && ev.venue_lng != null, out = goesOut(ev), K = kitchenOf(ev, cfg), kits = (cfg.kitchens || []).filter(k => k.lat != null);
  // what's still missing, in the order it matters
  const checks = [
    ['Serving time set', !!ev.serve_time],
    ...(out ? [['Address / venue written', !!(ev.venue || '').trim()], ['Location pinned on the map', pinned]] : []),
    ...(ev.kind === 'buffet' ? [['Number of guests', !!ev.pax]] : []),
    ['Menu has dishes', ctx.menu.length > 0],
    ...(ctx.menu.length ? [['Purchase request made', ctx.prs.length > 0]] : []),
    ['Client contact number', !!(s.mobile || client?.phone)],
    ['Status is Confirmed or later', ['confirmed', 'in_prep', 'done'].includes(ev.status)],
  ];
  const nOk = checks.filter(c => c[1]).length;
  const tips = [];
  if (plan?.leave) {
    if (rush(plan.leave) && plan.source !== 'google') tips.push('The send-off falls in busy traffic hours. Leave 10–15 minutes earlier to be safe.');
    const h = new Date(plan.leave.getTime() + 8 * 3600e3).getUTCHours(); if (h < 6) tips.push('Very early send-off: check that the kitchen and driver are in on time.');
    if (plan.km > 25) tips.push(`It's a long drive (${plan.km} km). Pack food hot-held and bring extra fuel for chafing dishes.`);
    if (plan.source === 'google' && plan.at && (Date.now() - new Date(plan.at)) > 6 * 3600e3) tips.push('The drive time is from ' + ago(plan.at) + '. Recalculate on the day for live traffic.');
  }
  if (out && pinned && !K) tips.push(isAdmin() ? 'Pin the kitchen location on the People page so the app can work out the drive.' : 'The owner still needs to pin the kitchen location.');
  if (ev.kind === 'buffet' && ev.pax >= 150) tips.push(`${ev.pax} guests: plan for two buffet lines and an extra server.`);
  const row = (label, d, strong, note) => `<div class="as-t${strong ? ' key' : ''}"><span>${label}</span><b>${d ? esc(clk(d)) + esc(dayWord(d, ev.event_date)) : '—'}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  let body = '';
  if (!plan) body = `<p class="as-warn">Add the serving time (Edit details) and the assistant will work out the send-off.</p>`;
  else if (!plan.out) body = `<div class="as-line">${row('Ready for pick-up by', plan.ready, true, '15 minutes before the pick-up time')}${row('Client picks up', plan.serve)}</div>`;
  else {
    const src = plan.mins == null ? '' : plan.source === 'google' ? `Google Maps, with expected traffic · updated ${ago(plan.at)}` : 'Rough estimate (straight-line distance). Connect Google Maps for traffic.';
    body = `<div class="as-drive">${pinned
        ? `<div><b>${plan.mins != null ? `${plan.mins} min drive` : 'Drive time not worked out yet'}</b>${plan.km != null ? ` <span class="mut">· ${plan.km} km</span>` : ''}<small>${esc(src)}</small></div>
           <div class="as-btns">${K ? `<a class="btn" target="_blank" rel="noopener" href="${gmapsDir(K, { lat: ev.venue_lat, lng: ev.venue_lng })}">Directions</a>` : ''}${cfg.gmaps ? `<button class="ghost" data-act="evRoute" data-id="${ev.id}">Recalculate</button>` : ''}</div>`
        : `<div><b>Pin the location</b><small>So the app can work out the drive and the send-off time.</small></div>`}</div>
      ${kits.length > 1 ? `<div class="as-kit">Leaving from ${canPin ? `<select data-evkitchen="${ev.id}">${kits.map(k => opt(k.id, k.name || 'Kitchen', k.id === K?.id)).join('')}</select>` : `<b>${esc(K?.name || '')}</b>`}</div>` : ''}
      <div class="as-place">${IC.pin(14)} ${pinned ? `<a target="_blank" rel="noopener" href="${gmapsLink(ev.venue_lat, ev.venue_lng)}">${esc(ev.venue_place || ev.venue || 'Pinned location')}</a>` : `<span class="mut">${esc(ev.venue || 'No address yet')}</span>`}
        ${canPin ? `<button class="lnk" data-act="evPin" data-id="${ev.id}">${pinned ? 'Change pin' : 'Pin on the map'}</button>` : ''}</div>
      ${plan.leave ? `<div class="as-line">${row('Pack & load by', plan.load, false, `${cfg.load} min to load the van`)}${row('Leave the kitchen by', plan.leave, true, 'send-off')}${row('Arrive by', plan.arrive, false, `${cfg.setup} min to set up`)}${row(ev.kind === 'buffet' ? 'Serve at' : 'Hand over at', plan.serve)}</div>
        <div class="as-btns mt"><button class="ghost" data-act="evSendTask" data-id="${ev.id}" data-at="${plan.leave.toISOString()}" data-name="${esc(evClient(ev, client))}">Add send-off to my tasks</button><button class="ghost" data-act="evSendPoke" data-at="${plan.leave.toISOString()}" data-load="${plan.load.toISOString()}" data-name="${esc(evClient(ev, client))}" data-venue="${esc(ev.venue || '')}">Poke the team</button></div>`
        : `<div class="as-line">${row('Arrive by', plan.arrive, true, `${cfg.setup} min before serving, to set up`)}${row(ev.kind === 'buffet' ? 'Serve at' : 'Hand over at', plan.serve)}</div>`}`;
  }
  // refresh the drive by itself: none yet, older than 6 hours, or within 2 hours of the send-off (live traffic)
  if (out && pinned && cfg.gmaps && K && ev.serve_time && !['done', 'closed', 'cancelled'].includes(ev.status)) {
    const age = tr ? Date.now() - new Date(tr.computed_at) : Infinity, toLeave = plan?.leave ? plan.leave - Date.now() : Infinity;
    const due = age > 6 * 3600e3 || (toLeave < 2 * 3600e3 && toLeave > -3600e3 && age > 10 * 60000);
    if (due && plan.serve > Date.now() - 3 * 3600e3 && !EV_AUTO[ev.id]) { EV_AUTO[ev.id] = 1; setTimeout(() => evRoute(ev.id, true), 300); }
  }
  return `<section class="card as" id="assist"><div class="as-h"><span class="as-ic">${SV('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>', 18)}</span>
      <h2>Event assistant</h2><span class="sp"></span><span class="as-score${nOk === checks.length ? ' ok' : ''}">${nOk}/${checks.length} ready</span></div>
    ${ctx.run ? runLine(ctx.run.run_status, ctx.run.left_at, ctx.run.arrived_at, ctx.run.done_at, plan) + (ctx.run.driver_name ? `<p class="small mut">Driver: ${esc(ctx.run.driver_name)} · <a href="#/c/runs/${ev.event_date}">Runs</a></p>` : `<p class="small mut">No driver yet · <a href="#/c/runs/${ev.event_date}">assign on Runs</a></p>`) : ''}
    ${body}
    ${checks.some(c => !c[1]) ? `<div class="as-todo"><b>Still to do</b>${checks.filter(c => !c[1]).map(c => `<span>${esc(c[0])}</span>`).join('')}</div>` : ''}
    ${tips.length ? `<ul class="as-tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</section>`;
}
const EV_AUTO = {};
document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-evkitchen]'); if (!sel) return;
  try { await db.rpc('event_set_kitchen', { p_event: sel.dataset.evkitchen, p_kitchen: sel.value }); delete EV_AUTO[sel.dataset.evkitchen]; toast('Kitchen changed — drive worked out again'); refresh(); }
  catch (err) { toast(err.message, true); }
});
async function evRoute(id, quiet) {
  const r = await db.edge(PUSH_FN, { event: 'route', event_id: id });
  if (r?.ok) { if (!quiet) toast(`Drive: ${r.mins} min (${r.km} km)`); if (current.startsWith('c/event')) refresh(); }
  else if (!quiet) toast(r?.error || 'Could not reach Google Maps', true);
}
ACT.evRoute = async el => { el.textContent = 'Working…'; await evRoute(el.dataset.id); };
ACT.evPin = async el => {
  const [ev] = await db.select('events', { eq: { id: el.dataset.id } });
  openPin({ title: 'Pin the location', lat: ev.venue_lat, lng: ev.venue_lng, query: ev.venue || '', onSave: async (lat, lng, place) => {
    await db.rpc('event_set_pin', { p_event: ev.id, p_lat: lat, p_lng: lng, p_place: place || ev.venue || null });
    toast('Location pinned'); delete EV_AUTO[ev.id]; refresh();
  } });
};
ACT.evSendTask = async el => {
  await tkLoadPrefs(); const [d, t] = mnlParts(el.dataset.at);
  const row = { title: `Send off food: ${el.dataset.name}`.slice(0, 200), due_date: d, due_time: t, remind: '30', priority: 1 };
  row.remind_at = remindAt(row); await db.insert('tasks', row); toast('Added to My tasks, with a reminder 30 min before');
};
ACT.evSendPoke = async el => {
  const leave = clk(new Date(el.dataset.at)), load = clk(new Date(el.dataset.load));
  sessionStorage.setItem('pokeDraft', `Send-off for ${el.dataset.name}${el.dataset.venue ? ' (' + el.dataset.venue + ')' : ''}: food packed and loaded by ${load}, leave the kitchen by ${leave}.`.slice(0, 500));
  go('#/pokes/new');
};

// ---- Map pin picker: Google Maps when connected; otherwise paste a link / coordinates or use this phone's location
let GM_LOAD = null;
function loadGmaps(key) {
  if (window.google?.maps) return Promise.resolve();
  return GM_LOAD ||= new Promise((ok, bad) => { window.__gmOk = ok; const sc = document.createElement('script');
    sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__gmOk&region=PH&language=en`;
    sc.async = true; sc.onerror = () => { GM_LOAD = null; bad(new Error('Google Maps did not load')); }; document.head.appendChild(sc); });
}
function parseLatLng(t) {
  t = String(t || '');
  const m = t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i) || t.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null; const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
async function openPin({ title, lat, lng, query, onSave }) {
  const cfg = await appCfg(), DAVAO = { lat: 7.0731, lng: 125.6128 };
  let cur = lat != null ? { lat, lng } : null, place = '';
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="card pin-card"><div class="row"><h2>${esc(title)}</h2><span class="sp"></span><button type="button" class="x" data-close>✕</button></div>
    ${cfg.gmaps ? `<div class="pin-search"><input placeholder="Search a place or address" value="${esc(query || '')}"><button type="button" class="pri" data-pin-find>Find</button></div>
      <div class="pin-map"></div><p class="small mut">Tap the map or drag the pin to the exact gate or entrance.</p>`
      : `<p class="small">Google Maps isn't connected yet, so pin it this way:</p>`}
    <label class="small">${cfg.gmaps ? 'Or paste' : 'Paste'} a Google Maps link or coordinates<input data-pin-paste placeholder="e.g. 7.0731, 125.6128"></label>
    <p class="small mut">In Google Maps, long-press the spot: the coordinates appear at the top. Copy and paste them here. Short links (maps.app.goo.gl) can't be read; open them first and copy the coordinates.</p>
    <div class="pin-now"><span data-pin-show>${cur ? `${cur.lat.toFixed(5)}, ${cur.lng.toFixed(5)}` : 'No pin yet'}</span>${cur ? ` · <a target="_blank" rel="noopener" href="${gmapsLink(cur.lat, cur.lng)}">check on Google Maps</a>` : ''}</div>
    <div class="row end mt"><button type="button" class="ghost" data-pin-here>Use this phone's location</button>${lat != null ? '<button type="button" class="lnk bad-t" data-pin-clear>Remove pin</button>' : ''}<span class="sp"></span><button type="button" class="pri" data-pin-save>Save pin</button></div></div>`;
  document.body.appendChild(box);
  const show = () => { const s = box.querySelector('[data-pin-show]'); s.parentElement.innerHTML = `<span data-pin-show>${cur ? `${cur.lat.toFixed(5)}, ${cur.lng.toFixed(5)}` : 'No pin yet'}</span>${cur ? ` · <a target="_blank" rel="noopener" href="${gmapsLink(cur.lat, cur.lng)}">check on Google Maps</a>` : ''}${place ? `<br><small>${esc(place)}</small>` : ''}`; };
  let map, marker, geo;
  const setPin = (p, pan, reverse = true) => { cur = { lat: +p.lat, lng: +p.lng }; show();
    if (map) { marker.setPosition(cur); if (pan) { map.panTo(cur); map.setZoom(Math.max(map.getZoom(), 16)); } }
    if (geo && reverse) geo.geocode({ location: cur }, (r, st) => { if (st === 'OK' && r[0]) { place = r[0].formatted_address; show(); } }); };
  if (cfg.gmaps) {
    try {
      await loadGmaps(cfg.gmaps);
      map = new google.maps.Map(box.querySelector('.pin-map'), { center: cur || cfg.kitchens?.[0] || DAVAO, zoom: cur ? 16 : 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false });
      marker = new google.maps.Marker({ map, position: cur || cfg.kitchens?.[0] || DAVAO, draggable: true, visible: !!cur }); geo = new google.maps.Geocoder();
      map.addListener('click', e => { marker.setVisible(true); setPin({ lat: e.latLng.lat(), lng: e.latLng.lng() }); });
      marker.addListener('dragend', e => setPin({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      const find = () => { const q = box.querySelector('.pin-search input').value.trim(); if (!q) return;
        geo.geocode({ address: q, region: 'ph', bounds: new google.maps.LatLngBounds({ lat: 6.9, lng: 125.3 }, { lat: 7.4, lng: 125.8 }) }, (r, st) => {
          if (st !== 'OK' || !r[0]) return toast('Not found. Try a nearby landmark, or tap the map.', true);
          marker.setVisible(true); place = r[0].formatted_address; setPin({ lat: r[0].geometry.location.lat(), lng: r[0].geometry.location.lng() }, true, false); }); };
      box.querySelector('[data-pin-find]').onclick = find;
      box.querySelector('.pin-search input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    } catch (err) { box.querySelector('.pin-map').innerHTML = `<p class="small bad-t" style="padding:12px">${esc(err.message)}. Check the Google Maps key on the People page.</p>`; }
  }
  box.querySelector('[data-pin-paste]').addEventListener('input', e => { const p = parseLatLng(e.target.value); if (p) { marker?.setVisible(true); setPin(p, true); } });
  box.querySelector('[data-pin-here]').onclick = () => { if (!navigator.geolocation) return toast("This phone can't share its location", true);
    navigator.geolocation.getCurrentPosition(p => { marker?.setVisible(true); setPin({ lat: p.coords.latitude, lng: p.coords.longitude }, true); }, () => toast('Location not allowed', true), { enableHighAccuracy: true, timeout: 10000 }); };
  box.querySelector('[data-pin-clear]')?.addEventListener('click', async () => { if (!confirm('Remove this pin?')) return; box.remove(); await onSave(null, null, null); });
  box.querySelector('[data-pin-save]').onclick = async () => { if (!cur) return toast('Put a pin first.', true); try { await onSave(cur.lat, cur.lng, place); box.remove(); } catch (err) { toast(err.message, true); } };
  box.addEventListener('click', e => { if (e.target.dataset.close !== undefined || e.target === box) box.remove(); });
}

// ---- Owner: delivery planning settings (People page)
function deliveryCfgHtml(cfg) {
  return `<section class="card mt" id="delivery-cfg"><h2>Delivery planning</h2>
    <p class="small mut">Used by the Event assistant to work out send-off times: serving time − set-up buffer − drive time − loading.</p>
    <h3 class="kt-h">Kitchens <span class="small mut">(where the food leaves from; the first one is the default)</span></h3>
    <div class="kt-list">${(cfg.kitchens || []).map((k, i) => `<div class="kt"><input value="${esc(k.name || '')}" data-ktname="${i}" maxlength="40" placeholder="Kitchen name">
      <span class="kt-pl">${IC.pin(14)} ${k.lat != null ? `<a target="_blank" rel="noopener" href="${gmapsLink(k.lat, k.lng)}">${esc(k.place || `${(+k.lat).toFixed(5)}, ${(+k.lng).toFixed(5)}`)}</a>` : '<span class="bad-t">not pinned</span>'}</span>
      <button class="lnk" data-act="ktPin" data-i="${i}">${k.lat != null ? 'Change pin' : 'Pin it'}</button>${(cfg.kitchens || []).length > 1 ? `<button class="lnk bad-t" data-act="ktDel" data-i="${i}">Remove</button>` : ''}</div>`).join('') || '<p class="bad-t small">No kitchen yet.</p>'}
      <button class="ghost" data-act="ktAdd">Add a kitchen</button></div>
    <form data-form="cfgDelivery" class="tk-pf">
      <label>Set-up buffer at the venue (minutes)<input type="number" name="setup" min="0" max="240" value="${cfg.setup}"></label>
      <label>Loading time before leaving (minutes)<input type="number" name="load" min="0" max="240" value="${cfg.load}"></label>
      <label style="grid-column:1/-1">Google Maps key for the map <span class="small mut">(browser key, locked to romualdos.ph)</span><input name="gmaps" value="${esc(cfg.gmaps)}" placeholder="AIza…" autocomplete="off"></label>
      <div class="row end"><button class="pri">Save</button></div></form>
    <details class="small mt"><summary><b>How to connect Google Maps</b></summary><ol>
      <li>Go to <b>console.cloud.google.com</b>, make a project (e.g. "Romualdos app") and add a billing account.</li>
      <li>APIs &amp; Services → Library: enable <b>Maps JavaScript API</b>, <b>Geocoding API</b> and <b>Routes API</b>.</li>
      <li>Credentials → Create API key → <b>Browser key</b>: restrict it to websites <code>https://romualdos.ph/*</code> and to the Maps JavaScript and Geocoding APIs. Paste it above.</li>
      <li>Create a second key → <b>Server key</b>: restrict it to the Routes API only. In Supabase → Edge Functions → Secrets, add it as <code>GOOGLE_MAPS_KEY</code>.</li>
      <li>Paste the latest <b>poke-push</b> code from GitHub into the Edge Function and deploy it.</li></ol>
      <p>Without Google Maps the assistant still works with rough estimates from the pinned locations.</p></details></section>`;
}
FORMS.cfgDelivery = async f => {
  await db.rpc('admin_set_config', { p_key: 'setup_mins', p_value: String(Math.max(0, Number(f.setup) || 30)) });
  await db.rpc('admin_set_config', { p_key: 'load_mins', p_value: String(Math.max(0, Number(f.load) || 15)) });
  await db.rpc('admin_set_config', { p_key: 'gmaps_key', p_value: (f.gmaps || '').trim() });
  await appCfg(true); toast('Saved'); refresh();
};
const saveKitchens = async list => { await db.rpc('admin_set_config', { p_key: 'kitchens', p_value: JSON.stringify(list) }); await appCfg(true); };
ACT.ktAdd = async () => { const cfg = await appCfg(true), n = (cfg.kitchens || []).length + 1;
  openPin({ title: `Pin kitchen ${n}`, query: '', onSave: async (lat, lng, place) => { if (lat == null) return;
    await saveKitchens([...(cfg.kitchens || []), { id: 'k' + Date.now().toString(36), name: n === 1 ? 'Main kitchen' : `Kitchen ${n}`, lat, lng, place: place || '' }]); toast('Kitchen added'); refresh(); } }); };
ACT.ktPin = async el => { const cfg = await appCfg(true), list = [...cfg.kitchens], k = list[+el.dataset.i];
  openPin({ title: `Pin ${k.name || 'the kitchen'}`, lat: k.lat, lng: k.lng, onSave: async (lat, lng, place) => { if (lat == null) return toast('A kitchen needs a pin — use Remove instead.', true);
    list[+el.dataset.i] = { ...k, lat, lng, place: place || k.place || '' }; await saveKitchens(list); toast('Kitchen pinned'); refresh(); } }); };
ACT.ktDel = async el => { const cfg = await appCfg(true), list = [...cfg.kitchens], k = list[+el.dataset.i];
  if (!confirm(`Remove ${k.name || 'this kitchen'}? Events that leave from it will use ${list.find((x, i) => i !== +el.dataset.i)?.name || 'the first kitchen'}.`)) return;
  list.splice(+el.dataset.i, 1); await saveKitchens(list); toast('Kitchen removed'); refresh(); };
// kitchen names save as you leave the box
document.addEventListener('change', async e => { const i = e.target.dataset?.ktname; if (i === undefined) return;
  const cfg = await appCfg(true), list = [...cfg.kitchens]; list[+i] = { ...list[+i], name: e.target.value.trim() || `Kitchen ${+i + 1}` }; await saveKitchens(list); toast('Kitchen name saved'); });

/* ================= DRIVER RUNS: today's deliveries in send-off order, with Loaded / Left / Arrived / Handed over ================= */
const RUN_STEPS = [['loaded', 'Loaded'], ['left', 'Left the kitchen'], ['arrived', 'Arrived'], ['handed_over', 'Handed over']];
const RUN_LABEL = { planned: 'Not started', loaded: 'Loaded', left: 'On the way', arrived: 'Arrived', handed_over: 'Handed over' };
const RUN_TONE = { planned: 'mut', loaded: 'warn', left: 'info', arrived: 'info', handed_over: 'ok' };
const runTeam = () => isAdmin() || can('catering', 'event_specialist', 'coordinator', 'manager', 'driver');
const runPlanner = () => isAdmin() || can('catering', 'event_specialist', 'coordinator', 'manager');
const driverOnly = () => !isAdmin() && can('catering', 'driver') && !can('catering', 'manager', 'finance', 'event_specialist', 'coordinator', 'purchaser', 'storekeeper', 'head_chef', 'rnd_chef', 'chef');
const minsLate = (actual, planned) => actual && planned ? Math.round((new Date(actual) - planned) / 60000) : null;
function runCard(r, cfg, drivers) {
  const tr = r.travel_mins != null ? { mins: r.travel_mins, km: r.travel_km, source: r.travel_source } : null;
  const pl = sendOff(r, tr, cfg), K = kitchenOf(r, cfg), st = r.run_status || 'planned', mine = r.driver === S.me.id;
  const idx = RUN_STEPS.findIndex(s => s[0] === st), next = RUN_STEPS[idx + 1];
  const late = pl?.leave && r.left_at ? minsLate(r.left_at, pl.leave) : null;
  const lateNow = pl?.leave && !r.left_at && st !== 'handed_over' && Date.now() > pl.leave.getTime() + 5 * 60000 ? Math.round((Date.now() - pl.leave) / 60000) : null;
  const mayAct = runPlanner() || mine || (!r.driver && can('catering', 'driver'));
  const stamp = (lbl, t) => `<div class="rn-st${t ? ' on' : ''}"><i></i><span>${lbl}</span><b>${t ? esc(clk(new Date(t))) : '—'}</b></div>`;
  const tel = (r.mobile || '').replace(/[^\d+]/g, '');
  return `<article class="rn rn-${st}${lateNow ? ' late' : ''}">
    <div class="rn-top"><div class="rn-time"><small>${pl?.leave ? 'Leave by' : pl && !pl.out ? 'Ready by' : 'Serve at'}</small><b>${pl?.leave ? esc(clk(pl.leave)) : pl?.ready ? esc(clk(pl.ready)) : r.serve_time ? esc(fmtClock(r.serve_time)) : 'TBC'}</b></div>
      <div class="rn-who"><h3>${esc(r.client)}</h3><span class="mut small">${esc([KIND[r.kind] || '', r.pax ? r.pax + ' guests' : '', r.serve_time ? 'serve ' + fmtClock(r.serve_time) : ''].filter(Boolean).join(' · '))}</span></div>
      ${chip(RUN_LABEL[st], RUN_TONE[st])}</div>
    ${lateNow ? `<div class="rn-late">Should have left ${lateNow} min ago</div>` : late != null && late > 5 ? `<div class="rn-late soft">Left ${late} min after the planned send-off</div>` : ''}
    <div class="rn-where">${IC.pin(15)} <span>${esc(r.venue_place || r.venue || 'No address yet')}</span>
      ${r.venue_lat != null && K ? `<a class="btn" target="_blank" rel="noopener" href="${gmapsDir(K, { lat: r.venue_lat, lng: r.venue_lng })}">Directions</a>` : r.venue_lat != null ? `<a class="btn" target="_blank" rel="noopener" href="${gmapsLink(r.venue_lat, r.venue_lng)}">Map</a>` : ''}</div>
    <div class="rn-facts">${[K && (CFG.v.kitchens || []).length > 1 ? ['From', K.name] : null, pl?.load ? ['Load by', clk(pl.load)] : null, pl?.mins != null ? ['Drive', `${pl.mins} min${pl.km != null ? ' · ' + pl.km + ' km' : ''}${pl.source === 'google' ? '' : ' (rough)'}`] : null,
      r.call ? ['Call time', r.call] : null, r.contact ? ['Contact', r.contact] : null, r.coord ? ['Venue coordinator', r.coord] : null, r.equip ? ['Equipment', r.equip] : null, r.special ? ['Special', r.special] : null]
      .filter(Boolean).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="rn-steps">${stamp('Loaded', r.loaded_at)}${stamp('Left', r.left_at)}${stamp('Arrived', r.arrived_at)}${stamp('Handed over', r.done_at)}</div>
    ${r.run_note ? `<p class="small mut">Note: ${esc(r.run_note)}</p>` : ''}
    <div class="rn-act">
      ${next && mayAct ? (next[0] === 'handed_over'
        ? `<label class="btn pri rn-go">Handed over<input type="file" accept="image/*" capture="environment" data-runphoto="${r.id}" hidden></label><button class="ghost" data-act="runStep" data-id="${r.id}" data-step="handed_over">Without photo</button>`
        : `<button class="pri rn-go" data-act="runStep" data-id="${r.id}" data-step="${next[0]}">${next[1]}</button>`) : ''}
      ${tel ? `<a class="btn" href="tel:${esc(tel)}">Call client</a>` : ''}
      ${r.has_proof ? `<button class="ghost" data-act="runProof" data-id="${r.id}">See photo</button>` : ''}
      ${runPlanner() ? `<select class="rn-drv" data-rundriver="${r.id}">${opt('', r.driver ? 'Remove driver' : 'Assign a driver…')}${drivers.map(d => opt(d.id, d.name + (d.name !== d.full_name ? ' · ' + d.full_name : ''), d.id === r.driver)).join('')}</select>` : `<span class="small mut">${r.driver_name ? 'Driver: ' + esc(r.driver_name) : 'No driver yet'}</span>`}
      ${st !== 'planned' && runPlanner() ? `<button class="lnk" data-act="runStep" data-id="${r.id}" data-step="${idx > 0 ? RUN_STEPS[idx - 1][0] : 'planned'}">Undo</button>` : ''}
      <a class="lnk" href="#/c/event/${r.id}">Event</a></div></article>`;
}
routes['c/runs'] = async arg => {
  if (!runTeam()) return '<div class="card">Runs are for drivers and the event team.</div>';
  const t = today(), day = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : t;
  const [rows, cfg, drivers] = await Promise.all([db.rpc('runs_for', { p_date: day }), appCfg(), db.rpc('run_drivers').catch(() => [])]);
  const mine = rows.filter(r => r.driver === S.me.id), list = driverOnly() && mine.length ? [...mine, ...rows.filter(r => r.driver !== S.me.id)] : rows;
  const order = list.map(r => ({ r, p: sendOff(r, r.travel_mins != null ? { mins: r.travel_mins } : null, cfg) })).sort((a, b) => ((a.p?.leave || a.p?.ready || a.p?.serve || 0) - (b.p?.leave || b.p?.ready || b.p?.serve || 0)));
  const done = rows.filter(r => r.run_status === 'handed_over').length;
  clearTimeout(S.runTimer); S.runTimer = setTimeout(() => { if (location.hash.startsWith('#/c/runs') && !document.querySelector('.modal')) refresh(); }, 60000);
  return `<div class="row"><h1>Runs</h1><span class="sp"></span><span class="mut small">${done}/${rows.length} handed over</span></div>
    <div class="seg">${[[t, 'Today'], [addDays(t, 1), 'Tomorrow']].map(([d, l]) => `<a href="#/c/runs/${d}" class="${day === d ? 'on' : ''}">${l}</a>`).join('')}
      <label class="rn-date"><input type="date" value="${day}" data-rundate></label></div>
    <p class="small mut">${esc(fmtLong(day))} · deliveries and on-site events, in send-off order. Tap the big button at each step: everyone sees where the food is.</p>
    ${order.length ? order.map(x => runCard(x.r, cfg, drivers)).join('') : '<div class="card mut">No deliveries or on-site events this day.</div>'}`;
};
document.addEventListener('change', async e => {
  if (e.target.matches('[data-rundate]') && e.target.value) return go('#/c/runs/' + e.target.value);
  const sel = e.target.closest('[data-rundriver]');
  if (sel) { try { await db.rpc('run_assign', { p_event: sel.dataset.rundriver, p_driver: sel.value || null }); toast(sel.value ? 'Driver assigned' : 'Driver removed'); refresh(); } catch (err) { toast(err.message, true); } return; }
  const ph = e.target.closest('[data-runphoto]');
  if (ph && ph.files?.[0]) {
    try { const img = await photoJpeg(ph.files[0]); await db.rpc('run_step', { p_event: ph.dataset.runphoto, p_status: 'handed_over', p_note: null, p_img: img }); toast('Handed over, with photo'); refresh(); }
    catch (err) { toast(err.message, true); }
  }
});
ACT.runStep = async el => {
  const step = el.dataset.step, note = step === 'arrived' || step === 'handed_over' ? '' : '';
  await db.rpc('run_step', { p_event: el.dataset.id, p_status: step, p_note: note, p_img: null });
  toast({ planned: 'Back to not started', loaded: 'Loaded', left: 'On the way — drive safe', arrived: 'Arrived', handed_over: 'Handed over' }[step]); refresh();
};
ACT.runProof = async el => {
  const img = await db.rpc('run_proof', { p_event: el.dataset.id }); if (!img) return toast('No photo', true);
  const box = document.createElement('div'); box.className = 'modal';
  box.innerHTML = `<div class="card"><div class="row"><h2>Hand-over photo</h2><span class="sp"></span><button type="button" class="x" data-close>✕</button></div><img src="${img}" alt="" style="width:100%;border-radius:10px"></div>`;
  document.body.appendChild(box); box.addEventListener('click', ev => { if (ev.target.dataset.close !== undefined || ev.target === box) box.remove(); });
};
// A photo for proof: longest side 900px, JPEG under ~150 KB
async function photoJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a photo this phone can open.")); i.src = url; });
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let q = 0.8, out = c.toDataURL('image/jpeg', q); while (out.length > 190000 && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
// Status line used on the Event assistant and the Events board
function runLine(st, leftAt, arrivedAt, doneAt, plan) {
  if (!st || st === 'planned') return '';
  const late = plan?.leave && leftAt ? minsLate(leftAt, plan.leave) : null;
  const txt = st === 'handed_over' ? `Handed over ${clk(new Date(doneAt))}` : st === 'arrived' ? `Arrived ${clk(new Date(arrivedAt))}` : st === 'left' ? `On the way · left ${clk(new Date(leftAt))}${late > 5 ? ` (${late} min late)` : ''}` : 'Loaded, about to leave';
  return `<div class="run-line run-${st}"><i></i>${esc(txt)}</div>`;
}
// Home: the driver's runs today
async function homeRuns() {
  if (!can('catering', 'driver') || isAdmin()) return '';
  try {
    const [rows, cfg] = await Promise.all([db.rpc('runs_for', { p_date: today() }), appCfg()]);
    const mine = rows.filter(r => r.driver === S.me.id && r.run_status !== 'handed_over'), open = rows.filter(r => !r.driver && r.run_status !== 'handed_over');
    const line = r => { const p = sendOff(r, r.travel_mins != null ? { mins: r.travel_mins } : null, cfg); return `<a class="pk-nl" href="#/c/runs"><span class="rn-mini">${p?.leave ? esc(clk(p.leave)) : '—'}</span><span><b>${esc(r.client)}</b><small>${esc(RUN_LABEL[r.run_status])} · ${esc(r.venue || '')}</small></span></a>`; };
    return `<section class="hw-panel"><div class="hp-h"><span class="hp-ic pk">${IC.bike(18)}</span><h2>My runs today</h2>${mine.length ? `<span class="hp-n hp-dark">${mine.length}</span>` : ''}<span class="sp"></span><a class="hp-a" href="#/c/runs">Open</a></div>
      ${mine.length ? mine.map(line).join('') : `<div class="hp-empty"><div><b>No runs assigned to you</b><small>${open.length ? open.length + ' run(s) today without a driver.' : 'Nothing going out today.'}</small></div></div>`}</section>`;
  } catch (e) { return ''; }
}

/* ================= PRODUCTION SHEET: every dish for a date, added up per kitchen ================= */
const canProd = () => isAdmin() || member('catering') || can('restaurant', 'manager', 'head_chef', 'chef');
routes['c/production'] = async arg => {
  if (!canProd()) return '<div class="card">The production sheet is for the kitchen and event teams.</div>';
  const [d0, k0] = decodeURIComponent(arg || '').split('|'), day = /^\d{4}-\d{2}-\d{2}$/.test(d0 || '') ? d0 : addDays(today(), 1);
  const [rows, cfg] = await Promise.all([db.rpc('production_sheet', { p_date: day }), appCfg()]);
  const kits = (cfg.kitchens || []).filter(k => k.lat != null || k.name), kOf = r => kitchenOf(r, cfg)?.id || '';
  const kit = k0 && kits.some(k => k.id === k0) ? k0 : '';
  const use = rows.filter(r => !kit || kOf(r) === kit);
  // one entry per event (for timing), then dishes
  const evs = {}; for (const r of use) evs[r.event_id] ||= { ...r, plan: sendOff(r, r.travel_mins != null ? { mins: r.travel_mins, km: r.travel_km, source: r.travel_source } : null, cfg) };
  const readyBy = e => e.plan ? (e.plan.load || e.plan.ready || e.plan.arrive || e.plan.serve) : null;
  const dishes = {};
  for (const r of use) {
    const key = r.dish_id || r.pack_id || 'c:' + (r.name || '').toLowerCase();
    const d = dishes[key] ||= { name: r.name || '—', course: r.course || 'Other', lines: [], portions: 0, exact: true, ready: null };
    const e = evs[r.event_id], rb = readyBy(e);
    let amt, por;
    if (r.kind === 'buffet') { amt = (r.servings ? num(r.servings) : num(r.pax)) + ' pax'; por = r.servings ? num(r.servings) : num(r.pax); }
    else if (r.kind === 'trays') { amt = fq(r.qty || 1) + ' tray' + (num(r.qty) > 1 ? 's' : ''); por = r.tray_serves ? num(r.qty || 1) * num(r.tray_serves) : null; }
    else { amt = fq(r.qty || 1) + (r.kind === 'packs' ? ' pack' + (num(r.qty) > 1 ? 's' : '') : ''); por = num(r.qty || 1); }
    if (por == null) d.exact = false; else d.portions += por;
    if (rb && (!d.ready || rb < d.ready)) d.ready = rb;
    d.lines.push({ e, amt, note: r.note });
  }
  const groups = COURSES.concat(['Other']).map(c => [c, Object.values(dishes).filter(d => (COURSES.includes(d.course) ? d.course : 'Other') === c).sort((a, b) => (a.ready || 0) - (b.ready || 0) || a.name.localeCompare(b.name))]).filter(([, l]) => l.length);
  const evList = Object.values(evs).sort((a, b) => (readyBy(a) || 0) - (readyBy(b) || 0));
  const guests = evList.reduce((a, e) => a + (e.kind === 'buffet' ? num(e.pax) : 0), 0);
  const allergies = evList.filter(e => (e.allergy || '').trim());
  const ln = (k, l) => `<a href="#/c/production/${encodeURIComponent(day + '|' + k)}" class="${kit === k ? 'on' : ''}">${esc(l)}</a>`;
  return `<div class="row"><h1>Production</h1><span class="sp"></span><button class="ghost" data-act="prodPrint">Print</button></div>
    <div class="seg">${[[today(), 'Today'], [addDays(today(), 1), 'Tomorrow']].map(([d, l]) => `<a href="#/c/production/${d}${kit ? encodeURIComponent('|' + kit) : ''}" class="${day === d ? 'on' : ''}">${l}</a>`).join('')}
      <label class="rn-date"><input type="date" value="${day}" data-proddate="${esc(kit)}"></label></div>
    ${kits.length > 1 ? `<div class="seg mt">${ln('', 'All kitchens')}${kits.map(k => ln(k.id, k.name || 'Kitchen')).join('')}</div>` : ''}
    <div class="pd-sum"><div><b>${evList.length}</b><span>event${evList.length === 1 ? '' : 's'}</span></div><div><b>${guests}</b><span>buffet guests</span></div><div><b>${Object.keys(dishes).length}</b><span>dishes</span></div>
      <div><b>${evList.length && readyBy(evList[0]) ? esc(clk(readyBy(evList[0]))) : '—'}</b><span>first ready-by</span></div></div>
    <p class="small mut pd-date">${esc(fmtLong(day))}${kit ? ' · ' + esc(kits.find(k => k.id === kit)?.name || '') : ''}. "Ready by" = packed and loaded for deliveries and on-site events, 15 minutes before pick-up for pick-ups.</p>
    ${allergies.length ? `<div class="alert bad small"><b>Allergies:</b> ${allergies.map(e => `${esc(e.client)}: ${esc(e.allergy)}`).join(' · ')}</div>` : ''}
    ${evList.length ? `<section class="card"><h2>Events</h2><div class="pd-evs">${evList.map(e => `<a href="#/c/event/${e.event_id}" class="pd-ev"><b>${readyBy(e) ? esc(clk(readyBy(e))) : '—'}</b><span>${esc(e.client)}<small>${esc([KIND[e.kind], e.kind === 'buffet' && e.pax ? e.pax + ' guests' : '', goesOut(e) ? (e.kind === 'buffet' ? 'on site' : 'delivery') : 'pick-up', (CFG.v.kitchens || []).length > 1 ? kitchenOf(e, cfg)?.name : ''].filter(Boolean).join(' · '))}</small></span></a>`).join('')}</div></section>` : ''}
    ${groups.length ? groups.map(([c, list]) => `<section class="card pd-g"><h2>${esc(c)}</h2>${list.map(d => `<div class="pd-d">
        <div class="pd-h"><b>${esc(d.name)}</b><span class="pd-t">${d.portions ? (d.exact ? '' : '≈ ') + fq(d.portions) + ' portions' : ''}</span>${d.ready ? `<span class="chip warn">ready by ${esc(clk(d.ready))}</span>` : ''}</div>
        <div class="pd-l">${d.lines.map(l => `<span>${esc(l.e.client)} · <b>${esc(l.amt)}</b>${l.note ? ` · ${esc(l.note)}` : ''}</span>`).join('')}</div></div>`).join('')}</section>`).join('')
      : `<div class="card mut">No event dishes ${kit ? 'for this kitchen ' : ''}on this day.</div>`}`;
};
document.addEventListener('change', e => { if (e.target.matches('[data-proddate]') && e.target.value) go('#/c/production/' + encodeURIComponent(e.target.value + (e.target.dataset.proddate ? '|' + e.target.dataset.proddate : ''))); });
ACT.prodPrint = async () => { document.body.classList.add('print-prod'); window.print(); setTimeout(() => document.body.classList.remove('print-prod'), 500); };

/* ================= APPROVALS INBOX + OWNER DASHBOARD ================= */
const canInbox = () => isAdmin() || canAny('manager', 'finance', 'head_chef') || can('catering', 'event_specialist');
const canDash = () => isAdmin() || canAny('manager', 'finance');
const INBOX = { n: null };
async function inboxCount() {
  if (!canInbox()) return 0;
  try { const a = await db.rpc('approvals_inbox'); INBOX.data = a;
    INBOX.n = a.requests.length + a.reports.length + a.zreadings.length + a.advances.length + a.counts.length + (a.recipes ? 1 : 0) + (a.inquiries ? 1 : 0); return INBOX.n; } catch (e) { return 0; }
}
const prLink = (ws, id) => `#/${ws === 'restaurant' ? 'r' : 'c'}/pr/${id}`;
routes.approvals = async () => {
  if (!canInbox()) return '<div class="card">Nothing to approve for your role.</div>';
  const [a, eqo] = await Promise.all([db.rpc('approvals_inbox'), (isAdmin() || member('catering')) ? db.rpc('equipment_open').catch(() => []) : []]), WS = w => w === 'restaurant' ? 'Restaurant' : 'Catering';
  const sec = (title, items, help) => items.length ? `<section class="card ap-s"><div class="row"><h2>${title}</h2><span class="hp-n">${items.length}</span></div>${help ? `<p class="small mut">${help}</p>` : ''}<div class="list">${items.join('')}</div></section>` : '';
  const li = (href, main, sub, right) => `<a class="li" href="${href}"><div class="li-main"><b>${main}</b><span class="mut small">${sub}</span></div>${right || ''}<span class="ap-go">›</span></a>`;
  const parts = [
    sec('Purchase requests to approve', a.requests.map(p => li(prLink(p.ws, p.id), `${esc(p.no)} · ${peso(p.total)}`, esc([WS(p.ws), p.who, p.event, p.lines + ' items', p.needed_by ? 'needed ' + fmtD(p.needed_by) : '', ago(p.at)].filter(Boolean).join(' · ')), p.priority === 'urgent' ? chip('Urgent', 'bad') : ''))),
    sec('Purchases bought, to approve', a.reports.map(r => li(prLink(r.ws, r.pr_id), `${esc(r.no)} · ${peso(r.total)}`, esc([WS(r.ws), r.who, r.supplier, ago(r.at)].filter(Boolean).join(' · ')))), 'What was actually bought and paid, against the request.'),
    sec('Z-readings to verify', a.zreadings.map(z => li('#/r/sales', fmtD(z.date), 'Net ' + peso(z.net)))),
    sec('Stock counts not posted', a.counts.map(c => li(`#/${c.ws === 'restaurant' ? 'r' : 'c'}/count/${c.id}`, `${WS(c.ws)} count`, esc([c.who, fmtT(c.at)].filter(Boolean).join(' · '))))),
    sec('Cash advances not liquidated', a.advances.map(x => li(x.ws === 'restaurant' ? '#/r/requests' : '#/c/requests', `${peso(x.amount)} · ${esc(x.who || '')}`, `${WS(x.ws)} · released ${esc(fmtT(x.at))}`)), 'Older than 2 days: ask for receipts and change.'),
    a.recipes ? sec('Recipes in draft', [li('#/c/recipes/draft', `${a.recipes} draft recipe${a.recipes > 1 ? 's' : ''}`, 'Check and verify so costing is right')]) : '',
    a.inquiries ? sec('New website inquiries', [li('#/c/inquiries', `${a.inquiries} new inquir${a.inquiries > 1 ? 'ies' : 'y'}`, 'Not contacted yet')]) : '',
    sec('Equipment not back from events', eqo.map(o => li(`#/c/event/${o.id}`, esc(o.client), esc([fmtD(o.date), o.not_back ? o.not_back + ' not checked in' : '', o.missing ? o.missing + ' missing' : ''].filter(Boolean).join(' · ')), o.missing ? chip('Missing', 'bad') : '')), 'Check the items back in on the event page, or chase what is missing.'),
    sec('Voided orders (last 3 days, to review)', a.voids.map(v => li('#/r/sales', `#${v.no} · ${peso(v.total)}${v.paid ? ' · was paid' : ''}`, esc([v.who, v.reason, fmtT(v.at)].filter(Boolean).join(' · '))))),
  ].filter(Boolean);
  const waiting = a.requests.length + a.reports.length + a.zreadings.length + a.counts.length + a.advances.length + (a.recipes ? 1 : 0) + (a.inquiries ? 1 : 0);
  return `<div class="row"><h1>Approvals</h1><span class="sp"></span>${canDash() ? '<a class="btn" href="#/dash">Dashboard</a>' : ''}</div>
    <p class="mut small">Everything waiting on a decision, in one place. Tap one to open it.</p>
    ${parts.length ? parts.join('') : '<div class="card"><b>All clear.</b> <span class="mut">Nothing waiting for you.</span></div>'}
    ${waiting === 0 && a.voids.length ? '' : ''}`;
};
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const trend = p => p == null ? '' : `<span class="db-tr ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`;
routes.dash = async () => {
  if (!canDash()) return '<div class="card">The dashboard is for the owner and managers.</div>';
  const [d, a, board, cfg, eqo] = await Promise.all([db.rpc('owner_dashboard'), db.rpc('approvals_inbox').catch(() => null), db.rpc('events_board', { p_from: today(), p_to: today() }).catch(() => []), appCfg(), db.rpc('equipment_open').catch(() => [])]);
  const st = d.sales_today || {}, lw = d.sales_lastweek || {};
  const owed = d.balances.reduce((s, b) => s + num(b.balance), 0), overdue = d.balances.filter(b => b.due && b.due < d.today);
  const nApp = a ? a.requests.length + a.reports.length + a.zreadings.length + a.counts.length + a.advances.length : 0;
  const evGuests = d.events_week.reduce((s, e) => s + (e.kind === 'buffet' ? num(e.pax) : 0), 0);
  const max = Math.max(1, ...d.sales_days.map(x => num(x.net)));
  const sends = board.map(e => ({ e, p: sendOff(e, e.travel_mins != null ? { mins: e.travel_mins, km: e.travel_km, source: e.travel_source } : null, cfg) })).filter(x => x.p).sort((x, y) => (x.p.leave || x.p.ready || x.p.serve) - (y.p.leave || y.p.ready || y.p.serve));
  const fc = d.food_cost.map(x => ({ ...x, p: num(x.contract) ? Math.round(num(x.cost) / num(x.contract) * 100) : null }));
  const tile = (href, label, big, sub, tone) => `<a class="db-t${tone ? ' ' + tone : ''}" href="${href}"><span>${label}</span><b>${big}</b><small>${sub}</small></a>`;
  return `<div class="row"><h1>Dashboard</h1><span class="sp"></span><span class="mut small">${esc(fmtLong(d.today))}</span></div>
    <div class="db-grid">
      ${tile('#/r/sales', 'Restaurant today', peso(st.net || 0), `${st.orders || 0} orders · ${st.guests || 0} guests ${trend(pct(num(st.net), num(lw.net)))} vs last ${new Date(d.today + 'T00:00').toLocaleDateString('en-PH', { weekday: 'short' })}`)}
      ${tile('#/r/sales', 'Last 7 days', peso(d.sales_7), `${trend(pct(num(d.sales_7), num(d.sales_prev7)))} vs the 7 days before`)}
      ${tile('#/events', 'Events next 7 days', d.events_week.length, `${evGuests} buffet guests`)}
      ${tile('#/c/billing', 'Unpaid balances', peso(owed), `${d.balances.length} event${d.balances.length === 1 ? '' : 's'}${overdue.length ? ` · <b class="bad-t">${overdue.length} overdue</b>` : ''}`, overdue.length ? 'bad' : '')}
      ${tile('#/approvals', 'Waiting for approval', nApp, nApp ? 'Tap to review' : 'All clear', nApp ? 'warn' : 'ok')}
      ${tile('#/r/kitchen', 'Restaurant 86 / low', `${d.k86} / ${d.klow}`, 'dishes out / running low', d.k86 ? 'bad' : '')}
      ${tile('#/c/stock', 'Catering stock below par', d.below_par, 'items to restock', d.below_par ? 'warn' : '')}
      ${tile('#/c/equipment', 'Equipment not back', eqo.reduce((s, o) => s + num(o.missing) + num(o.not_back), 0), eqo.length ? `from ${eqo.length} past event${eqo.length > 1 ? 's' : ''}` : 'Everything returned', eqo.some(o => o.missing) ? 'bad' : eqo.length ? 'warn' : 'ok')}
      ${tile('#/c/inquiries', 'New inquiries', d.inquiries, d.inquiries ? 'Not contacted yet' : 'All handled', d.inquiries ? 'warn' : '')}
    </div>
    <div class="db-two">
      <section class="card"><h2>Restaurant sales, last 14 days</h2><div class="db-bars">${d.sales_days.map(x => `<div title="${esc(fmtD(x.d))}: ${peso(x.net)}"><i style="height:${Math.max(2, Math.round(num(x.net) / max * 100))}%"${x.d === d.today ? ' class="now"' : ''}></i><span>${new Date(x.d + 'T00:00').toLocaleDateString('en-PH', { weekday: 'narrow' })}</span></div>`).join('')}</div></section>
      <section class="card"><h2>Send-offs today</h2>${sends.length ? `<div class="list">${sends.map(({ e, p }) => `<a class="li" href="#/c/event/${e.id}"><div class="li-main"><b>${esc(e.client)}</b><span class="mut small">${p.leave ? 'leave ' + clk(p.leave) : p.ready ? 'pick-up ready ' + clk(p.ready) : 'serve ' + fmtClock(e.serve_time)}${e.run_status && e.run_status !== 'planned' ? ' · ' + esc(RUN_LABEL[e.run_status]) : ''}</span></div></a>`).join('')}</div>` : '<p class="mut small">Nothing going out today.</p>'}</section>
    </div>
    <div class="db-two">
      <section class="card"><h2>This week's events</h2>${d.events_week.length ? `<div class="list">${d.events_week.map(e => `<a class="li" href="#/c/event/${e.id}"><div class="li-main"><b>${esc(e.client)}</b><span class="mut small">${esc(fmtD(e.date))}${e.time ? ' · ' + fmtClock(e.time) : ''} · ${esc(KIND[e.kind] || '')}${e.pax ? ' · ' + e.pax + ' guests' : ''}</span></div>${chip(EVENT_STATUS[e.status], statusTone(e.status))}</a>`).join('')}</div>` : '<p class="mut small">No events in the next 7 days.</p>'}</section>
      <section class="card"><h2>Unpaid balances</h2>${d.balances.length ? `<div class="list">${d.balances.slice(0, 8).map(b => `<a class="li" href="#/c/event/${b.event_id}"><div class="li-main"><b>${esc(b.client)} · ${peso(b.balance)}</b><span class="mut small">${esc(b.ref)} · ${esc(fmtD(b.event_date))}${b.due ? ' · due ' + esc(fmtD(b.due)) : ''}</span></div>${b.due && b.due < d.today ? chip('Overdue', 'bad') : chip(b.status === 'partial' ? 'Partly paid' : 'Unpaid', 'warn')}</a>`).join('')}</div>` : '<p class="mut small">Everything is paid.</p>'}</section>
    </div>
    <section class="card"><h2>Food cost, last 30 days</h2><p class="small mut">Ingredients and expenses against the contract price. Above 40% is worth a look.</p>
      ${fc.length ? `<div class="list">${fc.map(x => `<a class="li" href="#/c/event/${x.id}"><div class="li-main"><b>${esc(x.title)}</b><span class="mut small">${esc(x.ref)} · ${esc(fmtD(x.date))} · cost ${peso(x.cost)} of ${peso(x.contract)}</span></div>${x.p != null ? chip(x.p + '%', x.p > 40 ? 'bad' : x.p > 33 ? 'warn' : 'ok') : ''}</a>`).join('')}</div>` : '<p class="mut small">No priced events in the last 30 days.</p>'}</section>`;
};
// Home: a short line for managers and the owner
async function homeInbox() {
  if (!canInbox()) return '';
  const n = await inboxCount();
  return n ? `<a class="hw-inbox" href="#/approvals"><b>${n}</b><span>waiting for your approval</span><em>Review →</em></a>` : '';
}

/* ================= EQUIPMENT: what goes out to each event, what comes back ================= */
const equipTeam = () => isAdmin() || can('catering', 'manager', 'event_specialist', 'coordinator', 'storekeeper', 'head_chef', 'chef', 'driver');
async function evEquipCard(ev) {
  if (!(isAdmin() || member('catering'))) return '';
  const [lines, eq] = await Promise.all([db.select('event_equipment', { eq: { event_id: ev.id } }), db.select('equipment', { eq: { active: true }, order: [['category'], ['name']] })]);
  const byId = Object.fromEntries(eq.map(q => [q.id, q])), edit = equipTeam(), sheetEq = (ev.sheet?.equip || '').trim();
  const rows = lines.map(l => ({ ...l, q: byId[l.equipment_id] || { name: '(removed item)', category: '' } })).sort((a, b) => a.q.category.localeCompare(b.q.category) || a.q.name.localeCompare(b.q.name));
  const packed = rows.filter(r => r.out_qty != null).length, back = rows.filter(r => r.back_qty != null).length;
  const missing = rows.filter(r => r.back_qty != null && r.back_qty < r.out_qty);
  const past = ev.event_date < today();
  const notBack = past ? rows.filter(r => r.out_qty != null && r.back_qty == null) : [];
  const unused = eq.filter(q => !lines.some(l => l.equipment_id === q.id));
  const cell = (r, what) => {
    const v = what === 'out' ? r.out_qty : r.back_qty, need = what === 'out' ? r.qty : (r.out_qty ?? r.qty);
    if (!edit) return v == null ? '<span class="mut">—</span>' : `<b>${v}</b>`;
    if (what === 'back' && r.out_qty == null) return '<span class="mut small">not out</span>';
    return v == null ? `<button class="eq-tick" data-act="eqTick" data-ev="${ev.id}" data-eq="${r.equipment_id}" data-what="${what}" data-q="${need}">${what === 'out' ? 'Packed' : 'Back'} ${need}</button>`
      : `<button class="eq-done${what === 'back' && v < r.out_qty ? ' short' : ''}" data-act="eqEdit" data-ev="${ev.id}" data-eq="${r.equipment_id}" data-what="${what}" data-v="${v}" title="Change">${v}${what === 'back' && v < r.out_qty ? ` <small>${r.out_qty - v} missing</small>` : ''}</button>`;
  };
  return `<section class="card eq-card" id="equip"><div class="row"><h2>Equipment</h2><span class="sp"></span>${rows.length ? `<span class="small mut">${packed}/${rows.length} packed · ${back}/${rows.length} back</span>` : ''}</div>
    ${missing.length ? `<div class="alert bad small"><b>Missing after this event:</b> ${missing.map(r => `${esc(r.q.name)} ×${r.out_qty - r.back_qty}`).join(' · ')}</div>` : ''}
    ${notBack.length ? `<div class="alert warn small"><b>Not checked back in yet:</b> ${notBack.map(r => esc(r.q.name)).join(' · ')}</div>` : ''}
    ${sheetEq ? `<p class="small mut">From the event sheet: ${esc(sheetEq)}</p>` : ''}
    ${rows.length ? `<div class="tw"><table class="eq-t"><thead><tr><th>Item</th><th class="n">Needed</th><th class="n">Packed out</th><th class="n">Came back</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.q.name)}<div class="small mut">${esc(r.q.category)}${r.note ? ' · ' + esc(r.note) : ''}</div></td>
        <td class="n" data-l="Needed">${edit && r.out_qty == null ? `<input class="qty eq-q" type="number" min="0" value="${r.qty}" data-eqqty="${r.equipment_id}" data-ev="${ev.id}">` : r.qty}</td>
        <td class="n" data-l="Packed out">${cell(r, 'out')}</td><td class="n" data-l="Came back">${cell(r, 'back')}</td>
        ${edit ? `<td>${r.out_qty == null ? `<button class="lnk" data-act="eqDel" data-ev="${ev.id}" data-eq="${r.equipment_id}" aria-label="Remove">Remove</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : `<p class="mut small">No equipment listed yet. Add what has to go out with the food: chafing dishes, linens, serving spoons.</p>`}
    ${edit ? `<form data-form="eqAdd" data-id="${ev.id}" class="addline mt"><select name="eq">${opt('', 'Add an item…')}${unused.map(q => opt(q.id, q.name)).join('')}</select><input name="qty" type="number" min="1" value="1" class="qty"><button class="ghost">Add</button>
      ${!rows.length ? `<button type="button" class="lnk" data-act="eqCopy" data-id="${ev.id}">Copy the list from the last similar event</button>` : ''}<a class="lnk" href="#/c/equipment">All equipment</a></form>` : ''}
  </section>`;
}
FORMS.eqAdd = async (f, el) => {
  if (!f.eq) return toast('Pick an item.', true);
  await db.upsert('event_equipment', { event_id: el.dataset.id, equipment_id: f.eq, qty: Math.max(1, Math.round(num(f.qty) || 1)) }, 'event_id,equipment_id'); refresh();
};
ACT.eqCopy = async el => { const n = await db.rpc('equip_copy_last', { p_event: el.dataset.id }); toast(n ? `${n} items copied. Adjust the quantities.` : 'No earlier event has an equipment list yet.', !n); if (n) refresh(); };
ACT.eqDel = async el => { await db.remove('event_equipment', { event_id: el.dataset.ev, equipment_id: el.dataset.eq }); refresh(); };
ACT.eqTick = async el => { await db.rpc('equip_check', { p_event: el.dataset.ev, p_equipment: el.dataset.eq, p_what: el.dataset.what, p_qty: Math.round(num(el.dataset.q)) }); refresh(); };
ACT.eqEdit = async el => {
  const v = prompt(`How many ${el.dataset.what === 'out' ? 'were packed out' : 'came back'}? Leave empty to clear.`, el.dataset.v);
  if (v === null) return;
  await db.rpc('equip_check', { p_event: el.dataset.ev, p_equipment: el.dataset.eq, p_what: el.dataset.what, p_qty: v.trim() === '' ? null : Math.max(0, Math.round(num(v))) }); refresh();
};
document.addEventListener('change', async e => {
  const q = e.target.closest('[data-eqqty]');
  if (q) { try { await db.update('event_equipment', { qty: Math.max(0, Math.round(num(q.value))) }, { event_id: q.dataset.ev, equipment_id: q.dataset.eqqty }); toast('Saved'); } catch (err) { toast(err.message, true); } }
  const o = e.target.closest('[data-eqown]');
  if (o) { try { await db.update('equipment', { owned: Math.max(0, Math.round(num(o.value))) }, { id: o.dataset.eqown }); toast('Saved'); refresh(); } catch (err) { toast(err.message, true); } }
});
routes['c/equipment'] = async () => {
  if (!(isAdmin() || member('catering'))) return '<div class="card">Equipment is for the catering team.</div>';
  const [st, open] = await Promise.all([db.rpc('equipment_status'), db.rpc('equipment_open')]), edit = equipTeam();
  const cats = [...new Set(st.map(q => q.category))];
  const miss = st.reduce((s, q) => s + num(q.missing), 0), out = st.reduce((s, q) => s + num(q.out_now), 0);
  return `<div class="row"><h1>Equipment</h1></div>
    <p class="lede">Chafing dishes, linens, utensils and boxes: how many we own, how many are out at events, and what never came back.</p>
    <div class="pd-sum"><div><b>${st.filter(q => q.active).length}</b><span>kinds of items</span></div><div><b>${out}</b><span>out at events now</span></div><div><b class="${miss ? 'bad-t' : ''}">${miss}</b><span>missing after events</span></div><div><b>${open.length}</b><span>past events not all back</span></div></div>
    ${open.length ? `<section class="card"><h2>Not all back yet</h2><div class="list">${open.map(o => `<a class="li" href="#/c/event/${o.id}"><div class="li-main"><b>${esc(o.client)}</b><span class="mut small">${esc(fmtD(o.date))}${o.not_back ? ` · ${o.not_back} not checked in` : ''}${o.missing ? ` · ${o.missing} missing` : ''}</span></div>${o.missing ? chip('Missing', 'bad') : chip('Check in', 'warn')}</a>`).join('')}</div></section>` : ''}
    <input class="search" placeholder="Search…" data-filter="#eqTable tbody tr">
    <div class="card tw"><table id="eqTable"><thead><tr><th>Item</th><th class="n">We own</th><th class="n">Out now</th><th class="n">Booked ahead</th><th class="n">Missing</th></tr></thead><tbody>
    ${cats.map(c => `<tr class="eq-cat"><td colspan="5">${esc(c)}</td></tr>${st.filter(q => q.category === c && q.active).map(q => `<tr><td>${esc(q.name)}${(q.where_now || []).length ? `<div class="small mut">${q.where_now.slice(0, 3).map(w => `<a href="#/c/event/${w.event_id}">${esc(w.client)}</a> ${esc(fmtD(w.date))}`).join(' · ')}</div>` : ''}</td>
      <td class="n">${edit ? `<input class="qty" type="number" min="0" value="${q.owned}" data-eqown="${q.id}">` : q.owned}</td><td class="n">${q.out_now || '—'}</td>
      <td class="n ${q.owned && num(q.booked) > q.owned ? 'bad-t' : ''}">${q.booked || '—'}</td><td class="n ${q.missing ? 'bad-t' : ''}">${q.missing || '—'}</td></tr>`).join('')}`).join('')}
    </tbody></table></div>
    ${edit ? `<form class="card" data-form="eqNew"><h2>Add equipment</h2><div class="grid"><label>Name<input name="name" required maxlength="80" placeholder="e.g. Chafing dish (half size)"></label>
      <label>Group<input name="category" list="eqcats" maxlength="40" placeholder="Buffet, Linens…"><datalist id="eqcats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label><label>We own<input name="owned" type="number" min="0" value="0"></label></div>
      <div class="row end"><button class="pri">Add</button></div></form>` : ''}`;
};
FORMS.eqNew = async f => { await db.insert('equipment', { name: f.name.trim(), category: (f.category || 'Other').trim() || 'Other', owned: Math.max(0, Math.round(num(f.owned))) }); toast('Added'); refresh(); };

/* ================= DUPLICATE EVENTS: merge or delete (owner and catering managers) ================= */
const eventAdmin = () => isAdmin() || can('catering', 'manager', 'event_specialist');
const linkTxt = l => [l.menu && `${l.menu} menu line${l.menu > 1 ? 's' : ''}`, l.payments && `${l.payments} payment${l.payments > 1 ? 's' : ''} (${peso(l.paid)})`, l.bill && 'a bill',
  l.requests && `${l.requests} purchase request${l.requests > 1 ? 's' : ''}`, l.orders && `${l.orders} order${l.orders > 1 ? 's' : ''}`, l.expenses && `${l.expenses} expense${l.expenses > 1 ? 's' : ''}`,
  l.advances && `${l.advances} cash advance${l.advances > 1 ? 's' : ''}`, l.stock && 'stock issued', l.equipment && 'equipment list', l.inquiry && 'website inquiry'].filter(Boolean);
routes['c/duplicates'] = async () => {
  if (!eventAdmin()) return '<div class="card">Only the owner, catering managers and event specialists can merge or delete events.</div>';
  const groups = await db.rpc('event_duplicates');
  return `<div class="row"><a href="#/c/events" class="back">‹ Events</a></div><h1>Duplicate events</h1>
    <p class="lede">Events on the same day for the same client. Tap <b>Keep this one</b> on the right copy: everything attached to the others (payments, purchases, menu if the kept one has none) moves to it, then the others are removed. A copy of anything removed is kept in Activity.</p>
    ${groups.length ? groups.map(g => `<section class="card dup-g"><h2>${esc(g.who)} · ${esc(fmtD(g.date))}</h2><div class="dup-row">${g.events.map(e => {
      const lk = linkTxt(e.links), others = g.events.filter(x => x.id !== e.id).map(x => x.id).join(',');
      return `<div class="dup-ev"><div class="row"><a href="#/c/event/${e.id}"><b>${esc(e.ref)}</b></a><span class="sp"></span>${chip(EVENT_STATUS[e.status] || e.status, statusTone(e.status))}</div>
        <div class="small">${esc([KIND[e.kind], e.serve_time ? fmtClock(e.serve_time) : '', e.pax ? e.pax + ' guests' : '', e.venue].filter(Boolean).join(' · ') || '—')}</div>
        <div class="small mut">${esc(e.title || '')}${e.ops_id ? ' · moved from /ops' : ''} · made ${esc(fmtT(e.created_at))}</div>
        <div class="small dup-l">${lk.length ? 'Has ' + esc(lk.join(', ')) : '<span class="mut">Nothing attached</span>'}</div>
        <div class="row mt"><button class="pri" data-act="evKeep" data-keep="${e.id}" data-drop="${others}" data-ref="${esc(e.ref)}">Keep this one</button>
          <button class="ghost danger" data-act="evDelete" data-id="${e.id}" data-ref="${esc(e.ref)}" data-back="dups">Delete</button></div></div>`; }).join('')}</div></section>`).join('')
      : '<div class="card"><b>No duplicates found.</b> <span class="mut">Checked events from the last 60 days onward.</span></div>'}`;
};
ACT.evKeep = async el => {
  const drop = el.dataset.drop.split(',').filter(Boolean);
  if (!confirm(`Keep ${el.dataset.ref} and merge the other ${drop.length > 1 ? drop.length + ' copies' : 'copy'} into it? The other copy is removed. This can't be undone from the app.`)) return;
  for (const d of drop) await db.rpc('event_merge', { p_drop: d, p_keep: el.dataset.keep });
  toast(`Merged into ${el.dataset.ref}`); refresh();
};
ACT.evDelete = async el => {
  if (!confirm(`Delete ${el.dataset.ref}? Its menu and checklists go with it. This can't be undone from the app.`)) return;
  try { await db.rpc('event_delete', { p_event: el.dataset.id, p_reason: null }); toast(`${el.dataset.ref} deleted`); el.dataset.back ? refresh() : go('#/c/events'); }
  catch (err) { toast(err.message, true); }
};

/* ================= RESERVATIONS + the floor's day (waiters see it without prices) ================= */
const RES_STATUS = { tentative: ['Tentative', 'warn'], confirmed: ['Confirmed', 'ok'], seated: ['Seated', 'info'], done: ['Done', 'mut'], no_show: ['No-show', 'bad'], cancelled: ['Cancelled', 'mut'] };
const RES_AREAS = ['Dining area', 'Private room', 'Whole restaurant (exclusive)', 'Take-out / pick-up', 'Delivery'];
const resEditor = () => isAdmin() || can('restaurant', 'manager', 'cashier', 'finance');
const resViewer = () => member('restaurant') || can('catering', 'waiter', 'manager', 'event_specialist', 'coordinator');
const resFloor = () => resEditor() || can('restaurant', 'waiter', 'staff');
const waiterOnly = () => !isAdmin() && (S.me?.roles || []).length > 0 && (S.me.roles || []).every(r => r.role === 'waiter');
function resCard(r, ed) {
  const [sl, st] = RES_STATUS[r.status] || [r.status, ''];
  const time = r.time_in ? (r.time_out ? 'until ' + fmtClock(r.time_out) : '') : 'Time TBC';
  return `<article class="rs rs-${r.status}"><div class="rs-top"><div class="rs-time"><b>${esc(r.time_in ? fmtClock(r.time_in) : '—')}</b><small>${r.pax ? r.pax + ' pax' : ''}</small></div>
    <div class="rs-who"><h3>${esc(r.guest)}</h3><span class="small mut">${esc([r.area, r.table_no ? 'table ' + r.table_no : '', r.occasion, time].filter(Boolean).join(' · '))}</span></div>${chip(sl, st)}</div>
    ${r.allergy ? `<div class="rn-late soft">Allergy: ${esc(r.allergy)}</div>` : ''}
    ${[['Pre-order', r.preorder], ['Setup', r.setup], ['Notes', r.note], ...(ed ? [['Contact', r.contact], ['Down payment', r.downpayment != null ? peso(r.downpayment) : ''], ['Hold until', r.status === 'tentative' && r.hold_until ? fmtD(r.hold_until) : '']] : [])]
      .filter(([, v]) => v).map(([k, v]) => `<div class="rs-f"><span>${k}</span><p>${esc(v)}</p></div>`).join('')}
    <div class="rn-act">${resFloor() && ['tentative', 'confirmed'].includes(r.status) ? `<button class="pri" data-act="resMark" data-id="${r.id}" data-s="seated">Guests arrived</button><button class="ghost" data-act="resMark" data-id="${r.id}" data-s="no_show">No-show</button>` : ''}
      ${resFloor() && r.status === 'seated' ? `<button class="ghost" data-act="resMark" data-id="${r.id}" data-s="done">Done</button>` : ''}
      ${ed ? `<a class="lnk" href="#/reservations/edit/${r.id}">Edit</a>` : ''}<span class="sp"></span><span class="small mut">${esc(r.ref)}</span></div></article>`;
}
routes.reservations = async arg => {
  if (!resViewer()) return '<div class="card">Reservations are for the restaurant and service team.</div>';
  const [a0, a1] = (arg || '').split('/');
  if (a0 === 'new' || a0 === 'edit') return resForm(a0 === 'edit' ? a1 : null);
  const t = today(), d = /^\d{4}-\d{2}-\d{2}$/.test(a0 || '') ? a0 : t, week = a0 === 'week';
  const from = week ? t : d, to = week ? addDays(t, 6) : d;
  const x = await db.rpc('service_day', { p_from: from, p_to: to }), ed = x.editor;
  const live = x.reservations.filter(r => r.status !== 'cancelled'), pax = live.reduce((s, r) => s + num(r.pax), 0);
  const byDay = list => week ? [...new Set(list.map(i => i.res_date || i.date))].map(dd => [dd, list.filter(i => (i.res_date || i.date) === dd)]) : [[d, list]];
  clearTimeout(S.resTimer); S.resTimer = setTimeout(() => { if (location.hash.startsWith('#/reservations') && !location.hash.includes('/edit') && !location.hash.includes('/new')) refresh(); }, 60000);
  return `<div class="row"><h1>Reservations</h1><span class="sp"></span>${ed ? '<a class="btn pri" href="#/reservations/new">New reservation</a>' : ''}</div>
    <div class="seg">${[[t, 'Today'], [addDays(t, 1), 'Tomorrow'], ['week', 'Next 7 days']].map(([k, l]) => `<a href="#/reservations/${k}" class="${(week ? 'week' : d) === k ? 'on' : ''}">${l}</a>`).join('')}
      <label class="rn-date"><input type="date" value="${d}" data-resdate></label></div>
    <p class="small mut">${week ? 'Today to ' + esc(fmtD(to)) : esc(fmtLong(d))} · ${live.length} reservation${live.length === 1 ? '' : 's'}${pax ? ', ' + pax + ' guests' : ''} · ${x.events.length} catering event${x.events.length === 1 ? '' : 's'}</p>
    <h2 class="rs-h">Restaurant</h2>
    ${x.reservations.length ? byDay(x.reservations).map(([dd, l]) => (week ? `<h3 class="rs-day">${esc(fmtLong(dd))}</h3>` : '') + l.map(r => resCard(r, ed)).join('')).join('') : '<div class="card mut">No reservations.</div>'}
    <h2 class="rs-h">Catering events</h2>
    ${x.events.length ? byDay(x.events).map(([dd, l]) => (week ? `<h3 class="rs-day">${esc(fmtLong(dd))}</h3>` : '') + l.map(e => `<article class="rs rs-ev"><div class="rs-top"><div class="rs-time"><b>${esc(e.time ? fmtClock(e.time) : '—')}</b><small>${e.pax ? e.pax + ' pax' : ''}</small></div>
      <div class="rs-who"><h3>${esc(e.client)}</h3><span class="small mut">${esc([KIND[e.kind], e.type, e.venue].filter(Boolean).join(' · '))}</span></div>${chip(EVENT_STATUS[e.status] || e.status, statusTone(e.status))}</div>
      ${e.allergy ? `<div class="rn-late soft">Allergy: ${esc(e.allergy)}</div>` : ''}
      ${[['Call time', e.call], ['Staff', e.staff], ['Table setup', e.setup]].filter(([, v]) => v).map(([k, v]) => `<div class="rs-f"><span>${k}</span><p>${esc(v)}</p></div>`).join('')}
      ${member('catering') ? `<div class="rn-act"><a class="lnk" href="#/c/event/${e.id}">Event details</a></div>` : ''}</article>`).join('')).join('') : '<div class="card mut">No catering events.</div>'}`;
};
async function resForm(id) {
  if (!resEditor()) return '<div class="card">Only the cashier, managers and the owner take reservations.</div>';
  const r = id ? (await db.select('reservations', { eq: { id } }))[0] : { res_date: today(), status: 'tentative', area: RES_AREAS[0] };
  if (!r) return '<div class="card">Reservation not found.</div>';
  const v = k => esc(r[k] ?? ''), tm = k => esc((r[k] || '').slice(0, 5));
  return `<div class="row"><a href="#/reservations/${r.res_date || ''}" class="back">‹ Reservations</a></div><h1>${id ? 'Edit ' + esc(r.ref) : 'New reservation'}</h1>
    <form class="card" data-form="res" data-id="${id || ''}">
      <div class="grid"><label>Guest / company<input name="guest" required maxlength="120" value="${v('guest')}"></label><label>Contact no.<input name="contact" maxlength="60" value="${v('contact')}"></label></div>
      <div class="grid"><label>Date<input name="res_date" type="date" required value="${v('res_date')}"></label><label>Time in<input name="time_in" type="time" value="${tm('time_in')}"></label><label>Time out<input name="time_out" type="time" value="${tm('time_out')}"></label><label>Guests (pax)<input name="pax" type="number" min="1" value="${v('pax')}"></label></div>
      <div class="grid"><label>Area<select name="area">${[...new Set([...RES_AREAS, r.area].filter(Boolean))].map(a => opt(a, a, a === r.area)).join('')}</select></label><label>Table no.<input name="table_no" maxlength="40" value="${v('table_no')}"></label><label>Occasion<input name="occasion" maxlength="80" value="${v('occasion')}" placeholder="Birthday, meeting…"></label></div>
      <div class="grid"><label>Status<select name="status">${Object.entries(RES_STATUS).map(([k, [l]]) => opt(k, l, k === r.status)).join('')}</select></label><label>Hold until (if tentative)<input name="hold_until" type="date" value="${v('hold_until')}"></label><label>Down payment (₱)<input name="downpayment" type="number" min="0" step="0.01" value="${v('downpayment')}"></label></div>
      <label>Food &amp; drinks pre-order<textarea name="preorder" rows="3" maxlength="2000" placeholder="Item and quantity, serve time">${v('preorder')}</textarea></label>
      <div class="grid"><label>Setup &amp; requests<textarea name="setup" rows="2" maxlength="1000" placeholder="Table setup, cake, decor, sound">${v('setup')}</textarea></label><label>Allergies<textarea name="allergy" rows="2" maxlength="300">${v('allergy')}</textarea></label></div>
      <label>Notes<textarea name="note" rows="2" maxlength="1000">${v('note')}</textarea></label>
      <p class="small mut">A booking is confirmed only after the down payment is received. Waiters see everything here except the contact number and the down payment.</p>
      <div class="row end"><button class="pri">${id ? 'Save' : 'Add reservation'}</button></div></form>`;
}
FORMS.res = async (f, el) => {
  const row = { guest: f.guest.trim(), contact: f.contact || null, res_date: f.res_date, time_in: f.time_in || null, time_out: f.time_out || null, pax: f.pax ? Math.round(num(f.pax)) : null,
    area: f.area, table_no: f.table_no || null, occasion: f.occasion || null, status: f.status, hold_until: f.hold_until || null, downpayment: f.downpayment === '' ? null : num(f.downpayment),
    preorder: f.preorder || null, setup: f.setup || null, allergy: f.allergy || null, note: f.note || null };
  if (row.status === 'confirmed' && !row.downpayment && !confirm('Mark as confirmed without a down payment?')) return;
  if (el.dataset.id) await db.update('reservations', row, { id: el.dataset.id }); else await db.insert('reservations', row);
  toast(el.dataset.id ? 'Saved' : 'Reservation added'); go('#/reservations/' + row.res_date);
};
ACT.resMark = async el => { await db.rpc('reservation_mark', { p_id: el.dataset.id, p_status: el.dataset.s }); toast({ seated: 'Marked as arrived', done: 'Done', no_show: 'Marked as no-show' }[el.dataset.s]); refresh(); };
document.addEventListener('change', e => { if (e.target.matches('[data-resdate]') && e.target.value) go('#/reservations/' + e.target.value); });
async function homeRes() {
  if (!resViewer()) return '';
  try {
    const x = await db.rpc('service_day', { p_from: today(), p_to: today() }), l = x.reservations.filter(r => !['cancelled', 'done', 'no_show'].includes(r.status));
    if (!l.length && !waiterOnly()) return '';
    return `<section class="hw-panel"><div class="hp-h"><h2>Reservations today</h2>${l.length ? `<span class="hp-n hp-dark">${l.length}</span>` : ''}<span class="sp"></span><a class="hp-a" href="#/reservations">Open</a></div>
      ${l.length ? l.slice(0, 6).map(r => `<a class="pk-nl" href="#/reservations"><span class="rn-mini">${r.time_in ? esc(fmtClock(r.time_in)) : '—'}</span><span><b>${esc(r.guest)}</b><small>${esc([r.pax ? r.pax + ' pax' : '', r.area, (RES_STATUS[r.status] || [])[0]].filter(Boolean).join(' · '))}</small></span></a>`).join('')
        : '<div class="hp-empty"><div><b>No reservations today</b><small>Walk-ins only so far.</small></div></div>'}</section>`;
  } catch (e) { return ''; }
}

/* ================= AUTO-SAVE: what you type is kept on this phone as you type, and put back after an update, reload or crash.
   The event sheet details also save online a few seconds after typing stops (same as /ops). ================= */
const DRAFT = { pre: 'rom-draft|', days: 7, timers: new Map(), skip: null };
const draftKey = form => `${DRAFT.pre}${S.user?.id || ''}|${location.hash.replace(/^#\/?/, '')}|${form.dataset.form}|${form.dataset.id || ''}`;
const draftable = form => form?.dataset?.form && form.dataset.form !== 'none' && !form.dataset.nodraft && !form.querySelector('input[type=password]') && form.closest('#main');
function draftFields(form) {
  return [...form.elements].filter(el => el.name && !['password', 'file', 'hidden', 'submit', 'button', 'reset'].includes(el.type) && !el.disabled);
}
function draftValues(form) {
  const v = {};
  for (const el of draftFields(form)) {
    if (el.type === 'checkbox') v[`cb:${el.name}:${el.value}`] = el.checked;
    else if (el.type === 'radio') { if (el.checked) v[`rd:${el.name}`] = el.value; }
    else if (el.multiple) v[el.name] = [...el.selectedOptions].map(o => o.value);
    else v[el.name] = el.value;
  }
  return v;
}
function draftWrite(form) {
  if (!draftable(form)) return;
  try {
    const now = draftValues(form), base = form._draftBase || {};
    const changed = Object.keys(now).some(k => JSON.stringify(now[k]) !== JSON.stringify(base[k]));
    if (changed) localStorage.setItem(draftKey(form), JSON.stringify({ at: Date.now(), v: now }));
    else localStorage.removeItem(draftKey(form));
  } catch (e) {}
}
const draftClear = form => { try { localStorage.removeItem(draftKey(form)); } catch (e) {} form.querySelector('.draft-bar')?.remove(); };
function draftFlushAll() { document.querySelectorAll('#main form[data-form]').forEach(f => { clearTimeout(DRAFT.timers.get(f)); draftWrite(f); }); }
// After every screen is drawn: remember the saved values, then put back any unsaved typing
function draftRestore() {
  document.querySelectorAll('#main form[data-form]').forEach(form => {
    if (!draftable(form)) return;
    form._draftBase = draftValues(form);
    let d; try { d = JSON.parse(localStorage.getItem(draftKey(form)) || 'null'); } catch (e) { d = null; }
    if (!d?.v) return;
    if (Date.now() - d.at > DRAFT.days * 864e5) { draftClear(form); return; }
    let n = 0;
    for (const el of draftFields(form)) {
      const k = el.type === 'checkbox' ? `cb:${el.name}:${el.value}` : el.type === 'radio' ? `rd:${el.name}` : el.name;
      if (!(k in d.v)) continue;
      const want = d.v[k];
      if (el.type === 'checkbox') { if (el.checked !== want) { el.checked = want; n++; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (el.type === 'radio') { if ((el.value === want) !== el.checked) { el.checked = el.value === want; n++; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (el.multiple) { [...el.options].forEach(o => o.selected = want.includes(o.value)); n++; }
      else if (el.value !== want) {
        if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === want)) continue;
        el.value = want; n++; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (!n) { draftClear(form); return; }
    form.closest('details')?.setAttribute('open', '');
    if (current === 'c/event') EVW.dirty = true;
    const online = form.dataset.form === 'evSheet';
    form.insertAdjacentHTML('afterbegin', `<div class="draft-bar"><span>Your unsaved typing from ${esc(clockOf(new Date(d.at).toISOString()))} was put back.${online ? ' It saves online in a few seconds.' : ' Tap Save when ready.'}</span><button type="button" class="lnk" data-act="draftDiscard">Discard it</button></div>`);
    if (online) autoSaveSoon(form, 1500);
  });
}
document.addEventListener('input', e => {
  const form = e.target.closest?.('#main form[data-form]'); if (!draftable(form) || !e.isTrusted) return;
  clearTimeout(DRAFT.timers.get(form)); DRAFT.timers.set(form, setTimeout(() => draftWrite(form), 300));
  if (form.dataset.form === 'evSheet') autoSaveSoon(form);
});
document.addEventListener('change', e => { const form = e.target.closest?.('#main form[data-form]'); if (draftable(form) && e.isTrusted) { draftWrite(form); if (form.dataset.form === 'evSheet') autoSaveSoon(form); } });
window.addEventListener('pagehide', draftFlushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') draftFlushAll(); });
ACT.draftDiscard = async el => { const form = el.closest('form'); draftClear(form); if (current === 'c/event') EVW.dirty = false; await refresh(); toast('Discarded'); };

// Event sheet details: save online 3 seconds after typing stops, without reloading the page
const AUTO = { timers: new Map() };
function autoSaveSoon(form, ms = 3000) {
  clearTimeout(AUTO.timers.get(form));
  autoStatus(form, 'Unsaved changes, saving…');
  AUTO.timers.set(form, setTimeout(() => autoSaveSheet(form), ms));
}
function autoStatus(form, txt, bad) {
  let s = form.querySelector('.autosave'); if (!s) { form.insertAdjacentHTML('beforeend', '<p class="autosave small"></p>'); s = form.querySelector('.autosave'); }
  s.textContent = txt; s.classList.toggle('bad-t', !!bad);
}
async function autoSaveSheet(form) {
  if (!form.isConnected) return;
  if (form._saving) return autoSaveSoon(form, 1500);
  form._saving = true;
  const rev = JSON.stringify(draftValues(form));
  try {
    const [ev] = await db.select('events', { eq: { id: form.dataset.id } });
    if (await overwriteCheck(form, ev, 'sheet')) { autoStatus(form, 'Not saved: someone else changed this event. Choose a version above.', true); return; }
    const f = formData(form);
    const keys = ['contact', 'mobile', 'email', 'source', 'call', 'pull', 'coord', 'pkg', 'motif', 'setup', 'staff', 'equip', 'fulfil', 'allergy', 'special', 'approvedOn', 'preparedBy'];
    const sheet = { ...(ev?.sheet || {}) }; keys.forEach(k => { if (k in f) { const x = String(f[k] ?? '').trim(); if (x) sheet[k] = x; else delete sheet[k]; } });
    await db.update('events', { sheet }, { id: form.dataset.id });
    const [after] = await db.select('events', { cols: 'updated_at', eq: { id: form.dataset.id } }).catch(() => []);
    if (EVW.id === form.dataset.id && EVW.snap) { EVW.snap.sheet = sheet; if (after?.updated_at) EVW.at = after.updated_at; }
    if (JSON.stringify(draftValues(form)) === rev) {      // nothing typed while saving
      form._draftBase = draftValues(form); draftClear(form); EVW.dirty = false;
      autoStatus(form, 'Saved online ' + clockOf(new Date().toISOString()));
    } else autoSaveSoon(form, 1500);
  } catch (e) { draftWrite(form); autoStatus(form, 'Not saved online yet (' + (e.message || 'offline') + '). Kept on this phone; trying again.', true); autoSaveSoon(form, 15000); }
  finally { form._saving = false; }
}

/* ================= Profile photos ================= */
// Small square JPEGs kept in the database; each phone keeps a copy and only downloads photos that changed.
const AV = { img: {}, key: 'rom-avatars' };
try { AV.img = JSON.parse(localStorage.getItem(AV.key) || '{}'); } catch (e) { AV.img = {}; }
async function loadAvatars() {
  try {
    const list = await db.rpc('avatar_list'), now = {}; for (const a of list) now[a.user_id] = a.updated_at;
    const need = list.filter(a => AV.img[a.user_id]?.t !== a.updated_at).map(a => a.user_id);
    for (const id of Object.keys(AV.img)) if (!now[id]) delete AV.img[id];
    if (need.length) for (const a of await db.rpc('avatar_get', { p_ids: need })) AV.img[a.user_id] = { t: a.updated_at, img: a.img };
    try { localStorage.setItem(AV.key, JSON.stringify(AV.img)); } catch (e) {}
  } catch (e) {}
}
// A person's photo, or their initials when there's none
const av = (id, name, cls = '') => { const a = AV.img[id]?.img;
  return `<span class="av ${cls}">${a ? `<img src="${a}" alt="">` : esc(initials(name || '?'))}</span>`; };
// Shrink a picked photo to a 320px square JPEG (centre crop)
async function squareJpeg(file, size = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a photo this phone can open. Try a JPG or PNG.")); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    let q = 0.85, out = c.toDataURL('image/jpeg', q);
    while (out.length > 150000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
document.addEventListener('change', async e => {
  const inp = e.target; if (!inp.matches('input[data-avatar]') || !inp.files?.[0]) return;
  const wrap = inp.closest('.av-up'); wrap?.classList.add('busy');
  try { await db.rpc('my_set_avatar', { p_img: await squareJpeg(inp.files[0]) }); await loadAvatars(); toast('Photo saved'); renderShell(current); refresh(); }
  catch (err) { toast(err.message, true); } finally { wrap?.classList.remove('busy'); inp.value = ''; }
});
ACT.avatarRemove = async () => { if (!confirm('Remove your photo?')) return; await db.rpc('my_set_avatar', { p_img: null }); await loadAvatars(); toast('Photo removed'); renderShell(current); refresh(); };
ACT.avatarClear = async el => { if (!confirm('Remove this person’s photo?')) return; await db.rpc('admin_clear_avatar', { p_user: el.dataset.id }); await loadAvatars(); toast('Photo removed'); refresh(); };

/* ================= My account: your details, your roles and what they let you do, password, this device, your recent activity ================= */
const ROLE_DO = {
  waiter: ['Sees today\'s reservations and catering events, without prices', 'Marks guests arrived, done or no-show', 'Checks the 86 / running-low list before taking orders'],
  driver: ['Sees the day\'s runs in send-off order, with directions and the client contact', 'Taps Loaded, Left, Arrived and Handed over (with a photo)'],
  manager: ['Approves purchase requests, orders and reports', 'Creates and edits events; closes and voids when needed', 'Sees billing, sales and costing for the workspace'],
  finance: ['Makes billing statements and records payments', 'Sets contract prices', 'Sees costing and ingredient prices'],
  event_specialist: ['Creates events and takes website inquiries', 'Edits event details and menus', 'Makes purchase requests for events'],
  coordinator: ['Runs events: menu, details and printouts', 'Makes purchase requests for events', 'Cannot create new events or take inquiries'],
  purchaser: ['Turns approved requests into purchase orders', 'Records buying and purchase reports'],
  storekeeper: ['Receives deliveries and counts stock', 'Does the Kitchen stocks daily count (sets the 86 / running-low list)'],
  head_chef: ['Writes and edits recipes and dish details', 'Sees costing and ingredient prices', 'Kitchen work on events: menus, extra ingredients, prep'],
  rnd_chef: ['Writes, tests and costs recipes', 'Edits dish details'],
  chef: ['Kitchen work on events: menus, extra ingredients, prep day', 'Reads recipes'],
  cashier: ['Takes payments on the POS and opens/closes the cash drawer', 'Gives Senior/PWD discounts', 'Does the Z-reading on the Sales page'],
  staff: ['Takes orders on the POS and sends them to the kitchen', 'Sees the 86 / running-low list']
};
const WS_NAME = { catering: 'Catering', restaurant: 'Restaurant' };
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const ago = s => { if (!s) return ''; const m = Math.round((Date.now() - new Date(s)) / 60000);
  return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : fmtT(s); };
routes.me = async () => {
  const [acct, , acts, dev, team] = await Promise.all([db.rpc('my_account').catch(() => null), loadAvatars(), db.rpc('my_activity', { p_limit: 15 }).catch(() => null), db.rpc('pos_device_status').catch(() => null), db.rpc('team_list').catch(() => null)]);
  const me = { ...S.me, ...(acct || {}) }, roles = S.me?.roles || [];
  const byWs = Object.keys(WS_NAME).map(ws => [ws, roles.filter(r => r.ws === ws)]).filter(([, rs]) => rs.length);
  const roleCards = me.is_admin
    ? `<div class="me-role own"><b>Owner</b><span class="small">Full access to everything in Catering and Restaurant, plus People, Activity and POS tablets.</span></div>`
    : byWs.length ? byWs.map(([ws, rs]) => `<h3 class="me-ws">${WS_NAME[ws]}</h3>${rs.map(r => {
        const def = ROLES.find(x => x[0] === r.role);
        return `<div class="me-role"><b>${esc(roleName(r.role))}</b>${def?.[2] ? `<span class="small mut">${esc(def[2])}</span>` : ''}
          ${ROLE_DO[r.role] ? `<ul>${ROLE_DO[r.role].map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`; }).join('')}`).join('')
      : '<p class="mut">You have no roles yet. Ask the owner to set them on the People page.</p>';
  const go2 = [member('catering') && ['#/c', 'Catering'], member('restaurant') && ['#/r', 'Restaurant'], ['#/events', 'Events board'], me.is_admin && ['#/people', 'People']].filter(Boolean);
  const actRows = (acts || []).map(e => { const w = audWhat(e, {}), row = e.new_row || e.old_row || {};
    if (e.tbl === 'profiles' && e.action === 'UPDATE') return `<span>You updated ${row.username === S.me?.username ? 'your details' : 'the details of <b>' + esc(row.full_name || '') + '</b>'}</span>`;
    const lbl = row.ref || row.pr_no || row.po_no || row.bill_no || (row.order_no != null && e.tbl.startsWith('pos_') ? '#' + row.order_no : '') || row.title || row.name
      || (e.tbl === 'memberships' && row.role ? `${roleName(row.role)} · ${WS_NAME[row.ws] || row.ws}` : '') || S.dishById[row.dish_id]?.name || S.itemsById?.[row.item_id]?.name || '';
    if (e.action === 'UPDATE' && w.verb === 'changed' && !lbl) return '';
    return `<span>You ${esc(w.verb)} ${esc(AUD_NOUN[e.tbl] || e.tbl)}${lbl ? ' <b>' + esc(String(lbl)) + '</b>' : ''}</span>`;
  }).map((h, i, all) => h && (i === 0 || h !== all[i - 1]) && `<div class="li"><div class="li-main">${h}<span class="mut small">${ago(acts[i].at)}</span></div></div>`).filter(Boolean);
  const actList = acts == null ? '<p class="small mut">Needs the latest database update.</p>'
    : !actRows.length ? '<p class="small mut">Nothing yet. What you create, change, approve or void will show here.</p>' : `<div class="list">${actRows.join('')}</div>`;
  return `<div class="me-hero"><div class="me-avw"><label class="av-up" title="Change photo">${av(me.id, me.full_name || me.username, "me-av")}<span class="av-cam">${IC.cam(15)}</span><input type="file" accept="image/*" data-avatar hidden></label>${AV.img[me.id] ? '<button class="lnk me-avx" data-act="avatarRemove">Remove photo</button>' : '<span class="me-avx">Add a photo</span>'}</div>
      <div><span class="me-hi">Hi, ${esc(nick())}</span><h1>${esc(me.full_name || me.username || '')}</h1>
      <div class="me-chips">${me.is_admin ? chip('Owner', 'ok') : roles.map(r => chip(`${roleName(r.role)} · ${WS_NAME[r.ws] || r.ws}`, 'info')).join('')}</div></div></div>
  <div class="me-grid">
  <section class="card"><h2>My details</h2>
    <form data-form="meSave" class="stack">
      <label>Nickname <span class="small mut">(what the app calls you)</span><input name="nickname" maxlength="30" value="${esc(me.nickname || '')}" placeholder="${esc((me.full_name || '').split(' ')[0] || '')}"></label>
      <label>Phone<input name="phone" type="tel" maxlength="30" value="${esc(me.phone || '')}" placeholder="09xx xxx xxxx"></label>
      <div class="me-ro"><span>Full name</span><b>${esc(me.full_name || '—')}</b></div>
      <div class="me-ro"><span>Login name</span><b>${esc(me.username || '—')}</b></div>
      ${me.since ? `<div class="me-ro"><span>On the app since</span><b>${fmtD(me.since)}</b></div>` : ''}
      <p class="small mut">To change your full name or login name, ask the owner.</p>
      <button class="pri">Save</button></form></section>
  <section class="card"><h2>My role${me.is_admin || roles.length > 1 ? 's' : ''}</h2>${roleCards}
    <p class="small mut mt">Need to do something your role doesn't allow? Ask the owner or your manager.</p></section>
  <section class="card"><h2>Password &amp; sign-in</h2>
    <form data-form="mePassword" class="stack">
      <label>New password<input name="pw" type="password" minlength="8" autocomplete="new-password" required></label>
      <label>Type it again<input name="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
      <label class="row small"><input type="checkbox" data-showpw> Show password</label>
      <button class="pri">Change password</button></form>
    ${me.last_sign_in ? `<p class="small mut mt">Last signed in: ${fmtT(me.last_sign_in)}</p>` : ''}
    <div class="me-ro"><span>This device</span><b>${dev?.registered ? `POS tablet “${esc(dev.name || '')}”` : 'Not a POS tablet'}</b></div>
    <button class="ghost mt" data-act="logout">Log out of this device</button></section>
  <section class="card"><h2>Appearance</h2>
    <div class="seg th-seg">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-theme="${k}" class="${themePref() === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="small mut mt">Auto turns dark from 9 PM to 6 AM, easier on the eyes for night work. Saved on this phone only.</p></section>
  <section class="card"><h2>Go to</h2><div class="me-go">${go2.map(([h, l]) => `<a class="btn" href="${h}">${l}</a>`).join('')}${canInstall() ? '<button class="ghost" data-act="install">Get the app</button>' : ''}</div>
    <h2 class="mt">Good to know</h2><ul class="me-tips">
      <li>Keep your password to yourself. Everything you do is saved under your name.</li>
      <li>Using a shared or borrowed phone? Log out when you're done.</li>
      <li>Forgot your password? Ask the owner to reset it.</li></ul></section>
  </div>
  ${teamHtml(team)}
  <section class="card mt"><h2>My recent activity</h2>${actList}</section>`;
};
// My teammates: everyone on the team, who's in the app right now, and a quick poke
const ONLINE_MS = 2 * 60 * 1000;
function seenText(t) {
  if (!t) return ["Hasn't opened the app yet", 'never'];
  const ms = Date.now() - new Date(t);
  if (ms < ONLINE_MS) return ['In the app now', 'on'];
  if (ms < 864e5) return ['Active ' + ago(t), 'today'];
  return ['Last in ' + new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), 'old'];
}
function teamHtml(team) {
  if (!team) return '<section class="card mt"><h2>My teammates</h2><p class="small mut">Needs the latest database update.</p></section>';
  const others = team.filter(t => t.id !== S.me.id), nOn = others.filter(t => seenText(t.last_seen)[1] === 'on').length;
  const roles = t => t.is_admin ? chip('Owner', 'ok') : (t.roles || []).map(r => chip(`${roleName(r.role)} · ${WS_NAME[r.ws] || r.ws}`, 'info')).join(' ');
  return `<section class="card mt" id="teammates"><div class="row"><h2>My teammates <span class="mut small">${others.length}</span></h2><span class="sp"></span>
      <span class="tm-on">${nOn ? `<i></i>${nOn} in the app now` : 'Nobody else in the app right now'}</span></div>
    ${others.length > 6 ? '<input class="search" placeholder="Find a teammate…" data-filter="#tmList .tm">' : ''}
    <div class="tm-list" id="tmList">${others.map(t => { const [txt, st] = seenText(t.last_seen);
      return `<div class="tm"><div class="tm-av ${st}">${av(t.id, t.full_name)}<i></i></div>
        <div class="tm-main"><b>${esc(t.name)}</b>${t.name !== t.full_name ? ` <span class="mut small">${esc(t.full_name)}</span>` : ''}
          <div class="tm-roles">${roles(t)}</div><span class="tm-st ${st}">${esc(txt)}</span></div>
        <a class="btn" href="#/pokes/new~${t.id}" title="Poke ${esc(t.name)}">Poke</a></div>`; }).join('') || '<p class="mut">No teammates yet.</p>'}</div></section>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (!b) return;
  try { localStorage.setItem(THEME_KEY, b.dataset.theme); } catch (err) {} applyTheme();
  document.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b));
  toast(b.dataset.theme === 'auto' ? 'Dark from 9 PM to 6 AM' : b.dataset.theme === 'dark' ? 'Always dark' : 'Always light'); });
FORMS.meSave = async f => {
  await db.rpc('my_update_profile', { p_nickname: f.nickname || '', p_phone: f.phone || '' });
  S.me = await db.rpc('my_access'); toast('Saved'); refresh();
};
FORMS.mePassword = async (f, form) => {
  if ((f.pw || '').length < 8) return toast('Use at least 8 characters.', true);
  if (f.pw !== f.pw2) return toast("The two passwords don't match.", true);
  await db.changePassword(f.pw); form.reset(); toast('Password changed');
};
document.addEventListener('change', e => { if (e.target.matches('[data-showpw]')) e.target.closest('form').querySelectorAll('input[name^=pw]').forEach(i => i.type = e.target.checked ? 'text' : 'password'); });

/* ================= POKES (endorsements) ================= */
// A short note to a person or a team ("Put the crispy pata in the oven by 8AM tomorrow"). It shows on their home screen,
// the in the header counts what's open, and their phone gets a notification. Owner, managers and head chefs see every poke.
const POKE = { unread: { open: 0, unseen: 0, replies: 0 }, lastId: null, lastReply: null };
const pokeDue = d => {
  if (!d) return '';
  const t = new Date(d), now = new Date(), day = x => x.toDateString(), tm = new Date(now.getTime() + 864e5);
  const clock = t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  return day(t) === day(now) ? `by ${clock} today` : day(t) === day(tm) ? `by ${clock} tomorrow` : `by ${t.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}, ${clock}`;
};
const pokeLate = p => p.due_at && !p.done_at && new Date(p.due_at) < new Date();
function pokeCard(p, mode) {
  // mode: 'in' (for me), 'sent' (I sent it), 'all' (overseer view)
  const head = mode === 'in' ? `<b>${esc(p.from_name)}</b>${p.others > 0 ? ` <span class="mut small">to you + ${p.others} other${p.others > 1 ? 's' : ''}</span>` : ''}`
    : `<b>${esc(mode === 'sent' ? 'You' : p.from_name)}</b> → ${esc(p.to_label || (p.recipients || []).map(r => r.name).join(', '))}`;
  const rec = mode !== 'in' && p.recipients ? `<div class="pk-rec">${p.recipients.map(r => `<span class="pk-st ${r.done_at ? 'done' : r.seen_at ? 'seen' : ''}${mode === 'sent' && r.done_at && r.done_at > (p.sender_seen_at || p.created_at) ? ' new' : ''}" title="${r.done_at ? 'Done ' + fmtT(r.done_at) : r.seen_at ? 'Seen ' + fmtT(r.seen_at) : 'Not seen yet'}">${r.done_at ? '✓' : r.seen_at ? 'Seen ·' : '•'} ${esc(r.name)}${r.reply ? `: “${esc(r.reply)}”` : ''}</span>`).join('')}</div>` : '';
  const allDone = p.recipients && p.recipients.every(r => r.done_at);
  const acts = p.cancelled_at ? `<span class="chip mut">Taken back</span>`
    : mode === 'in' ? (p.done_at ? `<span class="chip ok">Done ${ago(p.done_at)}</span>${p.reply ? ` <span class="small mut">“${esc(p.reply)}”</span>` : ''} <button class="lnk" data-act="pokeUndo" data-id="${p.id}">Undo</button>`
        : `<button class="pri" data-act="pokeDone" data-id="${p.id}">✓ Done</button><button class="ghost" data-act="pokeReply" data-id="${p.id}">Reply</button><button class="lnk" data-act="pokeToTask" data-poke="${esc(JSON.stringify({ id: p.id, body: p.body, due: p.due_at }))}">＋ My tasks</button>`)
    : (allDone ? '<span class="chip ok">All done</span>' : '') + ((mode === 'sent' || isAdmin()) && !allDone ? `<button class="lnk" data-act="pokeCancel" data-id="${p.id}">Take back</button>` : '');
  const face = av(mode === 'sent' ? S.me.id : p.from_user, mode === 'sent' ? S.me.full_name : p.from_full || p.from_name, 'sm');
  return `<div class="poke${p.urgent ? ' urgent' : ''}${(mode === 'in' && p.done_at) || p.cancelled_at ? ' done' : ''}">
    <div class="pk-h"><span class="pk-who">${face}<span>${head}</span></span><span class="mut small">${ago(p.created_at)}</span></div>
    <div class="pk-b">${esc(p.body)}</div>
    ${p.urgent || p.due_at ? `<div class="pk-tags">${p.urgent ? '<span class="chip bad">Urgent</span>' : ''}${p.due_at ? `<span class="chip ${pokeLate(p) ? 'bad' : 'warn'}">${esc(pokeDue(p.due_at))}${pokeLate(p) ? ' · late' : ''}</span>` : ''}</div>` : ''}
    ${rec}<div class="pk-a">${acts}</div></div>`;
}
// Mark what's on screen as seen (clears the bell)
async function pokesSeen(list) {
  const ids = (list || []).filter(p => !p.seen_at && !p.done_at).map(p => p.id); if (!ids.length) return;
  await Promise.all(ids.map(id => db.rpc('poke_seen', { p_poke: id }).catch(() => {})));
  pokePoll();
}
// Home screen block: open pokes for me
// "done / replied" on pokes I sent, since I last looked at Sent
function pokeNews(sent) {
  const out = [];
  for (const p of sent || []) if (!p.cancelled_at) for (const r of p.recipients || [])
    if (r.done_at && r.done_at > (p.sender_seen_at || p.created_at)) out.push({ p, r });
  return out.sort((a, b) => b.r.done_at.localeCompare(a.r.done_at));
}
const newsLine = ({ p, r }) => `<a class="pk-nl" href="#/pokes/sent">${av(r.id, r.name, 'sm')}<span><b>${esc(r.name)}</b> ${r.reply ? `replied: “${esc(r.reply)}”` : 'marked it done ✓'}<small>re: ${esc(p.body.slice(0, 90))}${p.body.length > 90 ? '…' : ''} · ${ago(r.done_at)}</small></span></a>`;
async function homePokes() {
  const d = await db.rpc('my_pokes').catch(() => null); if (!d) return '';
  const open = d.inbox.filter(p => !p.done_at);
  setTimeout(() => pokesSeen(open), 1200);
  const news = pokeNews(d.sent);
  return `<section class="hw-panel"><div class="hp-h"><span class="hp-ic pk">${IC.msg(18)}</span><h2>Pokes for you</h2>${open.length ? `<span class="hp-n">${open.length}</span>` : ''}<span class="sp"></span>
      <a class="hp-a" href="#/pokes/new" title="Poke someone">＋ Poke</a></div>
    ${news.length ? `<div class="hp-news">${news.slice(0, 3).map(newsLine).join('')}${news.length > 3 ? `<a class="small" href="#/pokes/sent">+ ${news.length - 3} more updates</a>` : ''}</div>` : ''}
    ${open.length ? open.slice(0, 4).map(p => pokeCard(p, 'in')).join('') + (open.length > 4 ? `<a class="hp-more" href="#/pokes">See all ${open.length} →</a>` : '')
      : `<div class="hp-empty"><div><b>All clear</b><small>No endorsements waiting for you.</small></div></div>`}</section>`;
}
routes.pokes = async arg => {
  const tab = arg === 'sent' || arg === 'all' ? arg : 'in', compose = (arg || '').startsWith('new'), preTo = (arg || '').split('~')[1] || '';
  const [d, people] = await Promise.all([db.rpc('my_pokes'), compose ? db.rpc('poke_people') : null]);
  const lists = { in: d.inbox, sent: d.sent, all: d.all || [] }, nOpen = d.inbox.filter(p => !p.done_at).length;
  if (tab === 'in' && !compose) setTimeout(() => pokesSeen(d.inbox), 800);
  if (compose) setTimeout(() => { const f = $('form[data-form="sendPoke"]'); if (f) pkSummary(f); }, 0);
  const nNews = pokeNews(d.sent).length;
  if (tab === 'sent' && nNews) setTimeout(() => db.rpc('poke_sent_seen').then(pokePoll).catch(() => {}), 1500);
  const tabs = [['in', `For me${nOpen ? ' (' + nOpen + ')' : ''}`], ['sent', `Sent${nNews ? ' (' + nNews + ' new)' : ''}`], ...(d.overseer ? [['all', 'All pokes']] : [])];
  return `<div class="row"><h1>Pokes</h1><span class="sp"></span>${compose ? '' : '<a class="btn pri" href="#/pokes/new">＋ New poke</a>'}</div>
  <p class="mut small" style="margin-top:-4px">Endorsements to a person or a team. They show on their home screen and ping their phone.${d.overseer ? ' As owner, manager or head chef you see every poke.' : ''}</p>
  ${compose ? pokeForm(people, preTo) : ''}
  <div class="seg">${tabs.map(([k, l]) => `<a href="#/pokes${k === 'in' ? '' : '/' + k}" class="${tab === k && !compose ? 'on' : ''}">${l}</a>`).join('')}</div>
  <div class="pk-list mt">${lists[tab].length ? lists[tab].map(p => pokeCard(p, tab)).join('') : `<div class="card mut">${tab === 'in' ? 'No pokes for you.' : tab === 'sent' ? "You haven't sent any pokes in the last 14 days." : 'No pokes in the last 7 days.'}</div>`}</div>
  ${await pushCard(d)}`;
};
function pokeTeams(people) {
  const t = {};
  for (const p of people) for (const r of p.roles || []) {
    for (const k of [r.ws + '|' + r.role, r.ws + '|*']) (t[k] ||= { ws: r.ws, role: k.split('|')[1], ids: new Set() }).ids.add(p.id);
  }
  return Object.values(t).map(x => ({ ...x, n: x.ids.size, label: x.role === '*' ? `Everyone · ${WS_NAME[x.ws] || x.ws}` : `${roleName(x.role)} · ${WS_NAME[x.ws] || x.ws}` }))
    .sort((a, b) => (a.role === '*') - (b.role === '*') || a.label.localeCompare(b.label));
}
const pokeDraft = () => { const d = sessionStorage.getItem('pokeDraft') || ''; sessionStorage.removeItem('pokeDraft'); return d; };
function pokeForm(people, preTo) {
  const others = people.filter(p => p.id !== S.me.id), teams = pokeTeams(others);
  const role1 = p => roleName((p.roles || [])[0]?.role || '') || (p.is_admin ? 'Owner' : '');
  const plural = r => r === '*' ? 'Everyone' : /staff$/i.test(roleName(r)) ? roleName(r) : roleName(r) + 's';
  // people as bubble heads; teams tucked away, grouped by workspace
  const groups = Object.keys(WS_NAME).map(ws => [ws, teams.filter(t => t.ws === ws)]).filter(([, ts]) => ts.length);
  return `<form class="card pk-form" data-form="sendPoke">
    <h2>New poke</h2>
    <div class="pk-to"><span class="pk-lbl">To</span><span class="pk-sum mut">Tap a face (or a team below)</span><button type="button" class="lnk pk-clear" data-act="pkClear" hidden>Clear</button></div>
    ${others.length > 10 ? '<input class="search pk-find" placeholder="Find a person…" data-filter=".pk-faces .pk-face">' : ''}
    <div class="pk-faces">${others.map(p => `<label class="pk-face" title="${esc(p.full_name)}"><input type="checkbox" name="u_${p.id}"${p.id === preTo ? ' checked' : ''} data-label="${esc(p.name)}">
      <span class="pk-fav">${av(p.id, p.full_name, '')}<i class="pk-ck">✓</i></span><b>${esc(p.name)}</b><small>${esc(role1(p))}</small><span hidden>${esc(p.full_name)}</span></label>`).join('')}</div>
    <details class="pk-tdet"><summary>Send to a whole team</summary>
      ${groups.map(([ws, ts]) => `<div class="pk-tg"><span>${WS_NAME[ws]}</span><div class="pk-teams">${ts.map(t => `<label class="pk-chip"><input type="checkbox" name="t_${t.ws}|${t.role}" data-label="${esc(t.label)}"><span>${esc(plural(t.role))} <i>${t.n}</i></span></label>`).join('')}</div></div>`).join('')}</details>
    <label>Message<textarea name="body" maxlength="500" rows="3" required placeholder="e.g. Put the crispy pata in the oven by 8AM tomorrow">${esc(pokeDraft())}</textarea></label>
    <div class="pk-row"><label>Needed by<input type="datetime-local" name="due"></label>
      <label class="pk-urg"><input type="checkbox" name="urgent"> <span>Urgent</span></label></div>
    <div class="row end"><a class="btn" href="#/pokes">Cancel</a><button class="pri">Send poke</button></div></form>`;
}
// "To: Kamata, Jeoff + Chefs · Catering" as you tap
function pkSummary(form) {
  const on = [...form.querySelectorAll('.pk-face input:checked, .pk-tdet input:checked')].map(b => b.dataset.label);
  const sum = form.querySelector('.pk-sum'); sum.textContent = on.length ? on.join(', ') : 'Tap a face (or a team below)';
  sum.classList.toggle('mut', !on.length); form.querySelector('.pk-clear').hidden = !on.length;
  const nT = form.querySelectorAll('.pk-tdet input:checked').length, s = form.querySelector('.pk-tdet summary');
  s.textContent = nT ? `${nT} team${nT > 1 ? 's' : ''} picked` : 'Send to a whole team';
}
document.addEventListener('change', e => { const f = e.target.closest('form[data-form="sendPoke"]'); if (f && e.target.type === 'checkbox' && e.target.name !== 'urgent') pkSummary(f); });
ACT.pkClear = async el => { const f = el.closest('form'); f.querySelectorAll('.pk-face input, .pk-tdet input').forEach(i => i.checked = false); pkSummary(f); };
FORMS.sendPoke = async (f, form) => {
  const boxes = [...form.querySelectorAll('input[type=checkbox]:checked')];
  const to = boxes.filter(b => b.name.startsWith('u_')).map(b => b.name.slice(2));
  const teams = boxes.filter(b => b.name.startsWith('t_')).map(b => { const [ws, role] = b.name.slice(2).split('|'); return { ws, role }; });
  if (!to.length && !teams.length) return toast('Pick who to poke.', true);
  const label = boxes.filter(b => b.dataset.label).map(b => b.dataset.label).join(', ');
  const id = await db.rpc('send_poke', { p_to: to, p_teams: teams.length ? teams : null, p_body: f.body, p_due: f.due ? new Date(f.due).toISOString() : null, p_urgent: !!f.urgent, p_label: label });
  db.edge(PUSH_FN, { poke_id: id });   // phone notifications; the poke is already saved even if this fails
  toast('Poke sent to ' + label); go('#/pokes/sent');
};
ACT.pokeDone = async el => { await db.rpc('poke_done', { p_poke: el.dataset.id, p_reply: '' }); db.edge(PUSH_FN, { poke_id: el.dataset.id, event: 'done' }); toast('Marked done — the sender is told'); pokePoll(); refresh(); };
ACT.pokeReply = async el => { const r = prompt('Reply (it also marks the poke done):'); if (r == null) return; await db.rpc('poke_done', { p_poke: el.dataset.id, p_reply: r }); db.edge(PUSH_FN, { poke_id: el.dataset.id, event: 'done' }); toast('Reply sent'); pokePoll(); refresh(); };
ACT.pokeUndo = async el => { await db.rpc('poke_undo', { p_poke: el.dataset.id }); pokePoll(); refresh(); };
ACT.pokeCancel = async el => { if (!confirm('Take back this poke? It disappears from their home screen.')) return; await db.rpc('poke_cancel', { p_poke: el.dataset.id }); toast('Taken back'); refresh(); };

// The count: checked every 30 seconds and whenever the app comes back to the front
function bellHtml() { const u = POKE.unread, n = (u.open || 0) + (u.replies || 0);
  return `<a href="#/pokes${!u.open && u.replies ? '/sent' : ''}" class="bell${u.unseen || u.replies ? ' new' : ''}" title="Pokes${u.replies ? ` · ${u.replies} update${u.replies > 1 ? 's' : ''} on pokes you sent` : ''}">${IC.bell(22)}${n ? `<i>${n}</i>` : ''}</a>`; }
function paintBell() {
  document.querySelectorAll('.bell-slot').forEach(s => s.innerHTML = bellHtml());
  document.querySelectorAll('.mn-pokes i').forEach(i => { const n = (POKE.unread.open || 0) + (POKE.unread.replies || 0); i.textContent = n || ''; i.hidden = !n; });
  document.querySelector('.mnav summary')?.classList.toggle('dot', !!(POKE.unread.unseen || POKE.unread.replies));
}
let pokeBusy = false;
async function pokePoll() {
  if (!S.user || !S.me || pokeBusy || !navigator.onLine) return; pokeBusy = true;
  try {
    if (!document.hidden) db.rpc('i_am_here').catch(() => {});   // "in the app now" for My teammates
    tkReminderCheck();
    const u = await db.rpc('poke_unread'); const prev = POKE.lastId; POKE.unread = u; paintBell();
    const l = u.latest;
    if (l && l.id !== prev && prev !== null) {
      toast(`${l.from} poked you: ${l.body.slice(0, 70)}${l.body.length > 70 ? '…' : ''}`);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !(await pushSub())) {
        const reg = await navigator.serviceWorker?.getRegistration(); reg?.showNotification(`${l.urgent ? 'Urgent: ' : ''}${l.from} poked you`, { body: l.body, tag: 'poke-' + l.id, icon: './icons/icon-192.png' });
      }
      if (['home', 'pokes'].includes((current || 'home').split('/')[0])) refresh();
    }
    POKE.lastId = l ? l.id : (prev ?? '');
    // someone did (or answered) a poke I sent
    const r = u.latest_reply, prevR = POKE.lastReply;
    if (r && r.key !== prevR && prevR !== null) {
      const t = r.reply ? `${r.from} replied: “${r.reply}”` : `✓ ${r.from} did your poke`;
      toast(`${t} — ${r.body.slice(0, 50)}${r.body.length > 50 ? '…' : ''}`);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !(await pushSub())) {
        const reg = await navigator.serviceWorker?.getRegistration(); reg?.showNotification(t, { body: 're: ' + r.body, tag: 'pokedone-' + r.key, icon: './icons/icon-192.png' });
      }
      if (['home', 'pokes'].includes((current || 'home').split('/')[0])) refresh();
    }
    POKE.lastReply = r ? r.key : (prevR ?? '');
  } catch (e) {} finally { pokeBusy = false; }
}
setInterval(pokePoll, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pokePoll(); });

// Phone notifications for this phone
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function pushSub() { try { const reg = await navigator.serviceWorker?.getRegistration(); return await reg?.pushManager?.getSubscription() || null; } catch (e) { return null; } }
async function vapidKey() { const r = await db.select('app_config', { eq: { key: 'vapid_public' } }).catch(() => []); return r?.[0]?.value || ''; }
async function pushCard(d) {
  const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ok = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const perm = ok ? Notification.permission : 'unsupported', sub = ok ? await pushSub() : null;
  const status = !ok ? (IOS && !standalone ? 'On iPhone, add the app to your home screen first (Get the app), open it from there, then come back here.' : "This browser can't show notifications. Pokes still appear on your home screen.")
    : perm === 'denied' ? 'Notifications are blocked for this app. Allow them in the phone’s Settings → Notifications (or the browser’s site settings), then come back here.'
    : sub ? 'On for this phone ✓ You’ll be pinged when someone pokes you.' : perm === 'granted' ? 'Allowed, but not connected yet. Tap the button to finish.' : 'Off for this phone.';
  return `<section class="card mt"><h2>Phone notifications</h2><p class="small">${status}</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">${ok && perm !== 'denied' && !sub ? '<button class="pri" data-act="pushOn">Turn on for this phone</button>' : ''}${sub ? '<button class="ghost" data-act="pushTest">Send me a test</button><button class="lnk" data-act="pushOff">Turn off for this phone</button>' : ''}</div>
    ${d?.overseer ? `<label class="row small mt" style="gap:8px;justify-content:flex-start"><input type="checkbox" data-watch ${d.watch !== false ? 'checked' : ''} style="width:18px;height:18px"> Also notify me of every poke between other team members</label>` : ''}</section>`;
}
ACT.pushOn = async () => {
  const p = await Notification.requestPermission(); if (p !== 'granted') return toast('Notifications were not allowed.', true);
  const key = await vapidKey();
  if (!key) { toast('On while the app is open. Full phone notifications start once the owner finishes the setup.'); return refresh(); }
  const reg = await navigator.serviceWorker.ready;
  const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
  const j = s.toJSON(); await db.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
  toast('Notifications on for this phone'); refresh();
};
ACT.pushOff = async () => { const s = await pushSub(); if (s) { await db.rpc('push_unsubscribe', { p_endpoint: s.endpoint }).catch(() => {}); await s.unsubscribe(); } toast('Notifications off for this phone'); refresh(); };
ACT.pushTest = async () => { const reg = await navigator.serviceWorker.ready; await reg.showNotification("Test from Romualdo's", { body: 'This is how a poke will look on this phone.', icon: './icons/icon-192.png' }); };
document.addEventListener('change', async e => { if (!e.target.matches('[data-watch]')) return;
  try { await db.rpc('set_watch_pokes', { p_on: e.target.checked }); toast(e.target.checked ? 'You’ll be notified of every poke' : 'Only pokes to you will notify you'); } catch (err) { toast(err.message, true); } });

// Owner: one-time setup of the phone-notification keys. Made in this browser; the private key is shown once and saved nowhere in the app.
function pushSetupHtml(has) {
  return `<section class="card mt"><h2>Phone notifications setup (Pokes)</h2>
    <p class="small">${has ? 'Set up ✓ The public key is saved. If phones don’t get pinged, check the <b>poke-push</b> Edge Function and its secrets.' : 'Not set up yet. Pokes already show in the app; this lets them ping phones even when the app is closed.'}</p>
    <button class="${has ? 'ghost' : 'pri'}" data-act="vapidMake">${has ? 'Make new keys (every phone must turn notifications on again)' : 'Create notification keys'}</button><div id="vapidOut"></div></section>`;
}
ACT.vapidMake = async el => {
  if (el.classList.contains('ghost') && !confirm('Make new keys? Every phone will have to tap "Turn on" again.')) return;
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey), pub = b64u(await crypto.subtle.exportKey('raw', k.publicKey)), priv = jwk.d;
  await db.rpc('admin_set_config', { p_key: 'vapid_public', p_value: pub });
  const row = (n, v) => `<div class="vk"><span>${n}</span><code>${esc(v)}</code><button type="button" class="ghost" data-copy="${esc(v)}">Copy</button></div>`;
  $('#vapidOut').innerHTML = `<div class="alert warn small mt"><b>Do this now — the private key is shown only once.</b>
    <ol><li>Supabase → <b>Edge Functions</b> → <b>Secrets</b> → add these three (name and value):</li></ol>
    ${row('VAPID_PUBLIC_KEY', pub)}${row('VAPID_PRIVATE_KEY', priv)}${row('VAPID_SUBJECT', 'https://romualdos.ph')}
    <ol start="2"><li>Edge Functions → <b>Deploy a new function</b> → name it <b>poke-push</b> → paste the code from <code>supabase/functions/poke-push/index.ts</code> on GitHub → deploy → turn <b>Verify JWT</b> off in its settings.</li>
    <li>Each person opens <b>Pokes</b> and taps <b>Turn on for this phone</b>.</li></ol>
    <p>Don't paste the private key anywhere else — not in chat, not on GitHub.</p></div>`;
  el.remove();
};
document.addEventListener('click', async e => { const b = e.target.closest('[data-copy]'); if (!b) return; try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied ✓'; } catch (err) { toast('Copy failed — select it and copy by hand', true); } });

function tabletsHtml(tabs, dev) {
  if (!tabs) return `<section class="card mt"><h2>POS tablets</h2><p class="small mut">Needs the latest database update (migration <code>20261127000100_pos_tablets</code>).</p></section>`;
  const live = tabs.filter(t => !t.revoked_at);
  return `<section class="card mt" id="pos-tablets"><h2>POS tablets</h2>
    <p class="small mut">Only these tablets can ring up sales, send orders to the kitchen and take payment. You (owner) can use the POS anywhere; managers can check Sales, close the drawer and void a paid order from any device.</p>
    ${dev?.registered ? `<div class="alert ok small">✓ This device is registered as <b>${esc(dev.name)}</b>.</div>`
      : `<form class="row" data-form="regTablet" style="flex-wrap:wrap;gap:8px"><input name="name" placeholder="e.g. Counter tablet" required maxlength="60" style="flex:1;min-width:200px"><button class="pri">Register this device</button></form>
         <p class="small mut">Do this on the tablet itself${STANDALONE ? '' : ', after adding the app to its home screen and opening it from there (the app and the browser keep separate memory)'}.</p>`}
    ${live.length ? `<div class="list">${live.map(t => `<div class="li"><div class="li-main"><b>${esc(t.name)}${dev?.id === t.id ? ' ' + chip('this device', 'info') : ''}</b><span class="mut small">Registered ${fmtT(t.registered_at)}${t.last_seen ? ' · last used ' + fmtT(t.last_seen) : ''}</span></div>
      <button type="button" class="ghost sm danger" data-act="revokeTablet" data-id="${t.id}" data-name="${esc(t.name)}" data-me="${dev?.id === t.id ? 1 : ''}">Remove</button></div>`).join('')}</div>`
      : '<p class="small mut">No tablets yet — until you register one, only you can use the POS.</p>'}
  </section>`;
}
FORMS.regTablet = async f => {
  const key = await db.rpc('pos_register_device', { p_name: f.name });
  posDevice.set(key); toast(`Registered “${f.name.trim()}” — this device can now use the POS`); refresh();
};
ACT.revokeTablet = async el => {
  if (!confirm(`Remove “${el.dataset.name}”? It stops working as a POS right away.`)) return;
  await db.rpc('pos_revoke_device', { p_id: el.dataset.id });
  if (el.dataset.me) posDevice.set('');
  toast('Tablet removed'); refresh();
};
FORMS.savePerson = async (f, el) => {
  // r_<workspace>_<role>: the role itself may contain "_" (event_specialist, head_chef, rnd_chef)
  const roles = Object.keys(f).filter(k => k.startsWith('r_')).map(k => { const [, ws, ...rest] = k.split('_'); return { ws, role: rest.join('_') }; });
  await db.rpc('admin_set_member', { p_email: el.dataset.email, p_username: f.username, p_full_name: f.full_name, p_roles: roles, p_is_admin: !!f.is_admin, p_active: !!f.active });
  let note = '';
  try { await db.rpc('admin_set_nickname', { p_user: el.dataset.id, p_nickname: f.nickname || '' }); }
  catch (e) { note = ' — nickname needs the latest database update (20261127000400_nicknames)'; }
  if (el.dataset.id === S.me?.id) S.me = await db.rpc('my_access');   // your own nickname shows straight away
  toast('Saved' + note); refresh();
};

/* ================= account ================= */
ACT.account = async () => go('#/me');
ACT.logout = async () => { if (!confirm('Log out of the staff app?\n\nYou stay signed in until you log out, so you only need this on a shared or lost phone.')) return; S.user = null; await db.signOut(); S.user = null; S.me = null; location.hash = ''; renderLogin('You have logged out.'); };
ACT.reload = () => refresh();

/* ================= events wiring ================= */
function formData(form) { const o = {}; new FormData(form).forEach((v, k) => o[k] = typeof v === 'string' ? v.trim() : v); return o; }
document.addEventListener('submit', async e => {
  const form = e.target; const name = form.dataset.form; if (!name) return;
  e.preventDefault(); if (name === 'none' || !FORMS[name]) return;
  const btns = form.querySelectorAll('button'); btns.forEach(b => b.disabled = true);
  const dk = draftable(form) ? draftKey(form) : null, dv = dk && localStorage.getItem(dk);
  clearTimeout(DRAFT.timers.get(form)); clearTimeout(AUTO.timers.get(form)); if (dk) try { localStorage.removeItem(dk); } catch (e) {}
  try { await FORMS[name](formData(form), form); } catch (err) { console.error(err); toast(err.message, true); if (dv) try { localStorage.setItem(dk, dv); } catch (e) {} } finally { btns.forEach(b => b.disabled = false); }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault(); if (el.disabled) return; el.disabled = true;
  try { await ACT[el.dataset.act](el); } catch (err) { console.error(err); toast(err.message, true); } finally { el.disabled = false; }
});
// Names start with a capital letter: "ox" → "Ox" as it is typed (ingredients, dishes, categories, sections).
// Units (kg, pc, L…) are left as typed.
const CAP_SEL = 'input[list]:not([list="dl-units"]), input[data-cap]';
const cap1 = s => s.replace(/^(\s*)(\p{Ll})/u, (_, sp, c) => sp + c.toUpperCase());
document.addEventListener('input', e => {
  const t = e.target; if (!t.matches?.(CAP_SEL) || (e.inputType && !e.inputType.startsWith('insert'))) return;
  const v = t.value, c = cap1(v); if (c === v) return;
  const a = t.selectionStart, b = t.selectionEnd; t.value = c; try { t.setSelectionRange(a, b); } catch (err) {}
});
// phone keyboards: start these fields with Shift on
new MutationObserver(() => document.querySelectorAll(CAP_SEL).forEach(i => { if (!i.hasAttribute('autocapitalize')) i.setAttribute('autocapitalize', 'sentences'); }))
  .observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', e => { const j = e.target.closest('[data-jump]'); if (j) document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
document.addEventListener('input', e => {
  const t = e.target.dataset?.filter; if (!t) return; const q = e.target.value.toLowerCase();
  document.querySelectorAll(t).forEach(r => r.hidden = q && !r.textContent.toLowerCase().includes(q));
  document.querySelectorAll('[data-group]').forEach(g => g.hidden = ![...g.querySelectorAll('.li')].some(r => !r.hidden));
});

/* ================= start ================= */
(async () => {
  if (!window.ROM_SUPABASE?.url && !window.ROM_TEST_API) { $('#main').innerHTML = '<div class="card">The app is not connected yet (config.js).</div>'; return; }
  try { S.user = await db.currentUser(); if (S.user) return await afterLogin(); }
  catch (e) { console.error(e); if (S.user && (db.isNetErr(e) || !navigator.onLine)) return offlineStart(); }
  renderLogin();
})();
/* ---- Staying signed in, seamlessly ----
   Opening the app with no signal keeps the saved login and retries by itself instead of asking for the password. */
function offlineStart() {
  $('#top').innerHTML = `<div class="bar"><span class="brand"><img src="../assets/logo.png" alt="Romualdo's"><em>Staff</em></span></div>`;
  $('#main').innerHTML = `<div class="card login"><h1>Waiting for internet…</h1><p>You're still signed in. The app will open by itself as soon as the phone is back online.</p><button class="pri wide" data-act="retryStart">Try again</button></div>`;
}
ACT.retryStart = async () => { try { S.user = await db.currentUser(); if (S.user) await afterLogin(); else renderLogin(); } catch (e) { toast('Still no internet. Check the Wi-Fi or data.', true); } };
window.addEventListener('online', () => { setNet(); if (S.user && !S.me) ACT.retryStart(); });
window.addEventListener('offline', setNet);
function setNet() {
  let b = document.getElementById('netbar');
  if (navigator.onLine) { b?.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'netbar'; document.body.appendChild(b); }
  b.textContent = 'No internet — changes won’t save until you’re back online.';
}
setNet();
db.onSignedOut(() => { if (S.user) { S.user = null; S.me = null; renderLogin('You were signed out. Please log in again.'); } });
// Phone woke up / app came back to the screen: renew the login quietly
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user) db.wake(); });

/* ================= BILLING (Statement of Account per event + payments) ================= */
const canBill = () => can('catering', 'manager', 'finance');
const PAY_ST = { none: ['No bill yet', ''], unpaid: ['Unpaid', 'bad'], partial: ['Partially paid', 'warn'], paid: ['Paid in full', 'ok'], over: ['Overpaid', 'info'] };
const payChip = m => m && m.status !== 'none' ? chip(PAY_ST[m.status][0], PAY_ST[m.status][1]) : '';
const PAY_METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['bank', 'Bank transfer / deposit'], ['check', 'Check'], ['card', 'Card'], ['other', 'Other']];
const payMethod = k => (PAY_METHODS.find(x => x[0] === k) || [, k])[1];
async function moneyOf(ids) { const m = {}; if (ids.length) (await db.rpc('event_money', { p_events: ids })).forEach(r => m[r.event_id] = r); return m; }
const lineAmt = (l, pax) => Math.round(num(l.rate) * (l.qty === null || l.qty === '' || l.qty === undefined ? num(pax) : num(l.qty)) * 100) / 100;
function billCalc(bill, lines, pays, pax) {
  const sub = lines.reduce((a, l) => a + lineAmt(l, pax), 0), disc = num(bill?.discount), total = Math.max(0, Math.round((sub - disc) * 100) / 100);
  const paid = pays.filter(p => !p.voided_at).reduce((a, p) => a + num(p.amount), 0);
  return { sub, disc, total, paid, balance: Math.round((total - paid) * 100) / 100 };
}
// Starting lines from the event: buffet = one package line (contract ÷ guests per head); trays/packs = one line per menu item
function linesFromEvent(ev, menu) {
  const nm = m => m.dish_id ? S.dishById[m.dish_id]?.name : m.pack_id ? (S.packs.find(p => p.id === m.pack_id)?.name || 'Packed meal set') : m.custom_name;
  if (ev.kind === 'buffet') {
    const pax = num(ev.pax), c = num(ev.contract_price), items = COURSES.flatMap(c => sortMenu(menu.filter(m => m.course === c))).concat(menu.filter(m => !COURSES.includes(m.course))).map(nm).filter(Boolean).join('\n');
    return [{ label: ev.sheet?.pkg ? ev.sheet.pkg + ' package' : 'Catering package', items, rate: c && pax ? Math.round(c / pax * 100) / 100 : c, qty: c && !pax ? 1 : null, unit: c && !pax ? '' : 'head' }];
  }
  const L = menu.map(m => ({ label: nm(m) || 'Item', items: m.note || '', rate: 0, qty: num(m.qty) || 1, unit: m.course === 'Drinks' || DRINK_RE.test(nm(m) || '') ? '' : ev.kind === 'packs' ? 'pack' : 'tray' }));
  L.sort((x, y) => (x.unit ? 0 : 1) - (y.unit ? 0 : 1));   // trays / packs first, then drinks
  if (ev.sheet?.fulfil === 'Delivery') L.push({ label: 'Delivery', items: ev.venue || '', rate: 0, qty: 1, unit: '' });
  return L.length ? L : [{ label: 'Food trays', items: '', rate: num(ev.contract_price), qty: 1, unit: '' }];
}
function billRow(l, i, pax) {
  const q = l.qty === null || l.qty === undefined ? '' : l.qty;
  return `<tr data-bl><td><input name="label_${i}" value="${esc(l.label || '')}" placeholder="e.g. Catering package" required><textarea name="items_${i}" rows="2" placeholder="Menu or details (one per line) — optional">${esc(l.items || '')}</textarea></td>
   <td><input name="rate_${i}" type="number" step="any" min="0" inputmode="decimal" value="${esc(l.rate ?? '')}" class="qty"></td>
   <td><input name="qty_${i}" type="number" step="any" min="0" inputmode="decimal" value="${esc(q)}" placeholder="${pax ? pax + ' pax' : 'qty'}" class="qty"></td>
   <td><select name="unit_${i}">${[['', '—'], ['head', 'per head'], ['tray', 'per tray'], ['pack', 'per pack']].map(([v, t]) => opt(v, t, (l.unit || '') === v)).join('')}</select></td>
   <td class="n" data-blamt>${peso(lineAmt(l, pax))}</td><td><button type="button" class="ghost sm" data-act="billRmRow" title="Remove line">✕</button></td></tr>`;
}
function billCard(ev, B) {
  if (!canBill()) return '';
  const { bill, lines, pays, client } = B, pax = ev.pax;
  if (!bill) return `<section class="card" id="billing"><div class="row"><h2>Billing &amp; payment</h2><span class="sp"></span>${payChip(B.money)}</div>
    <p class="mut">No statement yet. Create one and the lines are filled in from this event${ev.kind === 'buffet' ? (ev.contract_price ? ` (contract ${peso(ev.contract_price)}${ev.pax ? ' ÷ ' + ev.pax + ' guests per head' : ''})` : '') : ' (one line per tray or pack — type the prices)'}. You can change everything after.</p>
    <div class="row end"><button class="pri" data-act="billCreate" data-id="${ev.id}">Create statement of account</button></div>
    ${pays.length ? payList(ev, pays) : ''}</section>`;
  const C = billCalc(bill, lines, pays, pax), overdue = bill.due && bill.due < today() && C.balance > 0;
  return `<section class="card" id="billing"><div class="row"><h2>Billing &amp; payment</h2>${payChip(B.money)}${overdue ? chip('Overdue', 'bad') : ''}<span class="sp"></span><button class="pdf" data-act="soaPdf" data-id="${ev.id}">Statement of Account (PDF)</button></div>
   <div class="kpis"><div class="kpi"><span>Total</span><b>${peso(C.total)}</b></div><div class="kpi"><span>Paid</span><b>${peso(C.paid)}</b></div><div class="kpi"><span>Balance</span><b class="${C.balance > 0 ? 'bad-t' : 'ok-t'}">${peso(C.balance)}</b></div><div class="kpi"><span>${esc(bill.soa_no)}</span><b style="font-size:15px">${bill.due ? 'Due ' + esc(fmtD(bill.due)) : 'No due date'}</b></div></div>
   <details class="mt" ${lines.length && C.total ? '' : 'open'}><summary>Edit the statement</summary>
   <form data-form="saveBill" data-id="${ev.id}" data-pax="${esc(pax ?? '')}" class="mt">
    <div class="grid"><label>Bill to<input name="bill_to" value="${esc(bill.bill_to || '')}" placeholder="${esc(client?.name || 'Client name')}"></label><label>Address<input name="address" value="${esc(bill.address || '')}"></label>
     <label>Issued<input name="issued" type="date" value="${esc(bill.issued)}"></label><label>Due<input name="due" type="date" value="${esc(bill.due || '')}"></label></div>
    <div class="tw"><table class="bill-ed"><thead><tr><th>Description</th><th>Rate ₱</th><th>Qty</th><th>Per</th><th class="n">Amount</th><th></th></tr></thead><tbody>${lines.map((l, i) => billRow(l, i, pax)).join('')}</tbody>
     <tfoot><tr><td colspan="6"><button type="button" class="ghost sm" data-act="billAddRow">＋ Add line</button> <span class="small mut">Leave Qty blank to use the guest count${pax ? ` (${pax})` : ''}.</span></td></tr>
     <tr><td colspan="4" class="n">Less discount ₱</td><td class="n"><input name="discount" type="number" step="any" min="0" value="${esc(num(bill.discount) || '')}" class="qty" placeholder="0"></td><td></td></tr>
     <tr><td colspan="4" class="n"><b>Total</b></td><td class="n"><b data-bltotal>${peso(C.total)}</b></td><td></td></tr></tfoot></table></div>
    <label>Notes on the statement<textarea name="notes" rows="2" placeholder="e.g. 50% down payment to confirm the date; balance on the event day">${esc(bill.notes || '')}</textarea></label>
    <div class="row end"><button type="button" class="ghost" data-act="billRefill" data-id="${ev.id}">Refill lines from the event</button><button class="pri">Save statement</button></div></form></details>
   ${payList(ev, pays, C)}</section>`;
}
function payList(ev, pays, C) {
  const live = pays.filter(p => !p.voided_at), voided = pays.filter(p => p.voided_at);
  return `<h3 class="mt">Payments received</h3>
   ${live.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="n">Amount</th><th></th></tr></thead><tbody>
    ${live.map(p => `<tr><td>${esc(fmtD(p.paid_on))}</td><td>${esc(payMethod(p.method))}</td><td class="small">${esc(p.ref || '')}${p.note ? `<div class="mut">${esc(p.note)}</div>` : ''}</td><td class="n">${peso(p.amount)}</td><td><button class="ghost sm" data-act="payVoid" data-id="${p.id}" title="Void this payment (wrong entry)">Void</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="mut small">None yet.</p>'}
   ${voided.length ? `<details><summary class="small mut">${voided.length} voided</summary><ul class="small mut">${voided.map(p => `<li>${esc(fmtD(p.paid_on))} · ${peso(p.amount)} · ${esc(payMethod(p.method))} — voided: ${esc(p.void_reason || '')}</li>`).join('')}</ul></details>` : ''}
   <form data-form="addPay" data-id="${ev.id}" class="addline mt"><input name="paid_on" type="date" value="${today()}" required><input name="amount" type="number" step="any" min="0.01" inputmode="decimal" placeholder="Amount ₱${C && C.balance > 0 ? ' (balance ' + fq(C.balance) + ')' : ''}" required>
    <select name="method">${PAY_METHODS.map(([v, l]) => opt(v, l)).join('')}</select><input name="ref" placeholder="Ref / OR no. (optional)"><button class="pri">Add payment</button></form>`;
}
async function billBundle(ev, client) {
  if (!canBill()) return {};
  const [bill, lines, pays, money] = await Promise.all([db.select('event_bills', { eq: { event_id: ev.id } }).then(r => r[0]), db.select('bill_lines', { eq: { event_id: ev.id }, order: [['sort']] }),
    db.select('event_payments', { eq: { event_id: ev.id }, order: [['paid_on'], ['created_at']] }), moneyOf([ev.id]).then(m => m[ev.id])]);
  return { bill, lines, pays, money, client };
}
async function writeLines(evId, lines) {
  await db.remove('bill_lines', { event_id: evId });
  if (lines.length) await db.insert('bill_lines', lines.map((l, i) => ({ event_id: evId, sort: i, label: l.label, items: l.items || null, rate: num(l.rate), qty: l.qty === null || l.qty === '' ? null : num(l.qty), unit: l.unit || null })));
}
async function evAndMenu(id) {
  const [ev] = await db.select('events', { eq: { id } }); ev.contract_price = (await contractOf([id]))[id] ?? null; const menu = await db.select('event_menu', { eq: { event_id: id }, order: [['sort'], ['course']] }); return [ev, menu];
}
ACT.billCreate = async el => {
  const [ev, menu] = await evAndMenu(el.dataset.id), [set] = await db.select('bill_settings', {});
  const due = set?.due_days && ev.event_date ? new Date(new Date(ev.event_date + 'T00:00').getTime() - set.due_days * 864e5 + 8 * 3600e3).toISOString().slice(0, 10) : ev.event_date;
  await db.insert('event_bills', { event_id: ev.id, due });
  await writeLines(ev.id, linesFromEvent(ev, menu)); toast('Statement created — check the rates'); refresh();
};
ACT.billRefill = async el => {
  if (!confirm('Replace the lines on this statement with lines from the event (menu and contract price)?')) return;
  const [ev, menu] = await evAndMenu(el.dataset.id); await writeLines(ev.id, linesFromEvent(ev, menu)); toast('Lines refilled'); refresh();
};
ACT.billAddRow = el => { const tb = el.closest('table').querySelector('tbody'), pax = el.closest('form').dataset.pax, i = Date.now() % 1e7;
  tb.insertAdjacentHTML('beforeend', billRow({ label: '', rate: '', qty: null, unit: '' }, i, pax)); tb.lastElementChild.querySelector('input').focus(); };
ACT.billRmRow = el => { const f = el.closest('form'); el.closest('tr').remove(); billLive(f); };
function billLive(f) {
  if (!f) return; const pax = f.dataset.pax; let sub = 0;
  f.querySelectorAll('tr[data-bl]').forEach(tr => { const g = n => tr.querySelector(`[name^="${n}_"]`)?.value ?? '', a = lineAmt({ rate: g('rate'), qty: g('qty') === '' ? null : g('qty') }, pax); sub += a; tr.querySelector('[data-blamt]').textContent = peso(a); });
  const t = f.querySelector('[data-bltotal]'); if (t) t.textContent = peso(Math.max(0, sub - num(f.querySelector('[name=discount]')?.value)));
}
document.addEventListener('input', e => { const f = e.target.closest('form[data-form=saveBill]'); if (f) billLive(f); });
FORMS.saveBill = async (f, el) => {
  const id = el.dataset.id, lines = [...el.querySelectorAll('tr[data-bl]')].map(tr => { const g = n => tr.querySelector(`[name^="${n}_"]`)?.value ?? '';
    return { label: g('label').trim(), items: g('items').trim(), rate: g('rate'), qty: g('qty') === '' ? null : g('qty'), unit: g('unit') }; }).filter(l => l.label);
  await db.update('event_bills', { bill_to: (f.bill_to || '').trim() || null, address: (f.address || '').trim() || null, issued: f.issued || today(), due: f.due || null, discount: num(f.discount), notes: (f.notes || '').trim() || null, updated_at: new Date().toISOString() }, { event_id: id });
  await writeLines(id, lines); toast('Statement saved'); refresh();
};
FORMS.addPay = async (f, el) => {
  if (!(num(f.amount) > 0)) return toast('Enter the amount received.', true);
  if (f.method !== 'cash' && !(f.ref || '').trim() && !confirm('No reference number for this ' + payMethod(f.method) + ' payment. Save anyway?')) return;
  await db.insert('event_payments', { event_id: el.dataset.id, paid_on: f.paid_on || today(), amount: num(f.amount), method: f.method, ref: (f.ref || '').trim() || null });
  toast('Payment recorded'); refresh();
};
ACT.payVoid = async el => {
  const r = prompt('Why void this payment? (e.g. wrong amount, entered twice)'); if (!r || !r.trim()) return;
  await db.update('event_payments', { voided_at: new Date().toISOString(), voided_by: S.me.id, void_reason: r.trim() }, { id: el.dataset.id }); toast('Payment voided'); refresh();
};
ACT.soaPdf = async el => {
  const w = window.open('', '_blank'); if (!w) return toast('The browser blocked the PDF window. Allow pop-ups for romualdos.ph and try again.', true);
  w.document.write('<!DOCTYPE html><title>Preparing PDF…</title><body style="font:15px Montserrat,Arial,sans-serif;color:#1A2C54;display:grid;place-items:center;height:90vh;margin:0">Preparing the statement…</body>');
  try {
    const id = el.dataset.id, [ev] = await db.select('events', { eq: { id } }), client = ev.client_id ? (await db.select('clients', { eq: { id: ev.client_id } }))[0] : null;
    const [B, [set]] = await Promise.all([billBundle(ev, client), db.select('bill_settings', {})]);
    if (!B.bill) { w.close(); return toast('Create the statement first.', true); }
    if (!S.logoData) S.logoData = await fetch(new URL('../assets/logo.png', location.href)).then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); })).catch(() => '');
    w.document.open(); w.document.write(soaHtml(ev, B, set || {})); w.document.close();
  } catch (e) { w.close(); throw e; }
};
function soaHtml(ev, B, set) {
  const { bill, lines, pays, client } = B, C = billCalc(bill, lines, pays, ev.pax), s = ev.sheet || {}, live = pays.filter(p => !p.voided_at);
  const st = PAY_ST[B.money?.status || 'unpaid'][0], who = bill.bill_to || client?.name || ev.title, logo = S.logoData || new URL('../assets/logo.png', location.href).href;
  const lf = d => fmtLong(d).replace(/^\w+, /, ''), pr = (l, v) => v ? `<p><b>${l}:</b> ${esc(v)}</p>` : '';
  const unitTxt = (l, q) => l.unit ? ' ' + l.unit + (q === 1 ? '' : 's') : '';
  const menuLines = lines.filter(l => (l.items || '').trim() && ev.kind === 'buffet');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(`Statement of Account ${bill.soa_no} - ${who}`)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400;1,500&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
:root{--ink:#14213F;--txt:#1F2433;--lab:#4A5265;--acc:#8A5A00;--rule:#9C9479;--wine:#631B1C}
body{font-family:Montserrat,Arial,sans-serif;color:var(--txt);font-size:9.6pt;line-height:1.42;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#ECE8DA}
h1,h2,.who{font-family:'Playfair Display',Georgia,serif}
.page{width:210mm;min-height:297mm;margin:0 auto;padding:11mm 13mm 9mm;background:#fff;display:flex;flex-direction:column}
.bar{display:flex;gap:10px;justify-content:center;padding:12px;background:#F7F4EA;border-bottom:1px solid #E4DFC8}
.bar button{font:600 13px Montserrat;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;background:#1A2C54;color:#fff}.bar button.alt{background:#fff;color:#1A2C54;border:1px solid #CFC9B0}.bar span{align-self:center;font-size:12px;color:#5B6478}
.bill-h{display:flex;align-items:center;gap:6mm;padding-bottom:3mm;border-bottom:1pt solid var(--rule)}.bill-h img{height:17mm}.bill-h .meta{margin-left:auto}
.tag{font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--acc);white-space:nowrap}
h1{font-weight:400;font-style:italic;font-size:22pt;line-height:1.1;margin:.8mm 0 .6mm;color:var(--ink)}.who{font-size:12.5pt;color:var(--ink)}
.meta{text-align:right;font-size:8pt;color:var(--lab);line-height:1.75;white-space:nowrap}
.status{display:inline-block;border:.8pt solid var(--wine);color:var(--wine);border-radius:20px;padding:0 2.5mm;font-size:7pt;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.addr{text-align:center;font-size:8pt;color:var(--lab);margin:2mm 0 0;line-height:1.6}
.boxes{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin:4mm 0}.boxes div{border:.9pt solid var(--ink);border-radius:2mm;padding:3mm 4mm}
.boxes h3{margin:0 0 1.5mm;font:600 6.8pt Montserrat,Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--acc)}
.boxes p{margin:.6mm 0;font-size:9.4pt}.boxes b{font-weight:600;color:var(--ink)}
h2{font-weight:600;font-size:11.5pt;margin:2mm 0 1.5mm;letter-spacing:.02em;border-bottom:.8pt solid var(--rule);padding-bottom:1mm;color:var(--ink)}
h2 small{font-family:Montserrat,Arial,sans-serif;font-weight:600;font-size:6.5pt;letter-spacing:.24em;text-transform:uppercase;color:var(--acc);margin-left:2mm}
.am{text-align:center;margin:2mm 0 4mm}.am h2{border:0;text-align:center;font-size:14pt;font-style:italic;font-weight:400;margin:0 0 1mm}
.am .c{font-size:7.2pt;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--acc);margin-top:2.6mm}.am .c i{font-style:normal;color:var(--wine);letter-spacing:.06em}.am .d{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:11pt;line-height:1.3;color:var(--ink)}
table.bd{width:100%;border-collapse:collapse;margin-top:1mm}.bd th{font-size:6.8pt;letter-spacing:.16em;text-transform:uppercase;color:var(--lab);font-weight:600;text-align:left;border-bottom:.9pt solid var(--ink);padding:1.2mm 1.5mm}
.bd td{padding:1.5mm;border-bottom:.6pt solid #CFC8B0;vertical-align:top}.bd .r{text-align:right;white-space:nowrap}.bd td.l{font-weight:600;color:var(--ink)}.bd td.l small{display:block;font-weight:400;color:var(--lab);font-size:7.6pt}
.bd tfoot td{border:0;padding:1mm 1.5mm}.bd tfoot .tt td{border-top:1.4pt solid var(--ink);font-size:12pt;font-weight:700;color:var(--ink);padding-top:2mm}.bd tfoot .bal td{font-size:11pt;font-weight:700;color:var(--wine)}.bd tfoot .pd td{font-size:8.6pt;color:var(--lab)}
.pay{margin-top:4mm;border:.8pt dashed var(--rule);border-radius:2mm;padding:2.5mm 4mm;font-size:8.6pt;white-space:pre-wrap}.pay b{color:var(--ink);font-size:7pt;letter-spacing:.18em;text-transform:uppercase;display:block;margin-bottom:.8mm}
.foot{margin-top:auto;padding-top:5mm}.sign{display:grid;grid-template-columns:1fr 1fr;gap:14mm}.sign div{border-top:.8pt solid var(--ink);padding-top:1.2mm;font-size:7.4pt;color:var(--lab)}.sign b{display:block;color:var(--ink);font-weight:600;font-size:8.6pt}
footer{margin-top:4mm;text-align:center;font-size:7.2pt;color:var(--lab);letter-spacing:.03em;border-top:.8pt solid var(--rule);padding-top:2mm}
@media screen{.page{margin:16px auto;box-shadow:0 2px 14px rgba(0,0,0,.12)}}@media print{body{background:#fff}.bar{display:none}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Save as PDF / Print</button><button class="alt" onclick="window.close()">Close</button><span>Choose <b>Save as PDF</b> as the destination.</span></div>
<div class="page" id="pg">
<div class="bill-h"><img src="${logo}" alt="Romualdo's"><div><div class="tag">Catering Services · Davao City</div><h1>Statement of Account</h1><div class="who">${esc(who)}</div></div>
<div class="meta">No. ${esc(bill.soa_no)}<br><span class="status">${esc(st)}</span><br>Issued ${esc(lf(bill.issued))}${bill.due ? '<br>Due ' + esc(lf(bill.due)) : ''}</div></div>
<p class="addr">${esc(set.bill_address || '')}<br>${esc(set.bill_contact || '')}</p>
<div class="boxes"><div><h3>Bill to</h3>${pr('Name / account', who + (s.contact ? ' – ' + s.contact : ''))}${pr('Address', bill.address)}${pr('Email', s.email || client?.email)}${pr('Mobile / tel.', s.mobile || client?.phone)}</div>
<div><h3>${ev.kind === 'buffet' ? 'Event' : 'Order'}</h3>${pr(ev.kind === 'buffet' ? 'Date of event' : s.fulfil === 'Delivery' ? 'Delivery date' : 'Pick-up date', ev.event_date ? fmtLong(ev.event_date) : '')}${pr(ev.kind === 'buffet' ? 'Time of event' : 'Ready by', ev.serve_time ? fmtClock(ev.serve_time) : '')}${pr(ev.kind === 'buffet' ? 'Guaranteed pax' : 'Good for', ev.pax ? ev.pax + ' pax' : '')}${pr(ev.kind === 'buffet' ? 'Venue' : s.fulfil === 'Delivery' ? 'Deliver to' : '', ev.venue)}${pr('Reference', ev.ref)}${pr('Food notes', s.allergy)}</div></div>
${menuLines.length ? `<div class="am"><h2>Approved Menu</h2>${menuLines.map(l => `<div class="c">${esc(l.label)}${num(l.rate) ? ` <i>(${peso(l.rate)}/${esc(l.unit || 'head')})</i>` : ''}</div>${l.items.split('\n').filter(x => x.trim()).map(x => `<div class="d">${esc(x.trim())}</div>`).join('')}`).join('')}</div>` : ''}
<h2>Breakdown<small>Billing</small></h2>
<table class="bd"><thead><tr><th>Description</th><th class="r">Rate</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>
${lines.map(l => { const q = l.qty === null ? num(ev.pax) : num(l.qty); return `<tr><td class="l">${esc(l.label)}${l.items && ev.kind !== 'buffet' ? `<small>${esc(l.items.split('\n').filter(Boolean).join(' · '))}</small>` : ''}</td><td class="r">${peso(l.rate)}</td><td class="r">${fq(q)}${esc(unitTxt(l, q))}</td><td class="r">${peso(lineAmt(l, ev.pax))}</td></tr>`; }).join('')}</tbody>
<tfoot>${C.disc ? `<tr><td colspan="3" class="r">Subtotal</td><td class="r">${peso(C.sub)}</td></tr><tr><td colspan="3" class="r">Less discount</td><td class="r">− ${peso(C.disc)}</td></tr>` : ''}
<tr class="tt"><td colspan="3">TOTAL</td><td class="r">${peso(C.total)}</td></tr>
${live.map(p => `<tr class="pd"><td colspan="3" class="r">Less payment received ${esc(lf(p.paid_on))} · ${esc(payMethod(p.method))}${p.ref ? ' · ' + esc(p.ref) : ''}</td><td class="r">− ${peso(p.amount)}</td></tr>`).join('')}
${live.length ? `<tr class="bal"><td colspan="3" class="r">${C.balance > 0 ? 'BALANCE DUE' : C.balance < 0 ? 'OVERPAID' : 'FULLY PAID'}</td><td class="r">${peso(Math.abs(C.balance))}</td></tr>` : ''}</tfoot></table>
${set.pay_info ? `<div class="pay"><b>Payment details</b>${esc(set.pay_info)}</div>` : ''}${bill.notes ? `<p style="margin:3mm 0 0;font-size:8.8pt;white-space:pre-wrap">${esc(bill.notes)}</p>` : ''}
<div class="foot"><div class="sign"><div><b>${esc(s.contact || who)}</b>Received by · signature over printed name · date</div><div><b>${esc(S.me.full_name || "Romualdo's Catering Services")}</b>Prepared by · Romualdo's Catering Services</div></div>
<footer>Romualdo's Catering Services · ${esc(set.bill_address || '')} · romualdos.ph</footer></div>
</div><script>
function fit(){var p=document.getElementById('pg'),H=p.offsetWidth*297/210;p.style.zoom=1;p.style.minHeight='0';var h=p.scrollHeight,z=h>H?Math.max(.55,(H-2)/h):1;p.style.zoom=z;p.style.minHeight=((H-2)/z)+'px';}
window.addEventListener('load',function(){(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){fit();setTimeout(function(){window.print()},400)})});
<\/script></body></html>`;
}
// Billing overview: who still owes what
routes['c/billing'] = async arg => {
  if (!canBill()) return '<div class="card">Billing is for finance, catering managers and the owner.</div>';
  const tab = arg || 'due';
  const evs = await db.select('events', { cols: 'id,ref,title,kind,event_type,event_date,pax,status,client_id,sheet,contract_price', order: [['event_date', false]] });
  const live = evs.filter(e => e.status !== 'cancelled'), M = await moneyOf(live.map(e => e.id)), CP = await contractOf(live.map(e => e.id)); live.forEach(e => e.contract_price = CP[e.id] ?? null);
  const cids = [...new Set(live.map(e => e.client_id).filter(Boolean))], cl = {}; if (cids.length) (await db.select('clients', { cols: 'id,name', in: { id: cids } })).forEach(c => cl[c.id] = c);
  const t = today(), withBill = live.filter(e => M[e.id]?.status !== 'none');
  const due = withBill.filter(e => num(M[e.id].balance) > 0), over = due.filter(e => M[e.id].due && M[e.id].due < t);
  const noBill = live.filter(e => M[e.id]?.status === 'none' && !['inquiry', 'cancelled'].includes(e.status));
  const sumK = (L, k) => L.reduce((a, e) => a + num(M[e.id][k]), 0);
  const list = tab === 'due' ? due.sort((a, b) => (M[a.id].due || a.event_date).localeCompare(M[b.id].due || b.event_date)) : tab === 'paid' ? withBill.filter(e => num(M[e.id].balance) <= 0) : tab === 'nobill' ? noBill : live;
  const [set] = isAdmin() ? await db.select('bill_settings', {}) : [null];
  const tabs = [['due', `Balance due (${due.length})`], ['nobill', `No statement yet (${noBill.length})`], ['paid', 'Paid'], ['all', 'All']];
  return `<h1>Billing</h1>
   <div class="kpis"><div class="kpi"><span>Billed</span><b>${peso(sumK(withBill, 'total'))}</b></div><div class="kpi"><span>Collected</span><b>${peso(sumK(withBill, 'paid'))}</b></div>
    <div class="kpi"><span>Receivable</span><b class="${sumK(due, 'balance') > 0 ? 'bad-t' : ''}">${peso(sumK(due, 'balance'))}</b></div><div class="kpi"><span>Overdue</span><b class="${over.length ? 'bad-t' : ''}">${over.length ? peso(sumK(over, 'balance')) : '—'}</b></div></div>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/billing/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${list.length ? `<div class="tw card" style="padding:6px 12px"><table><thead><tr><th>Event date</th><th>Client</th><th>Statement</th><th class="n">Total</th><th class="n">Paid</th><th class="n">Balance</th><th>Status</th></tr></thead><tbody>
   ${list.map(e => { const m = M[e.id], od = m.due && m.due < t && num(m.balance) > 0; return `<tr class="click" data-href="#/c/event/${e.id}"><td class="nowrap">${esc(fmtD(e.event_date))}</td><td><a href="#/c/event/${e.id}"><b>${esc(evClient(e, cl[e.client_id]))}</b></a><div class="small mut">${esc(e.ref)} · ${KIND[e.kind]}${e.pax ? ' · ' + e.pax + ' pax' : ''}</div></td>
     <td class="small">${m.soa_no ? esc(m.soa_no) + (m.due ? `<div class="${od ? 'bad-t' : 'mut'}">due ${esc(fmtD(m.due))}</div>` : '') : `<span class="mut">—</span>${e.contract_price ? `<div class="mut">contract ${peso(e.contract_price)}</div>` : ''}`}</td>
     <td class="n">${m.status === 'none' ? '' : peso(m.total)}</td><td class="n">${num(m.paid) ? peso(m.paid) : ''}</td><td class="n"><b class="${num(m.balance) > 0 ? 'bad-t' : ''}">${m.status === 'none' ? '' : peso(m.balance)}</b></td><td>${payChip(m) || chip('No statement')}${od ? ' ' + chip('Overdue', 'bad') : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Nothing here.</div>'}
   ${set ? `<details class="card mt"><summary>Statement settings <span class="small mut">— printed on every statement (owner only)</span></summary><form data-form="billSettings" class="mt">
     <label>Business address<input name="bill_address" value="${esc(set.bill_address)}"></label><label>Contact line<input name="bill_contact" value="${esc(set.bill_contact)}"></label>
     <label>Payment details (bank / GCash)<textarea name="pay_info" rows="3" placeholder="e.g. BDO Savings · Romualdo's Catering Services · 0000-0000-0000&#10;GCash 0917 000 0000 · J. Domingo">${esc(set.pay_info)}</textarea></label>
     <label>Default due date<select name="due_days">${[[0, 'On the event day'], [1, '1 day before the event'], [3, '3 days before'], [7, '7 days before']].map(([v, l]) => opt(v, l, num(set.due_days) === v)).join('')}</select></label>
     <div class="row end"><button class="pri">Save</button></div></form></details>` : ''}`;
};
FORMS.billSettings = async f => { await db.update('bill_settings', { bill_address: f.bill_address.trim(), bill_contact: f.bill_contact.trim(), pay_info: (f.pay_info || '').trim(), due_days: num(f.due_days) }, { id: 1 }); toast('Saved'); refresh(); };
document.addEventListener('click', e => { const tr = e.target.closest('tr.click[data-href]'); if (tr && !e.target.closest('a,button,input,select')) location.hash = tr.dataset.href; });

/* ---- New version published? Show a bar to reload, so nobody keeps working on an old copy after an update ---- */
const MY_VER = new URL(import.meta.url).searchParams.get('v') || '';
let verShown = false;
async function checkVersion() {
  if (verShown || !MY_VER || document.visibilityState !== 'visible') return;
  try {
    const html = await (await fetch('./index.html?check=' + Date.now(), { cache: 'no-store' })).text();
    const live = (html.match(/app\.js\?v=(\d+)/) || [])[1];
    if (live && live !== MY_VER) {
      verShown = true;
      const bar = document.createElement('div'); bar.className = 'verbar';
      bar.innerHTML = '<span>A new version of the app is ready.</span><button type="button">Update now</button>';
      bar.querySelector('button').onclick = () => {
        draftFlushAll();   // what's being typed is kept on this phone and put back after the update
        location.reload();
      };
      document.body.appendChild(bar);
    }
  } catch (e) {}
}
setInterval(checkVersion, 3 * 60 * 1000);
document.addEventListener('visibilitychange', checkVersion);
setTimeout(checkVersion, 15000);
