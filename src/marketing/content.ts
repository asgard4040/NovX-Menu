export type Language = 'ar' | 'en';
export type Bilingual = { ar: string; en: string };
export const t = (value: Bilingual, language: Language) => value[language];

// Update public contact destinations and replace screenshot entries here.
export const marketingConfig = {
  brand: 'ORDOVA',
  supportPhone: '07740064528',
  whatsapp: '9647740064528',
  canonicalUrl: 'https://ordova.cc',
  staffLoginUrl: 'https://rest.ordova.cc/',
  socialLinks: [] as { label: string; url: string }[],
  testimonials: [] as { quote: Bilingual; author: Bilingual; organization: Bilingual }[],
  screenshotSources: {
    'manager-menu-management': '/marketing/screenshots/owner-menu-management.png',
    'waiter-overview': '/marketing/screenshots/waiter-dashboard.png',
    'waiter-calls': '/marketing/screenshots/waiter-table-calls.png',
    'waiter-create-order': '/marketing/screenshots/waiter-create-order.png',
    'kitchen-overview': '/marketing/screenshots/kitchen-dashboard.png',
  } as Record<string, string>,
};

export const nav = [
  { id: 'home', label: { ar: 'الرئيسية', en: 'Home' } },
  { id: 'features', label: { ar: 'المميزات', en: 'Features' } },
  { id: 'how', label: { ar: 'كيف يعمل', en: 'How It Works' } },
  { id: 'screens', label: { ar: 'شاشات النظام', en: 'Product Screens' } },
  { id: 'solutions', label: { ar: 'الحلول', en: 'Solutions' } },
  { id: 'faq', label: { ar: 'الأسئلة الشائعة', en: 'FAQ' } },
  { id: 'contact', label: { ar: 'تواصل معنا', en: 'Contact' } },
];

export const steps = [
  { number: '01', icon: 'QrCode', title: { ar: 'امسح', en: 'Scan' }, description: { ar: 'يمسح الزبون رمز QR الموجود على الطاولة.', en: 'The guest scans the QR code on the table.' } },
  { number: '02', icon: 'BookOpen', title: { ar: 'تصفّح', en: 'Browse' }, description: { ar: 'يفتح المنيو فوراً ويستعرض الأقسام، الصور، الأسعار والمكونات.', en: 'The digital menu opens instantly with categories, photos, prices, and ingredients.' } },
  { number: '03', icon: 'ShoppingBag', title: { ar: 'اطلب', en: 'Order' }, description: { ar: 'يخصص الزبون وجبته، يضيف ملاحظاته ويرسل الطلب من هاتفه.', en: 'The guest customizes dishes, adds notes, and places the order from their phone.' } },
  { number: '04', icon: 'ChefHat', title: { ar: 'حضّر وقدّم', en: 'Prepare & Serve' }, description: { ar: 'يصل الطلب إلى فريق المطعم والمطبخ، ويتمكن الزبون من متابعة حالته.', en: 'The restaurant and kitchen receive the order while the guest follows its progress.' } },
];

