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
} from "../lib/supabase-db";
import { db } from "../lib/supabase-db";
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
import { MENU_THEMES, contrastRatio, resolveTheme, themeStyle, ThemeColors } from "../lib/themes";
import { supabase } from "../lib/supabase";
import { persistRestaurantImage } from "../lib/storage";
import { DEFAULT_SYSTEM_LOGO } from "../lib/brand";
import { localizeCategory, localizeDeviceType, useLanguage } from "../lib/i18n";
import QrPrintStudio, { imageDataUrl } from "./QrPrintStudio";
import { customerMenuUrl, staffPortalUrl } from '../lib/public-urls';
import { baghdadDayKey, summarizeOwnerOrders } from '../lib/owner-finance';

const RestaurantLocationMap = React.lazy(() => import('./RestaurantLocationMap'));

const DEFAULT_MENU_CATEGORIES = ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"];

const resolveMenuCategories = (categories?: string[]) =>
  categories?.filter((category) => category.trim().length > 0).length
    ? categories.filter((category) => category.trim().length > 0)
    : DEFAULT_MENU_CATEGORIES;

interface RestaurantDashboardProps {
  restaurantId: string;
  activeTab?: "overview" | "waiters" | "orders" | "menu" | "theme" | "help" | "qr" | "alerts";
  onThemeChange?: (restaurant: Restaurant) => void;
}

