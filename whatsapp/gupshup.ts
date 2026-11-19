import { randomBytes } from "node:crypto";
import { STAFF_ORIGIN } from "../src/lib/public-urls";
import { businessUserId, encryptionKey, ProviderError, seal, unseal, uuid, type InboundEvent } from "./meta";
import { result, type Account, type Db } from "./worker";
import { validLocation } from "./delivery-data";

const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_+=./:-]{1,256}$/.test(value);
const phone = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{6,14}$/.test(value);
const incomingPhone = (value: unknown): string | null => {
  const normalized = typeof value === "string" ? value.replace(/^\+/, "") : value;
  return phone(normalized) ? normalized : null;
};
const scope = (rid: string, app: string) => "gupshup-webhook:" + rid + ":" + app;

// Self-Serve does not document a signed callback. Authenticate with a separate,
// high-entropy bearer credential in its supported HTTPS callback URL. Never use
// the API key as a URL token or the event's app name as a routing authority.
export function gupshupSetup(account: Account | null) {
  if (account?.provider !== "gupshup" || account.status === "disconnected" || !account.webhook_secret_ciphertext) return null;
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  if (!key || !account.gupshup_app_id) return null;
  const token = unseal(account.webhook_secret_ciphertext, key, scope(account.restaurant_id, account.gupshup_app_id));
  const origin = new URL(process.env.WHATSAPP_WEBHOOK_ORIGIN || STAFF_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password) return null;
  const url = new URL("/api/whatsapp/gupshup/webhook", origin);
  url.searchParams.set("connection", account.restaurant_id);
  url.searchParams.set("token", token);
  return { callback: url.toString() };
}

export async function gupshupRequest(path: string, apiKey: string, fetcher: typeof fetch, body?: URLSearchParams | Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetcher("https://api.gupshup.io/" + path, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { apikey: apiKey, Accept: "application/json", ...(body ? { "Content-Type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json" } : {}) },
      ...(body ? { body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) } : {}),
    });
  } catch { throw new ProviderError("gupshup_network", !body, !!body); }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status === "error") {
    const limited = response.status === 429;
    const unauthorized = [401, 403].includes(response.status);
    // A server failure after a send can mean it was accepted. Do not retry it.
    throw new ProviderError(unauthorized ? "gupshup_unauthorized" : "gupshup_http_" + response.status,
      limited || (!body && response.status >= 500), !!body && response.status >= 500 && !limited,
      Number(response.headers.get("Retry-After")) || 0);
  }
  if (!data) throw new ProviderError("gupshup_invalid_response", !body, !!body);
  return data;
}

export async function verifyGupshup(appId: string, apiKey: string, fetcher: typeof fetch) {
  const data = await gupshupRequest("wa/app/" + appId + "/business", apiKey, fetcher);
  if (data.status !== "success" || typeof data.business?.id !== "string" || data.business.id.toLowerCase() !== appId.toLowerCase()) throw new ProviderError("gupshup_app_unverified");
}

export async function connectGupshup(db: Db, rid: string, body: any, fetcher: typeof fetch) {
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  if (!key) throw new ProviderError("manual_not_configured");
  const { appId, appName, source, apiKey } = body ?? {};
  if (!uuid(appId) || typeof appName !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(appName) ||
    !phone(source) || typeof apiKey !== "string" || !/^[A-Za-z0-9_+=.\/-]{16,4096}$/.test(apiKey)) {
    throw new ProviderError("invalid_gupshup_credentials");
  }
  if (!result(await db.rpc("restaurant_subscription_active", { rid }))) throw new ProviderError("subscription_inactive");
  await verifyGupshup(appId, apiKey, fetcher);
  const connection = "gupshup:" + appId.toLowerCase();
  const saved = result(await db.rpc("whatsapp_save_gupshup", {
    p_restaurant: rid, p_app: appId.toLowerCase(), p_name: appName, p_source: source,
    p_token: seal(apiKey, key, rid + ":" + connection),
    p_webhook: seal(randomBytes(32).toString("base64url"), key, scope(rid, appId.toLowerCase())),
  }));
  if (saved !== "connected") throw new ProviderError(saved);
}

export function gupshupMessage(body: any, jobId: string) {
  if (body.type === "interactive") {
    return { type: "quick_reply", msgid: jobId, content: { type: "text", text: body.interactive.body.text },
      options: body.interactive.action.buttons.map((button: any) => ({ title: button.reply.title, postbackText: button.reply.id })) };
  }
  return { type: "text", text: body.text.body, previewUrl: false };
}