export const features = [
  { icon: 'QrCode', title: { ar: 'منيو QR فوري', en: 'Instant QR Menu' }, text: { ar: 'المنيو يفتح على هاتف الضيف دون تنزيل تطبيق.', en: 'The menu opens on a guest’s phone with no app download.' } },
  { icon: 'ShoppingBag', title: { ar: 'طلب مباشر من الطاولة', en: 'Direct Table Ordering' }, text: { ar: 'أطباق وخيارات وملاحظات ورقم طاولة في طلب واحد.', en: 'Dishes, options, notes, and table number in one order.' } },
  { icon: 'Route', title: { ar: 'متابعة حالة الطلب', en: 'Live Order Tracking' }, text: { ar: 'من الاستلام إلى التحضير والجاهزية والتقديم.', en: 'From received to preparing, ready, and served.' } },
  { icon: 'BellRing', title: { ar: 'استدعاء الويتر', en: 'Call a Waiter' }, text: { ar: 'طلب الحساب أو المساعدة أو الإضافات مباشرة من الطاولة.', en: 'Request the bill, assistance, or extras from the table.' } },
  { icon: 'Sparkles', title: { ar: 'مساعد المنيو الذكي', en: 'AI Menu Assistant' }, text: { ar: 'يساعد الضيوف على اكتشاف الأطباق بحسب تفضيلاتهم، عند تفعيله.', en: 'Helps guests discover dishes by preference when enabled.' } },
  { icon: 'ChefHat', title: { ar: 'واجهة المطبخ', en: 'Kitchen Display' }, text: { ar: 'الطلبات والكميات والطاولات وتعليمات التحضير أمام الفريق.', en: 'Orders, quantities, tables, and preparation notes in one view.' } },
  { icon: 'ConciergeBell', title: { ar: 'مساحة الويتر', en: 'Waiter Workspace' }, text: { ar: 'طلبات جديدة ونداءات الطاولات والأطباق الجاهزة للتقديم.', en: 'New orders, table calls, and dishes ready to serve.' } },
  { icon: 'LayoutDashboard', title: { ar: 'إدارة المطعم', en: 'Restaurant Management' }, text: { ar: 'تحكم بالأطباق والأقسام والأسعار والصور والموظفين والطلبات.', en: 'Manage dishes, categories, prices, images, staff, and orders.' } },
  { icon: 'ChartNoAxesCombined', title: { ar: 'رؤية أوضح للمبيعات', en: 'Sales & Order Insights' }, text: { ar: 'إيرادات يومية وشهرية وسجل طلبات قابل للبحث.', en: 'Daily and monthly revenue with searchable order history.' } },
  { icon: 'MapPinCheck', title: { ar: 'التحقق من الموقع', en: 'Location Verification' }, text: { ar: 'تحقق اختياري من قرب الزبون من المطعم للحد من الطلبات غير الصحيحة.', en: 'Optional proximity checks help reduce invalid orders.' } },
  { icon: 'Palette', title: { ar: 'هوية خاصة لكل مطعم', en: 'Your Restaurant’s Brand' }, text: { ar: 'شعار وألوان وثيم للمنيو بما يلائم هوية المكان.', en: 'A logo, colors, and menu theme suited to your venue.' } },
  { icon: 'Languages', title: { ar: 'العربية والإنجليزية', en: 'Arabic & English' }, text: { ar: 'واجهات للضيوف والفرق باللغتين مع اتجاه عرض مناسب.', en: 'Guest and team interfaces in both languages.' } },
  { icon: 'Bell', title: { ar: 'تنبيهات فورية', en: 'Real-Time Alerts' }, text: { ar: 'تنبيهات للويتر والمطبخ عن الطلبات والنداءات عند تفعيلها.', en: 'Waiter and kitchen alerts for orders and calls when enabled.' } },
  { icon: 'PanelsTopLeft', title: { ar: 'يعمل على أجهزتك', en: 'Works Across Devices' }, text: { ar: 'تجربة ملائمة للهاتف والتابلت واللابتوب والكمبيوتر.', en: 'Designed for phones, tablets, laptops, and desktops.' } },
  { icon: 'WifiOff', title: { ar: 'تصفح عند ضعف الاتصال', en: 'Connection-Aware Menu' }, text: { ar: 'يمكن عرض بيانات المنيو المخزنة مؤقتاً عند انقطاع مؤقت للاتصال.', en: 'Cached menu information can remain available during a temporary outage.' } },
];

