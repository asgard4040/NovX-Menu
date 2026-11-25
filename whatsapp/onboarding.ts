import { createHmac } from "node:crypto";
import type { Db } from "./worker";
import { result, accountToken, accountAppSecret, tokenExpired, type Account } from "./worker";
import { encryptionKey, graph, graphVersion, metaId, ProviderError, seal, unseal, uuid } from "./meta";
import { STAFF_ORIGIN } from "../src/lib/public-urls";
import { verifyGupshup } from "./gupshup";

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function config() {
  const appId = process.env.WHATSAPP_META_APP_ID;
  const configId = process.env.WHATSAPP_META_SIGNUP_CONFIG_ID;
  const secret = process.env.WHATSAPP_META_APP_SECRET;
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  return metaId(appId) && metaId(configId) && secret && verifyToken && key
    ? { appId, configId, secret, key, version: graphVersion() } : null;
}

export const signupCallbackUrl = "https://menu.novx-team.com/api/whatsapp/signup/callback";

export function signupPage(options: NonNullable<ReturnType<typeof config>>, state: string) {
  const url = new URL("https://www.facebook.com/" + options.version + "/dialog/oauth");
  url.search = new URLSearchParams({
    client_id: options.appId, config_id: options.configId, redirect_uri: signupCallbackUrl,
    state, display: "page", response_type: "code", override_default_response_type: "true",
    is_business_login: "true", extras: JSON.stringify({ version: "v5", setup: {} }),
  }).toString();
  return url.href;
}

function expireAt(timestamp: unknown) {
  return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString() : null;
}

async function debugToken(token: string, options: { appId: string; secret: string }, fetcher: typeof fetch) {
  const response = await graph("debug_token", {
    appSecret: options.secret, token: options.appId + "|" + options.secret, fetcher,
    query: new URLSearchParams({ input_token: token }),
  });
  const details = response.data;
  if (!details?.is_valid || String(details.app_id) !== options.appId || !Array.isArray(details.scopes) ||
    !["whatsapp_business_management", "whatsapp_business_messaging"].every(scope => details.scopes?.includes(scope))) {
    throw new ApiError(422, "meta_permissions_unverified");
  }
  const expiry = expireAt(details.expires_at);
  const dataExpiry = expireAt(details.data_access_expires_at);
  if ([expiry, dataExpiry].some(at => at && Date.parse(at) <= Date.now())) throw new ApiError(422, "token_expired");
  const targets = Array.isArray(details.granular_scopes) ? details.granular_scopes : [];
  const messagingAccounts = [...new Set<string>(targets
    .filter((entry: any) => ["whatsapp_business_management", "whatsapp_business_messaging"].includes(entry?.scope))
    .flatMap((entry: any) => Array.isArray(entry.target_ids) ? entry.target_ids.filter(metaId) : []))];
  return { dates: { token_expires_at: expiry, data_access_expires_at: dataExpiry }, messagingAccounts };
}

export async function exchangeSignup(db: Db, restaurantId: string, userId: string, body: any, fetcher: typeof fetch, sameTab = false) {
  const options = config();
  if (!options) throw new ApiError(503, "meta_not_configured");
  if (!uuid(body?.signupId) || typeof body.code !== "string" || !/^[A-Za-z0-9_./+=-]{10,4096}$/.test(body.code)) {
    throw new ApiError(400, "invalid_signup");
  }
  const signup = result(await db.from("whatsapp_signup").update({ used_at: new Date().toISOString() })
    .eq("id", body.signupId).eq("restaurant_id", restaurantId).eq("user_id", userId)
    .gt("expires_at", new Date().toISOString()).is("used_at", null).select("id").maybeSingle());
  if (!signup) throw new ApiError(409, "signup_expired");
  // The code expires quickly. Exchange it before asking the owner to select a phone.
  const query = new URLSearchParams({ client_id: options.appId, client_secret: options.secret, code: body.code });
  if (sameTab) query.set("redirect_uri", signupCallbackUrl);
  const exchanged = await graph("oauth/access_token", {
    appSecret: options.secret, fetcher, query,
  });
  if (typeof exchanged.access_token !== "string" || !exchanged.access_token) throw new ApiError(422, "meta_token_missing");
  await debugToken(exchanged.access_token, options, fetcher);
  result(await db.from("whatsapp_signup").update({
    token_ciphertext: seal(exchanged.access_token, options.key, restaurantId + ":" + signup.id),
  }).eq("id", signup.id).eq("restaurant_id", restaurantId));
}

