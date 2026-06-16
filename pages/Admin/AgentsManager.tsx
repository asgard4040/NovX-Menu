
import React, { useState } from 'react';
import { User, SalesRequest, RequestStatus, UserRole } from '../../types';
import { ICONS } from '../../constants';

interface AgentsManagerProps {
  agents: User[];
  requests: SalesRequest[];
  onToggleStatus: (id: string) => void;
  onCreate: (agent: Omit<User, 'id' | 'status' | 'role'>) => void;
  onUpdate: (id: string, updates: Partial<User>) => void;
  currentUser?: User | null; // إضافة المستخدم الحالي للتحقق من الصلاحيات
}

const AgentsManager: React.FC<AgentsManagerProps> = ({ agents, requests, onToggleStatus, onCreate, onUpdate, currentUser }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    email: '',
    city: '',
    phone: ''
  });

  const isDirector = currentUser?.role === UserRole.ADMIN;

  const handleOpenCreate = () => {
    setEditingAgent(null);
    setFormData({ name: '', username: '', password: '', email: '', city: '', phone: '' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (agent: User) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      username: agent.username,
      password: agent.password || '',
      email: agent.email || '',
      city: agent.city || '',
      phone: agent.phone || ''
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // إذا لم يكن مديراً، نحذف كلمة المرور من التحديث لضمان عدم تغييرها بالخطأ
    const payload = { ...formData };
    if (!isDirector && editingAgent) {
      delete (payload as any).password;
    }
    
    if (editingAgent) {
      onUpdate(editingAgent.id, payload);
    } else {
      onCreate(payload);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-center justify-between bg-[#0A0A0A] p-8 rounded-[2.5rem] border border-[#1A1A1A] gap-6">
        <div>
          <h3 className="text-2xl font-black text-white tracking-tighter uppercase">فريق العمل الميداني</h3>
          <p className="text-[10px] text-gray-600 mt-1 font-black uppercase tracking-[0.4em]">إدارة صلاحيات وأداء المناديب</p>
        </div>
        <button 
          onClick={handleOpenCreate}
          className="bg-white text-black px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all active:scale-95 w-full md:w-auto text-center"
        >
          إضافة مندوب جديد
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {agents.map(agent => {
          const agentRequests = requests.filter(r => r.agentId === agent.id);
          const acceptedCount = agentRequests.filter(r => r.status === RequestStatus.ACCEPTED).length;
          
          return (
            <div key={agent.id} className="bg-[#0A0A0A] p-6 rounded-[2.5rem] border border-[#1A1A1A] flex flex-col md:flex-row items-center gap-6 group hover:border-white/10 transition-all">
              <div className="flex items-center gap-5 flex-1 w-full">
                <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-xl font-black border transition-all ${agent.status === 'ACTIVE' ? 'bg-black border-[#222] text-white group-hover:bg-white group-hover:text-black' : 'bg-black border-red-900/20 text-red-500'}`}>
                  {agent.name.charAt(0)}
                </div>
                <div className="overflow-hidden">
                  <h4 className="font-black text-lg text-white tracking-tighter uppercase truncate">{agent.name}</h4>
                  <div className="flex items-center gap-3 text-[10px] text-gray-600 font-bold mt-1 uppercase tracking-wider">
                    <span className="truncate">@{agent.username}</span>
                    <span>•</span>
                    <span>{agent.city}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-10 px-10 border-x border-[#111] py-2">
                <div className="text-center">
                  <p className="text-[8px] text-gray-700 font-black uppercase tracking-widest mb-1">الطلبات</p>
                  <p className="font-black text-xl text-white tracking-tighter">{agentRequests.length}</p>
                </div>
                <div className="text-center">
                  <p className="text-[8px] text-gray-700 font-black uppercase tracking-widest mb-1">المبيعات</p>
                  <p className="font-black text-xl text-white tracking-tighter">{acceptedCount}</p>
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto">
                <button 
                  onClick={() => handleOpenEdit(agent)}
                  className="flex-1 md:flex-none px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest bg-white/5 text-white hover:bg-white hover:text-black transition-all"
                >
                  تعديل
                </button>
                <button 
                  onClick={() => onToggleStatus(agent.id)}
                  className={`flex-1 md:flex-none px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                    agent.status === 'ACTIVE' ? 'bg-red-900/10 text-red-500 hover:bg-red-600 hover:text-white' : 'bg-green-900/10 text-green-500 hover:bg-green-600 hover:text-white'
                  }`}
                >
                  {agent.status === 'ACTIVE' ? 'إيقاف' : 'تفعيل'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-[100] p-6 overflow-y-auto">
          <div className="bg-[#0A0A0A] w-full max-w-xl rounded-[3.5rem] border border-white/5 shadow-2xl animate-in zoom-in duration-300">
            <form onSubmit={handleSubmit} className="p-10 space-y-8">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-3xl font-black text-white tracking-tighter uppercase italic">{editingAgent ? 'تعديل مندوب' : 'تسجيل مندوب جديد'}</h4>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-[0.4em] mt-1">Deployment Registry</p>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center hover:bg-white hover:text-black transition-all">
                  {ICONS.X}
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">الاسم الكامل</label>
                   <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 outline-none focus:border-white transition-all font-bold text-sm text-white" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">اسم المستخدم</label>
                    <input required type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 outline-none focus:border-white transition-all font-bold text-sm text-white" />
                  </div>
                  {/* إظهار حقل كلمة المرور للمدير فقط */}
                  {(isDirector || !editingAgent) && (
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">كلمة المرور</label>
                      <input required type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 outline-none focus:border-white transition-all font-bold text-sm text-white" />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">المدينة</label>
                    <input required type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 outline-none focus:border-white transition-all font-bold text-sm text-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">رقم الهاتف</label>
                    <input required type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 outline-none focus:border-white transition-all font-bold text-sm text-white" />
                  </div>
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <button type="submit" className="flex-1 bg-white text-black font-black py-5 rounded-3xl hover:shadow-[0_0_50px_rgba(255,255,255,0.2)] transition-all text-[11px] uppercase tracking-[0.4em]">حفظ التغييرات</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-8 py-5 text-[10px] font-black text-gray-600 uppercase tracking-widest hover:text-white">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentsManager;
