import type { SupabaseClient } from "@supabase/supabase-js";
import {
  agentText, aiCredentials, confirmation, defaultSettings, interpret, menuText, orderStatusText, quoteReply, shortlist, requestReservation, verifiedPrice, publicText,
  type CartItem, type Locale, type MenuItem, type Reply, type Settings,
} from "./agent";
import { defaultPolicy, fastIntent, messageLocale, normalizeMessage, scopeViolation } from "./policy";
import { factReply, restaurantFacts, searchTerms } from "./context";
import { deliveryControl, progressDelivery } from "./delivery";
import type { DeliveryState } from "./delivery-data";
import { customerMenuUrl } from "../src/lib/public-urls";
import { sendGupshup } from "./gupshup";
import { customerPhone, encryptionKey, graph, ProviderError, serviceWindowOpen, unseal, uuid } from "./meta";

export type Db = SupabaseClient<any, "public", any>;
export type Job = {
  id: string; restaurant_id: string; conversation_id: string; lease: string; direction: "in" | "out";
  attempts: number; kind: string; payload: any; occurred_at: string; created_at: string;
};
export type Conversation = {
  id: string; restaurant_id: string; phone_id: string; customer_id: string; locale: Locale; handoff: boolean;
  last_inbound_at: string; processed_at: string | null; draft: CartItem[]; quote_id: string | null;
  whatsapp_sender_phone?: string | null; delivery_state?: DeliveryState;
};
export type Account = {
  restaurant_id: string; phone_id: string; waba_id: string; status: string; subscribed: boolean; operation_at: string;
  token_ciphertext: string | null; token_expires_at: string | null; data_access_expires_at: string | null;
  meta_app_id?: string | null; app_secret_ciphertext?: string | null;
  provider?: "meta" | "gupshup"; gupshup_app_id?: string | null; gupshup_app_name?: string | null;
  gupshup_source?: string | null; webhook_secret_ciphertext?: string | null;
};
type DbResult<T> = { data: T; error: { code?: string } | null };
export function result<T>(response: DbResult<T>): T {
  if (response.error) throw new Error("db_" + (response.error.code || "error"));
  return response.data;
}

export function tokenExpired(account: Account) {
  return [account.token_expires_at, account.data_access_expires_at].some(time => time && Date.parse(time) <= Date.now());
}

export function accountToken(account: Account) {
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  if (!key || !account.token_ciphertext) throw new ProviderError("credential_unavailable");
  try {
    return unseal(account.token_ciphertext, key, account.restaurant_id + ":" + account.phone_id);
  } catch {
    throw new ProviderError("credential_invalid");
  }
}

export function accountAppSecret(account: Pick<Account, "meta_app_id" | "app_secret_ciphertext" | "restaurant_id" | "phone_id">) {
  if (!account.meta_app_id) {
    const secret = process.env.WHATSAPP_META_APP_SECRET;
    if (!secret) throw new ProviderError("meta_not_configured");
    return secret;
  }
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  if (!key || !account.app_secret_ciphertext) throw new ProviderError("credential_unavailable");
  try {
    return unseal(account.app_secret_ciphertext, key, "app:" + account.restaurant_id + ":" + account.phone_id);
  } catch {
    throw new ProviderError("credential_invalid");
  }
}

export function whatsappLog(event: string, job: Job, code: string) {
  console.warn(JSON.stringify({ subsystem: "whatsapp", event, job_id: job.id, conversation_id: job.conversation_id, restaurant_id: job.restaurant_id, code }));
}

const safeError = (error: unknown) => error instanceof ProviderError ? error :
  new ProviderError(error instanceof Error && /^db_[A-Za-z0-9_]+$/.test(error.message) ? error.message : "worker_error", true);

async function readAccount(db: Db, c: Conversation): Promise<Account | null> {
  return result(await db.from("whatsapp_accounts").select(
    "restaurant_id,phone_id,waba_id,status,subscribed,operation_at,token_ciphertext,token_expires_at,data_access_expires_at,meta_app_id,app_secret_ciphertext,provider,gupshup_app_id,gupshup_app_name,gupshup_source",
  ).eq("restaurant_id", c.restaurant_id).eq("phone_id", c.phone_id).maybeSingle());
}

