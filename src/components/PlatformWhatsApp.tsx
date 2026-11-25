import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Copy, MessageCircle, RefreshCw, Send } from "lucide-react";
import { useLanguage } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { invitationTemplate } from "../lib/platform-whatsapp-templates";

type TemplateKind = "invite" | "renewed" | "expired";
type Receiver = { id: string; name: string; lastFour: string | null; allowed: boolean; eligible: boolean };
type History = {
  id: string; restaurant_id: string; restaurant_name?: string; kind: TemplateKind | "manual";
  state: string; reason: string | null; phone_last_four: string | null; created_at: string;
};
type Dashboard = {
  sender: { appId: string; appName: string; source: string; templates: Partial<Record<TemplateKind, string>>; callback: string } | null;
  history: History[];
};
type Preview = { count: number; excluded: number; sample: string; template: string; recipients: string[] };
const root = "/api/whatsapp/platform";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-delicate px-4 py-2 text-sm font-semibold text-brand-primary disabled:opacity-50";
const field = "mt-1 min-h-11 w-full rounded-xl border border-border-delicate bg-bg-paper px-3 py-2 text-sm text-brand-primary";
const group = "space-y-4 rounded-2xl border border-border-delicate p-4 sm:p-5";

async function api<T>(endpoint = "", method = "GET", body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("unauthorized");
  const response = await fetch(root + endpoint, {
    method, headers: { Authorization: "Bearer " + data.session.access_token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000), cache: "no-store",
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) throw new Error(value?.error || "platform_whatsapp_unavailable");
  return value as T;
}

export default function PlatformWhatsApp() {
  const { tr, isEnglish } = useLanguage();
  const [open, setOpen] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [replace, setReplace] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [received, setReceived] = useState<{ receivers: Receiver[]; next: number | null } | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewAttempt = useRef("");
  const currentAction = useRef(false);
  const updateDashboard = useCallback(async () => setDashboard(await api<Dashboard>()), []);
  const loadReceivers = useCallback(async (search: string, offset = 0) => {
    const value = await api<{ receivers: Receiver[]; next: number | null }>("/receivers?" + new URLSearchParams({ search, offset: String(offset) }));
    setReceived(current => offset && current ? { ...value, receivers: [...current.receivers, ...value.receivers] } : value);
  }, []);

  const run = async (name: string, action: () => Promise<void>) => {
    if (currentAction.current) return;
    currentAction.current = true;
    setBusy(name);
    setError("");
    setNotice("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "platform_whatsapp_unavailable"); }
    finally { setBusy(""); currentAction.current = false; }
  };
  useEffect(() => {
    if (!open || dashboard) return;
    void run("load", async () => { await Promise.all([updateDashboard(), loadReceivers("")]); });
  }, [open, dashboard, updateDashboard, loadReceivers]);

  const saveConnection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value).trim()]));
    (form.elements.namedItem("apiKey") as HTMLInputElement).value = "";
    void run("connect", async () => {
      await api("/connection", "PUT", values);
      setReplace(false);
      setTemplates([]);
      setTemplateId("");
      setPreview(null);
      await updateDashboard();
      setNotice(tr("تم التحقق من التطبيق وحفظ الاتصال.", "Gupshup app verified and connection saved."));
    });
  };
  const saveTemplates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value).trim()]));
    void run("templates", async () => {
      await api("/templates", "PUT", form);
      await updateDashboard();
      setNotice(tr("تم حفظ القوالب المعتمدة.", "Approved templates saved."));
    });
  };
  const sender = dashboard?.sender;
  const ids = Object.keys(selected);
  const templateLabels = {
    invite: tr("دعوة دخول للمالك أو الموظف", "Owner or staff invitation"),
    renewed: tr("تجديد الاشتراك", "Subscription renewed"),
    expired: tr("انتهاء الاشتراك", "Subscription expired"),
    manual: tr("رسالة من الإدارة", "Message from ORDOVA"),
  };
  const states: Record<string, string> = {
    queued: tr("بانتظار الإرسال", "Queued"), sending: tr("جارٍ الإرسال", "Sending"),
    submitted: tr("استلمها Gupshup", "Accepted by Gupshup"), sent: tr("أُرسلت", "Sent"),
    delivered: tr("وصلت", "Delivered"), read: tr("مقروءة", "Read"),
    failed: tr("فشل الإرسال", "Failed"), skipped: tr("تم التخطي", "Skipped"), uncertain: tr("النتيجة غير مؤكدة", "Outcome unknown"),
  };
  const errors: Record<string, string> = {
    invalid_phone: tr("رقم واتساب غير صالح.", "Invalid WhatsApp number."),
    invalid_gupshup_credentials: tr("تحقق من معرّف التطبيق واسمه والرقم ومفتاح Gupshup.", "Check the app ID, name, number and Gupshup key."),
    platform_sender_already_in_use: tr("هذا الرقم أو التطبيق مرتبط بمطعم. استخدم رقم المنصة.", "A restaurant uses this number or app. Use the platform sender."),
    template_not_approved_or_format: tr("القالب غير معتمد أو لا يطابق ترتيب الحقول المطلوب.", "The template is unapproved or does not match the required fields."),
    invalid_template: tr("أدخل معرّف قالب Gupshup صالح.", "Enter a valid Gupshup template ID."),
    consent_missing: tr("لا توجد موافقة للاستلام على الأرقام المحددة.", "The selected numbers lack consent."),
    sender_not_connected: tr("رقم المنصة غير متصل.", "The platform sender is disconnected."),
    template_not_configured: tr("قالب الرسالة غير مضاف.", "No template configured."),
    passcode_unavailable: tr("رمز الدخول غير متاح.", "Passcode unavailable."),
    subscription_changed: tr("تغيّر الاشتراك.", "Subscription changed."),
    sender_changed: tr("تغيّر إعداد رقم المنصة.", "The sender configuration changed."),
    provider_failed: tr("تعذّر التسليم عبر Gupshup.", "Gupshup could not deliver the message."),
    gupshup_unauthorized: tr("Gupshup رفض المفتاح. تحقق من الصلاحيات.", "Gupshup rejected the key. Check the app's permissions."),
    platform_whatsapp_unavailable: tr("تعذّر تحميل واتساب الإدارة. حاول مرة ثانية.", "Could not load ORDOVA WhatsApp. Try again."),
  };
  const describe = (code: string) => errors[code] ?? tr("تعذّر إكمال العملية", "Could not complete the operation") + " (" + code + ")";
  const disabled = !!busy;
  const date = new Intl.DateTimeFormat(isEnglish ? "en-GB" : "ar-IQ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" });

  return <details className="rounded-2xl border border-border-delicate bg-bg-card" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 font-bold text-brand-primary">
      <span className="flex items-center gap-2"><MessageCircle className="size-5 text-emerald-700" />{tr("واتساب إدارة ORDOVA", "ORDOVA WhatsApp")}</span>
      <ChevronDown className="size-4" aria-hidden="true" />
    </summary>
    {open && <div className="space-y-5 border-t border-border-delicate p-4 sm:p-5">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{describe(error)}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {!dashboard ? <button type="button" className={secondary} disabled={disabled} onClick={() => void run("load", async () => {
        await Promise.all([updateDashboard(), loadReceivers("")]);
      })}>{disabled ? tr("جارٍ التحميل…", "Loading…") : tr("تحديث", "Refresh")}</button> : <>
        <section className={group}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-brand-primary">{tr("رقم المنصة", "Platform number")}</h3>
            {sender && <bdi className="rounded-lg bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-900">+{sender.source} · {sender.appName}</bdi>}
          </div>
          {(!sender || replace) ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveConnection}>
            <label className="text-sm">Gupshup App ID<input className={field} name="appId" dir="ltr" required defaultValue={sender?.appId} /></label>
            <label className="text-sm">Gupshup App Name<input className={field} name="appName" dir="ltr" required defaultValue={sender?.appName} /></label>
            <label className="text-sm">{tr("رقم واتساب المنصة", "WhatsApp number")}<input className={field} name="source" type="tel" dir="ltr" required defaultValue={sender?.source} /></label>
            <label className="text-sm">Gupshup API Key<input className={field} name="apiKey" type="password" dir="ltr" autoComplete="new-password" required /></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" className={primary} disabled={disabled}>{tr("تحقق واربط", "Verify and connect")}</button>
              {sender && <button type="button" className={secondary} onClick={() => setReplace(false)}>{tr("إلغاء", "Cancel")}</button>}
            </div>
          </form> : <>
            <p className="text-sm text-text-muted">{tr("انسخ الرابط إلى Webhooks في تطبيق Gupshup وفعّل أحداث الرسائل والتسليم.", "Add the callback under Webhooks in Gupshup and enable messages and delivery events.")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled={disabled} onClick={() => void run("copy", async () => {
                await navigator.clipboard.writeText(sender.callback);
                setNotice(tr("تم نسخ رابط تتبع التسليم.", "Delivery callback copied."));
              })}><Copy className="size-4" />{tr("نسخ الرابط الخاص", "Copy private callback")}</button>
              <button type="button" className={secondary} disabled={disabled} onClick={() => void run("test", async () => {
                await api("/connection/test", "POST");
                setNotice(tr("تم التحقق من صلاحية مفتاح التطبيق.", "App key verified."));
              })}>{tr("اختبار الاتصال", "Test connection")}</button>
              <button type="button" className={secondary} disabled={disabled} onClick={() => { setConfirmDisconnect(false); setReplace(true); }}>{tr("تحديث الربط", "Update connection")}</button>
              <button type="button" className={secondary} aria-expanded={confirmDisconnect} disabled={disabled} onClick={() => setConfirmDisconnect(value => !value)}>{tr("فصل الرقم", "Disconnect")}</button>
            </div>
            {confirmDisconnect && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-paper p-3">
              <p className="text-sm">{tr("فصل رقم المنصة يوقف إرسال إشعارات الإدارة.", "Disconnecting pauses ORDOVA notifications.")}</p>
              <button type="button" className={primary} disabled={disabled} onClick={() => void run("disconnect", async () => {
                await api("/connection", "DELETE");
                setConfirmDisconnect(false);
                setPreview(null);
                setTemplates([]);
                await updateDashboard();
              })}>{tr("تأكيد الفصل", "Confirm disconnect")}</button>
            </div>}
          </>}
        </section>

        {sender && <form key={sender.appId + JSON.stringify(sender.templates)} className={group} onSubmit={saveTemplates}>
          <h3 className="font-bold text-brand-primary">{tr("قوالب الرسائل التلقائية", "Automatic message templates")}</h3>
          <p className="text-sm text-text-muted">{tr("أضف معرّفات قوالب نصية وافق عليها Gupshup. حسب الترتيب، للتجديد والانتهاء استخدم اسم المطعم والتاريخ. للدعوة استخدم اسم المطعم ورابط الدخول والرمز.", "Enter approved Gupshup text template IDs. Use restaurant name and date for subscription messages. Use restaurant name, portal link and passcode for invitations, in that order.")}</p>
          <details className="rounded-xl bg-bg-paper p-3 text-sm">
            <summary className="cursor-pointer font-semibold">{tr("نص قالب دعوة الدخول", "Invitation template text")}</summary>
            <p className="mt-2 whitespace-pre-line">{tr(invitationTemplate.ar, invitationTemplate.en)}</p>
          </details>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["invite", "renewed", "expired"] as const).map(kind => <label className="min-w-0 text-sm" key={kind}>
              {templateLabels[kind]}<input name={kind} className={field} dir="ltr" defaultValue={sender.templates[kind]} />
            </label>)}
          </div>
          <button type="submit" disabled={disabled} className={primary}>{tr("حفظ القوالب", "Save templates")}</button>
        </form>}

        <section className={group}>
          <h3 className="font-bold text-brand-primary">{tr("إرسال لأصحاب المطاعم", "Message restaurant owners")}</h3>
          <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
            event.preventDefault(); void run("search", () => loadReceivers(search));
          }}>
            <label className="flex-1 text-sm">{tr("اسم المطعم", "Restaurant name")}<input className={field} value={search} onChange={event => setSearch(event.target.value)} /></label>
            <button type="submit" className={secondary} disabled={disabled}>{tr("بحث", "Search")}</button>
          </form>
          {received?.receivers.length === 0 && <p className="text-sm text-text-muted">{tr("ماكو مطاعم مطابقة.", "No matching restaurants.")}</p>}
          <ul className="max-h-72 divide-y divide-border-delicate overflow-y-auto">
            {received?.receivers.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <label className="flex min-w-0 items-center gap-2">
                <input type="checkbox" className="accent-brand-primary" disabled={disabled || !row.allowed || (ids.length >= 100 && !selected[row.id])} checked={!!selected[row.id]}
                  onChange={event => {
                    const next = { ...selected };
                    if (event.target.checked) next[row.id] = row.name;
                    else delete next[row.id];
                    setSelected(next);
                    setPreview(null);
                  }} />
                <span>{row.name}</span>{row.lastFour && <bdi className="shrink-0 text-xs text-text-muted">•••• {row.lastFour}</bdi>}
              </label>
              {row.eligible && <button type="button" disabled={disabled} className={secondary} onClick={() => {
                const allowed = !row.allowed;
                if (allowed && !window.confirm(tr("تأكد أن المالك وافق على استلام رسائل ORDOVA على هذا الرقم.", "Confirm that the owner agreed to receive ORDOVA WhatsApp messages at this number."))) return;
                void run("consent", async () => {
                  await api("/receivers/" + row.id, "PUT", { allowed });
                  if (!allowed) setSelected(current => { const next = { ...current }; delete next[row.id]; return next; });
                  setPreview(null);
                  await loadReceivers(search);
                });
              }}>{row.allowed ? tr("إلغاء الموافقة", "Revoke consent") : tr("تسجيل الموافقة", "Record consent")}</button>}
            </li>)}
          </ul>
          {received?.next != null && <button type="button" className={secondary} disabled={disabled} onClick={() => void run("more", () => loadReceivers(search, received.next!))}>{tr("عرض المزيد", "Show more")}</button>}
          {sender && <>
            {ids.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
              <span>{tr("المطاعم المحددة", "Selected restaurants")} · {ids.length}</span>
              <button type="button" className="underline" disabled={disabled} onClick={() => { setSelected({}); setPreview(null); }}>{tr("مسح الاختيار", "Clear selection")}</button>
            </div>}
            <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
              event.preventDefault();
              void run("preview", async () => {
                setPreview(await api<Preview>("/manual", "POST", { templateId: templateId.trim(), restaurants: ids }));
                previewAttempt.current = crypto.randomUUID();
              });
            }}>
              <label className="min-w-48 flex-1 text-sm">{tr("معرّف القالب المعتمد", "Approved template ID")}
                <input className={field} dir="ltr" list="platform-template-options" required value={templateId}
                  onChange={event => { setTemplateId(event.target.value); setPreview(null); }} />
                <datalist id="platform-template-options">{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</datalist>
              </label>
              <button type="button" className={secondary} disabled={disabled} onClick={() => void run("approved", async () => {
                const value = await api<{ templates: { id: string; name: string }[] }>("/templates");
                setTemplates(value.templates);
                if (value.templates.length === 0) setNotice(tr("ماكو قوالب نصية معتمدة للإرسال اليدوي.", "No approved text templates available for manual sends."));
              })}>{tr("تحميل القوالب", "Load templates")}</button>
              <button type="submit" className={secondary} disabled={disabled || ids.length === 0}>{tr("معاينة الإرسال", "Preview send")}</button>
            </form>
            {preview && <div className="space-y-3 rounded-xl border border-border-delicate bg-bg-paper p-4">
              <p className="text-sm font-semibold">{preview.template} · {preview.count} {tr("مستلم", "recipients")}</p>
              {preview.excluded > 0 && <p className="text-sm text-text-muted">{tr("تم استبعاد مطاعم بدون موافقة سارية", "Restaurants excluded without current consent")} · {preview.excluded}</p>}
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{preview.sample}</p>
              <button type="button" className={primary} disabled={disabled} onClick={() => void run("send", async () => {
                const result = await api<{ queued: number; count: number }>("/manual", "POST", {
                  templateId: templateId.trim(), restaurants: preview.recipients, requestId: previewAttempt.current,
                });
                setPreview(null);
                setSelected({});
                setNotice(tr("تمت جدولة الإرسال", "Send scheduled") + " · " + result.count);
                await updateDashboard();
              })}><Send className="size-4" />{tr("تأكيد الإرسال", "Confirm send")}</button>
            </div>}
          </>}
        </section>

        <section className={group}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-brand-primary">{tr("حالة الرسائل", "Message history")}</h3>
            <button type="button" className={secondary} disabled={disabled} onClick={() => void run("history", updateDashboard)}>
              <RefreshCw className="size-4" />{tr("تحديث", "Refresh")}
            </button>
          </div>
          {!dashboard.history.length && <p className="text-sm text-text-muted">{tr("لا توجد رسائل بعد.", "No messages yet.")}</p>}
          <ul className="max-h-96 divide-y divide-border-delicate overflow-y-auto">
            {dashboard.history.map(row => <li className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={row.id}>
              <div><strong>{templateLabels[row.kind]}</strong><p className="text-text-muted">{row.restaurant_name}{row.phone_last_four && <> · <bdi>•••• {row.phone_last_four}</bdi></>}</p></div>
              <div className="text-end"><strong>{states[row.state] ?? row.state}</strong><p className="text-text-muted">{date.format(new Date(row.created_at))}</p>
                {row.reason && <p className="text-xs text-text-muted">{errors[row.reason] ?? row.reason}</p>}</div>
            </li>)}
          </ul>
        </section>
      </>}
    </div>}
  </details>;
}
