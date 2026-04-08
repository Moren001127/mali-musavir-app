'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { kdvApi } from '@/lib/kdv';
import { apiClient } from '@/lib/api';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

const MONTHS = [
  '01 - Ocak','02 - Şubat','03 - Mart','04 - Nisan','05 - Mayıs','06 - Haziran',
  '07 - Temmuz','08 - Ağustos','09 - Eylül','10 - Ekim','11 - Kasım','12 - Aralık',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i);

type KdvTypeOption = 'KDV_191' | 'KDV_391' | 'ISLETME_GELIR' | 'ISLETME_GIDER';

const TYPE_OPTIONS: { value: KdvTypeOption; label: string; sub: string; color: string }[] = [
  { value: 'KDV_191',       label: '191 — İndirilecek KDV',  sub: 'Luca → KDV Muavin Defteri (Alış)',   color: 'border-blue-500 bg-blue-50' },
  { value: 'KDV_391',       label: '391 — Hesaplanan KDV',   sub: 'Luca → KDV Muavin Defteri (Satış)',  color: 'border-emerald-500 bg-emerald-50' },
  { value: 'ISLETME_GELIR', label: 'İşletme — Gelir',        sub: 'Luca → İşletme Defteri Gelir Sayfası', color: 'border-purple-500 bg-purple-50' },
  { value: 'ISLETME_GIDER', label: 'İşletme — Gider',        sub: 'Luca → İşletme Defteri Gider Sayfası', color: 'border-orange-500 bg-orange-50' },
];

export default function YeniKdvKontrolPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

  const [type, setType] = useState<KdvTypeOption>('KDV_191');
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(currentMonth);
  const [taxpayerId, setTaxpayerId] = useState('');
  const [notes, setNotes] = useState('');

  // Mükellef listesi
  const { data: taxpayers } = useQuery({
    queryKey: ['taxpayers-list'],
    queryFn: () => apiClient.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });

  const create = useMutation({
    mutationFn: () =>
      kdvApi.createSession({
        type,
        periodLabel: `${year}/${month}`,
        taxpayerId: taxpayerId || undefined,
        notes: notes || undefined,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['kdv-sessions'] });
      toast.success('Kontrol oturumu oluşturuldu');
      router.push(`/panel/kdv-kontrol/${data.id}`);
    },
    onError: () => toast.error('Oturum oluşturulamadı'),
  });

  const selectedType = TYPE_OPTIONS.find((t) => t.value === type)!;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="flex items-center gap-3">
        <Link href="/panel/kdv-kontrol" className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-500" />
        </Link>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Yeni KDV / İşletme Kontrolü</h2>
          <p className="text-sm text-gray-500">Mükellef, dönem ve kontrol türü seçin</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">

        {/* 1. Mükellef Seçimi */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Mükellef <span className="text-gray-400 font-normal">(isteğe bağlı)</span>
          </label>
          <div className="relative">
            <select
              value={taxpayerId}
              onChange={(e) => setTaxpayerId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white pr-10"
            >
              <option value="">— Genel kontrol (mükellef seçilmedi) —</option>
              {taxpayers?.map((tp: any) => (
                <option key={tp.id} value={tp.id}>
                  {tp.companyName || `${tp.firstName ?? ''} ${tp.lastName ?? ''}`.trim()}
                  {tp.taxNumber ? ` (${tp.taxNumber})` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="absolute right-3 top-3 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* 2. Kontrol Türü */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Kontrol Türü</label>
          <div className="grid grid-cols-2 gap-3">
            {TYPE_OPTIONS.map(({ value, label, sub, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`p-4 rounded-xl border-2 text-left transition-colors ${
                  type === value ? color : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <p className="font-semibold text-sm text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-tight">{sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Dönem */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Yıl</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ay</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTHS.map((m) => (
                <option key={m.slice(0, 2)} value={m.slice(0, 2)}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 4. Not */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Not (isteğe bağlı)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Örn: Revizyon kontrolü"
          />
        </div>

        {/* Özet */}
        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
          <p><span className="font-medium">Tür:</span> {selectedType.label}</p>
          <p><span className="font-medium">Dönem:</span> {year}/{month}</p>
          {taxpayerId && taxpayers && (
            <p>
              <span className="font-medium">Mükellef:</span>{' '}
              {(() => {
                const tp = taxpayers.find((t: any) => t.id === taxpayerId);
                return tp ? (tp.companyName || `${tp.firstName ?? ''} ${tp.lastName ?? ''}`.trim()) : '';
              })()}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <Link
            href="/panel/kdv-kontrol"
            className="flex-1 text-center py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            İptal
          </Link>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm"
          >
            {create.isPending ? 'Oluşturuluyor...' : 'Kontrol Oturumu Oluştur'}
          </button>
        </div>
      </div>
    </div>
  );
}
