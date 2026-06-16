
import React, { useState } from 'react';
import { Institution, SalesRequest } from '../../types';
import { ICONS } from '../../constants';

interface LeadsManagerProps {
  institutions: Institution[];
  requests: SalesRequest[];
  onDelete: (id: string) => void;
}

const LeadsManager: React.FC<LeadsManagerProps> = ({ institutions, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = institutions.filter(inst => 
    inst.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inst.city.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 pb-20">
      <div className="bg-[#0A0A0A] p-6 sm:p-10 lg:p-12 rounded-[2.5rem] sm:rounded-[3.5rem] border border-white/5 flex flex-col lg:flex-row items-center justify-between gap-8 shadow-2xl">
        <div className="text-center lg:text-right">
          <h3 className="text-3xl font-black text-white tracking-tighter uppercase italic">قاعدة بيانات العملاء</h3>
          <p className="text-[10px] text-gray-600 mt-2 font-black uppercase tracking-[0.5em]">Centralized Intelligence Database</p>
        </div>
        
        <div className="relative w-full max-w-xl">
          <input 
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-14 pr-8 py-5 rounded-[2rem] bg-black border border-white/5 text-white outline-none focus:border-white transition-all font-bold text-sm shadow-inner"
            placeholder="ابحث عن عميل، مدينة، أو عنوان محدد..."
          />
          <div className="absolute top-1/2 left-6 -translate-y-1/2 text-gray-600">
            {ICONS.Search}
          </div>
        </div>
      </div>

      <div className="bg-[#0A0A0A] rounded-[3rem] border border-white/5 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          <table className="w-full text-right border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-white/[0.02] border-b border-white/5">
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">العميل / الجهة</th>
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">العنوان</th>
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">النظام المعروض</th>
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">المسؤول الميداني</th>
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">تاريخ الرصد</th>
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">تصنيف الحالة</th>
                <th className="px-8 py-6 font-black text-gray-500 text-[10px] uppercase tracking-[0.4em]">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {filtered.map(inst => (
                <tr key={inst.id} className="hover:bg-white/[0.01] transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-black border border-white/5 flex items-center justify-center text-white/40 group-hover:text-white group-hover:border-white/20 transition-all">
                        {ICONS.Institutions}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-black text-white text-base tracking-tight">{inst.name}</span>
                        {inst.rejectionReason && (
                          <span className="text-[10px] text-red-400 font-bold mt-1 bg-red-950/20 border border-red-500/10 px-2 py-0.5 rounded-md self-start">
                            سبب الرفض: {inst.rejectionReason}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col">
                      <span className="text-gray-300 font-bold text-sm">{inst.city}</span>
                      <span className="text-[10px] text-gray-600 font-black uppercase tracking-wider">{inst.address}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-white font-black text-[11px] uppercase italic tracking-tighter">
                      {inst.offeredSystem || 'غير محدد'}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-[10px] font-black text-gray-500">
                        {inst.lastVisitedBy?.charAt(0)}
                      </div>
                      <span className="text-gray-300 font-bold text-sm uppercase tracking-tighter">{inst.lastVisitedBy}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-gray-500 font-black text-[11px] tabular-nums">{inst.lastVisitDate}</span>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border ${
                      inst.status === 'CUSTOMER' ? 'bg-white text-black border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' :
                      inst.status === 'INTERESTED' ? 'bg-blue-900/20 text-blue-400 border-blue-900/30' :
                      inst.status === 'REJECTED' ? 'bg-red-900/20 text-red-500 border-red-900/30' : 
                      'bg-gray-900/40 text-gray-500 border-gray-800'
                    }`}>
                      {inst.status === 'CUSTOMER' ? 'عميل نشط' :
                       inst.status === 'INTERESTED' ? 'مهتم' :
                       inst.status === 'REJECTED' ? 'تم الرفض' : 'تحت الدراسة'}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <button 
                      onClick={() => onDelete(inst.id)}
                      className="w-10 h-10 rounded-xl bg-red-900/10 text-red-500 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all"
                    >
                      {ICONS.X}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filtered.length === 0 && (
          <div className="py-32 text-center">
            <div className="w-20 h-20 bg-black border border-white/5 rounded-3xl flex items-center justify-center mx-auto mb-6 text-gray-800">
              {ICONS.Search}
            </div>
            <p className="text-gray-600 font-black uppercase tracking-[0.5em] text-[10px]">No matches found in the sector</p>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center px-10 text-[9px] font-black text-gray-700 uppercase tracking-[0.4em]">
        <span>Total Records: {filtered.length}</span>
        <span>Secure Access Protocol v3.1</span>
      </div>
    </div>
  );
};

export default LeadsManager;
