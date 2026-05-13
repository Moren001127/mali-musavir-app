'use client';

import { useState } from 'react';
import {
  Smartphone, Bell, FileText, ShieldCheck, Users, Sparkles, Mic, Camera,
  ArrowRight, Brain, BookOpen, Receipt, Wallet, MessageSquare,
  CreditCard, BarChart3, FolderOpen, Building, CheckSquare, Briefcase,
  Phone, Send, Lock, Eye, AlertCircle,
} from 'lucide-react';

const GOLD = '#d4b876';
const GOLD_DARK = '#b8a06f';
const TEAL = '#6ba3c4';

type Mode = 'ofis' | 'mukellef';

export default function MobilTanitimPage() {
  const [mode, setMode] = useState<Mode>('ofis');

  return (
    <div className="space-y-6">
      {/* HERO */}
      <section
        className="rounded-2xl p-8 relative overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at top, rgba(212,184,118,0.08) 0%, rgba(15,11,21,0.95) 60%)',
          border: '1px solid rgba(212,184,118,0.22)',
        }}
      >
        <span
          className="absolute top-0 left-12 right-12 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.55 }}
        />
        <div className="text-center max-w-4xl mx-auto">
          <p className="text-[10.5px] uppercase font-bold tracking-[.22em] mb-3" style={{ color: GOLD }}>
            Moren Mobil Tasarım Önizlemesi
          </p>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 48,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
              background: 'linear-gradient(135deg, #fafaf9 0%, #d4b876 60%, #b8a06f 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            İki Uygulama,<br />Tek Müşavirlik.
          </h1>
          <p className="mt-5 text-[14.5px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'rgba(250,250,249,0.65)' }}>
            Moren Mobil — portalın tamamını cebine taşıyan iki ayrı uygulama.
            <strong style={{ color: GOLD }}> Ofis</strong> tarafı tüm operasyon yönetimi için;
            <strong style={{ color: TEAL }}> Mükellef</strong> tarafı belge yükleme, fatura takibi ve ofise mesaj için.
          </p>

          {/* SEKME — Ofis / Mükellef */}
          <div
            className="inline-flex gap-1 mt-7 p-1 rounded-full"
            style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <button
              onClick={() => setMode('ofis')}
              className="px-5 py-2 rounded-full text-[13px] font-bold flex items-center gap-2 transition"
              style={{
                background: mode === 'ofis' ? `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})` : 'transparent',
                color: mode === 'ofis' ? '#0f0d0b' : 'rgba(250,250,249,0.65)',
              }}
            >
              <Briefcase size={14} />
              Ofis (Personel)
            </button>
            <button
              onClick={() => setMode('mukellef')}
              className="px-5 py-2 rounded-full text-[13px] font-bold flex items-center gap-2 transition"
              style={{
                background: mode === 'mukellef' ? `linear-gradient(135deg, ${TEAL}, #4a8aa8)` : 'transparent',
                color: mode === 'mukellef' ? '#0f0d0b' : 'rgba(250,250,249,0.65)',
              }}
            >
              <Building size={14} />
              Mükellef Uygulaması
            </button>
          </div>

          <div className="mt-4 flex gap-2 flex-wrap justify-center">
            <Badge icon={Smartphone} text="iOS · Android" />
            {mode === 'ofis' ? (
              <>
                <Badge icon={Mic} text="Sesli AI Sohbet" />
                <Badge icon={ShieldCheck} text="Onay Kuyruğu" />
                <Badge icon={Bell} text="Anlık Bildirim" />
              </>
            ) : (
              <>
                <Badge icon={Camera} text="Belge + OCR" color={TEAL} />
                <Badge icon={CreditCard} text="Cari & Ödeme" color={TEAL} />
                <Badge icon={MessageSquare} text="Mesajlaşma" color={TEAL} />
              </>
            )}
          </div>
        </div>
      </section>

      {/* SEKME İÇERİĞİ */}
      {mode === 'ofis' ? <OfisScreens /> : <MukellefScreens />}

      {/* PORTAL → MOBİL KARŞILAŞTIRMASI */}
      <section className="rounded-2xl p-6" style={{ background: 'rgba(212,184,118,0.04)', border: '1px solid rgba(212,184,118,0.15)' }}>
        <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: '#fafaf9', letterSpacing: '-0.02em' }}>
          Portalda Olan Her Şey Mobile Geliyor
        </h2>
        <p className="text-[13px] mt-1 mb-4" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Mobil uygulama portalın küçük bir parçası değil — tüm operasyon mobilden yönetilebilir.
        </p>

        {mode === 'ofis' ? <OfisFeatureGrid /> : <MukellefFeatureGrid />}
      </section>

      {/* AKIŞ */}
      <section className="rounded-2xl p-6" style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(212,184,118,0.18)' }}>
        <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, color: '#fafaf9', letterSpacing: '-0.02em', marginBottom: 6 }}>
          Geliştirme Yol Haritası
        </h2>
        <p className="text-[12.5px] mb-4" style={{ color: 'rgba(250,250,249,0.55)' }}>
          Tasarım sen onayladıktan sonra kodlama başlar. Beklenen aşamalar:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Phase n="1" title="Tasarım Onay" desc="Bu sayfadaki mockup'lara bakıp tamam dersen sonraki adıma geçeriz." status="active" />
          <Phase n="2" title="Ofis App MVP" desc="Login + Dashboard + Mükellef + AI Chat + Onay (1-2 hafta)" status="pending" />
          <Phase n="3" title="Mükellef App MVP" desc="OTP login + Belge yükle + Faturalarım + Mesaj (1-2 hafta)" status="pending" />
          <Phase n="4" title="TestFlight + Play Store" desc="iOS/Android build, mağaza onayı (1-3 hafta)" status="pending" />
        </div>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   OFİS (PERSONEL) — 8 EKRAN
   ═══════════════════════════════════════════════════════════ */

