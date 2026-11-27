// Romualdo's · poke-push
// Sends a phone notification for a new poke (endorsement) to the people it was sent to,
// and a quieter one to the owner, managers and head chefs who keep "notify me of all pokes" on.
// Also sends My tasks reminders: a database job calls it every minute with {"event":"reminders"} and its own x-cron-key.
// Called by the staff app right after a poke is sent, and when someone marks a poke done or replies (event "done": tells the sender). Settings: Verify JWT OFF (the function checks the caller itself).
// Secrets needed (Edge Functions → Secrets): SERVICE_KEY (already there), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pos-device, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? "", priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const pushReady = !!(pub && priv);
  if (pushReady) webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "https://romualdos.ph", pub, priv);
  const noPush = () => json({ ok: false, error: "Phone notifications are not set up yet (VAPID keys missing)" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body: any = await req.json().catch(() => ({}));
  const { poke_id, event } = body;

  // My tasks reminders (from the every-minute database job)
  if (event === "reminders") {
    if (!pushReady) return noPush();
    const { data: okKey } = await db.rpc("cron_key_ok", { k: req.headers.get("x-cron-key") ?? "" });
    if (okKey !== true) return json({ error: "Not allowed" }, 403);
    const { data: due, error: dErr } = await db.rpc("tasks_due_reminders");
    if (dErr) return json({ error: dErr.message }, 500);
    if (!due?.length) return json({ ok: true, sent: 0 });
    const { data: subs } = await db.from("push_subs").select("endpoint, user_id, p256dh, auth").in("user_id", [...new Set(due.map((t: any) => t.user_id))]);
    let sent = 0;
    await Promise.all(due.flatMap((t: any) => (subs ?? []).filter((s: any) => s.user_id === t.user_id).map(async (s: any) => {
      const when = t.due_time ? " · " + String(t.due_time).slice(0, 5) : "";
      const payload = JSON.stringify({ title: `${t.priority ? "Important reminder" : "Reminder"}: ${t.title}`.slice(0, 120), body: "From My tasks" + when, tag: "task-" + t.id, url: "./#/tasks", urgent: !!t.priority });
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60, urgency: "high" }); sent++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
    })));
    return json({ ok: true, reminders: due.length, sent });
  }

  // Event assistant: drive time from the kitchen to the event, with Google's traffic for that time of day.
  // Needs the secret GOOGLE_MAPS_KEY (a server key with the Routes API enabled).
  if (event === "route") {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Not signed in" }, 401);
    const gkey = Deno.env.get("GOOGLE_MAPS_KEY") ?? "";
    if (!gkey) return json({ ok: false, error: "Google Maps is not connected yet (GOOGLE_MAPS_KEY missing)" });
    // the caller must be able to see the event (same rule as the app)
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: ev } = await asUser.from("events").select("id, event_date, serve_time, venue_lat, venue_lng").eq("id", body.event_id).maybeSingle();
    if (!ev) return json({ error: "Event not found" }, 404);
    if (ev.venue_lat == null || ev.venue_lng == null) return json({ ok: false, error: "Pin the location first" });
    const { data: cfgRows } = await db.from("app_config").select("key, value").in("key", ["origin", "setup_mins"]);
    const cfg = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.key, r.value]));
    let origin: any = null; try { origin = JSON.parse(cfg.origin || "null"); } catch (_) { origin = null; }
    if (!origin?.lat) return json({ ok: false, error: "The owner hasn't pinned the kitchen location yet" });
    const setup = Number(cfg.setup_mins || 30);
    const serve = new Date(`${ev.event_date}T${String(ev.serve_time || "12:00").slice(0, 5)}:00+08:00`).getTime();
    const soon = Date.now() + 2 * 60 * 1000;
    const drive = async (depart: number) => {
      const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gkey, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: ev.venue_lat, longitude: ev.venue_lng } } },
          travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE_OPTIMAL", departureTime: new Date(Math.max(depart, soon)).toISOString(),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.routes?.length) throw new Error(j.error?.message || "Google Maps found no route");
      return { mins: Math.ceil(parseInt(String(j.routes[0].duration), 10) / 60), km: Math.round(j.routes[0].distanceMeters / 100) / 10 };
    };
    try {
      // 1st guess: leaving 2 hours before serving; 2nd: at the send-off time that guess gives. Keep the longer of the two.
      const a = await drive(serve - 120 * 60000);
      const leave = serve - (setup + a.mins) * 60000;
      const b = await drive(leave);
      const best = b.mins >= a.mins ? b : a;
      const row = { event_id: ev.id, mins: best.mins, km: best.km, depart_for: new Date(Math.max(leave, soon)).toISOString(), source: "google", computed_at: new Date().toISOString() };
      const { error: upErr } = await db.from("event_travel").upsert(row, { onConflict: "event_id" });
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, ...row });
    } catch (e: any) { return json({ ok: false, error: String(e?.message || e) }); }
  }

  if (!pushReady) return noPush();
  // Who is calling? Only the sender of the poke may trigger its notifications.
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Not signed in" }, 401);
  if (!poke_id) return json({ error: "poke_id missing" }, 400);

  const { data: poke, error: pErr } = await db.from("pokes").select("id, from_user, body, urgent, due_at, created_at, cancelled_at").eq("id", poke_id).maybeSingle();
  if (pErr) return json({ error: pErr.message }, 500);
  if (!poke) return json({ error: "Poke not found" }, 404);
  if (poke.cancelled_at) return json({ ok: true, sent: 0 });

  // "done": the caller marked this poke done (or replied) — tell the sender
  if (event === "done") {
    const { data: mine } = await db.from("poke_to").select("done_at, reply").eq("poke_id", poke_id).eq("user_id", who.user.id).maybeSingle();
    if (!mine?.done_at || Date.now() - new Date(mine.done_at).getTime() > 10 * 60 * 1000) return json({ error: "Not done by you just now" }, 403);
    if (poke.from_user === who.user.id) return json({ ok: true, sent: 0 });
    const { data: me } = await db.from("profiles").select("full_name, nickname").eq("id", who.user.id).maybeSingle();
    const name = (me?.nickname || "").trim() || String(me?.full_name || "Someone").split(" ")[0];
    const payload = JSON.stringify({
      title: mine.reply ? `${name} replied` : `${name} did your poke`,
      body: (mine.reply ? `“${mine.reply}” — ` : "") + "re: " + poke.body.slice(0, 140),
      tag: "pokedone-" + poke.id + "-" + who.user.id, url: "./#/pokes/sent",
    });
    const { data: subs } = await db.from("push_subs").select("endpoint, p256dh, auth").eq("user_id", poke.from_user);
    let sent = 0;
    await Promise.all((subs ?? []).map(async (s: any) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12, urgency: "normal" }); sent++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }));
    return json({ ok: true, sent });
  }

  if (poke.from_user !== who.user.id) return json({ error: "Not your poke" }, 403);
  if (Date.now() - new Date(poke.created_at).getTime() > 10 * 60 * 1000) return json({ ok: true, sent: 0, note: "too old" });

  const { data: to } = await db.from("poke_to").select("user_id").eq("poke_id", poke_id);
  const recipients = new Set((to ?? []).map((r: any) => r.user_id));

  // Overseers: owner (is_admin), managers, head chefs — who keep watch_pokes on, and aren't the sender or a recipient
  const { data: people } = await db.from("profiles").select("id, full_name, nickname, is_admin, active, watch_pokes");
  const { data: mems } = await db.from("memberships").select("user_id, role");
  const byId = new Map((people ?? []).map((p: any) => [p.id, p]));
  const lead = new Set((mems ?? []).filter((m: any) => ["manager", "head_chef"].includes(m.role)).map((m: any) => m.user_id));
  const watchers = new Set((people ?? []).filter((p: any) => p.active && p.watch_pokes && (p.is_admin || lead.has(p.id))
    && p.id !== poke.from_user && !recipients.has(p.id)).map((p: any) => p.id));

  const sender = byId.get(poke.from_user);
  const fromName = (sender?.nickname || "").trim() || String(sender?.full_name || "Someone").split(" ")[0];
  const toNames = [...recipients].map((id) => { const p = byId.get(id); return (p?.nickname || "").trim() || String(p?.full_name || "").split(" ")[0]; }).join(", ");
  const due = poke.due_at ? " · by " + new Date(poke.due_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", minute: "2-digit" }) : "";

  const ids = [...recipients, ...watchers];
  if (!ids.length) return json({ ok: true, sent: 0 });
  const { data: subs } = await db.from("push_subs").select("endpoint, user_id, p256dh, auth").in("user_id", ids);

  let sent = 0, gone = 0;
  await Promise.all((subs ?? []).map(async (s: any) => {
    const mine = recipients.has(s.user_id);
    const payload = JSON.stringify({
      title: mine ? `${poke.urgent ? "Urgent: " : ""}${fromName} poked you` : `${fromName} → ${toNames}`,
      body: poke.body.slice(0, 180) + due,
      tag: "poke-" + poke.id, url: "./#/pokes", urgent: mine && poke.urgent,
    });
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12, urgency: mine ? "high" : "normal" });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) { gone++; await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }));
  return json({ ok: true, sent, removed: gone });
});
