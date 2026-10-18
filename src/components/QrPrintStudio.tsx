import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { Download, Printer, Upload } from 'lucide-react';
import { doc, updateDoc, db } from '../lib/supabase-db';
import { DEFAULT_SYSTEM_LOGO } from '../lib/brand';
import { useLanguage } from '../lib/i18n';
import { menuQrUrl } from '../lib/qr-tables';
import { persistRestaurantImage } from '../lib/storage';
import type { Restaurant } from '../types';

type QrDesign = NonNullable<Restaurant['qrDesign']>;
const designs: QrDesign[] = ['ordova', 'minimal', 'cafe', 'bold'];
const palettes: Record<QrDesign, { background: string; ink: string; accent: string; qr: string; paper: string }> = {
  ordova: { background: '#081220', ink: '#fffaf4', accent: '#ff6a3d', qr: '#081220', paper: '#ffffff' },
  minimal: { background: '#faf9f6', ink: '#14202b', accent: '#14202b', qr: '#14202b', paper: '#ffffff' },
  cafe: { background: '#f1e3cc', ink: '#493426', accent: '#9b6845', qr: '#493426', paper: '#fffdf8' },
  bold: { background: '#ff6a3d', ink: '#081220', accent: '#081220', qr: '#081220', paper: '#ffffff' },
};

function QrCard({ restaurantName, logo, url, table, design, isEnglish, showText = true }: {
  restaurantName: string; logo: string; url: string; table?: number; design: QrDesign; isEnglish: boolean; showText?: boolean;
}) {
  const color = palettes[design];
  const title = table ? (isEnglish ? `TABLE ${table}` : `طاولة ${table}`) : (isEnglish ? 'THE MENU' : 'القائمة');
  const subtitle = isEnglish ? 'Scan to explore & order' : 'امسح الرمز لتصفح القائمة والطلب';
  const font = design === 'cafe' ? 'Georgia, IBM Plex Sans Arabic, serif' : 'IBM Plex Sans Arabic, Arial, sans-serif';
  const nameSize = restaurantName.length > 30 ? 25 : restaurantName.length > 18 ? 32 : 40;

  return <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" role="img" aria-label={`${restaurantName} ${title}`}>
    <rect width="600" height="800" fill={color.background} />
    {design === 'ordova' && <><circle cx="60" cy="50" r="170" fill="none" stroke="#1a3044" strokeWidth="56" /><rect x="0" y="772" width="600" height="28" fill={color.accent} /></>}
    {design === 'minimal' && <><rect x="24" y="24" width="552" height="752" rx="8" fill="none" stroke={color.ink} strokeWidth="2" /><path d="M82 188 H518 M82 706 H518" stroke={color.ink} strokeWidth="2" /></>}
    {design === 'cafe' && <><path d="M0 0 H600 V176 Q300 250 0 176 Z" fill="#e8d1ad" /><circle cx="300" cy="360" r="255" fill="none" stroke="#d9bf99" strokeWidth="3" /></>}
    {design === 'bold' && <><path d="M0 0 H600 V186 L0 236 Z" fill={color.accent} /><path d="M0 700 L600 650 V800 H0 Z" fill={color.accent} /></>}
    <image href={logo} x="264" y="50" width="72" height="72" preserveAspectRatio="xMidYMid meet" />
    {showText && <><text x="300" y="172" fill={design === 'bold' ? '#ffffff' : color.ink} textAnchor="middle" fontFamily={font} fontWeight="700" fontSize={nameSize} direction="auto">{restaurantName}</text>
    <text x="300" y="224" fill={design === 'bold' ? '#ffffff' : color.accent} textAnchor="middle" fontFamily={font} fontSize="22" fontWeight="700" direction="auto">{title}</text></>}
    <rect x="114" y="254" width="372" height="372" rx={design === 'minimal' ? 4 : 28} fill={color.paper} />
    <g transform="translate(150 290)">
      <QRCode value={url} size={300} level="H" bgColor={color.paper} fgColor={color.qr} />
      <rect x="119" y="119" width="62" height="62" rx="12" fill="#ffffff" />
      <image href={logo} x="126" y="126" width="48" height="48" preserveAspectRatio="xMidYMid meet" />
    </g>
    {showText && <><text x="300" y="678" fill={color.ink} textAnchor="middle" fontFamily={font} fontSize="22" fontWeight="500" direction="auto">{subtitle}</text>
    <text x="300" y="730" fill={design === 'bold' ? '#ffffff' : color.accent} textAnchor="middle" fontFamily={font} fontSize="15" fontWeight="700" letterSpacing="3">ORDOVA</text></>}
  </svg>;
}

