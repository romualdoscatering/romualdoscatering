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
    db.select('dishes', { cols: 'id,name,category,course,tray_price,tray_serves,standard,times_booked,active', order: [['times_booked', false], ['name']] }),
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
const dishOptions = (course, cat) => S.dishes.filter(d => d.active && (!course || d.course === course) && (!cat || d.category === cat))
  .map(d => `<option value="${esc(d.name)}"${course === 'Main' && !cat ? ` label="${esc(d.category)}"` : ''}>`).join('');
const mainCats = () => [...new Set(S.dishes.filter(d => d.active && d.course === 'Main').map(d => d.category))].sort();
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
/* ================= router ================= */
const routes = {};
let current = '';
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!S.user) return renderLogin();
  const [page, ...rest] = hash.split('/');
  const key = page === 'c' ? 'c/' + (rest[0] || 'events') : (page || 'home');
  const arg = page === 'c' ? rest.slice(1).join('/') : rest.join('/');
  const r = routes[key] || routes.home;
  current = key;
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
  const inCat = key.startsWith('c/');
  const nav = inCat ? [['c/events', 'Events'], ['c/requests', 'Requests'], ['c/orders', 'Orders & receiving'], ['c/stock', 'Stock'], ['c/recipes', 'Recipes']] : [];
  $('#top').innerHTML = `<div class="bar"><a class="brand" href="#/">Romualdo's<small>${inCat ? 'Catering' : 'Staff'}</small></a>
    <div class="who"><span>${esc(who())}</span>${isAdmin() ? '<a href="#/people">People</a>' : ''}<button class="ghost" data-act="account">Account</button><button class="ghost" data-act="logout">Log out</button></div></div>
    ${nav.length ? `<nav>${nav.map(([k, l]) => `<a href="#/${k}" class="${navOf(key) === k ? 'on' : ''}">${l}</a>`).join('')}<a href="#/" class="sw">Switch workspace</a></nav>` : ''}`;
}
function navOf(key) {
  return { 'c/event': 'c/events', 'c/event-new': 'c/events', 'c/pr': 'c/requests', 'c/po': 'c/orders', 'c/count': 'c/stock', 'c/recipe': 'c/recipes' }[key] || key;
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
  if (member('restaurant')) cards.push(`<a class="ws-card res" href="/ops/"><b>Restaurant</b><span>Coming next. For now, keep using the current app (opens /ops)</span></a>`);
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

  <section class="card"><h2>Menu</h2>
   ${byCourse.length ? byCourse.map(([c, l]) => `<div class="course"><h3>${esc(c)}</h3>${l.map(m => `<div class="mline"><span>${esc(lineName(m))} ${lineChip(m)}${m.note ? `<span class="mut small"> · ${esc(m.note)}</span>` : ''}</span><span class="sp"></span>${m.qty ? `<b>${fq(m.qty)} ${ev.kind === 'packs' ? 'packs' : 'trays'}</b>` : ''}${canMenu ? `<button class="x" title="Remove" data-act="rmMenu" data-id="${m.id}">✕</button>` : ''}</div>`).join('')}</div>`).join('') : '<p class="mut">No dishes yet.</p>'}
   ${canMenu ? `<form data-form="addMenu" data-id="${ev.id}" class="addline">
     <select name="course">${COURSES.map(c => opt(c, c, c === (S.lastCourse || 'Main'))).join('')}</select>
     ${ev.kind === 'packs' && S.packs.length ? `<select name="pack_id">${opt('', 'Dish (type below)')}${S.packs.map(p => opt(p.id, p.name)).join('')}</select>` : ''}
     <select name="cat" aria-label="Main dish type"${(S.lastCourse || 'Main') !== 'Main' ? ' hidden' : ''}>${opt('', 'All mains')}${mainCats().map(c => opt(c, c, c === S.lastCat)).join('')}</select>
     <input name="dish" list="dl-dishes" placeholder="Type or pick a dish" autocomplete="off">
     ${ev.kind !== 'buffet' ? `<input name="qty" type="number" step="any" min="0" placeholder="${ev.kind === 'packs' ? 'packs' : 'trays'}" class="qty">` : ''}
     <button class="pri">Add</button></form><datalist id="dl-dishes">${dishOptions(S.lastCourse || 'Main', (S.lastCourse || 'Main') === 'Main' ? S.lastCat || '' : '')}</datalist>
     <p class="small mut">The list shows only dishes for the course you pick (for Main, pick the meat to shorten it further). You can still type any dish. Names are matched to the standard dish list ("beef steak" → Bistek Tagalog). Several dishes typed together are split. Anything unknown is kept as an off-menu dish for the chef.${ev.kind === 'buffet' ? ' Buffet quantities come from the guest count.' : ''}</p>` : ''}
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
  const tab = arg || (can('catering', 'manager') ? 'approve' : 'open');
  const tabs = [['approve', 'To approve'], ['open', 'In progress'], ['draft', 'Drafts'], ['all', 'All']];
  const st = { approve: ['submitted'], open: ['submitted', 'approved', 'ordered'], draft: ['draft'] }[tab];
  const rows = await db.select('pr_overview', { eq: { ws: 'catering' }, ...(st ? { in: { status: st } } : {}), order: [['created_at', false]], limit: 200 });
  return `<div class="row"><h1>Purchase requests</h1><span class="sp"></span><button class="pri" data-act="newPR">＋ New request</button></div>
   <div class="seg">${tabs.map(([k, l]) => `<a href="#/c/requests/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${rows.length ? `<div class="list">${rows.map(p => `<a class="li" href="#/c/pr/${p.id}"><div class="li-main"><b>${esc(p.pr_no)}${p.priority === 'urgent' ? ' ' + chip('urgent', 'bad') : ''}</b>
     <span class="mut small">${p.event_title ? esc(p.event_ref + ' · ' + p.event_title) + ' · ' : ''}${esc(p.purpose || '')}</span>
     <span class="mut small">${p.line_count} items · est. ${peso(p.est_total)} · ${esc(p.requested_by_name || '')}${p.needed_by ? ' · needed ' + esc(fmtD(p.needed_by)) : ''}</span></div>${chip(PR_STATUS[p.status], statusTone(p.status))}</a>`).join('')}</div>` : '<div class="empty">No requests here.</div>'}`;
};
ACT.newPR = async () => { const r = (await db.insert('purchase_requests', { ws: 'catering', purpose: 'Catering store restock', requested_by: S.user.id }))[0]; go('#/c/pr/' + r.id); };

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
  return `<div class="row"><a href="#/c/requests" class="back">‹ Requests</a></div>
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
  ${orders.length ? `<section class="card"><h2>Orders</h2><div class="list">${orders.map(o => `<a class="li" href="#/c/po/${o.id}"><div class="li-main"><b>${esc(o.po_no)}</b><span class="mut small">${esc(o.supplier || '')} · ${o.line_count} items · by ${esc(o.buyer_name || '')}</span></div>${chip(PO_STATUS[o.status], statusTone(o.status))}</a>`).join('')}</div></section>` : ''}`;
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
  const rows = await db.select('po_overview', { eq: { ws: 'catering' }, ...(st ? { in: { status: st } } : {}), order: [['ordered_at', false]], limit: 200 });
  return `<h1>Orders & receiving</h1><div class="seg">${tabs.map(([k, l]) => `<a href="#/c/orders/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
   ${rows.length ? `<div class="list">${rows.map(o => `<a class="li" href="#/c/po/${o.id}"><div class="li-main"><b>${esc(o.po_no)}</b><span class="mut small">${esc(o.supplier || '')} · ${esc(o.pr_no || '')}${o.event_title ? ' · ' + esc(o.event_title) : ''}</span><span class="mut small">${o.line_count} items · bought by ${esc(o.buyer_name || '')} · ${esc(fmtT(o.ordered_at))}${num(o.received_value) ? ' · received ' + peso(o.received_value) : ''}</span></div>${chip(PO_STATUS[o.status], statusTone(o.status))}</a>`).join('')}</div>` : '<div class="empty">Nothing here.</div>'}`;
};
routes['c/po'] = async id => {
  const [o] = await db.select('po_overview', { eq: { id } }); if (!o) return '<div class="card">Order not found.</div>';
  const [lines, receipts] = await Promise.all([db.select('po_line_progress', { eq: { po_id: id } }), db.select('receipts', { eq: { po_id: id }, order: [['received_at', false]] })]);
  const canRecv = ['open', 'partly_received'].includes(o.status) && can(o.ws, 'storekeeper', 'manager', 'chef');
  const people = receipts.length ? Object.fromEntries((await db.select('profiles', { cols: 'id,full_name', in: { id: [...new Set(receipts.map(r => r.received_by))] } })).map(p => [p.id, p.full_name])) : {};
  return `<div class="row"><a href="#/c/orders" class="back">‹ Orders</a></div>
  <div class="row"><h1>${esc(o.po_no)}</h1>${chip(PO_STATUS[o.status], statusTone(o.status))}</div>
  <p class="lede">${esc(o.supplier || '')} · from <a href="#/c/pr/${o.pr_id}">${esc(o.pr_no)}</a>${o.event_id ? ` · <a href="#/c/event/${o.event_id}">${esc(o.event_title)}</a>` : ''} · bought by ${esc(o.buyer_name || '')}</p>
  <form class="card" data-form="${canRecv ? 'receive' : 'none'}" data-id="${id}"><h2>${canRecv ? 'Receive' : 'Items'}</h2>
   ${canRecv ? `<p class="small mut">Weigh or count what actually arrived. Only what you enter goes into the catering store.${o.buyer === S.user.id ? ' <b class="warn-t">You are the buyer on this order — it will be flagged if you receive it yourself.</b>' : ''}</p>` : ''}
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
  toast(num(r.short_value) > 0 ? `Received — short by ${peso(r.short_value)}` : 'Received into the catering store', num(r.short_value) > 0);
  await loadMaster(); refresh();
};

/* ================= STOCK & COUNTS ================= */
routes['c/stock'] = async () => {
  const [stock, counts] = await Promise.all([db.select('stock_on_hand', { eq: { ws: 'catering' }, order: [['category'], ['name']] }), db.select('stock_counts', { eq: { ws: 'catering' }, order: [['counted_at', false]], limit: 15 })]);
  const val = stock.reduce((s, x) => s + Math.max(num(x.value), 0), 0);
  return `<div class="row"><h1>Catering store</h1><span class="sp"></span>${can('catering', 'storekeeper', 'manager', 'chef') ? '<button class="pri" data-act="startCount">Start a count</button>' : ''}</div>
   <div class="kpis"><div class="kpi"><span>Items in stock</span><b>${stock.filter(s => num(s.on_hand) > 0).length}</b></div><div class="kpi"><span>Stock value (last prices)</span><b>${peso(val)}</b></div></div>
   <input class="search" placeholder="Search…" data-filter="#stockTable tbody tr">
   ${stock.length ? `<div class="card tw"><table id="stockTable"><thead><tr><th>Item</th><th class="n">On hand</th><th class="n">Value</th></tr></thead><tbody>
     ${stock.map(s => `<tr><td>${esc(s.name)}<div class="small mut">${esc(s.category)}</div></td><td class="n ${num(s.on_hand) < 0 ? 'bad-t' : ''}">${fq(s.on_hand)} ${esc(s.stock_unit)}</td><td class="n">${peso(s.value)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">The catering store is empty. Receive an order or do an opening count.</div>'}
   ${counts.length ? `<h2>Counts</h2><div class="list">${counts.map(c => `<a class="li" href="#/c/count/${c.id}"><div class="li-main"><b>${esc(fmtT(c.counted_at))}</b><span class="mut small">${c.status === 'posted' ? `missing ${peso(Math.abs(num(c.loss_value)))} · excess ${peso(c.gain_value)}` : 'not posted yet'}</span></div>${chip(c.status === 'posted' ? 'Posted' : 'Open', c.status === 'posted' ? (num(c.loss_value) < -1 ? 'bad' : 'ok') : 'warn')}</a>`).join('')}</div>` : ''}`;
};
ACT.startCount = async () => { const c = (await db.insert('stock_counts', { ws: 'catering', counted_by: S.user.id }))[0]; go('#/c/count/' + c.id); };
routes['c/count'] = async id => {
  const [c] = await db.select('stock_counts', { eq: { id } }); if (!c) return '<div class="card">Count not found.</div>';
  const lines = await db.select('stock_count_lines', { eq: { count_id: id } }); const got = Object.fromEntries(lines.map(l => [l.item_id, l]));
  if (c.status === 'posted') {
    const diff = lines.map(l => ({ ...l, d: num(l.counted) - num(l.expected) })).filter(l => Math.abs(l.d) > 0.0005).sort((a, b) => a.d * num(S.itemsById[a.item_id]?.last_cost) - b.d * num(S.itemsById[b.item_id]?.last_cost));
    return `<div class="row"><a href="#/c/stock" class="back">‹ Stock</a></div><h1>Count · ${esc(fmtT(c.counted_at))}</h1>
     <div class="kpis"><div class="kpi bad"><span>Missing</span><b>${peso(Math.abs(num(c.loss_value)))}</b></div><div class="kpi"><span>Excess</span><b>${peso(c.gain_value)}</b></div><div class="kpi"><span>Items counted</span><b>${lines.length}</b></div></div>
     ${diff.length ? `<div class="card tw"><table><thead><tr><th>Item</th><th class="n">Expected</th><th class="n">Counted</th><th class="n">Difference</th></tr></thead><tbody>${diff.map(l => `<tr><td>${esc(itemName(l.item_id))}</td><td class="n">${fq(l.expected)}</td><td class="n">${fq(l.counted)}</td><td class="n ${l.d < 0 ? 'bad-t' : 'ok-t'}">${l.d > 0 ? '+' : ''}${fq(l.d)} ${esc(itemUnit(l.item_id))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="alert ok">Everything matched.</div>'}
     <p class="small mut">Missing stock left the store without an issue or waste record. Recount big differences and ask who had access.</p>`;
  }
  const cats = [...new Set(S.items.map(i => i.category))];
  return `<div class="row"><a href="#/c/stock" class="back">‹ Stock</a></div><h1>Count the catering store</h1>
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
  const costTag = d => { const r = recipes[d.id]; if (!r || !costOf[d.id]) return ''; const c = costOf[d.id], pct = d.tray_price && num(r.batch_serves) === 12 ? Math.round(c / num(d.tray_price) * 100) : null;
    return ` · cost ${peso(c)}${pct !== null ? ` · <span class="${pct > 45 ? 'bad-t' : pct > 35 ? 'warn-t' : 'ok-t'}">${pct}%</span>` : ''}`; };
  const tabs = [['standard', 'Standard list'], ['draft', 'Draft recipes'], ['verified', 'Verified'], ['none', 'No recipe'], ['all', 'All dishes']];
  const list = S.dishes.filter(d => tab === 'all' || (tab === 'standard' ? d.standard : tab === 'none' ? !recipes[d.id] && d.standard : recipes[d.id]?.status === tab));
  return `<h1>Dishes & recipes</h1><p class="lede">A dish's recipe lists what to buy for one batch: one large tray (12 guests), or one guest for rice, drinks and fruit. Only <b>verified</b> recipes are used for purchase requests.</p>
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
  ${!r ? (edit ? `<form class="card" data-form="startRecipe" data-id="${id}"><p>No recipe yet.</p><label>One batch is for<select name="serves">${opt('12', 'one large tray (12 guests)')}${opt('1', 'one guest (rice, drinks, fruit)')}</select></label><div class="row end"><button class="pri">Start recipe</button></div></form>` : '<div class="card">No recipe yet. A chef can add it.</div>') : `
  <form class="card" data-form="${edit ? 'saveRecipe' : 'none'}" data-id="${id}">
   <div class="row"><h2>Ingredients for ${num(r.batch_serves) === 1 ? 'one guest' : `one batch (${fq(r.batch_serves)} guests)`}</h2></div>
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
   </tbody><tfoot><tr><td colspan="4" id="recipeTotal" data-tray="${d.tray_price && num(r.batch_serves) === 12 ? num(d.tray_price) : 0}" data-serves="${num(r.batch_serves)}">${recipeTotalText(cost, d.tray_price && num(r.batch_serves) === 12 ? num(d.tray_price) : 0, num(r.batch_serves))}</td></tr></tfoot></table></div>
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
