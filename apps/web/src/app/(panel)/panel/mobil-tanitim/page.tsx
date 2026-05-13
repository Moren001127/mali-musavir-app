'use client';

import { Smartphone, Bell, FileText, ShieldCheck, Users, Sparkles, Mic, Camera, ArrowRight } from 'lucide-react';

const GOLD = '#d4b876';

export default function MobilTanitimPage() {
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
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-[10.5px] uppercase font-bold tracking-[.22em] mb-3" style={{ color: GOLD }}>
            Moren Mali Müşavirlik
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
            Ofisin Cebine,<br />AI Ekibin Yanına.
          </h1>
          <p className="mt-5 text-[14.5px] leading-relaxed max-w-2xl mx-auto" style={{ color: 'rgba(250,250,249,0.65)' }}>
            Moren Mobil ile mali müşavirlik ofisinin tamamını telefonunuzdan yönetin.
            7 kişilik AI ekibi, mükellef takibi, AI onay kuyruğu, evrak yükleme ve
            DENİZ'in gece raporları artık cebinizde.
          </p>
          <div className="mt-6 flex gap-2 flex-wrap justify-center">
            <Badge icon={Smartphone} text="iOS · Android" />
            <Badge icon={Mic} text="Sesli Sohbet" />
            <Badge icon={Bell} text="Anlık Bildirim" />
            <Badge icon={Camera} text="Belge + OCR" />
          </div>
        </div>
      </section>

      {/* 6 PHONE MOCKUPS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <PhoneMockup label="01 · Gösterge Paneli">
          <Screen1Dashboard />
        </PhoneMockup>
        <PhoneMockup label="02 · Moren Ofis · 7 AI Ekibi">
          <Screen2Chat />
        </PhoneMockup>
        <PhoneMockup label="03 · AI Onay Kuyruğu">
          <Screen3Onay />
        </PhoneMockup>
        <PhoneMockup label="04 · Mükellef Bakış">
          <Screen4Mukellef />
        </PhoneMockup>
        <PhoneMockup label="05 · DENİZ Gece Raporu">
          <Screen5Deniz />
        </PhoneMockup>
        <PhoneMockup label="06 · Evrak + OCR">
          <Screen6Evrak />
        </PhoneMockup>
      </div>

      {/* FEATURES */}
      <section className="rounded-2xl p-6" style={{ background: 'rgba(212,184,118,0.04)', border: '1px solid rgba(212,184,118,0.15)' }}>
        <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: '#fafaf9', letterSpacing: '-0.02em' }}>
          Ne yapabilir?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <Feature title="7 AI Ekibi" desc="AYLİN, NEVRA, CEM, VOLKAN, DEFNE, KAYRA, DENİZ — telefondan sesli sohbet." />
          <Feature title="Sesli Konuş" desc="Yolda Moren Ofis ekibiyle konuş; ne yapacaklarını net söylesinler." />
          <Feature title="Evrak + OCR" desc="Faturayı çek-gönder; AI değerlendirir, doğru kalemi yakalar." />
          <Feature title="Akıllı Bildirim" desc="Kritik AI önerisi, mükellef mesajı, son tarih yaklaşınca cebinde." />
        </div>
      </section>

      {/* STATUS */}
      <section className="text-center py-6" style={{ color: 'rgba(250,250,249,0.5)' }}>
        <p className="text-sm">
          <span style={{ color: GOLD, fontWeight: 700 }}>Yakında</span> — iOS App Store + Google Play
        </p>
        <p className="text-xs mt-2 tracking-[.18em] uppercase" style={{ color: 'rgba(250,250,249,0.35)' }}>
          Moren Mobil · v0.1 İskelet
        </p>
      </section>
    </div>
  );
}

function Badge({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold"
      style={{ background: 'rgba(212,184,118,0.10)', border: '1px solid rgba(212,184,118,0.30)', color: GOLD }}
    >
      <Icon size={13} />
      {text}
    </span>
  );
}

