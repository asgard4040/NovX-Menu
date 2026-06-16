
import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, subtitle }) => {
  return (
    <div className="bg-[#0A0A0A] p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] border border-[#1A1A1A] flex items-center justify-between transition-all hover:border-white group cursor-default">
      <div>
        <p className="text-gray-500 text-[8px] sm:text-[9px] font-black uppercase tracking-[0.3em] mb-2">{title}</p>
        <h3 className="text-3xl sm:text-4xl font-black text-white tracking-tighter">{value}</h3>
        {subtitle && <p className="text-[8px] sm:text-[9px] text-gray-600 mt-2 font-black uppercase tracking-widest">{subtitle}</p>}
      </div>
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-black border border-[#222] flex items-center justify-center text-gray-400 group-hover:text-black group-hover:bg-white transition-all duration-500 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]">
        {icon}
      </div>
    </div>
  );
};

export default StatsCard;
