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
  runTransaction,
  Timestamp,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { handleFirestoreError, OperationType } from "../lib/firestore-utils";
import { Restaurant, MenuItem, Order, OrderItem } from "../types";
import { chatWithAI } from "../lib/gemini";

interface CustomerMenuProps {
  restaurantId: string;
}

export default function CustomerMenu({ restaurantId }: CustomerMenuProps) {
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
    const unsub = onSnapshot(
      doc(db, "orders", orderComplete.id),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data && data.status === "served") {
            try {
              localStorage.removeItem("novix_active_order_id");
            } catch (e) {
              console.error(e);
            }
          }
          setOrderComplete({ id: snap.id, ...data } as Order);
        } else {
          try {
            localStorage.removeItem("novix_active_order_id");
          } catch (e) {
            console.error(e);
          }
          setOrderComplete(null);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `orders/${orderComplete.id}`);
      }
    );
    return () => unsub();
  }, [orderComplete?.id]);

  // Waiter Call States
  const [showWaiterModal, setShowWaiterModal] = useState(false);
  const [waiterCallReason, setWaiterCallReason] = useState("");
  const [submittingWaiterCall, setSubmittingWaiterCall] = useState(false);
  const [waiterCallSuccess, setWaiterCallSuccess] = useState(false);

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
  const [computedDistance, setComputedDistance] = useState<number | null>(null);
  const [verifyingLocation, setVerifyingLocation] = useState(false);
  const [bypassGeofence, setBypassGeofence] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState("");

  // Distance calculator helper (Haversine Formula)
  const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) *
        Math.cos(phi2) *
        Math.sin(deltaLambda / 2) *
        Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

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

      await addDoc(collection(db, "security_alerts"), alertData);
    } catch (e) {
      console.error("Failed to log security alert:", e);
    }
  };

  const checkCustomerLocation = (latitude: number, longitude: number, restLat: number, restLng: number) => {
    const distance = getDistanceInMeters(latitude, longitude, restLat, restLng);
    setComputedDistance(distance);
    setCustomerCoords({ lat: latitude, lng: longitude });

    // Allow browsing even if they are far away (non-blocking)
    setIsLocationVerified(true);
    localStorage.setItem("verified_inside_restaurant", "true");

    if (distance > 150) {
      logSecurityAlert(
        "outside_range",
        `زبون يتصفح وهو خارج المطعم بمسافة ${Math.round(distance)} متر`,
        "warning",
        { lat: latitude, lng: longitude },
        distance
      );
    }
  };

  const verifyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("متصفحك لا يدعم نظام تحديد المواقع الجغرافي (GPS)");
      setIsLocationVerified(false);
      logSecurityAlert("failed_location", "متصفح الزائر لا يدعم الحصاد الجغرافي GPS", "warning");
      return;
    }

    setVerifyingLocation(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setVerifyingLocation(false);
        const { latitude, longitude } = position.coords;
        // Default coordinate Al-Mansour, Baghdad if not set in DB
        const restLat = (restaurant as any)?.latitude || 33.3250;
        const restLng = (restaurant as any)?.longitude || 44.3400;

        checkCustomerLocation(latitude, longitude, restLat, restLng);
      },
      (error) => {
        setVerifyingLocation(false);
        console.error("Geolocation error:", error);
        let errorMsg = "يرجى السماح بمشاركة الموقع لنتأكد من طلبك من داخل صالة المطعم بسلام وأمان.";
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = "العفو! لقد قمت برفض الإذن. الرجاء تعديل إعدادات الخصوصية في متصفحك لتتمكن من تقديم الطلب.";
        }
        setLocationError(errorMsg);
        setIsLocationVerified(false);
        logSecurityAlert("failed_location", `رفض مشاركة الموقع الجغرافي (رمز الخطأ: ${error.code})`, "warning");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  useEffect(() => {
    // If they were validated in this browser previously, allow it
    if (localStorage.getItem("verified_inside_restaurant") === "true") {
      setIsLocationVerified(true);
    }

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

      const resPath = `restaurants/${restaurantId}`;
      const resDoc = await getDoc(doc(db, "restaurants", restaurantId));
      if (resDoc.exists()) {
        const rData = { id: resDoc.id, ...resDoc.data() } as Restaurant;
        setRestaurant(rData);
        try {
          localStorage.setItem(`novix_customer_restaurant_${restaurantId}`, JSON.stringify(rData));
        } catch (_) {}
        if (rData.endDate) {
          const expiryTime = new Date(rData.endDate).getTime();
          const now = new Date().getTime();
          if (now >= expiryTime) {
            setIsExpired(true);
          }
        }
      }

      // Check if current fingerprint is banned
      const currentFingerprint = getDeviceFingerprint();
      const bannedQuery = query(
        collection(db, "banned_devices"),
        where("restaurantId", "==", restaurantId),
        where("fingerprint", "==", currentFingerprint)
      );
      const bannedSnap = await getDocs(bannedQuery);
      if (!bannedSnap.empty) {
        const banDetails = bannedSnap.docs[0].data();
        setIsBanned(true);
        setBanReason(banDetails.reason || "مخالفة شروط وسياسات استخدام الصالة");
      }

      const menuPath = "menuItems";
      const menuSnap = await getDocs(
        query(
          collection(db, menuPath),
          where("restaurantId", "==", restaurantId),
        ),
      );
      const itemsList = menuSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem);
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

  const handleWaiterCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !tableNumber.trim() || !waiterCallReason.trim()) {
      alert("الرجاء ملء جميع الحقول المطلوبة.");
      return;
    }

    setSubmittingWaiterCall(true);
    try {
      await addDoc(collection(db, "waiter_requests"), {
        restaurantId,
        customerName: customerName.trim(),
        tableNumber: tableNumber.trim(),
        reason: waiterCallReason.trim(),
        status: "pending",
        createdAt: Date.now(),
        coordinates: customerCoords,
        distanceMeters: computedDistance
      });
      setWaiterCallSuccess(true);
      setWaiterCallReason("");
      setTimeout(() => {
        setWaiterCallSuccess(false);
        setShowWaiterModal(false);
      }, 3000);
    } catch (err) {
      console.error("Error submitting waiter call:", err);
      alert("لم نتمكن من إرسال الطلب، يرجى المحاولة مرة أخرى.");
    } finally {
      setSubmittingWaiterCall(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!customerName || !tableNumber) {
      alert("الرجاء إدخال اسمك ورقم الطاولة");
      return;
    }

    const orderItems: OrderItem[] = Object.entries(cart).map(([cartKey, qty]) => {
      const { itemId, cheeseSelected, spicySelected } = parseCartKey(cartKey);
      const item = menuItems.find((i) => i.id === itemId)!;
      
      const extraList: string[] = [];
      if (cheeseSelected) extraList.push(`جبن (+${(item.cheesePrice || 0).toLocaleString()} د.ع)`);
      if (spicySelected) extraList.push(`سبايسي (+${(item.spicyPrice || 0).toLocaleString()} د.ع)`);
      
      const customizationText = extraList.length > 0 ? extraList.join(" + ") : "عادي";
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

    try {
      const resDocRef = doc(db, "restaurants", restaurantId);
      let orderNumber = 1;
      
      await runTransaction(db, async (transaction) => {
        const resSnap = await transaction.get(resDocRef);
        if (resSnap.exists()) {
          const curOrderNum = Number(resSnap.data().currentOrderNumber) || 0;
          orderNumber = curOrderNum + 1;
          transaction.update(resDocRef, { currentOrderNumber: orderNumber });
        }
      });

      const collectionPath = "orders";
      const orderData = {
        restaurantId,
        customerName,
        tableNumber,
        items: orderItems,
        totalAmount: totalPrice,
        status: "pending",
        notes,
        createdAt: Date.now(),
        orderNumber,
        clearedForStaff: false,
        deviceMetadata: {
          userAgent: navigator.userAgent,
          deviceType: getReadableDeviceType(navigator.userAgent),
          screenSize: `${window.innerWidth}x${window.innerHeight} px`,
          language: navigator.language || "ar",
          fingerprint: getDeviceFingerprint(),
          coordinates: customerCoords,
          distanceMeters: computedDistance,
        },
      };
      const docRef = await addDoc(collection(db, collectionPath), orderData);
      try {
        localStorage.setItem("novix_active_order_id", docRef.id);
      } catch (e) {
        console.error(e);
      }
      setOrderComplete({ id: docRef.id, ...orderData } as Order);
      setShowOrderTrackingModal(true);
      setCart({});
      setShowCart(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "orders");
      alert("فشل في إرسال الطلب. حاول مجدداً");
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

    if (orderItems.length === 0) {
      orderItems.push({
        id: "ai_custom_" + Date.now(),
        name: orderInfo.items.map((i) => `${i.name} (x${i.quantity})`).join(" + "),
        quantity: 1,
        price: 0,
      });
    }

    try {
      const resDocRef = doc(db, "restaurants", restaurantId);
      let orderNumber = 1;

      await runTransaction(db, async (transaction) => {
        const resSnap = await transaction.get(resDocRef);
        if (resSnap.exists()) {
          const curOrderNum = Number(resSnap.data().currentOrderNumber) || 0;
          orderNumber = curOrderNum + 1;
          transaction.update(resDocRef, { currentOrderNumber: orderNumber });
        }
      });

      const orderData = {
        restaurantId,
        customerName: orderInfo.customerName,
        tableNumber: orderInfo.tableNumber,
        items: orderItems,
        totalAmount: totalCalculatedPrice,
        status: "pending",
        notes: orderInfo.notes || "",
        createdAt: Date.now(),
        orderNumber,
        clearedForStaff: false,
        deviceMetadata: {
          userAgent: navigator.userAgent,
          deviceType: getReadableDeviceType(navigator.userAgent),
          screenSize: `${window.innerWidth}x${window.innerHeight} px`,
          language: navigator.language || "ar",
          fingerprint: getDeviceFingerprint(),
          coordinates: customerCoords,
          distanceMeters: computedDistance,
        },
      };

      const docRef = await addDoc(collection(db, "orders"), orderData);
      try {
        localStorage.setItem("novix_active_order_id", docRef.id);
      } catch (e) {
        console.error(e);
      }
      setOrderComplete({ id: docRef.id, ...orderData } as Order);
      setShowOrderTrackingModal(true);
      
      setCustomerName(orderInfo.customerName);
      setTableNumber(orderInfo.tableNumber);
      setNotes(orderInfo.notes || "");
      
      setCart({});
      setShowCart(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "orders");
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
      restaurant?.restaurantName || "مطعمنا",
      history,
      aiSettings
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
      <div className="min-h-screen bg-bg-paper flex items-center justify-center p-4 font-sans text-right" dir="rtl">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white w-full max-w-lg p-10 rounded-2xl shadow-xl border border-gray-200 text-center space-y-8"
        >
          <div className="w-20 h-20 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto border border-amber-100">
            <Utensils className="w-10 h-10" />
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-gray-800 font-display">عذراً، المنيو غير متاح حالياً</h1>
            <p className="text-sm text-text-muted leading-relaxed">
              المنيو الإلكتروني لهذا المطعم متوقف مؤقتاً وغير متاح للتصفح في الوقت الحالي. يرجى مراجعة إدارة المطعم لمزيد من التفاصيل.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isBanned) {
    return (
      <div className="min-h-screen bg-bg-paper flex items-center justify-center p-4 font-sans text-right" dir="rtl">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white w-full max-w-lg p-10 rounded-2xl shadow-xl border border-red-200 space-y-8"
        >
          <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-100">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-red-700 font-display">عذراً، لقد تم تقييد وصولك</h1>
            <p className="text-xs text-text-muted leading-relaxed">
              تم حظر هذا الجهاز من تصفح المنيو الإلكتروني أو تقديم طلبات جديدة من قبل إدارة المطعم.
            </p>
          </div>
          <div className="bg-red-50/50 p-6 rounded-xl border border-red-100 text-right space-y-2">
            <p className="text-[10px] font-bold text-red-800 uppercase tracking-widest leading-none">⚠️ سبب الحظر:</p>
            <p className="text-xs text-red-900 font-bold leading-relaxed">{banReason}</p>
          </div>
          <p className="text-[10.5px] text-text-muted">
            إذا كنت تعتقد أن هذا الإجراء تم بالخطأ، يرجى مراجعة كابتن الصالة أو مدير المطعم لتأكيد هويتك وتواجدك.
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
      className="min-h-screen bg-bg-paper font-sans pb-28 text-text-main selection:bg-brand-primary/10"
      dir="rtl"
    >
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="bg-amber-600 text-white text-xs py-2.5 px-4 text-center font-bold relative z-[110] flex items-center justify-center gap-2 border-b border-amber-700/50 shadow-inner" dir="rtl">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span>عيني زبائننا الكرام، جهازكم غير متصل بالإنترنت حالياً. لا تشيلون هم دقيقة، المنيو متوفر أوفلاين وسنحاول إعادة الاتصال تلقائياً لتحديث طلبكم فوراً!</span>
        </div>
      )}

      {/* Texture Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

      {/* --------------------------------------------------------- */}
      {/* SECURITY OUTSIDE-RANGE GEOFENCE OVERLAY */}
      {/* --------------------------------------------------------- */}
      {isLocationVerified !== true && !bypassGeofence && (
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-brand-primary/95 backdrop-blur-md z-[1000] flex items-center justify-center p-4 sm:p-6 text-right font-sans"
            dir="rtl"
          >
            <div className="bg-white border border-border-delicate p-6 sm:p-10 max-w-md w-full shadow-2xl space-y-8 relative">
              <div className="absolute top-0 right-0 left-0 h-1 bg-brand-gold animate-pulse" />
              
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-brand-primary/[0.03] text-brand-gold border border-border-delicate flex items-center justify-center mx-auto">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-display text-brand-primary tracking-tight">
                  نظام حماية صالة المطعم والأمن
                </h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  أهلاً بك عيني في {restaurant?.restaurantName || "مطعمنا"}! لإنتاج وخدمة ألذ المأكولات طازجة لزبائننا بالصالة، يرجى تفعيل الموقع للتأكد من تواجدك بالداخل وحماية طلبك من عابثي الخارج.
                </p>
              </div>

              {locationError ? (
                <div className="bg-red-50 text-red-800 border-r-4 border-r-red-600 p-4 rounded text-xs leading-relaxed space-y-2">
                  <p className="font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> تلميح أمني
                  </p>
                  <p>{locationError}</p>
                </div>
              ) : computedDistance !== null && computedDistance > 150 ? (
                <div className="bg-amber-50 text-amber-950 border-r-4 border-r-amber-500 p-4 rounded text-xs leading-relaxed space-y-2">
                  <p className="font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> خارج صالة المطعم الجغرافية!
                  </p>
                  <p>
                    أنت حالياً تبعد حوالي <strong className="text-amber-800">{Math.round(computedDistance)} متر</strong> خارج نطاق صالة الطعام. يمكنك الاستمرار بالطلب براحتك، وسنقوم بإشعار موظفينا بالمسافة.
                  </p>
                </div>
              ) : (
                <div className="bg-bg-paper p-4 rounded border border-border-delicate text-xs text-text-muted leading-relaxed flex items-center gap-3">
                  <MapPin className="text-brand-gold w-5 h-5 shrink-0" />
                  تحميل الموقع يساعدنا لتأكيد تواجد هاتفك داخل صالة ومقاعد المطعم وتوصيل الطعام لطاولتك بسرعة فائقة.
                </div>
              )}

              <div className="space-y-3 font-sans">
                <button
                  onClick={verifyLocation}
                  disabled={verifyingLocation}
                  className="w-full py-4 bg-brand-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-brand-secondary transition-all flex items-center justify-center gap-3 rounded-none"
                >
                  {verifyingLocation ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      جاري التحقق من موقعك الحالي...
                    </>
                  ) : (
                    <>
                      تحديد ومشاركة الموقع 📍
                    </>
                  )}
                </button>
                <button
                  onClick={() => setBypassGeofence(true)}
                  className="w-full py-3.5 border border-border-delicate hover:bg-slate-50 text-text-main text-[11px] font-bold uppercase tracking-widest transition-all text-center rounded-none"
                >
                  استمرار للطلب وعرض المنيو على أي حال 🍽️
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Header */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur-md border-b border-border-delicate px-4 sm:px-8 py-3.5 sm:py-5 flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="bg-white border border-border-delicate p-1 rounded-full shadow-sm">
            {restaurant?.logoUrl ? (
              <img
                src={restaurant.logoUrl}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-brand-primary/5 flex items-center justify-center">
                <Utensils className="text-brand-primary w-3.5 h-3.5 sm:w-5 sm:h-5" />
              </div>
            )}
          </div>
          <div>
            <h1 className="font-display text-lg sm:text-2xl text-brand-primary tracking-tight leading-none">
              {restaurant?.restaurantName}
            </h1>
            <p className="text-[7px] sm:text-[9px] text-brand-gold font-bold uppercase tracking-[0.3em] sm:tracking-[0.4em] mt-0.5 sm:mt-1.5">
              {restaurant?.province} — {restaurant?.area}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <button
            onClick={() => setShowWaiterModal(true)}
            className="relative flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-2 sm:py-2.5 bg-brand-primary text-white hover:bg-brand-secondary border border-transparent text-[10px] sm:text-xs font-bold rounded-full transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 hover:shadow-lg hover:shadow-brand-primary/20 group shrink-0"
          >
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-brand-gold group-hover:animate-bounce shrink-0" />
            <span className="shrink-0">
              طلب ويتر 🔔
            </span>
          </button>

          <button
            onClick={() => setShowAIChat(true)}
            className="relative flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-2 sm:py-2.5 bg-brand-gold text-white hover:bg-brand-gold/90 border border-transparent text-[10px] sm:text-xs font-bold rounded-full transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 hover:shadow-lg hover:shadow-brand-gold/20 group shrink-0"
          >
            <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-white"></span>
            </span>
            <span className="shrink-0 hidden sm:inline">
              اطلب بمساعدة الذكاء الاصطناعي ✨
            </span>
            <span className="shrink-0 sm:hidden">
              المساعد الذكي ✨
            </span>
            <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-40 px-6 sm:px-8 pb-12 relative overflow-hidden">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 flex flex-col items-center"
          >
            <div className="flex items-center justify-center gap-3">
              <span className="w-10 h-[1px] bg-brand-gold" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-brand-gold">
                أهلاً ومرحباً بكم في مطعمنا
              </span>
              <span className="w-10 h-[1px] bg-brand-gold" />
            </div>
            <h2 className="text-4xl md:text-7xl font-display text-brand-primary leading-[1.2] tracking-tight">
              صـحـة و <span className="italic text-brand-gold">عـافـيـة.</span>
            </h2>
            <p className="text-text-muted text-base max-w-xl leading-relaxed font-light mx-auto">
              نهتم بتقديم وجبات ومأكولات طازجة ومحضرة يومياً بأعلى درجات الجودة والنظافة لتنال رضاكم.
            </p>

            {/* Callouts Section: AI Assistant, Waiter Request, & Live Order Status Tracking */}
            <div className={`grid grid-cols-1 ${orderComplete ? 'lg:grid-cols-3 max-w-5xl' : 'md:grid-cols-2 max-w-3xl'} gap-4 w-full mt-6`}>
              {/* AI Assistant Callout Indicator */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowAIChat(true)}
                className="cursor-pointer flex items-center gap-4 p-5 bg-gradient-to-r from-brand-primary/5 via-brand-gold/5 to-brand-primary/5 hover:from-brand-primary/10 hover:to-brand-primary/10 border border-brand-gold/20 hover:border-brand-gold/40 rounded-2xl text-right transition-all duration-300 shadow-sm"
              >
                <div className="w-12 h-12 rounded-xl bg-brand-primary flex items-center justify-center text-brand-gold shadow-md shadow-brand-primary/10 shrink-0">
                  <Sparkles className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-0.5 flex-1 select-none">
                  <h4 className="text-sm font-bold text-brand-primary flex items-center gap-2">
                    اطلب الآن بالذكاء الاصطناعي ✨
                    <span className="text-[9px] bg-green-500/10 text-green-700 px-2 py-0.5 rounded-full font-bold shrink-0">نشط</span>
                  </h4>
                  <p className="text-xs text-text-muted leading-relaxed font-medium">
                    اضغط هنا للتحدث مع المساعد الذكي لمساعدتك في المنيو وتسجيل طلبك مباشرة وطاولتك تلقائياً!
                  </p>
                </div>
              </motion.div>

              {/* Waiter Callout Indicator */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowWaiterModal(true)}
                className="cursor-pointer flex items-center gap-4 p-5 bg-gradient-to-r from-brand-gold/5 via-brand-primary/5 to-brand-gold/5 hover:from-brand-gold/10 hover:to-brand-gold/10 border border-brand-gold/20 hover:border-brand-gold/40 rounded-2xl text-right transition-all duration-300 shadow-sm"
              >
                <div className="w-12 h-12 rounded-xl bg-brand-gold flex items-center justify-center text-white shadow-md shadow-brand-gold/10 shrink-0">
                  <Bell className="w-6 h-6 animate-bounce" />
                </div>
                <div className="space-y-0.5 flex-1 select-none">
                  <h4 className="text-sm font-bold text-brand-primary flex items-center gap-2">
                    طلب الويتر الآن 🔔
                    <span className="text-[9px] bg-green-500/10 text-green-700 px-2 py-0.5 rounded-full font-bold shrink-0">نشط</span>
                  </h4>
                  <p className="text-xs text-text-muted leading-relaxed font-medium">
                    اضغط هنا لطلب الويتر طاولتك مباشرة مع كتابة اسمك وتحديد نوع احتياجك (حساب، استفسار...)!
                  </p>
                </div>
              </motion.div>

              {/* Live Order Status Tracking Card (The requested Third Rectangle!) */}
              {orderComplete && (
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowOrderTrackingModal(true)}
                  className="cursor-pointer flex items-center gap-4 p-5 bg-gradient-to-r from-emerald-500/5 via-brand-gold/5 to-emerald-500/5 hover:from-emerald-500/10 hover:to-emerald-500/10 border border-emerald-500/20 hover:border-emerald-500/40 rounded-2xl text-right transition-all duration-300 shadow-sm relative overflow-hidden group"
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md shrink-0 relative ${
                    orderComplete.status === "pending"
                      ? "bg-amber-500 shadow-amber-500/10"
                      : orderComplete.status === "preparing"
                        ? "bg-blue-500 shadow-blue-500/10 animate-pulse"
                        : orderComplete.status === "ready"
                          ? "bg-emerald-500 shadow-emerald-500/10 scale-105"
                          : orderComplete.status === "served"
                            ? "bg-gray-500 shadow-gray-500/10"
                            : "bg-red-500 shadow-red-500/10"
                  }`}>
                    {orderComplete.status === "pending" && <span className="text-xl">⌛</span>}
                    {orderComplete.status === "preparing" && <span className="text-xl">🍳</span>}
                    {orderComplete.status === "ready" && <span className="text-xl">🎉</span>}
                    {orderComplete.status === "served" && <span className="text-xl">🍽️</span>}
                    {orderComplete.status === "rejected" && <span className="text-xl">⚠️</span>}
                    <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                    </span>
                  </div>
                  <div className="space-y-0.5 flex-1 min-w-0 text-right">
                    <h4 className="text-sm font-bold text-brand-primary flex items-center gap-2">
                      تتبع حالة طلبك الحالي 📊
                      <span className={`text-[9.5px] px-2.5 py-0.5 rounded-full font-bold shrink-0 ${
                        orderComplete.status === "pending"
                          ? "bg-amber-500/10 text-amber-700 font-bold"
                          : orderComplete.status === "preparing"
                            ? "bg-blue-500/10 text-blue-700 font-bold"
                            : orderComplete.status === "ready"
                              ? "bg-emerald-500/10 text-emerald-700 font-bold"
                              : orderComplete.status === "served"
                                ? "bg-gray-500/10 text-gray-700 font-bold"
                                : "bg-red-500/10 text-red-700 font-bold"
                      }`}>
                        {orderComplete.status === "pending" && "بإنتظار الموافقة"}
                        {orderComplete.status === "preparing" && "قيد التحضير"}
                        {orderComplete.status === "ready" && "جاهز للتسليم"}
                        {orderComplete.status === "served" && "تم تسليم الطلب"}
                        {orderComplete.status === "rejected" && "مرفوض"}
                      </span>
                    </h4>
                    <p className="text-xs text-text-muted leading-relaxed font-medium truncate">
                      {orderComplete.status === "pending" && "بإنتظار موافقة كابتن الصالة لتأكيد طاولتك..."}
                      {orderComplete.status === "preparing" && "المطبخ يعمل الآن على تحضير وجبتك بكل حب! 🍳"}
                      {orderComplete.status === "ready" && "نور الصالة! وجبتك جاهزة للتقديم والتسليم.. 🎉"}
                      {orderComplete.status === "served" && "🍽️ بالهناء والشفاء! نتمنى لك وقتاً طيباً ووجبة شهية."}
                      {orderComplete.status === "rejected" && `⚠️ نعتذر، تم رفض الطلب: ${orderComplete.rejectionReason || "تواصل معنا"}`}
                    </p>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Search and Categories Bar */}
      <div className="sticky top-[84px] z-30 bg-white/95 backdrop-blur-md border-b border-border-delicate py-6 space-y-4">
        {/* Search Input */}
        <div className="max-w-xl mx-auto px-6 sm:px-8">
          <div className="relative">
            <span className="absolute inset-y-0 right-4 flex items-center pr-3 pointer-events-none text-brand-gold">
              <Search className="w-5 h-5" />
            </span>
            <input
              type="text"
              placeholder="ابحث عن وجبتك المفضلة بالاسم أو المكونات..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-bg-paper border border-border-delicate focus:border-brand-gold pr-12 pl-4 py-3 text-sm text-brand-primary placeholder:text-text-muted/50 outline-none text-right transition-all font-bold"
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
        <div className="flex px-4 sm:px-8 overflow-x-auto no-scrollbar gap-3 md:gap-4 justify-start md:justify-center pb-2">
          {["الكل", ...(restaurant?.categories || ["الوجبات الأساسية", "المقبلات", "الحلويات", "المشروبات"])].map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`flex items-center gap-2 px-5 py-3 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-300 relative border ${
                  isSelected
                    ? "bg-brand-primary text-white border-brand-primary shadow-[0_10px_25px_-5px_rgba(45,58,39,0.22)]"
                    : "bg-white text-text-muted hover:text-brand-primary border-border-delicate hover:border-brand-gold/30 hover:shadow-sm"
                }`}
              >
                <span className={`transition-transform duration-300 ${isSelected ? "scale-110 text-brand-gold" : "text-text-muted/60"}`}>
                  {getCategoryIcon(cat)}
                </span>
                <span className="tracking-wide">{cat}</span>
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
      <div className="max-w-7xl mx-auto px-6 sm:px-8 pt-10 text-right">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border-delicate pb-5">
          <div className="space-y-1">
            <h2 className="text-2xl sm:text-3xl font-display font-medium text-brand-primary flex items-center gap-3">
              <span className="w-1.5 h-6 bg-brand-gold rounded-full" />
              {selectedCategory === "الكل" ? "جميع المأكولات والأصناف" : selectedCategory}
            </h2>
          </div>
          <span className="text-[10px] font-bold text-brand-gold uppercase tracking-widest bg-brand-primary/5 px-4 py-2 border border-brand-primary/10 rounded-full">
            {filteredMenuItems.length} أصناف متوفرة
          </span>
        </div>
      </div>

      {/* Menu Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12 text-right">
        {filteredMenuItems.length === 0 ? (
          <div className="text-center py-24 sm:py-32 border border-dashed border-border-delicate bg-white">
            <p className="font-display italic text-2xl text-brand-gold opacity-40">
              لا توجد أطباق متوفرة في هذا القسم حالياً.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {filteredMenuItems.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: Math.min(idx * 0.05, 0.4) }}
                className="group flex flex-col justify-between h-full bg-white border border-border-delicate hover:border-brand-gold transition-all duration-500 overflow-hidden"
              >
                <div>
                  <div className="aspect-[4/3] overflow-hidden relative">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                        alt={item.name}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full bg-bg-paper flex items-center justify-center text-border-delicate text-xs italic">
                        صورة الوجبة
                      </div>
                    )}
                    {item.isAvailable === false && (
                      <div className="absolute inset-0 bg-white/70 backdrop-blur-[1.5px] z-10 flex items-center justify-center">
                        <span className="bg-red-600 text-white text-[10px] sm:text-xs py-1.5 px-3 font-bold uppercase tracking-wider shadow">
                          غير متاح حالياً 🚫
                        </span>
                      </div>
                    )}
                    {item.isSpicy && (
                      <div className="absolute top-2 right-2 bg-brand-primary/80 backdrop-blur-sm text-white text-[8px] sm:text-[9px] py-1 px-2 font-bold uppercase tracking-wider z-20">
                        🔥 حار
                      </div>
                    )}
                  </div>

                  <div className="p-3 sm:p-5 space-y-2 text-right">
                    {item.category && (
                      <p className="text-[8px] sm:text-[9px] font-bold text-brand-gold uppercase tracking-widest block">
                        {item.category}
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-baseline gap-1">
                      <h3 className="font-display text-sm sm:text-base font-bold text-brand-primary leading-tight">
                        {item.name}
                      </h3>
                      <p className="font-display text-xs sm:text-sm font-bold text-brand-gold">
                        <span className="font-sans">{item.price.toLocaleString()}</span>{" "}
                        <span className="text-[9px] opacity-70">د.ع</span>
                      </p>
                    </div>

                    <p className="text-text-muted text-[10px] sm:text-xs font-light leading-relaxed line-clamp-2">
                      {item.ingredients || "أجود المكونات الطازجة المحضّرة بحب وعناية."}
                    </p>
                  </div>
                </div>

                <div className="p-3 sm:p-5 pt-0">
                  <div className="pt-2 sm:pt-3 border-t border-border-delicate/50 flex items-center justify-between gap-2">
                    {item.isAvailable === false ? (
                      <div className="w-full text-center bg-gray-100 border border-gray-200 text-gray-400 text-[10px] sm:text-xs font-bold py-2 px-3 cursor-not-allowed select-none">
                        غير متاح حالياً 🚫
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
                          <Sparkles className="w-3.5 h-3.5 shrink-0" /> تخصيص وإضافة للسلة ➕
                        </button>
                        {getQuantityInCart(item.id) > 0 && (
                          <div className="text-center text-[9px] font-bold text-brand-primary bg-brand-primary/5 py-1 px-2 border border-brand-primary/10 rounded">
                            تمت إضافة {getQuantityInCart(item.id)} بالسلة بخيارات مختلفة
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
                          className="hover:opacity-75 p-1"
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
                          className="hover:opacity-75 p-1"
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
                        className="w-full bg-bg-paper hover:bg-brand-primary hover:text-white border border-border-delicate text-text-muted hover:border-brand-primary text-[10px] sm:text-xs font-bold py-2 px-3 transition-all duration-300 text-center flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" /> إضافة للسلة
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
            className="fixed bottom-6 sm:bottom-10 left-0 right-0 z-50 flex justify-center px-4 sm:px-8"
          >
            <button
              onClick={() => setShowCart(true)}
              className="bg-brand-primary text-white py-4 px-6 sm:py-6 sm:px-12 rounded-full flex items-center gap-4 sm:gap-12 shadow-[0_20px_50px_rgba(45,58,39,0.3)] hover:bg-brand-secondary transition-all group max-w-full"
            >
              <div className="flex items-center gap-3 sm:gap-6">
                <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                <div className="text-right">
                  <p className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest opacity-60">
                    مراجعة وتأكيد طلبك
                  </p>
                  <p className="text-base sm:text-xl font-display italic leading-none">
                    {totalItems} أطباق مختارة
                  </p>
                </div>
              </div>
              <div className="h-8 sm:h-10 w-[1px] bg-white/20 shrink-0" />
              <div className="flex items-center gap-3 sm:gap-6">
                <span className="text-base sm:text-2xl font-display whitespace-nowrap">
                  {totalPrice.toLocaleString()} IQD
                </span>
                <div className="bg-white/20 p-1.5 sm:p-2 rounded-full group-hover:translate-x-2 transition-transform shrink-0">
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
              dir="rtl"
            >
              {/* Texture Overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

              {/* Drawer Header */}
              <div className="flex justify-between items-center mb-6 sm:mb-8 relative border-b border-border-delicate pb-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-display font-black text-brand-primary leading-none">
                    سلة المشتريات
                  </h2>
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest mt-2">
                     الوجبات التي قمت باختيارها
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCart(false)}
                  className="px-4 py-2 border border-border-delicate hover:bg-bg-paper text-brand-primary hover:text-brand-secondary transition-all text-xs font-bold"
                >
                  إغلاق السلة
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
                      <p className="text-base font-bold text-brand-primary">سلتك لا تزال فارغة</p>
                      <p className="text-xs text-text-muted max-w-[240px] leading-relaxed">
                        اختر من بين تشكيلة أطباقنا الشهية لتضيفها إلى سلتك وتستمتع بمذاق مميز.
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
                                  <span>✨ خيارات:</span>
                                  <span>{[
                                    cheeseSelected ? "جبن 🧀" : null,
                                    spicySelected ? "سبايسي 🌶️" : null
                                  ].filter(Boolean).join(" + ")}</span>
                                </div>
                              )}
                              <p className="text-xs text-brand-gold font-bold">
                                {itemPrice.toLocaleString()} <span className="text-[10px] opacity-70">د.ع</span>
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
                          اسم الزبون الكريم
                        </label>
                        <input
                          required
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          type="text"
                          placeholder="الرجاء إدخال الاسم الكامل"
                          className="w-full bg-bg-paper border border-border-delicate py-3 px-4 focus:outline-none focus:border-brand-primary transition-all text-sm text-brand-primary text-right font-bold focus:bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          رقم الطاولة المخصصة
                        </label>
                        <input
                          required
                          value={tableNumber}
                          onChange={(e) => setTableNumber(e.target.value)}
                          type="text"
                          placeholder="أدخل رقم طاولة جلوسك"
                          className="w-full bg-bg-paper border border-border-delicate py-3 px-4 focus:outline-none focus:border-brand-primary transition-all text-sm text-brand-primary text-right font-bold focus:bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-brand-gold uppercase tracking-widest block">
                          رغبات أو توجيهات خاصة بالطلب
                        </label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="مثال: بدون بصل، صوص خارجي، درجة الاستواء..."
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
                      المجموع الإجمالي للوجبات
                    </span>
                    <span className="text-xl sm:text-2xl font-sans text-brand-primary font-black">
                      {totalPrice.toLocaleString()} <span className="text-xs font-bold">د.ع</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePlaceOrder}
                    className="w-full py-4 bg-brand-primary text-white font-bold hover:bg-brand-secondary transition-all text-xs sm:text-sm tracking-widest text-center shadow-md uppercase"
                  >
                    إرسال الطلب للمطبخ والويترز
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
                    المنسق
                  </h2>
                  <p className="text-[10px] font-bold text-brand-gold uppercase tracking-widest mt-3">
                     المساعد الذكي لتنسيق طعامك
                  </p>
                </div>
                <button
                  onClick={() => setShowAIChat(false)}
                  className="text-text-muted hover:text-brand-primary font-bold"
                >
                  إغلاق
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto space-y-12 no-scrollbar px-2 relative"
              >
                <div className="bg-bg-paper p-8 rounded-[1.5rem] border border-border-delicate italic text-text-muted text-sm leading-relaxed shadow-sm">
                  أهلاً بك. أنا منسقك الشخصي في {restaurant?.restaurantName}.{" "}
                  <br /> <br />
                  نحن فخورون بتقديم قائمة طعام متنوعة. هل يمكنني مساعدتك في
                  العثور على ما يناسب ذوقك اليوم؟
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
                    جاري معالجة الرد ومساعدتك...
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
                    placeholder="كيف يمكنني مساعدتك؟"
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
                      حالة وتفاصيل طلبك النشط ✨
                    </h1>
                    <p className="text-text-muted mt-1 text-sm font-medium">
                      رقم الطلب:{" "}
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
                    الاسم:{" "}
                    <span className="text-text-main">
                      {orderComplete.customerName || "زبون مجهول"}
                    </span>
                  </p>
                  <p className="text-xs font-bold flex justify-between text-text-muted uppercase tracking-widest">
                    الطاولة:{" "}
                    <span className="text-text-main">
                      {orderComplete.tableNumber || "غير محددة"}
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
                      <p className="text-xs text-text-muted italic text-center">جاري جلب تفاصيل المواد من السيرفر...</p>
                    )}
                  </div>
                  <p className="pt-4 font-display text-brand-primary flex justify-between border-t border-border-delicate text-lg italic">
                    المجموع الكلي:{" "}
                    <span>{(orderComplete.totalAmount || 0).toLocaleString()} IQD</span>
                  </p>
                </div>

                {/* Real-time Order Status Live Road */}
                <div className="bg-bg-paper p-5 rounded-2xl border border-border-delicate text-right space-y-3">
                  <h4 className="text-xs font-bold text-brand-gold uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                    تتبع حالة طلبك المباشرة
                  </h4>

                  {orderComplete.status === "rejected" ? (
                    <div className="p-3 bg-red-50 border border-red-100 rounded text-red-700 text-xs">
                      <p className="font-bold underline">⚠️ تم إلغاء / رفض هذا الطلب:</p>
                      <p className="mt-1">{orderComplete.rejectionReason || "تواصل مع كابتن الصالة لمعرفة السبب."}</p>
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
                          موافقة الكابتن
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
                          قيد التحضير
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
                          جاهز للتسليم
                        </span>
                      </div>
                    </div>
                  )}

                  {orderComplete.status === "ready" && (
                    <div className="mt-3 p-2 bg-emerald-50 border border-emerald-100 rounded text-emerald-800 text-[11px] font-bold text-center leading-relaxed">
                      🎉 وجبتك جاهزة للتسليم! سيوصلها كابتن الصالة إلى طاولتك الآن!
                    </div>
                  )}
                  {orderComplete.status === "served" && (
                    <div className="mt-3 p-2 bg-brand-primary/5 border border-brand-primary/10 rounded text-brand-primary text-[11px] font-bold text-center leading-relaxed font-display">
                      🍽️ تم تقديم الوجبة لك بنجاح، نتمنى لك وقتاً طيباً ووجبة شهية ممتعة!
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-text-muted uppercase tracking-widest text-center leading-relaxed">
                  الضيافة الرفيعة هي رحلة في عوالم النكهات. <br /> جاري تحضير وجبتك بكل حب وعناية.
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
                  {orderComplete.status === 'served' || orderComplete.status === 'rejected' ? "موافق وبدء طلب جديد 🍽️" : "متابعة التصفح بالخلفية 🥣"}
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
              dir="rtl"
            >
              <div className="absolute top-0 right-0 w-full h-1 bg-brand-gold" />
              <div className="flex justify-between items-start mb-6 w-full">
                <div className="space-y-1">
                  <span className="text-[9px] font-bold text-brand-gold uppercase tracking-widest block font-sans">خيارات وتخصيص الوجبة</span>
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
                    <p className="text-xs text-text-muted leading-relaxed line-clamp-2">{showCustomizer.item.ingredients || "طعم لذيذ ومكونات طازجة."}</p>
                    <p className="text-sm font-bold text-brand-primary font-mono mt-1">
                      السعر الأساسي: {showCustomizer.item.price.toLocaleString()} د.ع
                    </p>
                  </div>
                </div>

                {/* خيارات التخصيص المتوفرة */}
                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border-delicate pb-2 font-sans">اختر خيارات وعناصر الإضافة المتاحة:</p>

                  {showCustomizer.item.hasCheese && (
                    <div 
                      onClick={() => setCustCheese(!custCheese)}
                      className={`flex justify-between items-center p-4 border cursor-pointer transition-all duration-300 ${custCheese ? "border-brand-gold bg-brand-gold/5" : "border-border-delicate bg-white hover:border-brand-gold/50"}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 border flex items-center justify-center rounded transition-all ${custCheese ? "bg-brand-gold border-brand-gold text-white" : "border-border-delicate bg-white"}`}>
                          {custCheese && <span className="text-xs">✕</span>}
                        </div>
                        <span className="text-sm font-bold text-brand-primary font-sans">إضافة الجبن الإضافي 🧀</span>
                      </div>
                      <span className="text-xs font-bold text-brand-gold font-mono">+{showCustomizer.item.cheesePrice ? showCustomizer.item.cheesePrice.toLocaleString() : "0"} د.ع</span>
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
                        <span className="text-sm font-bold text-brand-primary font-sans">خيار سبايسي (حار) 🌶️</span>
                      </div>
                      <span className="text-xs font-bold text-brand-primary font-mono">+{showCustomizer.item.spicyPrice ? showCustomizer.item.spicyPrice.toLocaleString() : "0"} د.ع</span>
                    </div>
                  )}

                  {!showCustomizer.item.hasCheese && !showCustomizer.item.isSpicy && (
                    <p className="text-xs text-text-muted font-sans">لا تتوفر إضافات مخصصة لهذا الصنف، سيقدم كـ عادي.</p>
                  )}
                </div>

                {/* المجموع الكلي */}
                <div className="bg-brand-primary/5 p-4 border border-brand-primary/10 flex justify-between items-center">
                  <span className="text-xs font-bold text-brand-primary font-sans">المجموع بعد التخصيص:</span>
                  <span className="text-base font-bold text-brand-primary font-mono">
                    {(showCustomizer.item.price + 
                      (custCheese ? (showCustomizer.item.cheesePrice || 0) : 0) + 
                      (custSpicy ? (showCustomizer.item.spicyPrice || 0) : 0)
                    ).toLocaleString()} د.ع
                  </span>
                </div>

                {/* أزرار الحفظ والالتزام */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleAddCustomizedToCart}
                    className="flex-1 py-3 bg-brand-primary text-white text-xs font-bold uppercase tracking-wider hover:bg-brand-secondary transition-colors font-sans"
                  >
                    أضف للسلة 🛒
                  </button>
                  <button
                    onClick={() => setShowCustomizer({ open: false, item: null })}
                    className="px-6 py-3 border border-border-delicate text-xs font-bold text-text-muted hover:bg-bg-paper transition-colors font-sans"
                  >
                    إلغاء
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
              dir="rtl"
            >
              {/* Top border accent */}
              <div className="absolute top-0 right-0 left-0 h-1.5 bg-brand-gold" />

              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-brand-primary/5 text-brand-gold rounded-full flex items-center justify-center">
                    <Bell className="w-5 h-5 animate-bounce" />
                  </div>
                  <h3 className="text-xl font-display text-brand-primary font-bold">
                    نداء نادل الخدمة (الويتر)
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
                  <h4 className="text-xl font-bold text-brand-primary">تم إرسال النداء بنجاح!</h4>
                  <p className="text-xs text-text-muted">
                    تم إشعار الويترز بطاولتك (طاولة {tableNumber}). سيحضر إليك أحد الموظفين فوراً لتلبية طلبك.
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleWaiterCallSubmit} className="space-y-6">
                  <p className="text-xs text-text-muted leading-relaxed">
                    يرجى ملء الاسم ورقم الطاولة لتحديد مكان جلوسك بدقة وتأكيد احتياجك السريع للنداء.
                  </p>

                  <div className="space-y-4">
                    {/* User Name */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-gold uppercase tracking-wider">الاسم بالكامل</label>
                      <input
                        type="text"
                        required
                        placeholder="أدخل اسمك هنا"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-bold focus:outline-none focus:border-brand-primary focus:bg-white text-right"
                      />
                    </div>

                    {/* Table Number */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-gold uppercase tracking-wider">رقم الطاولة</label>
                      <input
                        type="text"
                        required
                        placeholder="أدخل رقم طاولتك"
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-bold focus:outline-none focus:border-brand-primary focus:bg-white text-right font-mono"
                      />
                    </div>

                    {/* Call Reason / Need */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-brand-gold uppercase tracking-wider">ما هو احتياجك؟ المختصر</label>
                      <input
                        type="text"
                        required
                        placeholder="مثال: دفع الحساب، استفسار عن طبق، شوكة إضافية..."
                        value={waiterCallReason}
                        onChange={(e) => setWaiterCallReason(e.target.value)}
                        className="w-full bg-slate-50 border border-border-delicate px-4 py-3 text-sm font-bold focus:outline-none focus:border-brand-primary focus:bg-white text-right"
                      />
                    </div>

                    {/* Quick Suggestions template */}
                    <div className="space-y-1.5">
                      <label className="block text-[9px] font-bold text-text-muted uppercase tracking-wider">خيارات سريعة شائعة:</label>
                      <div className="flex flex-wrap gap-2 justify-start">
                        {[
                          "دفع وتصفية الـفـاتـورة 💳",
                          "استفسار بخصوص وجبة طعام 🍽️",
                          "طلب نادل على الطاولة 🧑‍🍳",
                          "طلب ماء / مناديل إضافية 🥤",
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
                          جاري إرسال النداء...
                        </>
                      ) : (
                        "تأكيد وإرسال نداء الويتر 🔔"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWaiterModal(false)}
                      className="px-5 py-3.5 border border-border-delicate hover:bg-slate-50 text-text-muted text-[11px] font-bold uppercase tracking-widest transition-all"
                    >
                      إلغاء
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
