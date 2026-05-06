'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import TaxpayerStatsCard from '@/components/TaxpayerStatsCard';
import DocumentExpiryWidget from '@/components/DocumentExpiryWidget';
import { bankaTakipApi } from '@/lib/banka-takip';
import { Landmark, Plus, Trash2, Loader2 } from 'lucide-react';

const TAXPAYER_TYPES = [
  { value: 'TUZEL_KISI', label: 'Tüzel Kişi (Şirket)' },
  { value: 'GERCEK_KISI', label: 'Gerçek Kişi' },
];

function PhoneInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="tel"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || '05xx xxx xx xx'}
      className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
    />
  );
}

function EmailInput({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="email"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="ornek@email.com"
      className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
    />
  );
}

export default function MukellefDetayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const isNew = id === 'yeni';

  const { data: taxpayer, isLoading } = useQuery({
    queryKey: ['taxpayer', id],
    queryFn: () => api.get(`/taxpayers/${id}`).then(r => r.data),
    enabled: !isNew,
  });

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
    defterTuru: 'BILANCO' as 'BILANCO' | 'ISLETME',
  });

  useEffect(() => {
    if (taxpayer) {
      const phones = [...(taxpayer.phones || []), '', '', ''].slice(0, 3);
      const emails = [...(taxpayer.emails || []), '', '', ''].slice(0, 3);
      setForm({
        type: taxpayer.type || 'TUZEL_KISI',
        companyName: taxpayer.companyName || '',
        firstName: taxpayer.firstName || '',
        lastName: taxpayer.lastName || '',
        taxNumber: taxpayer.taxNumber || '',
        taxOffice: taxpayer.taxOffice || '',
        phones,
        emails,
        address: taxpayer.address || '',
        notes: taxpayer.notes || '',
        startDate: taxpayer.startDate ? taxpayer.startDate.substring(0, 10) : '',
        endDate: taxpayer.endDate ? taxpayer.endDate.substring(0, 10) : '',
        evrakTeslimGunu: taxpayer.evrakTeslimGunu ?? '',
        whatsappEvrakTalep: taxpayer.whatsappEvrakTalep ?? false,
        whatsappEvrakGeldi: taxpayer.whatsappEvrakGeldi ?? false,
        isEFaturaMukellefi: (taxpayer as any).isEFaturaMukellefi ?? false,
        lucaSlug: taxpayer.lucaSlug ?? '',
        mihsapId: taxpayer.mihsapId ?? '',
        mihsapDefterTuru: taxpayer.mihsapDefterTuru ?? 'BILANCO',
        defterTuru: ((taxpayer as any).defterTuru ?? 'BILANCO') as 'BILANCO' | 'ISLETME',
      });
    }
  }, [taxpayer]);

  const { mutate: saveData, isPending } = useMutation({
    mutationFn: (data: any) =>
      isNew
        ? api.post('/taxpayers', data)
        : api.put(`/taxpayers/${id}`, data),
    onSuccess: () => {
      toast.success(isNew ? 'Mükellef eklendi' : 'Mükellef güncellendi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellefler');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : (msg || 'Kayıt hatası'));
    },
  });

  const { mutate: deleteMukellef, isPending: isDeleting } = useMutation({
    mutationFn: () => api.delete(`/taxpayers/${id}`),
    onSuccess: () => {
      toast.success('Mükellef silindi');
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      router.push('/panel/mukellefler');
    },
    onError: () => toast.error('Silme işlemi başarısız'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...form,
      phones: form.phones.filter(Boolean),
      emails: form.emails.filter(Boolean),
      evrakTeslimGunu: form.evrakTeslimGunu ? parseInt(String(form.evrakTeslimGunu)) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    };
    saveData(payload);
  };

  if (!isNew && isLoading) {
    return <div className="p-6 text-center text-gray-500">Yükleniyor...</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Başlık */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/panel/mukellefler">
          <button className="text-gray-500 hover:text-gray-700 text-sm">← Listeye Dön</button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" style={{ color: '#d4b876' }}>
            {isNew ? 'Yeni Mükellef' : 'Mükellef Düzenle'}
          </h1>
        </div>
        {!isNew && (
          <button
            onClick={() => { if (confirm('Mükellef silinsin mi?')) deleteMukellef(); }}
            disabled={isDeleting}
            className="text-sm text-red-500 border border-red-300 px-3 py-1.5 rounded-lg hover:bg-red-50"
          >
            {isDeleting ? 'Siliniyor...' : 'Sil'}
          </button>
        )}
      </div>

      {/* Karlılık & evrak yenileme widget'ları (sadece kayıtlı mükellefte) */}
      {!isNew && id && (
        <div className="space-y-3 mb-6">
          <TaxpayerStatsCard taxpayerId={id} />
          <DocumentExpiryWidget taxpayerId={id} compact={false} daysAhead={90} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Tip Seçimi */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>Mükellef Tipi</h2>
          <div className="flex gap-4">
            {TAXPAYER_TYPES.map(t => (
              <label key={t.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  value={t.value}
                  checked={form.type === t.value}
                  onChange={() => setForm(f => ({ ...f, type: t.value }))}
                  className="accent-[#d4b876]"
                />
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
                <input
                  type="text"
                  value={form.companyName}
                  onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                  className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                  required
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ad *</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Soyad *</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                    required
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.type === 'TUZEL_KISI' ? 'VKN (10 hane)' : 'TCKN (11 hane)'} *
              </label>
              <input
                type="text"
                value={form.taxNumber}
                onChange={e => setForm(f => ({ ...f, taxNumber: e.target.value.replace(/\D/g, '') }))}
                maxLength={11}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 font-mono focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vergi Dairesi *</label>
              <input
                type="text"
                value={form.taxOffice}
                onChange={e => setForm(f => ({ ...f, taxOffice: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İşe Başlama Tarihi</label>
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">İşi Bırakma Tarihi</label>
              <input
                type="date"
                value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Adres</label>
              <input
                type="text"
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              />
            </div>
          </div>
        </div>

        {/* İletişim Bilgileri */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>İletişim Bilgileri</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Telefon Numaraları</label>
              {form.phones.map((p, i) => (
                <PhoneInput
                  key={i}
                  value={p}
                  onChange={v => setForm(f => {
                    const phones = [...f.phones];
                    phones[i] = v;
                    return { ...f, phones };
                  })}
                  placeholder={i === 0 ? 'Telefon 1 (Ana)' : `Telefon ${i + 1}`}
                />
              ))}
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">E-posta Adresleri</label>
              {form.emails.map((e, i) => (
                <EmailInput
                  key={i}
                  value={e}
                  onChange={v => setForm(f => {
                    const emails = [...f.emails];
                    emails[i] = v;
                    return { ...f, emails };
                  })}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Evrak & WhatsApp Ayarları */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>Evrak & WhatsApp Ayarları</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Evrak Teslim İçin Son Gün (1-30)
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={form.evrakTeslimGunu}
                onChange={e => setForm(f => ({ ...f, evrakTeslimGunu: e.target.value }))}
                placeholder="Örn: 15"
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              />
              <p className="text-xs text-gray-500 mt-1">Her ayın bu günü geldiğinde WhatsApp hatırlatması gönderilir</p>
            </div>
            <div className="space-y-3 pt-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.whatsappEvrakTalep}
                  onChange={e => setForm(f => ({ ...f, whatsappEvrakTalep: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#d4b876] cursor-pointer"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Evrak Talep Mesajı Gönderilsin</span>
                  <p className="text-xs text-gray-500">Evrak gelme günü ve sonrasında otomatik hatırlatma</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.whatsappEvrakGeldi}
                  onChange={e => setForm(f => ({ ...f, whatsappEvrakGeldi: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#d4b876] cursor-pointer"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Evrak Geldi Mesajı Gönderilsin</span>
                  <p className="text-xs text-gray-500">Evraklar Geldi işaretlendiğinde onay mesajı gönderilir</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isEFaturaMukellefi}
                  onChange={e => setForm(f => ({ ...f, isEFaturaMukellefi: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#d4b876] cursor-pointer"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">E-Fatura Mükellefi</span>
                  <p className="text-xs text-gray-500">İşaretliyse Gelen/Giden E-Fatura sorgulanabilir; değilse Giden E-Arşiv aktif olur</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Otomasyon Ajanları */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>
            Otomasyon Ajanları
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Bu mükellef için ajanların çalışması gereken dış sistem kimlikleri. Boş bırakılırsa o ajan bu mükellef için liste dışında kalır.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Luca Slug
              </label>
              <input
                type="text"
                value={form.lucaSlug}
                onChange={e => setForm(f => ({ ...f, lucaSlug: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                placeholder="edeler_yem"
              />
              <p className="text-xs text-gray-400 mt-1">Luca ZIP'te görünen ad (ör. edeler_yem)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mihsap ID
              </label>
              <input
                type="text"
                value={form.mihsapId}
                onChange={e => setForm(f => ({ ...f, mihsapId: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
                placeholder="110564"
              />
              <p className="text-xs text-gray-400 mt-1">Mihsap URL'indeki sayı (ör. 110564)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mihsap Defter Türü
              </label>
              <select
                value={form.mihsapDefterTuru}
                onChange={e => setForm(f => ({ ...f, mihsapDefterTuru: e.target.value }))}
                className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              >
                <option value="BILANCO">Bilanço</option>
                <option value="DEFTER_BEYAN">Defter Beyan</option>
              </select>
            </div>
          </div>
        </div>

        {/* DEFTER TÜRÜ — Banka Takip ve diğer modüller için */}
        <div className="card">
          <h2 className="text-base font-semibold mb-1" style={{ color: '#d4b876' }}>Defter Türü</h2>
          <p className="text-xs mb-3" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Bilanço esasında defter tutuyorsa "Banka Takip" listesinde görünür ve banka hesapları yönetilebilir.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label
              className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border transition-colors"
              style={{
                background: form.defterTuru === 'BILANCO' ? 'rgba(212,184,118,0.10)' : 'rgba(255,255,255,0.02)',
                borderColor: form.defterTuru === 'BILANCO' ? 'rgba(212,184,118,0.45)' : 'rgba(255,255,255,0.08)',
              }}
            >
              <input
                type="radio"
                name="defterTuru"
                value="BILANCO"
                checked={form.defterTuru === 'BILANCO'}
                onChange={() => setForm(f => ({ ...f, defterTuru: 'BILANCO' }))}
                className="accent-[#d4b876]"
              />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>Bilanço</div>
                <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Bilanço esasında defter</div>
              </div>
            </label>
            <label
              className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer border transition-colors"
              style={{
                background: form.defterTuru === 'ISLETME' ? 'rgba(168,85,247,0.10)' : 'rgba(255,255,255,0.02)',
                borderColor: form.defterTuru === 'ISLETME' ? 'rgba(168,85,247,0.45)' : 'rgba(255,255,255,0.08)',
              }}
            >
              <input
                type="radio"
                name="defterTuru"
                value="ISLETME"
                checked={form.defterTuru === 'ISLETME'}
                onChange={() => setForm(f => ({ ...f, defterTuru: 'ISLETME' }))}
                className="accent-[#a78bfa]"
              />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#fafaf9' }}>İşletme Defteri</div>
                <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Basit usul / işletme defteri</div>
              </div>
            </label>
          </div>
        </div>

        {/* BANKA HESAPLARI — sadece BILANCO seçilmişse + mevcut mükellefte */}
        {!isNew && form.defterTuru === 'BILANCO' && id && (
          <BankaHesaplariBolumu taxpayerId={String(id)} />
        )}

        {/* Notlar */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4" style={{ color: '#d4b876' }}>Notlar</h2>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3}
            className="w-full border border-white/10 bg-black/20 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876] resize-none"
            placeholder="Mükellef hakkında notlar..."
          />
        </div>

        {/* Butonlar */}
        <div className="flex gap-3 justify-end">
          <Link href="/panel/mukellefler">
            <button type="button" className="btn-secondary">İptal</button>
          </Link>
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Kaydediliyor...' : (isNew ? 'Mükellef Ekle' : 'Güncelle')}
          </button>
        </div>
      </form>
    </div>
  );
}

// =============================================================
// BANKA HESAPLARI BOLUMU — mukellef kartı içinde inline yönetim
// (sadece defterTuru === 'BILANCO' ise gösterilir)
// =============================================================
function BankaHesaplariBolumu({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [bankaAdi, setBankaAdi] = useState('');
  const [iban, setIban] = useState('');
  const [hesapNo, setHesapNo] = useState('');
  const [aciklama, setAciklama] = useState('');

  const { data: hesaplar = [], isLoading } = useQuery({
    queryKey: ['banka-hesaplar', taxpayerId],
    queryFn: () => bankaTakipApi.hesaplar(taxpayerId),
  });

  const createMut = useMutation({
    mutationFn: () =>
      bankaTakipApi.createHesap({
        taxpayerId,
        bankaAdi: bankaAdi.trim(),
        iban: iban.trim() || undefined,
        hesapNo: hesapNo.trim() || undefined,
        aciklama: aciklama.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Banka hesabı eklendi');
      setBankaAdi(''); setIban(''); setHesapNo(''); setAciklama('');
      qc.invalidateQueries({ queryKey: ['banka-hesaplar', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['banka-takip'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => bankaTakipApi.deleteHesap(id),
    onSuccess: () => {
      toast.success('Hesap silindi');
      qc.invalidateQueries({ queryKey: ['banka-hesaplar', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['banka-takip'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hata'),
  });

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Landmark size={16} style={{ color: '#d4b876' }} />
        <h2 className="text-base font-semibold" style={{ color: '#d4b876' }}>
          Banka Hesapları
        </h2>
        <span className="text-xs" style={{ color: 'rgba(250,250,249,0.45)' }}>
          ({hesaplar.length})
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'rgba(250,250,249,0.45)' }}>
        Banka Takip listesinde bu hesaplar görünür ve çeyrek bazlı ekstre durumu izlenir.
      </p>

      {/* Mevcut hesaplar */}
      {isLoading ? (
        <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Yükleniyor…</div>
      ) : hesaplar.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          Henüz hesap eklenmemiş. Aşağıdan ekleyebilirsiniz.
        </div>
      ) : (
        <div className="space-y-1.5 mb-3">
          {hesaplar.map((h: any) => (
            <div
              key={h.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              <Landmark size={14} style={{ color: '#d4b876', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13px]" style={{ color: '#fafaf9' }}>
                  {h.bankaAdi}
                  {h.paraBirimi !== 'TRY' && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(168,85,247,0.15)', color: '#a78bfa' }}>
                      {h.paraBirimi}
                    </span>
                  )}
                </div>
                <div className="text-[11px] truncate font-mono" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {h.iban || h.hesapNo || '—'}
                  {h.aciklama && <span className="ml-2" style={{ color: 'rgba(250,250,249,0.35)' }}>· {h.aciklama}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`"${h.bankaAdi}" hesabını silmek istediğine emin misin?`)) {
                    deleteMut.mutate(h.id);
                  }
                }}
                disabled={deleteMut.isPending}
                className="p-1.5 rounded disabled:opacity-50"
                style={{ background: 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)' }}
                title="Sil"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Yeni hesap formu */}
      <div className="space-y-2 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="text-[11px] uppercase font-semibold tracking-wider mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Yeni Hesap Ekle
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Banka adı (zorunlu) — örn. Ziraat Bankası"
            value={bankaAdi}
            onChange={(e) => setBankaAdi(e.target.value)}
            className="px-3 py-2 rounded text-sm col-span-2 border border-white/10 bg-black/20 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
          />
          <input
            placeholder="IBAN (TR...)"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            className="px-3 py-2 rounded text-sm font-mono border border-white/10 bg-black/20 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
          />
          <input
            placeholder="Hesap No (opsiyonel)"
            value={hesapNo}
            onChange={(e) => setHesapNo(e.target.value)}
            className="px-3 py-2 rounded text-sm border border-white/10 bg-black/20 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
          />
          <input
            placeholder="Açıklama / Not (opsiyonel)"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            className="px-3 py-2 rounded text-sm col-span-2 border border-white/10 bg-black/20 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
          />
        </div>
        <button
          type="button"
          onClick={() => createMut.mutate()}
          disabled={!bankaAdi.trim() || createMut.isPending}
          className="w-full py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{
            background: bankaAdi.trim() ? 'linear-gradient(135deg, #b8a06f, #8b7649)' : 'rgba(255,255,255,0.05)',
            color: bankaAdi.trim() ? '#0f0d0b' : 'rgba(250,250,249,0.45)',
          }}
        >
          {createMut.isPending ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Plus size={14} className="inline mr-1" />}
          Hesap Ekle
        </button>
      </div>
    </div>
  );
}

