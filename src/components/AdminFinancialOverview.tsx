import { AlertCircle, ArrowUpRight, Building2, CalendarClock, CreditCard, Receipt, Wallet } from 'lucide-react';
import type { Restaurant } from '../types';
import { getSubscriptionAccess } from '../lib/subscription';
import { emptyPlanPrices, planMonthlyPrice, type PlanPrices } from '../lib/subscription-pricing';
import { useLanguage } from '../lib/i18n';

export type FinancialOverview = {
  paidTotal: number;
  paidThisMonth: number;
  paidCount: number;
  pendingCount: number;
  lastPaidAt: string | null;
  monthlySeries: Array<{ month: string; amount: number }>;
  planPrices: PlanPrices;
};

export default function AdminFinancialOverview({ restaurants, finance, now }: {
  restaurants: Restaurant[];
  finance: FinancialOverview | null;
  now: number;
}) {
  const { tr, language } = useLanguage();
  const active = restaurants.filter(restaurant => getSubscriptionAccess(restaurant, now).allowed);
  const expired = restaurants.filter(restaurant => getSubscriptionAccess(restaurant, now).reason === 'expired');
  const suspended = restaurants.filter(restaurant => restaurant.status === 'suspended');
  const soon = active.filter(restaurant => {
    const end = Date.parse(restaurant.endDate);
    return Number.isFinite(end) && end > now && end - now <= 7 * 86_400_000;
  });
  const prices = finance?.planPrices || emptyPlanPrices;
  const monthlyValue = active.reduce((total, restaurant) =>
    total + (planMonthlyPrice(restaurant.subscriptionType, restaurant.monthlyCost, prices) || 0), 0);
  const renewalOpportunity = expired.reduce((total, restaurant) =>
    total + (planMonthlyPrice(restaurant.subscriptionType, restaurant.monthlyCost, prices) || 0), 0);
  const money = (value: number) => `${value.toLocaleString()} ${tr('د.ع', 'IQD')}`;
  const series = finance?.monthlySeries || [];
  const max = Math.max(1, ...series.map(item => item.amount));

  return <div className="space-y-5">
    <div className="relative overflow-hidden rounded-3xl bg-[#081d2d] p-6 text-white shadow-xl sm:p-8">
      <div className="pointer-events-none absolute -end-20 -top-24 h-72 w-72 rounded-full border border-white/10 bg-white/5" />
      <div className="pointer-events-none absolute -bottom-32 start-1/3 h-64 w-64 rounded-full bg-brand-gold/10 blur-3xl" />
      <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div>
          <p className="mb-3 flex items-center gap-2 text-xs font-bold text-brand-gold"><Wallet className="h-4 w-4" />{tr('التحصيل الإلكتروني · WAYL', 'Online collections · WAYL')}</p>
          <h3 className="text-3xl font-bold tracking-tight sm:text-4xl">{finance ? money(finance.paidThisMonth) : '—'}</h3>
          <p className="mt-2 text-sm text-white/65">{tr('المدفوع فعلياً هذا الشهر بتوقيت بغداد', 'Actually paid this month, Baghdad time')}</p>
          <p className="mt-5 text-xs text-white/55">{finance?.lastPaidAt
            ? `${tr('آخر دفعة', 'Latest payment')}: ${new Date(finance.lastPaidAt).toLocaleString(language === 'ar' ? 'ar-IQ' : 'en-GB', { timeZone: 'Asia/Baghdad' })}`
            : tr('لا توجد دفعات إلكترونية ناجحة بعد.', 'No successful online payments yet.')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4"><p className="text-xs text-white/60">{tr('إجمالي المحصّل', 'Total collected')}</p><p className="mt-2 text-lg font-bold">{finance ? money(finance.paidTotal) : '—'}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4"><p className="text-xs text-white/60">{tr('عمليات ناجحة', 'Paid renewals')}</p><p className="mt-2 text-lg font-bold">{finance?.paidCount ?? '—'}</p></div>
        </div>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: tr('قيمة الخطط النشطة شهرياً', 'Active plan value / month'), value: money(monthlyValue), hint: tr('تقدير من أسعار المطاعم، ليس تحصيلاً', 'Estimate from plan prices, not collected cash'), icon: <CreditCard className="h-5 w-5" /> },
        { label: tr('فرصة تجديد المنتهي', 'Expired renewal opportunity'), value: money(renewalOpportunity), hint: tr('القيمة الشهرية للخطط المنتهية', 'Monthly value of expired plans'), icon: <ArrowUpRight className="h-5 w-5" /> },
        { label: tr('روابط دفع معلّقة', 'Pending checkouts'), value: finance?.pendingCount ?? '—', hint: tr('بانتظار إتمام الدفع', 'Awaiting payment'), icon: <Receipt className="h-5 w-5" /> },
        { label: tr('تنتهي خلال ٧ أيام', 'Expiring in 7 days'), value: soon.length, hint: tr('تحتاج متابعة قريبة', 'Needs attention soon'), icon: <CalendarClock className="h-5 w-5" /> },
      ].map(card => <div key={card.label} className="rounded-2xl border border-border-delicate bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-bg-paper text-brand-primary">{card.icon}</div>
        <p className="text-xs font-bold text-text-muted">{card.label}</p><p className="mt-2 text-xl font-bold text-brand-primary">{card.value}</p>
        <p className="mt-2 text-xs text-text-muted">{card.hint}</p>
      </div>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-2xl border border-border-delicate bg-white p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3"><div><h3 className="text-lg font-bold text-brand-primary">{tr('التحصيل خلال ٦ أشهر', 'Collections over 6 months')}</h3><p className="text-xs text-text-muted">{tr('دفعات WAYL الناجحة فقط', 'Successful WAYL payments only')}</p></div><Wallet className="h-5 w-5 text-brand-gold" /></div>
        <div className="flex h-44 items-end gap-2 border-b border-border-delicate pb-2 sm:gap-4">
          {series.length ? series.map(item => <div key={item.month} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center" title={`${item.month}: ${money(item.amount)}`}>
            <div className="flex min-h-0 flex-1 items-end"><div className="mx-auto w-full max-w-12 rounded-t-lg bg-brand-primary/80 transition-colors group-hover:bg-brand-gold" style={{ height: `${Math.max(item.amount ? 8 : 2, item.amount / max * 100)}%` }} /></div>
            <span className="text-[10px] font-bold text-text-muted" dir="ltr">{item.month.slice(5)}</span>
          </div>) : <p className="m-auto text-sm text-text-muted">{tr('بيانات التحصيل غير متاحة حالياً.', 'Collection data is unavailable.')}</p>}
        </div>
      </div>
      <div className="rounded-2xl border border-border-delicate bg-white p-5 sm:p-6">
        <h3 className="text-lg font-bold text-brand-primary">{tr('صحة الاشتراكات', 'Subscription health')}</h3>
        <p className="mt-1 text-xs text-text-muted">{tr('الحالة الفعلية الآن حسب تاريخ الانتهاء', 'Current status based on expiry dates')}</p>
        <div className="mt-5 space-y-3">
          {[
            { label: tr('نشطة', 'Active'), value: active.length, icon: <Building2 className="h-4 w-4" />, color: 'bg-emerald-50 text-emerald-800' },
            { label: tr('منتهية', 'Expired'), value: expired.length, icon: <AlertCircle className="h-4 w-4" />, color: 'bg-amber-50 text-amber-800' },
            { label: tr('موقوفة', 'Paused'), value: suspended.length, icon: <AlertCircle className="h-4 w-4" />, color: 'bg-red-50 text-red-800' },
          ].map(item => <div key={item.label} className="flex items-center justify-between rounded-xl bg-bg-paper px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold text-brand-primary">{item.icon}{item.label}</span><span className={`rounded-lg px-2 py-1 text-sm font-bold ${item.color}`}>{item.value}</span>
          </div>)}
        </div>
        <p className="mt-5 text-xs text-text-muted">{restaurants.length} {tr('مطعماً في النظام', 'restaurants in the system')}</p>
      </div>
    </div>
  </div>;
}
