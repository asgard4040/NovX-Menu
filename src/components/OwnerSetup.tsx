import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, LogOut, Palette, Table2, Utensils } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/i18n";
import { MENU_THEMES, resolveTheme, type MenuTheme } from "../lib/themes";

export default function OwnerSetup({ restaurantId, children, onComplete, onLogout }: {
  restaurantId: string; children: ReactNode; onComplete: (theme: MenuTheme) => void; onLogout: () => void;
}) {
  const { dir, isEnglish, tr } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(false);
  const [reload, setReload] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [name, setName] = useState("");
  const [count, setCount] = useState("");
  const [theme, setTheme] = useState(MENU_THEMES[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from("restaurants")
          .select("restaurant_name,owner_setup_completed_at,theme_id").eq("id", restaurantId).single();
        if (error) throw error;
        if (!current) return;
        setName(data.restaurant_name);
        setTheme(resolveTheme(data.theme_id));
        setCompleted(Boolean(data.owner_setup_completed_at));
      } catch {
        if (current) setFailure(true);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [restaurantId, reload]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !/^\d{1,3}$/.test(count) || Number(count) > 500) return;
    setSaving(true);
    setSaveError(false);
    try {
      const { data, error } = await supabase.rpc("complete_owner_setup", {
        p_restaurant: restaurantId, p_table_count: Number(count), p_theme: theme.id,
      });
      if (error || !data?.themeId) throw error ?? new Error("setup_unavailable");
      onComplete(resolveTheme(data.themeId, data.themeColors));
      setCompleted(true);
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  };

  if (completed) return <>{children}</>;
  const Next = isEnglish ? ArrowRight : ArrowLeft;
  const colors = theme.colors;
  return <main dir={dir} className="min-h-dvh bg-[#f7f6f2] px-4 py-6 text-[#142019] sm:py-12">
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex items-center justify-between">
        <strong className="text-lg font-bold tracking-wide">ORDOVA</strong>
        <button type="button" onClick={onLogout} className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold"><LogOut className="size-4" />{tr("تسجيل الخروج", "Sign out")}</button>
      </header>
      {loading ? <p role="status">{tr("جارٍ تحميل إعدادات المطعم…", "Loading restaurant setup…")}</p> : failure ? <div role="alert">
        <p>{tr("تعذّر تحميل الإعدادات.", "Could not load setup.")}</p>
        <button type="button" className="mt-2 underline" onClick={() => { setFailure(false); setLoading(true); setReload(value => value + 1); }}>{tr("حاول مرة ثانية", "Try again")}</button>
      </div> : <form onSubmit={submit} className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-sm">
        <div className="bg-[#142019] p-6 text-white sm:p-9">
          <p className="mb-2 text-sm font-semibold text-emerald-200">{name}</p>
          <h1 className="text-3xl font-bold">{tr("جهّز مطعمك", "Set up your restaurant")}</h1>
          <p className="mt-2 text-sm text-white/75">{tr("حدّد عدد الطاولات واختار شكل المنيو حتى تفتح لوحتك.", "Set your table count and choose a menu theme to open your dashboard.")}</p>
        </div>
        <div className="grid gap-6 p-5 sm:p-8 md:grid-cols-[1fr_16rem]">
          <div className="space-y-6">
            <label className="block">
              <span className="flex items-center gap-2 font-bold"><Table2 className="size-5" />{tr("عدد الطاولات", "Number of tables")}</span>
              <input className="mt-2 w-full rounded-xl border border-black/15 px-4 py-3 sm:max-w-48" dir="ltr" type="number" inputMode="numeric"
                min={0} max={500} step={1} required value={count} onChange={event => setCount(event.target.value)} />
              <span className="mt-2 block text-sm text-black/60">{tr("اكتب 0 إذا مطعمك ما بيه طاولات.", "Enter 0 if your restaurant has no tables.")}</span>
            </label>
            <fieldset className="min-w-0">
              <legend className="mb-3 flex items-center gap-2 font-bold"><Palette className="size-5" />{tr("ثيم المنيو", "Menu theme")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {MENU_THEMES.map(option => <label key={option.id} className="relative min-w-0 cursor-pointer">
                  <input className="peer sr-only" type="radio" name="theme" value={option.id} checked={theme.id === option.id} onChange={() => setTheme(option)} />
                  <span className="flex h-full items-center gap-2 rounded-xl border border-black/10 p-2 text-xs font-semibold peer-checked:border-[#142019] peer-checked:bg-[#f4f7f3] peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-700 sm:p-3">
                    <i aria-hidden="true" className="size-4 shrink-0 rounded-full" style={{ background: option.colors.primary }} />
                    <span className="min-w-0 flex-1 break-words">{isEnglish ? option.nameEn : option.name}</span>
                    {theme.id === option.id && <Check aria-hidden="true" className="size-4 shrink-0" />}
                  </span>
                </label>)}
              </div>
            </fieldset>
          </div>
          <div className="self-start">
            <p className="mb-2 text-xs font-semibold">{tr("معاينة شكل المنيو", "Menu preview")}</p>
            <div className="overflow-hidden rounded-2xl border border-black/10" style={{ background: colors.background, color: colors.text }}>
              <div className="flex items-center gap-2 p-4 font-bold text-white" style={{ background: colors.primary }}><Utensils className="size-4 shrink-0" />{name}</div>
              <div className="space-y-3 p-4">
                <strong>{tr("قائمة الطعام", "Menu")}</strong>
                {[0, 1].map(row => <div key={row} className="flex items-center gap-3 rounded-xl border p-2" style={{ borderColor: colors.accent }}>
                  <div className="size-9 shrink-0 rounded-md" style={{ background: colors.secondary, opacity: 0.25 }} />
                  <div className="flex-1 space-y-2"><div className="h-1.5 w-3/4 rounded-full" style={{ background: colors.secondary }} /><div className="h-1.5 w-1/2 rounded-full" style={{ background: colors.accent }} /></div>
                </div>)}
              </div>
            </div>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-black/10 p-5 sm:px-8">
          {saveError && <p role="alert" className="text-sm text-red-700">{tr("تعذّر حفظ الإعدادات. حاول مرة ثانية.", "Could not save setup. Try again.")}</p>}
          <button type="submit" disabled={saving} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#142019] px-5 py-2.5 font-bold text-white disabled:opacity-50">
            {saving ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ وفتح اللوحة", "Save and open dashboard")}<Next className="size-4" />
          </button>
        </footer>
      </form>}
    </div>
  </main>;
}
