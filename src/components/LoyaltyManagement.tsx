import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Gift, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/i18n";

type Program = {
  enabled: boolean;
  iqdPerPoint: string;
  rewardName: string;
  rewardPoints: string;
  rewardCostIqd: string;
};
type Settlement = {
  id: string;
  orderNumber: number;
  tableNumber: string;
  totalAmount: number;
  points: number;
  paidAt: string | null;
  reversedAt: string | null;
  createdAt: string;
};
type Snapshot = {
  program: { enabled: boolean; iqd_per_point: number; reward_name: string; reward_points: number; reward_cost_iqd: number } | null;
  stats: { members: number; returningMembers: number; paidOrders: number; rewards: number; rewardCostIqd: number } | null;
  orders: Settlement[];
};
const emptyProgram: Program = { enabled: false, iqdPerPoint: "1000", rewardName: "", rewardPoints: "", rewardCostIqd: "" };
const fieldClass = "mt-1 block min-h-11 w-full rounded-xl border border-border-delicate bg-bg-paper px-3 py-2 text-brand-primary";
const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50";

export default function LoyaltyManagement({ restaurantId, manage = false }: { restaurantId: string; manage?: boolean }) {
  const { tr, language } = useLanguage();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [program, setProgram] = useState(emptyProgram);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const rpc = useCallback(async (action: string, data: Record<string, unknown> = {}) => {
    const result = await supabase.rpc("loyalty_staff", { p_restaurant: restaurantId, p_action: action, p_data: data });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }, [restaurantId]);
  const load = useCallback(async () => {
    const current: Snapshot = await rpc("read");
    if (!current || !Array.isArray(current.orders)) throw new Error("loyalty_unavailable");
    setSnapshot(current);
    if (current.program) {
      const saved = current.program;
      setProgram({ enabled: saved.enabled, iqdPerPoint: String(saved.iqd_per_point),
        rewardName: saved.reward_name, rewardPoints: String(saved.reward_points), rewardCostIqd: String(saved.reward_cost_iqd) });
    }
  }, [rpc]);
  useEffect(() => {
    void load().catch(() => setError("loyalty_unavailable"));
  }, [load]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result) setMessage(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "loyalty_unavailable");
    } finally { setBusy(false); }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await rpc("configure", {
        enabled: program.enabled, iqdPerPoint: Number(program.iqdPerPoint), rewardName: program.rewardName.trim(),
        rewardPoints: Number(program.rewardPoints), rewardCostIqd: Number(program.rewardCostIqd),
      });
      return tr("انحفظ برنامج الولاء.", "Loyalty program saved.");
    });
  };
  const redeem = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await rpc("redeem", { code: code.replace(/\s/g, "").toUpperCase() });
      setCode("");
      return tr(`تم استبدال النقاط. سلّم الزبون: ${result.rewardName}`, `Points redeemed. Give the customer: ${result.rewardName}`);
    });
  };
  const settle = (order: Settlement, reverse: boolean) => {
    const question = reverse
      ? tr("تأكدت من إرجاع المبلغ؟ راح تنسحب نقاط هذا الطلب.", "Confirm the payment was refunded. This removes the order’s points.")
      : tr("استلمت كامل مبلغ هذا الطلب؟", "Confirm you received this order’s full payment.");
    if (!window.confirm(question)) return;
    void run(async () => {
      await rpc(reverse ? "reverse_payment" : "confirm_paid", { orderId: order.id });
      return reverse ? tr("انسحبت نقاط الطلب.", "Order points reversed.") : tr("تأكد التسديد وانحسبت النقاط.", "Payment recorded and points credited.");
    });
  };

  const statusMessage = error === "loyalty_invalid_code" ? tr("الرمز غير صالح أو منتهي. اطلب رمز جديد.", "Invalid or expired code. Ask for a new one.")
    : error === "loyalty_insufficient_points" ? tr("رصيد الزبون ما يكفي.", "The customer’s balance is too low.")
    : error === "loyalty_order_not_served" ? tr("لازم الطلب يصير «تم التقديم» أولاً.", "Mark the order served first.")
    : tr("تعذّر إكمال العملية. حدّث الصفحة أو جرّب مرة ثانية.", "Could not complete the action. Refresh or try again.");
  const stats = snapshot?.stats;

  return <section className="min-w-0 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-brand-primary"><Gift className="h-5 w-5 text-brand-gold" />{tr("ولاء الزبائن", "Customer loyalty")}</h2>
      <button type="button" disabled={busy} onClick={() => void run(async () => undefined)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-delicate px-3 text-xs font-bold text-brand-primary disabled:opacity-50">
        <RefreshCw className="h-4 w-4" />{tr("تحديث", "Refresh")}
      </button>
    </header>
    {!snapshot && !error && <p role="status" className="text-sm text-text-muted">{tr("جارٍ تحميل الولاء…", "Loading loyalty…")}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{statusMessage}</p>}
    {stats && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[
        [tr("البطاقات المسجلة", "Cards created"), stats.members],
        [tr("زبائن كرروا الطلب", "Returning customers"), stats.returningMembers],
        [tr("طلبات ولاء مسددة", "Paid loyalty orders"), stats.paidOrders],
        [tr("مكافآت مستبدلة", "Rewards redeemed"), stats.rewards],
        [tr("كلفة مقدرة للمكافآت", "Estimated reward cost"), `${stats.rewardCostIqd.toLocaleString()} ${tr("د.ع", "IQD")}`],
      ].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border border-border-delicate bg-white p-4">
        <p className="text-xs text-text-muted">{label}</p><strong className="mt-1 block break-words text-lg text-brand-primary">{value}</strong>
      </div>)}
    </div>}
    {manage && snapshot && <form onSubmit={save} className="space-y-4 rounded-2xl border border-border-delicate bg-white p-4 sm:p-5">
      <label className="flex min-h-11 items-center gap-2 font-bold text-brand-primary">
        <input type="checkbox" checked={program.enabled} onChange={event => setProgram({ ...program, enabled: event.target.checked })} />
        {tr("إظهار بطاقة الولاء بالمنيو", "Show loyalty in the menu")}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm text-text-muted">{tr("مبلغ الطلب لكل نقطة (د.ع)", "Order spend per point (IQD)")}
          <input className={fieldClass} type="number" min="1" max="1000000" required value={program.iqdPerPoint}
            onChange={event => setProgram({ ...program, iqdPerPoint: event.target.value })} />
        </label>
        <label className="min-w-0 text-sm text-text-muted">{tr("اسم المكافأة", "Reward name")}
          <input className={fieldClass} required maxLength={80} placeholder={tr("مثال: مشروب مجاني", "e.g. Free drink")} value={program.rewardName}
            onChange={event => setProgram({ ...program, rewardName: event.target.value })} />
        </label>
        <label className="min-w-0 text-sm text-text-muted">{tr("النقاط المطلوبة", "Points required")}
          <input className={fieldClass} type="number" min="1" max="1000000" required value={program.rewardPoints}
            onChange={event => setProgram({ ...program, rewardPoints: event.target.value })} />
        </label>
        <label className="min-w-0 text-sm text-text-muted">{tr("كلفة المكافأة المقدرة (د.ع)", "Estimated reward cost (IQD)")}
          <input className={fieldClass} type="number" min="0" max="1000000" required value={program.rewardCostIqd}
            onChange={event => setProgram({ ...program, rewardCostIqd: event.target.value })} />
        </label>
      </div>
      <button className={actionClass} disabled={busy}>{tr("حفظ البرنامج", "Save program")}</button>
    </form>}
    {snapshot?.program?.enabled && <form onSubmit={redeem} className="flex flex-wrap items-end gap-3 rounded-2xl border border-border-delicate bg-white p-4">
      <label className="min-w-0 flex-1 text-sm font-bold text-brand-primary">{tr("رمز مكافأة الزبون", "Customer reward code")}
        <input className={fieldClass + " font-mono"} dir="ltr" autoComplete="off" maxLength={16} value={code}
          onChange={event => setCode(event.target.value)} placeholder="XXXX XXXX XXXX" required />
      </label>
      <button className={actionClass} disabled={busy || !/^[\da-f]{12}$/i.test(code.replace(/\s/g, ""))}>{tr("تأكيد الاستبدال", "Confirm redemption")}</button>
    </form>}
    {snapshot && (snapshot.program || snapshot.orders.length > 0) && <div className="rounded-2xl border border-border-delicate bg-white p-4">
      <h3 className="font-bold text-brand-primary">{tr("تسديد طلبات الولاء", "Loyalty order payments")}</h3>
      <p className="mt-1 text-xs text-text-muted">{tr("أكد التسديد بعد تقديم الطلب واستلام كامل المبلغ.", "Confirm payment after serving the order and receiving the full amount.")}</p>
      {snapshot.orders.length === 0 && <p className="mt-4 text-sm text-text-muted">{tr("ماكو طلبات ولاء بانتظار تأكيد التسديد.", "No loyalty orders awaiting payment confirmation.")}</p>}
      <ul className="mt-3 divide-y divide-border-delicate">{snapshot.orders.map(order => <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-primary">#{order.orderNumber} · {tr("طاولة", "Table")} {order.tableNumber} · {order.totalAmount.toLocaleString()} {tr("د.ع", "IQD")}</p>
          <p className="mt-1 text-xs text-text-muted">{new Date(order.createdAt).toLocaleString(language === "ar" ? "ar-IQ" : "en-GB", { timeZone: "Asia/Baghdad" })} · {order.points} {tr("نقطة", "points")}</p>
        </div>
        {order.reversedAt ? <span className="text-xs text-text-muted">{tr("تم عكس النقاط", "Points reversed")}</span>
          : !order.paidAt ? <button type="button" className={actionClass} disabled={busy} onClick={() => settle(order, false)}>{tr("تأكيد استلام المبلغ", "Confirm payment received")}</button>
          : manage && <button type="button" className="min-h-11 rounded-xl border border-border-delicate px-3 text-xs text-brand-primary" disabled={busy}
            onClick={() => settle(order, true)}>{tr("عكس النقاط بعد الاسترداد", "Reverse points after refund")}</button>}
      </li>)}</ul>
    </div>}
  </section>;
}
