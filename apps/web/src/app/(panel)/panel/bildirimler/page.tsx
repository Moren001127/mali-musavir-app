'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Bell } from 'lucide-react';

export default function BildirimlerPage() {
  const qc = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    },
  });

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-gray-900">Bildirimler</h2>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Yükleniyor...</div>
        ) : notifications?.length === 0 ? (
          <div className="p-12 text-center">
            <Bell size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">Bildirim bulunmuyor.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications?.map((n: any) => (
              <div
                key={n.id}
                onClick={() => !n.isRead && markRead.mutate(n.id)}
                className={`p-4 flex items-start gap-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                  !n.isRead ? 'bg-blue-50' : ''
                }`}
              >
                <div
                  className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                    n.isRead ? 'bg-gray-200' : 'bg-blue-500'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      n.isRead ? 'text-gray-600' : 'text-gray-900'
                    }`}
                  >
                    {n.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(n.createdAt).toLocaleString('tr-TR')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
