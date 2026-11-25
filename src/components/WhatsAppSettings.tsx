import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import type { Settings } from "../../whatsapp/agent";
import { defaultPolicy } from "../../whatsapp/policy";
import { useLanguage } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { signupPopup, signupSdk, type SignupConfig } from "../lib/whatsapp-signup";

type Account = {
  provider: "meta" | "gupshup"; gupshup_app_id: string | null; gupshup_app_name: string | null; gupshup_source: string | null;
  phone_id: string; waba_id: string; meta_app_id: string | null;
  display_phone: string; status: string; subscribed: boolean; coexistence: boolean;
  last_error: string | null; verified_at: string | null; last_webhook_at: string | null;
  token_expires_at: string | null; data_access_expires_at: string | null;
};
type Conversation = { id: string; customer_id: string; last_inbound_at: string; handoff: boolean };
type Usage = {
  attempts: number; measured: number; input_tokens: number; output_tokens: number;
  estimated_usd: number | null; estimated_attempts: number;
  cached_input_tokens?: number; inbound_messages?: number; outbound_messages?: number;
  blocked_requests?: number; duplicate_events?: number; batched_messages?: number; estimated_provider_usd?: number | null;
};
type Limits = Pick<Settings, "daily_ai_limit" | "ai_policy">;
type OwnerSettings = Omit<Settings, keyof Limits>;
type Connection = { account: Account | null; manual: { callback: string; verifyToken: string } | null; gupshup: { callback: string } | null;
  setup: SignupConfig | null; limits: Limits; usage: Usage };
type Dashboard = {
  settings: OwnerSettings; connected: boolean; aiConfigured: boolean;
  conversations: Conversation[];
  orders: { order_id: string; orders: { order_number: number; status: string; total_amount: number } }[];
  failures: { id: string; conversation_id: string; state: string; error_code: string; created_at: string;
    order_number?: number; retryable: boolean }[];
};
type Thread = {
  conversation: Conversation; windowOpen: boolean; before: string | null;
  messages: { id: string; direction: "in" | "out"; kind: string; state: string; created_at: string;
    payload: { text?: string; status?: string; order_number?: number } }[];
};
type Assets = Awaited<ReturnType<typeof signupPopup>>;
type Phone = Assets & { display: string; needsPin: boolean };
type Signup = { id: string; sdk?: Awaited<ReturnType<typeof signupSdk>>; url?: string; phones?: Phone[]; assets?: Assets };

function clearSignupReturn() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("whatsappSignup")) return;
  url.searchParams.delete("whatsappSignup");
  url.searchParams.delete("whatsappRestaurant");
  window.history.replaceState(window.history.state, "", url);
}

const panel = "min-w-0 rounded-2xl border border-border-delicate bg-white p-4 sm:p-6";
const primary = "min-h-11 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-delicate px-4 py-2 text-sm font-semibold text-brand-primary disabled:opacity-50";
const field = "w-full rounded-xl border border-border-delicate bg-bg-paper px-3 py-2 text-sm text-text-main";
const heading = "mb-3 text-lg font-bold text-brand-primary";