function PhoneMockup({ label, children }: { label: string; children: React.ReactNode }) {
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
          boxShadow: '0 0 0 2px #1c1813, 0 0 0 8px #2a2419, 0 24px 50px rgba(0,0,0,0.5), 0 0 60px rgba(212,184,118,0.05)',
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
      <p className="text-center mt-3 text-[10.5px] uppercase font-bold tracking-[.18em]" style={{ color: 'rgba(212,184,118,0.85)' }}>
        {label}
      </p>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'rgba(212,184,118,0.04)', border: '1px solid rgba(212,184,118,0.15)' }}>
      <h4 style={{ fontFamily: 'Fraunces, serif', fontSize: 14, fontWeight: 600, color: GOLD, marginBottom: 4 }}>{title}</h4>
      <p className="text-[11.5px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.55)' }}>{desc}</p>
    </div>
  );
}

/* ====== EKRAN İÇERİKLERİ ====== */

function TopBar({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b', fontFamily: 'Fraunces, serif' }}>
        M
      </div>
      <span style={{ fontFamily: 'Fraunces, serif', fontSize: 13, fontWeight: 600, color: '#fafaf9' }}>{title}</span>
      <div className="ml-auto w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)', position: 'relative' }}>
        <Bell size={11} style={{ color: GOLD }} />
        <span className="absolute top-[3px] right-[3px] w-1.5 h-1.5 rounded-full" style={{ background: '#ef4444' }} />
      </div>
    </div>
  );
}

function Screen1Dashboard() {
  return (
    <>
      <TopBar title="Moren" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, color: '#fafaf9', letterSpacing: '-0.02em' }}>
        Günaydın Muzaffer
      </h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>13 Mayıs · Çarşamba</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatBox label="Bekleyen" value="3" valueColor="#fca5a5" sub="2 kritik · 1 normal" />
        <StatBox label="Bugün AI" value="8¢" valueColor="#fafaf9" sub="42 mesaj" />
      </div>

      <BrifingMini />
    </>
  );
}

function StatBox({ label, value, valueColor, sub }: { label: string; value: string; valueColor: string; sub: string }) {
  return (
    <div className="rounded-xl p-2.5 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))', border: '1px solid rgba(212,184,118,0.22)' }}>
      <span className="absolute top-0 left-3 right-3 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.5 }} />
      <p className="text-[8px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 700, color: valueColor, lineHeight: 1, marginTop: 4 }}>{value}</p>
      <p className="text-[8.5px] mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>{sub}</p>
    </div>
  );
}

function BrifingMini() {
  return (
    <div className="rounded-xl p-3 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.08), rgba(15,11,21,0.9))', border: '1px solid rgba(212,184,118,0.30)' }}>
      <span className="absolute top-0 left-5 right-5 h-px" style={{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: 0.55 }} />
      <p className="text-[8.5px] uppercase font-bold tracking-[.18em] mb-1" style={{ color: GOLD }}>
        <Sparkles size={9} className="inline mr-1" />Bugünkü Brifing
      </p>
      <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 13, fontWeight: 600, color: '#fafaf9', marginBottom: 8, letterSpacing: '-0.01em' }}>
        3 Mükellefin KDV Son Günü Yarın
      </h3>
      {['Petravet · KDV beyanname taslağı hazır', 'Akgöz Otomotiv · Eksik fatura: 2', 'Yıldız Tekstil · Mizan kontrolü gerek'].map((t, i) => (
        <p key={i} className="text-[10px] mb-1" style={{ color: 'rgba(250,250,249,0.78)' }}>
          <span style={{ color: GOLD, marginRight: 4 }}>◆</span>{t}
        </p>
      ))}
    </div>
  );
}

