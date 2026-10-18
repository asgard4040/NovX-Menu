import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Lock, User, Eye, EyeOff, AlertCircle, ChevronRight, Delete, Languages } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { UserSession } from '../types';
import { useLanguage } from '../lib/i18n';
import { selectStaffPortal, updateHomeScreenLink } from '../lib/home-screen';
import { BRAND_NAME } from '../lib/brand';
import { usePublicSystemLogo } from '../lib/use-system-brand';

interface LoginPageProps {
  onLogin: (user: UserSession) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { dir, isEnglish, setLanguage, tr } = useLanguage();
  const systemLogo = usePublicSystemLogo();
  const [role, setRole] = useState<'admin' | 'restaurant' | 'waiter' | 'kitchen'>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
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
    if (rid) {
      const requestedRole = params.get('portal');
      setRole(requestedRole === 'waiter' || requestedRole === 'kitchen' ? requestedRole : 'restaurant');
    }
    updateHomeScreenLink();

    const fetchCustomRestaurant = async (id: string) => {
      setFetchingCustomRest(true);
      setError(null);
      try {
        const response = await fetch(`/api/public/restaurants/${encodeURIComponent(id)}?branding=1`);
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()).restaurant;
        setCustomRestaurant({ id, restaurantName: data.restaurantName, logoUrl: data.logoUrl, status: 'active' });
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
      if (role !== 'admin' && !/^[0-9]{4}$/.test(passcode)) throw new Error('invalid_passcode');

      let sessionData: UserSession | null = null;

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(role === 'admin' ? { role, username, password } : { role, passcode, restaurantId: loginRestaurantId }),
        });

        if (response.headers.get('content-type')?.includes('application/json')) {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'invalid_credentials');
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
          });
          if (sessionError) throw sessionError;
          sessionData = result.session as UserSession;
        } else {
          throw new Error('api_unavailable');
        }
      } catch (apiErr: any) {
        // If the serverless/backend API is unreachable or returns an HTML gateway error,
        // fall back directly to Supabase client authentication so sign-in never fails unnecessarily.
        const isApiUnavailable = apiErr instanceof TypeError || apiErr?.message === 'api_unavailable';
        if (role === 'admin' && isApiUnavailable && supabaseConfigured) {
          const email = username.includes('@')
            ? username.trim().toLowerCase()
            : `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')}@accounts.novx.invalid`;

          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (authError || !authData.session) {
            throw new Error('invalid_credentials');
          }

          const user = authData.user;
          const metadata = user.app_metadata || {};

          if (role === 'admin') {
            if (metadata.system_role !== 'admin') throw new Error('role_mismatch');
            sessionData = {
              role: 'admin',
              id: user.id,
              name: user.user_metadata?.name || username,
            };
          } else {
            const { data: member, error: memErr } = await supabase
              .from('restaurant_members')
              .select('role,restaurant_id')
              .eq('user_id', user.id)
              .eq('restaurant_id', loginRestaurantId)
              .eq('active', true)
              .maybeSingle();

            const memberRole = member?.role === 'owner' || member?.role === 'manager'
              ? 'restaurant'
              : member?.role;

            if (memErr || !member || memberRole !== role) {
              throw new Error('role_mismatch');
            }

            sessionData = {
              role: memberRole as UserSession['role'],
              id: user.id,
              restaurantId: member.restaurant_id,
              name: user.user_metadata?.name || username,
            };
          }
        } else {
          throw apiErr;
        }
      }

      if (sessionData) {
        onLogin(sessionData);
      }
    } catch (err) {
      console.error(err);
      const code = err instanceof TypeError ? 'api_unavailable' : err instanceof Error ? err.message : 'invalid_credentials';
      setError(code === 'invalid_credentials'
        ? role === 'admin' ? tr('اسم المستخدم أو كلمة المرور غير صحيحة.', 'Incorrect username or password.') : tr('رمز الدخول غير صحيح.', 'Incorrect passcode.')
        : code === 'invalid_passcode'
          ? tr('أدخل رمزاً من أربعة أرقام.', 'Enter a four-digit passcode.')
        : code === 'passcode_secret_not_configured' || code === 'passcode_store_unavailable' || code === 'service_role_not_configured'
          ? tr('خدمة رموز الدخول غير مهيأة. تواصل مع المسؤول.', 'Passcode sign-in is not configured. Contact the administrator.')
        : code === 'too_many_requests'
          ? tr('محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.', 'Too many attempts. Wait a while and try again.')
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
    <div className="min-h-screen bg-bg-paper flex items-center justify-center p-3 sm:p-6 relative font-sans selection:bg-brand-primary/10" dir={dir}>
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
        className={`w-full max-w-xl bg-white rounded-3xl shadow-[0_40px_100px_rgba(0,0,0,0.3)] z-10 relative overflow-hidden ${role === 'admin' ? 'p-8 sm:p-16' : 'p-6 sm:p-10'}`}
      >
        {/* Decorative Texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />
        <div className="relative z-10 mb-5 flex justify-end">
          <div className="inline-flex items-center gap-1 rounded-full border border-border-delicate bg-bg-paper/80 p-1 shadow-sm" role="group" aria-label={tr('اللغة', 'Language')} dir="ltr">
            <Languages className="ms-2 h-4 w-4 text-text-muted" aria-hidden="true" />
            <button type="button" onClick={() => setLanguage('ar')} aria-pressed={!isEnglish}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${!isEnglish ? 'bg-brand-primary text-white shadow-sm' : 'text-text-muted hover:text-brand-primary'}`}>
              العربية
            </button>
            <button type="button" onClick={() => setLanguage('en')} aria-pressed={isEnglish}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${isEnglish ? 'bg-brand-primary text-white shadow-sm' : 'text-text-muted hover:text-brand-primary'}`}>
              English
            </button>
          </div>
        </div>
        
        {fetchingCustomRest ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-brand-primary">{tr('جاري استدعاء البوابة المخصصة للمطعم...', 'Loading restaurant portal...')}</p>
          </div>
        ) : (
          <>
            {/* Branding Header */}
            <div className={`relative z-10 flex flex-col items-center text-center ${role === 'admin' ? 'mb-10' : 'mb-5'}`}>
              {loginRestaurantId && customRestaurant ? (
                <>
                  {customRestaurant.logoUrl ? (
                    <img 
                      src={customRestaurant.logoUrl} 
                      alt="Restaurant Logo" 
                      className="w-20 h-20 rounded-full object-cover border-2 border-brand-gold p-1 shadow-lg mb-3 max-h-20 max-w-20"
                    />
                  ) : (
                    <img src={systemLogo} alt="" className="w-20 h-20 object-contain mb-3" />
                  )}
                  <p className="text-brand-gold text-[10px] font-bold uppercase tracking-widest leading-none mb-3">{tr('البوابة الأمنية المخصصة', 'Secure staff portal')}</p>
                  <h1 className="text-2xl sm:text-3xl font-display text-brand-primary tracking-tight font-bold mb-1">
                    {customRestaurant.restaurantName}
                  </h1>
                  <p className="text-text-muted text-[10px] uppercase font-sans font-medium tracking-tight">{tr('نظام الموظفين والشركاء المعتمد', 'Authorized staff access')}</p>
                </>
              ) : (
                <>
                  <img src={systemLogo} alt="" className="w-20 h-20 object-contain mb-4" />
                  <h1 className="text-4xl sm:text-5xl font-display font-bold text-brand-primary tracking-tight mb-3">{BRAND_NAME}</h1>
                  <p className="text-brand-gold text-xs font-bold uppercase tracking-widest text-center">{tr('تكنولوجيا المطاعم', 'Restaurant technology')}</p>
                </>
              )}
            </div>

            {/* Login Role Tabs Selector */}
            <div className={`flex border-b border-border-delicate relative z-10 overflow-x-auto no-scrollbar ${role === 'admin' ? 'mb-8' : 'mb-4'}`}>
              {currentRoles.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => {
                    setRole(r.id as any);
                    setPasscode('');
                    setError(null);
                    if (loginRestaurantId && r.id !== 'admin') selectStaffPortal(r.id, loginRestaurantId);
                  }}
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

            <form onSubmit={handleSubmit} className={`relative z-10 ${role === 'admin' ? 'space-y-8' : 'space-y-4'}`}>
              {role === 'admin' ? <>
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
                    className={`w-full bg-transparent border-b border-border-delicate py-3.5 font-display text-xl text-brand-primary placeholder:text-text-muted/20 focus:outline-none focus:border-brand-primary transition-all ${dir === 'rtl' ? 'pl-24 text-right' : 'pl-10 pr-14 text-left'}`}
                    placeholder={tr('أدخل الرقم السري', 'Enter password')}
                  />
                  <Lock className="absolute left-0 top-1/2 -translate-y-1/2 text-border-delicate group-focus-within:text-brand-primary transition-colors w-5 h-5 opacity-40" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:text-brand-primary hover:bg-brand-primary/5 transition-colors cursor-pointer ${dir === 'rtl' ? 'left-9' : 'right-0'}`}
                    aria-label={showPassword ? tr('إخفاء كلمة المرور', 'Hide password') : tr('عرض كلمة المرور', 'Show password')}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              </> : <div className="space-y-5">
                <div className="text-center space-y-2">
                  <p className="text-sm font-bold text-brand-primary">{tr('رمز الدخول المكوّن من ٤ أرقام', 'Your four-digit passcode')}</p>
                  <p className="text-xs text-text-muted">{tr('اختر الأرقام أدناه للدخول إلى قسمك.', 'Tap the numbers below to access your workspace.')}</p>
                </div>
                <div className="flex justify-center gap-4" role="status" aria-label={tr(`${passcode.length} من ٤ أرقام`, `${passcode.length} of 4 digits entered`)}>
                  {[0, 1, 2, 3].map((index) => <span key={index} className={`h-4 w-4 rounded-full border-2 border-brand-primary ${index < passcode.length ? 'bg-brand-primary' : 'bg-transparent'}`} />)}
                </div>
                <div className="mx-auto grid max-w-[280px] grid-cols-3 gap-3" dir="ltr">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                    <button key={digit} type="button" disabled={loading} onClick={() => { setPasscode((current) => current.length < 4 ? current + digit : current); setError(null); }}
                      className="h-14 sm:h-16 rounded-2xl border border-border-delicate bg-bg-paper text-2xl font-bold text-brand-primary transition-colors hover:border-brand-gold hover:bg-white active:bg-brand-primary active:text-white disabled:opacity-50">
                      {digit}
                    </button>
                  ))}
                  <span aria-hidden="true" />
                  <button type="button" disabled={loading} onClick={() => { setPasscode((current) => current.length < 4 ? current + '0' : current); setError(null); }}
                    className="h-14 sm:h-16 rounded-2xl border border-border-delicate bg-bg-paper text-2xl font-bold text-brand-primary transition-colors hover:border-brand-gold hover:bg-white active:bg-brand-primary active:text-white disabled:opacity-50">0</button>
                  <button type="button" disabled={loading || passcode.length === 0} onClick={() => { setPasscode((current) => current.slice(0, -1)); setError(null); }}
                    className="h-14 sm:h-16 rounded-2xl border border-border-delicate bg-bg-paper text-brand-primary flex items-center justify-center transition-colors hover:border-brand-gold hover:bg-white disabled:opacity-40"
                    aria-label={tr('حذف آخر رقم', 'Delete last digit')}><Delete className="w-6 h-6" /></button>
                </div>
              </div>}

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
                  disabled={loading || (role !== 'admin' && passcode.length !== 4)}
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

        <div className={`text-center relative z-10 ${role === 'admin' ? 'mt-12' : 'mt-6'}`}>
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
