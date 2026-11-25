import { raw, json, Router, type Request, type RequestHandler, type Response } from "express";
import { aiCredentials, defaultSettings, type Settings } from "./agent";
import { businessUserId, equalSecret, parseWebhook, ProviderError, serviceWindowOpen, uuid, verifySignature } from "./meta";
import { ApiError, checkConnection, completeSignup, config, connectManual, disconnect, exchangeSignup, listSignupPhones, manualSetup, manualWebhookToken, signupPage } from "./onboarding";
import { accountAppSecret, result, retryAllowed, runWorker, type Account, type Db } from "./worker";
import { connectGupshup, gupshupSetup, parseGupshup } from "./gupshup";
import { parsePolicy } from "./policy";
import { parseDeliveryZones } from "./delivery-data";
import { waitUntil } from "@vercel/functions";
import { platformWhatsAppRouter } from "./platform";

// Persist and acknowledge first. Vercel keeps this bounded task alive after the
// response; leases serialize concurrent wakes and cron remains crash recovery.
export function wakeWhatsAppWorker(db: Db, fetcher: typeof fetch) {
  if (process.env.VERCEL !== "1") return;
  waitUntil(new Promise(resolve => setTimeout(resolve, 450)).then(() => runWorker(db, fetcher))
    .catch(() => console.warn(JSON.stringify({ subsystem: "whatsapp", event: "wake_failed" }))));
}

const publicAccount = "phone_id,waba_id,meta_app_id,display_phone,status,subscribed,coexistence,last_error,verified_at,last_webhook_at,token_expires_at,data_access_expires_at,provider,gupshup_app_id,gupshup_app_name,gupshup_source";
const conversationFields = "id,customer_id,last_inbound_at,locale,handoff";
const signupCookie = "__Host-ordova-whatsapp";
const signupCookieOptions = { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/" };

function requireEmbeddedSignup() {
  if (process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED !== "true") throw new ApiError(404, "embedded_signup_disabled");
}

async function isOwner(db: Db, restaurantId: string, userId: string) {
  return !!result(await db.from("restaurant_members").select("role").eq("restaurant_id", restaurantId)
    .eq("user_id", userId).eq("role", "owner").eq("active", true).maybeSingle());
}

const ownerSettingsFields = "enabled,ordering_enabled,handoff_enabled,welcome,language,tone,opens_at,closes_at,timezone,delivery_enabled,delivery_zones";

function ownerSettings(settings: Settings) {
  const { ai_policy, daily_ai_limit, ...operational } = settings;
  return operational;
}

function operationalError(code: string | null) {
  if (!code) return "whatsapp_unavailable";
  if (/budget|quota|billing|rate_limit|insufficient|subscription/i.test(code)) return "assistant_unavailable";
  return code;
}

export function parseOwnerSettings(body: unknown) {
  if (!body || typeof body !== "object") throw new ApiError(400, "invalid_settings");
  return ownerSettings(parseSettings({ ...body, ai_policy: undefined, daily_ai_limit: defaultSettings.daily_ai_limit }));
}

export function parseSettings(body: any): Settings {
  if (!body || typeof body !== "object") throw new ApiError(400, "invalid_settings");
  const { enabled, ordering_enabled, handoff_enabled, welcome, language, tone, opens_at, closes_at, timezone, daily_ai_limit } = body;
  const validTime = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (![enabled, ordering_enabled, handoff_enabled].every(value => typeof value === "boolean") ||
    typeof welcome !== "string" || welcome.length > 300 || welcome.includes("\0") ||
    !["ar", "en"].includes(language) || !["friendly", "formal"].includes(tone) ||
    !["Asia/Baghdad", "UTC"].includes(timezone) || !Number.isInteger(daily_ai_limit) || daily_ai_limit < 1 || daily_ai_limit > 500 ||
    !((opens_at === null && closes_at === null) || (validTime(opens_at) && validTime(closes_at) && opens_at !== closes_at))) {
    throw new ApiError(400, "invalid_settings");
  }
  let ai_policy;
  if (body.ai_policy !== undefined) {
    try { ai_policy = parsePolicy(body.ai_policy); } catch { throw new ApiError(400, "invalid_policy"); }
  }
  const delivery: Pick<Settings,"delivery_enabled"|"delivery_zones">={};
  if (body.delivery_enabled !== undefined) {
    if (typeof body.delivery_enabled !== "boolean") throw new ApiError(400,"invalid_delivery_settings");
    delivery.delivery_enabled=body.delivery_enabled;
  }
  if (body.delivery_zones !== undefined) {
    try { delivery.delivery_zones=parseDeliveryZones(body.delivery_zones); } catch { throw new ApiError(400,"invalid_delivery_zones"); }
  }
  if (delivery.delivery_enabled && delivery.delivery_zones?.length===0) throw new ApiError(400,"delivery_zones_required");
  return { enabled, ordering_enabled, handoff_enabled, welcome: welcome.trim(), language, tone,
    opens_at, closes_at, timezone, daily_ai_limit, ...(ai_policy ? { ai_policy } : {}),...delivery };
}

function safeRoute(action: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res) => {
    void action(req, res).catch((error: unknown) => {
      if (error instanceof ApiError) { res.status(error.status).json({ error: error.code }); return; }
      if (error instanceof ProviderError) { res.status(error.retryable ? 503 : 422).json({ error: error.code }); return; }
      const code = error instanceof Error && /^db_[a-zA-Z0-9_]+$/.test(error.message) ? error.message : "internal_error";
      console.warn(JSON.stringify({ subsystem: "whatsapp", event: "request_failed", code }));
      res.status(503).json({ error: "whatsapp_unavailable" });
    });
  };
}

