import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { DEFAULT_AI_MODEL, openAIResponseText, providerForAIModel } from "./src/lib/ai-models";

if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = ws;
}
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
if (!supabaseUrl || !supabaseAnonKey) console.warn("Supabase server configuration is missing.");
const supabase = createClient(supabaseUrl || "http://127.0.0.1:54321", supabaseAnonKey || "missing", { auth: { persistSession: false } });
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAdmin = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const camel = (key: string) => key.replace(/_([a-z])/g, (_, value) => value.toUpperCase());
const camelRow = (value: any): any => Array.isArray(value) ? value.map(camelRow) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [camel(key), camelRow(item)])) : value;
const rateWindows = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const now = Date.now(); const key = `${req.ip}:${req.path}:${req.body?.restaurantId || ""}`; const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) rateWindows.set(key, { count: 1, resetAt: now + 60_000 });
  else if (++current.count > 15) return res.status(429).json({ error: "too_many_requests" });
  if (rateWindows.size > 5000) for (const [entry, value] of rateWindows) if (value.resetAt <= now) rateWindows.delete(entry);
  next();
}
async function resolveRestaurantId(identifier: string) {
  const { data } = await supabase.rpc("resolve_restaurant_id", { p_identifier: identifier });
  return data || identifier;
}

function parseCustomerLocation(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const { latitude, longitude, accuracy } = value as Record<string, unknown>;
  if (typeof latitude !== "number" || typeof longitude !== "number" || typeof accuracy !== "number"
    || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || accuracy <= 0 || accuracy > 150) return null;
  return { latitude, longitude, accuracy };
}

