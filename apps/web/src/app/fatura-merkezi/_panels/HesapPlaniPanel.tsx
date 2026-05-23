'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Send, RefreshCw, Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import HesapPlaniDialog from '../_dialogs/HesapPlaniDialog';
import { taxpayerName, taxpayerTaxNumber } from '../_lib/taxpayer';

/* HESAP PLANI PANELİ — mevcut hesap planını göster, Luca'dan yenile,
   yeni hesap aç, toplu yenileme yap. */
export default function HesapPlaniPanel({ taxpayerId }: { taxpayerId?: string }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const taxpayersQ = useQuery({
    queryKey: ['fatura-merkezi', 'taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data),
  });

  const taxpayers: any[] = Array.isArray(taxpayersQ.data) ? taxpayersQ.data : (taxpayersQ.data?.items || []);
  const selected = taxpayerId ? taxpayers.find((t) => t.id === taxpayerId) : null;

  const planQ = useQuery({
    queryKey: ['fatura-merkezi', 'account-plan', taxpayerId],
    enabled: !!taxpayerId,
    queryFn: () => api
      .get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, limit: 1000 } })
      .then((r) => Array.isArray(r.data) ? r.data : (r.data.accounts || r.data.items || [])),
  });

  const bulkRefreshMut = useMutation({
    mutationFn: () =>
      api.post('/fatura-muhasebelestirme/account-plan/refresh-all', {}).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(
        `Toplu yenileme başladı: ${data?.success || 0}/${data?.total || 0} iş kuyruğa alındı`,
      );
      qc.invalidateQueries({ queryKey: ['fatura-merkezi', 'account-plan'] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Toplu yenileme başlatılamadı');
    },
  });

  const items: any[] = planQ.data || [];
  const accountStats = {
    total: items.length,
    syncedToLuca: items.filter((i