const retryCode = (text: string) => /^(?:[1-9]\d{0,14})$/.test(text);
export function whatsappRouter(db: Db | null, fetcher = fetch) {
  const router = Router();
  router.use("/platform", platformWhatsAppRouter(db, fetcher));
  router.post("/gupshup/webhook", raw({ type: "application/json", inflate: false, limit: "256kb" }), safeRoute(async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (!db) return res.sendStatus(503);
    const rid = req.query.connection;
    if (!uuid(rid)) return res.sendStatus(401);
    const account = result(await db.from("whatsapp_accounts").select("*")
      .eq("restaurant_id", rid.toLowerCase()).eq("provider", "gupshup").eq("status", "connected").maybeSingle()) as Account | null;
    const setup = gupshupSetup(account);
    if (!account || !setup || !equalSecret(req.query.token, new URL(setup.callback).searchParams.get("token")!)) return res.sendStatus(401);
    let payload: unknown;
    try { payload = JSON.parse(req.body.toString("utf8")); }
    catch {
      console.warn(JSON.stringify({ subsystem: "whatsapp", event: "gupshup_invalid_json",
        content_type: req.is("application/json") ? "json" : "other", raw_body: Buffer.isBuffer(req.body) }));
      return res.sendStatus(400);
    }
    const events = parseGupshup(payload, account);
    if (!events) {
      // Record shape only: never log customer content, phone numbers, callback
      // credentials or the full provider payload, even for rejected requests.
      const value = payload as any;
      const safeType = (v: unknown) => typeof v === "string" && /^[a-z_-]{1,32}$/i.test(v) ? v : typeof v;
      const shape = (v: unknown, depth = 0): unknown => {
        if (v === null) return "null";
        if (typeof v !== "object") return typeof v;
        if (Array.isArray(v)) return "array";
        if (depth >= 3) return "object";
        return Object.fromEntries(Object.entries(v).slice(0, 20).map(([key, item]) => [
          /^[a-zA-Z_]{1,32}$/.test(key) ? key : "other_field", shape(item, depth + 1),
        ]));
      };
      console.warn(JSON.stringify({ subsystem: "whatsapp", event: "gupshup_invalid_event",
        structure: shape(value),
        version: [1, 2, "1", "2"].includes(value?.version) ? value.version : typeof value?.version,
        type: safeType(value?.type), message_type: safeType(value?.payload?.type),
        app_matches: value?.app === account.gupshup_app_name,
        app_id_matches: value?.appId == null || value.appId === account.gupshup_app_id,
        timestamp_digits: String(value?.timestamp ?? "").length,
        id_valid: typeof value?.payload?.id === "string" && /^[A-Za-z0-9_+=./:-]{1,256}$/.test(value.payload.id),
        source_valid: typeof value?.payload?.source === "string" && /^[1-9][0-9]{6,14}$/.test(value.payload.source),
        source_type: typeof value?.payload?.source,
        source_length: String(value?.payload?.source ?? "").length,
        source_plus_phone: typeof value?.payload?.source === "string" && /^\+[1-9][0-9]{6,14}$/.test(value.payload.source),
        source_numeric: /^[0-9]+$/.test(String(value?.payload?.source ?? "")),
        sender_phone_valid: typeof value?.payload?.sender?.phone === "string" && /^[1-9][0-9]{6,14}$/.test(value.payload.sender.phone),
        sender_id_valid: businessUserId(value?.payload?.sender?.user_id) || businessUserId(value?.payload?.sender?.userId),
      }));
      return res.sendStatus(400);
    }
    // Persist before acknowledging. The scheduled worker performs AI and sends.
    const accepted = result(await db.rpc("whatsapp_ingest_gupshup", {
      p_restaurant: account.restaurant_id, p_phone: account.phone_id,
      p_secret: account.webhook_secret_ciphertext, p_events: events,
    }));
    if (accepted > 0 && events.some(event => !["status","identity"].includes(event.kind))) wakeWhatsAppWorker(db, fetcher);
    return res.status(accepted < 0 ? 401 : 200).end();
  }));
  router.get(["/webhook", "/webhook/:restaurantId"], (req, res) => {
    const rid = req.params.restaurantId;
    const token = rid ? (uuid(rid) ? manualWebhookToken(rid.toLowerCase()) : null) : process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const challenge = req.query["hub.challenge"];
    if (req.query["hub.mode"] !== "subscribe" || !token || !equalSecret(req.query["hub.verify_token"], token) ||
      typeof challenge !== "string" || !/^\d{1,128}$/.test(challenge)) {
      res.sendStatus(403); return;
    }
    res.set("Cache-Control", "no-store").type("text/plain").send(challenge);
  });
  router.post(["/webhook", "/webhook/:restaurantId"], raw({ type: "application/json", inflate: false, limit: "256kb" }), safeRoute(async (req, res) => {
    if (!db) return res.sendStatus(503);
    const rid = req.params.restaurantId;
    let secret = process.env.WHATSAPP_META_APP_SECRET || "";
    let credential: string | null = null;
    if (rid) {
      if (!uuid(rid)) return res.sendStatus(404);
      const account = result(await db.from("whatsapp_accounts").select("restaurant_id,phone_id,meta_app_id,app_secret_ciphertext")
        .eq("restaurant_id", rid).eq("status", "connected").not("meta_app_id", "is", null).maybeSingle());
      if (!account?.app_secret_ciphertext) return res.sendStatus(401);
      secret = accountAppSecret(account);
      credential = account.app_secret_ciphertext;
    }
    if (!secret) return res.sendStatus(503);
    if (!verifySignature(req.body, req.headers["x-hub-signature-256"], secret)) {
      return res.sendStatus(401);
    }
    let payload: unknown;
    try { payload = JSON.parse(req.body.toString("utf8")); }
    catch { return res.status(400).json({ error: "invalid_webhook" }); }
    const events = parseWebhook(payload);
    if (!events) return res.status(400).json({ error: "invalid_webhook" });
    if (events.length) result(await db.rpc("whatsapp_ingest_verified", {
      p_events: events, p_restaurant: rid || null, p_secret: credential,
    }));
    if (events.some(event => !["status","identity"].includes(event.kind))) wakeWhatsAppWorker(db, fetcher);
    return res.sendStatus(200);
  }));
  router.post("/worker", safeRoute(async (req, res) => {
    if (!db) throw new ApiError(503, "whatsapp_unavailable");
    if (!equalSecret(req.headers.authorization, process.env.WHATSAPP_WORKER_SECRET ? "Bearer " + process.env.WHATSAPP_WORKER_SECRET : "")) {
      throw new ApiError(401, "unauthorized");
    }
    const processed = await runWorker(db, fetcher);
    return res.json({ processed });
  }));
  router.get("/signup/callback", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED !== "true") return res.sendStatus(404);
    const state = req.query.state;
    const cookie = req.headers.cookie?.split(";").map(value => value.trim())
      .find(value => value.startsWith(signupCookie + "="))?.slice(signupCookie.length + 1);
    let restaurantId = "";
    const back = (status: string) => res.redirect(303, "/?" + new URLSearchParams({
      whatsappSignup: status, ...(restaurantId ? { whatsappRestaurant: restaurantId } : {}),
    }).toString());
    if (!uuid(state) || !cookie || !equalSecret(state, cookie)) return back("signup_expired");
    res.clearCookie(signupCookie, signupCookieOptions);
    try {
      if (!db) throw new ApiError(503, "whatsapp_unavailable");
      const session = result(await db.from("whatsapp_signup").select("restaurant_id,user_id")
        .eq("id", state).gt("expires_at", new Date().toISOString()).is("used_at", null).maybeSingle());
      if (!session) return back("signup_expired");
      const identity = await db.auth.admin.getUserById(session.user_id);
      if (identity.error || identity.data.user?.app_metadata?.system_role !== "admin") return back("signup_expired");
      restaurantId = session.restaurant_id;
      if (req.query.error === "access_denied") return back("cancelled");
      if (!result(await db.rpc("restaurant_subscription_active", { rid: session.restaurant_id }))) return back("subscription_inactive");
      await exchangeSignup(db, session.restaurant_id, session.user_id, { signupId: state, code: req.query.code }, fetcher, true);
      return back(state);
    } catch (error) {
      const code = error instanceof ApiError || error instanceof ProviderError ? error.code : "internal_error";
      console.warn(JSON.stringify({ subsystem: "whatsapp", event: "signup_callback_failed", code }));
      return back(code === "signup_expired" ? code : "meta_return_failed");
    }
  });

  router.use(json({ limit: "16kb" }));

  function authorized(action: (db: Db, rid: string, userId: string, req: Request, res: Response) => Promise<unknown>, adminOnly = false) {
    return safeRoute(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!db) throw new ApiError(503, "whatsapp_unavailable");
      const rid = req.params.restaurantId;
      if (!uuid(rid)) throw new ApiError(400, "invalid_restaurant");
      const match = req.headers.authorization?.match(/^Bearer (\S+)$/);
      if (!match) throw new ApiError(401, "unauthorized");
      const { data, error } = await db.auth.getUser(match[1]);
      if (error || !data.user) throw new ApiError(401, "unauthorized");
      const allowed = adminOnly ? data.user.app_metadata?.system_role === "admin" : await isOwner(db, rid, data.user.id);
      if (!allowed) {
        throw new ApiError(403, adminOnly ? "admin_required" : "owner_required");
      }
      return action(db, rid.toLowerCase(), data.user.id, req, res);
    });
  }
  const owner = (action: Parameters<typeof authorized>[0]) => authorized(action);
  const admin = (action: Parameters<typeof authorized>[0]) => authorized(action, true);
  const root = "/restaurants/:restaurantId";
  const gupshupConnection = async (db: Db, rid: string) => gupshupSetup(result(await db.from("whatsapp_accounts")
    .select("restaurant_id,phone_id,waba_id,status,provider,gupshup_app_id,webhook_secret_ciphertext")
    .eq("restaurant_id", rid).eq("provider", "gupshup").eq("status", "connected").maybeSingle()) as Account | null);
  router.get(root + "/connection", admin(async (db, rid, _user, _req, res) => {
    const [accounts, settings, usage] = await Promise.all([
      db.from("whatsapp_accounts").select(publicAccount).eq("restaurant_id", rid).order("operation_at", { ascending: false }).limit(6),
      db.from("whatsapp_settings").select("daily_ai_limit,ai_policy").eq("restaurant_id", rid).maybeSingle(),
      db.rpc("whatsapp_usage_summary", { p_restaurant: rid }),
    ]);
    const rows = result(accounts);
    const account = rows.find(account => account.status !== "disconnected") || rows[0] || null;
    const configured = process.env.WHATSAPP_EMBEDDED_SIGNUP_ENABLED === "true" ? config() : null;
    const metrics = result(usage);
    const rate = Number(process.env.WHATSAPP_GUPSHUP_TEXT_USD_PER_MESSAGE || "0.001");
    return res.json({
      account,
      manual: manualSetup(rid),
      gupshup: await gupshupConnection(db, rid),
      setup: configured ? { appId: configured.appId, configId: configured.configId, version: configured.version } : null,
      limits: result(settings) || { daily_ai_limit: defaultSettings.daily_ai_limit },
      usage: { ...metrics, estimated_provider_usd: account?.provider === "gupshup" && Number.isFinite(rate) && rate >= 0
        ? (metrics.inbound_messages + metrics.outbound_messages) * rate : null },
    });
  }));
  router.put(root + "/limits", admin(async (db, rid, _user, req, res) => {
    const { daily_ai_limit, ai_policy } = req.body ?? {};
    if (!Number.isInteger(daily_ai_limit) || daily_ai_limit < 1 || daily_ai_limit > 500) throw new ApiError(400, "invalid_settings");
    let policy;
    try { policy = parsePolicy(ai_policy); } catch { throw new ApiError(400, "invalid_policy"); }
    result(await db.from("whatsapp_settings").upsert({ restaurant_id: rid, daily_ai_limit, ai_policy: policy }));
    return res.json({ ok: true });
  }));
  router.post(root + "/connection", admin(async (db, rid, _user, req, res) => {
    if (req.body?.provider === "gupshup") await connectGupshup(db, rid, req.body, fetcher);
    else if (req.body?.provider == null || req.body.provider === "meta") await connectManual(db, rid, req.body, fetcher);
    else throw new ApiError(400, "invalid_provider");
    return res.json({ ok: true });
  }));
  router.get(root, owner(async (db, rid, _user, _req, res) => {
    const [accounts, settings, chats, orders, failures] = await Promise.all([
      db.from("whatsapp_accounts").select("status,subscribed").eq("restaurant_id", rid).eq("status", "connected").limit(1),
      db.from("whatsapp_settings").select(ownerSettingsFields).eq("restaurant_id", rid).maybeSingle(),
      db.from("whatsapp_conversations").select(conversationFields).eq("restaurant_id", rid)
        .order("handoff", { ascending: false }).order("last_inbound_at", { ascending: false }).limit(30),
      db.from("whatsapp_orders").select("order_id,created_at,orders(order_number,status,total_amount)")
        .eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(30),
      db.from("whatsapp_jobs").select("id,seq,conversation_id,direction,kind,state,error_code,provider_id,created_at,payload")
        .eq("restaurant_id", rid).in("state", ["failed", "uncertain", "blocked"])
        .order("seq", { ascending: false }).limit(25),
    ]);
    return res.json({
      connected: result(accounts).some(account => account.subscribed),
      settings: result(settings) || ownerSettings(defaultSettings), conversations: result(chats), orders: result(orders),
      failures: result(failures).map(({ provider_id, payload, ...job }) => ({
        ...job, error_code: operationalError(job.error_code), order_number: job.kind === "order_status" ? payload?.order_number : undefined,
        retryable: retryAllowed({ ...job, provider_id } as Parameters<typeof retryAllowed>[0]),
      })),
      aiConfigured: !!aiCredentials().key,
    });
  }));
  router.put(root + "/settings", owner(async (db, rid, _user, req, res) => {
    const settings = parseOwnerSettings(req.body);
    if (settings.delivery_enabled && settings.delivery_zones === undefined) {
      const current=result(await db.from("whatsapp_settings").select("delivery_zones").eq("restaurant_id",rid).maybeSingle());
      if (!current?.delivery_zones?.length) throw new ApiError(400,"delivery_zones_required");
    }
    if (settings.enabled && !aiCredentials().key) {
      throw new ApiError(503, "ai_not_configured");
    }
    result(await db.from("whatsapp_settings").upsert({ restaurant_id: rid, ...settings }));
    return res.json({ settings });
  }));
  router.post(root + "/signup", admin(async (db, rid, userId, req, res) => {
    requireEmbeddedSignup();
    const options = config();
    if (!options) throw new ApiError(503, "meta_not_configured");
    if (!result(await db.rpc("restaurant_subscription_active", { rid }))) throw new ApiError(403, "subscription_inactive");
    const id = result(await db.rpc("whatsapp_begin_signup", { p_restaurant: rid, p_user: userId }));
    if (!id) throw new ApiError(429, "signup_rate_limited");
    if (req.body?.mode === "same_tab") {
      res.cookie(signupCookie, id, { ...signupCookieOptions, maxAge: 15 * 60_000 });
      return res.json({ id, url: signupPage(options, id) });
    }
    return res.json({ id });
  }));
  router.post(root + "/signup/exchange", admin(async (db, rid, userId, req, res) => {
    requireEmbeddedSignup();
    await exchangeSignup(db, rid, userId, req.body, fetcher);
    return res.json({ ok: true });
  }));
  router.post(root + "/signup/complete", admin(async (db, rid, userId, req, res) => {
    requireEmbeddedSignup();
    await completeSignup(db, rid, userId, req.body, fetcher);
    return res.json({ ok: true });
  }));
  router.get(root + "/signup/:id/phones", admin(async (db, rid, userId, req, res) => {
    requireEmbeddedSignup();
    return res.json({ phones: await listSignupPhones(db, rid, userId, req.params.id, fetcher) });
  }));
  router.post(root + "/disconnect", admin(async (db, rid, _user, _req, res) => res.json({ warning: await disconnect(db, rid, fetcher) })));
  router.post(root + "/health", admin(async (db, rid, _user, _req, res) => {
    await checkConnection(db, rid, fetcher);
    return res.json({ ok: true });
  }));
  router.get(root + "/conversations/:id", owner(async (db, rid, _user, req, res) => {
    const id = req.params.id;
    if (!uuid(id)) throw new ApiError(400, "invalid_conversation");
    const conversation = result(await db.from("whatsapp_conversations").select(conversationFields)
      .eq("restaurant_id", rid).eq("id", id).maybeSingle());
    if (!conversation) throw new ApiError(404, "conversation_not_found");
    const before = req.query.before;
    if (before !== undefined && (typeof before !== "string" || !retryCode(before))) throw new ApiError(400, "invalid_cursor");
    const messages = db.from("whatsapp_jobs").select("seq,id,direction,kind,payload,state,error_code,created_at,occurred_at")
      .eq("restaurant_id", rid).eq("conversation_id", id).order("seq", { ascending: false }).limit(40);
    if (before) messages.lt("seq", before);
    const rows = result(await messages);
    return res.json({
      conversation, messages: rows.map(row => ({ ...row, error_code: operationalError(row.error_code) })),
      windowOpen: serviceWindowOpen(conversation.last_inbound_at),
      before: rows.length === 40 ? String(rows.at(-1)?.seq) : null,
    });
  }));
  router.post(root + "/conversations/:id", owner(async (db, rid, _user, req, res) => {
    const { id } = req.params;
    const { action, text, messageId } = req.body ?? {};
    if (!uuid(id) || !["take", "resume", "reply"].includes(action) ||
      (action === "reply" && (!uuid(messageId) || typeof text !== "string" || !text.trim() ||
      text.length > 1500 || text.includes("\0")))) throw new ApiError(400, "invalid_conversation_action");
    const state = result(await db.rpc("whatsapp_handoff_action", {
      p_restaurant: rid, p_conversation: id, p_action: action,
      p_text: action === "reply" ? text.trim() : null, p_message: action === "reply" ? messageId : null,
    }));
    if (state !== "ok") throw new ApiError(state === "conversation_not_found" ? 404 : 409, state);
    return res.json({ ok: true });
  }));
  router.post(root + "/retry/:id", owner(async (db, rid, _user, req, res) => {
    const { id } = req.params;
    if (!uuid(id)) throw new ApiError(400, "invalid_job");
    const job = result(await db.from("whatsapp_jobs").select("*").eq("restaurant_id", rid).eq("id", id).maybeSingle());
    if (!job || !retryAllowed(job)) throw new ApiError(409, "retry_unavailable");
    const current = result(await db.from("orders").select("status").eq("restaurant_id", rid)
      .eq("id", job.payload.order_id).maybeSingle());
    if (current?.status !== job.payload.status) throw new ApiError(409, "status_superseded");
    const updated = result(await db.from("whatsapp_jobs").update({ state: "queued", attempts: 0,
      run_at: new Date().toISOString(), error_code: null }).eq("restaurant_id", rid).eq("id", id)
      .eq("state", "failed").is("provider_id", null).select("id").maybeSingle());
    if (!updated) throw new ApiError(409, "retry_unavailable");
    return res.json({ ok: true });
  }));
  return router;
}
