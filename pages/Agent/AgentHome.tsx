
import React from 'react';
import { User, SalesRequest, RequestStatus, SystemProduct } from '../../types';
import StatsCard from '../../components/StatsCard';
import { ICONS } from '../../constants';

interface AgentHomeProps {
  user: User;
  requests: SalesRequest[];
  systems: SystemProduct[];
}

const AgentHome: React.FC<AgentHomeProps> = ({ user, requests, systems }) => {
  const safeRequests = Array.isArray(requests) ? requests : [];
  const safeSystems = Array.isArray(systems) ? systems : [];
  
  const myRequests = safeRequests.filter(r => r.agentId === user.id) || [];
  const accepted = myRequests.filter(r => r.status === RequestStatus.ACCEPTED);
  const acceptedCount = accepted.length;
  const pendingCount = myRequests.filter(r => r.status === RequestStatus.PENDING).length;
  const rejectedCount = myRequests.filter(r => r.status === RequestStatus.REJECTED).length;

  const totalCommission = accepted.reduce((sum, req) => {
    const system = safeSystems.find(s => s.id === req.systemId);
    if (!system || !Array.isArray(system.tiers)) return sum;
    const tier = system.tiers.find(t => t.name === req.subscriptionType);
    return sum + (tier ? (Number(tier.commission) || 0) : 0);
  }, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tighter uppercase italic">مرحباً، {user.name} 👋</h1>
          <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.4em] mt-1">Field Agent Dashboard / Operational Summary</p>
        </div>
        <div className="bg-white/5 px-6 py-3 rounded-2xl border border-white/10">
           <p className="text-[8px] text-gray-500 font-black uppercase tracking-widest mb-1 text-left">Current Status</p>
           <p className="text-xs font-black text-green-500 uppercase tracking-tighter italic">Active & Authorized</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="إجمالي الطلبات" value={myRequests.length} icon={ICONS.MyRequests} color="" subtitle="Total Dispatched" />
        <StatsCard title="طلبات مقبولة" value={acceptedCount} icon={ICONS.Check} color="" subtitle="Successful Closures" />
        <StatsCard title="طلبات معلقة" value={pendingCount} icon={ICONS.Pending} color="" subtitle="In Review Process" />
        <StatsCard title="طلبات مرفوضة" value={rejectedCount} icon={ICONS.X} color="" subtitle="Rejected/Cancelled" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-[#0A0A0A] p-6 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] border border-[#1A1A1A]">
          <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-8 border-r-2 border-white pr-4">آخر العمليات الميدانية</h3>
          <div className="space-y-4">
            {myRequests.slice(0, 5).map(req => (
              <div key={req.id} className="flex items-center justify-between p-4 sm:p-6 bg-black border border-white/5 rounded-[1.5rem] sm:rounded-[2rem] hover:border-white/20 transition-all group">
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center border transition-all ${
                    req.status === RequestStatus.ACCEPTED ? 'bg-white text-black border-white' :
                    req.status === RequestStatus.REJECTED ? 'bg-red-900/10 text-red-500 border-red-900/20' : 'bg-black text-amber-500 border-amber-900/20'
                  }`}>
                    {req.status === RequestStatus.ACCEPTED ? ICONS.Check : req.status === RequestStatus.REJECTED ? ICONS.X : ICONS.Pending}
                  </div>
                  <div>
                    <p className="font-black text-white text-base sm:text-lg tracking-tighter uppercase">{req.institutionName}</p>
                    <p className="text-[8px] sm:text-[9px] text-gray-500 font-black uppercase tracking-widest mt-1">
                      {req.systemName} • {req.subscriptionType}
                    </p>
                  </div>
                </div>
                <div className="hidden sm:block">
                  <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                    req.status === RequestStatus.ACCEPTED ? 'bg-white/10 text-white border-white/20' :
                    req.status === RequestStatus.REJECTED ? 'bg-red-900/10 text-red-500 border-red-900/20' : 'bg-amber-900/10 text-amber-500 border-amber-900/20'
                  }`}>
                    {req.status === RequestStatus.ACCEPTED ? 'ACCEPTED' : req.status === RequestStatus.REJECTED ? 'REJECTED' : 'PENDING'}
                  </span>
                </div>
              </div>
            ))}
            {myRequests.length === 0 && (
              <div className="text-center py-20 text-gray-600 font-black uppercase tracking-widest text-[10px]">No operations recorded yet</div>
            )}
          </div>
        </div>

        <div className="bg-white p-8 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] flex flex-col justify-between shadow-2xl relative overflow-hidden group min-h-[300px]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-black/5 blur-3xl -mr-16 -mt-16 group-hover:bg-black/10 transition-all"></div>
          <div>
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-black text-white rounded-xl sm:rounded-[1.5rem] flex items-center justify-center mb-6 sm:mb-8 shadow-xl">
              {ICONS.Trend}
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-black tracking-tighter uppercase italic leading-tight">العمولة المكتسبة الحقيقية</h3>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.3em] mt-2 italic">Dynamic Tier Calculation</p>
          </div>
          <div className="mt-8 sm:mt-12 space-y-2">
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">المستحق الحالي (IQD)</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl sm:text-5xl font-black text-black tracking-tighter">{(totalCommission || 0).toLocaleString()}</span>
              <span className="text-xs sm:text-sm font-black text-gray-400 uppercase">د.ع</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentHome;
