import { useEffect, useRef, useState, type FormEvent } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { useLanguage } from "../lib/i18n";
import { supabase } from "../lib/supabase";

type Product = { id: string; name: string; price: number; category: string | null;
  has_cheese: boolean; is_spicy: boolean; cheese_price: number; spicy_price: number };
type Line = { quantity: number; cheeseSelected: boolean; spicySelected: boolean };
const control = "min-h-10 rounded-lg border border-border-delicate bg-bg-card px-3 text-sm text-brand-primary";
const emptyLine = { quantity: 0, cheeseSelected: false, spicySelected: false };

export default function CashierOrderForm({ restaurantId, table, onClose, onCreated }: {
  restaurantId: string;
  table: number | "counter";
  onClose: () => void;
  onCreated: (orderNumber: number) => void;
}) {
  const { tr, language } = useLanguage();
  const modal = useRef<HTMLDialogElement>(null);
  const attempt = useRef<string | null>(null);
  const submitting = useRef(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Line>>({});
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    void supabase.from("menu_items").select("id,name,price,category,has_cheese,is_spicy,cheese_price,spicy_price")
      .eq("restaurant_id", restaurantId).eq("is_available", true).order("category").order("name")
      .then(({ data, error: dbError }) => {
        if (!active) return;
        if (dbError) setError("menu");
        else setProducts(data);
      });
    return () => { active = false; };
  }, [restaurantId, reload]);

  const setLine = (id: string, patch: Partial<Line>) => setDraft(previous => ({
    ...previous, [id]: { ...(previous[id] ?? emptyLine), ...patch },
  }));
  const selected = (products ?? []).filter(product => (draft[product.id]?.quantity ?? 0) > 0);
  const total = selected.reduce((sum, product) => {
    const line = draft[product.id];
    return sum + line.quantity * (Number(product.price)
      + (line.cheeseSelected ? Number(product.cheese_price) : 0)
      + (line.spicySelected ? Number(product.spicy_price) : 0));
  }, 0);
  const money = (amount: number) => `${new Intl.NumberFormat(language === "ar" ? "ar-IQ" : "en").format(amount)} ${tr("د.ع", "IQD")}`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || selected.length === 0) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    attempt.current ??= crypto.randomUUID();
    try {
      const { data, error: dbError } = await supabase.rpc("create_cashier_order", {
        p_restaurant: restaurantId, p_table: String(table), p_name: name.trim(), p_notes: notes.trim(),
        p_items: selected.map(product => ({ id: product.id, ...draft[product.id] })), p_key: attempt.current,
      });
      if (dbError) throw dbError;
      if (!Number.isFinite(data?.orderNumber)) throw new Error("order_unavailable");
      onCreated(data.orderNumber);
    } catch (reason) {
      const code = (reason as { message?: string })?.message;
      setError(code === "invalid_menu_item" ? "unavailable" : code === "invalid_table" ? "table" : "order");
      if (code === "invalid_menu_item") setReload(value => value + 1);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  const visible = (products ?? []).filter(product => `${product.name} ${product.category ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
  return <dialog ref={modal} aria-labelledby="cashier-order-title" onCancel={event => {
    event.preventDefault();
    if (!busy) onClose();
  }} className="m-auto max-h-[90dvh] w-[min(94vw,44rem)] overflow-y-auto rounded-3xl border border-border-delicate bg-bg-card p-5 text-text-main shadow-2xl backdrop:bg-black/55 sm:p-6">
    <form onSubmit={event => void submit(event)} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="cashier-order-title" className="text-xl font-bold text-brand-primary">
          {table === "counter" ? tr("طلب كاونتر", "Counter order") : tr(`طلب لطاولة ${table}`, `Order for table ${table}`)}
        </h2>
        <button type="button" disabled={busy} aria-label={tr("إغلاق", "Close")} className={control} onClick={onClose}><X className="size-4" /></button>
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-border-delicate px-3">
        <Search className="size-4 text-text-muted" aria-hidden="true" /><input className="min-h-11 w-full bg-transparent text-sm outline-none"
          aria-label={tr("ابحث بالمنيو", "Search the menu")} placeholder={tr("ابحث بالمنيو", "Search the menu")} value={filter} onChange={event => setFilter(event.target.value)} />
      </label>
      {!products && !error && <p role="status" className="text-sm">{tr("جارٍ تحميل المنيو…", "Loading menu…")}</p>}
      {!!products && !visible.length && <p className="text-sm text-text-muted">{tr("ماكو أصناف مطابقة.", "No matching items.")}</p>}
      <div className="max-h-[35dvh] space-y-2 overflow-y-auto">
        {visible.map(product => {
          const line = draft[product.id] ?? emptyLine;
          return <div key={product.id} className="rounded-xl border border-border-delicate p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 break-words"><p className="text-sm font-bold">{product.name}</p><p className="text-xs text-text-muted">{money(product.price)}</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className={control} disabled={busy || !line.quantity}
                  onClick={() => setLine(product.id, { quantity: line.quantity - 1 })} aria-label={tr(`قلّل كمية ${product.name}`, `Decrease ${product.name}`)}><Minus className="size-4" /></button>
                <span className="w-5 text-center text-sm tabular-nums">{line.quantity}</span>
                <button type="button" className={control} disabled={busy || line.quantity >= 99}
                  onClick={() => setLine(product.id, { quantity: line.quantity + 1 })} aria-label={tr(`أضف ${product.name}`, `Add ${product.name}`)}><Plus className="size-4" /></button>
              </div>
            </div>
            {line.quantity > 0 && (product.has_cheese || product.is_spicy) && <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {product.has_cheese && <label className="flex items-center gap-1"><input type="checkbox" disabled={busy} checked={line.cheeseSelected}
                onChange={event => setLine(product.id, { cheeseSelected: event.target.checked })} />{tr("جبن", "Cheese")} + {money(product.cheese_price)}</label>}
              {product.is_spicy && <label className="flex items-center gap-1"><input type="checkbox" disabled={busy} checked={line.spicySelected}
                onChange={event => setLine(product.id, { spicySelected: event.target.checked })} />{tr("حار", "Spicy")} + {money(product.spicy_price)}</label>}
            </div>}
          </div>;
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label={tr("اسم الزبون", "Customer name")} placeholder={tr("اسم الزبون (اختياري)", "Customer name (optional)")} maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={busy} className={control} />
        <input aria-label={tr("ملاحظات للمطبخ", "Kitchen notes")} placeholder={tr("ملاحظات للمطبخ", "Kitchen notes")} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} disabled={busy} className={control} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{{
        menu: tr("تعذّر تحميل المنيو.", "Could not load the menu."),
        unavailable: tr("أحد الأصناف أو الإضافات صار غير متاح. راجع الطلب.", "An item or option is unavailable. Review the order."),
        table: tr("هالطاولة مو ضمن خريطة المطعم الحالية.", "This table is outside the current floor plan."),
        order: tr("تعذّر إرسال الطلب. جرّب مرة ثانية.", "Could not send the order. Try again."),
      }[error]} {error === "menu" && <button type="button" className="underline" onClick={() => { setError(""); setReload(value => value + 1); }}>{tr("إعادة المحاولة", "Retry")}</button>}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-delicate pt-4">
        <span className="text-sm font-bold">{tr("المجموع", "Total")} · {money(total)}</span>
        <button type="submit" disabled={busy || !selected.length || selected.length > 100}
          className="min-h-11 rounded-xl bg-brand-primary px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy ? tr("جارٍ الإرسال…", "Sending…") : tr("أرسل للمطبخ", "Send to kitchen")}
        </button>
      </div>
    </form>
  </dialog>;
}
