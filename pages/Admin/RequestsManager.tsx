
import React, { useState } from 'react';
import { SalesRequest, RequestStatus, SystemProduct } from '../../types';
import { ICONS } from '../../constants';

interface RequestsManagerProps {
  requests: SalesRequest[];
  systems: SystemProduct[];
  updateStatus: (id: string, status: RequestStatus, reason?: string) => void;
}

const RequestsManager: React.FC<RequestsManagerProps> = ({ requests, updateStatus }) => {
  const [selectedRequest, setSelectedRequest] = useState<SalesRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [filter, setFilter] = useState<RequestStatus | 'ALL'>('ALL');

  const filtered = requests.filter(r => filter === 'ALL' || r.status === filter);

  const openDetails = (req: SalesRequest) => {
    setSelectedRequest(req);
    setRejectionReason('');
  };

  const handleQuickAccept = (id: string) => {
    if (confirm('هل أنت متأكد من قبول هذا الطلب؟')) {
      updateStatus(id, RequestStatus.ACCEPTED);
    }
  };

  const handleQuickReject = (id: string) => {
    const reason = prompt('يرجى إدخال سبب الرفض المختصر:');
    if (reason) {
      updateStatus(id, RequestStatus.REJECTED, reason);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex gap-2 bg-[#0A0A0A] p-1 rounded-xl border border-white/5 w-fit">
          {['ALL', RequestStatus.PENDING, RequestStatus.ACCEPTED, RequestStatus.REJECTED].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                filter === f ? 'bg-white text-black' : 'text-gray-500 hover:text-white'
              }`}
            >
              {f === 'ALL' ? 'الكل' : f === RequestStatus.PENDING ? 'المعلقة' : f === RequestStatus.ACCEPTED ? 'المقبولة' : 'المرفوضة'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[#0A0A0A] rounded-2xl shadow-sm border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="bg-white/5 border-b border-white/5">
                <th className="px-6 py-4 font-black text-gray-500 text-[10px] uppercase tracking-widest">المندوب</th>
                <th className="px-6 py-4 font-black text-gray-500 text-[10px] uppercase tracking-widest">المؤسسة</th>
                <th className="px-6 py-4 font-black text-gray-500 text-[10px] uppercase tracking-widest">النظام</th>
                <th className="px-6 py-4 font-black text-gray-500 text-[10px] uppercase tracking-widest">الحالة</th>
                <th className="px-6 py-4 font-black text-gray-500 text-[10px] uppercase tracking-widest">التاريخ</th>
                <th className="px-6 py-4 font-black text-gray-500 text-[10px] uppercase tracking-widest text-left">إجراءات سريعة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map(req => (
                <tr key={req.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-6 py-4 font-bold text-white uppercase text-sm">{req.agentName}</td>
                  <td className="px-6 py-4 text-white font-bold">{req.institutionName}</td>
                  <td className="px-6 py-4">
                    <span className="text-gray-400 text-xs font-bold">{req.systemName}</span>
                    <span className="mr-2 text-[9px] bg-white/5 text-gray-400 px-2 py-0.5 rounded font-black border border-white/5">{req.subscriptionType}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                      req.status === RequestStatus.ACCEPTED ? 'bg-white text-black border-white' :
                      req.status === RequestStatus.REJECTED ? 'bg-red-900/20 text-red-500 border-red-900/30' : 
                      'bg-amber-900/20 text-amber-500 border-amber-900/30'
                    }`}>
                      {req.status === RequestStatus.ACCEPTED ? 'مقبول' : req.status === RequestStatus.REJECTED ? 'مرفوض' : 'معلق'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-[10px] font-black">{new Date(req.createdAt).toLocaleDateString('ar-EG')}</td>
                  <td className="px-6 py-4 text-left">
                    <div className="flex items-center gap-2">
                      {req.status === RequestStatus.PENDING && (
                        <>
                          <button 
                            onClick={() => handleQuickAccept(req.id)}
                            className="w-8 h-8 rounded-lg bg-green-900/20 text-green-500 flex items-center justify-center hover:bg-green-600 hover:text-white transition-all shadow-sm"
                            title="قبول فوري"
                          >
                            {ICONS.Check}
                          </button>
                          <button 
                            onClick={() => handleQuickReject(req.id)}
                            className="w-8 h-8 rounded-lg bg-red-900/20 text-red-500 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all shadow-sm"
                            title="رفض فوري"
                          >
                            {ICONS.X}
                          </button>
                        </>
                      )}
                      <button 
                        onClick={() => openDetails(req)}
                        className="bg-white/5 px-3 py-1.5 rounded-lg text-white/60 hover:text-white font-black text-[10px] uppercase tracking-widest transition-colors"
                      >
                        عرض التفاصيل
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRequest && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl flex items-center justify-center z-[100] p-6">
          <div className="bg-[#0A0A0A] w-full max-w-2xl rounded-[3rem] overflow-hidden border border-white/10 shadow-2xl animate-in zoom-in duration-300">
            <div className="p-8 border-b border-white/5 flex items-center justify-between">
              <div>
                <h4 className="text-2xl font-black text-white tracking-tighter uppercase italic">تفاصيل العملية الشرائية</h4>
                <p className="text-[9px] text-gray-600 font-black uppercase tracking-[0.4em] mt-1">Transaction Identity: {selectedRequest.id}</p>
              </div>
              <button onClick={() => setSelectedRequest(null)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white hover:text-black transition-all">
                {ICONS.X}
              </button>
            </div>
            <div className="p-10 space-y-8">
              <div className="grid grid-cols-2 gap-y-8 gap-x-12">
                <div>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-widest mb-1">اسم المؤسسة المستهدفة</p>
                  <p className="font-black text-white text-xl tracking-tighter uppercase">{selectedRequest.institutionName}</p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-widest mb-1">المندوب الميداني</p>
                  <p className="font-black text-white text-lg tracking-tighter">{selectedRequest.agentName}</p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-widest mb-1">النظام المعتمد</p>
                  <p className="font-black text-white text-lg uppercase tracking-tighter">{selectedRequest.systemName}</p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 font-black uppercase tracking-widest mb-1">فئة الاشتراك</p>
                  <p className="font-black text-white text-lg">{selectedRequest.subscriptionType}</p>
                </div>
              </div>

              {selectedRequest.status === RequestStatus.PENDING ? (
                <div className="space-y-6 pt-8 border-t border-white/5">
                  <div className="space-y-3">
                    <label className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em] mr-4">Administrative Feedback / ملاحظات الإدارة</label>
                    <textarea 
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      className="w-full px-6 py-4 rounded-2xl bg-black border border-white/5 text-white outline-none focus:border-white transition-all text-sm font-bold resize-none"
                      placeholder="اكتب سبب الرفض هنا في حال عدم القبول..."
                      rows={3}
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <button 
                      onClick={() => {
                        updateStatus(selectedRequest.id, RequestStatus.ACCEPTED);
                        setSelectedRequest(null);
                      }}
                      className="flex-1 bg-white text-black font-black py-5 rounded-[1.5rem] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-95 transition-all text-[11px] uppercase tracking-[0.4em]"
                    >
                      موافقة نهائية
                    </button>
                    <button 
                      onClick={() => {
                        if (!rejectionReason) return alert('يجب كتابة سبب الرفض أولاً');
                        updateStatus(selectedRequest.id, RequestStatus.REJECTED, rejectionReason);
                        setSelectedRequest(null);
                      }}
                      className="flex-1 bg-red-900/20 text-red-500 border border-red-900/30 font-black py-5 rounded-[1.5rem] hover:bg-red-600 hover:text-white active:scale-95 transition-all text-[11px] uppercase tracking-[0.4em]"
                    >
                      رفض الطلب
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pt-8 border-t border-white/5">
                   <p className="text-[9px] text-gray-600 font-black uppercase tracking-widest mb-2">حالة الطلب الحالية</p>
                   <div className={`p-6 rounded-[1.5rem] border ${
                     selectedRequest.status === RequestStatus.ACCEPTED ? 'bg-white/10 border-white/20 text-white' : 'bg-red-900/10 border-red-900/20 text-red-500'
                   }`}>
                      <p className="font-black text-sm uppercase tracking-widest flex items-center gap-3">
                        {selectedRequest.status === RequestStatus.ACCEPTED ? ICONS.Check : ICONS.X}
                        {selectedRequest.status === RequestStatus.ACCEPTED ? 'تم قبول هذا الطلب وتوثيقه' : 'هذا الطلب تم رفضه وإغلاقه'}
                      </p>
                      {selectedRequest.rejectionReason && (
                        <p className="mt-3 text-xs font-bold text-gray-400 italic border-t border-white/5 pt-3">السبب المسجل: {selectedRequest.rejectionReason}</p>
                      )}
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestsManager;
