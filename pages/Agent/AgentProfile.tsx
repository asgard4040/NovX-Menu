
import React, { useState } from 'react';
import { User, SalesRequest, RequestStatus, SystemProduct } from '../../types';
import { ICONS } from '../../constants';
import { api } from '../../services/api';

interface AgentProfileProps {
  user: User;
  requests: SalesRequest[];
  systems: SystemProduct[];
}

const AgentProfile: React.FC<AgentProfileProps> = ({ user, requests, systems }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  
  const [formData, setFormData] = useState({
    name: user.name,
    city: user.city || '',
  });

  const acceptedRequests = requests.filter(r => r.status === RequestStatus.ACCEPTED);
  
  // حساب العمولة بناءً على فئات الاشتراك المخصصة لكل نظام
  const calculatedCommission = acceptedRequests.reduce((sum, req) => {
    const system = systems.find(s => s.id === req.systemId);
    if (!system) return sum;
    const tier = system.tiers.find(t => t.name === req.subscriptionType);
    return sum + (tier ? tier.commission : 0);
  }, 0);

  const stats = {
    total: requests.length,
    accepted: acceptedRequests.length,
    commission: calculatedCommission
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.auth.updateProfile(user.id, formData);
      setIsEditing(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      window.location.reload(); 
    } catch (error) {
      alert("تعذر تحديث البيانات");
    } finally {
      setIsSaving(false);
    }
  };

  const DefaultAvatar = () => (
    <svg viewBox="0 0 24 24" className="w-full h-full fill-gray-600">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 relative">
      <div className="bg-[#0A0A0A] rounded-[3.5rem] border border-white/5 overflow-hidden shadow-2xl relative">
        <div className="h-48 bg-gradient-to-b from-white/10 to-transparent relative overflow-hidden">
           <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
        </div>
        
        <div className="px-12 pb-12 -mt-20 relative z-10">
          <div className="flex flex-col md:flex-row items-center md:items-end justify-between gap-8">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-8 text-center md:text-right">
              <div className="relative">
                <div className="w-40 h-40 rounded-[3rem] bg-[#1a1a1a] border-4 border-[#0A0A0A] overflow-hidden shadow-2xl ring-1 ring-white/10 transition-all flex items-center justify-center p-4">
                  <DefaultAvatar />
                </div>
              </div>
              
              <div className="mb-4">
                {isEditing ? (
                  <input 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="bg-white/5 border-b-2 border-white outline-none text-3xl font-black text-white tracking-tighter uppercase italic w-full md:w-auto text-center md:text-right"
                  />
                ) : (
                  <h3 className="text-4xl font-black text-white tracking-tighter uppercase italic">{formData.name}</h3>
                )}
                <p className="text-[10px] text-gray-500 font-black uppercase tracking-[0.6em] mt-2">Field Operations Specialist</p>
              </div>
            </div>

            <div className="flex gap-4 mb-4">
              {isEditing ? (
                <>
                  <button onClick={handleSave} disabled={isSaving} className="bg-white text-black px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all">{isSaving ? 'جارِ الحفظ...' : 'حفظ التغييرات'}</button>
                  <button onClick={() => { setIsEditing(false); setFormData({name: user.name, city: user.city || ''}); }} className="bg-white/5 text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all">إلغاء</button>
                </>
              ) : (
                <button onClick={() => setIsEditing(true)} className="bg-white/5 border border-white/10 text-white px-10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all">تعديل الملف</button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <div className="p-8 bg-black/40 rounded-[2.5rem] border border-white/5 hover:border-white/20 transition-all">
              <p className="text-[9px] text-gray-600 font-black uppercase tracking-widest mb-4">المدينة / النطاق</p>
              {isEditing ? (
                <input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full bg-white/5 border border-white/10 px-4 py-2 rounded-xl outline-none text-white font-bold" />
              ) : (
                <h4 className="text-xl font-black text-white uppercase tracking-tight">{formData.city || 'غير محدد'}</h4>
              )}
            </div>
            
            <div className="p-8 bg-black/40 rounded-[2.5rem] border border-white/5 flex flex-col justify-between opacity-60">
              <div>
                <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest mb-1">رقم الهاتف</p>
                <h4 className="text-xl font-black text-gray-400 tabular-nums">{user.phone || '05XXXXXXXX'}</h4>
              </div>
            </div>

            <div className="p-8 bg-black/40 rounded-[2.5rem] border border-white/5 flex flex-col justify-between opacity-60">
              <div>
                <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest mb-1">اسم المستخدم</p>
                <h4 className="text-xl font-black text-gray-400">@{user.username}</h4>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-[#0A0A0A] p-10 rounded-[3.5rem] border border-white/5 space-y-8">
          <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.6em] border-r-2 border-white pr-4">إحصائيات الأداء الميداني</h4>
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-1">
              <p className="text-[8px] text-gray-700 font-black uppercase tracking-widest">إجمالي الطلبات</p>
              <p className="text-4xl font-black text-white">{stats.total}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[8px] text-gray-700 font-black uppercase tracking-widest">المبيعات المكتملة</p>
              <p className="text-4xl font-black text-white">{stats.accepted}</p>
            </div>
          </div>
          <div className="pt-6 border-t border-white/5">
             <p className="text-[8px] text-gray-700 font-black uppercase tracking-widest mb-2">تقدير العمولات المعتمد (IQD)</p>
             <p className="text-3xl font-black text-white tracking-tighter">{stats.commission.toLocaleString()} <span className="text-sm text-gray-600">د.ع</span></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentProfile;