function OfisScreens() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <PhoneMockup label="01 · Giriş & Biyometrik" accent={GOLD}><LoginScreen /></PhoneMockup>
      <PhoneMockup label="02 · Gösterge Paneli" accent={GOLD}><DashboardScreen /></PhoneMockup>
      <PhoneMockup label="03 · Mükellef Listesi" accent={GOLD}><MukellefListScreen /></PhoneMockup>
      <PhoneMockup label="04 · Mükellef Detay" accent={GOLD}><MukellefDetayScreen /></PhoneMockup>
      <PhoneMockup label="05 · Moren Ofis · AI" accent={GOLD}><AIChatScreen /></PhoneMockup>
      <PhoneMockup label="06 · AI Onay Kuyruğu" accent={GOLD}><OnayScreen /></PhoneMockup>
      <PhoneMockup label="07 · Görevler & Notlar" accent={GOLD}><GorevlerScreen /></PhoneMockup>
      <PhoneMockup label="08 · Beyanname Takip" accent={GOLD}><BeyannameScreen /></PhoneMockup>
      <PhoneMockup label="09 · Mizan / Bilanço" accent={GOLD}><MizanScreen /></PhoneMockup>
      <PhoneMockup label="10 · Evrak + OCR" accent={GOLD}><EvrakScreen /></PhoneMockup>
      <PhoneMockup label="11 · DENİZ Patrol" accent={GOLD}><DenizScreen /></PhoneMockup>
      <PhoneMockup label="12 · Banka Takip" accent={GOLD}><BankaScreen /></PhoneMockup>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MÜKELLEF (DIŞ KULLANICI) — 6 EKRAN
   ═══════════════════════════════════════════════════════════ */

function MukellefScreens() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <PhoneMockup label="01 · SMS ile Giriş" accent={TEAL}><MukOtpScreen /></PhoneMockup>
      <PhoneMockup label="02 · Ana Sayfa" accent={TEAL}><MukDashboardScreen /></PhoneMockup>
      <PhoneMockup label="03 · Belge Yükle (OCR)" accent={TEAL}><MukBelgeScreen /></PhoneMockup>
      <PhoneMockup label="04 · Faturalarım" accent={TEAL}><MukFaturaScreen /></PhoneMockup>
      <PhoneMockup label="05 · Beyannamelerim" accent={TEAL}><MukBeyanScreen /></PhoneMockup>
      <PhoneMockup label="06 · Ofise Mesaj" accent={TEAL}><MukMesajScreen /></PhoneMockup>
      <PhoneMockup label="07 · Cari / Ödeme" accent={TEAL}><MukCariScreen /></PhoneMockup>
      <PhoneMockup label="08 · Bildirimler" accent={TEAL}><MukBildirimScreen /></PhoneMockup>
    </div>
  );
}

/* ════════════ Yardımcı bileşenler ════════════ */

function Badge({ icon: Icon, text, color = GOLD }: { icon: any; text: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold"
      style={{ background: `${color}1a`, border: `1px solid ${color}55`, color }}
    >
      <Icon size={13} />
      {text}
    </span>
  );
}

