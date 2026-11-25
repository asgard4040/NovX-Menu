import express from "express";
import { whatsappRouter } from "./whatsapp/routes";
import { platformPhone, queuePlatformInvitation } from "./whatsapp/platform";
import { loyaltyCardHash, loyaltyRouter } from "./loyalty/routes";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { DEFAULT_AI_MODEL, openAIResponseText, providerForAIModel } from "./src/lib/ai-models";
import { decryptPasscode, encryptPasscode, generatePasscode, isPasscode, isWeakPasscode, passcodeDigest, passcodeKey } from "./passcodes";
import { WAYL_API, renewalAmount, validWaylCheckoutUrl, verifyWaylSignature, waylLinkIsPaid } from "./wayl";
import { getSubscriptionAccess } from "./src/lib/subscription";
import { emptyPlanPrices, parsePlanPrices, planMonthlyPrice } from "./src/lib/subscription-pricing";
import { summarizeWaylPayments } from "./src/lib/admin-finance";

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
const configuredPasscodeSecret = process.env.PASSCODE_SECRET || "";
function getPasscodeKey() { return passcodeKey(configuredPasscodeSecret); }

async function setMemberPasscode(userId: string, restaurantId: string, role: "owner" | "manager" | "waiter" | "kitchen" | "cashier", requested?: string): Promise<string> {
  if (!supabaseAdmin) throw new Error("service_role_not_configured");
  const key = getPasscodeKey();
  if (requested !== undefined && !isPasscode(requested)) throw new Error("invalid_passcode");
  if (requested && isWeakPasscode(requested)) throw new Error("weak_passcode");
  for (let attempt = 0; attempt < (requested ? 1 : 100); attempt++) {
    const code = requested || generatePasscode();
    const { error } = await supabaseAdmin.from("staff_passcodes").upsert({
      user_id: userId, restaurant_id: restaurantId, role,
      code_digest: passcodeDigest(code, key), code_ciphertext: encryptPasscode(code, key),
      updated_at: new Date().toISOString(),
    }, { onConflict: "restaurant_id,user_id" });
    if (error?.code === "23505") {
      if (requested) throw new Error("passcode_taken");
      continue;
    }
    if (error) throw new Error(`passcode_save_failed:${error.message}`);
    // Supabase Auth keeps a strong, unknown password; the four digits are never an Auth password.
    const rotated = await supabaseAdmin.auth.admin.updateUserById(userId, { password: randomBytes(48).toString("base64url") });
    if (rotated.error) throw new Error("passcode_account_update_failed");
    return code;
  }
  throw new Error("passcode_space_exhausted");
}

async function getOrCreateMemberPasscode(userId: string, restaurantId: string, role: "owner" | "manager" | "waiter" | "kitchen" | "cashier"): Promise<string> {
  if (!supabaseAdmin) throw new Error("service_role_not_configured");
  const { data, error } = await supabaseAdmin.from("staff_passcodes").select("code_ciphertext,role").eq("user_id", userId).eq("restaurant_id", restaurantId).maybeSingle();
  if (error) throw new Error(`passcode_read_failed:${error.message}`);
  if (data?.role === role) return decryptPasscode(data.code_ciphertext, getPasscodeKey());
  if (data) return setMemberPasscode(userId, restaurantId, role);
  const key = getPasscodeKey();
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = generatePasscode();
    const inserted = await supabaseAdmin.from("staff_passcodes").insert({
      user_id: userId, restaurant_id: restaurantId, role,
      code_digest: passcodeDigest(code, key), code_ciphertext: encryptPasscode(code, key),
    });
    if (inserted.error?.code === "23505") {
      const winner = await supabaseAdmin.from("staff_passcodes").select("code_ciphertext").eq("user_id", userId).eq("restaurant_id", restaurantId).maybeSingle();
      if (winner.data) return decryptPasscode(winner.data.code_ciphertext, key);
      continue;
    }
    if (inserted.error) throw new Error(`passcode_save_failed:${inserted.error.message}`);
    const rotated = await supabaseAdmin.auth.admin.updateUserById(userId, { password: randomBytes(48).toString("base64url") });
    if (rotated.error) throw new Error("passcode_account_update_failed");
    return code;
  }
  throw new Error("passcode_space_exhausted");
}
function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}
const ai = getGeminiClient();

const camel = (key: string) => key.replace(/_([a-z])/g, (_, value) => value.toUpperCase());
const camelRow = (value: any): any => Array.isArray(value) ? value.map(camelRow) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [camel(key), camelRow(item)])) : value;
const rateWindows = new Map<string, { count: number; resetAt: number }>();
let nextRateCleanup = 0;
const restaurantUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function clientAddress(req: express.Request) {
  const platformAddress = process.env.VERCEL === "1" ? req.get("X-Vercel-Forwarded-For") : undefined;
  return platformAddress && isIP(platformAddress) ? platformAddress : req.socket.remoteAddress || "unknown";
}

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const now = Date.now();
  if (now >= nextRateCleanup) {
    nextRateCleanup = now + 60_000;
    for (const [key, value] of rateWindows) if (value.resetAt <= now) rateWindows.delete(key);
  }
  const key = `${clientAddress(req)}:${req.path}`;
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && rateWindows.size >= 10_000) return res.set("Retry-After", "60").status(429).json({ error: "too_many_requests" });
    rateWindows.set(key, { count: 1, resetAt: now + 60_000 });
  }
  else if (++current.count > 15) return res.status(429).json({ error: "too_many_requests" });
  next();
}

async function allowRestaurantRequest(req: express.Request, res: express.Response, restaurantId: string, action: string, limit: number) {
  if (!restaurantUuid.test(restaurantId)) {
    res.status(400).json({ error: "invalid_restaurant" });
    return false;
  }
  if (!supabaseAdmin) {
    res.status(503).json({ error: "server_config_missing" });
    return false;
  }
  const clientKey = createHmac("sha256", serviceRoleKey).update(`api:${action}:${clientAddress(req)}`).digest("hex");
  const { data, error } = await supabaseAdmin.rpc("claim_passcode_attempt", {
    p_restaurant_id: restaurantId, p_client_key: clientKey, p_limit: limit, p_window_seconds: 60,
  });
  if (error) {
    res.status(error.code === "23503" ? 404 : 503).json({ error: error.code === "23503" ? "restaurant_not_found" : "request_limit_unavailable" });
    return false;
  }
  if (data !== true) {
    res.set("Retry-After", "60").status(429).json({ error: "too_many_requests" });
    return false;
  }
  return true;
}

