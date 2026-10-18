import { useState } from 'react';
import { BookOpen, Share2, X } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

type Role = 'customer' | 'admin' | 'restaurant' | 'waiter' | 'kitchen';

export default function FirstVisitGuide({ role, restaurantId }: { role: Role; restaurantId?: string }) {
  const { tr } = useLanguage();
  const key = `novx_guide_v1_${role}_${restaurantId || 'system'}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== 'done');
  if (!open) return null;

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || window.matchMedia('(display-mode: standalone)').matches;
  const showInstall = (role === 'waiter' || role === 'kitchen') && isIos && !standalone;
  const content = {
    customer: [tr('تصفح الأطباق وأضف ما يعجبك إلى السلة.', 'Explore dishes and add your picks to the cart.'), tr('تأكد من طاولتك، ثم أرسل الطلب وتابع حالته هنا.', 'Confirm your table, send the order, and follow its status here.'), tr('يمكنك نداء الويتر أو سؤال مساعد القائمة.', 'You can call a waiter or ask the menu assistant.')],
    admin: [tr('أنشئ المطاعم وأدر اشتراكاتها من لوحة الإدارة.', 'Create restaurants and manage subscriptions from this dashboard.'), tr('افتح أي قسم من شريط التنقل لإدارة الإعدادات والتنبيهات.', 'Use the navigation to manage settings and notices.')],
    restaurant: [tr('تابع الطلبات والمبيعات من الرئيسية.', 'See orders and sales on the home screen.'), tr('أضف الأطباق والموظفين، وخصص الهوية وبطاقات QR.', 'Manage menu items, staff, branding, and table QR cards.'), tr('راجع التنبيهات وخدمة الطاولات من شريط التنقل.', 'Review alerts and table service from the navigation.')],
    waiter: [tr('ستظهر الطلبات الجديدة ونداءات الطاولات هنا.', 'New orders and table calls appear here.'), tr('اقبل الطلب، تابع حالته، ثم سلّمه للزبون.', 'Accept orders, follow their status, and serve the guest.'), tr('اترك صوت الطلبات مفعلاً، واضغط على الصفحة مرة للسماح بتشغيله.', 'Keep order sound on and tap the page once to allow playback.')],
    kitchen: [tr('ستظهر الطلبات المحالة إلى المطبخ هنا.', 'Orders sent to the kitchen appear here.'), tr('حدّث الطلب إلى جاهز عندما ينتهي التحضير.', 'Mark an order ready when preparation is complete.'), tr('اترك صوت الطلبات مفعلاً، واضغط على الصفحة مرة للسماح بتشغيله.', 'Keep order sound on and tap the page once to allow playback.')],
  }[role];
  const close = () => { localStorage.setItem(key, 'done'); setOpen(false); };

  return <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="first-visit-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-primary text-white"><BookOpen className="h-6 w-6" /></div>
        <button type="button" onClick={close} aria-label={tr('إغلاق الدليل', 'Close guide')} className="rounded-full p-2 text-text-muted hover:bg-bg-paper"><X className="h-5 w-5" /></button>
      </div>
      <h2 id="first-visit-title" className="mt-5 text-2xl font-bold text-brand-primary">{tr('أهلاً بك في أوردوفا', 'Welcome to Ordova')}</h2>
      <p className="mt-2 text-sm text-text-muted">{tr('دليل سريع لتبدأ بسهولة:', 'A quick guide to get started:')}</p>
      <ol className="mt-5 space-y-3">{content.map((step, index) => <li key={step} className="flex gap-3 rounded-xl bg-bg-paper p-3 text-sm text-text-main"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white">{index + 1}</span><span>{step}</span></li>)}</ol>
      {showInstall && <div className="mt-5 rounded-2xl border border-brand-gold/30 bg-brand-gold/10 p-4 text-sm text-brand-primary">
        <div className="flex items-center gap-2 font-bold"><Share2 className="h-4 w-4" />{tr('أضفها كتطبيق على iPhone', 'Add as an iPhone app')}</div>
        <p className="mt-2 leading-relaxed">{tr('افتح هذه الصفحة في Safari، اضغط مشاركة (المربع مع السهم)، ثم اختر «إضافة إلى الشاشة الرئيسية». افتحها من الأيقونة الجديدة ثم فعّل الإشعارات.', 'Open this page in Safari, tap Share (square with arrow), then Add to Home Screen. Open it from the new icon and enable notifications.')}</p>
      </div>}
      <button type="button" onClick={close} className="mt-6 w-full rounded-xl bg-brand-primary px-5 py-3 font-bold text-white">{tr('فهمت، لنبدأ', 'Got it, let’s start')}</button>
    </section>
  </div>;
}
