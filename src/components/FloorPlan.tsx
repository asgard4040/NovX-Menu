import { Armchair, Plus } from "lucide-react";
import { useLanguage } from "../lib/i18n";
import { floorColumns, floorSlotLimit, type TablePlacement } from "../lib/floor-plan";

export type TableActivity = { count: number; status: "pending" | "preparing" | "ready" };

const statusClass = {
  off: "border-border-delicate bg-bg-card text-text-muted",
  pending: "border-amber-300 bg-amber-100 text-amber-950",
  preparing: "border-blue-300 bg-blue-100 text-blue-950",
  ready: "border-emerald-300 bg-emerald-100 text-emerald-950",
};

export default function FloorPlan({ placements, selected, activity, onTable, onEmpty, extraRows = 0 }: {
  placements: TablePlacement[];
  selected: number | null;
  activity?: Map<number, TableActivity>;
  onTable: (placement: TablePlacement) => void;
  onEmpty?: (slot: number) => void;
  extraRows?: number;
}) {
  const { tr } = useLanguage();
  const slots = new Map(placements.map(placement => [placement.slot, placement]));
  const last = Math.max(0, ...Array.from(slots.keys()));
  const shown = Math.min(floorSlotLimit, (Math.max(3, Math.ceil((last + 1) / floorColumns)) + extraRows) * floorColumns);
  return <div className="overflow-auto rounded-3xl border border-border-delicate bg-bg-paper p-3 sm:p-5">
    <div dir="ltr" aria-label={tr("خريطة الصالة", "Dining room floor plan")}
      className="grid min-w-[36rem] grid-cols-8 gap-2" style={{
        backgroundImage: "radial-gradient(var(--color-border-delicate) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }}>
      {Array.from({ length: shown }, (_, slot) => {
        const placement = slots.get(slot);
        if (!placement) return onEmpty && selected !== null
          ? <button key={slot} type="button" onClick={() => onEmpty(slot)}
              aria-label={tr(`انقل الطاولة هنا، موقع ${slot + 1}`, `Move table here, position ${slot + 1}`)}
              className="grid min-h-24 place-items-center rounded-xl border border-dashed border-border-delicate bg-bg-card/60 text-text-muted hover:border-brand-gold">
              <Plus className="size-4" aria-hidden="true" />
            </button>
          : <div key={slot} className="min-h-24" aria-hidden="true" />;

        const order = activity?.get(placement.table);
        const status = order?.status ?? "off";
        const activityText = status === "pending" ? tr("طلب جديد", "New order")
          : status === "preparing" ? tr("قيد التحضير", "Preparing")
            : status === "ready" ? tr("جاهز", "Ready") : tr("بدون طلب نشط", "No active orders");
        const shape = placement.shape === "round" ? "size-12 rounded-full"
          : placement.shape === "square" ? "size-12 rounded-lg" : "h-10 w-16 rounded-lg";
        return <button key={slot} type="button" onClick={() => onTable(placement)}
          aria-pressed={selected === placement.table}
          aria-label={tr(`طاولة ${placement.table}`, `Table ${placement.table}`) + (activity ? `، ${activityText}` : "")}
          className={`relative flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl p-2 hover:bg-bg-card ${selected === placement.table ? "bg-bg-card ring-2 ring-brand-gold" : ""}`}>
          <Armchair aria-hidden="true" className="size-3 rotate-180 text-text-muted/70" />
          <span className={`grid place-items-center border-2 text-sm font-extrabold tabular-nums shadow-sm ${shape} ${statusClass[status]}`}>
            {placement.table}
          </span>
          <Armchair aria-hidden="true" className="size-3 text-text-muted/70" />
          {!!order?.count && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-brand-primary text-[10px] font-bold text-white">
            {order.count}
          </span>}
        </button>;
      })}
    </div>
  </div>;
}
