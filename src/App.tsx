/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  Bell
} from 'lucide-react';
import { UserSession } from './types';
import { auth } from './lib/firebase';
import { signInAnonymously } from 'firebase/auth';
import AdminDashboard from './components/AdminDashboard';
import RestaurantDashboard from './components/RestaurantDashboard';
import WaiterDashboard from './components/WaiterDashboard';
import KitchenDashboard from './components/KitchenDashboard';
import CustomerMenu from './components/CustomerMenu';
import LoginPage from './components/LoginPage';

export default function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [customerRestaurantId, setCustomerRestaurantId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    // Set initial sidebar state based on screen size
    setIsSidebarOpen(window.innerWidth >= 1024);
    
    // Ensure Firebase identity for security rules
    signInAnonymously(auth).catch((err) => {
      console.warn("Firebase Anonymous Auth is disabled. Please enable it in the Firebase Console to ensure full security.", err);
    });

    // Check for QR code in URL (e.g., ?restaurantId=...)
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('restaurantId');
    if (rid) {
      setCustomerRestaurantId(rid);
    }
    
    // Check local storage for persistent session
    const savedSession = localStorage.getItem('novx_session');
    if (savedSession) {
      setSession(JSON.parse(savedSession));
    }
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

  const handleLogin = (user: UserSession) => {
    setSession(user);
    localStorage.setItem('novx_session', JSON.stringify(user));
  };

  const handleLogout = () => {
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
    return <CustomerMenu restaurantId={customerRestaurantId} />;
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const menuItems = {
    admin: [
      { id: 'overview', label: 'الرئيسية', icon: <LayoutDashboard className="w-5 h-5" /> },
      { id: 'restaurants', label: 'المطاعم', icon: <Building2 className="w-5 h-5" /> },
      { id: 'ai', label: 'إدارة AI', icon: <Cpu className="w-5 h-5" /> },
      { id: 'alerts', label: 'التنبيهات', icon: <Bell className="w-5 h-5" /> },
    ],
    restaurant: [
      { id: 'overview', label: 'الرئيسية', icon: <BarChart3 className="w-5 h-5" /> },
      { id: 'waiters', label: 'الموظفين', icon: <Users className="w-5 h-5" /> },
      { id: 'orders', label: 'الطلبات', icon: <ClipboardList className="w-5 h-5" /> },
      { id: 'archive', label: 'أرشيف الوردية والطلبات', icon: <History className="w-5 h-5" /> },
      { id: 'alerts', label: 'التنبيهات', icon: <ShieldAlert className="w-5 h-5" /> },
      { id: 'menu', label: 'المنيو', icon: <Utensils className="w-5 h-5" /> },
      { id: 'qr', label: 'الباركود', icon: <QrCode className="w-5 h-5" /> },
      { id: 'help', label: 'المساعدة', icon: <HelpingHand className="w-5 h-5" /> },
    ],
    waiter: [
       { id: 'orders', label: 'طلباتي', icon: <ClipboardList className="w-5 h-5" /> },
    ],
    kitchen: [
       { id: 'orders', label: 'طلبات المطبخ', icon: <ChefHat className="w-5 h-5" /> },
    ]
  };

  const currentMenuItems = menuItems[session.role] || [];

  return (
    <div className="min-h-screen bg-bg-paper font-sans text-text-main selection:bg-brand-primary/10 flex overflow-hidden lg:rtl" dir="rtl">
      {/* Texture Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-[100] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />

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
        className="fixed inset-y-0 right-0 z-50 lg:relative bg-white border-l border-border-delicate shadow-2xl flex flex-col overflow-hidden whitespace-nowrap"
      >
        {/* Sidebar Banner */}
        <div className="p-12 pb-20 flex flex-col items-center relative overflow-hidden">
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
            className="w-20 h-20 bg-brand-primary rounded-full flex items-center justify-center mb-8 shadow-xl"
          >
            <Utensils className="text-white w-8 h-8" />
          </motion.div>
          <div className="text-center">
            <h1 className="text-4xl font-display text-brand-primary italic leading-none mb-4">نوفكس AI</h1>
            <p className="text-[9px] text-brand-gold font-bold uppercase tracking-[0.5em] opacity-80 italic">لوحة إدارة المطعم</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-8 space-y-2 overflow-y-auto no-scrollbar">
          <div className="mb-10">
             <div className="flex items-center gap-3 mb-8">
                <span className="w-8 h-[1px] bg-brand-gold" />
                <p className="text-[10px] font-bold text-brand-gold uppercase tracking-[0.3em]">أقسام النظام</p>
             </div>
             {currentMenuItems.map((item) => (
               <button
                 key={item.id}
                 onClick={() => {
                   setActiveTab(item.id);
                   if (window.innerWidth < 1024) setIsSidebarOpen(false);
                 }}
                 className={`w-full flex items-center gap-6 px-8 py-5 rounded-none transition-all relative group overflow-hidden border-b border-transparent hover:border-border-delicate ${
                   activeTab === item.id 
                    ? 'text-brand-primary italic font-medium' 
                    : 'text-text-muted hover:text-brand-primary'
                 }`}
               >
                 <span className={`transition-transform duration-700 ${activeTab === item.id ? 'scale-110 text-brand-gold' : 'group-hover:scale-110 opacity-40'}`}>
                    {item.icon}
                 </span>
                 <span className="font-display text-xl tracking-tight">{item.label}</span>
                 {activeTab === item.id && (
                   <motion.div layoutId="sidebarActiveInd" className="absolute left-0 w-1.5 h-full bg-brand-gold" />
                 )}
               </button>
             ))}
          </div>

          <div className="pt-12 border-t border-border-delicate">
             <button
               onClick={handleLogout}
               className="w-full flex items-center gap-6 px-8 py-6 text-text-muted hover:text-red-800 transition-all group font-display text-lg italic"
             >
               <LogOut className="w-5 h-5 opacity-40 group-hover:opacity-100 transition-opacity" />
               <span>تسجيل الخروج</span>
             </button>
          </div>
        </nav>

        {/* Sidebar Footer User Info */}
        <div className="p-10 bg-bg-paper mt-auto border-t border-border-delicate">
           <div className="flex items-center gap-5">
              <div className="w-12 h-12 rounded-full border border-brand-gold/30 flex items-center justify-center font-display italic text-brand-primary bg-white">
                 {session.name?.[0] || session.role[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-display text-brand-primary italic truncate">{session.name || session.role}</p>
                <p className="text-[9px] text-brand-gold uppercase tracking-[0.3em] font-bold truncate opacity-80">{session.restaurantName || 'بوابة المسؤول'}</p>
              </div>
           </div>
        </div>
      </motion.aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-8 bg-white border-b border-border-delicate relative z-40">
           <div className="flex items-center gap-4">
              <Utensils className="text-brand-primary w-6 h-6" />
              <span className="text-2xl font-display text-brand-primary italic">نوفكس</span>
           </div>
           <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-3 text-brand-primary">
              {isSidebarOpen ? <X className="w-7 h-7" /> : <MenuIcon className="w-7 h-7" />}
           </button>
        </header>

        {/* Desktop Header */}
        <header className="hidden lg:flex items-center justify-between px-16 py-10 bg-white/50 backdrop-blur-sm border-b border-border-delicate">
           <div className="flex items-center gap-6">
              <h2 className="text-5xl font-display text-brand-primary tracking-tight italic">
                {currentMenuItems.find(m => m.id === activeTab)?.label || 'الرئيسية'}
              </h2>
              <div className="w-[1px] h-10 bg-brand-gold/20" />
              <span className="text-[10px] text-brand-gold font-bold uppercase tracking-[0.5em]">{
                session.role === 'admin' ? 'الإدارة العامة' : 
                session.role === 'restaurant' ? 'إدارة المطعم' : 
                session.role === 'waiter' ? 'قسم الخدمة' : 'لوحة المطبخ'
              }</span>
           </div>
           
           <div className="flex items-center gap-12">
              <div className="relative group">
                 <Search className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted/30 group-focus-within:text-brand-primary transition-colors" />
                 <input 
                  type="text" 
                  placeholder="البحث الشامل..." 
                  className="bg-transparent border-b border-border-delicate px-8 py-3 text-sm focus:outline-none focus:border-brand-primary transition-all w-80 font-light italic text-right"
                 />
              </div>
              <div className="flex items-center gap-4">
                 <div className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-pulse" />
                 <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-[0.3em]">نشط ومستمر</span>
              </div>
           </div>
         </header>


        {/* Viewport for Dashboard Pages */}
        <main className="flex-1 overflow-y-auto p-8 lg:p-20 no-scrollbar bg-bg-paper">
          <AnimatePresence mode="wait">
            {session.role === 'admin' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key={`admin-${activeTab}`}
              >
                <AdminDashboard activeTab={activeTab as any} />
              </motion.div>
            )}
            {session.role === 'restaurant' && session.restaurantId && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                key={`restaurant-${activeTab}`}
              >
                <RestaurantDashboard restaurantId={session.restaurantId} activeTab={activeTab as any} />
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

      {/* Decorative Accents */}
      <div className="fixed top-12 left-12 w-24 h-24 border-t border-l border-brand-gold/20 pointer-events-none opacity-40 z-0" />
      <div className="fixed bottom-12 left-12 w-24 h-24 border-b border-l border-brand-gold/20 pointer-events-none opacity-40 z-0" />
    </div>
  );
}

