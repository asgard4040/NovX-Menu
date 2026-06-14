import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Utensils, Lock, User, Eye, EyeOff, AlertCircle, ChevronRight, Building2 } from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-utils';
import { UserSession } from '../types';

interface LoginPageProps {
  onLogin: (user: UserSession) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [role, setRole] = useState<'admin' | 'restaurant' | 'waiter' | 'kitchen'>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [restaurantsList, setRestaurantsList] = useState<{ id: string; restaurantName: string }[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>('');

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

    const fetchRestaurants = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'restaurants'));
        const list = snapshot.docs
          .map(doc => ({ id: doc.id, restaurantName: doc.data().restaurantName, status: doc.data().status }))
          .filter(r => r.status === 'active');
        setRestaurantsList(list);
        if (list.length > 0) {
          setSelectedRestaurantId(list[0].id);
        }
      } catch (err) {
        console.error("Error fetching restaurants list for login:", err);
      }
    };

    const fetchCustomRestaurant = async (id: string) => {
      setFetchingCustomRest(true);
      setError(null);
      try {
        const docRef = doc(db, 'restaurants', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.status === 'suspended') {
            setError('هذا الاشتراك معطل حالياً من قبل الإدارة العامة.');
          } else {
            setCustomRestaurant({
              id: docSnap.id,
              restaurantName: data.restaurantName,
              logoUrl: data.logoUrl,
              status: data.status
            });
            // Auto switch role to restaurant on specific login page
            setRole('restaurant');
          }
        } else {
          setError('رابط تسجيل دخول المطعم المخصص غير صحيح أو تالف.');
        }
      } catch (err) {
        console.error("Error loading custom restaurant info:", err);
        setError('حدث خطأ أثناء تحميل معلومات بوابة هذا المطعم.');
      } finally {
        setFetchingCustomRest(false);
      }
    };

    fetchRestaurants();

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
      if (role === 'admin') {
        if (loginRestaurantId) {
          setError('الحساب الشخصي للمشرف العام متاح فقط من خلال البوابة الرئيسية.');
          setLoading(false);
          return;
        }
        // System Admin credentials updated to request specification
        if (username === 'novx.team' && password === 'naolvix0508') {
          onLogin({ role: 'admin', name: 'Super Admin' });
        } else {
          setError('خطأ في اسم المستخدم أو كلمة المرور للأدمن');
        }
      } else if (role === 'restaurant') {
        if (!loginRestaurantId) {
          setError('عذراً، لأسباب أمنية؛ لا يمكن لمالك المطعم تسجيل الدخول إلا من خلال الرابط الأمني المخصص لمطعمه فقط.');
          setLoading(false);
          return;
        }

        const collectionPath = 'restaurants';
        try {
          const q = query(
            collection(db, collectionPath), 
            where('username', '==', username), 
            where('password', '==', password)
          );
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const docId = snapshot.docs[0].id;
            const restaurantData = snapshot.docs[0].data();

            if (docId !== loginRestaurantId) {
              setError('معلومات الدخول المدخلة غير تابعة للمطعم الحالي! يرجى الانتقال إلى رابط الدخول المخصص لمطعمك.');
            } else if (restaurantData.status === 'suspended') {
              setError('هذا الاشتراك معطل حالياً، يرجى مراجعة الإدارة');
            } else {
              onLogin({ 
                role: 'restaurant', 
                id: docId, 
                restaurantId: docId,
                name: restaurantData.restaurantName 
              });
            }
          } else {
            setError('خطأ في معلومات تسجيل دخول المطعم');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, collectionPath);
        }
      } else if (role === 'waiter') {
        if (!loginRestaurantId) {
          setError('عذراً، لأسباب أمنية؛ لا يمكن لموظفي الصالة تسجيل الدخول إلا من خلال الرابط الأمني المخصص لمطعمهم فقط.');
          setLoading(false);
          return;
        }

        const collectionPath = 'waiters';
        try {
          const q = query(
            collection(db, collectionPath), 
            where('username', '==', username), 
            where('password', '==', password),
            where('restaurantId', '==', loginRestaurantId)
          );
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const waiterData = snapshot.docs[0].data();
            if (waiterData.status === 'suspended') {
              setError('حساب الويتر معطل حالياً');
            } else {
               onLogin({ 
                role: 'waiter', 
                id: snapshot.docs[0].id, 
                restaurantId: waiterData.restaurantId,
                name: waiterData.name,
                restaurantName: waiterData.restaurantName
              });
            }
          } else {
            setError('خطأ في معلومات تسجيل دخول الويتر الخاصة بهذا المطعم.');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, collectionPath);
        }
      } else if (role === 'kitchen') {
        if (!loginRestaurantId) {
          setError('عذراً، لأسباب أمنية؛ لا يمكن لموظفي المطبخ تسجيل الدخول إلا من خلال الرابط الأمني المخصص لمطعمهم فقط.');
          setLoading(false);
          return;
        }

        const collectionPath = 'kitchen_staff';
        try {
          const q = query(
            collection(db, collectionPath), 
            where('username', '==', username), 
            where('password', '==', password),
            where('restaurantId', '==', loginRestaurantId)
          );
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const kitchenData = snapshot.docs[0].data();
            if (kitchenData.status === 'suspended') {
              setError('حساب المطبخ معطل حالياً');
            } else {
               onLogin({ 
                role: 'kitchen', 
                id: snapshot.docs[0].id, 
                restaurantId: kitchenData.restaurantId,
                name: kitchenData.name,
                restaurantName: kitchenData.restaurantName
              });
            }
          } else {
            setError('خطأ في معلومات تسجيل دخول طاقم المطبخ الخاصة بهذا المطعم.');
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, collectionPath);
        }
      }
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const currentRoles = loginRestaurantId && customRestaurant
    ? ([
        { id: 'restaurant', label: 'المالك / المدير' },
        { id: 'waiter', label: 'قسم الصالة (ويتر)' },
        { id: 'kitchen', label: 'قسم المطبخ' }
      ] as const)
    : ([
        { id: 'admin', label: 'المسؤول العام' }
      ] as const);

  return (
    <div className="min-h-screen bg-bg-paper flex items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-brand-primary/10" dir="rtl">
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
            <p className="text-sm font-bold text-brand-primary">جاري استدعاء البوابة المخصصة للمطعم...</p>
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
                  <p className="text-brand-gold text-[10px] font-bold uppercase tracking-widest leading-none mb-3">البوابة الأمنية المخصصة</p>
                  <h1 className="text-4xl font-display text-brand-primary italic tracking-tight font-bold mb-2">
                    {customRestaurant.restaurantName}
                  </h1>
                  <p className="text-text-muted text-[10px] uppercase font-sans font-medium tracking-tight">نظام الموظفين والشركاء المعتمد</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-6">
                    <span className="w-12 h-[1px] bg-brand-gold" />
                    <Utensils className="text-brand-gold w-6 h-6 italic" />
                    <span className="w-12 h-[1px] bg-brand-gold" />
                  </div>
                  <h1 className="text-5xl font-display text-brand-primary italic tracking-tight mb-4">نوفكس AI</h1>
                  <p className="text-brand-gold text-xs font-bold uppercase tracking-widest text-center">الفن الرفيع في إدارة المطاعم</p>
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
                <label className="text-xs font-bold text-brand-gold uppercase block pr-2">اسم المستخدم / الهوية</label>
                <div className="relative group">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full bg-transparent border-b border-border-delicate py-3.5 pl-10 font-display text-xl text-brand-primary placeholder:text-text-muted/20 focus:outline-none focus:border-brand-primary transition-all text-right"
                    placeholder="أدخل اسم المستخدم"
                  />
                  <User className="absolute left-0 top-1/2 -translate-y-1/2 text-border-delicate group-focus-within:text-brand-primary transition-colors w-5 h-5 opacity-40" />
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-brand-gold uppercase block pr-2">كلمة المرور / الرقم السري</label>
                <div className="relative group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-transparent border-b border-border-delicate py-3.5 pl-20 font-display text-xl text-brand-primary placeholder:text-text-muted/20 focus:outline-none focus:border-brand-primary transition-all text-right"
                    placeholder="أدخل الرقم السري"
                  />
                  <Lock className="absolute left-0 top-1/2 -translate-y-1/2 text-border-delicate group-focus-within:text-brand-primary transition-colors w-5 h-5 opacity-40" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-8 top-1/2 -translate-y-1/2 text-text-muted/40 hover:text-brand-primary hover:scale-105 transition-all text-xs cursor-pointer flex items-center gap-1.5 px-2 py-1 bg-bg-paper hover:bg-brand-primary/5 border border-border-delicate/40 select-none"
                    title={showPassword ? "إخفاء كلمة المرور" : "عرض كلمة المرور"}
                  >
                    {showPassword ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold">إخفاء</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold">عرض</span>
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
                  <span className="relative z-10 tracking-widest font-bold text-xs uppercase">الدخول الآمن للبوابة</span>
                  <ChevronRight className="relative z-10 w-4 h-4 group-hover:-translate-x-2 transition-transform rotate-180" />
                  {loading && <div className="absolute inset-0 bg-brand-primary flex items-center justify-center z-20"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
                </button>
              </div>
            </form>

            {/* Explanatory footer for central login */}
            {!loginRestaurantId && (
              <div className="mt-8 p-5 border border-dashed border-border-delicate bg-bg-paper text-center">
                <p className="text-xs text-text-muted leading-relaxed font-sans font-medium">
                  🔒 <strong>تنبيه الزملاء وطاقم العمل:</strong> يرجى استخدام <strong>رابط تسجيل الدخول الفريد</strong> المرسل لمطعمكم للدخول الآمن إلى الصالة والمطبخ والمدير المالي.
                </p>
              </div>
            )}
          </>
        )}

        <div className="mt-16 text-center relative z-10">
          <p className="text-xs text-text-muted uppercase tracking-widest italic font-medium">
             صـنـع بـأكـمـل <span className="text-brand-gold">أنـاقـة رقـمـيـة</span>
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
