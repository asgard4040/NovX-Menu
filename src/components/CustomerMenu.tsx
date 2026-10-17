import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShoppingBag,
  MessageSquare,
  X,
  Plus,
  Minus,
  Utensils,
  Send,
  CheckCircle2,
  ChefHat,
  ArrowRight,
  Info,
  Flame,
  Check,
  User,
  Search,
  GlassWater,
  Sparkles,
  ShieldAlert,
  MapPin,
  AlertTriangle,
  Bell,
  Languages,
} from "lucide-react";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  Timestamp,
  onSnapshot,
} from "../lib/supabase-db";
import { db } from "../lib/supabase-db";
import { handleFirestoreError, OperationType } from "../lib/firestore-utils";
import { Restaurant, MenuItem, Order, OrderItem } from "../types";
import { chatWithAI } from "../lib/gemini";
import { acceptableGpsAccuracyMeters, verifyGeofence } from "../lib/geofence";
import { resolveTheme, themeStyle } from "../lib/themes";
import { localizeCategory, useLanguage } from "../lib/i18n";

interface CustomerMenuProps {
  restaurantId: string;
}

export default function CustomerMenu({ restaurantId }: CustomerMenuProps) {
  const { dir, language, isEnglish, toggleLanguage, tr } = useLanguage();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(() => {
    try {
      const cached = localStorage.getItem(`novix_customer_restaurant_${restaurantId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (_) {
      return null;
    }
  });
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => {
    try {
      const cached = localStorage.getItem(`novix_customer_menu_${restaurantId}`);
      return cached ? JSON.parse(cached) : [];
    } catch (_) {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => !restaurant);
  const [isExpired, setIsExpired] = useState(false);
  const [cart, setCart] = useState<{ [id: string]: number }>({});
  const [showCart, setShowCart] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiSettings, setAiSettings] = useState<any>(null);

  // States & helper functions for item options customization (cheese/spicy)
  const [showCustomizer, setShowCustomizer] = useState<{
    open: boolean;
    item: MenuItem | null;
  }>({ open: false, item: null });
  const [custCheese, setCustCheese] = useState(false);
  const [custSpicy, setCustSpicy] = useState(false);

  const parseCartKey = (key: string) => {
    if (!key.includes(":")) {
      return { itemId: key, cheeseSelected: false, spicySelected: false };
    }
    const parts = key.split(":");
    return {
      itemId: parts[0],
      cheeseSelected: parts[1] === "cheese",
      spicySelected: parts[2] === "spicy"
    };
  };

  const getCartKey = (itemId: string, cheeseSelected: boolean, spicySelected: boolean) => {
    return `${itemId}:${cheeseSelected ? "cheese" : ""}:${spicySelected ? "spicy" : ""}`;
  };

  const handleOpenCustomizer = (item: MenuItem) => {
    setCustCheese(false);
    setCustSpicy(false);
    setShowCustomizer({ open: true, item });
  };

  const handleAddCustomizedToCart = () => {
    if (!showCustomizer.item) return;
    const key = getCartKey(showCustomizer.item.id, custCheese, custSpicy);
    addToCart(key);
    setShowCustomizer({ open: false, item: null });
  };

  const getQuantityInCart = (itemId: string) => {
    return Object.entries(cart).reduce((sum, [key, qty]) => {
      const parsed = parseCartKey(key);
      if (parsed.itemId === itemId) return sum + (qty as number);
      return sum;
    }, 0);
  };

  // Checkout fields
  const [customerName, setCustomerName] = useState(() => localStorage.getItem("customer_name") || "");
  const [tableNumber, setTableNumber] = useState(() => localStorage.getItem("table_number") || "");
  const [notes, setNotes] = useState("");
  const [showOrderTrackingModal, setShowOrderTrackingModal] = useState(false);
  const [orderComplete, setOrderComplete] = useState<Order | null>(() => {
    try {
      if (typeof window !== "undefined") {
        const activeOrderId = localStorage.getItem("novix_active_order_id");
        if (activeOrderId) {
          return { id: activeOrderId, status: "pending", items: [], totalAmount: 0 } as any;
        }
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  });
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

  useEffect(() => {
    if (!orderComplete?.id) return;
    const refresh = async () => {
      const token = localStorage.getItem("novix_active_order_token") || "";
      const response = await fetch(`/api/orders/${encodeURIComponent(orderComplete.id)}/status?token=${encodeURIComponent(token)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === "served") {
        localStorage.removeItem("novix_active_order_id");
        localStorage.removeItem("novix_active_order_token");
      }
      setOrderComplete(data as Order);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [orderComplete?.id]);

  // Waiter Call States
  const [showWaiterModal, setShowWaiterModal] = useState(false);
  const [waiterCallReason, setWaiterCallReason] = useState("");
  const [submittingWaiterCall, setSubmittingWaiterCall] = useState(false);
  const [waiterCallSuccess, setWaiterCallSuccess] = useState(false);
  const waiterIdempotencyKeyRef = useRef<string | null>(null);
  const orderIdempotencyKeyRef = useRef<string | null>(null);
  const orderTrackingTokenRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem("customer_name", customerName);
  }, [customerName]);

  useEffect(() => {
    localStorage.setItem("table_number", tableNumber);
  }, [tableNumber]);

  // Security & Location Anti-Fraud States
  const [isLocationVerified, setIsLocationVerified] = useState<boolean | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [customerCoords, setCustomerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [computedDistance, setComputedDistance] = useState<number | null>(null);
  const [verifyingLocation, setVerifyingLocation] = useState(false);

  // A location failure is phrased in the language selected when it occurred.
  // Clear it on language changes so a retry shows the newly selected language.
  useEffect(() => setLocationError(null), [language]);
  const locationWatchRef = useRef<number | null>(null);
  const locationTimeoutRef = useRef<number | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState("");

  const getDeviceFingerprint = (): string => {
    let fp = localStorage.getItem("device_fingerprint");
    if (!fp) {
      fp = "fp_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);
      localStorage.setItem("device_fingerprint", fp);
    }
    return fp;
  };

  const getReadableDeviceType = (ua: string): string => {
    if (/android/i.test(ua)) return "جهاز أندرويد (Android)";
    if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return "جهاز آيفون (iOS)";
    if (/Macintosh/i.test(ua)) return "كمبيوتر ماك (Mac OS)";
    if (/Windows/i.test(ua)) return "كمبيوتر ويندوز (Windows PC)";
    if (/Linux/i.test(ua)) return "جهاز لينكس (Linux PC)";
    return "جهاز ذكي غير معروف";
  };

  const logSecurityAlert = async (
    type: "outside_range" | "desktop_device" | "multi_name_spam" | "failed_location" | "suspicious_activity",
    title: string,
    severity: "info" | "warning" | "critical",
    coords: { lat: number; lng: number } | null = null,
    distance: number | null = null
  ) => {
    try {
      const ua = navigator.userAgent;
      const deviceType = getReadableDeviceType(ua);
      const fingerprint = getDeviceFingerprint();

      const alertData = {
        restaurantId,
        type,
        title,
        severity,
        customerName: customerName || "زبون مجهول",
        tableNumber: tableNumber || "غير محددة",
        timestamp: Date.now(),
        status: "unread",
        deviceMetadata: {
          userAgent: ua,
          deviceType,
          screenSize: `${window.innerWidth}x${window.innerHeight} px`,
          language: navigator.language || "ar",
          fingerprint,
          coordinates: coords,
          distanceMeters: distance,
        },
      };

      await fetch('/api/security-alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId, type, title, severity,
          customerName: alertData.customerName, tableNumber: alertData.tableNumber,
          fingerprint, distanceMeters: distance,
        }),
      });
    } catch (e) {
      console.error("Failed to log security alert:", e);
    }
  };

  const stopLocationWatch = () => {
    if (locationWatchRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
    if (locationTimeoutRef.current !== null) {
      window.clearTimeout(locationTimeoutRef.current);
      locationTimeoutRef.current = null;
    }
  };

  useEffect(() => () => stopLocationWatch(), []);

  const checkCustomerLocation = (latitude: number, longitude: number, accuracy: number, restLat: number, restLng: number) => {
    const result = verifyGeofence({
      customerLatitude: latitude,
      customerLongitude: longitude,
      accuracyMeters: accuracy,
      restaurantLatitude: restLat,
      restaurantLongitude: restLng,
      radiusMeters: restaurant?.geofenceRadiusMeters || 150,
    });
    setComputedDistance(result.distanceMeters);
    setCustomerCoords({ lat: latitude, lng: longitude });
    setLocationAccuracy(accuracy);
    setIsLocationVerified(result.allowed);

    if (!result.allowed) {
      setLocationError(result.reason === "inaccurate_location"
        ? tr(
            `تعذر الحصول على موقع دقيق بما يكفي (الدقة الحالية نحو ${Math.round(accuracy)} متر). فعّل الموقع الدقيق وانتقل قرب نافذة ثم أعد المحاولة.`,
            `A precise enough location was not available (current accuracy is about ${Math.round(accuracy)} m). Enable precise location, move near a window, and try again.`,
          )
        : tr(
            `أنت خارج نطاق المطعم المسموح (${restaurant?.geofenceRadiusMeters || 150} متر).`,
            `You are outside the restaurant's allowed range (${restaurant?.geofenceRadiusMeters || 150} m).`,
          ));
      logSecurityAlert(
        "outside_range",
        `محاولة من خارج النطاق أو بموقع غير دقيق${result.distanceMeters === null ? "" : ` (${Math.round(result.distanceMeters)} متر)`}`,
        "warning",
        { lat: latitude, lng: longitude },
        result.distanceMeters
      );
    }
  };

  const verifyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError(tr("متصفحك لا يدعم نظام تحديد المواقع الجغرافي (GPS)", "Your browser does not support location services."));
      setIsLocationVerified(false);
      logSecurityAlert("failed_location", "متصفح الزائر لا يدعم الحصاد الجغرافي GPS", "warning");
      return;
    }

    setVerifyingLocation(true);
    setLocationError(null);
    setComputedDistance(null);
    stopLocationWatch();

    let bestPosition: GeolocationPosition | null = null;
    let completed = false;
    const finish = (position: GeolocationPosition) => {
      if (completed) return;
      completed = true;
      stopLocationWatch();
      setVerifyingLocation(false);
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(restaurant?.latitude) || !Number.isFinite(restaurant?.longitude)) {
        setLocationError(tr("لم يثبت المطعم موقعه بعد. يرجى إبلاغ الإدارة.", "The restaurant has not configured its location yet. Please tell the management."));
        setIsLocationVerified(false);
        return;
      }
      checkCustomerLocation(latitude, longitude, accuracy, restaurant!.latitude!, restaurant!.longitude!);
    };

    locationWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
          bestPosition = position;
        }
        if (position.coords.accuracy > 0 && position.coords.accuracy <= acceptableGpsAccuracyMeters(restaurant?.geofenceRadiusMeters)) finish(position);
      },
      (error) => {
        if (completed) return;
        completed = true;
        stopLocationWatch();
        setVerifyingLocation(false);
        console.error("Geolocation error:", error);
        let errorMsg = tr(
          "تعذر الحصول على موقعك. تأكد من تشغيل خدمة الموقع ثم أعد المحاولة.",
          "Your location could not be obtained. Turn on location services and try again.",
        );
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = tr(
            "تم رفض إذن الموقع. اسمح للموقع بالوصول إلى موقعك الدقيق من إعدادات المتصفح ثم أعد المحاولة.",
            "Location permission was denied. Allow precise location access in your browser settings, then try again.",
          );
        }
        setLocationError(errorMsg);
        setIsLocationVerified(false);
        logSecurityAlert("failed_location", `رفض مشاركة الموقع الجغرافي (رمز الخطأ: ${error.code})`, "warning");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    locationTimeoutRef.current = window.setTimeout(() => {
      if (completed) return;
      if (bestPosition) finish(bestPosition);
      else {
        completed = true;
        stopLocationWatch();
        setVerifyingLocation(false);
        setIsLocationVerified(false);
        setLocationError(tr(
          "انتهت مهلة تحديد الموقع. تأكد من تشغيل الموقع الدقيق ثم أعد المحاولة.",
          "Location timed out. Make sure precise location is enabled, then try again.",
        ));
      }
    }, 12000);
  };

  useEffect(() => {
    if (restaurant) {
      // Inspect if visitor is on a normal PC and alert the dashboard
      const ua = navigator.userAgent;
      const isDesktop = !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      if (isDesktop) {
        logSecurityAlert("desktop_device", "دخول إلى نظام المنيو من كمبيوتر مكتبي وليس هاتف محمول", "warning");
      }
    }
  }, [restaurant]);

  // Category and Search Filtering
  const [selectedCategory, setSelectedCategory] = useState("الكل");
  const [searchQuery, setSearchQuery] = useState("");

  // AI Chat state
  const [messages, setMessages] = useState<
    { role: "user" | "model"; text: string }[]
  >([]);
  const [inputMessage, setInputMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, [restaurantId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, aiLoading]);

  const fetchData = async () => {
    try {
      // Fetch AI settings
      try {
        const aiDoc = await getDoc(doc(db, "settings", "ai"));
        if (aiDoc.exists()) {
          setAiSettings(aiDoc.data());
        }
      } catch (e) {
        console.warn("Failed to fetch AI settings in customer menu:", e);
      }

      const publicResponse = await fetch(`/api/public/restaurants/${encodeURIComponent(restaurantId)}`);
      if (!publicResponse.ok) {
        if (publicResponse.status === 403) setIsExpired(true);
        throw new Error(`restaurant_load_${publicResponse.status}`);
      }
      const publicData = await publicResponse.json();
      {
        const rData = publicData.restaurant as Restaurant;
        setRestaurant(rData);
        try {
          localStorage.setItem(`novix_customer_restaurant_${restaurantId}`, JSON.stringify(rData));
        } catch (_) {}
      }

      const statusResponse = await fetch(`/api/public/restaurants/${encodeURIComponent(restaurantId)}/customer-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: getDeviceFingerprint(), restaurantId }),
      });
      const customerStatus = statusResponse.ok ? await statusResponse.json() : { banned: false };
      if (customerStatus.banned) {
        setIsBanned(true);
        setBanReason(customerStatus.reason || "مخالفة شروط وسياسات استخدام الصالة");
      }

      const itemsList = publicData.menuItems as MenuItem[];
      setMenuItems(itemsList);
      try {
        localStorage.setItem(`novix_customer_menu_${restaurantId}`, JSON.stringify(itemsList));
      } catch (_) {}
    } catch (err) {
      console.warn("Could not fetch customer menu from Firestore (using offline local storage cache):", err);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (id: string) => {
    setCart((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => {
      const next = { ...prev };
      if (next[id] > 1) next[id]--;
      else delete next[id];
      return next;
    });
  };

  const totalItems = (Object.values(cart) as number[]).reduce(
    (a, b) => a + b,
    0,
  );
  const totalPrice = Object.entries(cart).reduce((sum, [cartKey, qty]) => {
    const { itemId, cheeseSelected, spicySelected } = parseCartKey(cartKey);
    const item = menuItems.find((i) => i.id === itemId);
    if (!item) return sum;
    const itemPrice = item.price + 
      (cheeseSelected ? (item.cheesePrice || 0) : 0) + 
      (spicySelected ? (item.spicyPrice || 0) : 0);
    return sum + itemPrice * (qty as number);
  }, 0);

  const showSubmissionError = (error: unknown, requestType: "order" | "waiter") => {
    const code = error instanceof Error ? error.message : "request_failed";
    if (["location_required", "invalid_location", "location_rejected"].includes(code)) {
      setIsLocationVerified(false);
      setLocationError(tr(
        "لم يتمكن المطعم من التحقق من موقعك. أعد تحديد الموقع الدقيق، أو اطلب من أحد الموظفين تسجيل الطلب لك.",
        "The restaurant could not verify your location. Retry precise location or ask a staff member to place the order for you.",
      ));
      return;
    }
    if (code === "invalid_menu_item") {
      void fetchData();
      alert(tr("تغيرت القائمة أو لم يعد أحد الأطباق متاحاً. راجع السلة وحاول مجدداً.", "The menu changed or an item is unavailable. Review your cart and try again."));
      return;
    }
    if (code === "subscription_inactive") {
      alert(tr("الطلب الإلكتروني غير متاح حالياً لهذا المطعم. يرجى التواصل مع الموظفين.", "Online ordering is currently unavailable for this restaurant. Please contact staff."));
      return;
    }
    alert(requestType === "order"
      ? tr("تعذر إرسال الطلب. تحقق من الاتصال ثم حاول مرة أخرى؛ إذا استمرت المشكلة فأبلغ الموظفين.", "The order could not be sent. Check your connection and try again, or tell a staff member.")
      : tr("تعذر إرسال نداء الويتر. حاول مجدداً أو اطلب المساعدة مباشرة.", "The waiter request could not be sent. Try again or ask staff directly."));
  };

  const handleWaiterCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !tableNumber.trim() || !waiterCallReason.trim()) {
      alert(tr("الرجاء ملء جميع الحقول المطلوبة.", "Please complete all required fields."));
      return;
    }

    setSubmittingWaiterCall(true);
    try {
      if (!isLocationVerified || !customerCoords || locationAccuracy === null) {
        throw new Error("location_required");
      }
      waiterIdempotencyKeyRef.current ||= crypto.randomUUID();
      const response = await fetch('/api/waiter-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          customerName: customerName.trim(),
          tableNumber: tableNumber.trim(),
          reason: waiterCallReason.trim(),
          idempotencyKey: waiterIdempotencyKeyRef.current,
          location: { latitude: customerCoords.lat, longitude: customerCoords.lng, accuracy: locationAccuracy },
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'request_failed');
      waiterIdempotencyKeyRef.current = null;
      setWaiterCallSuccess(true);
      setWaiterCallReason("");
      setTimeout(() => {
        setWaiterCallSuccess(false);
        setShowWaiterModal(false);
      }, 3000);
    } catch (err) {
      console.error("Error submitting waiter call:", err);
      showSubmissionError(err, "waiter");
    } finally {
      setSubmittingWaiterCall(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (submittingOrder) return;
    if (!customerName.trim() || !tableNumber.trim()) {
      alert(tr("الرجاء إدخال اسمك ورقم الطاولة", "Enter your name and table number."));
      return;
    }

    setSubmittingOrder(true);
    try {
    const orderItems: OrderItem[] = Object.entries(cart).map(([cartKey, qty]) => {
      const { itemId, cheeseSelected, spicySelected } = parseCartKey(cartKey);
      const item = menuItems.find((i) => i.id === itemId);
      if (!item) throw new Error("invalid_menu_item");
      
      const extraList: string[] = [];
      if (cheeseSelected) extraList.push(tr(`جبن (+${(item.cheesePrice || 0).toLocaleString()} د.ع)`, `Cheese (+${(item.cheesePrice || 0).toLocaleString()} IQD)`));
      if (spicySelected) extraList.push(tr(`سبايسي (+${(item.spicyPrice || 0).toLocaleString()} د.ع)`, `Spicy (+${(item.spicyPrice || 0).toLocaleString()} IQD)`));
      
      const customizationText = extraList.length > 0 ? extraList.join(" + ") : tr("عادي", "Regular");
      const customizedPrice = item.price + 
        (cheeseSelected ? (item.cheesePrice || 0) : 0) + 
        (spicySelected ? (item.spicyPrice || 0) : 0);

      return {
        id: item.id,
        name: item.name + (extraList.length > 0 ? ` (${cheeseSelected ? "🧀" : ""}${spicySelected ? "🌶️" : ""})` : ""),
        quantity: qty as number,
        price: customizedPrice,
        cheeseSelected,
        spicySelected,
        customizationText,
      };
    });

      if (orderItems.length === 0) throw new Error("invalid_order");
      if (!isLocationVerified || !customerCoords || locationAccuracy === null) throw new Error("location_required");
      orderIdempotencyKeyRef.current ||= crypto.randomUUID();
      orderTrackingTokenRef.current ||= crypto.randomUUID();
      const response = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId, customerName: customerName.trim(), tableNumber: tableNumber.trim(), notes, items: orderItems, idempotencyKey: orderIdempotencyKeyRef.current,
          trackingToken: orderTrackingTokenRef.current,
          fingerprint: getDeviceFingerprint(), location: { latitude: customerCoords.lat, longitude: customerCoords.lng, accuracy: locationAccuracy } }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'order_failed');
      const orderData = await response.json();
      orderIdempotencyKeyRef.current = null;
      orderTrackingTokenRef.current = null;
      localStorage.setItem("novix_active_order_id", orderData.id);
      localStorage.setItem("novix_active_order_token", orderData.trackingToken);
      setOrderComplete(orderData as Order);
      setShowOrderTrackingModal(true);
      setCart({});
      setShowCart(false);
    } catch (err) {
      console.error(err);
      showSubmissionError(err, "order");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleAIPlaceOrder = async (orderInfo: {
    customerName: string;
    tableNumber: string;
    notes: string;
    items: { name: string; quantity: number }[];
  }) => {
    const orderItems: OrderItem[] = [];
    let totalCalculatedPrice = 0;

    for (const item of orderInfo.items) {
      const menuItem = menuItems.find(
        (m) =>
          m.name.trim().toLowerCase() === item.name.trim().toLowerCase() ||
          m.name.trim().includes(item.name.trim()) ||
          item.name.trim().includes(m.name.trim())
      );

      if (menuItem) {
        orderItems.push({
          id: menuItem.id,
          name: menuItem.name,
          quantity: item.quantity || 1,
          price: menuItem.price,
        });
        totalCalculatedPrice += menuItem.price * (item.quantity || 1);
      }
    }

    if (orderItems.length === 0) return;

    if (submittingOrder) return;
    setSubmittingOrder(true);
    try {
      if (!isLocationVerified || !customerCoords || locationAccuracy === null) throw new Error("location_required");
      orderIdempotencyKeyRef.current ||= crypto.randomUUID();
      orderTrackingTokenRef.current ||= crypto.randomUUID();
      const response = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId, customerName: orderInfo.customerName, tableNumber: orderInfo.tableNumber,
          notes: orderInfo.notes || "", items: orderItems, fingerprint: getDeviceFingerprint(), idempotencyKey: orderIdempotencyKeyRef.current,
          trackingToken: orderTrackingTokenRef.current,
          location: { latitude: customerCoords.lat, longitude: customerCoords.lng, accuracy: locationAccuracy } }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'order_failed');
      const orderData = await response.json();
      orderIdempotencyKeyRef.current = null;
      orderTrackingTokenRef.current = null;
      localStorage.setItem("novix_active_order_id", orderData.id);
      localStorage.setItem("novix_active_order_token", orderData.trackingToken);
      setOrderComplete(orderData as Order);
      setShowOrderTrackingModal(true);
      
      setCustomerName(orderInfo.customerName);
      setTableNumber(orderInfo.tableNumber);
      setNotes(orderInfo.notes || "");
      
      setCart({});
      setShowCart(false);
    } catch (err) {
      console.error(err);
      showSubmissionError(err, "order");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const cleanMessageText = (text: string) => {
    if (!text) return "";
    let clean = text;
    const startIndex = clean.indexOf("[ORDER_JSON_START]");
    if (startIndex !== -1) {
      clean = clean.substring(0, startIndex).trim();
    }
    // Replace markdown list asterisks (* ) with neat bullet points (• ) at start of lines
    clean = clean.replace(/^\s*\*\s+/gm, "• ");
    // Strip markdown bold markers **
    clean = clean.replace(/\*\*(.*?)\*\*/g, "$1");
    // Strip markdown italic markers *
    clean = clean.replace(/\*(.*?)\*/g, "$1");
    return clean;
  };

  const handleAISend = async () => {
    if (!inputMessage.trim() || aiLoading) return;

    const userText = inputMessage.trim();
    setInputMessage("");
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setAiLoading(true);

    const history = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const response = await chatWithAI(
      userText,
      menuItems,
      restaurant?.restaurantName || tr("مطعمنا", "our restaurant"),
      restaurantId,
      history,
      aiSettings,
      language,
    );

    setAiLoading(false);
    setMessages((prev) => [...prev, { role: "model", text: response }]);

    const startIdx = response.indexOf("[ORDER_JSON_START]");
    const endIdx = response.indexOf("[ORDER_JSON_END]");
    if (startIdx !== -1 && endIdx !== -1) {
      const jsonStr = response.substring(startIdx + "[ORDER_JSON_START]".length, endIdx).trim();
      try {
        const orderInfo = JSON.parse(jsonStr);
        if (orderInfo && orderInfo.items && orderInfo.items.length > 0) {
          await handleAIPlaceOrder(orderInfo);
        }
      } catch (e) {
        console.error("Failed to parse AI order JSON:", e);
      }
    }
  };

  const getCategoryIcon = (categoryName: string) => {
    const name = categoryName.trim();
    if (name === "الكل") return <Utensils className="w-3.5 h-3.5" />;
    if (name.includes("وجب") || name.includes("رئيس") || name.includes("أطباق")) return <ChefHat className="w-3.5 h-3.5" />;
    if (name.includes("قبل") || name.includes("مقبلات") || name.includes("سلط")) return <Flame className="w-3.5 h-3.5" />;
    if (name.includes("حلو") || name.includes("حلويات") || name.includes("كيك")) return <Sparkles className="w-3.5 h-3.5" />;
    if (name.includes("شرب") || name.includes("مشروبات") || name.includes("عصير") || name.includes("بارد")) return <GlassWater className="w-3.5 h-3.5" />;
    if (name.includes("شوا") || name.includes("مشويات") || name.includes("كباب")) return <Flame className="w-3.5 h-3.5" />;
    return <Utensils className="w-3.5 h-3.5" />;
  };

  const roundedCategoryMap: Record<string, string> = {
    "الكل": "كل المأكولات والمشروبات المتاحة",
    "الوجبات الأساسية": "وجباتنا الرئيسية المحضرة بمذاق طيب وطازج",
    "المقبلات": "فواتح الشهية والمشروبات التمهيدية الطازجة",
    "الحلويات": "تشكيلة من الحلويات اللذيذة والباردة المحضرة يومياً",
    "المشروبات": "عصائر طبيعية ومشروبات غازية وحارة منعشة"
  };

  if (loading)
    return (
      <div className="min-h-screen bg-bg-paper flex items-center justify-center font-sans">
        <div className="w-12 h-12 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (isExpired) {
    return (
      <div className="min-h-screen bg-bg-paper flex items-center justify-center p-4 font-sans" dir={dir}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white w-full max-w-lg p-10 rounded-2xl shadow-xl border border-gray-200 text-center space-y-8"
        >
          <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto border border-amber-100">
            <Utensils className="w-10 h-10" />
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-gray-800 font-display">{tr('عذراً، المنيو غير متاح حالياً', 'Sorry, the menu is unavailable')}</h1>
            <p className="text-sm text-text-muted leading-relaxed">
              {tr('المنيو الإلكتروني لهذا المطعم متوقف مؤقتاً وغير متاح للتصفح في الوقت الحالي. يرجى مراجعة إدارة المطعم لمزيد من التفاصيل.', 'This restaurant menu is temporarily unavailable. Please contact the restaurant for details.')}
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isBanned) {
    return (
      <div className="min-h-screen bg-bg-paper flex items-center justify-center p-4 font-sans" dir={dir}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white w-full max-w-lg p-10 rounded-2xl shadow-xl border border-red-200 space-y-8"
        >
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-100">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-red-700 font-display">{tr('عذراً، لقد تم تقييد وصولك', 'Access restricted')}</h1>
            <p className="text-xs text-text-muted leading-relaxed">
              {tr('تم حظر هذا الجهاز من تصفح المنيو الإلكتروني أو تقديم طلبات جديدة من قبل إدارة المطعم.', 'Restaurant management has blocked this device from browsing or placing new orders.')}
            </p>
          </div>
          <div className="bg-red-50/50 p-6 rounded-xl border border-red-100 text-right space-y-2">
            <p className="text-[10px] font-bold text-red-800 uppercase tracking-widest leading-none">⚠️ {tr('سبب الحظر:', 'Reason:')}</p>
            <p className="text-xs text-red-900 font-bold leading-relaxed">{banReason}</p>
          </div>
          <p className="text-[10.5px] text-text-muted">
            {tr('إذا كنت تعتقد أن هذا الإجراء تم بالخطأ، يرجى مراجعة كابتن الصالة أو مدير المطعم لتأكيد هويتك وتواجدك.', 'If you believe this is a mistake, please speak to the waiter or restaurant manager.')}
          </p>
        </motion.div>
      </div>
    );
  }



  const filteredMenuItems = menuItems.filter((item) => {
    const matchesCategory =
      selectedCategory === "الكل" || 
      item.category === selectedCategory || 
      (!item.category && selectedCategory === "الوجبات الأساسية");

    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.ingredients &&
        item.ingredients.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesCategory && matchesSearch;
  });

  return (
    <div
      className="menu-theme min-h-screen bg-bg-paper font-sans pb-28 text-text-main selection:bg-brand-primary/10"
      data-menu-theme={restaurant?.themeId || "italian-luxury"}
      style={themeStyle(resolveTheme(restaurant?.themeId, restaurant?.themeColors))}
      dir={dir}
    >
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="bg-amber-600 text-white text-xs py-2.5 px-4 text-center font-bold relative z-[110] flex items-center justify-center gap-2 border-b border-amber-700/50 shadow-inner">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span>{tr('عيني زبائننا الكرام، جهازكم غير متصل بالإنترنت حالياً. لا تشيلون هم دقيقة، المنيو متوفر أوفلاين وسنحاول إعادة الاتصال تلقائياً لتحديث طلبكم فوراً!', 'You are offline. The menu remains available and we will reconnect automatically.')}</span>
        </div>
      )}

      {/* Texture Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

      {/* --------------------------------------------------------- */}
      {/* SECURITY OUTSIDE-RANGE GEOFENCE OVERLAY */}
      {/* --------------------------------------------------------- */}
      {isLocationVerified !== true && (
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-brand-primary/95 backdrop-blur-md z-[1000] flex items-center justify-center p-4 sm:p-6 text-right font-sans"
            dir={dir}
          >
            <div className="bg-white border border-border-delicate rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5 relative">
              <div className="absolute top-0 right-0 left-0 h-1 bg-brand-gold animate-pulse" />
              
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-brand-primary/[0.03] text-brand-gold border border-border-delicate flex items-center justify-center mx-auto">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-display text-brand-primary tracking-tight">
                  {tr('تأكيد موقعك', 'Confirm your location')}
                </h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  {tr(`للاطلاع على منيو ${restaurant?.restaurantName || 'المطعم'} وإرسال طلبك، اسمح بالوصول إلى موقعك وأنت داخل المطعم.`, `To browse ${restaurant?.restaurantName || 'the restaurant'} menu and order, allow location access while you are at the restaurant.`)}
                </p>
              </div>

              {locationError ? (
                <div className="bg-red-50 text-red-800 border-r-4 border-r-red-600 p-4 rounded text-xs leading-relaxed space-y-2">
                  <p className="font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> {tr('تعذر تأكيد الموقع', 'Could not confirm location')}
                  </p>
                  <p>{locationError}</p>
                </div>
              ) : computedDistance !== null && computedDistance > (restaurant?.geofenceRadiusMeters || 150) ? (
                <div className="bg-amber-50 text-amber-950 border-r-4 border-r-amber-500 p-4 rounded text-xs leading-relaxed space-y-2">
                  <p className="font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> {tr('خارج صالة المطعم الجغرافية!', 'Outside the restaurant area')}
                  </p>
                  <p>
                    {tr('تبعد تقريباً', 'You are about')} <strong className="text-amber-800">{Math.round(computedDistance)} {tr('متر', 'm')}</strong> {tr('عن المطعم.', 'from the restaurant.')}
                  </p>
                </div>
              ) : (
                <div className="bg-bg-paper p-4 rounded border border-border-delicate text-xs text-text-muted leading-relaxed flex items-center gap-3">
                  <MapPin className="text-brand-gold w-5 h-5 shrink-0" />
                  {tr('يُستخدم موقعك للتحقق من وجودك قرب المطعم قبل الطلب.', 'Your location is used to check that you are near the restaurant before ordering.')}
                </div>
              )}

              <div className="space-y-3 font-sans">
                <button
                  onClick={verifyLocation}
                  disabled={verifyingLocation}
                  className="w-full py-4 bg-brand-primary text-white text-sm font-bold hover:bg-brand-secondary transition-colors flex items-center justify-center gap-3 rounded-xl"
                >
                  {verifyingLocation ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {tr('جاري التحقق من موقعك الحالي...', 'Checking your location...')}
                    </>
                  ) : (
                    <>
                      {tr('تأكيد موقعي', 'Confirm my location')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Header */}
      <header className="fixed top-0 inset-x-0 z-40 bg-bg-card/95 backdrop-blur-xl border-b border-border-delicate shadow-sm px-4 sm:px-8 h-16 sm:h-20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-bg-paper border border-border-delicate p-1 rounded-xl shrink-0">
            {restaurant?.logoUrl ? (
              <img
                src={restaurant.logoUrl}
                alt={restaurant.restaurantName}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-brand-primary/5 flex items-center justify-center">
                <Utensils className="text-brand-primary w-3.5 h-3.5 sm:w-5 sm:h-5" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-base sm:text-xl font-bold text-brand-primary truncate leading-tight">
              {restaurant?.restaurantName}
            </h1>
            <p className="text-[10px] sm:text-xs text-text-muted font-medium mt-0.5 truncate">
              {tr('القائمة الرقمية', 'Digital menu')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex items-center justify-center h-10 px-2 sm:px-3 rounded-full border border-border-delicate bg-bg-paper text-brand-primary hover:border-brand-gold transition-colors text-[10px] sm:text-xs font-bold"
            aria-label={tr('تغيير اللغة', 'Change language')}
          >
            <Languages className="w-4 h-4 sm:me-1" />
            <span>{isEnglish ? 'AR' : 'EN'}</span>
          </button>
          <button
            onClick={() => setShowWaiterModal(true)}
            className="flex items-center gap-2 px-3 sm:px-4 h-10 bg-brand-primary text-white hover:bg-brand-secondary text-xs font-bold rounded-full transition-colors"
            aria-label={tr('طلب ويتر', 'Call waiter')}
          >
            <Bell className="w-4 h-4 shrink-0" />
            <span className="hidden min-[390px]:inline">{tr('ويتر', 'Waiter')}</span>
          </button>

          <button
            onClick={() => setShowAIChat(true)}
            className="flex items-center justify-center h-10 w-10 rounded-full border border-border-delicate bg-bg-paper text-brand-primary hover:border-brand-gold hover:text-brand-gold transition-colors"
            aria-label={tr('المساعد الذكي', 'AI assistant')}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* A compact introduction keeps the food within reach on a phone. */}
      <section className="menu-preview-header pt-24 sm:pt-28 px-4 sm:px-8 pb-5 sm:pb-7">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-brand-gold mb-1">{tr('أهلاً بك', 'Welcome')}</p>
            <h2 className="text-2xl sm:text-4xl font-display font-bold text-brand-primary leading-tight">
              {tr('ماذا تحب أن تطلب؟', 'What would you like to eat?')}
            </h2>
            <p className="text-sm text-text-muted mt-1">{tr('اختر أطباقك وأرسل الطلب من السلة.', 'Choose your dishes, then send your order from the cart.')}</p>
          </div>
          {orderComplete && (
            <button type="button" onClick={() => setShowOrderTrackingModal(true)}
              className="inline-flex items-center justify-between gap-4 rounded-xl border border-brand-gold/40 bg-bg-card px-4 py-3 text-sm font-bold text-brand-primary shadow-sm sm:min-w-56">
              <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-brand-gold" />{tr('تتبع طلبك', 'Track your order')}</span>
              <span className="text-xs text-text-muted">{orderComplete.status === 'pending' ? tr('قيد التأكيد', 'Pending') : orderComplete.status === 'preparing' ? tr('قيد التحضير', 'Preparing') : orderComplete.status === 'ready' ? tr('جاهز', 'Ready') : orderComplete.status === 'served' ? tr('تم التقديم', 'Served') : tr('راجع الطلب', 'Check order')}</span>
            </button>
          )}
        </div>
      </section>

      {/* Search and Categories Bar */}
      <div className="sticky top-16 sm:top-20 z-30 bg-bg-card/95 backdrop-blur-md border-b border-border-delicate py-3 sm:py-4 space-y-3">
        {/* Search Input */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="relative">
            <span className="absolute inset-y-0 right-4 flex items-center pr-3 pointer-events-none text-brand-gold">
              <Search className="w-5 h-5" />
            </span>
            <input
              type="text"
              aria-label={tr('ابحث في المنيو', 'Search menu')}
              placeholder={tr('ابحث عن طبق أو مكون', 'Search dishes or ingredients')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-paper border border-border-delicate rounded-xl focus:border-brand-gold pr-12 pl-4 py-3 text-sm text-brand-primary placeholder:text-text-muted/60 outline-none text-right transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 left-4 flex items-center pl-3 text-text-muted hover:text-brand-primary"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Categories Carousel */}
        <div className="flex max-w-7xl mx-auto px-4 sm:px-8 overflow-x-auto no-scrollbar gap-2 justify-start pb-1" aria-label={tr('أقسام المنيو', 'Menu categories')}>
          {["الكل", ...(restaurant?.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"])].map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors relative border ${
                  isSelected
                    ? "bg-brand-primary text-white border-brand-primary shadow-[0_10px_25px_-5px_rgba(45,58,39,0.22)]"
                    : "bg-bg-card text-text-muted hover:text-brand-primary border-border-delicate hover:border-brand-gold/30 hover:shadow-sm"
                }`}
                aria-pressed={isSelected}
              >
                <span className={`transition-transform duration-300 ${isSelected ? "scale-110 text-brand-gold" : "text-text-muted/60"}`}>
                  {getCategoryIcon(cat)}
                </span>
                <span className="tracking-wide">{cat === 'الكل' ? tr('الكل', 'All') : localizeCategory(cat, language)}</span>
                {isSelected && (
                  <motion.div
                    layoutId="activeCatBubble"
                    className="absolute inset-0 rounded-full bg-brand-primary -z-10"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dynamic Category Editorial Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 text-right">
        <div className="flex flex-row justify-between items-center gap-4 border-b border-border-delicate pb-3">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-display font-bold text-brand-primary flex items-center gap-3">
              <span className="w-1.5 h-6 bg-brand-gold rounded-full" />
              {selectedCategory === "الكل" ? tr('جميع المأكولات والأصناف', 'All menu items') : localizeCategory(selectedCategory, language)}
            </h2>
          </div>
          <span className="text-xs font-bold text-text-muted whitespace-nowrap">
            {filteredMenuItems.length} {tr('أصناف متوفرة', 'items available')}
          </span>
        </div>
      </div>

      {/* Menu Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-5 sm:py-8 text-right">
        {filteredMenuItems.length === 0 ? (
          <div className="text-center py-24 sm:py-32 border border-dashed border-border-delicate bg-white">
            <p className="font-display italic text-2xl text-brand-gold opacity-40">
              {tr('لا توجد أطباق متوفرة في هذا القسم حالياً.', 'No dishes are available in this category yet.')}
            </p>
          </div>
        ) : (
          <div className="menu-preview-grid grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {filteredMenuItems.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(idx * 0.05, 0.4) }}
                className="menu-preview-card group flex flex-col justify-between h-full bg-bg-card border border-border-delicate rounded-2xl hover:border-brand-gold transition-colors overflow-hidden shadow-sm"
              >
                <div>
                  <div className="aspect-[16/10] overflow-hidden relative">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                        alt={item.name}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full bg-bg-paper flex items-center justify-center text-border-delicate text-xs italic">
                        {tr('صورة الوجبة', 'Dish image')}
                      </div>
                    )}
                    {item.isAvailable === false && (
                      <div className="absolute inset-0 bg-white/70 backdrop-blur-[1.5px] z-10 flex items-center justify-center">
                        <span className="bg-red-600 text-white text-[10px] sm:text-xs py-1.5 px-3 font-bold uppercase tracking-wider shadow">
                          {tr('غير متاح حالياً', 'Unavailable')} 🚫
                        </span>
                      </div>
                    )}
                    {item.isSpicy && (
                      <div className="absolute top-2 right-2 bg-brand-primary/80 backdrop-blur-sm text-white text-[8px] sm:text-[9px] py-1 px-2 font-bold uppercase tracking-wider z-20">
                        🔥 {tr('حار', 'Spicy')}
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-2 text-right">
                    {item.category && (
                      <p className="text-[8px] sm:text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                        {localizeCategory(item.category, language)}
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-baseline gap-1">
                      <h3 className="font-display text-sm sm:text-base font-bold text-brand-primary leading-tight">
                        {item.name}
                      </h3>
                      <p className="font-display text-xs sm:text-sm font-bold text-brand-gold">
                        <span className="font-sans">{item.price.toLocaleString()}</span>{" "}
                        <span className="text-[9px] opacity-70">{tr('د.ع', 'IQD')}</span>
                      </p>
                    </div>

                    <p className="text-text-muted text-[10px] sm:text-xs font-light leading-relaxed line-clamp-2">
                      {item.ingredients || tr('أجود المكونات الطازجة المحضّرة بحب وعناية.', 'Fresh ingredients, prepared with care.')}
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-0">
                  <div className="pt-2 sm:pt-3 border-t border-border-delicate/50 flex items-center justify-between gap-2">
                    {item.isAvailable === false ? (
                      <div className="w-full text-center bg-gray-100 border border-gray-200 text-gray-400 text-[10px] sm:text-xs font-bold py-2 px-3 cursor-not-allowed select-none">
                        {tr('غير متاح حالياً', 'Unavailable')} 🚫
                      </div>
                    ) : (item.hasCheese || item.isSpicy) ? (
                      <div className="space-y-2 w-full">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenCustomizer(item);
                          }}
                          className="w-full bg-brand-gold hover:bg-brand-gold/90 text-white text-[10px] sm:text-xs font-bold py-2.5 px-3 transition-all duration-300 text-center flex items-center justify-center gap-1.5 shadow-sm rounded-full transform hover:-translate-y-0.5 active:translate-y-0 text-right"
                        >
                          <Sparkles className="w-3.5 h-3.5 shrink-0" /> {tr('تخصيص وإضافة للسلة', 'Customize and add')} ➕
                        </button>
                        {getQuantityInCart(item.id) > 0 && (
                          <div className="text-center text-[9px] font-bold text-brand-primary bg-brand-primary/5 py-1 px-2 border border-brand-primary/10 rounded">
                            {tr(`تمت إضافة ${getQuantityInCart(item.id)} بالسلة بخيارات مختلفة`, `${getQuantityInCart(item.id)} added with selected options`)}
                          </div>
                        )}
                      </div>
                    ) : cart[item.id] ? (
                      <div className="flex items-center justify-between w-full bg-brand-primary text-white py-1.5 px-3 rounded-full text-xs font-bold transition-all">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromCart(item.id);
                          }}
                          className="hover:opacity-75 p-2 min-w-10 min-h-10 flex items-center justify-center"
                          aria-label={tr('تقليل الكمية', 'Decrease quantity')}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-sans font-bold w-6 text-center">
                          {cart[item.id]}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addToCart(item.id);
                          }}
                          className="hover:opacity-75 p-2 min-w-10 min-h-10 flex items-center justify-center"
                          aria-label={tr('زيادة الكمية', 'Increase quantity')}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addToCart(item.id);
                        }}
                        className="w-full min-h-11 bg-bg-paper hover:bg-brand-primary hover:text-white border border-border-delicate rounded-full text-text-muted hover:border-brand-primary text-xs font-bold py-2 px-3 transition-colors text-center flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" /> {tr('إضافة للسلة', 'Add to cart')}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Cart Summary (Floating Editorial) */}
      <AnimatePresence>
        {totalItems > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-0 sm:bottom-6 left-0 right-0 z-50 flex justify-center px-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-8 sm:pb-0"
          >
            <button
              onClick={() => setShowCart(true)}
              className="bg-brand-primary text-white py-3 px-5 sm:py-4 sm:px-8 rounded-2xl flex items-center justify-between gap-4 shadow-[0_12px_35px_rgba(0,0,0,0.25)] hover:bg-brand-secondary transition-colors w-full max-w-xl"
            >
              <div className="flex items-center gap-3 sm:gap-6">
                <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                <div className="text-right">
                  <p className="text-base font-bold leading-none">
                    {tr('عرض السلة', 'View cart')} · {totalItems}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 sm:gap-6">
                <span className="text-sm sm:text-lg font-bold whitespace-nowrap">
                  {totalPrice.toLocaleString()} IQD
                </span>
                <div className="bg-white/20 p-1.5 sm:p-2 rounded-full shrink-0">
                  <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cart Overlay (Editorial Pane) */}
      <AnimatePresence>
        {showCart && (
          <div className="fixed inset-0 z-[60] flex items-center justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCart(false)}
              className="absolute inset-0 bg-brand-primary/25 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 35, stiffness: 300 }}
              className="bg-white w-full max-w-md h-full relative flex flex-col p-6 sm:p-10 shadow-2xl border-l border-border-delicate overflow-hidden text-right"
              dir={dir}
            >
              {/* Texture Overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

              {/* Drawer Header */}
              <div className="flex justify-between items-center mb-6 sm:mb-8 relative border-b border-border-delicate pb-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-display font-black text-brand-primary leading-none">
                    {tr('سلة المشتريات', 'Your cart')}
                  </h2>
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest mt-2">
                     {tr('الوجبات التي قمت باختيارها', 'Selected dishes')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCart(false)}
                  className="px-4 py-2 border border-border-delicate hover:bg-bg-paper text-brand-primary hover:text-brand-secondary transition-all text-xs font-bold"
                >
                  {tr('إغلاق السلة', 'Close cart')}
                </button>
              </div>

              {/* Scrollable Contents */}
              <div className="flex-1 overflow-y-auto space-y-8 no-scrollbar relative">
                {Object.keys(cart).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-bg-paper border border-border-delicate flex items-center justify-center text-brand-gold">
                      <ShoppingBag className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-bold text-brand-primary">{tr('سلتك لا تزال فارغة', 'Your cart is empty')}</p>
                      <p className="text-xs text-text-muted max-w-[240px] leading-relaxed">
                        {tr('اختر من بين تشكيلة أطباقنا الشهية لتضيفها إلى سلتك وتستمتع بمذاق مميز.', 'Choose dishes from the menu to add them to your cart.')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      {Object.entries(cart).map(([cartKey, qty]) => {
                        const { itemId, cheeseSelected, spicySelected } = parseCartKey(cartKey);
                        const item = menuItems.find((i) => i.id === itemId);
                        if (!item) return null;
                        
                        const itemPrice = item.price + 
                          (cheeseSelected ? (item.cheesePrice || 0) : 0) + 
                          (spicySelected ? (item.spicyPrice || 0) : 0);
                        
                        return (
                          <div 
                            key={cartKey} 
                            className="flex gap-4 items-center bg-bg-paper border border-border-delicate p-3 hover:border-brand-gold transition-colors duration-300 text-right"
                          >
                            <div className="w-16 h-16 bg-white border border-border-delicate shrink-0 overflow-hidden flex items-center justify-center">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                  referrerPolicy="no-referrer"
                                  alt={item.name}
                                />
                              ) : (
                                <Utensils className="w-5 h-5 text-brand-gold/30" />
                              )}
                            </div>
                            <div className="flex-1 space-y-1">
                              <h4 className="font-display text-sm font-bold text-brand-primary leading-tight">
                                {item.name}
                              </h4>
                              {(cheeseSelected || spicySelected) && (
                                <div className="text-[10px] text-brand-gold font-bold flex gap-1 justify-end flex-wrap">
                                  <span>✨ {tr('خيارات:', 'Options:')}</span>
                                  <span>{[
                                    cheeseSelected ? tr('جبن 🧀', 'Cheese 🧀') : null,
                                    spicySelected ? tr('سبايسي 🌶️', 'Spicy 🌶️') : null
                                  ].filter(Boolean).join(" + ")}</span>
                                </div>
                              )}
                              <p className="text-xs text-brand-gold font-bold">
                                {itemPrice.toLocaleString()} <span className="text-[10px] opacity-70">{tr('د.ع', 'IQD')}</span>
                              </p>
                            </div>
                            <div className="flex items-center gap-3 bg-white border border-border-delicate rounded-full py-1 px-3">
                              <button
                                type="button"
                                onClick={() => removeFromCart(cartKey)}
                                className="text-text-muted hover:text-brand-primary transition-colors p-1"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="font-mono font-bold text-xs text-brand-primary w-4 text-center">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => addToCart(cartKey)}
                                className="text-text-muted hover:text-brand-primary transition-colors p-1"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-6 border-t border-border-delicate space-y-6 pb-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          {tr('اسم الزبون الكريم', 'Your name')}
                        </label>
                        <input
                          required
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          type="text"
                          placeholder={tr('الرجاء إدخال الاسم الكامل', 'Enter your full name')}
                          className="w-full bg-bg-paper border border-border-delicate py-3 px-4 focus:outline-none focus:border-brand-primary transition-all text-sm text-brand-primary text-right font-bold focus:bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          {tr('رقم الطاولة المخصصة', 'Table number')}
                        </label>
                        <input
                          required
                          value={tableNumber}
                          onChange={(e) => setTableNumber(e.target.value)}
                          type="text"
                          placeholder={tr('أدخل رقم طاولة جلوسك', 'Enter your table number')}
                          className="w-full bg-bg-paper border border-border-delicate py-3 px-4 focus:outline-none focus:border-brand-primary transition-all text-sm text-brand-primary text-right font-bold focus:bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          {tr('رغبات أو توجيهات خاصة بالطلب', 'Special instructions')}
                        </label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={tr('مثال: بدون بصل، صوص خارجي، درجة الاستواء...', 'Example: no onion, extra sauce...')}
                          className="w-full bg-bg-paper border border-border-delicate p-4 rounded-none focus:outline-none focus:border-brand-primary transition-all text-xs h-24 resize-none leading-relaxed text-right font-bold focus:bg-white"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Subtotal & Checkout Button */}
              {Object.keys(cart).length > 0 && (
                <div className="pt-4 border-t border-border-delicate relative bg-white">
                  <div className="flex justify-between items-baseline mb-6 bg-bg-paper border border-border-delicate p-4">
                    <span className="text-xs font-bold text-brand-primary uppercase tracking-widest">
                      {tr('المجموع الإجمالي للوجبات', 'Order total')}
                    </span>
                    <span className="text-xl sm:text-2xl font-sans text-brand-primary font-black">
                      {totalPrice.toLocaleString()} <span className="text-xs font-bold">{tr('د.ع', 'IQD')}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePlaceOrder}
                    disabled={submittingOrder}
                    className="w-full py-4 bg-brand-primary text-white font-bold hover:bg-brand-secondary transition-all text-xs sm:text-sm tracking-widest text-center shadow-md uppercase disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submittingOrder ? tr('جاري إرسال الطلب...', 'Sending order...') : tr('إرسال الطلب للمطبخ والويترز', 'Send order to kitchen and waiters')}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Chat Drawer (Editorial) */}
      <AnimatePresence>
        {showAIChat && (
          <div className="fixed inset-0 z-[70] flex items-center justify-start">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAIChat(false)}
              className="absolute inset-0 bg-brand-primary/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 35, stiffness: 300 }}
              className="bg-white w-full max-w-md h-full relative flex flex-col p-6 sm:p-12 shadow-2xl border-r border-border-delicate overflow-hidden"
            >
              <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

              <div className="flex justify-between items-center mb-8 sm:mb-16 relative">
                <div>
                  <h2 className="text-4xl font-display text-brand-primary leading-none">
                    {tr('المنسق', 'Assistant')}
                  </h2>
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest mt-3">
                     {tr('المساعد الذكي لتنسيق طعامك', 'Your menu assistant')}
                  </p>
                </div>
                <button
                  onClick={() => setShowAIChat(false)}
                  className="text-text-muted hover:text-brand-primary font-bold"
                >
                  {tr('إغلاق', 'Close')}
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto space-y-12 no-scrollbar px-2 relative"
              >
                <div className="bg-bg-paper p-8 rounded-[1.5rem] border border-border-delicate italic text-text-muted text-sm leading-relaxed shadow-sm">
                  {tr('أهلاً بك. أنا منسقك الشخصي في', 'Welcome! I am your menu assistant at')} {restaurant?.restaurantName}.{" "}
                  <br /> <br />
                  {tr('نحن فخورون بتقديم قائمة طعام متنوعة. هل يمكنني مساعدتك في العثور على ما يناسب ذوقك اليوم؟', 'Can I help you find something you will enjoy today?')}
                </div>

                {messages.map((m, i) => (
                  <motion.div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] p-6 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                        m.role === "user"
                          ? "bg-brand-primary text-white"
                          : "bg-bg-paper border border-border-delicate text-text-main italic"
                      }`}
                    >
                      {cleanMessageText(m.text)}
                    </div>
                  </motion.div>
                ))}

                {aiLoading && (
                  <div className="text-[11px] text-text-muted animate-pulse font-bold">
                    {tr('جاري معالجة الرد ومساعدتك...', 'Thinking...')}
                  </div>
                )}
              </div>

              <div className="pt-10 relative">
                <div className="flex bg-bg-paper border border-border-delicate p-2 rounded-full focus-within:border-brand-primary transition-all">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAISend()}
                    placeholder={tr('كيف يمكنني مساعدتك؟', 'How can I help you?')}
                    className="flex-1 bg-transparent px-6 py-4 text-sm focus:outline-none placeholder:text-text-muted/50"
                  />
                  <button
                    onClick={handleAISend}
                    disabled={!inputMessage.trim() || aiLoading}
                    className="w-12 h-12 bg-brand-primary text-white rounded-full flex items-center justify-center disabled:opacity-30"
                  >
                    <Send className="w-5 h-5 rotate-[180deg]" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-time Order Tracking Modal */}
      <AnimatePresence>
        {showOrderTrackingModal && orderComplete && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white w-full max-w-lg p-6 sm:p-10 rounded-[2rem] shadow-[0_24px_70px_rgba(45,58,39,0.15)] space-y-6 text-center border border-border-delicate relative my-8 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="absolute inset-0 pointer-events-none opacity-[0.02] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

              {/* Scrollable Container inside modal */}
              <div className="overflow-y-auto space-y-6 flex-1 pr-1 pl-1 py-1 no-scrollbar text-right">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 bg-brand-primary/5 text-brand-primary rounded-full flex items-center justify-center mx-auto border border-brand-primary/10">
                    <CheckCircle2 className="w-8 h-8 animate-bounce" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-display text-brand-primary tracking-tight">
                      {tr('حالة وتفاصيل طلبك النشط', 'Your active order')} ✨
                    </h1>
                    <p className="text-text-muted mt-1 text-sm font-medium">
                      {tr('رقم الطلب:', 'Order number:')}{" "}
                      {orderComplete.orderNumber ? (
                        <span className="font-sans font-bold text-brand-gold italic text-xl">
                          {orderComplete.orderNumber}
                        </span>
                      ) : (
                        <span className="font-sans font-bold text-brand-gold italic text-lg">
                          #{orderComplete.id.slice(-6).toUpperCase()}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="bg-bg-paper/50 p-6 rounded-2xl text-right space-y-4 border border-border-delicate shadow-inner relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-2 h-full bg-brand-gold opacity-30" />
                  <p className="text-xs font-bold flex justify-between text-text-muted uppercase tracking-widest">
                    {tr('الاسم:', 'Name:')}{" "}
                    <span className="text-text-main">
                      {orderComplete.customerName || tr('زبون مجهول', 'Guest')}
                    </span>
                  </p>
                  <p className="text-xs font-bold flex justify-between text-text-muted uppercase tracking-widest">
                    {tr('الطاولة:', 'Table:')}{" "}
                    <span className="text-text-main">
                      {orderComplete.tableNumber || tr('غير محددة', 'Not specified')}
                    </span>
                  </p>
                  <div className="pt-4 border-t border-border-delicate space-y-2">
                    {orderComplete.items && orderComplete.items.length > 0 ? (
                      orderComplete.items.map((item, i) => (
                        <p
                          key={i}
                          className="text-xs text-text-muted py-0.5 flex justify-between font-medium"
                        >
                          <span>
                            {item.name} x{item.quantity}
                          </span>
                          <span className="font-bold text-text-main">
                            {(item.price * item.quantity).toLocaleString()} IQD
                          </span>
                        </p>
                      ))
                    ) : (
                      <p className="text-xs text-text-muted italic text-center">{tr('جاري جلب تفاصيل المواد من السيرفر...', 'Loading order details...')}</p>
                    )}
                  </div>
                  <p className="pt-4 font-display text-brand-primary flex justify-between border-t border-border-delicate text-lg italic">
                    {tr('المجموع الكلي:', 'Total:')}{" "}
                    <span>{(orderComplete.totalAmount || 0).toLocaleString()} IQD</span>
                  </p>
                </div>

                {/* Real-time Order Status Live Road */}
                <div className="bg-bg-paper p-5 rounded-2xl border border-border-delicate text-right space-y-3">
                  <h4 className="text-xs font-bold text-brand-gold uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                    {tr('تتبع حالة طلبك المباشرة', 'Live order status')}
                  </h4>

                  {orderComplete.status === "rejected" ? (
                    <div className="p-3 bg-red-50 border border-red-100 rounded text-red-700 text-xs">
                      <p className="font-bold underline">⚠️ {tr('تم إلغاء / رفض هذا الطلب:', 'This order was cancelled or rejected:')}</p>
                      <p className="mt-1">{orderComplete.rejectionReason || tr('تواصل مع كابتن الصالة لمعرفة السبب.', 'Ask a waiter for details.')}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1 relative mt-1 pt-1">
                      {/* Visual Line Background Tracks Wrapper */}
                      <div className="absolute top-4 left-10 right-10 h-1 -z-0">
                        {/* Gray Background Track */}
                        <div className="absolute inset-0 bg-border-delicate" />
                        {/* Golden Active Track */}
                        <div 
                          className="absolute top-0 right-0 h-full bg-brand-gold transition-all duration-500" 
                          style={{
                            width: orderComplete.status === "pending" 
                              ? "0%" 
                              : orderComplete.status === "preparing" 
                                ? "50%" 
                                : "100%"
                          }}
                        />
                      </div>

                      {/* Step 1: Pending */}
                      <div className="flex flex-col items-center text-center relative z-10">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          orderComplete.status === "pending" 
                            ? "bg-brand-primary text-white scale-110 shadow-lg" 
                            : "bg-brand-gold text-white"
                        }`}>
                          <span className="text-[9px] font-bold">1</span>
                        </div>
                        <span className={`text-[8px] font-bold mt-1 leading-tight ${orderComplete.status === "pending" ? "text-brand-primary" : "text-text-muted"}`}>
                          {tr('موافقة الكابتن', 'Confirmed')}
                        </span>
                      </div>

                      {/* Step 2: Preparing */}
                      <div className="flex flex-col items-center text-center relative z-10">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          orderComplete.status === "preparing" 
                            ? "bg-brand-primary text-white scale-110 shadow-lg animate-pulse" 
                            : (orderComplete.status === "ready" || orderComplete.status === "served")
                              ? "bg-brand-gold text-white" 
                              : "bg-border-delicate text-text-muted"
                        }`}>
                          <span className="text-[9px] font-bold">2</span>
                        </div>
                        <span className={`text-[8px] font-bold mt-1 leading-tight ${orderComplete.status === "preparing" ? "text-brand-primary font-bold" : "text-text-muted"}`}>
                          {tr('قيد التحضير', 'Preparing')}
                        </span>
                      </div>

                      {/* Step 3: Ready */}
                      <div className="flex flex-col items-center text-center relative z-10">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          (orderComplete.status === "ready" || orderComplete.status === "served")
                            ? "bg-emerald-500 text-white scale-110 shadow-lg" 
                            : "bg-border-delicate text-text-muted"
                        }`}>
                          <span className="text-[9px] font-bold">3</span>
                        </div>
                        <span className={`text-[8px] font-bold mt-1 leading-tight ${
                          (orderComplete.status === "ready" || orderComplete.status === "served") ? "text-emerald-600 font-bold" : "text-text-muted"
                        }`}>
                          {tr('جاهز للتسليم', 'Ready')}
                        </span>
                      </div>
                    </div>
                  )}

                  {orderComplete.status === "ready" && (
                    <div className="mt-3 p-2 bg-emerald-50 border border-emerald-100 rounded text-emerald-800 text-[11px] font-bold text-center leading-relaxed">
                      🎉 {tr('وجبتك جاهزة للتسليم! سيوصلها كابتن الصالة إلى طاولتك الآن!', 'Your order is ready. A waiter will bring it to your table shortly!')}
                    </div>
                  )}
                  {orderComplete.status === "served" && (
                    <div className="mt-3 p-2 bg-brand-primary/5 border border-brand-primary/10 rounded text-brand-primary text-[11px] font-bold text-center leading-relaxed font-display">
                      🍽️ {tr('تم تقديم الوجبة لك بنجاح، نتمنى لك وقتاً طيباً ووجبة شهية ممتعة!', 'Your order has been served. Enjoy your meal!')}
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-text-muted uppercase tracking-widest text-center leading-relaxed">
                  {tr('الضيافة الرفيعة هي رحلة في عوالم النكهات.', 'Great hospitality begins with good food.')} <br /> {tr('جاري تحضير وجبتك بكل حب وعناية.', 'Your order is being prepared with care.')}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-border-delicate">
                <button
                  onClick={() => {
                    if (orderComplete.status === 'served' || orderComplete.status === 'rejected') {
                      try {
                        localStorage.removeItem("novix_active_order_id");
                      } catch (e) {
                        console.error(e);
                      }
                      setOrderComplete(null);
                    }
                    setShowOrderTrackingModal(false);
                  }}
                  className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold shadow-xl shadow-brand-primary/10 hover:bg-brand-secondary transition-all text-xs"
                >
                  {orderComplete.status === 'served' || orderComplete.status === 'rejected' ? tr('موافق وبدء طلب جديد 🍽️', 'Done — start a new order 🍽️') : tr('متابعة التصفح بالخلفية 🥣', 'Continue browsing 🥣')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Customizer Modal */}
      <AnimatePresence>
        {showCustomizer.open && showCustomizer.item && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[1200] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white max-w-md w-full p-6 sm:p-8 border border-border-delicate relative text-right rounded shadow-2xl z-10"
              dir={dir}
            >
              <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
              <div className="flex justify-between items-start mb-6 w-full">
                <div className="space-y-1">
                  <span className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block font-sans">{tr('خيارات وتخصيص الوجبة', 'Customize your dish')}</span>
                  <h3 className="text-xl font-display font-bold text-brand-primary font-sans">{showCustomizer.item.name}</h3>
                </div>
                <button
                  onClick={() => setShowCustomizer({ open: false, item: null })}
                  className="text-text-muted hover:text-brand-primary transition-colors text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-6">
                {/* معلومات الوجبة */}
                <div className="bg-bg-paper p-4 border border-border-delicate flex gap-4 items-center">
                  <div className="w-16 h-16 shrink-0 bg-white border border-border-delicate overflow-hidden flex items-center justify-center rounded">
                    {showCustomizer.item.imageUrl ? (
                      <img
                        src={showCustomizer.item.imageUrl}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        alt={showCustomizer.item.name}
                      />
                    ) : (
                      <Utensils className="w-6 h-6 text-brand-gold/30" />
                    )}
                  </div>
                  <div className="space-y-0.5 text-right flex-1">
                    <p className="text-xs text-text-muted leading-relaxed line-clamp-2">{showCustomizer.item.ingredients || tr('طعم لذيذ ومكونات طازجة.', 'Fresh ingredients, delicious flavor.')}</p>
                    <p className="text-sm font-bold text-brand-primary font-mono mt-1">
                      {tr('السعر الأساسي:', 'Base price:')} {showCustomizer.item.price.toLocaleString()} {tr('د.ع', 'IQD')}
                    </p>
                  </div>
                </div>

                {/* خيارات التخصيص المتوفرة */}
                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border-delicate pb-2 font-sans">{tr('اختر خيارات وعناصر الإضافة المتاحة:', 'Available options:')}</p>

                  {showCustomizer.item.hasCheese && (
                    <div 
                      onClick={() => setCustCheese(!custCheese)}
                      className={`flex justify-between items-center p-4 border cursor-pointer transition-all duration-300 ${custCheese ? "border-brand-gold bg-brand-gold/5" : "border-border-delicate bg-white hover:border-brand-gold/50"}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 border flex items-center justify-center rounded transition-all ${custCheese ? "bg-brand-gold border-brand-gold text-white" : "border-border-delicate bg-white"}`}>
                          {custCheese && <span className="text-xs">✕</span>}
                        </div>
                        <span className="text-sm font-bold text-brand-primary font-sans">{tr('إضافة الجبن الإضافي', 'Extra cheese')} 🧀</span>
                      </div>
                      <span className="text-xs font-bold text-brand-gold font-mono">+{showCustomizer.item.cheesePrice ? showCustomizer.item.cheesePrice.toLocaleString() : "0"} {tr('د.ع', 'IQD')}</span>
                    </div>
                  )}

                  {showCustomizer.item.isSpicy && (
                    <div 
                      onClick={() => setCustSpicy(!custSpicy)}
                      className={`flex justify-between items-center p-4 border cursor-pointer transition-all duration-300 ${custSpicy ? "border-brand-primary bg-brand-primary/5" : "border-border-delicate bg-white hover:border-brand-primary/50"}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 border flex items-center justify-center rounded transition-all ${custSpicy ? "bg-brand-primary border-brand-primary text-white" : "border-border-delicate bg-white"}`}>
                          {custSpicy && <span className="text-xs">✕</span>}
                        </div>
                        <span className="text-sm font-bold text-brand-primary font-sans">{tr('خيار سبايسي (حار)', 'Spicy option')} 🌶️</span>
                      </div>
                      <span className="text-xs font-bold text-brand-primary font-mono">+{showCustomizer.item.spicyPrice ? showCustomizer.item.spicyPrice.toLocaleString() : "0"} {tr('د.ع', 'IQD')}</span>
                    </div>
                  )}

                  {!showCustomizer.item.hasCheese && !showCustomizer.item.isSpicy && (
                    <p className="text-xs text-text-muted font-sans">{tr('لا تتوفر إضافات مخصصة لهذا الصنف، سيقدم كـ عادي.', 'No custom options are available for this item.')}</p>
                  )}
                </div>

                {/* المجموع الكلي */}
                <div className="bg-brand-primary/5 p-4 border border-brand-primary/10 flex justify-between items-center">
                  <span className="text-xs font-bold text-brand-primary font-sans">{tr('المجموع بعد التخصيص:', 'Customized total:')}</span>
                  <span className="text-base font-bold text-brand-primary font-mono">
                    {(showCustomizer.item.price + 
                      (custCheese ? (showCustomizer.item.cheesePrice || 0) : 0) + 
                      (custSpicy ? (showCustomizer.item.spicyPrice || 0) : 0)
                    ).toLocaleString()} {tr('د.ع', 'IQD')}
                  </span>
                </div>

                {/* أزرار الحفظ والالتزام */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleAddCustomizedToCart}
                    className="flex-1 py-3 bg-brand-primary text-white text-xs font-bold uppercase tracking-wider hover:bg-brand-secondary transition-colors font-sans"
                  >
                    {tr('أضف للسلة', 'Add to cart')} 🛒
                  </button>
                  <button
                    onClick={() => setShowCustomizer({ open: false, item: null })}
                    className="px-6 py-3 border border-border-delicate text-xs font-bold text-text-muted hover:bg-bg-paper transition-colors font-sans"
                  >
                    {tr('إلغاء', 'Cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Waiter Call Modal / Dialog */}
      <AnimatePresence>
        {showWaiterModal && (
          <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWaiterModal(false)}
              className="absolute inset-0 bg-brand-primary/30 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="bg-white w-full max-w-md p-6 sm:p-10 relative shadow-2xl border border-border-delicate rounded-sm text-right font-sans z-10"
              dir={dir}
            >
              {/* Top border accent */}
              <div className="absolute top-0 right-0 left-0 h-1.5 bg-brand-gold" />

              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-brand-primary/5 text-brand-gold rounded-full flex items-center justify-center">
                    <Bell className="w-5 h-5 animate-bounce" />
                  </div>
                  <h3 className="text-xl font-display text-brand-primary font-bold">
                    {tr('نداء نادل الخدمة (الويتر)', 'Call a waiter')}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWaiterModal(false)}
                  className="text-text-muted hover:text-brand-primary text-xs font-bold"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {waiterCallSuccess ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="py-12 text-center space-y-4"
                >
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto border border-emerald-100">
                    <Check className="w-8 h-8 font-bold" />
                  </div>
                  <h4 className="text-xl font-bold text-brand-primary">{tr('تم إرسال النداء بنجاح!', 'Request sent!')}</h4>
                  <p className="text-xs text-text-muted">
                    {tr(`تم إشعار الويترز بطاولتك (طاولة ${tableNumber}). سيحضر إليك أحد الموظفين فوراً لتلبية طلبك.`, `A waiter has been notified for table ${tableNumber} and will be with you shortly.`)}
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleWaiterCallSubmit} className="space-y-6">
                  <p className="text-xs text-text-muted leading-relaxed">
                    {tr('يرجى ملء الاسم ورقم الطاولة لتحديد مكان جلوسك بدقة وتأكيد احتياجك السريع للنداء.', 'Enter your name, table number, and what you need so staff can find you quickly.')}
                  </p>

                  <div className="space-y-4">
                    {/* User Name */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-gold uppercase tracking-wider">{tr('الاسم بالكامل', 'Full name')}</label>
                      <input
                        type="text"
                        required
                        placeholder={tr('أدخل اسمك هنا', 'Enter your name')}
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-bold focus:outline-none focus:border-brand-primary focus:bg-white text-right"
                      />
                    </div>

                    {/* Table Number */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-gold uppercase tracking-wider">{tr('رقم الطاولة', 'Table number')}</label>
                      <input
                        type="text"
                        required
                        placeholder={tr('أدخل رقم طاولتك', 'Enter your table number')}
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-bold focus:outline-none focus:border-brand-primary focus:bg-white text-right font-mono"
                      />
                    </div>

                    {/* Call Reason / Need */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-gold uppercase tracking-wider">{tr('ما هو احتياجك؟ المختصر', 'How can we help?')}</label>
                      <input
                        type="text"
                        required
                        placeholder={tr('مثال: دفع الحساب، استفسار عن طبق، شوكة إضافية...', 'Example: bill, question, extra cutlery...')}
                        value={waiterCallReason}
                        onChange={(e) => setWaiterCallReason(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-bold focus:outline-none focus:border-brand-primary focus:bg-white text-right"
                      />
                    </div>

                    {/* Quick Suggestions template */}
                    <div className="space-y-1.5">
                      <label className="block text-[9px] font-bold text-text-muted uppercase tracking-wider">{tr('خيارات سريعة شائعة:', 'Quick options:')}</label>
                      <div className="flex flex-wrap gap-2 justify-start">
                        {[
                          tr('دفع وتصفية الـفـاتـورة 💳', 'Pay the bill 💳'),
                          tr('استفسار بخصوص وجبة طعام 🍽️', 'Question about a dish 🍽️'),
                          tr('طلب نادل على الطاولة 🧑‍🍳', 'Waiter at the table 🧑‍🍳'),
                          tr('طلب ماء / مناديل إضافية 🥤', 'Water or napkins 🥤'),
                        ].map((suggestion, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setWaiterCallReason(suggestion)}
                            className="bg-slate-50 hover:bg-brand-primary/10 hover:border-brand-primary/20 text-text-main text-[11px] px-3 py-1.5 border border-border-delicate rounded transition-all font-medium"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex gap-4">
                    <button
                      type="submit"
                      disabled={submittingWaiterCall}
                      className="flex-1 py-3.5 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all flex items-center justify-center gap-2"
                    >
                      {submittingWaiterCall ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          {tr('جاري إرسال النداء...', 'Sending request...')}
                        </>
                      ) : (
                        tr('تأكيد وإرسال نداء الويتر 🔔', 'Send waiter request 🔔')
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWaiterModal(false)}
                      className="px-5 py-3.5 border border-border-delicate hover:bg-slate-50 text-text-muted text-[11px] font-bold uppercase tracking-widest transition-all"
                    >
                      {tr('إلغاء', 'Cancel')}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
