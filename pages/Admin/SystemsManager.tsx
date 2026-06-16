
import React, { useState } from 'react';
import { SystemProduct, SubscriptionTier } from '../../types';
import { ICONS } from '../../constants';

interface SystemsManagerProps {
  systems: SystemProduct[];
  onCreate: (system: Omit<SystemProduct, 'id'>) => void;
  onUpdate: (id: string, system: Partial<SystemProduct>) => void;
  onDelete: (id: string) => void;
}

const SystemsManager: React.FC<SystemsManagerProps> = ({ systems, onCreate, onUpdate, onDelete }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSystem, setEditingSystem] = useState<SystemProduct | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [formData, setFormData] = useState<Omit<SystemProduct, 'id'>>({
    name: '',
    description: '',
    tiers: [
      { name: 'اشتراك قياسي', price: 0, commission: 0 }
    ]
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      tiers: [{ name: 'اشتراك قياسي', price: 0, commission: 0 }]
    });
    setEditingSystem(null);
  };

  const addTier = () => {
    setFormData({
      ...formData,
      tiers: [...formData.tiers, { name: '', price: 0, commission: 0 }]
    });
  };

  const removeTier = (index: number) => {
    if (formData.tiers.length === 1) return;
    const newTiers = formData.tiers.filter((_, i) => i !== index);
    setFormData({ ...formData, tiers: newTiers });
  };

  const updateTier = (index: number, field: keyof SubscriptionTier, value: string | number) => {
    const newTiers = [...formData.tiers];
    newTiers[index] = { ...newTiers[index], [field]: value };
    setFormData({ ...formData, tiers: newTiers });
  };

  const handleOpenEdit = (system: SystemProduct) => {
    setEditingSystem(system);
    setFormData({
      name: system.name,
      description: system.description,
      tiers: Array.isArray(system.tiers) ? [...system.tiers] : [{ name: 'اشتراك قياسي', price: 0, commission: 0 }]
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (editingSystem) {
        await onUpdate(editingSystem.id, formData);
      } else {
        await onCreate(formData);
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      console.error("Submit Error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-10 pb-24">
      {/* Header Section with Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0A0A0A] p-6 sm:p-10 lg:p-12 rounded-[2.5rem] sm:rounded-[3.5rem] border border-white/5 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-40 h-40 bg-white/5 blur-3xl -ml-20 -mt-20"></div>
          <div className="relative z-10">
            <h3 className="text-3xl sm:text-4xl font-black text-white tracking-tighter uppercase italic">الأنظمة والأسعار</h3>
            <p className="text-[10px] text-gray-600 mt-2 font-black uppercase tracking-[0.5em]">Dynamic Pricing & Tier Matrix</p>
          </div>
          <button 
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="relative z-10 bg-white text-black px-10 py-5 sm:px-12 sm:py-6 rounded-[1.5rem] sm:rounded-[2rem] text-[10px] sm:text-[11px] font-black uppercase tracking-[0.4em] hover:shadow-[0_0_50px_rgba(255,255,255,0.2)] transition-all active:scale-95 w-full md:w-auto text-center italic"
          >
            إضافة نظام جديد +
          </button>
        </div>

        <div className="bg-[#0A0A0A] p-6 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] border border-white/5 flex flex-col justify-center items-center text-center shadow-2xl">
          <p className="text-[10px] text-gray-700 font-black uppercase tracking-[0.4em] mb-2">إجمالي الأنظمة النشطة</p>
          <div className="text-5xl sm:text-6xl font-black text-white tracking-tighter italic">{(systems || []).length}</div>
          <p className="text-[8px] text-gray-800 font-black uppercase tracking-widest mt-4">Operational Systems Protocol</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
        {(systems || []).map(sys => (
          <div key={sys.id} className="bg-[#0A0A0A] rounded-[2.5rem] sm:rounded-[4rem] border border-white/5 overflow-hidden flex flex-col group hover:border-white/10 transition-all duration-700 shadow-2xl relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/[0.02] blur-[100px] -mr-32 -mt-32 group-hover:bg-white/[0.05] transition-all"></div>
            
            <div className="p-8 sm:p-12 border-b border-white/[0.03] relative z-10">
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-black border border-white/5 rounded-[1.5rem] sm:rounded-[2rem] flex items-center justify-center text-white/40 group-hover:bg-white group-hover:text-black transition-all duration-500 shadow-xl">
                    {ICONS.Package}
                  </div>
                  <div>
                    <h4 className="font-black text-2xl sm:text-3xl text-white tracking-tighter uppercase italic">{sys.name}</h4>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="px-3 py-1 bg-white/5 rounded-lg text-[8px] font-black text-gray-500 uppercase tracking-widest border border-white/5">
                        {sys.tiers?.length || 0} TIERS
                      </span>
                      <span className="w-1 h-1 bg-gray-800 rounded-full"></span>
                      <span className="text-[8px] text-gray-700 font-black uppercase tracking-widest">ID: {sys.id.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 sm:gap-3">
                   <button 
                    onClick={() => handleOpenEdit(sys)} 
                    className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-white/5 hover:bg-white hover:text-black rounded-xl sm:rounded-2xl transition-all shadow-lg"
                    title="تعديل"
                   >
                    {ICONS.Settings}
                   </button>
                   <button 
                    onClick={() => onDelete(sys.id)} 
                    className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-red-900/10 text-red-500 hover:bg-red-600 hover:text-white rounded-xl sm:rounded-2xl transition-all shadow-lg"
                    title="حذف"
                   >
                    {ICONS.X}
                   </button>
                </div>
              </div>
              <p className="text-sm sm:text-base text-gray-500 font-bold leading-relaxed max-w-xl">{sys.description}</p>
            </div>
            
            <div className="p-8 sm:p-12 space-y-8 flex-1 bg-black/40 relative z-10">
              <div className="flex items-center gap-4">
                <h5 className="font-black text-[10px] text-white uppercase tracking-[0.5em]">مصفوفة الأسعار والعمولات</h5>
                <div className="h-px flex-1 bg-white/5"></div>
              </div>

              <div className="grid gap-4">
                {sys.tiers?.map((tier, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 sm:p-8 bg-black border border-white/5 rounded-[2rem] sm:rounded-[2.5rem] hover:border-white/10 transition-all group/tier">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-white/20 group-hover/tier:bg-white transition-all"></div>
                        <span className="font-black text-sm text-white uppercase tracking-widest">{tier.name}</span>
                      </div>
                      <p className="text-[8px] text-gray-700 font-black uppercase tracking-[0.3em] italic ml-5">Subscription Tier Level {idx + 1}</p>
                    </div>
                    
                    <div className="flex items-center gap-8 sm:gap-12 mt-6 sm:mt-0">
                      <div className="text-right">
                        <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest mb-1">السعر</p>
                        <div className="flex items-baseline gap-2">
                          <span className="font-black text-xl sm:text-2xl text-white tracking-tighter italic">{tier.price.toLocaleString()}</span>
                          <span className="text-[8px] font-black text-gray-600 uppercase">IQD</span>
                        </div>
                      </div>
                      <div className="text-right border-r border-white/5 pr-8 sm:pr-10">
                        <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest mb-1">العمولة</p>
                        <div className="flex items-baseline gap-2">
                          <span className="font-black text-xl sm:text-2xl text-emerald-500 tracking-tighter italic">{tier.commission.toLocaleString()}</span>
                          <span className="text-[8px] font-black text-gray-600 uppercase">IQD</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-2xl flex justify-center items-start z-[100] p-4 sm:p-8 overflow-y-auto">
          <div className="bg-[#0A0A0A] w-full max-w-4xl rounded-[3rem] sm:rounded-[4rem] border border-white/10 shadow-2xl animate-in zoom-in duration-300 my-8">
            <form onSubmit={handleSubmit}>
              <div className="p-8 sm:p-12 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h4 className="text-2xl sm:text-4xl font-black text-white tracking-tighter uppercase italic">
                    {editingSystem ? 'تحديث هيكلية النظام' : 'تأسيس نظام برمجي جديد'}
                  </h4>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-[0.4em] mt-2 italic">Architecture & Tier Management Protocol</p>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center rounded-2xl sm:rounded-3xl bg-white/5 hover:bg-white hover:text-black transition-all shadow-xl">
                  {ICONS.X}
                </button>
              </div>

              <div className="p-8 sm:p-16 space-y-12">
                <div className="grid grid-cols-1 gap-10">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.5em] mr-6">اسم النظام الأساسي</label>
                    <input 
                      required
                      type="text" 
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      className="w-full px-8 py-6 rounded-[2rem] bg-black border border-white/10 text-white focus:border-white outline-none transition-all font-black text-lg shadow-inner"
                      placeholder="PRODUCT NAME"
                    />
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.5em] mr-6">المواصفات الفنية والوصف</label>
                    <textarea 
                      required
                      rows={3}
                      value={formData.description}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      className="w-full px-8 py-6 rounded-[2rem] bg-black border border-white/10 text-white focus:border-white outline-none transition-all font-bold text-base resize-none"
                      placeholder="TECHNICAL DESCRIPTION"
                    />
                  </div>
                </div>

                <div className="space-y-10">
                   <div className="flex items-center justify-between border-b border-white/5 pb-6">
                      <h5 className="text-[10px] font-black text-white uppercase tracking-[0.6em]">مصفوفة فئات الاشتراكات والعمولات</h5>
                      <button 
                        type="button" 
                        onClick={addTier}
                        className="bg-white text-black px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all flex items-center gap-2"
                      >
                        {ICONS.SendRequest} إضافة فئة جديدة
                      </button>
                   </div>
                   
                   <div className="space-y-6">
                     {formData.tiers.map((tier, idx) => (
                       <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-6 p-8 bg-black/40 rounded-[2.5rem] border border-white/5 relative group">
                          {formData.tiers.length > 1 && (
                            <button 
                              type="button" 
                              onClick={() => removeTier(idx)}
                              className="absolute -top-3 -left-3 w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg z-10"
                            >
                              {ICONS.X}
                            </button>
                          )}
                          <div className="space-y-3">
                             <label className="text-[8px] font-black text-gray-700 uppercase tracking-widest">اسم الفئة</label>
                             <input 
                                required
                                type="text"
                                value={tier.name}
                                onChange={e => updateTier(idx, 'name', e.target.value)}
                                className="w-full px-5 py-4 rounded-xl bg-black border border-white/5 text-white outline-none font-black text-xs"
                                placeholder="مثلاً: باقة العمالقة"
                             />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[8px] font-black text-gray-700 uppercase tracking-widest">السعر النهائي (IQD)</label>
                             <input 
                                required
                                type="number"
                                value={tier.price}
                                onChange={e => updateTier(idx, 'price', Number(e.target.value))}
                                className="w-full px-5 py-4 rounded-xl bg-black border border-white/5 text-white outline-none font-black text-xs"
                             />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[8px] font-black text-gray-700 uppercase tracking-widest">عمولة المندوب (IQD)</label>
                             <input 
                                required
                                type="number"
                                value={tier.commission}
                                onChange={e => updateTier(idx, 'commission', Number(e.target.value))}
                                className="w-full px-5 py-4 rounded-xl bg-black border border-white/5 text-white outline-none font-black text-xs"
                             />
                          </div>
                          <div className="flex items-end pb-1 hidden md:flex">
                             <div className="text-[8px] text-gray-800 font-black uppercase tracking-widest">ID: OPT_{idx+1}</div>
                          </div>
                       </div>
                     ))}
                   </div>
                </div>
              </div>

              <div className="p-10 sm:p-16 border-t border-white/5 flex flex-col sm:flex-row gap-6">
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-white text-black font-black py-7 rounded-[2rem] hover:shadow-[0_0_60px_rgba(255,255,255,0.2)] active:scale-95 transition-all text-[12px] uppercase tracking-[0.6em] italic disabled:opacity-50"
                >
                  {isSubmitting ? 'جار الحفظ وتأمين البيانات...' : 'حفظ وتأمين البيانات'}
                </button>
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-12 py-7 text-[10px] font-black text-gray-600 hover:text-white uppercase tracking-widest italic"
                >
                  تجاهل التغييرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemsManager;
