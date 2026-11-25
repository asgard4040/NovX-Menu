import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, X } from "lucide-react";
import { useLanguage } from "../lib/i18n";

type Item = { id: string; label: string; icon: ReactNode };
const historyKey = "ordovaWorkspaceMore";

export default function MobileWorkspaceNav({ items, role, active, onSelect }: {
  items: Item[]; role: "admin" | "restaurant"; active: string; onSelect: (id: string) => void;
}) {
  const { tr } = useLanguage();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const primary = role === "admin" ? ["overview", "restaurants", "finance", "settings"] : ["overview", "orders", "menu", "waiters"];
  const byId = new Map(items.map(item => [item.id, item]));
  const pinned = primary.flatMap(id => byId.get(id) ?? []);
  const remaining = items.filter(item => !primary.includes(item.id));

  const close = () => {
    setOpen(false);
    if (window.history.state?.[historyKey]) window.history.back();
  };
  useEffect(() => {
    const sync = () => setOpen(Boolean(window.history.state?.[historyKey]) && !window.matchMedia("(min-width: 1024px)").matches);
    const desktop = window.matchMedia("(min-width: 1024px)");
    const resize = () => { if (desktop.matches && window.history.state?.[historyKey]) window.history.back(); };
    window.addEventListener("popstate", sync);
    desktop.addEventListener("change", resize);
    return () => {
      window.removeEventListener("popstate", sync);
      desktop.removeEventListener("change", resize);
      if (window.history.state?.[historyKey]) {
        const state = { ...window.history.state };
        delete state[historyKey];
        window.history.replaceState(state, "");
      }
    };
  }, []);

  useEffect(() => {
    if (!open || !dialog.current || !moreButton.current) return;
    const modal = dialog.current;
    const opener = moreButton.current;
    modal.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      modal.close();
      document.body.style.overflow = previousOverflow;
      if (opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  const navButton = "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-center text-[10px] font-bold leading-tight";
  const currentStyle = "bg-brand-primary text-white";
  return <>
    <nav className="mobile-bottom-nav fixed inset-x-2 bottom-[calc(.5rem+env(safe-area-inset-bottom))] z-50 grid grid-cols-5 gap-1 rounded-2xl border border-border-delicate workspace-shell-panel p-1.5 shadow-lg lg:hidden" aria-label={tr("التنقل الرئيسي", "Main navigation")}>
      {pinned.map(item => <button key={item.id} type="button" aria-current={active === item.id ? "page" : undefined}
        className={navButton + " " + (active === item.id ? currentStyle : "text-text-muted")} onClick={() => onSelect(item.id)}>
        {item.icon}<span className="max-w-full break-words">{item.label}</span>
      </button>)}
      <button ref={moreButton} type="button" className={navButton + " " + (open || remaining.some(item => item.id === active) ? currentStyle : "text-text-muted")}
        aria-haspopup="dialog" aria-expanded={open} aria-controls="workspace-more"
        onClick={() => {
          if (!window.history.state?.[historyKey]) window.history.pushState({ ...window.history.state, [historyKey]: true }, "");
          setOpen(true);
        }}>
        <Ellipsis className="size-5" aria-hidden="true" />{tr("المزيد", "More")}
      </button>
    </nav>
    <dialog ref={dialog} id="workspace-more" aria-labelledby="workspace-more-title"
      onCancel={event => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-text-main">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 flex items-center justify-between">
          <h2 id="workspace-more-title" className="text-2xl font-bold text-brand-primary">{tr("المزيد", "More")}</h2>
          <button type="button" autoFocus onClick={close} aria-label={tr("إغلاق", "Close")} className="rounded-xl border border-border-delicate bg-bg-card p-3"><X className="size-5" /></button>
        </header>
        <div className="grid grid-cols-2 gap-3">
          {remaining.map(item => <button key={item.id} type="button"
            aria-current={active === item.id ? "page" : undefined}
            onClick={() => { onSelect(item.id); close(); }}
            className={"flex min-h-20 items-center gap-3 rounded-2xl border border-border-delicate p-3 text-start text-sm font-bold " + (active === item.id ? currentStyle : "bg-bg-card text-brand-primary")}>
            <span className="shrink-0">{item.icon}</span><span className="min-w-0 break-words">{item.label}</span>
          </button>)}
        </div>
      </div>
    </dialog>
  </>;
}
