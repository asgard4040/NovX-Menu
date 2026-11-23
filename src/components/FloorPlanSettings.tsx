import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import FloorPlan from "./FloorPlan";
import { buildFloor, loadFloor, moveTable, type TablePlacement, type TableShape } from "../lib/floor-plan";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/i18n";

export default function FloorPlanSettings({ restaurantId, onQrSettings }: {
  restaurantId: string;
  onQrSettings: () => void;
}) {
  const { tr } = useLanguage();
  const [floor, setFloor] = useState<TablePlacement[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [rows, setRows] = useState(1);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    void loadFloor(restaurantId).then(data => { if (active) setFloor(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [restaurantId, reload]);

  const update = (next: TablePlacement[]) => { setFloor(next); setSaved(false); setError(false); };
  const place = (slot: number) => {
    if (!floor || !moving || selected === null) return;
    update(moveTable(floor, selected, slot));
    setMoving(false);
  };
  const save = async () => {
    if (!floor || busy) return;
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      const { error: saveError } = await supabase.from("restaurant_table_layouts").upsert({ restaurant_id: restaurantId, placements: floor });
      if (saveError) throw saveError;
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const current = floor?.find(placement => placement.table === selected);
  const controls = "min-h-10 rounded-xl border border-border-delicate bg-bg-card px-3 py-2 text-sm font-semibold text-brand-primary disabled:opacity-50";
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-brand-primary">{tr("ترتيب صالة المطعم", "Dining room layout")}</h2>
        <p className="mt-1 text-sm text-text-muted">{tr("اختار الطاولة وعدّل شكلها أو مكانها على خريطة الكاشير.", "Select a table to change its shape or location on the cashier map.")}</p></div>
      <button type="button" onClick={onQrSettings} className={controls}>{tr("تعديل عدد الطاولات", "Edit table count")}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{tr("تعذّر تحميل الخريطة أو حفظها.", "Could not load or save the layout.")} {!floor && <button className="underline" onClick={() => { setError(false); setReload(reload + 1); }}>{tr("إعادة المحاولة", "Retry")}</button>}</p>}
    {!floor && !error && <p role="status">{tr("جارٍ تحميل الطاولات…", "Loading tables…")}</p>}
    {floor?.length === 0 && <p className="rounded-2xl border border-border-delicate p-4 text-sm">{tr("حدّد عدد الطاولات من إعدادات الباركود حتى تبدأ ترتّب الصالة.", "Set the table count in QR settings to start arranging your floor.")}</p>}
    {!!floor?.length && <>
      <div className="flex flex-wrap items-center gap-2">
        {current && <>
          <label className="flex items-center gap-2 text-sm font-bold text-brand-primary">
            {tr(`شكل طاولة ${current.table}`, `Shape of table ${current.table}`)}
            <select className={controls} value={current.shape} disabled={busy} onChange={event => {
              const shape = event.target.value as TableShape;
              update(floor.map(placement => placement.table === current.table ? { ...placement, shape } : placement));
            }}>
              <option value="round">{tr("دائرية", "Round")}</option><option value="square">{tr("مربعة", "Square")}</option><option value="rect">{tr("مستطيلة", "Rectangular")}</option>
            </select>
          </label>
          <button type="button" aria-pressed={moving} disabled={busy} onClick={() => setMoving(!moving)} className={controls}>
            {moving ? tr("إلغاء النقل", "Cancel move") : tr("نقل الطاولة", "Move table")}
          </button>
        </>}
        <button type="button" onClick={() => setRows(rows + 1)} disabled={rows >= 24} className={controls}>{tr("مساحة إضافية", "Add space")}</button>
        <button type="button" onClick={() => {
          if (!window.confirm(tr("ترجع لترتيب الطاولات الافتراضي؟", "Reset to the default table layout?"))) return;
          update(buildFloor(floor.length, []));
          setMoving(false);
        }} disabled={busy} className={controls}>{tr("الترتيب الافتراضي", "Reset layout")}</button>
      </div>
      {moving && <p role="status" className="text-sm text-text-muted">{tr("اختار مكان فارغ أو طاولة ثانية حتى تبدّل مكانهن.", "Select an empty spot or another table to swap their positions.")}</p>}
      <FloorPlan placements={floor} selected={selected} extraRows={rows} onTable={placement => {
        if (busy) return;
        if (moving) place(placement.slot);
        else setSelected(placement.table);
      }} onEmpty={moving && !busy ? place : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save()}
          className="flex min-h-11 items-center gap-2 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Save className="size-4" aria-hidden="true" />{busy ? tr("جارٍ الحفظ…", "Saving…") : tr("احفظ الخريطة", "Save layout")}
        </button>
        {saved && <p role="status" className="text-sm text-emerald-800">{tr("انحفظ ترتيب الطاولات.", "Table layout saved.")}</p>}
      </div>
    </>}
  </section>;
}
