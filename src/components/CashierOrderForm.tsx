import { useEffect, useRef, useState, type FormEvent } from "react";
import { Armchair, Minus, Plus, Search, Store, X } from "lucide-react";
import type { TablePlacement } from "../lib/floor-plan";
import { localizeCategory, useLanguage } from "../lib/i18n";
import { supabase } from "../lib/supabase";

type Product = { id: string; name: string; price: number; category: string | null;
  has_cheese: boolean; is_spicy: boolean; cheese_price: number; spicy_price: number };
type Line = { quantity: number; cheeseSelected: boolean; spicySelected: boolean };
const control = "min-h-10 rounded-lg border border-border-delicate bg-bg-card px-3 text-sm text-brand-primary";
const emptyLine = { quantity: 0, cheeseSelected: false, spicySelected: false };
const mainCategory = "الوجبات الأساسية";
const shapeClass = { round: "size-8 rounded-full", square: "size-8 rounded-md", rect: "h-7 w-10 rounded-md" };

export default function CashierOrderForm({ restaurantId, initialTable, tables, onClose, onCreated }: {
  restaurantId: string;
  initialTable: number | null;
  tables: TablePlacement[] | null;
  onClose: () => void;
  onCreated: (orderNumber: number) => void;
}) {
  const { tr, language } = useLanguage();
  const modal = useRef<HTMLDialogElement>(null);
  const attempt = useRef<string | null>(null);
  const submitting = useRef(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [table, setTable] = useState<number | "counter" | null>(initialTable);
  const [draft, setDraft] = useState<Record<string, Line>>({});
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    void supabase.from("restaurants").select("categories").eq("id", restaurantId).maybeSingle()
      .then(({ data }) => {
        if (active && Array.isArray(data?.categories)) {
          setCategories(data.categories.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
        }
      });
    void supabase.from("menu_items").select("id,name,price,category,has_cheese,is_spicy,cheese_price,spicy_price")
      .eq("restaurant_id", restaurantId).eq("is_available", true).order("category").order("name")
      .then(({ data, error: dbError }) => {
        if (!active) return;
        if (dbError) setError("menu");
        else setProducts(data);
      });
    return () => { active = false; };
  }, [restaurantId, reload]);

  const tableAvailable = typeof table === "number" && tables?.some(item => item.table === table);
  const canSend = table === "counter" || tableAvailable || (retrying && table !== null);
  const editingLocked = busy || retrying;
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
    if (submitting.current || !canSend || selected.length === 0 || selected.length > 100) return;
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
      const rejection = reason as { message?: string; code?: string };
      const code = rejection?.message;
      const resolved = /^(P0001|42501|22\w{3})$/.test(rejection?.code ?? "");
      if (resolved) attempt.current = null;
      setRetrying(!resolved);
      setError(code === "invalid_menu_item" ? "unavailable" : code === "invalid_table" ? "table" : "order");
      if (code === "invalid_menu_item") setReload(value => value + 1);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  const groups = new Map<string, Product[]>(categories.map(name => [name.trim(), []]));
  for (const product of products ?? []) {
    const name = product.category?.trim() || mainCategory;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(product);
  }
  const query = filter.trim().toLowerCase();
  const visibleGroups = Array.from(groups, ([name, items]) => ({
    name,
    items: items.filter(product => `${product.name} ${name} ${localizeCategory(name, language)}`.toLowerCase().includes(query)),
  })).filter(group => (category === null || group.name === category) && group.items.length > 0);
  const selectTable = (next: number | "counter") => {
    setTable(next);
    if (error === "table") setError("");
  };
  return <dialog ref={modal} aria-labelledby="cashier-order-title" onCancel={event => {
    event.preventDefault();
    if (!busy) onClose();
  }} className="m-auto max-h-[90dvh] w-[min(94vw,44rem)] overflow-y-auto rounded-3xl border border-border-delicate bg-bg-card p-5 text-text-main shadow-2xl backdrop:bg-black/55 sm:p-6">
    <form onSubmit={event => void submit(event)} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="cashier-order-title" className="text-xl font-bold text-brand-primary">
          {tr("طلب جديد", "New order")}
        </h2>
        <button type="button" disabled={busy} aria-label={tr("إغلاق", "Close")} className={control} onClick={onClose}><X className="size-4" /></button>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-brand-primary">{tr("اختار مكان الطلب", "Choose where the order goes")}</legend>
        <div className="grid max-h-36 grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2 overflow-y-auto p-1">
          {(tables ?? []).map(placement => <button key={placement.table} type="button"
            aria-label={tr(`طاولة ${placement.table}`, `Table ${placement.table}`)}
            aria-pressed={table === placement.table} disabled={editingLocked} onClick={() => selectTable(placement.table)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-brand-primary disabled:opacity-70 ${table === placement.table ? "border-brand-primary bg-brand-primary/10 ring-1 ring-brand-primary" : "border-border-delicate bg-bg-paper hover:border-brand-gold"}`}>
            <Armchair className="size-3 rotate-180 text-text-muted" aria-hidden="true" />
            <span className={`grid place-items-center border border-current text-sm font-extrabold tabular-nums ${shapeClass[placement.shape]}`}>{placement.table}</span>
            <Armchair className="size-3 text-text-muted" aria-hidden="true" />
          </button>)}
          <button type="button" aria-pressed={table === "counter"} disabled={editingLocked} onClick={() => selectTable("counter")}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-xs font-bold text-brand-primary disabled:opacity-70 ${table === "counter" ? "border-brand-primary bg-brand-primary/10 ring-1 ring-brand-primary" : "border-border-delicate bg-bg-paper hover:border-brand-gold"}`}>
            <Store className="size-5" aria-hidden="true" />{tr("كاونتر", "Counter")}
          </button>
        </div>
        {tables === null && <p className="text-xs text-text-muted">{tr("جارٍ تحميل الطاولات…", "Loading tables…")}</p>}
        {tables?.length === 0 && <p className="text-xs text-text-muted">{tr("المالك يحدد عدد الطاولات من قسم الباركود.", "Set the table count in the owner's QR settings.")}</p>}
      </fieldset>
      <h3 className="text-sm font-bold text-brand-primary">{tr("أصناف المنيو", "Menu items")}</h3>
      <label className="flex items-center gap-2 rounded-xl border border-border-delicate px-3">
        <Search className="size-4 text-text-muted" aria-hidden="true" /><input className="min-h-11 w-full bg-transparent text-sm outline-none"
          aria-label={tr("ابحث بالمنيو", "Search the menu")} placeholder={tr("ابحث بالمنيو", "Search the menu")} value={filter} onChange={event => setFilter(event.target.value)} />
      </label>
      {!!groups.size && <div role="group" aria-label={tr("أقسام المنيو", "Menu categories")} className="flex gap-2 overflow-x-auto p-1">
        {[null, ...groups.keys()].map(name => <button key={name === null ? "all" : `category-${name}`} type="button" aria-pressed={category === name}
          onClick={() => setCategory(name)} className={`min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-bold ${category === name ? "border-brand-primary bg-brand-primary text-white" : "border-border-delicate bg-bg-paper text-brand-primary"}`}>
          {name === null ? tr("الكل", "All") : localizeCategory(name, language)}
        </button>)}
      </div>}
      {!products && !error && <p role="status" className="text-sm">{tr("جارٍ تحميل المنيو…", "Loading menu…")}</p>}
      {!!products && !visibleGroups.length && <p className="text-sm text-text-muted">{tr("ماكو أصناف مطابقة.", "No matching items.")}</p>}
      <div className="max-h-[35dvh] space-y-3 overflow-y-auto">
        {visibleGroups.map(group => <section key={group.name} className="space-y-2">
          <h4 className="rounded-lg bg-bg-paper px-3 py-1.5 text-xs font-bold text-brand-primary">{localizeCategory(group.name, language)}</h4>
          {group.items.map(product => {
          const line = draft[product.id] ?? emptyLine;
          return <div key={product.id} className="rounded-xl border border-border-delicate p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 break-words"><p className="text-sm font-bold">{product.name}</p><p className="text-xs text-text-muted">{money(product.price)}</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className={control} disabled={editingLocked || !line.quantity}
                  onClick={() => setLine(product.id, { quantity: line.quantity - 1 })} aria-label={tr(`قلّل كمية ${product.name}`, `Decrease ${product.name}`)}><Minus className="size-4" /></button>
                <span className="w-5 text-center text-sm tabular-nums">{line.quantity}</span>
                <button type="button" className={control} disabled={editingLocked || line.quantity >= 99}
                  onClick={() => setLine(product.id, { quantity: line.quantity + 1 })} aria-label={tr(`أضف ${product.name}`, `Add ${product.name}`)}><Plus className="size-4" /></button>
              </div>
            </div>
            {line.quantity > 0 && (product.has_cheese || product.is_spicy) && <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {product.has_cheese && <label className="flex items-center gap-1"><input type="checkbox" disabled={editingLocked} checked={line.cheeseSelected}
                onChange={event => setLine(product.id, { cheeseSelected: event.target.checked })} />{tr("جبن", "Cheese")} + {money(product.cheese_price)}</label>}
              {product.is_spicy && <label className="flex items-center gap-1"><input type="checkbox" disabled={editingLocked} checked={line.spicySelected}
                onChange={event => setLine(product.id, { spicySelected: event.target.checked })} />{tr("حار", "Spicy")} + {money(product.spicy_price)}</label>}
            </div>}
          </div>;
          })}
        </section>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label={tr("اسم الزبون", "Customer name")} placeholder={tr("اسم الزبون (اختياري)", "Customer name (optional)")} maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={editingLocked} className={control} />
        <input aria-label={tr("ملاحظات للمطبخ", "Kitchen notes")} placeholder={tr("ملاحظات للمطبخ", "Kitchen notes")} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} disabled={editingLocked} className={control} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{{
        menu: tr("تعذّر تحميل المنيو.", "Could not load the menu."),
        unavailable: tr("أحد الأصناف أو الإضافات صار غير متاح. راجع الطلب.", "An item or option is unavailable. Review the order."),
        table: tr("هالطاولة مو ضمن خريطة المطعم الحالية.", "This table is outside the current floor plan."),
        order: retrying ? tr("تعذّر التحقق من الإرسال. أعد إرسال نفس الطلب.", "Could not confirm delivery. Retry the same order.") : tr("تعذّر إرسال الطلب. جرّب مرة ثانية.", "Could not send the order. Try again."),
      }[error]} {error === "menu" && <button type="button" className="underline" onClick={() => { setError(""); setReload(value => value + 1); }}>{tr("إعادة المحاولة", "Retry")}</button>}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-delicate pt-4">
        <div className="space-y-1 text-sm">
          <span className="font-bold">{tr("المجموع", "Total")} · {money(total)}</span>
          <p className="text-xs text-text-muted">{table === "counter" ? tr("كاونتر", "Counter") :
            table !== null && canSend ? tr(`طاولة ${table}`, `Table ${table}`) : tr("اختار الطاولة أو الكاونتر.", "Select a table or the counter.")}</p>
        </div>
        <button type="submit" disabled={busy || !canSend || !selected.length || selected.length > 100}
          className="min-h-11 rounded-xl bg-brand-primary px-4 text-sm font-bold text-white disabled:opacity-50">
          {busy ? tr("جارٍ الإرسال…", "Sending…") : tr("أرسل للمطبخ", "Send to kitchen")}
        </button>
      </div>
    </form>
  </dialog>;
}