function Phase({ n, title, desc, status }: { n: string; title: string; desc: string; status: 'active' | 'pending' | 'done' }) {
  const c = status === 'active' ? GOLD : status === 'done' ? '#86efac' : 'rgba(250,250,249,0.4)';
  return (
    <div className="rounded-xl p-3.5" style={{ background: status === 'active' ? `${GOLD}10` : 'rgba(255,255,255,0.025)', border: `1px solid ${status === 'active' ? `${GOLD}40` : 'rgba(255,255,255,0.06)'}` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold" style={{ background: status === 'active' ? GOLD : 'rgba(255,255,255,0.06)', color: status === 'active' ? '#0f0d0b' : c }}>
          {n}
        </span>
        <h4 style={{ fontFamily: 'Fraunces, serif', fontSize: 13, fontWeight: 600, color: status === 'active' ? '#fafaf9' : c }}>{title}</h4>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.55)' }}>{desc}</p>
    </div>
  );
}

function PhoneMockup({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="relative pb-10">
      <div
        className="mx-auto"
        style={{
          width: 280,
          height: 580,
          background: '#0f0d0b',
          borderRadius: 36,
          padding: 8,
          boxShadow: `0 0 0 2px #1c1813, 0 0 0 8px #2a2419, 0 24px 50px rgba(0,0,0,0.5), 0 0 60px ${accent}10`,
          position: 'relative',
        }}
      >
        <div
          className="absolute z-10"
          style={{
            top: 4,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 95,
            height: 22,
            background: '#0a0907',
            borderRadius: 16,
          }}
        />
        <div
          className="overflow-hidden relative flex flex-col"
          style={{ width: '100%', height: '100%', background: '#0f0d0b', borderRadius: 28 }}
        >
          <div className="flex justify-between items-center px-6 pt-3 pb-1 text-[10px] font-bold" style={{ color: '#fafaf9' }}>
            <span>09:41</span>
            <span>● ● ● 5G</span>
          </div>
          <div className="flex-1 px-3.5 py-2 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
      <p className="text-center mt-3 text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: `${accent}d0` }}>
        {label}
      </p>
    </div>
  );
}

function TopBar({ title, accent = GOLD }: { title: string; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent === GOLD ? GOLD_DARK : '#4a8aa8'})`, color: '#0f0d0b', fontFamily: 'Fraunces, serif' }}
      >
        M
      </div>
      <span style={{ fontFamily: 'Fraunces, serif', fontSize: 13, fontWeight: 600, color: '#fafaf9' }}>{title}</span>
      <div className="ml-auto w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)', position: 'relative' }}>
        <Bell size={11} style={{ color: accent }} />
        <span className="absolute top-[3px] right-[3px] w-1.5 h-1.5 rounded-full" style={{ background: '#ef4444' }} />
      </div>
    </div>
  );
}

/* ═══════════ OFİS EKRANLARI ═══════════ */

function LoginScreen() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-2">
      <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})` }}>
        <span style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: '#0f0d0b' }}>M</span>
      </div>
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: '#fafaf9', marginBottom: 4 }}>Moren Ofis</h2>
      <p className="text-[11px] mb-6" style={{ color: 'rgba(250,250,249,0.55)' }}>Personel Girişi</p>
      <input placeholder="E-posta" className="w-full mb-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.22)', color: '#fafaf9' }} readOnly value="muzaffer@moren..." />
      <input type="password" placeholder="Parola" className="w-full mb-3 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.22)', color: '#fafaf9' }} readOnly value="••••••••" />
      <div className="w-full px-3 py-2 rounded-lg text-[12px] font-bold text-center mb-2" style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`, color: '#0f0d0b' }}>
        Giriş Yap
      </div>
      <div className="w-full px-3 py-2 rounded-lg text-[11.5px] font-bold text-center flex items-center justify-center gap-1.5" style={{ background: 'rgba(255,255,255,0.05)', color: GOLD, border: `1px solid ${GOLD}30` }}>
        <Lock size={11} /> Face ID ile Giriş
      </div>
    </div>
  );
}

function DashboardScreen() {
  return (
    <>
      <TopBar title="Moren" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9', letterSpacing: '-0.02em' }}>Günaydın Muzaffer</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>14 Mayıs · Perşembe</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricBox label="Bekleyen" value="3" color="#fca5a5" sub="2 kritik" />
        <MetricBox label="Mükellef" value="42" color="#fafaf9" sub="aktif" />
        <MetricBox label="Bu Hafta" value="8" color={GOLD} sub="beyanname" />
        <MetricBox label="AI Maliyet" value="12¢" color="#86efac" sub="bugün" />
      </div>

      <div className="rounded-xl p-2.5 mb-2" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.08), rgba(15,11,21,0.9))', border: '1px solid rgba(212,184,118,0.30)' }}>
        <p className="text-[8.5px] uppercase font-bold tracking-[.18em] mb-1" style={{ color: GOLD }}>⚡ Brifing</p>
        <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.85)' }}>3 mükellefin KDV son günü yarın</p>
      </div>
    </>
  );
}

function MukellefListScreen() {
  return (
    <>
      <TopBar title="Mükellefler" />
      <div className="relative mb-3">
        <input placeholder="🔍 Ara..." readOnly className="w-full px-2.5 py-1.5 rounded-lg text-[11px]" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.20)', color: 'rgba(250,250,249,0.55)' }} />
      </div>
      <p className="text-[9.5px] uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,0.45)' }}>42 aktif · 3 acil</p>

      {[
        { name: 'Petravet Veteriner', vkn: '7290854321', status: 'acil', sub: 'KDV son günü 2 gün' },
        { name: 'Akgöz Otomotiv', vkn: '0540123456', status: 'normal', sub: 'Mizan kontrolü gerek' },
        { name: 'Zırhlı Gıda Tic.', vkn: '9982016230', status: 'normal', sub: 'Beyanname gönderildi' },
        { name: 'Yıldız Tekstil', vkn: '9123456789', status: 'ok', sub: 'Hepsi güncel' },
        { name: 'Yeşil Market', vkn: '8765432109', status: 'normal', sub: '4 evrak bekleniyor' },
      ].map((m, i) => (
        <div key={i} className="rounded-lg p-2 mb-1.5 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold" style={{ background: m.status === 'acil' ? 'rgba(239,68,68,0.20)' : m.status === 'ok' ? 'rgba(34,197,94,0.20)' : 'rgba(212,184,118,0.18)', color: m.status === 'acil' ? '#fca5a5' : m.status === 'ok' ? '#86efac' : GOLD }}>
            {m.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold truncate" style={{ color: '#fafaf9' }}>{m.name}</p>
            <p className="text-[9px]" style={{ color: m.status === 'acil' ? '#fca5a5' : 'rgba(250,250,249,0.5)' }}>{m.sub}</p>
          </div>
        </div>
      ))}
    </>
  );
}

function MukellefDetayScreen() {
  return (
    <>
      <TopBar title="Mükellef" />
      <div className="rounded-xl p-3 mb-3" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.08), rgba(15,11,21,0.85))', border: '1px solid rgba(212,184,118,0.25)' }}>
        <p style={{ fontFamily: 'Fraunces, serif', fontSize: 15, fontWeight: 600, color: '#fafaf9' }}>Petravet Veteriner Klinik</p>
        <p className="text-[9.5px] mt-1" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'monospace' }}>VKN: 7290854321 · İstanbul</p>
      </div>

      <p className="text-[8.5px] uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,0.45)' }}>Bu ay özet</p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {[
          { l: 'Satış', v: '97.7K', c: '#86efac' },
          { l: 'Alış', v: '36.3K', c: GOLD },
          { l: 'Net KDV', v: '12.3K', c: '#fafaf9' },
        ].map((x, i) => (
          <div key={i} className="rounded-md py-1.5 px-1 text-center" style={{ background: 'rgba(255,255,255,0.025)' }}>
            <p className="text-[7.5px] uppercase tracking-[.1em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{x.l}</p>
            <p style={{ fontFamily: 'Fraunces, serif', fontSize: 12, fontWeight: 700, color: x.c }}>{x.v}</p>
          </div>
        ))}
      </div>

      <p className="text-[8.5px] uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,0.45)' }}>Hızlı Aksiyon</p>
      {['Mizan Çek', 'Belge Yükle', 'AI ile Sor', 'Hatırlatma'].map((a, i) => (
        <div key={i} className="rounded-md py-1.5 px-2.5 mb-1 flex items-center gap-2 text-[10.5px]" style={{ background: 'rgba(212,184,118,0.06)', border: '1px solid rgba(212,184,118,0.18)', color: GOLD }}>
          <ArrowRight size={10} /> {a}
        </div>
      ))}
    </>
  );
}

function AIChatScreen() {
  return (
    <>
      <TopBar title="Moren Ofis" />
      <div className="grid grid-cols-4 gap-1 mb-2.5">
        {[
          { name: 'AYLİN', bg: `linear-gradient(135deg,${GOLD},${GOLD_DARK})`, color: GOLD, initials: 'AY' },
          { name: 'NEVRA', bg: 'linear-gradient(135deg,#60a5fa,#3b82f6)', color: '#60a5fa', initials: 'NV' },
          { name: 'CEM', bg: 'linear-gradient(135deg,#a855f7,#7e22ce)', color: '#a855f7', initials: 'CM' },
          { name: 'DENİZ', bg: 'linear-gradient(135deg,#6ba3c4,#4a8aa8)', color: '#6ba3c4', initials: 'DN' },
        ].map((a) => (
          <div key={a.name} className="rounded-lg py-1.5 px-1 text-center" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.10), rgba(255,255,255,0.012))', border: '1px solid rgba(212,184,118,0.22)' }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center mx-auto mb-1 text-[7px] font-bold" style={{ background: a.bg, color: '#0f0d0b', fontFamily: 'Fraunces,serif' }}>{a.initials}</div>
            <p style={{ fontFamily: 'Fraunces,serif', fontSize: 9, fontWeight: 700, color: a.color }}>{a.name}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl p-2.5 flex flex-col gap-2" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.05), rgba(15,11,21,0.85))', border: '1px solid rgba(212,184,118,0.22)', flex: 1, minHeight: 280 }}>
        <div className="self-end max-w-[80%] rounded-lg px-2.5 py-1.5 text-[10px]" style={{ background: 'rgba(212,184,118,0.18)', color: '#fafaf9' }}>
          Petravet Nisan KDV?
        </div>
        <ChatMsg color={GOLD} name="AYLİN" body="Tamam, Nevra'ya yönlendiriyorum. Cem mizan'a bakacak." />
        <ChatMsg color="#60a5fa" name="NEVRA" body="Nisan: satış 97.729 TL, alış 36.319 TL. Net KDV ~12.300 TL." />
        <div className="mt-auto flex gap-1 items-center">
          <InputIcon>📎</InputIcon>
          <InputIcon><Mic size={11} /></InputIcon>
          <div className="flex-1 h-7 rounded-lg px-2 flex items-center text-[9.5px]" style={{ background: 'rgba(0,0,0,0.4)', color: 'rgba(250,250,249,0.5)' }}>
            Ekibe sor...
          </div>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`, color: '#0f0d0b' }}>
            <ArrowRight size={11} />
          </div>
        </div>
      </div>
    </>
  );
}

function InputIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px]" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.65)' }}>
      {children}
    </div>
  );
}

function ChatMsg({ color, name, body }: { color: string; name: string; body: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[7.5px] uppercase font-bold tracking-[.14em]" style={{ color }}>{name}</span>
      </div>
      <div className="rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed" style={{ background: 'rgba(255,255,255,0.02)', color: 'rgba(250,250,249,0.92)' }}>{body}</div>
    </div>
  );
}

function OnayScreen() {
  return (
    <>
      <TopBar title="AI Onay" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, color: '#fafaf9' }}>3 Bekliyor</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>AI ekiplerin önerileri</p>

      <div className="rounded-xl p-2 mb-1.5" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.30)' }}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[7px] uppercase font-bold px-1 py-[1px] rounded" style={{ background: 'rgba(239,68,68,0.20)', color: '#fca5a5' }}>CRITICAL</span>
          <span className="text-[7px] uppercase font-bold px-1 py-[1px] rounded" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>DENİZ</span>
        </div>
        <p className="text-[10.5px] font-bold" style={{ color: '#fafaf9' }}>Captcha modeli güncellensin</p>
        <p className="text-[9px] mt-0.5" style={{ color: 'rgba(250,250,249,0.65)' }}>Son 24 saatte 8 başarısız Luca.</p>
        <div className="flex gap-1 mt-1.5">
          <div className="flex-1 h-5 rounded text-[8.5px] font-bold flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>✕ Reddet</div>
          <div className="flex-1 h-5 rounded text-[8.5px] font-bold flex items-center justify-center" style={{ background: `linear-gradient(135deg,${GOLD},${GOLD_DARK})`, color: '#0f0d0b' }}>✓ Onayla</div>
        </div>
      </div>

      <div className="rounded-xl p-2 mb-1.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[7px] uppercase font-bold px-1 py-[1px] rounded" style={{ background: 'rgba(245,158,11,0.18)', color: '#fbbf24' }}>MEDIUM</span>
          <span className="text-[7px] uppercase font-bold px-1 py-[1px] rounded" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>NEVRA</span>
        </div>
        <p className="text-[10.5px] font-bold" style={{ color: '#fafaf9' }}>Petravet KDV hatırlatması</p>
        <p className="text-[9px] mt-0.5" style={{ color: 'rgba(250,250,249,0.65)' }}>Son tarih 28 Mayıs, 3 gün kaldı.</p>
      </div>
    </>
  );
}

