
import React, { useState, useEffect } from 'react';
import { UserRole, RequestStatus, SalesRequest, User, Institution, SystemProduct } from './types';
import Sidebar from './components/Sidebar';
import { ICONS } from './constants';
import { api } from './services/api';

// Pages
import AdminDashboard from './pages/Admin/AdminDashboard';
import RequestsManager from './pages/Admin/RequestsManager';
import AgentsManager from './pages/Admin/AgentsManager';
import AdminsManager from './pages/Admin/AdminsManager'; 
import LeadsManager from './pages/Admin/LeadsManager';
import SystemsManager from './pages/Admin/SystemsManager';
import ReportsGenerator from './pages/Admin/ReportsGenerator';
import AdminProfile from './pages/Admin/AdminProfile'; 
import AgentHome from './pages/Agent/AgentHome';
import SendRequest from './pages/Agent/SendRequest';
import MyRequests from './pages/Agent/MyRequests';
import PublicInstitutionsList from './pages/Agent/PublicInstitutionsList';
import AgentProfile from './pages/Agent/AgentProfile';
import Notifications from './pages/Agent/Notifications';
import Login from './pages/Login';
import SettingsPage from './pages/Admin/SettingsPage';
import HelpPage from './pages/Agent/HelpPage';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(api.auth.getCurrentUser());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [requests, setRequests] = useState<SalesRequest[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [systems, setSystems] = useState<SystemProduct[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);

  const [logoUrl, setLogoUrl] = useState('');
  const [supportPhone, setSupportPhone] = useState('');

  const loadSettings = async () => {
    try {
      const res = await api.settings.get();
      setLogoUrl(res.logoUrl || '');
      setSupportPhone(res.supportPhone || '');
    } catch (e) {
      console.error("Error loading settings:", e);
    }
  };

  useEffect(() => {
    // تأمين وجود المدير الافتراضي في قاعدة البيانات السحابية
    api.auth.seedAdmin();
    loadSettings();

    if (currentUser) {
      loadAllData();
      const statusInterval = setInterval(checkCurrentStatus, 30000);
      return () => clearInterval(statusInterval);
    }
  }, [currentUser]);

  const checkCurrentStatus = async () => {
    if (currentUser && currentUser.role === UserRole.AGENT) {
      try {
        const freshAgent = await api.agents.getById(currentUser.id);
        if (freshAgent && freshAgent.status === 'SUSPENDED') {
          alert("تم إيقاف حسابك من قبل الإدارة. سيتم تسجيل خروجك الآن.");
          handleLogout();
        }
      } catch (err) {
        console.error("Status check failed", err);
      }
    }
  };

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [reqs, insts, sys, agnts, admns] = await Promise.all([
        api.requests.getAll().catch(() => []),
        api.institutions.getAll().catch(() => []),
        api.systems.getAll().catch(() => []),
        api.agents.getAll().catch(() => []),
        api.admins.getAll().catch(() => [])
      ]);
      
      setRequests(Array.isArray(reqs) ? reqs : []);
      setInstitutions(Array.isArray(insts) ? insts : []);
      setSystems(Array.isArray(sys) ? sys : []);
      setAgents(Array.isArray(agnts) ? agnts : []);
      setAdmins(Array.isArray(admns) ? admns : []);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const user = await api.auth.login(username, password);
      if (user) {
        setCurrentUser(user);
        setActiveTab('dashboard');
      } else {
        alert("بيانات الدخول غير صحيحة.");
      }
    } catch (error: any) {
      alert("حدث خطأ أثناء تسجيل الدخول.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    api.auth.logout();
    setCurrentUser(null);
  };

  const handleCreateAgent = async (agent: Omit<User, 'id' | 'status' | 'role'>) => {
    setIsLoading(true);
    try {
      await api.agents.create(agent);
      await loadAllData();
      alert("تمت إضافة المندوب بنجاح.");
    } catch (error: any) {
      alert(`فشل في إضافة المندوب: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateAgent = async (id: string, updates: Partial<User>) => {
    setIsLoading(true);
    try {
      await api.agents.update(id, updates);
      await loadAllData();
    } catch (error: any) {
      alert(`فشل التحديث: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAdmin = async (admin: Omit<User, 'id' | 'status' | 'role'>) => {
    setIsLoading(true);
    try {
      await api.admins.create(admin);
      await loadAllData();
    } catch (error: any) {
      alert(`فشل إضافة المسؤول: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateAdmin = async (id: string, updates: Partial<User>) => {
    setIsLoading(true);
    try {
      await api.admins.update(id, updates);
      await loadAllData();
    } catch (error: any) {
      alert(`فشل التحديث: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = (updates: Partial<User>) => {
    if (currentUser) {
      const updatedUser = { ...currentUser, ...updates };
      setCurrentUser(updatedUser);
    }
  };

  const renderContent = () => {
    if (!currentUser) return <Login onLogin={handleLogin} logoUrlSetting={logoUrl} />;
    
    // Safety check for all data variables
    const safeRequests = Array.isArray(requests) ? requests : [];
    const safeInstitutions = Array.isArray(institutions) ? institutions : [];
    const safeSystems = Array.isArray(systems) ? systems : [];
    const safeAgents = Array.isArray(agents) ? agents : [];
    const safeAdmins = Array.isArray(admins) ? admins : [];

    if (currentUser.role === UserRole.AGENT) {
      switch (activeTab) {
        case 'dashboard': return <AgentHome user={currentUser} requests={safeRequests} systems={safeSystems} />;
        case 'send-request': return <SendRequest systems={safeSystems} onSend={async (r) => {
          setIsLoading(true);
          try {
            await api.requests.create({...r, agentId: currentUser.id, agentName: currentUser.name});
            await loadAllData();
            setActiveTab('my-requests');
          } finally { setIsLoading(false); }
        }} />;
        case 'my-requests': return <MyRequests requests={safeRequests.filter(r => r.agentId === currentUser.id)} />;
        case 'notifications': return <Notifications />;
        case 'names-list': return (
          <PublicInstitutionsList 
            institutions={safeInstitutions} 
            systems={safeSystems}
            onAddVisit={async (d) => {
              setIsLoading(true);
              try { 
                await api.institutions.create(d); 
                await loadAllData(); 
              } catch (err: any) {
                alert("حدث خطأ أثناء حفظ الزيارة: " + (err.message || "يرجى التحقق من الاتصال."));
              } finally { 
                setIsLoading(false); 
              }
            }} 
            onDelete={() => {}}
            currentUserName={currentUser.name}
          />
        );
        case 'profile': return <AgentProfile user={currentUser} requests={safeRequests.filter(r => r.agentId === currentUser.id)} systems={safeSystems} />;
        case 'help': return <HelpPage supportPhone={supportPhone} />;
        default: return <AgentHome user={currentUser} requests={safeRequests} systems={safeSystems} />;
      }
    } 
    else {
      switch (activeTab) {
        case 'dashboard': return <AdminDashboard requests={safeRequests} agents={safeAgents} systems={safeSystems} />;
        case 'requests': return <RequestsManager requests={safeRequests} updateStatus={async (id, s, r) => {
           setIsLoading(true);
           try { await api.requests.updateStatus(id, s, r); await loadAllData(); } finally { setIsLoading(false); }
        }} systems={safeSystems} />;
        case 'agents': return (
          <AgentsManager 
            agents={safeAgents} 
            requests={safeRequests} 
            onToggleStatus={async (id) => {
              setIsLoading(true);
              try { await api.agents.toggleStatus(id); await loadAllData(); } finally { setIsLoading(false); }
            }} 
            onCreate={handleCreateAgent}
            onUpdate={handleUpdateAgent}
            currentUser={currentUser}
          />
        );
        case 'admins': return <AdminsManager admins={safeAdmins} onCreate={handleCreateAdmin} onUpdate={handleUpdateAdmin} currentUser={currentUser} />;
        case 'leads': return <LeadsManager institutions={safeInstitutions} requests={safeRequests} onDelete={async (id) => {
           setIsLoading(true);
           try { await api.institutions.delete(id); await loadAllData(); } finally { setIsLoading(false); }
        }} />;
        case 'systems': return (
          <SystemsManager 
            systems={safeSystems} 
            onCreate={async (s) => { 
              setIsLoading(true); 
              try { 
                await api.systems.create(s); 
                await loadAllData(); 
                alert("تم إضافة النظام الجديد بنجاح.");
              } catch (e: any) {
                alert("فشل إضافة النظام: " + (e.message || "يرجى التأكد من تحديث جدول الأنظمة في SQL Editor"));
              } finally { 
                setIsLoading(false); 
              } 
            }}
            onUpdate={async (id, s) => { 
              setIsLoading(true); 
              try { 
                await api.systems.update(id, s); 
                await loadAllData(); 
              } catch (e: any) {
                alert("فشل تحديث النظام: " + e.message);
              } finally { 
                setIsLoading(false); 
              } 
            }}
            onDelete={async (id) => { 
              if (!confirm("هل أنت متأكد من حذف هذا النظام نهائياً؟")) return;
              setIsLoading(true); 
              try { 
                await api.systems.delete(id); 
                await loadAllData(); 
              } catch (error: any) {
                alert("فشل الحذف: قد يكون هذا النظام مرتبطاً بطلبات مبيعات سابقة. يجب حذف الطلبات المرتبطة به أولاً.");
              } finally { 
                setIsLoading(false); 
              } 
            }}
          />
        );
        case 'reports': return <ReportsGenerator requests={safeRequests} agents={safeAgents} systems={safeSystems} />;
        case 'admin-profile': return <AdminProfile user={currentUser} onUpdate={handleUpdateProfile} onResetData={loadAllData} />;
        case 'settings': return <SettingsPage onSettingsSaved={loadSettings} logoUrlSetting={logoUrl} supportPhoneSetting={supportPhone} />;
        default: return <AdminDashboard requests={safeRequests} agents={safeAgents} systems={safeSystems} />;
      }
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white selection:text-black" dir="rtl">
      {currentUser && (
        <Sidebar 
          role={currentUser.role} 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          userName={currentUser.name}
          onLogout={handleLogout}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          logoUrl={logoUrl}
        />
      )}
      <main className={`${currentUser ? 'lg:pr-64' : ''} transition-all duration-700 min-h-screen relative`}>
        {currentUser && (
          <header className="h-20 lg:h-24 bg-black/50 backdrop-blur-xl flex items-center justify-between px-6 lg:px-12 sticky top-0 z-30 border-b border-white/5">
            <div className="flex items-center gap-4">
              <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden w-10 h-10 flex items-center justify-center rounded-xl bg-white/5">
                {ICONS.Menu}
              </button>
              <h2 className="font-black text-white text-lg lg:text-2xl tracking-tighter uppercase italic">{activeTab}</h2>
            </div>
            <button onClick={() => setActiveTab('notifications')} className="w-10 h-10 lg:w-12 lg:h-12 bg-white/5 border border-white/5 text-white flex items-center justify-center rounded-xl lg:rounded-[1.2rem] hover:bg-white hover:text-black transition-all relative">
              {ICONS.Notification}
            </button>
          </header>
        )}
        
        {isLoading && !currentUser && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-[100]">
            <div className="w-24 h-24 bg-black border-2 border-white/10 rounded-[2.5rem] flex items-center justify-center overflow-hidden mb-8 animate-pulse shadow-2xl">
              <img 
                src="https://picsum.photos/seed/novx/400/400" 
                alt="NOVX Logo" 
                className="w-full h-full object-contain p-2"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="h-1 w-48 bg-white/5 rounded-full overflow-hidden">
               <div className="h-full bg-white animate-[loading_2s_infinite]"></div>
            </div>
            <style>{`
              @keyframes loading {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
              }
            `}</style>
          </div>
        )}

        <div className="p-4 sm:p-6 lg:p-12 max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
      
      {isLoading && currentUser && (
        <div className="fixed bottom-6 left-6 bg-white text-black px-6 py-3 rounded-2xl font-black text-[9px] uppercase tracking-[0.4em] z-50 animate-pulse-slow">Syncing Data...</div>
      )}
    </div>
  );
};

export default App;
