// Romualdo's · poke-push
// Sends a phone notification for a new poke (endorsement) to the people it was sent to,
// and a quieter one to the owner, managers and head chefs who keep "notify me of all pokes" on.
// Called by the staff app right after a poke is sent. Settings: Verify JWT OFF (the function checks the caller itself).
// Secrets needed (Edge Functions → Secrets): SERVICE_KEY (already there), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pos-device",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? "", priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  if (!pub || !priv) return json({ ok: false, error: "Phone notifications are not set up yet (VAPID keys missing)" });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "https://romualdos.ph", pub, priv);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Who is calling? Only the sender of the poke may trigger its notifications.
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Not signed in" }, 401);
  const { poke_id } = await req.json().catch(() => ({}));
  if (!poke_id) return json({ error: "poke_id missing" }, 400);

  const { data: poke, error: pErr } = await db.from("pokes").select("id, from_user, body, urgent, due_at, created_at, cancelled_at").eq("id", poke_id).maybeSingle();
  if (pErr) return json({ error: pErr.message }, 500);
  if (!poke || poke.from_user !== who.user.id) return json({ error: "Not your poke" }, 403);
  if (poke.cancelled_at) return json({ ok: true, sent: 0 });
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
      title: mine ? `${poke.urgent ? "🔴 " : "👉 "}${fromName} poked you` : `${fromName} → ${toNames}`,
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
