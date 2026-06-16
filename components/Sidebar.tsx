
import React, { useState, useEffect } from 'react';
import { ICONS } from '../constants';
import { UserRole } from '../types';
import { api } from '../services/api';

interface SidebarProps {
  role: UserRole;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userName: string;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
  logoUrl?: string;
}

interface SidebarLink {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const Sidebar: React.FC<SidebarProps> = ({ role, activeTab, setActiveTab, userName, onLogout, isOpen, onClose, logoUrl }) => {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (role === UserRole.AGENT) {
      const user = api.auth.getCurrentUser();
      if (user) {
        const fetchUnread = async () => {
          const notifs = await api.notifications.getAll(user.id);
          setUnreadCount(notifs.filter(n => !n.isRead).length);
        };
        fetchUnread();
        const interval = setInterval(fetchUnread, 15000);
        return () => clearInterval(interval);
      }
    }
  }, [role, activeTab]);

  const adminLinks: SidebarLink[] = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: ICONS.Dashboard },
    { id: 'requests', label: 'إدارة الطلبات', icon: ICONS.MyRequests },
    { id: 'agents', label: 'إدارة المندوبين', icon: ICONS.Agents },
    { id: 'admins', label: 'إدارة المشرفين', icon: ICONS.Users },
    { id: 'leads', label: 'قاعدة البيانات', icon: ICONS.Institutions },
    { id: 'systems', label: 'الأنظمة والأسعار', icon: ICONS.Package },
    { id: 'reports', label: 'التقارير', icon: ICONS.Trend },
    { id: 'admin-profile', label: 'الملف الشخصي', icon: ICONS.Profile },
    { id: 'settings', label: 'الإعدادات', icon: ICONS.Settings },
  ];

  const agentLinks: SidebarLink[] = [
    { id: 'dashboard', label: 'الرئيسية', icon: ICONS.Dashboard },
    { id: 'send-request', label: 'ارسال طلب', icon: ICONS.SendRequest },
    { id: 'my-requests', label: 'طلباتي', icon: ICONS.MyRequests },
    { id: 'notifications', label: 'الإشعارات', icon: ICONS.Notification, badge: unreadCount },
    { id: 'names-list', label: 'قاعدة البيانات', icon: ICONS.Institutions },
    { id: 'profile', label: 'الملف الشخصي', icon: ICONS.Profile },
    { id: 'help', label: 'المساعدة', icon: ICONS.Info },
  ];

  const links = role === UserRole.AGENT ? agentLinks : adminLinks;

  const handleLinkClick = (id: string) => {
    setActiveTab(id);
    if (window.innerWidth < 1024) onClose();
  };

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      
      <aside className={`w-64 bg-black h-screen border-l border-[#1A1A1A] flex flex-col fixed right-0 top-0 z-50 transition-transform duration-300 lg:translate-x-0 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-10 flex flex-col items-center">
          <div className="relative group cursor-pointer">
            <div className="absolute -inset-1 bg-white rounded-[2rem] blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative w-23 h-23 bg-black border border-[#222] rounded-[2rem] flex items-center justify-center overflow-hidden shadow-2xl transition-transform group-hover:scale-105">
              <img 
                src={logoUrl || "https://picsum.photos/seed/novx/400/400"} 
                alt="System Logo" 
                className="w-full h-full object-contain p-2"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
          <div className="mt-6 text-center">
            <h1 className="font-black text-white text-xl tracking-widest">MANDOUBI</h1>
            <p className="text-[9px] text-gray-500 font-black tracking-[0.4em] uppercase mt-2">Core System</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <ul className="space-y-2">
            {links.map((link) => (
              <li key={link.id}>
                <button
                  onClick={() => handleLinkClick(link.id)}
                  className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-300 relative ${
                    activeTab === link.id
                      ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.2)]'
                      : 'text-gray-500 hover:text-white hover:bg-[#0A0A0A]'
                  }`}
                >
                  <span className="flex-shrink-0">{link.icon}</span>
                  <span className="font-bold text-xs uppercase tracking-wider">{link.label}</span>
                  {link.badge !== undefined && link.badge > 0 && (
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] font-black border-2 border-black">
                      {link.badge > 9 ? '+9' : link.badge}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-6 border-t border-[#111]">
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#0A0A0A] border border-[#111] mb-4">
            <div className="w-10 h-10 rounded-xl bg-white text-black flex items-center justify-center font-black text-sm">
              {userName.charAt(0)}
            </div>
            <div className="overflow-hidden">
              <p className="font-bold text-xs text-white truncate">{userName}</p>
              <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">{role}</p>
            </div>
          </div>
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-3.5 text-[10px] font-black text-gray-400 hover:text-white transition-colors uppercase tracking-[0.2em]"
          >
            {ICONS.Logout}
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
