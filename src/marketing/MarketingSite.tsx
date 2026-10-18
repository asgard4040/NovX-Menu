import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpLeft, ArrowUpRight, Bell, BellRing, BookOpen, ChartNoAxesCombined, Check, ChefHat, Circle, CircleCheck, ConciergeBell, Info, Languages, LayoutDashboard, MapPinCheck, Menu, MessageCircle, Palette, PanelsTopLeft, Phone, Plus, QrCode, Route, ScanLine, ShoppingBag, Smartphone, Sparkles, WifiOff, X, type LucideIcon } from 'lucide-react';
import { faqs, features, marketingConfig, nav, screenshots, steps, t, type Bilingual, type Language, type Screenshot } from './content';
import './marketing.css';

const copy = {
  eyebrow: { ar: 'نظام متكامل للمطاعم', en: 'A connected restaurant system' },
  hero: { ar: 'حوّل كل طاولة إلى تجربة طلب ذكية', en: 'Turn Every Table Into a Smarter Ordering Experience' },
  heroText: { ar: 'مع أوردوفا، يمسح ضيوفك رمز QR، يتصفحون المنيو، يرسلون طلباتهم ويتابعونها مباشرة، بينما يدير فريقك الصالة والمطبخ من نظام واحد.', en: 'With ORDOVA, guests scan, browse, order, and track from their phones—while your team manages the dining room and kitchen through one connected system.' },
  demo: { ar: 'اطلب عرضاً تجريبياً', en: 'Request a Demo' },
  explore: { ar: 'اكتشف المميزات', en: 'Explore Features' },
  appFree: { ar: 'لا يحتاج الزبون إلى تحميل تطبيق', en: 'No customer app download required' },
  more: { ar: 'أكثر من مجرد منيو إلكتروني', en: 'More Than a Digital Menu' },
  moreText: { ar: 'أوردوفا هو نظام متكامل يربط الزبون، الويتر، المطبخ، ومدير المطعم في تجربة واحدة سريعة ومنظمة.', en: 'ORDOVA is a connected restaurant system that brings guests, waiters, kitchen staff, and managers together in one fast, organized experience.' },
  oneScan: { ar: 'مسح واحد يربط الزبون، الويتر، المطبخ، وإدارة المطعم.', en: 'One scan connects the guest, waiter, kitchen, and restaurant manager.' },
  how: { ar: 'من الطاولة إلى التقديم، بخطوات واضحة', en: 'From table to service, in four clear steps' },
  howText: { ar: 'تجربة بسيطة للضيف، ومعلومات تصل للفريق في وقتها.', en: 'Simple for guests. Clear and timely for the whole team.' },
  screens: { ar: 'شاهد أوردوفا أثناء العمل', en: 'See ORDOVA in Action' },
  screensText: { ar: 'شاهد لقطات حقيقية من واجهات إدارة المطعم والويتر والمطبخ في نظام أوردوفا.', en: 'See real ORDOVA screens for restaurant management, waiters, and the kitchen.' },
  screenshotNotice: { ar: 'اللقطات المعروضة مأخوذة من نظام أوردوفا الحقيقي في مطعم تجريبي.', en: 'Every screenshot shown here comes from the real ORDOVA system at a demo restaurant.' },
  features: { ar: 'كل ما يحتاجه المطعم، في تدفق عمل واحد', en: 'One flow for the whole restaurant' },
  benefits: { ar: 'خدمة أوضح. تشغيل أكثر انسيابية.', en: 'Clearer service. Smoother operations.' },
  solutions: { ar: 'مصمم لإيقاع ضيافتك', en: 'Built around your kind of hospitality' },
  cta: { ar: 'جاهز لتطوير تجربة مطعمك؟', en: 'Ready to Upgrade Your Restaurant Experience?' },
  ctaText: { ar: 'ابدأ مع أوردوفا واجعل الطلب أسرع، الخدمة أوضح، وإدارة مطعمك أكثر ذكاءً.', en: 'Start with ORDOVA and make ordering faster, service clearer, and restaurant management smarter.' },
};

