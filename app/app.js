// Romualdo's staff app · Restaurant & Catering
import { db } from './db.js';

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
const ROLES = [['manager', 'Manager'], ['finance', 'Finance'], ['purchaser', 'Purchaser'], ['storekeeper', 'Storekeeper'], ['chef', 'Chef'], ['coordinator', 'Coordinator'], ['cashier', 'Cashier'], ['staff', 'Staff']];
const chip = (label, tone) => `<span class="chip ${tone || ''}">${esc(label)}</span>`;
const statusTone = s => ({ draft: 'mut', inquiry: 'mut', for_client_approval: 'warn', submitted: 'warn', confirmed: 'ok', approved: 'ok', in_prep: 'info', ordered: 'info', open: 'info', partly_received: 'warn', done: 'ok', received: 'ok', closed: 'mut', rejected: 'bad', cancelled: 'bad' }[s] || '');

/* ================= state ================= */
const S = { user: null, me: null, items: [], itemsById: {}, dishes: [], dishById: {}, aliasMap: {}, packs: [] };
const isAdmin = () => !!S.me?.is_admin;
const member = ws => isAdmin() || (S.me?.roles || []).some(r => r.ws === ws);
const can = (ws, ...roles) => isAdmin() || (S.me?.roles || []).some(r => r.ws === ws && roles.includes(r.role));
const canAny = (...roles) => isAdmin() || (S.me?.roles || []).some(r => roles.includes(r.role));
const who = () => S.me?.full_name || S.me?.username || '';

