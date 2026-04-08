'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const MONTHS = [
  'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
  'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık',
];

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

type MonthlyStatus = {
  id?: string;
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  kontrolEdildi: boolean;
  beyannameVerildi: boolean;
  kdvKontrolEdildi: boolean;
};

type Taxpayer = {
  id: string;
  type: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxNumber: string;
  taxOffice: string;
  evrakTeslimGunu?: number;
  monthlyStatus: MonthlyStatus | null;
};

// SMS Şablonu Modal
function SmsTemplateModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/sms-templates').then(r => r.data),
  });
  const [evrakTalep, setEvrakTalep] = useState('');
  const [evrakGeldi, setEvrakGeldi] = useState('');

  const { mutate: save, isPending } = useMutation({
    mutationFn: (d: any) => api.patch('/sms-templates', d),
    onSuccess: () => {
      toast.success('Şablonlar kaydedildi');
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      onClose();
    },
  });

  const talepMsg = evrakTalep || data?.evrakTalepMesaji || '';
  const geldiMsg = evrakGeldi || data?.evrakGeldiMesaji || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="card w-full max-w-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--navy)' }}>
            WhatsApp Mesaj Şablonları
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Kullanılabilir değişkenler: <code className="bg-gray-100 px-1 rounded">{'{ad}'}</code>{' '}
          <code className="bg-gray-100 px-1 rounded">{'{dönem}'}</code>
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Evrak Talep Mesajı</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-24 resize-none focus:outline-none focus:ring-2"
              value={talepMsg}
              onChange={e => setEvrakTalep(e.target.value)}
              placeholder={data?.evrakTalepMesaji}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Evrak Geldi Mesajı</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-24 resize-none focus:outline-none focus:ring-2"
              value={geldiMsg}
              onChange={e => setEvrakGeldi(e.target.value)}
              placeholder={data?.evrakGeldiMesaji}
            />
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="btn-secondary">İptal</button>
          <button
            className="btn-primary"
            disabled={isPending}
            onClick={() => save({ evrakTalepMesaji: talepMsg, evrakGeldiMesaji: geldiMsg })}
          >
            {isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Durum Checkbox bileşeni
function StatusCheckbox({
  checked, onChange, title,
}: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className="flex items-center justify-center cursor-pointer" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-[var(--gold)] cursor-pointer"
      />
    </label>
  );
}

export default function MukelleflerPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [showSmsModal, setShowSmsModal] = useState(false);

  const { data: taxpayers = [], isLoading } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers', search, year, month],
    queryFn: () =>
      api.get('/taxpayers', { params: { search: search || undefined, year, month } })
        .then(r => r.data),
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: boolean }) =>
      api.patch(`/taxpayers/${id}/monthly-status`, { year, month, [field]: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taxpayers'] }),
    onError: () => toast.error('Durum güncellenemedi'),
  });

  const handleStatus = useCallback((id: string, field: string, value: boolean) => {
    updateStatus({ id, field, value });
  }, [updateStatus, year, month]);

  const getAdUnvan = (t: Taxpayer) =>
    t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || '-';

  return (
    <div className="p-6">
      {showSmsModal && <SmsTemplateModal onClose={() => setShowSmsModal(false)} />}

      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Mükellef Listesi</h1>
          <p className="text-sm text-gray-500 mt-1">Aylık evrak ve beyanname takibi</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowSmsModal(true)}
            className="btn-secondary text-sm"
          >
            📱 SMS Şablonu
          </button>
          <Link href="/panel/mukellefler/yeni">
            <button className="btn-primary text-sm">+ Mükellef Ekle</button>
          </Link>
        </div>
      </div>

      {/* Filtreler */}
      <div className="card mb-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Dönem:</label>
          <select
            value={month}
            onChange={e => setMonth(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={e => setYear(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            {[2024, 2025, 2026].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <input
          type="text"
          placeholder="Mükellef ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2"
        />
      </div>

      {/* Tablo */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2" style={{ borderColor: 'var(--gold)' }}>
              <th className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--navy)' }}>Ad / Unvan</th>
              <th className="text-left py-3 px-3 font-semibold" style={{ color: 'var(--navy)' }}>VKN/TC</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Evrak<br/>Son Gün</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Evraklar<br/>Geldi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Evraklar<br/>İşlendi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Kontrol<br/>Edildi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>Beyanname<br/>Verildi</th>
              <th className="text-center py-3 px-2 font-semibold text-xs" style={{ color: 'var(--navy)' }}>KDV<br/>Kontrol</th>
              <th className="text-center py-3 px-2 font-semibold" style={{ color: 'var(--navy)' }}>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Yükleniyor...</td></tr>
            ) : taxpayers.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Mükellef bulunamadı</td></tr>
            ) : taxpayers.map((t, i) => {
              const s = t.monthlyStatus;
              return (
                <tr key={t.id} className={i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="py-3 px-3 font-medium" style={{ color: 'var(--navy)' }}>
                    <Link href={`/panel/mukellefler/${t.id}`} className="hover:underline">
                      {getAdUnvan(t)}
                    </Link>
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{
                      background: t.type === 'TUZEL_KISI' ? 'rgba(0,51,102,0.1)' : 'rgba(204,165,0,0.1)',
                      color: t.type === 'TUZEL_KISI' ? 'var(--navy)' : '#a08000',
                    }}>
                      {t.type === 'TUZEL_KISI' ? 'Tüzel' : 'Gerçek'}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-gray-600 font-mono text-xs">{t.taxNumber}</td>
                  <td className="py-3 px-2 text-center">
                    {t.evrakTeslimGunu ? (
                      <span className="font-medium" style={{ color: 'var(--gold)' }}>
                        {t.evrakTeslimGunu}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox
                      checked={s?.evraklarGeldi ?? false}
                      onChange={v => handleStatus(t.id, 'evraklarGeldi', v)}
                      title="Evraklar Geldi"
                    />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox
                      checked={s?.evraklarIslendi ?? false}
                      onChange={v => handleStatus(t.id, 'evraklarIslendi', v)}
                      title="Evraklar İşlendi"
                    />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox
                      checked={s?.kontrolEdildi ?? false}
                      onChange={v => handleStatus(t.id, 'kontrolEdildi', v)}
                      title="Kontrol Edildi"
                    />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox
                      checked={s?.beyannameVerildi ?? false}
                      onChange={v => handleStatus(t.id, 'beyannameVerildi', v)}
                      title="Beyanname Verildi"
                    />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <StatusCheckbox
                      checked={s?.kdvKontrolEdildi ?? false}
                      onChange={v => handleStatus(t.id, 'kdvKontrolEdildi', v)}
                      title="KDV Kontrol Edildi"
                    />
                  </td>
                  <td className="py-3 px-2 text-center">
                    <Link href={`/panel/mukellefler/${t.id}`}>
                      <button className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 transition">
                        Düzenle
                      </button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Özet */}
      {taxpayers.length > 0 && (
        <div className="mt-4 flex gap-4 flex-wrap text-sm text-gray-500">
          <span>Toplam: <strong>{taxpayers.length}</strong></span>
          <span>Evrak Geldi: <strong className="text-green-600">{taxpayers.filter(t => t.monthlyStatus?.evraklarGeldi).length}</strong></span>
          <span>Beyanname: <strong className="text-blue-600">{taxpayers.filter(t => t.monthlyStatus?.beyannameVerildi).length}</strong></span>
          <span>KDV Kontrol: <strong style={{ color: 'var(--gold)' }}>{taxpayers.filter(t => t.monthlyStatus?.kdvKontrolEdildi).length}</strong></span>
        </div>
      )}
    </div>
  );
}