const groups = [
  { id: 'customer', label: { ar: 'الزبون', en: 'Customer' } },
  { id: 'manager', label: { ar: 'مدير المطعم', en: 'Restaurant Manager' } },
  { id: 'waiter', label: { ar: 'الويتر', en: 'Waiter' } },
  { id: 'kitchen', label: { ar: 'المطبخ', en: 'Kitchen' } },
] as const;
const capturedScreenshots = screenshots.filter((item): item is Screenshot & { src: string } => Boolean(item.src));
const capturedGroups = groups.filter(group => capturedScreenshots.some(item => item.group === group.id));

const benefits: Bilingual[] = [
  { ar: 'طلب أسرع من الطاولة', en: 'Faster ordering from the table' },
  { ar: 'تواصل أوضح بين الضيف والفريق', en: 'Clearer guest and team communication' },
  { ar: 'تقليل أخطاء إدخال الطلبات', en: 'Fewer order-entry mistakes' },
  { ar: 'تنسيق أفضل بين الصالة والمطبخ', en: 'Better dining room and kitchen coordination' },
  { ar: 'تحديث الأطباق والأسعار بسهولة', en: 'Simple menu and price updates' },
  { ar: 'رؤية مباشرة للطلبات الجارية', en: 'Clear visibility into active orders' },
  { ar: 'سجل طلبات منظم وقابل للبحث', en: 'Organized, searchable order history' },
  { ar: 'هوية مرنة لكل مطعم', en: 'Flexible branding for each restaurant' },
];
const venues: Bilingual[] = [
  { ar: 'المطاعم', en: 'Restaurants' }, { ar: 'المقاهي', en: 'Cafés' },
  { ar: 'الوجبات السريعة', en: 'Fast food' }, { ar: 'مطاعم الفنادق', en: 'Hotel restaurants' },
  { ar: 'ساحات الطعام', en: 'Food courts' }, { ar: 'المطاعم العائلية', en: 'Casual dining' },
  { ar: 'المطاعم الراقية', en: 'Fine dining' }, { ar: 'مجموعات المطاعم', en: 'Restaurant groups' },
];

const icons: Record<string, LucideIcon> = { ArrowLeft, ArrowRight, ArrowUpLeft, ArrowUpRight, Bell, BellRing, BookOpen, ChartNoAxesCombined, Check, ChefHat, Circle, CircleCheck, ConciergeBell, Info, Languages, LayoutDashboard, MapPinCheck, Menu, MessageCircle, Palette, PanelsTopLeft, Phone, Plus, QrCode, Route, ScanLine, ShoppingBag, Smartphone, Sparkles, WifiOff, X };
const icon = (name: string, size = 22) => {
  const Item = icons[name] || Circle;
  return <Item size={size} strokeWidth={1.75} aria-hidden />;
};

function ScreenDevice({ item, language }: { item: Screenshot & { src: string }; language: Language }) {
  return <div className={`ms-device ms-device-${item.device}`}>
    <div className="ms-device-bar"><span/><span/><span/></div>
    <img src={item.src} alt={`${t(item.title, language)} — ORDOVA`} loading="lazy" />
  </div>;
}

