import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BarChart3,
  Users,
  UtensilsCrossed,
  ClipboardList,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  QrCode,
  Download,
  AlertCircle,
  Phone,
  ChefHat,
  Search,
  UserPlus,
  HelpingHand,
  MapPin,
  ExternalLink,
  Bell,
  ChevronRight,
  Edit2,
  Building2,
  PlusCircle,
  X,
  CreditCard,
  PauseCircle,
  PlayCircle,
  Upload,
  Camera,
  ShieldAlert,
  Info,
} from "lucide-react";
import {
  collection,
  addDoc,
  query,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  where,
  onSnapshot,
  orderBy,
  getDoc,
  runTransaction,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestore-utils";
import { Restaurant, Waiter, MenuItem, Order, OrderStatus, SecurityAlert } from "../types";
import QRCode from "react-qr-code";
import { format } from "date-fns";

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
import { BanCustomerModal } from "./WaiterDashboard";

interface RestaurantDashboardProps {
  restaurantId: string;
  activeTab?: "overview" | "waiters" | "orders" | "menu" | "help" | "qr" | "alerts";
}

export default function RestaurantDashboard({
  restaurantId,
  activeTab: externalTab,
}: RestaurantDashboardProps) {
  const [internalTab, setInternalTab] = useState<
    "overview" | "waiters" | "orders" | "archive" | "menu" | "help" | "qr" | "alerts"
  >("overview");
  const activeTab = externalTab || internalTab;
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kitchenStaff, setKitchenStaff] = useState<Waiter[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [bannedDevices, setBannedDevices] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStaffModal, setShowStaffModal] = useState<{
    open: boolean;
    role: "waiter" | "kitchen";
    staff?: Waiter;
  } | null>(null);
  const [showProductModal, setShowProductModal] = useState<{
    open: boolean;
    item?: MenuItem;
  } | null>(null);
  const [banningOrder, setBanningOrder] = useState<Order | null>(null);
  const [selectedOrderForTimeline, setSelectedOrderForTimeline] = useState<Order | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const [staffLinkCopied, setStaffLinkCopied] = useState(false);

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

  const [selectedProfitDate, setSelectedProfitDate] = useState<string>(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [archiveDate, setArchiveDate] = useState<string>(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [archiveSearch, setArchiveSearch] = useState("");
  const [alertsSubTab, setAlertsSubTab] = useState<
    "order_devices" | "security_alerts" | "banned_customers" | "system_announcements"
  >("system_announcements");

  const [latInput, setLatInput] = useState<string>("");
  const [lngInput, setLngInput] = useState<string>("");
  const [savingLocation, setSavingLocation] = useState(false);
  const [fetchingLocationGPS, setFetchingLocationGPS] = useState(false);

  useEffect(() => {
    if (restaurant) {
      if (restaurant.latitude !== undefined && latInput === "") {
        setLatInput(restaurant.latitude.toString());
      }
      if (restaurant.longitude !== undefined && lngInput === "") {
        setLngInput(restaurant.longitude.toString());
      }
    }
  }, [restaurant]);

  const handleUpdateLocation = async () => {
    const latNum = parseFloat(latInput);
    const lngNum = parseFloat(lngInput);
    if (isNaN(latNum) || isNaN(lngNum)) {
      alert("يرجى إدخال قيم جغرافية (خط العرض وخط الطول) صحيحة.");
      return;
    }
    try {
      setSavingLocation(true);
      await updateDoc(doc(db, "restaurants", restaurantId), {
        latitude: latNum,
        longitude: lngNum
      });
      alert("تم حفظ موقع المطعم الجغرافي بنجاح! سيتم فحص وجود الزبائن تبعاً لهذا الموقع بدقة.");
      if (restaurant) {
        setRestaurant({ ...restaurant, latitude: latNum, longitude: lngNum });
      }
    } catch (err) {
      alert("فشل في حفظ إعدادات الموقع الجغرافي.");
    } finally {
      setSavingLocation(false);
    }
  };

  const handleFetchCurrentGPS = () => {
    if (!navigator.geolocation) {
      alert("متصفحك لا يدعم تتبع وتحديد المواقع الجغرافية GPS.");
      return;
    }
    setFetchingLocationGPS(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatInput(position.coords.latitude.toString());
        setLngInput(position.coords.longitude.toString());
        setFetchingLocationGPS(false);
        alert("تم التقاط إحداثيات موقعك الحالي بنجاح! انقر على زر 'حفظ موقع المطعم' لتثبيت الإعدادات.");
      },
      (error) => {
        setFetchingLocationGPS(false);
        alert("فشل في التقاط موقعك الجغرافي. يرجى تفعيل إذن الوصول للموقع في متصفحك أو إدخالها يدوياً.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      if (!restaurant) return;
      const currentCats = restaurant.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"];
      if (currentCats.includes(newCategoryName.trim())) {
        alert("هذا القسم موجود بالفعل في قائمتك.");
        return;
      }
      const updated = [...currentCats, newCategoryName.trim()];
      await updateDoc(doc(db, "restaurants", restaurantId), { categories: updated });
      setNewCategoryName("");
      setRestaurant(prev => prev ? { ...prev, categories: updated } : null);
    } catch (err) {
      alert("فشل في إضافة القسم. يرجى المحاولة مجدداً.");
    }
  };

  const handleDeleteCategory = async (catToDelete: string) => {
    if (!confirm(`هل أنت متأكد من حذف قسم "${catToDelete}"؟ الوجبات المصنفة تحت هذا القسم ستبقى ولكن تصنيفها سيصبح غير محدد.`)) {
      return;
    }
    try {
      if (!restaurant) return;
      const currentCats = restaurant.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"];
      const updated = currentCats.filter(c => c !== catToDelete);
      await updateDoc(doc(db, "restaurants", restaurantId), { categories: updated });
      setRestaurant(prev => prev ? { ...prev, categories: updated } : null);
    } catch (err) {
      alert("فشل في حذف القسم.");
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
        reason,
        bannedBy: staffName,
        bannedAt: Date.now(),
        deviceMetadata: order.deviceMetadata
      });
      alert(`🚫 تم حظر الزبون "${order.customerName}" بنجاح وتجميد بصمة جهازه لمنع إجرائه لأي طلبات مستقبلية.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "banned_devices");
    }
  };

  const executeResetOrderCounter = async () => {
    try {
      setIsResetting(true);
      const resDocRef = doc(db, "restaurants", restaurantId);
      
      // 1. Transactional update to safely set currentOrderNumber back to 0
      await runTransaction(db, async (transaction) => {
        const resSnap = await transaction.get(resDocRef);
        if (resSnap.exists()) {
          transaction.update(resDocRef, {
            currentOrderNumber: 0
          });
        }
      });

      // 2. Hide active orders from staff dashboard (set clearedForStaff to true)
      const unclearedOrders = orders.filter(o => !o.clearedForStaff);
      let successCount = 0;

      if (unclearedOrders.length > 0) {
        await Promise.all(
          unclearedOrders.map(async (o) => {
            try {
              await updateDoc(doc(db, "orders", o.id), { clearedForStaff: true });
              successCount++;
            } catch (orderErr) {
              console.error(`Failed to clear order ${o.id}:`, orderErr);
            }
          })
        );
      }

      alert(`✅ تم تصفير عداد أرقام الطلبات بنجاح!\n• سيبدأ الطلب القادم من الرقم 1.\n• تم أرشفة وإخفاء ${successCount} من الطلبات القديمة لبدء يوم عمل جديد.`);
    } catch (err: any) {
      console.error("Failed to reset order counter:", err);
      alert("❌ فشل تصفير عداد الطلبيات. السبب: " + (err?.message || err));
    } finally {
      setIsResetting(false);
    }
  };

  const todayStr = new Date().toDateString();
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const dailyOrders = orders.filter(o => {
    try {
      return new Date(o.createdAt).toDateString() === todayStr;
    } catch {
      return false;
    }
  });
  const dailyOrdersCount = dailyOrders.length;
  const dailyEarnings = dailyOrders.reduce((sum, o) => o.status !== 'cancelled' ? sum + o.totalAmount : sum, 0);

  const monthlyOrders = orders.filter(o => {
    try {
      const oDate = new Date(o.createdAt);
      return oDate.getMonth() === currentMonth && oDate.getFullYear() === currentYear;
    } catch {
      return false;
    }
  });
  const monthlyOrdersCount = monthlyOrders.length;
  const monthlyEarnings = monthlyOrders.reduce((sum, o) => o.status !== 'cancelled' ? sum + o.totalAmount : sum, 0);

  // Profit analytical date filters
  const selectedDateOrders = orders.filter(o => {
    try {
      const oDate = new Date(o.createdAt);
      const formatYMD = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      };
      return formatYMD(oDate) === selectedProfitDate;
    } catch {
      return false;
    }
  });
  const selectedDateOrdersCount = selectedDateOrders.length;
  const selectedDateEarnings = selectedDateOrders.reduce((sum, o) => o.status !== 'cancelled' ? sum + o.totalAmount : sum, 0);
  const selectedDateCancelled = selectedDateOrders.filter(o => o.status === 'cancelled').length;

  useEffect(() => {
    const unsubRestaurant = onSnapshot(
      doc(db, "restaurants", restaurantId),
      (snap) => {
        if (snap.exists()) {
          setRestaurant({ id: snap.id, ...snap.data() } as Restaurant);
        }
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `restaurants/${restaurantId}`)
    );

    const unsubWaiters = onSnapshot(
      query(
        collection(db, "waiters"),
        where("restaurantId", "==", restaurantId),
      ),
      (snapshot) => {
        setWaiters(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Waiter),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "waiters"),
    );

    const unsubKitchen = onSnapshot(
      query(
        collection(db, "kitchen_staff"),
        where("restaurantId", "==", restaurantId),
      ),
      (snapshot) => {
        setKitchenStaff(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Waiter),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "kitchen_staff"),
    );

    const unsubMenu = onSnapshot(
      query(
        collection(db, "menuItems"),
        where("restaurantId", "==", restaurantId),
      ),
      (snapshot) => {
        setMenuItems(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "menuItems"),
    );

    const unsubOrders = onSnapshot(
      query(
        collection(db, "orders"),
        where("restaurantId", "==", restaurantId),
      ),
      (snapshot) => {
        const sorted = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Order)
          .sort((a, b) => b.createdAt - a.createdAt);
        setOrders(sorted);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "orders"),
    );

    const unsubAlerts = onSnapshot(
      query(
        collection(db, "security_alerts"),
        where("restaurantId", "==", restaurantId),
      ),
      (snapshot) => {
        const sorted = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as SecurityAlert)
          .sort((a, b) => b.timestamp - a.timestamp);
        setAlerts(sorted);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "security_alerts"),
    );

    const unsubBanned = onSnapshot(
      query(
        collection(db, "banned_devices"),
        where("restaurantId", "==", restaurantId),
      ),
      (snapshot) => {
        const sorted = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() } as any))
          .sort((a, b) => b.bannedAt - a.bannedAt);
        setBannedDevices(sorted);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "banned_devices"),
    );

    const unsubAnnouncements = onSnapshot(
      query(
        collection(db, "announcements"),
        where("targetRestaurantId", "in", ["all", restaurantId]),
      ),
      (snapshot) => {
        const sorted = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() } as any))
          .sort((a, b) => {
            const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
            const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
            return tB - tA;
          });
        setAnnouncements(sorted);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, "announcements"),
    );

    return () => {
      unsubRestaurant();
      unsubWaiters();
      unsubKitchen();
      unsubMenu();
      unsubOrders();
      unsubAlerts();
      unsubBanned();
      unsubAnnouncements();
    };
  }, [restaurantId]);

  const fetchRestaurant = async () => {
    try {
      const docRef = doc(db, "restaurants", restaurantId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setRestaurant({ id: docSnap.id, ...docSnap.data() } as Restaurant);
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.GET,
        `restaurants/${restaurantId}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const updateFields: any = { status: newStatus };
      if (newStatus === "preparing") {
        updateFields.approvedAt = Date.now();
      } else if (newStatus === "ready") {
        updateFields.readyAt = Date.now();
      }
      await updateDoc(doc(db, "orders", orderId), updateFields);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `orders/${orderId}`);
    }
  };

  const deleteMenuItem = async (itemId: string) => {
    if (confirm("هل أنت متأكد من حذف هذا المنتج؟")) {
      try {
        await deleteDoc(doc(db, "menuItems", itemId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `menuItems/${itemId}`);
      }
    }
  };

  const toggleStaffStatus = async (
    id: string,
    current: string,
    role: "waiter" | "kitchen",
  ) => {
    const coll = role === "waiter" ? "waiters" : "kitchen_staff";
    try {
      await updateDoc(doc(db, coll, id), {
        status: current === "active" ? "suspended" : "active",
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `${coll}/${id}`);
    }
  };

  const deleteStaff = async (id: string, role: "waiter" | "kitchen") => {
    if (confirm("حذف هذا الموظف؟")) {
      const coll = role === "waiter" ? "waiters" : "kitchen_staff";
      try {
        await deleteDoc(doc(db, coll, id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `${coll}/${id}`);
      }
    }
  };

  const resolveAlert = async (alertId: string) => {
    try {
      await updateDoc(doc(db, "security_alerts", alertId), { status: 'resolved' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `security_alerts/${alertId}`);
    }
  };

  const deleteAlert = async (alertId: string) => {
    if (confirm("هل أنت متأكد من حذف هذا التنبيه نهائياً؟")) {
      try {
        await deleteDoc(doc(db, "security_alerts", alertId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `security_alerts/${alertId}`);
      }
    }
  };

  const cancelAllOrdersByFingerprint = async (fingerprint: string) => {
    if (confirm("هل أنت متأكد من إلغاء وحظر جميع طلبات هذا العميل (البصمة الرقمية المحفوظة له)؟ سيتم إلغاء جميع الطلبات المعلقة المرتبطة بهذا الجهاز تلقائياً.")) {
      try {
        const suspiciousOrders = orders.filter(o => o.deviceMetadata?.fingerprint === fingerprint && o.status !== 'cancelled');
        await Promise.all(
          suspiciousOrders.map(o => 
            updateDoc(doc(db, "orders", o.id), { status: 'cancelled', notes: (o.notes || "") + " [ملغى تلقائياً بسبب شبهة احتيال بالتنبيهات]" })
          )
        );
        alert(`تم إلغاء ${suspiciousOrders.length} طلبات معلقة بنجاح!`);
      } catch (err) {
        alert("فشل في إلغاء طلبات البصمة.");
      }
    }
  };

  const downloadQR = () => {
    const svg = document.getElementById("menu-qr");
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        const pngFile = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.download = `${restaurant?.restaurantName}-Menu-QR.png`;
        downloadLink.href = `${pngFile}`;
        downloadLink.click();
      };
      img.src = "data:image/svg+xml;base64," + btoa(svgData);
    }
  };

    if (!restaurant) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[60vh] text-center space-y-6 bg-white border border-border-delicate" dir="rtl">
        <AlertCircle className="w-16 h-16 text-brand-gold" />
        <h2 className="text-3xl font-display text-brand-primary italic">المطعم غير موجود أو قد يكون تم حذفه</h2>
        <p className="text-text-muted max-w-md">نظراً لتحديث إعدادات خادم قاعدة بيانات المشروع، قد تكون بيانات تسجيل دخولك تنتمي للنظام السابق. يرجى تسجيل الخروج ثم الدخول كأدمن لتسجيل المطعم مجدداً.</p>
        <button 
          onClick={() => {
            localStorage.removeItem('novx_session');
            window.location.reload();
          }}
          className="bg-brand-primary text-white px-8 py-4 font-bold text-xs uppercase tracking-widest hover:bg-brand-secondary transition-all"
        >
          تسجيل الخروج والعودة لصفحة الدخول
        </button>
      </div>
    );
  }

  const now = new Date().getTime();
  const expiryTime = restaurant.endDate ? new Date(restaurant.endDate).getTime() : 0;
  const oneDay = 24 * 60 * 60 * 1000;
  const isWarningBefore = expiryTime > 0 && now < expiryTime && (expiryTime - now <= 3 * oneDay);
  const isWarningAfter = expiryTime > 0 && now >= expiryTime && (now - expiryTime <= 3 * oneDay);
  const isExpiredAndLocked = expiryTime > 0 && (now - expiryTime > 3 * oneDay);

  if (isExpiredAndLocked) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[60vh] text-center space-y-8 bg-white border border-red-200" dir="rtl">
        <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-100">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <div className="space-y-4 max-w-lg">
          <h2 className="text-3xl font-display text-red-700 font-bold">عذراً، انتهى اشتراك النظام!</h2>
          <p className="text-text-muted leading-relaxed font-sans">
            لقد انتهت فترة الاشتراك وفترة السماح الممنوحة لهذا المطعم بالكامل. تم إيقاف تشغيل لوحة التحكم مؤقتاً.
          </p>
          <div className="bg-red-50 p-6 rounded-xl border border-red-100 text-center font-display space-y-2">
            <p className="text-xs text-red-800 font-bold">يرجى الاتصال بفريق الدعم الفني فوراً من أجل تجديد الاشتراك وتفعيل النظام:</p>
            <p className="text-2xl font-bold text-red-900 tracking-wider">{supportPhone}</p>
          </div>
        </div>
        <button 
          onClick={() => {
            localStorage.removeItem('novx_session');
            window.location.reload();
          }}
          className="bg-brand-primary text-white px-8 py-4 font-bold text-xs uppercase tracking-widest hover:bg-brand-secondary transition-all"
        >
          تسجيل الخروج والعودة لصفحة الدخول
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-12" dir="rtl">
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="p-4 bg-red-600 text-white rounded-none flex items-center justify-center gap-3 text-right font-sans font-bold text-xs" id="admin-offline-banner">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span>تنبيه الاتصال: إنترنت الإدارة غير مستقر أو منقطع حالياً! لا تقلق، البيانات مخزنة أوفلاين وسيقوم المتصفح بإرسال جميع تحديثات الطلبات فور إعادة الاتصال بالشبكة.</span>
        </div>
      )}

      {/* Expiry alerts */}
      {isWarningBefore && (
        <div className="p-6 bg-amber-50 border border-amber-200 text-amber-900 rounded-none flex items-center gap-4 text-right">
          <Bell className="w-6 h-6 text-amber-600 shrink-0" />
          <p className="text-sm font-bold font-sans">
            تنبيه هام: اشتراككم قارب على الانتهاء وسوف ينتهي بعد أقل من 3 أيام. يرجى تجديد الاشتراك لضمان استمرار الخدمة دون انقطاع. للاتصال بالدعم الفني: <span className="font-display font-medium text-amber-800">{supportPhone}</span>
          </p>
        </div>
      )}

      {isWarningAfter && (
        <div className="p-6 bg-red-50 border border-red-200 text-red-950 rounded-none flex items-center gap-4 text-right">
          <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 animate-pulse" />
          <p className="text-sm font-bold font-sans">
            تنبيه حرج جداً: لقد انتهى اشتراك نظامكم رسميًا! النظام قيد فترة التجريب والمهلة الإضافية وستتوقف الخدمة تماماً بعد 3 أيام من تاريخ الانتهاء. اتصلوا بالدعم للتجديد الفوري: <span className="font-display font-bold text-red-800">{supportPhone}</span>
          </p>
        </div>
      )}

      {/* Header Section */}
      <div className="bg-white border border-border-delicate p-6 sm:p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-primary" />
        <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-right gap-6 sm:gap-8 w-full">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-bg-paper border border-border-delicate flex items-center justify-center overflow-hidden shrink-0">
              {restaurant.logoUrl ? (
                <img
                  src={restaurant.logoUrl}
                  className="w-full h-full object-cover"
                  alt="Logo"
                  referrerPolicy="no-referrer"
                />
              ) : systemLogo ? (
                <img
                  src={systemLogo}
                  className="w-full h-full object-contain p-1"
                  alt="System Logo"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Building2 className="w-8 h-8 sm:w-10 sm:h-10 text-brand-gold/30" />
              )}
            </div>
            <div className="space-y-2 text-right">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                  لوحة التحكم للمدير المالك
                </span>
                {systemLogo && restaurant.logoUrl && (
                  <div className="h-3 w-px bg-border-delicate" />
                )}
                {systemLogo && restaurant.logoUrl && (
                  <img src={systemLogo} className="h-4 object-contain opacity-70" alt="System Brand" referrerPolicy="no-referrer" />
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                أهلاً بك،{" "}
                <span className="text-brand-gold">
                  {restaurant.restaurantName}
                </span>
              </h1>
              <p className="text-xs font-bold text-text-muted/60 tracking-wider">
                المدير المسؤول: {restaurant.managerName}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 sm:gap-8 text-center sm:text-right min-w-[240px] border-t border-border-delicate lg:border-t-0 pt-6 lg:pt-0 w-full lg:w-auto">
            <div className="space-y-1">
              <p className="text-[9px] font-fold text-brand-gold font-bold tracking-widest opacity-60">
                حالة الاشتراك
              </p>
              <span
                className={`text-xs font-bold tracking-widest ${restaurant.status === "active" ? "text-emerald-600" : "text-red-600"}`}
              >
                {restaurant.status === "active"
                  ? "باقة بريميوم نشطة"
                  : "منتهي الاشتراك"}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-brand-gold tracking-widest opacity-60">
                تاريخ التجديد
              </p>
              <p className="text-sm font-bold text-brand-primary">
                {safeFormatDate(restaurant.endDate, "yyyy/MM/dd")}
              </p>
            </div>
          </div>
        </div>
      </div>

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
                title="المبيعات اليومية"
                value={`${dailyEarnings.toLocaleString()} د.ع`}
                label={`بواقع ${dailyOrdersCount} طلباً اليوم`}
                icon={<ClipboardList className="w-5 h-5" />}
              />
              <StatCard
                title="أرباح هذا الشهر"
                value={`${monthlyEarnings.toLocaleString()} د.ع`}
                label={`بواقع ${monthlyOrdersCount} طلباً هذا الشهر`}
                icon={<BarChart3 className="w-5 h-5" />}
              />
              <StatCard
                title="خدمة الصالة والموظفين"
                value={waiters.length}
                label="الموظفين المسجلين"
                icon={<Users className="w-5 h-5" />}
              />
              <StatCard
                title="فريق الطهي"
                value={kitchenStaff.length}
                label="طاقم المطبخ المعتمد"
                icon={<ChefHat className="w-5 h-5" />}
              />
            </div>

            {/* Specific Day Profit Analyzer */}
            <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-6 relative overflow-hidden text-right" dir="rtl">
              <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-gold" />
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">أرباح أي يوم تريده</p>
                    <h3 className="text-xl font-display text-brand-primary italic font-bold">مستكشف مبيعات الأيام السابقة</h3>
                  </div>
                  {/* Date input styled nicely */}
                  <input
                    type="date"
                    value={selectedProfitDate}
                    onChange={(e) => setSelectedProfitDate(e.target.value)}
                    className="bg-bg-paper border border-border-delicate px-4 py-2 text-sm font-bold text-brand-primary focus:outline-none w-full sm:w-auto"
                  />
                </div>
                
                {/* Stats for the chosen day */}
                <div className="grid grid-cols-3 gap-4 pt-2">
                  <div className="p-4 bg-bg-paper border border-border-delicate text-right">
                    <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest">مبيعات هذا اليوم</p>
                    <p className="text-md sm:text-lg font-display text-brand-primary not-italic font-bold truncate mt-1">
                      <span className="font-sans">{selectedDateEarnings.toLocaleString()}</span> <span className="text-[10px]">د.ع</span>
                    </p>
                  </div>
                  <div className="p-4 bg-bg-paper border border-border-delicate text-right">
                    <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-sans">طلبات مكتملة</p>
                    <p className="text-md sm:text-lg font-display text-brand-primary not-italic font-bold mt-1">
                      <span className="font-sans">{selectedDateOrders.filter(o => o.status !== 'cancelled').length}</span>
                    </p>
                  </div>
                  <div className="p-4 bg-bg-paper border border-border-delicate text-right">
                    <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest font-sans">طلبات ملغاة</p>
                    <p className="text-md sm:text-lg font-display text-red-800 not-italic font-bold mt-1">
                      <span className="font-sans">{selectedDateCancelled}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Geofence & Location Control Center */}
            <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-6 relative overflow-hidden text-right" dir="rtl">
              <div className="absolute top-0 right-0 w-1.5 h-full bg-emerald-600" />
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                    التحقق الجغرافي والوقاية من الطلبات والتصفح المزيف (GPS Anti-Spam)
                  </p>
                  <h3 className="text-xl font-display text-brand-primary italic font-bold">تحديد موقع المطعم الجغرافي</h3>
                  <p className="text-xs text-text-muted max-w-3xl leading-relaxed">
                    من خلال تحديد إحداثيات خطوط الطول والعرض لموقع مطعمك، حتى يظهر لك موقع الزبون بالنسبة لموقع مطعمك لكشف الطلبات الوهمية.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleFetchCurrentGPS}
                  disabled={fetchingLocationGPS}
                  className="px-5 py-3 bg-white border border-brand-primary text-brand-primary text-[10px] font-bold uppercase tracking-wider hover:bg-brand-primary hover:text-white transition-all duration-300 disabled:opacity-40 rounded-none shrink-0 font-sans"
                >
                  {fetchingLocationGPS ? "جاري جلب موقعك..." : "تحديد موقعي الحالي بالـ GPS 📍"}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 font-sans">
                <div className="space-y-1.5 text-right">
                  <label className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">خط العرض (Latitude)</label>
                  <input
                    type="text"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    placeholder="مثال: 33.3250"
                    className="w-full bg-bg-paper border border-border-delicate px-4 py-3.5 text-sm font-semibold text-brand-primary focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5 text-right">
                  <label className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">خط الطول (Longitude)</label>
                  <input
                    type="text"
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    placeholder="مثال: 44.3400"
                    className="w-full bg-bg-paper border border-border-delicate px-4 py-3.5 text-sm font-semibold text-brand-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center gap-4 justify-between border-t border-border-delicate/40 font-sans">
                <div className="text-xs text-text-muted flex items-center gap-1.5">
                  {restaurant?.latitude && restaurant?.longitude ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <span className="w-2 h-2 bg-emerald-600 rounded-full" />
                      الموقع الحالي مثبت: ({restaurant.latitude.toFixed(5)}, {restaurant.longitude.toFixed(5)})
                    </span>
                  ) : (
                    <span className="text-amber-700 font-semibold flex items-center gap-1 animate-pulse">
                      <span className="w-2 h-2 bg-amber-500 rounded-full" />
                      يرجى تعيين موقعك لتفعيل الوقاية الجغرافية (المنصور، بغداد افتراضياً)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleUpdateLocation}
                  disabled={savingLocation}
                  className="w-full sm:w-auto px-10 py-4 bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all duration-300 disabled:opacity-40 rounded-none text-center font-sans"
                >
                  {savingLocation ? "جاري الحفظ والترميز الجغرافي..." : "حفظ وتثبيت موقع المطعم 💾"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-8">
              <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-8">
                <div className="flex items-center gap-4">
                  <div className="w-1.5 h-6 bg-brand-gold" />
                  <h3 className="text-xl font-display text-brand-primary italic tracking-tight">
                    الفعاليات والطلبات الأخيرة
                  </h3>
                </div>
                <div className="space-y-4">
                  {orders.slice(0, 5).map((order) => (
                    <div
                      key={order.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-bg-paper border-r-4 border-brand-primary w-full"
                    >
                      <div className="space-y-1 text-right">
                        <p className="text-sm font-bold text-brand-primary">
                          {order.customerName}{" "}
                          <span className="text-text-muted opacity-40">
                            / طاولة {order.tableNumber}
                          </span>
                        </p>
                        <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                          {safeFormatDate(order.createdAt, "hh:mm a")}
                        </p>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t border-border-delicate/40 sm:border-t-0 pt-4 sm:pt-0">
                        <span className="text-sm font-display italic text-brand-primary font-bold">
                          {order.totalAmount.toLocaleString()} د.ع
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest p-2 bg-white border border-border-delicate min-w-[80px] text-center">
                          {order.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {orders.length === 0 && (
                    <div className="text-center py-20 text-text-muted italic opacity-40">
                      لا توجد طلبات واردة حالياً.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "waiters" && (
          <motion.div
            key="waiters"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-16"
          >
            {/* Waiters Section */}
            <div className="space-y-8">
              <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end gap-6">
                <div className="space-y-2 text-right">
                  <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                    موظفين الصالة
                  </h2>
                </div>
                <button
                  onClick={() =>
                    setShowStaffModal({ open: true, role: "waiter" })
                  }
                  className="px-10 py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all shadow-xl text-center"
                >
                  إضافة كابتن / ويتر جديد
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {waiters.map((w) => (
                  <StaffCard
                    key={w.id}
                    staff={w}
                    onToggle={() => toggleStaffStatus(w.id, w.status, "waiter")}
                    onDelete={() => deleteStaff(w.id, "waiter")}
                    onEdit={() =>
                      setShowStaffModal({
                        open: true,
                        role: "waiter",
                        staff: w,
                      })
                    }
                  />
                ))}
              </div>
            </div>

            {/* Kitchen Staff Section */}
            <div className="space-y-8 pt-16 border-t border-border-delicate">
              <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end gap-6">
                <div className="space-y-2 text-right">
                  <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                    قسم المطبخ
                  </h2>
                </div>
                <button
                  onClick={() =>
                    setShowStaffModal({ open: true, role: "kitchen" })
                  }
                  className="px-10 py-5 border border-brand-gold text-brand-gold text-[11px] font-bold uppercase tracking-widest hover:bg-brand-gold hover:text-white transition-all text-center"
                >
                  اضافة موظف جديد
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {kitchenStaff.map((w) => (
                  <StaffCard
                    key={w.id}
                    staff={w}
                    onToggle={() =>
                      toggleStaffStatus(w.id, w.status, "kitchen")
                    }
                    onDelete={() => deleteStaff(w.id, "kitchen")}
                    onEdit={() =>
                      setShowStaffModal({
                        open: true,
                        role: "kitchen",
                        staff: w,
                      })
                    }
                    accent="gold"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "orders" && (
          <motion.div
            key="orders"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-12"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white border border-border-delicate p-6 sm:p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-gold" />
              <div className="space-y-1.5 text-right flex-1">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                  إدارة وتنظيم طلبات الزبائن (المقود الذكي)
                </p>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-display text-brand-primary font-bold italic">لوحة إدارة الطلبيات المباشرة</h3>
                  <span className="text-xs bg-bg-paper text-brand-primary py-1 px-2 border border-border-delicate font-mono font-bold">
                    العدد الحالي: {restaurant?.currentOrderNumber || 0}
                  </span>
                </div>
                <p className="text-xs text-text-muted leading-relaxed">
                  هنا تعرض جميع الطلبات الجارية مقسمة حسب الحالة. يمكنك تصفير عداد ترتيب الطلبات والبدء بيوم عمل جديد من خلال الزر الجانبي.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(true)}
                disabled={isResetting}
                className="w-full md:w-auto px-6 py-4 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all shrink-0 flex items-center justify-center gap-2 rounded-none"
              >
                {isResetting ? "جاري تصفير العداد..." : "🧹 تصفير العداد والبدء بيوم عمل جديد"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
              <OrderColumn
                title="طلبات جديدة واردة"
                orders={orders.filter((o) => o.status === "pending" && !o.clearedForStaff)}
                type="pending"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
              />
              <OrderColumn
                title="قيد التحضير بالمطبخ"
                orders={orders.filter((o) => o.status === "preparing" && !o.clearedForStaff)}
                type="preparing"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
              />
              <OrderColumn
                title="جاهزة للتسليم"
                orders={orders.filter((o) => o.status === "ready" && !o.clearedForStaff)}
                type="ready"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
              />
              <OrderColumn
                title="طلبات منتهية وتاريخية"
                orders={orders.filter((o) => o.status === "served" && !o.clearedForStaff)}
                type="served"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
                isHistory
              />
              <OrderColumn
                title="طلبات مرفوضة ومسترجعة"
                orders={orders.filter((o) => o.status === "rejected" && !o.clearedForStaff)}
                type="rejected"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
                isHistory
              />
            </div>
          </motion.div>
        )}

        {activeTab === "archive" && (() => {
          const formatYMD = (date: Date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
          };

          const archiveOrders = orders.filter(o => {
            try {
              const oDate = new Date(o.createdAt);
              const matchesDate = formatYMD(oDate) === archiveDate;
              if (!matchesDate) return false;

              if (archiveSearch) {
                const searchLower = archiveSearch.toLowerCase().trim();
                return (
                  o.customerName.toLowerCase().includes(searchLower) ||
                  o.tableNumber.toLowerCase().includes(searchLower) ||
                  (o.orderNumber && String(o.orderNumber) === searchLower) ||
                  o.id.toLowerCase().includes(searchLower)
                );
              }
              return true;
            } catch {
              return false;
            }
          });

          // Stats calculation
          const completedOrders = archiveOrders.filter(o => o.status === "served");
          const rejectedOrders = archiveOrders.filter(o => o.status === "rejected");
          const activeOrders = archiveOrders.filter(o => ["pending", "preparing", "ready"].includes(o.status));
          
          const totalRevenue = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);
          const totalEstimatedRevenue = archiveOrders.reduce((sum, o) => o.status !== "rejected" ? sum + o.totalAmount : sum, 0);

          return (
            <motion.div
              key="archive"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-12 text-right font-sans"
            >
              {/* Header */}
              <div className="bg-white border border-border-delicate p-6 sm:p-12 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-gold" />
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2">
                    <h3 className="text-2xl sm:text-3xl font-display text-brand-primary font-bold italic">
                      الأرشيف التاريخي العام للطلب
                    </h3>
                    <p className="text-xs text-text-muted">
                      مراجعة وتتبع شامل لجميع الطلبيات السابقة ببياناتها ومبيعاتها اليومية لأي يوم تختاره من التقويم.
                    </p>
                  </div>
                  
                  {/* Date & Search Filters */}
                  <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-primary uppercase tracking-wider">اختر اليوم المطلوب</label>
                      <input
                        type="date"
                        value={archiveDate}
                        onChange={(e) => setArchiveDate(e.target.value)}
                        className="bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-medium focus:outline-none focus:border-brand-primary focus:bg-white text-right font-sans h-[48px]"
                      />
                    </div>
                    <div className="space-y-1.5 flex-1 sm:w-64">
                      <label className="block text-[10px] font-bold text-brand-primary uppercase tracking-wider">بحث مخصص في الطلبات</label>
                      <input
                        type="text"
                        placeholder="رقم طاولة، اسم زبون، رقم الطلب..."
                        value={archiveSearch}
                        onChange={(e) => setArchiveSearch(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-medium focus:outline-none focus:border-brand-primary focus:bg-white text-right font-sans h-[48px]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Day Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">إجمالي إيرادات اليوم المقبولة</span>
                  <p className="text-2xl sm:text-3xl font-display text-emerald-600 font-bold">
                    {totalRevenue.toLocaleString()}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">د.ع</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">من {completedOrders.length} طلب مستلم بنجاح</span>
                </div>

                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">الطلبات النشطة / قيد المعالجة</span>
                  <p className="text-2xl sm:text-3xl font-display text-brand-gold font-bold">
                    {activeOrders.length}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">طلبيات</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">خلال الوردية الجارية حالياً</span>
                </div>

                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">طلبات مرفوضة ومسترجعة</span>
                  <p className="text-2xl sm:text-3xl font-display text-red-600 font-bold">
                    {rejectedOrders.length}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">طلبيات</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">مرفوضة من الويترز أو المطبخ</span>
                </div>

                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">مجموع العمليات المالية المقدرة</span>
                  <p className="text-2xl sm:text-3xl font-display text-brand-primary font-bold">
                    {totalEstimatedRevenue.toLocaleString()}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">د.ع</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">مجموع الطلبات لليوم {archiveOrders.length}</span>
                </div>
              </div>

              {/* Archive Orders List */}
              <div className="space-y-6">
                <div className="flex items-center gap-4 justify-start">
                  <div className="h-0.5 w-12 bg-brand-primary opacity-30" />
                  <p className="text-sm font-bold text-brand-primary uppercase tracking-widest">
                    سجل الطلبيات لليوم المحدد ({archiveOrders.length})
                  </p>
                </div>

                {archiveOrders.length === 0 ? (
                  <div className="bg-white border border-border-delicate p-12 py-24 text-center space-y-4">
                    <p className="font-display italic text-xl text-brand-gold opacity-30">لا توجد أي بيانات مسجلة لهذا التاريخ.</p>
                    <p className="text-xs text-text-muted max-w-sm mx-auto">تأكد من اختيار يوم المبيعات المناسب أو مراجعة فلاتر البحث أعلاه.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {archiveOrders.map((o) => (
                      <div
                        key={o.id}
                        className="bg-white border border-border-delicate p-6 sm:p-8 space-y-5 rounded-sm relative shadow-sm hover:shadow-lg transition-all"
                      >
                        <div className={`absolute top-0 right-0 w-1.5 h-full ${
                          o.status === "served" ? "bg-emerald-600" :
                          o.status === "rejected" ? "bg-red-600" : "bg-brand-gold"
                        }`} />

                        <div className="flex justify-between items-start gap-4 border-b border-border-delicate/40 pb-3">
                          <div className="space-y-1">
                            <h4 className="font-display text-lg font-bold text-brand-primary">
                              طاولة {o.tableNumber} <span className="text-xs text-text-muted font-normal">/ {o.customerName}</span>
                            </h4>
                            <span className="text-[10px] font-mono text-text-muted/50 block">المعرف: #{o.id.slice(-6).toUpperCase()}</span>
                          </div>

                          <div className="text-left font-mono">
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded ${
                              o.status === "served" ? "bg-emerald-50 text-emerald-800" :
                              o.status === "rejected" ? "bg-red-50 text-red-800" : "bg-brand-gold/15 text-brand-gold"
                            }`}>
                              {o.status === "served" ? "✔ مكتمل وموصل" :
                               o.status === "rejected" ? "✘ مرفوض" : "⚡ نشط/قيد المعالجة"}
                            </span>
                            <span className="text-[10px] font-medium text-text-muted block mt-2">
                              {o.orderNumber ? `رقم الطلب: ${o.orderNumber}` : "رقم الطلب: غير محدد"}
                            </span>
                          </div>
                        </div>

                        {/* Order Items */}
                        <div className="space-y-2">
                          {o.items.map((item, idx) => (
                            <div key={idx} className="space-y-0.5 border-b border-border-delicate/20 pb-1 last:border-0 text-right">
                              <div className="flex justify-between text-xs text-text-main">
                                <span>{item.name} <strong className="text-brand-gold">x{item.quantity}</strong></span>
                                <span className="font-mono opacity-80">{(item.price * item.quantity).toLocaleString()} د.ع</span>
                              </div>
                              {item.customizationText && (
                                <p className="text-[10px] text-brand-gold font-bold">
                                  ✨ الخيارات: {item.customizationText}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="border-t border-border-delicate/40 pt-4 flex justify-between items-center bg-slate-50/50 -mx-6 sm:-mx-8 px-6 sm:px-8 -mb-6 sm:-mb-8 py-4">
                          <span className="text-[10px] font-mono text-text-muted">
                            {new Date(o.createdAt).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <p className="text-base font-bold text-brand-primary font-mono">
                            {o.totalAmount.toLocaleString()} <span className="text-[9px]">د.ع</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}

        {activeTab === "menu" && (
          <motion.div
            key="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-16"
          >
            <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end gap-6 bg-bg-paper p-6 sm:p-12 border border-border-delicate border-r-4 border-r-brand-gold">
              <div className="space-y-2 text-right">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                  تنظيم قائمة الطعام والمنيو المباشر
                </p>
                <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                  قائمة الأطباق والمشروبات
                </h2>
                <p className="text-xs font-bold text-text-muted/60 tracking-wider max-w-md">
                  حدث وعدل قائمة طعامك بكل تفاصيل الأسعار والصور ونسب النكهات.
                </p>
              </div>
              <button
                onClick={() => setShowProductModal({ open: true })}
                className="px-10 py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all shadow-2xl text-center w-full md:w-auto"
              >
                إضافة طبق طعام جديد
              </button>
            </div>

            {/* Category Management Panel */}
            <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-6 text-right" dir="rtl">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">أقسام المنيو واللوائح المخصصة</p>
                <h3 className="text-xl font-display text-brand-primary italic font-bold">إدارة تصنيفات وقوائم الطعام</h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  يمكنك إضافة أو حذف أقسام (مثل: وجبات رئيسية، شاورما، حلويات، عصائر). عند حذف أي قسم ستبقى الوجبات التابعة له كما هي دون حذف، ويمكنك تصنيفها لأي قسم جديد.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="أدخل اسم القسم الجديد (مثلاً: مشاوي، عصائر طبيعية، مقبلات...)"
                  className="bg-bg-paper border border-border-delicate px-4 py-3 text-sm text-brand-primary focus:outline-none flex-1 text-right font-bold"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  className="px-8 py-3 bg-brand-primary text-white text-xs font-bold hover:bg-brand-secondary transition-all whitespace-nowrap"
                >
                  إضافة قسم جديد +
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {(restaurant?.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"]).map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-2 bg-bg-paper border border-border-delicate px-4 py-2 text-xs font-bold text-brand-primary"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat)}
                      className="text-red-500 hover:text-red-700 font-bold text-base w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-50"
                      title="حذف هذا القسم"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {menuItems.map((item) => (
                <div
                  key={item.id}
                  className="group relative bg-white border border-border-delicate hover:border-brand-gold transition-colors duration-500 overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <div className="aspect-[4/3] relative overflow-hidden">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000"
                        />
                      ) : (
                        <div className="w-full h-full bg-bg-paper flex items-center justify-center">
                          <UtensilsCrossed className="w-8 h-8 text-brand-gold/20" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                      <div className="absolute top-4 left-4 flex flex-col gap-2">
                        {item.isSpicy && (
                          <span className="bg-white/90 backdrop-blur-sm p-1.5 text-xs shadow-sm border border-border-delicate">
                            🔥
                          </span>
                        )}
                        {item.hasCheese && (
                          <span className="bg-white/90 backdrop-blur-sm p-1.5 text-xs shadow-sm border border-border-delicate">
                            🧀
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-4 sm:p-5 space-y-2 text-right">
                      {item.category && (
                        <p className="text-[8px] font-bold text-brand-gold uppercase tracking-widest">
                          {item.category}
                        </p>
                      )}
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-1">
                        <h3 className="font-display text-base sm:text-lg text-brand-primary tracking-tight font-bold">
                          {item.name}
                        </h3>
                        <p className="text-sm sm:text-base font-display text-brand-gold font-bold">
                          <span className="font-sans">{item.price.toLocaleString()}</span>{" "}
                          <span className="text-[9px] opacity-65">د.ع</span>
                        </p>
                      </div>
                      {item.ingredients && (
                        <p className="text-[10px] text-text-muted leading-relaxed line-clamp-2">
                          {item.ingredients}
                        </p>
                      )}
                      
                      {/* عرض أسعار الإضافات */}
                      {(item.hasCheese || item.isSpicy) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {item.hasCheese && item.cheesePrice !== undefined && (
                            <span className="text-[8px] font-bold text-brand-gold bg-brand-gold/5 px-2 py-0.5 border border-brand-gold/10">
                              🧀 إضافة جبن: +{(item.cheesePrice || 0).toLocaleString()} د.ع
                            </span>
                          )}
                          {item.isSpicy && item.spicyPrice !== undefined && (
                            <span className="text-[8px] font-bold text-brand-primary bg-brand-primary/5 px-2 py-0.5 border border-brand-primary/10">
                              🔥 خيار سبايسي: +{(item.spicyPrice || 0).toLocaleString()} د.ع
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-4 pt-0">
                    <div className="pt-2 flex gap-2 border-t border-border-delicate/50">
                      <button
                        onClick={() => deleteMenuItem(item.id)}
                        className="flex-1 py-2 sm:py-2.5 bg-red-50 text-red-700 text-[8px] font-bold uppercase tracking-wider hover:bg-red-100 transition-colors"
                      >
                        حذف
                      </button>
                      <button
                        onClick={() =>
                          setShowProductModal({ open: true, item })
                        }
                        className="flex-1 py-2 sm:py-2.5 border border-border-delicate text-[8px] font-bold uppercase tracking-wider text-brand-primary hover:bg-bg-paper transition-colors"
                      >
                        تعديل
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {menuItems.length === 0 && (
              <div className="text-center py-40 border border-dashed border-border-delicate bg-bg-paper">
                <p className="font-display italic text-3xl text-brand-gold opacity-30">
                  The archive is currently empty.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "qr" && (
          <motion.div
            key="qr"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center p-6 sm:p-12 py-12 sm:py-20 bg-white border border-border-delicate"
          >
            <div className="space-y-4 text-center mb-12">
              <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                البوابة الرقمية للمطعم
              </p>
              <h3 className="text-3xl sm:text-4xl font-display text-brand-primary tracking-tight">
                كود الطاولة والمنيو التعريفي (QR)
              </h3>
            </div>

            <div className="p-6 sm:p-16 bg-white shadow-2xl relative border border-border-delicate mb-12 w-full max-w-[320px] flex items-center justify-center">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-brand-gold -translate-x-4 -translate-y-4" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-brand-gold translate-x-4 -translate-y-4" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-brand-gold -translate-x-4 translate-y-4" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-brand-gold translate-x-4 translate-y-4" />
              <div className="w-full h-full max-w-[200px] sm:max-w-none flex items-center justify-center animate-fade-in">
                <QRCode
                  value={`${window.location.origin}?restaurantId=${restaurantId}`}
                  size={240}
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                  id="menu-qr"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 w-full sm:w-auto px-6 sm:px-0">
              <button
                onClick={downloadQR}
                className="px-10 py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all flex items-center justify-center gap-4 w-full sm:w-auto text-center cursor-pointer"
              >
                <Download className="w-5 h-5 shrink-0" /> تحميل كود الـ QR المخصص
              </button>
              <button
                onClick={() =>
                  window.open(
                    `${window.location.origin}?restaurantId=${restaurantId}`,
                    "_blank",
                  )
                }
                className="px-10 py-5 border border-border-delicate text-[11px] font-bold uppercase tracking-widest text-brand-primary hover:bg-bg-paper transition-all flex items-center justify-center gap-4 w-full sm:w-auto text-center cursor-pointer"
              >
                <ExternalLink className="w-5 h-5 shrink-0" /> استعراض صفحة زبائنك
              </button>
            </div>

            {/* Custom Staff Login Link Section */}
            <div className="mt-16 p-8 border border-border-delicate bg-bg-paper w-full max-w-2xl text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-brand-gold">
                <span className="w-8 h-[1px] bg-brand-gold opacity-30" />
                <p className="text-[10px] font-bold uppercase tracking-widest leading-none">تأمين البوابات وأنظمة الطاقم</p>
                <span className="w-8 h-[1px] bg-brand-gold opacity-30" />
              </div>
              <h4 className="text-xl font-display text-brand-primary font-bold">بوابة تسجيل دخول الموظفين والمالك الخاصة بك</h4>
              <p className="text-xs text-text-muted/80 max-w-md mx-auto leading-relaxed">
                لحماية خصوصية مطعمتكم، تم تخصيص بوابة مشتغلي الطاقم والمالك. يرجى تسجيل الدخول حصرياً عبر الرابط الأمني الفريد أدناه:
              </p>
              <div className="flex flex-col sm:flex-row items-stretch gap-4 justify-center pt-2">
                <input 
                  type="text" 
                  readOnly 
                  value={`${window.location.origin}?loginRestaurantId=${restaurantId}`}
                  className="w-full sm:w-80 px-4 py-2.5 bg-white border border-border-delicate text-xs font-mono text-center focus:outline-none select-all text-brand-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}?loginRestaurantId=${restaurantId}`);
                    setStaffLinkCopied(true);
                    setTimeout(() => setStaffLinkCopied(false), 2000);
                  }}
                  className="px-6 py-2.5 bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all w-full sm:w-auto cursor-pointer flex items-center justify-center gap-2"
                >
                  {staffLinkCopied ? "✓ تم نسخ الرابط الأمني" : "📋 نسخ الرابط الأمني"}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "alerts" && (
          <motion.div
            key="alerts"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8 text-right font-sans"
          >
            {/* Top info card */}
            <div className="bg-white border border-border-delicate p-6 sm:p-10 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 right-0 w-1.5 h-full bg-red-600" />
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-brand-gold shrink-0" />
                    جدار الحماية والأمن ومكافحة السبام البشري
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                    إدارة التنبيهات والطلبات الوهمية
                  </h3>
                  <p className="text-xs text-text-muted max-w-2xl leading-relaxed">
                    هذا النظام يقوم بمطابقة إشارات تحديد المواقع لكل زبائنك لضمان وجودهم داخل الصالة، إلى جانب رصد وتخزين بصمات الكوكيز ونوع النظام لإفشال الطلبات المزعجة من خارج المطعم أو تغيير معلومات الطاولات بشكل متكرر.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-pulse" />
                    الحماية الجغرافية نشطة
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-pulse" />
                    مراقبة الأجهزة نشطة
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Summary Panel */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white border border-border-delicate p-6 text-right shadow-sm space-y-1">
                <p className="text-xs text-text-muted font-bold">إجمالي التنبيهات المرصودة</p>
                <p className="text-4xl font-display italic text-brand-primary font-bold">{alerts.length}</p>
              </div>
              <div className="bg-white border border-border-delicate p-6 text-right shadow-sm space-y-1 border-r-4 border-r-amber-500">
                <p className="text-xs text-text-muted font-bold">تنبيهات معلقة وتحتاج مراجعة</p>
                <p className="text-4xl font-display italic text-amber-600 font-bold">
                  {alerts.filter(a => a.status === 'unread').length}
                </p>
              </div>
              <div className="bg-white border border-border-delicate p-6 text-right shadow-sm space-y-1 border-r-4 border-r-red-600">
                <p className="text-xs text-text-muted font-bold">حالات شديدة الخطورة ومثيرة للشبهة</p>
                <p className="text-4xl font-display italic text-red-600 font-bold">
                  {alerts.filter(a => a.severity === 'critical' && a.status === 'unread').length}
                </p>
              </div>
            </div>

            {/* Sub-tab Switcher inside Alerts page */}
            <div className="flex flex-col sm:flex-row border-b border-border-delicate">
              <button
                onClick={() => setAlertsSubTab("system_announcements")}
                className={`flex-1 py-4 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  alertsSubTab === "system_announcements"
                    ? "border-brand-primary text-brand-primary bg-bg-paper font-semibold shadow-sm"
                    : "border-transparent text-text-muted hover:text-brand-primary"
                }`}
              >
                📢 تبليغات وتوجيهات الإدارة ({announcements.length})
              </button>
              <button
                onClick={() => setAlertsSubTab("order_devices")}
                className={`flex-1 py-4 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  alertsSubTab === "order_devices"
                    ? "border-brand-primary text-brand-primary bg-bg-paper font-semibold shadow-sm"
                    : "border-transparent text-text-muted hover:text-brand-primary"
                }`}
              >
                📱 معلومات وبصمات طالبي الطعام ({orders.filter(o => o.deviceMetadata).length})
              </button>
              <button
                onClick={() => setAlertsSubTab("security_alerts")}
                className={`flex-1 py-4 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  alertsSubTab === "security_alerts"
                    ? "border-brand-primary text-brand-primary bg-bg-paper font-semibold shadow-sm"
                    : "border-transparent text-text-muted hover:text-brand-primary"
                }`}
              >
                🚨 محاولات الاختراق والطلبات الوهمية ({alerts.length})
              </button>
              <button
                onClick={() => setAlertsSubTab("banned_customers")}
                className={`flex-1 py-4 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  alertsSubTab === "banned_customers"
                    ? "border-brand-primary text-brand-primary bg-bg-paper font-semibold shadow-sm"
                    : "border-transparent text-text-muted hover:text-brand-primary"
                }`}
              >
                🚫 الزبائن المحظورين ({bannedDevices.length})
              </button>
            </div>

            {alertsSubTab === "system_announcements" && (
              <div className="space-y-6">
                <h4 className="text-lg font-display text-brand-primary font-bold border-b border-border-delicate pb-3 flex items-center gap-3">
                  <Bell className="w-5 h-5 text-brand-gold shrink-0" />
                  إعلانات وتوجيهات الإدارة العامة للنظام
                </h4>

                {announcements.length === 0 ? (
                  <div className="bg-white border border-dashed border-border-delicate p-12 py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                      <Bell className="w-8 h-8" />
                    </div>
                    <h4 className="text-base font-display text-text-muted font-bold">لا توجد أي تبليغات أو توجيهات من الإدارة حالياً</h4>
                    <p className="text-text-muted/60 max-w-sm mx-auto text-xs leading-relaxed">
                      أي إعلان أو تنبيه فني أو إداري يتم نشره من قبل أصحاب النظام سيظهر لك هنا حياً ومباشرة لتكون على اطلاع دائم.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6">
                    {announcements.map((ann) => {
                      const isCritical = ann.severity === "critical";
                      const isWarning = ann.severity === "warning";
                      return (
                        <div
                          key={ann.id}
                          className={`p-6 sm:p-8 border relative transition-all bg-white hover:border-brand-gold ${
                            isCritical
                              ? "border-red-200 bg-red-50/20"
                              : isWarning
                              ? "border-amber-200 bg-amber-50/20"
                              : "border-border-delicate bg-white"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-4">
                            <div className="space-y-3 flex-grow">
                              <div className="flex items-center flex-wrap gap-3">
                                <h4 className={`text-base font-bold font-display ${
                                  isCritical ? "text-red-900 font-extrabold" : isWarning ? "text-amber-900" : "text-brand-primary"
                                }`}>
                                  {ann.title}
                                </h4>
                                <span className={`px-2.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wider ${
                                  isCritical
                                    ? "bg-red-100 text-red-800"
                                    : isWarning
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-blue-50 text-blue-800"
                                }`}>
                                  {isCritical ? "طارئ" : isWarning ? "تحذير" : "إرشاد"}
                                </span>
                                <span className="text-[10px] text-text-muted font-sans mr-auto" dir="ltr">
                                  {safeFormatDate(ann.createdAt?.toDate ? ann.createdAt.toDate() : ann.createdAt, "yyyy/MM/dd | hh:mm a")}
                                </span>
                              </div>
                              <p className="text-xs text-brand-primary font-sans leading-relaxed whitespace-pre-wrap">
                                {ann.message}
                              </p>
                              <div className="flex items-center gap-2 pt-2 text-[10px] text-text-muted font-bold font-sans">
                                <span>موجه إلى:</span>
                                <span className="text-brand-gold">
                                  {(ann.target === "all" || ann.targetRestaurantId === "all") ? "جميع المطاعم المشتركة" : "مطعمكم بشكل خاص"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {alertsSubTab === "security_alerts" && (
              <div className="space-y-6">
                <h4 className="text-lg font-display text-brand-primary font-bold border-b border-border-delicate pb-3 flex items-center gap-3">
                  <Bell className="w-5 h-5 text-brand-gold shrink-0" />
                  سجل تتبع الهجمات والمحاولات المشبوهة
                </h4>

              {alerts.length === 0 ? (
                <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-xl font-display text-emerald-700 font-bold">لا توجد أي تنبيهات حالياً</h4>
                  <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                    درع الحماية نشط ويقوم بفحص كل عملية تصفح أو طلب قائمة طعام بشكل مستمر. صالة مطعمك آمنة ومحمية بالكامل!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {alerts.map((alert) => {
                    const isUnread = alert.status === 'unread';
                    const isCritical = alert.severity === 'critical';
                    
                    return (
                      <motion.div
                        key={alert.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`bg-white border transition-all relative p-6 sm:p-8 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center ${
                          isUnread 
                            ? isCritical 
                              ? 'border-red-600/30 bg-red-50/5 shadow-md shadow-red-500/5' 
                              : 'border-amber-600/30 bg-amber-50/5 shadow-md shadow-amber-500/5'
                            : 'border-border-delicate bg-white opacity-75'
                        }`}
                      >
                        {/* Bullet indication for unread */}
                        {isUnread && (
                          <div className={`absolute top-4 right-4 w-2.5 h-2.5 rounded-full ${isCritical ? 'bg-red-600 animate-ping' : 'bg-amber-500 animate-ping'}`} />
                        )}

                        <div className="space-y-4 flex-1">
                          {/* Top row badges */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2.5 py-1 text-[9px] font-bold rounded-full ${
                              isCritical 
                                ? 'bg-red-100 text-red-100 bg-red-800' 
                                : alert.severity === 'warning' 
                                  ? 'bg-amber-100 text-amber-800' 
                                  : 'bg-blue-100 text-blue-800'
                            }`}>
                              {alert.severity === 'critical' ? 'حرج للغاية (خطر عالي)' : 'شبهة احتيال مكررة'}
                            </span>
                            <span className="text-[9.5px] font-bold text-text-muted opacity-80 bg-bg-paper border border-border-delicate px-2.5 py-1 rounded-full">
                              نوع الاختراق: {
                                alert.type === 'outside_range' ? 'طلب من خارج صالة المطعم (GPS)' :
                                alert.type === 'desktop_device' ? 'مسح باركود من نظام كمبيوتر / حاسوب مشبوه' :
                                alert.type === 'multi_name_spam' ? 'محاولة تغيير الاسم أو الطاولة (تكرار عشوائي)' :
                                alert.type === 'failed_location' ? 'تم حجب مشاركة الموقع الجغرافي' : 'نشاط عشوائي مشبوه بالقرب من المطعم'
                              }
                            </span>
                            <span className="text-[9px] font-mono text-text-muted mr-auto">
                              {safeFormatDate(alert.timestamp, "yyyy/MM/dd | hh:mm a")}
                            </span>
                          </div>

                          {/* Alert details */}
                          <div className="space-y-2">
                            <h4 className="text-base font-bold text-brand-primary leading-tight">
                              {alert.title}
                            </h4>
                            <p className="text-xs text-text-muted leading-relaxed">
                              العميل المشتبه به: <strong className="text-brand-primary">{alert.customerName || 'غير محدد بعد'}</strong> 
                              {alert.tableNumber && <> — طلس/جلس على طاولة كود: <strong className="text-brand-secondary">طاولة {alert.tableNumber}</strong></>}
                            </p>
                          </div>

                          {/* Device footprint details (True Identification Parameters) */}
                          <div className="bg-bg-paper border border-border-delicate p-4 rounded-xl space-y-3.5 text-xs text-right">
                            <p className="text-[10px] uppercase font-bold text-brand-gold tracking-widest border-b border-border-delicate pb-1.5 mb-2">
                              أدلة الهوية الرقمية الحقيقية (Device DNA Signature)
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6">
                              <div>
                                <span className="text-text-muted font-medium">نوع وماركة النظام: </span>
                                <strong className="text-brand-primary font-bold">{alert.deviceMetadata.deviceType}</strong>
                              </div>
                              <div>
                                <span className="text-text-muted font-medium">البصمة الرقمية للعميل (Fingerprint ID): </span>
                                <code className="bg-white border border-border-delicate px-1.5 py-0.5 rounded font-mono text-[9px] font-bold text-red-700">{alert.deviceMetadata.fingerprint}</code>
                              </div>
                              <div>
                                <span className="text-text-muted font-medium">أبعاد ودقة جهاز الزائر: </span>
                                <span className="text-brand-primary font-medium">{alert.deviceMetadata.screenSize}</span>
                              </div>
                              <div>
                                <span className="text-text-muted font-medium">لغة المتصفح المعتمدة: </span>
                                <span className="text-brand-primary font-medium">{alert.deviceMetadata.language}</span>
                              </div>
                              <div className="md:col-span-2">
                                <span className="text-text-muted font-medium">الحالة الجغرافية وموقع الزبون: </span>
                                <span className={`font-bold ${alert.deviceMetadata.coordinates ? 'text-rose-700' : 'text-amber-800'}`}>
                                  {alert.deviceMetadata.coordinates 
                                    ? `📍 إحداثيات المشتبه به [${alert.deviceMetadata.coordinates.lat.toFixed(5)}, ${alert.deviceMetadata.coordinates.lng.toFixed(5)}] على بعد ${alert.deviceMetadata.distanceMeters ? Math.round(alert.deviceMetadata.distanceMeters) : 0} متر من مطعمك!`
                                    : '📍 الزبون حجب وحظر مشاركة الموقع الجغرافي الخاص بجهازه (قد يكون خارج المطعم)'}
                                </span>
                              </div>
                            </div>
                            <details className="mt-2 text-[10px] cursor-pointer text-text-muted">
                              <summary className="font-semibold hover:text-brand-primary transition-colors">عرض كود الـ User-Agent الكامل الخاص بجهاز ومذياع الطلب</summary>
                              <div className="bg-white border border-border-delicate p-2.5 mt-2 rounded font-mono break-all text-left" dir="ltr">
                                {alert.deviceMetadata.userAgent}
                              </div>
                            </details>
                          </div>
                        </div>

                        {/* Interactive actions for manager */}
                        <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 self-stretch justify-center items-stretch shrink-0 min-w-[200px]">
                          {isUnread && (
                            <button
                              onClick={() => resolveAlert(alert.id)}
                              className="px-4 py-2 bg-brand-primary hover:bg-brand-secondary text-white text-[10px] font-bold uppercase tracking-wider rounded transition-all text-center"
                            >
                              تعليم كـ "مقروء ومحقق فيه"
                            </button>
                          )}
                          <button
                            onClick={() => cancelAllOrdersByFingerprint(alert.deviceMetadata.fingerprint)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase tracking-wider rounded transition-all text-center flex items-center justify-center gap-1.5"
                          >
                            إلغاء جميع طلبات هذه البصمة 🚫
                          </button>
                          <button
                            onClick={() => deleteAlert(alert.id)}
                            className="px-4 py-2 border border-border-delicate text-text-muted hover:text-red-700 hover:bg-bg-paper text-[10px] font-bold uppercase tracking-wider rounded transition-all text-center"
                          >
                            حذف السجل نهائياً
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {alertsSubTab === "order_devices" && (
              <div className="space-y-6">
                <h4 className="text-lg font-display text-brand-primary font-bold border-b border-border-delicate pb-3 flex items-center gap-3 font-sans">
                  <span className="w-2.5 h-2.5 bg-brand-gold rounded-full animate-pulse" />
                  أدلة وهويات طالبي الطعام بالصالة (بصمات الأجهزة النشطة للطلبات الحية)
                </h4>

                {orders.length === 0 ? (
                  <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-display text-emerald-700 font-bold">لا توجد طلبات مسجلة حالياً</h4>
                    <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                      بمجرد أن يبدأ زبائن الصالة في إرسال طلبات طعامهم، ستظهر الهويات الحية لأجهزتهم ومسافاتهم الجغرافية وبصماتهم الرقمية هنا فوراً!
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6 text-right font-sans">
                    {orders.slice().reverse().map((order) => {
                      const hasDeviceMeta = !!order.deviceMetadata;
                      const deviceMeta = order.deviceMetadata;
                      const distance = deviceMeta?.distanceMeters;

                      return (
                        <div
                          key={order.id}
                          className={`bg-white border p-6 sm:p-8 relative transition-all ${
                            hasDeviceMeta 
                              ? (distance && distance > 150)
                                ? "border-red-400 bg-red-50/10 shadow-md"
                                : "border-border-delicate bg-white shadow-sm"
                              : "border-border-delicate bg-gray-50/5 opacity-80"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border-delicate/40 pb-4 mb-4">
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block font-sans">
                                كود مرجعي: <span className="font-mono text-[9px]">{order.id.substring(0, 8)}...</span>
                              </span>
                              <h4 className="text-base sm:text-lg font-bold text-brand-primary flex flex-wrap items-center gap-2">
                                {order.customerName}
                                <span className="text-[10px] bg-brand-primary/5 text-brand-gold px-2.5 py-0.5 rounded-full border border-border-delicate/40 font-semibold font-sans">
                                  طاولة {order.tableNumber}
                                </span>
                                {order.status === 'pending' && <span className="text-[9px] bg-amber-50 text-amber-800 border border-amber-205 px-2 py-0.5 rounded">معلق</span>}
                                {order.status === 'preparing' && <span className="text-[9px] bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded animate-pulse">جاري التحضير</span>}
                                {order.status === 'ready' && <span className="text-[9px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded">جاهز</span>}
                                {order.status === 'served' && <span className="text-[9px] bg-gray-100 text-gray-700 border border-gray-300 px-2 py-0.5 rounded">تم التقديم</span>}
                                {order.status === 'cancelled' && <span className="text-[9px] bg-red-50 text-red-800 border border-red-200 px-2 py-0.5 rounded">ملغي</span>}
                              </h4>
                            </div>
                            <div className="flex flex-col sm:items-end gap-1 font-sans">
                              <span className="text-xs font-bold text-brand-primary">
                                {order.totalAmount.toLocaleString()} د.ع
                              </span>
                              <span className="text-[9.5px] text-text-muted">
                                {safeFormatDate(order.createdAt, "yyyy/MM/dd | hh:mm a")}
                              </span>
                            </div>
                          </div>

                          {hasDeviceMeta && deviceMeta ? (
                            <div className="space-y-4">
                              <div className="bg-bg-paper border border-border-delicate p-4 rounded-xl space-y-3.5 text-xs">
                                <p className="text-[10px] uppercase font-bold text-brand-gold tracking-widest border-b border-border-delicate pb-1.5 mb-2 font-sans">
                                  أدلة الهوية الرقمية للزبون (Customer DeviceDNA Signature)
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 font-sans">
                                  <div>
                                    <span className="text-text-muted font-medium">نوع وماركة النظام: </span>
                                    <strong className="text-brand-primary font-bold">{deviceMeta.deviceType}</strong>
                                  </div>
                                  <div>
                                    <span className="text-text-muted font-medium">البصمة الرقمية للزبون (Fingerprint): </span>
                                    <code className="bg-white border border-border-delicate px-1.5 py-0.5 rounded font-mono text-[9px] font-bold text-brand-gold">{deviceMeta.fingerprint}</code>
                                  </div>
                                  <div>
                                    <span className="text-text-muted font-medium">دقة الشاشة وأبعادها: </span>
                                    <span className="text-brand-primary font-medium">{deviceMeta.screenSize}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted font-medium">لغة العميل المفضلة: </span>
                                    <span className="text-brand-primary font-medium">{deviceMeta.language}</span>
                                  </div>
                                  <div className="md:col-span-2">
                                    <span className="text-text-muted font-medium">الحالة الجغرافية ومطابقة النطاق: </span>
                                    <span className={`font-bold ${deviceMeta.coordinates ? (distance !== undefined && distance <= 150 ? 'text-emerald-700' : 'text-rose-700') : 'text-amber-800'}`}>
                                      {deviceMeta.coordinates
                                        ? `📍 إحداثيات العميل [${deviceMeta.coordinates.lat.toFixed(5)}, ${deviceMeta.coordinates.lng.toFixed(5)}] على بعد ${distance ? Math.round(distance) : 0} متر من إحداثيات صالتك المعينة!`
                                        : '📍 الزبون حجب وحظر مشاركة الموقع الجغرافي الخاص بجهازه (قد يكون خارج المطعم، أو طلب بواسطة الويتر)'}
                                    </span>
                                  </div>
                                </div>
                                <details className="mt-2 text-[10px] cursor-pointer text-text-muted font-sans font-sans">
                                  <summary className="font-semibold hover:text-brand-primary transition-colors">عرض كود الـ User-Agent الكامل الخاص بجهاز ومذياع الطلب</summary>
                                  <div className="bg-white border border-border-delicate p-2.5 mt-2 rounded font-mono break-all text-left" dir="ltr">
                                    {deviceMeta.userAgent}
                                  </div>
                                </details>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-bg-paper p-4 text-xs text-text-muted border border-border-delicate/40 rounded flex items-center gap-2 font-sans font-sans">
                              <Info className="w-5 h-5 text-brand-gold shrink-0" />
                              طلب مدخل يدوياً بواسطة كابتن الصالة (الويتر) أو تم طلبه مسبقاً قبل تفعيل جدار الوقاية.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {alertsSubTab === "banned_customers" && (
              <div className="space-y-6 text-right">
                <h4 className="text-lg font-display text-brand-primary font-bold border-b border-border-delicate pb-3 flex items-center gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                  قائمة الأجهزة والزبائن المحظورين من الدخول للمنيو
                </h4>

                {bannedDevices.length === 0 ? (
                  <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                      <Users className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-display text-brand-primary font-bold">لا يوجد أي زبائن محظورين</h4>
                    <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                      لا يوجد أي زبائن في قائمة الحظر حالياً. صالة مطعمك مفتوحة لجميع الهواتف!
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6">
                    {bannedDevices.map((banned) => (
                      <div
                        key={banned.id}
                        className="bg-white border border-red-200 p-6 sm:p-8 relative flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shadow-sm border-r-4 border-r-red-600"
                      >
                        <div className="space-y-4 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="bg-red-50 text-red-800 border border-red-200 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              محظور من الطلب 🚫
                            </span>
                            <span className="text-[10px] font-mono text-text-muted">
                              تاريخ الحظر: {banned.bannedAt ? safeFormatDate(banned.bannedAt, "yyyy/MM/dd | hh:mm a") : "غير محدد"}
                            </span>
                          </div>

                          <div className="space-y-2">
                            <h5 className="text-base sm:text-lg font-bold text-brand-primary">
                              الزبون: <span className="text-red-700">{banned.customerName}</span> (طاولة {banned.tableNumber || "غير محددة"})
                            </h5>
                            <p className="text-xs text-text-main leading-relaxed">
                              السبب المسجل للحظر: <strong className="text-red-900 bg-red-50 px-2.5 py-1.5 rounded font-bold">{banned.reason}</strong>
                            </p>
                            <p className="text-[11px] text-text-muted">
                              الموظف الذي قام بالحظر: <span className="text-brand-primary font-bold bg-slate-100 px-2 py-0.5 rounded">{banned.bannedBy || "مدير النظام (أنت)"}</span>
                            </p>
                          </div>

                          <div className="bg-bg-paper border border-border-delicate p-4 rounded-xl space-y-2 text-xs font-mono">
                            <p className="text-[10px] font-bold text-brand-gold tracking-widest uppercase border-b border-border-delicate pb-1.5 mb-1.5 font-sans">
                              مواصفات جهاز الزبون المحظور:
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-muted">
                              <div>نوع الجهاز: <span className="font-sans font-bold text-brand-primary">{banned.deviceMetadata?.deviceType || "غير متوفر"}</span></div>
                              <div>البصمة الرقمية: <span className="text-red-600 font-bold font-mono">{banned.fingerprint}</span></div>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={async () => {
                            if (confirm(`هل أنت متأكد من إلغاء حظر الزبون "${banned.customerName}" وتمكينه من الطلب مجدداً؟`)) {
                              try {
                                await deleteDoc(doc(db, "banned_devices", banned.id));
                                alert(`تم فك الحظر عن "${banned.customerName}" بنجاح!`);
                              } catch (err) {
                                alert("فشل إلغاء الحظر. حاول مجدداً");
                              }
                            }
                          }}
                          className="px-5 py-3 border border-border-delicate hover:border-emerald-600 text-text-muted hover:text-emerald-700 hover:bg-emerald-50 text-[11px] font-bold uppercase tracking-wider rounded transition-all shrink-0 w-full md:w-auto text-center font-sans"
                        >
                          فك الحظر والترخيص بالطلب 🔓
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "help" && (
          <motion.div
            key="help"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 lg:grid-cols-2 bg-white border border-border-delicate overflow-hidden"
          >
            <div className="p-6 sm:p-12 md:p-20 space-y-8 sm:space-y-12 bg-bg-paper border-r border-border-delicate text-right">
              <div className="space-y-4">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                  الدعم الفني والخدمات الفنية
                </p>
                <h3 className="text-3xl sm:text-4xl font-display text-brand-primary tracking-tight">
                  كيف يمكننا خدمتك ومساعدتك؟
                </h3>
              </div>
              <p className="text-base sm:text-lg text-text-muted leading-relaxed">
                فريق الدعم الفني متواجد لمساعدتك لضمان تشغيل خدمتك الرقمية باستمرار وبدون أي انقطاع.
              </p>
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-6 sm:gap-10 pt-6 sm:pt-8 justify-start">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border border-brand-gold flex items-center justify-center text-brand-gold shrink-0">
                  <Phone className="w-6 h-6 sm:w-8 sm:h-8" />
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold opacity-60">
                    رقم خط الطوارئ المباشر
                  </p>
                  <p className="text-2xl sm:text-3xl font-display tracking-tight text-brand-primary">
                    {supportPhone}
                  </p>
                </div>
              </div>
            </div>
            <div className="relative aspect-square lg:aspect-auto min-h-[300px]">
              <img
                src="https://images.unsplash.com/photo-1544148103-0773bf10d330?auto=format&fit=crop&q=80"
                className="w-full h-full object-cover"
                alt="Support"
              />
              <div className="absolute inset-0 bg-brand-primary/20 mix-blend-multiply" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStaffModal?.open && (
          <StaffModal
            onClose={() => setShowStaffModal(null)}
            restaurantId={restaurantId}
            role={showStaffModal.role}
            existingStaff={showStaffModal.staff}
          />
        )}
        {showProductModal?.open && (
          <AddProductModal
            onClose={() => setShowProductModal(null)}
            restaurantId={restaurantId}
            existingItem={showProductModal.item}
            categories={restaurant?.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"]}
          />
        )}
        {banningOrder && (
          <BanCustomerModal
            order={banningOrder}
            onClose={() => setBanningOrder(null)}
            defaultStaffName="المدير / صاحب المطعم"
            onConfirm={async (reason, staffName) => {
              await handleBanCustomer(banningOrder, reason, staffName);
              setBanningOrder(null);
            }}
          />
        )}
        {selectedOrderForTimeline && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white max-w-lg w-full p-6 sm:p-10 border border-border-delicate relative my-8 text-right font-sans rounded-none"
              dir="rtl"
            >
              <button
                onClick={() => setSelectedOrderForTimeline(null)}
                className="absolute top-4 left-4 text-text-muted hover:text-brand-primary transition-colors h-[32px] w-[32px] flex items-center justify-center border border-border-delicate hover:bg-bg-paper"
                id="close-timeline-modal"
              >
                <X className="w-4 h-4" />
              </button>
              
              <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
              
              <div className="space-y-6 text-right">
                <p className="text-[10px] sm:text-xs font-bold text-brand-gold uppercase tracking-widest">تتبع الكفاءة والزمن (Timeline)</p>
                <h3 className="text-xl font-display text-brand-primary font-bold italic">
                  التسلسل الزمني للطلب: {selectedOrderForTimeline.orderNumber ? `رقم ${selectedOrderForTimeline.orderNumber}` : `#${selectedOrderForTimeline.id.slice(-6).toUpperCase()}`}
                </h3>
                <div className="bg-bg-paper p-4 border border-border-delicate text-xs text-text-muted leading-relaxed space-y-1">
                  <p>الزبون: <strong className="text-brand-primary">{selectedOrderForTimeline.customerName}</strong></p>
                  <p>الطاولة: <strong className="text-brand-primary">{selectedOrderForTimeline.tableNumber}</strong></p>
                  {selectedOrderForTimeline.notes && (
                    <p>ملاحظات الزبون: <span className="italic">"{selectedOrderForTimeline.notes}"</span></p>
                  )}
                </div>

                <div className="mt-8 relative border-r-2 border-brand-gold/20 mr-4 pr-6 space-y-8 text-right">
                  {/* Step 1: Placed */}
                  <div className="relative">
                    <span className="absolute -right-[31px] top-1 flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white ring-8 ring-white">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase">1. وقت إرسال الطلب من الزبون</h4>
                      <p className="text-xs font-mono text-brand-gold mt-1" dir="ltr">
                        {selectedOrderForTimeline.createdAt ? new Date(selectedOrderForTimeline.createdAt).toLocaleString("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, day: "numeric", month: "numeric" }) : "—"}
                      </p>
                      <p className="text-[10px] text-text-muted mt-0.5">تم استلام الطلب وبانتظار الموافقة.</p>
                    </div>
                  </div>

                  {/* Step 2: Approved */}
                  <div className="relative">
                    <span className={`absolute -right-[31px] top-1 flex items-center justify-center w-4 h-4 rounded-full ${selectedOrderForTimeline.approvedAt ? "bg-emerald-500 text-white" : "bg-amber-100 text-amber-600 animate-pulse"} ring-8 ring-white`}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase">2. وقت موافقة الكابتن على طلب الزبون</h4>
                      {selectedOrderForTimeline.approvedAt ? (
                        <>
                          <p className="text-xs font-mono text-brand-gold mt-1" dir="ltr">
                            {new Date(selectedOrderForTimeline.approvedAt).toLocaleString("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, day: "numeric", month: "numeric" })}
                          </p>
                          {selectedOrderForTimeline.approvedAt > selectedOrderForTimeline.createdAt && (
                            <p className="text-[10px] text-emerald-600 mt-1 font-bold">
                              ⏱️ وقت الاستجابة للموافقة: {(() => {
                                const diff = selectedOrderForTimeline.approvedAt - selectedOrderForTimeline.createdAt;
                                const sec = Math.floor(diff / 1000) % 60;
                                const min = Math.floor(diff / 60000);
                                return min > 0 ? `${min} دقيقة و ${sec} ثانية` : `${sec} ثانية`;
                              })()}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs italic text-amber-600 mt-1">بانتظار موافقة كابتن الصالة والبدء بالتحضير الفعلي...</p>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Ready */}
                  <div className="relative">
                    <span className={`absolute -right-[31px] top-1 flex items-center justify-center w-4 h-4 rounded-full ${selectedOrderForTimeline.readyAt ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400"} ring-8 ring-white`}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase">3. وقت جهوزية الطلب للتسليم</h4>
                      {selectedOrderForTimeline.readyAt ? (
                        <>
                          <p className="text-xs font-mono text-brand-gold mt-1" dir="ltr">
                            {new Date(selectedOrderForTimeline.readyAt).toLocaleString("ar-IQ", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, day: "numeric", month: "numeric" })}
                          </p>
                          {selectedOrderForTimeline.approvedAt && selectedOrderForTimeline.readyAt > selectedOrderForTimeline.approvedAt && (
                            <p className="text-[10px] text-emerald-600 mt-1 font-bold">
                              🍳 مدة التحضير الفعلي بالمطبخ: {(() => {
                                const diff = selectedOrderForTimeline.readyAt! - selectedOrderForTimeline.approvedAt!;
                                const sec = Math.floor(diff / 1000) % 60;
                                const min = Math.floor(diff / 60000);
                                return min > 0 ? `${min} دقيقة و ${sec} ثانية` : `${sec} ثانية`;
                              })()}
                            </p>
                          )}
                          {selectedOrderForTimeline.readyAt > selectedOrderForTimeline.createdAt && (
                            <p className="text-[10px] text-brand-primary mt-2 font-extrabold border-t border-border-delicate pt-2">
                              🕒 إجمالي كفاءة الخدمة (الطلب حتى الجاهزية): {(() => {
                                const diff = selectedOrderForTimeline.readyAt! - selectedOrderForTimeline.createdAt;
                                const sec = Math.floor(diff / 1000) % 60;
                                const min = Math.floor(diff / 60000);
                                return min > 0 ? `${min} دقيقة و ${sec} ثانية` : `${sec} ثانية`;
                              })()}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs italic text-text-muted mt-1">جاري العمل على الوجبات في القسم المختص...</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-8 border-t border-border-delicate pt-6 flex justify-end">
                  <button
                    onClick={() => setSelectedOrderForTimeline(null)}
                    className="px-6 py-2.5 bg-brand-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all"
                  >
                    إغلاق التفاصيل
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {showResetConfirmModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white max-w-md w-full p-6 sm:p-10 border border-border-delicate relative my-8 text-right"
              dir="rtl"
            >
              <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
              <div className="space-y-4 text-right">
                <p className="text-[10px] sm:text-xs font-bold text-brand-gold uppercase tracking-widest">تأكيد تصفير النظام</p>
                <h3 className="text-xl font-display text-brand-primary font-bold italic">هل تود تصفير عداد المبيعات وبدء يوم جديد؟</h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  أنت على وشك تصفير عداد أرقام الطلبات للبدء بيوم عمل جديد مفرغ تماماً.
                  <br className="mb-2" />
                  • سيبدأ ترتيب أرقام الطلبيات القادمة للزبائن من الرقم 1.
                  <br />
                  • سيتم أرشفة وإخفاء جميع الطلبيات النشطة حالياً من شاشات الموظفين واللوحة لتبدأ صفحة جديدة نظيفة.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mt-8">
                <button
                  type="button"
                  onClick={async () => {
                    setShowResetConfirmModal(false);
                    await executeResetOrderCounter();
                  }}
                  className="flex-1 px-4 py-3 bg-[#c2410c] text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-primary transition-all text-center"
                >
                  نعم، تصفير والبدء من جديد
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirmModal(false)}
                  className="flex-1 px-4 py-3 border border-border-delicate text-brand-primary text-[11px] font-bold uppercase tracking-widest hover:bg-bg-paper transition-all text-center"
                >
                  إلغاء التراجع
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  title,
  value,
  label,
  icon,
}: {
  title: string;
  value: number | string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-6 relative group overflow-hidden">
      <div className="absolute top-0 right-0 w-1.5 h-full bg-border-delicate group-hover:bg-brand-gold transition-colors" />
      <div className="text-brand-gold opacity-40 group-hover:scale-110 transition-transform duration-500">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-[9px] font-bold text-text-muted uppercase tracking-[0.3em]">
          {label}
        </p>
        <p className="text-4xl sm:text-5xl font-display not-italic text-brand-primary tracking-tighter tabular-nums font-bold">
          {value}
        </p>
      </div>
      <p className="text-xs font-bold text-brand-gold uppercase tracking-widest">
        {title}
      </p>
    </div>
  );
}

function StaffCard({
  staff,
  onToggle,
  onDelete,
  onEdit,
  accent = "primary",
}: {
  staff: Waiter;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  accent?: "primary" | "gold";
  key?: any;
}) {
  return (
    <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-8 group transition-all duration-500 hover:shadow-2xl">
      <div className="flex justify-between items-start">
        <div
          className={`w-16 h-16 sm:w-20 sm:h-20 border border-border-delicate flex items-center justify-center font-display italic text-2xl sm:text-3xl ${accent === "gold" ? "text-brand-gold" : "text-brand-primary"}`}
        >
          {staff.name[0]}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center border border-border-delicate text-text-muted hover:border-brand-primary hover:text-brand-primary transition-all"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggle}
            className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center border border-border-delicate transition-all ${staff.status === "active" ? "text-emerald-600 hover:bg-emerald-50" : "text-red-500 hover:bg-red-50"}`}
          >
            {staff.status === "active" ? (
              <PauseCircle className="w-3.5 h-3.5" />
            ) : (
              <PlayCircle className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onDelete}
            className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center border border-border-delicate text-text-muted hover:border-red-500 hover:text-red-500 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-1 text-right">
        <div className="flex items-center gap-3 justify-start">
          <span
            className={`w-2 h-2 rounded-full ${staff.status === "active" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"}`}
          />
          <h3 className="text-xl sm:text-2xl font-display italic text-brand-primary tracking-tight">
            {staff.name}
          </h3>
        </div>
        <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
          {staff.phone}
        </p>
      </div>
      <div className="bg-bg-paper p-6 sm:p-8 border border-border-delicate space-y-3">
        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-text-muted gap-2">
          <span>اسم مستخدم الدخول</span>
          <span className="text-brand-primary truncate max-w-[120px]">
            {staff.username}
          </span>
        </div>
        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-text-muted gap-2">
          <span>رمز المرور الخاص</span>
          <span className="text-brand-primary truncate max-w-[120px]">
            {staff.password}
          </span>
        </div>
      </div>
    </div>
  );
}

function OrderColumn({
  title,
  orders,
  type,
  onUpdate,
  onBan,
  isHistory = false,
  onShowTimeline,
}: {
  title: string;
  orders: Order[];
  type: OrderStatus;
  onUpdate: (id: string, s: OrderStatus) => void;
  onBan?: (order: Order) => void;
  isHistory?: boolean;
  onShowTimeline?: (order: Order) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-border-delicate pb-4">
        <h3 className="text-sm font-bold text-brand-primary uppercase tracking-widest">
          {title}
        </h3>
        <span className="text-[10px] font-bold text-brand-gold">
          {orders.length}
        </span>
      </div>
      <div className="space-y-6">
        <AnimatePresence mode="popLayout">
          {orders.map((order) => (
            <motion.div
              layout
              key={order.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-border-delicate p-5 sm:p-8 space-y-6 group hover:border-brand-gold transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1 text-right">
                  <h4 className="font-display text-lg italic text-brand-primary tracking-tight">
                    {order.customerName}
                  </h4>
                  <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest">
                    طاولة رقم: {order.tableNumber}
                  </p>
                </div>
                <span className="text-[10px] font-sans font-bold text-brand-gold bg-brand-gold/10 px-2 py-0.5 rounded">
                  {order.orderNumber ? `رقم الطلب ${order.orderNumber}` : `#${order.id.slice(-6).toUpperCase()}`}
                </span>
              </div>

              <div className="space-y-3 border-y border-border-delicate py-6 bg-bg-paper -mx-5 px-5 sm:-mx-8 sm:px-8 text-right">
                {order.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-col border-b border-border-delicate/20 pb-2 last:border-b-0"
                  >
                    <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-[0.4em]">
                      <div className="flex items-center gap-4">
                        <span className="text-brand-gold not-italic">
                          <span className="font-sans font-bold">{item.quantity}</span>×
                        </span>
                        <span className="text-brand-primary">{item.name}</span>
                      </div>
                      <span className="font-sans text-brand-gold opacity-8 tracking-normal">{(item.price * item.quantity).toLocaleString()} د.ع</span>
                    </div>
                    {item.customizationText && (
                      <div className="text-[9px] text-brand-gold font-bold tracking-normal mt-1 block">
                        ✨ الخيارات: {item.customizationText}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {order.status === "rejected" && (
                <div className="p-3 bg-red-50 border border-red-100 space-y-2 text-right">
                  <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest leading-none">⚠️ تفاصيل الرفض والطلب تراجعاً</p>
                  <p className="text-xs text-red-900 font-bold leading-relaxed">
                    <span className="text-[10px] text-red-600 font-normal">السبب: </span>{order.rejectionReason}
                  </p>
                  <div className="pt-2 border-t border-red-100 flex items-center justify-between text-[8px] font-bold text-red-800">
                    <span>بواسطة الموظف: <span className="underline">{order.rejectedBy || "غير معروف"}</span></span>
                    <span className="bg-red-100 px-1.5 py-0.5 rounded text-[8px]">
                      {order.rejectedRole === "waiter" ? "طاقم الخدمة والويترز" : "لوحة المطبخ"}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 pt-3 border-t border-border-delicate">
                <div className="flex justify-between items-center">
                  <p className="text-base font-display not-italic text-brand-primary">
                    <span className="font-sans font-bold">{order.totalAmount.toLocaleString()}</span> د.ع
                  </p>
                  {onShowTimeline && (
                    <button
                      onClick={() => onShowTimeline(order)}
                      type="button"
                      className="text-[10px] font-bold text-brand-gold hover:text-brand-primary border border-brand-gold/25 hover:border-brand-primary/20 px-3 py-1.5 rounded transition-all flex items-center gap-1 h-[36px]"
                      title="عرض المخطط الزمني وتتبع الكفاءة"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>⏱️ تفاصيل الأوقات</span>
                    </button>
                  )}
                </div>

                {!isHistory && (
                  <div className="flex items-center justify-end gap-4 mt-1">
                    {order.deviceMetadata?.fingerprint && onBan && (
                      <button
                        onClick={() => onBan(order)}
                        className="text-[10px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 border border-red-100 rounded transition-all duration-300 flex items-center gap-1 shrink-0 h-[36px]"
                        title="حظر هذا العميل من المنيو الرقمي نهائياً"
                      >
                        🚫 حظر
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const nextMap: Record<string, OrderStatus> = {
                          pending: "preparing",
                          preparing: "ready",
                          ready: "served",
                        };
                        onUpdate(order.id, nextMap[order.status] || "served");
                      }}
                      className="flex items-center gap-2 text-[9px] font-bold text-brand-gold uppercase tracking-widest group/btn border border-border-delicate hover:border-brand-primary/20 px-4 py-1.5 rounded transition-all h-[36px] flex-1 justify-center"
                    >
                      {order.status === "pending"
                        ? "إرسال للمطبخ"
                        : order.status === "preparing"
                          ? "تأكيد جاهزية الطبق"
                          : "تأكيد تقديم الطلب"}
                      <ChevronRight className="w-4 h-4 group-hover:-translate-x-1 transition-transform rotate-180" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {orders.length === 0 && (
          <div className="py-20 text-center text-text-muted/20 text-xs font-bold uppercase tracking-widest">
            القائمة فارغة حالياً
          </div>
        )}
      </div>
    </div>
  );
}

function StaffModal({
  onClose,
  restaurantId,
  role,
  existingStaff,
}: {
  onClose: () => void;
  restaurantId: string;
  role: "waiter" | "kitchen";
  existingStaff?: Waiter;
}) {
  const [formData, setFormData] = useState({
    name: existingStaff?.name || "",
    phone: existingStaff?.phone || "",
    username: existingStaff?.username || "",
    password: existingStaff?.password || "",
  });

  useEffect(() => {
    if (!existingStaff) {
      const prefix = role === "waiter" ? "WTR" : "CHEF";
      if (!formData.username)
        setFormData((p) => ({
          ...p,
          username: `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`,
        }));
      if (!formData.password)
        setFormData((p) => ({
          ...p,
          password: Math.random().toString(36).substring(2, 8).toUpperCase(),
        }));
    }
  }, [role, existingStaff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const coll = role === "waiter" ? "waiters" : "kitchen_staff";
    try {
      if (existingStaff) {
        await updateDoc(doc(db, coll, existingStaff.id), formData);
      } else {
        await addDoc(collection(db, coll), {
          ...formData,
          restaurantId,
          status: "active",
        });
      }
      onClose();
    } catch (err) {
      handleFirestoreError(
        err,
        existingStaff ? OperationType.UPDATE : OperationType.CREATE,
        coll,
      );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white max-w-md w-full p-6 sm:p-12 border border-border-delicate relative my-8"
      >
        <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
        <div className="space-y-2 mb-8 text-right">
          <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest">
            تسجيل وتعديل بيانات الموظف
          </p>
          <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
            {existingStaff ? "تعديل بيانات" : "تسجيل وتعيين"}{" "}
            <span className="text-brand-gold">
              {role === "waiter" ? "موظف صالة (ويتر)" : "شيف المطبخ"}
            </span>
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                الاسم الكامل للموظف
              </label>
              <input
                required
                placeholder="الاسم الكامل"
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all text-right"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                رقم الهاتف المباشر
              </label>
              <input
                required
                placeholder="مثال: 0780000000"
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all text-right"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1 text-right">
                <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                  اسم كود التعريف (ID)
                </label>
                <input
                  className="w-full bg-bg-paper border border-border-delicate p-3 text-xs font-bold tracking-widest text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                  value={formData.username}
                  onChange={(e) =>
                    setFormData({ ...formData, username: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1 text-right">
                <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                  رمز المرور السري
                </label>
                <input
                  className="w-full bg-bg-paper border border-border-delicate p-3 text-xs font-bold tracking-widest text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button
              type="submit"
              className="flex-1 py-4 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest shadow-xl hover:bg-brand-secondary text-center"
            >
              تأكيد وتسجيل الموظف
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-4 px-6 border border-border-delicate text-[11px] font-bold uppercase tracking-widest text-text-muted text-center"
            >
              إلغاء والعودة
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

const compressAndResizeImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

function AddProductModal({
  onClose,
  restaurantId,
  existingItem,
  categories,
}: {
  onClose: () => void;
  restaurantId: string;
  existingItem?: MenuItem;
  categories: string[];
}) {
  const [formData, setFormData] = useState({
    name: existingItem?.name || "",
    price: existingItem?.price || 0,
    ingredients: existingItem?.ingredients || "",
    isSpicy: existingItem?.isSpicy || false,
    hasCheese: existingItem?.hasCheese || false,
    cheesePrice: existingItem?.cheesePrice || 0,
    spicyPrice: existingItem?.spicyPrice || 0,
    imageUrl: existingItem?.imageUrl || "",
    category: existingItem?.category || (categories && categories.length > 0 ? categories[0] : "الوجبات الأساسية"),
    isAvailable: existingItem?.isAvailable !== false,
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      setUploadError("حجم الصورة كبير جداً. يرجى اختيار صورة أصغر من 12 ميغابايت.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadError("");
      const compressedRes = await compressAndResizeImage(file);
      setFormData(prev => ({ ...prev, imageUrl: compressedRes }));
    } catch {
      setUploadError("عذراً، فشل تحميل ومعالجة الصورة. يرجى تجربة صورة أخرى.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    setFormData(prev => ({ ...prev, imageUrl: "" }));
    setUploadError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (existingItem) {
        await updateDoc(doc(db, "menuItems", existingItem.id), formData);
      } else {
        await addDoc(collection(db, "menuItems"), {
          ...formData,
          restaurantId,
        });
      }
      onClose();
    } catch (err) {
      handleFirestoreError(
        err,
        existingItem ? OperationType.UPDATE : OperationType.CREATE,
        "menuItems",
      );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white max-w-2xl w-full p-6 sm:p-12 md:p-16 border border-border-delicate relative max-h-[90vh] overflow-y-auto custom-scrollbar my-8"
      >
        <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
        <div className="space-y-2 mb-8 sm:mb-12 text-right">
          <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest">
            إدارة وتحرير أطباق المنيو
          </p>
          <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
            {existingItem ? "تعديل وبيانات" : "إضافة وتعيين"}{" "}
            <span className="text-brand-gold">طبق جديد</span>
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10">
            <div className="space-y-2 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                اسم وجبة الطعام أو المشروب
              </label>
              <input
                required
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-lg text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                placeholder="مثال: كباب بغدادي، كولا..."
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                سعر الوجبة بالدينار العراقي (د.ع)
              </label>
              <input
                required
                type="number"
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-lg text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                placeholder="سعر الطبق د.ع"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="space-y-2 text-right">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
              تصنيف وجبة الطعام (القائمة التابع لها)
            </label>
            <select
              required
              className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary text-right appearance-none"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
            >
              {categories.map((cat) => (
                <option key={cat} value={cat} className="text-brand-primary bg-white text-right">
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4 text-right">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
              صورة وجبة الطعام (من الاستوديو أو المعرض)
            </label>
            
            {formData.imageUrl ? (
              <div className="border border-border-delicate p-6 bg-bg-paper flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="w-24 h-24 sm:w-32 sm:h-32 border border-border-delicate overflow-hidden bg-white shadow-inner flex items-center justify-center">
                  <img 
                    src={formData.imageUrl} 
                    alt="معاينة وجبة الطعام" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 text-center sm:text-right space-y-2">
                  <p className="text-xs text-brand-primary font-bold">تم اختيار الصورة بنجاح</p>
                  <p className="text-[10px] text-text-muted">تم ضغط الصورة تلقائياً لتسريع تحميل المنيو للزبائن</p>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="px-4 py-2 border border-red-200 text-red-800 text-[10px] uppercase font-bold tracking-wider hover:bg-red-50 transition-colors"
                  >
                    حذف صورة الوجبة وإضافة غيرها
                  </button>
                </div>
              </div>
            ) : (
              <label className="border-2 border-dashed border-border-delicate hover:border-brand-gold p-8 sm:p-12 flex flex-col items-center justify-center gap-4 cursor-pointer bg-bg-paper transition-all relative overflow-hidden group">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isUploading}
                />
                <div className="w-16 h-16 border border-border-delicate rounded-full flex items-center justify-center bg-white group-hover:scale-105 transition-transform duration-300">
                  {isUploading ? (
                    <div className="w-5 h-5 border-2 border-brand-gold border-t-transparent animate-spin rounded-full" />
                  ) : (
                    <Camera className="w-6 h-6 text-brand-gold" />
                  )}
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs sm:text-sm font-bold text-brand-primary">
                    {isUploading ? "جاري ضغط ومعالجة الصورة..." : "اضغط هنا لاختيار صورة من الاستوديو"}
                  </p>
                  <p className="text-[10px] text-text-muted">تدعم الصور من كافة الصيغ (PNG, JPG, HEIC)</p>
                </div>
              </label>
            )}

            {uploadError && (
              <p className="text-[10px] text-red-800 font-bold bg-red-50 border-r-2 border-red-800 p-2 text-right">
                {uploadError}
              </p>
            )}
          </div>

          <div className="space-y-2 text-right">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
              مكونات وتفاصيل وجبة الطعام
            </label>
            <textarea
              className="w-full bg-bg-paper border border-border-delicate p-4 sm:p-6 font-display text-brand-primary focus:border-brand-primary outline-none h-28 sm:h-32 resize-none text-right"
              placeholder="مثال: لحم عراقي طازج، متبل بالبهارات الخاصة، يقدم مع الخبز الحار والسلطات..."
              value={formData.ingredients}
              onChange={(e) =>
                setFormData({ ...formData, ingredients: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 sm:p-10 bg-bg-paper border border-border-delicate">
            <label className="flex items-center gap-4 cursor-pointer group justify-end w-full">
              <span className="text-[11px] font-bold uppercase tracking-widest text-brand-primary text-right">
                الوجبة متوفرة للطلب؟
              </span>
              <input
                type="checkbox"
                className="hidden"
                checked={formData.isAvailable}
                onChange={(e) =>
                  setFormData({ ...formData, isAvailable: e.target.checked })
                }
              />
              <div
                className={`w-8 h-8 sm:w-10 sm:h-10 border border-border-delicate flex items-center justify-center transition-all ${formData.isAvailable ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white"}`}
              >
                {formData.isAvailable && (
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </div>
            </label>
            <label className="flex items-center gap-4 cursor-pointer group justify-end w-full">
              <span className="text-[11px] font-bold uppercase tracking-widest text-brand-primary text-right">
                الوجبة حارة؟ (سبايسي)
              </span>
              <input
                type="checkbox"
                className="hidden"
                checked={formData.isSpicy}
                onChange={(e) =>
                  setFormData({ ...formData, isSpicy: e.target.checked })
                }
              />
              <div
                className={`w-8 h-8 sm:w-10 sm:h-10 border border-border-delicate flex items-center justify-center transition-all ${formData.isSpicy ? "bg-brand-primary text-white" : "bg-white"}`}
              >
                {formData.isSpicy && (
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </div>
            </label>
            <label className="flex items-center gap-4 cursor-pointer group justify-end w-full">
              <span className="text-[11px] font-bold uppercase tracking-widest text-brand-primary text-right">
                تحتوي على الجبن؟
              </span>
              <input
                type="checkbox"
                className="hidden"
                checked={formData.hasCheese}
                onChange={(e) =>
                  setFormData({ ...formData, hasCheese: e.target.checked })
                }
              />
              <div
                className={`w-8 h-8 sm:w-10 sm:h-10 border border-border-delicate flex items-center justify-center transition-all ${formData.hasCheese ? "bg-brand-gold text-white" : "bg-white"}`}
              >
                {formData.hasCheese && (
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </div>
            </label>
          </div>

          {/* أسعار الخيارات المميزة */}
          {(formData.isSpicy || formData.hasCheese) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10 p-6 sm:p-10 bg-brand-primary/[0.02] border border-border-delicate/80 text-right">
              {formData.hasCheese && (
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                    سعر إضافة الجبن الإضافي (د.ع)
                  </label>
                  <input
                    type="number"
                    className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                    placeholder="مثال: 1000"
                    value={formData.cheesePrice}
                    onChange={(e) =>
                      setFormData({ ...formData, cheesePrice: Number(e.target.value) })
                    }
                  />
                  <p className="text-[9px] text-text-muted">السعر الإضافي الذي سيزاد على سعر الوجبة الأساسي عند طلب الجبن.</p>
                </div>
              )}
              {formData.isSpicy && (
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                    سعر خيار سبايسي الإضافي (د.ع)
                  </label>
                  <input
                    type="number"
                    className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                    placeholder="مثال: 500"
                    value={formData.spicyPrice}
                    onChange={(e) =>
                      setFormData({ ...formData, spicyPrice: Number(e.target.value) })
                    }
                  />
                  <p className="text-[9px] text-text-muted">السعر الإضافي عند طلب الخيار الحار (يمكن تركه 0 إذا كان مجاناً).</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button
              type="submit"
              className="flex-1 py-4 sm:py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest shadow-2xl hover:bg-brand-secondary text-center"
            >
              حفظ وتثبيت الطبق بالمنيو
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-4 px-8 border border-border-delicate text-[11px] font-bold uppercase tracking-widest text-text-muted text-center"
            >
              رجوع للخلف
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