async function loadMaster() {
  const [items, dishes, aliases, packs] = await Promise.all([
    db.select('items', { cols: 'id,name,category,stock_unit,purchase_unit,units_per_purchase,last_cost,waste_pct,active', eq: { active: true }, order: [['category'], ['name']] }),
    db.select('dishes', { cols: 'id,name,category,course,tray_price,tray_serves,standard,times_booked,active,sold_as', order: [['times_booked', false], ['name']] }),
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
function itemIdFromName(name) { const n = (name || '').trim().toLowerCase(); return S.items.find(i => i.name.toLowerCase() === n)?.id || null; }

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
  const key = pre ? page + '/' + (rest[0] || (page === 'c' ? 'events' : 'kitchen')) : (page || 'home');
  const arg = pre ? rest.slice(1).join('/') : rest.join('/');
  const r = routes[key] || routes.home;
  current = key;
  document.body.classList.toggle('pos-mode', key === 'r/pos');
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
  document.querySelectorAll('[data-show-if]').forEach(el => { const [name, val] = el.dataset.showIf.split('='); const src = document.querySelector(`[name="${name}"]`); const upd = () => el.hidden = src?.value !== val; src?.addEventListener('change', upd); upd(); });
}

/* ================= shell ================= */
function renderShell(key) {
  const inCat = key.startsWith('c/'), inRes = key.startsWith('r/');
  const nav = inCat ? [['c/events', 'Events'], ['c/inquiries', 'Inquiries'], ['c/requests', 'Requests'], ['c/orders', 'Orders & receiving'], ['c/stock', 'Stock'], ['c/recipes', 'Recipes']]
    : inRes ? [['r/pos', 'POS'], ['r/sales', 'Sales'], ['r/kitchen', 'Kitchen stocks'], ['r/requests', 'Requests'], ['r/orders', 'Orders & receiving'], ['r/stock', 'Store & par']] : [];
  $('#top').innerHTML = `<div class="bar"><a class="brand" href="#/">Romualdo's<small>${inCat ? 'Catering' : inRes ? 'Restaurant' : 'Staff'}</small></a>
    <div class="who"><span>${esc(who())}</span>${isAdmin() ? '<a href="#/people">People</a>' : ''}<button class="ghost" data-act="account">Account</button><button class="ghost" data-act="logout">Log out</button></div></div>
    ${nav.length ? `<nav>${nav.map(([k, l]) => `<a href="#/${k}" class="${navOf(key) === k ? 'on' : ''}">${l}</a>`).join('')}<a href="#/" class="sw">Switch workspace</a></nav>` : ''}`;
}
function navOf(key) {
  return { 'c/event': 'c/events', 'c/event-new': 'c/events', 'c/pr': 'c/requests', 'c/po': 'c/orders', 'c/count': 'c/stock', 'c/recipe': 'c/recipes', 'c/inquiry': 'c/inquiries',
    'r/pr': 'r/requests', 'r/po': 'r/orders', 'r/count': 'r/stock' }[key] || key;
}

/* ================= login ================= */
function renderLogin(msg) {
  $('#top').innerHTML = `<div class="bar"><span class="brand">Romualdo's<small>Staff</small></span></div>`;
  $('#main').innerHTML = `<form class="card login" id="loginForm"><h1>Log in</h1>
    ${msg ? `<p class="alert warn">${esc(msg)}</p>` : ''}
    <label>Email or username<input name="login" autocomplete="username" autocapitalize="none" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="pri wide">Log in</button>
    <p class="mut small">Forgot your password or need an account? Ask the owner.</p></form>`;
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
  await loadMaster();
  route();
}

/* ================= home ================= */
routes.home = async () => {
  const cards = [];
  if (member('catering')) cards.push(`<a class="ws-card cat" href="#/c/events"><b>Catering</b><span>Events, menus, purchase requests, receiving, stock, recipes</span></a>`);
  if (member('restaurant')) cards.push(`<a class="ws-card res" href="#/r/${can('restaurant', 'cashier', 'staff') && !can('restaurant', 'manager', 'chef') ? 'pos' : 'kitchen'}"><b>Restaurant</b><span>POS, daily sales, kitchen stocks, restock, purchase requests, receiving, store and par levels</span></a>`);
  if (!cards.length) cards.push(`<div class="card"><p>You don't have a workspace yet. Ask the owner to give you a role.</p></div>`);
  return `<h1>Good day, ${esc(S.me.full_name.split(' ')[0])}</h1><p class="lede">Choose where you're working.</p><div class="ws-grid">${cards.join('')}</div>
    ${isAdmin() ? `<p class="small mut" style="margin-top:24px">Owner: <a href="#/people">add people and give them roles</a>.</p>` : ''}`;
};

/* ================= EVENTS ================= */
routes['c/events'] = async arg => {
  const tab = arg || 'upcoming', t = today();
  const opts = { cols: 'id,ref,title,kind,event_type,event_date,serve_time,pax,status,venue', order: [['event_date', tab !== 'past']] };
  if (tab === 'upcoming') opts.gte = { event_date: t }; if (tab === 'past') opts.lte = { event_date: t };
  let ev = await db.select('events', opts);
  if (tab === 'upcoming') ev = ev.filter(e => !['cancelled', 'closed'].includes(e.status));
  const tabs = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']];
  return `<div class="row"><h1>Events</h1><span class="sp"></span>${can('catering', 'coordinator', 'manager') ? '<a class="btn pri" href="#/c/event-new">＋ New event</a>' : ''}</div>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/events/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${ev.length ? `<div class="list">${ev.map(e => `<a class="li" href="#/c/event/${e.id}"><div class="li-date"><b>${esc(fmtD(e.event_date).split(',')[0])}</b><span>${esc(fmtD(e.event_date).split(',').slice(1).join(','))}</span></div>
      <div class="li-main"><b>${esc(e.title)}</b><span class="mut small">${esc(e.ref)} · ${KIND[e.kind]}${e.pax ? ' · ' + e.pax + ' guests' : ''}${e.serve_time ? ' · ' + fmtClock(e.serve_time) : ''}${e.venue ? ' · ' + esc(e.venue) : ''}</span></div>
      ${chip(EVENT_STATUS[e.status], statusTone(e.status))}</a>`).join('')}</div>` : '<div class="empty">No events here.</div>'}`;
};

routes['c/event-new'] = async () => {
  if (!can('catering', 'coordinator', 'manager')) return '<div class="card">Only coordinators and managers can add events.</div>';
  return `<h1>New event</h1><form class="card" data-form="newEvent">
    <div class="grid">
     <label>Order type<select name="kind">${Object.entries(KIND).map(([k, l]) => opt(k, l)).join('')}</select></label>
     <label>Event name<input name="title" required placeholder="e.g. Santos Wedding"></label>
     <label>Event type<select name="event_type">${opt('', '—')}${EV_TYPES.map(x => opt(x, x)).join('')}</select></label>
     <label>Date<input name="event_date" type="date" required value="${today()}"></label>
     <label>Serving time<input name="serve_time" type="time"></label>
     <label>Guests<input name="pax" type="number" min="0" inputmode="numeric"></label>
     <label>Venue<input name="venue"></label>
     <label>Contract price ₱<input name="contract_price" type="number" step="any" min="0"></label>
     <label>Client name<input name="client_name"></label>
     <label>Client mobile<input name="client_phone" inputmode="tel"></label>
    </div><p class="small mut">Next step: after you tap Create event, the event page opens and you add the menu (dishes) there.</p>
    <div class="row end"><a class="btn ghost" href="#/c/events">Cancel</a><button class="pri">Create event</button></div></form>`;
};
const FORMS = {};
FORMS.newEvent = async f => {
  let client_id = null;
  if (f.client_name) client_id = (await db.insert('clients', { name: f.client_name, phone: f.client_phone || null }))[0].id;
  const row = { kind: f.kind, title: f.title.trim(), event_type: f.event_type || null, event_date: f.event_date, serve_time: f.serve_time || null,
    pax: f.pax ? parseInt(f.pax) : null, venue: f.venue || null, contract_price: f.contract_price ? num(f.contract_price) : null, client_id, status: 'draft' };
  const ev = (await db.insert('events', row))[0];
  toast(`Event ${ev.ref} created — now add the menu.`); go('#/c/event/' + ev.id);
};

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
  const recipeState = {}; const dishIds = [...new Set(menu.map(m => m.dish_id).filter(Boolean))];
  if (dishIds.length) (await db.select('recipes', { cols: 'dish_id,status', in: { dish_id: dishIds } })).forEach(r => recipeState[r.dish_id] = r.status);
  const open = !['done', 'closed', 'cancelled'].includes(ev.status);
  const canMenu = open && can('catering', 'coordinator', 'manager', 'chef');
  const canEdit = ev.status !== 'closed' && can('catering', 'coordinator', 'manager', 'finance');
  const byCourse = COURSES.map(c => [c, menu.filter(m => m.course === c)]).concat([['Other', menu.filter(m => !COURSES.includes(m.course))]]).filter(([, l]) => l.length);
  const lineName = m => m.dish_id ? S.dishById[m.dish_id]?.name : m.pack_id ? (S.packs.find(p => p.id === m.pack_id)?.name || 'Packed meal set') : m.custom_name;
  const lineChip = m => m.custom_name && !m.dish_id && !m.pack_id ? chip('off-menu', 'warn') : m.dish_id ? (recipeState[m.dish_id] === 'verified' ? '' : chip(recipeState[m.dish_id] ? 'recipe draft' : 'no recipe', 'warn')) : '';
  const toBuy = needs.filter(n => num(n.to_buy) > 0);
  const margin = cost && ev.contract_price ? num(ev.contract_price) - num(cost.total_cost) : null;
  return `<div class="row"><a href="#/c/events" class="back">‹ Events</a></div>
  <div class="row"><h1>${esc(ev.title)}</h1>${chip(EVENT_STATUS[ev.status], statusTone(ev.status))}</div>
  <p class="lede">${esc(ev.ref)} · ${KIND[ev.kind]} · ${esc(fmtD(ev.event_date))}${ev.serve_time ? ' · ' + fmtClock(ev.serve_time) : ''}${ev.pax ? ' · <b>' + ev.pax + ' guests</b>' : ''}${ev.venue ? ' · ' + esc(ev.venue) : ''}${client ? ' · ' + esc(client.name) + (client.phone ? ' (' + esc(client.phone) + ')' : '') : ''}</p>

  ${canEdit ? `<details class="card"><summary>Edit details & status</summary><form data-form="editEvent" data-id="${ev.id}" class="mt">
    <div class="grid">
     <label>Status<select name="status">${Object.entries(EVENT_STATUS).filter(([k]) => k !== 'closed').map(([k, l]) => opt(k, l, ev.status === k)).join('')}</select></label>
     <label>Event name<input name="title" value="${esc(ev.title)}" required></label>
     <label>Order type<select name="kind">${Object.entries(KIND).map(([k, l]) => opt(k, l, ev.kind === k)).join('')}</select></label>
     <label>Event type<select name="event_type">${opt('', '—')}${EV_TYPES.map(x => opt(x, x, ev.event_type === x)).join('')}</select></label>
     <label>Date<input name="event_date" type="date" value="${esc(ev.event_date)}" required></label>
     <label>Serving time<input name="serve_time" type="time" value="${esc((ev.serve_time || '').slice(0, 5))}"></label>
     <label>Guests<input name="pax" type="number" min="0" value="${esc(ev.pax ?? '')}"></label>
     <label>Venue<input name="venue" value="${esc(ev.venue || '')}"></label>
     <label>Contract price ₱<input name="contract_price" type="number" step="any" min="0" value="${esc(ev.contract_price ?? '')}"></label>
    </div><div class="row end">${can('catering', 'manager', 'finance') && ev.status === 'done' ? `<button type="button" class="ghost" data-act="closeEvent" data-id="${ev.id}">Close event (releases leftover stock)</button>` : ''}<button class="pri">Save</button></div></form></details>` : ''}

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
    ${extras.length ? `<table><tbody>${extras.map(x => `<tr><td>${esc(itemName(x.item_id))}</td><td class="n">${fq(x.qty)} ${esc(itemUnit(x.item_id))}</td><td class="mut small">${esc(x.note || '')}</td><td>${can('catering', 'chef', 'manager') && open ? `<button class="x" data-act="rmExtra" data-ev="${ev.id}" data-item="${x.item_id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    ${can('catering', 'chef', 'manager') && open ? `<form data-form="addExtra" data-id="${ev.id}" class="addline"><input name="item" list="dl-items" placeholder="Ingredient" autocomplete="off"><input name="qty" type="number" step="any" min="0" placeholder="qty" class="qty"><input name="note" placeholder="for which dish"><button class="pri">Add</button></form>${itemDatalist()}` : ''}
  </section>` : ''}

  <section class="card"><div class="row"><h2>Purchasing</h2><span class="sp"></span>${open && can('catering', 'coordinator', 'manager', 'chef') && menu.length ? `<button class="pri" data-act="genPR" data-id="${ev.id}">${prs.some(p => p.status === 'draft' && p.source === 'event_auto') ? 'Update purchase request' : 'Create purchase request'}</button>` : ''}</div>
   ${warnings.length ? `<div class="alert warn"><b>Not included yet:</b><ul>${warnings.map(w => `<li>${esc(w.dish)} — ${esc(w.problem)}</li>`).join('')}</ul></div>` : ''}
   ${needs.length ? `<details ${toBuy.length ? 'open' : ''}><summary>What this event needs (${needs.length} ingredients, ${toBuy.length} to buy · est. ${peso(needs.reduce((s, n) => s + num(n.est_cost), 0))})</summary>
     <div class="tw"><table><thead><tr><th>Ingredient</th><th class="n">Needed</th><th class="n">In store</th><th class="n">To buy</th><th class="n">Est. cost</th></tr></thead><tbody>
     ${shopRows(needs, n => n.item_id, n => n.needed, 5, n => `<tr><td>${esc(n.item)}<div class="small mut">${esc(n.from_dishes || '')}</div></td><td class="n">${fq(n.needed)} ${esc(n.unit)}</td><td class="n mut">${fq(n.free_stock)}</td><td class="n"><b>${num(n.to_buy) > 0 ? buyCell(n.item_id, n.to_buy) : '—'}</b></td><td class="n">${num(n.est_cost) ? peso(n.est_cost) : '<span class="mut small">no price yet</span>'}</td></tr>`)}
     </tbody></table></div></details>` : '<p class="mut">Add dishes with verified recipes to see what to buy.</p>'}
   ${prs.length ? `<h3 class="mt">Requests for this event</h3><div class="list">${prs.map(p => `<a class="li" href="#/c/pr/${p.id}"><div class="li-main"><b>${esc(p.pr_no)}</b><span class="mut small">${p.line_count} items · ${peso(p.est_total)} · ${esc(fmtT(p.created_at))}</span></div>${chip(PR_STATUS[p.status], statusTone(p.status))}</a>`).join('')}</div>` : ''}
  </section>

  ${(pick.length || ['confirmed', 'in_prep', 'done'].includes(ev.status)) && can('catering', 'storekeeper', 'manager', 'chef') ? `<section class="card"><h2>Prep day</h2>
   ${pick.length ? `<form data-form="issue" data-id="${ev.id}"><p class="small mut">Stock set aside for this event in the catering store. Issue it to the cook in charge.</p>
     <div class="tw"><table><thead><tr><th>Item</th><th class="n">Set aside</th><th class="n">Issue now</th></tr></thead><tbody>
     ${shopRows(pick, p => p.item_id, p => p.reserved, 3, p => `<tr><td>${esc(p.name)}</td><td class="n">${fq(p.reserved)} ${esc(p.stock_unit)}</td><td class="n"><input name="q_${p.item_id}" type="number" step="any" min="0" value="${num(p.reserved)}" class="qty"></td></tr>`)}
     </tbody></table></div><div class="row end"><input name="received_by" placeholder="Received by (cook in charge)" required><button class="pri">Issue to event</button></div></form>` : '<p class="mut">Nothing set aside for this event right now.</p>'}
   <details class="mt"><summary>Return leftovers to the store</summary><form data-form="returnLeft" data-id="${ev.id}" class="addline"><input name="item" list="dl-items" placeholder="Item" autocomplete="off"><input name="qty" type="number" step="any" min="0" placeholder="qty" class="qty"><input name="by" placeholder="Returned by" required><button>Return</button></form>${itemDatalist()}</details>
  </section>` : ''}

  ${cost ? `<section class="card"><h2>Costing</h2><div class="kpis">
    <div class="kpi"><span>Contract</span><b>${ev.contract_price ? peso(ev.contract_price) : '—'}</b></div>
    <div class="kpi"><span>Ingredients used</span><b>${peso(cost.ingredients_used)}</b></div>
    <div class="kpi"><span>Event expenses</span><b>${peso(cost.expenses)}</b></div>
    <div class="kpi"><span>Total cost</span><b>${peso(cost.total_cost)}</b></div>
    <div class="kpi ${margin != null && margin < 0 ? 'bad' : ''}"><span>Margin</span><b>${margin != null ? peso(margin) + (num(ev.contract_price) ? ` <small>${Math.round(margin / num(ev.contract_price) * 100)}%</small>` : '') : '—'}</b></div>
    <div class="kpi"><span>Cost per guest</span><b>${ev.pax ? peso(num(cost.total_cost) / ev.pax) : '—'}</b></div></div>
    <p class="small mut">Ingredients used = stock issued to the event minus leftovers returned, at purchase prices.</p></section>` : ''}`;
};
FORMS.editEvent = async (f, el) => {
  await db.update('events', { status: f.status, title: f.title.trim(), kind: f.kind, event_type: f.event_type || null, event_date: f.event_date, serve_time: f.serve_time || null,
    pax: f.pax ? parseInt(f.pax) : null, venue: f.venue || null, contract_price: f.contract_price ? num(f.contract_price) : null }, { id: el.dataset.id });
  toast('Saved'); refresh();
};
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
  const rows = await db.select('pr_overview', { eq: { ws: WS() }, ...(st ? { in: { status: st } } : {}), order: [['created_at', false]], limit: 200 });
  return `<div class="row"><h1>Purchase requests</h1><span class="sp"></span><button class="pri" data-act="newPR">＋ New request</button></div>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/${P()}/requests/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${rows.length ? `<div class="list">${rows.map(p => `<a class="li" href="#/${P()}/pr/${p.id}"><div class="li-main"><b>${esc(p.pr_no)}${p.priority === 'urgent' ? ' ' + chip('urgent', 'bad') : ''}</b>
     <span class="mut small">${p.event_title ? esc(p.event_ref + ' · ' + p.event_title) + ' · ' : ''}${esc(p.purpose || '')}</span>
     <span class="mut small">${p.line_count} items · est. ${peso(p.est_total)} · ${esc(p.requested_by_name || '')}${p.needed_by ? ' · needed ' + esc(fmtD(p.needed_by)) : ''}</span></div>${chip(PR_STATUS[p.status], statusTone(p.status))}</a>`).join('')}</div>` : '<div class="empty">No requests here.</div>'}`;
};
ACT.newPR = async () => { const r = (await db.insert('purchase_requests', { ws: WS(), purpose: WS() === 'restaurant' ? 'Restaurant restock' : 'Catering store restock', requested_by: S.user.id }))[0]; go(`#/${P()}/pr/${r.id}`); };

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
  const total = lines.reduce((s, l) => s + num(l.approved_qty ?? l.qty) * num(l.est_unit_cost), 0);
  return `<div class="row"><a href="#/${P()}/requests" class="back">‹ Requests</a></div>
  <div class="row"><h1>${esc(p.pr_no)}</h1>${chip(PR_STATUS[p.status], statusTone(p.status))}</div>
  <p class="lede">${p.event_id ? `<a href="#/c/event/${p.event_id}">${esc(p.event_ref + ' · ' + p.event_title)}</a> · ` : ''}${esc(p.purpose || '')}<br><span class="small mut">Requested by ${esc(p.requested_by_name || '')} · ${esc(fmtT(p.created_at))}${p.needed_by ? ' · needed by ' + esc(fmtD(p.needed_by)) : ''}${p.approved_by_name ? ` · ${p.status === 'rejected' ? 'rejected' : 'approved'} by ${esc(p.approved_by_name)} ${esc(fmtT(p.approved_at))}` : ''}</span></p>
  ${p.decision_note ? `<div class="alert ${p.status === 'rejected' ? 'bad' : 'info'}">${esc(p.decision_note)}</div>` : ''}
  <form class="card" data-form="${approver ? 'approvePR' : editable ? 'saveDraft' : 'none'}" data-id="${id}">
   <div class="tw"><table><thead><tr><th>Item</th><th class="n">Requested</th>${p.status !== 'draft' ? '<th class="n">Approved</th>' : ''}${buyer ? '<th class="n">Still to order</th>' : ''}<th class="n">Est. price</th><th class="n">In store then</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
   ${shopRows(lines, l => l.item_id, l => l.approved_qty ?? l.qty, 7, l => `<tr><td>${esc(itemName(l.item_id))}${l.note ? `<div class="small mut">${esc(l.note)}</div>` : ''}</td>
     <td class="n">${editable ? `<input name="q_${l.id}" type="number" step="any" min="0" value="${num(l.qty)}" class="qty">` : fq(l.qty)} ${esc(itemUnit(l.item_id))}${packSplit(l.item_id, l.qty) ? `<div class="small mut">${esc(packSplit(l.item_id, l.qty))}</div>` : ''}</td>
     ${p.status !== 'draft' ? `<td class="n">${approver ? `<input name="a_${l.id}" type="number" step="any" min="0" max="${num(l.qty)}" value="${num(l.qty)}" class="qty">` : l.approved_qty != null ? buyCell(l.item_id, l.approved_qty) : '—'}</td>` : ''}
     ${buyer ? `<td class="n">${remaining(l) > 0 ? `<label class="tick"><input type="checkbox" name="o_${l.id}" checked form="orderForm"> ${fq(remaining(l))}</label>` : '<span class="mut">ordered</span>'}</td>` : ''}
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
  </form>
  ${buyer && lines.some(l => remaining(l) > 0) ? `<form class="card" id="orderForm" data-form="createPO" data-id="${id}"><h2>Create an order</h2>
    <p class="small mut">One order per supplier or market run. Tick the lines bought there (above).</p>
    <div class="grid"><label>Supplier / stall<input name="supplier" required placeholder="e.g. Agdao market — stall 12"></label>
    <label>Cash advance used<select name="advance">${opt('', 'None / paid directly')}${advances.map(a => opt(a.id, `${peso(a.amount)} · ${fmtT(a.released_at)}`)).join('')}</select></label></div>
    <div class="row end"><button class="pri">Create order</button></div></form>` : ''}
  ${orders.length ? `<section class="card"><h2>Orders</h2><div class="list">${orders.map(o => `<a class="li" href="#/${P()}/po/${o.id}"><div class="li-main"><b>${esc(o.po_no)}</b><span class="mut small">${esc(o.supplier || '')} · ${o.line_count} items · by ${esc(o.buyer_name || '')}</span></div>${chip(PO_STATUS[o.status], statusTone(o.status))}</a>`).join('')}</div></section>` : ''}`;
};
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
   ${canRecv ? `<div class="grid mt"><label>Official receipt / invoice no.<input name="or_no"></label><label>Note<input name="note" placeholder="e.g. 0.5 kg short, wilted pechay"></label></div><div class="row end"><button class="pri">Receive into store</button></div>` : ''}
  </form>
  ${receipts.length ? `<section class="card"><h2>Receipts</h2><table><tbody>${receipts.map(r => `<tr><td>${esc(fmtT(r.received_at))}<div class="small mut">by ${esc(people[r.received_by] || '')}${r.or_no ? ' · OR ' + esc(r.or_no) : ''}${r.note ? ' · ' + esc(r.note) : ''}</div></td>
     <td>${num(r.short_value) > 0 ? chip('short ' + peso(r.short_value), 'bad') : chip('complete', 'ok')} ${num(r.price_var) ? chip('price ' + (num(r.price_var) > 0 ? '+' : '') + peso(r.price_var), num(r.price_var) > 0 ? 'warn' : 'info') : ''} ${r.same_person ? chip('received by buyer', 'warn') : ''}</td></tr>`).join('')}</tbody></table></section>` : ''}`;
};
FORMS.receive = async (f, el) => {
  const lines = Object.keys(f).filter(k => k.startsWith('q_')).map(k => ({ po_line_id: k.slice(2), qty: num(f[k]), unit_cost: f['c_' + k.slice(2)] === '' ? undefined : num(f['c_' + k.slice(2)]) }));
  if (lines.some(l => l.qty > 0 && !(l.unit_cost > 0))) return toast('Enter the actual unit price for each item received.', true);
  const r = await db.rpc('receive_po', { p_po: el.dataset.id, p_lines: lines, p_or_no: f.or_no || null, p_note: f.note || null });
  toast(num(r.short_value) > 0 ? `Received — short by ${peso(r.short_value)}` : 'Received into the ' + STORE(), num(r.short_value) > 0);
  await loadMaster(); refresh();
};

/* ================= STOCK & COUNTS ================= */
routes['c/stock'] = async arg => {
  if (arg === 'par') return parView();
  const [stock, counts] = await Promise.all([db.select('stock_on_hand', { eq: { ws: WS() }, order: [['category'], ['name']] }), db.select('stock_counts', { eq: { ws: WS() }, order: [['counted_at', false]], limit: 15 })]);
  const val = stock.reduce((s, x) => s + Math.max(num(x.value), 0), 0);
  return `<div class="row"><h1>${WS() === 'restaurant' ? 'Restaurant store' : 'Catering store'}</h1><span class="sp"></span><a class="btn ghost" href="#/${P()}/stock/par">Par levels &amp; restock</a>${can(WS(), 'storekeeper', 'manager', 'chef') ? '<button class="pri" data-act="startCount">Start a count</button>' : ''}</div>
   <div class="kpis"><div class="kpi"><span>Items in stock</span><b>${stock.filter(s => num(s.on_hand) > 0).length}</b></div><div class="kpi"><span>Stock value (last prices)</span><b>${peso(val)}</b></div></div>
   <input class="search" placeholder="Search…" data-filter="#stockTable tbody tr">
   ${stock.length ? `<div class="card tw"><table id="stockTable"><thead><tr><th>Item</th><th class="n">On hand</th><th class="n">Value</th></tr></thead><tbody>
     ${stock.map(s => `<tr><td>${esc(s.name)}<div class="small mut">${esc(s.category)}</div></td><td class="n ${num(s.on_hand) < 0 ? 'bad-t' : ''}">${fq(s.on_hand)} ${esc(s.stock_unit)}</td><td class="n">${peso(s.value)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">The ${STORE()} is empty. Receive an order or do an opening count.</div>`}
   ${counts.length ? `<h2>Counts</h2><div class="list">${counts.map(c => `<a class="li" href="#/${P()}/count/${c.id}"><div class="li-main"><b>${esc(fmtT(c.counted_at))}</b><span class="mut small">${c.status === 'posted' ? `missing ${peso(Math.abs(num(c.loss_value)))} · excess ${peso(c.gain_value)}` : 'not posted yet'}</span></div>${chip(c.status === 'posted' ? 'Posted' : 'Open', c.status === 'posted' ? (num(c.loss_value) < -1 ? 'bad' : 'ok') : 'warn')}</a>`).join('')}</div>` : ''}`;
};
ACT.startCount = async () => { const c = (await db.insert('stock_counts', { ws: WS(), counted_by: S.user.id }))[0]; go(`#/${P()}/count/${c.id}`); };
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
  const cats = [...new Set(S.items.map(i => i.category))];
  return `<div class="row"><a href="#/${P()}/stock" class="back">‹ Stock</a></div><h1>Count the ${STORE()}</h1>
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
routes['c/recipes'] = async arg => {
  const tab = arg || 'standard';
  const [rs, rl] = await Promise.all([db.select('recipes', { cols: 'dish_id,status,batch_serves' }), db.select('recipe_lines', { cols: 'dish_id,item_id,qty' })]);
  const recipes = Object.fromEntries(rs.map(r => [r.dish_id, r]));
  const costOf = {}; rl.forEach(l => costOf[l.dish_id] = (costOf[l.dish_id] || 0) + num(l.qty) * num(S.itemsById[l.item_id]?.last_cost));
  const costTag = d => { const r = recipes[d.id]; if (!r || !costOf[d.id]) return ''; const c = costOf[d.id], pct = d.tray_price && num(r.batch_serves) > 1 ? Math.round(c / num(d.tray_price) * 100) : null;
    return ` · cost ${peso(c)}${pct !== null ? ` · <span class="${pct > 45 ? 'bad-t' : pct > 35 ? 'warn-t' : 'ok-t'}">${pct}%</span>` : ''}`; };
  const tabs = [['standard', 'Standard list'], ['draft', 'Draft recipes'], ['verified', 'Verified'], ['none', 'No recipe'], ['all', 'All dishes']];
  const list = S.dishes.filter(d => tab === 'all' || (tab === 'standard' ? d.standard : tab === 'none' ? !recipes[d.id] && d.standard : recipes[d.id]?.status === tab));
  return `<h1>Dishes & recipes</h1><p class="lede">A dish's recipe lists what to buy for one batch: one large tray (10–12 guests, planned at 10), or one guest for rice, drinks and fruit. Only <b>verified</b> recipes are used for purchase requests.</p>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/recipes/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   <input class="search" placeholder="Search dishes…" data-filter=".dgroup .li">
   ${(g => g.length > 2 ? `<div class="jump">${g.map(([head], i) => `<button type="button" data-jump="g${i}">${esc(head.replace('Main · ', ''))}</button>`).join('')}</div>` : '')(dishGroups(list))}
   ${dishGroups(list).map(([head, ds], i) => `<section class="dgroup" data-group id="g${i}"><h3>${esc(head)} <span class="cnt">${ds.length}</span></h3><div class="list">${ds.map(d => `<a class="li" href="#/c/recipe/${d.id}"><div class="li-main"><b>${esc(d.name)}</b><span class="mut small">chosen ${d.times_booked}×${d.tray_price ? ' · tray ' + peso(d.tray_price) : ''}${costTag(d)}</span></div>${recipes[d.id] ? chip(recipes[d.id].status === 'verified' ? 'Verified' : 'Draft', recipes[d.id].status === 'verified' ? 'ok' : 'warn') : chip('No recipe', 'mut')}</a>`).join('')}</div></section>`).join('') || '<div class="empty">None.</div>'}`;
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
  const pct = tray ? Math.round(cost / tray * 100) : null;
  return `Ingredient cost per batch <b>${peso(cost)}</b> · ${peso(cost / (serves || 1))} per guest${pct !== null ? ` · <span class="${pct > 45 ? 'bad-t' : pct > 35 ? 'warn-t' : 'ok-t'}">${pct}% of the tray price</span>` : ''}`;
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
  if (!(num(e.target.value) > 0)) return toast('Quantity must be more than 0 (use ✕ to remove an ingredient).', true);
  try { await db.update('recipe_lines', { qty: num(e.target.value) }, { dish_id: form.dataset.id, item_id: m[1] }); toast('Saved'); } catch (err) { toast(err.message, true); }
});
routes['c/recipe'] = async id => {
  const d = S.dishById[id]; if (!d) return '<div class="card">Dish not found.</div>';
  const [[r], lines] = await Promise.all([db.select('recipes', { eq: { dish_id: id } }), db.select('recipe_lines', { eq: { dish_id: id } })]);
  const edit = canAny('chef', 'manager');
  const cost = lines.reduce((s, l) => s + num(l.qty) * num(S.itemsById[l.item_id]?.last_cost), 0);
  // No meat, pasta or rice (desserts, soups, salads)? The ingredient named in the dish is the main one — Buko Pandan → buko
  const words = d.name.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
  const named = itemId => { const n = (S.itemsById[itemId]?.name || '').toLowerCase(); return words.some(w => n.includes(w)); };
  const noMain = !lines.some(l => recipeRank(l.item_id) === 0);
  const rank0 = recipeRank; const recipeRankD = itemId => noMain && named(itemId) ? 0 : rank0(itemId);
  lines.sort((a, b) => recipeRankD(a.item_id) - recipeRankD(b.item_id) || (isToTaste(a.item_id) - isToTaste(b.item_id)) || num(b.qty) - num(a.qty) || itemName(a.item_id).localeCompare(itemName(b.item_id)));
  let lastG = -1; const head = itemId => { const g = recipeRankD(itemId); if (g === lastG) return ''; lastG = g; return `<tr class="grp"><td colspan="4">${g === 1 && !lines.some(l => recipeRankD(l.item_id) === 0) ? 'Ingredients' : RECIPE_HEADS[g]}</td></tr>`; };
  return `<div class="row"><a href="#/c/recipes" class="back">‹ Dishes</a></div>
  <div class="row"><h1>${esc(d.name)}</h1>${r ? chip(r.status === 'verified' ? 'Verified' : 'Draft', r.status === 'verified' ? 'ok' : 'warn') : chip('No recipe', 'mut')}</div>
  <p class="lede">${esc(d.category)} · ${esc(d.course)} · chosen ${d.times_booked}× ${d.tray_price ? '· tray price ' + peso(d.tray_price) : ''}</p>
  ${!r ? (edit ? `<form class="card" data-form="startRecipe" data-id="${id}"><p>No recipe yet.</p><label>One batch is for<select name="serves">${opt('10', 'one large tray (10–12 guests)')}${opt('1', 'one guest (rice, drinks, fruit)')}</select></label><div class="row end"><button class="pri">Start recipe</button></div></form>` : '<div class="card">No recipe yet. A chef can add it.</div>') : `
  <form class="card" data-form="${edit ? 'saveRecipe' : 'none'}" data-id="${id}">
   <div class="row"><h2>Ingredients for ${num(r.batch_serves) === 1 ? 'one guest' : (num(r.batch_serves) === 10 ? 'one tray (10–12 guests)' : `one batch (${fq(r.batch_serves)} guests)`)}</h2></div>
   ${r.method ? `<p class="small mut">${esc(r.method)}</p>` : ''}
   <div class="tw"><table><thead><tr><th>Ingredient</th><th class="n">Qty</th><th class="n">Cost</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
   ${lines.map(l => { const it = S.itemsById[l.item_id] || {}; return `${head(l.item_id)}<tr><td>${esc(itemName(l.item_id))}${num(it.last_cost) ? `<div class="small mut">${peso(it.last_cost)} per ${esc(it.stock_unit)}</div>` : ''}</td><td class="n">${edit ? `<input name="q_${l.item_id}" type="number" step="any" min="0" value="${num(l.qty)}" class="qty">` : fq(l.qty)} ${esc(itemUnit(l.item_id))}</td><td class="n" data-linecost="${l.item_id}" data-price="${num(it.last_cost)}">${num(it.last_cost) ? peso(num(l.qty) * num(it.last_cost)) : '<span class="mut small">no price</span>'}</td>${edit ? `<td class="nowrap"><button type="button" class="x" title="Edit" data-act="editIng" data-item="${l.item_id}">✎</button><button type="button" class="x" title="Remove" data-act="rmIng" data-dish="${id}" data-item="${l.item_id}">✕</button></td>` : ''}</tr>
   ${edit ? `<tr class="ing-edit" id="ie_${l.item_id}" hidden><td colspan="4"><div class="grid">
     <label>Replace with another ingredient (this recipe only)<input name="e_swap_${l.item_id}" list="dl-items" placeholder="leave empty to keep ${esc(it.name || '')}" autocomplete="off"></label>
     <label>Ingredient name<input name="e_name_${l.item_id}" value="${esc(it.name || '')}"></label>
     <label>Unit used in recipes<input name="e_unit_${l.item_id}" list="dl-units" value="${esc(it.stock_unit || '')}"></label>
     <label>Price per unit ₱<input name="e_cost_${l.item_id}" type="number" step="any" min="0" value="${num(it.last_cost) || ''}"></label></div>
     <p class="small mut">Name, unit and price belong to the ingredient, so they change in every recipe that uses it. Price is updated again automatically when goods are received.</p>
     <div class="row end"><button type="button" class="ghost" data-act="editIng" data-item="${l.item_id}">Cancel</button><button type="button" class="pri" data-act="saveIng" data-dish="${id}" data-item="${l.item_id}">Save ingredient</button></div></td></tr>` : ''}`; }).join('')}
   </tbody><tfoot><tr><td colspan="4" id="recipeTotal" data-tray="${d.tray_price && num(r.batch_serves) > 1 ? num(d.tray_price) : 0}" data-serves="${num(r.batch_serves)}">${recipeTotalText(cost, d.tray_price && num(r.batch_serves) > 1 ? num(d.tray_price) : 0, num(r.batch_serves))}</td></tr></tfoot></table></div>
   ${edit ? `<div class="addline mt"><input name="new_item" list="dl-items" placeholder="Add ingredient" autocomplete="off"><input name="new_qty" type="number" step="any" min="0" placeholder="qty" class="qty"><button type="button" data-act="addIng" data-id="${id}">Add</button></div>${itemDatalist()}
   <div class="row end"><button class="ghost">Save quantities</button>${r.status !== 'verified' ? `<button type="button" class="pri" data-act="verify" data-id="${id}">Mark verified</button>` : ''}</div>
   <p class="small mut">${r.status === 'verified' ? 'A manager\'s change puts this recipe back to draft until a chef verifies it again.' : 'Check each quantity against how the kitchen really cooks this dish, then mark it verified so it can be used for purchase requests.'}</p>` : ''}
  </form>
  ${edit ? `<details class="card"><summary>Ingredient not on the list? Add a new item</summary><form data-form="newItem" class="mt"><div class="grid">
    <label>Name<input name="name" required></label><label>Category<input name="category" list="dl-cats" required></label>
    <label>Unit used in recipes<input name="stock_unit" list="dl-units" value="kg" required></label><label>Unit bought in<input name="purchase_unit" list="dl-units" value="kg" required></label>
    <label>How many recipe units in one bought unit<input name="units_per_purchase" type="number" step="any" min="0.001" value="1"></label><label>Last price per recipe unit ₱<input name="last_cost" type="number" step="any" min="0"></label></div>
    <datalist id="dl-cats">${[...new Set(S.items.map(i => i.category))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dl-units">${['kg', 'g', 'L', 'pc', 'pack', 'can', 'bundle', 'bottle', 'tray', 'sack', 'box'].map(u => `<option value="${u}">`).join('')}</datalist>
    <div class="row end"><button class="pri">Add item</button></div></form></details>` : ''}`}`;
};
FORMS.startRecipe = async (f, el) => { await db.insert('recipes', { dish_id: el.dataset.id, batch_serves: num(f.serves), status: 'draft' }); refresh(); };
FORMS.saveRecipe = async (f, el) => {
  for (const [k, v] of Object.entries(f).filter(([k]) => k.startsWith('q_'))) if (num(v) > 0) await db.update('recipe_lines', { qty: num(v) }, { dish_id: el.dataset.id, item_id: k.slice(2) });
  toast('Saved'); refresh();
};
FORMS.newItem = async f => {
  if (itemIdFromName(f.name)) return toast('An item with that name exists already.', true);
  await db.insert('items', { name: f.name.trim(), category: f.category.trim(), stock_unit: f.stock_unit.trim(), purchase_unit: f.purchase_unit.trim(), units_per_purchase: num(f.units_per_purchase) || 1, last_cost: num(f.last_cost) });
  await loadMaster(); toast('Item added'); refresh();
};
ACT.addIng = async el => {
  const f = formData(el.closest('form')); const item = itemIdFromName(f.new_item);
  if (!item) return toast('Pick an ingredient from the list, or add it as a new item below.', true); if (!(num(f.new_qty) > 0)) return toast('Enter a quantity.', true);
  await db.upsert('recipe_lines', { dish_id: el.dataset.id, item_id: item, qty: num(f.new_qty) }, 'dish_id,item_id'); refresh();
};
ACT.editIng = async el => { const r = document.getElementById('ie_' + el.dataset.item); if (r) r.hidden = !r.hidden; };
ACT.saveIng = async el => {
  const f = formData(el.closest('form')), id = el.dataset.item, dish = el.dataset.dish, it = S.itemsById[id];
  const swap = (f['e_swap_' + id] || '').trim(), name = (f['e_name_' + id] || '').trim(), unit = (f['e_unit_' + id] || '').trim(), cost = f['e_cost_' + id];
  if (swap) {
    const to = itemIdFromName(swap); if (!to) return toast('Pick the replacement from the list, or add it as a new item below.', true);
    if (to === id) return toast('That is the same ingredient.', true);
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
ACT.verify = async el => { const f = formData(el.closest('form')); await FORMS.saveRecipe(f, el.closest('form')); await db.rpc('verify_recipe', { p_dish: el.dataset.id }); toast('Recipe verified — it will now be used for purchase requests'); refresh(); };


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
  const canAct = can('catering', 'coordinator', 'manager');
  const items = (p.items || []).filter(i => i.dish);
  const row = (l, v) => v ? `<tr><td class="mut">${l}</td><td>${v}</td></tr>` : '';
  const plan = pl.kind === 'package' ? `${esc(pl.packageName || 'Package')}${num(pl.pricePerHead) ? ` · ${peso(pl.pricePerHead)} per head` : ''}` : esc(BK_KIND[pl.kind] || pl.kind || '');
  return `<div class="row"><a href="#/c/inquiries" class="back">‹ Inquiries</a></div>
  <div class="row"><h1>${esc(b.client_name || 'Inquiry')}</h1>${chip(BK_STATUS[b.status], BK_TONE[b.status])}</div>
  <p class="lede">${esc(b.ref)}${b.website_ref ? ' · website ref ' + esc(b.website_ref) : ''} · received ${esc(fmtT(b.received_at))}</p>
  <section class="card"><h2>Customer and event</h2><table class="kv"><tbody>
   ${row('Mobile', c.phone ? `<a href="tel:${esc(String(c.phone).replace(/\s+/g, ''))}">${esc(c.phone)}</a>` : '')}${row('Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')}
   ${row('Company', esc([k.company, k.position].filter(Boolean).join(' · ')))}
   ${row('Event', esc([ev.type, ev.date ? fmtD(ev.date) : '', ev.time ? fmtClock(ev.time) : ''].filter(Boolean).join(' · ')))}${row('Venue', esc(ev.venue || ''))}${row('Guests', ev.pax ? esc(ev.pax) : '')}
   ${row('Plan', plan)}${row('Fulfilment', esc([pl.fulfil, pl.payment].filter(Boolean).join(' · ')))}
   ${row('Estimate', num(es.total) ? `${peso(es.total)}${num(es.perHead) ? ` (${peso(es.perHead)} per head)` : ''} <span class="mut small">— estimate shown to the customer</span>` : '')}
   ${row('Notes', p.notes ? esc(p.notes).replace(/\n/g, '<br>') : '')}
  </tbody></table></section>
  ${items.length || pl.chefPick ? `<section class="card"><h2>Menu picked</h2>${pl.chefPick ? '<p>Chef to recommend the menu.</p>' : ''}
   ${items.map(i => `<div class="mline"><span class="mut small" style="min-width:120px">${esc(COURSE_OF[i.cat] || i.cat || '')}</span><span>${esc(i.dish)}</span>${i.tier === 'request' ? chip('special request', 'warn') : ''}<span class="sp"></span>${i.qty ? `<b>${esc(i.qty)}${pl.kind === 'tray' ? ' tray' + (num(i.qty) > 1 ? 's' : '') : ''}</b>` : ''}</div>`).join('')}</section>` : ''}
  ${canAct ? `<section class="card"><div class="row"><h2>Next step</h2></div>
   <div class="row">${b.event_id ? `<a class="btn pri" href="#/c/event/${b.event_id}">Open the event</a>` : `<button class="pri" data-act="bkEvent" data-id="${b.id}">Create event from this inquiry</button>`}
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
  const [tab, dArg] = (arg || 'day').split('/');
  const tabs = [['day', 'Daily count'], ['restock', 'Restock list'], ['week', 'Weekly report'], ...(can('restaurant', 'manager', 'chef') ? [['dishes', 'Menu, prices & par']] : [])];
  const seg = `<div class="seg">${tabs.map(([k, l]) => `<a href="#/r/kitchen/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  const body = tab === 'restock' ? await kRestock(dArg) : tab === 'week' ? await kWeek(dArg) : tab === 'dishes' ? await kDishes() : await kDay(dArg);
  return `<h1>Kitchen stocks</h1>${seg}${body}`;
};
async function kDay(d) {
  d = d || S.kDate || today(); S.kDate = d;
  const [rows, [day], posDay] = await Promise.all([db.rpc('kitchen_sheet', { p_date: d }), db.select('kitchen_days', { eq: { count_date: d } }), db.select('pos_daily', { eq: { biz_date: d } }).catch(() => [])]);
  const fromPos = num(posDay[0]?.orders) > 0 && !can('restaurant', 'manager');
  S.kRows = Object.fromEntries(rows.map(r => [r.dish_id, r]));
  const by = S.kGroup || 'section', mayEdit = member('restaurant');
  const low = rows.filter(r => kEnd(r) < num(r.min_level));
  const saver = day?.saved_by ? (await db.select('profiles', { cols: 'full_name', eq: { id: day.saved_by } }))[0]?.full_name : '';
  return `<div class="card"><div class="row wrap"><label class="inline">Date <input type="date" value="${d}" data-kdate max="${today()}"></label>
     <label class="inline">Group by <select data-kgroup>${opt('section', 'Menu section', by === 'section')}${opt('protein', 'Main ingredient', by === 'protein')}</select></label><span class="sp"></span>
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
  const n = e.target.closest('.kname'); if (!n || !member('restaurant')) return;
  const row = n.closest('[data-kid]'), r = S.kRows?.[row.dataset.kid]; if (!r) return;
  const note = prompt(`Note for ${r.name} (e.g. 2 burnt, staff meal):`, r.note || ''); if (note === null) return;
  r.note = note.trim(); try { await kSave(r, 'note'); toast('Note saved'); refresh(); } catch (err) { toast(err.message, true); }
});
async function kRestock(d) {
  d = d || S.kDate || today();
  const rows = await db.rpc('kitchen_sheet', { p_date: d });
  const need = rows.map(r => ({ ...r, end: kEnd(r) })).filter(r => r.end < num(r.min_level)).map(r => ({ ...r, need: Math.max(num(r.par) - r.end, 0) }));
  return `<div class="card"><div class="row wrap"><label class="inline">Date <input type="date" value="${d}" onchange="location.hash='#/r/kitchen/restock/'+this.value" max="${today()}"></label><span class="sp"></span><button class="ghost" onclick="window.print()">Print</button></div></div>
   ${need.length ? `<div class="card tw"><h2>To cook — ${esc(fmtD(d))}</h2><p class="small mut">Dishes that ended below their low level. Cook back up to par.</p>
     <table><thead><tr><th>Dish</th><th class="n">Ending</th><th class="n">Par</th><th class="n">Cook</th></tr></thead><tbody>
     ${kGroups(need, 'protein').map(([g, l]) => `<tr class="grp"><td colspan="4">${esc(g)}</td></tr>${l.sort((a, b) => b.need - a.need).map(r => `<tr><td>${esc(r.name)}</td><td class="n ${r.end <= 0 ? 'bad-t' : ''}">${fq(r.end)}</td><td class="n">${fq(r.par)}</td><td class="n"><b>${fq(r.need)}</b></td></tr>`).join('')}`).join('')}
     </tbody></table></div>` : '<div class="empty">Nothing is low. 👍</div>'}`;
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
  return `<div class="card"><div class="row wrap"><a class="btn ghost" href="#/r/kitchen/week/${addDays(from, -7)}">‹ Previous</a><b>${esc(fmtD(from))} – ${esc(fmtD(to))}</b>${from < weekStart(today()) ? `<a class="btn ghost" href="#/r/kitchen/week/${addDays(from, 7)}">Next ›</a>` : ''}<span class="sp"></span><span class="small mut">${days} of 7 days counted</span><button class="ghost" onclick="window.print()">Print</button></div></div>
   ${list.length ? `<div class="kpis"><div class="kpi"><span>Portions sold</span><b>${fq(T('sold'))}</b></div><div class="kpi"><span>Cooked</span><b>${fq(T('in'))}</b></div><div class="kpi ${T('out') ? 'bad' : ''}"><span>Pulled out</span><b>${fq(T('out'))}</b></div></div>
   <div class="two"><div class="card"><h3>Best sellers</h3>${top.map((x, i) => `<div class="mline"><span>${i + 1}. ${esc(x.name)}</span><span class="sp"></span><b>${fq(x.sold)}</b></div>`).join('') || '<span class="mut small">No sales recorded.</span>'}</div>
     <div class="card"><h3>Pulled out — check waste</h3>${pulled.map(x => `<div class="mline"><span>${esc(x.name)}</span><span class="sp"></span><b class="warn-t">${fq(x.out)}</b></div>`).join('') || '<span class="mut small">None.</span>'}</div></div>
   ${idle.length ? `<p class="small mut">In stock but not sold this week: ${idle.map(x => esc(x.name)).join(', ')}</p>` : ''}
   <div class="card tw"><table><thead><tr><th>Dish</th><th class="n">Beg</th><th class="n">Cooked</th><th class="n">Pull-out</th><th class="n">Sold</th><th class="n">End</th></tr></thead><tbody>
   ${list.map(x => `<tr><td>${esc(x.name)}<div class="small mut">${esc(x.section)}${x.notes.length ? ' · ' + esc(x.notes.join(' · ')) : ''}</div></td><td class="n">${fq(x.start)}</td><td class="n">${x.in ? fq(x.in) : ''}</td><td class="n ${x.out ? 'warn-t' : ''}">${x.out ? fq(x.out) : ''}</td><td class="n"><b>${fq(x.sold)}</b></td><td class="n">${fq(x.end)}</td></tr>`).join('')}
   </tbody></table></div>` : '<div class="empty">No counts this week.</div>'}`;
}
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
const POS = { order: null, menu: [], sec: 'All', q: '', t: null, busy: false, settings: null, shift: null, tab: 'change', cash: 0, left: {}, drawer: false, search: false };
const KIND_L = { dine_in: 'Dine-in', take_out: 'Take-out', delivery: 'Delivery' };
const KIND_I = { dine_in: '🍽', take_out: '🛍', delivery: '🛵' };
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
  if (!posCan()) return '<div class="card">The POS is for cashiers, servers and managers. Ask the owner to add the Cashier or Staff job in Restaurant.</div>';
  const [menu, [st], [shift], open, sheet] = await Promise.all([
    db.select('restaurant_menu', { eq: { on_pos: true }, order: [['sort']] }), db.select('pos_settings'),
    db.select('pos_shifts', { order: [['opened_at', false]], limit: 1 }), db.select('pos_orders', { eq: { status: 'open' }, order: [['opened_at']] }),
    db.rpc('kitchen_sheet', { p_date: today() }).catch(() => [])]);
  POS.menu = menu.map(m => ({ ...m, name: S.dishById[m.dish_id]?.name || '?' })); POS.settings = st; POS.shift = shift && !shift.closed_at ? shift : null; POS.open = open;
  POS.left = Object.fromEntries(sheet.map(r => [r.dish_id, num(r.ending)]));      // portions left per counted dish
  if (arg && arg !== 'new') { const [o] = await db.select('pos_orders', { eq: { id: arg } }); POS.order = o && o.status === 'open' ? { ...o, lines: await db.select('pos_lines', { eq: { order_id: arg }, order: [['created_at']] }) } : posBlank(); POS.cash = 0; }
  else if (arg === 'new' || !POS.order || (POS.order.id && !open.some(o => o.id === POS.order.id))) { POS.order = posBlank(); POS.cash = 0; }
  POS.drawer = false;
  return posHtml();
};
function posLeft(m) {   // portions left after what is already on this order (null = dish not counted)
  if (!(m.dish_id in POS.left) || !m.active) return null;
  const onOrder = POS.order.lines.filter(l => l.dish_id === m.dish_id).reduce((a, l) => a + num(l.qty), 0);
  return POS.left[m.dish_id] - onOrder;
}
function posSum(o) {
  const T = posTotals(o), change = POS.cash - T.total;
  return `<div class="p-sum"><div><div class="big"><span>Subtotal</span><b>${peso(T.sub)}</b></div>${T.sc ? `<div><span>Service ${fq(POS.settings?.sc_rate ?? 10)}%</span><span>${peso(T.sc)}</span></div>` : ''}<div><span>Disc. amount</span><span>${T.disc ? '−' + peso(T.disc) : '₱0'}</span></div></div>
     <div><div class="big"><span>Total</span><b>${peso(T.total)}</b></div><div><span>Cash received</span><span>${peso(POS.cash)}</span></div><div><span>${POS.cash && change < 0 ? 'Still due' : 'Change'}</span><span class="${POS.cash && change < 0 ? 'bad-t' : POS.cash ? 'ok-t' : ''}">${POS.cash ? peso(Math.abs(change)) : '₱0'}</span></div></div></div>`;
}
function posHtml() {
  const o = POS.order, T = posTotals(o), first = (S.me.full_name || '').split(' ')[0];
  const priced = POS.menu.filter(m => m.price != null), unpriced = POS.menu.length - priced.length;
  const secs = ['All', ...new Set(priced.map(m => m.section))];
  const items = priced.filter(m => (POS.sec === 'All' || m.section === POS.sec) && (!POS.q || m.name.toLowerCase().includes(POS.q.toLowerCase())));
  const nItems = o.lines.reduce((a, l) => a + num(l.qty), 0), change = POS.cash - T.total;
  const tabBody = {
    change: `<div class="notes">${[20, 50, 100, 200, 500, 1000].map((v, i) => `<button type="button" class="note n${i}" data-posnote-cash="${v}">₱${v.toLocaleString()}</button>`).join('')}
       <button type="button" class="note exact" data-posnote-cash="exact">Exact</button><button type="button" class="note clr" data-posnote-cash="0" title="Clear the cash">Clear</button>
       <label class="note-in"><span>₱</span><input type="text" inputmode="decimal" autocomplete="off" placeholder="Type the cash received" data-poscashin value="${POS.cash ? String(+POS.cash.toFixed(2)) : ''}"></label></div>`,
    discount: `<div class="ptab-grid"><label>Guests<span class="step"><button type="button" data-posstep="pax|-1">−</button><b>${o.pax}</b><button type="button" data-posstep="pax|1">＋</button></span></label>
       <label>Senior / PWD<span class="step"><button type="button" data-posstep="seniors|-1">−</button><b>${o.seniors}</b><button type="button" data-posstep="seniors|1">＋</button></span></label>
       <p class="small mut">${fq(POS.settings?.senior_pct ?? 20)}% off each Senior/PWD's share of the bill. Check their ID.</p></div>`,
    service: `<div class="seg pos-kind">${Object.entries(KIND_L).map(([k, l]) => `<button type="button" class="${o.kind === k ? 'on' : ''}" data-poskind="${k}">${KIND_I[k]} ${l}</button>`).join('')}</div>
       <div class="ptab-grid">${o.kind === 'dine_in' ? `<label>Table<input data-posf="table_no" value="${esc(o.table_no || '')}" inputmode="numeric"></label>` : `<label>Customer name<input data-posf="customer" value="${esc(o.customer || '')}"></label>`}
       <p class="small mut">${o.kind === 'dine_in' ? `${fq(POS.settings?.sc_rate ?? 10)}% service charge applies to dine-in.` : 'No service charge on take-out and delivery.'}</p></div>`,
    print: `<div class="ptab-grid"><button type="button" class="pbtn" data-act="posSend"${o.lines.some(l => !l.sent_at) ? '' : ' disabled'}>🍳 Send to kitchen</button><button type="button" class="pbtn" data-act="posPreBill"${o.lines.length ? '' : ' disabled'}>🧾 Print bill</button>
       <button type="button" class="pbtn" data-act="posBill"${o.lines.length && posCash() ? '' : ' disabled'}>💳 Card / split / charge</button>${o.id ? '<button type="button" class="pbtn danger" data-act="posVoid">✕ Void order</button>' : ''}</div>`
  }[POS.tab];
  return `<div class="pos2">
   <div class="p-left">
    <div class="p-bar"><button type="button" class="ic" data-posdrawer title="Orders and menu">☰</button><button type="button" class="ic ${POS.search ? 'on' : ''}" data-possearch title="Search">⌕</button>
     ${POS.search ? `<input class="p-search" placeholder="Find a dish…" value="${esc(POS.q)}" data-posq>` : `<div class="p-tabs">${secs.map(x => `<button type="button" class="${POS.sec === x ? 'on' : ''}" data-possec="${esc(x)}">${esc(x)}</button>`).join('')}</div>`}</div>
    <div class="p-grid">${items.map(m => { const left = posLeft(m), inO = o.lines.filter(l => l.dish_id === m.dish_id).reduce((a, l) => a + num(l.qty), 0);
      return `<button type="button" class="p-tile ${left !== null && left <= 0 ? 'out' : ''}" style="--c:${PROT_C[m.protein] || PROT_C.Others}" data-posadd="${m.dish_id}">${inO ? `<i>${fq(inO)}</i>` : ''}<b>${esc(m.name)}</b><small>${peso(m.price).replace('.00', '')}${left !== null ? ` · ${left <= 0 ? 'out' : fq(left) + ' left'}` : ''}</small></button>`; }).join('') || (posEditor() ? '' : '<div class="p-empty">No dishes here.</div>')}
     ${posEditor() ? '<button type="button" class="p-tile add" data-act="posNewItem"><b>＋</b><small>Add item</small></button>' : ''}</div>
    ${unpriced ? `<p class="p-note">${unpriced} item${unpriced > 1 ? 's' : ''} hidden — no price yet${can('restaurant', 'manager', 'chef') ? ' · <a href="#/r/kitchen/dishes">set prices</a>' : ''}</p>` : ''}
   </div>
   <div class="p-right">
    <div class="p-head"><span class="hello">Hello ${esc(first)}</span><span class="sp"></span>${POS.shift ? '' : posCash() ? '<button type="button" class="chipbtn" data-act="posShift">Open drawer</button>' : '<span class="chip warn">Drawer closed</span>'}<button type="button" class="ic light" data-postab="service" title="${KIND_L[o.kind]}">${KIND_I[o.kind]}</button></div>
    <div class="p-items"><span>${o.id ? `ORDER #${o.order_no}${o.table_no ? ' · T' + esc(o.table_no) : ''}` : 'ITEMS'} <em>${fq(nItems)}</em></span><span class="sp"></span>${o.lines.length && !o.lines.some(l => l.sent_at) ? '<button type="button" class="ic light" data-posclear title="Clear">🗑</button>' : ''}</div>
    <div class="p-lines">${o.lines.length ? o.lines.map((l, i) => `<div class="pl ${l.sent_at ? 'sent' : ''}"><div class="pl-n" data-posnote="${i}"><b>${esc(l.name)}</b>${l.note ? `<small>${esc(l.note)}</small>` : ''}${l.sent_at ? '<small class="k">in the kitchen</small>' : ''}</div>
       <span class="step sm"><button type="button" data-posqty="${i}|-1">−</button><b>${fq(l.qty)}</b><button type="button" data-posqty="${i}|1">＋</button></span><span class="pl-a">${peso(num(l.qty) * num(l.price))}</span></div>`).join('')
      : `<div class="p-tap"><div class="p-circle">▦</div><b>Tap an item</b><span>to add to order ${o.order_no ? '#' + o.order_no : '#' + ((POS.open.reduce((a, x) => Math.max(a, x.order_no), 0)) + 1)}</span></div>`}</div>
    <div class="p-tabs2">${[['change', 'Change'], ['discount', 'Discount'], ['service', 'Service'], ['print', 'More']].map(([k, l]) => `<button type="button" class="${POS.tab === k ? 'on' : ''}" data-postab="${k}">${l}${k === 'discount' && o.seniors ? ' •' : ''}</button>`).join('')}</div>
    <div class="p-tabbody">${tabBody}</div>
    ${posSum(o)}
    <div class="p-act"><button type="button" class="sq" data-postab="service" title="Order type">${KIND_I[o.kind]}</button><button type="button" class="sq" data-act="posSend" title="Send to kitchen"${o.lines.some(l => !l.sent_at) ? '' : ' disabled'}>🍳</button>
     <button type="button" class="charge" data-act="posCharge"${o.lines.length && posCash() ? '' : ' disabled'}>Charge</button><button type="button" class="gcash" data-act="posGcash"${o.lines.length && posCash() ? '' : ' disabled'}>GCash</button></div>
   </div>
   ${POS.drawer ? `<div class="p-drawer" data-posdrawer-bg><div class="p-dpanel"><h2>Open orders</h2>
     ${POS.open.map(x => `<a class="otab ${x.id === o.id ? 'on' : ''}" href="#/r/pos/${x.id}"><b>${x.table_no ? 'Table ' + esc(x.table_no) : '#' + x.order_no + ' · ' + KIND_L[x.kind]}</b><small>${peso(x.total)}</small></a>`).join('') || '<p class="mut small">No open orders.</p>'}
     <a class="btn pri" href="#/r/pos/new">＋ New order</a><hr>
     ${posEditor() ? '<a href="javascript:void 0" data-act="posNewItem">＋ Add an item to the POS</a>' : ''}<a href="#/r/sales">Sales today</a><a href="#/r/kitchen">Kitchen stocks</a>${POS.shift && posCash() ? '<a href="#/r/sales">Close the cash drawer</a>' : ''}<a href="#/">Exit POS</a></div></div>` : ''}
  </div>`;
}
function posPaint() { $('#main').innerHTML = posHtml(); }
function posQueueSave() { clearTimeout(POS.t); POS.t = setTimeout(() => posSave().catch(err => toast(err.message, true)), 700); }
async function posSave() {
  clearTimeout(POS.t); const o = POS.order; if (!o.id && !o.lines.length) return o;
  while (POS.busy) await new Promise(r => setTimeout(r, 120));
  POS.busy = true;
  try {
    const r = await db.rpc('pos_save', { p: { id: o.id, kind: o.kind, table_no: o.table_no, pax: o.pax, seniors: o.seniors, customer: o.customer, note: o.note,
      lines: o.lines.map(l => ({ id: l.id || null, dish_id: l.dish_id, qty: num(l.qty), note: l.note || '' })) } });
    const lines = await db.select('pos_lines', { eq: { order_id: r.id }, order: [['created_at']] });
    const wasNew = !o.id; POS.order = { ...r, lines };
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
  if (b.dataset.possec) { POS.sec = b.dataset.possec; return posPaint(); }
  if (b.dataset.postab) { POS.tab = b.dataset.postab; return posPaint(); }
  if (b.dataset.posclear !== undefined) { if (!confirm('Clear this order?')) return; o.lines = []; POS.cash = 0; posPaint(); return o.id ? posQueueSave() : null; }
  if (b.dataset.posnoteCash !== undefined) { const v = b.dataset.posnoteCash; POS.cash = v === 'exact' ? posTotals(o).total : v === '0' ? 0 : POS.cash + Number(v); return posPaint(); }
  if (b.dataset.posadd) { const m = POS.menu.find(x => x.dish_id === b.dataset.posadd), left = posLeft(m);
    if (left !== null && left <= 0 && !confirm(`${m.name} shows 0 portions left in the kitchen count. Add it anyway?`)) return;
    const l = o.lines.find(x => x.dish_id === m.dish_id && !x.sent_at && !x.note);
    if (l) l.qty = num(l.qty) + 1; else o.lines.push({ dish_id: m.dish_id, name: m.name, price: m.price, qty: 1 }); posPaint(); return posQueueSave(); }
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
async function posPayNow(pay) {
  try {
    const o = await posSave();
    const r = await db.rpc('pos_pay', { p_order: o.id, p_cash: pay.cash || 0, p_card: pay.card || 0, p_gcash: pay.gcash || 0, p_charge: pay.charge || 0, p_ref: pay.ref || '', p_invoice: pay.invoice || '' });
    const lines = POS.order.lines; toast(num(r.change_due) ? `Paid · change ${peso(r.change_due)}` : 'Paid');
    if (confirm(`Paid${num(r.change_due) ? ' — change ' + peso(r.change_due) : ''}. Print the order slip?`)) posSlip(r, lines);
    POS.order = posBlank(); POS.cash = 0; POS.tab = 'change'; go('#/r/pos/new');
  } catch (err) { toast(err.message, true); }
}
ACT.posCharge = async () => {
  const T = posTotals(POS.order);
  if (!POS.cash) return toast('Tap the cash received (₱20 … ₱1,000 or Exact), then Charge.', true);
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
  try { await db.rpc('pos_void', { p_order: POS.order.id, p_reason: reason }); toast('Order voided'); POS.order = posBlank(); go('#/r/pos/new'); } catch (err) { toast(err.message, true); }
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
  const openShift = shifts.find(s => !s.closed_at);
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
   ${orders.length ? `<details class="card"><summary>All orders (${orders.length})</summary><div class="tw"><table><thead><tr><th>#</th><th>Type</th><th>Time</th><th class="n">Total</th><th>Paid by</th><th>Status</th></tr></thead><tbody>
     ${orders.map(o => `<tr><td>${o.order_no}</td><td>${KIND_L[o.kind]}${o.table_no ? ' · T' + esc(o.table_no) : ''}</td><td>${o.paid_at ? esc(new Date(o.paid_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })) : ''}</td><td class="n">${peso(o.total)}</td><td>${['cash', 'gcash', 'card', 'charge'].filter(k => num(o['paid_' + k])).join(' + ')}${o.invoice_no ? `<div class="small mut">inv ${esc(o.invoice_no)}</div>` : ''}</td><td>${chip(o.status, o.status === 'paid' ? 'ok' : o.status === 'void' ? 'bad' : 'warn')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
};
FORMS.saveZ = async (f, el) => {
  const n = k => f[k] === '' ? null : num(f[k]);
  await db.upsert('daily_sales', { sale_date: el.dataset.date, gross: n('gross') ?? 0, discounts: n('discounts') ?? 0, service_charge: n('service_charge') ?? 0, cash: n('cash'), card: n('card'), gcash: n('gcash'), charge: n('charge'),
    guests: f.guests === '' ? null : Math.round(num(f.guests)), or_from: f.or_from || null, or_to: f.or_to || null, source: 'registered_pos', verified_by: S.user.id }, 'sale_date');
  toast('Z-reading saved'); refresh();
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
  const people = await db.rpc('admin_people');
  const sel = people.find(p => p.id === arg);
  const has = (ws, role) => (sel?.roles || []).some(r => r.ws === ws && r.role === role);
  return `<h1>People & roles</h1>
  <div class="alert info"><b>Adding someone new:</b> first create their login in Supabase → <b>Authentication → Users → Add user</b> (their email, or <code>username@staff.romualdos.ph</code> if they have none, and a starting password). Then they appear below — open them and give them roles.</div>
  <div class="list">${people.map(p => `<a class="li" href="#/people/${p.id}"><div class="li-main"><b>${esc(p.full_name || p.email)}</b><span class="mut small">${esc(p.email)}${p.username ? ' · ' + esc(p.username) : ''}</span>
    <span class="small">${p.is_admin ? chip('Owner', 'info') + ' ' : ''}${(p.roles || []).map(r => chip(`${r.ws === 'catering' ? 'Catering' : 'Restaurant'} · ${r.role}`)).join(' ')}${!p.username ? chip('not set up', 'warn') : ''}${p.username && !p.active ? chip('switched off', 'bad') : ''}</span></div></a>`).join('')}</div>
  ${sel ? `<form class="card mt" data-form="savePerson" data-email="${esc(sel.email)}"><h2>${esc(sel.full_name || sel.email)}</h2>
    <div class="grid"><label>Full name<input name="full_name" value="${esc(sel.full_name || '')}" required></label><label>Username<input name="username" value="${esc(sel.username || sel.email.split('@')[0])}" required pattern="[a-z0-9._\\-]{2,40}" title="lower-case letters, numbers, . _ -"></label></div>
    <table class="roles"><thead><tr><th></th><th>Catering</th><th>Restaurant</th></tr></thead><tbody>
    ${ROLES.map(([k, l]) => `<tr><td>${l}</td><td><input type="checkbox" name="r_catering_${k}" ${has('catering', k) ? 'checked' : ''}></td><td><input type="checkbox" name="r_restaurant_${k}" ${has('restaurant', k) ? 'checked' : ''}></td></tr>`).join('')}
    </tbody></table>
    <label class="tick"><input type="checkbox" name="is_admin" ${sel.is_admin ? 'checked' : ''}> Owner (everything, both workspaces)</label>
    <label class="tick"><input type="checkbox" name="active" ${!sel.username || sel.active ? 'checked' : ''}> Can log in</label>
    <div class="row end"><a class="btn ghost" href="#/people">Close</a><button class="pri">Save</button></div></form>` : ''}`;
};
FORMS.savePerson = async (f, el) => {
  const roles = Object.keys(f).filter(k => k.startsWith('r_')).map(k => { const [, ws, role] = k.split('_'); return { ws, role }; });
  await db.rpc('admin_set_member', { p_email: el.dataset.email, p_username: f.username, p_full_name: f.full_name, p_roles: roles, p_is_admin: !!f.is_admin, p_active: !!f.active });
  toast('Saved'); refresh();
};

/* ================= account ================= */
ACT.account = async () => {
  const pw = prompt('New password (at least 8 characters). Leave empty to cancel.');
  if (!pw) return; if (pw.length < 8) return toast('Use at least 8 characters.', true);
  await db.changePassword(pw); toast('Password changed');
};
ACT.logout = async () => { await db.signOut(); S.user = null; S.me = null; location.hash = ''; renderLogin('You have logged out.'); };
ACT.reload = () => refresh();

/* ================= events wiring ================= */
function formData(form) { const o = {}; new FormData(form).forEach((v, k) => o[k] = typeof v === 'string' ? v.trim() : v); return o; }
document.addEventListener('submit', async e => {
  const form = e.target; const name = form.dataset.form; if (!name) return;
  e.preventDefault(); if (name === 'none' || !FORMS[name]) return;
  const btns = form.querySelectorAll('button'); btns.forEach(b => b.disabled = true);
  try { await FORMS[name](formData(form), form); } catch (err) { console.error(err); toast(err.message, true); } finally { btns.forEach(b => b.disabled = false); }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault(); if (el.disabled) return; el.disabled = true;
  try { await ACT[el.dataset.act](el); } catch (err) { console.error(err); toast(err.message, true); } finally { el.disabled = false; }
});
document.addEventListener('click', e => { const j = e.target.closest('[data-jump]'); if (j) document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
document.addEventListener('input', e => {
  const t = e.target.dataset?.filter; if (!t) return; const q = e.target.value.toLowerCase();
  document.querySelectorAll(t).forEach(r => r.hidden = q && !r.textContent.toLowerCase().includes(q));
  document.querySelectorAll('[data-group]').forEach(g => g.hidden = ![...g.querySelectorAll('.li')].some(r => !r.hidden));
});

/* ================= start ================= */
(async () => {
  if (!window.ROM_SUPABASE?.url && !window.ROM_TEST_API) { $('#main').innerHTML = '<div class="card">The app is not connected yet (config.js).</div>'; return; }
  try { S.user = await db.currentUser(); if (S.user) return afterLogin(); } catch (e) { console.error(e); }
  renderLogin();
})();