export type Screenshot = { id: string; group: 'customer' | 'manager' | 'waiter' | 'kitchen'; title: Bilingual; description: Bilingual; dimensions: string; src?: string; device: 'phone' | 'desktop' | 'tablet' };
const capturedDescriptions: Record<string, Bilingual> = {
  'manager-menu-management': { ar: 'لقطة حقيقية من لوحة المالك تُظهر تنظيم الأطباق والأقسام وصورها وأسعارها.', en: 'A real owner view of dishes, categories, photos, and prices.' },
  'waiter-overview': { ar: 'لوحة الخدمة الحقيقية تعرض ملخص الطلبات الجديدة والنداءات وأدوات التنبيه.', en: 'The real service dashboard shows new orders, table calls, and alert controls.' },
  'waiter-calls': { ar: 'تصل طلبات المساعدة من الطاولات إلى مساحة الويتر مع نوع النداء وحالته.', en: 'Table assistance requests reach the waiter with their type and status.' },
  'waiter-create-order': { ar: 'يستطيع الويتر اختيار الأطباق وتسجيل طلب باسم الضيف ورقم الطاولة.', en: 'Waiters can select dishes and record an order with guest and table details.' },
  'kitchen-overview': { ar: 'واجهة المطبخ الحقيقية تلخّص الطلبات قيد التحضير والجاهزة للتقديم.', en: 'The real kitchen view summarizes preparing and ready-to-serve orders.' },
};
const screen = (group: Screenshot['group'], id: string, ar: string, en: string, device: Screenshot['device'], dimensions: string): Screenshot => {
  const key = `${group}-${id}`;
  return { id, group, title: { ar, en }, description: capturedDescriptions[key] ?? { ar: `لقطة مطلوبة من واجهة ${ar} الحقيقية، ببيانات عرض غير شخصية.`, en: `Capture the real ${en.toLowerCase()} screen with non-personal demo data.` }, device, dimensions, src: marketingConfig.screenshotSources[key] };
};
export const screenshots: Screenshot[] = [
  screen('customer','qr-entry','فتح المنيو عبر QR','QR entry','phone','390 × 844'),
  screen('customer','menu-ar','المنيو العربي','Arabic digital menu','phone','390 × 844'),
  screen('customer','menu-en','المنيو الإنجليزي','English digital menu','phone','390 × 844'),
  screen('customer','categories','أقسام المنيو','Menu categories','phone','390 × 844'),
  screen('customer','search','البحث عن طبق','Dish search','phone','390 × 844'),
  screen('customer','food-cards','صور الأطباق والأسعار','Food cards and prices','phone','390 × 844'),
  screen('customer','customization','تخصيص الطبق','Dish customization','phone','390 × 844'),
  screen('customer','cart','سلة الطلب','Shopping cart','phone','390 × 844'),
  screen('customer','guest-details','اسم الزبون ورقم الطاولة','Guest and table details','phone','390 × 844'),
  screen('customer','notes','ملاحظات المطبخ','Kitchen notes','phone','390 × 844'),
  screen('customer','confirmation','تأكيد الطلب','Order confirmation','phone','390 × 844'),
  screen('customer','tracking','متابعة الطلب','Live order tracking','phone','390 × 844'),
  screen('customer','call-waiter','استدعاء الويتر','Call waiter','phone','390 × 844'),
  screen('customer','ai-assistant','مساعد المنيو الذكي','AI menu assistant','phone','390 × 844'),
  screen('manager','overview','لوحة المالك','Owner dashboard','desktop','1440 × 900'),
  screen('manager','daily-sales','مبيعات اليوم','Daily sales','desktop','1440 × 900'),
  screen('manager','monthly-revenue','إيرادات الشهر','Monthly revenue','desktop','1440 × 900'),
  screen('manager','recent-orders','الطلبات الأخيرة','Recent orders','desktop','1440 × 900'),
  screen('manager','order-board','لوحة الطلبات المباشرة','Live order board','desktop','1440 × 900'),
  screen('manager','order-status','حالات الطلبات','Order status columns','desktop','1440 × 900'),
  screen('manager','history','سجل الطلبات والبحث','Order history and search','desktop','1440 × 900'),
  screen('manager','menu-management','إدارة المنيو','Menu management','desktop','1440 × 900'),
  screen('manager','categories-management','إدارة الأقسام','Category management','desktop','1440 × 900'),
  screen('manager','dish-editor','إنشاء وتعديل طبق','Dish editor','desktop','1440 × 900'),
  screen('manager','food-photos','صور الأطباق','Food photo management','desktop','1440 × 900'),
  screen('manager','staff','إدارة الموظفين','Staff management','desktop','1440 × 900'),
  screen('manager','location','إعدادات الموقع','Restaurant location settings','desktop','1440 × 900'),
  screen('manager','gps','التحقق من GPS','GPS verification settings','desktop','1440 × 900'),
  screen('manager','branding','هوية المطعم والثيم','Branding and theme','desktop','1440 × 900'),
  screen('waiter','overview','واجهة الويتر','Waiter dashboard','tablet','1280 × 800'),
  screen('waiter','new-orders','طلبات الطاولات الجديدة','New table orders','tablet','1024 × 768'),
  screen('waiter','ready','طلبات جاهزة للتقديم','Ready-to-serve orders','tablet','1024 × 768'),
  screen('waiter','calls','نداءات الطاولات','Table calls','tablet','1280 × 800'),
  screen('waiter','bill','طلبات الحساب','Bill requests','tablet','1024 × 768'),
  screen('waiter','assistance','طلبات المساعدة','Assistance requests','tablet','1024 × 768'),
  screen('waiter','notifications','إعدادات الإشعارات','Notification controls','tablet','1024 × 768'),
  screen('waiter','create-order','إنشاء طلب للطاولة','Waiter-created order','tablet','1280 × 800'),
  screen('kitchen','overview','واجهة المطبخ','Kitchen dashboard','tablet','1280 × 600'),
  screen('kitchen','preparing','طلبات قيد التحضير','Preparing orders','tablet','1024 × 768'),
  screen('kitchen','ready','طلبات جاهزة','Ready orders','tablet','1024 × 768'),
  screen('kitchen','order-detail','الطاولة والزبون والكميات','Table, guest, and quantities','tablet','1024 × 768'),
  screen('kitchen','instructions','تعليمات التحضير','Kitchen instructions','tablet','1024 × 768'),
  screen('kitchen','status-controls','تحديث حالة الطلب','Order status controls','tablet','1024 × 768'),
  screen('kitchen','notifications','تنبيهات المطبخ','Kitchen notification controls','tablet','1024 × 768'),
];