function Screen2Chat() {
  return (
    <>
      <TopBar title="Moren Ofis" />
      <div className="grid grid-cols-4 gap-1 mb-2.5">
        {[
          { name: 'AYLİN', sub: 'Müşavir', bg: 'linear-gradient(135deg,#d4b876,#b8a06f)', color: '#d4b876', initials: 'AY' },
          { name: 'NEVRA', sub: 'Vergi', bg: 'linear-gradient(135deg,#60a5fa,#3b82f6)', color: '#60a5fa', initials: 'NV' },
          { name: 'CEM', sub: 'Denetim', bg: 'linear-gradient(135deg,#a855f7,#7e22ce)', color: '#a855f7', initials: 'CM' },
          { name: 'DENİZ', sub: 'Sistem', bg: 'linear-gradient(135deg,#6ba3c4,#4a8aa8)', color: '#6ba3c4', initials: 'DN' },
        ].map((a) => (
          <div key={a.name} className="rounded-lg py-1.5 px-1 text-center" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.10), rgba(255,255,255,0.012))', border: '1px solid rgba(212,184,118,0.22)' }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center mx-auto mb-1 text-[7px] font-bold" style={{ background: a.bg, color: '#0f0d0b', fontFamily: 'Fraunces,serif' }}>
              {a.initials}
            </div>
            <p style={{ fontFamily: 'Fraunces,serif', fontSize: 9, fontWeight: 700, color: a.color, letterSpacing: '-0.01em' }}>{a.name}</p>
            <p className="text-[6px] uppercase tracking-wider mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>{a.sub}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl p-2.5 flex flex-col gap-2" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.05), rgba(15,11,21,0.85))', border: '1px solid rgba(212,184,118,0.22)', minHeight: 280 }}>
        <div className="self-end max-w-[80%] rounded-lg px-2.5 py-1.5 text-[10px]" style={{ background: 'rgba(212,184,118,0.18)', border: '1px solid rgba(212,184,118,0.30)', color: '#fafaf9' }}>
          Petravet için Mayıs KDV durumu?
        </div>
        <ChatMsg color="#d4b876" name="AYLİN" body="Tamam Muzaffer Bey, Nevra'ya yönlendiriyorum, KDV durumunu özetleyecek. Cem de mizan açısından bakacak." />
        <ChatMsg color="#60a5fa" name="NEVRA" body="Petravet Nisan KDV: satış 97.729 TL, alış 36.319 TL. Net ödenecek KDV ~12.300 TL. Son tarih 28 Mayıs." />
        <div className="mt-auto flex gap-1 items-center">
          <InputIcon>📎</InputIcon>
          <InputIcon><Mic size={11} /></InputIcon>
          <div className="flex-1 h-7 rounded-lg px-2 flex items-center text-[9.5px]" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,184,118,0.22)', color: 'rgba(250,250,249,0.5)' }}>
            Ekibe sor...
          </div>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
            <ArrowRight size={11} />
          </div>
        </div>
      </div>
    </>
  );
}

function InputIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px]" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.65)' }}>
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
      <div className="rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed" style={{ background: 'rgba(255,255,255,0.02)', color: 'rgba(250,250,249,0.92)' }}>
        {body}
      </div>
    </div>
  );
}

function Screen3Onay() {
  return (
    <>
      <TopBar title="AI Onay" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, color: '#fafaf9' }}>3 Onay Bekliyor</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>AI ekiplerin önerileri</p>

      <OnayCard high title="Captcha modeli güncellensin" desc="Son 24 saatte 8 başarısız Luca giriş. Captcha çözücü %60'a düştü." pill="CRITICAL" pillColor="#fca5a5" agent="DENİZ" showActions />
      <OnayCard title="Petravet'e KDV hatırlatması" desc="Mayıs KDV son günü 28 Mayıs · 3 gün kaldı · WhatsApp ile hatırlat." pill="MEDIUM" pillColor="#fbbf24" agent="NEVRA" />
      <OnayCard title="Akgöz'e teşekkür mesajı" desc="Faturalar zamanında geldi · taslak mesaj hazır." pill="LOW" pillColor="#86efac" agent="DEFNE" />
    </>
  );
}

