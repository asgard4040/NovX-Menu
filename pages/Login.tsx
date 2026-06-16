import React, { useState } from 'react';

interface LoginProps {
  onLogin: (username: string, password: string) => void;
  logoUrlSetting?: string;
}

const Login: React.FC<LoginProps> = ({ onLogin, logoUrlSetting }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      return alert("يرجى إدخال اسم المستخدم وكلمة المرور");
    }
    onLogin(username.trim(), password.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-6 relative overflow-hidden">
      {/* Light ambient aura glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white opacity-[0.03] rounded-full blur-[100px]"></div>

      <div className="max-w-md w-full relative z-10" dir="rtl">
        <div className="text-center mb-12">
          <div className="relative inline-block mb-10 group">
             <div className="absolute -inset-6 bg-white opacity-10 blur-3xl rounded-full group-hover:opacity-20 transition-opacity"></div>
             <div className="relative w-36 h-36 bg-[#050505] border-2 border-white/5 rounded-[3.5rem] flex items-center justify-center overflow-hidden shadow-2xl transition-all group-hover:scale-105 group-hover:border-white/20">
                <img 
                  src={logoUrlSetting || "https://picsum.photos/seed/novx/400/400"} 
                  alt="System Logo" 
                  className="w-full h-full object-contain p-4"
                  referrerPolicy="no-referrer"
                />
             </div>
          </div>
          <h1 className="text-5xl font-black text-white tracking-tighter mb-4 italic">MANDOUBI</h1>
          <p className="text-gray-600 text-[10px] font-black uppercase tracking-[0.8em] mr-3">Field Operation Hub</p>
        </div>

        <div className="bg-[#0A0A0A] border border-white/5 p-12 rounded-[4rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,1)]">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-2">
              <label className="block text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">اسم المستخدم</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-8 py-5 rounded-3xl bg-black border border-white/5 text-white focus:border-white focus:ring-0 outline-none transition-all font-bold placeholder:text-gray-800 text-sm placeholder-left text-right"
                placeholder="USERNAME"
              />
            </div>
            
            <div className="space-y-2">
              <label className="block text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">كلمة المرور</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-8 py-5 rounded-3xl bg-black border border-white/5 text-white focus:border-white focus:ring-0 outline-none transition-all font-bold placeholder:text-gray-800 text-sm placeholder-left text-right"
                placeholder="PASSWORD"
              />
            </div>

            <div className="pt-6">
              <button
                type="submit"
                className="w-full bg-white text-black font-black py-5 rounded-[2rem] hover:shadow-[0_0_40px_rgba(255,255,255,0.25)] active:scale-95 transition-all text-sm uppercase tracking-widest"
              >
                تسجيل الدخول
              </button>
            </div>
          </form>
        </div>

        <div className="mt-16 text-center">
          <p className="text-[8px] font-black text-gray-800 uppercase tracking-[1em]">
            SYSTEM VERSION 3.2.0 &bull; MMXXV
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
