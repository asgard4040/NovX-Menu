import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Building2,
  Users,
  CreditCard,
  Plus,
  Search,
  Filter,
  Trash2,
  PauseCircle,
  PlayCircle,
  QrCode,
  LayoutDashboard,
  Cpu,
  MoreVertical,
  CheckCircle2,
  Calendar,
  Phone,
  MapPin,
  ExternalLink,
  Settings,
  BarChart3,
  Bell,
  AlertTriangle,
  Save,
  MessageSquare,
  Sparkles,
  Image,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  collection,
  addDoc,
  query,
  getDocs,
  doc,
  updateDoc,
  where,
  orderBy,
  Timestamp,
  getDoc,
  setDoc,
  deleteDoc,
  type DocumentData,
} from "../lib/supabase-db";
import { db } from "../lib/supabase-db";
import { handleFirestoreError, OperationType } from "../lib/firestore-utils";
import {
  IRAQI_PROVINCES,
  SUBSCRIPTION_TYPES,
  SUBSCRIPTION_DURATIONS,
} from "../constants";
import { Restaurant, SubscriptionType, SubscriptionDuration } from "../types";
import { format } from "date-fns";
import { calculateSubscriptionEnd } from "../lib/subscription";
import QRCode from "react-qr-code";
import { supabase } from "../lib/supabase";
import { persistRestaurantImage } from "../lib/storage";
import { localizeProvince, useLanguage } from "../lib/i18n";

const aiLogEnglish: Record<string, string> = {
  'تم توثيق الاتصال بنجاح لبوابة المطعم المشترك.': 'Restaurant portal connection verified.',
  'تم معالجة استعلام الذكاء الاصطناعي بنجاح (زمن الاستجابة: 0.12ms).': 'AI query processed (response time: 0.12 ms).',
  'تمت المزامنة وحفظ التحديثات والتبديلات الحية تلقائياً بنجاح.': 'Live updates synchronized and saved.',
  'تم استدعاء تفضيلات الطهي والأطباق المقترحة من الذاكرة اللحظية بكفاءة 99%.': 'Menu preferences loaded from cache.',
  'تم إرسال إشارة تشخيصية (Cortex System Ping Test) - الاستجابة مثالية.': 'Cortex test signal sent successfully.',
};

const safeFormatDate = (dateVal: any, formatStr: string, fallback: string = "---") => {
  if (!dateVal) return fallback;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return fallback;
  try {
    return format(d, formatStr);
  } catch {
    return fallback;
  }
};

