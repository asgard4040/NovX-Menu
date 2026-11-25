import { randomBytes } from "node:crypto";
import { json, Router, type Request, type RequestHandler, type Response } from "express";
import { decryptPasscode, isPasscode, passcodeKey } from "../passcodes";
import { STAFF_ORIGIN, staffPortalUrl } from "../src/lib/public-urls";
import { invitationTemplate } from "../src/lib/platform-whatsapp-templates";
import { gupshupRequest, verifyGupshup } from "./gupshup";
import { encryptionKey, equalSecret, ProviderError, seal, unseal, uuid } from "./meta";
import { ApiError } from "./onboarding";
import { result, type Db } from "./worker";

type TemplateKind = "invite" | "renewed" | "expired";
type JobKind = TemplateKind | "manual";
type SendJob = {
  id: string; restaurant_id: string; user_id: string; kind: JobKind; period_end: string | null;
  template_id: string | null; attempts: number;
};
type Sender = {
  app_id: string; app_name: string; source: string; key_ciphertext: string;
  callback_ciphertext: string; connected_at: string; templates: Partial<Record<TemplateKind, string>>;
};
type Template = { id: string; name: string; body: string; count: number; category: string };
const senderKey = (app: string) => "platform-key:" + app;
const callbackKey = (app: string) => "platform-webhook:" + app;
const callbackPath = "/api/whatsapp/platform/webhook";
const kinds: TemplateKind[] = ["invite", "renewed", "expired"];
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_+=./:-]{1,256}$/.test(value);

export function platformPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 50) return null;
  let digits = value.trim()
    .replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) >= 1776 ? char.charCodeAt(0) - 1776 : char.charCodeAt(0) - 1632))
    .replace(/[\s()-]/g, "").replace(/^(?:\+|00)/, "");
  if (/^07\d{9}$/.test(digits)) digits = "964" + digits.slice(1);
  return /^[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}

function key() {
  const value = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  if (!value) throw new ApiError(503, "credential_unavailable");
  return value;
}
function token(sender: Sender) {
  return unseal(sender.key_ciphertext, key(), senderKey(sender.app_id));
}
function readSender(db: Db) {
  return db.from("platform_whatsapp_sender").select("*").eq("id", true).maybeSingle()
    .then(response => result(response) as Sender | null);
}
function callbackToken(sender: Sender) {
  return unseal(sender.callback_ciphertext, key(), callbackKey(sender.app_id));
}
function callbackUrl(sender: Sender) {
  const url = new URL(callbackPath, process.env.WHATSAPP_WEBHOOK_ORIGIN || STAFF_ORIGIN);
  if (url.protocol !== "https:" || url.username || url.password) throw new ApiError(503, "invalid_callback_origin");
  url.searchParams.set("token", callbackToken(sender));
  return url.toString();
}

