
import React, { useState } from 'react';
import { SalesRequest, RequestStatus, SystemProduct, User } from '../../types';
import StatsCard from '../../components/StatsCard';
import { ICONS } from '../../constants';
import { api } from '../../services/api';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line 
} from 'recharts';

interface AdminDashboardProps {
  requests: SalesRequest[];
  agents: User[];
  systems: SystemProduct[];
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ requests, agents, systems }) => {
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const safeRequests = Array.isArray(requests) ? requests : [];
  const safeAgents = Array.isArray(agents) ? agents : [];

  // حساب الإحصائيات الحقيقية
  const today = new Date().toISOString().split('T')[0];
  const todayRequests = safeRequests.filter(r => r.createdAt && r.createdAt.startsWith(today)).length;
  const pendingCount = safeRequests.filter(r => r.status === RequestStatus.PENDING).length;
  const acceptedCount = safeRequests.filter(r => r.status === RequestStatus.ACCEPTED).length;
  
  const conversionRate = safeRequests.length > 0 
    ? Math.round((acceptedCount / safeRequests.length) * 100) 
    : 0;

  const handleAiAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const insight = await api.ai.analyzePerformance(safeRequests);
      setAiInsight(insight);
    } catch (e) {
      setAiInsight("Error retrieving AI data.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // توليد بيانات الرسوم البيانية من الطلبات الفعلية
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const count = safeRequests.filter(r => r.createdAt && r.createdAt.startsWith(dateStr)).length;
    return { name: dayName, sales: count };
  });

  const subscriptionData = [
    { name: 'STD', value: safeRequests.filter(r => r.subscriptionType === 'STANDARD').length },
    { name: 'PLS', value: safeRequests.filter(r => r.subscriptionType === 'PLUS').length },
    { name: 'PRM', value: safeRequests.filter(r => r.subscriptionType === 'PREMIUM').length },
  ].filter(d => d.value > 0);

  const PIE_COLORS = ['#FFFFFF', '#888888', '#333333'];

  return (
    <div className="space-y-8 lg:space-y-12 pb-20">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between border-b border-[#111] pb-8 gap-6">
        <div>
          <h1 className="text-3xl lg:text-5xl font-black text-white tracking-tighter uppercase">INTELLIGENCE</h1>
          <p className="text-gray-600 text-[9px] lg:text-[10px] mt-2 font-black uppercase tracking-[0.6em]">Real-time Strategic Overview</p>
        </div>
        <button 
          onClick={handleAiAnalyze}
          disabled={isAnalyzing}
          className="flex items-center justify-center gap-3 px-6 lg:px-8 py-4 lg:py-5 bg-white text-black rounded-2xl text-[9px] lg:text-[10px] font-black uppercase tracking-[0.4em] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] disabled:opacity-50 transition-all w-full lg:w-auto"
        >
          {ICONS.AI}
          {isAnalyzing ? "Processing..." : "Generate AI Insight"}
        </button>
      </div>

      {aiInsight && (
        <div className="bg-[#050505] border border-white/10 p-5 sm:p-8 lg:p-10 rounded-[2rem] lg:rounded-[3rem] shadow-2xl animate-in slide-in-from-top duration-700">
          <div className="flex items-center gap-3 mb-6 lg:mb-8">
            <div className="w-8 h-8 lg:w-10 h-10 bg-white text-black rounded-xl flex items-center justify-center font-black text-xs">AI</div>
            <h3 className="text-[8px] sm:text-[9px] lg:text-[10px] font-black uppercase tracking-[0.4em]">Strategic Recommendations</h3>
          </div>
          <div className="text-gray-400 text-xs lg:text-sm leading-relaxed whitespace-pre-line font-bold border-r-2 lg:border-r-4 border-white pr-4 lg:pr-8">
            {aiInsight}
          </div>
          <button onClick={() => setAiInsight(null)} className="mt-8 lg:mt-10 text-[8px] lg:text-[9px] font-black uppercase tracking-[0.5em] text-gray-700 hover:text-white transition-colors">Terminate View</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatsCard title="Daily Intake" value={todayRequests} icon={ICONS.SendRequest} color="" subtitle="Today's Requests" />
        <StatsCard title="Pending" value={pendingCount} icon={ICONS.Pending} color="" subtitle="Awaiting Review" />
        <StatsCard title="Confirmed" value={acceptedCount} icon={ICONS.Check} color="" subtitle="Total Sales" />
        <StatsCard title="Conversion" value={`${conversionRate}%`} icon={ICONS.Trend} color="" subtitle="Success Velocity" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-[#0A0A0A] p-5 sm:p-8 lg:p-10 rounded-[2rem] lg:rounded-[3rem] border border-[#1A1A1A]">
          <h3 className="text-[9px] lg:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-8 lg:mb-12">Weekly Velocity (Real Activity)</h3>
          <div className="h-[250px] lg:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={last7Days}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#111" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#444', fontSize: 9, fontWeight: '900'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#444', fontSize: 9, fontWeight: '900'}} />
                <Tooltip contentStyle={{backgroundColor: '#000', borderRadius: '15px', border: '1px solid #222', color: '#fff'}} />
                <Line type="monotone" dataKey="sales" stroke="#FFFFFF" strokeWidth={4} dot={{r: 4, fill: '#000', stroke: '#fff', strokeWidth: 2}} activeDot={{r: 6, fill: '#fff'}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#0A0A0A] p-5 sm:p-8 lg:p-10 rounded-[2rem] lg:rounded-[3rem] border border-[#1A1A1A]">
          <h3 className="text-[9px] lg:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-8 lg:mb-12">Market Tier Distribution</h3>
          <div className="h-[250px] lg:h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={subscriptionData.length > 0 ? subscriptionData : [{name: 'Empty', value: 1}]} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={60} 
                  outerRadius={100} 
                  paddingAngle={8} 
                  dataKey="value"
                >
                  {subscriptionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                  {subscriptionData.length === 0 && <Cell fill="#111" />}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-[#0A0A0A] p-5 sm:p-8 lg:p-12 rounded-[2rem] lg:rounded-[4rem] border border-[#1A1A1A]">
        <h3 className="text-[9px] lg:text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-8 lg:mb-12">Top Operational Agents</h3>
        <div className="overflow-x-auto -mx-6 lg:mx-0">
          <div className="inline-block min-w-full align-middle px-6 lg:px-0">
            <table className="w-full text-right">
              <thead>
                <tr className="text-[9px] lg:text-[10px] font-black text-gray-700 uppercase tracking-[0.4em] border-b border-[#111]">
                  <th className="pb-6">Operator</th>
                  <th className="pb-6 text-center">Unit Volume</th>
                  <th className="pb-6 text-center">Accepted</th>
                  <th className="pb-6 text-left">Sector</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111]">
                {safeAgents.map(agent => (
                  <tr key={agent.id} className="group transition-colors">
                    <td className="py-6 font-black text-white uppercase tracking-tighter text-sm lg:text-lg">{agent.name}</td>
                    <td className="py-6 text-center font-black text-gray-500">{safeRequests.filter(r => r.agentId === agent.id).length}</td>
                    <td className="py-6 text-center font-black text-white">{safeRequests.filter(r => r.agentId === agent.id && r.status === RequestStatus.ACCEPTED).length}</td>
                    <td className="py-6 text-left text-gray-700 font-black text-[8px] lg:text-[10px] uppercase tracking-widest">{agent.city || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