function OnayCard({ high, title, desc, pill, pillColor, agent, showActions }: any) {
  const bgColor = high ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.025)';
  const borderColor = high ? 'rgba(239,68,68,0.30)' : 'rgba(255,255,255,0.05)';
  const barColor = pill === 'CRITICAL' ? '#ef4444' : pill === 'MEDIUM' ? '#fbbf24' : '#86efac';
  return (
    <div className="rounded-xl p-2 mb-1.5 flex gap-2" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
      <div style={{ width: 2.5, borderRadius: 100, background: barColor }} />
      <div className="flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[7px] uppercase font-bold tracking-[.14em] px-1 py-[1px] rounded" style={{ background: `${pillColor}20`, color: pillColor }}>{pill}</span>
          <span className="text-[7px] uppercase font-bold tracking-[.14em] px-1 py-[1px] rounded" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>{agent}</span>
        </div>
        <p className="text-[10.5px] font-bold mb-0.5" style={{ color: '#fafaf9' }}>{title}</p>
        <p className="text-[9px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.65)' }}>{desc}</p>
        {showActions && (
          <div className="flex gap-1 mt-1.5">
            <div className="flex-1 h-5 rounded flex items-center justify-center text-[8.5px] font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.30)' }}>✕ Reddet</div>
            <div className="flex-1 h-5 rounded flex items-center justify-center text-[8.5px] font-bold" style={{ background: `linear-gradient(135deg,${GOLD},#b8a06f)`, color: '#0f0d0b' }}>✓ Onayla</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Screen4Mukellef() {
  return (
    <>
      <TopBar title="Mükellefler" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, color: '#fafaf9' }}>Hızlı Bakış</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>42 aktif mükellef</p>

      <MukellefCard name="Petravet Veteriner Klinik" vkn="VKN: 7290854321 · İstanbul" m1="✓" c1="#86efac" m2="⏳" c2="#fbbf24" m3="42" c3="#86efac" />
      <MukellefCard name="Akgöz Otomotiv Ltd." vkn="VKN: 0540123456 · İzmir" m1="✓" c1="#86efac" m2="!" c2="#fca5a5" m3="38" c3="#d4b876" />
      <MukellefCard name="Yıldız Tekstil A.Ş." vkn="VKN: 9123456789 · Bursa" m1="⏳" c1="#fbbf24" m2="✓" c2="#86efac" m3="71" c3="#86efac" />
    </>
  );
}

function MukellefCard({ name, vkn, m1, c1, m2, c2, m3, c3 }: any) {
  return (
    <div className="rounded-xl p-2.5 mb-1.5" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))', border: '1px solid rgba(212,184,118,0.22)' }}>
      <p style={{ fontFamily: 'Fraunces, serif', fontSize: 12, fontWeight: 600, color: '#fafaf9', letterSpacing: '-0.01em' }}>{name}</p>
      <p className="text-[8.5px] mb-1.5" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'monospace' }}>{vkn}</p>
      <div className="grid grid-cols-3 gap-1">
        <MukellefM label="Mizan" value={m1} color={c1} />
        <MukellefM label="KDV" value={m2} color={c2} />
        <MukellefM label="Evrak" value={m3} color={c3} />
      </div>
    </div>
  );
}

