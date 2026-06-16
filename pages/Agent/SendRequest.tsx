
import React, { useState } from 'react';
import { SystemProduct, RequestStatus } from '../../types';

interface SendRequestProps {
  systems: SystemProduct[];
  onSend: (req: any) => void;
}

const SendRequest: React.FC<SendRequestProps> = ({ systems, onSend }) => {
  const [formData, setFormData] = useState({
    institutionName: '',
    systemId: '',
    subscriptionType: '', // تم تحويله لنص
    location: '',
    contactName: '',
    contactPhone: '',
    note: ''
  });

  const [submitted, setSubmitted] = useState(false);

  const selectedSystem = systems.find(s => s.id === formData.systemId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.institutionName || !formData.systemId || !formData.subscriptionType) {
      alert("يرجى إكمال جميع الحقول الإجبارية واختيار فئة الاشتراك");
      return;
    }

    const system = systems.find(s => s.id === formData.systemId);

    onSend({
      ...formData,
      systemName: system?.name || '',
      status: RequestStatus.PENDING,
      adminNote: formData.note
    });

    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
    setFormData({
      institutionName: '',
      systemId: '',
      subscriptionType: '',
      location: '',
      contactName: '',
      contactPhone: '',
      note: ''
    });
  };

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <div className="bg-[#0A0A0A] p-5 sm:p-10 lg:p-12 rounded-[2rem] sm:rounded-[3.5rem] border border-white/5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-32 h-32 bg-white/5 blur-3xl -mr-16 -mt-16"></div>
        
        <div className="mb-8 sm:mb-12">
          <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tighter uppercase italic">إطلاق عملية مبيعات جديدة</h3>
          <p className="text-gray-600 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.4em] mt-2">Sales Deployment Protocol</p>
        </div>

        {submitted && (
          <div className="mb-8 p-5 sm:p-6 bg-white text-black rounded-2xl sm:rounded-3xl font-black text-[10px] sm:text-xs uppercase tracking-[0.2em] animate-in fade-in slide-in-from-top text-center">
            SUCCESS: Data Transmitted to Command Center
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8 sm:space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            <div className="md:col-span-2 space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">العميل المستهدف (مطعم، شركة، مدرسة...)</label>
              <input 
                required
                type="text" 
                value={formData.institutionName}
                onChange={e => setFormData({...formData, institutionName: e.target.value})}
                className="w-full px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-[2rem] bg-black border border-white/5 text-white focus:border-white outline-none transition-all font-bold text-sm sm:text-base"
                placeholder="اسم العميل أو الجهة المستهدفة"
              />
            </div>

            <div className="space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">النظام المختار</label>
              <select 
                required
                value={formData.systemId}
                onChange={e => {
                  const sid = e.target.value;
                  const sys = systems.find(s => s.id === sid);
                  setFormData({
                    ...formData, 
                    systemId: sid, 
                    subscriptionType: sys?.tiers[0]?.name || '' 
                  });
                }}
                className="w-full px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-[2rem] bg-black border border-white/5 text-white focus:border-white outline-none transition-all font-bold text-sm sm:text-base appearance-none cursor-pointer"
              >
                <option value="">SELECT SYSTEM</option>
                {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">فئة الاشتراك (ديناميكي)</label>
              <select 
                required
                value={formData.subscriptionType}
                onChange={e => setFormData({...formData, subscriptionType: e.target.value})}
                disabled={!formData.systemId}
                className="w-full px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-[2rem] bg-black border border-white/5 text-white focus:border-white outline-none transition-all font-bold text-sm sm:text-base appearance-none cursor-pointer disabled:opacity-30"
              >
                {!selectedSystem && <option value="">CHOOSE SYSTEM FIRST</option>}
                {selectedSystem?.tiers.map((tier, idx) => (
                  <option key={idx} value={tier.name}>
                    {tier.name} - ({tier.price.toLocaleString()} IQD)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">العنوان</label>
              <input 
                required
                type="text" 
                value={formData.location}
                onChange={e => setFormData({...formData, location: e.target.value})}
                className="w-full px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-[2rem] bg-black border border-white/5 text-white focus:border-white outline-none transition-all font-bold text-sm sm:text-base"
                placeholder="SECTOR / LOCATION"
              />
            </div>

            <div className="space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">هاتف التواصل</label>
              <input 
                required
                type="tel" 
                value={formData.contactPhone}
                onChange={e => setFormData({...formData, contactPhone: e.target.value})}
                className="w-full px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-[2rem] bg-black border border-white/5 text-white focus:border-white outline-none transition-all font-black text-sm sm:text-base tabular-nums"
                placeholder="07XXXXXXXX"
              />
            </div>

            <div className="md:col-span-2 space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">المسؤول عن القرار</label>
              <input 
                required
                type="text" 
                value={formData.contactName}
                onChange={e => setFormData({...formData, contactName: e.target.value})}
                className="w-full px-6 sm:px-8 py-4 sm:py-5 rounded-xl sm:rounded-[2rem] bg-black border border-white/5 text-white focus:border-white outline-none transition-all font-bold text-sm sm:text-base"
                placeholder="PRIMARY CONTACT"
              />
            </div>
          </div>

          <div className="pt-4 sm:pt-8">
            <button 
              type="submit"
              className="w-full bg-white text-black font-black py-5 sm:py-7 rounded-2xl sm:rounded-[2.5rem] hover:shadow-[0_0_50px_rgba(255,255,255,0.2)] transition-all active:scale-95 text-[10px] sm:text-[12px] uppercase tracking-[0.4em] sm:tracking-[0.6em] italic"
            >
              تأكيد وإرسال البيانات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SendRequest;
