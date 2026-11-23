// Romualdo's staff app · data layer
// Talks to Supabase with the public (publishable) key. Every action is checked again by the
// database's own security rules, so the buttons the app shows are only a convenience.
// For local testing, window.ROM_TEST_API points the same calls at a test server instead.

const CFG = window.ROM_SUPABASE || {};
let sb = null;

async function supa() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return sb;
}
const fail = e => { const err = new Error(friendly(e?.message || String(e))); err.raw = e; throw err; };
function friendly(m) {
  if (/Invalid login credentials/i.test(m)) return 'Wrong email/username or password.';
  if (/row-level security|permission denied|42501/i.test(m)) return 'You don\'t have permission to do that.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection — nothing was saved. Try again.';
  if (/JWT expired/i.test(m)) return 'Your session ended. Please log in again.';
  return m.replace(/^ERROR:\s*/, '');
}

// ---------------- local test mode ----------------
const TEST = window.ROM_TEST_API;
let testUser = null;
async function t(op, body) {
  let r;
  try { r = await fetch(TEST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, uid: testUser?.id || null, ...body }) }); }
  catch (e) { fail(e); }
  const j = await r.json();
  if (!r.ok) fail(j.message || 'Error');
  return j.data;
}

export const db = {
  // ---------- logins ----------
  async signIn(login, password) {
    const email = login.includes('@') ? login.trim() : `${login.trim().toLowerCase()}@staff.romualdos.ph`;
    if (TEST) { testUser = await t('login', { email }); localStorage.setItem('rom_test_user', JSON.stringify(testUser)); return testUser; }
    const c = await supa(); const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) fail(error); return { id: data.user.id, email: data.user.email };
  },
  async signOut() {
    if (TEST) { testUser = null; localStorage.removeItem('rom_test_user'); return; }
    const c = await supa(); await c.auth.signOut();
  },
  async currentUser() {
    if (TEST) { try { testUser = JSON.parse(localStorage.getItem('rom_test_user') || 'null'); } catch (e) { testUser = null; } return testUser; }
    const c = await supa(); const { data } = await c.auth.getSession();
    return data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
  },
  async changePassword(pw) {
    if (TEST) return;
    const c = await supa(); const { error } = await c.auth.updateUser({ password: pw }); if (error) fail(error);
  },
  // ---------- reading & writing ----------
  // opts: { cols, eq:{col:val}, in:{col:[..]}, gte:{}, lte:{}, neq:{}, order:[['col', asc]], limit }
  async select(table, opts = {}) {
    if (TEST) return t('select', { table, opts });
    const c = await supa(); let q = c.from(table).select(opts.cols || '*');
    for (const [k, v] of Object.entries(opts.eq || {})) q = v === null ? q.is(k, null) : q.eq(k, v);
    for (const [k, v] of Object.entries(opts.neq || {})) q = q.neq(k, v);
    for (const [k, v] of Object.entries(opts.in || {})) q = q.in(k, v);
    for (const [k, v] of Object.entries(opts.gte || {})) q = q.gte(k, v);
    for (const [k, v] of Object.entries(opts.lte || {})) q = q.lte(k, v);
    for (const [k, asc] of (opts.order || [])) q = q.order(k, { ascending: asc !== false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q; if (error) fail(error); return data || [];
  },
  async insert(table, rows) {
    if (TEST) return t('insert', { table, rows: [].concat(rows) });
    const c = await supa(); const { data, error } = await c.from(table).insert(rows).select(); if (error) fail(error); return data || [];
  },
  async upsert(table, rows, onConflict) {
    if (TEST) return t('upsert', { table, rows: [].concat(rows), onConflict });
    const c = await supa(); const { data, error } = await c.from(table).upsert(rows, { onConflict }).select(); if (error) fail(error); return data || [];
  },
  async update(table, patch, eq) {
    if (TEST) return t('update', { table, patch, eq });
    const c = await supa(); let q = c.from(table).update(patch);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { data, error } = await q.select(); if (error) fail(error);
    if (!data || !data.length) fail('Not saved — you may not have permission, or it was changed by someone else.');
    return data;
  },
  async remove(table, eq) {
    if (TEST) return t('remove', { table, eq });
    const c = await supa(); let q = c.from(table).delete();
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { error } = await q; if (error) fail(error);
  },
  async rpc(fn, args = {}) {
    if (TEST) return t('rpc', { fn, args });
    const c = await supa(); const { data, error } = await c.rpc(fn, args); if (error) fail(error); return data;
  },
};