type VerifiedPhone = {
  waba: string; phone: string; display: string; coexistence: boolean; needsPin: boolean;
};

async function verifiedPhones(waba: string, token: string, appSecret: string, fetcher: typeof fetch): Promise<VerifiedPhone[]> {
  const phones = await graph(waba + "/phone_numbers", {
    appSecret, fetcher, token, query: new URLSearchParams({
      fields: "id,display_phone_number,status,is_on_biz_app,platform_type", limit: "100",
    }),
  });
  if (!Array.isArray(phones?.data)) return [];
  return phones.data
    .filter((row: any) => metaId(row?.id) && typeof row.display_phone_number === "string" &&
      (row.is_on_biz_app !== true || row.platform_type === "CLOUD_API"))
    .map((row: any) => ({
      waba, phone: row.id, display: row.display_phone_number.slice(0, 32),
      coexistence: row.is_on_biz_app === true, needsPin: row.is_on_biz_app !== true && row.status !== "CONNECTED",
    }));
}

async function signupToken(db: Db, restaurantId: string, userId: string, signupId: string, key: Buffer) {
  const signup = result(await db.from("whatsapp_signup").select("token_ciphertext")
    .eq("id", signupId).eq("user_id", userId).eq("restaurant_id", restaurantId)
    .gt("expires_at", new Date().toISOString()).maybeSingle());
  if (!signup?.token_ciphertext) throw new ApiError(409, "signup_expired");
  return unseal(signup.token_ciphertext, key, restaurantId + ":" + signupId);
}

export async function listSignupPhones(db: Db, restaurantId: string, userId: string, signupId: unknown, fetcher: typeof fetch) {
  const options = config();
  if (!options) throw new ApiError(503, "meta_not_configured");
  if (!uuid(signupId)) throw new ApiError(400, "invalid_signup");
  const token = await signupToken(db, restaurantId, userId, signupId, options.key);
  const { messagingAccounts } = await debugToken(token, options, fetcher);
  if (!messagingAccounts.length) throw new ApiError(422, "meta_no_phone");
  const accounts = await Promise.all(messagingAccounts.slice(0, 10).map(waba => verifiedPhones(waba, token, options.secret, fetcher)));
  const phones = accounts.flat();
  if (!phones.length) throw new ApiError(422, "meta_no_phone");
  return phones;
}

function hasApp(subscriptions: any, appId: string) {
  return Array.isArray(subscriptions?.data) &&
    subscriptions.data.some(app => String(app?.whatsapp_business_api_data?.id ?? app?.id) === appId);
}

export function manualWebhookToken(restaurantId: string) {
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  return key ? createHmac("sha256", key).update("whatsapp-webhook:" + restaurantId).digest("hex") : null;
}

export function manualSetup(restaurantId: string) {
  const verifyToken = manualWebhookToken(restaurantId);
  const origin = new URL(process.env.WHATSAPP_WEBHOOK_ORIGIN || STAFF_ORIGIN);
  return verifyToken && origin.protocol === "https:" && !origin.username && !origin.password
    ? { callback: origin.origin + "/api/whatsapp/webhook/" + restaurantId, verifyToken } : null;
}

