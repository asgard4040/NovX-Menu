import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { validLocation, type DeliveryLocation } from "./delivery-data";

export function equalSecret(left: unknown, right: string): boolean {
  if (typeof left !== "string" || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifySignature(raw: unknown, signature: unknown, secret: string): boolean {
  return Buffer.isBuffer(raw) && !!secret &&
    equalSecret(signature, "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
}

export const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const metaId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{5,32}$/.test(value);
export const customerPhone = (value: unknown): value is string =>
  typeof value === "string" && /^\d{5,24}$/.test(value);
export const businessUserId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/.test(value);
const providerId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_+=./:-]{1,256}$/.test(value);
const time = (value: unknown): value is string =>
  typeof value === "string" && /^\d{10}$/.test(value);

export function encryptionKey(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const key = Buffer.from(value, "base64url");
  return key.length === 32 ? key : null;
}

export function seal(value: string, key: Buffer, scope: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("ordova-whatsapp:" + scope));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function unseal(value: string, key: Buffer, scope: string) {
  const [version, nonce, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !ciphertext) throw new Error("credential_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
  decipher.setAAD(Buffer.from("ordova-whatsapp:" + scope));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString();
}

export type InboundEvent = {
  kind: "text" | "button" | "location" | "unsupported" | "identity"; phone: string; waba: string; customer: string;
  provider_id: string; time: string; text?: string; button?: string; context?: string; previous_customer?: string; customer_phone?: string; location?: DeliveryLocation;
};
type StatusEvent = {
  kind: "status"; phone: string; waba: string; provider_id: string; time: string;
  status: string; opaque?: string; error?: string;
};

type AccountEvent = { kind: "revoked"; waba: string; time: string };

export function parseWebhook(payload: any): (InboundEvent | StatusEvent | AccountEvent)[] | null {
  if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return null;
  const events: (InboundEvent | StatusEvent | AccountEvent)[] = [];
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) return null;
    // The Meta dashboard uses account ID 0 for signed sample deliveries.
    // Acknowledge them without routing them to a restaurant.
    if (entry.id === "0") continue;
    if (!metaId(entry.id)) return null;
    for (const change of entry.changes) {
      if (change?.field === "account_update") {
        const { event, waba_info } = change.value ?? {};
        const waba = event === "ACCOUNT_DELETED" ? entry.id : waba_info?.waba_id;
        const occurredAt = String(entry.time ?? "");
        const revoked = event === "ACCOUNT_DELETED" || event === "PARTNER_REMOVED" ||
          (event === "PARTNER_APP_UNINSTALLED" && waba_info?.partner_app_id === process.env.WHATSAPP_META_APP_ID);
        if (revoked && metaId(waba) && time(occurredAt)) events.push({ kind: "revoked", waba, time: occurredAt });
        continue;
      }
      if (change?.field !== "messages") continue;
      const value = change.value;
      const phone = value?.metadata?.phone_number_id;
      if (!metaId(phone) || value.messaging_product !== "whatsapp") return null;
      if (value.messages !== undefined && !Array.isArray(value.messages)) return null;
      if (value.statuses !== undefined && !Array.isArray(value.statuses)) return null;
      for (const msg of value.messages || []) {
        if (!providerId(msg?.id) || !time(msg.timestamp)) continue;
        if (msg.type === "system") {
          const { type, user_id, previous_user_id } = msg.system ?? {};
          if (["user_changed_user_id", "user_changed_number"].includes(type) &&
            businessUserId(user_id) && businessUserId(previous_user_id)) {
            events.push({ kind: "identity", phone, waba: entry.id, customer: user_id,
              previous_customer: previous_user_id, time: msg.timestamp, provider_id: msg.id });
          }
          continue;
        }
        const number = customerPhone(msg.from) ? msg.from : undefined;
        const customer = businessUserId(msg.from_user_id) ? msg.from_user_id : number;
        if (!customer) continue;
        const event: InboundEvent = {
          kind: "unsupported", phone, waba: entry.id, customer, customer_phone: number, time: msg.timestamp, provider_id: msg.id,
        };
        if (providerId(msg.context?.id)) event.context = msg.context.id;
        if (msg.type === "location") {
          const location=validLocation(msg.location);
          if (location) { event.kind="location"; event.location=location; }
        }
        if (msg.type === "text" && typeof msg.text?.body === "string" && msg.text.body.length <= 1000) {
          event.kind = "text";
          event.text = msg.text.body.replaceAll("\0", "").trim();
        }
        const button = msg.interactive?.button_reply?.id;
        if (msg.type === "interactive" && msg.interactive?.type === "button_reply" &&
          typeof button === "string" && button.startsWith("confirm:") && uuid(button.slice(8))) {
          event.kind = "button";
          event.button = button;
        }
        events.push(event);
      }
      for (const status of value.statuses || []) {
        if (!providerId(status?.id) || !time(status.timestamp) ||
          !["sent", "delivered", "read", "failed"].includes(status.status)) continue;
        events.push({
          kind: "status", waba: entry.id, phone, provider_id: status.id, time: status.timestamp, status: status.status,
          opaque: uuid(status.biz_opaque_callback_data) ? status.biz_opaque_callback_data : undefined,
          error: Number.isSafeInteger(status.errors?.[0]?.code) ? "meta_" + status.errors[0].code : undefined,
        });
      }
    }
  }
  // Group a batch by phone to acquire conversation locks consistently.
  const phoneKey = (event: typeof events[number]) => event.kind === "revoked" ? "" : event.phone;
  const customerKey = (event: typeof events[number]) => "customer" in event ? event.customer : "";
  return events.sort((a, b) => phoneKey(a).localeCompare(phoneKey(b)) ||
    customerKey(a).localeCompare(customerKey(b)) || a.time.localeCompare(b.time));
}

export class ProviderError extends Error {
  constructor(public code: string, public retryable = false, public uncertain = false, public retryAfter = 0) {
    super(code);
  }
}

export function graphVersion() {
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v27.0";
  if (!/^v\d{2,3}\.0$/.test(version)) throw new Error("invalid_graph_version");
  return version;
}

export async function graph(path: string, options: {
  token?: string; method?: "GET" | "POST" | "DELETE"; body?: object; query?: URLSearchParams;
  appSecret: string; send?: boolean; fetcher?: typeof fetch;
}) {
  const params = new URLSearchParams(options.query);
  if (options.token) params.set("appsecret_proof",
    createHmac("sha256", options.appSecret).update(options.token).digest("hex"));
  const url = new URL("https://graph.facebook.com/" + graphVersion() + "/" + path);
  url.search = params.toString();
  let response: Response;
  try {
    response = await (options.fetcher || fetch)(url, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: "Bearer " + options.token } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
  } catch {
    throw new ProviderError("meta_network", !options.send, !!options.send);
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.error) {
    const code = Number.isSafeInteger(json?.error?.code) ? json.error.code : null;
    const limited = response.status === 429 || [4, 17, 32, 613, 130429, 131048, 131056].includes(code);
    const transient = json?.error?.is_transient === true || [1, 2, 131016].includes(code);
    const unknown = response.status >= 500 && !json?.error;
    const retryAfter = Number(response.headers.get("Retry-After")) || 0;
    throw new ProviderError(code ? "meta_" + code : "meta_http_" + response.status,
      limited || (transient && !unknown) || (!options.send && response.status >= 500),
      !!options.send && unknown && !limited, retryAfter);
  }
  if (!json) throw new ProviderError("meta_invalid_response", !options.send, !!options.send);
  return json;
}

export function serviceWindowOpen(lastInbound: string, now = Date.now()) {
  const timestamp = Date.parse(lastInbound);
  return timestamp <= now && now - timestamp < 24 * 60 * 60 * 1000;
}
