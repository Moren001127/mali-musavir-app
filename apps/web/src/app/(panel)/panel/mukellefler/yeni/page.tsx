'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const TAXPAYER_TYPES = [
  { value: 'TUZEL_KISI', label: 'Tüzel Kişi (Şirket)' },
  { value: 'GERCEK_KISI', label: 'Gerçek Kişi' },
];

export default function YeniMukellefPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    type: 'TUZEL_KISI',
    companyName: '',
    firstName: '',
    lastName: '',
    taxNumber: '',
    taxOffice: '',
    phones: ['', '', ''],
    emails: ['', '', ''],
    address: '',
    notes: '',
    startDate: '',
    endDate: '',
    evrakTeslimGunu: '' as string | number,
    whatsappEvrakTalep: false,
    whatsappEvrakGeldi: false,
    isEFaturaMukellefi: false,
    lucaSlug: '',
    mihsapId: '',
    mihsapDefterTuru: 'BILANCO',
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: (data: any) => api.post('/taxpayers', data),
    onSuccess: () => {
      toast.success('Mükellef eklendi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellefler');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : (msg || 'Kayıt hatası'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save({
      ...form,
      phones: form.phones.filter(Boolean),
      emails: form.emails.filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(String(form.evrakTeslimGunu)) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/panel/mukellefler">
          <button className="text-gray-500 hover:text-gray-700 text-sm">← Listeye Dön</button>
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: '#d4b876' }}>Yeni Mükellef</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Tip */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>Mükellef Tipi</h2>
          <div className="flex gap-6">
            {TAXPAYER_TYPES.map(t => (
              <label key={t.value} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" value={t.value}
                  checked={form.type === t.value}
                  onChange={() => setForm(f => ({ ...f, type: t.value }))}
                  className="accent-[#d4b876]" />
                <span className="text-sm font-medium">{t.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Temel Bilgiler */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>Temel Bilgiler</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {form.type === 'TUZEL_KISI' ? (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Şirket Adı *</label>
                <input type="text" value={form.companyName} required
                  onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ad *</label>
                  <input type="text" value={form.firstName} required
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Soyad *</label>
                  <input type="text" value={form.lastName} required
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.type === 'TUZEL_KISI' ? 'VKN (10 hane)' : 'TCKN (11 hane)'} *
              </label>
              <input type="text" value={form.taxNumber} required maxLength={11}
                onChange={e => setForm(f => ({ ...f, taxNumber: e.target.value.replace(/\D/g, '') }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vergi Dairesi *</label>
              <input type="text" value={form.taxOffice} required
                onChange={e => setForm(f => ({ ...f, taxOffice: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İşe Başlama Tarihi</label>
              <input type="date" value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İşi Bırakma Tarihi</label>
              <input type="date" value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              <p className="text-xs text-gray-400 mt-1">Belirlenirse mükellef o aydan itibaren listede çıkmaz</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Adres</label>
              <input type="text" value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
            </div>
          </div>
        </div>

        {/* İletişim */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>İletişim Bilgileri</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Telefon Numaraları</label>
              {form.phones.map((p, i) => (
                <input key={i} type="tel" value={p}
                  placeholder={i === 0 ? 'Telefon 1 (Ana)' : `Telefon ${i + 1}`}
                  onChange={e => setForm(f => {
                    const phones = [...f.phones]; phones[i] = e.target.value; return { ...f, phones };
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              ))}
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">E-posta Adresleri</label>
              {form.emails.map((e, i) => (
                <input key={i} type="email" value={e}
                  placeholder={`E-posta ${i + 1}`}
                  onChange={ev => setForm(f => {
                    const emails = [...f.emails]; emails[i] = ev.target.value; return { ...f, emails };
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              ))}
            </div>
          </div>
        </div>

        {/* Evrak & SMS Ayarları */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>Evrak & SMS Ayarları</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Evrak Teslim İçin Son Gün (1-30)
              </label>
              <input type="number" min={1} max={30}
                value={form.evrakTeslimGunu}
                onChange={e => setForm(f => ({ ...f, evrakTeslimGunu: e.target.value }))}
                placeholder="Örn: 15"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              <p className="text-xs text-gray-400 mt-1">Her ayın bu günü geldiğinde SMS hatırlatması gönderilir</p>
            </div>
            <div className="space-y-4 pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.whatsappEvrakTalep}
                  onChange={e => setForm(f => ({ ...f, whatsappEvrakTalep: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#d4b876]" />
                <div>
                  <span className="text-sm font-medium text-gray-700">Evrak Talebi SMS Gönderilsin</span>
                  <p className="text-xs text-gray-400">Evrak gelme günü ve sonrasında otomatik hatırlatma</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.whatsappEvrakGeldi}
                  onChange={e => setForm(f => ({ ...f, whatsappEvrakGeldi: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#d4b876]" />
                <div>
                  <span className="text-sm font-medium text-gray-700">İşleme Başlama SMS Gönderilsin</span>
                  <p className="text-xs text-gray-400">Evraklar geldi işaretlendiğinde onay mesajı gönderilir</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form.isEFaturaMukellefi}
                  onChange={e => setForm(f => ({ ...f, isEFaturaMukellefi: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#d4b876]" />
                <div>
                  <span className="text-sm font-medium text-gray-700">E-Fatura Mükellefi mi?</span>
                  <p className="text-xs text-gray-400">İşaretliyse Luca'dan Çek dediğinde E-Faturalar da çekilir; işaretsizse sadece E-Arşiv</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Otomasyon Ajanları */}
        <div className="card">
          <h2 className="text-base font-semibold mb-3" style={{ color: '#d4b876' }}>Otomasyon Ajanları</h2>
          <p className="text-xs text-gray-500 mb-4">Bu mükellef için ajanların kullanacağı dış sistem kimlikleri.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Luca Slug</label>
              <input type="text" value={form.lucaSlug}
                onChange={e => setForm(f => ({ ...f, lucaSlug: e.target.value }))}
                placeholder="edeler_yem"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              <p className="text-xs text-gray-400 mt-1">Luca ZIP slug (ör. edeler_yem)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mihsap ID</label>
              <input type="text" value={form.mihsapId}
                onChange={e => setForm(f => ({ ...f, mihsapId: e.target.value }))}
                placeholder="110564"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]" />
              <p className="text-xs text-gray-400 mt-1">Mihsap URL'indeki sayı</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mihsap Defter Türü</label>
              <select value={form.mihsapDefterTuru}
                onChange={e => setForm(f => ({ ...f, mihsapDefterTuru: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876]">
                <option value="BILANCO">Bilanço</option>
                <option value="DEFTER_BEYAN">Defter Beyan</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notlar */}
        <div className="card">
          <h2 className="text-base font-semibold mb-3" style={{ color: '#d4b876' }}>Notlar</h2>
          <textarea value={form.notes} rows={3} placeholder="Mükellef hakkında notlar..."
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4b876] resize-none" />
        </div>

        <div className="flex gap-3 justify-end">
          <Link href="/panel/mukellefler">
            <button type="button" className="btn-secondary">İptal</button>
          </Link>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Kaydediliyor...' : 'Mükellef Ekle'}
          </button>
        </div>
      </form>
    </div>
  );
}