async function resolveRestaurantId(identifier: string) {
  if (restaurantUuid.test(identifier)) return identifier.toLowerCase();
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
app.use((req: any, _res: any, next: any) => {
  if (req.body !== undefined && !req._body) {
    req._body = true;
  }
  next();
});
app.use("/api/whatsapp", whatsappRouter(supabaseAdmin));
app.use(express.json({ limit: "256kb", verify: (req, _res, body) => { (req as any).rawBody = Buffer.from(body); } }));
app.use("/api/loyalty", loyaltyRouter(supabaseAdmin, rateLimit));

async function waylRequest(path: string, options?: RequestInit) {
  const token = process.env.WAYL_API_KEY;
  if (!token) throw new Error("wayl_not_configured");
  const response = await fetch(`${WAYL_API}${path}`, {
    ...options,
    headers: { "X-WAYL-AUTHENTICATION": token, "Content-Type": "application/json", ...options?.headers },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data) throw new Error(`wayl_http_${response.status}`);
  return payload.data;
}

async function subscriptionIdentity(req: express.Request) {
  if (!supabaseAdmin) return null;
  const bearer = req.headers.authorization?.replace(/^Bearer /, "") || "";
  const { data } = await supabaseAdmin.auth.getUser(bearer);
  return data.user || null;
}

async function subscriptionMembership(userId: string, restaurantId: string) {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("restaurant_members").select("role")
    .eq("user_id", userId).eq("restaurant_id", restaurantId).eq("active", true).maybeSingle();
  return data?.role || null;
}

async function readPlanPrices() {
  if (!supabaseAdmin) throw new Error("service_role_not_configured");
  // The existing app_settings table stores this small JSON document under its own key.
  const { data, error } = await supabaseAdmin.from("app_settings").select("prompt")
    .eq("key", "subscription_pricing").maybeSingle();
  if (error) throw new Error("pricing_unavailable");
  return data ? parsePlanPrices(data.prompt) : emptyPlanPrices;
}

async function reconcileWaylPayment(referenceId: string) {
  if (!supabaseAdmin) throw new Error("service_role_not_configured");
  const { data: payment, error } = await supabaseAdmin.from("subscription_payments")
    .select("reference_id,restaurant_id,amount_iqd,environment,wayl_link_id,status").eq("reference_id", referenceId).maybeSingle();
  if (error || !payment) throw new Error("payment_not_found");
  if (payment.status === "paid") return true;
  if (payment.environment === "test" && payment.restaurant_id !== process.env.WAYL_TEST_RESTAURANT_ID)
    throw new Error("test_payment_restaurant_not_allowed");
  const link = await waylRequest(`/${encodeURIComponent(referenceId)}`);
  if (!payment.wayl_link_id && link?.referenceId === referenceId && typeof link?.id === "string") {
    const saved = await supabaseAdmin.from("subscription_payments").update({ wayl_link_id: link.id })
      .eq("reference_id", referenceId).is("wayl_link_id", null);
    if (saved.error) throw new Error("payment_store_failed");
    payment.wayl_link_id = link.id;
  }
  if (!waylLinkIsPaid(link, referenceId, Number(payment.amount_iqd), payment.wayl_link_id)) return false;
  const applied = await supabaseAdmin.rpc("apply_paid_subscription", { p_reference_id: referenceId });
  if (applied.error) throw new Error(`renewal_failed:${applied.error.message}`);
  return true;
}

  app.get("/api/home-screen-manifest", (req, res) => {
    const restaurantId = String(req.query.restaurantId || "");
    const portal = String(req.query.portal || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(restaurantId)
      || !["menu", "restaurant", "waiter", "kitchen", "cashier"].includes(portal))
      return res.status(400).json({ error: "invalid_home_screen_portal" });
    const name = { menu: "ORDOVA Menu", restaurant: "ORDOVA Restaurant", waiter: "ORDOVA Waiter", kitchen: "ORDOVA Kitchen", cashier: "ORDOVA Cashier" }[portal];
    const startUrl = portal === "menu"
      ? `/?restaurantId=${encodeURIComponent(restaurantId)}`
      : `/?loginRestaurantId=${encodeURIComponent(restaurantId)}&portal=${portal}`;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    return res.json({ name, short_name: name, id: `/home/${portal}/${restaurantId}`,
      start_url: startUrl, scope: "/", display: "standalone",
      background_color: "#081220", theme_color: "#081220",
      icons: [{ src: "/ordova-mark.png", sizes: "1254x1254", type: "image/png", purpose: "any" }] });
  });

  app.get("/api/public/system-brand", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    if (!supabaseAdmin) return res.json({ logoUrl: null });
    const { data, error } = await supabaseAdmin.from("app_settings").select("logo_url").eq("key", "support").maybeSingle();
    if (error) return res.status(503).json({ error: "branding_unavailable" });
    return res.json({ logoUrl: data?.logo_url || null });
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
  app.get("/api/admin/subscription-prices", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = await subscriptionIdentity(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });
    if (user.app_metadata?.system_role !== "admin") return res.status(403).json({ error: "admin_required" });
    try { return res.json({ ...await readPlanPrices(), paymentConfigured: Boolean(process.env.WAYL_API_KEY),
      paymentEnvironment: process.env.WAYL_ENV || null }); }
    catch { return res.status(503).json({ error: "pricing_unavailable" }); }
  });
  app.put("/api/admin/subscription-prices", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = await subscriptionIdentity(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });
    if (user.app_metadata?.system_role !== "admin") return res.status(403).json({ error: "admin_required" });
    const { normal, pro } = req.body || {};
    if (![normal, pro].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000))
      return res.status(400).json({ error: "invalid_plan_prices" });
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const { error } = await supabaseAdmin.from("app_settings").upsert({
      key: "subscription_pricing", prompt: JSON.stringify({ normal, pro }), updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) return res.status(503).json({ error: "pricing_save_failed" });
    return res.json({ normal, pro });
  });
  app.get("/api/admin/financial-overview", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = await subscriptionIdentity(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });
    if (user.app_metadata?.system_role !== "admin") return res.status(403).json({ error: "admin_required" });
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const paid: Array<{ amount_iqd: number; paid_at: string }> = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await supabaseAdmin.from("subscription_payments").select("amount_iqd,paid_at")
        .eq("status", "paid").eq("environment", "live")
        .order("paid_at", { ascending: false }).range(offset, offset + 999);
      if (page.error) return res.status(503).json({ error: "financial_data_unavailable" });
      paid.push(...(page.data || []).filter(item => item.paid_at));
      if ((page.data || []).length < 1000) break;
    }
    const pending = await supabaseAdmin.from("subscription_payments").select("reference_id", { count: "exact", head: true })
      .eq("status", "pending").eq("environment", "live");
    if (pending.error) return res.status(503).json({ error: "financial_data_unavailable" });
    let planPrices;
    try { planPrices = await readPlanPrices(); }
    catch { return res.status(503).json({ error: "pricing_unavailable" }); }
    return res.json({ ...summarizeWaylPayments(paid, pending.count || 0), planPrices });
  });
  app.get("/api/restaurants/:restaurantId/subscription", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = await subscriptionIdentity(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });
    const restaurantId = await resolveRestaurantId(req.params.restaurantId);
    const role = await subscriptionMembership(user.id, restaurantId);
    if (!role) return res.status(403).json({ error: "restaurant_access_denied" });
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const { data: restaurant, error } = await supabaseAdmin.from("restaurants")
      .select("restaurant_name,status,start_date,end_date,grace_period_days,subscription_type,subscription_duration,monthly_cost")
      .eq("id", restaurantId).maybeSingle();
    if (error || !restaurant) return res.status(404).json({ error: "restaurant_not_found" });
    const access = getSubscriptionAccess({ status: restaurant.status, startDate: restaurant.start_date,
      endDate: restaurant.end_date, gracePeriodDays: restaurant.grace_period_days });
    let prices;
    try { prices = await readPlanPrices(); }
    catch { return res.status(503).json({ error: "pricing_unavailable" }); }
    const monthlyPrice = planMonthlyPrice(restaurant.subscription_type, restaurant.monthly_cost, prices);
    const managedQuote = await supabaseAdmin.rpc("saas_gateway_quote", { p_restaurant: restaurantId });
    const renewal = managedQuote.error ? null : managedQuote.data ? Number(managedQuote.data.amount) : monthlyPrice === null ? null : renewalAmount(monthlyPrice, restaurant.subscription_duration);
    return res.json({ allowed: access.allowed, reason: access.reason, restaurantName: restaurant.restaurant_name,
      endDate: restaurant.end_date, gracePeriodDays: restaurant.grace_period_days,
      amountIqd: role === "owner" || role === "manager" ? renewal : null,
      canRenew: (role === "owner" || role === "manager") && restaurant.status === "active"
        && renewal !== null });
  });

  app.post("/api/restaurants/:restaurantId/subscription/checkout", rateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = await subscriptionIdentity(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });
    const restaurantId = await resolveRestaurantId(req.params.restaurantId);
    const role = await subscriptionMembership(user.id, restaurantId);
    if (role !== "owner" && role !== "manager") return res.status(403).json({ error: "owner_required" });
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const appUrl = process.env.APP_URL || "https://rest.ordova.cc";
    if (!process.env.WAYL_API_KEY || !["test", "live"].includes(process.env.WAYL_ENV || "")
      || !appUrl.startsWith("https://")) return res.status(503).json({ error: "payment_not_configured" });
    if (process.env.WAYL_ENV === "test" && restaurantId !== process.env.WAYL_TEST_RESTAURANT_ID)
      return res.status(403).json({ error: "test_payment_restaurant_not_allowed" });
    const { data: restaurant, error } = await supabaseAdmin.from("restaurants")
      .select("id,restaurant_name,status,end_date,subscription_type,subscription_duration,monthly_cost")
      .eq("id", restaurantId).maybeSingle();
    if (error || !restaurant) return res.status(404).json({ error: "restaurant_not_found" });
    if (restaurant.status !== "active") return res.status(403).json({ error: "restaurant_suspended" });
    if (Date.parse(restaurant.end_date) > Date.now()) return res.status(409).json({ error: "subscription_still_active" });
    let prices;
    try { prices = await readPlanPrices(); }
    catch { return res.status(503).json({ error: "pricing_unavailable" }); }
    const monthlyPrice = planMonthlyPrice(restaurant.subscription_type, restaurant.monthly_cost, prices);
    const managedQuote = await supabaseAdmin.rpc("saas_gateway_quote", { p_restaurant: restaurantId });
    if (managedQuote.error) return res.status(409).json({ error: "managed_manual_payment_required" });
    const managed = managedQuote.data;
    const duration = managed ? "month" : restaurant.subscription_duration;
    const amount = managed ? Number(managed.amount) : monthlyPrice === null ? null : renewalAmount(monthlyPrice, duration);
    if (amount === null) return res.status(409).json({ error: "plan_price_not_configured" });
    const { data: pending } = await supabaseAdmin.from("subscription_payments")
      .select("reference_id,checkout_url,amount_iqd,duration,environment,created_at,saas_snapshot")
      .eq("restaurant_id", restaurantId).eq("status", "pending").maybeSingle();
    if (pending && Date.now() - Date.parse(pending.created_at) < 2 * 60 * 60 * 1000
      && Number(pending.amount_iqd) === amount && pending.duration === duration && JSON.stringify(pending.saas_snapshot || null) === JSON.stringify(managed?.snapshot || null)
      && pending.environment === process.env.WAYL_ENV) {
      if (!pending.checkout_url) return res.status(409).json({ error: "checkout_preparing" });
      return res.json({ url: pending.checkout_url, referenceId: pending.reference_id });
    }
    if (pending) await supabaseAdmin.from("subscription_payments").update({ status: "superseded" }).eq("reference_id", pending.reference_id);
    const referenceId = `renewal-${randomUUID()}`;
    const webhookSecret = randomBytes(32).toString("hex");
    const inserted = await supabaseAdmin.from("subscription_payments").insert({
      reference_id: referenceId, restaurant_id: restaurantId, amount_iqd: amount,
      environment: process.env.WAYL_ENV,
      duration, webhook_secret: webhookSecret, saas_snapshot: managed?.snapshot || null,
    });
    if (inserted.error) return res.status(inserted.error.code === "23505" ? 409 : 503).json({ error: "checkout_preparing" });
    try {
      const site = new URL(appUrl);
      const redirect = new URL(site.origin + "/");
      redirect.searchParams.set("loginRestaurantId", restaurantId);
      redirect.searchParams.set("portal", "restaurant");
      redirect.searchParams.set("paymentReturn", "1");
      const link = await waylRequest("", { method: "POST", body: JSON.stringify({
        env: process.env.WAYL_ENV, referenceId, total: amount,
        currency: "IQD", customParameter: restaurantId,
        lineItem: [{ label: `${restaurant.restaurant_name} subscription renewal`, amount, type: "increase" }],
        webhookUrl: new URL("/api/payments/wayl/webhook", site.origin).toString(),
        webhookSecret, redirectionUrl: redirect.toString(),
      }) });
      if (link.referenceId !== referenceId || link.currency !== "IQD" || Number(link.total) !== amount
        || typeof link.id !== "string" || !validWaylCheckoutUrl(link.url)) throw new Error("wayl_invalid_response");
      const saved = await supabaseAdmin.from("subscription_payments")
        .update({ wayl_link_id: link.id, checkout_url: link.url }).eq("reference_id", referenceId);
      if (saved.error) throw new Error("payment_store_failed");
      return res.json({ url: link.url, referenceId });
    } catch (reason) {
      console.error("Wayl checkout creation failed:", reason);
      await supabaseAdmin.from("subscription_payments").update({ status: "superseded" }).eq("reference_id", referenceId);
      return res.status(502).json({ error: "checkout_unavailable" });
    }
  });

  app.post("/api/payments/wayl/webhook", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).end();
    const referenceId = req.body?.referenceId;
    if (typeof referenceId !== "string" || !/^renewal-[0-9a-f-]{36}$/i.test(referenceId)) return res.status(400).end();
    const { data: payment } = await supabaseAdmin.from("subscription_payments")
      .select("webhook_secret").eq("reference_id", referenceId).maybeSingle();
    if (!payment || !verifyWaylSignature((req as any).rawBody, req.headers["x-wayl-signature-256"], payment.webhook_secret)) return res.status(401).end();
    try {
      await reconcileWaylPayment(referenceId);
      return res.status(204).end();
    } catch (reason) {
      console.error("Wayl renewal reconciliation failed:", reason);
      return res.status(503).end();
    }
  });

  app.get("/api/payments/wayl/:referenceId/status", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const user = await subscriptionIdentity(req);
    if (!user || !supabaseAdmin) return res.status(401).json({ error: "authentication_required" });
    const { data: payment } = await supabaseAdmin.from("subscription_payments")
      .select("restaurant_id,status").eq("reference_id", req.params.referenceId).maybeSingle();
    if (!payment) return res.status(404).json({ error: "payment_not_found" });
    const role = await subscriptionMembership(user.id, payment.restaurant_id);
    if (role !== "owner" && role !== "manager") return res.status(403).json({ error: "owner_required" });
    try { return res.json({ paid: await reconcileWaylPayment(req.params.referenceId) }); }
    catch (reason) { console.error("Wayl payment status check failed:", reason); return res.status(503).json({ error: "payment_status_unavailable" }); }
  });
  app.post("/api/public/restaurants/:restaurantId/customer-status", rateLimit, async (req, res) => {
    const restaurantId = await resolveRestaurantId(req.params.restaurantId);
    const { data, error } = await supabase.rpc("customer_device_status", { p_restaurant_id: restaurantId, p_fingerprint: String(req.body?.fingerprint || "").slice(0, 128) });
    if (error) return res.status(400).json({ error: error.message }); return res.json(data);
  });
  app.post("/api/security-alerts", async (req, res) => {
    const body = req.body || {};
    const restaurantId = await resolveRestaurantId(String(body.restaurantId || ""));
    if (!await allowRestaurantRequest(req, res, restaurantId, "security-alert", 15)) return;
    const { error } = await supabaseAdmin!.rpc("create_security_alert", { p_restaurant_id: restaurantId, p_type: body.type, p_title: body.title, p_severity: body.severity, p_customer_name: body.customerName, p_table_number: body.tableNumber, p_fingerprint: body.fingerprint, p_distance: body.distanceMeters });
    if (error) return res.status(400).json({ error: error.message }); return res.status(204).end();
  });
  app.post("/api/auth/login", rateLimit, async (req, res) => {
    if (!supabaseUrl || !supabaseAnonKey) return res.status(503).json({ error: "server_config_missing" });
    const requestedRole = req.body?.role;
    const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (requestedRole === "admin") {
      const username = String(req.body?.username || "").trim().toLowerCase();
      const email = username.includes("@") ? username : `${username.replace(/[^a-z0-9._-]/g, "")}@accounts.novx.invalid`;
      try {
        const { data, error } = await authClient.auth.signInWithPassword({ email, password: String(req.body?.password || "") });
        if (error || !data.session) return res.status(401).json({ error: "invalid_credentials" });
        if (data.user.app_metadata?.system_role !== "admin") return res.status(403).json({ error: "role_mismatch" });
        return res.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, session: { role: "admin", id: data.user.id, name: data.user.user_metadata?.name || username } });
      } catch (error) {
        console.error("Supabase sign-in service unavailable:", error);
        return res.status(503).json({ error: "auth_service_unavailable" });
      }
    }
    if (!["restaurant", "waiter", "kitchen", "cashier"].includes(requestedRole)) return res.status(400).json({ error: "invalid_role" });
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const code = req.body?.passcode;
    if (!isPasscode(code)) return res.status(400).json({ error: "invalid_passcode" });
    const requestedRestaurantId = await resolveRestaurantId(String(req.body?.restaurantId || ""));
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(requestedRestaurantId)) return res.status(401).json({ error: "invalid_credentials" });
    let digest: string;
    let key: Buffer;
    try { key = getPasscodeKey(); digest = passcodeDigest(code, key); }
    catch { return res.status(503).json({ error: "passcode_secret_not_configured" }); }
    const ipKey = createHmac("sha256", key).update(`ip:${clientAddress(req)}`).digest("hex");
    const globalKey = createHmac("sha256", key).update(`restaurant:${requestedRestaurantId}`).digest("hex");
    const [ipLimit, restaurantLimit] = await Promise.all([
      supabaseAdmin.rpc("claim_passcode_attempt", { p_restaurant_id: requestedRestaurantId, p_client_key: ipKey, p_limit: 8, p_window_seconds: 600 }),
      supabaseAdmin.rpc("claim_passcode_attempt", { p_restaurant_id: requestedRestaurantId, p_client_key: globalKey, p_limit: 80, p_window_seconds: 3600 }),
    ]);
    if (ipLimit.error || restaurantLimit.error) return res.status(503).json({ error: "passcode_store_unavailable" });
    if (!ipLimit.data || !restaurantLimit.data) return res.status(429).json({ error: "too_many_requests" });
    const allowedRoles = requestedRole === "restaurant" ? ["owner", "manager"] : [requestedRole];
    const { data: record, error: lookupError } = await supabaseAdmin.from("staff_passcodes")
      .select("user_id,restaurant_id,role").eq("code_digest", digest).eq("restaurant_id", requestedRestaurantId).in("role", allowedRoles).maybeSingle();
    if (lookupError) return res.status(503).json({ error: "passcode_store_unavailable" });
    if (!record) return res.status(401).json({ error: "invalid_credentials" });
    const { data: membership } = await supabaseAdmin.from("restaurant_members").select("role,active")
      .eq("user_id", record.user_id).eq("restaurant_id", requestedRestaurantId).maybeSingle();
    if (!membership?.active || membership.role !== record.role) return res.status(401).json({ error: "invalid_credentials" });
    if (requestedRole !== "restaurant") {
      const { data: staff } = await supabaseAdmin.from("staff").select("status")
        .eq("auth_user_id", record.user_id).eq("restaurant_id", requestedRestaurantId).eq("role", requestedRole).maybeSingle();
      if (staff?.status !== "active") return res.status(401).json({ error: "invalid_credentials" });
    }
    const { data: account, error: accountError } = await supabaseAdmin.auth.admin.getUserById(record.user_id);
    if (accountError || !account.user?.email) return res.status(503).json({ error: "auth_service_unavailable" });
    try {
      const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: account.user.email });
      if (link.error || !link.data.properties?.hashed_token) return res.status(503).json({ error: "auth_service_unavailable" });
      const { data, error } = await authClient.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
      if (error || !data.session || data.user?.id !== record.user_id) return res.status(503).json({ error: "auth_service_unavailable" });
      return res.json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token,
        session: { role: requestedRole, membershipRole: record.role, id: record.user_id, restaurantId: requestedRestaurantId, name: data.user.user_metadata?.name || requestedRole } });
    } catch (error) {
      console.error("Passcode session creation failed:", error);
      return res.status(503).json({ error: "auth_service_unavailable" });
    }
  });
  app.get("/api/auth/session", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    if (!bearer) return res.status(401).end();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await userClient.auth.getUser(bearer);
    if (identityError && (!identityError.status || identityError.status === 429 || identityError.status >= 500)) {
      return res.status(503).json({ error: "auth_service_unavailable" });
    }
    if (!identity.user) return res.status(401).end();
    if (identity.user.app_metadata?.system_role === "admin") return res.json({ role: "admin", id: identity.user.id, name: identity.user.user_metadata?.name || "admin" });
    const preferredRestaurant = identity.user.app_metadata?.restaurant_id;
    let membershipQuery = userClient.from("restaurant_members").select("role,restaurant_id").eq("user_id", identity.user.id).eq("active", true);
    if (preferredRestaurant) membershipQuery = membershipQuery.eq("restaurant_id", preferredRestaurant);
    const { data: memberships, error: membershipError } = await membershipQuery.limit(1);
    if (membershipError) return res.status(503).json({ error: "auth_service_unavailable" });
    const membership = memberships?.[0]; if (!membership) return res.status(403).end();
    const role = membership.role === "owner" || membership.role === "manager" ? "restaurant" : membership.role;
    return res.json({ role, membershipRole: membership.role, id: identity.user.id, restaurantId: membership.restaurant_id, name: identity.user.user_metadata?.name || "user" });
  });
  app.get("/api/admin/restaurants/:restaurantId/passcode", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, "") || "";
    const { data: identity } = await supabaseAdmin.auth.getUser(bearer);
    if (identity.user?.app_metadata?.system_role !== "admin") return res.status(403).json({ error: "admin_required" });
    const { data: owner } = await supabaseAdmin.from("restaurant_members").select("user_id,role")
      .eq("restaurant_id", req.params.restaurantId).eq("role", "owner").maybeSingle();
    if (!owner) return res.status(404).json({ error: "restaurant_owner_not_found" });
    try {
      const passcode = await getOrCreateMemberPasscode(owner.user_id, req.params.restaurantId, "owner");
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ passcode });
    } catch (error) {
      console.error("Owner passcode retrieval failed:", error);
      return res.status(503).json({ error: "passcode_unavailable" });
    }
  });
  app.get("/api/staff/:staffId/passcode", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, "") || "";
    const { data: identity } = await supabaseAdmin.auth.getUser(bearer);
    if (!identity.user) return res.status(401).json({ error: "authentication_required" });
    const restaurantId = String(req.query.restaurantId || "");
    const { data: owner } = await supabaseAdmin.from("restaurant_members").select("role").eq("restaurant_id", restaurantId)
      .eq("user_id", identity.user.id).eq("active", true).maybeSingle();
    if (!owner || !["owner", "manager"].includes(owner.role)) return res.status(403).json({ error: "owner_required" });
    const { data: staff } = await supabaseAdmin.from("staff").select("auth_user_id,role")
      .eq("id", req.params.staffId).eq("restaurant_id", restaurantId).maybeSingle();
    if (!staff?.auth_user_id) return res.status(404).json({ error: "staff_not_found" });
    try {
      const passcode = await getOrCreateMemberPasscode(staff.auth_user_id, restaurantId, staff.role);
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ passcode });
    } catch (error) {
      console.error("Staff passcode retrieval failed:", error);
      return res.status(503).json({ error: "passcode_unavailable" });
    }
  });
  app.post("/api/staff", async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: "service_role_not_configured" });
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const { data: identity } = await supabaseAdmin.auth.getUser(bearer || "");
    if (!identity.user) return res.status(401).json({ error: "authentication_required" });
    const body = req.body || {}; const restaurantId = String(body.restaurantId || "");
    const role = ["kitchen", "waiter", "cashier"].includes(body.role) ? body.role as "kitchen" | "waiter" | "cashier" : null;
    const sendInvitation = !body.id && body.whatsappConsent === true;
    if (sendInvitation && !platformPhone(body.phone)) return res.status(400).json({ error: "invalid_phone" });
    const requestedPasscode = body.passcode === "" || body.passcode == null ? undefined : body.passcode;
    if (!role) return res.status(400).json({ error: "invalid_staff_role" });
    if (requestedPasscode !== undefined && !isPasscode(requestedPasscode)) return res.status(400).json({ error: "invalid_passcode" });
    if (requestedPasscode && isWeakPasscode(requestedPasscode)) return res.status(400).json({ error: "weak_passcode" });
    try { getPasscodeKey(); } catch { return res.status(503).json({ error: "passcode_secret_not_configured" }); }
    const { data: membership } = await supabaseAdmin.from("restaurant_members").select("role").eq("restaurant_id", restaurantId).eq("user_id", identity.user.id).eq("active", true).maybeSingle();
    if (!membership || !["owner", "manager"].includes(membership.role)) return res.status(403).json({ error: "owner_required" });
    const { data: restaurant } = await supabaseAdmin.from("restaurants").select("status,start_date,end_date,grace_period_days").eq("id", restaurantId).single();
    const now = Date.now(); const starts = Date.parse(restaurant?.start_date || ""); const graceEnd = Date.parse(restaurant?.end_date || "") + Number(restaurant?.grace_period_days || 0) * 86_400_000;
    if (!restaurant || restaurant.status !== "active" || now < starts || now >= graceEnd) return res.status(403).json({ error: "subscription_inactive" });
    if (body.id) {
      const { data: staff } = await supabaseAdmin.from("staff").select("auth_user_id,role").eq("id", body.id).eq("restaurant_id", restaurantId).single();
      if (!staff) return res.status(404).end();
      if (!staff.auth_user_id) return res.status(409).json({ error: "staff_auth_account_missing" });
      if (staff.role !== role) return res.status(409).json({ error: "staff_role_mismatch" });
      const authUpdate = await supabaseAdmin.auth.admin.updateUserById(staff.auth_user_id, {
        user_metadata: { name: body.name },
        app_metadata: { role, restaurant_id: restaurantId },
      });
      if (authUpdate.error) return res.status(400).json({ error: "staff_auth_update_failed", details: authUpdate.error.message });
      if (requestedPasscode) {
        try { await setMemberPasscode(staff.auth_user_id, restaurantId, role, requestedPasscode); }
        catch (error) { return res.status(error instanceof Error && error.message === "passcode_taken" ? 409 : 503).json({ error: error instanceof Error ? error.message : "passcode_save_failed" }); }
      }
      const { error } = await supabaseAdmin.from("staff").update({ name: body.name, phone: body.phone, role }).eq("id", body.id).eq("restaurant_id", restaurantId);
      if (error) return res.status(400).json({ error: error.message }); return res.status(204).end();
    }
    const username = `staff-${randomUUID()}`;
    const email = `${username}@accounts.novx.invalid`;
    const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password: randomBytes(48).toString("base64url"), email_confirm: true, user_metadata: { name: body.name }, app_metadata: { role, restaurant_id: restaurantId } });
    if (authError || !created.user) return res.status(400).json({ error: authError?.message });
    const staffInsert = await supabaseAdmin.from("staff").insert({ restaurant_id: restaurantId, auth_user_id: created.user.id, role, name: body.name, phone: body.phone, username }).select().single();
    if (staffInsert.error) { await supabaseAdmin.auth.admin.deleteUser(created.user.id); return res.status(400).json({ error: staffInsert.error.message }); }
    const membershipInsert = await supabaseAdmin.from("restaurant_members").insert({ restaurant_id: restaurantId, user_id: created.user.id, role });
    if (membershipInsert.error) {
      await supabaseAdmin.from("staff").delete().eq("id", staffInsert.data.id).eq("restaurant_id", restaurantId);
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return res.status(400).json({ error: "staff_membership_failed", details: membershipInsert.error.message });
    }
    try {
      const passcode = await setMemberPasscode(created.user.id, restaurantId, role, requestedPasscode);
      const whatsappInvitation = sendInvitation ? await queuePlatformInvitation(supabaseAdmin, {
        restaurantId, userId: created.user.id, actorId: identity.user.id, phone: body.phone,
      }) : undefined;
      return res.status(201).json({ ...camelRow(staffInsert.data), passcode, whatsappInvitation });
    } catch (error) {
      await supabaseAdmin.from("staff").delete().eq("id", staffInsert.data.id).eq("restaurant_id", restaurantId);
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return res.status(error instanceof Error && error.message === "passcode_taken" ? 409 : 503).json({ error: error instanceof Error ? error.message : "passcode_save_failed" });
    }
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
    const body = req.body || {};
    const sendInvitation = !body.id && body.whatsappConsent === true;
    if (sendInvitation && !platformPhone(body.managerPhone)) return res.status(400).json({ error: "invalid_phone" });
    // New restaurants always receive a server-generated, globally unique code.
    // Administrators can choose a replacement only when editing an existing restaurant.
    const requestedPasscode = !body.id || body.passcode === "" || body.passcode == null ? undefined : body.passcode;
    if (requestedPasscode !== undefined && !isPasscode(requestedPasscode)) return res.status(400).json({ error: "invalid_passcode" });
    if (requestedPasscode && isWeakPasscode(requestedPasscode)) return res.status(400).json({ error: "weak_passcode" });
    try { getPasscodeKey(); } catch { return res.status(503).json({ error: "passcode_secret_not_configured" }); }
    const username = body.id ? String(body.username || "") : `restaurant-${randomUUID()}`;
    let prices;
    try { prices = await readPlanPrices(); }
    catch { return res.status(503).json({ error: "pricing_unavailable" }); }
    const monthlyCost = body.subscriptionType === "trial" ? 0 : planMonthlyPrice(body.subscriptionType, body.monthlyCost, prices);
    if (monthlyCost === null) return res.status(400).json({ error: "plan_price_not_configured" });
    const months = body.subscriptionDuration === "month" ? 1 : body.subscriptionDuration === "six-months" ? 6 : body.subscriptionDuration === "year" ? 12 : null;
    if (body.subscriptionType !== "trial" && months === null) return res.status(400).json({ error: "invalid_subscription_duration" });
    const row = { manager_name: body.managerName, manager_phone: body.managerPhone, restaurant_name: body.restaurantName, username, province: body.province, area: body.area, landmark: body.landmark, subscription_type: body.subscriptionType, subscription_duration: body.subscriptionDuration, start_date: body.startDate, end_date: body.endDate, monthly_cost: monthlyCost, total_cost: monthlyCost * (months || 0), grace_period_days: 0, logo_url: body.logoUrl, status: body.status || "active" };
    if (body.id) {
      if (requestedPasscode) {
        const owner = await supabaseAdmin.from("restaurant_members").select("user_id").eq("restaurant_id", body.id).eq("role", "owner").single();
        if (owner.error || !owner.data) return res.status(404).json({ error: "restaurant_owner_not_found" });
        try { await setMemberPasscode(owner.data.user_id, body.id, "owner", requestedPasscode); }
        catch (error) { return res.status(error instanceof Error && error.message === "passcode_taken" ? 409 : 503).json({ error: error instanceof Error ? error.message : "passcode_save_failed" }); }
      }
      const { error } = await supabaseAdmin.from("restaurants").update(row).eq("id", body.id); if (error) return res.status(400).json({ error: error.message });
      return res.status(204).end();
    }
    const email = `${username}@accounts.novx.invalid`;
    const authResult = await supabaseAdmin.auth.admin.createUser({ email, password: randomBytes(48).toString("base64url"), email_confirm: true, user_metadata: { name: body.restaurantName }, app_metadata: { role: "restaurant" } });
    if (authResult.error || !authResult.data.user) return res.status(400).json({ error: "account_creation_failed", details: authResult.error?.message });
    const restaurant = await supabaseAdmin.from("restaurants").insert({ ...row, theme_id: "ordova" }).select().single();
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
    try {
      const passcode = await setMemberPasscode(authResult.data.user.id, restaurant.data.id, "owner", requestedPasscode);
      const whatsappInvitation = sendInvitation ? await queuePlatformInvitation(supabaseAdmin, {
        restaurantId: restaurant.data.id, userId: authResult.data.user.id, actorId: identity.user.id, phone: body.managerPhone,
      }) : undefined;
      return res.status(201).json({ ...camelRow(restaurant.data), passcode, whatsappInvitation });
    } catch (error) {
      await supabaseAdmin.from("restaurants").delete().eq("id", restaurant.data.id).eq("username", row.username);
      await supabaseAdmin.auth.admin.deleteUser(authResult.data.user.id);
      return res.status(error instanceof Error && error.message === "passcode_taken" ? 409 : 503).json({ error: error instanceof Error ? error.message : "passcode_save_failed" });
    }
  });
  app.post("/api/waiter-requests", async (req, res) => {
    const body = req.body || {}; const location = parseCustomerLocation(body.location);
    if (!location) return res.status(400).json({ error: "invalid_location" });
    const customerName = String(body.customerName || "").trim() || "Guest";
    const tableNumber = String(body.tableNumber || "").trim();
    const reason = String(body.reason || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "");
    if (!body.restaurantId || !customerName || !tableNumber || !reason || idempotencyKey.length < 20 || idempotencyKey.length > 200)
      return res.status(400).json({ error: "invalid_request" });
    const restaurantId = await resolveRestaurantId(String(body.restaurantId));
    if (!await allowRestaurantRequest(req, res, restaurantId, "waiter-request", 30)) return;
    const { data, error } = await supabaseAdmin!.rpc("create_waiter_request", { p_restaurant_id: restaurantId, p_customer_name: customerName, p_table_number: tableNumber, p_reason: reason, p_lat: location.latitude, p_lon: location.longitude, p_accuracy: location.accuracy, p_idempotency_key: idempotencyKey });
    if (error) return res.status(error.message.includes("subscription") || error.message.includes("location") ? 403 : 400).json({ error: error.message });
    return res.status(201).json({ id: data, notification: "queued" });
  });
  app.post("/api/orders", async (req, res) => {
    const body = req.body || {}; const location = parseCustomerLocation(body.location);
    if (!location) return res.status(400).json({ error: "invalid_location" });
    const trackingToken = String(body.trackingToken || "");
    if (trackingToken.length < 20 || trackingToken.length > 200) return res.status(400).json({ error: "invalid_tracking_token" });
    const customerName = String(body.customerName || "").trim() || "Guest";
    const tableNumber = String(body.tableNumber || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "");
    if (!body.restaurantId || !customerName || !tableNumber || idempotencyKey.length < 20 || idempotencyKey.length > 200
      || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100
      || body.items.some((item: any) => !item || typeof item.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(item.id)
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99))
      return res.status(400).json({ error: "invalid_order" });
    const items = body.items.map((item: any) => ({ id: item.id, quantity: item.quantity, cheeseSelected: item.cheeseSelected === true, spicySelected: item.spicySelected === true }));
    const restaurantId = await resolveRestaurantId(String(body.restaurantId));
    if (!await allowRestaurantRequest(req, res, restaurantId, "order", 60)) return;
    const order = { p_restaurant_id: restaurantId, p_customer_name: customerName, p_table_number: tableNumber,
      p_notes: String(body.notes || ""), p_items: items, p_lat: location.latitude, p_lon: location.longitude,
      p_accuracy: location.accuracy, p_fingerprint: String(body.fingerprint || ""),
      p_idempotency_key: idempotencyKey, p_tracking_token: trackingToken };
    const card = body.collectLoyalty === true ? loyaltyCardHash(req, restaurantId) : null;
    const { data, error } = card
      ? await supabaseAdmin!.rpc("loyalty_create_order", { ...order, p_token_hash: card })
      : await supabaseAdmin!.rpc("create_customer_order", order);
    if (error) return res.status(error.code === "42501" || error.message.includes("subscription") || error.message.includes("location") ? 403 : 400).json({ error: error.message });
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
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, restaurantId, history } = req.body;
      const language = req.body?.language === "en" ? "en" : "ar";
      if (typeof message !== "string" || !message.trim()) return res.status(400).json({ reply: language === "en" ? "Message is required." : "الرسالة مطلوبة." });

      const resolvedId = await resolveRestaurantId(String(restaurantId || ""));
      if (!await allowRestaurantRequest(req, res, resolvedId, "menu-chat", 15)) return;
      const access = await supabase.rpc("public_restaurant_menu", { p_restaurant_id: resolvedId });
      if (access.error) return res.status(403).json({ reply: language === "en" ? "This restaurant's subscription is inactive." : "اشتراك هذا المطعم غير نشط حالياً." });

      let aiSettings: any = null;
      if (supabaseAdmin) {
        try {
          const { data, error } = await supabaseAdmin.from("app_settings").select("model,prompt,temperature").eq("key", "ai").maybeSingle();
          if (!error && data) aiSettings = data;
        } catch (settingsErr) {
          console.warn("Could not load AI app_settings, using defaults:", settingsErr);
        }
      }

      const rawModel = aiSettings?.model || DEFAULT_AI_MODEL;
      const model = rawModel === "gemini-2.0-flash" ? DEFAULT_AI_MODEL : rawModel;
      const provider = providerForAIModel(model) || "gemini";
      const geminiClient = getGeminiClient();

      if ((provider === "gemini" && !geminiClient) || (provider === "openai" && !process.env.OPENAI_API_KEY)) {
        return res.status(200).json({ reply: language === "en" ? `${provider === "openai" ? "OpenAI" : "Gemini"} is not configured on the server yet.` : `مفتاح ${provider === "openai" ? "OpenAI" : "Gemini"} غير مهيأ على الخادم بعد.` });
      }

      const menuItems = access.data?.menu_items || [];
      const restaurantName = access.data?.restaurant?.restaurant_name || "المطعم";
      const menu = Array.isArray(menuItems) ? menuItems.map((item: any) => `• ${item.name} | ${item.price} د.ع | ${item.ingredients || ""}`).join("\n") : "";
      const system = `${aiSettings?.prompt || `أنت مساعد مطعم عراقي محترم ومختصر لمطعم ${restaurantName}.`}\nOnly recommend items from this menu. Never invent menu items or prices:\n${menu}\n${language === "en" ? "Reply in English. Keep menu item names as stored." : "أجب باللغة العربية."}`;
      const safeHistory = (Array.isArray(history) ? history.slice(-12) : []).filter((item: any) => item?.role === "user" || item?.role === "model")
        .map((item: any) => ({ role: item.role as "user" | "model", text: String(item.parts?.[0]?.text || "").slice(0, 2000) })).filter((item) => item.text);

      let reply = "";
      if (provider === "gemini") {
        try {
          const response = await geminiClient!.models.generateContent({
            model,
            contents: [
              { role: "user", parts: [{ text: system }] },
              ...safeHistory.map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
              { role: "user", parts: [{ text: message.slice(0, 2000) }] }
            ],
            config: { temperature: Number(aiSettings?.temperature ?? 0.3) }
          });
          reply = response.text || "";
        } catch (geminiErr: any) {
          console.error("Gemini model request failed for", model, geminiErr?.message || geminiErr);
          if (model !== DEFAULT_AI_MODEL) {
            console.log("Retrying with default model:", DEFAULT_AI_MODEL);
            const fallbackResponse = await geminiClient!.models.generateContent({
              model: DEFAULT_AI_MODEL,
              contents: [
                { role: "user", parts: [{ text: system }] },
                ...safeHistory.map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
                { role: "user", parts: [{ text: message.slice(0, 2000) }] }
              ],
              config: { temperature: 0.3 }
            });
            reply = fallbackResponse.text || "";
          } else {
            throw geminiErr;
          }
        }
      } else {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, instructions: system, input: [...safeHistory.map((item) => ({ role: item.role === "model" ? "assistant" : "user", content: item.text })), { role: "user", content: message.slice(0, 2000) }], max_output_tokens: 1800, store: false }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          console.error("OpenAI request failed", { status: response.status });
          return res.status(200).json({ reply: language === "en" ? "The selected AI provider is unavailable. Please try again later." : "مزود المساعد الذكي غير متاح حالياً. يرجى المحاولة لاحقاً." });
        }
        reply = openAIResponseText(await response.json());
      }
      return res.json({ reply: reply || (language === "en" ? "No answer is available right now." : "لا تتوفر إجابة حالياً.") });
    } catch (error: any) {
      console.error("Chat API error:", error?.message || error);
      const language = req.body?.language === "en" ? "en" : "ar";
      return res.status(200).json({
        reply: language === "en"
          ? "I am temporarily unavailable right now. Please explore our menu or ask the waiter for assistance."
          : "أهلاً بيكم! المساعد الذكي غير متاح مؤقتاً حالياً. يرجى تصفح المنيو أو نداء الويتر لخدمتكم.",
      });
    }
  });
  app.get("/api/health", (_req, res) => {
    const missing = [!supabaseUrl && "SUPABASE_URL", !supabaseAnonKey && "SUPABASE_ANON_KEY"].filter(Boolean);
    return missing.length ? res.status(503).json({ status: "misconfigured", missing }) : res.json({ status: "ok", database: "supabase" });
  });

export default app;
