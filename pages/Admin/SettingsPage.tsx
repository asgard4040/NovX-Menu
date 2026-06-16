import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface SettingsPageProps {
  onSettingsSaved: () => void;
  logoUrlSetting: string;
  supportPhoneSetting: string;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onSettingsSaved, logoUrlSetting, supportPhoneSetting }) => {
  const [logoUrl, setLogoUrl] = useState(logoUrlSetting || '');
  const [supportPhone, setSupportPhone] = useState(supportPhoneSetting || '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setLogoUrl(logoUrlSetting);
    setSupportPhone(supportPhoneSetting);
  }, [logoUrlSetting, supportPhoneSetting]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setMessage({ type: 'error', text: 'حجم اللوجو كبير جداً. يرجى اختيار ملف بحجم أقل من 2 ميجابايت.' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setLogoUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      await api.settings.update({
        logoUrl: logoUrl.trim(),
        supportPhone: supportPhone.trim()
      });
      setMessage({ type: 'success', text: 'تم حفظ الإعدادات بنجاح وسيتم تطبيقها على كافة الواجهات.' });
      onSettingsSaved();
    } catch (error: any) {
      console.error(error);
      setMessage({ type: 'error', text: 'فشل حفظ الإعدادات. يرجى التحقق من اتصالك بالإنترنت.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="bg-[#0A0A0A] p-6 sm:p-10 lg:p-12 rounded-[2.5rem] sm:rounded-[3.5rem] border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
        <div className="text-right">
          <h3 className="text-3xl font-black text-white tracking-tighter uppercase italic">الإعدادات العامة</h3>
          <p className="text-[10px] text-gray-600 mt-2 font-black uppercase tracking-[0.5em]">System configuration & Visual Identity</p>
        </div>
      </div>

      <div className="bg-[#0A0A0A] border border-white/5 p-8 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] relative overflow-hidden">
        {message && (
          <div className={`p-6 rounded-2xl mb-8 border font-bold text-xs ${
            message.type === 'success' 
              ? 'bg-white/5 border-white/10 text-white' 
              : 'bg-red-950/20 border-red-500/10 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Logo Customization section */}
            <div className="lg:col-span-2 space-y-8">
              <div className="space-y-3">
                <label className="block text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">رقم هاتف الدعم الفني للمندوبين</label>
                <input
                  type="text"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  className="w-full px-8 py-5 rounded-[2rem] bg-black border border-white/5 text-white focus:border-white focus:ring-0 outline-none transition-all font-bold text-sm"
                  placeholder="+966 50 000 0000"
                />
                <p className="text-[9px] text-gray-600 mr-4">هذا الرقم سيظهر للمناديب في صفحة "المساعدة" حتى يتمكنوا من الاتصال بكم مباشرة بضغطة زر عند مواجهة أي صعوبة.</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="block text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">رفع لوغو من الاستوديو</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <label className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-5 rounded-[2rem] bg-white text-black font-black hover:bg-white/90 active:scale-95 transition-all text-xs cursor-pointer">
                      <span>اختر صورة اللوجو</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                    <span className="text-[10px] text-gray-600 font-bold uppercase">أو ضع رابط مباشر أدناه</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">رابط مباشر للوغو</label>
                  <input
                    type="text"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    className="w-full px-8 py-5 rounded-[2rem] bg-black border border-white/5 text-white focus:border-white focus:ring-0 outline-none transition-all font-bold text-sm"
                    placeholder="https://example.com/logo.png"
                  />
                </div>
              </div>
            </div>

            {/* Preview Section */}
            <div className="flex flex-col items-center justify-center p-8 bg-black/40 border border-white/5 rounded-[2rem]">
              <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mb-6">معاينة اللوجو الحالي</span>
              <div className="w-40 h-40 bg-black border border-white/5 rounded-[2.5rem] flex items-center justify-center overflow-hidden p-4 relative group">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Current Logo Preview"
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <img
                    src="https://picsum.photos/seed/novx/400/400"
                    alt="Fallback Logo"
                    className="w-full h-full object-contain opacity-40"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
              <p className="text-[9px] text-gray-700 font-bold tracking-wider mt-4">
                {logoUrl ? "شعار مخصص مفعل" : "يتم استخدام الشعار الافتراضي للنظام"}
              </p>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full sm:w-auto flex items-center justify-center gap-3 px-12 py-5 rounded-[2rem] bg-white text-black font-black hover:bg-white/90 active:scale-95 transition-all text-xs uppercase"
            >
              {isSaving ? "جاري الحفظ..." : "حفظ التغييرات وتطبيقها"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsPage;