function ScreenshotShowcase({ language }: { language: Language }) {
  const [group, setGroup] = useState<Screenshot['group']>(capturedGroups[0]?.id ?? 'manager');
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<(Screenshot & { src: string }) | null>(null);
  const touchX = useRef<number | null>(null);
  const items = capturedScreenshots.filter(s => s.group === group);
  const selected = items[Math.min(index, items.length - 1)];
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'Tab') { e.preventDefault(); document.querySelector<HTMLButtonElement>('.ms-lightbox-close')?.focus(); }
    };
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = ''; previous?.focus(); };
  }, [open]);
  if (!selected) return null;
  const next = (delta: number) => setIndex(v => (v + delta + items.length) % items.length);
  return <section className="ms-section ms-screens" id="screens" aria-labelledby="screens-title">
    <div className="ms-container"><div className="ms-section-heading"><span className="ms-kicker">PRODUCT / المنتج</span><h2 id="screens-title">{t(copy.screens, language)}</h2><p>{t(copy.screensText, language)}</p></div>
      <div className="ms-screen-notice">{icon('Info', 18)}<span>{t(copy.screenshotNotice, language)}</span></div>
      <div className="ms-tabs" role="tablist" aria-label={language === 'ar' ? 'واجهات أوردوفا' : 'ORDOVA workspaces'}>{capturedGroups.map(g => <button key={g.id} id={`tab-${g.id}`} type="button" role="tab" aria-selected={group === g.id} aria-controls="screen-panel" onClick={() => { setGroup(g.id); setIndex(0); }}>{t(g.label, language)}</button>)}</div>
      <div className="ms-screen-stage" id="screen-panel" role="tabpanel" aria-labelledby={`tab-${group}`} onTouchStart={e => { touchX.current = e.touches[0].clientX; }} onTouchEnd={e => { if (touchX.current === null) return; const diff = e.changedTouches[0].clientX - touchX.current; if (Math.abs(diff) > 45) next(diff > 0 ? -1 : 1); touchX.current = null; }}>
        <button className="ms-screen-main" type="button" onClick={() => setOpen(selected)} aria-label={`${language === 'ar' ? 'تكبير' : 'Open'} ${t(selected.title, language)}`}><ScreenDevice item={selected} language={language} /></button>
        <div className="ms-screen-description"><span className="ms-kicker">{String(index + 1).padStart(2,'0')} / {String(items.length).padStart(2,'0')}</span><h3>{t(selected.title, language)}</h3><p>{t(selected.description, language)}</p>{items.length > 1 && <div className="ms-screen-controls"><button type="button" onClick={() => next(-1)} aria-label={language === 'ar' ? 'اللقطة السابقة' : 'Previous screenshot'}>{icon(language === 'ar' ? 'ArrowRight' : 'ArrowLeft')}</button><button type="button" onClick={() => next(1)} aria-label={language === 'ar' ? 'اللقطة التالية' : 'Next screenshot'}>{icon(language === 'ar' ? 'ArrowLeft' : 'ArrowRight')}</button></div>}</div>
      </div>
      {items.length > 1 && <div className="ms-screen-strip" aria-label={language === 'ar' ? 'اللقطات الحقيقية' : 'Real screenshots'}>{items.map((item, position) => <button type="button" key={item.id} className={position === index ? 'active' : ''} onClick={() => setIndex(position)}>{String(position + 1).padStart(2,'0')} <span>{t(item.title, language)}</span></button>)}</div>}
    </div>
    {open && <div className="ms-lightbox" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(null); }}><div className="ms-lightbox-dialog" role="dialog" aria-modal="true" aria-label={t(open.title, language)}><button autoFocus className="ms-lightbox-close" type="button" onClick={() => setOpen(null)} aria-label={language === 'ar' ? 'إغلاق' : 'Close'}>{icon('X')}</button><ScreenDevice item={open} language={language} /><p>{t(open.title, language)} · {open.dimensions}</p></div></div>}
  </section>;
}