function GorevlerScreen() {
  return (
    <>
      <TopBar title="Görevler" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9' }}>7 Görev</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>3 bugün · 4 bu hafta</p>

      {[
        { title: 'Petravet KDV beyan kontrolü', tag: 'BUGÜN', tagColor: '#fca5a5', done: false },
        { title: 'Akgöz mizan denetimi', tag: 'YARIN', tagColor: '#fbbf24', done: false },
        { title: 'Zırhlı Gıda evrak hazırla', tag: 'BU HAFTA', tagColor: GOLD, done: false },
        { title: 'Banka mutabakat — Yıldız', tag: 'YAPILDI', tagColor: '#86efac', done: true },
      ].map((t, i) => (
        <div key={i} className="rounded-lg p-2 mb-1.5 flex items-start gap-2" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0 mt-0.5" style={{ background: t.done ? '#86efac' : 'transparent', border: `1px solid ${t.done ? '#86efac' : 'rgba(255,255,255,0.20)'}` }}>
            {t.done && <CheckSquare size={12} style={{ color: '#0f0d0b' }} />}
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold" style={{ color: t.done ? 'rgba(250,250,249,0.45)' : '#fafaf9', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</p>
            <span className="inline-block mt-0.5 text-[8px] uppercase font-bold tracking-wider px-1 py-[1px] rounded" style={{ background: `${t.tagColor}20`, color: t.tagColor }}>{t.tag}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function BeyannameScreen() {
  return (
    <>
      <TopBar title="Beyanname" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9' }}>Mayıs 2026</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>42 mükellef · 8 gönderildi · 12 hazır</p>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <BeyanCard label="KDV" sent={8} pending={4} />
        <BeyanCard label="GV" sent={3} pending={9} />
        <BeyanCard label="MUH" sent={5} pending={6} />
      </div>

      <p className="text-[8.5px] uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,0.45)' }}>Yakın Son Tarihler</p>
      {[
        { name: 'Petravet', tip: 'KDV', date: '28 May', urgent: true },
        { name: 'Akgöz', tip: 'KDV', date: '28 May', urgent: true },
        { name: 'Yıldız', tip: 'Muh.', date: '26 May', urgent: false },
      ].map((b, i) => (
        <div key={i} className="rounded-md p-1.5 mb-1 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
          <span className="text-[8.5px] font-bold px-1.5 py-[1px] rounded" style={{ background: `${GOLD}20`, color: GOLD }}>{b.tip}</span>
          <span className="text-[10.5px] flex-1" style={{ color: '#fafaf9' }}>{b.name}</span>
          <span className="text-[9px] font-mono" style={{ color: b.urgent ? '#fca5a5' : 'rgba(250,250,249,0.6)' }}>{b.date}</span>
        </div>
      ))}
    </>
  );
}

function BeyanCard({ label, sent, pending }: { label: string; sent: number; pending: number }) {
  return (
    <div className="rounded-md p-2 text-center" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <p className="text-[8.5px] uppercase font-bold tracking-wider" style={{ color: GOLD }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces,serif', fontSize: 15, fontWeight: 700, color: '#86efac', lineHeight: 1.2 }}>{sent}</p>
      <p className="text-[7.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{pending} bekliyor</p>
    </div>
  );
}

function MizanScreen() {
  return (
    <>
      <TopBar title="Mizan" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9' }}>Petravet</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>Nisan 2026 · Genel Mizan</p>

      <div className="rounded-xl p-2.5 mb-2" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(212,184,118,0.18)' }}>
        <p className="text-[8.5px] uppercase tracking-wider mb-1.5" style={{ color: GOLD }}>Brüt Kâr</p>
        <p style={{ fontFamily: 'Fraunces,serif', fontSize: 22, fontWeight: 700, color: '#86efac', letterSpacing: '-0.02em' }}>93.383,38 TL</p>
        <p className="text-[9px] mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>%95,6 marj</p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <SmallMetric label="Satış" value="97.729" color="#86efac" />
        <SmallMetric label="SMM" value="4.345" color="#fca5a5" />
        <SmallMetric label="Giderler" value="104.026" color="#fca5a5" />
        <SmallMetric label="Dönem Kar" value="-10.643" color="#fca5a5" />
      </div>

      <div className="mt-2.5 rounded-md p-2 flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)' }}>
        <AlertCircle size={11} style={{ color: '#fca5a5' }} />
        <span className="text-[10px]" style={{ color: '#fca5a5' }}>CEM: Giderler %106 — kontrol gerek</span>
      </div>
    </>
  );
}

function SmallMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md p-1.5" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <p className="text-[8px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces,serif', fontSize: 13, fontWeight: 700, color }}>{value}</p>
    </div>
  );
}

function EvrakScreen() {
  return (
    <>
      <TopBar title="Evrak + OCR" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9' }}>Belge Yükle</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>AI değerlendirir</p>

      <div className="rounded-xl p-4 text-center mb-2" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))', border: '2px dashed rgba(212,184,118,0.35)' }}>
        <p style={{ fontSize: 28 }}>📎</p>
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 13, color: '#fafaf9', fontWeight: 600 }}>Fatura / Mizan / PDF</h3>
        <p className="text-[9px] mt-1 mb-2" style={{ color: 'rgba(250,250,249,0.55)' }}>Maks 10MB · 5 dosya</p>
        <div className="flex gap-1.5 justify-center">
          <div className="px-3 py-1 rounded-full text-[9.5px] font-bold flex items-center gap-1" style={{ background: `linear-gradient(135deg,${GOLD},${GOLD_DARK})`, color: '#0f0d0b' }}>
            <Camera size={10} /> Kamera
          </div>
          <div className="px-3 py-1 rounded-full text-[9.5px] font-bold flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.05)', color: GOLD, border: `1px solid ${GOLD}30` }}>
            📁 Galeri
          </div>
        </div>
      </div>

      <FileRow icon="📄" name="eurorepar.pdf" size="245KB" status="✓" />
      <FileRow icon="🖼" name="mizan-mayis.jpg" size="1.2MB" status="⟳" />

      <div className="mt-2 px-3 py-2 rounded-xl text-[11px] font-bold text-center" style={{ background: `linear-gradient(135deg,${GOLD},${GOLD_DARK})`, color: '#0f0d0b' }}>
        ⚡ Değerlendir (2)
      </div>
    </>
  );
}

function FileRow({ icon, name, size, status }: { icon: string; name: string; size: string; status: string }) {
  return (
    <div className="rounded-md p-1.5 mb-1 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <span className="text-[14px]">{icon}</span>
      <span className="flex-1 text-[10px] font-semibold" style={{ color: '#fafaf9' }}>{name}</span>
      <span className="text-[8.5px] font-mono" style={{ color: 'rgba(250,250,249,0.5)' }}>{size}</span>
      <span className="text-[12px]" style={{ color: GOLD }}>{status}</span>
    </div>
  );
}

function DenizScreen() {
  return (
    <>
      <TopBar title="DENİZ" />
      <div className="rounded-xl p-3 mb-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(107,163,196,0.12), rgba(15,11,21,0.85))', border: '1px solid rgba(107,163,196,0.30)' }}>
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: '#6ba3c4', fontWeight: 700 }}>DENİZ</h3>
        <p className="text-[8.5px] uppercase tracking-[.18em] mt-1" style={{ color: 'rgba(107,163,196,0.7)' }}>Sistem · Aktif</p>
      </div>
      <p className="text-[10px] mb-2" style={{ color: 'rgba(250,250,249,0.5)' }}>Son 24h · 4 öneri</p>

      <div className="rounded-lg p-2 mb-1" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)' }}>
        <span className="text-[7px] uppercase font-bold px-1 py-[1px] rounded mb-1 inline-block" style={{ background: 'rgba(239,68,68,0.20)', color: '#fca5a5' }}>HIGH · Bug</span>
        <p className="text-[10px] font-bold mt-1" style={{ color: '#fafaf9' }}>Stuck Luca — 60dk+</p>
        <p className="text-[8.5px]" style={{ color: 'rgba(250,250,249,0.65)' }}>2 mizan iptal edildi.</p>
      </div>
      <div className="rounded-lg p-2 mb-1" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="text-[7px] uppercase font-bold px-1 py-[1px] rounded mb-1 inline-block" style={{ background: 'rgba(245,158,11,0.18)', color: '#fbbf24' }}>MEDIUM · Perf</span>
        <p className="text-[10px] font-bold mt-1" style={{ color: '#fafaf9' }}>Endpoint yavaş</p>
        <p className="text-[8.5px]" style={{ color: 'rgba(250,250,249,0.65)' }}>/taxpayers p95 2.4s.</p>
      </div>
    </>
  );
}

