
import React, { useState } from 'react';
import { SalesRequest, RequestStatus } from '../../types';
import { ICONS } from '../../constants';

interface MyRequestsProps {
  requests: SalesRequest[];
}

const MyRequests: React.FC<MyRequestsProps> = ({ requests }) => {
  const [filter, setFilter] = useState<RequestStatus | 'ALL'>('ALL');

  const filteredRequests = requests.filter(req => filter === 'ALL' || req.status === filter);

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.ACCEPTED:
        return <span className="px-4 py-1.5 bg-white text-black rounded-full text-[10px] font-black uppercase tracking-widest">مقبول</span>;
      case RequestStatus.REJECTED:
        return <span className="px-4 py-1.5 bg-red-900/20 text-red-500 border border-red-900/30 rounded-full text-[10px] font-black uppercase tracking-widest">مرفوض</span>;
      case RequestStatus.NEED_INFO:
        return <span className="px-4 py-1.5 bg-blue-900/20 text-blue-400 border border-blue-900/30 rounded-full text-[10px] font-black uppercase tracking-widest">معلومات</span>;
      default:
        return <span className="px-4 py-1.5 bg-amber-900/20 text-amber-500 border border-amber-900/30 rounded-full text-[10px] font-black uppercase tracking-widest">معلق</span>;
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h3 className="text-3xl font-black text-white tracking-tighter uppercase italic">سجل العمليات الميدانية</h3>
          <p className="text-[10px] text-gray-600 font-black uppercase tracking-[0.4em] mt-1">Deployment History Log</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar">
          {['ALL', RequestStatus.PENDING, RequestStatus.ACCEPTED, RequestStatus.REJECTED].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
                filter === f 
                  ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.1)]' 
                  : 'bg-black text-gray-500 border-white/5 hover:border-white/20'
              }`}
            >
              {f === 'ALL' ? 'الكل' : f === RequestStatus.PENDING ? 'المعلقة' : f === RequestStatus.ACCEPTED ? 'المقبولة' : 'المرفوضة'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6">
        {filteredRequests.map((req) => (
          <div key={req.id} className="bg-[#0A0A0A] p-5 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] border border-white/5 shadow-2xl transition-all hover:border-white/10 group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 blur-3xl -mr-16 -mt-16 group-hover:bg-white/10 transition-all"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start gap-6 relative z-10">
              <div className="flex gap-4 sm:gap-5">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-black border border-white/5 flex items-center justify-center text-white/40 group-hover:bg-white group-hover:text-black transition-all flex-shrink-0">
                  {ICONS.Institutions}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-black text-lg sm:text-xl text-white tracking-tighter uppercase truncate">{req.institutionName}</h4>
                  <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-2 mt-2">
                    <span className="flex items-center gap-2 text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      <span className="text-white/20">{ICONS.Package}</span> {req.systemName}
                    </span>
                    <span className="flex items-center gap-2 text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      <span className="text-white/20">{ICONS.Location}</span> {req.location}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-4 border-t border-white/5 pt-4 md:border-t-0 md:pt-0">
                {getStatusBadge(req.status)}
                <p className="text-[9px] sm:text-[10px] font-black text-gray-700 tabular-nums uppercase tracking-widest">
                  {new Date(req.createdAt).toLocaleDateString('ar-EG')}
                </p>
              </div>
            </div>

            {req.status === RequestStatus.REJECTED && req.rejectionReason && (
              <div className="mt-6 sm:mt-8 p-5 sm:p-6 bg-red-900/10 border border-red-900/20 rounded-2xl sm:rounded-3xl">
                <p className="text-[8px] sm:text-[9px] text-red-500/50 uppercase font-black tracking-[0.3em] mb-2">Administrative Feedback:</p>
                <p className="text-xs sm:text-sm text-red-400 font-bold italic">"{req.rejectionReason}"</p>
              </div>
            )}

            <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-white/5 grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 relative z-10">
              <div className="space-y-1">
                <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest">نوع الاشتراك</p>
                <p className="font-black text-white text-xs uppercase italic">{req.subscriptionType}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest">المسؤول</p>
                <p className="font-black text-white text-xs uppercase">{req.contactName}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest">رقم التواصل</p>
                <p className="font-black text-white text-xs tabular-nums">{req.contactPhone}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] text-gray-700 font-black uppercase tracking-widest">توقيت الإرسال</p>
                <p className="font-black text-white text-xs tabular-nums">
                  {new Date(req.createdAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'})}
                </p>
              </div>
            </div>
          </div>
        ))}

        {filteredRequests.length === 0 && (
          <div className="bg-[#050505] py-32 rounded-[3rem] border border-dashed border-white/5 text-center">
            <div className="w-20 h-20 bg-black border border-white/5 rounded-3xl flex items-center justify-center mx-auto mb-6 text-gray-800">
              {ICONS.MyRequests}
            </div>
            <p className="text-gray-600 font-black uppercase tracking-[0.5em] text-[10px]">No deployment records found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyRequests;
