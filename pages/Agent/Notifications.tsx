
import React, { useState, useEffect } from 'react';
import { Notification } from '../../types';
import { api } from '../../services/api';
import { ICONS } from '../../constants';

const Notifications: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotifications = async () => {
    const user = api.auth.getCurrentUser();
    if (user) {
      const data = await api.notifications.getAll(user.id);
      setNotifications(data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAsRead = async (id: string) => {
    await api.notifications.markAsRead(id);
    fetchNotifications();
  };

  const handleMarkAllRead = async () => {
    const user = api.auth.getCurrentUser();
    if (user) {
      await api.notifications.markAllAsRead(user.id);
      fetchNotifications();
    }
  };

  if (isLoading) return <div className="animate-pulse space-y-4">
    {[1,2,3].map(i => <div key={i} className="h-24 bg-white/5 rounded-3xl" />)}
  </div>;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">التنبيهات المركزية</h2>
          <p className="text-[10px] text-gray-600 mt-1 font-black uppercase tracking-[0.4em]">System Response Logs</p>
        </div>
        {notifications.some(n => !n.isRead) && (
          <button 
            onClick={handleMarkAllRead}
            className="text-[10px] font-black text-white/40 hover:text-white uppercase tracking-widest transition-colors"
          >
            تحديد الكل كمقروء
          </button>
        )}
      </div>

      <div className="space-y-4">
        {notifications.map((notif) => (
          <div 
            key={notif.id} 
            onClick={() => !notif.isRead && handleMarkAsRead(notif.id)}
            className={`p-6 rounded-[2rem] border transition-all cursor-pointer relative overflow-hidden group ${
              notif.isRead 
                ? 'bg-[#0A0A0A] border-white/5 opacity-60' 
                : 'bg-black border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]'
            }`}
          >
            {!notif.isRead && (
              <div className="absolute top-0 right-0 w-1 h-full bg-white group-hover:w-2 transition-all"></div>
            )}
            
            <div className="flex items-start gap-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                notif.type === 'SUCCESS' ? 'bg-green-900/20 text-green-500' :
                notif.type === 'DANGER' ? 'bg-red-900/20 text-red-500' : 'bg-blue-900/20 text-blue-500'
              }`}>
                {notif.type === 'SUCCESS' ? ICONS.Check : notif.type === 'DANGER' ? ICONS.X : ICONS.Info}
              </div>
              
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h4 className={`font-black uppercase tracking-tight ${notif.isRead ? 'text-gray-400' : 'text-white'}`}>
                    {notif.title}
                  </h4>
                  <span className="text-[9px] font-black text-gray-700 uppercase tracking-widest">
                    {new Date(notif.createdAt).toLocaleDateString('ar-EG')}
                  </span>
                </div>
                <p className={`text-sm font-bold leading-relaxed ${notif.isRead ? 'text-gray-600' : 'text-gray-400'}`}>
                  {notif.message}
                </p>
              </div>
            </div>
          </div>
        ))}

        {notifications.length === 0 && (
          <div className="py-32 text-center bg-[#050505] rounded-[3rem] border border-dashed border-white/5">
            <div className="w-16 h-16 bg-black border border-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6 text-gray-800">
              {ICONS.Notification}
            </div>
            <p className="text-gray-600 font-black uppercase tracking-[0.4em] text-[10px]">No notifications in system log</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Notifications;