function BankaScreen() {
  return (
    <>
      <TopBar title="Banka Takip" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9' }}>Petravet</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>3 hesap · Bu ay 124 hareket</p>

      {[
        { bank: 'AKBANK', iban: 'TR49 ***0307', balance: '24.530,15', color: '#86efac' },
        { bank: 'GARANTİ', iban: 'TR14 ***8564', balance: '8.142,80', color: '#86efac' },
        { bank: 'ZİRAAT', iban: 'TR07 ***5002', balance: '-2.340,50', color: '#fca5a5' },
      ].map((b, i) => (
        <div key={i} className="rounded-lg p-2 mb-1.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9.5px] uppercase font-bold tracking-wider" style={{ color: GOLD }}>{b.bank}</span>
            <span style={{ fontFamily: 'Fraunces,serif', fontSize: 13, fontWeight: 700, color: b.color }}>{b.balance}</span>
          </div>
          <p className="text-[9px] font-mono" style={{ color: 'rgba(250,250,249,0.45)' }}>{b.iban}</p>
        </div>
      ))}
    </>
  );
}

function MetricBox({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="rounded-xl p-2 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))', border: '1px solid rgba(212,184,118,0.22)' }}>
      <p className="text-[7.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces,serif', fontSize: 17, fontWeight: 700, color, lineHeight: 1, marginTop: 3 }}>{value}</p>
      <p className="text-[8px] mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>{sub}</p>
    </div>
  );
}

/* ═══════════ MÜKELLEF EKRANLARI ═══════════ */

function MukOtpScreen() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-2">
      <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${TEAL}, #4a8aa8)` }}>
        <span style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: '#0f0d0b' }}>M</span>
      </div>
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, color: '#fafaf9' }}>Moren Mükellef</h2>
      <p className="text-[10.5px] mb-5" style={{ color: 'rgba(250,250,249,0.55)' }}>Cep numarana SMS göndereceğiz</p>

      <input value="+90 532 *** 67 89" readOnly className="w-full mb-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${TEAL}30`, color: '#fafaf9' }} />

      <p className="text-[9px] mt-3 mb-1" style={{ color: 'rgba(250,250,249,0.55)' }}>Doğrulama Kodu</p>
      <div className="flex gap-1.5 mb-3">
        {['4', '7', '2', '9'].map((d, i) => (
          <div key={i} className="w-10 h-12 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${TEAL}40`, fontFamily: 'Fraunces,serif', fontSize: 20, fontWeight: 700, color: '#fafaf9' }}>{d}</div>
        ))}
      </div>

      <div className="w-full px-3 py-2 rounded-lg text-[12px] font-bold" style={{ background: `linear-gradient(135deg, ${TEAL}, #4a8aa8)`, color: '#0f0d0b' }}>
        Devam Et
      </div>
      <p className="text-[9px] mt-3" style={{ color: 'rgba(250,250,249,0.4)' }}>53 saniye sonra tekrar gönder</p>
    </div>
  );
}

function MukDashboardScreen() {
  return (
    <>
      <TopBar title="Hoş Geldin" accent={TEAL} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 18, fontWeight: 600, color: '#fafaf9' }}>Doğan Özkan</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>Zırhlı Gıda Tic. A.Ş.</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MukMetric label="Bu Ay Satış" value="3.831" sub="TL" color="#86efac" />
        <MukMetric label="Toplam KDV" value="62" sub="TL" color={TEAL} />
        <MukMetric label="Belge" value="42" sub="bekliyor: 3" color="#fafaf9" />
        <MukMetric label="Borç" value="0" sub="ödeme yok" color="#86efac" />
      </div>

      <p className="text-[8.5px] uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>Hızlı Aksiyon</p>
      {[
        { icon: Camera, text: 'Belge / Fatura Yükle', color: TEAL },
        { icon: MessageSquare, text: 'Ofise Mesaj Yaz', color: '#fafaf9' },
        { icon: Receipt, text: 'Faturalarımı Gör', color: '#fafaf9' },
      ].map((a, i) => (
        <div key={i} className="rounded-md py-1.5 px-2.5 mb-1 flex items-center gap-2 text-[10.5px]" style={{ background: 'rgba(107,163,196,0.06)', border: '1px solid rgba(107,163,196,0.20)', color: a.color }}>
          <a.icon size={11} /> {a.text}
        </div>
      ))}
    </>
  );
}

function MukMetric({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl p-2" style={{ background: 'linear-gradient(135deg, rgba(107,163,196,0.08), rgba(15,11,21,0.85))', border: '1px solid rgba(107,163,196,0.22)' }}>
      <p className="text-[7.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces,serif', fontSize: 17, fontWeight: 700, color, lineHeight: 1, marginTop: 3 }}>{value}</p>
      <p className="text-[8px] mt-0.5" style={{ color: 'rgba(250,250,249,0.45)' }}>{sub}</p>
    </div>
  );
}

function MukBelgeScreen() {
  return (
    <>
      <TopBar title="Belge Gönder" accent={TEAL} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600, color: '#fafaf9' }}>Faturayı Çek, Yolla</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>OCR otomatik okur</p>

      <div className="rounded-xl p-5 text-center mb-3" style={{ background: 'linear-gradient(135deg, rgba(107,163,196,0.10), rgba(15,11,21,0.85))', border: `2px dashed ${TEAL}50` }}>
        <p style={{ fontSize: 38, marginBottom: 8 }}>📸</p>
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 13, fontWeight: 600, color: '#fafaf9' }}>Kamera ile Çek</h3>
        <p className="text-[9px] mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>veya galeriden seç</p>
        <div className="mt-3 inline-flex px-4 py-2 rounded-full text-[10.5px] font-bold" style={{ background: `linear-gradient(135deg, ${TEAL}, #4a8aa8)`, color: '#0f0d0b' }}>
          <Camera size={12} className="mr-1.5" /> Kamerayı Aç
        </div>
      </div>

      <p className="text-[8.5px] uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.45)' }}>Son Yüklemeler</p>
      <div className="rounded-md p-1.5 mb-1 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
        <span className="text-[14px]">📄</span>
        <span className="flex-1 text-[10px] font-semibold" style={{ color: '#fafaf9' }}>migros-fatura-may.pdf</span>
        <span className="text-[8.5px] font-bold" style={{ color: '#86efac' }}>✓ OCR</span>
      </div>
      <div className="rounded-md p-1.5 mb-1 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
        <span className="text-[14px]">🖼</span>
        <span className="flex-1 text-[10px] font-semibold" style={{ color: '#fafaf9' }}>akaryakit-kasim.jpg</span>
        <span className="text-[8.5px] font-bold" style={{ color: '#86efac' }}>✓ OCR</span>
      </div>
    </>
  );
}

