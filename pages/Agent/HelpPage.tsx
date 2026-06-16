import React from 'react';

interface HelpPageProps {
  supportPhone: string;
}

const HelpPage: React.FC<HelpPageProps> = ({ supportPhone }) => {
  const displayPhone = supportPhone || '+966 50 000 0000';

  return (
    <div className="space-y-8 pb-20">
      {/* Header card matching design layout */}
      <div className="bg-[#0A0A0A] p-6 sm:p-10 lg:p-12 rounded-[2.5rem] sm:rounded-[3.5rem] border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
        <div className="text-right">
          <h3 className="text-3xl font-black text-white tracking-tighter uppercase italic">مركز الدعم والمساعدة</h3>
          <p className="text-[10px] text-gray-600 mt-2 font-black uppercase tracking-[0.5em]">Field Agent Support Desk</p>
        </div>
      </div>

      {/* Main layout */}
      <div className="max-w-md mx-auto w-full">
        
        {/* Support Call Widget */}
        <div className="bg-[#0A0A0A] border border-white/5 p-8 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] flex flex-col items-center justify-center text-center relative overflow-hidden h-fit">
          <div className="absolute -inset-6 bg-white opacity-[0.02] blur-3xl rounded-full"></div>
          
          <div className="relative w-20 h-20 bg-white/5 border border-white/10 rounded-3xl flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>

          <h4 className="text-lg font-black text-white mb-2">الدعم الفني</h4>
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-6">Immediate Helpdesk Line</p>

          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            للتواصل مع ادارة الفريق، يرجى الاتصال على الرقم :
          </p>

          <div className="bg-black/50 border border-white/5 rounded-2xl py-4 px-6 mb-6 w-full">
            <span className="block text-[8px] font-black text-gray-500 uppercase tracking-widest mb-1">رقم الاتصال</span>
            <span className="font-mono text-base font-black text-white tracking-widest">{displayPhone}</span>
          </div>

          <a
            href={`tel:${displayPhone.replace(/\s+/g, '')}`}
            className="w-full flex items-center justify-center py-4 bg-white text-black font-black rounded-2xl hover:shadow-[0_0_20px_rgba(255,255,255,0.15)] active:scale-95 transition-all text-xs"
          >
            اتصال الآن بالدعم
          </a>
        </div>

      </div>
    </div>
  );
};

export default HelpPage;
