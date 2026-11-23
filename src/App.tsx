/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart3, 
  Utensils, 
  Users, 
  LogOut, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Smartphone,
  ChevronRight,
  Menu as MenuIcon,
  X,
  CreditCard,
  Wallet,
  Gift,
  MapPin,
  MessageSquare,
  HelpingHand,
  Building2,
  Cpu,
  ClipboardList,
  QrCode,
  LayoutDashboard,
  ChefHat,
  ShieldAlert,
  History,
  Bell,
  Palette,
  Settings,
  Languages,
} from 'lucide-react';
import { UserSession } from './types';
import { supabase } from './lib/supabase';
import SubscriptionGuard from './components/SubscriptionGuard';
import FirstVisitGuide from './components/FirstVisitGuide';
import { db, doc, onSnapshot } from './lib/supabase-db';
import { DEFAULT_THEME, resolveTheme, themeStyle } from './lib/themes';
import type { MenuTheme } from './lib/themes';
import { useLanguage } from './lib/i18n';
import { selectStaffPortal, updateHomeScreenLink } from './lib/home-screen';
import { BRAND_NAME, DEFAULT_SYSTEM_LOGO } from './lib/brand';
import { staffPortalUrl } from './lib/public-urls';

const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));
const RestaurantDashboard = React.lazy(() => import('./components/RestaurantDashboard'));
const WhatsAppSettings = React.lazy(() => import('./components/WhatsAppSettings'));
const LoyaltyManagement = React.lazy(() => import('./components/LoyaltyManagement'));
const WaiterDashboard = React.lazy(() => import('./components/WaiterDashboard'));
const KitchenDashboard = React.lazy(() => import('./components/KitchenDashboard'));
const CashierDashboard = React.lazy(() => import('./components/CashierDashboard'));
const FloorPlanSettings = React.lazy(() => import('./components/FloorPlanSettings'));
const CustomerMenu = React.lazy(() => import('./components/CustomerMenu'));
const LoginPage = React.lazy(() => import('./components/LoginPage'));

