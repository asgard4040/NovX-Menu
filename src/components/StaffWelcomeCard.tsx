type StaffWelcomeCardProps = {
  logoUrl: string;
  logoAlt: string;
  eyebrow: string;
  title: string;
  description: string;
  metrics: { label: string; value: number }[];
};

export function StaffWelcomeCard({ logoUrl, logoAlt, eyebrow, title, description, metrics }: StaffWelcomeCardProps) {
  return (
    <section
      className="relative overflow-hidden rounded-[28px] px-6 py-7 text-white shadow-[0_20px_45px_rgba(8,18,32,0.14)] sm:px-9 sm:py-9"
      style={{ backgroundImage: 'linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-secondary))' }}
    >
      <div className="pointer-events-none absolute -top-24 -end-20 h-64 w-64 rounded-full border-[32px] border-white/[0.04]" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <img src={logoUrl} alt={logoAlt} className="h-14 w-14 shrink-0 object-contain sm:h-20 sm:w-20" referrerPolicy="no-referrer" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">{eyebrow}</p>
            <h1 className="font-display text-xl font-bold leading-tight sm:text-3xl">{title}</h1>
            <p className="text-xs text-white/75 sm:text-sm">{description}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-white/20 pt-4 sm:min-w-48 sm:border-t-0 sm:pt-0">
          {metrics.map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white/10 px-3 py-2.5 text-center">
              <p className="text-[10px] font-medium text-white/75">{label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