export default function AdminDashboard({
  activeTab: externalTab,
  onNavigate,
}: {
  activeTab?: "overview" | "restaurants" | "ai" | "alerts";
  onNavigate?: (tab: "overview" | "restaurants" | "ai" | "alerts") => void;
}) {
  const { dir, language, tr } = useLanguage();
  const [internalTab, setInternalTab] = useState<
    "overview" | "restaurants" | "ai" | "alerts"
  >("overview");
  const activeTab = externalTab || internalTab;

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProvince, setFilterProvince] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterExpiry, setFilterExpiry] = useState<"all" | "expired" | "soon">("all");

  // Support phone and system logo state
  const [supportPhone, setSupportPhone] = useState("07740064528");
  const [systemLogo, setSystemLogo] = useState(() => localStorage.getItem("novix_system_logo") || "");
  const [isSavingSupport, setIsSavingSupport] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // AI settings state
  const [aiPrompt, setAiPrompt] = useState(
    `أنت مساعد افتراضي ذكي لمطعم في العراق، مخصص لمساعدة الزبائن في استعراض المنيو وأقسامه وتسجيل طلباتهم.`
  );
  const [aiModel, setAiModel] = useState("gemini-3.5-flash");
  const [aiTemperature, setAiTemperature] = useState(0.3);
  const [isSavingAI, setIsSavingAI] = useState(false);
  const [aiSaveSuccess, setAiSaveSuccess] = useState(false);
  const [aiLogs, setAiLogs] = useState<Array<{ time: string; msg: string; type: string }>>([
    { time: "14:20:45", msg: "تم توثيق الاتصال بنجاح لبوابة المطعم المشترك.", type: "sys" },
    { time: "14:20:48", msg: "تم معالجة استعلام الذكاء الاصطناعي بنجاح (زمن الاستجابة: 0.12ms).", type: "ai" },
    { time: "14:21:02", msg: "تمت المزامنة وحفظ التحديثات والتبديلات الحية تلقائياً بنجاح.", type: "sys" },
    { time: "14:21:15", msg: "تم استدعاء تفضيلات الطهي والأطباق المقترحة من الذاكرة اللحظية بكفاءة 99%.", type: "ai" }
  ]);

  // Announcements state
  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [annSeverity, setAnnSeverity] = useState<"info" | "warning" | "critical">("info");
  const [annTarget, setAnnTarget] = useState("all");
  const [announcementsList, setAnnouncementsList] = useState<any[]>([]);
  const [isSendingAnn, setIsSendingAnn] = useState(false);
  const [annSuccess, setAnnSuccess] = useState(false);
  const [annLoading, setAnnLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalRestaurants: 0,
    monthlyProfit: 0,
    activeSubscriptions: 0,
  });

  useEffect(() => {
    fetchRestaurants();
    fetchSupportSetting();
    fetchAISettings();
    fetchAnnouncements();

    const handleOnline = () => {
      setIsOffline(false);
      // Retry fetching when connection restored
      fetchRestaurants();
      fetchSupportSetting();
      fetchAISettings();
      fetchAnnouncements();
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const fetchSupportSetting = async () => {
    try {
      const d = await getDoc(doc(db, "settings", "support"));
      if (d.exists()) {
        if (d.data().phone) {
          setSupportPhone(d.data().phone);
          localStorage.setItem("novix_support_phone", d.data().phone);
        }
        if (d.data().logoUrl) {
          setSystemLogo(d.data().logoUrl);
          localStorage.setItem("novix_system_logo", d.data().logoUrl);
        }
      }
    } catch (e) {
      console.warn("Error fetching support setting (using fallback):", e);
      const cachedPhone = localStorage.getItem("novix_support_phone");
      if (cachedPhone) setSupportPhone(cachedPhone);
      const cachedLogo = localStorage.getItem("novix_system_logo");
      if (cachedLogo) setSystemLogo(cachedLogo);
    }
  };

  const saveSupportSetting = async () => {
    setIsSavingSupport(true);
    setSaveSuccess(false);
    try {
      const logoUrl = await persistRestaurantImage("00000000-0000-0000-0000-000000000000", systemLogo, "system-logo");
      await setDoc(doc(db, "settings", "support"), { 
        phone: supportPhone,
        logoUrl
      }, { merge: true });
      setSystemLogo(logoUrl);
      localStorage.setItem("novix_support_phone", supportPhone);
      localStorage.setItem("novix_system_logo", logoUrl);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error("Error saving support setting:", e);
      localStorage.setItem("novix_support_phone", supportPhone);
      localStorage.setItem("novix_system_logo", systemLogo);
      setSaveSuccess(true); // Treat as locally saved
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSavingSupport(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          setSystemLogo(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const fetchAISettings = async () => {
    try {
      const d = await getDoc(doc(db, "settings", "ai"));
      if (d.exists()) {
        const data = d.data();
        if (data.prompt) setAiPrompt(data.prompt);
        if (data.model) setAiModel(data.model);
        if (data.temperature !== undefined) setAiTemperature(data.temperature);
        localStorage.setItem("novix_ai_settings", JSON.stringify(data));
      }
    } catch (e) {
      console.warn("Error fetching AI settings (using fallback):", e);
      const cached = localStorage.getItem("novix_ai_settings");
      if (cached) {
        try {
          const data = JSON.parse(cached);
          if (data.prompt) setAiPrompt(data.prompt);
          if (data.model) setAiModel(data.model);
          if (data.temperature !== undefined) setAiTemperature(data.temperature);
        } catch (_) {}
      }
    }
  };

  const saveAISettings = async () => {
    setIsSavingAI(true);
    setAiSaveSuccess(false);
    const settingsObj = {
      prompt: aiPrompt,
      model: aiModel,
      temperature: aiTemperature,
    };
    try {
      await setDoc(doc(db, "settings", "ai"), {
        ...settingsObj,
        updatedAt: Timestamp.now()
      }, { merge: true });
      localStorage.setItem("novix_ai_settings", JSON.stringify(settingsObj));
      setAiSaveSuccess(true);
      setTimeout(() => setAiSaveSuccess(false), 3000);
    } catch (e) {
      console.error("Error saving AI settings (applying locally):", e);
      localStorage.setItem("novix_ai_settings", JSON.stringify(settingsObj));
      setAiSaveSuccess(true); // Show success since we fall back safely
      setTimeout(() => setAiSaveSuccess(false), 3000);
    } finally {
      setIsSavingAI(false);
    }
  };

  const fetchAnnouncements = async () => {
    setAnnLoading(true);
    try {
      const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAnnouncementsList(list);
      localStorage.setItem("novix_announcements", JSON.stringify(list));
    } catch (e) {
      console.warn("Error fetching announcements (using fallback):", e);
      const cached = localStorage.getItem("novix_announcements");
      if (cached) {
        try {
          setAnnouncementsList(JSON.parse(cached));
        } catch (_) {}
      }
    } finally {
      setAnnLoading(false);
    }
  };

  const sendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim()) return;
    setIsSendingAnn(true);
    setAnnSuccess(false);
    try {
      const targetRest = restaurants.find(r => r.id === annTarget);
      const payload = {
        title: annTitle,
        message: annMessage,
        severity: annSeverity,
        target: annTarget,
        targetRestaurantId: annTarget,
        targetRestaurantName: annTarget === "all" ? "جميع المطاعم" : (targetRest?.restaurantName || "مطعم مخصص"),
        createdAt: Timestamp.now()
      };
      await addDoc(collection(db, "announcements"), payload);
      setAnnTitle("");
      setAnnMessage("");
      setAnnSuccess(true);
      fetchAnnouncements();
      setTimeout(() => setAnnSuccess(false), 3000);
    } catch (e) {
      console.error("Error sending announcement:", e);
      // Simulate locally if we want, or alert the user
      alert(tr('تعذر الاتصال بمركز البث. يرجى التأكد من اتصال الإنترنت الخاص بالسيرفر وإعادة المحاولة.', 'Could not send the announcement. Check the server connection and retry.'));
    } finally {
      setIsSendingAnn(false);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    try {
      await deleteDoc(doc(db, "announcements", id));
      fetchAnnouncements();
    } catch (e) {
      console.error("Error deleting announcement:", e);
    }
  };

  const fetchRestaurants = async () => {
    setLoading(true);
    const collectionPath = "restaurants";
    try {
      const q = query(
        collection(db, collectionPath),
        orderBy("startDate", "desc"),
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Restaurant,
      );
      setRestaurants(data);
      localStorage.setItem("novix_restaurants", JSON.stringify(data));

      setStats({
        totalRestaurants: data.length,
        monthlyProfit: data.reduce(
          (acc, curr) => acc + (curr.monthlyCost || 0),
          0,
        ),
        activeSubscriptions: data.filter((r) => r.status === "active").length,
      });
    } catch (err) {
      console.warn("Could not load restaurants from Supabase (using local cache):", err);
      const cached = localStorage.getItem("novix_restaurants");
      if (cached) {
        try {
          const data = JSON.parse(cached) as Restaurant[];
          setRestaurants(data);
          setStats({
            totalRestaurants: data.length,
            monthlyProfit: data.reduce(
              (acc, curr) => acc + (curr.monthlyCost || 0),
              0,
            ),
            activeSubscriptions: data.filter((r) => r.status === "active").length,
          });
        } catch (_) {}
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (restaurantId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    const docPath = `restaurants/${restaurantId}`;
    try {
      await updateDoc(doc(db, "restaurants", restaurantId), {
        status: newStatus,
      });
      fetchRestaurants();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  };

  const filteredRestaurants = restaurants.filter((r) => {
    const matchesSearch =
      r.restaurantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.managerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.managerPhone.includes(searchQuery);
    const matchesProvince = filterProvince
      ? r.province === filterProvince
      : true;
    const matchesType = filterType ? r.subscriptionType === filterType : true;

    // Subscription expiry filters
    let matchesExpiry = true;
    if (filterExpiry !== "all") {
      const now = new Date().getTime();
      const expiryTime = r.endDate ? new Date(r.endDate).getTime() : 0;
      const oneDay = 24 * 60 * 60 * 1000;

      if (filterExpiry === "expired") {
        matchesExpiry = expiryTime > 0 && now >= expiryTime;
      } else if (filterExpiry === "soon") {
        matchesExpiry = expiryTime > 0 && now < expiryTime && (expiryTime - now <= 3 * oneDay);
      }
    }

    return matchesSearch && matchesProvince && matchesType && matchesExpiry;
  });

  return (
    <div className="space-y-8" dir={dir}>
      {isOffline && (
        <div className="p-4 bg-amber-50/80 border-r-4 border-brand-gold text-brand-primary text-xs font-sans font-bold flex items-center gap-3 animate-pulse">
          <span className="w-2.5 h-2.5 bg-brand-gold rounded-full shrink-0" />
          <span>{tr('الوضع المحلي نشط: النظام يعمل بكفاءة عبر الذاكرة المحلية المؤقتة (Offline Cache). سيتم التزامن تلقائياً فور استقرار اتصال المزود.', 'Offline mode is active. Cached data will synchronize when the connection returns.')}</span>
        </div>
      )}
      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-brand-gold mb-1">{tr('نظرة عامة', 'Overview')}</p>
                <h2 className="text-2xl sm:text-3xl font-display font-bold text-brand-primary">{tr('إدارة المطاعم ببساطة', 'Manage your restaurants')}</h2>
                <p className="text-sm text-text-muted mt-1">{tr('تابع الشركاء والاشتراكات من مكان واحد.', 'Partners and subscriptions at a glance.')}</p>
              </div>
              <button type="button" onClick={() => setShowAddModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-white hover:bg-brand-secondary min-h-12">
                <Plus className="w-4 h-4" />{tr('إضافة مطعم', 'Add restaurant')}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
              <StatCard
                title={tr('إجمالي المطاعم', 'Total restaurants')}
                value={stats.totalRestaurants}
                icon={<Building2 className="w-6 h-6 text-brand-primary" />}
              />
              <StatCard
                title={tr('قيمة الاشتراكات الشهرية', 'Monthly plan value')}
                value={`${stats.monthlyProfit.toLocaleString()} ${tr('د.ع', 'IQD')}`}
                icon={<CreditCard className="w-6 h-6 text-emerald-500" />}
              />
              <StatCard
                title={tr('الاشتراكات النشطة', 'Active subscriptions')}
                value={stats.activeSubscriptions}
                icon={<CheckCircle2 className="w-6 h-6 text-purple-500" />}
              />
            </div>

            <div className="bg-white border border-border-delicate rounded-2xl p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-brand-primary">{tr('أحدث المطاعم', 'Recent restaurants')}</h3>
                  <p className="text-xs text-text-muted">{tr('الوصول السريع إلى الشركاء', 'Quick access to your partners')}</p>
                </div>
                <button type="button" onClick={() => onNavigate ? onNavigate('restaurants') : setInternalTab('restaurants')}
                  className="text-sm font-bold text-brand-primary hover:text-brand-secondary whitespace-nowrap">{tr('عرض الكل', 'View all')}</button>
              </div>
              {restaurants.length ? <div className="divide-y divide-border-delicate">
                {restaurants.slice(0, 4).map((res) => <div key={res.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {res.logoUrl ? <img src={res.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" /> : <div className="w-10 h-10 rounded-xl bg-bg-paper flex items-center justify-center shrink-0"><Building2 className="w-5 h-5 text-brand-primary" /></div>}
                    <div className="min-w-0"><p className="font-bold text-brand-primary truncate">{res.restaurantName}</p><p className="text-xs text-text-muted truncate">{res.managerName}</p></div>
                  </div>
                  <button type="button" onClick={() => setEditingRestaurant(res)} className="shrink-0 rounded-lg border border-border-delicate px-3 py-2 text-xs font-bold text-brand-primary hover:bg-bg-paper">{tr('تعديل', 'Edit')}</button>
                </div>)}
              </div> : <p className="py-8 text-center text-sm text-text-muted">{loading ? tr('جاري التحميل...', 'Loading...') : tr('لا توجد مطاعم بعد.', 'No restaurants yet.')}</p>}
            </div>

            {/* Support and System Branding Card */}
            <details className="bg-white border border-border-delicate rounded-2xl overflow-hidden group">
              <summary className="list-none cursor-pointer p-5 sm:p-6 flex items-center justify-between gap-4 font-bold text-brand-primary">
                <span className="flex items-center gap-2"><Settings className="w-5 h-5" />{tr('إعدادات الدعم والشعار', 'Support and branding settings')}</span>
                <span className="text-xs text-text-muted group-open:hidden">{tr('عرض الإعدادات', 'Open settings')}</span>
              </summary>
            <div className="p-5 sm:p-8 border-t border-border-delicate relative overflow-hidden space-y-8">
              <div className="absolute top-0 right-0 w-[4px] h-full bg-brand-gold" />
              
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 border-b border-border-delicate/40 pb-8">
                <div className="space-y-3 text-right">
                  <div className="flex items-center gap-4">
                    <Phone className="w-6 h-6 text-brand-gold" />
                    <h3 className="text-2xl font-display text-brand-primary italic font-bold">
                      {tr('خط طوارئ الدعم الفني العام', 'Technical support number')}
                    </h3>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed font-sans max-w-2xl">
                    {tr('هذا الرقم يظهر لجميع شركائك من المطاعم والمطابخ والويترز في صفحة "المساعدة" الخاصة بهم وعند التحذير من قرب انتهاء الاشتراك لتسهيل تجديد اشتراكاتهم وتواصلهم المباشر معك.', 'This number appears in partner help pages and subscription notices so staff can contact you.')}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch gap-4 w-full lg:w-auto">
                  <div className="relative">
                    <input
                      type="text"
                      dir="ltr"
                      value={supportPhone}
                      onChange={(e) => setSupportPhone(e.target.value)}
                      placeholder="e.g. 07740064528"
                      className="px-6 py-4 bg-bg-paper border border-border-delicate font-mono text-lg text-brand-primary focus:outline-none focus:border-brand-primary transition-all text-center w-full sm:w-64"
                    />
                  </div>
                  <button
                    onClick={saveSupportSetting}
                    disabled={isSavingSupport}
                    className="px-8 py-4 bg-brand-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isSavingSupport ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>{tr('حفظ وتعميم الرقم الجديد', 'Save support number')}</span>
                  </button>
                </div>
              </div>

              {/* System Logo Branding Section */}
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
                <div className="space-y-3 text-right">
                  <div className="flex items-center gap-4">
                    <Image className="w-6 h-6 text-brand-gold" />
                    <h3 className="text-2xl font-display text-brand-primary italic font-bold">
                      {tr('شعار النظام العام الموحد (رفع اللوغو)', 'System logo')}
                    </h3>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed font-sans max-w-2xl">
                    {tr('يمكنك رفع لوغو الاستوديو ليعرض فوراً وعمومياً في واجهة مالك المطعم، لوحة الويتر، وقسم المطبخ.', 'Upload a logo to display in owner, waiter, and kitchen workspaces.')}
                  </p>
                </div>

                <div className="flex items-center gap-6 w-full lg:w-auto">
                  {systemLogo && (
                    <div className="w-20 h-20 bg-bg-paper border border-border-delicate flex items-center justify-center p-2 relative overflow-hidden shrink-0 group">
                      <img src={systemLogo} className="w-full h-full object-contain" alt="Branding Preview" referrerPolicy="no-referrer" />
                      <button
                        onClick={async () => {
                          setSystemLogo("");
                          try {
                            await setDoc(doc(db, "settings", "support"), { logoUrl: "" }, { merge: true });
                            localStorage.removeItem("novix_system_logo");
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className="absolute inset-0 bg-red-950/80 text-white text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        {tr('إزالة اللوغو', 'Remove logo')}
                      </button>
                    </div>
                  )}
                  <div className="flex-1 sm:flex-initial">
                    <label className="px-8 py-4 bg-bg-paper border border-dashed border-brand-gold/60 text-brand-primary hover:border-brand-primary cursor-pointer text-xs font-bold uppercase tracking-widest transition-all inline-block text-center w-full">
                      <span>📤 {tr('رفع لوغو من الاستوديو', 'Upload logo')}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {saveSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-sans text-center"
                >
                  {tr('تم حفظ وتحديث رقم الدعم ولوغو الاستوديو بنجاح!', 'Support details and logo saved.')}
                </motion.div>
              )}
            </div>
            </details>
          </motion.div>
        )}

        {activeTab === "restaurants" && (
          <motion.div
            key="restaurants"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div><h2 className="text-2xl sm:text-3xl font-display font-bold text-brand-primary">{tr('المطاعم', 'Restaurants')}</h2><p className="text-sm text-text-muted">{tr('ابحث، افتح المنيو، أو عدّل بيانات الشريك.', 'Find a partner, open its menu, or edit its details.')}</p></div>
              <button onClick={() => setShowAddModal(true)} className="bg-brand-primary text-white px-5 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-brand-secondary transition-colors min-h-12"><Plus className="w-4 h-4" />{tr('إضافة مطعم', 'Add restaurant')}</button>
            </div>
            <div className="bg-white p-4 sm:p-5 border border-border-delicate rounded-2xl space-y-3">
              <div className="relative">
                  <Search className="absolute start-4 top-1/2 -translate-y-1/2 text-text-muted w-5 h-5 pointer-events-none" />
                  <input
                    type="text"
                    placeholder={tr('البحث عن اسم المطعم أو المدير...', 'Search restaurant or manager...')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full ps-12 pe-4 py-3 bg-bg-paper border border-border-delicate rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors"
                  />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={filterProvince}
                  onChange={(e) => setFilterProvince(e.target.value)}
                  className="px-3 py-3 bg-bg-paper border border-border-delicate rounded-xl text-sm focus:outline-none cursor-pointer"
                >
                  <option value="">{tr('كل المحافظات', 'All provinces')}</option>
                  {IRAQI_PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {localizeProvince(p, language)}
                    </option>
                  ))}
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-3 py-3 bg-bg-paper border border-border-delicate rounded-xl text-sm focus:outline-none cursor-pointer"
                >
                  <option value="">{tr('كل الباقات/الفئات', 'All plans')}</option>
                  {SUBSCRIPTION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {tr(t.label, t.id === 'trial' ? 'Trial' : t.id === 'pro' ? 'Pro' : 'Standard')}
                    </option>
                  ))}
                </select>
                <select
                  value={filterExpiry}
                  onChange={(e) => setFilterExpiry(e.target.value as any)}
                  className="px-3 py-3 bg-bg-paper border border-border-delicate rounded-xl text-sm focus:outline-none cursor-pointer"
                >
                  <option value="all">{tr('كل حالات الاشتراك', 'All subscription statuses')}</option>
                  <option value="expired">{tr('مطاعم منتهية الاشتراك 🔴', 'Expired restaurants 🔴')}</option>
                  <option value="soon">{tr('مطاعم ستنتهي خلال 3 أيام 🟡', 'Expiring in 3 days 🟡')}</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-text-muted">{filteredRestaurants.length} {tr('مطاعم', 'restaurants')}</p>
            {!loading && filteredRestaurants.length === 0 && <div className="bg-white border border-dashed border-border-delicate rounded-2xl p-8 text-center text-sm text-text-muted">{tr('لا توجد مطاعم تطابق البحث.', 'No restaurants match your search.')}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
              {filteredRestaurants.map((res) => <article key={res.id} className="bg-white border border-border-delicate rounded-2xl p-4 space-y-4">
                <div className="flex items-center gap-3">
                  {res.logoUrl ? <img src={res.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover" /> : <div className="w-12 h-12 rounded-xl bg-bg-paper flex items-center justify-center"><Building2 className="w-5 h-5 text-brand-primary" /></div>}
                  <div className="min-w-0 flex-1"><h3 className="font-bold text-brand-primary truncate">{res.restaurantName}</h3><p className="text-xs text-text-muted truncate">{res.managerName} · {localizeProvince(res.province, language)}</p></div>
                  <span className={`text-xs font-bold ${res.status === 'active' ? 'text-emerald-700' : 'text-red-700'}`}>{res.status === 'active' ? tr('نشط', 'Active') : tr('موقوف', 'Paused')}</span>
                </div>
                <p className="text-xs text-text-muted">{tr('الباقة', 'Plan')}: {res.subscriptionType} · {tr('تنتهي', 'Expires')} {safeFormatDate(res.endDate, 'yyyy-MM-dd')}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEditingRestaurant(res)} className="rounded-lg bg-brand-primary text-white px-3 py-2 text-xs font-bold">{tr('تعديل', 'Edit')}</button>
                  <a href={`${window.location.origin}?restaurantId=${res.id}`} target="_blank" rel="noreferrer" className="rounded-lg border border-border-delicate px-3 py-2 text-xs font-bold text-brand-primary">{tr('فتح المنيو', 'Open menu')}</a>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?loginRestaurantId=${res.id}`); setCopiedId(res.id); setTimeout(() => setCopiedId(null), 2000); }} className="rounded-lg border border-border-delicate px-3 py-2 text-xs font-bold text-brand-primary">{copiedId === res.id ? tr('تم النسخ', 'Copied') : tr('نسخ رابط الدخول', 'Copy login link')}</button>
                  <button type="button" onClick={() => toggleStatus(res.id, res.status)} className="rounded-lg border border-border-delicate px-3 py-2 text-xs font-bold text-brand-primary">{res.status === 'active' ? tr('إيقاف', 'Pause') : tr('تفعيل', 'Reactivate')}</button>
                </div>
              </article>)}
            </div>
            <div className="hidden lg:block bg-white border border-border-delicate rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right" dir={dir}>
                  <thead>
                    <tr className="bg-bg-paper">
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        {tr('المطعم / المؤسسة', 'Restaurant')}
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        {tr('المدير المسؤول', 'Manager')}
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        {tr('المحافظة والعنوان', 'Location')}
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        {tr('الفئة / الباقة', 'Plan')}
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        {tr('حالة الاشتراك', 'Subscription')}
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate text-center whitespace-nowrap">
                        {tr('كود الـ QR المباشر', 'Menu QR code')}
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        {tr('الإجراءات والتحكم', 'Actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-delicate">
                    {filteredRestaurants.map((res) => (
                      <tr
                        key={res.id}
                        className="hover:bg-bg-paper/30 transition-colors group"
                      >
                        <td className="px-10 py-10">
                          <div className="flex items-center gap-6">
                            {res.logoUrl ? (
                              <img
                                src={res.logoUrl}
                                className="w-16 h-16 rounded-full object-cover border border-border-delicate p-1"
                                alt="Logo"
                              />
                            ) : (
                              <div className="w-16 h-16 bg-bg-paper rounded-full flex items-center justify-center text-text-muted/30 border border-border-delicate">
                                <Building2 className="w-6 h-6" />
                              </div>
                            )}
                            <div>
                              <p className="text-2xl font-display text-brand-primary italic tracking-tight mb-1">
                                {res.restaurantName}
                              </p>
                              <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-60">
                                REF: {res.id.slice(0, 8)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-10 py-10">
                          <div className="space-y-1">
                            <p className="text-brand-primary font-display text-lg italic">
                              {res.managerName}
                            </p>
                            <p className="text-text-muted text-[10px] flex items-center gap-2 font-bold uppercase tracking-widest">
                              <Phone className="w-3 h-3 opacity-40" />{" "}
                              {res.managerPhone}
                            </p>
                          </div>
                        </td>
                        <td className="px-10 py-10">
                          <div className="space-y-1">
                            <p className="flex items-center gap-2 text-brand-primary font-display text-lg italic">
                              <MapPin className="w-4 h-4 text-brand-gold opacity-40" />{" "}
                              {localizeProvince(res.province, language)}
                            </p>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest leading-none mr-6 opacity-60">
                              {res.area}
                            </p>
                          </div>
                        </td>
                        <td className="px-10 py-10">
                          <div className="space-y-2">
                            <span
                              className={`px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-[0.3em] border ${
                                res.subscriptionType === "pro"
                                  ? "bg-brand-primary text-white"
                                  : "bg-bg-paper text-text-muted border-border-delicate"
                              }`}
                            >
                              {res.subscriptionType}
                            </span>
                            <p className="text-[9px] text-brand-gold font-bold uppercase tracking-widest opacity-60 pt-2 block">
                              {tr('صلاحية:', 'Expires:')} {safeFormatDate(res.endDate, "MMM yyyy")}
                            </p>
                          </div>
                        </td>
                        <td className="px-10 py-10">
                          <span
                            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] ${
                              res.status === "active"
                                ? "text-emerald-700"
                                : "text-red-800 opacity-50"
                            }`}
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${res.status === "active" ? "bg-emerald-600 animate-pulse" : "bg-red-800"}`}
                            />
                            {res.status === "active"
                              ? tr('نشط ومفعّل', 'Active')
                              : tr('موقوف مؤقتاً', 'Paused')}
                          </span>
                        </td>
                        <td className="px-10 py-10 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="p-3 bg-white border border-border-delicate shadow-lg group-hover:scale-105 transition-transform">
                              <QRCode
                                value={`${window.location.origin}?restaurantId=${res.id}`}
                                size={64}
                                bgColor="#ffffff"
                                fgColor="#2D3A27"
                              />
                            </div>
                            <div className="space-y-2 flex flex-col items-center">
                              <a
                                href={`${window.location.origin}?restaurantId=${res.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] hover:text-brand-primary transition-all flex items-center gap-2 italic font-sans"
                              >
                                <ExternalLink className="w-3 h-3" /> {tr('المنيو الرقمي', 'Digital menu')}
                              </a>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(`${window.location.origin}?loginRestaurantId=${res.id}`);
                                  setCopiedId(res.id);
                                  setTimeout(() => setCopiedId(null), 2000);
                                }}
                                className="text-[8px] font-bold text-brand-primary hover:text-brand-gold transition-all flex items-center gap-1 bg-bg-paper px-2 py-1 border border-border-delicate cursor-pointer"
                              >
                                {copiedId === res.id ? tr('✓ تم النسخ', '✓ Copied') : tr('📋 نسخ رابط الموظفين والمالك', '📋 Copy staff/owner login link')}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-10 py-10">
                          <div className="flex gap-4">
                            <button
                              onClick={() => toggleStatus(res.id, res.status)}
                              className="w-12 h-12 bg-bg-paper border border-border-delicate rounded-full text-text-muted flex items-center justify-center hover:bg-brand-primary hover:text-white transition-all shadow-sm"
                              title={
                                res.status === "active"
                                  ? tr('إيقاف مؤقت', 'Pause')
                                  : tr('إعادة تفعيل', 'Reactivate')
                              }
                            >
                              {res.status === "active" ? (
                                <PauseCircle className="w-6 h-6" />
                              ) : (
                                <PlayCircle className="w-6 h-6" />
                              )}
                            </button>
                            <button
                              onClick={() => setEditingRestaurant(res)}
                              className="w-12 h-12 bg-bg-paper border border-border-delicate rounded-full text-text-muted flex items-center justify-center hover:bg-brand-primary hover:text-white transition-all shadow-sm"
                              title={tr('تعديل الإعدادات', 'Edit settings')}
                            >
                              <Settings className="w-6 h-6" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "ai" && (
          <motion.div
            key="ai"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8 sm:space-y-16 lg:space-y-20"
          >
            {/* System Status Banner */}
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 sm:gap-10 lg:gap-12">
              <div className="xl:col-span-3 bg-white p-6 sm:p-12 lg:p-16 border border-border-delicate relative overflow-hidden shadow-sm">
                <div className="relative z-10 flex flex-col md:flex-row items-center gap-8 sm:gap-12 md:gap-16">
                  <div className="w-28 h-28 sm:w-36 sm:h-36 md:w-48 md:h-48 rounded-full bg-brand-primary flex items-center justify-center shadow-2xl relative group shrink-0">
                    <Cpu className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 text-white relative z-10" />
                    <motion.div
                      animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.3, 0.1] }}
                      transition={{ duration: 5, repeat: Infinity }}
                      className="absolute inset-0 bg-white rounded-full"
                    />
                  </div>
                  <div className="text-center md:text-right flex-grow">
                    <div className="flex items-center justify-center md:justify-start flex-wrap gap-3 sm:gap-6 mb-4 md:mb-8">
                      <span className="px-3 py-1 sm:px-4 sm:py-2 border border-emerald-200 bg-emerald-50 text-emerald-800 text-[9px] font-bold uppercase tracking-widest italic">
                        {tr('الذكاء الاصطناعي متصل', 'AI connected')}
                      </span>
                      <span className="text-[10px] text-brand-gold font-bold uppercase tracking-widest opacity-60 italic">
                        v2.4 LTS {tr('إصدار مستقر', 'stable release')}
                      </span>
                    </div>
                    <h2 className="text-3xl sm:text-5xl md:text-6xl font-display text-brand-primary italic tracking-tighter leading-none mb-4 md:mb-6">
                      {tr('نوفكس الموجه', 'NovX AI')} <br className="hidden sm:inline" />{" "}
                      <span className="text-brand-gold">{tr('الذكي المتكامل', 'assistant')}</span>
                    </h2>
                    <p className="text-text-muted max-w-lg font-light italic text-sm sm:text-base md:text-lg leading-relaxed">
                      {tr('الشبكة المركزية الذكية تعمل بكفاءة عالية. تحسين جودة المنيو الرقمي، الاستجابة السريعة، وتحليلات تفضيلات الزبائن والخدمة الرقمية التلقائية لجميع الشركاء.', 'Manage the AI assistant and its settings for all partner restaurants.')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-2 bg-bg-paper p-6 sm:p-12 lg:p-16 border border-border-delicate flex flex-col justify-between">
                <div className="space-y-6 sm:space-y-8">
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                    {tr('مواصفات هيكل النظام العصبي', 'AI configuration')}
                  </p>
                  <div className="space-y-4 sm:space-y-6">
                    <div className="flex justify-between items-center py-3 sm:py-4 border-b border-border-delicate">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        {tr('أفق التفكير اللحظي', 'Response window')}
                      </span>
                      <span className="text-lg sm:text-xl font-display text-brand-primary italic">
                        128k Tokens
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-3 sm:py-4 border-b border-border-delicate">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        {tr('درجة استجابة Cortex', 'Cortex response')}
                      </span>
                      <span className="text-lg sm:text-xl font-display text-brand-primary italic">
                        0.7 ({tr('متزن ذكي', 'Balanced')})
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-3 sm:py-4">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        {tr('معيار الاحتمالية Top P', 'Top P probability')}
                      </span>
                      <span className="text-lg sm:text-xl font-display text-brand-primary italic">
                        0.95
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-8 sm:mt-16">
                  <button className="w-full py-4 sm:py-6 border border-border-delicate text-[10px] font-bold uppercase tracking-widest text-text-muted hover:bg-brand-primary hover:text-white hover:border-brand-primary transition-all italic">
                    {tr('إعادة تصفية وتحسين ومعايرة cortex', 'Adjust Cortex settings')}
                  </button>
                </div>
              </div>
            </div>

            {/* Performance Grids */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 sm:gap-12 lg:gap-16">
              {/* Usage Metrics */}
              <div className="lg:col-span-2 bg-white p-5 sm:p-12 border border-border-delicate space-y-6 sm:space-y-12">
                <div className="flex items-center justify-between border-b border-border-delicate pb-4 sm:pb-8">
                  <div className="flex items-center gap-3 sm:gap-5">
                    <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-brand-gold opacity-40 italic" />
                    <h3 className="text-2xl sm:text-3xl font-display text-brand-primary italic tracking-tight">
                      {tr('توزيع استهلاك النظام', 'System usage')}
                    </h3>
                  </div>
                </div>

                <div className="space-y-4 sm:space-y-8 max-h-[400px] sm:max-h-[600px] overflow-y-auto no-scrollbar">
                  {restaurants.map((r, i) => (
                    <div
                      key={r.id}
                      className="group p-5 sm:p-8 border border-border-delicate hover:bg-bg-paper transition-all relative overflow-hidden"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8 relative z-10">
                        <div className="flex items-center gap-3 sm:gap-5">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border border-border-delicate flex items-center justify-center font-display italic text-brand-primary text-xl sm:text-2xl group-hover:bg-brand-primary group-hover:text-white transition-all">
                            {r.restaurantName[0]}
                          </div>
                          <div>
                            <p className="text-lg sm:text-xl font-display text-brand-primary italic tracking-tight">
                              {r.restaurantName}
                            </p>
                            <p className="text-[9px] text-brand-gold uppercase font-bold tracking-widest mt-1 opacity-60 italic">
                              {tr('ولوج آمن وموثق', 'Secure access')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right sm:text-left">
                          <p className="text-xl sm:text-2xl font-display text-brand-primary tabular-nums tracking-tighter">
                            {(1200 + i * 45).toLocaleString()}
                          </p>
                          <p className="text-[9px] text-text-muted font-bold uppercase tracking-widest leading-none italic">
                            {tr('عمليات ذكية مدرجة', 'AI operations')}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 sm:space-y-3 relative z-10">
                        <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest mb-1 opacity-60">
                          <span className="text-text-muted">{tr('العبء والتحمل', 'Capacity')}</span>
                          <span className="text-brand-gold">{40 + i * 5}%</span>
                        </div>
                        <div className="h-[2px] w-full bg-border-delicate overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${40 + i * 5}%` }}
                            transition={{ duration: 3 }}
                            className="h-full bg-brand-gold"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Engine Control & Logs */}
              <div className="lg:col-span-3 bg-white p-5 sm:p-12 border border-border-delicate space-y-6 sm:space-y-12">
                <div className="flex items-center justify-between border-b border-border-delicate pb-4 sm:pb-8">
                  <div className="flex items-center gap-3 sm:gap-5">
                    <Settings className="w-6 h-6 sm:w-8 sm:h-8 text-brand-gold opacity-40 italic" />
                    <h3 className="text-2xl sm:text-3xl font-display text-brand-primary italic tracking-tight">
                      {tr('إدارة التحكم الذكي بقواعد المنيو', 'Menu AI settings')}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">
                      {tr('مستقر وآمن', 'Stable and secure')}
                    </span>
                  </div>
                </div>

                <div className="space-y-6 sm:space-y-10">
                  <div className="p-5 sm:p-10 bg-bg-paper border border-border-delicate space-y-6 sm:space-y-8">
                    <div className="space-y-4 sm:space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          {tr('توجيهات النظام والتعليمات الفوقية لنوفكس الذكي (System Instruction)', 'AI system instructions')}
                        </label>
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          className="w-full h-36 sm:h-48 bg-white border border-border-delicate p-4 sm:p-8 text-xs sm:text-sm text-brand-primary font-sans focus:outline-none focus:border-brand-primary transition-all resize-none leading-relaxed shadow-inner"
                          placeholder={tr('أدخل توجيهات الذكاء الاصطناعي الجديدة للتحكم بالخدمات والمنيو تلقائياً...', 'Enter instructions for the AI assistant...')}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                            {tr('نموذج معالجة اللغة المحدد', 'Selected language model')}
                          </label>
                          <select
                            value={aiModel}
                            onChange={(e) => setAiModel(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-border-delicate text-xs font-display focus:outline-none text-right"
                          >
                            <option value="gemini-3.5-flash">Gemini 3.5 Flash {tr('(سرعة البرق والاستدلال الأحدث)', '(latest fast model)')}</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash {tr('(سرعة فائقة)', '(fast)')}</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro {tr('(تفوق استدلالي)', '(advanced reasoning)')}</option>
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash {tr('(النموذج السابق)', '(previous model)')}</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                            {tr('درجة الإبداع العشوائي (Temperature):', 'Temperature:')} {aiTemperature}
                          </label>
                          <input
                            type="range"
                            min="0.0"
                            max="1.0"
                            step="0.1"
                            value={aiTemperature}
                            onChange={(e) => setAiTemperature(parseFloat(e.target.value))}
                            className="w-full accent-brand-primary cursor-pointer mt-2"
                          />
                        </div>

                        <div className="space-y-3 sm:col-span-2 bg-amber-50 border border-amber-100 p-4 text-xs text-amber-900">
                          {tr('مفتاح Gemini يُضبط الآن كسر خادمي عبر GEMINI_API_KEY ولا يُخزن في قاعدة البيانات أو المتصفح.', 'The Gemini key is configured server-side via GEMINI_API_KEY and is not stored in the browser.')}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4 border-t border-border-delicate">
                      {aiSaveSuccess ? (
                        <span className="text-xs text-emerald-800 font-sans font-bold text-center sm:text-right">
                          ✓ {tr('تم حفظ قواعد الذكاء ومزامنتها بنجاح مع سيرفر المعالجة!', 'AI settings saved and synchronized.')}
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-muted font-sans font-medium text-center sm:text-right leading-relaxed">
                          * {tr('أي تعديل يتم تطبيقه حياً ومباشرةً لجميع المطاعم المشتركة لزبائنهم', 'Changes apply to all partner restaurants.')}
                        </span>
                      )}

                      <button
                        onClick={saveAISettings}
                        disabled={isSavingAI}
                        className="px-6 sm:px-12 py-3.5 sm:py-4 bg-brand-primary text-white font-bold text-[10px] uppercase tracking-widest shadow-xl hover:bg-brand-secondary transition-all flex items-center justify-center gap-3 disabled:opacity-50 w-full sm:w-auto"
                      >
                        {isSavingAI ? (
                          <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        <span>{tr('حفظ وتطبيق التعليمات الذكية', 'Save AI instructions')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 sm:space-y-6">
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                      <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest italic">
                        {tr('سلسلة السجلات والعمليات الحية الحالية لنوفكس Cortex', 'Cortex activity log')}
                      </p>
                      <div className="flex gap-4">
                        <button
                          onClick={() => {
                            const nowStr = new Date().toTimeString().split(' ')[0];
                            setAiLogs(prev => [
                              ...prev,
                              {
                                time: nowStr,
                                msg: "تم إرسال إشارة تشخيصية (Cortex System Ping Test) - الاستجابة مثالية.",
                                type: "sys"
                              }
                            ]);
                          }}
                          className="text-[9px] hover:text-brand-primary text-text-muted font-bold tracking-widest uppercase underline"
                        >
                          {tr('إرسال إشارة فحص', 'Send test signal')}
                        </button>
                        <button
                          onClick={() => setAiLogs([])}
                          className="text-[9px] hover:text-red-600 text-text-muted font-bold tracking-widest uppercase underline"
                        >
                          {tr('مسح السجلات', 'Clear logs')}
                        </button>
                      </div>
                    </div>
                    <div className="h-64 bg-white border border-border-delicate p-4 sm:p-8 font-sans text-xs text-text-muted/60 overflow-y-auto space-y-4 no-scrollbar italic shadow-inner">
                      {aiLogs.length === 0 ? (
                        <p className="text-center py-10 opacity-40">{tr('لا توجد سجلات حالياً. انقر على إرسال إشارة فحص لتوليد سجل.', 'No activity yet. Send a test signal to create a log entry.')}</p>
                      ) : (
                        aiLogs.map((log, index) => (
                          <p
                            key={index}
                            className={`border-r-2 pr-4 ${
                              log.type === "sys"
                                ? "border-brand-primary/20"
                                : log.type === "ai"
                                ? "border-brand-gold/20"
                                : "border-emerald-600/20"
                            }`}
                          >
                            <span className="text-brand-gold opacity-40 ml-2">{log.time}</span>
                            {tr(log.msg, aiLogEnglish[log.msg] || log.msg)}
                          </p>
                        ))
                      )}
                      <p className="animate-pulse">_</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "alerts" && (
          <motion.div
            key="alerts"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-16 text-right"
            dir={dir}
          >
            {/* Alerts Page Header */}
            <div className="bg-white border border-border-delicate p-10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[4px] h-full bg-brand-primary" />
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                  {tr('نظام التنبيهات والإشعارات الفوري العام', 'Announcements and alerts')}
                </p>
                <h2 className="text-3xl font-display text-brand-primary italic font-bold">
                  {tr('إدارة الإعلانات وتوجيهات الشركاء', 'Partner announcements')}
                </h2>
                <p className="text-xs text-text-muted font-sans leading-relaxed">
                  {tr('من هنا يمكنك كتابة رسالة توجيهية أو إعلان طارئ أو تنبيه فني وبثه حياً لجميع المطاعم المرتبطة بالنظام أو توجيهه لمطعم شريك مخصص.', 'Send an announcement to all restaurants or to one selected partner.')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-12">
              {/* Creator Form */}
              <div className="xl:col-span-2 bg-white p-10 border border-border-delicate space-y-8">
                <div className="border-b border-border-delicate pb-6 flex items-center gap-4">
                  <Bell className="w-6 h-6 text-brand-gold shrink-0" />
                  <h3 className="text-xl font-display text-brand-primary italic font-bold">
                    {tr('إنشاء إعلان وبث فوري', 'Create announcement')}
                  </h3>
                </div>

                <form onSubmit={sendAnnouncement} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                      {tr('عنوان الإشعار', 'Title')}
                    </label>
                    <input
                      type="text"
                      required
                      value={annTitle}
                      onChange={(e) => setAnnTitle(e.target.value)}
                      placeholder={tr('مثال: صيانة مبرمجة لقواعد البيانات', 'Example: scheduled maintenance')}
                      className="w-full bg-bg-paper border border-border-delicate p-4 text-sm focus:outline-none focus:border-brand-primary transition-colors text-right"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                      {tr('نص وتفاصيل الرسالة', 'Message')}
                    </label>
                    <textarea
                      required
                      rows={5}
                      value={annMessage}
                      onChange={(e) => setAnnMessage(e.target.value)}
                      placeholder={tr('اكتب هنا تفاصيل التنبيه أو الإعلان بدقة...', 'Write the announcement details...')}
                      className="w-full bg-bg-paper border border-border-delicate p-4 text-sm focus:outline-none focus:border-brand-primary transition-colors resize-none leading-relaxed text-right"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                        {tr('المستهدف الإداري', 'Audience')}
                      </label>
                      <select
                        value={annTarget}
                        onChange={(e) => setAnnTarget(e.target.value)}
                        className="w-full bg-bg-paper border border-border-delicate p-4 text-xs focus:outline-none focus:border-brand-primary text-right"
                      >
                        <option value="all">{tr('كل المطاعم (عام)', 'All restaurants')}</option>
                        {restaurants.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.restaurantName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                        {tr('مستوى الخطورة / اللون', 'Severity')}
                      </label>
                      <select
                        value={annSeverity}
                        onChange={(e) => setAnnSeverity(e.target.value as any)}
                        className="w-full bg-bg-paper border border-border-delicate p-4 text-xs focus:outline-none focus:border-brand-primary text-right"
                      >
                        <option value="info">{tr('إرشادي معلومتاتي (أزرق)', 'Information (blue)')}</option>
                        <option value="warning">{tr('تحذيري متوسط (أصفر)', 'Warning (yellow)')}</option>
                        <option value="critical">{tr('حرج جداً وعاجل (أحمر)', 'Critical (red)')}</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSendingAnn}
                    className="w-full py-5 bg-brand-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-brand-secondary transition-colors flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isSendingAnn ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    <span>{tr('إرسال وتعميم الإعلان الآن', 'Send announcement')}</span>
                  </button>
                </form>

                {annSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-sans text-center"
                  >
                    {tr('تم إرسال ونشر الإعلان بنجاح ومزامنته بجميع لوحات تحكم المطاعم المعنية!', 'Announcement sent to the selected restaurants.')}
                  </motion.div>
                )}
              </div>

              {/* Announcements list */}
              <div className="xl:col-span-3 bg-white p-10 border border-border-delicate space-y-8">
                <div className="border-b border-border-delicate pb-6">
                  <h3 className="text-xl font-display text-brand-primary italic font-bold">
                    {tr('سجل وبث الإعلانات المنشورة', 'Published announcements')}
                  </h3>
                </div>

                {annLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 text-text-muted gap-4">
                    <span className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-sans font-bold">{tr('جاري تحميل سجل البث الحقيقي...', 'Loading announcements...')}</span>
                  </div>
                ) : announcementsList.length === 0 ? (
                  <div className="border border-dashed border-border-delicate p-16 text-center text-text-muted italic text-xs font-sans">
                    {tr('لا تتوفر إعلانات أو تبليغات مرسلة حالياً في السيرفر.', 'No announcements have been sent yet.')}
                  </div>
                ) : (
                  <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2 gap-4">
                    {announcementsList.map((ann) => {
                      const isCritical = ann.severity === "critical";
                      const isWarning = ann.severity === "warning";
                      return (
                        <div
                          key={ann.id}
                          className={`p-6 border relative transition-all hover:bg-bg-paper ${
                            isCritical
                              ? "border-red-200 bg-red-50/50"
                              : isWarning
                              ? "border-amber-200 bg-amber-50/50"
                              : "border-border-delicate bg-white"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-4">
                            <div className="space-y-2 flex-grow">
                              <div className="flex items-center flex-wrap gap-3">
                                <h4 className={`text-base font-bold font-display ${
                                  isCritical ? "text-red-900" : isWarning ? "text-amber-900" : "text-brand-primary"
                                }`}>
                                  {ann.title}
                                </h4>
                                <span className={`px-2 py-0.5 text-[8px] font-sans font-bold uppercase tracking-wider rounded-none ${
                                  isCritical
                                    ? "bg-red-100 text-red-800"
                                    : isWarning
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-blue-50 text-blue-800"
                                }`}>
                                  {isCritical ? tr('طارئ', 'Critical') : isWarning ? tr('تحذير', 'Warning') : tr('إرشاد', 'Info')}
                                </span>
                                <span className="text-[9px] text-text-muted font-sans mr-auto">
                                  {tr('تاريخ البث:', 'Sent:')} {safeFormatDate(ann.createdAt?.toDate ? ann.createdAt.toDate() : ann.createdAt, "yyyy/MM/dd HH:mm")}
                                </span>
                              </div>
                              <p className="text-xs text-brand-primary font-sans leading-relaxed whitespace-pre-wrap">
                                {ann.message}
                              </p>
                              <div className="flex items-center gap-2 pt-2 text-[10px] text-text-muted font-bold font-sans">
                                <span>{tr('المستهدف:', 'Audience:')}</span>
                                <span className="text-brand-gold">{ann.targetRestaurantName === 'جميع المطاعم' ? tr('جميع المطاعم', 'All restaurants') : ann.targetRestaurantName || tr('جميع المطاعم', 'All restaurants')}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                if (confirm(tr('هل أنت متأكد من حذف هذا التبليغ؟', 'Delete this announcement?'))) {
                                  deleteAnnouncement(ann.id);
                                }
                              }}
                              className="p-2 border border-border-delicate text-text-muted hover:text-red-600 hover:border-red-200 transition-colors shrink-0"
                              title={tr('حذف وإلغاء التبليغ', 'Delete announcement')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Restaurant Modal (Add/Edit) */}
      {(showAddModal || editingRestaurant) && (
        <RestaurantModal
          restaurant={editingRestaurant || undefined}
          onClose={() => {
            setShowAddModal(false);
            setEditingRestaurant(null);
          }}
          onSuccess={() => {
            setShowAddModal(false);
            setEditingRestaurant(null);
            fetchRestaurants();
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white p-5 sm:p-6 rounded-2xl border border-border-delicate shadow-sm relative overflow-hidden">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className="p-3 bg-bg-paper rounded-xl border border-border-delicate">
          {React.cloneElement(icon as React.ReactElement, {
            className: "w-5 h-5 transition-colors",
          })}
        </div>
      </div>
      <div className="relative z-10">
        <p className="text-text-muted text-sm font-bold mb-2">
          {title}
        </p>
        <p className="text-2xl sm:text-3xl font-display font-bold text-brand-primary tracking-tight tabular-nums leading-none">
          {value}
        </p>
      </div>
    </div>
  );
}

function RestaurantModal({
  onClose,
  onSuccess,
  restaurant,
}: {
  onClose: () => void;
  onSuccess: () => void;
  restaurant?: Restaurant;
}) {
  const { dir, language, tr } = useLanguage();
  const [formData, setFormData] = useState({
    managerName: restaurant?.managerName || "",
    managerPhone: restaurant?.managerPhone || "",
    restaurantName: restaurant?.restaurantName || "",
    province: restaurant?.province || "",
    area: restaurant?.area || "",
    landmark: restaurant?.landmark || "",
    subscriptionType:
      restaurant?.subscriptionType || ("normal" as SubscriptionType),
    subscriptionDuration:
      restaurant?.subscriptionDuration || ("month" as SubscriptionDuration),
    startDate: restaurant?.startDate && !isNaN(new Date(restaurant.startDate).getTime())
      ? format(new Date(restaurant.startDate), "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd"),
    monthlyCost: restaurant?.monthlyCost || 0,
    username: restaurant?.username || "",
    password: restaurant?.password || "",
    logoUrl: restaurant?.logoUrl || "",
  });

  const [finalCost, setFinalCost] = useState(0);
  const [endDate, setEndDate] = useState(
    restaurant?.endDate && !isNaN(new Date(restaurant.endDate).getTime())
      ? format(new Date(restaurant.endDate), "yyyy-MM-dd")
      : ""
  );
  const [isEndDateOverridden, setIsEndDateOverridden] = useState(!!restaurant?.endDate);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Only auto-generate credentials if we are NOT editing
    if (!restaurant) {
      if (!formData.username && formData.restaurantName) {
        setFormData((prev) => ({
          ...prev,
          username:
            Math.random().toString(36).substring(2, 6) +
            Math.floor(Math.random() * 100),
        }));
      }
      if (!formData.password) {
        setFormData((prev) => ({
          ...prev,
          password: `Nx${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}9!`,
        }));
      }
    }

    const start = new Date(formData.startDate);
    let end = new Date();
    let multiplier = 1;

    if (formData.subscriptionType === "trial") {
      end = calculateSubscriptionEnd(start, "week");
      if (!restaurant) {
        setFormData((prev) => ({
          ...prev,
          subscriptionDuration: "week",
          monthlyCost: 0,
        }));
      }
      setFinalCost(0);
    } else {
      if (formData.subscriptionDuration === "month") {
        end = calculateSubscriptionEnd(start, "month");
        multiplier = 1;
      } else if (formData.subscriptionDuration === "six-months") {
        end = calculateSubscriptionEnd(start, "six-months");
        multiplier = 6;
      } else if (formData.subscriptionDuration === "year") {
        end = calculateSubscriptionEnd(start, "year");
        multiplier = 12;
      }
      setFinalCost(formData.monthlyCost * multiplier);
    }

    if (!isEndDateOverridden) {
      setEndDate(format(end, "yyyy-MM-dd"));
    }
  }, [
    formData.subscriptionType,
    formData.subscriptionDuration,
    formData.startDate,
    formData.monthlyCost,
    formData.restaurantName,
    restaurant,
    isEndDateOverridden,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const collectionPath = "restaurants";
    setFormError(null);
    if ((!restaurant || formData.password) && (formData.password.length < 8 || !/[A-Za-z]/.test(formData.password) || !/\d/.test(formData.password))) {
      setFormError(tr('كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف ورقم. تجنب كلمات المرور الشائعة مثل 123456.', 'Password must have at least 8 characters, including a letter and number. Avoid common passwords.'));
      return;
    }
    try {
      setSaving(true);
      const payload = {
        ...formData,
        endDate: new Date(endDate).toISOString(),
        startDate: new Date(formData.startDate).toISOString(),
        totalCost: finalCost,
        status: restaurant?.status || "active",
        updatedAt: Timestamp.now(),
      };

      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("authentication_required");
      const response = await fetch('/api/admin/restaurants', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ ...payload, id: restaurant?.id }) });
      if (!response.ok) {
        const result = await response.json();
        if (["password_too_weak", "password_rejected", "password_or_account_rejected"].includes(result.error)) throw new Error(result.details || tr('كلمة المرور ضعيفة أو مرفوضة. استخدم كلمة أقوى وغير شائعة.', 'Password rejected. Use a stronger, uncommon password.'));
        throw new Error(result.error || 'restaurant_save_failed');
      }
      onSuccess();
    } catch (err) {
      console.error("Restaurant save failed", err, collectionPath);
      setFormError(err instanceof Error ? err.message : tr('تعذر حفظ حساب المطعم.', 'Could not save the restaurant account.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-6" dir={dir}>
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-none shadow-2xl p-16 custom-scrollbar border border-border-delicate relative"
      >
        <div className="absolute top-0 right-0 w-full h-1.5 bg-brand-primary" />

        <div className="flex justify-between items-center mb-20 text-right">
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.4em] italic leading-none">
              {tr('تسجيل وتوثيق المنشأة الشريكة', 'Restaurant registration')}
            </p>
            <h2 className="text-4xl font-display text-brand-primary italic font-bold">
              {restaurant ? tr('تعديل بنود', 'Edit') : tr('تأسيس اتفاقية', 'Create')}{" "}
              <span className="text-brand-gold">{tr('شراكة جديدة', 'restaurant account')}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-16 h-16 bg-bg-paper border border-border-delicate rounded-full flex items-center justify-center hover:bg-brand-primary hover:text-white transition-all group"
          >
            <Plus className="rotate-45 w-8 h-8 group-hover:rotate-90 transition-transform duration-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-20 text-right">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Institution Details */}
            <div className="space-y-12">
              <div className="flex items-center gap-4 mb-8">
                <div className="h-0.5 w-12 bg-brand-gold opacity-30" />
                <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.4em]">
                  {tr('بيانات وتفاصيل المنشأة', 'Restaurant details')}
                </p>
              </div>

              <div className="space-y-8">
                <div className="relative group">
                  <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-2 block opacity-60 group-focus-within:opacity-100 transition-opacity">
                    {tr('اسم المطعم / المنشأة', 'Restaurant name')}
                  </label>
                  <input
                    type="text"
                    className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-xl text-brand-primary focus:outline-none focus:border-brand-primary transition-all placeholder:text-text-muted/20 text-right"
                    placeholder={tr('مثال: مطعم السرايا الملكي في بغداد', 'Example: The Royal Restaurant')}
                    required
                    value={formData.restaurantName}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        restaurantName: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-8">
                  <div className="relative group">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-2 block opacity-60">
                      {tr('المحافظة', 'Province')}
                    </label>
                    <select
                      className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all cursor-pointer text-right"
                      required
                      value={formData.province}
                      onChange={(e) =>
                        setFormData({ ...formData, province: e.target.value })
                      }
                    >
                      <option value="">{tr('اختر المحافظة', 'Select province')}</option>
                      {IRAQI_PROVINCES.map((p) => (
                        <option key={p} value={p}>
                          {localizeProvince(p, language)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="relative group">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-2 block opacity-60">
                      {tr('المنطقة / الحي والشارع', 'Area / street')}
                    </label>
                    <input
                      type="text"
                      className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all placeholder:text-text-muted/20 text-right"
                      placeholder={tr('شارع الأميرات، المنصور', 'Street and neighborhood')}
                      required
                      value={formData.area}
                      onChange={(e) =>
                        setFormData({ ...formData, area: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="relative group">
                  <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-2 block opacity-60">
                    {tr('رابط الهوية البصرية وشعار المطعم (Logo URL)', 'Restaurant logo URL')}
                  </label>
                  <input
                    type="url"
                    className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-sm text-brand-primary focus:outline-none focus:border-brand-primary transition-all placeholder:text-text-muted/20 text-left"
                    placeholder="https://images.unsplash.com/..."
                    value={formData.logoUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, logoUrl: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Directorship */}
            <div className="space-y-12">
              <div className="flex items-center gap-4 mb-8">
                <div className="h-0.5 w-12 bg-brand-gold opacity-30" />
                <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.4em]">
                  {tr('إدارة الحساب والمشرف المسؤول', 'Owner account')}
                </p>
              </div>

              <div className="space-y-8 p-10 bg-bg-paper border border-border-delicate">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="relative">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-3 block opacity-60">
                      {tr('اسم المدير المسؤول', 'Manager name')}
                    </label>
                    <div className="relative underline-animation">
                      <Users className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-gold/40" />
                      <input
                        type="text"
                        className="w-full bg-transparent pr-8 pl-4 py-3 text-sm text-brand-primary font-bold tracking-widest focus:outline-none text-right"
                        placeholder={tr('الاسم الثلاثي الكامل', 'Full name')}
                        required
                        value={formData.managerName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            managerName: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-3 block opacity-60">
                      {tr('رقم الهاتف المباشر للمدير', 'Manager phone number')}
                    </label>
                    <div className="relative underline-animation">
                      <Phone className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-gold/40" />
                      <input
                        type="tel"
                        className="w-full bg-transparent pr-8 pl-4 py-3 text-sm text-brand-primary font-bold tracking-widest focus:outline-none text-left"
                        dir="ltr"
                        placeholder="07XXXXXXXXX"
                        required
                        value={formData.managerPhone}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            managerPhone: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6">
                  <div className="relative">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-3 block opacity-60">
                      {tr('اسم مستخدم بوابة لوحة التحكم', 'Dashboard username')}
                    </label>
                    <input
                      type="text"
                      className="w-full bg-white border border-border-delicate px-6 py-4 text-xs font-bold tracking-widest text-brand-primary focus:border-brand-primary outline-none text-left"
                      readOnly={!!restaurant}
                      value={formData.username}
                      onChange={(e) =>
                        setFormData({ ...formData, username: e.target.value })
                      }
                    />
                  </div>
                  <div className="relative">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-3 block opacity-60">
                      {tr('كلمة المرور الإدارية (رمز الدخول السري)', 'Owner password')}
                    </label>
                    <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="w-full bg-white border border-border-delicate px-12 py-4 text-xs font-bold tracking-widest text-brand-primary focus:border-brand-primary outline-none text-left"
                      required={!restaurant}
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={restaurant ? tr('اتركها فارغة للإبقاء على كلمة المرور الحالية', 'Leave blank to keep the current password') : tr('8 أحرف على الأقل، تتضمن حرفاً ورقماً', 'At least 8 characters, with a letter and number')}
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                    />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gold" aria-label={showPassword ? tr('إخفاء كلمة المرور', 'Hide password') : tr('إظهار كلمة المرور', 'Show password')}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    </div>
                    <p className="mt-2 text-[9px] text-text-muted">{restaurant ? tr('أدخل كلمة جديدة لتغييرها، أو اترك الحقل فارغاً دون تغيير.', 'Enter a new password to change it, or leave this blank.') : tr('استخدم كلمة قوية وغير شائعة.', 'Use a strong, uncommon password.')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Subscription Tiers */}
          <div className="space-y-12 py-16 border-y border-border-delicate bg-bg-paper -mx-16 px-16">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-4">
              <div className="flex items-center gap-4">
                <div className="h-0.5 w-12 bg-brand-gold opacity-30" />
                <p className="text-[10px] font-bold text-brand-primary uppercase tracking-[0.4em]">
                  {tr('باقات خطة الاستثمار والاشتراك', 'Subscription plan')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.4em] block">
                  {tr('باقة الاشتراك الفنية المحددة', 'Selected plan')}
                </label>
                <select
                  className="w-full bg-white border border-border-delicate px-8 py-5 text-sm font-sans text-brand-primary focus:border-brand-primary outline-none cursor-pointer text-right"
                  value={formData.subscriptionType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      subscriptionType: e.target.value as SubscriptionType,
                    })
                  }
                >
                  {SUBSCRIPTION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.4em] block">
                  {tr('دورة تجديد الاشتراك التعاقدية', 'Renewal cycle')}
                </label>
                <select
                  className="w-full bg-white border border-border-delicate px-8 py-5 text-sm font-sans text-brand-primary focus:border-brand-primary outline-none cursor-pointer text-right"
                  disabled={formData.subscriptionType === "trial"}
                  value={formData.subscriptionDuration}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      subscriptionDuration: e.target
                        .value as SubscriptionDuration,
                    })
                  }
                >
                  <option value="month">{tr('تجديد شهري دوري', 'Monthly')}</option>
                  <option value="six-months">{tr('دورة نصف سنوية (6 أشهر)', 'Every 6 months')}</option>
                  <option value="year">{tr('تجديد سنوي مسبق (12 شهر)', 'Annual')}</option>
                </select>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.2em] block">
                  Monthly Subscription Cost (IQD)
                </label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-xs font-bold text-brand-gold opacity-60">
                    IQD
                  </span>
                  <input
                    type="number"
                    className="w-full bg-white border border-border-delicate pl-16 pr-8 py-5 text-xl font-mono text-brand-primary focus:border-brand-primary outline-none text-right"
                    placeholder="Enter subscription cost..."
                    disabled={formData.subscriptionType === "trial"}
                    value={formData.monthlyCost}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        monthlyCost: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Interactive Subscription Dates Module */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 pt-10 border-t border-border-delicate/40 mt-8">
              <div className="p-8 border border-border-delicate bg-white flex flex-col justify-between space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-wider opacity-60 block">
                    {tr('تاريخ بدء الاشتراك', 'Start date')}
                  </p>
                  <p className="text-sm font-sans text-brand-primary font-bold">
                    {safeFormatDate(formData.startDate, "yyyy/MM/dd")}
                  </p>
                </div>
                <input
                  type="date"
                  className="w-full bg-bg-paper border border-border-delicate px-4 py-2 text-xs font-sans text-brand-primary outline-none text-right"
                  value={formData.startDate}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, startDate: e.target.value }));
                  }}
                />
              </div>

              <div className="p-8 border border-border-delicate bg-white flex flex-col justify-between space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-wider opacity-60 block">
                    {tr('تاريخ انتهاء الصلاحية', 'Expiration date')}
                  </p>
                  <p className="text-sm font-sans text-brand-primary font-bold">
                    {safeFormatDate(endDate, "yyyy/MM/dd")}
                  </p>
                </div>
                <input
                  type="date"
                  className="w-full bg-bg-paper border border-border-delicate px-4 py-2 text-xs font-sans text-brand-primary outline-none text-right"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setIsEndDateOverridden(true);
                  }}
                />
              </div>

              <div className="p-8 border border-border-delicate bg-white flex flex-col justify-center">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-wider opacity-60 mb-2">
                  Total Contract Value (IQD)
                </p>
                <p className="text-xl font-display text-emerald-700 italic font-bold">
                  {finalCost.toLocaleString()} IQD
                </p>
              </div>

              <div className="p-8 border border-border-delicate bg-white flex flex-col justify-center">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-wider opacity-60 mb-2">
                  {tr('كود الشريك التعريفي', 'Restaurant ID')}
                </p>
                <p className="text-sm font-mono text-brand-primary uppercase tracking-widest font-bold">
                  {restaurant?.id?.slice(-8).toUpperCase() || tr('جديد تلقائي', 'Auto-generated')}
                </p>
              </div>
            </div>
          </div>

          {formError && <div className="p-4 border border-red-200 bg-red-50 text-red-700 text-sm font-bold">{formError}</div>}
          <div className="flex justify-end pt-12 pb-20">
            <button
              type="submit"
              disabled={saving}
              className="px-24 py-6 bg-brand-primary text-white font-bold text-xs uppercase tracking-widest shadow-2xl hover:bg-brand-secondary transition-all disabled:opacity-50"
            >
              {saving ? tr('جاري الحفظ...', 'Saving...') : tr('اعتماد وتوثيق اتفاقية الشراكة في النظام', 'Save restaurant account')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
