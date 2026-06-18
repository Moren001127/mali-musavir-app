'use client';

import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import {
  MonitorDown,
  Download,
  ShieldCheck,
  KeyRound,
  MousePointerClick,
  CheckCircle2,
  Cpu,
} from 'lucide-react';

const GOLD = '#d4b876';

const DOWNLOAD_URL = `${API_BASE}/desktop/installer`;
const VERSION_URL = `${API_BASE}/desktop/installer/version`;

type VersionInfo = { version: string; available: boolean; sizeBytes: number; filename: string };

function formatMb(bytes: number) {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const FEATURES = [
  { icon: MousePointerClick, title: 'Tek tıkla otomatik giriş', text: 'Firma seç, portala tıkla — kullanıcı kodu, şifre ve güvenlik kodu otomatik dolar, giriş yapılır.' },
  { icon: KeyRound, title: 'Güvenlik kodu otomatik', text: 'Dijital/İnteraktif/İnternet Vergi Dairesi, e-Beyanname, e-Defter ve SGK portallarında güvenlik kodu otomatik çözülür.' },
  { icon: ShieldCheck, title: 'Şifreler güvende', text: 'Şifreler yalnızca giriş anında, şifreli kanaldan alınır; bilgisayara düz metin yazılmaz, ekranda gösterilmez.' },
];

const STEPS = [
  'Aşağıdaki “Kurulum Dosyasını İndir” butonuna tıklayın.',
  'İnen dosyaya çift tıklayın. Windows “bilinmeyen yayıncı” uyarısı verirse “Daha fazla bilgi” → “Yine de çalıştır” deyin.',
  'Kurulumu tamamlayın; masaüstüne “Moren Masaüstü” kısayolu gelir.',
  'Uygulamayı açıp müşavir e-posta ve şifrenizle giriş yapın — firmalar ve kısayollar otomatik gelir.',
];

export default function MasaustuPage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(VERSION_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setInfo(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-6">
      {/* Üst kart */}
      <section
        className="relative overflow-hidden rounded-2xl p-7"
        style={{
          background:
            'radial-gradient(620px 300px at 18% 0%, rgba(212,184,118,0.14), transparent 60%), linear-gradient(150deg,#16130d,#0e0c09)',
          border: '1px solid rgba(212,184,118,0.18)',
        }}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl"
              style={{ background: 'linear-gradient(145deg,#e8cf8f,#b18f43)', color: '#231a06' }}
            >
              <MonitorDown size={28} />
            </div>
            <div>
              <h1 className="text-[24px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
                Moren Masaüstü Uygulaması
              </h1>
              <p className="mt-1 max-w-xl text-[13.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                Devlet portallarına tek tıkla otomatik giriş yapan Windows uygulaması. Bu dosyayı indirip
                ofisteki diğer bilgisayarlara kurabilirsiniz.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                <span className="rounded-full px-3 py-1" style={{ border: '1px solid rgba(212,184,118,0.25)' }}>
                  Sürüm {info?.version || '—'}
                </span>
                <span className="rounded-full px-3 py-1" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                  Windows 10 / 11 · 64-bit
                </span>
                {info?.sizeBytes ? (
                  <span className="rounded-full px-3 py-1" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                    {formatMb(info.sizeBytes)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2">
            <a
              href={DOWNLOAD_URL}
              className="flex items-center justify-center gap-2.5 rounded-xl px-7 py-4 text-[15px] font-bold transition hover:brightness-105"
              style={{
                background: 'linear-gradient(145deg,#e8cf8f,#c2a052)',
                color: '#221903',
                boxShadow: '0 10px 26px rgba(212,184,118,0.22)',
                pointerEvents: loading || (info && !info.available) ? 'none' : 'auto',
                opacity: loading || (info && !info.available) ? 0.55 : 1,
              }}
            >
              <Download size={19} />
              Kurulum Dosyasını İndir
            </a>
            <span className="text-center text-[11.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
              {loading
                ? 'Sürüm bilgisi alınıyor…'
                : info && !info.available
                  ? 'Kurulum dosyası henüz yüklenmedi.'
                  : 'Tek dosya · kurulum sihirbazı açılır'}
            </span>
          </div>
        </div>
      </section>

      {/* Özellikler */}
      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <section
              key={f.title}
              className="rounded-2xl p-5"
              style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD }}>
                <Icon size={19} />
              </div>
              <h3 className="text-[14.5px] font-semibold" style={{ color: '#fafaf9' }}>{f.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.55)' }}>{f.text}</p>
            </section>
          );
        })}
      </div>

      {/* Kurulum adımları */}
      <section className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mb-4 flex items-center gap-2.5">
          <Cpu size={18} style={{ color: GOLD }} />
          <h2 className="text-[16px] font-semibold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
            Diğer bilgisayara nasıl kurulur?
          </h2>
        </div>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[12px] font-bold"
                style={{ background: 'rgba(212,184,118,0.14)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' }}
              >
                {i + 1}
              </span>
              <span className="text-[13px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.72)' }}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex items-start gap-2.5 rounded-xl p-3.5" style={{ background: 'rgba(95,174,126,0.08)', border: '1px solid rgba(95,174,126,0.2)' }}>
          <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0" style={{ color: '#5fae7e' }} />
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.66)' }}>
            Kurulan uygulama her açılışta en güncel firma listesini ve kısayolları portaldan çeker. Yeni sürüm
            çıktığında bu sayfadan tekrar indirip kurmanız yeterlidir.
          </p>
        </div>
      </section>
    </div>
  );
}