function MukellefM({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md py-1 text-center" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <p className="text-[7px] uppercase tracking-[.1em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</p>
      <p style={{ fontFamily: 'Fraunces, serif', fontSize: 12, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</p>
    </div>
  );
}

function Screen5Deniz() {
  return (
    <>
      <TopBar title="DENİZ Patrol" />
      <div className="rounded-xl p-3 mb-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(107,163,196,0.12), rgba(15,11,21,0.85))', border: '1px solid rgba(107,163,196,0.30)' }}>
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: '#6ba3c4', fontWeight: 700, marginBottom: 2 }}>DENİZ</h3>
        <p className="text-[8.5px] uppercase font-bold tracking-[.18em]" style={{ color: 'rgba(107,163,196,0.7)' }}>Sistem Sorumlusu · Aktif</p>
      </div>
      <p className="text-[10px] mb-2" style={{ color: 'rgba(250,250,249,0.5)' }}>Son 24 saat · 4 öneri</p>

      <PropCard high title="Stuck Luca Job — 60dk+" desc="2 mizan çekim takıldı, otomatik iptal edildi. Captcha hatası muhtemel." pill="HIGH" pillColor="#fca5a5" cat="Bug" />
      <PropCard title="Endpoint yavaş" desc="/taxpayers p95 2.4s — index önerilir." pill="MEDIUM" pillColor="#fbbf24" cat="Performans" />
      <PropCard title="DB Snapshot OK" desc="Gece yedekleme tamamlandı · 04:12." pill="LOW" pillColor="#86efac" cat="Bilgi" />
    </>
  );
}

function PropCard({ high, title, desc, pill, pillColor, cat }: any) {
  return (
    <div className="rounded-lg p-2 mb-1" style={{ background: high ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.025)', border: `1px solid ${high ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[7px] uppercase font-bold tracking-[.14em] px-1 py-[1px] rounded" style={{ background: `${pillColor}20`, color: pillColor }}>{pill}</span>
        <span className="text-[7px] uppercase font-bold tracking-[.14em] px-1 py-[1px] rounded" style={{ background: 'rgba(212,184,118,0.14)', color: GOLD }}>{cat}</span>
      </div>
      <p className="text-[10px] font-bold" style={{ color: '#fafaf9' }}>{title}</p>
      <p className="text-[8.5px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.65)' }}>{desc}</p>
    </div>
  );
}

function Screen6Evrak() {
  return (
    <>
      <TopBar title="Evrak Yükle" />
      <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 600, color: '#fafaf9' }}>Evrak Gönder</h2>
      <p className="text-[10px] mb-3" style={{ color: 'rgba(250,250,249,0.5)' }}>AI ekip değerlendirir</p>

      <div className="rounded-xl p-5 text-center mb-3" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.06), rgba(15,11,21,0.85))', border: '2px dashed rgba(212,184,118,0.35)' }}>
        <p style={{ fontSize: 28, marginBottom: 8 }}>📎</p>
        <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 13, color: '#fafaf9', fontWeight: 600, marginBottom: 4 }}>Fatura · Mizan · PDF</h3>
        <p className="text-[9px] mb-3" style={{ color: 'rgba(250,250,249,0.55)' }}>Resim · PDF · Text<br />Maks 10MB · 5 dosya</p>
        <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[10.5px] font-bold" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
          <Camera size={11} /> Kamera ile Çek
        </div>
      </div>

      <FileItem icon="📄" name="eurorepar-fatura.pdf" size="245KB" />
      <FileItem icon="🖼" name="mizan-mayis.jpg" size="1.2MB" />

      <div className="rounded-xl py-2.5 text-center text-[11px] font-bold mt-2" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>
        ⚡ Değerlendir (2 dosya)
      </div>
    </>
  );
}

function FileItem({ icon, name, size }: { icon: string; name: string; size: string }) {
  return (
    <div className="rounded-lg p-2 flex items-center gap-2 mb-1" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="w-7 h-7 rounded-md flex items-center justify-center text-[13px]" style={{ background: 'rgba(212,184,118,0.12)' }}>
        {icon}
      </div>
      <div className="flex-1 text-[10px] font-semibold" style={{ color: '#fafaf9' }}>{name}</div>
      <div className="text-[8.5px] font-mono" style={{ color: 'rgba(250,250,249,0.5)' }}>{size}</div>
    </div>
  );
}