async function finish(db: Db, job: Job, values: object, state = "processing") {
  return result(await db.from("whatsapp_jobs").update(values).eq("id", job.id).eq("restaurant_id", job.restaurant_id)
    .eq("lease", job.lease).eq("state", state).select("id").maybeSingle());
}

async function complete(db: Db, job: Job, locale: Locale, action: string, reply?: Reply,
  draft?: CartItem[], quoteId?: string, price?: object) {
  return result(await db.rpc("whatsapp_complete", {
    p_job: job.id, p_lease: job.lease, p_locale: locale, p_action: action, p_draft: draft ?? null,
    p_quote_id: quoteId ?? null, p_quote: price ?? null, p_reply: reply ?? null,
  }));
}

async function inbound(db: Db, job: Job, c: Conversation, account: Account | null, settings: Settings, fetcher: typeof fetch) {
  let fallback = messageLocale(job.payload.text || "", c.processed_at ? c.locale : settings.language);
  if (account?.status !== "connected" || !account.subscribed || tokenExpired(account) || !settings.enabled || c.handoff || !serviceWindowOpen(job.occurred_at) ||
      (c.processed_at && Date.parse(job.occurred_at) < Date.parse(c.processed_at)) ||
      !result(await db.rpc("restaurant_subscription_active", { rid: job.restaurant_id }))) {
    await complete(db, job, fallback, "skip");
    return;
  }
  const policy = { ...defaultPolicy, ...settings.ai_policy };
  const reply = (text: string) => complete(db, job, fallback, "reply", {
    text: text.length <= policy.max_response_chars ? text : agentText.noDetails(fallback),
  });
  const limitedNotice = async (reason: string, text: string) => {
    if (result(await db.rpc("whatsapp_scope_notice", { p_job: job.id, p_lease: job.lease, p_reason: reason }))) await reply(text);
    else await complete(db, job, fallback, "skip");
  };
  const admission = result(await db.rpc("whatsapp_prepare_inbound", { p_job: job.id, p_lease: job.lease }));
  if (admission.gate === "skip") { await complete(db, job, fallback, "skip"); return; }
  if (admission.gate === "notice") { await reply(agentText.quota(fallback)); return; }
  job.payload = admission.payload;
  job.occurred_at = admission.occurred_at;
  const text: string = job.payload.text ?? "";
  fallback = messageLocale(text, fallback);
  if (scopeViolation(text)) {
    if (result(await db.rpc("whatsapp_scope_notice", { p_job: job.id, p_lease: job.lease }))) await reply(agentText.unsupported(fallback));
    else await complete(db, job, fallback, "skip");
    return;
  }
  if (await deliveryControl(db,job,c,settings,fallback)) return;
  if (/^(ثبتت الطلب|انثبت الطلب|تم تثبيت الطلب|did you (place|confirm) (the |my )?order|is my order confirmed)$/.test(normalizeMessage(text))) {
    const order=await latestOrder(db,c);
    await reply(order ? orderStatusText(order.status,order.order_number,fallback,order.device_metadata?.fulfillment) : agentText.noOrder(fallback));return;
  }
  if (job.kind === "location" && settings.delivery_enabled) { await progressDelivery(db,job,c,settings,fallback); return; }
  if (c.quote_id && (job.kind === "button" || /ثبت|confirm/i.test(text))) {
    const quote = result(await db.from("whatsapp_jobs").select("provider_id").eq("restaurant_id", job.restaurant_id)
      .eq("conversation_id", c.id).eq("direction", "out").eq("dedupe_key", "quote:" + c.quote_id).maybeSingle());
    if (confirmation(job.payload, c.quote_id, quote?.provider_id)) {
      const state = await complete(db, job, fallback, "confirm", undefined, undefined, c.quote_id);
      if (state === "quote_changed") await complete(db, job, fallback, "reset_quote", { text: agentText.changed(fallback) });
      if (state === "confirmation_expired") await reply(agentText.expired(fallback));
      if (state === "ordering_closed") await reply(agentText.closed(fallback));
      return;
    }
  }
  if (job.kind === "button" || /^(?:confirm|ثبت) [a-f0-9]{8}$/i.test(text)) {
    await reply(agentText.expired(fallback));
    return;
  }
  if (job.kind !== "text" || !text) { await limitedNotice("unsupported", agentText.unsupported(fallback)); return; }
  const fast = fastIntent(text);
  if (fast) {
    if (fast === "menu") await reply((fallback === "ar" ? "تگدر تشوف المنيو وتختار من هنا: " : "Browse the menu here: ")+customerMenuUrl(job.restaurant_id));
    else await reply(factReply(fast, await restaurantFacts(db, job.restaurant_id), settings, fallback));
    return;
  }
  const credentials = aiCredentials();
  const runtime = settings.runtime_config?.model ? settings.runtime_config : undefined;
  const model = runtime?.model || credentials.model, key = credentials.key;
  if (!key) { await limitedNotice("ai_unavailable", agentText.quota(fallback)); return; }
  const [historyResponse, restaurant, order] = await Promise.all([
    db.from("whatsapp_jobs").select("direction,payload").eq("restaurant_id", job.restaurant_id).eq("conversation_id", c.id)
      .in("state", ["done", "accepted", "sent", "delivered", "read"]).in("kind", ["text", "reply"])
      .order("seq", { ascending: false }).limit(4),
    restaurantFacts(db, job.restaurant_id),
    latestOrder(db, c),
  ]);

  const history = result(historyResponse).reverse().filter(row => typeof row.payload?.text === "string").map(row =>
    (row.direction === "in" ? "Customer: " : "Assistant: ") + row.payload.text.slice(0, 240));
  const rows: MenuItem[] = result(await db.rpc("whatsapp_menu_context", { p_restaurant: job.restaurant_id,
    p_terms: searchTerms(text+" "+history.slice(-2).join(" ")), p_ids: c.draft.map(item => item.id) }))
    .filter((item: MenuItem) => publicText(item.name));
  const candidates = shortlist(rows, text, c.draft);
  const input = { text, menu: candidates, history, draft: c.draft, locale: fallback, pickupQuoted: !!c.quote_id && c.delivery_state?.fulfillment!=="delivery",
    hasActiveOrder: !!order && ["pending", "preparing", "ready"].includes(order.status),
    ...(settings.delivery_enabled ? { deliveryContext:{ enabled:true,awaitingField:c.delivery_state?.awaitingField,
      hasAddress:!!c.delivery_state?.address?.details,hasContact:!!c.delivery_state?.deliveryContactPhone,hasSenderPhone:!!c.whatsapp_sender_phone } } : {}) };
  const reserved = requestReservation(input, model, runtime);
  if (reserved === null || !result(await db.rpc("whatsapp_reserve_ai", { p_job: job.id, p_lease: job.lease, p_model: model, p_reserved_usd: reserved }))) {
    await limitedNotice("ai_budget", agentText.quota(fallback));
    return;
  }
  const modelStarted=Date.now();
  let interpretation: Awaited<ReturnType<typeof interpret>>;
  try {
    interpretation = await interpret(input, model, key, fetcher, runtime);
  } catch (error) {
    if (error instanceof ProviderError && (!error.retryable || job.attempts >= 5)) {
      whatsappLog("ai_unavailable", job, error.code);
      await limitedNotice("ai_unavailable", agentText.quota(fallback));
      return;
    }
    throw error;
  }
  if (interpretation.usage.input_tokens !== undefined) {
    result(await db.from("whatsapp_usage").update({...interpretation.usage, latency_ms:Date.now()-modelStarted, ...(runtime ? {pricing_snapshot:runtime} : {})}).eq("job_id", job.id)
      .eq("restaurant_id", job.restaurant_id).eq("attempt", job.attempts));
  }
  const d = interpretation.decision;
  const locale = d?.locale ?? fallback;
  const ar = locale === "ar";
  const say = (message: string, action = "reply", draft?: CartItem[]) =>
    complete(db, job, locale, action, { text: message.length <= policy.max_response_chars ? message : agentText.noDetails(locale) }, draft);
  const menuUrl = customerMenuUrl(job.restaurant_id);
  if (!d) { await say(agentText.clarify(locale)); return; }
  const explicitPickup=/استلام|pickup|takeaway/i.test(text) && !/توصيل|delivery/i.test(text);
  const existingPickup=c.delivery_state?.fulfillment === ("pickup" as string);
  if (settings.delivery_enabled && !explicitPickup && (!existingPickup || /توصيل|delivery/i.test(text)) &&
    (["draft","quote_pickup","delivery"].includes(d.action) || !!d.delivery_address && (c.delivery_state?.fulfillment==="delivery" || d.items.length>0))) {
    await progressDelivery(db,job,c,settings,locale,d.items.length?d.items:undefined,d.delivery_address || undefined);return;
  }
  let refreshed: MenuItem[] = [];
  if (["ingredients", "menu", "details"].includes(d.action)) {
    const ids = d.menu_ids.length ? d.menu_ids : candidates.slice(0,3).map(item => item.id);
    if (ids.length) refreshed = result(await db.from("menu_items").select("id,name,category,price,has_cheese,is_spicy,cheese_price,spicy_price,is_available,ingredients")
      .eq("restaurant_id", job.restaurant_id).in("id", ids));
  }
  switch (d.action) {
    case "greet":
      await say((c.processed_at ? "" : publicText(settings.welcome)) || (settings.tone === "formal"
        ? (ar ? "أهلاً بكم في " : "Welcome to ") + restaurant.restaurant_name + (ar ? ". كيف يمكننا مساعدتكم؟" : ". How may we help you?")
        : (ar ? "هلا بيك بمطعم " : "Hi! Welcome to ") + restaurant.restaurant_name + (ar ? "! شتحب تطلب؟" : "! What would you like?")));
      return;
    case "location":
    case "hours":
    case "contact":
      await say(factReply(d.action, restaurant, settings, locale));
      return;
    case "ingredients": {
      const details = refreshed.filter(item => item.is_available && d.menu_ids.includes(item.id) && item.ingredients && publicText(item.ingredients))
        .slice(0, 3).map(item => publicText(item.name).slice(0, 65) + " — " + publicText(item.ingredients!).slice(0, 200));
      await say(details.length ? details.join("\n") : agentText.noDetails(locale));
      return;
    }
    case "menu":
    case "details": {
      const selected = d.menu_ids.length ? d.menu_ids.map(id => refreshed.find(item => item.id === id)).filter((item): item is MenuItem => !!item) : refreshed;
      await say(selected.some(item => item.is_available && !verifiedPrice(item.price)) ? agentText.noDetails(locale) : menuText(selected, locale, menuUrl));
      return;
    }
    case "status":
      await say(order ? orderStatusText(order.status, order.order_number, locale, order.device_metadata?.fulfillment) : agentText.noOrder(locale));
      return;
    case "handoff":
      await complete(db, job, locale, "handoff", { text: settings.handoff_enabled ? agentText.handoff(locale) : agentText.noHandoff(locale), handoff: true });
      return;
    case "cancel_cart":
      await say(agentText.cancel_cart(locale), "reset_quote", []);
      return;
    case "draft":
    case "quote_pickup": {
      if (!settings.ordering_enabled || !result(await db.rpc("whatsapp_open", { p_restaurant: job.restaurant_id }))) {
        await say(agentText.closed(locale)); return;
      }
      const cart = d.items;
      if (cart.some(line => !candidates.some(item => item.id === line.id))) {
        await say(agentText.clarify(locale), "reset_quote");
        return;
      }
      const price = result(await db.rpc("whatsapp_price", { p_restaurant: job.restaurant_id, p_items: cart }));
      if (!price) { await say(agentText.clarify(locale), "reset_quote"); return; }
      if (d.action === "draft") { await say(agentText.pickup(locale), "reset_quote", cart); return; }
      const quote = quoteReply(price, locale);
      const state = await complete(db, job, locale, "quote", quote.reply, cart, quote.id, price);
      if (state === "quote_changed") await say(agentText.changed(locale), "reset_quote", cart);
      if (state === "ordering_closed") await say(agentText.closed(locale), "reset_quote");
      return;
    }
    case "delivery":
      if (settings.handoff_enabled) {
        await complete(db, job, locale, "handoff", { text: agentText.delivery(locale) + " " + agentText.handoff(locale), handoff: true });
      } else await say(agentText.delivery(locale), "reset_quote");
      return;
    case "dine_in":
    case "clarify":
    case "invalid_modifier":
      await say(agentText[d.action](locale), "reset_quote");
      return;
    case "unavailable":
      await say(candidates.some(item => !item.is_available && normalizeMessage(text).includes(normalizeMessage(item.name)))
        ? agentText.unavailable(locale)
        : (ar ? "ما قدرت أتحقق من هالصنف بهالاسم. تگدر تشوف المنيو: " : "I could not verify that item by this name. Browse the menu: ") + menuUrl);
      return;
    default:
      if (result(await db.rpc("whatsapp_scope_notice", { p_job: job.id, p_lease: job.lease }))) await say(agentText.unsupported(locale));
      else await complete(db, job, locale, "skip");
  }
}