function asTemplate(value: any): Template | null {
  const category = String(value?.category ?? "").toUpperCase();
  if (!uuid(value?.id) || typeof value?.status !== "string" || value.status.toUpperCase() !== "APPROVED" ||
    !["UTILITY", "MARKETING"].includes(category)) return null;
  const raw = value.containerMeta ?? value.data;
  let content = raw;
  if (typeof content === "string") {
    try { content = JSON.parse(content); } catch { content = undefined; }
  }
  const components = Array.isArray(value.components) ? value.components : content?.components;
  if (Array.isArray(components) && components.some(component => !["BODY", "FOOTER"].includes(String(component?.type).toUpperCase()))) return null;
  if (value.buttons?.length || content?.buttons?.length || content?.header ||
    (value.templateType != null && String(value.templateType).toUpperCase() !== "TEXT")) return null;
  const body = components?.find((component: any) => String(component.type).toUpperCase() === "BODY")?.text ??
    value.content ?? content?.data ?? content?.body ?? value.body ??
    (typeof value.data === "string" && !value.data.includes(" | ") ? value.data : null);
  if (typeof body !== "string" || !body.trim() || body.length > 2048) return null;
  const indices = [...new Set([...body.matchAll(/{{\s*(\d+)\s*}}/g)].map(match => Number(match[1])))].sort((a, b) => a - b);
  if (indices.some((index, i) => index !== i + 1) || /{{/.test(body.replace(/{{\s*\d+\s*}}/g, ""))) return null;
  const name = value.elementName ?? value.name;
  return { id: value.id.toLowerCase(), name: typeof name === "string" ? name.slice(0, 100) : value.id, body, count: indices.length, category };
}

async function verifiedTemplate(sender: Sender, id: string, kind: JobKind, fetcher: typeof fetch) {
  const data = await gupshupRequest("wa/app/" + sender.app_id + "/template/" + id, token(sender), fetcher);
  const row = data.template ?? data;
  const template = asTemplate(row);
  if (!template || template.id !== id || (kind === "manual"
    ? template.count > 1 : template.category !== "UTILITY" || template.count !== (kind === "invite" ? 3 : 2))) {
    throw new ApiError(422, "template_not_approved_or_format");
  }
  if (kind === "invite" && !Object.values(invitationTemplate).some(body => body === template.body.replace(/\r\n/g, "\n").trim())) {
    throw new ApiError(422, "template_not_approved_or_format");
  }
  return template;
}
function preview(template: Template, params: string[]) {
  return template.body.replace(/{{\s*(\d+)\s*}}/g, (_match, index) => params[Number(index) - 1] ?? "");
}

async function ownerOf(db: Db, rid: string) {
  const owners = result(await db.from("restaurant_members").select("user_id").eq("restaurant_id", rid)
    .eq("role", "owner").eq("active", true).limit(2));
  return owners.length === 1 ? owners[0].user_id as string : null;
}
async function recipient(db: Db, rid: string, uid: string) {
  const [venue, membership, consent] = await Promise.all([
    db.from("restaurants").select("restaurant_name,manager_phone").eq("id", rid).maybeSingle(),
    db.from("restaurant_members").select("role").eq("restaurant_id", rid).eq("user_id", uid).eq("active", true).maybeSingle(),
    db.from("platform_whatsapp_consents").select("phone").eq("restaurant_id", rid).eq("user_id", uid).maybeSingle(),
  ]);
  const restaurant = result(venue), member = result(membership), permitted = result(consent);
  if (!restaurant || !member || !permitted) return null;
  const role = member.role as "owner" | "manager" | "waiter" | "kitchen" | "cashier";
  const row = role === "owner" ? null : result(await db.from("staff").select("phone,role,status")
    .eq("restaurant_id", rid).eq("auth_user_id", uid).maybeSingle());
  if (role !== "owner" && (!row || row.role !== role || row.status !== "active")) return null;
  const phone = platformPhone(role === "owner" ? restaurant.manager_phone : row?.phone);
  return phone && phone === permitted.phone ? { phone, role, name: restaurant.restaurant_name as string } : null;
}

export async function recordPlatformConsent(db: Db, options: {
  restaurantId: string; userId: string; actorId: string; phone: unknown; allowed: boolean;
}) {
  const { restaurantId, userId, actorId, allowed } = options;
  const phone = platformPhone(options.phone);
  if (!allowed) {
    result(await db.from("platform_whatsapp_consents").delete().eq("restaurant_id", restaurantId).eq("user_id", userId));
    return;
  }
  if (!phone) throw new ApiError(400, "invalid_phone");
  result(await db.from("platform_whatsapp_consents").upsert({
    restaurant_id: restaurantId, user_id: userId, phone, granted_by: actorId, granted_at: new Date().toISOString(),
  }));
}

export async function queuePlatformInvitation(db: Db, options: {
  restaurantId: string; userId: string; actorId: string; phone: unknown;
}) {
  try {
    await recordPlatformConsent(db, { ...options, allowed: true });
    result(await db.from("platform_whatsapp_outbox").upsert({
      restaurant_id: options.restaurantId, user_id: options.userId, kind: "invite",
      event_key: "invite:" + options.restaurantId + ":" + options.userId,
    }, { onConflict: "event_key", ignoreDuplicates: true }));
    return "queued";
  } catch {
    console.warn(JSON.stringify({ subsystem: "platform_whatsapp", event: "invitation_queue_failed" }));
    return "unavailable";
  }
}

async function currentPin(db: Db, restaurantId: string, userId: string, role: string) {
  const row = result(await db.from("staff_passcodes").select("code_ciphertext")
    .eq("restaurant_id", restaurantId).eq("user_id", userId).eq("role", role).maybeSingle());
  if (!row) return null;
  const pin = decryptPasscode(row.code_ciphertext, passcodeKey(process.env.PASSCODE_SECRET || ""));
  return isPasscode(pin) ? pin : null;
}

export async function runPlatformWhatsApp(db: Db, fetcher: typeof fetch) {
  const [sender, jobs] = await Promise.all([
    readSender(db), db.rpc("platform_whatsapp_claim").then(response => result(response) as SendJob[]),
  ]);
  const templates = new Map<string, Promise<Template>>();
  await Promise.all(jobs.map(async job => {
    let lastFour: string | null = null;
    const finish = async (state: string, reason: string, postpone = 0) => {
      result(await db.from("platform_whatsapp_outbox").update({
        state, reason, phone_last_four: lastFour, updated_at: new Date().toISOString(),
        ...(postpone ? { run_at: new Date(Date.now() + postpone * 1000).toISOString() } : {}),
      }).eq("id", job.id).eq("state", "sending"));
    };
    try {
      if (!sender) return await finish("skipped", "sender_not_connected");
      const templateId = job.kind === "manual" ? job.template_id : sender.templates[job.kind];
      if (!templateId) return await finish("skipped", "template_not_configured");
      const cacheKey = job.kind + ":" + templateId;
      if (!templates.has(cacheKey)) templates.set(cacheKey, verifiedTemplate(sender, templateId, job.kind, fetcher));
      const template = await templates.get(cacheKey)!;
      const currentSender = await readSender(db);
      if (!currentSender || currentSender.app_id !== sender.app_id || currentSender.key_ciphertext !== sender.key_ciphertext ||
        (job.kind !== "manual" && currentSender.templates[job.kind] !== templateId)) {
        return await finish("skipped", "sender_changed");
      }
      const contact = await recipient(db, job.restaurant_id, job.user_id);
      if (!contact || (job.kind !== "invite" && contact.role !== "owner")) return await finish("skipped", "consent_missing");
      lastFour = contact.phone.slice(-4);
      const name = contact.name.replace(/\s+/g, " ").trim().slice(0, 160);
      let params = template.count ? [name] : [];
      if (job.kind === "invite") {
        const pin = await currentPin(db, job.restaurant_id, job.user_id, contact.role);
        if (!pin) return await finish("skipped", "passcode_unavailable");
        const portal = contact.role === "owner" || contact.role === "manager" ? "restaurant" : contact.role;
        params = [name, staffPortalUrl(job.restaurant_id, portal), pin];
      } else if (job.kind !== "manual") {
        const date = job.period_end && result(await db.rpc("platform_whatsapp_period_date", {
          p_restaurant: job.restaurant_id, p_kind: job.kind, p_period: job.period_end,
        }));
        if (!date) return await finish("skipped", "subscription_changed");
        params = [name, new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeZone: "Asia/Baghdad" }).format(new Date(date))];
      }
      result(await db.from("platform_whatsapp_outbox").update({ phone_last_four: lastFour })
        .eq("id", job.id).eq("state", "sending"));
      const response = await gupshupRequest("wa/api/v1/template/msg", token(sender), fetcher, new URLSearchParams({
        channel: "whatsapp", source: sender.source, destination: contact.phone, "src.name": sender.app_name,
        template: JSON.stringify({ id: template.id, params }),
      }));
      if (!identifier(response.messageId)) throw new ProviderError("gupshup_missing_message_id", false, true);
      result(await db.rpc("platform_whatsapp_submitted", { p_job: job.id, p_app: sender.app_id, p_provider: response.messageId }));
    } catch (error) {
      if (error instanceof ProviderError && error.uncertain) return await finish("uncertain", error.code);
      if (error instanceof ProviderError && error.retryable && job.attempts < 3) {
        return await finish("queued", error.code, Math.max(30, Math.min(error.retryAfter || 0, 300)));
      }
      if (error instanceof ProviderError || error instanceof ApiError) return await finish("failed", error.code);
      // A failed database write after provider acceptance has an unknown outcome.
      return await finish("uncertain", "worker_error");
    }
  }));
  return jobs.length;
}

