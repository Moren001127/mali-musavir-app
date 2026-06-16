'use client';
import Link from 'next/link';
import { Briefcase, UserRound, ArrowRight } from 'lucide-react';

const GOLD = '#d4b876';

const options = [
  {
    href: '/giris/musavir',
    icon: Briefcase,
    title: 'Mali Müşavir Girişi',
    text: 'Ofis personeli ve yönetici — tüm portal yönetimi',
  },
  {
    href: '/giris/mukellef',
    icon: UserRound,
    title: 'Mükellef Girişi',
    text: 'Kendi beyanname, cari ve evrak bilgilerinizi görüntüleyin',
  },
];

export default function GirisSecimPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, rgba(184,160,111,.10), transparent 55%),' +
          'linear-gradient(160deg, #211c15 0%, #17130f 100%)',
      }}
    >
      <img
        src="/brand/moren-logo-gold.png"
        alt="Moren Mali Müşavirlik"
        style={{ height: 110, width: 'auto', maxWidth: 360, filter: 'drop-shadow(0 10px 40px rgba(212,184,118,.35))' }}
      />
      <h1
        className="mt-8 text-center"
        style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}
      >
        Nasıl giriş yapmak istersiniz?
      </h1>
      <p className="mt-2 text-[14px] text-center" style={{ color: 'rgba(250,250,249,.45)' }}>
        Lütfen giriş türünüzü seçin
      </p>

      <div className="mt-10 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {options.map(({ href, icon: Icon, title, text }) => (
          <Link
            key={href}
            href={href}
            className="group relative overflow-hidden rounded-2xl p-6 transition-all"
            style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(184,160,111,.18)' }}
          >
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${GOLD}, transparent)` }} />
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, rgba(184,160,111,.18), rgba(184,160,111,.06))', border: '1px solid rgba(184,160,111,.22)' }}
            >
              <Icon size={22} style={{ color: GOLD }} />
            </div>
            <h2 className="mt-4 text-[17px] font-semibold" style={{ color: '#fafaf9' }}>{title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'rgba(250,250,249,.5)' }}>{text}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold transition-transform group-hover:translate-x-1" style={{ color: GOLD }}>
              Devam et <ArrowRight size={15} />
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-[11px]" style={{ color: 'rgba(250,250,249,.2)' }}>© 2026 Moren Mali Müşavirlik</p>
    </div>
  );
}