function MukFaturaScreen() {
  return (
    <>
      <TopBar title="Faturalarım" accent={TEAL} />
      <div className="flex gap-1 mb-3">
        <Pill label="Satış" count={42} active />
        <Pill label="Alış" count={18} />
        <Pill label="Tümü" count={60} />
      </div>

      {[
        { name: 'EUROREPAR', date: '08.04', amount: '12.000', kdv: '2.000', color: '#86efac' },
        { name: 'MIGROS', date: '05.04', amount: '843', kdv: '22', color: '#86efac' },
        { name: 'OPET', date: '03.04', amount: '1.250', kdv: '208', color: GOLD },
        { name: 'BIM', date: '01.04', amount: '420', kdv: '67', color: '#86efac' },
      ].map((f, i) => (
        <div key={i} className="rounded-lg p-2 mb-1.5 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
          <div className="flex-1">
            <p className="text-[11px] font-bold" style={{ color: '#fafaf9' }}>{f.name}</p>
            <p className="text-[8.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{f.date} · KDV {f.kdv}</p>
          </div>
          <p style={{ fontFamily: 'Fraunces,serif', fontSize: 13, fontWeight: 700, color: f.color }}>{f.amount}</p>
        </div>
      ))}
    </>
  );
}

function Pill({ label, count, active = false }: { label: string; count: number; active?: boolean }) {
  return (
    <span className="px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1" style={{ background: active ? `${TEAL}25` : 'rgba(255,255,255,0.04)', border: `1px solid ${active ? `${TEAL}50` : 'rgba(255,255,255,0.06)'}`, color: active ? TEAL : 'rgba(250,250,249,0.55)' }}>
      {label} <span className="opacity-70">{count}</span>
    </span>
  );
}