export default function RestaurantDashboard({
  restaurantId,
  activeTab: externalTab,
  onThemeChange,
}: RestaurantDashboardProps) {
  const { dir, language, tr } = useLanguage();
  const [internalTab, setInternalTab] = useState<
    "overview" | "waiters" | "orders" | "archive" | "menu" | "theme" | "help" | "qr" | "alerts"
  >("overview");
  const activeTab = externalTab || internalTab;
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kitchenStaff, setKitchenStaff] = useState<Waiter[]>([]);
  const [cashiers, setCashiers] = useState<Waiter[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [bannedDevices, setBannedDevices] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restaurantLoadError, setRestaurantLoadError] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState<{
    open: boolean;
    role: "waiter" | "kitchen" | "cashier";
    staff?: Waiter;
  } | null>(null);
  const [staffPasscodeVersion, setStaffPasscodeVersion] = useState(0);
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
  const [qrLogoData, setQrLogoData] = useState<string | null>(null);
  const [qrDownloadError, setQrDownloadError] = useState("");

  useEffect(() => {
    let active = true;
    setQrLogoData(null);
    setQrDownloadError("");
    const logoUrl = restaurant?.logoUrl || DEFAULT_SYSTEM_LOGO;
    imageDataUrl(logoUrl)
      .catch(() => imageDataUrl(DEFAULT_SYSTEM_LOGO))
      .then(data => { if (active) setQrLogoData(data); })
      .catch(() => { if (active) setQrDownloadError(tr('تعذر تحميل شعار رمز QR.', 'Could not load the QR logo.')); });
    return () => { active = false; };
  }, [restaurant?.logoUrl, language]);

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

  const [selectedProfitDate, setSelectedProfitDate] = useState<string>(() => baghdadDayKey(Date.now()));
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
  const [radiusInput, setRadiusInput] = useState<string>("150");
  const [selectingLocationOnMap, setSelectingLocationOnMap] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [financeNow, setFinanceNow] = useState(Date.now());
  const [savingLocation, setSavingLocation] = useState(false);
  const [fetchingLocationGPS, setFetchingLocationGPS] = useState(false);
  const locationInitializedFor = React.useRef<string | null>(null);

  useEffect(() => {
    if (!restaurant || locationInitializedFor.current === restaurant.id) return;
    locationInitializedFor.current = restaurant.id;
    setLatInput(restaurant.latitude == null ? '' : String(restaurant.latitude));
    setLngInput(restaurant.longitude == null ? '' : String(restaurant.longitude));
    setRadiusInput(String(Math.min(1000, Math.max(10, restaurant.geofenceRadiusMeters || 150))));
  }, [restaurant]);

  useEffect(() => {
    const timer = window.setInterval(() => setFinanceNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleUpdateLocation = async () => {
    const latNum = parseFloat(latInput);
    const lngNum = parseFloat(lngInput);
    const radiusNum = parseFloat(radiusInput);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
      setLocationMessage(tr('حدد موقع المطعم على الخريطة أولاً.', 'Choose the restaurant location on the map first.'));
      return;
    }
    if (!Number.isInteger(radiusNum) || radiusNum < 10 || radiusNum > 1000) {
      setLocationMessage(tr('اختر نطاقاً بين ١٠ و١٠٠٠ متر.', 'Choose a radius between 10 and 1000 meters.'));
      return;
    }
    try {
      setSavingLocation(true);
      await updateDoc(doc(db, "restaurants", restaurantId), {
        latitude: latNum,
        longitude: lngNum,
        geofenceRadiusMeters: radiusNum,
      });
      setLocationMessage(tr('تم حفظ الموقع ونطاق التحقق بنجاح.', 'Location and allowed radius saved.'));
      if (restaurant) {
        setRestaurant({ ...restaurant, latitude: latNum, longitude: lngNum, geofenceRadiusMeters: radiusNum });
      }
    } catch (err) {
      setLocationMessage(tr('تعذر حفظ الموقع. تحقق من الاتصال ثم أعد المحاولة.', 'Could not save location. Check your connection and retry.'));
    } finally {
      setSavingLocation(false);
    }
  };

  const handleFetchCurrentGPS = () => {
    if (!navigator.geolocation) {
      alert(tr('متصفحك لا يدعم تتبع وتحديد المواقع الجغرافية GPS.', 'Your browser does not support location services.'));
      return;
    }
    setFetchingLocationGPS(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatInput(position.coords.latitude.toString());
        setLngInput(position.coords.longitude.toString());
        setFetchingLocationGPS(false);
        setSelectingLocationOnMap(false);
        setLocationMessage(tr('تم تحديد موقعك الحالي. راجع الدائرة ثم احفظ.', 'Current location selected. Review the circle, then save.'));
      },
      () => {
        setFetchingLocationGPS(false);
        setLocationMessage(tr('تعذر تحديد الموقع. اسمح للموقع بالوصول إلى GPS أو اختره على الخريطة.', 'Could not get your location. Allow GPS access or pick the restaurant on the map.'));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      if (!restaurant) return;
      const currentCats = resolveMenuCategories(restaurant.categories);
      if (currentCats.includes(newCategoryName.trim())) {
        alert(tr('هذا القسم موجود بالفعل في قائمتك.', 'This category already exists.'));
        return;
      }
      const updated = [...currentCats, newCategoryName.trim()];
      await updateDoc(doc(db, "restaurants", restaurantId), { categories: updated });
      setNewCategoryName("");
      setRestaurant(prev => prev ? { ...prev, categories: updated } : null);
    } catch (err) {
      alert(tr('فشل في إضافة القسم. يرجى المحاولة مجدداً.', 'Could not add the category. Please retry.'));
    }
  };

  const handleDeleteCategory = async (catToDelete: string) => {
    if (!confirm(tr(`هل أنت متأكد من حذف قسم "${catToDelete}"؟ الوجبات المصنفة تحت هذا القسم ستبقى ولكن تصنيفها سيصبح غير محدد.`, `Delete category "${catToDelete}"? Its dishes will remain but become uncategorized.`))) {
      return;
    }
    try {
      if (!restaurant) return;
      const currentCats = resolveMenuCategories(restaurant.categories);
      const updated = currentCats.filter(c => c !== catToDelete);
      await updateDoc(doc(db, "restaurants", restaurantId), { categories: updated });
      setRestaurant(prev => prev ? { ...prev, categories: updated } : null);
    } catch (err) {
      alert(tr('فشل في حذف القسم.', 'Could not delete the category.'));
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
      alert(tr(`🚫 تم حظر الزبون "${order.customerName}" بنجاح وتجميد بصمة جهازه لمنع إجرائه لأي طلبات مستقبلية.`, `Customer "${order.customerName}" was blocked from placing new orders.`));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "banned_devices");
    }
  };

  const executeResetOrderCounter = async () => {
    try {
      setIsResetting(true);
      const { data: successCount, error } = await supabase.rpc('reset_restaurant_shift', { p_restaurant_id: restaurantId });
      if (error) throw error;

      alert(tr(`✅ تم تصفير عداد أرقام الطلبات بنجاح!\n• سيبدأ الطلب القادم من الرقم 1.\n• تم أرشفة وإخفاء ${successCount} من الطلبات القديمة لبدء يوم عمل جديد.`, `✅ Order counter reset. The next order starts at 1; ${successCount} old orders were archived.`));
    } catch (err: any) {
      console.error("Failed to reset order counter:", err);
      alert(tr('❌ فشل تصفير عداد الطلبيات. السبب: ', '❌ Could not reset the order counter: ') + (err?.message || err));
    } finally {
      setIsResetting(false);
    }
  };

  const finance = summarizeOwnerOrders(orders, financeNow);
  const draftLat = Number(latInput);
  const draftLng = Number(lngInput);
  const draftPoint = latInput !== '' && lngInput !== '' && Number.isFinite(draftLat) && Number.isFinite(draftLng)
    && Math.abs(draftLat) <= 90 && Math.abs(draftLng) <= 180 ? { latitude: draftLat, longitude: draftLng } : null;

  // Profit analytical date filters
  const selectedDateOrders = orders.filter(o => {
    try {
      return baghdadDayKey(new Date(o.createdAt)) === selectedProfitDate;
    } catch {
      return false;
    }
  });
  const selectedDateEarnings = selectedDateOrders.reduce((sum, o) => o.status === 'served' ? sum + o.totalAmount : sum, 0);
  const selectedDateCancelled = selectedDateOrders.filter(o => o.status === 'cancelled' || o.status === 'rejected').length;

  useEffect(() => {
    let active = true;
    let missingRetryTimer: number | null = null;
    let positiveReadVersion = 0;
    setLoading(true);
    setRestaurantLoadError(false);
    setRestaurant(null);
    const unsubRestaurant = onSnapshot(
      doc(db, "restaurants", restaurantId),
      (snap) => {
        if (!active) return;
        if (snap.exists()) {
          positiveReadVersion += 1;
          if (missingRetryTimer !== null) window.clearTimeout(missingRetryTimer);
          missingRetryTimer = null;
          setRestaurant({ id: snap.id, ...snap.data() } as Restaurant);
          setRestaurantLoadError(false);
          setLoading(false);
        } else if (missingRetryTimer === null) {
          // An initial empty RLS read can race session restoration. Confirm it
          // before showing an unavailable restaurant instead of flashing it.
          missingRetryTimer = window.setTimeout(async () => {
            missingRetryTimer = null;
            const retryVersion = positiveReadVersion;
            try {
              const retry = await getDoc(doc(db, "restaurants", restaurantId));
              if (!active || retryVersion !== positiveReadVersion) return;
              setRestaurant(retry.exists() ? { id: retry.id, ...retry.data() } as Restaurant : null);
              setRestaurantLoadError(false);
            } catch (error) {
              if (!active || retryVersion !== positiveReadVersion) return;
              console.error("Unable to confirm restaurant availability", error);
              setRestaurantLoadError(true);
            } finally {
              if (active && retryVersion === positiveReadVersion) setLoading(false);
            }
          }, 1000);
        }
      },
      (err) => {
        if (!active) return;
        console.error("Unable to load restaurant", err);
        setRestaurantLoadError(true);
        setLoading(false);
      }
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
      (err) => console.error("Unable to load waiters", err),
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
      (err) => console.error("Unable to load kitchen staff", err),
    );
    const unsubCashiers = onSnapshot(
      query(collection(db, "cashier_staff"), where("restaurantId", "==", restaurantId)),
      snapshot => setCashiers(snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as Waiter)),
      err => console.error("Unable to load cashiers", err),
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
      (err) => console.error("Unable to load menu items", err),
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
      (err) => console.error("Unable to load orders", err),
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
      (err) => console.error("Unable to load security alerts", err),
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
      (err) => console.error("Unable to load banned devices", err),
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
      (err) => console.error("Unable to load announcements", err),
    );

    return () => {
      active = false;
      if (missingRetryTimer !== null) window.clearTimeout(missingRetryTimer);
      unsubRestaurant();
      unsubWaiters();
      unsubKitchen();
      unsubCashiers();
      unsubMenu();
      unsubOrders();
      unsubAlerts();
      unsubBanned();
      unsubAnnouncements();
    };
  }, [restaurantId]);

  const fetchRestaurant = async () => {
    setLoading(true);
    setRestaurantLoadError(false);
    try {
      const docRef = doc(db, "restaurants", restaurantId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setRestaurant({ id: docSnap.id, ...docSnap.data() } as Restaurant);
      } else {
        setRestaurant(null);
      }
    } catch (err) {
      console.error("Unable to retry restaurant load", err);
      setRestaurantLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
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
      alert(tr("تعذر تحديث حالة الطلب. حاول مجدداً.", "Could not update the order status. Please retry."));
    }
  };

  const deleteMenuItem = async (itemId: string) => {
    if (confirm(tr('هل أنت متأكد من حذف هذا المنتج؟', 'Delete this menu item?'))) {
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
    role: "waiter" | "kitchen" | "cashier",
  ) => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('authentication_required');
      const response = await fetch(`/api/staff/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ restaurantId, status: current === 'active' ? 'suspended' : 'active' }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'staff_status_failed');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `staff/${id}`);
    }
  };

  const deleteStaff = async (id: string, role: "waiter" | "kitchen" | "cashier") => {
    if (confirm(tr('حذف هذا الموظف؟', 'Delete this staff member?'))) {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('authentication_required');
        const response = await fetch(`/api/staff/${encodeURIComponent(id)}?restaurantId=${encodeURIComponent(restaurantId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${data.session.access_token}` } });
        if (!response.ok) throw new Error((await response.json()).error || 'staff_delete_failed');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `staff/${id}`);
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
    if (confirm(tr('هل أنت متأكد من حذف هذا التنبيه نهائياً؟', 'Permanently delete this alert?'))) {
      try {
        await deleteDoc(doc(db, "security_alerts", alertId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `security_alerts/${alertId}`);
      }
    }
  };

  const cancelAllOrdersByFingerprint = async (fingerprint: string) => {
    if (confirm(tr('هل أنت متأكد من إلغاء وحظر جميع طلبات هذا العميل (البصمة الرقمية المحفوظة له)؟ سيتم إلغاء جميع الطلبات المعلقة المرتبطة بهذا الجهاز تلقائياً.', 'Cancel all pending orders associated with this device fingerprint?'))) {
      try {
        const suspiciousOrders = orders.filter(o => o.deviceMetadata?.fingerprint === fingerprint && o.status !== 'cancelled');
        await Promise.all(
          suspiciousOrders.map(o => 
            updateDoc(doc(db, "orders", o.id), { status: 'cancelled', notes: (o.notes || "") + " [ملغى تلقائياً بسبب شبهة احتيال بالتنبيهات]" })
          )
        );
        alert(tr(`تم إلغاء ${suspiciousOrders.length} طلبات معلقة بنجاح!`, `${suspiciousOrders.length} pending orders were cancelled.`));
      } catch (err) {
        alert(tr('فشل في إلغاء طلبات البصمة.', 'Could not cancel the device orders.'));
      }
    }
  };

  const downloadQR = () => {
    const svg = document.getElementById("menu-qr");
    if (svg && qrLogoData) {
      setQrDownloadError("");
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      const svgUrl = URL.createObjectURL(new Blob([svgData], { type: "image/svg+xml;charset=utf-8" }));
      img.onload = () => {
        try {
          canvas.width = 1024;
          canvas.height = 1024;
          if (!ctx) throw new Error("canvas_unavailable");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const downloadLink = document.createElement("a");
          downloadLink.download = `${restaurant?.restaurantName}-Menu-QR.png`;
          downloadLink.href = canvas.toDataURL("image/png");
          downloadLink.click();
        } catch {
          setQrDownloadError(tr('تعذر تنزيل رمز QR. حاول مرة أخرى.', 'Could not download the QR code. Try again.'));
        } finally {
          URL.revokeObjectURL(svgUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        setQrDownloadError(tr('تعذر تنزيل رمز QR. حاول مرة أخرى.', 'Could not download the QR code. Try again.'));
      };
      img.src = svgUrl;
    }
  };

  if (loading && (!restaurant || restaurant.id !== restaurantId)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-border-delicate bg-white p-8 text-center" role="status" dir={dir}>
        <p className="text-sm font-semibold text-text-muted">{tr('جاري تحميل بيانات المطعم...', 'Loading restaurant details...')}</p>
      </div>
    );
  }

  if (!restaurant || restaurant.id !== restaurantId) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[60vh] text-center space-y-6 bg-white border border-border-delicate" dir={dir}>
        <AlertCircle className="w-16 h-16 text-brand-gold" />
        <h2 className="text-3xl font-display text-brand-primary">{restaurantLoadError ? tr('تعذر تحميل بيانات المطعم', 'Could not load restaurant') : tr('المطعم غير متاح حالياً', 'Restaurant unavailable')}</h2>
        <p className="text-text-muted max-w-md">{tr('تحقق من الاتصال ثم أعد المحاولة. إذا استمرت المشكلة، تواصل مع المسؤول.', 'Check your connection and retry. If this continues, contact an administrator.')}</p>
        <button onClick={() => void fetchRestaurant()} className="bg-brand-primary text-white px-8 py-4 font-bold text-xs uppercase tracking-widest hover:bg-brand-secondary transition-all">
          {tr('إعادة المحاولة', 'Retry')}
        </button>
        <button 
          onClick={() => {
            localStorage.removeItem('novx_session');
            window.location.reload();
          }}
          className="bg-brand-primary text-white px-8 py-4 font-bold text-xs uppercase tracking-widest hover:bg-brand-secondary transition-all"
        >
          {tr('تسجيل الخروج والعودة لصفحة الدخول', 'Sign out and return to login')}
        </button>
      </div>
    );
  }

  const now = new Date().getTime();
  const expiryTime = restaurant.endDate ? new Date(restaurant.endDate).getTime() : 0;
  const oneDay = 24 * 60 * 60 * 1000;
  const isWarningBefore = expiryTime > 0 && now < expiryTime && (expiryTime - now <= 3 * oneDay);
  const isWarningAfter = expiryTime > 0 && now >= expiryTime && (now - expiryTime <= 3 * oneDay);
  const graceMs = (restaurant.gracePeriodDays ?? 0) * oneDay;
  const isExpiredAndLocked = expiryTime <= 0 || now >= expiryTime + graceMs;

  if (isExpiredAndLocked) {
    return (
      <div className="flex flex-col items-center justify-center p-12 min-h-[60vh] text-center space-y-8 bg-white border border-red-200" dir={dir}>
        <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-100">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <div className="space-y-4 max-w-lg">
          <h2 className="text-3xl font-display text-red-700 font-bold">{tr('عذراً، انتهى اشتراك النظام!', 'Subscription expired')}</h2>
          <p className="text-text-muted leading-relaxed font-sans">
            {tr('انتهت فترة الاشتراك. تم إيقاف لوحة التحكم مؤقتاً حتى التجديد.', 'The subscription has ended. This workspace is unavailable until renewal.')}
          </p>
          <div className="bg-red-50 p-6 rounded-xl border border-red-100 text-center font-display space-y-2">
            <p className="text-xs text-red-800 font-bold">{tr('يرجى الاتصال بفريق الدعم الفني فوراً من أجل تجديد الاشتراك وتفعيل النظام:', 'Contact support to renew and reactivate the service:')}</p>
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
          {tr('تسجيل الخروج والعودة لصفحة الدخول', 'Sign out and return to login')}
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard-surface space-y-6" dir={dir}>
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="p-4 bg-red-600 text-white rounded-none flex items-center justify-center gap-3 text-right font-sans font-bold text-xs" id="admin-offline-banner">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span>{tr('تنبيه الاتصال: إنترنت الإدارة غير مستقر أو منقطع حالياً! لا تقلق، البيانات مخزنة أوفلاين وسيقوم المتصفح بإرسال جميع تحديثات الطلبات فور إعادة الاتصال بالشبكة.', 'Connection warning: Internet access is unstable or offline. Changes will sync when the connection returns.')}</span>
        </div>
      )}

      {/* Expiry alerts */}
      {isWarningBefore && (
        <div className="p-6 bg-amber-50 border border-amber-200 text-amber-900 rounded-none flex items-center gap-4 text-right">
          <Bell className="w-6 h-6 text-amber-600 shrink-0" />
          <p className="text-sm font-bold font-sans">
            {tr('تنبيه هام: اشتراككم قارب على الانتهاء وسوف ينتهي بعد أقل من 3 أيام. يرجى تجديد الاشتراك لضمان استمرار الخدمة دون انقطاع. للاتصال بالدعم الفني:', 'Your subscription expires in less than 3 days. Renew to avoid interruption. Support:')} <span className="font-display font-medium text-amber-800">{supportPhone}</span>
          </p>
        </div>
      )}

      {isWarningAfter && (
        <div className="p-6 bg-red-50 border border-red-200 text-red-950 rounded-none flex items-center gap-4 text-right">
          <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 animate-pulse" />
          <p className="text-sm font-bold font-sans">
            {tr('انتهى الاشتراك. جدد لاستعادة الخدمة أو اتصل بالدعم:', 'The subscription has ended. Renew to restore service or contact support:')} <span className="font-display font-bold text-red-800">{supportPhone}</span>
          </p>
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
            <section
              className="relative overflow-hidden rounded-[28px] bg-[#081d2d] px-6 py-8 text-white shadow-[0_20px_45px_rgba(8,18,32,0.14)] sm:px-10 sm:py-10"
            >
              <div className="pointer-events-none absolute -top-24 -end-20 h-72 w-72 rounded-full border-[36px] border-white/[0.04]" />
              <div className="pointer-events-none absolute -bottom-32 start-1/3 h-64 w-64 rounded-full bg-white/[0.04] blur-2xl" />
              <div className="relative flex flex-col gap-8">
                <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-7">
                  <img
                    src={restaurant.logoUrl || systemLogo || '/ordova-mark.png'}
                    className="h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20"
                    alt={restaurant.logoUrl ? tr('شعار المطعم', 'Restaurant logo') : tr('شعار أوردوفا', 'Ordova logo')}
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
                      {tr('لوحة التحكم للمدير المالك', 'Owner dashboard')}
                    </p>
                    <h1 className="font-display text-2xl font-bold leading-tight sm:text-4xl">
                      {tr('أهلاً بك،', 'Welcome,')} <span className="text-white">{restaurant.restaurantName}</span>
                    </h1>
                    <p className="text-sm text-white/75">
                      {tr('المدير المسؤول:', 'Manager:')} {restaurant.managerName}
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 border-t border-white/20 pt-6 sm:grid-cols-2 sm:gap-8">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-white/65">{tr('حالة الاشتراك', 'Subscription')}</p>
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${restaurant.status === 'active' ? 'bg-emerald-400/15 text-emerald-100' : 'bg-red-400/20 text-red-100'}`}>
                      <span className={`h-2 w-2 rounded-full ${restaurant.status === 'active' ? 'bg-emerald-300' : 'bg-red-300'}`} />
                      {restaurant.status === 'active' ? tr('باقة بريميوم نشطة', 'Active plan') : tr('منتهي الاشتراك', 'Expired')}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-white/65">{tr('تاريخ التجديد', 'Renewal date')}</p>
                    <p className="text-base font-bold text-white">{safeFormatDate(restaurant.endDate, 'yyyy/MM/dd')}</p>
                  </div>
                </div>
              </div>
            </section>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title={tr('قيمة الطلبات المقدمة اليوم', 'Served order value today')}
                value={finance.todayValue.toLocaleString()}
                unit={tr('د.ع', 'IQD')}
                label={tr('حسب الطلبات المقدمة فقط', 'Served orders only')}
                icon={<ClipboardList className="w-5 h-5" />}
              />
              <StatCard
                title={tr('قيمة الطلبات المقدمة هذا الشهر', 'Served order value this month')}
                value={finance.monthValue.toLocaleString()}
                unit={tr('د.ع', 'IQD')}
                label={tr(`من ${finance.monthServedCount} طلب مقدم`, `From ${finance.monthServedCount} served orders`)}
                icon={<BarChart3 className="w-5 h-5" />}
              />
              <StatCard
                title={tr('خدمة الصالة والموظفين', 'Service staff')}
                value={waiters.length}
                label={tr('الموظفين المسجلين', 'Registered staff')}
                icon={<Users className="w-5 h-5" />}
              />
              <StatCard
                title={tr('فريق الطهي', 'Kitchen team')}
                value={kitchenStaff.length}
                label={tr('طاقم المطبخ المعتمد', 'Kitchen staff')}
                icon={<ChefHat className="w-5 h-5" />}
              />
            </div>

            <OwnerFinancePanel finance={finance} />

            {/* Specific Day Profit Analyzer */}
            <div className="relative space-y-6 overflow-hidden rounded-2xl border border-border-delicate bg-white p-6 text-right sm:p-8" dir={dir}>
              <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-gold" />
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-brand-gold">{tr('مراجعة الأيام', 'Daily review')}</p>
                    <h3 className="text-xl font-bold text-brand-primary">{tr('تفاصيل يوم محدد', 'A closer look at any day')}</h3>
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
                <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-border-delicate bg-bg-paper p-4 text-right">
                    <p className="text-xs font-bold text-text-muted">{tr('قيمة الطلبات المقدمة', 'Served order value')}</p>
                    <p className="text-md sm:text-lg font-display text-brand-primary not-italic font-bold truncate mt-1">
                      <span className="font-sans">{selectedDateEarnings.toLocaleString()}</span> <span className="text-[10px]">{tr('د.ع', 'IQD')}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-border-delicate bg-bg-paper p-4 text-right">
                    <p className="text-xs font-bold text-text-muted">{tr('طلبات مقدمة', 'Served orders')}</p>
                    <p className="text-md sm:text-lg font-display text-brand-primary not-italic font-bold mt-1">
                      <span className="font-sans">{selectedDateOrders.filter(o => o.status === 'served').length}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-border-delicate bg-bg-paper p-4 text-right">
                    <p className="text-xs font-bold text-text-muted">{tr('ملغاة أو مرفوضة', 'Cancelled or rejected')}</p>
                    <p className="text-md sm:text-lg font-display text-red-800 not-italic font-bold mt-1">
                      <span className="font-sans">{selectedDateCancelled}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Geofence & Location Control Center */}
            <section className="space-y-5 rounded-2xl border border-border-delicate bg-white p-5 sm:p-7" dir={dir}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="mb-1 text-xs font-bold text-brand-gold">{tr('حماية الطلبات بالموقع', 'Location-based order protection')}</p><h3 className="text-xl font-bold text-brand-primary">{tr('موقع المطعم ونطاق الخدمة', 'Restaurant location and service area')}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">{tr('حدد مركز المطعم بالطريقة المناسبة، ثم اسحب الشريط لتشاهد المدى المسموح للزبائن على الخريطة.', 'Set the restaurant point, then drag the slider to preview the customer ordering area on the map.')}</p></div>
                <span className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${restaurant.latitude != null && restaurant.longitude != null ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}><span className="h-2 w-2 rounded-full bg-current" />{restaurant.latitude != null && restaurant.longitude != null ? tr('الموقع محفوظ', 'Location saved') : tr('الموقع غير محدد', 'No location saved')}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={handleFetchCurrentGPS} disabled={fetchingLocationGPS} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 text-sm font-bold text-white disabled:opacity-50"><MapPin className="h-4 w-4" />{fetchingLocationGPS ? tr('جاري تحديد الموقع...', 'Locating...') : tr('تحديد موقعي الحالي كمطعم', 'Use my current location')}</button>
                <button type="button" onClick={() => { setSelectingLocationOnMap(true); setLocationMessage(tr('انقر على موضع المطعم داخل الخريطة.', 'Tap the restaurant position on the map.')); }} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold ${selectingLocationOnMap ? 'border-brand-gold bg-amber-50 text-brand-primary' : 'border-border-delicate text-brand-primary hover:bg-bg-paper'}`}><MapPin className="h-4 w-4" />{selectingLocationOnMap ? tr('انقر على الخريطة الآن', 'Tap the map now') : tr('تحديد المطعم على الخريطة', 'Choose on the map')}</button>
              </div>
              <div className="relative z-0 overflow-hidden rounded-2xl border border-border-delicate"><React.Suspense fallback={<div className="flex h-72 items-center justify-center bg-bg-paper text-sm text-text-muted">{tr('جاري تحميل الخريطة...', 'Loading map...')}</div>}><RestaurantLocationMap point={draftPoint} radius={Number(radiusInput) || 150} selecting={selectingLocationOnMap} onSelect={point => { setLatInput(String(point.latitude)); setLngInput(String(point.longitude)); setSelectingLocationOnMap(false); setLocationMessage(tr('تم اختيار الموقع. راجع الدائرة ثم احفظ.', 'Location selected. Review the circle, then save.')); }} /></React.Suspense></div>
              <div className="rounded-xl bg-bg-paper p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3"><label htmlFor="service-radius" className="text-sm font-bold text-brand-primary">{tr('نصف قطر التحقق', 'Allowed radius')}</label><span className="rounded-lg bg-white px-3 py-1 text-sm font-bold text-brand-primary" dir="ltr">{Number(radiusInput).toLocaleString()} {tr('متر', 'm')}</span></div>
                <input id="service-radius" type="range" min="10" max="1000" step="10" value={radiusInput} onChange={event => { setRadiusInput(event.target.value); setLocationMessage(''); }} className="w-full accent-emerald-700" />
                <div className="mt-1 flex justify-between text-xs text-text-muted" dir="ltr"><span>10 m</span><span>1,000 m</span></div>
                <p className="mt-3 text-xs leading-5 text-text-muted">{tr('الدائرة على الخريطة تمثل المسافة من مركز المطعم، وليست مساحة بالمتر المربع.', 'The circle shows distance from the restaurant point in meters.')}</p>
              </div>
              <div className="flex flex-col gap-3 border-t border-border-delicate pt-4 sm:flex-row sm:items-center sm:justify-between"><p role="status" className="text-sm text-text-muted">{locationMessage || (draftPoint ? tr('راجع الموقع والمدى ثم احفظ التغييرات.', 'Review the location and radius, then save.') : tr('اختر موقع المطعم لعرض دائرة النطاق.', 'Choose a location to preview the allowed area.'))}</p><button type="button" onClick={handleUpdateLocation} disabled={savingLocation || !draftPoint} className="min-h-11 rounded-xl bg-brand-primary px-6 text-sm font-bold text-white disabled:opacity-50">{savingLocation ? tr('جاري الحفظ...', 'Saving...') : tr('حفظ الموقع والنطاق', 'Save location and radius')}</button></div>
            </section>

            <div className="grid grid-cols-1 gap-8">
              <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-8">
                <div className="flex items-center gap-4">
                  <div className="w-1.5 h-6 bg-brand-gold" />
                  <h3 className="text-xl font-display text-brand-primary italic tracking-tight">
                    {tr('الفعاليات والطلبات الأخيرة', 'Recent orders')}
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
                            / {tr('طاولة', 'Table')} {order.tableNumber}
                          </span>
                        </p>
                        <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">
                          {safeFormatDate(order.createdAt, "hh:mm a")}
                        </p>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t border-border-delicate/40 sm:border-t-0 pt-4 sm:pt-0">
                        <span className="text-sm font-display italic text-brand-primary font-bold">
                          {order.totalAmount.toLocaleString()} {tr('د.ع', 'IQD')}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest p-2 bg-white border border-border-delicate min-w-[80px] text-center">
                          {order.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {orders.length === 0 && (
                    <div className="text-center py-20 text-text-muted italic opacity-40">
                      {tr('لا توجد طلبات واردة حالياً.', 'No recent orders.')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "theme" && restaurant && (
          <ThemeSettings restaurant={restaurant} onSaved={(next) => { setRestaurant(next); onThemeChange?.(next); }} />
        )}

        {activeTab === "waiters" && (
          <motion.div
            key="waiters"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-8"
          >
            <div className="relative overflow-hidden rounded-3xl bg-[#081d2d] p-6 text-white shadow-xl sm:p-8">
              <div className="absolute -end-16 -top-20 h-56 w-56 rounded-full border border-white/10 bg-white/5" />
              <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div><p className="mb-2 text-xs font-bold text-brand-gold">{tr('إدارة الفريق', 'Team management')}</p><h2 className="text-2xl font-bold sm:text-3xl">{tr('طاقم مطعمك في مكان واحد', 'Your team in one place')}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-white/65">{tr('تابع موظفي الصالة والمطبخ، وعدّل بياناتهم أو حالة عملهم بسرعة.', 'See your waiter and kitchen teams, and manage their access quickly.')}</p></div>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-xs text-white/60">{tr('الكل', 'Total')}</p><p className="mt-1 text-2xl font-bold">{waiters.length + kitchenStaff.length + cashiers.length}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-xs text-white/60">{tr('الصالة', 'Waiters')}</p><p className="mt-1 text-2xl font-bold">{waiters.length}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-xs text-white/60">{tr('المطبخ', 'Kitchen')}</p><p className="mt-1 text-2xl font-bold">{kitchenStaff.length}</p></div>
                </div>
              </div>
            </div>
            {/* Waiters Section */}
            <div className="space-y-5">
              <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end gap-6">
                <div className="space-y-1 text-right">
                  <h2 className="text-xl sm:text-2xl font-bold text-brand-primary">{tr('فريق الصالة', 'Waiter team')}</h2>
                  <p className="text-sm text-text-muted">{tr('استقبال الطلبات وخدمة الطاولات', 'Taking orders and serving tables')}</p>
                </div>
                <button
                  onClick={() =>
                    setShowStaffModal({ open: true, role: "waiter" })
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-white hover:bg-brand-secondary transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  {tr('إضافة كابتن / ويتر جديد', 'Add waiter')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {waiters.map((w) => (
                  <StaffCard
                    key={w.id}
                    staff={w}
                    restaurantId={restaurantId}
                    passcodeVersion={staffPasscodeVersion}
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
                {waiters.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-border-delicate bg-white p-10 text-center text-sm text-text-muted">{tr('لا يوجد موظفو صالة بعد. أضف أول موظف للبدء.', 'No waiter staff yet. Add your first team member.')}</div>}
              </div>
            </div>

            {/* Kitchen Staff Section */}
            <div className="space-y-5 border-t border-border-delicate pt-8">
              <div className="flex flex-col md:flex-row justify-between items-stretch md:items-end gap-6">
                <div className="space-y-1 text-right">
                  <h2 className="text-xl sm:text-2xl font-bold text-brand-primary">{tr('فريق المطبخ', 'Kitchen team')}</h2>
                  <p className="text-sm text-text-muted">{tr('تحضير الأصناف وتحديث جاهزية الطلبات', 'Preparing items and marking orders ready')}</p>
                </div>
                <button
                  onClick={() =>
                    setShowStaffModal({ open: true, role: "kitchen" })
                  }
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-gold px-5 py-3 text-sm font-bold text-brand-primary hover:bg-brand-gold/10 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  {tr('اضافة موظف جديد', 'Add kitchen staff')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {kitchenStaff.map((w) => (
                  <StaffCard
                    key={w.id}
                    staff={w}
                    restaurantId={restaurantId}
                    passcodeVersion={staffPasscodeVersion}
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
                {kitchenStaff.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-border-delicate bg-white p-10 text-center text-sm text-text-muted">{tr('لا يوجد موظفو مطبخ بعد. أضف أول موظف للبدء.', 'No kitchen staff yet. Add your first team member.')}</div>}
              </div>
            </div>
            <section className="space-y-4 border-t border-border-delicate pt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-brand-primary">{tr('فريق الكاشير', 'Cashier team')}</h2>
                <button type="button" onClick={() => setShowStaffModal({ open: true, role: "cashier" })}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-primary px-4 text-sm font-bold text-white">
                  <Plus className="size-4" />{tr('إضافة كاشير', 'Add cashier')}
                </button>
              </div>
              <a href={staffPortalUrl(restaurantId, "cashier")} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-brand-primary underline">
                {tr('رابط دخول الكاشير', 'Cashier sign-in link')}
              </a>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cashiers.map(staff => <StaffCard key={staff.id} staff={staff} restaurantId={restaurantId}
                  passcodeVersion={staffPasscodeVersion} accent="gold"
                  onToggle={() => toggleStaffStatus(staff.id, staff.status, "cashier")}
                  onDelete={() => deleteStaff(staff.id, "cashier")}
                  onEdit={() => setShowStaffModal({ open: true, role: "cashier", staff })} />)}
              </div>
            </section>
          </motion.div>
        )}

        {activeTab === "orders" && (
          <motion.div
            key="orders"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="relative overflow-hidden rounded-3xl bg-[#081d2d] p-6 text-white shadow-xl sm:p-8">
              <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div><p className="mb-2 text-xs font-bold text-brand-gold">{tr('متابعة مباشرة', 'Live workflow')}</p><h2 className="text-2xl font-bold sm:text-3xl">{tr('الطلبات حسب مرحلة العمل', 'Orders by work stage')}</h2><p className="mt-2 text-sm text-white/65">{tr('ابدأ بالطلبات الجديدة، ثم تابع التحضير والتقديم. التاريخ والرفض في الأسفل.', 'Start with new orders, then follow preparation and service. History and rejections appear below.')}</p></div>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-xs text-white/60">{tr('جديد', 'New')}</p><p className="mt-1 text-2xl font-bold">{orders.filter(o => o.status === 'pending' && !o.clearedForStaff).length}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-xs text-white/60">{tr('تحضير', 'Preparing')}</p><p className="mt-1 text-2xl font-bold">{orders.filter(o => o.status === 'preparing' && !o.clearedForStaff).length}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-xs text-white/60">{tr('جاهز', 'Ready')}</p><p className="mt-1 text-2xl font-bold">{orders.filter(o => o.status === 'ready' && !o.clearedForStaff).length}</p></div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-delicate bg-white px-5 py-4">
              <p className="text-sm font-semibold text-text-muted">{tr('آخر رقم طلب', 'Latest order number')}: <span className="font-bold text-brand-primary">{restaurant?.currentOrderNumber || 0}</span></p>
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(true)}
                disabled={isResetting}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-delicate px-4 py-2 text-xs font-bold text-brand-primary hover:bg-bg-paper"
              >
                {isResetting ? tr('جاري تصفير العداد...', 'Resetting counter...') : tr('🧹 تصفير العداد والبدء بيوم عمل جديد', '🧹 Start a new workday')}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              <OrderColumn
                title={tr('طلبات جديدة واردة', 'New orders')}
                orders={orders.filter((o) => o.status === "pending" && !o.clearedForStaff)}
                type="pending"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
              />
              <OrderColumn
                title={tr('قيد التحضير بالمطبخ', 'Preparing')}
                orders={orders.filter((o) => o.status === "preparing" && !o.clearedForStaff)}
                type="preparing"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
              />
              <OrderColumn
                title={tr('جاهزة للتسليم', 'Ready to serve')}
                orders={orders.filter((o) => o.status === "ready" && !o.clearedForStaff)}
                type="ready"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
              />
            </div>
            <div className="border-t border-border-delicate pt-5"><h3 className="text-lg font-bold text-brand-primary">{tr('السجل والمتابعة', 'History and follow-up')}</h3><p className="mt-1 text-sm text-text-muted">{tr('الطلبات المكتملة والمرفوضة للمراجعة.', 'Review completed and rejected orders.')}</p></div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <OrderColumn
                title={tr('طلبات منتهية وتاريخية', 'Completed orders')}
                orders={orders.filter((o) => o.status === "served" && !o.clearedForStaff)}
                type="served"
                onUpdate={updateOrderStatus}
                onBan={(order) => setBanningOrder(order)}
                onShowTimeline={(order) => setSelectedOrderForTimeline(order)}
                isHistory
              />
              <OrderColumn
                title={tr('طلبات مرفوضة ومسترجعة', 'Rejected orders')}
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
                      {tr('الأرشيف التاريخي العام للطلب', 'Order history')}
                    </h3>
                    <p className="text-xs text-text-muted">
                      {tr('مراجعة وتتبع شامل لجميع الطلبيات السابقة ببياناتها ومبيعاتها اليومية لأي يوم تختاره من التقويم.', 'Review past orders and sales for any selected date.')}
                    </p>
                  </div>
                  
                  {/* Date & Search Filters */}
                  <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-primary uppercase tracking-wider">{tr('اختر اليوم المطلوب', 'Select date')}</label>
                      <input
                        type="date"
                        value={archiveDate}
                        onChange={(e) => setArchiveDate(e.target.value)}
                        className="bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-medium focus:outline-none focus:border-brand-primary focus:bg-white text-right font-sans h-[48px]"
                      />
                    </div>
                    <div className="space-y-1.5 flex-1 sm:w-64">
                      <label className="block text-[10px] font-bold text-brand-primary uppercase tracking-wider">{tr('بحث مخصص في الطلبات', 'Search orders')}</label>
                      <input
                        type="text"
                        placeholder={tr('رقم طاولة، اسم زبون، رقم الطلب...', 'Table, customer, or order number...')}
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
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">{tr('إجمالي إيرادات اليوم المقبولة', 'Completed revenue')}</span>
                  <p className="text-2xl sm:text-3xl font-display text-emerald-600 font-bold">
                    {totalRevenue.toLocaleString()}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">{tr('د.ع', 'IQD')}</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">{tr(`من ${completedOrders.length} طلب مستلم بنجاح`, `From ${completedOrders.length} completed orders`)}</span>
                </div>

                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">{tr('الطلبات النشطة / قيد المعالجة', 'Active orders')}</span>
                  <p className="text-2xl sm:text-3xl font-display text-brand-gold font-bold">
                    {activeOrders.length}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">{tr('طلبيات', 'orders')}</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">{tr('خلال الوردية الجارية حالياً', 'During the current shift')}</span>
                </div>

                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">{tr('طلبات مرفوضة ومسترجعة', 'Rejected orders')}</span>
                  <p className="text-2xl sm:text-3xl font-display text-red-600 font-bold">
                    {rejectedOrders.length}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">{tr('طلبيات', 'orders')}</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">{tr('مرفوضة من الويترز أو المطبخ', 'Rejected by waiter or kitchen')}</span>
                </div>

                <div className="bg-white border border-border-delicate p-6 space-y-2 text-right">
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest block">{tr('مجموع العمليات المالية المقدرة', 'Estimated revenue')}</span>
                  <p className="text-2xl sm:text-3xl font-display text-brand-primary font-bold">
                    {totalEstimatedRevenue.toLocaleString()}{" "}
                    <span className="text-xs opacity-50 font-sans font-normal">{tr('د.ع', 'IQD')}</span>
                  </p>
                  <span className="text-[10px] text-text-muted/60 block">{tr(`مجموع الطلبات لليوم ${archiveOrders.length}`, `${archiveOrders.length} orders for this date`)}</span>
                </div>
              </div>

              {/* Archive Orders List */}
              <div className="space-y-6">
                <div className="flex items-center gap-4 justify-start">
                  <div className="h-0.5 w-12 bg-brand-primary opacity-30" />
                  <p className="text-sm font-bold text-brand-primary uppercase tracking-widest">
                    {tr('سجل الطلبيات لليوم المحدد', 'Orders for selected date')} ({archiveOrders.length})
                  </p>
                </div>

                {archiveOrders.length === 0 ? (
                  <div className="bg-white border border-border-delicate p-12 py-24 text-center space-y-4">
                    <p className="font-display italic text-xl text-brand-gold opacity-30">{tr('لا توجد أي بيانات مسجلة لهذا التاريخ.', 'No orders found for this date.')}</p>
                    <p className="text-xs text-text-muted max-w-sm mx-auto">{tr('تأكد من اختيار يوم المبيعات المناسب أو مراجعة فلاتر البحث أعلاه.', 'Choose another date or review your search filters.')}</p>
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
                              {tr('طاولة', 'Table')} {o.tableNumber} <span className="text-xs text-text-muted font-normal">/ {o.customerName}</span>
                            </h4>
                            <span className="text-[10px] font-mono text-text-muted/50 block">{tr('المعرف:', 'ID:')} #{o.id.slice(-6).toUpperCase()}</span>
                          </div>

                          <div className="text-left font-mono">
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded ${
                              o.status === "served" ? "bg-emerald-50 text-emerald-800" :
                              o.status === "rejected" ? "bg-red-50 text-red-800" : "bg-brand-gold/15 text-brand-gold"
                            }`}>
                              {o.status === "served" ? tr('✔ مكتمل وموصل', '✔ Served') :
                               o.status === "rejected" ? tr('✘ مرفوض', '✘ Rejected') : tr('⚡ نشط/قيد المعالجة', '⚡ Active')}
                            </span>
                            <span className="text-[10px] font-medium text-text-muted block mt-2">
                              {o.orderNumber ? tr(`رقم الطلب: ${o.orderNumber}`, `Order: ${o.orderNumber}`) : tr('رقم الطلب: غير محدد', 'Order number unavailable')}
                            </span>
                          </div>
                        </div>

                        {/* Order Items */}
                        <div className="space-y-2">
                          {o.items.map((item, idx) => (
                            <div key={idx} className="space-y-0.5 border-b border-border-delicate/20 pb-1 last:border-0 text-right">
                              <div className="flex justify-between text-xs text-text-main">
                                <span>{item.name} <strong className="text-brand-gold">x{item.quantity}</strong></span>
                                <span className="font-mono opacity-80">{(item.price * item.quantity).toLocaleString()} {tr('د.ع', 'IQD')}</span>
                              </div>
                              {item.customizationText && (
                                <p className="text-[10px] text-brand-gold font-bold">
                                  ✨ {tr('الخيارات:', 'Options:')} {item.customizationText}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="border-t border-border-delicate/40 pt-4 flex justify-between items-center bg-slate-50/50 -mx-6 sm:-mx-8 px-6 sm:px-8 -mb-6 sm:-mb-8 py-4">
                          <span className="text-[10px] font-mono text-text-muted">
                            {new Date(o.createdAt).toLocaleTimeString(language === 'en' ? 'en-IQ' : 'ar-IQ', { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <p className="text-base font-bold text-brand-primary font-mono">
                            {o.totalAmount.toLocaleString()} <span className="text-[9px]">{tr('د.ع', 'IQD')}</span>
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
                  {tr('تنظيم قائمة الطعام والمنيو المباشر', 'Manage your live menu')}
                </p>
                <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                  {tr('قائمة الأطباق والمشروبات', 'Food and drinks')}
                </h2>
                <p className="text-xs font-bold text-text-muted/60 tracking-wider max-w-md">
                  {tr('حدث وعدل قائمة طعامك بكل تفاصيل الأسعار والصور ونسب النكهات.', 'Add and update dishes, prices, photos, and options.')}
                </p>
              </div>
              <button
                onClick={() => setShowProductModal({ open: true })}
                className="px-10 py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all shadow-2xl text-center w-full md:w-auto"
              >
                {tr('إضافة طبق طعام جديد', 'Add a new dish')}
              </button>
            </div>

            {/* Category Management Panel */}
            <div className="bg-white border border-border-delicate p-6 sm:p-10 space-y-6 text-right" dir={dir}>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest">{tr('أقسام المنيو واللوائح المخصصة', 'Menu categories')}</p>
                <h3 className="text-xl font-display text-brand-primary italic font-bold">{tr('إدارة تصنيفات وقوائم الطعام', 'Manage categories')}</h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  {tr('يمكنك إضافة أو حذف أقسام (مثل: وجبات رئيسية، شاورما، حلويات، عصائر). عند حذف أي قسم ستبقى الوجبات التابعة له كما هي دون حذف، ويمكنك تصنيفها لأي قسم جديد.', 'Add or remove categories. Removing a category does not delete its dishes; you can assign them to another category.')}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={tr('أدخل اسم القسم الجديد (مثلاً: مشاوي، عصائر طبيعية، مقبلات...)', 'New category name (for example: Grills, Juices...)')}
                  className="bg-bg-paper border border-border-delicate px-4 py-3 text-sm text-brand-primary focus:outline-none flex-1 text-right font-bold"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  className="px-8 py-3 bg-brand-primary text-white text-xs font-bold hover:bg-brand-secondary transition-all whitespace-nowrap"
                >
                  {tr('إضافة قسم جديد', 'Add category')} +
                </button>
              </div>

              <div className="grid gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-3">
                {(restaurant?.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"]).map((cat) => (
                  <div
                    key={cat}
                    className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border-delicate bg-bg-paper/70 p-3 transition-colors hover:border-brand-gold/50 hover:bg-white"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-primary shadow-sm" aria-hidden="true"><UtensilsCrossed className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-brand-primary" title={localizeCategory(cat, language)}>{localizeCategory(cat, language)}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">{menuItems.filter(item => item.category === cat).length} {tr('طبق', 'dishes')}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-transparent text-red-600 transition-colors hover:border-red-100 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                      title={tr('حذف هذا القسم', 'Delete this category')}
                      aria-label={`${tr('حذف القسم', 'Delete category')}: ${localizeCategory(cat, language)}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
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
                          {localizeCategory(item.category, language)}
                        </p>
                      )}
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-1">
                        <h3 className="font-display text-base sm:text-lg text-brand-primary tracking-tight font-bold">
                          {item.name}
                        </h3>
                        <p className="text-sm sm:text-base font-display text-brand-gold font-bold">
                          <span className="font-sans">{item.price.toLocaleString()}</span>{" "}
                          <span className="text-[9px] opacity-65">{tr('د.ع', 'IQD')}</span>
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
                              🧀 {tr('إضافة جبن:', 'Extra cheese:')} +{(item.cheesePrice || 0).toLocaleString()} {tr('د.ع', 'IQD')}
                            </span>
                          )}
                          {item.isSpicy && item.spicyPrice !== undefined && (
                            <span className="text-[8px] font-bold text-brand-primary bg-brand-primary/5 px-2 py-0.5 border border-brand-primary/10">
                              🔥 {tr('خيار سبايسي:', 'Spicy option:')} +{(item.spicyPrice || 0).toLocaleString()} {tr('د.ع', 'IQD')}
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
                        {tr('حذف', 'Delete')}
                      </button>
                      <button
                        onClick={() =>
                          setShowProductModal({ open: true, item })
                        }
                        className="flex-1 py-2 sm:py-2.5 border border-border-delicate text-[8px] font-bold uppercase tracking-wider text-brand-primary hover:bg-bg-paper transition-colors"
                      >
                        {tr('تعديل', 'Edit')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {menuItems.length === 0 && (
              <div className="text-center py-40 border border-dashed border-border-delicate bg-bg-paper">
                <p className="font-display italic text-3xl text-brand-gold opacity-30">
                  {tr('لا توجد أطباق في القائمة حالياً.', 'No dishes in the menu yet.')}
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
                {tr('البوابة الرقمية للمطعم', 'Restaurant digital portal')}
              </p>
              <h3 className="text-3xl sm:text-4xl font-display text-brand-primary tracking-tight">
                {tr('كود الطاولة والمنيو التعريفي (QR)', 'Menu QR code')}
              </h3>
            </div>

            <div className="p-6 sm:p-16 bg-white shadow-2xl relative border border-border-delicate mb-12 w-full max-w-[320px] flex items-center justify-center">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-brand-gold -translate-x-4 -translate-y-4" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-brand-gold translate-x-4 -translate-y-4" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-brand-gold -translate-x-4 translate-y-4" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-brand-gold translate-x-4 translate-y-4" />
              <div className="w-full h-full max-w-[200px] sm:max-w-none flex items-center justify-center animate-fade-in">
                <svg id="menu-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" className="h-auto max-w-full" role="img" aria-label={tr('رمز QR لقائمة المطعم مع الشعار في المنتصف', 'Restaurant menu QR code with centered logo')}>
                  <QRCode value={customerMenuUrl(restaurantId)} size={256} level="H" bgColor="#ffffff" fgColor="#2D3A27" />
                  {qrLogoData && <>
                    <rect x="101" y="101" width="54" height="54" rx="10" fill="#ffffff" />
                    <image href={qrLogoData} x="106" y="106" width="44" height="44" preserveAspectRatio="xMidYMid meet" />
                  </>}
                </svg>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 w-full sm:w-auto px-6 sm:px-0">
              <button
                onClick={downloadQR}
                disabled={!qrLogoData}
                className="px-10 py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all flex items-center justify-center gap-4 w-full sm:w-auto text-center cursor-pointer disabled:cursor-wait disabled:opacity-50"
              >
                <Download className="w-5 h-5 shrink-0" /> {tr('تحميل رمز QR المخصص', 'Download QR code')}
              </button>
              <button
                onClick={() =>
                  window.open(
                    customerMenuUrl(restaurantId),
                    "_blank",
                  )
                }
                className="px-10 py-5 border border-border-delicate text-[11px] font-bold uppercase tracking-widest text-brand-primary hover:bg-bg-paper transition-all flex items-center justify-center gap-4 w-full sm:w-auto text-center cursor-pointer"
              >
                <ExternalLink className="w-5 h-5 shrink-0" /> {tr('استعراض صفحة زبائنك', 'View customer menu')}
              </button>
            </div>
            {qrDownloadError && <p role="alert" className="mt-3 text-sm text-red-700">{qrDownloadError}</p>}

            <QrPrintStudio restaurant={restaurant} onSaved={setRestaurant} />

            {/* Custom Staff Login Link Section */}
            <div className="mt-16 p-8 border border-border-delicate bg-bg-paper w-full max-w-2xl text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-brand-gold">
                <span className="w-8 h-[1px] bg-brand-gold opacity-30" />
                <p className="text-[10px] font-bold uppercase tracking-widest leading-none">{tr('تأمين البوابات وأنظمة الطاقم', 'Secure staff access')}</p>
                <span className="w-8 h-[1px] bg-brand-gold opacity-30" />
              </div>
              <h4 className="text-xl font-display text-brand-primary font-bold">{tr('بوابة تسجيل دخول الموظفين والمالك الخاصة بك', 'Owner and staff login portal')}</h4>
              <p className="text-xs text-text-muted/80 max-w-md mx-auto leading-relaxed">
                {tr('لحماية خصوصية مطعمتكم، تم تخصيص بوابة مشتغلي الطاقم والمالك. يرجى تسجيل الدخول حصرياً عبر الرابط الأمني الفريد أدناه:', 'Use this restaurant-specific link to sign in securely as an owner or staff member:')}
              </p>
              <div className="flex flex-col sm:flex-row items-stretch gap-4 justify-center pt-2">
                <input 
                  type="text" 
                  readOnly 
                  value={staffPortalUrl(restaurantId)}
                  className="w-full sm:w-80 px-4 py-2.5 bg-white border border-border-delicate text-xs font-mono text-center focus:outline-none select-all text-brand-primary"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(staffPortalUrl(restaurantId));
                    setStaffLinkCopied(true);
                    setTimeout(() => setStaffLinkCopied(false), 2000);
                  }}
                  className="px-6 py-2.5 bg-brand-primary text-white text-[10px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all w-full sm:w-auto cursor-pointer flex items-center justify-center gap-2"
                >
                  {staffLinkCopied ? tr('✓ تم نسخ الرابط الأمني', '✓ Link copied') : tr('📋 نسخ الرابط الأمني', '📋 Copy login link')}
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
                    {tr('جدار الحماية والأمن ومكافحة السبام البشري', 'Customer protection')}
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
                    {tr('إدارة التنبيهات والطلبات الوهمية', 'Alerts and suspicious orders')}
                  </h3>
                  <p className="text-xs text-text-muted max-w-2xl leading-relaxed">
                    {tr('هذا النظام يقوم بمطابقة إشارات تحديد المواقع لكل زبائنك لضمان وجودهم داخل الصالة، إلى جانب رصد وتخزين بصمات الكوكيز ونوع النظام لإفشال الطلبات المزعجة من خارج المطعم أو تغيير معلومات الطاولات بشكل متكرر.', 'Location and device checks help flag suspicious orders and repeated abuse.')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-pulse" />
                    {tr('الحماية الجغرافية نشطة', 'Location protection active')}
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-pulse" />
                    {tr('مراقبة الأجهزة نشطة', 'Device monitoring active')}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Summary Panel */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white border border-border-delicate p-6 text-right shadow-sm space-y-1">
                <p className="text-xs text-text-muted font-bold">{tr('إجمالي التنبيهات المرصودة', 'Total alerts')}</p>
                <p className="text-4xl font-display italic text-brand-primary font-bold">{alerts.length}</p>
              </div>
              <div className="bg-white border border-border-delicate p-6 text-right shadow-sm space-y-1 border-r-4 border-r-amber-500">
                <p className="text-xs text-text-muted font-bold">{tr('تنبيهات معلقة وتحتاج مراجعة', 'Needs review')}</p>
                <p className="text-4xl font-display italic text-amber-600 font-bold">
                  {alerts.filter(a => a.status === 'unread').length}
                </p>
              </div>
              <div className="bg-white border border-border-delicate p-6 text-right shadow-sm space-y-1 border-r-4 border-r-red-600">
                <p className="text-xs text-text-muted font-bold">{tr('تنبيهات مهمة', 'Important alerts')}</p>
                <p className="text-4xl font-display italic text-red-600 font-bold">
                  {alerts.filter(a => a.severity === 'critical' && a.status === 'unread').length}
                </p>
              </div>
            </div>

            {/* Sub-tab Switcher inside Alerts page */}
            <div className="flex flex-wrap gap-2 rounded-2xl border border-border-delicate bg-bg-paper p-2">
              <button
                onClick={() => setAlertsSubTab("system_announcements")}
                className={`flex-1 min-w-[130px] rounded-xl px-3 py-3 text-center text-xs font-bold transition-colors ${
                  alertsSubTab === "system_announcements"
                    ? "bg-brand-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-white hover:text-brand-primary"
                }`}
              >
                📢 {tr('تبليغات وتوجيهات الإدارة', 'Admin announcements')} ({announcements.length})
              </button>
              <button
                onClick={() => setAlertsSubTab("order_devices")}
                className={`flex-1 min-w-[130px] rounded-xl px-3 py-3 text-center text-xs font-bold transition-colors ${
                  alertsSubTab === "order_devices"
                    ? "bg-brand-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-white hover:text-brand-primary"
                }`}
              >
                📱 {tr('معلومات وبصمات طالبي الطعام', 'Customer devices')} ({orders.filter(o => o.deviceMetadata).length})
              </button>
              <button
                onClick={() => setAlertsSubTab("security_alerts")}
                className={`flex-1 min-w-[130px] rounded-xl px-3 py-3 text-center text-xs font-bold transition-colors ${
                  alertsSubTab === "security_alerts"
                    ? "bg-brand-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-white hover:text-brand-primary"
                }`}
              >
                🚨 {tr('تنبيهات المطعم', 'Restaurant alerts')} ({alerts.length})
              </button>
              <button
                onClick={() => setAlertsSubTab("banned_customers")}
                className={`flex-1 min-w-[130px] rounded-xl px-3 py-3 text-center text-xs font-bold transition-colors ${
                  alertsSubTab === "banned_customers"
                    ? "bg-brand-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-white hover:text-brand-primary"
                }`}
              >
                🚫 {tr('الزبائن المحظورين', 'Blocked customers')} ({bannedDevices.length})
              </button>
            </div>

            {alertsSubTab === "system_announcements" && (
              <div className="space-y-6">
                <h4 className="text-lg font-display text-brand-primary font-bold border-b border-border-delicate pb-3 flex items-center gap-3">
                  <Bell className="w-5 h-5 text-brand-gold shrink-0" />
                  {tr('إعلانات وتوجيهات الإدارة العامة للنظام', 'System announcements')}
                </h4>

                {announcements.length === 0 ? (
                  <div className="bg-white border border-dashed border-border-delicate p-12 py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                      <Bell className="w-8 h-8" />
                    </div>
                    <h4 className="text-base font-display text-text-muted font-bold">{tr('لا توجد أي تبليغات أو توجيهات من الإدارة حالياً', 'No announcements yet')}</h4>
                    <p className="text-text-muted/60 max-w-sm mx-auto text-xs leading-relaxed">
                      {tr('أي إعلان أو تنبيه فني أو إداري يتم نشره من قبل أصحاب النظام سيظهر لك هنا حياً ومباشرة لتكون على اطلاع دائم.', 'New system notices will appear here when published.')}
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
                                  {isCritical ? tr('طارئ', 'Critical') : isWarning ? tr('تحذير', 'Warning') : tr('إرشاد', 'Info')}
                                </span>
                                <span className="text-[10px] text-text-muted font-sans mr-auto" dir="ltr">
                                  {safeFormatDate(ann.createdAt?.toDate ? ann.createdAt.toDate() : ann.createdAt, "yyyy/MM/dd | hh:mm a")}
                                </span>
                              </div>
                              <p className="text-xs text-brand-primary font-sans leading-relaxed whitespace-pre-wrap">
                                {ann.message}
                              </p>
                              <div className="flex items-center gap-2 pt-2 text-[10px] text-text-muted font-bold font-sans">
                                <span>{tr('موجه إلى:', 'Audience:')}</span>
                                <span className="text-brand-gold">
                                  {(ann.target === "all" || ann.targetRestaurantId === "all") ? tr('جميع المطاعم المشتركة', 'All restaurants') : tr('مطعمكم بشكل خاص', 'Your restaurant')}
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
                  {tr('تنبيهات المطعم', 'Restaurant alerts')}
                </h4>

              {alerts.length === 0 ? (
                <div className="rounded-3xl bg-white border border-border-delicate p-10 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-xl font-display text-emerald-700 font-bold">{tr('لا توجد أي تنبيهات حالياً', 'No alerts right now')}</h4>
                  <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                    {tr('ستظهر هنا التنبيهات التي تحتاج انتباهك.', 'Alerts that need your attention will appear here.')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {alerts.map((alert) => {
                    const isUnread = alert.status === 'unread';
                    const isCritical = alert.severity === 'critical';
                    
                    return (
                      <motion.div
                        key={alert.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`rounded-2xl border transition-all relative p-5 sm:p-6 flex flex-col md:flex-row gap-5 justify-between items-start md:items-center ${
                          isUnread 
                            ? isCritical 
                              ? 'border-red-200 bg-red-50/50 shadow-sm'
                              : 'border-amber-200 bg-amber-50/50 shadow-sm'
                            : 'border-border-delicate bg-white'
                        }`}
                      >
                        {/* Bullet indication for unread */}
                        {isUnread && (
                          <div className={`absolute top-4 right-4 w-2.5 h-2.5 rounded-full ${isCritical ? 'bg-red-600' : 'bg-amber-500'}`} />
                        )}

                        <div className="space-y-4 flex-1">
                          {/* Top row badges */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2.5 py-1 text-[9px] font-bold rounded-full ${
                              isCritical 
                                ? 'bg-red-100 text-red-800'
                                : alert.severity === 'warning' 
                                  ? 'bg-amber-100 text-amber-800' 
                                  : 'bg-blue-100 text-blue-800'
                            }`}>
                              {alert.severity === 'critical' ? tr('مهم', 'Important') : alert.severity === 'warning' ? tr('تنبيه', 'Warning') : tr('معلومة', 'Info')}
                            </span>
                            <span className="text-[9.5px] font-bold text-text-muted opacity-80 bg-bg-paper border border-border-delicate px-2.5 py-1 rounded-full">
                              {tr('النوع:', 'Type:')} {
                                alert.type === 'outside_range' ? tr('خارج نطاق المطعم', 'Outside restaurant range') :
                                alert.type === 'desktop_device' ? tr('استخدام جهاز مكتبي', 'Desktop device') :
                                alert.type === 'multi_name_spam' ? tr('تغييرات متكررة', 'Repeated changes') :
                                alert.type === 'failed_location' ? tr('الموقع غير متاح', 'Location unavailable') : tr('نشاط غير معتاد', 'Unusual activity')
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
                              {tr('العميل:', 'Customer:')} <strong className="text-brand-primary">{alert.customerName || tr('غير محدد', 'Unknown')}</strong>
                              {alert.tableNumber && <> — {tr('طاولة', 'Table')}: <strong className="text-brand-secondary">{alert.tableNumber}</strong></>}
                            </p>
                          </div>

                          {/* Details remain available without overwhelming the alert summary. */}
                          <details className="bg-bg-paper border border-border-delicate p-4 rounded-xl space-y-3.5 text-xs text-right">
                            <summary className="cursor-pointer font-bold text-brand-primary">{tr('تفاصيل الجهاز والموقع', 'Device and location details')}</summary>
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6">
                              <div>
                                <span className="text-text-muted font-medium">{tr('نوع وماركة النظام:', 'Device type:')} </span>
                                <strong className="text-brand-primary font-bold">{localizeDeviceType(alert.deviceMetadata.deviceType, language)}</strong>
                              </div>
                              <div>
                                <span className="text-text-muted font-medium">{tr('معرّف الجهاز:', 'Device ID:')} </span>
                                <code className="bg-white border border-border-delicate px-1.5 py-0.5 rounded font-mono text-[9px] font-bold text-red-700">{alert.deviceMetadata.fingerprint}</code>
                              </div>
                              <div>
                                <span className="text-text-muted font-medium">{tr('أبعاد ودقة جهاز الزائر:', 'Screen size:')} </span>
                                <span className="text-brand-primary font-medium">{alert.deviceMetadata.screenSize}</span>
                              </div>
                              <div>
                                <span className="text-text-muted font-medium">{tr('لغة المتصفح المعتمدة:', 'Browser language:')} </span>
                                <span className="text-brand-primary font-medium">{alert.deviceMetadata.language}</span>
                              </div>
                              <div className="md:col-span-2">
                                <span className="text-text-muted font-medium">{tr('الموقع:', 'Location:')} </span>
                                <span className={`font-bold ${alert.deviceMetadata.coordinates ? 'text-rose-700' : 'text-amber-800'}`}>
                                  {alert.deviceMetadata.coordinates 
                                    ? tr(`إحداثيات [${alert.deviceMetadata.coordinates.lat.toFixed(5)}, ${alert.deviceMetadata.coordinates.lng.toFixed(5)}]، على بعد ${alert.deviceMetadata.distanceMeters ? Math.round(alert.deviceMetadata.distanceMeters) : 0} متر.`, `Coordinates [${alert.deviceMetadata.coordinates.lat.toFixed(5)}, ${alert.deviceMetadata.coordinates.lng.toFixed(5)}], ${alert.deviceMetadata.distanceMeters ? Math.round(alert.deviceMetadata.distanceMeters) : 0} m away.`)
                                    : tr('الموقع غير متاح.', 'Location unavailable.')}
                                </span>
                              </div>
                            </div>
                            <details className="mt-2 text-[10px] cursor-pointer text-text-muted">
                              <summary className="font-semibold hover:text-brand-primary transition-colors">{tr('معلومات المتصفح', 'Browser details')}</summary>
                              <div className="bg-white border border-border-delicate p-2.5 mt-2 rounded font-mono break-all text-left" dir="ltr">
                                {alert.deviceMetadata.userAgent}
                              </div>
                            </details>
                          </details>
                        </div>

                        {/* Interactive actions for manager */}
                        <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 self-stretch justify-center items-stretch shrink-0 min-w-[200px]">
                          {isUnread && (
                            <button
                              onClick={() => resolveAlert(alert.id)}
                              className="px-4 py-2 bg-brand-primary hover:bg-brand-secondary text-white text-[10px] font-bold uppercase tracking-wider rounded transition-all text-center"
                            >
                              {tr('تمت المراجعة', 'Mark reviewed')}
                            </button>
                          )}
                          <button
                            onClick={() => cancelAllOrdersByFingerprint(alert.deviceMetadata.fingerprint)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold uppercase tracking-wider rounded transition-all text-center flex items-center justify-center gap-1.5"
                          >
                            {tr('إلغاء جميع طلبات هذه البصمة', 'Cancel orders from this device')} 🚫
                          </button>
                          <button
                            onClick={() => deleteAlert(alert.id)}
                            className="px-4 py-2 border border-border-delicate text-text-muted hover:text-red-700 hover:bg-bg-paper text-[10px] font-bold uppercase tracking-wider rounded transition-all text-center"
                          >
                            {tr('حذف السجل نهائياً', 'Delete log')}
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
                  {tr('أدلة وهويات طالبي الطعام بالصالة (بصمات الأجهزة النشطة للطلبات الحية)', 'Customer device details for live orders')}
                </h4>

                {orders.length === 0 ? (
                  <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-display text-emerald-700 font-bold">{tr('لا توجد طلبات مسجلة حالياً', 'No orders yet')}</h4>
                    <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                      {tr('بمجرد أن يبدأ زبائن الصالة في إرسال طلبات طعامهم، ستظهر الهويات الحية لأجهزتهم ومسافاتهم الجغرافية وبصماتهم الرقمية هنا فوراً!', 'Customer device details and estimated distances will appear when orders arrive.')}
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
                                {tr('كود مرجعي:', 'Reference:')} <span className="font-mono text-[9px]">{order.id.substring(0, 8)}...</span>
                              </span>
                              <h4 className="text-base sm:text-lg font-bold text-brand-primary flex flex-wrap items-center gap-2">
                                {order.customerName}
                                <span className="text-[10px] bg-brand-primary/5 text-brand-gold px-2.5 py-0.5 rounded-full border border-border-delicate/40 font-semibold font-sans">
                                  {tr('طاولة', 'Table')} {order.tableNumber}
                                </span>
                                {order.status === 'pending' && <span className="text-[9px] bg-amber-50 text-amber-800 border border-amber-205 px-2 py-0.5 rounded">{tr('معلق', 'Pending')}</span>}
                                {order.status === 'preparing' && <span className="text-[9px] bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded animate-pulse">{tr('جاري التحضير', 'Preparing')}</span>}
                                {order.status === 'ready' && <span className="text-[9px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded">{tr('جاهز', 'Ready')}</span>}
                                {order.status === 'served' && <span className="text-[9px] bg-gray-100 text-gray-700 border border-gray-300 px-2 py-0.5 rounded">{tr('تم التقديم', 'Served')}</span>}
                                {order.status === 'cancelled' && <span className="text-[9px] bg-red-50 text-red-800 border border-red-200 px-2 py-0.5 rounded">{tr('ملغي', 'Cancelled')}</span>}
                              </h4>
                            </div>
                            <div className="flex flex-col sm:items-end gap-1 font-sans">
                              <span className="text-xs font-bold text-brand-primary">
                                {order.totalAmount.toLocaleString()} {tr('د.ع', 'IQD')}
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
                                  {tr('أدلة الهوية الرقمية للزبون (Customer DeviceDNA Signature)', 'Customer device details')}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-6 font-sans">
                                  <div>
                                    <span className="text-text-muted font-medium">{tr('نوع وماركة النظام:', 'Device type:')} </span>
                                    <strong className="text-brand-primary font-bold">{localizeDeviceType(deviceMeta.deviceType, language)}</strong>
                                  </div>
                                  <div>
                                    <span className="text-text-muted font-medium">{tr('البصمة الرقمية للزبون (Fingerprint):', 'Fingerprint:')} </span>
                                    <code className="bg-white border border-border-delicate px-1.5 py-0.5 rounded font-mono text-[9px] font-bold text-brand-gold">{deviceMeta.fingerprint}</code>
                                  </div>
                                  <div>
                                    <span className="text-text-muted font-medium">{tr('دقة الشاشة وأبعادها:', 'Screen size:')} </span>
                                    <span className="text-brand-primary font-medium">{deviceMeta.screenSize}</span>
                                  </div>
                                  <div>
                                    <span className="text-text-muted font-medium">{tr('لغة العميل المفضلة:', 'Browser language:')} </span>
                                    <span className="text-brand-primary font-medium">{deviceMeta.language}</span>
                                  </div>
                                  <div className="md:col-span-2">
                                    <span className="text-text-muted font-medium">{tr('الحالة الجغرافية ومطابقة النطاق:', 'Location:')} </span>
                                    <span className={`font-bold ${deviceMeta.coordinates ? (distance !== undefined && distance <= 150 ? 'text-emerald-700' : 'text-rose-700') : 'text-amber-800'}`}>
                                      {deviceMeta.coordinates
                                        ? tr(`📍 إحداثيات العميل [${deviceMeta.coordinates.lat.toFixed(5)}, ${deviceMeta.coordinates.lng.toFixed(5)}] على بعد ${distance ? Math.round(distance) : 0} متر من إحداثيات صالتك المعينة!`, `📍 Coordinates [${deviceMeta.coordinates.lat.toFixed(5)}, ${deviceMeta.coordinates.lng.toFixed(5)}], ${distance ? Math.round(distance) : 0} m from the restaurant.`)
                                        : tr('📍 الزبون حجب وحظر مشاركة الموقع الجغرافي الخاص بجهازه (قد يكون خارج المطعم، أو طلب بواسطة الويتر)', '📍 Customer location is unavailable or this was a staff order.')}
                                    </span>
                                  </div>
                                </div>
                                <details className="mt-2 text-[10px] cursor-pointer text-text-muted font-sans font-sans">
                                  <summary className="font-semibold hover:text-brand-primary transition-colors">{tr('عرض معلومات المتصفح الكاملة لجهاز الطلب', 'Show full browser user agent')}</summary>
                                  <div className="bg-white border border-border-delicate p-2.5 mt-2 rounded font-mono break-all text-left" dir="ltr">
                                    {deviceMeta.userAgent}
                                  </div>
                                </details>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-bg-paper p-4 text-xs text-text-muted border border-border-delicate/40 rounded flex items-center gap-2 font-sans font-sans">
                              <Info className="w-5 h-5 text-brand-gold shrink-0" />
                              {tr('طلب مدخل يدوياً بواسطة كابتن الصالة (الويتر) أو تم طلبه مسبقاً قبل تفعيل جدار الوقاية.', 'Staff-created order, or placed before location protection was enabled.')}
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
                  {tr('قائمة الأجهزة والزبائن المحظورين من الدخول للمنيو', 'Blocked devices and customers')}
                </h4>

                {bannedDevices.length === 0 ? (
                  <div className="bg-white border border-border-delicate p-12 py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                      <Users className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-display text-brand-primary font-bold">{tr('لا يوجد أي زبائن محظورين', 'No blocked customers')}</h4>
                    <p className="text-text-muted max-w-sm mx-auto text-xs leading-relaxed">
                      {tr('لا يوجد أي زبائن في قائمة الحظر حالياً. صالة مطعمك مفتوحة لجميع الهواتف!', 'No customers or devices are currently blocked.')}
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
                              {tr('محظور من الطلب', 'Blocked from ordering')} 🚫
                            </span>
                            <span className="text-[10px] font-mono text-text-muted">
                              {tr('تاريخ الحظر:', 'Blocked:')} {banned.bannedAt ? safeFormatDate(banned.bannedAt, "yyyy/MM/dd | hh:mm a") : tr('غير محدد', 'Unknown')}
                            </span>
                          </div>

                          <div className="space-y-2">
                            <h5 className="text-base sm:text-lg font-bold text-brand-primary">
                              {tr('الزبون:', 'Customer:')} <span className="text-red-700">{banned.customerName}</span> ({tr('طاولة', 'Table')} {banned.tableNumber || tr('غير محددة', 'Unknown')})
                            </h5>
                            <p className="text-xs text-text-main leading-relaxed">
                              {tr('السبب المسجل للحظر:', 'Reason:')} <strong className="text-red-900 bg-red-50 px-2.5 py-1.5 rounded font-bold">{banned.reason}</strong>
                            </p>
                            <p className="text-[11px] text-text-muted">
                              {tr('الموظف الذي قام بالحظر:', 'Blocked by:')} <span className="text-brand-primary font-bold bg-slate-100 px-2 py-0.5 rounded">{banned.bannedBy || tr('مدير النظام (أنت)', 'You')}</span>
                            </p>
                          </div>

                          <div className="bg-bg-paper border border-border-delicate p-4 rounded-xl space-y-2 text-xs font-mono">
                            <p className="text-[10px] font-bold text-brand-gold tracking-widest uppercase border-b border-border-delicate pb-1.5 mb-1.5 font-sans">
                              {tr('مواصفات جهاز الزبون المحظور:', 'Blocked device details:')}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-muted">
                              <div>{tr('نوع الجهاز:', 'Device type:')} <span className="font-sans font-bold text-brand-primary">{banned.deviceMetadata?.deviceType ? localizeDeviceType(banned.deviceMetadata.deviceType, language) : tr('غير متوفر', 'Unavailable')}</span></div>
                              <div>{tr('البصمة الرقمية:', 'Fingerprint:')} <span className="text-red-600 font-bold font-mono">{banned.fingerprint}</span></div>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={async () => {
                            if (confirm(tr(`هل أنت متأكد من إلغاء حظر الزبون "${banned.customerName}" وتمكينه من الطلب مجدداً؟`, `Unblock "${banned.customerName}" and allow ordering again?`))) {
                              try {
                                await deleteDoc(doc(db, "banned_devices", banned.id));
                                alert(tr(`تم فك الحظر عن "${banned.customerName}" بنجاح!`, `"${banned.customerName}" was unblocked.`));
                              } catch (err) {
                                alert(tr('فشل إلغاء الحظر. حاول مجدداً', 'Could not unblock this customer. Please retry.'));
                              }
                            }
                          }}
                          className="px-5 py-3 border border-border-delicate hover:border-emerald-600 text-text-muted hover:text-emerald-700 hover:bg-emerald-50 text-[11px] font-bold uppercase tracking-wider rounded transition-all shrink-0 w-full md:w-auto text-center font-sans"
                        >
                          {tr('فك الحظر والترخيص بالطلب', 'Unblock customer')} 🔓
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
                  {tr('الدعم الفني والخدمات الفنية', 'Technical support')}
                </p>
                <h3 className="text-3xl sm:text-4xl font-display text-brand-primary tracking-tight">
                  {tr('كيف يمكننا خدمتك ومساعدتك؟', 'How can we help?')}
                </h3>
              </div>
              <p className="text-base sm:text-lg text-text-muted leading-relaxed">
                {tr('فريق الدعم الفني متواجد لمساعدتك لضمان تشغيل خدمتك الرقمية باستمرار وبدون أي انقطاع.', 'Contact support to keep your digital service running smoothly.')}
              </p>
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-6 sm:gap-10 pt-6 sm:pt-8 justify-start">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border border-brand-gold flex items-center justify-center text-brand-gold shrink-0">
                  <Phone className="w-6 h-6 sm:w-8 sm:h-8" />
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold opacity-60">
                    {tr('رقم خط الطوارئ المباشر', 'Direct support line')}
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
            onClose={() => { setShowStaffModal(null); setStaffPasscodeVersion(version => version + 1); }}
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
            categories={resolveMenuCategories(restaurant?.categories)}
          />
        )}
        {banningOrder && (
          <BanCustomerModal
            order={banningOrder}
            onClose={() => setBanningOrder(null)}
            defaultStaffName={tr('المدير / صاحب المطعم', 'Restaurant owner')}
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
              dir={dir}
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
                <p className="text-[10px] sm:text-xs font-bold text-brand-gold uppercase tracking-widest">{tr('تتبع الكفاءة والزمن (Timeline)', 'Order timeline')}</p>
                <h3 className="text-xl font-display text-brand-primary font-bold italic">
                  {tr('التسلسل الزمني للطلب:', 'Order timeline:')} {selectedOrderForTimeline.orderNumber ? tr(`رقم ${selectedOrderForTimeline.orderNumber}`, `No. ${selectedOrderForTimeline.orderNumber}`) : `#${selectedOrderForTimeline.id.slice(-6).toUpperCase()}`}
                </h3>
                <div className="bg-bg-paper p-4 border border-border-delicate text-xs text-text-muted leading-relaxed space-y-1">
                  <p>{tr('الزبون:', 'Customer:')} <strong className="text-brand-primary">{selectedOrderForTimeline.customerName}</strong></p>
                  <p>{tr('الطاولة:', 'Table:')} <strong className="text-brand-primary">{selectedOrderForTimeline.tableNumber}</strong></p>
                  {selectedOrderForTimeline.notes && (
                    <p>{tr('ملاحظات الزبون:', 'Customer notes:')} <span className="italic">"{selectedOrderForTimeline.notes}"</span></p>
                  )}
                </div>

                <div className="mt-8 relative border-r-2 border-brand-gold/20 mr-4 pr-6 space-y-8 text-right">
                  {/* Step 1: Placed */}
                  <div className="relative">
                    <span className="absolute -right-[31px] top-1 flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white ring-8 ring-white">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase">1. {tr('وقت إرسال الطلب من الزبون', 'Order placed')}</h4>
                      <p className="text-xs font-mono text-brand-gold mt-1" dir="ltr">
                        {selectedOrderForTimeline.createdAt ? new Date(selectedOrderForTimeline.createdAt).toLocaleString(language === 'en' ? 'en-IQ' : 'ar-IQ', { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, day: "numeric", month: "numeric" }) : "—"}
                      </p>
                      <p className="text-[10px] text-text-muted mt-0.5">{tr('تم استلام الطلب وبانتظار الموافقة.', 'Order received and waiting for confirmation.')}</p>
                    </div>
                  </div>

                  {/* Step 2: Approved */}
                  <div className="relative">
                    <span className={`absolute -right-[31px] top-1 flex items-center justify-center w-4 h-4 rounded-full ${selectedOrderForTimeline.approvedAt ? "bg-emerald-500 text-white" : "bg-amber-100 text-amber-600 animate-pulse"} ring-8 ring-white`}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase">2. {tr('وقت موافقة الكابتن على طلب الزبون', 'Waiter confirmation')}</h4>
                      {selectedOrderForTimeline.approvedAt ? (
                        <>
                          <p className="text-xs font-mono text-brand-gold mt-1" dir="ltr">
                            {new Date(selectedOrderForTimeline.approvedAt).toLocaleString(language === 'en' ? 'en-IQ' : 'ar-IQ', { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, day: "numeric", month: "numeric" })}
                          </p>
                          {selectedOrderForTimeline.approvedAt > selectedOrderForTimeline.createdAt && (
                            <p className="text-[10px] text-emerald-600 mt-1 font-bold">
                              ⏱️ {tr('وقت الاستجابة للموافقة:', 'Confirmation time:')} {(() => {
                                const diff = selectedOrderForTimeline.approvedAt - selectedOrderForTimeline.createdAt;
                                const sec = Math.floor(diff / 1000) % 60;
                                const min = Math.floor(diff / 60000);
                                return min > 0 ? tr(`${min} دقيقة و ${sec} ثانية`, `${min} min ${sec} sec`) : tr(`${sec} ثانية`, `${sec} sec`);
                              })()}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs italic text-amber-600 mt-1">{tr('بانتظار موافقة كابتن الصالة والبدء بالتحضير الفعلي...', 'Waiting for the waiter to confirm the order...')}</p>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Ready */}
                  <div className="relative">
                    <span className={`absolute -right-[31px] top-1 flex items-center justify-center w-4 h-4 rounded-full ${selectedOrderForTimeline.readyAt ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400"} ring-8 ring-white`}>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase">3. {tr('وقت جهوزية الطلب للتسليم', 'Order ready')}</h4>
                      {selectedOrderForTimeline.readyAt ? (
                        <>
                          <p className="text-xs font-mono text-brand-gold mt-1" dir="ltr">
                            {new Date(selectedOrderForTimeline.readyAt).toLocaleString(language === 'en' ? 'en-IQ' : 'ar-IQ', { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, day: "numeric", month: "numeric" })}
                          </p>
                          {selectedOrderForTimeline.approvedAt && selectedOrderForTimeline.readyAt > selectedOrderForTimeline.approvedAt && (
                            <p className="text-[10px] text-emerald-600 mt-1 font-bold">
                              🍳 {tr('مدة التحضير الفعلي بالمطبخ:', 'Kitchen preparation:')} {(() => {
                                const diff = selectedOrderForTimeline.readyAt! - selectedOrderForTimeline.approvedAt!;
                                const sec = Math.floor(diff / 1000) % 60;
                                const min = Math.floor(diff / 60000);
                                return min > 0 ? tr(`${min} دقيقة و ${sec} ثانية`, `${min} min ${sec} sec`) : tr(`${sec} ثانية`, `${sec} sec`);
                              })()}
                            </p>
                          )}
                          {selectedOrderForTimeline.readyAt > selectedOrderForTimeline.createdAt && (
                            <p className="text-[10px] text-brand-primary mt-2 font-extrabold border-t border-border-delicate pt-2">
                              🕒 {tr('إجمالي كفاءة الخدمة (الطلب حتى الجاهزية):', 'Order-to-ready time:')} {(() => {
                                const diff = selectedOrderForTimeline.readyAt! - selectedOrderForTimeline.createdAt;
                                const sec = Math.floor(diff / 1000) % 60;
                                const min = Math.floor(diff / 60000);
                                return min > 0 ? tr(`${min} دقيقة و ${sec} ثانية`, `${min} min ${sec} sec`) : tr(`${sec} ثانية`, `${sec} sec`);
                              })()}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs italic text-text-muted mt-1">{tr('جاري العمل على الوجبات في القسم المختص...', 'The kitchen is preparing the dishes...')}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-8 border-t border-border-delicate pt-6 flex justify-end">
                  <button
                    onClick={() => setSelectedOrderForTimeline(null)}
                    className="px-6 py-2.5 bg-brand-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all"
                  >
                    {tr('إغلاق التفاصيل', 'Close details')}
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
              dir={dir}
            >
              <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
              <div className="space-y-4 text-right">
                <p className="text-[10px] sm:text-xs font-bold text-brand-gold uppercase tracking-widest">{tr('تأكيد تصفير النظام', 'Confirm reset')}</p>
                <h3 className="text-xl font-display text-brand-primary font-bold italic">{tr('هل تود تصفير عداد المبيعات وبدء يوم جديد؟', 'Start a new workday?')}</h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  {tr('أنت على وشك تصفير عداد أرقام الطلبات للبدء بيوم عمل جديد مفرغ تماماً.', 'This resets the order counter for a new workday.')}
                  <br className="mb-2" />
                  • {tr('سيبدأ ترتيب أرقام الطلبيات القادمة للزبائن من الرقم 1.', 'New order numbers will start at 1.')}
                  <br />
                  • {tr('سيتم أرشفة وإخفاء جميع الطلبيات النشطة حالياً من شاشات الموظفين واللوحة لتبدأ صفحة جديدة نظيفة.', 'Current active orders will be archived and hidden from staff screens.')}
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
                  {tr('نعم، تصفير والبدء من جديد', 'Yes, start new day')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirmModal(false)}
                  className="flex-1 px-4 py-3 border border-border-delicate text-brand-primary text-[11px] font-bold uppercase tracking-widest hover:bg-bg-paper transition-all text-center"
                >
                  {tr('إلغاء التراجع', 'Cancel')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeSettings({ restaurant, onSaved }: { restaurant: Restaurant; onSaved: (restaurant: Restaurant) => void }) {
  const { isEnglish, tr } = useLanguage();
  const initial = resolveTheme(restaurant.themeId, restaurant.themeColors);
  const [themeId, setThemeId] = useState(initial.id);
  const [colors, setColors] = useState<ThemeColors>(initial.colors);
  const [saving, setSaving] = useState(false);
  const activeTheme = resolveTheme(themeId, colors);
  const contrastOk = contrastRatio(colors.text, colors.background) >= 4.5;
  const colorFields: { key: keyof ThemeColors; label: string }[] = [
    { key: "primary", label: tr('الأساسي', 'Primary') }, { key: "secondary", label: tr('الثانوي', 'Secondary') },
    { key: "accent", label: tr('البارز', 'Accent') }, { key: "background", label: tr('الخلفية', 'Background') },
    { key: "text", label: tr('النص', 'Text') },
  ];

  const chooseTheme = (id: typeof themeId) => {
    const selected = resolveTheme(id);
    setThemeId(selected.id);
    setColors(selected.colors);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "restaurants", restaurant.id), { themeId, themeColors: colors });
      onSaved({ ...restaurant, themeId, themeColors: colors });
      alert(tr('تم حفظ الهوية وتطبيقها على المنيو ولوحات المالك والويتر والمطبخ.', 'Branding saved and applied to the menu, owner, waiter, and kitchen workspaces.'));
    } catch {
      alert(tr('تعذر حفظ التصميم. حاول مرة أخرى.', 'Could not save the theme. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div>
        <h2 className="section-title">{tr('هوية المطعم', 'Restaurant branding')}</h2>
        <p className="text-sm text-text-muted mt-2">{tr('اختر قالباً ثم خصّص ألوانه. تُطبّق الهوية على المنيو ولوحات المالك والويتر والمطبخ، وتبقى هوية أوردوفا هي الافتراضية.', 'Choose a theme and customize its colors. It applies to the menu and all restaurant workspaces; Ordova is the default.')}</p>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {MENU_THEMES.map((theme) => (
          <button key={theme.id} onClick={() => chooseTheme(theme.id)} className={`p-5 text-right border transition-all ${themeId === theme.id ? "border-brand-gold shadow-lg" : "border-border-delicate hover:border-brand-gold/50"}`}>
            <div className="flex gap-1 mb-4">{Object.values(theme.colors).slice(0, 4).map((color) => <span key={color} className="w-7 h-7 rounded-full border border-black/10" style={{ background: color }} />)}</div>
            <h3 className="font-display text-xl text-brand-primary">{isEnglish ? theme.nameEn : theme.name}</h3>
            <p className="text-xs text-text-muted mt-1">{isEnglish ? theme.descriptionEn : theme.description}</p>
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <div className="bg-white border border-border-delicate p-6 space-y-4">
          <h3 className="font-bold text-brand-primary">{tr('ألوان مخصصة', 'Custom colors')}</h3>
          {colorFields.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-4 text-sm">
              <span>{label}</span>
              <span className="flex items-center gap-2" dir="ltr">
                <input type="color" value={colors[key]} onChange={(event) => setColors({ ...colors, [key]: event.target.value })} className="w-10 h-10" />
                <input value={colors[key]} onChange={(event) => setColors({ ...colors, [key]: event.target.value })} className="w-24 border p-2 text-xs" />
              </span>
            </label>
          ))}
          {!contrastOk && <p className="text-xs text-red-700 bg-red-50 p-3">{tr('تباين النص والخلفية أقل من معيار WCAG AA (4.5:1). عدّل الألوان قبل الحفظ.', 'Text and background contrast is below WCAG AA (4.5:1). Adjust colors before saving.')}</p>}
          <button onClick={save} disabled={saving || !contrastOk} className="w-full bg-brand-primary text-white py-3 font-bold disabled:opacity-50">{saving ? tr('جاري الحفظ...', 'Saving...') : tr('حفظ التصميم', 'Save branding')}</button>
        </div>
        <div className="menu-theme min-h-[430px] border border-border-delicate overflow-hidden bg-bg-paper text-text-main" data-menu-theme={themeId} style={themeStyle(activeTheme)}>
          <div className="menu-preview-header p-8 bg-brand-primary text-white">
            <p className="text-xs text-brand-gold font-bold tracking-widest">{tr('معاينة مباشرة', 'Live preview')}</p>
            <h3 className="font-display text-4xl mt-3">{restaurant.restaurantName}</h3>
          </div>
          <div className="menu-preview-grid grid sm:grid-cols-2 gap-4 p-6">
            {[tr('طبق المطعم المميز', 'Signature dish'), tr('قهوة اليوم', 'Coffee of the day'), tr('حلوى الشيف', 'Chef dessert'), tr('مشروب موسمي', 'Seasonal drink')].map((name, index) => (
              <article key={name} className="menu-preview-card bg-white border border-border-delicate p-5">
                <span className="text-[10px] text-brand-gold font-bold">{tr('اختيار الشيف', 'Chef pick')} {index + 1}</span>
                <h4 className="font-display text-xl text-brand-primary mt-2">{name}</h4>
                <p className="text-xs text-text-muted mt-2">{tr('مكونات طازجة محضرة بعناية يومياً.', 'Fresh ingredients prepared daily.')}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function OwnerFinancePanel({ finance }: { finance: ReturnType<typeof summarizeOwnerOrders> }) {
  const { tr, language } = useLanguage();
  const max = Math.max(1, ...finance.week.map(day => day.value));
  const money = (value: number) => `${value.toLocaleString()} ${tr('د.ع', 'IQD')}`;
  return <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <div className="rounded-2xl border border-border-delicate bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-brand-gold">{tr('اتجاه المبيعات', 'Sales trend')}</p><h3 className="mt-1 text-lg font-bold text-brand-primary">{tr('آخر ٧ أيام', 'Last 7 days')}</h3></div><span className="rounded-full bg-bg-paper px-3 py-1 text-xs font-semibold text-text-muted">{tr('الطلبات المقدمة فقط', 'Served orders only')}</span></div>
      <div className="mt-6 flex h-44 items-end gap-2 border-b border-border-delicate pb-2 sm:gap-3">
        {finance.week.map(day => <div key={day.day} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center" title={`${day.day}: ${money(day.value)}`}>
          <div className="flex min-h-0 flex-1 items-end"><div className={`mx-auto w-full max-w-12 rounded-t-lg ${day.value ? 'bg-brand-primary/85 group-hover:bg-brand-gold' : 'bg-bg-paper'}`} style={{ height: `${Math.max(day.value ? 8 : 3, day.value / max * 100)}%` }} /></div>
          <span className="text-[10px] font-bold text-text-muted" dir="ltr">{new Date(`${day.day}T12:00:00+03:00`).toLocaleDateString(language === 'ar' ? 'ar-IQ' : 'en-GB', { weekday: 'short', timeZone: 'Asia/Baghdad' })}</span>
        </div>)}
      </div>
      <p className="mt-3 text-xs text-text-muted">{tr('هذه قيم الطلبات التي تم تقديمها، وليست تحصيلاً نقدياً مؤكداً أو صافي ربح.', 'Served order value is not confirmed cash collection or net profit.')}</p>
    </div>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border-delicate bg-white p-5"><p className="text-xs font-semibold text-text-muted">{tr('متوسط الطلب هذا الشهر', 'Average order this month')}</p><p className="mt-3 text-lg font-bold text-brand-primary">{money(finance.averageTicket)}</p><p className="mt-2 text-xs text-text-muted">{tr('من الطلبات المقدمة', 'From served orders')}</p></div>
        <div className="rounded-2xl border border-border-delicate bg-white p-5"><p className="text-xs font-semibold text-text-muted">{tr('قيمة الطلبات المفتوحة', 'Open order value')}</p><p className="mt-3 text-lg font-bold text-brand-primary">{money(finance.openValue)}</p><p className="mt-2 text-xs text-text-muted">{tr('جديد، تحضير، جاهز', 'New, preparing, ready')}</p></div>
      </div>
      <div className="rounded-2xl border border-border-delicate bg-white p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-bold text-brand-primary">{tr('الأصناف الأكثر طلباً هذا الشهر', 'Most ordered items this month')}</h3><UtensilsCrossed className="h-4 w-4 text-brand-gold" /></div>
        {finance.topItems.length ? <div className="mt-3 space-y-2">{finance.topItems.map((item, index) => <div key={item.name} className="flex items-center justify-between gap-3 rounded-xl bg-bg-paper px-3 py-2 text-sm"><span className="min-w-0 truncate font-semibold text-brand-primary">{index + 1}. {item.name}</span><span className="shrink-0 text-xs font-bold text-text-muted">{item.quantity} {tr('قطعة', 'sold')}</span></div>)}</div> : <p className="mt-4 text-sm text-text-muted">{tr('ستظهر الأصناف بعد تقديم الطلبات.', 'Items will appear after orders are served.')}</p>}
        <p className="mt-4 border-t border-border-delicate pt-3 text-xs text-text-muted">{tr(`ملغاة أو مرفوضة هذا الشهر: ${finance.monthRejectedCount}`, `Cancelled or rejected this month: ${finance.monthRejectedCount}`)}</p>
      </div>
    </div>
  </section>;
}

function StatCard({
  title,
  value,
  unit,
  label,
  icon,
}: {
  title: string;
  value: number | string;
  unit?: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="group relative min-w-0 space-y-4 overflow-hidden rounded-2xl border border-border-delicate bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,.03)] sm:p-6">
      <div className="absolute top-0 right-0 h-full w-1 bg-brand-gold/60" />
      <div className="text-brand-gold">
        {icon}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold text-text-muted">
          {label}
        </p>
        <p className="min-w-0 text-2xl leading-tight text-brand-primary tabular-nums font-bold [overflow-wrap:anywhere] sm:text-3xl">
          <bdi>{value}</bdi>{unit && <span className="ms-2 inline-block whitespace-nowrap align-baseline text-base font-semibold tracking-normal">{unit}</span>}
        </p>
      </div>
      <p className="text-xs font-bold text-brand-primary">
        {title}
      </p>
    </div>
  );
}

function StaffCard({
  staff,
  restaurantId,
  passcodeVersion,
  onToggle,
  onDelete,
  onEdit,
  accent = "primary",
}: {
  staff: Waiter;
  restaurantId: string;
  passcodeVersion: number;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  accent?: "primary" | "gold";
  key?: any;
}) {
  const { tr } = useLanguage();
  const [passcode, setPasscode] = useState<string | null>(null);
  const [passcodeError, setPasscodeError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPasscode(null);
    setPasscodeError(false);
    setCopied(false);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('authentication_required');
      const response = await fetch(`/api/staff/${encodeURIComponent(staff.id)}/passcode?restaurantId=${encodeURIComponent(restaurantId)}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store',
      });
      if (!response.ok) throw new Error('passcode_unavailable');
      const result = await response.json();
      if (!/^[0-9]{4}$/.test(result.passcode)) throw new Error('invalid_passcode');
      if (!cancelled) setPasscode(result.passcode);
    })().catch(() => { if (!cancelled) setPasscodeError(true); });
    return () => { cancelled = true; };
  }, [staff.id, restaurantId, passcodeVersion]);

  const copyPasscode = async () => {
    if (!passcode) return;
    try { await navigator.clipboard.writeText(passcode); setCopied(true); }
    catch { setCopied(false); }
  };
  return (
    <article className="overflow-hidden rounded-2xl border border-border-delicate bg-white shadow-[0_8px_28px_rgba(0,0,0,.03)] transition-shadow hover:shadow-lg">
      <div className="flex items-start gap-4 p-5">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ${accent === 'gold' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-brand-primary'}`}>{staff.name?.trim().charAt(0) || '•'}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-brand-primary">{staff.name}</p>
          <p className="mt-0.5 text-sm text-text-muted" dir="ltr">{staff.phone}</p>
          <p className="mt-2 text-xs font-semibold text-text-muted">{accent === 'gold' ? tr('موظف مطبخ', 'Kitchen staff') : tr('موظف صالة', 'Waiter staff')}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${staff.status === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{staff.status === 'active' ? tr('نشط', 'Active') : tr('موقوف', 'Paused')}</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border-delicate bg-bg-paper/60 px-5 py-3">
        <div><p className="text-xs font-semibold text-text-muted">{tr('رمز الدخول', 'Passcode')}</p><p className="mt-1 font-mono text-xl font-bold tracking-[.25em] text-brand-primary" dir="ltr">{passcodeError ? '—' : passcode || '••••'}</p></div>
        {passcode ? <button type="button" onClick={() => void copyPasscode()} className="min-h-10 rounded-xl border border-border-delicate bg-white px-4 text-xs font-bold text-brand-primary hover:bg-bg-paper">{copied ? tr('تم النسخ', 'Copied') : tr('نسخ الرمز', 'Copy code')}</button> : <span className="text-xs text-text-muted">{passcodeError ? tr('تعذر تحميل الرمز', 'Could not load code') : tr('جاري التحميل...', 'Loading...')}</span>}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-border-delicate p-4">
        <button type="button" onClick={onEdit} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand-primary px-3 text-xs font-bold text-white"><Edit2 className="h-4 w-4" />{tr('تعديل', 'Edit')}</button>
        <button type="button" onClick={onToggle} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border-delicate px-3 text-xs font-bold text-brand-primary">{staff.status === 'active' ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}{staff.status === 'active' ? tr('إيقاف', 'Pause') : tr('تفعيل', 'Activate')}</button>
        <button type="button" onClick={onDelete} aria-label={tr(`حذف ${staff.name}`, `Delete ${staff.name}`)} title={tr('حذف الموظف', 'Delete staff member')} className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-red-100 text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
      </div>
    </article>
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
  const { tr } = useLanguage();
  const stageColor = type === 'pending' ? 'bg-blue-500' : type === 'preparing' ? 'bg-amber-500' : type === 'ready' ? 'bg-emerald-500' : type === 'rejected' ? 'bg-red-500' : 'bg-slate-400';
  const stageHint = type === 'pending' ? tr('بانتظار الإرسال للمطبخ', 'Waiting to be sent to kitchen') : type === 'preparing' ? tr('المطبخ يعمل عليها الآن', 'The kitchen is working on these') : type === 'ready' ? tr('بانتظار التقديم للطاولة', 'Waiting to be served') : type === 'rejected' ? tr('طلبات تحتاج مراجعة', 'Orders to review') : tr('تم تقديمها للزبائن', 'Served to customers');
  return (
    <section className="min-w-0 rounded-2xl border border-border-delicate bg-bg-paper/60 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className={`h-3 w-3 shrink-0 rounded-full ${stageColor}`} /><div><h3 className="text-base font-bold text-brand-primary">{title}</h3><p className="mt-0.5 text-xs text-text-muted">{stageHint}</p></div></div>
        <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-white px-2 text-sm font-bold text-brand-primary">{orders.length}</span>
      </div>
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {orders.map((order) => (
            <motion.div
              layout
              key={order.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="group space-y-4 rounded-2xl border border-border-delicate bg-white p-4 shadow-sm transition-colors hover:border-brand-gold sm:p-5"
            >
              <div className="flex justify-between items-start gap-3">
                <div className="space-y-1 text-right">
                  <h4 className="text-lg font-bold text-brand-primary">{tr('طاولة', 'Table')} {order.tableNumber}</h4>
                  <p className="text-sm text-text-muted">{order.customerName}</p>
                </div>
                <span className="shrink-0 rounded-lg bg-bg-paper px-2.5 py-1 text-xs font-bold text-brand-primary">
                  {order.orderNumber ? tr(`رقم الطلب ${order.orderNumber}`, `Order ${order.orderNumber}`) : `#${order.id.slice(-6).toUpperCase()}`}
                </span>
              </div>

              <div className="space-y-2 rounded-xl bg-bg-paper p-3 text-right">
                {order.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-col border-b border-border-delicate/60 pb-2 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-start gap-2">
                        <span className="shrink-0 rounded-md bg-white px-2 py-0.5 font-bold text-brand-primary">{item.quantity}×</span>
                        <span className="font-semibold text-brand-primary">{item.name}</span>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-text-muted">{(item.price * item.quantity).toLocaleString()} {tr('د.ع', 'IQD')}</span>
                    </div>
                    {item.customizationText && (
                      <div className="mt-1 text-xs font-semibold text-amber-800">
                        ✨ {tr('الخيارات:', 'Options:')} {item.customizationText}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {order.status === "rejected" && (
                <div className="p-3 bg-red-50 border border-red-100 space-y-2 text-right">
                  <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest leading-none">⚠️ {tr('تفاصيل الرفض والطلب تراجعاً', 'Rejection details')}</p>
                  <p className="text-xs text-red-900 font-bold leading-relaxed">
                    <span className="text-[10px] text-red-600 font-normal">{tr('السبب:', 'Reason:')} </span>{order.rejectionReason}
                  </p>
                  <div className="pt-2 border-t border-red-100 flex items-center justify-between text-[8px] font-bold text-red-800">
                    <span>{tr('بواسطة الموظف:', 'By staff:')} <span className="underline">{order.rejectedBy || tr('غير معروف', 'Unknown')}</span></span>
                    <span className="bg-red-100 px-1.5 py-0.5 rounded text-[8px]">
                      {order.rejectedRole === "waiter" ? tr('طاقم الخدمة والويترز', 'Waiter team') : tr('لوحة المطبخ', 'Kitchen')}
                    </span>
                  </div>
                </div>
              )}

              {order.notes && <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">{tr('ملاحظة الزبون:', 'Customer note:')} {order.notes}</p>}
              <div className="flex flex-col gap-3 border-t border-border-delicate pt-3">
                <div className="flex justify-between items-center">
                  <p className="text-base font-display not-italic text-brand-primary">
                    <span className="font-sans font-bold">{order.totalAmount.toLocaleString()}</span> {tr('د.ع', 'IQD')}
                  </p>
                  {onShowTimeline && (
                    <button
                      onClick={() => onShowTimeline(order)}
                      type="button"
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border-delicate px-3 text-xs font-bold text-brand-primary hover:bg-bg-paper"
                      title={tr('عرض المخطط الزمني وتتبع الكفاءة', 'View order timeline')}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>{tr('التوقيت', 'Timeline')}</span>
                    </button>
                  )}
                </div>

                {!isHistory && (
                  <div className="flex items-center justify-end gap-2">
                    {order.deviceMetadata?.fingerprint && onBan && (
                      <button
                        onClick={() => onBan(order)}
                        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-red-100 px-3 text-xs font-bold text-red-700 hover:bg-red-50"
                        title={tr('حظر هذا العميل من المنيو الرقمي نهائياً', 'Block this customer from the digital menu')}
                      >
                        🚫 {tr('حظر', 'Block')}
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
                      className="group/btn flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-primary px-3 text-xs font-bold text-white hover:bg-brand-secondary"
                    >
                      {order.status === "pending"
                        ? tr('إرسال للمطبخ', 'Send to kitchen')
                        : order.status === "preparing"
                          ? tr('تأكيد جاهزية الطبق', 'Mark ready')
                          : tr('تأكيد تقديم الطلب', 'Mark served')}
                      <ChevronRight className="w-4 h-4 group-hover:-translate-x-1 transition-transform rotate-180" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {orders.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-delicate bg-white py-10 text-center text-sm text-text-muted">
            {tr('القائمة فارغة حالياً', 'No orders here yet')}
          </div>
        )}
      </div>
    </section>
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
  role: "waiter" | "kitchen" | "cashier";
  existingStaff?: Waiter;
}) {
  const { dir, tr } = useLanguage();
  const [formData, setFormData] = useState({
    name: existingStaff?.name || "",
    phone: existingStaff?.phone || "",
  });
  const [passcode, setPasscode] = useState("");
  const [passcodeDirty, setPasscodeDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdPasscode, setCreatedPasscode] = useState<string | null>(null);
  const [whatsappConsent, setWhatsAppConsent] = useState(false);
  const [invitationStatus, setInvitationStatus] = useState("");

  useEffect(() => {
    if (!existingStaff?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const response = await fetch(`/api/staff/${encodeURIComponent(existingStaff.id)}/passcode?restaurantId=${encodeURIComponent(restaurantId)}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (cancelled) return;
      if (!response.ok) throw new Error('passcode_unavailable');
      const result = await response.json();
      setPasscode((current) => current || result.passcode);
    })().catch(() => { if (!cancelled) setSaveError(tr('تعذر عرض رمز الدخول الحالي. تحقق من إعدادات الخادم.', 'Could not load this passcode. Check server setup.')); });
    return () => { cancelled = true; };
  }, [existingStaff?.id, restaurantId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if ((passcode || (existingStaff && passcodeDirty)) && !/^[0-9]{4}$/.test(passcode)) throw new Error('invalid_passcode');
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("authentication_required");
      const response = await fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ ...formData, whatsappConsent: !existingStaff && whatsappConsent, passcode: (!existingStaff || passcodeDirty) ? passcode : undefined, id: existingStaff?.id, restaurantId, role }) });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'staff_save_failed');
      }
      if (existingStaff) {
        onClose();
      } else {
        const result = await response.json();
        setCreatedPasscode(result.passcode);
        setInvitationStatus(result.whatsappInvitation || "");
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : 'staff_save_failed';
      if (code === 'invalid_phone') {
        setSaveError(tr('أدخل رقم واتساب صحيح للموظف.', 'Enter a valid staff WhatsApp number.'));
        return;
      }
      setSaveError(code === 'invalid_passcode'
        ? tr('رمز الدخول يجب أن يتكون من أربعة أرقام.', 'Passcode must be exactly four digits.')
        : code === 'weak_passcode'
          ? tr('اختر رمزاً أقل قابلية للتخمين.', 'Choose a less predictable passcode.')
        : code === 'passcode_taken'
          ? tr('هذا الرمز مستخدم بالفعل. اختر رمزاً آخر.', 'That passcode is already in use. Choose another.')
        : code === 'staff_auth_update_failed'
          ? tr('تعذر تحديث حساب الموظف.', 'Could not update the staff account.')
          : tr('تعذر حفظ حساب الموظف. تحقق من إعدادات رموز الدخول.', 'Could not save the staff account. Check passcode setup.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto" dir={dir}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white max-w-md w-full p-6 sm:p-12 border border-border-delicate relative my-8"
      >
        <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
        {createdPasscode ? (
          <div className="space-y-6 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto" />
            <div>
              <h2 className="text-2xl font-display text-brand-primary">{tr('تم إنشاء حساب الموظف', 'Staff account created')}</h2>
              <p className="text-xs text-text-muted mt-2">{tr('هذا رمز دخول الموظف. يمكنك عرضه أو تغييره لاحقاً من شاشة التعديل.', 'This is the staff passcode. You can view or change it later in Edit.')}</p>
            </div>
            <p className="rounded-xl bg-bg-paper border border-border-delicate p-5 text-4xl font-bold tracking-[.3em] text-brand-primary" dir="ltr">{createdPasscode}</p>
            {invitationStatus && <p role="status" className="text-sm text-text-muted">{invitationStatus === 'queued'
              ? tr('تمت إضافة دعوة واتساب إلى قائمة الإرسال.', 'WhatsApp invitation queued.')
              : tr('تعذّر جدولة دعوة واتساب. يمكنك مشاركة الرمز يدوياً.', 'Could not queue the WhatsApp invitation. You can share the passcode manually.')}</p>}
            <button type="button" onClick={() => navigator.clipboard.writeText(createdPasscode)} className="w-full py-3 border border-brand-primary text-brand-primary font-bold">{tr('نسخ رمز الدخول', 'Copy passcode')}</button>
            <button type="button" onClick={onClose} className="w-full py-4 bg-brand-primary text-white font-bold">{tr('تم، إغلاق', 'Done')}</button>
          </div>
        ) : <>
        <div className="space-y-2 mb-8">
          <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest">
            {tr('تسجيل وتعديل بيانات الموظف', 'Staff access details')}
          </p>
          <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
            {existingStaff ? tr('تعديل بيانات', 'Edit') : tr('تسجيل وتعيين', 'Create')}{" "}
            <span className="text-brand-gold">
              {role === "cashier" ? tr('الكاشير', 'cashier account') : role === "waiter" ? tr('موظف صالة (ويتر)', 'waiter account') : tr('شيف المطبخ', 'kitchen account')}
            </span>
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                {tr('الاسم الكامل للموظف', 'Full name')}
              </label>
              <input
                required
                placeholder={tr('الاسم الكامل', 'Full name')}
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all text-right"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                {tr('رقم الهاتف المباشر', 'Phone number')}
              </label>
              <input
                required
                placeholder={tr('مثال: 0780000000', 'Example: 0780000000')}
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary transition-all text-right"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
            </div>
            {!existingStaff && <label className="flex items-start gap-2 text-sm text-brand-primary">
              <input type="checkbox" className="mt-1 accent-brand-primary" checked={whatsappConsent} onChange={event => setWhatsAppConsent(event.target.checked)} />
              {tr('الموظف وافق يستلم بيانات الدخول على واتساب بهذا الرقم.', 'The staff member agreed to receive login details at this WhatsApp number.')}
            </label>}
            <div className="pt-2">
              <div className="space-y-1 text-right">
                <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                  {tr('رمز دخول الموظف (٤ أرقام)', 'Staff passcode (4 digits)')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  placeholder={existingStaff ? tr('جارٍ تحميل الرمز...', 'Loading passcode...') : tr('اتركه فارغاً للتوليد تلقائياً', 'Leave blank to generate automatically')}
                  className="w-full bg-bg-paper border border-border-delicate p-3 text-xs font-bold tracking-widest text-brand-primary focus:outline-none focus:border-brand-primary"
                  value={passcode}
                  onChange={(e) => { setPasscode(e.target.value.replace(/\D/g, '').slice(0, 4)); setPasscodeDirty(true); }}
                />
                <p className="text-xs text-text-muted">{tr('الرمز فريد لجميع الحسابات. شاركه مع الموظف فقط.', 'The passcode is unique across all accounts. Share it only with this staff member.')}</p>
              </div>
            </div>
          </div>

          {saveError && <p className="text-xs font-bold text-red-800 bg-red-50 border border-red-200 p-3">{saveError}</p>}

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-4 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest shadow-xl hover:bg-brand-secondary text-center disabled:opacity-60"
            >
              {saving ? tr('جاري الحفظ...', 'Saving...') : tr('تأكيد وتسجيل الموظف', 'Save staff account')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-4 px-6 border border-border-delicate text-[11px] font-bold uppercase tracking-widest text-text-muted text-center"
            >
              {tr('إلغاء والعودة', 'Cancel')}
            </button>
          </div>
        </form>
        </>}
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
  const { dir, language, tr } = useLanguage();
  const availableCategories = resolveMenuCategories(categories);
  const [formData, setFormData] = useState({
    name: existingItem?.name || "",
    price: existingItem?.price || 0,
    ingredients: existingItem?.ingredients || "",
    isSpicy: existingItem?.isSpicy || false,
    hasCheese: existingItem?.hasCheese || false,
    cheesePrice: existingItem?.cheesePrice || 0,
    spicyPrice: existingItem?.spicyPrice || 0,
    imageUrl: existingItem?.imageUrl || "",
    category: existingItem?.category || availableCategories[0],
    isAvailable: existingItem?.isAvailable !== false,
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      setUploadError(tr('حجم الصورة كبير جداً. يرجى اختيار صورة أصغر من 12 ميغابايت.', 'Image is too large. Choose one smaller than 12 MB.'));
      return;
    }

    try {
      setIsUploading(true);
      setUploadError("");
      const compressedRes = await compressAndResizeImage(file);
      setFormData(prev => ({ ...prev, imageUrl: compressedRes }));
    } catch {
      setUploadError(tr('عذراً، فشل تحميل ومعالجة الصورة. يرجى تجربة صورة أخرى.', 'Could not process this image. Try another image.'));
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
    if (isSaving) return;
    setSaveError("");
    setIsSaving(true);
    try {
      const imageUrl = await persistRestaurantImage(restaurantId, formData.imageUrl, "menu-item");
      if (existingItem) {
        await updateDoc(doc(db, "menuItems", existingItem.id), { ...formData, imageUrl });
      } else {
        await addDoc(collection(db, "menuItems"), {
          ...formData,
          imageUrl,
          restaurantId,
        });
      }
      onClose();
    } catch (err) {
      console.error("Failed to save menu item", err);
      setSaveError(tr(
        "تعذر حفظ الطبق. تحقق من اتصال الإنترنت والصورة المختارة ثم حاول مرة أخرى.",
        "The menu item could not be saved. Check your connection and selected image, then try again.",
      ));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div dir={dir} className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white max-w-2xl w-full p-6 sm:p-12 md:p-16 border border-border-delicate relative max-h-[90vh] overflow-y-auto custom-scrollbar my-8"
      >
        <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
        <div className="space-y-2 mb-8 sm:mb-12 text-right">
          <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest">
            {tr('إدارة وتحرير أطباق المنيو', 'Manage menu items')}
          </p>
          <h2 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight">
            {existingItem ? tr('تعديل وبيانات', 'Edit') : tr('إضافة وتعيين', 'Add')}{" "}
            <span className="text-brand-gold">{tr('طبق جديد', 'menu item')}</span>
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10">
            <div className="space-y-2 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                {tr('اسم وجبة الطعام أو المشروب', 'Item name')}
              </label>
              <input
                required
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-lg text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                placeholder={tr('مثال: كباب بغدادي، كولا...', 'Example: kebab, cola...')}
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2 text-right">
              <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                {tr('سعر الوجبة بالدينار العراقي (د.ع)', 'Price (IQD)')}
              </label>
              <input
                required
                type="number"
                className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-lg text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                placeholder={tr('سعر الطبق د.ع', 'Item price in IQD')}
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="space-y-2 text-right">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
              {tr('تصنيف وجبة الطعام (القائمة التابع لها)', 'Category')}
            </label>
            <select
              required
              className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary text-right appearance-none"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
            >
              {availableCategories.map((cat) => (
                <option key={cat} value={cat} className="text-brand-primary bg-white text-right">
                  {localizeCategory(cat, language)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4 text-right">
            <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
              {tr('صورة وجبة الطعام (من الاستوديو أو المعرض)', 'Item photo')}
            </label>
            
            {formData.imageUrl ? (
              <div className="border border-border-delicate p-6 bg-bg-paper flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="w-24 h-24 sm:w-32 sm:h-32 border border-border-delicate overflow-hidden bg-white shadow-inner flex items-center justify-center">
                  <img 
                    src={formData.imageUrl} 
                    alt={tr('معاينة وجبة الطعام', 'Item preview')}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 text-center sm:text-right space-y-2">
                  <p className="text-xs text-brand-primary font-bold">{tr('تم اختيار الصورة بنجاح', 'Image selected')}</p>
                  <p className="text-[10px] text-text-muted">{tr('تم ضغط الصورة تلقائياً لتسريع تحميل المنيو للزبائن', 'The image was optimized for faster menu loading.')}</p>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="px-4 py-2 border border-red-200 text-red-800 text-[10px] uppercase font-bold tracking-wider hover:bg-red-50 transition-colors"
                  >
                    {tr('حذف صورة الوجبة وإضافة غيرها', 'Replace photo')}
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
                    {isUploading ? tr('جاري ضغط ومعالجة الصورة...', 'Processing image...') : tr('اضغط هنا لاختيار صورة من الاستوديو', 'Choose an image')}
                  </p>
                  <p className="text-[10px] text-text-muted">{tr('تدعم الصور من كافة الصيغ (PNG, JPG, HEIC)', 'Supported formats: PNG, JPG, HEIC')}</p>
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
              {tr('مكونات وتفاصيل وجبة الطعام', 'Ingredients and description')}
            </label>
            <textarea
              className="w-full bg-bg-paper border border-border-delicate p-4 sm:p-6 font-display text-brand-primary focus:border-brand-primary outline-none h-28 sm:h-32 resize-none text-right"
              placeholder={tr('مثال: لحم عراقي طازج، متبل بالبهارات الخاصة، يقدم مع الخبز الحار والسلطات...', 'Example: fresh meat, seasoned and served with bread and salad...')}
              value={formData.ingredients}
              onChange={(e) =>
                setFormData({ ...formData, ingredients: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 sm:p-10 bg-bg-paper border border-border-delicate">
            <label className="flex items-center gap-4 cursor-pointer group justify-end w-full">
              <span className="text-[11px] font-bold uppercase tracking-widest text-brand-primary text-right">
                {tr('الوجبة متوفرة للطلب؟', 'Available to order?')}
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
                {tr('الوجبة حارة؟ (سبايسي)', 'Spicy?')}
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
                {tr('تحتوي على الجبن؟', 'Contains cheese?')}
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
                    {tr('سعر إضافة الجبن الإضافي (د.ع)', 'Extra cheese price (IQD)')}
                  </label>
                  <input
                    type="number"
                    className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                    placeholder={tr('مثال: 1000', 'Example: 1000')}
                    value={formData.cheesePrice}
                    onChange={(e) =>
                      setFormData({ ...formData, cheesePrice: Number(e.target.value) })
                    }
                  />
                  <p className="text-[9px] text-text-muted">{tr('السعر الإضافي الذي سيزاد على سعر الوجبة الأساسي عند طلب الجبن.', 'Added to the base price when cheese is selected.')}</p>
                </div>
              )}
              {formData.isSpicy && (
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                    {tr('سعر خيار سبايسي الإضافي (د.ع)', 'Spicy option price (IQD)')}
                  </label>
                  <input
                    type="number"
                    className="w-full bg-transparent border-b border-border-delicate py-2 sm:py-3 font-display text-base text-brand-primary focus:outline-none focus:border-brand-primary text-right"
                    placeholder={tr('مثال: 500', 'Example: 500')}
                    value={formData.spicyPrice}
                    onChange={(e) =>
                      setFormData({ ...formData, spicyPrice: Number(e.target.value) })
                    }
                  />
                  <p className="text-[9px] text-text-muted">{tr('السعر الإضافي عند طلب الخيار الحار (يمكن تركه 0 إذا كان مجاناً).', 'Added when spicy is selected; use 0 if free.')}</p>
                </div>
              )}
            </div>
          )}

          {saveError && (
            <p role="alert" className="w-full text-sm text-red-800 bg-red-50 border border-red-200 p-3 text-center">
              {saveError}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <button
              type="submit"
              disabled={isSaving || isUploading}
              className="flex-1 py-4 sm:py-5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest shadow-2xl hover:bg-brand-secondary text-center disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? tr("جاري حفظ الطبق...", "Saving item...") : tr("حفظ وتثبيت الطبق بالمنيو", "Save menu item")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-4 px-8 border border-border-delicate text-[11px] font-bold uppercase tracking-widest text-text-muted text-center"
            >
              {tr('رجوع للخلف', 'Back')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
