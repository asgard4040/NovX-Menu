import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  User,
  ChevronLeft,
  Bell,
  Timer,
  Search,
  Plus,
  Minus,
  X,
  Trash2,
  ShieldAlert,
  Users,
  ShoppingBag,
} from "lucide-react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  orderBy,
  addDoc,
  getDocs,
  deleteDoc,
} from "../lib/supabase-db";
import { db } from "../lib/supabase-db";
import { Order, OrderStatus, WaiterRequest } from "../types";
import { format } from "date-fns";
import { enableStaffNotifications, showDeviceNotificationTest } from "../lib/notifications";
import { supabase } from "../lib/supabase";
import { localizeDeviceType, useLanguage } from "../lib/i18n";
import { StaffWelcomeCard } from "./StaffWelcomeCard";

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

interface WaiterDashboardProps {
  restaurantId: string;
}

export default function WaiterDashboard({
  restaurantId,
}: WaiterDashboardProps) {
  const { dir, language, tr } = useLanguage();
  const [restaurant, setRestaurant] = useState<any | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationState, setNotificationState] = useState<"idle" | "loading" | "enabled" | "error">("idle");
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationTestMessage, setNotificationTestMessage] = useState<string | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [banningOrder, setBanningOrder] = useState<Order | null>(null);

  const [bannedDevices, setBannedDevices] = useState<any[]>([]);
  const [waiterRequests, setWaiterRequests] = useState<WaiterRequest[]>([]);
  const [supportPhone, setSupportPhone] = useState(() => localStorage.getItem("novix_support_phone") || "07740064528");
  const [systemLogo, setSystemLogo] = useState(() => localStorage.getItem("novix_system_logo") || "");

  useEffect(() => {
    const fetchSupport = async () => {
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
        console.warn("Error loading support phone (using local fallback):", e);
      }
    };
    fetchSupport();
  }, []);

  // States for table-side ordering menu (Requirement 3)
  const [view, setView] = useState<"dashboard" | "menu" | "bans" | "requests">("dashboard");
  useEffect(() => {
    const requestId = new URLSearchParams(window.location.search).get("requestId");
    if (!requestId) return;
    setView("requests");
    const timer = window.setTimeout(() => {
      document.getElementById(`waiter-request-${requestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [waiterRequests.length]);
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("orderId");
    if (!orderId) return;
    setView("dashboard");
    const timer = window.setTimeout(() => {
      document.getElementById(`staff-order-${orderId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [orders.length]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [cart, setCart] = useState<{ [id: string]: { name: string; price: number; quantity: number } }>({});
  const staffOrderIdempotencyKeyRef = useRef<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const getStaffName = () => {
    try {
      const savedSession = localStorage.getItem('novx_session');
      if (savedSession) {
        const session = JSON.parse(savedSession);
        if (session && session.name) return session.name;
      }
    } catch (e) {
      console.error("Failed to parse session", e);
    }
    return "";
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
      if (snap.exists()) {
        setRestaurant({ id: snap.id, ...snap.data() });
      }
    });
    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "==", restaurantId),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const sorted = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Order)
          .sort((a, b) => b.createdAt - a.createdAt);
        setOrders(sorted);
        setLoading(false);
      },
      (err) => {
        console.error("Unable to load orders", err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(
      collection(db, "banned_devices"),
      where("restaurantId", "==", restaurantId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setBannedDevices(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
      },
      (err) => {
        console.error("Unable to load banned devices", err);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(
      collection(db, "waiter_requests"),
      where("restaurantId", "==", restaurantId),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const sorted = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as WaiterRequest)
          .sort((a, b) => b.createdAt - a.createdAt);
        setWaiterRequests(sorted);
      },
      (err) => {
        console.error("Unable to load waiter requests", err);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const handleAcceptRequest = async (requestId: string) => {
    const staffName = getStaffName() || tr('ويتر الصالة', 'Waiter');
    try {
      await updateDoc(doc(db, "waiter_requests", requestId), {
        status: "accepted",
        waiterName: staffName,
        acceptedAt: Date.now()
      });
    } catch (err) {
      console.error("Unable to accept waiter request", err);
      alert(tr('تعذر قبول طلب الويتر. تحقق من اتصالك وحاول مجدداً.', 'Could not accept the waiter request. Check your connection and retry.'));
    }
  };

  const handleCompleteRequest = async (requestId: string) => {
    try {
      await updateDoc(doc(db, "waiter_requests", requestId), {
        status: "completed",
        completedAt: Date.now()
      });
    } catch (err) {
      console.error("Unable to complete waiter request", err);
      alert(tr('تعذر إكمال طلب الويتر. حاول مجدداً.', 'Could not complete the waiter request. Please retry.'));
    }
  };

  const updateStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const updateFields: any = { status: newStatus };
      if (newStatus === "preparing") {
        updateFields.approvedAt = new Date().toISOString();
      } else if (newStatus === "ready") {
        updateFields.readyAt = new Date().toISOString();
      }
      await updateDoc(doc(db, "orders", orderId), updateFields);
    } catch (err) {
      console.error("Unable to update order status", err);
      alert(tr('تعذر تحديث حالة الطلب. حاول مجدداً.', 'Could not update the order status. Please retry.'));
    }
  };

  useEffect(() => {
    if (view === "menu" && menuItems.length === 0) {
      setMenuLoading(true);
      const unsub = onSnapshot(
        query(
          collection(db, "menuItems"),
          where("restaurantId", "==", restaurantId)
        ),
        (snap) => {
          setMenuItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setMenuLoading(false);
        },
        (err) => {
          console.error("Unable to load menu items", err);
          setMenuLoading(false);
        }
      );
      return () => unsub();
    }
  }, [view, restaurantId, menuItems.length]);

  const handlePlaceWaiterOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const cartItems = Object.entries(cart)
      .filter(([_, value]) => (value as any).quantity > 0)
      .map(([id, value]) => {
        const item = value as { name: string; price: number; quantity: number };
        return {
          id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        };
      });

    if (cartItems.length === 0) {
      alert(tr('⚠️ يرجى أولاً إضافة أطباق إلى سلة الطلب.', 'Please add items to the order first.'));
      return;
    }
    if (!tableNumber.trim() || !customerName.trim()) {
      alert(tr('⚠️ يرجى تعبئة رقم الطاولة واسم الزبون.', 'Enter the table number and guest name.'));
      return;
    }

    try {
      const staffName = getStaffName();
      staffOrderIdempotencyKeyRef.current ||= crypto.randomUUID();
      const { error } = await supabase.rpc('create_staff_order', { p_restaurant_id: restaurantId, p_customer_name: customerName.trim(), p_table_number: tableNumber.trim(), p_notes: notes.trim(), p_items: cartItems.map((item) => ({ id: item.id, quantity: item.quantity })), p_waiter_name: staffName || tr('كابتن الصالة', 'Waiter'), p_idempotency_key: staffOrderIdempotencyKeyRef.current });
      if (error) throw error;
      staffOrderIdempotencyKeyRef.current = null;
      
      setCart({});
      setCustomerName("");
      setTableNumber("");
      setNotes("");
      alert(tr('✅ تم إرسال الطلب المباشر للمطبخ للتحضير الفوري!', 'Order sent to the kitchen.'));
      setView("dashboard");
    } catch (err) {
      console.error("Unable to place staff order", err);
      alert(tr('تعذر إرسال الطلب للمطبخ. تحقق من اتصالك وحاول مجدداً.', 'Could not send the order to the kitchen. Check your connection and retry.'));
    }
  };

  const handleBanCustomer = async (order: Order, reason: string, staffName: string) => {
    if (!order.deviceMetadata?.fingerprint) return;
    try {
      await addDoc(collection(db, "banned_devices"), {
        restaurantId,
        fingerprint: order.deviceMetadata.fingerprint,
        customerName: order.customerName,
        tableNumber: order.tableNumber,
        reason: reason,
        bannedBy: staffName,
        bannedAt: new Date().getTime(),
        deviceMetadata: {
          deviceType: order.deviceMetadata.deviceType || "",
          userAgent: order.deviceMetadata.userAgent || "",
          screenSize: order.deviceMetadata.screenSize || "",
          language: order.deviceMetadata.language || "",
        }
      });

      await updateDoc(doc(db, "orders", order.id), {
        status: "rejected",
        rejectedBy: staffName,
        rejectedRole: "waiter",
        rejectionReason: tr(`تم حظر هذا الزبون بسبب: ${reason}`, `Customer blocked: ${reason}`),
        updatedAt: new Date().toISOString(),
      });

      alert(tr(`✅ تم حظر الزبون "${order.customerName}" وبصمته الرقمية بنجاح!`, `Customer "${order.customerName}" was blocked.`));
    } catch (err) {
      console.error("Unable to ban customer", err);
      alert(tr('تعذر حظر الزبون. حاول مجدداً.', 'Could not block the customer. Please retry.'));
    }
  };

  const handleRejectOrder = async (orderId: string, reason: string, staffName: string) => {
    try {
      await updateDoc(doc(db, "orders", orderId), {
        status: "rejected",
        rejectedBy: staffName,
        rejectedRole: "waiter",
        rejectionReason: reason,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Unable to reject order", err);
      alert(tr('تعذر رفض الطلب. حاول مجدداً.', 'Could not reject the order. Please retry.'));
    }
  };

  const activeOrders = orders.filter((o) => !o.clearedForStaff);
  const pendingOrders = activeOrders.filter((o) => o.status === "pending");
  const readyOrders = activeOrders.filter((o) => o.status === "ready");
  const preparingOrders = activeOrders.filter((o) => o.status === "preparing");
  const pendingRequestsCount = waiterRequests.filter((r) => r.status === "pending").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20 min-h-[60vh]">
        <div className="w-12 h-12 border-t-2 border-brand-gold rounded-full animate-spin" />
      </div>
    );
  }

  const now = new Date().getTime();
  const expiryTime = restaurant?.endDate ? new Date(restaurant.endDate).getTime() : 0;
  const oneDay = 24 * 60 * 60 * 1000;
  const isExpiredAndLocked = expiryTime > 0 && (now - expiryTime > 3 * oneDay);
  const isSuspended = restaurant?.status === "suspended";

  if (isExpiredAndLocked || isSuspended) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[60vh] text-center space-y-8 bg-white border border-red-200" dir={dir}>
        <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-100">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <div className="space-y-4 max-w-lg">
          <h2 className="text-3xl font-display text-red-700 font-bold">{tr('تنبيه: انتهت صلاحية الاشتراك بالنظام!', 'Subscription expired')}</h2>
          <p className="text-sm text-text-muted leading-relaxed font-sans">
            {tr('لقد تم إيقاف الخدمة مؤقتًا بسبب انتهاء فترة الاشتراك والمهلة الإضافية المحددة للمطعم. يرجى التواصل مع الإدارة من أجل تجديد الخدمة.', 'Service is temporarily unavailable. Please contact management to renew the restaurant subscription.')}
          </p>
          <div className="bg-red-50 p-6 rounded-xl border border-red-100 text-center font-display space-y-2">
            <p className="text-xs text-red-800 font-bold">{tr('يرجى من الإدارة الاتصال بالدعم الفني للتجديد الفوري وتفعيل اللوحة:', 'Technical support:')}</p>
            <p className="text-2xl font-bold text-red-900 tracking-wider">{supportPhone}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 lg:space-y-12 pb-24 lg:pb-0" dir={dir}>
      {view === "dashboard" && (
        <StaffWelcomeCard
          logoUrl={restaurant?.logoUrl || systemLogo || '/ordova-mark.png'}
          logoAlt={restaurant?.logoUrl ? tr('شعار المطعم', 'Restaurant logo') : tr('شعار أوردوفا', 'Ordova logo')}
          eyebrow={restaurant?.restaurantName || tr('إدارة وتنسيق الردهة', 'Dining room operations')}
          title={tr('لوحة تحكم الخدمة', 'Waiter workspace')}
          description={tr('متابعة وخدمة الطاولات في الوقت الفعلي', 'Live table service and order tracking')}
          metrics={[
            { label: tr('طلبات جديدة', 'New orders'), value: pendingOrders.length },
            { label: tr('نداءات معلقة', 'Pending calls'), value: pendingRequestsCount },
          ]}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-delicate bg-white p-3 sm:p-4">
            <div className="flex items-center justify-center gap-3 rounded-xl bg-bg-paper px-4 py-3">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
              <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">{tr('تحديث ومزامنة فورية حية', 'Live sync')}</span>
            </div>
            <button
              onClick={async () => {
                setNotificationState("loading");
                setNotificationError(null);
                try { await enableStaffNotifications(restaurantId); setNotificationState("enabled"); }
                catch (error) { console.error(error); setNotificationError(error instanceof Error ? error.message : "notification_registration_failed"); setNotificationState("error"); }
              }}
              disabled={notificationState === "loading" || notificationState === "enabled"}
              className="flex items-center justify-center gap-2 rounded-xl border border-brand-gold px-4 py-3 text-[10px] font-bold text-brand-primary disabled:opacity-60"
            >
              <Bell className="w-4 h-4" />
              {notificationState === "enabled" ? tr('تم تفعيل الإشعارات', 'Notifications enabled') : notificationState === "loading" ? tr('جاري التفعيل...', 'Enabling...') : notificationState === "error" ? tr('تعذر التفعيل — أعد المحاولة', 'Try again') : tr('تفعيل تنبيهات النداء والطلبات', 'Enable call and order alerts')}
            </button>
            {notificationState === "enabled" && <button type="button"
              onClick={async () => {
                try {
                  await showDeviceNotificationTest();
                  setNotificationTestMessage(tr('تم إرسال تنبيه اختباري إلى هذا الجهاز. إن لم يظهر، تحقق من إعدادات إشعارات iPhone ووضع التركيز.', 'Device test queued. If it does not appear, check iPhone Notifications and Focus settings.'));
                } catch (error) {
                  console.error(error);
                  setNotificationTestMessage(tr('تعذر عرض التنبيه الاختباري على هذا الجهاز.', 'This device could not display a test alert.'));
                }
              }}
              className="rounded-xl border border-border-delicate px-4 py-3 text-[10px] font-bold text-brand-primary">
              {tr('اختبار إشعار هذا الجهاز', 'Test this device')}
            </button>}
            {notificationTestMessage && <p role="status" className="text-xs text-text-muted max-w-xs">{notificationTestMessage}</p>}
            {notificationError && <p role="alert" className="text-xs text-red-700 text-center lg:text-start max-w-xs">
              {notificationError === "web_push_not_configured" ? tr('مفتاح إشعارات المتصفح غير مضبوط على الخادم.', 'Browser push key is missing from this deployment.')
                : notificationError === "notifications_https_required" ? tr('الإشعارات تتطلب اتصال HTTPS آمن.', 'Notifications require a secure HTTPS connection.')
                : notificationError === "notifications_home_screen_required" ? tr('على iPhone افتح التطبيق من أيقونة الشاشة الرئيسية، ثم فعّل الإشعارات من داخل التطبيق.', 'On iPhone, open the app from its Home Screen icon, then enable notifications inside the app.')
                : notificationError === "notifications_unsupported" ? tr('هذا المتصفح لا يدعم إشعارات الويب.', 'This browser does not support web push notifications.')
                : notificationError === "notification_permission_denied" ? tr('تم رفض إذن الإشعارات. اسمح بالإشعارات لهذا الموقع من إعدادات المتصفح.', 'Notifications are blocked. Allow them for this site in your browser settings.')
                : notificationError === "authentication_required" ? tr('انتهت جلسة الدخول. سجّل الدخول مجدداً.', 'Your session expired. Sign in again.')
                : notificationError === "not_authorized_for_restaurant" ? tr('حسابك غير مخوّل لاستقبال إشعارات هذا المطعم.', 'Your account is not authorized for this restaurant.')
                : notificationError === "subscription_conflict" ? tr('هذا المتصفح مرتبط بحساب موظف آخر. ألغِ إشعارات الموقع من إعدادات المتصفح ثم أعد المحاولة.', 'This browser is linked to another staff account. Reset this site’s notification subscription in browser settings, then try again.')
                : tr('تعذر تسجيل الجهاز للإشعارات. تحقق من اتصالك وأعد المحاولة.', 'Could not register this device for notifications. Check your connection and try again.')}
            </p>}
      </div>

      {/* View Switcher for Waiter */}
      <div className="fixed lg:static bottom-[calc(.5rem+env(safe-area-inset-bottom))] inset-x-3 z-50 flex gap-1 rounded-2xl border border-border-delicate workspace-shell-panel lg:bg-bg-paper p-2 lg:p-1 shadow-[0_10px_30px_rgba(0,0,0,.16)] lg:shadow-sm">
        <button
          onClick={() => setView("dashboard")}
          className={`flex-1 min-w-0 h-16 lg:h-auto lg:py-4 rounded-xl text-center text-[10px] lg:text-xs font-bold transition-all flex flex-col lg:flex-row items-center justify-center gap-1 lg:gap-2 ${
            view === "dashboard"
              ? "bg-brand-primary text-white shadow-md font-bold"
              : "text-brand-primary hover:bg-white"
          }`}
        >
          <ClipboardList className="w-5 h-5 lg:hidden" />
          <span>{tr('الطلبات', 'Orders')}</span>
        </button>
        <button
          onClick={() => setView("requests")}
          className={`flex-1 min-w-0 h-16 lg:h-auto lg:py-4 rounded-xl text-center text-[10px] lg:text-xs font-bold transition-all flex flex-col lg:flex-row items-center justify-center gap-1 lg:gap-2 relative ${
            view === "requests"
              ? "bg-brand-primary text-white shadow-md font-bold"
              : "text-brand-primary hover:bg-white"
          }`}
        >
          <Bell className="w-5 h-5 lg:hidden" />
          <span>{tr('النداءات', 'Calls')}</span>
          {pendingRequestsCount > 0 && (
            <span className="bg-red-500 text-white font-sans text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse shrink-0">
              {pendingRequestsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setView("menu")}
          className={`flex-1 min-w-0 h-16 lg:h-auto lg:py-4 rounded-xl text-center text-[10px] lg:text-xs font-bold transition-all flex flex-col lg:flex-row items-center justify-center gap-1 lg:gap-2 ${
            view === "menu"
              ? "bg-brand-primary text-white shadow-md font-bold"
              : "text-brand-primary hover:bg-white"
          }`}
        >
          <ShoppingBag className="w-5 h-5 lg:hidden" />
          <span>{tr('طلب جديد', 'New order')}</span>
        </button>
        <button
          onClick={() => setView("bans")}
          className={`flex-1 min-w-0 h-16 lg:h-auto lg:py-4 rounded-xl text-center text-[10px] lg:text-xs font-bold transition-all flex flex-col lg:flex-row items-center justify-center gap-1 lg:gap-2 ${
            view === "bans"
              ? "bg-brand-primary text-white shadow-md font-bold"
              : "text-brand-primary hover:bg-white"
          }`}
        >
          <ShieldAlert className="w-5 h-5 lg:hidden" />
          <span>{tr('المحظورون', 'Blocked')}</span>
        </button>
      </div>

      {view === "menu" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start font-sans">
          {/* Main Menu items & filter column */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white border border-border-delicate p-6 space-y-4">
              <h3 className="text-xl font-display text-brand-primary font-bold">{tr('بوابة تسجيل الطلبات الفورية', 'Create table order')}</h3>
              <p className="text-xs text-text-muted">{tr('اختر الأغذية والمشروبات من المنيو أدناه وسجل الطلب باسم الزبون ورقم الطاولة لإمضائه مباشرة للمطبخ.', 'Choose menu items, enter the guest and table, then send the order directly to the kitchen.')}</p>
              
              <div className="relative">
                <Search className="w-4 h-4 text-brand-gold absolute right-4 top-3.5" />
                <input
                  type="text"
                  placeholder={tr('ابحث عن وجبة أو مشروب باسمه...', 'Search food or drinks...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-border-delicate py-3 px-12 text-sm font-medium text-brand-primary focus:outline-none focus:border-brand-primary focus:bg-white"
                />
              </div>

              {/* Category selector */}
              <div className="flex flex-wrap gap-2 pt-2 justify-start md:justify-start" dir={dir}>
                <button
                  onClick={() => setSelectedCategory("all")}
                  className={`px-4 py-2 text-xs font-bold border transition-all ${selectedCategory === "all" ? "bg-brand-gold text-white border-brand-gold" : "border-border-delicate text-text-muted hover:border-brand-primary"}`}
                >
                  {tr('جميع الوجبات', 'All items')} 🍽️
                </button>
                {Array.from(new Set(menuItems.map(item => item.category).filter(Boolean))).map((cat: any) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-2 text-xs font-bold border transition-all ${selectedCategory === cat ? "bg-brand-gold text-white border-brand-gold" : "border-border-delicate text-text-muted hover:border-brand-primary"}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {menuLoading ? (
              <div className="flex justify-center p-12">
                <div className="w-8 h-8 border-2 border-brand-gold border-t-transparent animate-spin rounded-full" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {menuItems
                  .filter(item => {
                    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
                    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
                    return matchesSearch && matchesCategory;
                  })
                  .map(item => {
                    const itemQty = cart[item.id]?.quantity || 0;
                    return (
                      <div key={item.id} className="bg-white border border-border-delicate p-5 flex flex-col justify-between gap-4 select-none relative">
                        {item.isAvailable === false && (
                          <div className="absolute inset-0 bg-white/90 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center p-4 text-center">
                            <span className="text-[10px] bg-red-50 text-red-800 border border-red-200 px-3 py-1 font-bold rounded-full mb-1">
                              {tr('غير متاح حالياً', 'Unavailable')} 🚫
                            </span>
                            <p className="text-[10px] text-text-muted">{tr('غير متاح للزبائن؛ يمكن للويتر إضافته عند توفره.', 'Unavailable to customers; staff may add it when available.')}</p>
                          </div>
                        )}
                        <div className="flex items-start gap-4 justify-between text-right">
                          <div className="space-y-1 text-right flex-1">
                            <h4 className="text-base font-bold text-brand-primary leading-tight">{item.name}</h4>
                            <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">{item.ingredients || tr('مكونات الشيف الطازجة', 'Fresh chef ingredients')}</p>
                            <p className="text-sm font-bold text-brand-gold font-sans">{item.price.toLocaleString()} {tr('د.ع', 'IQD')}</p>
                          </div>
                          {item.imageUrl && (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="w-16 h-16 sm:w-20 sm:h-20 object-cover border border-border-delicate/60 shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </div>

                        {/* Quantity selection buttons */}
                        <div className="flex items-center gap-3 justify-end border-t border-border-delicate/40 pt-3 mt-auto">
                          {itemQty > 0 ? (
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => {
                                  setCart(prev => {
                                    const next = { ...prev };
                                    if (next[item.id].quantity <= 1) {
                                      delete next[item.id];
                                    } else {
                                      next[item.id].quantity -= 1;
                                    }
                                    return next;
                                  });
                                }}
                                className="w-8 h-8 rounded-full border border-border-delicate flex items-center justify-center text-brand-primary hover:bg-slate-50 transition-colors"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="font-bold text-sm text-brand-primary font-sans w-5 text-center">{itemQty}</span>
                              <button
                                onClick={() => {
                                  setCart(prev => ({
                                    ...prev,
                                    [item.id]: {
                                      name: item.name,
                                      price: item.price,
                                      quantity: prev[item.id].quantity + 1
                                    }
                                  }));
                                }}
                                className="w-8 h-8 rounded-full border border-border-delicate flex items-center justify-center text-brand-primary hover:bg-slate-50 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setCart(prev => ({
                                  ...prev,
                                  [item.id]: {
                                    name: item.name,
                                    price: item.price,
                                    quantity: 1
                                  }
                                }));
                              }}
                              className="px-4 py-1.5 border border-brand-primary text-brand-primary text-xs font-bold hover:bg-brand-primary hover:text-white transition-all uppercase tracking-wider"
                            >
                              {tr('إضافة للطلب', 'Add')} +
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Checkout column */}
          <div className="bg-white border border-border-delicate p-6 sm:p-8 space-y-6 sticky top-6 text-right">
            <div className="space-y-1 pb-4 border-b border-border-delicate">
              <h3 className="text-lg font-display text-brand-primary font-bold flex items-center gap-2 justify-end">
                <ShoppingBag className="w-5 h-5 text-brand-gold shrink-0" />
                {tr('ملخص سلة وجبات الطاولة', 'Table order summary')}
              </h3>
              <p className="text-[10px] text-text-muted">{tr('مجموع الوجبات المحددة حالياً لتسجيلها للطاولة', 'Items selected for this table')}</p>
            </div>

            {/* Selected items list */}
            <div className="space-y-4 max-h-56 overflow-y-auto pr-1">
              {Object.entries(cart).filter(([_, v]) => (v as any).quantity > 0).length === 0 ? (
                <p className="text-center text-xs text-text-muted py-8 italic">{tr('سلة وجبات الطاولة فارغة', 'No items selected')}</p>
              ) : (
                Object.entries(cart)
                  .filter(([_, v]) => (v as any).quantity > 0)
                  .map(([itemId, val]) => {
                    const itemValue = val as { name: string; price: number; quantity: number };
                    return (
                      <div key={itemId} className="flex justify-between items-center text-xs border-b border-border-delicate/40 pb-2">
                        <div className="space-y-1 text-right">
                          <p className="font-bold text-brand-secondary">{itemValue.name}</p>
                          <p className="text-[10px] text-text-muted font-sans font-sans">{itemValue.price.toLocaleString()} {tr('د.ع', 'IQD')} × {itemValue.quantity}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-sans font-bold text-brand-primary">{(itemValue.price * itemValue.quantity).toLocaleString()} {tr('د.ع', 'IQD')}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setCart(prev => {
                                const next = { ...prev };
                                delete next[itemId];
                                return next;
                              });
                            }}
                            className="text-text-muted hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            {/* Table-side checkout configuration form */}
            <form onSubmit={handlePlaceWaiterOrder} className="space-y-4 pt-4 border-t border-border-delicate">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                  {tr('رقم الطاولة (إجباري)', 'Table number (required)')}
                </label>
                <input
                  required
                  type="text"
                  placeholder={tr('مثال: 12، 4، VIP...', 'Example: 12, 4, VIP...')}
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  className="w-full bg-slate-50 border border-border-delicate px-4 py-2.5 text-xs font-bold text-brand-primary focus:outline-none focus:border-brand-primary focus:bg-white text-right font-sans"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                  {tr('اسم الزبون (إجباري)', 'Guest name (required)')}
                </label>
                <input
                  required
                  type="text"
                  placeholder={tr('مثال: ضيف عابر، عائلة أحمد...', 'Example: Guest, Smith family...')}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full bg-slate-50 border border-border-delicate px-4 py-2.5 text-xs font-bold text-brand-primary focus:outline-none focus:border-brand-primary focus:bg-white text-right"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                  {tr('ملاحظات أو توجيهات إضافية للمطبخ', 'Kitchen notes')}
                </label>
                <textarea
                  placeholder={tr('مثال: بدون بصل، صوص إضافي، اللحم مستوي جيداً...', 'Example: No onion, extra sauce...')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-border-delicate px-4 py-2.5 text-xs text-brand-primary focus:outline-none focus:border-brand-primary focus:bg-white h-16 resize-none text-right"
                />
              </div>

              {/* Total display */}
              <div className="bg-slate-50 border border-border-delicate p-4 flex justify-between items-center text-sm">
                <span className="font-bold text-brand-primary">{tr('إجمالي الحساب:', 'Total:')}</span>
                <span className="text-xl font-display text-brand-primary font-bold font-sans">
                  {Object.values(cart)
                    .reduce((sum: number, val) => {
                      const current = val as { price: number; quantity: number };
                      return sum + current.price * current.quantity;
                    }, 0)
                    .toLocaleString()}{" "}
                  {tr('د.ع', 'IQD')}
                </span>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 shadow-lg flex items-center justify-center gap-2 transition-all font-sans"
              >
                {tr('تثبيت وإرسال الطلب للمطبخ', 'Send order to kitchen')} 🍳
              </button>
            </form>
          </div>
        </div>
      )}

      {view === "dashboard" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Urgent: Ready for Delivery */}
        <div className="lg:col-span-2 space-y-10">
          <div className="flex items-center gap-4 border-b border-border-delicate pb-4">
            <div className="h-0.5 w-12 bg-emerald-500" />
            <h2 className="text-sm font-bold text-brand-primary uppercase tracking-widest">
              {tr('طلبات جاهزة للتوصيل للزبائن فوراً', 'Ready for table service')}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <AnimatePresence mode="popLayout">
              {readyOrders.map((order) => (
                <WaiterOrderCard
                  key={order.id}
                  order={order}
                  onAction={() => updateStatus(order.id, "served")}
                  onReject={() => setRejectingOrder(order)}
                  onBan={() => setBanningOrder(order)}
                  type="ready"
                />
              ))}
            </AnimatePresence>
          </div>
          {readyOrders.length === 0 && (
            <div className="py-20 text-center bg-bg-paper border border-dashed border-border-delicate">
              <p className="font-display italic text-2xl text-brand-gold opacity-30">
                {tr('لا توجد طلبات جاهزة بانتظار تقديمها للطاولات حالياً.', 'No orders are ready for service.')}
              </p>
            </div>
          )}
        </div>

        {/* Pending Section */}
        <div className="space-y-10">
          <div className="flex items-center gap-4 border-b border-border-delicate pb-4">
            <div className="h-0.5 w-12 bg-brand-primary" />
            <h2 className="text-sm font-bold text-brand-primary uppercase tracking-widest">
              {tr('الطلبات الجديدة المعلقة من الطاولات', 'New table orders')}
            </h2>
          </div>

          <div className="space-y-8">
            <AnimatePresence mode="popLayout">
              {pendingOrders.map((order) => (
                <WaiterOrderCard
                  key={order.id}
                  order={order}
                  onAction={() => updateStatus(order.id, "preparing")}
                  onReject={() => setRejectingOrder(order)}
                  onBan={() => setBanningOrder(order)}
                  type="pending"
                />
              ))}
            </AnimatePresence>
            {pendingOrders.length === 0 && (
              <div className="py-20 text-center bg-bg-paper border border-dashed border-border-delicate">
                <p className="font-display italic text-xl text-brand-gold opacity-30 text-center px-10 leading-relaxed">
                  {tr('قائمة الطلبات الجديدة فارغة الآن.', 'No new orders.')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Preparing Section */}
        <div className="space-y-10">
          <div className="flex items-center gap-4 border-b border-border-delicate pb-4">
            <div className="h-0.5 w-12 bg-brand-gold" />
            <h2 className="text-sm font-bold text-brand-primary uppercase tracking-widest">
              {tr('طلبات قيد التحضير والطهي في المطبخ', 'Orders being prepared')}
            </h2>
          </div>

          <div className="space-y-8">
            <AnimatePresence mode="popLayout">
              {preparingOrders.map((order) => (
                <WaiterOrderCard
                  key={order.id}
                  order={order}
                  onAction={() => {}}
                  onReject={() => setRejectingOrder(order)}
                  onBan={() => setBanningOrder(order)}
                  type="preparing"
                />
              ))}
            </AnimatePresence>
            {preparingOrders.length === 0 && (
              <div className="py-20 text-center bg-bg-paper border border-dashed border-border-delicate">
                <p className="font-display italic text-xl text-brand-gold opacity-30 text-center px-10 leading-relaxed">
                   {tr('لا توجد طلبات قيد التحضير حالياً.', 'No orders are being prepared.')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    )}

      {view === "requests" && (
        <div className="space-y-8 text-right font-sans">
          <div className="bg-white border border-border-delicate p-6 sm:p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-gold" />
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h3 className="text-xl font-display text-brand-primary font-bold flex items-center gap-3">
                  <Bell className="text-brand-gold w-5 h-5 animate-pulse" />
                  {tr('نداءات وطلبات الطاولة من الزبائن', 'Table calls')}
                </h3>
                <p className="text-xs text-text-muted mt-2">
                  {tr('هنا تصل نداءات الزبائن مباشرة من الطاولات (طلب حساب، نادل، استفسارات، إضافات). يرجى قبوله وتلبية الطلب فوراً.', 'Customer calls arrive here for bills, assistance, questions, and extras.')}
                </p>
              </div>
              <div className="flex gap-4 bg-bg-paper border border-border-delicate p-1 text-xs font-bold leading-none">
                <span className="px-4 py-2.5 bg-brand-primary text-white">{tr('النشطة:', 'Active:')} {waiterRequests.filter(r => r.status !== "completed").length}</span>
                <span className="px-4 py-2.5 text-text-muted">{tr('المكتملة اليوم:', 'Completed:')} {waiterRequests.filter(r => r.status === "completed").length}</span>
              </div>
            </div>
          </div>

          {waiterRequests.length === 0 ? (
            <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                <Bell className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-display text-brand-primary font-bold">{tr('لا توجد طلبات نداء حالياً', 'No table calls')}</h4>
              <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                {tr('لا توجد طاولات تطلب الويتر في الوقت الحالي. الخدمة مستقرة!', 'No tables currently need assistance.')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {waiterRequests.map((req) => {
                const minutesAgo = Math.floor((Date.now() - req.createdAt) / 60000);
                const timeStr = minutesAgo <= 0 ? tr('الآن', 'Now') : tr(`منذ ${minutesAgo} د`, `${minutesAgo}m ago`);
                
                return (
                  <div
                    key={req.id}
                    id={`waiter-request-${req.id}`}
                    className={`bg-white border p-6 sm:p-8 flex flex-col justify-between gap-6 transition-all relative ${
                      req.status === "pending"
                        ? "border-brand-gold border-r-4 border-r-brand-gold shadow shadow-brand-gold/10"
                        : req.status === "accepted"
                        ? "border-emerald-200 border-r-4 border-r-emerald-500 bg-emerald-50/10 shadow-sm"
                        : "border-border-delicate text-text-muted/60 bg-slate-50/50"
                    }`}
                  >
                    <div className="space-y-4 flex-1">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <span className="text-[10px] font-mono text-brand-gold bg-brand-gold/5 border border-brand-gold/15 px-2 py-0.5 rounded">
                            {timeStr}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {req.status === "pending" && (
                            <span className="bg-red-50 text-red-800 border border-red-200 text-[10px] font-bold px-2.5 py-1 rounded-full animate-pulse">
                              {tr('بانتظار الاستجابة', 'Waiting')} 🔔
                            </span>
                          )}
                          {req.status === "accepted" && (
                            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              {tr('تحت تلبية:', 'Accepted by:')} {req.waiterName} 🏃‍♂️
                            </span>
                          )}
                          {req.status === "completed" && (
                            <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              {tr('اكتملت الخدمة', 'Completed')} ✓
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2 text-right">
                        <h4 className="text-lg font-bold text-brand-primary">
                          {tr('طاولة', 'Table')} <span className="font-mono text-xl text-brand-primary">{req.tableNumber}</span>
                          <span className="text-xs text-text-muted font-normal mr-2">({req.customerName})</span>
                        </h4>
                        
                        <div className="bg-bg-paper border border-border-delicate p-4 rounded-xl">
                          <p className="text-xs text-text-muted italic">{tr('الاحتياج المطلوب:', 'Request:')}</p>
                          <p className="text-sm font-bold text-brand-primary mt-1 leading-relaxed">
                            {req.reason}
                          </p>
                        </div>

                        {req.distanceMeters !== undefined && (
                          <div className="mt-3 text-[10px] font-sans font-bold text-amber-700 bg-amber-500/5 px-3 py-2 border border-amber-500/10 flex items-center justify-between rounded">
                            <span>📍 {tr('موقع الزبون الجغرافي:', 'Customer location:')}</span>
                            <span>
                              {req.distanceMeters > 150 ? (
                                <span className="text-red-700 bg-red-500/5 border border-red-500/10 px-1.5 py-0.5 animate-pulse ml-1.5 rounded">{tr('بعيد خارج المطعم', 'Outside restaurant')} ({Math.round(req.distanceMeters)} {tr('متر', 'm')})</span>
                              ) : (
                                <span className="text-emerald-700 bg-emerald-500/5 border border-emerald-500/10 px-1.5 py-0.5 rounded ml-1.5">{tr('داخل الصالة', 'Inside')} ({Math.round(req.distanceMeters)} {tr('متر', 'm')})</span>
                              )}
                              {req.coordinates && `[${req.coordinates.lat.toFixed(4)}, ${req.coordinates.lng.toFixed(4)}]`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {req.status !== "completed" && (
                      <div className="pt-4 border-t border-border-delicate flex gap-3">
                        {req.status === "pending" ? (
                          <button
                            onClick={() => handleAcceptRequest(req.id)}
                            className="flex-1 py-3 bg-brand-gold text-white text-xs font-bold hover:bg-brand-primary transition-all shadow-md font-sans"
                          >
                            {tr('تأكيد تلبية النداء والذهاب للطاولة', 'Accept and go to table')} 🏃‍♂️
                          </button>
                        ) : (
                          <button
                            onClick={() => handleCompleteRequest(req.id)}
                            className="flex-1 py-3 bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all shadow-md font-sans"
                          >
                            {tr('تأكيد اكتمال الخدمة وحل الطلب', 'Complete request')} ✅
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === "bans" && (
        <div className="space-y-6 text-right font-sans">
          <div className="bg-white border border-border-delicate p-6 sm:p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-primary" />
            <h3 className="text-xl font-display text-brand-primary font-bold flex items-center gap-3">
              <ShieldAlert className="text-red-600 w-5 h-5 shrink-0" />
              {tr('قائمة الأجهزة والزبائن المحظورين من الدخول للمنيو الرقمي', 'Blocked customers and devices')}
            </h3>
            <p className="text-xs text-text-muted mt-2">{tr('بصفتك كابتن خدمة صالة، يمكنك فك حظر أي جهاز زبون لتمكينه من إعادة تصفح المنيو والطلب مجدداً.', 'Unblock a customer device to restore menu and ordering access.')}</p>
          </div>

          {bannedDevices.length === 0 ? (
            <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                <Users className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-display text-brand-primary font-bold">{tr('لا يوجد زبائن محظورون حالياً', 'No blocked customers')}</h4>
              <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                {tr('قائمة الحظر فارغة تماماً. جميع زبائن صالة المطعم بإمكانهم الطلب بنجاح!', 'All customers can currently place orders.')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {bannedDevices.map((banned) => (
                <div
                  key={banned.id}
                  className="bg-white border border-red-200 p-6 sm:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-sm border-r-4 border-r-red-600 relative overflow-hidden"
                >
                  <div className="space-y-4 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bg-red-50 text-red-800 border border-red-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
                        {tr('محظور من الخدمة الرقمية', 'Blocked')} 🚫
                      </span>
                      <span className="text-[10px] font-mono text-text-muted">
                        {tr('تاريخ الحظر:', 'Blocked:')} {banned.bannedAt ? safeFormatDate(banned.bannedAt, "yyyy/MM/dd | hh:mm a") : tr('غير محدد', 'Unknown')}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <h5 className="text-base sm:text-lg font-bold text-brand-primary">
                        {tr('الزبون:', 'Customer:')} <span className="text-red-700 font-bold">{banned.customerName}</span> ({tr('طاولة', 'Table')} {banned.tableNumber || tr('غير محددة', 'Unknown')})
                      </h5>
                      <p className="text-xs text-text-main leading-relaxed">
                        {tr('سبب الحظر:', 'Reason:')} <strong className="text-red-950 bg-red-50 px-2.5 py-1.5 rounded font-bold">{banned.reason}</strong>
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {tr('الموظف المسؤول:', 'Staff:')} <span className="text-brand-primary font-bold bg-slate-100 px-2 py-0.5 rounded">{banned.bannedBy || tr('إدارة المطعم', 'Management')}</span>
                      </p>
                    </div>

                    <div className="bg-bg-paper border border-border-delicate p-4 rounded-xl space-y-2 text-xs font-mono">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-muted">
                        <div>{tr('الجهاز:', 'Device:')} <span className="font-sans font-bold text-brand-primary">{banned.deviceMetadata?.deviceType ? localizeDeviceType(banned.deviceMetadata.deviceType, language) : tr('غير معلوم', 'Unknown')}</span></div>
                        <div>{tr('البصمة:', 'Fingerprint:')} <span className="text-red-600 font-bold font-mono text-xs">{banned.fingerprint}</span></div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      if (confirm(tr(`هل أنت متأكد من إلغاء حظر الزبون "${banned.customerName}" وتمكينه من الطلب مجدداً؟`, `Unblock "${banned.customerName}"?`))) {
                        try {
                          await deleteDoc(doc(db, "banned_devices", banned.id));
                          alert(tr(`تم إلغاء حظر الزبون "${banned.customerName}" بنجاح!`, `Customer "${banned.customerName}" was unblocked.`));
                        } catch (err) {
                          alert(tr('فشل في إلغاء الحظر. يرجى المحاولة لاحقاً.', 'Could not unblock this customer. Try again.'));
                        }
                      }
                    }}
                    className="px-5 py-3 border border-border-delicate hover:border-emerald-600 text-text-muted hover:text-emerald-700 hover:bg-emerald-50 text-[11px] font-bold rounded transition-all shrink-0 w-full md:w-auto text-center font-sans shadow-sm"
                  >
                    {tr('فك الحظر والترخيص بالطلب', 'Unblock customer')} 🔓
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {rejectingOrder && (
          <RejectOrderModal
            order={rejectingOrder}
            onClose={() => setRejectingOrder(null)}
            onConfirm={async (reason, name) => {
              await handleRejectOrder(rejectingOrder.id, reason, name);
              setRejectingOrder(null);
            }}
            defaultStaffName={getStaffName()}
          />
        )}
        {banningOrder && (
          <BanCustomerModal
            order={banningOrder}
            onClose={() => setBanningOrder(null)}
            onConfirm={async (reason, name) => {
              await handleBanCustomer(banningOrder, reason, name);
              setBanningOrder(null);
            }}
            defaultStaffName={getStaffName()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function WaiterOrderCard({
  order,
  onAction,
  onReject,
  onBan,
  type,
}: {
  order: Order;
  onAction: () => void;
  onReject: () => void;
  onBan: () => void;
  type: "pending" | "preparing" | "ready";
  key?: string;
}) {
  const { language, tr } = useLanguage();
  const isPreparing = type === "preparing";
  return (
    <motion.div
      id={`staff-order-${order.id}`}
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white border border-border-delicate p-5 sm:p-10 space-y-6 sm:space-y-8 group transition-all duration-500 hover:shadow-2xl relative"
    >
      <div
        className={`absolute top-0 right-0 w-1.5 h-full ${type === "pending" ? "bg-brand-primary" : type === "preparing" ? "bg-brand-gold" : "bg-emerald-500"}`}
      />

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h3 className="font-display text-xl sm:text-2xl italic text-brand-primary tracking-tight">
            {tr('طاولة', 'Table')} <span className="not-italic inline-block font-sans font-bold">{order.tableNumber}</span>{" "}
            <span className="text-text-muted opacity-40 font-bold ml-2">
              / {order.customerName}
            </span>
          </h3>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em]">
            <span className="flex items-center gap-2">
              <Timer className="w-3 h-3" />{" "}
              <span className="not-italic inline-block font-sans">{safeFormatDate(order.createdAt, "hh:mm a")}</span>
            </span>
            <span className="text-text-muted/40 hidden sm:inline">|</span>
            <span className="text-text-muted/40 flex items-center gap-1.5">
              {tr('رقم الطلب:', 'Order:')} <span className="text-brand-gold font-sans font-bold text-xs bg-brand-gold/10 px-2 py-0.5 rounded">{order.orderNumber || `#${order.id.slice(-6).toUpperCase()}`}</span>
            </span>
          </div>
        </div>
        <div className="text-right sm:text-left w-full sm:w-auto border-t border-border-delicate/40 sm:border-t-0 pt-3 sm:pt-0">
          <p className="text-xl font-display not-italic text-brand-primary">
            <span className="font-sans font-bold">{order.totalAmount.toLocaleString()}</span>{" "}
            <span className="text-[10px] font-bold opacity-40 uppercase">
              {tr('د.ع', 'IQD')}
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-4 border-y border-border-delicate py-6 sm:py-8 bg-bg-paper -mx-5 px-5 sm:-mx-10 sm:px-10 text-right">
        {order.items.map((item, i) => (
          <div
            key={i}
            className="flex flex-col border-b border-border-delicate/20 pb-2 last:border-b-0"
          >
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-text-muted">
              <div className="flex items-center gap-4">
                <span className="text-brand-gold italic"><span className="not-italic font-sans font-bold">{item.quantity}</span>×</span>
                <span className="text-brand-primary">{item.name}</span>
              </div>
              <span className="font-sans text-brand-gold">{(item.price * item.quantity).toLocaleString()} {tr('د.ع', 'IQD')}</span>
            </div>
            {item.customizationText && (
              <span className="text-[9px] text-brand-gold font-bold mt-1 block">
                ✨ {tr('الخيارات:', 'Options:')} {item.customizationText}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Customer Distance details (Requirement 2) */}
      <div className="bg-slate-50 border border-slate-100 p-3.5 flex flex-col gap-1 text-right text-xs">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-bold text-brand-gold uppercase tracking-wider">📍 {tr('معلومات جهاز ومسافة الزبون', 'Customer location')}</span>
          <span className="font-bold text-brand-primary">{tr('البصمة:', 'Fingerprint:')} <span className="font-mono select-all">{order.deviceMetadata?.fingerprint?.slice(0, 10) || tr('لا توجد (ويتر)', 'Staff order')}</span></span>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          <span className="font-bold text-brand-primary">{tr('المسافة المقدرة:', 'Estimated distance:')}</span>{" "}
          {order.deviceMetadata?.distanceMeters !== undefined ? (
            <span className="font-bold text-red-600 font-sans">
              {order.deviceMetadata.distanceMeters >= 1000
                ? `${(order.deviceMetadata.distanceMeters / 1000).toFixed(2)} ${tr('كم', 'km')}`
                : `${Math.round(order.deviceMetadata.distanceMeters)} ${tr('متر', 'm')}`}
            </span>
          ) : (
            <span className="text-amber-600 font-bold">{tr('غير متوفرة (طلب مباشر من كابتن الصالة)', 'Unavailable (staff order)')}</span>
          )}
        </p>
        {order.deviceMetadata?.deviceType && (
          <p className="text-[9px] text-text-muted/70 font-sans">
            {tr('الجهاز:', 'Device:')} {localizeDeviceType(order.deviceMetadata.deviceType, language)} | {order.deviceMetadata.language}
          </p>
        )}
      </div>

      {order.notes && (
        <div className="p-4 sm:p-6 bg-red-50 border border-red-100 flex items-start gap-4 italic text-right">
          <Bell className="w-5 h-5 text-red-400 shrink-0" />
          <div className="space-y-1">
            <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest">
              {tr('توجيه خاص من الزبون', 'Customer note')}
            </p>
            <p className="text-xs text-red-900/80 leading-relaxed font-bold">
              {order.notes}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isPreparing ? (
          <div className="space-y-3">
            <div className="w-full py-5 sm:py-6 border border-border-delicate bg-bg-paper text-brand-gold/40 text-[9px] font-bold uppercase tracking-[0.5em] flex items-center justify-center gap-4">
              <Clock className="w-4 h-4 animate-spin" />
              {tr('جاري تحضير وطهي الطلب بالمطبخ...', 'The kitchen is preparing this order...')}
            </div>
            <button
              type="button"
              onClick={onReject}
              className="w-full py-3 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors text-xs font-bold flex items-center justify-center gap-2"
            >
              {tr('رفض وإلغاء هذا الطلب', 'Reject order')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onAction}
              className={`flex-1 py-4 sm:py-5 text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xl text-white ${
                type === "pending"
                  ? "bg-brand-primary hover:bg-brand-secondary"
                  : "bg-emerald-500 hover:bg-emerald-600"
              }`}
            >
              {type === "pending"
                ? tr('إرسال وتحضير الطلب في المطبخ', 'Send to kitchen')
                : tr('تأكيد تقديم الطلب للطاولة وتوصيله', 'Mark served')}
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onReject}
              className="py-4 sm:py-5 px-6 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors text-xs font-bold flex items-center justify-center gap-2"
            >
              {tr('رفض الطلب', 'Reject')}
            </button>
          </div>
        )}

        {order.deviceMetadata?.fingerprint && (
          <button
            type="button"
            onClick={onBan}
            className="w-full py-3 bg-red-600 text-white font-bold text-[10px] tracking-widest uppercase hover:bg-red-700 transition-all flex items-center justify-center gap-2"
          >
            🚫 {tr('حظر جهاز هذا الزبون ومنعه من الخدمة الرقمية', 'Block this customer device')}
          </button>
        )}
      </div>
    </motion.div>
  );
}

interface RejectOrderModalProps {
  order: Order;
  onClose: () => void;
  onConfirm: (reason: string, staffName: string) => void;
  defaultStaffName: string;
}

export function RejectOrderModal({
  order,
  onClose,
  onConfirm,
  defaultStaffName,
}: RejectOrderModalProps) {
  const { dir, tr } = useLanguage();
  const [reason, setReason] = useState("");
  const [staffName, setStaffName] = useState(defaultStaffName || "");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(tr('يرجى كتابة سبب الرفض بالتفصيل.', 'Enter a rejection reason.'));
      return;
    }
    if (reason.trim().length < 4) {
      setError(tr('يرجى كتابة سبب حقيقي للرفض (4 أحرف على الأقل).', 'The reason must be at least 4 characters.'));
      return;
    }
    if (!staffName.trim()) {
      setError(tr('يرجى إدخال اسم الموظف المسؤول المسجل للرفض.', 'Enter the responsible staff member.'));
      return;
    }
    setError("");
    onConfirm(reason.trim(), staffName.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" dir={dir}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white border border-border-delicate p-6 sm:p-10 w-full max-w-lg shadow-2xl space-y-6 relative text-right"
      >
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest leading-none">{tr('إجراء تراجعي فوري', 'Order action')}</p>
          <h3 className="text-xl font-display text-brand-primary font-bold font-black">{tr('رفض الطلب الحالي', 'Reject order')} #<span className="font-sans text-sm">{order.id.slice(-6).toUpperCase()}</span></h3>
          <p className="text-xs text-text-muted leading-relaxed">
            {tr('أكد سبب رفض طلب الطاولة', 'Confirm the reason for rejecting the order for table')} <span className="font-bold text-brand-primary">({order.tableNumber})</span> — <span className="font-bold text-brand-primary">({order.customerName})</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs font-bold text-red-700">
              ⚠️ {error}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.2em] block leading-none">
                {tr('اسم الموظف المسؤول عن الرفض', 'Responsible staff member')}
              </label>
              {defaultStaffName && (
                <span className="text-[9px] text-red-600 font-bold flex items-center gap-1">
                  🔒 {tr('مؤمن ومغلق (جلسة الدخول)', 'From signed-in account')}
                </span>
              )}
            </div>
            <input
              type="text"
              required
              readOnly={!!defaultStaffName}
              placeholder={tr('مثال: أحمد علي، سارة محمد...', 'Example: Ahmed, Sarah...')}
              value={staffName}
              onChange={(e) => !defaultStaffName && setStaffName(e.target.value)}
              className={`w-full border px-4 py-3 text-sm font-bold focus:outline-none ${
                defaultStaffName 
                  ? "bg-bg-paper border-border-delicate/60 text-brand-primary/50 cursor-not-allowed select-none" 
                  : "bg-bg-paper border-border-delicate text-brand-primary focus:border-red-500"
              }`}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.2em] block leading-none">
              {tr('سبب الرفض (إجباري)', 'Rejection reason (required)')}
            </label>
            <textarea
              required
              rows={3}
              placeholder={tr('مثال: المواد غير متوفرة حالياً، الزبون غادر الطاولة، تم تكرار الطلب...', 'Example: Item unavailable or duplicate order...')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-bg-paper border border-border-delicate p-4 text-xs text-brand-primary focus:outline-none focus:border-red-500 resize-none font-bold"
            />
          </div>

          <div className="flex gap-4 pt-4 border-t border-border-delicate">
            <button
              type="submit"
              className="flex-1 py-3 bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-all shadow-md uppercase tracking-wider"
            >
              {tr('رفض وإلغاء الطلب نهائياً', 'Reject order')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-border-delicate text-xs font-bold text-brand-primary hover:bg-bg-paper transition-all"
            >
              {tr('التراجع والإغلاق', 'Cancel')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

interface BanCustomerModalProps {
  order: Order;
  onClose: () => void;
  onConfirm: (reason: string, staffName: string) => void;
  defaultStaffName: string;
}

export function BanCustomerModal({
  order,
  onClose,
  onConfirm,
  defaultStaffName,
}: BanCustomerModalProps) {
  const { dir, tr } = useLanguage();
  const [reason, setReason] = useState("");
  const [staffName, setStaffName] = useState(defaultStaffName || "");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(tr('يرجى كتابة سبب الحظر بالتفصيل.', 'Enter a blocking reason.'));
      return;
    }
    if (reason.trim().length < 4) {
      setError(tr('يرجى كتابة سبب حقيقي للحظر (4 أحرف على الأقل).', 'The reason must be at least 4 characters.'));
      return;
    }
    if (!staffName.trim()) {
      setError(tr('يرجى إدخال اسم الموظف المسؤول الذي اتخذ القرار.', 'Enter the responsible staff member.'));
      return;
    }
    setError("");
    onConfirm(reason.trim(), staffName.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" dir={dir}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white border border-border-delicate p-6 sm:p-10 w-full max-w-lg shadow-2xl space-y-6 relative text-right"
      >
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest leading-none">{tr('إجراء أمني حازم', 'Security action')}</p>
          <h3 className="text-xl font-display text-brand-primary font-bold">🚫 {tr('حظر الزبون وتجميد البصمة', 'Block customer device')}</h3>
          <p className="text-xs text-text-muted leading-relaxed">
            {tr('سيتم حجب جهاز الزبون', 'This will block the device for')} <span className="font-bold text-red-600">{order.customerName}</span> ({tr('طاولة', 'Table')} {order.tableNumber}).
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs font-bold text-red-700">
              ⚠️ {error}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.2em] block leading-none">
                {tr('اسم الموظف المسؤول عن قرار الحظر', 'Responsible staff member')}
              </label>
              {defaultStaffName && (
                <span className="text-[9px] text-red-600 font-bold flex items-center gap-1 font-sans">
                  🔒 {tr('مسجل للتقرير', 'Recorded')} ({defaultStaffName})
                </span>
              )}
            </div>
            <input
              type="text"
              required
              readOnly={!!defaultStaffName}
              placeholder={tr('مثال: كابتن أحمد، سارة...', 'Example: Ahmed, Sarah...')}
              value={staffName}
              onChange={(e) => !defaultStaffName && setStaffName(e.target.value)}
              className={`w-full border px-4 py-3 text-sm font-bold focus:outline-none ${
                defaultStaffName 
                  ? "bg-bg-paper border-border-delicate/60 text-brand-primary/50 cursor-not-allowed select-none" 
                  : "bg-bg-paper border-border-delicate text-brand-primary focus:border-red-500"
              }`}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-[0.2em] block leading-none">
              {tr('سبب وتبرير الحظر للزبون (إجباري)', 'Blocking reason (required)')}
            </label>
            <textarea
              required
              rows={3}
              placeholder={tr('مثال: يطلب للتسلية، بعيد عن المطعم ولا يجيب على كابتن الصالة، سلوك غير لائق...', 'Example: abusive or fraudulent ordering...')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-bg-paper border border-border-delicate p-4 text-xs text-brand-primary focus:outline-none focus:border-red-500 resize-none font-bold"
            />
          </div>

          <div className="flex gap-4 pt-4 border-t border-border-delicate">
            <button
              type="submit"
              className="flex-1 py-3 bg-red-700 text-white text-xs font-bold hover:bg-red-850 transition-all shadow-md uppercase tracking-wider font-sans"
            >
              {tr('تأكيد حظر جهاز الزبون فوراً', 'Block customer device')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-border-delicate text-xs font-bold text-brand-primary hover:bg-bg-paper transition-all"
            >
              {tr('إلغاء', 'Cancel')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