export async function connectManual(db: Db, restaurantId: string, body: any, fetcher: typeof fetch) {
  const key = encryptionKey(process.env.WHATSAPP_CREDENTIAL_KEY);
  if (!key) throw new ApiError(503, "manual_not_configured");
  const { appId, appSecret, waba, phone, token } = body ?? {};
  if (!metaId(appId) || !metaId(waba) || !metaId(phone) || typeof appSecret !== "string" ||
      !/^[a-f0-9]{32}$/i.test(appSecret) || typeof token !== "string" || !/^[A-Za-z0-9_-]{20,4096}$/.test(token)) {
    throw new ApiError(400, "invalid_manual_credentials");
  }
  if (!result(await db.rpc("restaurant_subscription_active", { rid: restaurantId }))) throw new ApiError(403, "subscription_inactive");
  const { dates } = await debugToken(token, { appId, secret: appSecret }, fetcher);
  const asset = (await verifiedPhones(waba, token, appSecret, fetcher)).find(row => row.phone === phone);
  if (!asset) throw new ApiError(422, "meta_phone_mismatch");
  if (asset.needsPin) throw new ApiError(422, "meta_register_in_meta");
  const request = { appSecret, fetcher, token };
  const path = waba + "/subscribed_apps";
  if (!hasApp(await graph(path, request), appId)) {
    const subscribed = await graph(path, { ...request, method: "POST" });
    if (subscribed?.success !== true || !hasApp(await graph(path, request), appId)) {
      throw new ApiError(422, "meta_subscription_unverified");
    }
  }
  const scope = restaurantId + ":" + phone;
  const saved = result(await db.rpc("whatsapp_save_manual", {
    p_restaurant: restaurantId, p_phone: phone, p_waba: waba, p_display: asset.display, p_coexistence: asset.coexistence,
    p_app: appId, p_secret: seal(appSecret, key, "app:" + scope), p_token: seal(token, key, scope),
    p_expires: dates.token_expires_at, p_data_expires: dates.data_access_expires_at,
  }));
  if (saved !== "connected") throw new ApiError(409, saved);
}

export async function completeSignup(db: Db, restaurantId: string, userId: string, body: any, fetcher: typeof fetch) {
  const options = config();
  if (!options) throw new ApiError(503, "meta_not_configured");
  const { signupId, waba, phone, pin } = body ?? {};
  if (!uuid(signupId) || !metaId(waba) || !metaId(phone) || (pin != null && !/^\d{6}$/.test(pin))) {
    throw new ApiError(400, "invalid_assets");
  }
  const token = await signupToken(db, restaurantId, userId, signupId, options.key);
  const { dates: credentialDates } = await debugToken(token, options, fetcher);
  const request = { appSecret: options.secret, fetcher, token };
  // Verify asset ownership through Meta. Never use the popup event as authority.
  const asset = (await verifiedPhones(waba, token, options.secret, fetcher)).find(row => row.phone === phone);
  if (!asset) throw new ApiError(422, "meta_phone_mismatch");
  const { coexistence, needsPin } = asset;
  if (needsPin && !/^\d{6}$/.test(pin || "")) throw new ApiError(422, "meta_pin_required");

  const reserved = result(await db.rpc("whatsapp_reserve_account", {
    p_restaurant: restaurantId, p_signup: signupId, p_phone: phone, p_waba: waba,
    p_display: asset.display, p_coexistence: coexistence,
  }));
  if (reserved !== "reserved") throw new ApiError(409, reserved || "account_in_use");
  try {
    if (needsPin) {
      const registered = await graph(phone + "/register", { ...request, method: "POST",
        body: { messaging_product: "whatsapp", pin } });
      if (registered?.success !== true) throw new ApiError(422, "meta_registration_unverified");
    }
    const subscribed = await graph(waba + "/subscribed_apps", { ...request, method: "POST" });
    if (subscribed?.success !== true) throw new ApiError(422, "meta_subscription_unverified");
    const current = await graph(waba + "/subscribed_apps", request);
    if (!hasApp(current, options.appId)) throw new ApiError(422, "meta_subscription_unverified");
    const stored = result(await db.from("whatsapp_accounts").update({
      ...credentialDates, token_ciphertext: seal(token, options.key, restaurantId + ":" + phone),
      meta_app_id: null, app_secret_ciphertext: null,
      status: "connected", subscribed: true, verified_at: new Date().toISOString(), onboarding_id: null,
      last_error: null,
    }).eq("restaurant_id", restaurantId).eq("phone_id", phone).eq("status", "connecting")
      .eq("onboarding_id", signupId).select("phone_id").maybeSingle());
    if (!stored) throw new ApiError(409, "signup_expired");
    result(await db.from("whatsapp_signup").update({ token_ciphertext: null }).eq("id", signupId).eq("restaurant_id", restaurantId));
  } catch (error) {
    const code = error instanceof ApiError || error instanceof ProviderError ? error.code : "onboarding_failed";
    result(await db.from("whatsapp_accounts").update({ status: "reconnect_required", last_error: code, onboarding_id: null })
      .eq("phone_id", phone).eq("restaurant_id", restaurantId).eq("status", "connecting").eq("onboarding_id", signupId));
    throw error;
  }
}