export async function sendGupshup(account: Account, apiKey: string, body: any, jobId: string, fetcher: typeof fetch) {
  if (businessUserId(body.recipient) && !body.to) {
    if (!uuid(account.gupshup_app_id)) throw new ProviderError("invalid_message_body");
    // Self-Serve V3 accepts the existing Cloud-style body, including recipient
    // for BSUID-only customers. Credentials still go only to Gupshup.
    const response = await gupshupRequest("wa/app/" + account.gupshup_app_id + "/v3/msg", apiKey, fetcher, body);
    const messageId = response.messages?.[0]?.id;
    if (!id(messageId)) throw new ProviderError("gupshup_missing_message_id", false, true);
    return messageId;
  }
  if (!phone(body.to) || !account.gupshup_app_name || !phone(account.gupshup_source)) throw new ProviderError("invalid_message_body");
  const response = await gupshupRequest("wa/api/v1/msg", apiKey, fetcher, new URLSearchParams({
    channel: "whatsapp", source: account.gupshup_source, destination: body.to, "src.name": account.gupshup_app_name,
    message: JSON.stringify(gupshupMessage(body, jobId)),
  }));
  if (response.status !== "submitted" || !id(response.messageId)) throw new ProviderError("gupshup_missing_message_id", false, true);
  return response.messageId as string;
}

export function parseGupshup(data: any, account: Account): (InboundEvent | {
  kind: "status"; phone: string; waba: string; provider_id: string; time: string; status: string; error?: string;
})[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.version !== 2 || typeof data.type !== "string") return null;
  if (data.app !== account.gupshup_app_name || (data.appId != null && data.appId !== account.gupshup_app_id)) return null;
  const p = data.payload;
  const timestamp = Number(data.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < 1_000_000_000_000 || timestamp > 9_999_999_999_999) return null;
  const common = { phone: account.phone_id, waba: account.waba_id, time: String(Math.floor(timestamp / 1000)) };
  if (data.type === "message") {
    if (!p || !id(p.id) || typeof p.type !== "string") return null;
    // Current V2 webhooks may omit source and put the number in sender.phone.
    // Canonicalize E.164's optional '+'; never guess a number from names/BSUIDs
    // or accept conflicting explicit phone identities.
    const source = incomingPhone(p.source);
    const sender = incomingPhone(p.sender?.phone);
    if ((p.source != null && p.source !== "" && !source) || (p.sender?.phone != null && p.sender.phone !== "" && !sender) ||
      (source && sender && source !== sender)) return null;
    const number = source || sender;
    const snakeId = p.sender?.user_id;
    const camelId = p.sender?.userId;
    if ((snakeId != null && !businessUserId(snakeId)) || (camelId != null && !businessUserId(camelId)) ||
      (snakeId && camelId && snakeId !== camelId)) return null;
    const customer = camelId || snakeId || number;
    if (!customer) return null;
    const base = { ...common, customer, ...(number ? { customer_phone: number } : {}), provider_id: p.id };
    const context = p.context?.gsId;
    if (p.type === "location") {
      const location=validLocation(p.payload);
      return location ? [{ ...base,kind:"location",location }] : null;
    }
    if (p.type === "text" && typeof p.payload?.text === "string" && p.payload.text.length <= 4096 && !p.payload.text.includes("\0")) {
      return [{ ...base, kind: "text", text: p.payload.text, ...(id(context) ? { context } : {}) }];
    }
    // Self-Serve sends the developer token as id; older quick replies use
    // postbackText. Never use the visible title/reply as an authorization token.
    const button = p.payload?.postbackText ?? p.payload?.id;
    if (["button_reply", "quick_reply"].includes(p.type) && typeof button === "string" && button.length > 0 && button.length <= 256 && !button.includes("\0") &&
      !(p.payload?.postbackText != null && p.payload?.id != null && p.payload.postbackText !== p.payload.id)) {
      return [{ ...base, kind: "button", button, ...(id(context) ? { context } : {}) }];
    }
    return [{ ...base, kind: "unsupported" }];
  }
  if (data.type === "message-event") {
    if (!p || typeof p.type !== "string") return null;
    if (!["sent", "delivered", "read", "failed"].includes(p.type)) return [];
    const providerId = p.gsId || p.id;
    if (!id(providerId)) return null;
    const providerTime = Number(p.payload?.ts);
    // Keep the provider's diagnostic with its code. A submitted API response is
    // only a queue acknowledgement; the asynchronous failure explains delivery.
    // This field is displayed as escaped text in the authenticated dashboard.
    const reason = typeof p.payload?.reason === "string"
      ? p.payload.reason.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
      : "";
    return [{ ...common, ...(Number.isSafeInteger(providerTime) && providerTime >= 1_000_000_000 && providerTime < 10_000_000_000 ? { time: String(providerTime) } : {}), kind: "status", provider_id: providerId, status: p.type,
      ...(p.type === "failed" ? { error: "gupshup_delivery_" + (Number.isSafeInteger(p.payload?.code) ? p.payload.code : "failed") + (reason ? ": " + reason : "") } : {}) }];
  }
  // Connectivity checks, sandbox-start and future system events are acknowledged
  // without invoking the AI or extending the customer-service window.
  return [];
}
