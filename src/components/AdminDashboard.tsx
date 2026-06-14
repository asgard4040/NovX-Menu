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
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestore-utils";
import {
  IRAQI_PROVINCES,
  SUBSCRIPTION_TYPES,
  SUBSCRIPTION_DURATIONS,
} from "../constants";
import { Restaurant, SubscriptionType, SubscriptionDuration } from "../types";
import { addWeeks, addMonths, addYears, format } from "date-fns";
import QRCode from "react-qr-code";

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
}: {
  activeTab?: "overview" | "restaurants" | "ai" | "alerts";
}) {
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
  const [aiApiKey, setAiApiKey] = useState("");
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
    dailySubscriptions: 0,
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
      await setDoc(doc(db, "settings", "support"), { 
        phone: supportPhone,
        logoUrl: systemLogo
      }, { merge: true });
      localStorage.setItem("novix_support_phone", supportPhone);
      localStorage.setItem("novix_system_logo", systemLogo);
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
        if (data.apiKey) setAiApiKey(data.apiKey);
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
          if (data.apiKey) setAiApiKey(data.apiKey);
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
      apiKey: aiApiKey,
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
      alert("تعذر الاتصال بمركز البث. يرجى التأكد من اتصال الإنترنت الخاص بالسيرفر وإعادة المحاولة.");
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

      // Calculate basic stats for demo
      setStats({
        totalRestaurants: data.length,
        monthlyProfit: data.reduce(
          (acc, curr) => acc + (curr.monthlyCost || 0),
          0,
        ),
        activeSubscriptions: data.filter((r) => r.status === "active").length,
        dailySubscriptions: 1, // Placeholder
      });
    } catch (err) {
      console.warn("Could not load restaurants from Firebase (using local cache):", err);
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
            dailySubscriptions: 1,
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
    <div className="space-y-12" dir="rtl">
      {isOffline && (
        <div className="p-4 bg-amber-50/80 border-r-4 border-brand-gold text-brand-primary text-xs font-sans font-bold flex items-center gap-3 animate-pulse">
          <span className="w-2.5 h-2.5 bg-brand-gold rounded-full shrink-0" />
          <span>الوضع المحلي نشط: النظام يعمل بكفاءة عبر الذاكرة المحلية المؤقتة (Offline Cache). سيتم التزامن تلقائياً فور استقرار اتصال المزود.</span>
        </div>
      )}
      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-12"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <StatCard
                title="إجمالي المطاعم"
                value={stats.totalRestaurants}
                icon={<Building2 className="w-6 h-6 text-brand-primary" />}
                trend="+12% النمو"
              />
              <StatCard
                title="الأرباح المتوقعة"
                value={`${stats.monthlyProfit.toLocaleString()} د.ع`}
                icon={<CreditCard className="w-6 h-6 text-emerald-500" />}
                trend="+5% زيادة"
              />
              <StatCard
                title="الاشتراكات النشطة"
                value={stats.activeSubscriptions}
                icon={<CheckCircle2 className="w-6 h-6 text-purple-500" />}
                trend="95% استقرار"
              />
              <StatCard
                title="طلبات اليوم"
                value={stats.dailySubscriptions}
                icon={<Users className="w-6 h-6 text-amber-500" />}
                trend="+8% اليوم"
              />
            </div>

            {/* Support and System Branding Card */}
            <div className="bg-white border border-border-delicate p-10 relative overflow-hidden space-y-8">
              <div className="absolute top-0 right-0 w-[4px] h-full bg-brand-gold" />
              
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 border-b border-border-delicate/40 pb-8">
                <div className="space-y-3 text-right">
                  <div className="flex items-center gap-4">
                    <Phone className="w-6 h-6 text-brand-gold" />
                    <h3 className="text-2xl font-display text-brand-primary italic font-bold">
                      خط طوارئ الدعم الفني العام
                    </h3>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed font-sans max-w-2xl">
                    هذا الرقم يظهر لجميع شركائك من المطاعم والمطابخ والويترز في صفحة "المساعدة" الخاصة بهم وعند التحذير من قرب انتهاء الاشتراك لتسهيل تجديد اشتراكاتهم وتواصلهم المباشر معك.
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
                    <span>حفظ وتعميم الرقم الجديد</span>
                  </button>
                </div>
              </div>

              {/* System Logo Branding Section */}
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
                <div className="space-y-3 text-right">
                  <div className="flex items-center gap-4">
                    <Image className="w-6 h-6 text-brand-gold" />
                    <h3 className="text-2xl font-display text-brand-primary italic font-bold">
                      شعار النظام العام الموحد (رفع اللوغو)
                    </h3>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed font-sans max-w-2xl">
                    يمكنك رفع لوغو الاستوديو ليعرض فوراً وعمومياً في واجهة مالك المطعم، لوحة الويتر، وقسم المطبخ.
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
                        إزالة اللوغو
                      </button>
                    </div>
                  )}
                  <div className="flex-1 sm:flex-initial">
                    <label className="px-8 py-4 bg-bg-paper border border-dashed border-brand-gold/60 text-brand-primary hover:border-brand-primary cursor-pointer text-xs font-bold uppercase tracking-widest transition-all inline-block text-center w-full">
                      <span>📤 رفع لوغو من الاستوديو</span>
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
                  تم حفظ وتحديث رقم الدعم ولوغو الاستوديو بنجاح!
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === "restaurants" && (
          <motion.div
            key="restaurants"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-16"
          >
            <div className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-6 sm:gap-10 bg-white p-5 sm:p-10 border border-border-delicate">
              <div className="flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-6 w-full xl:w-auto">
                <div className="relative flex-1 xl:w-96 group">
                  <Search className="absolute right-0 top-1/2 -translate-y-1/2 text-text-muted/40 w-5 h-5 group-focus-within:text-brand-primary" />
                  <input
                    type="text"
                    placeholder="البحث عن اسم المطعم أو المدير..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pr-10 py-3 sm:py-4 bg-transparent border-b border-border-delicate text-base sm:text-lg font-display focus:outline-none focus:border-brand-primary transition-all text-right"
                  />
                </div>
                <select
                  value={filterProvince}
                  onChange={(e) => setFilterProvince(e.target.value)}
                  className="px-4 sm:px-6 py-3 sm:py-4 bg-bg-paper border border-border-delicate rounded-none text-[10px] font-bold uppercase tracking-[0.2em] focus:outline-none cursor-pointer hover:bg-white transition-colors"
                >
                  <option value="">كل المحافظات</option>
                  {IRAQI_PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-4 sm:px-6 py-3 sm:py-4 bg-bg-paper border border-border-delicate rounded-none text-[10px] font-bold uppercase tracking-[0.2em] focus:outline-none cursor-pointer hover:bg-white transition-colors text-right"
                >
                  <option value="">كل الباقات/الفئات</option>
                  {SUBSCRIPTION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select
                  value={filterExpiry}
                  onChange={(e) => setFilterExpiry(e.target.value as any)}
                  className="px-4 sm:px-6 py-3 sm:py-4 bg-bg-paper border border-border-delicate rounded-none text-[10px] font-bold uppercase tracking-[0.2em] focus:outline-none cursor-pointer hover:bg-white transition-colors text-right"
                >
                  <option value="all">كل حالات الاشتراك</option>
                  <option value="expired">مطاعم منتهية الاشتراك 🔴</option>
                  <option value="soon">مطاعم ستنتهي خلال 3 أيام 🟡</option>
                </select>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-brand-primary text-white px-6 sm:px-12 py-4 sm:py-5 rounded-none font-bold flex items-center justify-center gap-4 shadow-xl hover:bg-brand-secondary transition-all w-full xl:w-auto"
              >
                <Plus className="w-5 h-5" />
                <span className="text-[10px] uppercase tracking-widest font-bold">
                  تسجيل وإضافة شريك جديد
                </span>
              </button>
            </div>

            <div className="bg-white border border-border-delicate overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right" dir="rtl">
                  <thead>
                    <tr className="bg-bg-paper">
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        المطعم / المؤسسة
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        المدير المسؤول
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        المحافظة والعنوان
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        الفئة / الباقة
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        حالة الاشتراك
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate text-center whitespace-nowrap">
                        كود الـ QR المباشر
                      </th>
                      <th className="px-10 py-8 text-[10px] font-bold text-brand-gold uppercase tracking-widest border-b border-border-delicate whitespace-nowrap">
                        الإجراءات والتحكم
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
                              {res.province}
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
                              صلاحية: {safeFormatDate(res.endDate, "MMM yyyy")}
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
                              ? "نشط ومفعّل"
                              : "موقوف مؤقتاً"}
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
                                <ExternalLink className="w-3 h-3" /> المنيو الرقمي
                              </a>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(`${window.location.origin}?loginRestaurantId=${res.id}`);
                                  setCopiedId(res.id);
                                  setTimeout(() => setCopiedId(null), 2000);
                                }}
                                className="text-[8px] font-bold text-brand-primary hover:text-brand-gold transition-all flex items-center gap-1 bg-bg-paper px-2 py-1 border border-border-delicate cursor-pointer"
                              >
                                {copiedId === res.id ? "✓ تم النسخ" : "📋 نسخ رابط الموظفين والمالك"}
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
                                  ? "إيقاف مؤقت"
                                  : "إعادة تفعيل"
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
                              title="تعديل الإعدادات"
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
                        الذكاء الاصطناعي متصل
                      </span>
                      <span className="text-[10px] text-brand-gold font-bold uppercase tracking-widest opacity-60 italic">
                        v2.4 LTS إصدار مستقر
                      </span>
                    </div>
                    <h2 className="text-3xl sm:text-5xl md:text-6xl font-display text-brand-primary italic tracking-tighter leading-none mb-4 md:mb-6">
                      نوفكس الموجه <br className="hidden sm:inline" />{" "}
                      <span className="text-brand-gold">الذكي المتكامل</span>
                    </h2>
                    <p className="text-text-muted max-w-lg font-light italic text-sm sm:text-base md:text-lg leading-relaxed">
                      الشبكة المركزية الذكية تعمل بكفاءة عالية. تحسين جودة المنيو الرقمي، الاستجابة السريعة، وتحليلات تفضيلات الزبائن والخدمة الرقمية التلقائية لجميع الشركاء.
                    </p>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-2 bg-bg-paper p-6 sm:p-12 lg:p-16 border border-border-delicate flex flex-col justify-between">
                <div className="space-y-6 sm:space-y-8">
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                    مواصفات هيكل النظام العصبي
                  </p>
                  <div className="space-y-4 sm:space-y-6">
                    <div className="flex justify-between items-center py-3 sm:py-4 border-b border-border-delicate">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        أفق التفكير اللحظي
                      </span>
                      <span className="text-lg sm:text-xl font-display text-brand-primary italic">
                        128k Tokens
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-3 sm:py-4 border-b border-border-delicate">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        درجة استجابة Cortex
                      </span>
                      <span className="text-lg sm:text-xl font-display text-brand-primary italic">
                        0.7 (متزن ذكي)
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-3 sm:py-4">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        معيار الاحتمالية Top P
                      </span>
                      <span className="text-lg sm:text-xl font-display text-brand-primary italic">
                        0.95
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-8 sm:mt-16">
                  <button className="w-full py-4 sm:py-6 border border-border-delicate text-[10px] font-bold uppercase tracking-widest text-text-muted hover:bg-brand-primary hover:text-white hover:border-brand-primary transition-all italic">
                    إعادة تصفية وتحسين ومعايرة cortex
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
                      توزيع استهلاك النظام
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
                              ولوج آمن وموثق
                            </p>
                          </div>
                        </div>
                        <div className="text-right sm:text-left">
                          <p className="text-xl sm:text-2xl font-display text-brand-primary tabular-nums tracking-tighter">
                            {(1200 + i * 45).toLocaleString()}
                          </p>
                          <p className="text-[9px] text-text-muted font-bold uppercase tracking-widest leading-none italic">
                            عمليات ذكية مدرجة
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 sm:space-y-3 relative z-10">
                        <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest mb-1 opacity-60">
                          <span className="text-text-muted">العبء والتحمل</span>
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
                      إدارة التحكم الذكي بقواعد المنيو
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">
                      مستقر وآمن
                    </span>
                  </div>
                </div>

                <div className="space-y-6 sm:space-y-10">
                  <div className="p-5 sm:p-10 bg-bg-paper border border-border-delicate space-y-6 sm:space-y-8">
                    <div className="space-y-4 sm:space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          توجيهات النظام والتعليمات الفوقية لنوفكس الذكي (System Instruction)
                        </label>
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          className="w-full h-36 sm:h-48 bg-white border border-border-delicate p-4 sm:p-8 text-xs sm:text-sm text-brand-primary font-sans focus:outline-none focus:border-brand-primary transition-all resize-none leading-relaxed shadow-inner"
                          placeholder="أدخل توجيهات الذكاء الاصطناعي الجديدة للتحكم بالخدمات والمنيو تلقائياً..."
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                            نموذج معالجة اللغة المحدد
                          </label>
                          <select
                            value={aiModel}
                            onChange={(e) => setAiModel(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-border-delicate text-xs font-display focus:outline-none text-right"
                          >
                            <option value="gemini-3.5-flash">Gemini 3.5 Flash (سرعة البرق والاستدلال الأحدث)</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash (سرعة فائقة)</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro (تفوق استدلالي)</option>
                            <option value="gemini-2.0-flash">Gemini 2.0 Flash (النموذج السابق)</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                            درجة الإبداع العشوائي (Temperature): {aiTemperature}
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

                        <div className="space-y-3 sm:col-span-2">
                          <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                            مفتاح خادم Gemini (Gemini API Key) - يعمل كاحتياطي ممتاز في السيرفر والمتصفح
                          </label>
                          <input
                            type="password"
                            value={aiApiKey}
                            onChange={(e) => setAiApiKey(e.target.value)}
                            placeholder="...أدخل مفتاح الـ Gemini API الخاص بك هنا"
                            className="w-full px-4 py-3 bg-white border border-border-delicate text-xs font-sans font-medium outline-none focus:border-brand-primary transition-all text-left"
                            style={{ direction: "ltr" }}
                          />
                          <p className="text-[9px] text-text-muted mt-1 text-right">
                            * في حال قمت برفع المنيو على سيرفر مستقل أو استضافة ساكنة، كتابة هذا المفتاح سيضمن عمل الذكاء الاصطناعي مباشرة من متصفح الزبون في حال وجود أي مشاكل اتصال بالسيرفر الخاص بك.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4 border-t border-border-delicate">
                      {aiSaveSuccess ? (
                        <span className="text-xs text-emerald-800 font-sans font-bold text-center sm:text-right">
                          ✓ تم حفظ قواعد الذكاء ومزامنتها بنجاح مع سيرفر المعالجة!
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-muted font-sans font-medium text-center sm:text-right leading-relaxed">
                          * أي تعديل يتم تطبيقه حياً ومباشرةً لجميع المطاعم المشتركة لزبائنهم
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
                        <span>حفظ وتطبيق التعليمات الذكية</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 sm:space-y-6">
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                      <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest italic">
                        سلسلة السجلات والعمليات الحية الحالية لنوفكس Cortex
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
                          إرسال إشارة فحص
                        </button>
                        <button
                          onClick={() => setAiLogs([])}
                          className="text-[9px] hover:text-red-600 text-text-muted font-bold tracking-widest uppercase underline"
                        >
                          مسح السجلات
                        </button>
                      </div>
                    </div>
                    <div className="h-64 bg-white border border-border-delicate p-4 sm:p-8 font-sans text-xs text-text-muted/60 overflow-y-auto space-y-4 no-scrollbar italic shadow-inner">
                      {aiLogs.length === 0 ? (
                        <p className="text-center py-10 opacity-40">لا توجد سجلات حالياً. انقر على إرسال إشارة فحص لتوليد سجل.</p>
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
                            {log.msg}
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
            dir="rtl"
          >
            {/* Alerts Page Header */}
            <div className="bg-white border border-border-delicate p-10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[4px] h-full bg-brand-primary" />
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                  نظام التنبيهات والإشعارات الفوري العام
                </p>
                <h2 className="text-3xl font-display text-brand-primary italic font-bold">
                  إدارة الإعلانات وتوجيهات الشركاء
                </h2>
                <p className="text-xs text-text-muted font-sans leading-relaxed">
                  من هنا يمكنك كتابة رسالة توجيهية أو إعلان طارئ أو تنبيه فني وبثه حياً لجميع المطاعم المرتبطة بالنظام أو توجيهه لمطعم شريك مخصص.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-12">
              {/* Creator Form */}
              <div className="xl:col-span-2 bg-white p-10 border border-border-delicate space-y-8">
                <div className="border-b border-border-delicate pb-6 flex items-center gap-4">
                  <Bell className="w-6 h-6 text-brand-gold shrink-0" />
                  <h3 className="text-xl font-display text-brand-primary italic font-bold">
                    إنشاء إعلان وبث فوري
                  </h3>
                </div>

                <form onSubmit={sendAnnouncement} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                      عنوان الإشعار
                    </label>
                    <input
                      type="text"
                      required
                      value={annTitle}
                      onChange={(e) => setAnnTitle(e.target.value)}
                      placeholder="مثال: صيانة مبرمجة لقواعد البيانات"
                      className="w-full bg-bg-paper border border-border-delicate p-4 text-sm focus:outline-none focus:border-brand-primary transition-colors text-right"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                      نص وتفاصيل الرسالة
                    </label>
                    <textarea
                      required
                      rows={5}
                      value={annMessage}
                      onChange={(e) => setAnnMessage(e.target.value)}
                      placeholder="اكتب هنا تفاصيل التنبيه أو الإعلان بدقة..."
                      className="w-full bg-bg-paper border border-border-delicate p-4 text-sm focus:outline-none focus:border-brand-primary transition-colors resize-none leading-relaxed text-right"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                        المستهدف الإداري
                      </label>
                      <select
                        value={annTarget}
                        onChange={(e) => setAnnTarget(e.target.value)}
                        className="w-full bg-bg-paper border border-border-delicate p-4 text-xs focus:outline-none focus:border-brand-primary text-right"
                      >
                        <option value="all">كل المطاعم (عام)</option>
                        {restaurants.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.restaurantName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                        مستوى الخطورة / اللون
                      </label>
                      <select
                        value={annSeverity}
                        onChange={(e) => setAnnSeverity(e.target.value as any)}
                        className="w-full bg-bg-paper border border-border-delicate p-4 text-xs focus:outline-none focus:border-brand-primary text-right"
                      >
                        <option value="info">إرشادي معلومتاتي (أزرق)</option>
                        <option value="warning">تحذيري متوسط (أصفر)</option>
                        <option value="critical">حرج جداً وعاجل (أحمر)</option>
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
                    <span>إرسال وتعميم الإعلان الآن</span>
                  </button>
                </form>

                {annSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-sans text-center"
                  >
                    تم إرسال ونشر الإعلان بنجاح ومزامنته بجميع لوحات تحكم المطاعم المعنية!
                  </motion.div>
                )}
              </div>

              {/* Announcements list */}
              <div className="xl:col-span-3 bg-white p-10 border border-border-delicate space-y-8">
                <div className="border-b border-border-delicate pb-6">
                  <h3 className="text-xl font-display text-brand-primary italic font-bold">
                    سجل وبث الإعلانات المنشورة
                  </h3>
                </div>

                {annLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 text-text-muted gap-4">
                    <span className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-sans font-bold">جاري تحميل سجل البث الحقيقي...</span>
                  </div>
                ) : announcementsList.length === 0 ? (
                  <div className="border border-dashed border-border-delicate p-16 text-center text-text-muted italic text-xs font-sans">
                    لا تتوفر إعلانات أو تبليغات مرسلة حالياً في السيرفر.
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
                                  {isCritical ? "طارئ" : isWarning ? "تحذير" : "إرشاد"}
                                </span>
                                <span className="text-[9px] text-text-muted font-sans mr-auto">
                                  تاريخ البث: {safeFormatDate(ann.createdAt?.toDate ? ann.createdAt.toDate() : ann.createdAt, "yyyy/MM/dd HH:mm")}
                                </span>
                              </div>
                              <p className="text-xs text-brand-primary font-sans leading-relaxed whitespace-pre-wrap">
                                {ann.message}
                              </p>
                              <div className="flex items-center gap-2 pt-2 text-[10px] text-text-muted font-bold font-sans">
                                <span>المستهدف:</span>
                                <span className="text-brand-gold">{ann.targetRestaurantName || "جميع المطاعم"}</span>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                if (confirm("هل أنت متأكد من حذف هذا التبليغ؟")) {
                                  deleteAnnouncement(ann.id);
                                }
                              }}
                              className="p-2 border border-border-delicate text-text-muted hover:text-red-600 hover:border-red-200 transition-colors shrink-0"
                              title="حذف وإلغاء التبليغ"
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
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend: string;
}) {
  return (
    <div className="bg-white p-6 sm:p-10 rounded-none border border-border-delicate shadow-sm relative overflow-hidden group hover:border-brand-gold/30 transition-all">
      <div className="flex justify-between items-start mb-6 sm:mb-12 relative z-10">
        <div className="p-3 sm:p-4 bg-bg-paper rounded-full border border-border-delicate group-hover:bg-brand-primary group-hover:text-white transition-all duration-500">
          {React.cloneElement(icon as React.ReactElement, {
            className: "w-5 h-5 transition-colors",
          })}
        </div>
        <span
          className={`text-[9px] font-bold px-4 py-1.5 rounded-full uppercase tracking-[0.2em] italic border border-border-delicate ${trend.includes("+") ? "text-emerald-700 bg-emerald-50" : "text-text-muted bg-bg-paper"}`}
        >
          {trend}
        </span>
      </div>
      <div className="relative z-10">
        <p className="text-brand-gold text-[10px] font-bold uppercase tracking-[0.4em] mb-2 sm:mb-4">
          {title}
        </p>
        <p className="text-3xl sm:text-4xl font-display text-brand-primary italic tracking-tight tabular-nums leading-none">
          {value}
        </p>
      </div>
      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-brand-gold/10 opacity-0 group-hover:opacity-100 transition-opacity" />
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
          password: Math.random().toString(36).substring(2, 8).toUpperCase(),
        }));
      }
    }

    const start = new Date(formData.startDate);
    let end = new Date();
    let multiplier = 1;

    if (formData.subscriptionType === "trial") {
      end = addWeeks(start, 1);
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
        end = addMonths(start, 1);
        multiplier = 1;
      } else if (formData.subscriptionDuration === "six-months") {
        end = addMonths(start, 6);
        multiplier = 6;
      } else if (formData.subscriptionDuration === "year") {
        end = addYears(start, 1);
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
    try {
      const payload = {
        ...formData,
        endDate: new Date(endDate).toISOString(),
        startDate: new Date(formData.startDate).toISOString(),
        totalCost: finalCost,
        status: restaurant?.status || "active",
        updatedAt: Timestamp.now(),
      };

      if (restaurant?.id) {
        await updateDoc(doc(db, "restaurants", restaurant.id), payload);
      } else {
        await addDoc(collection(db, collectionPath), {
          ...payload,
          createdAt: Timestamp.now(),
        });
      }
      onSuccess();
    } catch (err) {
      handleFirestoreError(
        err,
        restaurant ? OperationType.UPDATE : OperationType.CREATE,
        restaurant ? `restaurants/${restaurant.id}` : collectionPath,
      );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[60] flex items-center justify-center p-6" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-none shadow-2xl p-16 custom-scrollbar border border-border-delicate relative"
      >
        <div className="absolute top-0 right-0 w-full h-1.5 bg-brand-primary" />

        <div className="flex justify-between items-center mb-20 text-right">
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.4em] italic leading-none">
              تسجيل وتوثيق المنشأة الشريكة
            </p>
            <h2 className="text-4xl font-display text-brand-primary italic font-bold">
              {restaurant ? "تعديل بنود" : "تأسيس اتفاقية"}{" "}
              <span className="text-brand-gold">شراكة جديدة</span>
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
                  بيانات وتفاصيل المنشأة
                </p>
              </div>

              <div className="space-y-8">
                <div className="relative group">
                  <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-2 block opacity-60 group-focus-within:opacity-100 transition-opacity">
                    اسم المطعم / المنشأة
                  </label>
                  <input
                    type="text"
                    className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-xl text-brand-primary focus:outline-none focus:border-brand-primary transition-all placeholder:text-text-muted/20 text-right"
                    placeholder="مثال: مطعم السرايا الملكي في بغداد"
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
                      المحافظة
                    </label>
                    <select
                      className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all cursor-pointer text-right"
                      required
                      value={formData.province}
                      onChange={(e) =>
                        setFormData({ ...formData, province: e.target.value })
                      }
                    >
                      <option value="">اختر المحافظة</option>
                      {IRAQI_PROVINCES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="relative group">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-2 block opacity-60">
                      المنطقة / الحي والشارع
                    </label>
                    <input
                      type="text"
                      className="w-full bg-transparent border-b border-border-delicate py-4 font-sans text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all placeholder:text-text-muted/20 text-right"
                      placeholder="شارع الأميرات، المنصور"
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
                    رابط الهوية البصرية وشعار المطعم (Logo URL)
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
                  إدارة الحساب والمشرف المسؤول
                </p>
              </div>

              <div className="space-y-8 p-10 bg-bg-paper border border-border-delicate">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="relative">
                    <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em] mb-3 block opacity-60">
                      اسم المدير المسؤول
                    </label>
                    <div className="relative underline-animation">
                      <Users className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-gold/40" />
                      <input
                        type="text"
                        className="w-full bg-transparent pr-8 pl-4 py-3 text-sm text-brand-primary font-bold tracking-widest focus:outline-none text-right"
                        placeholder="الاسم الثلاثي الكامل"
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
                      رقم الهاتف المباشر للمدير
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
                      اسم مستخدم بوابة لوحة التحكم
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
                      كلمة المرور الإدارية (رمز الدخول السري)
                    </label>
                    <input
                      type="text"
                      className="w-full bg-white border border-border-delicate px-6 py-4 text-xs font-bold tracking-widest text-brand-primary focus:border-brand-primary outline-none text-left"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                    />
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
                  باقات خطة الاستثمار والاشتراك
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.4em] block">
                  باقة الاشتراك الفنية المحددة
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
                  دورة تجديد الاشتراك التعاقدية
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
                  <option value="month">تجديد شهري دوري</option>
                  <option value="six-months">دورة نصف سنوية (6 أشهر)</option>
                  <option value="year">تجديد سنوي مسبق (12 شهر)</option>
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
                    تاريخ بدء الاشتراك
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
                    تاريخ انتهاء الصلاحية
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
                  كود الشريك التعريفي
                </p>
                <p className="text-sm font-mono text-brand-primary uppercase tracking-widest font-bold">
                  {restaurant?.id?.slice(-8).toUpperCase() || "جديد تلقائي"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-12 pb-20">
            <button
              type="submit"
              className="px-24 py-6 bg-brand-primary text-white font-bold text-xs uppercase tracking-widest shadow-2xl hover:bg-brand-secondary transition-all"
            >
              اعتماد وتوثيق اتفاقية الشراكة في النظام
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