export async function disconnect(db: Db, restaurantId: string, fetcher: typeof fetch) {
  const reservation = result(await db.rpc("whatsapp_begin_disconnect", { p_restaurant: restaurantId })) as
    { account: Account; unsubscribe: boolean } | null;
  if (!reservation) throw new ApiError(409, "account_operation_unavailable");
  const { account, unsubscribe } = reservation;
  let warning: string | null = null;
  if (unsubscribe && account.provider !== "gupshup") {
    try {
      if (!account.token_ciphertext || tokenExpired(account)) throw new Error("credential_unavailable");
      const response = await graph(account.waba_id + "/subscribed_apps", {
        token: accountToken(account), method: "DELETE", appSecret: accountAppSecret(account), fetcher,
      });
      if (!response?.success) throw new Error("meta_unsubscribe_unverified");
    } catch {
      warning = "revoke_in_meta";
    }
  }
  // Clear the credential even when Meta cannot confirm unsubscription. The UI
  // offers the Meta-side revocation step when local disconnect is all we can verify.
  result(await db.from("whatsapp_accounts").update({
    status: "disconnected", token_ciphertext: null, app_secret_ciphertext: null, webhook_secret_ciphertext: null, subscribed: false, last_error: warning,
    token_expires_at: null, data_access_expires_at: null, onboarding_id: null,
  }).eq("phone_id", account.phone_id).eq("restaurant_id", restaurantId).eq("status", "disconnecting"));
  return warning;
}

export async function checkConnection(db: Db, restaurantId: string, fetcher: typeof fetch) {
  const account = result(await db.from("whatsapp_accounts").select("*").eq("restaurant_id", restaurantId)
    .eq("status", "connected").maybeSingle()) as Account | null;
  if (!account) throw new ApiError(409, "account_disconnected");

  const update = (changes: object) => db.from("whatsapp_accounts").update(changes).eq("restaurant_id", restaurantId)
    .eq("phone_id", account.phone_id).eq("token_ciphertext", account.token_ciphertext).eq("status", "connected");
  try {
    if (account.provider === "gupshup") {
      await verifyGupshup(account.gupshup_app_id!, accountToken(account), fetcher);
      result(await update({ verified_at: new Date().toISOString(), last_error: null }));
      return;
    }
    const appId = account.meta_app_id || process.env.WHATSAPP_META_APP_ID;
    if (!metaId(appId)) throw new ApiError(503, "meta_not_configured");
    const secret = accountAppSecret(account);
    const token = accountToken(account);
    const { dates } = await debugToken(token, { appId, secret }, fetcher);
    if (account.meta_app_id && !(await verifiedPhones(account.waba_id, token, secret, fetcher))
      .some(phone => phone.phone === account.phone_id && !phone.needsPin)) throw new ApiError(422, "meta_phone_mismatch");
    const current = await graph(account.waba_id + "/subscribed_apps", { token, appSecret: secret, fetcher });
    if (!hasApp(current, appId)) throw new ApiError(422, "meta_subscription_unverified");
    result(await update({ ...dates, verified_at: new Date().toISOString(), last_error: null, subscribed: true }));
  } catch (error) {
    const code = error instanceof ProviderError || error instanceof ApiError ? error.code : "connection_check_failed";
    const reconnect = ["meta_190", "meta_subscription_unverified", "meta_permissions_unverified", "token_expired",
      "credential_unavailable", "credential_invalid", "meta_phone_mismatch", "gupshup_unauthorized", "gupshup_app_unverified"].includes(code);
    result(await update({ last_error: code, ...(reconnect ? { status: "reconnect_required", subscribed: false } : {}) }));
    throw error;
  }
}