async function prepareLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) throw new Error('unsupported_logo');
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('unsupported_logo'));
      image.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 400 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas_unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(imageUrl); }
}

async function drawCardText(context: CanvasRenderingContext2D, name: string, table: number | undefined, design: QrDesign, isEnglish: boolean) {
  try { await document.fonts.load('700 40px "IBM Plex Sans Arabic"', 'مطعم'); } catch { /* Use the browser's Arabic-capable fallback. */ }
  const color = palettes[design];
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const line = (value: string, y: number, size: number, weight: number, fill: string, maxWidth = 500) => {
    context.direction = /[\u0600-\u06ff]/.test(value) ? 'rtl' : 'ltr';
    context.font = `${weight} ${size}px "IBM Plex Sans Arabic", Arial, sans-serif`;
    context.fillStyle = fill;
    context.fillText(value, 300, y, maxWidth);
  };
  line(name, 172, name.length > 30 ? 25 : name.length > 18 ? 32 : 40, 700, design === 'bold' ? '#ffffff' : color.ink);
  line(table ? (isEnglish ? `TABLE ${table}` : `طاولة ${table}`) : (isEnglish ? 'THE MENU' : 'القائمة'), 224, 22, 700, design === 'bold' ? '#ffffff' : color.accent);
  line(isEnglish ? 'Scan to explore & order' : 'امسح الرمز لتصفح القائمة والطلب', 678, 22, 500, color.ink);
  line('ORDOVA', 730, 15, 700, design === 'bold' ? '#ffffff' : color.accent);
}

async function imageDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error('logo_unavailable');
  const blob = await response.blob();
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(blob.type) || blob.size > 5_000_000) throw new Error('unsupported_logo');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('logo_unavailable'));
    reader.readAsDataURL(blob);
  });
}

