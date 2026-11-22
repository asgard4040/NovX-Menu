import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Gift, Repeat2 } from "lucide-react";
import { useLanguage } from "../lib/i18n";
import type { OrderItem } from "../types";

export type SavedOrderItem = Pick<OrderItem, "id" | "name" | "quantity" | "cheeseSelected" | "spicySelected">;

type LoyaltyOrder = {
  id: string;
  orderNumber: number;
  createdAt: string;
  status: string;
  paid: boolean;
  reversed: boolean;
  points: number;
  items: SavedOrderItem[];
};
type Wallet = {
  enabled: boolean;
  joined?: boolean;
  balance?: number;
  iqdPerPoint?: number;
  rewardName?: string;
  rewardPoints?: number;
  orders?: LoyaltyOrder[];
};

export function useCustomerLoyalty(restaurantId?: string) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [optOut, setOptOut] = useState(false);
  const endpoint = restaurantId ? `/api/loyalty/${encodeURIComponent(restaurantId)}` : null;
  const latestEndpoint = useRef(endpoint);
  latestEndpoint.current = endpoint;
  const refresh = useCallback(async () => {
    if (!endpoint) return;
    const response = await fetch(endpoint);
    if (!response.ok) return;
    const data: Wallet = await response.json();
    if (latestEndpoint.current === endpoint) setWallet(data);
  }, [endpoint]);
  useEffect(() => {
    setWallet(null);
    setOptOut(false);
    void refresh().catch(() => undefined);
  }, [refresh]);

  const act = async (action: "join" | "claim") => {
    if (!endpoint) throw new Error("loyalty_unavailable");
    const response = await fetch(endpoint + "/" + action, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "loyalty_unavailable");
    const data = await response.json();
    if (action === "join" && latestEndpoint.current === endpoint) {
      setWallet(data);
      setOptOut(false);
    }
    return data;
  };
  return { wallet, refresh, act, collect: !!wallet?.enabled && !!wallet.joined && !optOut, setOptOut };
}

export type CustomerLoyaltyState = ReturnType<typeof useCustomerLoyalty>;