async function latestOrder(db: Db, c: Conversation) {
  const link = result(await db.from("whatsapp_orders").select("order_id").eq("restaurant_id", c.restaurant_id)
    .eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle());
  return link && result(await db.from("orders").select("status,order_number,device_metadata").eq("restaurant_id", c.restaurant_id)
    .eq("id", link.order_id).maybeSingle());
}

export function outboundBody(job: Job, c: Conversation) {
  const reply: Reply = job.kind === "order_status"
    ? { text: orderStatusText(job.payload.status, job.payload.order_number, c.locale,job.payload.fulfillment) }
    : job.payload;
  const common = { messaging_product: "whatsapp", recipient_type: "individual",
    ...(customerPhone(c.customer_id) ? { to: c.customer_id } : { recipient: c.customer_id }),
    biz_opaque_callback_data: job.id };
  if (reply.button && reply.title && reply.text?.length <= 1024) {
    return { ...common, type: "interactive", interactive: {
      type: "button", body: { text: reply.text },
      action: { buttons: [{ type: "reply", reply: { id: reply.button, title: reply.title } }] },
    } };
  }
  if (typeof reply.text !== "string" || !reply.text || reply.text.length > 4096) throw new ProviderError("invalid_message_body");
  return { ...common, type: "text", text: { preview_url: false, body: reply.text } };
}

