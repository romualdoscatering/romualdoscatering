// Romualdo's staff app · data layer
// Talks to Supabase with the public (publishable) key. Every action is checked again by the
// database's own security rules, so the buttons the app shows are only a convenience.
// For local testing, window.ROM_TEST_API points the same calls at a test server instead.

const CFG = window.ROM_SUPABASE || {};
let sb = null;

// Pinned so a library update can never change the app under the team's feet.
const SUPA_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';
let signedOutCb = null;
async function supa() {
  if (!sb) {
    const { createClient } = await import(SUPA_JS);
    // carry over a login saved under the library's default name (people already signed in stay signed in)
    try { const old = `sb-${new URL(CFG.url).hostname.split('.')[0]}-auth-token`;
      if (!localStorage.getItem('rom-staff-auth') && localStorage.getItem(old)) localStorage.setItem('rom-staff-auth', localStorage.getItem(old)); } catch (e) {}
    // Staff stay signed in: the session is kept on the device and renewed in the background
    // until they tap Log out (or the owner switches the account off).
    sb = createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'rom-staff-auth' } });
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && signedOutCb) signedOutCb(); });
    // Ask the phone not to clear the app's storage (keeps the login on Android / installed apps)
    try { navigator.storage?.persist?.(); } catch (e) {}
  }
  return sb;
}
const NET_RE = /Failed to fetch|NetworkError|network|Load failed|fetch failed|AuthRetryableFetchError|No internet/i;
const isNetErr = e => !!e && (NET_RE.test(e.message || '') || NET_RE.test(e.name || '') || (e.raw && isNetErr(e.raw)) || (typeof navigator !== 'undefined' && navigator.onLine === false));
const isJwtErr = e => /JWT expired|jwt|PGRST301|invalid claim/i.test(e?.message || '') || e?.code === 'PGRST301';
// Run a request; if the access pass has just expired (phone asleep, app in background), renew it and try once more.
async function call(fn) {
  const c = await supa();
  let r = await fn(c);
  if (r?.error && isJwtErr(r.error)) { await c.auth.refreshSession().catch(() => {}); r = await fn(c); }
  return r;
}
const fail = e => { const err = new Error(friendly(e?.message || String(e))); err.raw = e; throw err; };
function friendly(m) {
  if (/Invalid login credentials/i.test(m)) return 'Wrong email/username or password.';
  if (/row-level security|permission denied|42501/i.test(m)) return 'You don\'t have permission to do that.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection — nothing was saved. Try again.';
  if (/JWT expired/i.test(m)) return 'Reconnecting… please try that again.';
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
    const c = await supa(); const { data, error } = await c.auth.getSession();
    if (data.session) return { id: data.session.user.id, email: data.session.user.email };
    // No signal right now: the saved login is still on the phone, so don't send them back to the login screen.
    if (error && isNetErr(error)) {
      try { const u = JSON.parse(localStorage.getItem('rom-staff-auth') || 'null')?.user; if (u) return { id: u.id, email: u.email, offline: true }; } catch (e) {}
    }
    return null;
  },
  onSignedOut(cb) { signedOutCb = cb; },
  // Renew the login when the app comes back to the screen (after the phone slept)
  async wake() { if (TEST) return; const c = await supa(); try { await c.auth.startAutoRefresh(); await c.auth.getSession(); } catch (e) {} },
  isNetErr,
  async changePassword(pw) {
    if (TEST) return;
    const c = await supa(); const { error } = await c.auth.updateUser({ password: pw }); if (error) fail(error);
  },
  // ---------- reading & writing ----------
  // opts: { cols, eq:{col:val}, in:{col:[..]}, gte:{}, lte:{}, neq:{}, order:[['col', asc]], limit }
  async select(table, opts = {}) {
    if (TEST) return t('select', { table, opts });
    const { data, error } = await call(c => { let q = c.from(table).select(opts.cols || '*');
      for (const [k, v] of Object.entries(opts.eq || {})) q = v === null ? q.is(k, null) : q.eq(k, v);
      for (const [k, v] of Object.entries(opts.neq || {})) q = q.neq(k, v);
      for (const [k, v] of Object.entries(opts.in || {})) q = q.in(k, v);
      for (const [k, v] of Object.entries(opts.gte || {})) q = q.gte(k, v);
      for (const [k, v] of Object.entries(opts.lte || {})) q = q.lte(k, v);
      for (const [k, asc] of (opts.order || [])) q = q.order(k, { ascending: asc !== false });
      if (opts.limit) q = q.limit(opts.limit);
      return q; });
    if (error) fail(error); return data || [];
  },
  async insert(table, rows) {
    if (TEST) return t('insert', { table, rows: [].concat(rows) });
    const { data, error } = await call(c => c.from(table).insert(rows).select()); if (error) fail(error); return data || [];
  },
  async upsert(table, rows, onConflict) {
    if (TEST) return t('upsert', { table, rows: [].concat(rows), onConflict });
    const { data, error } = await call(c => c.from(table).upsert(rows, { onConflict }).select()); if (error) fail(error); return data || [];
  },
  async update(table, patch, eq) {
    if (TEST) return t('update', { table, patch, eq });
    const { data, error } = await call(c => { let q = c.from(table).update(patch); for (const [k, v] of Object.entries(eq)) q = q.eq(k, v); return q.select(); });
    if (error) fail(error);
    if (!data || !data.length) fail('Not saved — you may not have permission, or it was changed by someone else.');
    return data;
  },
  async remove(table, eq) {
    if (TEST) return t('remove', { table, eq });
    const { error } = await call(c => { let q = c.from(table).delete(); for (const [k, v] of Object.entries(eq)) q = q.eq(k, v); return q; });
    if (error) fail(error);
  },
  async rpc(fn, args = {}) {
    if (TEST) return t('rpc', { fn, args });
    const { data, error } = await call(c => c.rpc(fn, args)); if (error) fail(error); return data;
  },
};
