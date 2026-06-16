
import React, { useState } from 'react';
import { User, UserRole } from '../../types';
import { ICONS } from '../../constants';

interface AdminsManagerProps {
  admins: User[];
  onCreate: (admin: Omit<User, 'id' | 'status' | 'role'>) => void;
  onUpdate: (id: string, updates: Partial<User>) => void;
  currentUser?: User | null;
}

const AdminsManager: React.FC<AdminsManagerProps> = ({ admins, onCreate, onUpdate, currentUser }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    email: '',
  });

  // التحقق هل المستخدم الحالي هو "مدير عام"
  const isDirector = currentUser?.role === UserRole.ADMIN;

  const handleOpenCreate = () => {
    // فقط المدير العام يمكنه إنشاء أدمن جديد
    if (!isDirector) {
      alert("عذراً، صلاحية إنشاء حسابات إدارية محصورة للمدير العام فقط.");
      return;
    }
    setEditingAdmin(null);
    setFormData({ name: '', username: '', password: '', email: '' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (admin: User) => {
    // المشرف لا يمكنه تعديل المدير العام
    if (!isDirector && admin.role === UserRole.ADMIN) {
      alert("عذراً، لا تمتلك الصلاحية لتعديل بيانات المدير العام.");
      return;
    }
    setEditingAdmin(admin);
    setFormData({
      name: admin.name,
      username: admin.username,
      password: admin.password || '',
      email: admin.email || '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...formData };
    
    // تأمين كلمة المرور: المشرف لا يمكنه تغيير كلمة المرور حتى لو حاول فتح الواجهة برمجياً
    if (!isDirector && editingAdmin) {
      delete (payload as any).password;
    }

    if (editingAdmin) {
      onUpdate(editingAdmin.id, payload);
    } else {
      onCreate(payload);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-center justify-between bg-[#0A0A0A] p-8 rounded-[2.5rem] border border-[#1A1A1A] gap-6">
        <div>
          <h3 className="text-2xl font-black text-white tracking-tighter uppercase italic">التحكم في المشرفين</h3>
          <p className="text-[10px] text-gray-600 mt-1 font-black uppercase tracking-[0.4em]">Administrative Access Management</p>
        </div>
        {isDirector && (
          <button 
            onClick={handleOpenCreate}
            className="bg-white text-black px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all active:scale-95 w-full md:w-auto text-center"
          >
            إنشاء حساب أدمن جديد
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {admins.map(admin => {
          const isTargetDirector = admin.role === UserRole.ADMIN;
          const canEdit = isDirector || !isTargetDirector;

          return (
            <div key={admin.id} className={`bg-[#0A0A0A] p-8 rounded-[2.5rem] border flex flex-col gap-6 group transition-all shadow-lg relative overflow-hidden ${isTargetDirector ? 'border-white/20' : 'border-white/5'}`}>
              {isTargetDirector && (
                <div className="absolute top-0 left-0 bg-white text-black px-4 py-1 text-[8px] font-black uppercase tracking-widest rounded-br-2xl">
                  Director / مدير عام
                </div>
              )}
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 bg-black border rounded-2xl flex items-center justify-center text-white transition-all font-black text-xl ${isTargetDirector ? 'border-white' : 'border-white/5'}`}>
                    {admin.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-black text-white uppercase tracking-tighter italic">{admin.name}</h4>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${isTargetDirector ? 'text-white' : 'text-gray-600'}`}>
                      {admin.role}
                    </p>
                  </div>
                </div>
                
                {canEdit && (
                  <button 
                    onClick={() => handleOpenEdit(admin)}
                    className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-white/40 hover:text-white transition-all"
                  >
                    {ICONS.Settings}
                  </button>
                )}
              </div>
              
              <div className="space-y-3 pt-4 border-t border-white/5 text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">
                <div className="flex justify-between">
                  <span>Username:</span>
                  <span className="text-white">@{admin.username}</span>
                </div>
                <div className="flex justify-between">
                  <span>Access Status:</span>
                  <span className="text-green-500">Active & Logged</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-xl flex items-center justify-center z-[100] p-6">
          <div className="bg-[#0A0A0A] w-full max-w-xl rounded-[4rem] border border-white/10 shadow-2xl animate-in zoom-in duration-300">
            <form onSubmit={handleSubmit} className="p-12 space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-3xl font-black text-white tracking-tighter uppercase italic">{editingAdmin ? 'تعديل مسؤول' : 'أدمن جديد'}</h4>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-[0.4em] mt-1">Permission Update Protocol</p>
                </div>
                <button type="button" onClick={() => setIsModalOpen(false)} className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center hover:bg-white hover:text-black">
                  {ICONS.X}
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Name / الاسم</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-8 py-5 rounded-3xl bg-black border border-white/5 text-white outline-none focus:border-white font-bold text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Username / اسم المستخدم</label>
                  <input required type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full px-8 py-5 rounded-3xl bg-black border border-white/5 text-white outline-none focus:border-white font-bold text-sm" />
                </div>
                {/* كلمة المرور لا تظهر إلا للمدير العام عند التعديل، وتظهر للكل عند الإنشاء الجديد */}
                {(isDirector || !editingAdmin) && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Security Code / كلمة المرور</label>
                    <input required type="text" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full px-8 py-5 rounded-3xl bg-black border border-white/5 text-white outline-none focus:border-white font-bold text-sm" />
                  </div>
                )}
              </div>

              <div className="pt-6 flex gap-4">
                <button type="submit" className="flex-1 bg-white text-black font-black py-6 rounded-3xl hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all uppercase tracking-[0.4em] text-[10px]">حفظ التعديلات</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-10 py-6 text-[10px] font-black text-gray-600 uppercase tracking-widest">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminsManager;