export default function WhatsAppSettings({ restaurantId, connectionOnly = false }: { restaurantId: string; connectionOnly?: boolean }) {
  const { tr, language, dir } = useLanguage();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [provider, setProvider] = useState<"gupshup" | "meta">("gupshup");
  const [settings, setSettings] = useState<OwnerSettings | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadId, setThreadId] = useState("");
  const [manualText, setManualText] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [signup, setSignup] = useState<Signup | null>(null);
  const [pin, setPin] = useState("");
  const abort = useRef<AbortController | null>(null);
  const live = useRef(false);
  const message = useRef<{ thread: string; text: string; id: string } | null>(null);

  const api = useCallback(async <T,>(path = "", method = "GET", body?: object): Promise<T> => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("unauthorized");
    const response = await fetch("/api/whatsapp/restaurants/" + restaurantId + path, {
      method, headers: { Authorization: "Bearer " + data.session.access_token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55_000),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) throw new Error(value?.error || "whatsapp_unavailable");
    return value as T;
  }, [restaurantId]);

  const refresh = useCallback(async (replace = false) => {
    if (connectionOnly) {
      const data = await api<Connection>("/connection");
      if (live.current) {
        setConnection(data);
        setLimits(current => replace || !current ? data.limits : current);
      }
      return;
    }
    const data = await api<Dashboard>();
    if (!data.settings || !Array.isArray(data.conversations)
      || !Array.isArray(data.orders) || !Array.isArray(data.failures)) throw new Error("whatsapp_unavailable");
    if (!live.current) return;
    setDashboard(data);
    setSettings(current => replace || !current ? {
      ...data.settings, opens_at: data.settings.opens_at?.slice(0, 5) ?? null, closes_at: data.settings.closes_at?.slice(0, 5) ?? null,
    } : current);
  }, [api, connectionOnly]);

  useEffect(() => {
    live.current = true;
    void refresh(true).catch(e => { if (live.current) setError(e.message); })
      .finally(() => { if (live.current) setLoading(false); });
    return () => { live.current = false; abort.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!connectionOnly) return;
    const url = new URLSearchParams(window.location.search);
    const returned = url.get("whatsappSignup");
    if (url.get("whatsappRestaurant") !== restaurantId) return;
    if (!returned) return;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(returned)) {
      setError(["signup_expired", "subscription_inactive", "cancelled"].includes(returned) ? returned : "meta_return_failed");
      return;
    }
    let current = true;
    setPending("return");
    void api<{ phones: Phone[] }>("/signup/" + returned + "/phones").then(({ phones }) => {
      if (current) setSignup({ id: returned, phones, assets: phones.length === 1 ? phones[0] : undefined });
    }).catch(e => {
      if (current) setError(e.message);
    }).finally(() => {
      if (current) setPending("");
    });
    return () => { current = false; };
  }, [api, connectionOnly, restaurantId]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setPending(name);
    setError("");
    setNotice("");
    try { await fn(); }
    catch (e) { if (live.current) setError(e instanceof Error ? e.message : "whatsapp_unavailable"); }
    finally { if (live.current) setPending(""); }
  };

  const loadThread = async (id: string, before?: string) => {
    const next = await api<Thread>("/conversations/" + id + (before ? "?before=" + before : ""));
    setThread(previous => before && previous?.conversation.id === id ? { ...next, messages: [...previous.messages, ...next.messages] } : next);
  };

  const begin = (sameTab: boolean) => void run("signup", async () => {
    if (!connection?.setup) return;
    clearSignupReturn();
    setPin("");
    if (sameTab) {
      const session = await api<{ id: string; url: string }>("/signup", "POST", { mode: "same_tab" });
      setSignup(session);
      return;
    }
    const sdk = await signupSdk(connection.setup);
    const session = await api<{ id: string }>("/signup", "POST");
    setSignup({ id: session.id, sdk });
  });

  const saveManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const credentials = Object.fromEntries(["appId", "appSecret", "waba", "phone", "token"]
      .map(name => [name, String(fields.get(name) ?? "").trim()]));
    for (const name of ["appSecret", "token"]) (form.elements.namedItem(name) as HTMLInputElement).value = "";
    void run("manual", async () => {
      await api("/connection", "POST", credentials);
      setManualOpen(false);
      await refresh();
      setNotice(tr("تم التحقق من الرقم واشتراك الإشعارات.", "Phone and webhook subscription verified."));
    });
  };

  const saveGupshup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const credentials = Object.fromEntries(["appId", "appName", "source", "apiKey"]
      .map(name => [name, String(fields.get(name) ?? "").trim()]));
    (form.elements.namedItem("apiKey") as HTMLInputElement).value = "";
    void run("manual", async () => {
      await api("/connection", "POST", { ...credentials, provider: "gupshup" });
      setManualOpen(false);
      await refresh();
      setNotice(tr("تم التحقق من صلاحية الوصول للتطبيق. انسخ رابط التتبّع الخاص أدناه إلى Gupshup واختر الإصدار 2.", "App access verified. Copy the private callback URL below into Gupshup and select version 2."));
    });
  };

  const finalize = async (state: Signup, assets: Assets, registrationPin = "") => {
    try {
      await api("/signup/complete", "POST", { signupId: state.id, waba: assets.waba, phone: assets.phone, pin: registrationPin || null });
      clearSignupReturn();
      setSignup(null);
      setPin("");
      setNotice(tr("تم التحقق من الرقم واشتراك الإشعارات.", "Phone connection and webhook subscription verified."));
    } catch (e) {
      if (e instanceof Error && e.message === "signup_expired") {
        clearSignupReturn();
        setSignup(null);
      }
      throw e;
    } finally {
      await refresh().catch(() => {});
    }
  };

  const launch = () => {
    if (!signup?.sdk || !connection?.setup) return;
    const sdk = signup.sdk;
    const setup = connection.setup;
    abort.current = new AbortController();
    const signal = abort.current.signal;
    void run("popup", async () => {
      try {
        const assets = await signupPopup(sdk, setup, code => api("/signup/exchange", "POST", { signupId: signup.id, code }), signal);
        if (signal.aborted || !live.current) return;
        setSignup({ ...signup, assets });
        if (assets.coexistence) await finalize(signup, assets);
      } catch (e) {
        if (!signal.aborted) {
          if (e instanceof Error && ["popup_no_response", "popup_timeout", "signup_expired"].includes(e.message)) setSignup(null);
          throw e;
        }
      }
    });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    void run("save", async () => {
      await api("/settings", "PUT", settings);
      await refresh(true);
      setNotice(tr("تم حفظ الإعدادات.", "Settings saved."));
    });
  };

  const change = <K extends keyof OwnerSettings>(key: K, value: OwnerSettings[K]) =>
    setSettings(current => current && { ...current, [key]: value });

  const labels: Record<string, string> = {
    connected: tr("مرتبط", "Connected"), disconnected: tr("غير مرتبط", "Disconnected"),
    connecting: tr("جارٍ الربط", "Connecting"), disconnecting: tr("جارٍ الفصل", "Disconnecting"),
    reconnect_required: tr("يلزم إعادة الربط", "Reconnect required"), pending: tr("بانتظار الموافقة", "Awaiting approval"),
    preparing: tr("قيد التحضير", "Preparing"), ready: tr("جاهز للاستلام", "Ready for pickup"),
    served: tr("مكتمل", "Completed"), rejected: tr("مرفوض", "Declined"), cancelled: tr("ملغى", "Cancelled"),
    queued: tr("في قائمة الانتظار", "Queued"), processing: tr("قيد المعالجة", "Processing"),
    accepted: tr("قبله مزود الرسائل", "Accepted by provider"), sent: tr("أُرسل", "Sent"), delivered: tr("تم التوصيل", "Delivered"),
    read: tr("مقروء", "Read"), failed: tr("فشل", "Failed"), blocked: tr("متوقف", "Blocked"),
    uncertain: tr("الإرسال غير مؤكد", "Send outcome unknown"), done: tr("تمت المعالجة", "Processed"),
    skipped: tr("تم التخطي", "Skipped"), sending: tr("جارٍ الإرسال", "Sending"),
  };
  const errors: Record<string, string> = {
    assistant_unavailable: tr("تعذّر تشغيل المساعد. تواصل مع الإدارة.", "The assistant is unavailable. Contact ORDOVA support."),
    invalid_delivery_zones: tr("تأكد من المدينة والمنطقة ورسوم التوصيل لكل منطقة، بدون مناطق مكررة.","Check each delivery city, area and fee; duplicate areas are not allowed."),
    delivery_zones_required: tr("أضف مناطق التوصيل ورسومها قبل تفعيل طلبات التوصيل.","Add delivery areas and fees before enabling delivery orders."),
    invalid_delivery_settings: tr("إعدادات التوصيل غير صالحة.","Delivery settings are invalid."),
    invalid_gupshup_credentials: tr("تحقق من اسم تطبيق Gupshup ومعرّفه ورقم المرسل مع رمز الدولة ومفتاح API.", "Check the Gupshup App Name, App ID, sender number with country code, and API key."),
    gupshup_unauthorized: tr("مفتاح Gupshup غير صالح أو لا يملك صلاحية هذا التطبيق. استبدل بيانات الربط.", "The Gupshup API key is invalid or cannot access this app. Replace the credentials."),
    gupshup_app_unverified: tr("لم نتمكن من التحقق من تطبيق Gupshup. تحقق من معرّف التطبيق والمفتاح.", "Gupshup app access could not be verified. Check the App ID and API key."),
    owner_required: tr("هذا القسم متاح لمالك المطعم فقط.", "This section is available to the restaurant owner."),
    unauthorized: tr("سجّل الدخول من جديد.", "Sign in again to continue."),
    meta_not_configured: tr("إعداد ميتا مطلوب من إدارة أوردوفا.", "An ORDOVA administrator needs to configure Meta."),
    manual_not_configured: tr("إعداد تشفير بيانات واتساب مطلوب من إدارة أوردوفا.", "An ORDOVA administrator needs to configure WhatsApp credential encryption."),
    invalid_manual_credentials: tr("تحقق من معرّفات ميتا والرمز ومفتاح التطبيق.", "Check the Meta IDs, access token, and App Secret."),
    meta_phone_mismatch: tr("لم تعثر ميتا على الرقم ضمن الحساب المحدد.", "Meta did not confirm this number belongs to the specified WhatsApp account."),
    meta_register_in_meta: tr("سجّل الرقم في ميتا قبل ربطه بأوردوفا.", "Register the phone in Meta before connecting it to ORDOVA."),
    meta_permissions_unverified: tr("تحقق من تطبيق ميتا وصلاحيات رمز الوصول.", "Check that the access token belongs to this Meta app and has both WhatsApp permissions."),
    ai_not_configured: tr("إعداد OpenAI مطلوب من إدارة أوردوفا.", "An ORDOVA administrator needs to configure OpenAI."),
    signup_expired: tr("انتهت جلسة الربط. ابدأ من جديد.", "The signup session expired. Start again."),
    number_required: tr("اختر حساباً واحداً ورقم عمل مؤهلاً وأكمل التحقق.", "Select one messaging account and verify an eligible business number."),
    cancelled: tr("أُغلقت نافذة ميتا قبل إكمال الربط.", "The Meta window closed before signup finished."),
    failed: tr("تعذر إكمال التسجيل لدى ميتا. راجع أهلية الرقم أو استخدم رقماً مخصصاً.", "Meta could not complete signup. Check number eligibility or use a dedicated number."),
    popup_not_opened: tr("ما وصلنا رد من نافذة ميتا. استخدم خيار فتح ميتا في نفس الصفحة.", "Meta's window did not respond. Choose Open Meta in this tab."),
    popup_no_response: tr("ما اكتمل رد ميتا. ابدأ الربط من جديد واضغط إنهاء داخل نافذة ميتا قبل إغلاقها.", "Meta did not finish sending its response. Start the connection again and click Finish in Meta before closing the window."),
    popup_timeout: tr("انتهى وقت الربط مع ميتا. ابدأ الربط من جديد.", "Meta signup timed out. Start the connection again."),
    sdk_unavailable: tr("تعذر تحميل نافذة ميتا. اسمح بالنوافذ المنبثقة.", "Meta could not load. Allow its popup and retry."),
    meta_pin_required: tr("أدخل رمزاً من ٦ أرقام لتسجيل الرقم.", "Enter a six-digit PIN to register the number."),
    meta_no_phone: tr("ما وصلنا رقم مؤهل من ميتا. ابدأ الربط من جديد واختر حساب واتساب ورقم عمل.", "Meta returned no eligible phone. Start again and select a WhatsApp account and business number."),
    meta_return_failed: tr("تعذّر التحقق من تفويض ميتا. ابدأ الربط من جديد وأكمل الخطوات بنفس المتصفح.", "Meta authorization could not be verified. Start again and finish in the same browser."),
    subscription_inactive: tr("يتطلب ربط الرقم اشتراكاً فعالاً.", "Connecting a phone requires an active subscription."),
    revoke_in_meta: tr("تم الفصل من أوردوفا. ألغِ إذن أوردوفا في إعدادات ميتا.", "Disconnected in ORDOVA. Revoke ORDOVA access in Meta Business settings."),
    service_window_closed: tr("انتهت نافذة الـ٢٤ ساعة. استخدم قناة بديلة بموافقة الزبون.", "The 24-hour window closed. Use an alternate contact method with the customer’s consent."),
    account_in_use: tr("هذا الرقم أو الحساب مرتبط بمطعم آخر.", "This number or messaging account is already linked."),
    disconnect_current_number: tr("افصل الرقم الحالي قبل ربط رقم آخر.", "Disconnect the current number before connecting another."),
    status_superseded: tr("حالة الطلب تغيّرت منذ هذا الإشعار.", "The order status changed after this update."),
    token_expired: tr("انتهى إذن ميتا. أعد الربط.", "Meta authorization expired. Reconnect the number."),
    meta_access_revoked: tr("أُلغي إذن الوصول لدى ميتا. أعد الربط.", "Meta access was revoked. Reconnect the number."),
    account_operation_unavailable: tr("هناك عملية ربط أو فصل جارية. حدّث الصفحة وحاول بعد قليل.", "A connection operation is in progress. Refresh and try again shortly."),
  };
  const describe = (code: string) => {
    const delivery = /^gupshup_delivery_([^:]+)(?:: (.*))?$/.exec(code);
    if (delivery) return tr("تعذّر توصيل الرسالة عبر Gupshup", "Gupshup could not deliver the message") +
      " (" + delivery[1] + ")" + (delivery[2] ? ": " + delivery[2] : "");
    return errors[code] || tr("تعذر إكمال العملية", "Could not complete the operation") + " (" + code + ")";
  };
  const date = (value: string) => new Intl.DateTimeFormat(language === "ar" ? "ar-IQ" : "en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad",
  }).format(new Date(value));
  const cost = (usage: Usage) => usage.estimated_usd == null ? tr("غير متوفر", "Unavailable") : "$" + Number(usage.estimated_usd).toFixed(4);
  const account = connection?.account;
  const disabled = !!pending;
  const preferSameTab = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
  const selectedPhone = signup?.phones?.find(phone => phone.phone === signup.assets?.phone);
  const needsPin = signup?.assets && (selectedPhone?.needsPin ?? !signup.assets.coexistence);
  return <div className="min-w-0 space-y-5" dir={dir}>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-3 font-display text-2xl font-bold text-brand-primary">
        <MessageCircle className="h-6 w-6 text-emerald-700" /> {connectionOnly
          ? tr("واتساب المطعم", "Restaurant WhatsApp") : tr("طلبات واتساب", "WhatsApp orders")}
      </h1>
      <button type="button" className={secondary} disabled={disabled || loading} onClick={() => void run("refresh", async () => {
        await refresh();
        if (threadId) await loadThread(threadId);
      })}><RefreshCw size={15} /> {tr("تحديث", "Refresh")}</button>
    </header>
    {loading && <p role="status" className={panel}>{tr("جارٍ تحميل الإعدادات…", "Loading WhatsApp settings…")}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{describe(error)}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {connectionOnly && connection && <>
      <div className="grid gap-5">
        <section className={panel}>
          <h2 className={heading}>{tr("ربط رقم واتساب", "WhatsApp connection")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className={account?.status === "connected" ? "rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-900" : "rounded-lg bg-bg-paper px-3 py-1 text-sm font-bold text-text-muted"}>
              {labels[account?.status ?? "disconnected"]}
            </span>
            {account?.display_phone && <bdi className="font-mono text-sm">{account.display_phone}</bdi>}
          </div>
          {account?.provider === "gupshup" && <p className="mt-2 text-sm">Gupshup · <bdi>{account.gupshup_app_name}</bdi></p>}
          {connection.gupshup && <div className="mt-3 space-y-2 rounded-xl border border-border-delicate p-3">
            <label className="block text-sm">{tr("رابط Gupshup الخاص للتتبّع", "Private Gupshup webhook callback URL")}
              <input className={field} dir="ltr" readOnly type="password" autoComplete="off" value={connection.gupshup.callback} onFocus={event => event.currentTarget.select()} />
            </label>
            <button type="button" className={secondary} onClick={() => void run("copy", async () => {
              await navigator.clipboard.writeText(connection.gupshup!.callback);
              setNotice(tr("تم نسخ رابط التتبّع.", "Callback URL copied."));
            })}>{tr("نسخ الرابط", "Copy callback URL")}</button>
            <p className="text-sm text-text-muted">{tr("في تطبيق Gupshup افتح Webhooks وأضف الرابط كاملاً واختر الإصدار 2. فعّل الرسائل الواردة وأحداث الإرسال والتوصيل والقراءة والفشل. الرابط يحتوي رمزاً سرياً؛ لا تشاركه. عند استبدال المفتاح، حدّث الرابط أيضاً.", "In your Gupshup app, open Webhooks, add the entire URL, and select version 2. Enable incoming messages and sent, delivered, read, enqueued, and failed events. This URL contains a secret; keep it private. Update it after replacing credentials.")}</p>
            <p className="text-sm">{account?.subscribed ? tr("وصل حدث موثّق من Gupshup.", "Authenticated Gupshup callback received.") : tr("بانتظار أول حدث موثّق من Gupshup. فحص الاتصال يتحقق من المفتاح فقط.", "Awaiting the first authenticated Gupshup event. Check connection verifies API access only.")}</p>
          </div>}
          {account?.coexistence && account.status === "connected" && <p className="mt-2 text-sm text-text-muted">{tr("الرقم مرتبط أيضاً بتطبيق واتساب للأعمال.", "This number also uses the WhatsApp Business app.")}</p>}
          {account?.verified_at && <p className="mt-2 text-sm text-text-muted">{tr("آخر تحقق", "Last verification")} · {date(account.verified_at)}</p>}
          {(account?.token_expires_at || account?.data_access_expires_at) && <p className="mt-2 text-sm text-text-muted">
            {tr("انتهاء إذن ميتا", "Meta authorization expires")} · {date([account.token_expires_at, account.data_access_expires_at].filter(Boolean).sort()[0]!)}
          </p>}
          <p className="mt-2 text-sm text-text-muted">{tr("آخر حدث من واتساب", "Last WhatsApp event")} · {account?.last_webhook_at ? date(account.last_webhook_at) : tr("لم يصل حدث بعد", "Awaiting first event")}</p>
          {account?.last_error && <p className="mt-2 text-sm text-red-800">{describe(account.last_error)}</p>}
          {!connection.manual && <p className="mt-3 text-sm text-amber-900">{errors.manual_not_configured}</p>}
          {dashboard && !dashboard.aiConfigured && <p className="mt-2 text-sm text-amber-900">{errors.ai_not_configured}</p>}
          {!signup && <div className="mt-4 flex flex-wrap gap-2">
            {connection.manual && <button type="button" className={primary} disabled={disabled} onClick={() => { setProvider(account?.provider || "gupshup"); setManualOpen(open => !open); }}>
              {account?.status === "connected" ? tr("استبدال بيانات الربط", "Replace credentials") : tr("ربط واتساب يدوياً", "Connect WhatsApp manually")}
            </button>}
            {connection.setup && <button type="button" className={secondary} disabled={disabled}
              onClick={() => begin(preferSameTab)}>
              {tr("الربط عبر ميتا", "Connect with Meta signup")}
            </button>}
            {connection.setup && !preferSameTab && <button type="button" className={secondary} disabled={disabled} onClick={() => begin(true)}>
              {tr("فتح ميتا في نفس الصفحة", "Open Meta in this tab")}
            </button>}
            {account?.status === "connected" && <button type="button" className={secondary} disabled={disabled} onClick={() => void run("health", async () => {
              try { await api("/health", "POST"); setNotice(tr("اكتمل فحص الاتصال.", "Connection check completed.")); }
              finally { await refresh(); }
            })}>{tr("فحص الاتصال", "Check connection")}</button>}
            {account && ["connected", "reconnect_required"].includes(account.status) &&
              <button type="button" className={secondary} disabled={disabled} onClick={() => setConfirmDisconnect(true)}>{tr("فصل", "Disconnect")}</button>}
          </div>}
          {manualOpen && connection.manual && <label className="mt-4 block text-sm">{tr("مزود الرسائل", "Messaging provider")}
            <select className={field} value={provider} disabled={disabled} onChange={event => setProvider(event.target.value as "gupshup" | "meta")}>
              <option value="gupshup">Gupshup Self-Serve</option><option value="meta">Meta Cloud API</option>
            </select>
          </label>}
          {manualOpen && connection.manual && provider === "gupshup" && <form onSubmit={saveGupshup} className="mt-4 space-y-3 rounded-xl border border-border-delicate p-3">
            <p className="text-sm">{tr("من إعدادات تطبيق Gupshup انسخ اسم التطبيق ومعرّفه ومفتاح API. أدخل رقم المرسل المسجّل مع رمز الدولة، بدون +. يبقى المفتاح مشفراً على الخادم.", "Copy App Name, App ID, and API Key from your Gupshup app settings. Enter its registered sender number with country code, without +. The key stays encrypted on the server.")}</p>
            {([ ["appName", "Gupshup App Name", account?.gupshup_app_name], ["appId", "Gupshup App ID", account?.gupshup_app_id], ["source", tr("رقم المرسل مع رمز الدولة", "Sender number with country code"), account?.gupshup_source] ] as const).map(([name, label, value]) => <label key={name} className="block text-sm">{label}
              <input className={field} name={name} dir="ltr" required maxLength={128} defaultValue={value ?? ""} inputMode={name === "source" ? "tel" : "text"} />
            </label>)}
            <label className="block text-sm">Gupshup API Key
              <input className={field} name="apiKey" type="password" autoComplete="off" dir="ltr" required maxLength={4096} />
            </label>
            <button type="submit" className={primary} disabled={disabled}>{tr("تحقق واحفظ", "Verify and save")}</button>
          </form>}
          {manualOpen && connection.manual && provider === "meta" && <form onSubmit={saveManual} className="mt-4 space-y-3 rounded-xl border border-border-delicate p-3">
            <p className="text-sm">{tr("في تطبيق ميتا الخاص بالمطعم، اختر Webhooks لحساب WhatsApp Business وأضف رابط التتبّع ورمز التحقق ثم اشترك في messages.", "In the restaurant’s Meta app, configure the WhatsApp Business Account webhook with this callback and verify token, then subscribe to messages.")}</p>
            <label className="block text-sm">{tr("رابط التتبّع", "Webhook callback URL")}
              <input className={field} dir="ltr" readOnly value={connection.manual.callback} onFocus={event => event.currentTarget.select()} />
            </label>
            <label className="block text-sm">{tr("رمز التحقق", "Webhook verify token")}
              <input className={field} dir="ltr" readOnly value={connection.manual.verifyToken} onFocus={event => event.currentTarget.select()} />
            </label>
            {([
              ["phone", "Phone Number ID", account?.phone_id],
              ["waba", "WhatsApp Business Account ID", account?.waba_id],
              ["appId", "Meta App ID", account?.meta_app_id],
            ] as const).map(([name, label, value]) => <label key={name} className="block text-sm">{label}
              <input name={name} className={field} dir="ltr" inputMode="numeric" pattern="[0-9]{5,32}" required defaultValue={value ?? ""} />
            </label>)}
            <label className="block text-sm">Meta App Secret
              <input name="appSecret" className={field} dir="ltr" type="password" autoComplete="off" required maxLength={32} />
            </label>
            <label className="block text-sm">{tr("رمز الوصول", "Access token")}
              <input name="token" className={field} dir="ltr" type="password" autoComplete="off" required maxLength={4096} />
            </label>
            <button type="submit" className={primary} disabled={disabled}>{tr("تحقق واحفظ", "Verify and save")}</button>
          </form>}
          {confirmDisconnect && <div className="mt-4 rounded-xl border border-border-delicate p-3">
            <p className="mb-2 text-sm">{tr("سيُوقف استقبال الرسائل وإرسالها عبر أوردوفا لهذا الرقم.", "This stops ORDOVA from receiving and sending WhatsApp messages for this number.")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled={disabled} onClick={() => void run("disconnect", async () => {
                const response = await api<{ warning: string | null }>("/disconnect", "POST");
                setConfirmDisconnect(false);
                await refresh();
                if (response.warning) setError(response.warning);
              })}>{tr("تأكيد الفصل", "Confirm disconnect")}</button>
              <button type="button" className={secondary} disabled={disabled} onClick={() => setConfirmDisconnect(false)}>{tr("إلغاء", "Cancel")}</button>
            </div>
          </div>}
          {signup && <div className="mt-4 space-y-3 rounded-xl border border-border-delicate bg-bg-paper p-3">
            {signup.phones && <label className="block space-y-1 text-sm">
              <span>{tr("رقم واتساب للأعمال", "WhatsApp Business number")}</span>
              <select className={field} value={signup.assets?.phone ?? ""} disabled={disabled} onChange={event => {
                const phone = event.target.value;
                setPin("");
                setSignup({ ...signup, assets: signup.phones?.find(asset => asset.phone === phone) });
              }}>
                <option value="" disabled>{tr("اختر رقم واتساب", "Choose a WhatsApp number")}</option>
                {signup.phones.map(phone => <option key={phone.phone} value={phone.phone}>{phone.display}</option>)}
              </select>
            </label>}
            {(needsPin || !signup.phones) && <p className="text-sm">{needsPin
              ? tr("للرقم الجديد، اختر رمز PIN من ستة أرقام واحتفظ به بأمان. يمكنك تركه فارغاً إذا كان الرقم مسجلاً مسبقاً.", "For a new number, choose a six-digit PIN and keep it somewhere safe. Leave it blank if the number is already registered.")
              : tr("أكمل تفويض الرقم في ميتا. يمكن ربط رقم تطبيق واتساب للأعمال إذا وافقت ميتا على أهليته.", "Authorize the number in Meta. You can keep using an existing WhatsApp Business app number if Meta marks it eligible.")}</p>}
            {needsPin && <label className="block space-y-1 text-sm">
              <span>{tr("رمز PIN لدى ميتا", "Meta registration PIN")}</span>
              <input className={field} type="password" inputMode="numeric" maxLength={6} autoComplete="off"
                value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ""))} />
            </label>}
            <div className="flex flex-wrap gap-2">
              {signup.phones || signup.assets
                ? <button type="button" className={primary} disabled={disabled || !signup.assets || ((selectedPhone?.needsPin || pin.length > 0) && pin.length !== 6)}
                    onClick={() => void run("complete", () => finalize(signup, signup.assets!, pin))}>{tr("تحقق من الربط", "Verify connection")}</button>
                : signup.url
                  ? <a className={primary + " inline-flex items-center"} href={signup.url}>{tr("متابعة مع ميتا", "Continue with Meta")}</a>
                  : <button type="button" className={primary} disabled={disabled} onClick={launch}>{tr("متابعة مع ميتا", "Continue with Meta")}</button>}
              {signup.sdk && !signup.assets && !pending && <button type="button" className={secondary} onClick={() => begin(true)}>
                {tr("فتح ميتا في نفس الصفحة", "Open Meta in this tab")}
              </button>}
              <button type="button" className={secondary} disabled={!!pending && pending !== "popup"}
                onClick={() => { abort.current?.abort(); clearSignupReturn(); setSignup(null); setPin(""); }}>{tr("إلغاء", "Cancel")}</button>
            </div>
            {pending && <p role="status" className="text-sm text-text-muted">{pending === "popup"
              ? tr("أكمل الربط في نافذة ميتا التي يفتحها المتصفح…", "Complete signup in the Meta window opened by your browser…")
              : tr("جارٍ التحقق من ميتا…", "Verifying with Meta…")}</p>}
          </div>}
        </section>
      </div>
    </>}
        {dashboard && settings && <form onSubmit={save} className={panel}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-brand-primary">{tr("إعدادات المساعد", "Assistant settings")}</h2>
            <span className="text-sm font-semibold text-text-muted">{dashboard.connected && dashboard.aiConfigured
              ? tr("المساعد جاهز", "Assistant ready") : tr("المساعد غير جاهز · تواصل مع الإدارة", "Assistant unavailable · Contact ORDOVA support")}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {([
              ["enabled", tr("تشغيل المساعد", "Enable assistant")],
              ["ordering_enabled", tr("استقبال طلبات واتساب", "Accept WhatsApp orders")],
              ["handoff_enabled", tr("طلب مساعدة بشرية", "Allow staff handoff")],
            ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={settings[key]} disabled={disabled || (key === "enabled" && !dashboard.aiConfigured && !settings.enabled)}
                onChange={event => change(key, event.target.checked)} className="h-4 w-4 accent-brand-primary" /> {label}
            </label>)}
          </div>
          <label className="mt-4 block space-y-1 text-sm">
            <span>{tr("رسالة ترحيب اختيارية", "Custom welcome message")}</span>
            <textarea className={field} rows={2} maxLength={300} value={settings.welcome} onChange={e => change("welcome", e.target.value)} />
          </label>
          <details className="my-3 rounded-xl border border-border-delicate p-3" onInvalid={event => { event.currentTarget.open = true; }}>
            <summary className="cursor-pointer text-sm font-semibold">{tr("الدوام والتوصيل وخيارات الرد", "Hours, delivery, and reply options")}</summary>
          <fieldset className="mt-4 space-y-3 rounded-xl border border-border-delicate p-3">
            <legend className="px-1 text-sm font-semibold">{tr("طلبات التوصيل", "Delivery ordering")}</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-primary"
              checked={!!settings.delivery_enabled} disabled={disabled} onChange={event=>change("delivery_enabled",event.target.checked)} />
              {tr("تفعيل طلبات التوصيل عبر واتساب", "Enable WhatsApp delivery orders")}</label>
            <p className="text-xs text-text-muted">{tr("حدد المدينة والمنطقة ورسوم التوصيل الفعلية لكل منطقة. المساعد ما يثبت طلب توصيل خارج التغطية المسجلة. الصفر يعني توصيلاً مجانياً لهذه المنطقة.", "Enter each delivery city, area and actual fee. The assistant cannot confirm delivery outside configured coverage. Zero means free delivery for that area.")}</p>
            {(settings.delivery_zones||[]).map((zone,index)=><div key={zone.id} className="grid gap-2 rounded-xl bg-bg-paper p-2 sm:grid-cols-4">
              <label className="text-xs">{tr("المدينة", "City")}<input className={field} required maxLength={80} value={zone.city}
                onChange={event=>change("delivery_zones",(settings.delivery_zones||[]).map((row,i)=>i===index?{...row,city:event.target.value}:row))} /></label>
              <label className="text-xs">{tr("المنطقة", "Area")}<input className={field} required maxLength={80} value={zone.area}
                onChange={event=>change("delivery_zones",(settings.delivery_zones||[]).map((row,i)=>i===index?{...row,area:event.target.value}:row))} /></label>
              <label className="text-xs">{tr("رسوم التوصيل (د.ع)", "Delivery fee (IQD)")}<input className={field} required type="number" min={0} max={1000000} step="0.01" value={zone.fee}
                onChange={event=>change("delivery_zones",(settings.delivery_zones||[]).map((row,i)=>i===index?{...row,fee:Number(event.target.value)}:row))} /></label>
              <button className={secondary} type="button" disabled={disabled} onClick={()=>change("delivery_zones",(settings.delivery_zones||[]).filter((_,i)=>i!==index))}>{tr("حذف المنطقة", "Remove area")}</button>
            </div>)}
            <button type="button" className={secondary} disabled={disabled||(settings.delivery_zones||[]).length>=100}
              onClick={()=>change("delivery_zones",[...(settings.delivery_zones||[]),{id:crypto.randomUUID(),city:"",area:"",fee:0}])}>{tr("إضافة منطقة توصيل", "Add delivery area")}</button>
          </fieldset>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">{tr("اللغة الافتراضية", "Default language")}
              <select className={field} value={settings.language} onChange={e => change("language", e.target.value === "en" ? "en" : "ar")}>
                <option value="ar">{tr("العربية العراقية", "Iraqi Arabic")}</option><option value="en">English</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">{tr("أسلوب الترحيب", "Greeting tone")}
              <select className={field} value={settings.tone} onChange={e => change("tone", e.target.value === "formal" ? "formal" : "friendly")}>
                <option value="friendly">{tr("ودّي", "Friendly")}</option><option value="formal">{tr("رسمي", "Formal")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">{tr("بداية استقبال الطلبات", "Ordering opens")}
              <input className={field} type="time" value={settings.opens_at || ""} onChange={e => change("opens_at", e.target.value || null)} />
            </label>
            <label className="space-y-1 text-sm">{tr("نهاية استقبال الطلبات", "Ordering closes")}
              <input className={field} type="time" value={settings.closes_at || ""} onChange={e => change("closes_at", e.target.value || null)} />
            </label>
            <label className="space-y-1 text-sm">{tr("التوقيت", "Time zone")}
              <select className={field} value={settings.timezone} onChange={e => change("timezone", e.target.value)}>
                <option value="Asia/Baghdad">{tr("بغداد", "Baghdad")}</option><option value="UTC">UTC</option>
              </select>
            </label>
          </div>
          <p className="my-3 text-xs text-text-muted">{tr("اترك الوقتين فارغين لاستقبال الطلبات طوال اليوم.", "Leave both times empty to accept orders all day.")}</p>
          </details>
          <button type="submit" className={primary} disabled={disabled}>{pending === "save" ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ الإعدادات", "Save settings")}</button>
        </form>}
    {connectionOnly && connection && limits && <>
          <form className={panel} onSubmit={event => {
            event.preventDefault();
            void run("limits", async () => {
              await api("/limits", "PUT", { ...limits, ai_policy: { ...defaultPolicy, ...limits.ai_policy } });
              await refresh(true);
              setNotice(tr("تم حفظ الحدود.", "Limits saved."));
            });
          }}>
          <label className="block space-y-1 text-sm">{tr("حد محاولات الذكاء الاصطناعي يومياً", "Daily AI request limit")}
            <input className={field} type="number" min={1} max={500} required value={limits.daily_ai_limit || ""}
              onChange={e => setLimits({ ...limits, daily_ai_limit: Number(e.target.value) })} />
          </label>
          <details className="my-3 rounded-xl border border-border-delicate p-3" onInvalid={event => { event.currentTarget.open = true; }}>
            <summary className="cursor-pointer text-sm font-semibold">{tr("حدود استخدام المساعد", "Assistant usage limits")}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                ["daily_budget_usd", tr("ميزانية OpenAI اليومية ($)", "Daily OpenAI budget ($)"), 0, 1000, 0.01],
                ["monthly_budget_usd", tr("ميزانية OpenAI الشهرية ($)", "Monthly OpenAI budget ($)"), 0, 10000, 0.01],
                ["monthly_requests", tr("محاولات الذكاء الاصطناعي شهرياً", "Monthly AI attempts"), 1, 100000, 1],
                ["customer_daily_requests", tr("رسائل الزبون يومياً", "Customer messages per day"), 1, 1000, 1],
              ] as const).map(([key, label, min, max, step]) => <label key={key} className="space-y-1 text-sm">
                <span>{label}</span><input className={field} type="number" min={min} max={max} step={step} required
                  value={{ ...defaultPolicy, ...limits.ai_policy }[key]}
                  onChange={event => setLimits({ ...limits, ai_policy: { ...defaultPolicy, ...limits.ai_policy, [key]: Number(event.target.value) } })} />
              </label>)}
            </div>
            <p className="mt-2 text-xs text-text-muted">{tr("الحدود المالية تستخدم حجزاً احتياطياً لكل محاولة؛ وقد توقف المساعد قبل الوصول إلى التكلفة الفعلية المعروضة. الصفر يوقف محاولات الذكاء الاصطناعي المدفوعة.", "Budget limits reserve a conservative amount per attempt and may stop AI calls before the displayed actual estimate reaches the limit. Zero disables paid AI attempts.")}</p>
          </details>
          <button type="submit" className={primary} disabled={disabled}>{tr("حفظ الحدود", "Save limits")}</button>
        </form>
      <section className={panel}>
        <h2 className={heading}>{tr("استخدام الذكاء الاصطناعي هذا الشهر", "AI usage this month")}</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {[
            [tr("المحاولات", "Attempts"), connection.usage.attempts],
            [tr("رموز الإدخال", "Input tokens"), connection.usage.input_tokens],
            [tr("رموز الإخراج", "Output tokens"), connection.usage.output_tokens],
            [tr("تكلفة OpenAI المقدّرة", "Estimated OpenAI cost"), cost(connection.usage)],
            [tr("رموز الإدخال المخزّنة", "Cached input tokens"), connection.usage.cached_input_tokens ?? 0],
            [tr("رسائل واردة / صادرة", "Inbound / submitted messages"), (connection.usage.inbound_messages ?? 0) + " / " + (connection.usage.outbound_messages ?? 0)],
            [tr("محظورة / مكررة / مجمّعة", "Blocked / duplicate / batched"), (connection.usage.blocked_requests ?? 0) + " / " + (connection.usage.duplicate_events ?? 0) + " / " + (connection.usage.batched_messages ?? 0)],
            [tr("رسوم Gupshup المقدّرة فقط", "Estimated Gupshup fee only"), connection.usage.estimated_provider_usd == null ? tr("غير متوفر", "Unavailable") : "$" + connection.usage.estimated_provider_usd.toFixed(4)],
          ].map(([label, value]) => <div key={label} className="rounded-xl bg-bg-paper p-3"><dt className="text-text-muted">{label}</dt><dd className="mt-1 break-words text-xl font-bold text-brand-primary">{value}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-text-muted">{tr("عدد المحاولات المقاسة", "Measured attempts")} · {connection.usage.measured}/{connection.usage.attempts} · {tr("المقدّرة", "Estimated")} · {connection.usage.estimated_attempts}/{connection.usage.attempts}</p>
      </section>
    </>}
    {dashboard && settings && <>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className={panel}>
          <h2 className={heading}>{tr("أحدث المحادثات", "Recent conversations")}</h2>
          {!dashboard.conversations.length && <p className="text-sm text-text-muted">{tr("لا توجد محادثات بعد.", "No conversations yet.")}</p>}
          <ul className="max-h-52 divide-y divide-border-delicate overflow-auto">
            {dashboard.conversations.map(chat => <li key={chat.id}>
              <button className="flex w-full flex-wrap justify-between gap-2 rounded-md py-2 text-start text-sm text-brand-primary hover:bg-bg-paper"
                type="button" disabled={disabled} aria-pressed={threadId === chat.id}
                onClick={() => { setThreadId(chat.id); setThread(null); setManualText(""); void run("thread", () => loadThread(chat.id)); }}>
                <bdi>{chat.customer_id}</bdi><span>{chat.handoff ? tr("يتطلب متابعة", "Staff follow-up") : date(chat.last_inbound_at)}</span>
              </button>
            </li>)}
          </ul>
          {pending === "thread" && <p role="status" className="py-2 text-sm">{tr("جارٍ تحميل المحادثة…", "Loading conversation…")}</p>}
          {thread && <div className="mt-4 space-y-3 border-t border-border-delicate pt-3">
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className={secondary} disabled={disabled} onClick={() => void run("handoff", async () => {
                await api("/conversations/" + threadId, "POST", { action: thread.conversation.handoff ? "resume" : "take" });
                await Promise.all([loadThread(threadId), refresh()]);
              })}>{thread.conversation.handoff ? tr("إعادة تشغيل المساعد", "Resume assistant") : tr("استلام المحادثة", "Take over conversation")}</button>
            </div>
            <ol className="flex max-h-72 flex-col gap-2 overflow-auto">
              {thread.messages.map(item => <li key={item.id} className={item.direction === "in" ? "me-5 rounded-xl bg-bg-paper p-3" : "ms-5 rounded-xl border border-border-delicate p-3"}>
                <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
                  {item.payload.text || (item.kind === "order_status" && item.payload.status
                    ? "#" + item.payload.order_number + " · " + (labels[item.payload.status] || item.payload.status)
                    : tr("رسالة واتساب", "WhatsApp message"))}
                </p>
                <p className="mt-1 text-xs text-text-muted">{date(item.created_at)} · {labels[item.state] || item.state}</p>
              </li>)}
            </ol>
            {thread.before && <button type="button" className={secondary} disabled={disabled}
              onClick={() => void run("older", () => loadThread(threadId, thread.before!))}>{tr("الرسائل الأقدم", "Older messages")}</button>}
            {thread.conversation.handoff && (thread.windowOpen ? <form className="flex flex-wrap gap-2" onSubmit={event => {
              event.preventDefault();
              const text = manualText.trim();
              if (!text) return;
              if (message.current?.text !== text || message.current.thread !== threadId) message.current = { thread: threadId, text, id: crypto.randomUUID() };
              const messageId = message.current.id;
              void run("reply", async () => {
                await api("/conversations/" + threadId, "POST", { action: "reply", text, messageId });
                setManualText("");
                message.current = null;
                await loadThread(threadId);
              });
            }}>
              <input className={field} aria-label={tr("رد الموظف", "Staff reply")} maxLength={1500} value={manualText} onChange={e => setManualText(e.target.value)} />
              <button type="submit" className={secondary} disabled={disabled || !manualText.trim()}>{tr("إرسال", "Send")}</button>
            </form> : <p className="text-sm text-amber-900">{errors.service_window_closed}</p>)}
          </div>}
        </section>
        <div className="min-w-0 space-y-5">
          <section className={panel}>
            <h2 className={heading}>{tr("طلبات واتساب الأخيرة", "Recent WhatsApp orders")}</h2>
            {dashboard.orders.length ? <ul className="divide-y divide-border-delicate">{dashboard.orders.map(order => order.orders && <li key={order.order_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <strong>#{order.orders.order_number}</strong><span>{labels[order.orders.status]}</span>
              <span>{Number(order.orders.total_amount).toLocaleString()} {tr("د.ع", "IQD")}</span>
            </li>)}</ul> : <p className="text-sm text-text-muted">{tr("لا توجد طلبات من واتساب بعد.", "No WhatsApp orders yet.")}</p>}
          </section>
          <section className={panel}>
            <h2 className={heading}>{tr("مشكلات المعالجة والإرسال", "Processing and delivery issues")}</h2>
            {dashboard.failures.length ? <ul className="divide-y divide-border-delicate">{dashboard.failures.map(job => <li key={job.id} className="space-y-1 py-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{labels[job.state]} {job.order_number ? "#" + job.order_number : ""}</strong>
                <span className="text-xs text-text-muted">{date(job.created_at)}</span>
              </div>
              <p className="text-text-muted">{describe(job.error_code)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondary} disabled={disabled} onClick={() => {
                  setThreadId(job.conversation_id); setManualText(""); void run("thread", () => loadThread(job.conversation_id));
                }}>{tr("فتح المحادثة", "Open conversation")}</button>
                {job.retryable && <button type="button" className={secondary} disabled={disabled} onClick={() => void run("retry", async () => {
                  await api("/retry/" + job.id, "POST");
                  await refresh();
                })}>{tr("إعادة المحاولة", "Retry")}</button>}
              </div>
            </li>)}</ul> : <p className="text-sm text-text-muted">{tr("لا توجد مشكلات حديثة.", "No recent issues.")}</p>}
          </section>
        </div>
      </div>
    </>}
  </div>;
}
