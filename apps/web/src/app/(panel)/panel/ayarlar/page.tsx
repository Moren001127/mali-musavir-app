'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Copy, Check, ExternalLink, FileCheck2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

/**
 * Moren Agent = tarayıcıda çalışan bookmarklet.
 *
 * Kullanıcı bu bookmarklet'i tarayıcı sık kullanılanlarına ekler, Luca veya
 * Mihsap sekmesindeyken tıklar, agent sayfada aktif olur ve portalın
 * queue'ladığı işleri (muavin/mizan Excel indirme, fatura sınıflandırma)
 * tarayıcı üzerinden yürütür.
 *
 * Neden bu yol? Railway cloud IP'leri Luca tarafından bloklandığı için
 * backend Playwright yolu çalışmıyor. Kullanıcının tarayıcısı zaten Luca'da
 * giriş yapmış durumda — o oturumu kullanıyoruz.
 */
function MorenAgentSection() {
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);

  const { data: info, isLoading } = useQuery({
    queryKey: ['agent-me-token'],
    queryFn: () =>
      api.get('/agent/me/token').then(
        (r) => r.data as { token: string; tenantName: string | null },
      ),
  });

  // Portal'ın üzerinde çalıştığı origin — bookmarklet script'ini buradan çeker
  const portalOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const scriptUrl = `${portalOrigin}/moren-agent.js`;

  const bookmarkletCode =
    `javascript:(function(){if(window.__morenAgent)return alert('Moren Agent zaten açık');` +
    `var s=document.createElement('script');` +
    `s.src='${scriptUrl}?v='+Date.now();` +
    `document.head.appendChild(s);})();`;

  const copy = async (text: string, which: 'token' | 'bookmarklet') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'token') {
        setCopiedToken(true);
        setTimeout(() => setCopiedToken(false), 1500);
      } else {
        setCopiedBookmarklet(true);
        setTimeout(() => setCopiedBookmarklet(false), 1500);
      }
      toast.success('Kopyalandı');
    } catch {
      toast.error('Kopyalanamadı — elle seçip kopyalayın');
    }
  };

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">🤖</span>
        <div>
          <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>
            Moren Agent Bookmarklet
          </h3>
          <p className="text-xs text-gray-500">
            Luca / Mihsap sekmesinde açık kalır, portalın queue'ladığı
            muavin/mizan indirme gibi işleri yürütür.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Token */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'rgba(250,250,249,0.7)' }}
            >
              Agent Token (ilk kurulumda bir kez istenir)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={info?.token || ''}
                className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none font-mono"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: '#fafaf9',
                }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => copy(info?.token || '', 'token')}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                {copiedToken ? <Check size={13} /> : <Copy size={13} />}
                {copiedToken ? 'Tamam' : 'Kopyala'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Bookmarklet ilk çalıştığında bu token'ı soracak. Bir kez
              yapıştırdıktan sonra tarayıcıda saklanır.
            </p>
          </div>

          {/* Bookmarklet */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: 'rgba(250,250,249,0.7)' }}
            >
              Bookmarklet
            </label>
            <div className="rounded-lg border p-3"
              style={{
                background: 'rgba(255,255,255,0.02)',
                borderColor: 'rgba(255,255,255,0.08)',
              }}>
              <a
                href={bookmarkletCode}
                onClick={(e) => e.preventDefault()}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold"
                style={{
                  background: '#d4b876',
                  color: '#1a1a19',
                  textDecoration: 'none',
                }}
              >
                <ExternalLink size={13} />
                Moren Agent'ı Başlat
              </a>
              <p className="text-[11px] text-gray-500 mt-2">
                Yukarıdaki düğmeyi tarayıcının sık kullanılanlar çubuğuna{' '}
                <strong style={{ color: '#d4b876' }}>sürükle-bırak</strong> →
                bookmark oluşur. Sürüklemek yerine kodu kopyalayıp yeni
                bookmark olarak da ekleyebilirsin.
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => copy(bookmarkletCode, 'bookmarklet')}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                {copiedBookmarklet ? <Check size={13} /> : <Copy size={13} />}
                {copiedBookmarklet ? 'Kopyalandı' : 'Kodu Kopyala'}
              </button>
            </div>
          </div>

          {/* Kullanım */}
          <div
            className="rounded-lg p-3 text-xs leading-relaxed"
            style={{
              background: 'rgba(212,184,118,0.06)',
              border: '1px solid rgba(212,184,118,0.18)',
              color: 'rgba(250,250,249,0.85)',
            }}
          >
            <div className="font-semibold mb-1.5" style={{ color: '#d4b876' }}>
              Nasıl kullanılır?
            </div>
            <ol className="space-y-1 list-decimal list-inside">
              <li>
                Luca veya Mihsap'a giriş yap (CAPTCHA/2FA'yı kendin geç).
              </li>
              <li>
                İlgili ekrana gel — muavin için <em>Muavin Defter</em>, mizan
                için <em>Mizan</em>.
              </li>
              <li>
                Sık kullanılanlardaki <strong>Moren Agent'ı Başlat</strong>{' '}
                bookmarklet'ine tıkla.
              </li>
              <li>
                Sayfanın sağ üstünde bir panel çıkar ("MOREN AGENT · Bekleniyor").
              </li>
              <li>
                Portaldan "Luca'dan veri çek" / "Mizan çek" butonuna bas.
                Agent 15 saniye içinde işi alıp Excel'i indirecek ve portala
                yollayacak.
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}


function SmsTemplateSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/sms-templates').then(r => r.data),
  });

  const [evrakTalep, setEvrakTalep] = useState('');
  const [evrakGeldi, setEvrakGeldi] = useState('');
  const [editing, setEditing] = useState(false);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (d: any) => api.patch('/sms-templates', d),
    onSuccess: () => {
      toast.success('SMS şablonları kaydedildi');
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      setEditing(false);
    },
    onError: () => toast.error('Kayıt hatası'),
  });

  const handleEdit = () => {
    setEvrakTalep(data?.evrakTalepMesaji || '');
    setEvrakGeldi(data?.evrakGeldiMesaji || '');
    setEditing(true);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💬</span>
          <div>
            <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>SMS / WhatsApp Şablonları</h3>
            <p className="text-xs text-gray-500">Mükellef evrak hatırlatma mesaj şablonları</p>
          </div>
        </div>
        {!editing && (
          <button onClick={handleEdit} className="btn-secondary text-sm">Düzenle</button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Yükleniyor...</p>
      ) : editing ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">
            Kullanılabilir değişkenler:{' '}
            <code className="bg-white border rounded px-1">{'{ad}'}</code>{' '}
            <code className="bg-white border rounded px-1">{'{dönem}'}</code>
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Evrak Talebi SMS (Hatırlatma)
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              value={evrakTalep}
              onChange={e => setEvrakTalep(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              İşleme Başlama SMS (Onay)
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[#d4b876]"
              value={evrakGeldi}
              onChange={e => setEvrakGeldi(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">İptal</button>
            <button
              className="btn-primary text-sm"
              disabled={isPending}
              onClick={() => save({ evrakTalepMesaji: evrakTalep, evrakGeldiMesaji: evrakGeldi })}
            >
              {isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Evrak Talebi SMS</p>
            <p className="text-sm text-gray-700">{data?.evrakTalepMesaji || '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">İşleme Başlama SMS</p>
            <p className="text-sm text-gray-700">{data?.evrakGeldiMesaji || '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AyarlarPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#d4b876' }}>Ayarlar</h1>
        <p className="text-sm text-gray-500 mt-1">Sistem ve entegrasyon ayarları</p>
      </div>

      <MorenAgentSection />

      <Link
        href="/panel/ayarlar/beyanname-takip"
        className="card hover:border-amber-300 transition-colors flex items-center gap-4 group cursor-pointer"
      >
        <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 flex-shrink-0">
          <FileCheck2 size={22} />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>Mükellef Beyanname Takip</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Her mükellefin hangi beyannameleri verdiğini (KDV/MUHSGK/Kurumlar/E-Defter) ve dönem yapısını ayarla.
            Toplu Beyanname Kontrol paneli bu ayarlara göre çalışır.
          </p>
        </div>
        <ArrowRight size={18} className="text-gray-400 group-hover:text-amber-600 group-hover:translate-x-1 transition-all" />
      </Link>

      <SmsTemplateSection />

      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">📱</span>
          <h3 className="text-base font-semibold" style={{ color: '#d4b876' }}>WhatsApp Otomasyonu</h3>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
          WhatsApp entegrasyonu yakında aktif edilecek. Mükellef listesinde telefon numaralarını ve SMS tercihlerinizi şimdiden ayarlayabilirsiniz.
        </div>
      </div>

      <div className="card opacity-60">
        <h3 className="text-base font-semibold mb-2" style={{ color: '#d4b876' }}>Diğer Ayarlar</h3>
        <p className="text-sm text-gray-400">Yakında eklenecek: Ofis bilgileri, logo, bildirim tercihleri...</p>
      </div>
    </div>
  );
}
