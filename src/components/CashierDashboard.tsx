import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, CookingPot, CreditCard, Plus, Printer, RefreshCw, Table2 } from "lucide-react";
import FloorPlan, { type TableActivity } from "./FloorPlan";
import CashierOrderForm from "./CashierOrderForm";
import { loadFloor, type TablePlacement } from "../lib/floor-plan";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/i18n";
import type { OrderItem } from "../types";
import { printCashierReceipt, type ReceiptOrder } from "../lib/cashier-receipt";

type CashierOrder = {
  id: string;
  orderNumber: number;
  tableNumber: string;
  customerName: string;
  amount: number;
  status: TableActivity["status"];
  source: "cashier" | "menu" | "staff" | "whatsapp";
  items: OrderItem[];
  notes: string | null;
  createdAt: string;
};
type Snapshot = { orders: CashierOrder[]; stats: { total: number; served: number; servedValue: number } };
const priority = { pending: 3, ready: 2, preparing: 1 };

export default function CashierDashboard({ restaurantId }: { restaurantId: string }) {
  const { tr, language } = useLanguage();
  const [floor, setFloor] = useState<TablePlacement[] | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [table, setTable] = useState<number | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [newOrder, setNewOrder] = useState<number | "choose" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [floorError, setFloorError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [createdOrder, setCreatedOrder] = useState<{ id: string; orderNumber: number } | null>(null);
  const [receipt, setReceipt] = useState<ReceiptOrder | null>(null);
  const [receiptError, setReceiptError] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptRetry, setReceiptRetry] = useState(0);
  const [restaurantName, setRestaurantName] = useState("");
  const refreshOrders = useRef<() => void>(() => undefined);

  const refreshFloor = useCallback(async () => {
    try { setFloor(await loadFloor(restaurantId)); setFloorError(false); }
    catch { setFloorError(true); }
  }, [restaurantId]);

  useEffect(() => {
    void refreshFloor();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refreshFloor(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshFloor]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let queued = false;
    let realtime = false;
    const refresh = async () => {
      if (!active) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      try {
        const { data: value, error } = await supabase.rpc("cashier_snapshot", { p_restaurant: restaurantId });
        if (error || !Array.isArray(value?.orders) || !value?.stats) throw error ?? new Error("snapshot_unavailable");
        if (active) { setData(value); setLoadError(false); }
      } catch {
        if (active) setLoadError(true);
      } finally {
        inFlight = false;
        if (queued && active) { queued = false; void refresh(); }
      }
    };
    const sync = () => { void refresh(); };
    refreshOrders.current = sync;
    sync();
    const channel = supabase.channel(`cashier-orders:${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, sync)
      .subscribe(status => { realtime = status === "SUBSCRIBED"; if (realtime) sync(); });
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks++;
      if (!inFlight && document.visibilityState === "visible" && navigator.onLine && (!realtime || ticks % 5 === 0)) sync();
    }, 3_000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  useEffect(() => {
    let current = true;
    void supabase.from("restaurants").select("restaurant_name").eq("id", restaurantId).maybeSingle()
      .then(({ data: row }) => { if (current && row) setRestaurantName(row.restaurant_name); });
    return () => { current = false; };
  }, [restaurantId]);

  useEffect(() => {
    if (!createdOrder) return;
    let current = true;
    setReceiptLoading(true);
    setReceiptError(false);
    void (async () => {
      try {
        const { data: row, error } = await supabase.from("orders")
          .select("order_number,created_at,table_number,total_amount,items")
          .eq("restaurant_id", restaurantId).eq("id", createdOrder.id).single();
        if (error || !row || !Array.isArray(row.items)) throw error ?? new Error("receipt_unavailable");
        if (current) setReceipt(row);
      } catch { if (current) setReceiptError(true); }
      finally { if (current) setReceiptLoading(false); }
    })();
    return () => { current = false; };
  }, [createdOrder, receiptRetry, restaurantId]);

  const printReceipt = () => {
    if (!receipt) { setReceiptRetry(value => value + 1); return; }
    try { setReceiptError(false); printCashierReceipt(receipt, restaurantName, language); }
    catch { setReceiptError(true); }
  };

  const advance = async (order: CashierOrder) => {
    if (busy || order.status === "preparing") return;
    setBusy(order.id);
    setActionError("");
    try {
      const { data: updated, error } = await supabase.from("orders")
        .update({ status: order.status === "pending" ? "preparing" : "served" })
        .eq("id", order.id).eq("restaurant_id", restaurantId).eq("status", order.status)
        .eq("cleared_for_staff", false).select("id").maybeSingle();
      if (error) throw error;
      if (!updated) setActionError(tr("حالة الطلب تغيّرت. حدّثنا قائمة الطلبات.", "The order status changed. The queue has been refreshed."));
    } catch {
      setActionError(tr("تعذّر تحديث حالة الطلب. جرّب مرة ثانية.", "Could not update the order. Try again."));
    } finally {
      refreshOrders.current();
      setBusy(null);
    }
  };

  const activity = new Map<number, TableActivity>();
  const orders = data?.orders ?? [];
  const floorTables = new Set(floor?.map(placement => placement.table));
  for (const order of orders) {
    const number = Number(order.tableNumber);
    if (!floorTables.has(number)) continue;
    const current = activity.get(number);
    activity.set(number, { count: (current?.count ?? 0) + 1,
      status: current && priority[current.status] > priority[order.status] ? current.status : order.status });
  }
  const pending = orders.filter(order => order.status === "pending").length;
  const visibleOrders = orders.filter(order => (table === null || Number(order.tableNumber) === table) && (!pendingOnly || order.status === "pending"));
  const format = new Intl.NumberFormat(language === "ar" ? "ar-IQ" : "en");
  const money = (amount: number) => tr(`${format.format(amount)} د.ع`, `${format.format(amount)} IQD`);
  const badge = {
    pending: tr("بانتظار الموافقة", "Awaiting approval"),
    preparing: tr("قيد التحضير", "Preparing"),
    ready: tr("جاهز للتقديم", "Ready to serve"),
  };
  const source = { menu: tr("المنيو", "Digital menu"), whatsapp: tr("واتساب", "WhatsApp"), cashier: tr("الكاشير", "Cashier"), staff: tr("الصالة", "Waiter") };
  const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
  const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-delicate bg-bg-card px-3 py-2 text-sm font-semibold text-brand-primary";
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-2xl font-bold text-brand-primary">{tr("طلبات الصالة والكاونتر", "Dining room and counter")}</h2>
      <div className="flex gap-2">
        <button className={secondary} onClick={() => { refreshOrders.current(); void refreshFloor(); }} type="button"><RefreshCw className="size-4" />{tr("تحديث", "Refresh")}</button>
        <button className={primary} onClick={() => setNewOrder("choose")} type="button"><Plus className="size-4" />{tr("طلب جديد", "New order")}</button>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {[
        { title: tr("طلبات اليوم", "Today's orders"), value: data ? format.format(data.stats.total) : "—", Icon: ClipboardList },
        { title: tr("بانتظار الموافقة", "Awaiting approval"), value: data ? format.format(pending) : "—", Icon: CookingPot },
        { title: tr("طاولات بطلبات نشطة", "Tables with active orders"), value: data && floor ? format.format(activity.size) : "—", Icon: Table2 },
        { title: tr("تم تقديمها اليوم", "Served today"), value: data ? format.format(data.stats.served) : "—", Icon: CookingPot },
        { title: tr("قيمة الطلبات المقدّمة اليوم", "Served order value today"), value: data ? money(data.stats.servedValue) : "—", Icon: CreditCard },
      ].map(({ title, value, Icon }) => <article key={title} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border-delicate bg-bg-card p-4">
        <Icon className="size-5 text-brand-gold" aria-hidden="true" /><p className="text-xs font-semibold text-text-muted">{title}</p>
        <strong className="break-words text-lg text-brand-primary sm:text-2xl">{value}</strong>
      </article>)}
    </div>
    {loadError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{tr("تعذّر تحديث الطلبات. راجع الاتصال أو اضغط تحديث.", "Orders could not be refreshed. Check the connection or select Refresh.")}</p>}
    {createdOrder && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="font-semibold">{tr(`الطلب #${createdOrder.orderNumber} انرسل للمطبخ.`, `Order #${createdOrder.orderNumber} was sent to the kitchen.`)}</p>
        <button type="button" className={secondary} disabled={receiptLoading || (!receipt && !receiptError)} onClick={printReceipt}>
          <Printer className="size-4" />{receiptError && !receipt ? tr("إعادة تحميل الوصل", "Reload receipt") : tr("طباعة الوصل", "Print receipt")}
        </button>
      </div>
      {receiptError && <p role="alert" className="mt-2 text-red-800">{tr("تعذّر تجهيز الوصل للطباعة. جرّب مرة ثانية.", "Could not prepare the receipt for printing. Try again.")}</p>}
    </div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-brand-primary">{tr("خريطة الطاولات", "Table layout")}</h3>
          <div className="flex flex-wrap gap-2 text-xs text-text-muted">
            {([["bg-amber-300", tr("جديد", "New")], ["bg-blue-300", tr("بالتحضير", "Preparing")], ["bg-emerald-300", tr("جاهز", "Ready")]]).map(([color, label]) =>
              <span key={label} className="flex items-center gap-1"><i className={`size-2 rounded-full ${color}`} />{label}</span>)}
          </div>
        </div>
        {floorError && <p role="alert" className="text-sm text-amber-900">{tr("تعذّر تحديث خريطة الطاولات.", "Could not refresh the floor plan.")}</p>}
        {floor && floor.length > 0
          ? <FloorPlan placements={floor} selected={table} activity={activity} onTable={placement => { setPendingOnly(false); setTable(placement.table); }} />
          : <div className="rounded-2xl border border-border-delicate p-5 text-sm text-text-muted">{floor ? tr("خلي المالك يحدد عدد الطاولات من قسم الباركود.", "Set the table count from the owner's QR settings.") : tr("جارٍ تحميل الطاولات…", "Loading tables…")}</div>}
      </div>
      <div className="min-w-0 space-y-3 rounded-2xl border border-border-delicate bg-bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-brand-primary">{table === null ? tr("الطلبات النشطة", "Active orders") : tr(`طاولة ${table}`, `Table ${table}`)}</h3>
          {table !== null && <button className={primary} onClick={() => setNewOrder(table)} type="button"><Plus className="size-4" />{tr("طلب للطاولة", "New table order")}</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondary} aria-pressed={table === null && !pendingOnly} onClick={() => { setTable(null); setPendingOnly(false); }}>{tr("الكل", "All")}</button>
          <button type="button" className={secondary} aria-pressed={pendingOnly} onClick={() => { setTable(null); setPendingOnly(true); }}>{tr("بانتظار الموافقة", "Awaiting approval")} · {pending}</button>
        </div>
        {actionError && <p role="alert" className="text-sm text-amber-900">{actionError}</p>}
        {!data && !loadError && <p role="status" className="text-sm text-text-muted">{tr("جارٍ تحميل الطلبات…", "Loading orders…")}</p>}
        {data && !visibleOrders.length && <p className="py-3 text-sm text-text-muted">{tr("ماكو طلبات بهالقائمة حالياً.", "There are no orders in this view.")}</p>}
        <ul className="space-y-3">
          {visibleOrders.map(order => <li key={order.id} className="space-y-2 rounded-xl border border-border-delicate p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm font-bold text-brand-primary">
              <span>#{order.orderNumber} · {order.tableNumber === "counter" ? tr("كاونتر", "Counter") : order.source === "whatsapp" ? source.whatsapp : tr(`طاولة ${order.tableNumber}`, `Table ${order.tableNumber}`)}</span>
              <span>{money(order.amount)}</span>
            </div>
            <p className="text-xs text-text-muted">{order.customerName === "Guest" ? tr("زبون", "Guest") : order.customerName} · {source[order.source]} · {badge[order.status]}</p>
            <ul className="space-y-1 text-sm text-brand-primary">
              {order.items.map((item, index) => <li key={`${item.id}-${index}`}>{item.quantity} × {item.name}{item.cheeseSelected ? tr(" + جبن", " + cheese") : ""}{item.spicySelected ? tr(" + حار", " + spicy") : ""}</li>)}
            </ul>
            {order.notes && <p className="break-words rounded-lg bg-bg-paper p-2 text-xs">{order.notes}</p>}
            {order.status !== "preparing" && <button className={`${primary} w-full`} disabled={busy !== null || loadError} type="button" onClick={() => void advance(order)}>
              {order.status === "pending" ? tr("وافق وأرسل للمطبخ", "Approve and send to kitchen") : tr("تم التقديم", "Mark served")}
            </button>}
          </li>)}
        </ul>
      </div>
    </div>
    {newOrder !== null && <CashierOrderForm restaurantId={restaurantId}
      initialTable={newOrder === "choose" ? null : newOrder} tables={floor}
      onClose={() => setNewOrder(null)} onCreated={order => { setReceipt(null); setReceiptError(false); setCreatedOrder(order); setNewOrder(null); refreshOrders.current(); }} />}
  </section>;
}
