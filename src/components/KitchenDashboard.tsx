import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Utensils, Clock, CheckCircle2, User, ChevronRight, ChefHat, Bell, Timer, ShieldAlert } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, Timestamp, getDoc, db } from '../lib/supabase-db';
import { Order, OrderStatus } from '../types';
import { format } from 'date-fns';
import { useLanguage } from '../lib/i18n';
import { enableStaffNotifications, showDeviceNotificationTest } from '../lib/notifications';
import { StaffWelcomeCard } from './StaffWelcomeCard';
import { useOrderSound } from '../lib/use-order-sound';

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
  const orderSound = useOrderSound(restaurantId, 'kitchen');
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
      orderSound.checkOrders(sorted);
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
  const isExpiredAndLocked = expiryTime <= 0 || now >= expiryTime + (restaurant?.gracePeriodDays ?? 0) * oneDay;
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
            {tr('انتهى اشتراك المطعم. يرجى التواصل مع الإدارة لتجديد الخدمة.', 'The restaurant subscription has ended. Please contact management to renew it.')}
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
    <div className="dashboard-surface space-y-6 pb-24 lg:pb-0" dir={dir}>
      <div className={mobileView === 'preparing' ? '' : 'hidden xl:block'}>
        <StaffWelcomeCard
          logoUrl={restaurant?.logoUrl || systemLogo || '/ordova-mark.png'}
          logoAlt={restaurant?.logoUrl ? tr('شعار المطعم', 'Restaurant logo') : tr('شعار أوردوفا', 'Ordova logo')}
          eyebrow={restaurant?.restaurantName || tr('شاشات المطبخ', 'Kitchen display')}
          title={tr('قسم الطهي والتحضير', 'Kitchen workspace')}
          description={tr('إدارة متكاملة للطلبات مباشرة', 'Live preparation workflow')}
          metrics={[
            { label: tr('قيد التحضير', 'Preparing'), value: preparingOrders.length },
            { label: tr('جاهز للتقديم', 'Ready'), value: readyOrders.length },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-delicate bg-white p-3 sm:p-4">
             <button type="button" onClick={() => { void orderSound.toggle(); }} aria-pressed={orderSound.enabled}
               className="flex items-center gap-2 rounded-xl border border-border-delicate px-4 py-3 text-xs font-bold text-brand-primary">
               <Bell className="h-4 w-4" />{orderSound.enabled ? tr('صوت الطلبات: مفعل', 'Order sound: on') : tr('صوت الطلبات: متوقف', 'Order sound: off')}
             </button>
             <button type="button" disabled={notificationState === 'loading' || notificationState === 'enabled'}
               onClick={async () => {
                 setNotificationState('loading');
                 setNotificationError(null);
                 try { await enableStaffNotifications(restaurantId); setNotificationState('enabled'); }
                 catch (error) { console.error(error); setNotificationError(error instanceof Error ? error.message : 'notification_registration_failed'); setNotificationState('error'); }
               }}
               className="flex items-center gap-2 rounded-xl border border-brand-gold px-4 py-3 text-xs font-bold text-brand-primary disabled:opacity-60">
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
             }} className="rounded-xl border border-border-delicate px-4 py-3 text-xs font-bold text-brand-primary">
               {tr('اختبار هذا الجهاز', 'Test this device')}
             </button>}
              {notificationError && <p role="alert" className="w-full text-xs text-red-700">
               {notificationError === 'notifications_home_screen_required' ? tr('افتح التطبيق من أيقونة الشاشة الرئيسية على iPhone ثم فعّل الإشعارات.', 'Open the app from its iPhone Home Screen icon, then enable alerts.')
                 : notificationError === 'notification_permission_denied' ? tr('اسمح بإشعارات التطبيق من إعدادات iPhone.', 'Allow this app in iPhone Notifications settings.')
                 : notificationError === 'not_authorized_for_restaurant' ? tr('حساب المطبخ غير مخوّل لهذا المطعم.', 'This kitchen account is not authorized for this restaurant.')
                 : tr('تعذر تسجيل الجهاز. تحقق من الاتصال وأعد المحاولة.', 'Could not register this device. Check your connection and retry.')}
             </p>}
              {notificationTestMessage && <p role="status" className="w-full text-xs text-text-muted">{notificationTestMessage}</p>}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Preparing Column */}
        <div className={`${mobileView === 'preparing' ? 'block' : 'hidden'} workflow-panel space-y-5 xl:block`}>
           <div className="flex items-center justify-between gap-3 border-b border-border-delicate pb-4">
               <div><h2 className="text-lg font-bold text-brand-primary">{tr('قيد التحضير', 'Preparing orders')}</h2><p className="mt-1 text-xs text-text-muted">{tr('راجع الأصناف والملاحظات ثم أكد الجاهزية.', 'Check items and notes, then mark ready.')}</p></div><span className="rounded-lg bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800">{preparingOrders.length}</span>
            </div>
            
            <div className="space-y-3">
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
        <div className={`${mobileView === 'ready' ? 'block' : 'hidden'} workflow-panel workflow-panel-ready space-y-5 xl:block`}>
           <div className="flex items-center justify-between gap-3 border-b border-border-delicate pb-4">
               <div><h2 className="text-lg font-bold text-brand-primary">{tr('جاهزة للتقديم', 'Ready for service')}</h2><p className="mt-1 text-xs text-text-muted">{tr('بانتظار الويتر. أعدها للتحضير إذا لزم تعديلها.', 'Waiting for waiter service. Return if changes are needed.')}</p></div><span className="rounded-lg bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-800">{readyOrders.length}</span>
            </div>
            
            <div className="space-y-3">
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

      <nav className="fixed xl:hidden bottom-[calc(.5rem+env(safe-area-inset-bottom))] inset-x-3 z-50 grid grid-cols-2 gap-2 rounded-2xl border border-border-delicate workspace-shell-panel p-2 shadow-[0_10px_30px_rgba(0,0,0,.16)]" aria-label={tr('مراحل طلبات المطبخ', 'Kitchen order stages')}>
        <button onClick={() => setMobileView('preparing')} className={`h-16 rounded-xl flex items-center justify-center gap-2 text-xs font-bold ${mobileView === 'preparing' ? 'bg-brand-primary text-white' : 'text-brand-primary'}`}>
          <Clock className="w-5 h-5" /> {tr('تحضير', 'Preparing')} <span className="min-w-5 h-5 px-1 rounded-full bg-brand-gold text-white flex items-center justify-center">{preparingOrders.length}</span>
        </button>
        <button onClick={() => setMobileView('ready')} className={`h-16 rounded-xl flex items-center justify-center gap-2 text-xs font-bold ${mobileView === 'ready' ? 'bg-emerald-600 text-white' : 'text-brand-primary'}`}>
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
      className="group relative space-y-4 overflow-hidden rounded-2xl border border-border-delicate bg-white p-5 shadow-sm transition-colors hover:border-brand-gold sm:p-6"
    >
      <div className={`absolute top-0 right-0 w-1.5 h-full ${type === 'preparing' ? 'bg-brand-gold' : 'bg-emerald-500'}`} />
      
      <div className="flex flex-wrap items-start justify-between gap-3">
         <div className="space-y-1">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${type === 'preparing' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{type === 'preparing' ? tr('قيد التحضير · أكمل الأصناف', 'Preparing · finish the items') : tr('جاهز للتقديم', 'Ready for service')}</span>
            <h3 className="pt-1 text-2xl font-bold text-brand-primary">{order.deviceMetadata?.source === 'whatsapp' ? (order.deviceMetadata.fulfillment === 'delivery' ? tr('واتساب · توصيل', 'WhatsApp · Delivery') : tr('واتساب · استلام', 'WhatsApp · Pickup')) : order.deviceMetadata?.source === 'cashier' && order.tableNumber === 'counter' ? tr('طلب كاونتر', 'Counter order') : tr('طاولة', 'Table') + ' ' + order.tableNumber}</h3>
            <p className="text-sm text-text-muted">{order.customerName}</p>
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs font-semibold text-text-muted">
               <span className="flex items-center gap-2"><Timer className="h-4 w-4" />{safeFormatDate(order.createdAt, 'hh:mm a')}</span>
               <span>{tr('طلب رقم', 'Order')} <b className="text-brand-primary">{order.orderNumber || `#${order.id.slice(-6).toUpperCase()}`}</b></span>
            </div>
         </div>
         <div className="rounded-xl bg-bg-paper px-3 py-2 text-sm font-bold text-brand-primary">{order.items.reduce((sum, item) => sum + item.quantity, 0)} {tr('قطعة', 'items')}</div>
      </div>

      <div className="space-y-2 rounded-xl bg-bg-paper p-4">
         {order.items.map((item, i) => (
           <div key={i} className="border-b border-border-delicate/60 pb-2 last:border-b-0 last:pb-0">
              <div className="flex items-start gap-3"><span className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-white px-2 text-sm font-bold text-brand-primary">{item.quantity}×</span><span className="pt-1 text-base font-semibold text-brand-primary">{item.name}</span></div>
              {item.customizationText && <p className="mt-1 ps-12 text-xs font-semibold text-amber-800">{tr('الخيارات:', 'Options:')} {item.customizationText}</p>}
           </div>
         ))}
      </div>

      {order.notes && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
           <Bell className="w-5 h-5 text-red-400 shrink-0" />
           <div>
              <p className="mb-1 text-xs font-bold text-amber-900">{tr('ملاحظة الزبون', 'Customer note')}</p>
              <p className="text-sm font-semibold leading-relaxed text-amber-950">{order.notes}</p>
           </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onAction}
          className={`flex min-h-12 flex-grow items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors ${
            type === 'preparing'
            ? 'bg-brand-primary text-white hover:bg-brand-secondary'
            : 'border border-border-delicate bg-white text-brand-primary hover:bg-bg-paper'
          }`}
        >
           {type === 'preparing' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
           {actionLabel}
        </button>
        {type === 'preparing' && onReject && (
          <button
            type="button"
            onClick={onReject}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-bold text-red-700 hover:bg-red-100"
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-delicate bg-bg-paper py-10 text-text-muted">
       <div className="opacity-50">{icon}</div>
       <p className="px-5 text-center text-sm font-medium">{text}</p>
    </div>
  );
}
