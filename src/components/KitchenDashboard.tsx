import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Utensils, Clock, CheckCircle2, User, ChevronRight, ChefHat, Bell, Timer, ShieldAlert } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, Timestamp, getDoc, db } from '../lib/supabase-db';
import { Order, OrderStatus } from '../types';
import { format } from 'date-fns';
import { useLanguage } from '../lib/i18n';
import { enableStaffNotifications, showDeviceNotificationTest } from '../lib/notifications';

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
import { RejectOrderModal } from './WaiterDashboard';

interface KitchenDashboardProps {
  restaurantId: string;
}

export default function KitchenDashboard({ restaurantId }: KitchenDashboardProps) {
  const { dir, tr } = useLanguage();
  const [restaurant, setRestaurant] = useState<any | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [supportPhone, setSupportPhone] = useState(() => localStorage.getItem("novix_support_phone") || "07740064528");
  const [systemLogo, setSystemLogo] = useState(() => localStorage.getItem("novix_system_logo") || "");
  const [mobileView, setMobileView] = useState<'preparing' | 'ready'>('preparing');
  const [notificationState, setNotificationState] = useState<'idle' | 'loading' | 'enabled' | 'error'>('idle');
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationTestMessage, setNotificationTestMessage] = useState<string | null>(null);

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('orderId');
    if (!orderId) return;
    const matching = orders.find((order) => order.id === orderId);
    if (matching?.status === 'ready') setMobileView('ready');
    const timer = window.setTimeout(() => {
      document.getElementById(`staff-order-${orderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [orders.length]);

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

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
      if (snap.exists()) {
        setRestaurant({ id: snap.id, ...snap.data() });
      }
    });
    return () => unsubscribe();
  }, [restaurantId]);

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
    const q = query(
      collection(db, 'orders'), 
      where('restaurantId', '==', restaurantId),
      where('status', 'in', ['preparing', 'ready'])
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sorted = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Order))
        .sort((a, b) => b.createdAt - a.createdAt);
      setOrders(sorted);
      setLoading(false);
    }, (err) => {
      console.error('Unable to load kitchen orders', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [restaurantId]);

  const updateStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const updateFields: any = { 
        status: newStatus,
        updatedAt: Timestamp.now()
      };
      if (newStatus === "preparing") {
        updateFields.approvedAt = new Date().toISOString();
      } else if (newStatus === "ready") {
        updateFields.readyAt = new Date().toISOString();
      }
      await updateDoc(doc(db, 'orders', orderId), updateFields);
    } catch (err) {
      console.error('Unable to update kitchen order', err);
      alert(tr('تعذر تحديث حالة الطلب. حاول مجدداً.', 'Could not update the order status. Please retry.'));
    }
  };

  const handleRejectOrder = async (orderId: string, reason: string, staffName: string) => {
    try {
      await updateDoc(doc(db, "orders", orderId), {
        status: "rejected",
        rejectedBy: staffName,
        rejectedRole: "kitchen",
        rejectionReason: reason,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Unable to reject kitchen order', err);
      alert(tr('تعذر رفض الطلب. حاول مجدداً.', 'Could not reject the order. Please retry.'));
    }
  };

  const activeOrders = orders.filter(o => !o.clearedForStaff);
  const preparingOrders = activeOrders.filter(o => o.status === 'preparing');
  const readyOrders = activeOrders.filter(o => o.status === 'ready');

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
      {/* Header */}
      <div className="bg-white border border-border-delicate p-6 sm:p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1.5 h-full bg-brand-primary" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-right gap-6 sm:gap-8 w-full">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-bg-paper border border-border-delicate flex items-center justify-center overflow-hidden shrink-0">
               {systemLogo ? (
                 <img src={systemLogo} className="w-full h-full object-contain" alt="System Logo" referrerPolicy="no-referrer" />
               ) : (
                 <ChefHat className="w-8 h-8 sm:w-10 sm:h-10 text-brand-gold/30" />
               )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.5em] italic">{tr('شاشات المطبخ', 'Kitchen display')}</p>
              <h1 className="text-3xl sm:text-4xl font-display text-brand-primary italic tracking-tighter">{tr('قسم الطهي والتحضير', 'Kitchen workspace')}</h1>
              <p className="text-xs font-bold text-text-muted/60 uppercase tracking-widest">{tr('إدارة متكاملة للطلبات مباشرة', 'Live preparation workflow')}</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 sm:gap-8 justify-center lg:justify-end border-t border-border-delicate pt-6 lg:border-t-0 lg:pt-0 w-full lg:w-auto">
             <div className="flex flex-col gap-2 max-w-xs">
             <button type="button" disabled={notificationState === 'loading' || notificationState === 'enabled'}
               onClick={async () => {
                 setNotificationState('loading');
                 setNotificationError(null);
                 try { await enableStaffNotifications(restaurantId); setNotificationState('enabled'); }
                 catch (error) { console.error(error); setNotificationError(error instanceof Error ? error.message : 'notification_registration_failed'); setNotificationState('error'); }
               }}
               className="flex items-center gap-2 px-3 py-2 border border-brand-gold text-brand-primary text-xs font-bold disabled:opacity-60">
               <Bell className="w-4 h-4" />
               {notificationState === 'enabled' ? tr('الإشعارات مفعلة', 'Alerts enabled') : notificationState === 'loading' ? tr('جاري التفعيل...', 'Enabling...') : notificationState === 'error' ? tr('فشل التفعيل، أعد المحاولة', 'Could not enable, retry') : tr('تفعيل تنبيهات الطلبات', 'Enable order alerts')}
             </button>
             {notificationState === 'enabled' && <button type="button" onClick={async () => {
               try {
                 await showDeviceNotificationTest();
                 setNotificationTestMessage(tr('تم إرسال تنبيه اختباري. إن لم يظهر، تحقق من إشعارات iPhone ووضع التركيز.', 'Device test queued. If hidden, check iPhone Notifications and Focus settings.'));
               } catch (error) {
                 console.error(error);
                 setNotificationTestMessage(tr('تعذر عرض التنبيه الاختباري.', 'Could not display a test alert.'));
               }
             }} className="border border-border-delicate px-3 py-2 text-xs font-bold text-brand-primary">
               {tr('اختبار هذا الجهاز', 'Test this device')}
             </button>}
             {notificationError && <p role="alert" className="text-xs text-red-700">
               {notificationError === 'notifications_home_screen_required' ? tr('افتح التطبيق من أيقونة الشاشة الرئيسية على iPhone ثم فعّل الإشعارات.', 'Open the app from its iPhone Home Screen icon, then enable alerts.')
                 : notificationError === 'notification_permission_denied' ? tr('اسمح بإشعارات التطبيق من إعدادات iPhone.', 'Allow this app in iPhone Notifications settings.')
                 : notificationError === 'not_authorized_for_restaurant' ? tr('حساب المطبخ غير مخوّل لهذا المطعم.', 'This kitchen account is not authorized for this restaurant.')
                 : tr('تعذر تسجيل الجهاز. تحقق من الاتصال وأعد المحاولة.', 'Could not register this device. Check your connection and retry.')}
             </p>}
             {notificationTestMessage && <p role="status" className="text-xs text-text-muted">{notificationTestMessage}</p>}
             </div>
             <div className="text-center sm:text-right">
                <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest opacity-60 font-sans">{tr('قيد التحضير', 'Preparing')}</p>
                <p className="text-2xl font-display not-italic text-brand-primary font-bold"><span className="font-sans">{preparingOrders.length}</span></p>
             </div>
             <div className="text-center sm:text-right">
                <p className="text-[9px] font-bold text-brand-gold uppercase tracking-widest opacity-60 font-sans">{tr('جاهز للتقديم', 'Ready')}</p>
                <p className="text-2xl font-display not-italic text-emerald-600 font-bold"><span className="font-sans">{readyOrders.length}</span></p>
             </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
        {/* Preparing Column */}
        <div className={`${mobileView === 'preparing' ? 'block' : 'hidden'} xl:block space-y-10`}>
           <div className="flex items-center gap-4 border-b border-border-delicate pb-4">
              <div className="h-0.5 w-12 bg-brand-gold" />
               <h2 className="text-sm font-bold text-brand-primary uppercase tracking-widest">{tr('طلبات قيد الطهي والتحضير', 'Preparing orders')}</h2>
            </div>
            
            <div className="space-y-8">
               <AnimatePresence mode="popLayout">
                 {preparingOrders.map((order) => (
                   <KitchenOrderCard 
                     key={order.id} 
                     order={order} 
                     onAction={() => updateStatus(order.id, 'ready')}
                     actionLabel={tr('اكتمال التحضير وجهوزية الطبق', 'Mark ready')}
                     type="preparing"
                     onReject={() => setRejectingOrder(order)}
                   />
                 ))}
               </AnimatePresence>
               {preparingOrders.length === 0 && <EmptyState icon={<Clock className="w-10 h-10" />} text={tr('المطبخ هادئ ومستقر حالياً.', 'No orders are being prepared.')} />}
            </div>
        </div>

        {/* Ready Column */}
        <div className={`${mobileView === 'ready' ? 'block' : 'hidden'} xl:block space-y-10`}>
           <div className="flex items-center gap-4 border-b border-border-delicate pb-4">
              <div className="h-0.5 w-12 bg-emerald-500" />
               <h2 className="text-sm font-bold text-brand-primary uppercase tracking-widest">{tr('أطباق جاهزة للتقديم فوراً', 'Ready for service')}</h2>
            </div>
            
            <div className="space-y-8">
               <AnimatePresence mode="popLayout">
                  {readyOrders.map((order) => (
                     <KitchenOrderCard 
                       key={order.id} 
                       order={order} 
                       onAction={() => updateStatus(order.id, 'preparing')}
                       actionLabel={tr('إرجاع الطبق إلى قيد التحضير', 'Return to preparing')}
                       type="ready"
                       onReject={() => setRejectingOrder(order)}
                     />
                  ))}
               </AnimatePresence>
               {readyOrders.length === 0 && <EmptyState icon={<CheckCircle2 className="w-10 h-10" />} text={tr('لا توجد أطباق جاهزة بانتظار الخدمة.', 'No dishes are waiting for service.')} />}
            </div>
        </div>
      </div>

      <nav className="fixed xl:hidden bottom-0 inset-x-0 z-50 grid grid-cols-2 gap-2 border-t border-border-delicate workspace-shell-panel px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(0,0,0,.10)]" aria-label={tr('مراحل طلبات المطبخ', 'Kitchen order stages')}>
        <button onClick={() => setMobileView('preparing')} className={`h-16 flex items-center justify-center gap-2 text-xs font-bold ${mobileView === 'preparing' ? 'bg-brand-primary text-white' : 'text-brand-primary'}`}>
          <Clock className="w-5 h-5" /> {tr('تحضير', 'Preparing')} <span className="min-w-5 h-5 px-1 rounded-full bg-brand-gold text-white flex items-center justify-center">{preparingOrders.length}</span>
        </button>
        <button onClick={() => setMobileView('ready')} className={`h-16 flex items-center justify-center gap-2 text-xs font-bold ${mobileView === 'ready' ? 'bg-emerald-600 text-white' : 'text-brand-primary'}`}>
          <CheckCircle2 className="w-5 h-5" /> {tr('جاهز', 'Ready')} <span className="min-w-5 h-5 px-1 rounded-full bg-emerald-500 text-white flex items-center justify-center">{readyOrders.length}</span>
        </button>
      </nav>

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
      </AnimatePresence>
    </div>
  );
}

function KitchenOrderCard({ 
  order, 
  onAction, 
  actionLabel, 
  type, 
  onReject 
}: { 
  order: Order, 
  onAction: () => void, 
  actionLabel: string, 
  type: 'preparing' | 'ready', 
  onReject?: () => void,
  key?: string 
}) {
  const { tr } = useLanguage();
  return (
    <motion.div
      id={`staff-order-${order.id}`}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white border border-border-delicate p-5 sm:p-10 space-y-8 group hover:border-brand-gold transition-colors duration-500 relative"
    >
      <div className={`absolute top-0 right-0 w-1.5 h-full ${type === 'preparing' ? 'bg-brand-gold' : 'bg-emerald-500'}`} />
      
      <div className="flex justify-between items-start">
         <div className="space-y-1">
            <h3 className="font-display text-xl sm:text-2xl italic text-brand-primary tracking-tight">{tr('طاولة', 'Table')} <span className="not-italic inline-block font-sans font-bold">{order.tableNumber}</span> <span className="text-text-muted opacity-40 font-bold ml-2">/ {order.customerName}</span></h3>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-[9px] font-bold text-brand-gold uppercase tracking-[0.3em]">
               <span className="flex items-center gap-2"><Timer className="w-3 h-3" /> <span className="not-italic inline-block font-sans">{safeFormatDate(order.createdAt, 'hh:mm a')}</span></span>
               <span className="text-text-muted/40 hidden sm:inline">|</span>
               <span className="text-text-muted/40 flex items-center gap-1.5">
                  {tr('رقم الطلب:', 'Order:')} <span className="text-brand-gold font-sans font-bold text-xs bg-brand-gold/10 px-2 py-0.5 rounded">{order.orderNumber || `#${order.id.slice(-6).toUpperCase()}`}</span>
               </span>
            </div>
         </div>
      </div>

      <div className="space-y-4 border-y border-border-delicate py-6 sm:py-8 bg-bg-paper -mx-5 px-5 sm:-mx-10 sm:px-10">
         {order.items.map((item, i) => (
           <div key={i} className="flex items-center justify-between group/item">
              <div className="flex items-center gap-4">
                 <div className="min-w-[36px] sm:min-w-[40px] h-9 sm:h-10 border border-border-delicate bg-white flex items-center justify-center font-display not-italic text-brand-gold font-bold">
                    {item.quantity}
                 </div>
                 <span className="font-display italic text-base sm:text-lg text-brand-primary">{item.name}</span>
              </div>
           </div>
         ))}
      </div>

      {order.notes && (
        <div className="p-4 sm:p-6 bg-red-50 border border-red-100 flex items-start gap-4 italic">
           <Bell className="w-5 h-5 text-red-400 shrink-0" />
           <div>
              <p className="text-[9px] font-bold text-red-600 uppercase tracking-widest mb-1">{tr('توجيهات خاصة وجانبية', 'Special instructions')}</p>
              <p className="text-sm font-bold text-red-900/80 leading-relaxed">{order.notes}</p>
           </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onAction}
          className={`flex-grow py-5 sm:py-6 text-[10px] font-bold uppercase tracking-[0.4em] transition-all flex items-center justify-center gap-4 shadow-xl ${
            type === 'preparing'
            ? 'bg-brand-primary text-white hover:bg-brand-secondary'
            : 'bg-white border border-border-delicate text-text-muted hover:bg-bg-paper'
          }`}
        >
           {type === 'preparing' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
           {actionLabel}
        </button>
        {type === 'preparing' && onReject && (
          <button
            type="button"
            onClick={onReject}
            className="py-5 sm:py-6 px-6 border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
          >
            {tr('رفض الطلب', 'Reject order')}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode, text: string }) {
  return (
    <div className="py-24 bg-bg-paper border border-dashed border-border-delicate flex flex-col items-center justify-center text-text-muted/40 gap-6 grayscale">
       <div className="opacity-20">{icon}</div>
       <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-center px-10">{text}</p>
    </div>
  );
}
