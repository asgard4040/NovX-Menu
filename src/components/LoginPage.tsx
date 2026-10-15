import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Utensils, Lock, User, Eye, EyeOff, AlertCircle, ChevronRight, Building2 } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { UserSession } from '../types';
import { useLanguage } from '../lib/i18n';

interface LoginPageProps {
  onLogin: (user: UserSession) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { dir, tr } = useLanguage();
  const [role, setRole] = useState<'admin' | 'restaurant' | 'waiter' | 'kitchen'>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Customized login settings
  const [loginRestaurantId, setLoginRestaurantId] = useState<string | null>(null);
  const [customRestaurant, setCustomRestaurant] = useState<{
    id: string;
    restaurantName: string;
    logoUrl?: string;
    status: string;
  } | null>(null);
  const [fetchingCustomRest, setFetchingCustomRest] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('loginRestaurantId');
    setLoginRestaurantId(rid);

    const fetchCustomRestaurant = async (id: string) => {
      setFetchingCustomRest(true);
      setError(null);
      try {
        const response = await fetch(`/api/public/restaurants/${encodeURIComponent(id)}?branding=1`);
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()).restaurant;
        setCustomRestaurant({ id, restaurantName: data.restaurantName, logoUrl: data.logoUrl, status: 'active' });
        setRole('restaurant');
      } catch (err) {
        console.error("Error loading custom restaurant info:", err);
        setError(tr('حدث خطأ أثناء تحميل معلومات بوابة هذا المطعم.', 'Could not load this restaurant portal.'));
      } finally {
        setFetchingCustomRest(false);
      }
    };

    if (rid) {
      fetchCustomRestaurant(rid);
    } else {
      setRole('admin');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!supabaseConfigured) throw new Error('client_config_missing');
      if (role !== 'admin' && !loginRestaurantId) throw new Error('restaurant_required');
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, username, password, restaurantId: loginRestaurantId }),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('api_unavailable');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'invalid_credentials');
      const { error: sessionError } = await supabase.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken });
      if (sessionError) throw sessionError;
      onLogin(result.session as UserSession);
    } catch (err) {
      console.error(err);
      const code = err instanceof TypeError ? 'api_unavailable' : err instanceof Error ? err.message : 'invalid_credentials';
      setError(code === 'invalid_credentials'
        ? tr('اسم المستخدم أو كلمة المرور غير صحيحة.', 'Incorrect username or password.')
        : code === 'client_config_missing' || code === 'server_config_missing'
          ? tr('إعدادات Supabase ناقصة في النشر. أضف متغيرات البيئة ثم أعد النشر.', 'Supabase deployment settings are missing. Add the environment variables and redeploy.')
        : code === 'auth_service_unavailable'
          ? tr('تعذر الاتصال بخدمة تسجيل الدخول. تحقق من عنوان Supabase وسجلات الخادم.', 'Cannot reach the sign-in service. Check the Supabase URL and server logs.')
        : code === 'api_unavailable'
          ? tr('خدمة تسجيل الدخول غير متاحة. تحقق من إعدادات الخادم والنشر.', 'Sign-in service is unavailable. Check the deployment and server configuration.')
        : code === 'role_mismatch'
          ? tr('هذا الحساب لا يطابق القسم المحدد أو المطعم الحالي.', 'This account does not belong to the selected role or restaurant.')
          : code === 'restaurant_required'
            ? tr('استخدم رابط تسجيل الدخول الخاص بالمطعم للموظفين.', 'Staff must use the restaurant-specific login link.')
            : tr('حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى.', 'Sign-in failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const currentRoles = loginRestaurantId && customRestaurant
    ? ([
        { id: 'restaurant', label: tr('المالك / المدير', 'Owner / Manager') },
        { id: 'waiter', label: tr('قسم الصالة (ويتر)', 'Waiter') },
        { id: 'kitchen', label: tr('قسم المطبخ', 'Kitchen') }
      ] as const)
    : ([
        { id: 'admin', label: tr('المسؤول العام', 'Administrator') }
      ] as const);

  return (
    <div className="min-h-screen bg-bg-paper flex items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-brand-primary/10" dir={dir}>
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src="https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?q=80&w=2070&auto=format&fit=crop" 
          className="w-full h-full object-cover grayscale-[0.4] scale-105 animate-fade-in" 
          alt="Premium background" 
        />
        <div className="absolute inset-0 bg-brand-primary/40 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xl bg-white rounded-none p-12 sm:p-20 shadow-[0_40px_100px_rgba(0,0,0,0.3)] z-10 relative overflow-hidden"
      >
        {/* Decorative Texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />
        
        {fetchingCustomRest ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-brand-primary">{tr('جاري استدعاء البوابة المخصصة للمطعم...', 'Loading restaurant portal...')}</p>
          </div>
        ) : (
          <>
            {/* Branding Header */}
            <div className="relative z-10 flex flex-col items-center mb-12 text-center">
              {loginRestaurantId && customRestaurant ? (
                <>
                  {customRestaurant.logoUrl ? (
                    <img 
                      src={customRestaurant.logoUrl} 
                      alt="Restaurant Logo" 
                      className="w-24 h-24 rounded-full object-cover border-2 border-brand-gold p-1 shadow-lg mb-6 max-h-24 max-w-24"
                    />
                  ) : (
                    <div className="w-24 h-24 bg-bg-paper rounded-full border-2 border-brand-gold flex items-center justify-center text-brand-primary shadow-lg mb-6">
                      <Building2 className="w-10 h-10" />
                    </div>
                  )}
                  <p className="text-brand-gold text-[10px] font-bold uppercase tracking-widest leading-none mb-3">{tr('البوابة الأمنية المخصصة', 'Secure staff portal')}</p>
                  <h1 className="text-4xl font-display text-brand-primary italic tracking-tight font-bold mb-2">
                    {customRestaurant.restaurantName}
                  </h1>
                  <p className="text-text-muted text-[10px] uppercase font-sans font-medium tracking-tight">{tr('نظام الموظفين والشركاء المعتمد', 'Authorized staff access')}</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-6">
                    <span className="w-12 h-[1px] bg-brand-gold" />
                    <Utensils className="text-brand-gold w-6 h-6 italic" />
                    <span className="w-12 h-[1px] bg-brand-gold" />
                  </div>
                  <h1 className="text-5xl font-display text-brand-primary italic tracking-tight mb-4">نوفكس AI</h1>
                  <p className="text-brand-gold text-xs font-bold uppercase tracking-widest text-center">{tr('الفن الرفيع في إدارة المطاعم', 'Restaurant management, refined')}</p>
                </>
              )}
            </div>

            {/* Login Role Tabs Selector */}
            <div className="flex border-b border-border-delicate mb-10 relative z-10 overflow-x-auto no-scrollbar">
              {currentRoles.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setRole(r.id as any)}
                  className={`flex-1 min-w-[70px] py-4 text-sm font-bold tracking-wider transition-all relative cursor-pointer ${
                    role === r.id 
                    ? 'text-brand-primary' 
                    : 'text-text-muted hover:text-brand-primary opacity-60 hover:opacity-100'
                  }`}
                >
                  {r.label}
                  {role === r.id && <motion.div layoutId="loginRoleTab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand-gold" />}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
              <div className="space-y-4">
                <label className="text-xs font-bold text-brand-gold uppercase block">{tr('اسم المستخدم / الهوية', 'Username')}</label>
                <div className="relative group">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full bg-transparent border-b border-border-delicate py-3.5 pl-10 font-display text-xl text-brand-primary placeholder:text-text-muted/20 focus:outline-none focus:border-brand-primary transition-all text-right"
                    placeholder={tr('أدخل اسم المستخدم', 'Enter username')}
                  />
                  <User className="absolute left-0 top-1/2 -translate-y-1/2 text-border-delicate group-focus-within:text-brand-primary transition-colors w-5 h-5 opacity-40" />
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-brand-gold uppercase block">{tr('كلمة المرور / الرقم السري', 'Password')}</label>
                <div className="relative group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-transparent border-b border-border-delicate py-3.5 pl-20 font-display text-xl text-brand-primary placeholder:text-text-muted/20 focus:outline-none focus:border-brand-primary transition-all text-right"
                    placeholder={tr('أدخل الرقم السري', 'Enter password')}
                  />
                  <Lock className="absolute left-0 top-1/2 -translate-y-1/2 text-border-delicate group-focus-within:text-brand-primary transition-colors w-5 h-5 opacity-40" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-8 top-1/2 -translate-y-1/2 text-text-muted/40 hover:text-brand-primary hover:scale-105 transition-all text-xs cursor-pointer flex items-center gap-1.5 px-2 py-1 bg-bg-paper hover:bg-brand-primary/5 border border-border-delicate/40 select-none"
                    title={showPassword ? tr('إخفاء كلمة المرور', 'Hide password') : tr('عرض كلمة المرور', 'Show password')}
                  >
                    {showPassword ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold">{tr('إخفاء', 'Hide')}</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold">{tr('عرض', 'Show')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }} 
                  animate={{ opacity: 1, x: 0 }}
                  className="py-4 border-l-2 border-red-800 bg-red-50 pr-4 flex items-center gap-4 text-red-900 text-xs font-medium italic"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <p>{error}</p>
                </motion.div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-primary text-white py-5 rounded-none font-bold shadow-xl hover:bg-brand-secondary transition-all flex items-center justify-center gap-6 group overflow-hidden relative cursor-pointer"
                >
                  <span className="relative z-10 tracking-widest font-bold text-xs uppercase">{tr('الدخول الآمن للبوابة', 'Secure sign in')}</span>
                  <ChevronRight className="relative z-10 w-4 h-4 group-hover:-translate-x-2 transition-transform rotate-180" />
                  {loading && <div className="absolute inset-0 bg-brand-primary flex items-center justify-center z-20"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
                </button>
              </div>
            </form>

            {/* Explanatory footer for central login */}
            {!loginRestaurantId && (
              <div className="mt-8 p-5 border border-dashed border-border-delicate bg-bg-paper text-center">
                <p className="text-xs text-text-muted leading-relaxed font-sans font-medium">
                  🔒 <strong>{tr('تنبيه الزملاء وطاقم العمل:', 'Staff notice:')}</strong> {tr('يرجى استخدام رابط تسجيل الدخول الفريد المرسل لمطعمكم للدخول الآمن إلى الصالة والمطبخ.', 'Use your restaurant-specific login link to access waiter and kitchen workspaces.')}
                </p>
              </div>
            )}
          </>
        )}

        <div className="mt-16 text-center relative z-10">
          <p className="text-xs text-text-muted uppercase tracking-widest italic font-medium">
             {tr('صـنـع بـأكـمـل', 'Crafted with')} <span className="text-brand-gold">{tr('أنـاقـة رقـمـيـة', 'digital elegance')}</span>
          </p>
        </div>

        {/* Decorative corner lines */}
        <div className="absolute top-0 left-0 w-24 h-[1px] bg-border-delicate" />
        <div className="absolute top-0 left-0 w-[1px] h-24 bg-border-delicate" />
        <div className="absolute bottom-0 right-0 w-24 h-[1px] bg-border-delicate" />
        <div className="absolute bottom-0 right-0 w-[1px] h-24 bg-border-delicate" />
      </motion.div>
    </div>
  );
}