export default function QrPrintStudio({ restaurant, onSaved }: { restaurant: Restaurant; onSaved: (next: Restaurant) => void }) {
  const { isEnglish, tr } = useLanguage();
  const [design, setDesign] = useState<QrDesign>(restaurant.qrDesign || 'ordova');
  const [tableCount, setTableCount] = useState(restaurant.tableCount || 0);
  const [selectedTable, setSelectedTable] = useState(1);
  const [logoData, setLogoData] = useState<string | null>(null);
  const [logoWarning, setLogoWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logoUrl = restaurant.logoUrl || DEFAULT_SYSTEM_LOGO;
  const validCount = Number.isInteger(tableCount) && tableCount >= 0 && tableCount <= 500;
  const menuUrl = (table?: number) => menuQrUrl(window.location.origin, restaurant.id, table);

  useEffect(() => {
    setDesign(restaurant.qrDesign || 'ordova');
    setTableCount(restaurant.tableCount || 0);
    setSelectedTable(1);
  }, [restaurant.id]);

  useEffect(() => {
    let active = true;
    setLogoData(null);
    setLogoWarning('');
    imageDataUrl(logoUrl).catch(() => {
      if (active && restaurant.logoUrl) setLogoWarning(tr('تعذر إدراج شعار المطعم في الصورة؛ سيُستخدم شعار أوردوفا.', 'The restaurant logo could not be embedded; the Ordova mark will be used.'));
      return imageDataUrl(DEFAULT_SYSTEM_LOGO);
    })
      .then((data) => { if (active) setLogoData(data); })
      .catch(() => { if (active) setError(tr('تعذر تحميل شعار البطاقة.', 'Could not load the card logo.')); });
    return () => { active = false; };
  }, [logoUrl, isEnglish]);

  const saveSettings = async () => {
    if (!validCount) return;
    setBusy(true); setError('');
    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id), { tableCount, qrDesign: design });
      onSaved({ ...restaurant, tableCount, qrDesign: design });
    } catch (cause) {
      console.error('QR settings save failed', cause);
      setError(tr('تعذر حفظ إعدادات الباركود. تحقق من الاتصال أو الاشتراك.', 'Could not save QR settings. Check your connection or subscription.'));
    } finally { setBusy(false); }
  };

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const image = await prepareLogo(file);
      const logoUrl = await persistRestaurantImage(restaurant.id, image, 'restaurant-logo');
      await updateDoc(doc(db, 'restaurants', restaurant.id), { logoUrl });
      onSaved({ ...restaurant, logoUrl });
    } catch (cause) {
      console.error('Restaurant logo upload failed', cause);
      setError(tr('تعذر رفع الشعار أو حفظه. استخدم صورة PNG أو JPG أو WebP بحجم أقل من ٥ ميغابايت.', 'Could not upload or save the logo. Use a PNG, JPG, or WebP image under 5 MB.'));
    } finally { setBusy(false); }
  };

  const ensureLogo = async () => logoData || await imageDataUrl(logoUrl).catch(() => imageDataUrl(DEFAULT_SYSTEM_LOGO));

  const downloadCard = async () => {
    setBusy(true); setError('');
    try {
      const logo = await ensureLogo();
      const { renderToStaticMarkup } = await import('react-dom/server');
      const table = tableCount > 0 ? selectedTable : undefined;
      const svg = renderToStaticMarkup(<QrCard restaurantName={restaurant.restaurantName} logo={logo} url={menuUrl(table)} table={table} design={design} isEnglish={isEnglish} showText={false} />);
      const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error('card_render_failed'));
        image.src = blobUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 1600;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.scale(2, 2);
      await drawCardText(context, restaurant.restaurantName, table, design, isEnglish);
      URL.revokeObjectURL(blobUrl);
      const link = document.createElement('a');
      const safeName = restaurant.restaurantName.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 40) || 'restaurant';
      link.download = `${safeName}-${tableCount > 0 ? `table-${selectedTable}` : 'menu'}-QR.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (cause) {
      console.error('QR card download failed', cause);
      setError(tr('تعذر إنشاء الصورة. حاول استخدام شعار PNG أو JPG.', 'Could not create the image. Try a PNG or JPG logo.'));
    } finally { setBusy(false); }
  };

  const printCards = async () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { setError(tr('اسمح بفتح نافذة الطباعة ثم حاول مجدداً.', 'Allow the print window and try again.')); return; }
    setBusy(true); setError('');
    try {
      const logo = await ensureLogo();
      const { renderToStaticMarkup } = await import('react-dom/server');
      const tables = tableCount > 0 ? Array.from({ length: tableCount }, (_, index) => index + 1) : [undefined];
      const cards = tables.map((table) => `<div class="card">${renderToStaticMarkup(<QrCard restaurantName={restaurant.restaurantName} logo={logo} url={menuUrl(table)} table={table} design={design} isEnglish={isEnglish} />)}</div>`).join('');
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html><head><title>QR cards</title><style>@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&display=swap');@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0}.sheet{display:grid;grid-template-columns:repeat(2,95mm);gap:0}.card{width:95mm;height:126.67mm;break-inside:avoid}.card>svg{width:100%;height:100%;display:block}</style></head><body><main class="sheet">${cards}</main></body></html>`);
      printWindow.document.close();
      try { await printWindow.document.fonts.load('700 40px "IBM Plex Sans Arabic"', 'مطعم'); } catch { /* Browser fallback remains available. */ }
      printWindow.focus();
      printWindow.print();
    } catch (cause) {
      printWindow.close();
      console.error('QR card printing failed', cause);
      setError(tr('تعذر تجهيز البطاقات للطباعة.', 'Could not prepare the cards for printing.'));
    } finally { setBusy(false); }
  };

  return <section className="mt-12 w-full max-w-5xl rounded-3xl border border-border-delicate bg-bg-paper p-5 sm:p-8" dir={isEnglish ? 'ltr' : 'rtl'}>
    <div className="mb-7">
      <p className="text-xs font-bold uppercase tracking-[.22em] text-brand-gold">{tr('جاهز للطباعة', 'Print-ready')}</p>
      <h4 className="mt-2 text-2xl font-bold text-brand-primary">{tr('بطاقات QR للطاولات', 'Table QR cards')}</h4>
      <p className="mt-2 text-sm text-text-muted">{tr('اختر التصميم، أضف عدد الطاولات إن رغبت، ثم نزّل صورة أو اطبع جميع البطاقات.', 'Choose a design, optionally set your table count, then download an image or print the full set.')}</p>
    </div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-6">
        <fieldset>
          <legend className="mb-3 text-sm font-bold text-brand-primary">{tr('التصميم', 'Design')}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {designs.map((option) => <button key={option} type="button" onClick={() => setDesign(option)} aria-pressed={design === option}
              className={`rounded-2xl border p-3 text-start transition-all ${design === option ? 'border-brand-primary ring-2 ring-brand-primary/15' : 'border-border-delicate hover:border-brand-gold'}`}>
              <span className="mb-3 block h-14 rounded-xl" style={{ background: palettes[option].background }}>
                <span className="ms-3 mt-3 inline-block h-8 w-8 rounded-md border-4" style={{ borderColor: palettes[option].accent, background: palettes[option].paper }} />
              </span>
              <span className="text-xs font-bold text-brand-primary">{{ ordova: tr('أوردوفا', 'Ordova'), minimal: tr('بسيط', 'Minimal'), cafe: tr('مقهى', 'Café'), bold: tr('جريء', 'Bold') }[option]}</span>
            </button>)}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border-delicate bg-white p-4 text-sm text-brand-primary hover:border-brand-gold">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg-paper">
            {logoData ? <img src={logoData} alt="" className="h-full w-full object-contain" /> : <Upload className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{tr('رفع شعار المطعم', 'Upload restaurant logo')}</span>
            <span className="mt-1 block text-xs text-text-muted">{tr('يُحفظ في Supabase كشعار المطعم ويظهر في القائمة ووسط رمز QR وعلى البطاقة.', 'Saved in Supabase as the restaurant logo; shown on the menu, in the QR center, and on the card.')}</span>
          </span>
          <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="sr-only" onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex-1 min-w-[180px] text-sm font-bold text-brand-primary">
            {tr('عدد الطاولات (اختياري)', 'Number of tables (optional)')}
            <input type="number" min="0" max="500" step="1" value={tableCount} onChange={(event) => setTableCount(Number(event.target.value))}
              className="mt-2 w-full rounded-xl border border-border-delicate bg-white px-4 py-3 text-base font-medium outline-none focus:border-brand-primary" />
          </label>
          <button type="button" onClick={saveSettings} disabled={busy || !validCount}
            className="rounded-xl bg-brand-primary px-5 py-3.5 text-sm font-bold text-white disabled:opacity-50">{tr('حفظ الإعدادات', 'Save settings')}</button>
        </div>
        {!validCount && <p className="text-sm text-red-700">{tr('أدخل عدداً صحيحاً من ٠ إلى ٥٠٠.', 'Enter a whole number from 0 to 500.')}</p>}
        {validCount && tableCount > 0 && <label className="block max-w-xs text-sm font-bold text-brand-primary">
          {tr('معاينة الطاولة', 'Preview table')}
          <select value={Math.min(selectedTable, tableCount)} onChange={(event) => setSelectedTable(Number(event.target.value))}
            className="mt-2 w-full rounded-xl border border-border-delicate bg-white px-4 py-3 text-base outline-none focus:border-brand-primary">
            {Array.from({ length: tableCount }, (_, index) => <option key={index + 1} value={index + 1}>{tr('طاولة', 'Table')} {index + 1}</option>)}
          </select>
        </label>}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={downloadCard} disabled={busy || !validCount || !logoData}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-3.5 text-sm font-bold text-white disabled:opacity-50"><Download className="h-4 w-4" />{tr('تنزيل صورة PNG', 'Download PNG')}</button>
          <button type="button" onClick={printCards} disabled={busy || !validCount || !logoData}
            className="inline-flex items-center gap-2 rounded-xl border border-border-delicate bg-white px-5 py-3.5 text-sm font-bold text-brand-primary disabled:opacity-50"><Printer className="h-4 w-4" />{tr('طباعة جميع البطاقات', 'Print all cards')}</button>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        {logoWarning && <p role="status" className="text-sm text-amber-800">{logoWarning}</p>}
      </div>
      <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl shadow-xl [&>svg]:block [&>svg]:h-auto [&>svg]:w-full">
        <QrCard restaurantName={restaurant.restaurantName} logo={logoData || logoUrl} url={menuUrl(tableCount > 0 ? Math.min(selectedTable, tableCount) : undefined)}
          table={tableCount > 0 ? Math.min(selectedTable, tableCount) : undefined} design={design} isEnglish={isEnglish} />
      </div>
    </div>
  </section>;
}