export default function App() {
  const { dir, isEnglish, toggleLanguage, tr } = useLanguage();
  const [session, setSession] = useState<UserSession | null>(null);
  const [customerRestaurantId, setCustomerRestaurantId] = useState(() => new URLSearchParams(window.location.search).get('restaurantId'));
  const [checkingSession, setCheckingSession] = useState(!customerRestaurantId);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [workspaceTheme, setWorkspaceTheme] = useState<MenuTheme>(DEFAULT_THEME);
  const [systemLogo, setSystemLogo] = useState(() => localStorage.getItem('novix_system_logo') || '');
  const [appAlert, setAppAlert] = useState<string | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => setAppAlert(String(message ?? ''));
    return () => { window.alert = originalAlert; };
  }, []);

  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;
    const scrollNavWithWheel = (event: WheelEvent) => {
      if (nav.scrollWidth <= nav.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      nav.scrollLeft += event.deltaY * (getComputedStyle(nav).direction === 'rtl' ? -1 : 1);
    };
    nav.addEventListener('wheel', scrollNavWithWheel, { passive: false });
    return () => nav.removeEventListener('wheel', scrollNavWithWheel);
  }, [session?.role]);

  useEffect(() => {
    // Set initial sidebar state based on screen size
    setIsSidebarOpen(window.innerWidth >= 1024);
    
  }, []);
    
  useEffect(() => {
    if (customerRestaurantId) return;
    let current = true;
    // Rebuild UI authorization from the authenticated server identity. Never
    // trust the role or restaurant stored by the browser.
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      if (!current) return;
      if (!data.session) {
        localStorage.removeItem('novx_session');
        return;
      }
      const response = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!current) return;
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('novx_session');
        setSession(null);
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      if (!response.ok) throw new Error('session_unavailable');
      const verifiedSession = await response.json() as UserSession;
      if (!current) return;
      setSession(verifiedSession);
      localStorage.setItem('novx_session', JSON.stringify(verifiedSession));
    }).catch(() => {
      if (!current) return;
      localStorage.removeItem('novx_session');
      setAppAlert(tr('تعذّر التحقق من الجلسة. حدّث الصفحة أو سجّل الدخول مرة ثانية.', 'Could not verify your session. Refresh the page or sign in again.'));
    }).finally(() => { if (current) setCheckingSession(false); });
    return () => { current = false; };
  }, [customerRestaurantId]);

  useEffect(() => {
    // Reset tab to overview on login/logout
    if (session) {
      if (session.role === 'kitchen') {
        setActiveTab('orders');
      } else if (session.membershipRole === 'owner' && new URLSearchParams(window.location.search).has('whatsappSignup')) {
        setActiveTab('whatsapp');
      } else {
        setActiveTab('overview');
      }
    }
  }, [session?.role, session?.membershipRole]);

  useEffect(() => {
    if (customerRestaurantId) return;
    // Existing sessions on old bookmarks must not keep a staff workspace on
    // the administrator host (or an administrator workspace on the staff host).
    if (session?.restaurantId && session.role !== 'admin' && window.location.hostname === 'menu.novx-team.com') {
      window.location.replace(staffPortalUrl(session.restaurantId, session.role));
      return;
    }
    if (session?.role === 'admin' && window.location.hostname === 'rest.ordova.cc') {
      window.location.replace('https://menu.novx-team.com/');
      return;
    }
    if (session?.restaurantId && session.role !== 'admin') {
      selectStaffPortal(session.role, session.restaurantId);
    } else if (session?.role === 'admin') {
      const url = new URL(window.location.href);
      url.searchParams.delete('loginRestaurantId');
      url.searchParams.delete('portal');
      window.history.replaceState(window.history.state, '', url);
      updateHomeScreenLink();
    }
  }, [session?.role, session?.restaurantId, customerRestaurantId]);

  useEffect(() => {
    if (!session?.restaurantId || session.role === 'admin') {
      setWorkspaceTheme(DEFAULT_THEME);
      return;
    }

    return onSnapshot(
      doc(db, 'restaurants', session.restaurantId),
      (snapshot) => {
        const restaurant = snapshot.data();
        setWorkspaceTheme(resolveTheme(restaurant?.themeId, restaurant?.themeColors));
      },
      (error) => {
        console.error('Unable to load restaurant workspace theme:', error);
        setWorkspaceTheme(DEFAULT_THEME);
      },
    );
  }, [session?.restaurantId, session?.role]);

  useEffect(() => {
    if (!session) return;
    return onSnapshot(doc(db, 'settings', 'support'), (snapshot) => {
      const logoUrl = snapshot.data()?.logoUrl || '';
      setSystemLogo(logoUrl);
      if (logoUrl) localStorage.setItem('novix_system_logo', logoUrl);
      else localStorage.removeItem('novix_system_logo');
    }, (error) => console.warn('Unable to load system branding:', error));
  }, [session?.role]);

  const handleLogin = (user: UserSession) => {
    setSession(user);
    localStorage.setItem('novx_session', JSON.stringify(user));
  };

  const handleLogout = () => {
    supabase.auth.signOut().then(({ error }) => error && console.error(error));
    setSession(null);
    localStorage.removeItem('novx_session');
    // Clear URL if in customer mode
    if (customerRestaurantId) {
      window.history.replaceState({}, '', window.location.pathname);
      setCustomerRestaurantId(null);
    }
  };

  // If URL has restaurantId, show Customer Menu directly
  const loadingView = <p className="p-4 text-sm font-semibold text-text-muted" role="status">{tr('جارٍ التحميل…', 'Loading…')}</p>;
  if (customerRestaurantId) {
    return <div dir={dir}><React.Suspense fallback={loadingView}><CustomerMenu restaurantId={customerRestaurantId} /><div key={`customer-${customerRestaurantId}`}><FirstVisitGuide role="customer" restaurantId={customerRestaurantId} /></div></React.Suspense><SystemNotice message={appAlert} onClose={() => setAppAlert(null)} /></div>;
  }

  if (!session) {
    return <div dir={dir}><React.Suspense fallback={loadingView}>{checkingSession ? loadingView : <LoginPage onLogin={handleLogin} />}</React.Suspense><SystemNotice message={appAlert} onClose={() => setAppAlert(null)} /></div>;
  }

  const menuItems = {
    admin: [
      { id: 'overview', label: tr('الرئيسية', 'Home'), icon: <LayoutDashboard className="w-5 h-5" /> },
      { id: 'restaurants', label: tr('المطاعم', 'Restaurants'), icon: <Building2 className="w-5 h-5" /> },
      { id: 'finance', label: tr('المالية', 'Finance'), icon: <Wallet className="w-5 h-5" /> },
      { id: 'settings', label: tr('الإعدادات', 'Settings'), icon: <Settings className="w-5 h-5" /> },
      { id: 'ai', label: tr('إدارة AI', 'AI'), icon: <Cpu className="w-5 h-5" /> },
      { id: 'alerts', label: tr('التنبيهات', 'Alerts'), icon: <Bell className="w-5 h-5" /> },
    ],
    restaurant: [
      { id: 'overview', label: tr('الرئيسية', 'Home'), icon: <BarChart3 className="w-5 h-5" /> },
      { id: 'waiters', label: tr('الموظفين', 'Staff'), icon: <Users className="w-5 h-5" /> },
      { id: 'menu', label: tr('المنيو', 'Menu'), icon: <Utensils className="w-5 h-5" /> },
      ...(session.membershipRole === 'owner' ? [{ id: 'whatsapp', label: tr('طلبات واتساب', 'WhatsApp AI'), icon: <MessageSquare className="w-5 h-5" /> }] : []),
      ...(['owner', 'manager'].includes(session.membershipRole || '') ? [
        { id: 'loyalty', label: tr('الولاء', 'Loyalty'), icon: <Gift className="w-5 h-5" /> },
      ] : []),
      { id: 'qr', label: tr('الباركود', 'QR'), icon: <QrCode className="w-5 h-5" /> },
      { id: 'floor', label: tr('خريطة الطاولات', 'Table layout'), icon: <MapPin className="w-5 h-5" /> },
      { id: 'orders', label: tr('الطلبات', 'Orders'), icon: <ClipboardList className="w-5 h-5" /> },
      { id: 'archive', label: tr('الأرشيف', 'Archive'), icon: <History className="w-5 h-5" /> },
      { id: 'alerts', label: tr('التنبيهات', 'Alerts'), icon: <ShieldAlert className="w-5 h-5" /> },
      { id: 'theme', label: tr('هوية المطعم', 'Branding'), icon: <Palette className="w-5 h-5" /> },
      { id: 'help', label: tr('المساعدة', 'Help'), icon: <HelpingHand className="w-5 h-5" /> },
    ],
    waiter: [
       { id: 'orders', label: tr('طلباتي', 'My orders'), icon: <ClipboardList className="w-5 h-5" /> },
    ],
    kitchen: [
       { id: 'orders', label: tr('طلبات المطبخ', 'Kitchen orders'), icon: <ChefHat className="w-5 h-5" /> },
    ],
    cashier: [
       { id: 'overview', label: tr('الكاشير', 'Cashier'), icon: <Wallet className="w-5 h-5" /> },
    ],
  };

  const currentMenuItems = menuItems[session.role] || [];

  return (
    <SubscriptionGuard session={session}>
    <div
      className={`workspace-theme ${session.role === 'admin' ? 'admin-shell' : 'partner-shell'} min-h-screen bg-bg-paper font-sans text-text-main selection:bg-brand-primary/10 flex overflow-hidden`}
      data-workspace-theme={workspaceTheme.id}
      style={themeStyle(workspaceTheme)}
      dir={dir}
    >
      {/* Mobile Backdrop Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Persistent Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? '320px' : '0px', opacity: isSidebarOpen ? 1 : 0 }}
        className="workspace-sidebar workspace-shell-panel fixed inset-y-0 right-0 z-50 hidden flex-col overflow-hidden whitespace-nowrap border-l border-border-delicate shadow-2xl lg:relative lg:flex lg:h-screen lg:min-h-0"
      >
        {/* Sidebar Banner */}
        <div className="relative flex shrink-0 flex-col items-center overflow-hidden p-8 pb-8">
          <div className="absolute top-0 left-0 w-full h-[2px] bg-brand-gold opacity-30" />
          
          {/* Mobile Close Button */}
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-6 left-6 p-2 text-brand-primary/60 hover:text-brand-primary lg:hidden"
          >
            <X className="w-6 h-6" />
          </button>

          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-primary p-2"
          >
            <img src={systemLogo || DEFAULT_SYSTEM_LOGO} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </motion.div>
          <div className="text-center">
            <h1 className="mb-2 font-display text-2xl font-bold leading-none tracking-tight text-brand-primary">{BRAND_NAME}</h1>
            <p className="text-xs text-text-muted font-bold">{session.role === 'admin' ? tr('لوحة الإدارة', 'Admin dashboard') : tr('لوحة إدارة المطعم', 'Restaurant workspace')}</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="sidebar-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain px-4">
          <div className="mb-5">
             <div className="mb-3 flex items-center gap-3 px-3">
                <span className="w-8 h-[1px] bg-brand-gold" />
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.3em]">{tr('أقسام النظام', 'Workspace')}</p>
             </div>
             {currentMenuItems.map((item) => (
               <button
                 key={item.id}
                 onClick={() => {
                   setActiveTab(item.id);
                   if (window.innerWidth < 1024) setIsSidebarOpen(false);
                 }}
                 className={`relative flex w-full items-center gap-4 overflow-hidden rounded-xl px-4 py-3 transition-colors ${activeTab === item.id ? 'bg-brand-primary font-bold text-white' : 'text-text-muted hover:bg-bg-paper hover:text-brand-primary'}`}
               >
                 <span className={activeTab === item.id ? 'text-white' : 'text-brand-gold'}>
                    {item.icon}
                 </span>
                 <span className="font-display text-base">{item.label}</span>
               </button>
             ))}
          </div>

          <div className="pt-12 border-t border-border-delicate">
             <button
               onClick={handleLogout}
               className="w-full flex items-center gap-6 px-8 py-6 text-text-muted hover:text-red-800 transition-all group font-display text-lg italic"
             >
               <LogOut className="w-5 h-5 opacity-40 group-hover:opacity-100 transition-opacity" />
               <span>{tr('تسجيل الخروج', 'Sign out')}</span>
             </button>
             <button
               onClick={toggleLanguage}
               className="w-full flex items-center gap-6 px-8 py-4 text-text-muted hover:text-brand-primary transition-all font-display text-base"
             >
               <Languages className="w-5 h-5 opacity-60" />
               <span>{isEnglish ? 'العربية' : 'English'}</span>
             </button>
          </div>
        </nav>

        {/* Sidebar Footer User Info */}
        <div className="shrink-0 border-t border-border-delicate bg-bg-paper p-6 lg:p-8">
           <div className="flex items-center gap-5">
              <div className="w-12 h-12 rounded-full border border-brand-gold/30 flex items-center justify-center font-display italic text-brand-primary bg-white">
                 {session.name?.[0] || session.role[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-display text-brand-primary italic truncate">{session.name || session.role}</p>
                <p className="text-[9px] text-brand-gold uppercase tracking-[0.3em] font-bold truncate opacity-80">{session.restaurantName || tr('بوابة المسؤول', 'Staff portal')}</p>
              </div>
           </div>
        </div>
      </motion.aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Mobile Header */}
        <header className="workspace-shell-panel lg:hidden flex items-center justify-between px-5 py-3 border-b border-border-delicate relative z-40">
           <div className="flex items-center gap-4">
              <img src={systemLogo || DEFAULT_SYSTEM_LOGO} alt="" className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
              <span className="text-xl font-display font-bold tracking-tight text-brand-primary">{BRAND_NAME}</span>
           </div>
           <div className="flex items-center gap-1">
             <button onClick={toggleLanguage} className="min-w-12 h-11 px-3 flex items-center justify-center gap-1 text-brand-primary border border-border-delicate" aria-label={tr('تغيير اللغة', 'Change language')}>
               <Languages className="w-5 h-5" /><span className="text-[10px] font-bold">{isEnglish ? 'AR' : 'EN'}</span>
             </button>
             <button onClick={handleLogout} className="w-11 h-11 flex items-center justify-center text-red-700 border border-border-delicate" aria-label={tr('تسجيل الخروج', 'Sign out')}>
               <LogOut className="w-5 h-5" />
             </button>
           </div>
        </header>

        {/* Desktop Header */}
        <header className="workspace-shell-panel hidden items-center justify-between border-b border-border-delicate px-10 py-5 backdrop-blur-sm lg:flex">
           <div className="flex items-center gap-6">
              <h2 className="font-display text-2xl font-bold text-brand-primary">
                {currentMenuItems.find(m => m.id === activeTab)?.label || tr('الرئيسية', 'Home')}
              </h2>
              <div className="w-[1px] h-10 bg-brand-gold/20" />
              <span className="text-[10px] text-brand-gold font-bold uppercase tracking-[0.5em]">{
                session.role === 'admin' ? tr('الإدارة العامة', 'Administration') :
                session.role === 'restaurant' ? tr('إدارة المطعم', 'Restaurant management') :
                session.role === 'waiter' ? tr('قسم الخدمة', 'Service') :
                session.role === 'cashier' ? tr('قسم الكاشير', 'Cashier') : tr('لوحة المطبخ', 'Kitchen')
              }</span>
           </div>
           
           <div className="flex items-center gap-2">
             <button type="button" onClick={toggleLanguage} className="rounded-xl border border-border-delicate px-4 py-2 text-sm font-bold text-brand-primary">{isEnglish ? 'العربية' : 'English'}</button>
             <button type="button" onClick={handleLogout} className="rounded-xl border border-border-delicate px-4 py-2 text-sm font-bold text-red-700">{tr('خروج', 'Sign out')}</button>
           </div>
         </header>


        {/* Viewport for Dashboard Pages */}
        <main className="no-scrollbar flex-1 overflow-y-auto bg-bg-paper px-4 pb-28 pt-5 sm:p-8 lg:px-10 lg:py-8">
          <React.Suspense fallback={loadingView}>
          <AnimatePresence mode="wait">
            {session.role === 'admin' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key={`admin-${activeTab}`}
              >
                <AdminDashboard activeTab={activeTab as any} onNavigate={setActiveTab} />
              </motion.div>
            )}
            {session.role === 'restaurant' && session.restaurantId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key={`restaurant-${activeTab}`}
              >
                {activeTab === 'whatsapp' && session.membershipRole === 'owner' ? (
                  <React.Suspense fallback={<p role="status">{tr('جارٍ التحميل…', 'Loading…')}</p>}>
                    <WhatsAppSettings key={session.restaurantId} restaurantId={session.restaurantId} />
                  </React.Suspense>
                ) : activeTab === 'loyalty' && ['owner', 'manager'].includes(session.membershipRole || '') ? (
                  <React.Suspense fallback={<p role="status">{tr('جارٍ التحميل…', 'Loading…')}</p>}>
                    <LoyaltyManagement key={session.restaurantId} restaurantId={session.restaurantId} manage />
                  </React.Suspense>
                ) : activeTab === 'floor' ? (
                  <FloorPlanSettings key={session.restaurantId} restaurantId={session.restaurantId} onQrSettings={() => setActiveTab('qr')} />
                ) : (
                  <RestaurantDashboard restaurantId={session.restaurantId} activeTab={activeTab as any} onThemeChange={(restaurant) => setWorkspaceTheme(resolveTheme(restaurant.themeId, restaurant.themeColors))} />
                )}
              </motion.div>
            )}
            {session.role === 'waiter' && session.restaurantId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key="waiter"
              >
                <WaiterDashboard restaurantId={session.restaurantId} />
              </motion.div>
            )}
            {session.role === 'kitchen' && session.restaurantId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key="kitchen"
              >
                <KitchenDashboard restaurantId={session.restaurantId} />
              </motion.div>
            )}
            {session.role === 'cashier' && session.restaurantId && (
              <CashierDashboard key={session.restaurantId} restaurantId={session.restaurantId} />
            )}
          </AnimatePresence>
          </React.Suspense>
        </main>
      </div>

      {session.role !== 'waiter' && session.role !== 'kitchen' && session.role !== 'cashier' && (
        <nav ref={mobileNavRef} className="mobile-bottom-nav lg:hidden fixed bottom-[calc(.5rem+env(safe-area-inset-bottom))] inset-x-3 z-50 flex items-stretch gap-1 overflow-x-auto rounded-2xl border border-border-delicate workspace-shell-panel p-2 shadow-[0_10px_30px_rgba(0,0,0,.16)]" aria-label={tr('التنقل الرئيسي', 'Main navigation')}>
          {currentMenuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`min-w-[72px] flex-1 h-16 px-2 flex flex-col items-center justify-center gap-1 rounded-2xl transition-colors ${activeTab === item.id ? 'bg-brand-primary text-white' : 'text-text-muted'}`}
            >
              {item.icon}
              <span className="text-[10px] font-bold whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      <div key={`${session.role}-${session.restaurantId || 'system'}`}><FirstVisitGuide role={session.role} restaurantId={session.restaurantId} /></div>
      <SystemNotice message={appAlert} onClose={() => setAppAlert(null)} />

      {/* Decorative Accents */}
      <div className="fixed top-12 left-12 w-24 h-24 border-t border-l border-brand-gold/20 pointer-events-none opacity-40 z-0" />
      <div className="fixed bottom-12 left-12 w-24 h-24 border-b border-l border-brand-gold/20 pointer-events-none opacity-40 z-0" />
    </div>
    </SubscriptionGuard>
  );
}

function SystemNotice({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return <div role="alert" className="fixed end-4 top-4 z-[500] flex max-w-[min(26rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-brand-gold/30 bg-white p-4 text-sm text-brand-primary shadow-2xl">
    <Bell className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
    <p className="flex-1 whitespace-pre-wrap leading-relaxed">{message}</p>
    <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded-full p-1 hover:bg-bg-paper"><X className="h-4 w-4" /></button>
  </div>;
}