async function markReconnect(db: Db, account: Account, error: string) {
  const query = db.from("whatsapp_accounts").update({ status: "reconnect_required", last_error: error })
    .eq("restaurant_id", account.restaurant_id).eq("phone_id", account.phone_id).eq("status", "connected");
  if (account.token_ciphertext) query.eq("token_ciphertext", account.token_ciphertext);
  result(await query);
}

async function outbound(db: Db, job: Job, c: Conversation, account: Account | null, settings: Settings, fetcher: typeof fetch) {
  const blocked = (error: string) => finish(db, job, { state: "blocked", lease: null, error_code: error });
  if (account?.status !== "connected" || !account.subscribed) { await blocked("account_disconnected"); return; }
  if (tokenExpired(account)) {
    await markReconnect(db, account, "token_expired");
    await blocked("token_expired"); return;
  }
  if (Date.parse(job.created_at) < Date.parse(account.operation_at)) { await blocked("previous_connection"); return; }
  if (job.kind === "reply" && (!settings.enabled || (c.handoff && !job.payload.handoff))) {
    await blocked("assistant_disabled"); return;
  }
  if (["reply", "manual"].includes(job.kind) && Date.now() - Date.parse(job.created_at) > 20 * 60 * 1000) {
    await blocked("reply_expired"); return;
  }
  const secret = account.provider === "gupshup" ? "" : accountAppSecret(account);
  if (Date.parse(c.last_inbound_at) < Math.floor(Date.parse(account.operation_at) / 1000) * 1000 ||
      !serviceWindowOpen(c.last_inbound_at)) { await blocked("service_window_closed"); return; }
  const body = outboundBody(job, c);
  const token = accountToken(account);
  if (!await finish(db, job, { state: "sending", run_at: new Date(Date.now() + 55_000).toISOString() })) return;
  try {
    const providerId = account.provider === "gupshup"
      ? await sendGupshup(account, token, body, job.id, fetcher)
      : (await graph(account.phone_id + "/messages", { method: "POST", send: true, body, token, appSecret: secret, fetcher }))?.messages?.[0]?.id;
    if (typeof providerId !== "string" || !providerId || providerId.length > 256) throw new ProviderError("meta_missing_message_id", false, true);
    await finish(db, job, { state: "accepted", provider_id: providerId, lease: null, error_code: null }, "sending");
  } catch (error) {
    // Once sending starts, an ambiguous result must not be blindly resent. A
    // later signed status can reconcile it via biz_opaque_callback_data.
    const e = error instanceof ProviderError ? error : new ProviderError("send_outcome_unknown", false, true);
    if (["meta_190", "meta_10", "meta_200", "gupshup_unauthorized"].includes(e.code)) await markReconnect(db, account, e.code);
    await fail(db, job, e, "sending");
  }
}