const app = express();
app.use(express.json({ limit: "256kb" }));

  app.get("/api/home-screen-manifest", (req, res) => {
    const restaurantId = String(req.query.restaurantId || "");
    const portal = String(req.query.portal || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(restaurantId)
      || !["menu", "restaurant", "waiter", "kitchen"].includes(portal))
      return res.status(400).json({ error: "invalid_home_screen_portal" });
    const name = { menu: "NovX Menu", restaurant: "NovX Restaurant", waiter: "NovX Waiter", kitchen: "NovX Kitchen" }[portal];
    const startUrl = portal === "menu"
      ? `/?restaurantId=${encodeURIComponent(restaurantId)}`
      : `/?loginRestaurantId=${encodeURIComponent(restaurantId)}&portal=${portal}`;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    return res.json({ name, short_name: name, id: `/home/${portal}/${restaurantId}`,
      start_url: startUrl, scope: "/", display: "standalone",
      background_color: "#000000", theme_color: "#000000",
      icons: [{ src: "/novx-1.png", sizes: "512x512", type: "image/png" }] });
  });

  app.get("/api/restaurants/:restaurantId/access", async (req, res) => {
    const restaurantId = await resolveRestaurantId(req.params.restaurantId);
    const { data, error } = await supabase.rpc("public_restaurant_menu", { p_restaurant_id: restaurantId });
    if (error) return res.status(error.message.includes("subscription_inactive") ? 403 : 404).json({ allowed: false, reason: error.message });
    return res.json({ allowed: true, serverTime: Date.now(), geofenceRadiusMeters: data.restaurant.geofence_radius_meters });
  });
  app.get("/api/public/restaurants/:restaurantId", async (req, res) => {
    const restaurantId = await resolveRestaurantId(req.params.restaurantId);
    const rpc = req.query.branding === "1" ? "public_restaurant_branding" : "public_restaurant_menu";
    const { data, error } = await supabase.rpc(rpc, { p_restaurant_id: restaurantId });
    if (error || !data) return res.status(error?.message.includes("subscription_inactive") ? 403 : 404).json({ error: error?.message || "not_found" });
    return res.json(req.query.branding === "1" ? { restaurant: camelRow(data) } : camelRow(data));
  });
  app.post("/api/public/restaurants/:restaurantId/customer-status", rateLimit, async (req, res) => {
    const restaurantId = await resolveRestaurantId(req.params.restaurantId);
    const { data, error } = await supabase.rpc("customer_device_status", { p_restaurant_id: restaurantId, p_fingerprint: String(req.body?.fingerprint || "").slice(0, 128) });
    if (error) return res.status(400).json({ error: error.message }); return res.json(data);
  });
  app.post("/api/security-alerts", rateLimit, async (req, res) => {
    const body = req.body || {};
    const restaurantId = await resolveRestaurantId(body.restaurantId);
    const { error } = await supabase.rpc("create_security_alert", { p_restaurant_id: restaurantId, p_type: body.type, p_title: body.title, p_severity: body.severity, p_customer_name: body.customerName, p_table_number: body.tableNumber, p_fingerprint: body.fingerprint, p_distance: body.distanceMeters });
    if (error) return res.status(400).json({ error: error.message }); return res.status(204).end();
  });
  app.post("/api/auth/login", rateLimit, async (req, res) => {
    if (!supabaseUrl || !supabaseAnonKey) return res.status(503).json({ error: "server_config_missing" });
    const username = String(req.body?.username || "").trim().toLowerCase();
    const email = username.includes("@") ? username : `${username.replace(/[^a-z0-9._-]/g, "")}@accounts.novx.invalid`;
    const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let authResult;
    try {
      authResult = await authClient.auth.signInWithPassword({ email, password: String(req.body?.password || "") });
    } catch (error) {
      console.error("Supabase sign-in service unavailable:", error);
      return res.status(503).json({ error: "auth_service_unavailable" });
    }
    const { data, error } = authResult;
    if (error || !data.session) return res.status(401).json({ error: "invalid_credentials" });
    const metadata = data.user.app_metadata || {};
    const requestedRole = req.body?.role;
    if (requestedRole === "admin") {
      if (metadata.system_role !== "admin") return res.status(403).json({ error: "role_mismatch" });
      return res.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, session: { role: "admin", id: data.user.id, name: data.user.user_metadata?.name || username } });
    }
    const requestedRestaurantId = await resolveRestaurantId(String(req.body?.restaurantId || ""));
    const { data: membership } = await authClient.from("restaurant_members").select("role,restaurant_id").eq("user_id", data.user.id).eq("restaurant_id", requestedRestaurantId).eq("active", true).maybeSingle();
    const role = membership?.role === "owner" || membership?.role === "manager" ? "restaurant" : membership?.role;
    const restaurantId = membership?.restaurant_id;
    if (!membership || role !== requestedRole) return res.status(403).json({ error: "role_mismatch" });
    return res.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, session: { role, id: data.user.id, restaurantId, name: data.user.user_metadata?.name || username } });
  });
  app.get("/api/auth/session", async (req, res) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    if (!bearer) return res.status(401).end();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity } = await userClient.auth.getUser(bearer);
    if (!identity.user) return res.status(401).end();
    if (identity.user.app_metadata?.system_role === "admin") return res.json({ role: "admin", id: identity.user.id, name: identity.user.user_metadata?.name || "admin" });
    const preferredRestaurant = identity.user.app_metadata?.restaurant_id;
    let membershipQuery = userClient.from("restaurant_members").select("role,restaurant_id").eq("user_id", identity.user.id).eq("active", true);
    if (preferredRestaurant) membershipQuery = membershipQuery.eq("restaurant_id", preferredRestaurant);
    const { data: memberships } = await membershipQuery.limit(1);
    const membership = memberships?.[0]; if (!membership) return res.status(403).end();
    const role = membership.role === "owner" || membership.role === "manager" ? "restaurant" : membership.role;
    return res.json({ role, id: identity.user.id, restaurantId: membership.restaurant_id, name: identity.user.user_metadata?.name || "user" });
  });
  app.post("/api/staff", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const { data: identity } = await supabaseAdmin.auth.getUser(bearer || "");
    if (!identity.user) return res.status(401).json({ error: "authentication_required" });
    const body = req.body || {}; const restaurantId = String(body.restaurantId || "");
    const role = body.role === "kitchen" ? "kitchen" : body.role === "waiter" ? "waiter" : null;
    const username = String(body.username || "").trim();
    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const password = String(body.password || "");
    const passwordIsStrong = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
    if (!role) return res.status(400).json({ error: "invalid_staff_role" });
    if (!normalizedUsername || normalizedUsername !== username.toLowerCase()) return res.status(400).json({ error: "invalid_username" });
    if ((!body.id || password) && !passwordIsStrong) return res.status(400).json({ error: "password_too_weak" });
    const { data: membership } = await supabaseAdmin.from("restaurant_members").select("role").eq("restaurant_id", restaurantId).eq("user_id", identity.user.id).eq("active", true).maybeSingle();
    if (!membership || !["owner", "manager"].includes(membership.role)) return res.status(403).json({ error: "owner_required" });
    const { data: restaurant } = await supabaseAdmin.from("restaurants").select("status,start_date,end_date,grace_period_days").eq("id", restaurantId).single();
    const now = Date.now(); const starts = Date.parse(restaurant?.start_date || ""); const graceEnd = Date.parse(restaurant?.end_date || "") + Number(restaurant?.grace_period_days || 0) * 86_400_000;
    if (!restaurant || restaurant.status !== "active" || now < starts || now >= graceEnd) return res.status(403).json({ error: "subscription_inactive" });
    const email = `${normalizedUsername}@accounts.novx.invalid`;
    if (body.id) {
      const { data: staff } = await supabaseAdmin.from("staff").select("auth_user_id,username,name,phone").eq("id", body.id).eq("restaurant_id", restaurantId).single();
      if (!staff) return res.status(404).end();
      if (!staff.auth_user_id) return res.status(409).json({ error: "staff_auth_account_missing" });
      const authUpdate = await supabaseAdmin.auth.admin.updateUserById(staff.auth_user_id, {
        email,
        email_confirm: true,
        user_metadata: { name: body.name },
        app_metadata: { role, restaurant_id: restaurantId },
        ...(password ? { password } : {}),
      });
      if (authUpdate.error) return res.status(400).json({ error: "staff_auth_update_failed", details: authUpdate.error.message });
      const { error } = await supabaseAdmin.from("staff").update({ name: body.name, phone: body.phone, username, role }).eq("id", body.id).eq("restaurant_id", restaurantId);
      if (error) return res.status(400).json({ error: error.message }); return res.status(204).end();
    }
    const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: body.name }, app_metadata: { role, restaurant_id: restaurantId } });
    if (authError || !created.user) return res.status(400).json({ error: authError?.message });
    const staffInsert = await supabaseAdmin.from("staff").insert({ restaurant_id: restaurantId, auth_user_id: created.user.id, role, name: body.name, phone: body.phone, username }).select().single();
    if (staffInsert.error) { await supabaseAdmin.auth.admin.deleteUser(created.user.id); return res.status(400).json({ error: staffInsert.error.message }); }
    const membershipInsert = await supabaseAdmin.from("restaurant_members").insert({ restaurant_id: restaurantId, user_id: created.user.id, role });
    if (membershipInsert.error) {
      await supabaseAdmin.from("staff").delete().eq("id", staffInsert.data.id).eq("restaurant_id", restaurantId);
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return res.status(400).json({ error: "staff_membership_failed", details: membershipInsert.error.message });
    }
    return res.status(201).json(camelRow(staffInsert.data));
  });
  app.patch("/api/staff/:staffId/status", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const { data: identity } = await supabaseAdmin.auth.getUser(bearer || "");
    if (!identity.user) return res.status(401).json({ error: "authentication_required" });
    const restaurantId = String(req.body?.restaurantId || "");
    const status = req.body?.status === "active" ? "active" : req.body?.status === "suspended" ? "suspended" : null;
    if (!status) return res.status(400).json({ error: "invalid_status" });
    const owner = await supabaseAdmin.from("restaurant_members").select("role").eq("restaurant_id", restaurantId).eq("user_id", identity.user.id).eq("active", true).maybeSingle();
    if (!owner.data || !["owner", "manager"].includes(owner.data.role)) return res.status(403).json({ error: "owner_required" });
    const staff = await supabaseAdmin.from("staff").select("auth_user_id").eq("id", req.params.staffId).eq("restaurant_id", restaurantId).single();
    if (staff.error || !staff.data) return res.status(404).json({ error: "staff_not_found" });
    const staffUpdate = await supabaseAdmin.from("staff").update({ status }).eq("id", req.params.staffId).eq("restaurant_id", restaurantId);
    if (staffUpdate.error) return res.status(400).json({ error: staffUpdate.error.message });
    const membershipUpdate = await supabaseAdmin.from("restaurant_members").update({ active: status === "active" }).eq("restaurant_id", restaurantId).eq("user_id", staff.data.auth_user_id);
    if (membershipUpdate.error) return res.status(400).json({ error: membershipUpdate.error.message });
    return res.status(204).end();
  });
  app.delete("/api/staff/:staffId", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const { data: identity } = await supabaseAdmin.auth.getUser(bearer || "");
    if (!identity.user) return res.status(401).json({ error: "authentication_required" });
    const restaurantId = String(req.query.restaurantId || "");
    const owner = await supabaseAdmin.from("restaurant_members").select("role").eq("restaurant_id", restaurantId).eq("user_id", identity.user.id).eq("active", true).maybeSingle();
    if (!owner.data || !["owner", "manager"].includes(owner.data.role)) return res.status(403).json({ error: "owner_required" });
    const staff = await supabaseAdmin.from("staff").select("auth_user_id").eq("id", req.params.staffId).eq("restaurant_id", restaurantId).single();
    if (staff.error || !staff.data) return res.status(404).json({ error: "staff_not_found" });
    const membershipDelete = await supabaseAdmin.from("restaurant_members").delete().eq("restaurant_id", restaurantId).eq("user_id", staff.data.auth_user_id);
    if (membershipDelete.error) return res.status(400).json({ error: membershipDelete.error.message });
    const staffDelete = await supabaseAdmin.from("staff").delete().eq("id", req.params.staffId).eq("restaurant_id", restaurantId);
    if (staffDelete.error) return res.status(400).json({ error: staffDelete.error.message });
    if (staff.data.auth_user_id) await supabaseAdmin.auth.admin.deleteUser(staff.data.auth_user_id);
    return res.status(204).end();
  });
  app.post("/api/admin/restaurants", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, ""); const { data: identity } = await supabaseAdmin.auth.getUser(bearer || "");
    if (identity.user?.app_metadata?.system_role !== "admin") return res.status(403).json({ error: "admin_required" });
    const body = req.body || {}; const password = String(body.password || "");
    const passwordIsStrong = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
    if ((!body.id || password) && !passwordIsStrong) return res.status(400).json({ error: "password_too_weak" });
    const row = { manager_name: body.managerName, manager_phone: body.managerPhone, restaurant_name: body.restaurantName, username: body.username, province: body.province, area: body.area, landmark: body.landmark, subscription_type: body.subscriptionType, subscription_duration: body.subscriptionDuration, start_date: body.startDate, end_date: body.endDate, monthly_cost: body.monthlyCost, total_cost: body.totalCost, logo_url: body.logoUrl, status: body.status || "active" };
    if (body.id) {
      if (password) {
        const owner = await supabaseAdmin.from("restaurant_members").select("user_id").eq("restaurant_id", body.id).eq("role", "owner").single();
        if (owner.error || !owner.data) return res.status(404).json({ error: "restaurant_owner_not_found" });
        const passwordUpdate = await supabaseAdmin.auth.admin.updateUserById(owner.data.user_id, { password });
        if (passwordUpdate.error) return res.status(400).json({ error: "password_rejected", details: passwordUpdate.error.message });
      }
      const { error } = await supabaseAdmin.from("restaurants").update(row).eq("id", body.id); if (error) return res.status(400).json({ error: error.message });
      return res.status(204).end();
    }
    const email = `${String(body.username).toLowerCase().replace(/[^a-z0-9._-]/g, "")}@accounts.novx.invalid`;
    const authResult = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: body.restaurantName }, app_metadata: { role: "restaurant" } });
    if (authResult.error || !authResult.data.user) return res.status(400).json({ error: "password_or_account_rejected", details: authResult.error?.message });
    const restaurant = await supabaseAdmin.from("restaurants").insert(row).select().single();
    if (restaurant.error) { await supabaseAdmin.auth.admin.deleteUser(authResult.data.user.id); return res.status(400).json({ error: restaurant.error.message }); }
    const membership = await supabaseAdmin.from("restaurant_members").insert({ restaurant_id: restaurant.data.id, user_id: authResult.data.user.id, role: "owner" });
    if (membership.error) {
      await supabaseAdmin.from("restaurants").delete().eq("id", restaurant.data.id).eq("username", row.username);
      await supabaseAdmin.auth.admin.deleteUser(authResult.data.user.id);
      return res.status(400).json({ error: "owner_membership_failed", details: membership.error.message });
    }
    const ownerMetadata = await supabaseAdmin.auth.admin.updateUserById(authResult.data.user.id, { app_metadata: { role: "restaurant", restaurant_id: restaurant.data.id } });
    if (ownerMetadata.error) {
      await supabaseAdmin.from("restaurants").delete().eq("id", restaurant.data.id).eq("username", row.username);
      await supabaseAdmin.auth.admin.deleteUser(authResult.data.user.id);
      return res.status(400).json({ error: "owner_account_setup_failed", details: ownerMetadata.error.message });
    }
    return res.status(201).json(camelRow(restaurant.data));
  });
  app.post("/api/waiter-requests", rateLimit, async (req, res) => {
    const body = req.body || {}; const location = parseCustomerLocation(body.location);
    if (!location) return res.status(400).json({ error: "invalid_location" });
    const customerName = String(body.customerName || "").trim();
    const tableNumber = String(body.tableNumber || "").trim();
    const reason = String(body.reason || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "");
    if (!body.restaurantId || !customerName || !tableNumber || !reason || idempotencyKey.length < 20 || idempotencyKey.length > 200)
      return res.status(400).json({ error: "invalid_request" });
    const restaurantId = await resolveRestaurantId(String(body.restaurantId));
    const { data, error } = await supabase.rpc("create_waiter_request", { p_restaurant_id: restaurantId, p_customer_name: customerName, p_table_number: tableNumber, p_reason: reason, p_lat: location.latitude, p_lon: location.longitude, p_accuracy: location.accuracy, p_idempotency_key: idempotencyKey });
    if (error) return res.status(error.message.includes("subscription") || error.message.includes("location") ? 403 : 400).json({ error: error.message });
    return res.status(201).json({ id: data, notification: "queued" });
  });
  app.post("/api/orders", rateLimit, async (req, res) => {
    const body = req.body || {}; const location = parseCustomerLocation(body.location);
    if (!location) return res.status(400).json({ error: "invalid_location" });
    const trackingToken = String(body.trackingToken || "");
    if (trackingToken.length < 20 || trackingToken.length > 200) return res.status(400).json({ error: "invalid_tracking_token" });
    const customerName = String(body.customerName || "").trim();
    const tableNumber = String(body.tableNumber || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "");
    if (!body.restaurantId || !customerName || !tableNumber || idempotencyKey.length < 20 || idempotencyKey.length > 200
      || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100
      || body.items.some((item: any) => !item || typeof item.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(item.id)
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99))
      return res.status(400).json({ error: "invalid_order" });
    const items = body.items.map((item: any) => ({ id: item.id, quantity: item.quantity, cheeseSelected: item.cheeseSelected === true, spicySelected: item.spicySelected === true }));
    const restaurantId = await resolveRestaurantId(String(body.restaurantId));
    const { data, error } = await supabase.rpc("create_customer_order", { p_restaurant_id: restaurantId, p_customer_name: customerName, p_table_number: tableNumber, p_notes: String(body.notes || ""), p_items: items, p_lat: location.latitude, p_lon: location.longitude, p_accuracy: location.accuracy, p_fingerprint: String(body.fingerprint || ""), p_idempotency_key: idempotencyKey, p_tracking_token: trackingToken });
    if (error) return res.status(error.message.includes("subscription") || error.message.includes("location") ? 403 : 400).json({ error: error.message });
    return res.status(201).json(camelRow(data));
  });
  app.get("/api/orders/:orderId/status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    const { data, error } = await supabase.rpc("track_order", { p_order_id: req.params.orderId, p_tracking_token: String(req.query.token || "") });
    if (error || !data) return res.status(403).json({ error: "invalid_tracking_token" }); return res.json(camelRow(data));
  });
  app.post("/api/push-subscriptions", async (req, res) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, ""); if (!bearer) return res.status(401).end();
    if (!supabaseUrl || !supabaseAnonKey) return res.status(503).json({ error: "server_config_missing" });
    const restaurantId = String(req.body?.restaurantId || "");
    const subscription = req.body?.subscription;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(restaurantId)
      || typeof subscription?.endpoint !== "string" || subscription.endpoint.length > 2048
      || !subscription.endpoint.startsWith("https://")
      || typeof subscription?.keys?.auth !== "string" || typeof subscription?.keys?.p256dh !== "string")
      return res.status(400).json({ error: "invalid_push_subscription" });
    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } });
    const { data: identity } = await userClient.auth.getUser(bearer); if (!identity.user) return res.status(401).end();
    const { data: member } = await userClient.from("restaurant_members").select("role").eq("restaurant_id", restaurantId).eq("user_id", identity.user.id).eq("active", true).maybeSingle();
    if (!member || !["owner", "manager", "waiter", "kitchen"].includes(member.role)) return res.status(403).json({ error: "not_authorized_for_restaurant" });
    const { error } = await userClient.from("push_subscriptions").upsert({ restaurant_id: restaurantId, user_id: identity.user.id, endpoint: subscription.endpoint, subscription }, { onConflict: "endpoint" });
    if (error) return res.status(403).json({ error: error.code === "23505" ? "subscription_conflict" : "notification_registration_failed" }); return res.status(204).end();
  });
  app.post("/api/chat", rateLimit, async (req, res) => {
    try {
      const { message, restaurantId, history } = req.body;
      const language = req.body?.language === "en" ? "en" : "ar";
      if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "invalid_message" });
      const access = await supabase.rpc("public_restaurant_menu", { p_restaurant_id: restaurantId });
      if (access.error) return res.status(403).json({ error: "subscription_inactive" });
      if (!supabaseAdmin) return res.status(503).json({ reply: language === "en" ? "The AI settings service is not configured." : "خدمة إعدادات المساعد غير مهيأة." });
      const { data: aiSettings, error: settingsError } = await supabaseAdmin.from("app_settings").select("model,prompt,temperature").eq("key", "ai").maybeSingle();
      if (settingsError) throw settingsError;
      const model = aiSettings?.model || DEFAULT_AI_MODEL;
      const provider = providerForAIModel(model);
      if (!provider) return res.status(503).json({ reply: language === "en" ? "The selected AI model is not supported. Ask the administrator to choose another model." : "النموذج المختار غير مدعوم. يرجى اختيار نموذج آخر من لوحة الإدارة." });
      if ((provider === "gemini" && !ai) || (provider === "openai" && !process.env.OPENAI_API_KEY))
        return res.status(503).json({ reply: language === "en" ? `${provider === "openai" ? "OpenAI" : "Gemini"} is not configured on the server yet.` : `مفتاح ${provider === "openai" ? "OpenAI" : "Gemini"} غير مهيأ على الخادم بعد.` });
      const menuItems = access.data?.menu_items || [];
      const restaurantName = access.data?.restaurant?.restaurant_name || "المطعم";
      const menu = Array.isArray(menuItems) ? menuItems.map((item: any) => `• ${item.name} | ${item.price} د.ع | ${item.ingredients || ""}`).join("\n") : "";
      const system = `${aiSettings?.prompt || `أنت مساعد مطعم عراقي محترم ومختصر لمطعم ${restaurantName}.`}\nOnly recommend items from this menu. Never invent menu items or prices:\n${menu}\n${language === "en" ? "Reply in English. Keep menu item names as stored." : "أجب باللغة العربية."}`;
      const safeHistory = (Array.isArray(history) ? history.slice(-12) : []).filter((item: any) => item?.role === "user" || item?.role === "model")
        .map((item: any) => ({ role: item.role as "user" | "model", text: String(item.parts?.[0]?.text || "").slice(0, 2000) })).filter((item) => item.text);
      let reply = "";
      if (provider === "gemini") {
        const response = await ai!.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: system }] }, ...safeHistory.map((item) => ({ role: item.role, parts: [{ text: item.text }] })), { role: "user", parts: [{ text: message.slice(0, 2000) }] }], config: { temperature: Number(aiSettings?.temperature ?? .3) } });
        reply = response.text || "";
      } else {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, instructions: system, input: [...safeHistory.map((item) => ({ role: item.role === "model" ? "assistant" : "user", content: item.text })), { role: "user", content: message.slice(0, 2000) }], max_output_tokens: 1800, store: false }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          console.error("OpenAI request failed", { status: response.status });
          return res.status(502).json({ reply: language === "en" ? "The selected AI provider is unavailable. Please try again later." : "مزود المساعد الذكي غير متاح حالياً. يرجى المحاولة لاحقاً." });
        }
        reply = openAIResponseText(await response.json());
      }
      return res.json({ reply: reply || (language === "en" ? "No answer is available right now." : "لا تتوفر إجابة حالياً.") });
    } catch (error) { console.error(error); return res.status(500).json({ reply: req.body?.language === "en" ? "The service is temporarily unavailable." : "حدثت مشكلة اتصال بالخدمة." }); }
  });
  app.get("/api/health", (_req, res) => {
    const missing = [!supabaseUrl && "SUPABASE_URL", !supabaseAnonKey && "SUPABASE_ANON_KEY"].filter(Boolean);
    return missing.length ? res.status(503).json({ status: "misconfigured", missing }) : res.json({ status: "ok", database: "supabase" });
  });

export default app;
