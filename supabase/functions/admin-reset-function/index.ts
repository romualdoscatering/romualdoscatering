import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_ROLES = ["admin", "owner"];
const MIN_PASSWORD_LENGTH = 8;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  // Prefer a secret you add yourself (SERVICE_KEY = your sb_secret_... key); fall back to the built-in one.
  const serviceKey = Deno.env.get("SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Not signed in" + (whoErr ? ` (${whoErr.message})` : "") }, 401);

  // Is the caller an admin? (profiles.is_admin, or memberships.role admin/owner)
  const notes: string[] = [];
  let admin = false;
  const p = await db.from("profiles").select("is_admin").eq("id", who.user.id).maybeSingle();
  if (p.error) notes.push("profiles: " + p.error.message);
  else if (p.data?.is_admin === true) admin = true;
  if (!admin) {
    const m = await db.from("memberships").select("role").eq("user_id", who.user.id);
    if (m.error) notes.push("memberships: " + m.error.message);
    else if ((m.data ?? []).some((r: any) => ADMIN_ROLES.includes(String(r.role).toLowerCase()))) admin = true;
  }
  if (!admin) {
    if (!p.error && !p.data) notes.push("no profile row found for " + who.user.email);
    return json({ error: "Admins only" + (notes.length ? " — " + notes.join("; ") : "") }, 403);
  }

  // Input
  let body: { email?: string; new_password?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const email = (body.email ?? "").trim().toLowerCase();
  const newPassword = (body.new_password ?? "").trim();
  if (!email) return json({ error: "Enter the staff email" }, 400);
  if (newPassword.length < MIN_PASSWORD_LENGTH)
    return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);

  // Find the staff account
  let targetId = "";
  for (let page = 1; page <= 10 && !targetId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ error: "Could not list accounts: " + error.message }, 500);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) targetId = hit.id;
    if (data.users.length < 200) break;
  }
  if (!targetId) return json({ error: "Staff account not found" }, 404);

  // Set the password
  const { error } = await db.auth.admin.updateUserById(targetId, { password: newPassword });
  if (error) return json({ error: error.message }, 400);
  // Stamp it in the activity log: who reset whose password, and when (never the password itself)
  await db.from("audit_log").insert({ actor: who.user.id, tbl: "auth.users", row_id: targetId, action: "PASSWORD_RESET",
    new_row: { email, reset_by: who.user.email } });
  return json({ ok: true, reset_by: who.user.email });
});
