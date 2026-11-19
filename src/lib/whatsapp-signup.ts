type MetaSdk = {
  init(options: { appId: string; version: string; xfbml: boolean; cookie: boolean }): void;
  login(callback: (response: { authResponse?: { code?: string } }) => void, options: object): void;
};
export type SignupConfig = { appId: string; configId: string; version: string };
type Assets = { waba: string; phone: string; coexistence: boolean };

export function readSignupEvent(origin: string, raw: unknown): Assets | "cancelled" | "failed" | "number_required" | null {
  if (!["https://www.facebook.com", "https://web.facebook.com", "https://m.facebook.com", "https://facebook.com"].includes(origin)) {
    return null;
  }
  let event: any = raw;
  if (typeof raw === "string") {
    try { event = JSON.parse(raw); } catch { return null; }
  }
  if (event?.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (event.event === "CANCEL") return "cancelled";
  if (event.event === "ERROR") return "failed";
  if (!["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"].includes(event.event)) return "number_required";
  const phone = event.data?.phone_number_id;
  const owners = event.data?.messaging_account_ids ?? (event.data?.waba_id ? [event.data.waba_id] : []);
  const isId = (value: unknown) => typeof value === "string" && /^\d{5,32}$/.test(value);
  if (!isId(phone) || !Array.isArray(owners) || owners.length !== 1 || !isId(owners[0])) return "number_required";
  return { phone, waba: owners[0], coexistence: event.data?.is_on_biz_app === true ||
    event.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" };
}

let loading: Promise<MetaSdk> | undefined;
export async function signupSdk(config: SignupConfig) {
  const browser = window as Window & { FB?: MetaSdk };
  loading ??= new Promise<MetaSdk>((resolve, reject) => {
    if (browser.FB) { resolve(browser.FB); return; }
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    const timeout = window.setTimeout(() => fail(), 15_000);
    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("sdk_unavailable"));
    }
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      if (browser.FB) resolve(browser.FB);
      else fail();
    };
    document.head.appendChild(script);
  }).catch(error => { loading = undefined; throw error; });
  const sdk = await loading;
  sdk.init({ appId: config.appId, version: config.version, xfbml: false, cookie: false });
  return sdk;
}

export async function signupPopup(sdk: MetaSdk, config: SignupConfig, exchange: (code: string) => Promise<unknown>, signal: AbortSignal) {
  let found: Assets | null = null;
  let exchanged = false;
  let finished = false;
  let gotCode = false;
  return new Promise<Assets>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("cancelled")); return; }
    const timeout = window.setTimeout(() => finish(new Error("popup_timeout")), 14 * 60 * 1000);
    let replyDeadline = window.setTimeout(() => finish(new Error("popup_not_opened")), 25_000);
    const abort = () => finish(new Error("cancelled"));
    function waitForReply() {
      window.clearTimeout(replyDeadline);
      replyDeadline = window.setTimeout(() => finish(new Error("popup_no_response")), 15_000);
    }
    function onBlur() {
      if (!gotCode && !found) window.clearTimeout(replyDeadline);
    }
    function onFocus() {
      if (!gotCode && !found) waitForReply();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") onBlur();
      else onFocus();
    }
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      window.clearTimeout(replyDeadline);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (found) resolve(found);
    }
    function onMessage(event: MessageEvent) {
      const data = readSignupEvent(event.origin, event.data);
      if (!data) return;
      if (typeof data === "string") { finish(new Error(data)); return; }
      found = data;
      if (exchanged) finish();
      else if (!gotCode) waitForReply();
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    signal.addEventListener("abort", abort, { once: true });
    try {
      sdk.login(response => {
        if (finished || gotCode) return;
        const code = response?.authResponse?.code;
        if (!code) { finish(new Error("cancelled")); return; }
        gotCode = true;
        window.clearTimeout(replyDeadline);
        void exchange(code).then(() => {
          if (finished) return;
          exchanged = true;
          if (found) finish();
          else waitForReply();
        }, error => finish(error instanceof Error ? error : new Error("failed")));
      }, { config_id: config.configId, response_type: "code", override_default_response_type: true,
        extras: { version: "v5", setup: {} } });
    } catch {
      finish(new Error("sdk_unavailable"));
    }
  });
}
