
import React, { useState } from 'react';
import { User } from '../../types';
import { api } from '../../services/api';
import { ICONS } from '../../constants';

interface AdminProfileProps {
  user: User;
  onUpdate: (updates: Partial<User>) => void;
  onResetData: () => Promise<void>;
}

const AdminProfile: React.FC<AdminProfileProps> = ({ user, onUpdate, onResetData }) => {
  const [formData, setFormData] = useState({
    name: user.name,
    username: user.username,
    password: user.password || '',
  });
  const [isSuccess, setIsSuccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.auth.updateProfile(user.id, formData);
      onUpdate(formData);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (error) {
      alert("حدث خطأ أثناء تحديث الملف الشخصي");
    }
  };

  const handleExport = () => {
    api.data.exportAll();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (confirm('سيؤدي استيراد الملف إلى استبدال جميع البيانات الحالية. هل تريد المتابعة؟')) {
        api.data.importAll(file);
      }
    }
  };

  const handleReset = async () => {
    if (confirm('تنبيه هام للغاية! هل أنت متأكد من رغبتك في تصفير البيانات التشغيلية؟ هذا الإجراء سيقوم بحذف كافة طلبات المبيعات، الزيارات الميدانية، والاشعارات سحابياً بشكل كامل ونهائي ولا يمكن التراجع عنه.')) {
      setIsResetting(true);
      try {
        await api.ai.resetSystemData();
        await onResetData();
        alert('تم تصفير كافة البيانات التشغيلية بنجاح.');
      } catch (e: any) {
        alert('فشل تصفير البيانات: ' + e.message);
      } finally {
        setIsResetting(false);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-32">
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-white/5 pb-8">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter uppercase italic">الملف الشخصي والإدارة</h2>
          <p className="text-[10px] text-gray-600 mt-1 font-black uppercase tracking-[0.4em]">Personal Settings & System Control</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Profile Settings */}
        <div className="bg-[#0A0A0A] border border-white/5 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden h-fit">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-3xl -mr-16 -mt-16"></div>
          
          <h3 className="text-xl font-black text-white mb-8 tracking-tighter italic uppercase border-r-4 border-white pr-4">إعدادات الأمان والوصول</h3>

          {isSuccess && (
            <div className="mb-8 p-4 bg-white text-black rounded-2xl font-black text-[9px] uppercase tracking-[0.4em] animate-in slide-in-from-top flex items-center justify-center gap-3">
               تم التحديث بنجاح
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Name / الاسم</label>
              <input 
                required
                type="text" 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 text-white outline-none focus:border-white font-bold text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Username / اسم المستخدم</label>
              <input 
                required
                type="text" 
                value={formData.username}
                onChange={e => setFormData({...formData, username: e.target.value})}
                className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 text-white outline-none focus:border-white font-bold text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Security Key / كلمة المرور</label>
              <input 
                required
                type="password" 
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
                className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 text-white outline-none focus:border-white font-bold text-sm"
              />
            </div>
            <button type="submit" className="w-full bg-white text-black font-black py-5 rounded-3xl hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all uppercase tracking-[0.4em] text-[10px]">تحديث البيانات</button>
          </form>
        </div>

        {/* Data Management Section */}
        <div className="bg-[#0A0A0A] border border-white/5 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-900/5 blur-3xl -mr-16 -mt-16"></div>
          
          <div>
            <h3 className="text-xl font-black text-white mb-8 tracking-tighter italic uppercase border-r-4 border-red-500 pr-4">إدارة قاعدة البيانات</h3>
            <p className="text-gray-500 text-sm font-bold leading-relaxed mb-10">
              لضمان استمرارية عملك، يمكنك تصدير قاعدة البيانات الحالية كملف JSON وحفظها على جهازك. يمكنك استعادة هذه البيانات في أي وقت من خلال خيار الاستيراد.
            </p>
          </div>

          <div className="space-y-4">
             <button 
              onClick={handleExport}
              className="w-full flex items-center justify-center gap-4 py-6 rounded-3xl bg-black border border-white/5 text-white hover:bg-white hover:text-black transition-all group"
             >
                <span className="w-10 h-10 bg-white/5 group-hover:bg-black/10 rounded-xl flex items-center justify-center">
                  {ICONS.Download}
                </span>
                <span className="font-black text-[10px] uppercase tracking-[0.3em]">تصدير نسخة احتياطية (Backup)</span>
             </button>

             <div className="relative">
                <input 
                  type="file" 
                  accept=".json"
                  onChange={handleImport}
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                <div className="w-full flex items-center justify-center gap-4 py-6 rounded-3xl bg-black border border-white/5 text-gray-500">
                  <span className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
                    {ICONS.SendRequest}
                  </span>
                  <span className="font-black text-[10px] uppercase tracking-[0.3em]">استيراد قاعدة بيانات خارجية</span>
                </div>
             </div>

             <button 
              onClick={handleReset}
              disabled={isResetting}
              className="w-full flex items-center justify-center gap-4 py-6 rounded-3xl bg-red-950/20 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-black hover:border-red-500 transition-all group"
             >
                <span className="w-10 h-10 bg-red-500/10 group-hover:bg-black/10 rounded-xl flex items-center justify-center font-bold">
                  ⚠️
                </span>
                <span className="font-black text-[10px] uppercase tracking-[0.3em]">
                  {isResetting ? 'جاري تصفير النظام...' : 'تصفير كافة البيانات التشغيلية'}
                </span>
             </button>
          </div>

          <div className="mt-12 pt-8 border-t border-white/5 text-center">
             <p className="text-[8px] text-gray-800 font-black uppercase tracking-[0.8em]">Storage Protocol: LocalBrowser 1.0</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminProfile;