function route(action: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    void action(req, res).catch((error: unknown) => {
      if (error instanceof ApiError || error instanceof ProviderError) {
        const status = error instanceof ApiError ? error.status : error.retryable ? 503 : 422;
        return res.status(status).json({ error: error.code });
      }
      console.warn(JSON.stringify({ subsystem: "platform_whatsapp", event: "request_failed" }));
      return res.status(503).json({ error: "platform_whatsapp_unavailable" });
    });
  };
}

export function platformWhatsAppRouter(db: Db | null, fetcher: typeof fetch) {
  const router = Router();
  router.use(json({ limit: "32kb" }));
  router.post("/worker", route(async (req, res) => {
    if (!db) throw new ApiError(503, "platform_whatsapp_unavailable");
    const secret = process.env.WHATSAPP_WORKER_SECRET;
    if (!secret || !equalSecret(req.headers.authorization, "Bearer " + secret)) throw new ApiError(401, "unauthorized");
    return res.json({ processed: await runPlatformWhatsApp(db, fetcher) });
  }));
  router.get("/webhook", route(async (req, res) => {
    const sender = db && await readSender(db);
    if (!sender || !equalSecret(req.query.token, callbackToken(sender))) return res.sendStatus(401);
    return res.status(200).end();
  }));
  router.post("/webhook", route(async (req, res) => {
    if (!db) throw new ApiError(503, "platform_whatsapp_unavailable");
    const sender = await readSender(db);
    if (!sender || !equalSecret(req.query.token, callbackToken(sender))) return res.sendStatus(401);
    const body = req.body;
    if (!body?.type && !body?.app) return res.status(200).end();
    if (body.app !== sender.app_name || (body.appId && body.appId !== sender.app_id)) return res.sendStatus(401);
    const event = body.payload;
    if (body.type === "message-event" && ["sent", "delivered", "read", "failed"].includes(event?.type)) {
      const id = event.gsId || event.id;
      if (identifier(id)) result(await db.rpc("platform_whatsapp_delivery", { p_app: sender.app_id, p_provider: id, p_state: event.type }));
    }
    if (body.type === "message" && event?.type === "text" && typeof event.payload?.text === "string" &&
      /^(?:stop|unsubscribe|إيقاف|ايقاف|الغاء الاشتراك|إلغاء الاشتراك)$/i.test(event.payload.text.trim())) {
      const source = platformPhone(event.source);
      const senderPhone = platformPhone(event.sender?.phone);
      const phone = source && senderPhone && source !== senderPhone ? null : senderPhone ?? source;
      const timestamp = Number(body.timestamp);
      if (phone && Number.isSafeInteger(timestamp) && timestamp >= 1e9) {
        const sent = new Date(Math.min(Date.now(), timestamp < 1e12 ? timestamp * 1000 : timestamp));
        result(await db.from("platform_whatsapp_consents").delete().eq("phone", phone).lte("granted_at", sent.toISOString()));
      }
    }
    return res.status(200).end();
  }));
  function admin(action: (db: Db, userId: string, req: Request, res: Response) => Promise<unknown>) {
    return route(async (req, res) => {
      if (!db) throw new ApiError(503, "platform_whatsapp_unavailable");
      const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!bearer) throw new ApiError(401, "unauthorized");
      const identity = await db.auth.getUser(bearer);
      const user = identity.data?.user;
      if (!user || user.app_metadata?.system_role !== "admin") throw new ApiError(403, "admin_required");
      return action(db, user.id, req, res);
    });
  }
  const requiredSender = async (db: Db) => {
    const sender = await readSender(db);
    if (!sender) throw new ApiError(409, "sender_not_connected");
    return sender;
  };
  router.get("/", admin(async (db, _user, _req, res) => {
    const [sender, history] = await Promise.all([
      readSender(db),
      db.from("platform_whatsapp_outbox").select("id,restaurant_id,kind,state,reason,phone_last_four,created_at")
        .order("created_at", { ascending: false }).limit(50),
    ]);
    const rows = result(history);
    const ids = [...new Set(rows.map(row => row.restaurant_id).filter(Boolean))];
    const venues = ids.length ? result(await db.from("restaurants").select("id,restaurant_name").in("id", ids)) : [];
    const names = new Map(venues.map(row => [row.id, row.restaurant_name]));
    return res.json({ sender: sender ? {
      appId: sender.app_id, appName: sender.app_name, source: sender.source,
      templates: sender.templates, callback: callbackUrl(sender), verifiedAt: sender.connected_at,
    } : null, history: rows.map(row => ({ ...row, restaurant_name: names.get(row.restaurant_id) })) });
  }));
  router.put("/connection", admin(async (db, _user, req, res) => {
    const { appId, appName, source, apiKey } = req.body ?? {};
    const phone = platformPhone(source);
    if (!uuid(appId) || typeof appName !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(appName) || !phone ||
      typeof apiKey !== "string" || !/^[A-Za-z0-9_+=./-]{16,4096}$/.test(apiKey)) throw new ApiError(400, "invalid_gupshup_credentials");
    const app = appId.toLowerCase();
    const encryption = key();
    await verifyGupshup(app, apiKey, fetcher);
    const existing = await readSender(db);
    const same = existing?.app_id === app && existing.source === phone && existing.app_name === appName;
    const saved = await db.from("platform_whatsapp_sender").upsert({
      id: true, app_id: app, app_name: appName, source: phone, key_ciphertext: seal(apiKey, encryption, senderKey(app)),
      callback_ciphertext: same ? existing.callback_ciphertext : seal(randomBytes(32).toString("base64url"), encryption, callbackKey(app)),
      templates: same ? existing.templates : {}, connected_at: new Date().toISOString(),
    });
    if (saved.error?.message === "platform_sender_already_in_use") throw new ApiError(409, "platform_sender_already_in_use");
    result(saved);
    return res.json({ ok: true });
  }));
  router.delete("/connection", admin(async (db, _user, _req, res) => {
    result(await db.from("platform_whatsapp_sender").delete().eq("id", true));
    return res.json({ ok: true });
  }));
  router.post("/connection/test", admin(async (db, _user, _req, res) => {
    const sender = await requiredSender(db);
    await verifyGupshup(sender.app_id, token(sender), fetcher);
    return res.json({ ok: true });
  }));
  router.get("/templates", admin(async (db, _user, _req, res) => {
    const sender = await requiredSender(db);
    const data = await gupshupRequest("wa/app/" + sender.app_id + "/template?templateStatus=APPROVED&templateType=TEXT&pageSize=100", token(sender), fetcher);
    const rows = Array.isArray(data.templates) ? data.templates : Array.isArray(data.templates?.content) ? data.templates.content : [];
    return res.json({ templates: rows.map(asTemplate).filter((row: Template | null) => row && row.count <= 1) });
  }));
  router.put("/templates", admin(async (db, _user, req, res) => {
    const sender = await requiredSender(db);
    const templates: Sender["templates"] = {};
    await Promise.all(kinds.map(async kind => {
      const value = req.body?.[kind];
      if (value == null || value === "") return;
      if (!uuid(value)) throw new ApiError(400, "invalid_template");
      templates[kind] = (await verifiedTemplate(sender, value.toLowerCase(), kind, fetcher)).id;
    }));
    const updated = result(await db.from("platform_whatsapp_sender").update({ templates })
      .eq("app_id", sender.app_id).eq("key_ciphertext", sender.key_ciphertext).select("id").maybeSingle());
    if (!updated) throw new ApiError(409, "sender_changed");
    return res.json({ ok: true });
  }));
  router.get("/receivers", admin(async (db, _user, req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 80).replace(/[%_\\]/g, "") : "";
    const offset = typeof req.query.offset === "string" && /^\d{1,5}$/.test(req.query.offset) ? Number(req.query.offset) : 0;
    const restaurants = db.from("restaurants").select("id,restaurant_name,manager_phone").order("restaurant_name").order("id").range(offset, offset + 49);
    if (search) restaurants.ilike("restaurant_name", "%" + search + "%");
    const rows = result(await restaurants);
    const ids = rows.map(row => row.id);
    const owners = ids.length ? result(await db.from("restaurant_members").select("restaurant_id,user_id").eq("active", true)
      .eq("role", "owner").in("restaurant_id", ids)) : [];
    const consents = ids.length ? result(await db.from("platform_whatsapp_consents").select("restaurant_id,user_id,phone")
      .in("restaurant_id", ids).in("user_id", owners.length ? owners.map(row => row.user_id) : ["00000000-0000-0000-0000-000000000000"])) : [];
    return res.json({ receivers: rows.map(row => {
      const phone = platformPhone(row.manager_phone);
      const active = owners.filter(owner => owner.restaurant_id === row.id);
      const allowed = active.length === 1 && !!phone && consents.some(consent => consent.restaurant_id === row.id &&
        consent.user_id === active[0].user_id && consent.phone === phone);
      return { id: row.id, name: row.restaurant_name, lastFour: phone?.slice(-4) ?? null, allowed, eligible: !!phone && active.length === 1 };
    }), next: rows.length === 50 ? offset + 50 : null });
  }));
  router.put("/receivers/:restaurantId", admin(async (db, userId, req, res) => {
    const rid = req.params.restaurantId;
    const allowed = req.body?.allowed;
    if (!uuid(rid) || typeof allowed !== "boolean") throw new ApiError(400, "invalid_receiver");
    const [owner, venue] = await Promise.all([
      ownerOf(db, rid),
      db.from("restaurants").select("manager_phone").eq("id", rid).maybeSingle(),
    ]);
    if (!owner || !venue.data) throw new ApiError(404, "restaurant_owner_not_found");
    await recordPlatformConsent(db, { restaurantId: rid, userId: owner, actorId: userId, allowed, phone: venue.data.manager_phone });
    return res.json({ ok: true });
  }));
  router.post("/manual", admin(async (db, _user, req, res) => {
    const { templateId, restaurants, requestId } = req.body ?? {};
    if (!uuid(templateId) || !Array.isArray(restaurants) || restaurants.length < 1 || restaurants.length > 100 ||
      !restaurants.every(uuid) || (requestId != null && !uuid(requestId))) throw new ApiError(400, "invalid_message");
    const sender = await requiredSender(db);
    const template = await verifiedTemplate(sender, templateId.toLowerCase(), "manual", fetcher);
    const ids = [...new Set<string>(restaurants.map((id: string) => id.toLowerCase()))];
    const [owners, venues, permissions] = await Promise.all([
      db.from("restaurant_members").select("restaurant_id,user_id").eq("role", "owner").eq("active", true).in("restaurant_id", ids),
      db.from("restaurants").select("id,restaurant_name,manager_phone").in("id", ids),
      db.from("platform_whatsapp_consents").select("restaurant_id,user_id,phone").in("restaurant_id", ids),
    ]);
    const members = result(owners), grants = result(permissions);
    const recipients = result(venues).flatMap(venue => {
      const people = members.filter(owner => owner.restaurant_id === venue.id);
      if (people.length !== 1 || !grants.some(grant => grant.restaurant_id === venue.id && grant.user_id === people[0].user_id &&
        grant.phone === platformPhone(venue.manager_phone))) return [];
      return [{ id: venue.id as string, uid: people[0].user_id as string, name: venue.restaurant_name as string }];
    });
    if (!recipients.length) throw new ApiError(409, "consent_missing");
    if (!requestId) return res.json({
      count: recipients.length, excluded: ids.length - recipients.length,
      sample: preview(template, [recipients[0].name]), template: template.name, recipients: recipients.map(contact => contact.id),
    });
    const queued = result(await db.from("platform_whatsapp_outbox").upsert(recipients.map(contact => ({
      restaurant_id: contact.id, user_id: contact.uid, kind: "manual", template_id: template.id,
      event_key: "manual:" + requestId.toLowerCase() + ":" + contact.id,
    })), { onConflict: "event_key", ignoreDuplicates: true }).select("id"));
    return res.json({ queued: queued.length, count: recipients.length });
  }));
  return router;
}