function retryAt(attempt: number, after: number) {
  const seconds = Math.min(3600, Math.max(after, 10 * 2 ** attempt) + Math.random() * 5);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function fail(db: Db, job: Job, e: ProviderError, state = "processing") {
  const retry = e.retryable && !e.uncertain && job.attempts < 5;
  await finish(db, job, {
    state: retry ? "queued" : e.uncertain ? "uncertain" : "failed",
    lease: null, error_code: e.code, ...(retry ? { run_at: retryAt(job.attempts, e.retryAfter) } : {}),
  }, state);
  whatsappLog(retry ? "retry_scheduled" : "job_failed", job, e.code);
}

async function processJob(db: Db, job: Job, fetcher: typeof fetch) {
  const started=Date.now();
  try {
    const c: Conversation = result(await db.from("whatsapp_conversations").select(
      "id,restaurant_id,phone_id,customer_id,locale,handoff,last_inbound_at,processed_at,draft,quote_id,whatsapp_sender_phone,delivery_state",
    ).eq("id", job.conversation_id).eq("restaurant_id", job.restaurant_id).single());
    const [account, preferences] = await Promise.all([
      readAccount(db, c),
      db.from("whatsapp_settings").select("*").eq("restaurant_id", job.restaurant_id).maybeSingle(),
    ]);
    const settings: Settings = result(preferences) ?? defaultSettings;
    if (job.direction === "in") await inbound(db, job, c, account, settings, fetcher);
    else await outbound(db, job, c, account, settings, fetcher);
  } catch (error) {
    await fail(db, job, safeError(error));
  } finally {
    console.info(JSON.stringify({subsystem:"whatsapp",event:"job_timing",job_id:job.id,direction:job.direction,
      queue_ms:Math.max(0,started-Date.parse(job.created_at)),process_ms:Date.now()-started}));
  }
}

export async function runWorker(db: Db, fetcher = fetch, duration = 20_000) {
  const end = Date.now() + duration;
  let total = 0;
  // Give pending customer replies a chance even with a sustained inbound backlog.
  for (let round = 0; round < 12 && Date.now() < end; round++) {
    const jobs: Job[] = result(await db.rpc("whatsapp_claim", { p_direction: "out", p_limit: 12 }));
    if (Date.now() < end) jobs.push(...result(await db.rpc("whatsapp_claim", { p_direction: "in", p_limit: 10 })));
    if (!jobs.length) break;
    const settled = await Promise.allSettled(jobs.map(job => processJob(db, job, fetcher)));
    settled.forEach((r, i) => { if (r.status === "rejected") whatsappLog("persistence_failed", jobs[i], "worker_retry_on_lease_expiry"); });
    total += jobs.length;
  }
  return total;
}

export function retryAllowed(job: Pick<Job, "id" | "direction" | "kind"> & { state: string; provider_id: string | null; error_code: string | null }) {
  return uuid(job.id) && job.direction === "out" && !job.provider_id && job.kind === "order_status" &&
    job.state === "failed" && !!job.error_code &&
    /^(attempts_exhausted|credential_unavailable|meta_(130429|131056|131016|190|10|200|4|17|32|613|http_429))$/.test(job.error_code);
}