function MukBeyanScreen() {
  return (
    <>
      <TopBar title="Beyannameler" accent={TEAL} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600, color: '#fafaf9' }}>Beyannamelerin</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>Gönderildi · Ödeme · Onay</p>

      {[
        { name: 'Nisan 2026 KDV', date: '28 Mayıs', status: 'ÖDENECEK', amount: '12.300', color: '#fbbf24' },
        { name: 'Nisan 2026 Muh.', date: '26 Mayıs', status: 'BEKLİYOR', amount: '—', color: GOLD },
        { name: 'Mart 2026 KDV', date: '28 Nisan', status: 'GÖNDERİLDİ', amount: '8.420', color: '#86efac' },
      ].map((b, i) => (
        <div key={i} className="rounded-lg p-2 mb-2" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-[11.5px] font-bold" style={{ color: '#fafaf9' }}>{b.name}</p>
              <p className="text-[9px] mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Son tarih: {b.date}</p>
              <span className="inline-block mt-1 text-[8px] uppercase font-bold tracking-wider px-1.5 py-[1px] rounded" style={{ background: `${b.color}22`, color: b.color }}>{b.status}</span>
            </div>
            {b.amount !== '—' && (
              <p style={{ fontFamily: 'Fraunces,serif', fontSize: 13, fontWeight: 700, color: b.color }}>{b.amount}</p>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function MukMesajScreen() {
  return (
    <>
      <TopBar title="Ofis Mesajı" accent={TEAL} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 16, fontWeight: 600, color: '#fafaf9' }}>Moren Müşavirlik</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>● Çevrimiçi</p>

      <div className="flex flex-col gap-2 mb-3">
        <div className="self-start max-w-[78%] rounded-lg px-2.5 py-1.5 text-[10.5px]" style={{ background: 'rgba(255,255,255,0.04)', color: '#fafaf9' }}>
          Merhaba Doğan Bey, Nisan faturalarınız 2 eksik görünüyor.
        </div>
        <div className="self-start max-w-[78%] rounded-lg px-2.5 py-1.5 text-[10.5px]" style={{ background: 'rgba(255,255,255,0.04)', color: '#fafaf9' }}>
          Migros ve Opet faturalarınızı gönderebilir misiniz?
        </div>
        <div className="self-end max-w-[78%] rounded-lg px-2.5 py-1.5 text-[10.5px]" style={{ background: `${TEAL}25`, color: '#fafaf9', border: `1px solid ${TEAL}40` }}>
          Tamam, hemen yüklüyorum
        </div>
        <div className="self-start max-w-[78%] rounded-lg px-2.5 py-1.5 text-[10.5px]" style={{ background: 'rgba(255,255,255,0.04)', color: '#fafaf9' }}>
          Teşekkürler! Alış kontrolü yapıp dönüyoruz.
        </div>
      </div>

      <div className="mt-auto flex gap-1 items-center">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>📎</div>
        <div className="flex-1 h-7 rounded-lg px-2 flex items-center text-[9.5px]" style={{ background: 'rgba(0,0,0,0.4)', color: 'rgba(250,250,249,0.5)' }}>
          Yaz...
        </div>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${TEAL}, #4a8aa8)`, color: '#0f0d0b' }}>
          <Send size={11} />
        </div>
      </div>
    </>
  );
}

function MukCariScreen() {
  return (
    <>
      <TopBar title="Cari / Ödeme" accent={TEAL} />
      <div className="rounded-xl p-3 mb-3 text-center" style={{ background: `linear-gradient(135deg, ${TEAL}1a, rgba(15,11,21,0.85))`, border: `1px solid ${TEAL}40` }}>
        <p className="text-[8.5px] uppercase tracking-[.18em]" style={{ color: TEAL }}>Mevcut Bakiye</p>
        <p style={{ fontFamily: 'Fraunces,serif', fontSize: 26, fontWeight: 700, color: '#86efac' }}>0,00 TL</p>
        <p className="text-[9px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>Borcunuz bulunmuyor</p>
      </div>

      <p className="text-[8.5px] uppercase tracking-wider mb-2" style={{ color: 'rgba(250,250,249,0.45)' }}>Geçmiş Ödemeler</p>

      {[
        { date: '12.04.2026', desc: 'Mali Müşavirlik Ücreti — Mart', amount: '2.500,00', icon: '✓' },
        { date: '12.03.2026', desc: 'Mali Müşavirlik Ücreti — Şubat', amount: '2.500,00', icon: '✓' },
        { date: '12.02.2026', desc: 'Mali Müşavirlik Ücreti — Ocak', amount: '2.500,00', icon: '✓' },
      ].map((p, i) => (
        <div key={i} className="rounded-md p-1.5 mb-1 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
          <span style={{ color: '#86efac', fontSize: 12 }}>{p.icon}</span>
          <div className="flex-1">
            <p className="text-[10px] font-semibold" style={{ color: '#fafaf9' }}>{p.desc}</p>
            <p className="text-[8.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{p.date}</p>
          </div>
          <p className="text-[10.5px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces,serif' }}>{p.amount}</p>
        </div>
      ))}
    </>
  );
}

function MukBildirimScreen() {
  return (
    <>
      <TopBar title="Bildirimler" accent={TEAL} />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600, color: '#fafaf9' }}>5 Bildirim</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>2 okunmamış</p>

      {[
        { title: 'KDV Beyannameniz Hazır', desc: 'Onay için ofisi inceleyin', tag: 'YENİ', tagColor: TEAL, time: '2 saat önce' },
        { title: 'Mart KDV Ödemesi', desc: 'Son 3 gün — 12.300 TL', tag: 'ACİL', tagColor: '#fca5a5', time: '5 saat önce' },
        { title: 'Ofise gönderilen belgeniz kabul edildi', desc: 'eurorepar.pdf işlendi', tag: '✓', tagColor: '#86efac', time: 'dün' },
        { title: 'Mart Bordro Hazır', desc: 'Görmek için tıkla', tag: 'BİLGİ', tagColor: 'rgba(250,250,249,0.55)', time: '3 gün önce' },
      ].map((n, i) => (
        <div key={i} className="rounded-lg p-2 mb-1.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[8px] uppercase font-bold px-1 py-[1px] rounded" style={{ background: `${n.tagColor}22`, color: n.tagColor }}>{n.tag}</span>
            <span className="text-[9px] ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>{n.time}</span>
          </div>
          <p className="text-[10.5px] font-bold" style={{ color: '#fafaf9' }}>{n.title}</p>
          <p className="text-[9px] mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>{n.desc}</p>
        </div>
      ))}
    </>
  );
}

/* ═══════════ FEATURE GRID'LER ═══════════ */

function OfisFeatureGrid() {
  const features = [
    { icon: Users, title: 'Mükellef Yönetimi', desc: 'Liste, arama, profil, hızlı aksiyon, mizan/KDV bakış' },
    { icon: Brain, title: '7 AI Ekibi', desc: 'AYLİN, NEVRA, CEM, VOLKAN, DEFNE, KAYRA, DENİZ — sesli sohbet' },
    { icon: ShieldCheck, title: 'AI Onay Kuyruğu', desc: 'Toplu onay/reddet, kritik bildirim, audit log' },
    { icon: CheckSquare, title: 'Görevler & Notlar', desc: 'Bugün/yarın/hafta, hatırlatma, müşteri notu' },
    { icon: FileText, title: 'Beyanname Takip', desc: 'KDV/GV/Muhtasar — kim hazır, kim gönderildi' },
    { icon: BarChart3, title: 'Mizan & Bilanço', desc: 'Cep boyutunda mali tablo, anomali uyarısı' },
    { icon: Camera, title: 'Evrak + OCR', desc: 'Kamera ile çek, AI değerlendirir, otomatik kategorize' },
    { icon: Building, title: 'Banka Takip', desc: 'Hesap bakiyesi, mutabakat, son hareketler' },
    { icon: Sparkles, title: 'DENİZ Patrol', desc: 'Gece sistem raporları, otomatik müdahale, haftalık özet' },
    { icon: Receipt, title: 'Cari Kasa', desc: 'Tahsilat, mükellef bakiyesi, ödeme planı' },
    { icon: BookOpen, title: 'Vergi Takvimi', desc: 'Hangi mükellefin hangi tarihte ne yapacağı' },
    { icon: FolderOpen, title: 'Belge Arşivi', desc: 'Tüm yüklü belgeler, hızlı arama, filtrele' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {features.map((f, i) => (
        <div key={i} className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: 'rgba(212,184,118,0.04)', border: '1px solid rgba(212,184,118,0.15)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${GOLD}15`, border: `1px solid ${GOLD}30` }}>
            <f.icon size={15} style={{ color: GOLD }} />
          </div>
          <div className="flex-1">
            <h4 style={{ fontFamily: 'Fraunces, serif', fontSize: 14, fontWeight: 600, color: '#fafaf9' }}>{f.title}</h4>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(250,250,249,0.6)' }}>{f.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function MukellefFeatureGrid() {
  const features = [
    { icon: Phone, title: 'SMS ile Giriş', desc: 'Telefon + OTP. E-posta/parola yok, biyometrik ile hızlı erişim' },
    { icon: Camera, title: 'Belge Yükle (OCR)', desc: 'Faturayı/dekontu çek, AI otomatik okur, ofise gönderir' },
    { icon: Receipt, title: 'Faturalarım', desc: 'Satış + alış, aylara göre, KDV ile birlikte özet' },
    { icon: FileText, title: 'Beyannamelerim', desc: 'KDV, GV, Muhtasar — gönderildi mi, ne kadar ödenecek' },
    { icon: MessageSquare, title: 'Ofise Mesaj', desc: 'WhatsApp gibi — soru sor, eksik evrak iste, durum öğren' },
    { icon: CreditCard, title: 'Cari / Ödeme', desc: 'Mali müşavirlik ücreti bakiyesi, geçmiş ödemeler' },
    { icon: BarChart3, title: 'Mali Özet', desc: 'Bu ay satış, alış, brüt kâr — sade görünüm' },
    { icon: Bell, title: 'Akıllı Bildirim', desc: 'Beyanname son tarihi, eksik belge, mesaj geldi' },
    { icon: BookOpen, title: 'Belgelerim', desc: 'Tüm yüklü belgeler kronolojik, indirilebilir' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {features.map((f, i) => (
        <div key={i} className="rounded-xl p-3.5 flex items-start gap-3" style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}25` }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40` }}>
            <f.icon size={15} style={{ color: TEAL }} />
          </div>
          <div className="flex-1">
            <h4 style={{ fontFamily: 'Fraunces, serif', fontSize: 14, fontWeight: 600, color: '#fafaf9' }}>{f.title}</h4>
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(250,250,249,0.6)' }}>{f.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