function DemoForm({ language }: { language: Language }) {
  const [status, setStatus] = useState('');
  const [handoffUrl, setHandoffUrl] = useState('');
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [preferredLanguage, setPreferredLanguage] = useState<Language>(language);
  useEffect(() => setPreferredLanguage(language), [language]);
  const labels: Record<string,Bilingual> = {
    fullName: { ar: 'الاسم الكامل', en: 'Full name' }, restaurant: { ar: 'اسم المطعم', en: 'Restaurant name' }, phone: { ar: 'رقم الهاتف', en: 'Phone number' }, email: { ar: 'البريد الإلكتروني', en: 'Email address' }, city: { ar: 'المدينة أو المحافظة', en: 'City or province' }, type: { ar: 'نوع المطعم', en: 'Restaurant type' }, branches: { ar: 'عدد الفروع', en: 'Number of branches' }, preferred: { ar: 'اللغة المفضلة', en: 'Preferred language' }, message: { ar: 'رسالتك', en: 'Message' }, consent: { ar: 'أوافق على فتح واتساب لإرسال بيانات هذا الطلب إلى فريق أوردوفا.', en: 'I agree to open WhatsApp and send these request details to the ORDOVA team.' },
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setStatus(''); setHandoffUrl('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const found: Record<string,string> = {};
    for (const key of ['fullName','restaurant','phone','email','city','type','branches','preferred']) if (!String(data.get(key) || '').trim()) found[key] = language === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required';
    if (data.get('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.get('email')))) found.email = language === 'ar' ? 'أدخل بريداً صحيحاً' : 'Enter a valid email';
    if (data.get('phone') && !/^[+\d\s()\-]{7,20}$/.test(String(data.get('phone')))) found.phone = language === 'ar' ? 'أدخل رقم هاتف صحيحاً' : 'Enter a valid phone number';
    if (data.get('branches') && (!Number.isInteger(Number(data.get('branches'))) || Number(data.get('branches')) < 1)) found.branches = language === 'ar' ? 'أدخل عدداً صحيحاً أكبر من صفر' : 'Enter a whole number greater than zero';
    if (!data.get('consent')) found.consent = language === 'ar' ? 'الموافقة مطلوبة لإرسال الطلب' : 'Consent is required to send the request';
    setErrors(found);
    if (Object.keys(found).length) { form.querySelector<HTMLElement>(`[name="${Object.keys(found)[0]}"]`)?.focus(); return; }
    const lines = [language === 'ar' ? 'طلب عرض تجريبي — ORDOVA' : 'ORDOVA demo request', '', ...Object.entries(labels).filter(([key]) => key !== 'consent').map(([key,label]) => `${t(label, language)}: ${String(data.get(key) || '—').trim()}`)];
    const url = `https://wa.me/${marketingConfig.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
    const popup = window.open(url, '_blank');
    if (popup) popup.opener = null;
    setHandoffUrl(url);
    setStatus(popup ? (language === 'ar' ? 'فُتح واتساب برسالة جاهزة. اضغط إرسال هناك لإكمال طلب العرض.' : 'WhatsApp opened with your prepared message. Press Send there to complete your request.') : (language === 'ar' ? 'تعذر فتح واتساب تلقائياً. استخدم الرابط أدناه لإكمال الطلب.' : 'WhatsApp could not open automatically. Use the link below to finish your request.'));
  };
  const input = (name: string, type = 'text') => <label className="ms-field" key={name}><span>{t(labels[name], language)} <b aria-hidden="true">*</b></span><input name={name} type={type} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} required={name !== 'message'} min={name === 'branches' ? 1 : undefined} />{errors[name] && <small role="alert" id={`${name}-error`}>{errors[name]}</small>}</label>;
  return <form className="ms-form" onSubmit={submit} noValidate>
    <div className="ms-form-grid">{input('fullName')}{input('restaurant')}{input('phone','tel')}{input('email','email')}{input('city')}<label className="ms-field"><span>{t(labels.type, language)} <b>*</b></span><select name="type" required defaultValue=""><option value="" disabled>{language === 'ar' ? 'اختر النوع' : 'Select type'}</option>{venues.map(v => <option key={v.en} value={v.en}>{t(v, language)}</option>)}</select>{errors.type && <small role="alert">{errors.type}</small>}</label>{input('branches','number')}<label className="ms-field"><span>{t(labels.preferred, language)} <b>*</b></span><select name="preferred" required value={preferredLanguage} onChange={e => setPreferredLanguage(e.target.value as Language)}><option value="ar">العربية</option><option value="en">English</option></select></label></div>
    <label className="ms-field"><span>{t(labels.message, language)}</span><textarea name="message" rows={4} /></label>
    <label className="ms-consent"><input name="consent" type="checkbox" aria-invalid={!!errors.consent} /><span>{t(labels.consent, language)}</span></label>{errors.consent && <small className="ms-error" role="alert">{errors.consent}</small>}
    <button className="ms-button ms-button-primary" type="submit">{language === 'ar' ? 'تابع لإرسال الطلب عبر واتساب' : 'Continue to Send via WhatsApp'} {icon(language === 'ar' ? 'ArrowUpLeft' : 'ArrowUpRight', 18)}</button>
    <p className="ms-form-note">{language === 'ar' ? 'لن تُرسل البيانات تلقائياً؛ يمكنك مراجعة الرسالة قبل إرسالها في واتساب.' : 'Your details are not sent automatically; you can review the message before sending it in WhatsApp.'}</p>
    {status && <p className="ms-form-status" role="status">{status} {handoffUrl && <a href={handoffUrl} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'افتح واتساب' : 'Open WhatsApp'}</a>}</p>}
  </form>;
}

export default function MarketingSite() {
  const [language, setLanguage] = useState<Language>(() => new URLSearchParams(window.location.search).get('lang') === 'en' || (!new URLSearchParams(window.location.search).has('lang') && localStorage.getItem('ordova-marketing-language') === 'en') ? 'en' : 'ar');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    document.querySelector<HTMLElement>('.ms-nav-links a')?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); document.querySelector<HTMLButtonElement>('.ms-menu-toggle')?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.title = language === 'ar' ? 'أوردوفا | نظام المنيو الذكي وإدارة المطاعم' : 'ORDOVA | Smart Digital Menu & Restaurant Management';
    localStorage.setItem('ordova-marketing-language', language);
    const description = language === 'ar' ? 'أوردوفا يربط الزبون والويتر والمطبخ وإدارة المطعم عبر منيو QR ذكي وطلبات مباشرة من الطاولة.' : 'ORDOVA connects guests, waiters, kitchen staff, and managers through a smart QR menu and direct table ordering.';
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]'); if (meta) meta.content = description;
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]'); if (ogTitle) ogTitle.content = document.title;
    const ogDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]'); if (ogDescription) ogDescription.content = description;
    if (marketingConfig.canonicalUrl) {
      let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
      canonical.href = marketingConfig.canonicalUrl + (language === 'en' ? '?lang=en' : '');
      const ogImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]'); if (ogImage) ogImage.content = new URL('/marketing/ordova-qr-restaurant-hero-v2.jpg', marketingConfig.canonicalUrl).href;
    }
  }, [language]);
  const changeLanguage = () => setLanguage(v => { const next = v === 'ar' ? 'en' : 'ar'; const url = new URL(window.location.href); url.searchParams.set('lang', next); window.history.replaceState({}, '', url); return next; });
  return <div className="ms-site" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <a className="ms-skip" href="#main">{language === 'ar' ? 'انتقل إلى المحتوى' : 'Skip to content'}</a>
    <header className="ms-header"><div className="ms-container ms-nav"><a href="#home" className="ms-brand" aria-label="ORDOVA — Home"><img src="/ordova-mark.png" alt="" /><span>ORDOVA</span></a><nav className={menuOpen ? 'ms-nav-links open' : 'ms-nav-links'} id="primary-nav" aria-label={language === 'ar' ? 'القائمة الرئيسية' : 'Main navigation'}>{nav.map(link => <a href={`#${link.id}`} key={link.id} onClick={() => setMenuOpen(false)}>{t(link.label, language)}</a>)}<a className="ms-mobile-demo" href="#contact" onClick={() => setMenuOpen(false)}>{t(copy.demo, language)}</a></nav><div className="ms-nav-actions"><button className="ms-lang" type="button" onClick={changeLanguage} aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}><span>{icon('Languages', 17)}</span>{language === 'ar' ? 'EN' : 'عربي'}</button><a className="ms-button ms-button-primary ms-nav-demo" href="#contact">{t(copy.demo, language)}</a><button className="ms-menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="primary-nav" aria-label={menuOpen ? (language === 'ar' ? 'إغلاق القائمة' : 'Close menu') : (language === 'ar' ? 'فتح القائمة' : 'Open menu')} onClick={() => setMenuOpen(v => !v)}>{icon(menuOpen ? 'X' : 'Menu', 25)}</button></div></div></header>
    <main id="main">
      <section className="ms-hero" id="home"><div className="ms-container ms-hero-grid"><div className="ms-hero-copy"><div className="ms-eyebrow"><span className="ms-eyebrow-line" />{t(copy.eyebrow, language)}</div><h1>{t(copy.hero, language)}</h1><p>{t(copy.heroText, language)}</p><div className="ms-hero-actions"><a className="ms-button ms-button-primary" href="#contact">{t(copy.demo, language)} {icon(language === 'ar' ? 'ArrowUpLeft' : 'ArrowUpRight',18)}</a><a className="ms-button ms-button-outline" href="#features">{t(copy.explore, language)}</a></div><div className="ms-trust">{icon('CircleCheck',18)}{t(copy.appFree, language)}</div></div><div className="ms-hero-visual"><img src="/marketing/ordova-qr-restaurant-hero-v2.jpg" alt={language === 'ar' ? 'ضيف يمسح رمز QR على طاولة مطعم بهاتفه' : 'Guest scanning a table QR code with a phone in a restaurant'} fetchPriority="high" /><div className="ms-hero-caption"><span>01 / SCAN</span><strong>{language === 'ar' ? 'من الطاولة تبدأ التجربة' : 'The experience starts at the table'}</strong></div></div></div><div className="ms-hero-bottom"><div className="ms-container"><span>ORDOVA / CONNECTED HOSPITALITY</span><span>{language === 'ar' ? 'اسحب لاكتشاف النظام' : 'Scroll to explore'} ↓</span></div></div></section>
      <section className="ms-section ms-intro"><div className="ms-container ms-intro-grid"><div><span className="ms-kicker">BEYOND THE MENU / أكثر من منيو</span><h2>{t(copy.more, language)}</h2></div><div><p>{t(copy.moreText, language)}</p><div className="ms-one-scan">{icon('ScanLine',28)}<strong>{t(copy.oneScan, language)}</strong></div></div></div><div className="ms-container ms-roles"><div>{icon('Smartphone')}<span>{language === 'ar' ? 'الضيف' : 'Guest'}</span></div><div>{icon('ConciergeBell')}<span>{language === 'ar' ? 'الويتر' : 'Waiter'}</span></div><div>{icon('ChefHat')}<span>{language === 'ar' ? 'المطبخ' : 'Kitchen'}</span></div><div>{icon('LayoutDashboard')}<span>{language === 'ar' ? 'الإدارة' : 'Manager'}</span></div></div></section>
      <section className="ms-section ms-how" id="how"><div className="ms-container"><div className="ms-section-heading"><span className="ms-kicker">HOW IT WORKS / كيف يعمل</span><h2>{t(copy.how, language)}</h2><p>{t(copy.howText, language)}</p></div><div className="ms-steps">{steps.map(step => <div className="ms-step" key={step.number}><span className="ms-step-number">{step.number}</span><div className="ms-step-icon">{icon(step.icon,27)}</div><h3>{t(step.title, language)}</h3><p>{t(step.description, language)}</p></div>)}</div></div></section>
      <ScreenshotShowcase language={language} />
      <section className="ms-section ms-features" id="features"><div className="ms-container"><div className="ms-section-heading"><span className="ms-kicker">CAPABILITIES / الإمكانيات</span><h2>{t(copy.features, language)}</h2></div><div className="ms-feature-grid">{features.map((feature,i) => <article className="ms-feature-card" key={i}><span className="ms-feature-icon">{icon(feature.icon,24)}</span><h3>{t(feature.title, language)}</h3><p>{t(feature.text, language)}</p></article>)}</div></div></section>
      <section className="ms-section ms-benefits"><div className="ms-container ms-benefits-grid"><div><span className="ms-kicker">WHY ORDOVA / لماذا أوردوفا</span><h2>{t(copy.benefits, language)}</h2><p>{language === 'ar' ? 'التفاصيل الصغيرة في الخدمة تصنع تجربة أفضل. أوردوفا يجعل معلومات الطلب واضحة للجميع، من هاتف الضيف حتى شاشة المطبخ.' : 'Better service lives in the details. ORDOVA keeps order information clear from the guest’s phone to the kitchen screen.'}</p><a className="ms-text-link" href="#contact">{t(copy.demo, language)} {icon(language === 'ar' ? 'ArrowLeft' : 'ArrowRight',18)}</a><img className="ms-benefits-photo" src="/marketing/ordova-kitchen-team.jpg" alt={language === 'ar' ? 'فريق مطبخ يراجع الطلبات على جهاز لوحي' : 'Kitchen team reviewing orders on a tablet'} loading="lazy" /></div><ul>{benefits.map((benefit,i) => <li key={i}>{icon('Check',19)}<span>{t(benefit, language)}</span></li>)}</ul></div></section>
      <section className="ms-section ms-solutions" id="solutions"><div className="ms-container"><div className="ms-section-heading"><span className="ms-kicker">MADE FOR HOSPITALITY / للضيافة</span><h2>{t(copy.solutions, language)}</h2><p>{language === 'ar' ? 'سواء كانت لديك صالة واحدة أو فريق متعدد الأدوار، تتكيف رحلة الطلب مع نمط خدمتك.' : 'Whether you run one dining room or a team with many roles, the ordering journey fits your service style.'}</p></div><div className="ms-venue-grid">{venues.map((venue,i) => <div key={i}><span>{String(i + 1).padStart(2,'0')}</span><strong>{t(venue, language)}</strong>{icon('ArrowUpRight',18)}</div>)}</div></div></section>
      <section className="ms-section ms-testimonials"><div className="ms-container"><span className="ms-kicker">CUSTOMER VOICES / آراء العملاء</span>{marketingConfig.testimonials.length ? <div className="ms-testimonial-grid">{marketingConfig.testimonials.map((item,i) => <blockquote key={i}><p>“{t(item.quote, language)}”</p><footer><strong>{t(item.author, language)}</strong><span>{t(item.organization, language)}</span></footer></blockquote>)}</div> : <div className="ms-testimonial-empty"><h2>{language === 'ar' ? 'مساحة لقصص عملاء أوردوفا' : 'Space for customer stories'}</h2><p>{language === 'ar' ? 'مساحة مخصصة لشهادات موثقة. لم تُزوّدنا بعد آراء أو شعارات قابلة للنشر.' : 'Reserved for verified testimonials. No publishable quotes or restaurant logos were supplied yet.'}</p><span>{language === 'ar' ? 'محتوى مؤقت — يُستبدل بشهادات حقيقية' : 'Placeholder — replace with real testimonials'}</span></div>}</div></section>
      <section className="ms-cta"><div className="ms-container ms-cta-inner"><div><span className="ms-kicker">LET’S TALK / لنبدأ</span><h2>{t(copy.cta, language)}</h2><p>{t(copy.ctaText, language)}</p></div><div className="ms-cta-buttons"><a className="ms-button ms-button-primary" href="#contact">{language === 'ar' ? 'احجز عرضاً تجريبياً' : 'Book a Demo'} {icon(language === 'ar' ? 'ArrowUpLeft' : 'ArrowUpRight',18)}</a><a className="ms-button ms-button-light" href={`https://wa.me/${marketingConfig.whatsapp}`} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'تواصل معنا' : 'Contact Us'}</a></div></div></section>
      <section className="ms-section ms-faq" id="faq"><div className="ms-container ms-faq-grid"><div><span className="ms-kicker">QUESTIONS / الأسئلة الشائعة</span><h2>{language === 'ar' ? 'إجابات واضحة قبل أن تبدأ' : 'Clear answers before you begin'}</h2><p>{language === 'ar' ? 'تعرف على تجربة الضيف، أدوات الفريق، وكيفية بدء العرض.' : 'Learn about the guest experience, team tools, and how to get a demo.'}</p></div><div className="ms-faq-list">{faqs.map((faq,i) => <details key={i}><summary>{t(faq.q, language)}{icon('Plus',19)}</summary><p>{t(faq.a, language)}</p></details>)}</div></div></section>
      <section className="ms-section ms-contact" id="contact"><div className="ms-container ms-contact-grid"><div><span className="ms-kicker">GET IN TOUCH / تواصل معنا</span><h2>{language === 'ar' ? 'دعنا نريك كيف يعمل أوردوفا في مطعمك' : 'See how ORDOVA can work in your restaurant'}</h2><p>{language === 'ar' ? 'أخبرنا قليلاً عن مطعمك واسألنا عن العرض التجريبي أو الاشتراك. يفتح النموذج رسالة واتساب يمكنك مراجعتها وإرسالها بنفسك.' : 'Tell us about your restaurant and ask about a demo, trial, or subscription. The form prepares a WhatsApp message for you to review and send.'}</p><a className="ms-contact-link" href={`tel:+${marketingConfig.whatsapp}`}>{icon('Phone',19)} {marketingConfig.supportPhone}</a><a className="ms-contact-link" href={`https://wa.me/${marketingConfig.whatsapp}`} target="_blank" rel="noopener noreferrer">{icon('MessageCircle',19)} WhatsApp</a></div><DemoForm language={language} /></div></section>
      <section className="ms-legal" id="privacy"><div className="ms-container"><details><summary>{language === 'ar' ? 'معلومات الخصوصية' : 'Privacy information'}</summary><p>{language === 'ar' ? 'نموذج العرض لا يخزن مدخلاتك في هذا الموقع. يفتح رسالة واتساب جاهزة، ولا تصل التفاصيل إلى فريق أوردوفا إلا بعد أن تضغط إرسال داخل واتساب. تنطبق سياسة واتساب على استخدامه. لطلب معلومات إضافية عن معالجة البيانات في نظام أوردوفا، تواصل مع الفريق.' : 'This demo form does not store your entries on this website. It opens a prepared WhatsApp message; ORDOVA receives the details only after you press Send in WhatsApp. WhatsApp’s own policy applies. Contact the team for details on data handling in the ORDOVA system.'}</p></details><details id="terms"><summary>{language === 'ar' ? 'معلومات شروط الخدمة' : 'Service terms information'}</summary><p>{language === 'ar' ? 'معلومات الموقع تعريفية. تفاصيل الاشتراك والإعداد والدعم تُحدد في الاتفاق المباشر مع فريق أوردوفا. اطلب عرضاً للحصول على الشروط المناسبة لمطعمك.' : 'This website provides product information. Subscription, setup, and support terms are agreed directly with the ORDOVA team. Request a demo for terms applicable to your restaurant.'}</p></details></div></section>
    </main>
    <footer className="ms-footer"><div className="ms-container ms-footer-grid"><div><a className="ms-brand" href="#home"><img src="/ordova-mark.png" alt="" /><span>ORDOVA</span></a><p>{t(copy.moreText, language)}</p></div><div><strong>{language === 'ar' ? 'المنتج' : 'Product'}</strong>{nav.slice(1,5).map(link => <a href={`#${link.id}`} key={link.id}>{t(link.label, language)}</a>)}</div><div><strong>{language === 'ar' ? 'ابدأ' : 'Get started'}</strong><a href="#contact">{t(copy.demo, language)}</a><a href="/app">{language === 'ar' ? 'دخول الفريق' : 'Staff sign in'}</a><a href={`https://wa.me/${marketingConfig.whatsapp}`} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'الدعم الفني' : 'Technical support'}</a><a href="#faq">{language === 'ar' ? 'الأسئلة الشائعة' : 'FAQ'}</a></div><div><strong>{language === 'ar' ? 'معلومات' : 'Information'}</strong><a href="#privacy">{language === 'ar' ? 'الخصوصية' : 'Privacy'}</a><a href="#terms">{language === 'ar' ? 'شروط الخدمة' : 'Terms of service'}</a><button type="button" onClick={changeLanguage}>{language === 'ar' ? 'English' : 'العربية'}</button>{marketingConfig.socialLinks.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</div></div><div className="ms-container ms-footer-bottom"><span>© {new Date().getFullYear()} ORDOVA</span><span>{language === 'ar' ? 'صُمم للمطاعم التي تهتم بالتفاصيل' : 'Made for restaurants that care about the details'}</span></div></footer>
  </div>;
}