function RewardProgress({ balance, target, reward }: { balance: number; target: number; reward: string }) {
  const { tr, language } = useLanguage();
  const earned = Math.min(balance, target);
  const remaining = target - earned;
  const stampCount = Math.min(target, 5);
  const locale = language === "ar" ? "ar-IQ" : "en";
  const number = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 0 });
  const progressText = tr(
    `${number.format(earned)} من ${number.format(target)} نقطة للمكافأة`,
    `${number.format(earned)} of ${number.format(target)} points toward the reward`,
  );

  return <div className="relative isolate overflow-hidden rounded-2xl bg-[#101b2a] px-4 py-5 text-white sm:px-6 sm:py-6"
    style={{ backgroundImage: "linear-gradient(135deg, color-mix(in srgb, var(--color-brand-primary) 55%, #081220), color-mix(in srgb, var(--color-brand-gold) 35%, #081220))" }}>
    <div aria-hidden="true" className="pointer-events-none absolute -end-12 -top-20 -z-10 size-52 rounded-full border-[22px] border-white/5" />
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="text-xs font-semibold text-white/85">{tr("تقدّمك للمكافأة", "Reward progress")}</p>
      <span className="inline-flex gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-bold tabular-nums" dir="ltr" aria-hidden="true">
        <span>{number.format(earned)}</span><span>/</span><span>{number.format(target)}</span>
      </span>
    </div>
    <div role="progressbar" aria-label={tr("نقاط المكافأة", "Reward points")}
      aria-valuemin={0} aria-valuemax={target} aria-valuenow={earned} aria-valuetext={progressText}
      className="mt-4 flex flex-wrap gap-1.5 min-[360px]:gap-2 sm:gap-3">
      {Array.from({ length: stampCount }, (_, index) => {
        const milestone = Math.ceil(target * (index + 1) / stampCount);
        const reached = earned >= milestone;
        const isReward = index === stampCount - 1;

        return <span key={milestone} aria-hidden="true"
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums min-[360px]:size-11 sm:size-13 sm:text-xs ${
            reached ? "bg-white text-[#101b2a]" : "border border-dashed border-white/65 bg-white/5 text-white"
          }`}>
          {isReward ? <Gift className={`size-[18px] sm:size-5 ${reached ? "" : "text-amber-200"}`} />
            : reached ? <Check className="size-4 sm:size-5" strokeWidth={2.8} />
              : compact.format(milestone)}
        </span>;
      })}
    </div>
    <div className="mt-4 border-t border-white/20 pt-3">
      <p className="break-words text-base font-bold leading-snug sm:text-lg">{reward}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/85">
        {remaining > 0 ? tr(`باقيلك ${number.format(remaining)} نقطة`, `${number.format(remaining)} more points to go`)
          : tr("مكافأتك جاهزة للاستبدال", "Your reward is ready to redeem")}
      </p>
    </div>
  </div>;
}

export default function CustomerLoyalty({ loyalty, onReorder }: {
  loyalty: CustomerLoyaltyState;
  onReorder: (items: SavedOrderItem[]) => Promise<void>;
}) {
  const { tr, language } = useLanguage();
  const { wallet } = loyalty;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [claim, setClaim] = useState<{ code: string; rewardName: string } | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!claim) return;
    const timer = window.setTimeout(() => setExpired(true), 5 * 60_000);
    return () => window.clearTimeout(timer);
  }, [claim]);
  if (!wallet?.enabled) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (err) {
      setError(err instanceof Error && err.message === "loyalty_insufficient_points"
        ? tr("رصيدك الحالي ما يكفي للمكافأة.", "Your current balance is too low for this reward.")
        : tr("تعذّر إكمال العملية. جرّب مرة ثانية.", "Could not complete the action. Try again."));
    } finally { setBusy(false); }
  };
  const history = wallet.orders ?? [];
  return <section className="mx-auto mt-4 max-w-7xl px-3 sm:px-6">
    <div className="overflow-hidden rounded-2xl border border-border-delicate bg-bg-card">
      <details onToggle={event => { if (event.currentTarget.open) void loyalty.refresh().catch(() => undefined); }}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-brand-primary">
          <span className="flex min-w-0 items-center gap-2 font-bold"><Gift className="h-5 w-5 shrink-0 text-brand-gold" />{tr("بطاقة الولاء", "Loyalty card")}</span>
          <span className="shrink-0 rounded-full bg-bg-paper px-3 py-1 text-xs font-bold">
            {wallet.joined ? tr(`${wallet.balance ?? 0} نقطة`, `${wallet.balance ?? 0} points`) : tr("انضم مجاناً", "Join free")}
          </span>
        </summary>
        <div className="space-y-4 border-t border-border-delicate p-4 sm:p-5">
          {wallet.rewardName && typeof wallet.rewardPoints === "number" && wallet.rewardPoints > 0 &&
            <RewardProgress balance={wallet.balance ?? 0} target={wallet.rewardPoints} reward={wallet.rewardName} />}
          <p className="text-sm text-text-muted">{tr(
            `كل ${wallet.iqdPerPoint?.toLocaleString()} د.ع من الطلبات المسددة تجمعلك نقطة.`,
            `Earn one point per ${wallet.iqdPerPoint?.toLocaleString()} IQD on paid orders.`,
          )}</p>
          {!wallet.joined ? <>
            <p className="text-xs leading-relaxed text-text-muted">{tr(
              "البطاقة تنحفظ بهذا المتصفح لمدة ستة أشهر تقريباً. إذا حذفت بيانات الموقع أو بدّلت الجهاز، تحتاج بطاقة جديدة.",
              "This card stays in this browser for about six months. Clearing site data or switching devices requires a new card.",
            )}</p>
            <button type="button" disabled={busy} onClick={() => void run(async () => { await loyalty.act("join"); })}
              className="min-h-11 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr("لحظة…", "Working…") : tr("فعّل بطاقتي", "Create my card")}
            </button>
          </> : <>
            <label className="flex min-h-10 items-center gap-2 text-sm text-brand-primary">
              <input type="checkbox" checked={loyalty.collect} onChange={event => loyalty.setOptOut(!event.target.checked)} />
              {tr("اجمع نقاط على طلبي القادم", "Earn points on my next order")}
            </label>
            {(wallet.balance ?? 0) >= (wallet.rewardPoints ?? Infinity) && <button type="button" disabled={busy}
              onClick={() => void run(async () => { setClaim(await loyalty.act("claim")); setExpired(false); })}
              className="min-h-11 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {claim ? tr("طلّع رمز جديد", "Get a new code") : tr("استخدم نقاطك", "Redeem points")}
            </button>}
            {claim && <div className="rounded-xl bg-bg-paper p-3 text-sm text-brand-primary" role="status">
              {expired ? tr("انتهت صلاحية الرمز. طلّع رمز جديد إذا تريد.", "This code expired. Generate a new one to redeem.")
                : <><p>{tr("ورّي الرمز للموظف خلال ٥ دقايق.", "Show this code to staff within five minutes.")}</p>
                  <strong dir="ltr" className="mt-1 block font-mono tracking-wider">{claim.code.match(/.{4}/g)?.join(" ")}</strong>
                  <p className="mt-1 text-xs text-text-muted">{claim.rewardName}</p></>}
            </div>}
            {history.length > 0 && <div className="space-y-2">
              <h3 className="text-sm font-bold text-brand-primary">{tr("طلباتك الأخيرة", "Recent orders")}</h3>
              {history.map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-delicate p-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-bold text-brand-primary">#{order.orderNumber} · {new Date(order.createdAt).toLocaleDateString(language === "ar" ? "ar-IQ" : "en-GB", { timeZone: "Asia/Baghdad" })}</p>
                  <p className="break-words text-xs text-text-muted">{order.items?.map(item => `${item.quantity} × ${item.name}`).join("، ")}</p>
                  <p className="mt-1 text-xs text-text-muted">{order.paid
                    ? tr(`+${order.points} نقطة`, `+${order.points} points`)
                    : order.reversed || ["cancelled", "rejected"].includes(order.status)
                      ? tr("الطلب ما احتسب نقاط", "No points earned")
                      : tr("النقاط تنضاف بعد تأكيد التسديد", "Points are added after payment confirmation")}</p>
                </div>
                {order.paid && <button type="button" disabled={busy}
                  onClick={() => void run(() => onReorder(order.items))}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-delicate px-3 text-xs font-bold text-brand-primary disabled:opacity-50">
                  <Repeat2 className="h-4 w-4" />{tr("اطلبه مرة ثانية", "Order again")}
                </button>}
              </article>)}
            </div>}
          </>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
      </details>
    </div>
  </section>;
}
