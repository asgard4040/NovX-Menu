import { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';

type PricingResponse = {
  normal: number | null;
  pro: number | null;
  paymentConfigured: boolean;
  paymentEnvironment: string | null;
};

export default function AdminSubscriptionSettings({ onSaved }: { onSaved?: () => void }) {
  const { tr } = useLanguage();
  const [normal, setNormal] = useState('');
  const [pro, setPro] = useState('');
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [paymentEnvironment, setPaymentEnvironment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('authentication_required');
      const response = await fetch('/api/admin/subscription-prices', {
        headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store',
      });
      if (!response.ok) throw new Error('pricing_unavailable');
      const pricing: PricingResponse = await response.json();
      if (cancelled) return;
      setNormal(pricing.normal == null ? '' : String(pricing.normal));
      setPro(pricing.pro == null ? '' : String(pricing.pro));
      setPaymentConfigured(pricing.paymentConfigured);
      setPaymentEnvironment(pricing.paymentEnvironment);
    })().catch(() => { if (!cancelled) setError(tr('تعذر تحميل الأسعار.', 'Could not load prices.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tr]);

  const save = async () => {
    const normalAmount = Number(normal);
    const proAmount = Number(pro);
    if (![normalAmount, proAmount].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000)) {
      setError(tr('أدخل سعراً صحيحاً وموجباً لكل باقة بالدينار العراقي.', 'Enter a positive whole IQD price for each plan.'));
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('authentication_required');
      const response = await fetch('/api/admin/subscription-prices', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ normal: normalAmount, pro: proAmount }),
      });
      if (!response.ok) throw new Error('pricing_save_failed');
      setMessage(tr('تم حفظ الأسعار. ستُستخدم في عمليات التجديد القادمة.', 'Prices saved for future renewals.'));
      onSaved?.();
    } catch {
      setError(tr('تعذر حفظ الأسعار. لم تتغير أسعار التجديد.', 'Could not save prices. Renewal prices were not changed.'));
    } finally { setSaving(false); }
  };

  const preview = (value: string, months: number) => {
    const amount = Number(value);
    return Number.isSafeInteger(amount) && amount > 0 ? `${(amount * months).toLocaleString()} ${tr('د.ع', 'IQD')}` : '—';
  };

  return <section className="overflow-hidden rounded-3xl border border-border-delicate bg-white shadow-[0_12px_40px_rgba(0,0,0,.04)]">
    <div className="flex flex-col gap-4 border-b border-border-delicate p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div>
        <p className="mb-2 text-xs font-bold text-brand-gold">{tr('الفوترة والاشتراكات', 'Billing and subscriptions')}</p>
        <h3 className="text-xl font-bold text-brand-primary">{tr('أسعار الباقات', 'Plan prices')}</h3>
        <p className="mt-1 text-sm text-text-muted">{tr('حدد السعر الشهري الأساسي. يُحسب سعر ٦ أشهر أو سنة تلقائياً عند التجديد.', 'Set the monthly base price. Six-month and yearly renewals are calculated automatically.')}</p>
      </div>
      <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${paymentConfigured ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
        <ShieldCheck className="h-4 w-4" />{paymentConfigured ? tr('بوابة الدفع مهيأة', 'Payment gateway configured') : tr('بوابة الدفع غير مهيأة', 'Payment gateway not configured')}
        {paymentEnvironment && <span className="font-mono uppercase">· {paymentEnvironment}</span>}
      </div>
    </div>
    <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
      {([
        { key: 'normal', label: tr('الباقة الأساسية', 'Standard plan'), value: normal, setValue: setNormal },
        { key: 'pro', label: tr('الباقة الاحترافية', 'Pro plan'), value: pro, setValue: setPro },
      ] as const).map(plan => <div key={plan.key} className="rounded-2xl border border-border-delicate bg-bg-paper p-5">
        <label htmlFor={`price-${plan.key}`} className="mb-3 flex items-center gap-2 text-sm font-bold text-brand-primary"><CreditCard className="h-4 w-4 text-brand-gold" />{plan.label}</label>
        <div className="flex items-center gap-3 rounded-xl border border-border-delicate bg-white px-4">
          <input id={`price-${plan.key}`} type="number" min="1" max="1000000000" step="1" inputMode="numeric" value={plan.value}
            onChange={event => plan.setValue(event.target.value)} disabled={loading || saving}
            className="min-w-0 flex-1 bg-transparent py-3 text-lg font-bold text-brand-primary outline-none" />
          <span className="text-xs font-bold text-text-muted">{tr('د.ع / شهر', 'IQD / month')}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div><p className="text-text-muted">{tr('٦ أشهر', '6 months')}</p><p className="mt-1 font-bold text-brand-primary">{preview(plan.value, 6)}</p></div>
          <div><p className="text-text-muted">{tr('سنة', '1 year')}</p><p className="mt-1 font-bold text-brand-primary">{preview(plan.value, 12)}</p></div>
        </div>
      </div>)}
    </div>
    <div className="flex flex-col gap-4 border-t border-border-delicate px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <p className="text-xs leading-6 text-text-muted">{tr('تطبق الأسعار الجديدة على روابط الدفع التي تُنشأ بعد الحفظ. الاشتراكات المدفوعة سابقاً لا تتغير.', 'New prices apply to checkout links created after saving. Earlier paid subscriptions stay unchanged.')}</p>
      <button type="button" onClick={() => void save()} disabled={loading || saving}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
        {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
        {tr('حفظ الأسعار', 'Save prices')}
      </button>
    </div>
    {(message || error) && <p role={error ? 'alert' : 'status'} className={`mx-6 mb-6 flex items-center gap-2 rounded-xl p-3 text-sm font-bold sm:mx-8 ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
      {!error && <CheckCircle2 className="h-4 w-4" />}{error || message}
    </p>}
  </section>;
}
