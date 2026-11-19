import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/i18n';
import type { UserSession } from '../types';

type SubscriptionStatus = {
  sessionKey: string;
  allowed: boolean;
  reason: string;
  restaurantName: string;
  endDate: string;
  amountIqd: number | null;
  canRenew: boolean;
};

export default function SubscriptionGuard({ session, children }: { session: UserSession; children: React.ReactNode }) {
  const { dir, tr } = useLanguage();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [checkedSessionKey, setCheckedSessionKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!session.restaurantId || session.role === 'admin') return;
    const sessionKey = `${session.id}:${session.restaurantId}`;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('authentication_required');
      const headers = { Authorization: `Bearer ${data.session.access_token}` };
      const subscriptionUrl = `/api/restaurants/${encodeURIComponent(session.restaurantId)}/subscription`;
      const response = await fetch(subscriptionUrl, { headers, cache: 'no-store' });
      if (!response.ok) throw new Error('subscription_status_unavailable');
      setStatus({ ...await response.json(), sessionKey });
      setCheckedSessionKey(sessionKey);
      setError('');

      // Show the subscription state before checking an earlier checkout, which can take longer.
      const pendingReference = sessionStorage.getItem(`wayl-renewal:${session.restaurantId}`);
      if (pendingReference) {
        try {
          const payment = await fetch(`/api/payments/wayl/${encodeURIComponent(pendingReference)}/status`, { headers, cache: 'no-store' });
          if (payment.ok && (await payment.json()).paid) {
            sessionStorage.removeItem(`wayl-renewal:${session.restaurantId}`);
            const renewed = await fetch(subscriptionUrl, { headers, cache: 'no-store' });
            if (renewed.ok) setStatus({ ...await renewed.json(), sessionKey });
          }
        } catch { /* The next refresh can check the payment again. */ }
      }
    } catch {
      setStatus(previous => previous?.sessionKey === sessionKey && !previous.allowed ? previous : null);
      setCheckedSessionKey(sessionKey);
      setError(tr('تعذر التحقق من الاشتراك. أعد المحاولة.', 'Could not verify the subscription. Try again.'));
    }
  }, [session.id, session.restaurantId, session.role, tr]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (session.role === 'admin' || !session.restaurantId) return <>{children}</>;
  const sessionKey = `${session.id}:${session.restaurantId}`;
  const currentStatus = status?.sessionKey === sessionKey ? status : null;
  if (currentStatus?.allowed) return <>{children}</>;

  if (!currentStatus && checkedSessionKey !== sessionKey) return <main className="min-h-screen bg-bg-paper flex items-center justify-center p-5 font-sans" dir={dir}>
    <div role="status" className="flex items-center gap-3 text-text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-primary border-t-transparent" aria-hidden="true" />
      {tr('جاري التحقق من الاشتراك...', 'Checking subscription...')}
    </div>
  </main>;

  const canPay = session.role === 'restaurant' && currentStatus?.reason === 'expired' && currentStatus.canRenew;
  const startCheckout = async () => {
    if (!session.restaurantId || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('authentication_required');
      const response = await fetch(`/api/restaurants/${encodeURIComponent(session.restaurantId)}/subscription/checkout`, {
        method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error('checkout_unavailable');
      const checkout = await response.json();
      const url = new URL(checkout.url);
      if (url.protocol !== 'https:' || !['checkout.thewayl.com', 'link.thewayl.com'].includes(url.hostname)) throw new Error('checkout_unavailable');
      sessionStorage.setItem(`wayl-renewal:${session.restaurantId}`, checkout.referenceId);
      window.location.assign(url.toString());
    } catch {
      setError(tr('تعذر فتح صفحة الدفع. حاول مرة أخرى أو اتصل بالدعم.', 'Could not open payment. Try again or contact support.'));
      setBusy(false);
    }
  };

  return <main className="min-h-screen bg-bg-paper flex items-center justify-center p-5 font-sans" dir={dir}>
    <section className="w-full max-w-lg rounded-3xl border border-border-delicate bg-white p-8 text-center shadow-xl sm:p-12">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-700">
        {canPay ? <CreditCard size={30} /> : <ShieldAlert size={30} />}
      </div>
      <h1 className="text-2xl font-bold text-brand-primary">{currentStatus?.restaurantName || tr('اشتراك المطعم', 'Restaurant subscription')}</h1>
      <p className="mt-4 text-text-muted">
        {currentStatus?.reason === 'expired'
          ? tr('انتهت صلاحية الاشتراك. يرجى التجديد لاستعادة الوصول.', 'The subscription has expired. Renew to restore access.')
          : currentStatus?.reason === 'inactive'
            ? tr('تم تعليق خدمة هذا المطعم. تواصل مع الإدارة.', 'This restaurant is suspended. Contact the administrator.')
            : tr('الاشتراك غير متاح حالياً.', 'The subscription is currently unavailable.')}
      </p>
      {canPay && <>
        <p className="mt-6 text-xl font-bold text-brand-primary">{Number(currentStatus.amountIqd).toLocaleString()} IQD</p>
        <button disabled={busy} onClick={() => void startCheckout()}
          className="mt-5 w-full rounded-xl bg-brand-primary px-6 py-4 font-bold text-white disabled:opacity-50">
          {busy ? tr('جاري فتح الدفع...', 'Opening payment...') : tr('ادفع الكترونيا وجدد الاشتراك', 'Pay online and renew')}
        </button>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label={tr('طرق الدفع', 'Payment methods')}>
          {[
            ['QiCard', '/payment-methods/qicard.svg'],
            ['Mastercard', '/payment-methods/mastercard.svg'],
            ['ZainCash', '/payment-methods/zaincash.svg'],
            ['FIB', '/payment-methods/fib.svg'],
          ].map(([name, src]) => <div key={name} className="flex h-12 w-[88px] items-center justify-center rounded-lg border border-border-delicate bg-white px-2">
            <img src={src} alt={name} className="h-8 w-auto max-w-full object-contain" loading="eager" />
          </div>)}
        </div>
      </>}
      {currentStatus?.reason === 'expired' && session.role === 'restaurant' && !currentStatus.canRenew &&
        <p className="mt-5 text-sm text-amber-700">{tr('خطة التجديد أو سعرها غير مهيأ. تواصل مع الإدارة.', 'The renewal plan or price is not configured. Contact the administrator.')}</p>}
      {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
      <button onClick={() => void refresh()} className="mt-6 text-sm font-semibold text-brand-primary underline">
        {tr('تحقق من حالة الدفع', 'Check payment status')}
      </button>
    </section>
  </main>;
}
