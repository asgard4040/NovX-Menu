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
  Search, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Smartphone,
  ChevronRight,
  Menu as MenuIcon,
  X,
  CreditCard,
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
  Languages,
} from 'lucide-react';
import { UserSession } from './types';
import { supabase } from './lib/supabase';
import AdminDashboard from './components/AdminDashboard';
import RestaurantDashboard from './components/RestaurantDashboard';
import WaiterDashboard from './components/WaiterDashboard';
import KitchenDashboard from './components/KitchenDashboard';
import CustomerMenu from './components/CustomerMenu';
import LoginPage from './components/LoginPage';
import FirstVisitGuide from './components/FirstVisitGuide';
import { db, doc, onSnapshot } from './lib/supabase-db';
import { DEFAULT_THEME, resolveTheme, themeStyle } from './lib/themes';
import type { MenuTheme } from './lib/themes';
import { useLanguage } from './lib/i18n';
import { selectStaffPortal, updateHomeScreenLink } from './lib/home-screen';
import { BRAND_NAME, DEFAULT_SYSTEM_LOGO } from './lib/brand';

export default function App() {
  const { dir, isEnglish, toggleLanguage, tr } = useLanguage();
  const [session, setSession] = useState<UserSession | null>(null);
  const [customerRestaurantId, setCustomerRestaurantId] = useState<string | null>(null);
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
    
    // Check for QR code in URL (e.g., ?restaurantId=...)
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('restaurantId');
    if (rid) {
      setCustomerRestaurantId(rid);
    }
    
    // Rebuild UI authorization from the authenticated server identity. Never
    // trust the role or restaurant stored by the browser.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { localStorage.removeItem('novx_session'); return; }
      try {
        const response = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
        if (response.ok) {
          const verifiedSession = await response.json() as UserSession;
          setSession(verifiedSession);
          localStorage.setItem('novx_session', JSON.stringify(verifiedSession));
          return;
        }
        if (response.status === 401 || response.status === 403) {
          await supabase.auth.signOut();
          localStorage.removeItem('novx_session');
          setSession(null);
          return;
        }
      } catch (e) {
        console.warn('Session verification network error, trying fallback:', e);
      }

      // Fallback verification from client Supabase session
      const user = data.session.user;
      if (user.app_metadata?.system_role === 'admin') {
        const fallbackSession: UserSession = { role: 'admin', id: user.id, name: user.user_metadata?.name || 'admin' };
        setSession(fallbackSession);
        localStorage.setItem('novx_session', JSON.stringify(fallbackSession));
      } else {
        const cached = localStorage.getItem('novx_session');
        if (cached) {
          try { setSession(JSON.parse(cached)); } catch {}
        }
      }
    });
  }, []);

  useEffect(() => {
    // Reset tab to overview on login/logout
    if (session) {
      if (session.role === 'kitchen') {
        setActiveTab('orders');
      } else {
        setActiveTab('overview');
      }
    }
  }, [session?.role]);

  useEffect(() => {
    if (customerRestaurantId) return;
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
  if (customerRestaurantId) {
    return <div dir={dir}><CustomerMenu restaurantId={customerRestaurantId} /><div key={`customer-${customerRestaurantId}`}><FirstVisitGuide role="customer" restaurantId={customerRestaurantId} /></div><SystemNotice message={appAlert} onClose={() => setAppAlert(null)} /></div>;
  }

  if (!session) {
    return <div dir={dir}><LoginPage onLogin={handleLogin} /><SystemNotice message={appAlert} onClose={() => setAppAlert(null)} /></div>;
  }

  const menuItems = {
    admin: [
      { id: 'overview', label: tr('الرئيسية', 'Home'), icon: <LayoutDashboard className="w-5 h-5" /> },
      { id: 'restaurants', label: tr('المطاعم', 'Restaurants'), icon: <Building2 className="w-5 h-5" /> },
      { id: 'ai', label: tr('إدارة AI', 'AI'), icon: <Cpu className="w-5 h-5" /> },
      { id: 'alerts', label: tr('التنبيهات', 'Alerts'), icon: <Bell className="w-5 h-5" /> },
    ],
    restaurant: [
      { id: 'overview', label: tr('الرئيسية', 'Home'), icon: <BarChart3 className="w-5 h-5" /> },
      { id: 'waiters', label: tr('الموظفين', 'Staff'), icon: <Users className="w-5 h-5" /> },
      { id: 'orders', label: tr('الطلبات', 'Orders'), icon: <ClipboardList className="w-5 h-5" /> },
      { id: 'archive', label: tr('الأرشيف', 'Archive'), icon: <History className="w-5 h-5" /> },
      { id: 'alerts', label: tr('التنبيهات', 'Alerts'), icon: <ShieldAlert className="w-5 h-5" /> },
      { id: 'menu', label: tr('المنيو', 'Menu'), icon: <Utensils className="w-5 h-5" /> },
      { id: 'theme', label: tr('هوية المطعم', 'Branding'), icon: <Palette className="w-5 h-5" /> },
      { id: 'qr', label: tr('الباركود', 'QR'), icon: <QrCode className="w-5 h-5" /> },
      { id: 'help', label: tr('المساعدة', 'Help'), icon: <HelpingHand className="w-5 h-5" /> },
    ],
    waiter: [
       { id: 'orders', label: tr('طلباتي', 'My orders'), icon: <ClipboardList className="w-5 h-5" /> },
    ],
    kitchen: [
       { id: 'orders', label: tr('طلبات المطبخ', 'Kitchen orders'), icon: <ChefHat className="w-5 h-5" /> },
    ]
  };

  const currentMenuItems = menuItems[session.role] || [];

  return (
    <div
      className={`workspace-theme ${session.role === 'admin' ? 'admin-shell' : ''} min-h-screen bg-bg-paper font-sans text-text-main selection:bg-brand-primary/10 flex overflow-hidden`}
      data-workspace-theme={workspaceTheme.id}
      style={themeStyle(workspaceTheme)}
      dir={dir}
    >
      {/* Texture Overlay */}
      {session.role !== 'admin' && <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-[100] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />}

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
            className={session.role === 'admin' ? 'w-14 h-14 bg-brand-primary rounded-2xl flex items-center justify-center mb-4 p-2' : 'w-20 h-20 bg-brand-primary rounded-2xl flex items-center justify-center mb-8 shadow-xl p-3'}
          >
            <img src={systemLogo || DEFAULT_SYSTEM_LOGO} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </motion.div>
          <div className="text-center">
            <h1 className={session.role === 'admin' ? 'text-2xl font-display font-bold text-brand-primary leading-none mb-2 tracking-tight' : 'text-4xl font-display font-bold text-brand-primary leading-none mb-4 tracking-tight'}>{BRAND_NAME}</h1>
            <p className="text-xs text-text-muted font-bold">{session.role === 'admin' ? tr('لوحة الإدارة', 'Admin dashboard') : tr('لوحة إدارة المطعم', 'Restaurant workspace')}</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className={session.role === 'admin' ? 'sidebar-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain px-4' : 'sidebar-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain px-8'}>
          <div className={session.role === 'admin' ? 'mb-5' : 'mb-10'}>
             <div className={session.role === 'admin' ? 'flex items-center gap-3 mb-3 px-3' : 'flex items-center gap-3 mb-8'}>
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
                 className={session.role === 'admin'
                   ? `w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-colors relative group overflow-hidden ${activeTab === item.id ? 'bg-brand-primary text-white font-bold' : 'text-text-muted hover:text-brand-primary hover:bg-bg-paper'}`
                   : `w-full flex items-center gap-6 px-8 py-5 rounded-none transition-all relative group overflow-hidden border-b border-transparent hover:border-border-delicate ${activeTab === item.id ? 'text-brand-primary italic font-medium' : 'text-text-muted hover:text-brand-primary'}`}
               >
                 <span className={session.role === 'admin' ? (activeTab === item.id ? 'text-white' : 'text-brand-gold') : `transition-transform duration-700 ${activeTab === item.id ? 'scale-110 text-brand-gold' : 'group-hover:scale-110 opacity-40'}`}>
                    {item.icon}
                 </span>
                 <span className={session.role === 'admin' ? 'font-display text-base' : 'font-display text-xl tracking-tight'}>{item.label}</span>
                 {session.role !== 'admin' && activeTab === item.id && <motion.div layoutId="sidebarActiveInd" className="absolute left-0 w-1.5 h-full bg-brand-gold" />}
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
        <header className={session.role === 'admin' ? 'workspace-shell-panel hidden lg:flex items-center justify-between px-10 py-5 backdrop-blur-sm border-b border-border-delicate' : 'workspace-shell-panel hidden lg:flex items-center justify-between px-16 py-10 backdrop-blur-sm border-b border-border-delicate'}>
           <div className="flex items-center gap-6">
              <h2 className={session.role === 'admin' ? 'text-2xl font-display font-bold text-brand-primary' : 'text-5xl font-display text-brand-primary tracking-tight italic'}>
                {currentMenuItems.find(m => m.id === activeTab)?.label || tr('الرئيسية', 'Home')}
              </h2>
              <div className="w-[1px] h-10 bg-brand-gold/20" />
              <span className="text-[10px] text-brand-gold font-bold uppercase tracking-[0.5em]">{
                session.role === 'admin' ? tr('الإدارة العامة', 'Administration') :
                session.role === 'restaurant' ? tr('إدارة المطعم', 'Restaurant management') :
                session.role === 'waiter' ? tr('قسم الخدمة', 'Service') : tr('لوحة المطبخ', 'Kitchen')
              }</span>
           </div>
           
           {session.role === 'admin' ? <div className="flex items-center gap-2">
             <button type="button" onClick={toggleLanguage} className="rounded-xl border border-border-delicate px-4 py-2 text-sm font-bold text-brand-primary">{isEnglish ? 'العربية' : 'English'}</button>
             <button type="button" onClick={handleLogout} className="rounded-xl border border-border-delicate px-4 py-2 text-sm font-bold text-red-700">{tr('خروج', 'Sign out')}</button>
           </div> : <div className="flex items-center gap-12">
              <div className="relative group">
                 <Search className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted/30 group-focus-within:text-brand-primary transition-colors" />
                 <input 
                  type="text" 
                  placeholder={tr('البحث الشامل...', 'Search...')}
                  className="bg-transparent border-b border-border-delicate px-8 py-3 text-sm focus:outline-none focus:border-brand-primary transition-all w-80 font-light italic"
                 />
              </div>
              <div className="flex items-center gap-4">
                 <div className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-pulse" />
                 <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-[0.3em]">{tr('نشط ومستمر', 'Live')}</span>
              </div>
           </div>}
         </header>


        {/* Viewport for Dashboard Pages */}
        <main className={session.role === 'admin' ? 'flex-1 overflow-y-auto px-4 pt-5 pb-28 sm:p-8 lg:px-10 lg:py-8 no-scrollbar bg-bg-paper' : 'flex-1 overflow-y-auto px-4 pt-5 pb-28 sm:p-8 lg:p-20 no-scrollbar bg-bg-paper'}>
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
                <RestaurantDashboard restaurantId={session.restaurantId} activeTab={activeTab as any} onThemeChange={(restaurant) => setWorkspaceTheme(resolveTheme(restaurant.themeId, restaurant.themeColors))} />
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
          </AnimatePresence>
        </main>
      </div>

      {session.role !== 'waiter' && session.role !== 'kitchen' && (
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