export const faqs: { q: Bilingual; a: Bilingual }[] = [
  { q: { ar: 'هل يحتاج الزبون إلى تحميل تطبيق؟', en: 'Do customers need to install an app?' }, a: { ar: 'لا. يفتح المنيو في متصفح الهاتف عند مسح رمز QR.', en: 'No. Scanning the QR code opens the menu in the phone browser.' } },
  { q: { ar: 'كيف يعمل منيو QR؟', en: 'How does the QR menu work?' }, a: { ar: 'يُنشئ المطعم رمزاً يرتبط بمنيوه، ويضعه على الطاولة ليفتحه الضيف بهاتفه.', en: 'The restaurant creates a QR code linked to its menu and places it on the table for guests to scan.' } },
  { q: { ar: 'هل يمكن الطلب مباشرة من الطاولة؟', en: 'Can guests order from the table?' }, a: { ar: 'نعم. يختار الضيف الأطباق والكميات والخيارات، ويضيف ملاحظات ورقم الطاولة ثم يرسل الطلب.', en: 'Yes. Guests choose dishes, quantities, options, notes, and a table number before submitting.' } },
  { q: { ar: 'هل يمكن متابعة الطلب؟', en: 'Can guests track an order?' }, a: { ar: 'نعم، تظهر حالة الاستلام والتحضير والجاهزية والتقديم.', en: 'Yes. The menu shows received, preparing, ready, and served stages.' } },
  { q: { ar: 'هل يمكن استدعاء الويتر؟', en: 'Can guests call a waiter?' }, a: { ar: 'نعم، يستطيع الضيف طلب الويتر أو الحساب أو المساعدة أو إضافة طلب.', en: 'Yes. Guests can request a waiter, the bill, assistance, or additional items.' } },
  { q: { ar: 'هل يمكن تغيير الأطباق والأسعار؟', en: 'Can restaurants update dishes and prices?' }, a: { ar: 'نعم، تتضمن لوحة المطعم أدوات لإدارة الأطباق والأقسام والأسعار والصور والتوفر.', en: 'Yes. The restaurant workspace manages dishes, categories, prices, photos, and availability.' } },
  { q: { ar: 'هل يدعم الصور والأقسام؟', en: 'Does it support images and categories?' }, a: { ar: 'نعم، يمكن عرض صور الأطباق وتنظيمها ضمن أقسام.', en: 'Yes. Dishes can have images and be organized into categories.' } },
  { q: { ar: 'هل يدعم العربية والإنجليزية؟', en: 'Does it support Arabic and English?' }, a: { ar: 'نعم، تتوفر واجهات الضيف والفريق باللغتين.', en: 'Yes. Guest and team interfaces support both languages.' } },
  { q: { ar: 'هل تصل تنبيهات للفريق؟', en: 'Can staff receive notifications?' }, a: { ar: 'تتوفر تنبيهات للويتر والمطبخ بعد تفعيلها ومنح المتصفح الإذن اللازم.', en: 'Waiter and kitchen notifications are available once enabled and browser permission is granted.' } },
  { q: { ar: 'هل يمكن تخصيص الشعار والألوان؟', en: 'Can a restaurant customize its branding?' }, a: { ar: 'نعم، يمكن ضبط الشعار والألوان وثيم المنيو.', en: 'Yes. The restaurant can set its logo, colors, and menu theme.' } },
  { q: { ar: 'هل يعمل على الهاتف والتابلت؟', en: 'Does it work on phones and tablets?' }, a: { ar: 'نعم، صُممت الواجهات للمتصفح على الهاتف والتابلت والكمبيوتر.', en: 'Yes. The browser interfaces are designed for phones, tablets, and computers.' } },
  { q: { ar: 'هل يدعم عدة حسابات للموظفين؟', en: 'Can multiple staff use ORDOVA?' }, a: { ar: 'نعم، يمكن إدارة حسابات موظفي الصالة والمطبخ من لوحة المطعم.', en: 'Yes. Restaurant managers can manage waiter and kitchen staff accounts.' } },
  { q: { ar: 'كيف يعمل التحقق من الموقع؟', en: 'How does location verification work?' }, a: { ar: 'يمكن تفعيل نطاق جغرافي اختياري حول المطعم. عندما يكون مفعلاً، يطلب النظام إذن الموقع للتحقق من قرب الضيف.', en: 'An optional radius can be set around the restaurant. When enabled, the system asks for location permission to check proximity.' } },
  { q: { ar: 'كيف أطلب عرضاً تجريبياً؟', en: 'How can I request a demonstration?' }, a: { ar: 'املأ النموذج أدناه، ثم أرسل الرسالة الجاهزة عبر واتساب إلى فريق أوردوفا.', en: 'Complete the form below, then send the prepared WhatsApp message to the ORDOVA team.' } },
];
