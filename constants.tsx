
import React from 'react';
import { 
  LayoutDashboard, 
  FilePlus, 
  ClipboardList, 
  Building2, 
  UserCircle, 
  Users, 
  Settings, 
  LogOut, 
  Bell, 
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  Package,
  MapPin,
  ChevronLeft,
  Filter,
  Download,
  Sparkles,
  Menu
} from 'lucide-react';

export const ICONS = {
  Dashboard: <LayoutDashboard size={20} />,
  SendRequest: <FilePlus size={20} />,
  MyRequests: <ClipboardList size={20} />,
  Institutions: <Building2 size={20} />,
  Profile: <UserCircle size={20} />,
  Agents: <Users size={20} />,
  // Fix: Added missing Users icon property to resolve compilation error in Sidebar.tsx
  Users: <Users size={20} />,
  Settings: <Settings size={20} />,
  Logout: <LogOut size={20} />,
  Notification: <Bell size={20} />,
  Search: <Search size={18} />,
  Check: <CheckCircle2 size={16} />,
  X: <XCircle size={16} />,
  Pending: <Clock size={16} />,
  Info: <AlertCircle size={16} />,
  Trend: <TrendingUp size={20} />,
  Package: <Package size={20} />,
  Location: <MapPin size={16} />,
  ChevronLeft: <ChevronLeft size={20} />,
  Filter: <Filter size={18} />,
  Download: <Download size={18} />,
  AI: <Sparkles size={18} />,
  Menu: <Menu size={24} />
};

export const COLORS = {
  primary: '#FFFFFF',
  secondary: '#9CA3AF',
  success: '#FFFFFF',
  danger: '#EF4444',
  warning: '#FBBF24',
  info: '#E5E7EB',
  bg: '#000000',
  cardBg: '#0A0A0A',
  border: '#1A1A1A'
};
