import { BotMessageSquare, Info } from 'lucide-react';
import { LucaOperatorChat } from './_components/LucaOperatorChat';
import { LucaSkillsPanel } from './_components/LucaSkillsPanel';
import { LucaOperatorDurum } from './_components/LucaOperatorDurum';

const ACCENT = '#d4b876'; // altın — Luca Operatörü modül kimliği

export const metadata = {
  title: 'Luca Operatörü',
};

export default function LucaOperatorPage() {
  return (
    <div className="flex h-full flex-col gap-3">
      {/* Üst renk şeridi */}
      <div
        className="h-1 w-full flex-shrink-0 rounded-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}33 40%, transparent)` }}
      />

      {/* Başlık (kompakt, AI Maliyet imzası) */}
      <header
        className="relative flex-shrink-0 overflow-hidden rounded-2xl px-5 py-4"
        style={{
          background: 'linear-gradient(135deg, rgba(24,20,12,0.92), rgba(8,7,5,0.92))',
          border: `1px solid ${ACCENT}29`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background: `radial-gradient(circle at 12% 0%, ${ACCENT}24, transparent 36%), radial-gradient(circle at 100% 120%, ${ACCENT}12, transparent 42%)`,
          }}
        />
        <div className="relative flex items-center gap-4">
          <div
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #8b7649)`,
              color: '#15110b',
              boxShadow: `0 0 22px ${ACCENT}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            <BotMessageSquare size={24} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold" style={{ color: '#fafaf9' }}>
              Luca Operatörü
            </h1>
            <p className="text-sm" style={{ color: 'rgba(250,250,249,0.6)' }}>
              Luca işlerini yapan, konuşulan ve öğrenen çalışan. Yazılı veya sesli komut ver.
            </p>
          </div>
          <span
            className="hidden flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold sm:inline-flex"
            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#86efac' }}
            title="Max aboneliğiyle çalışır — ek API maliyeti yok"
          >
            ● Max · ücretsiz
          </span>
        </div>
      </header>

      {/* Operatör tarayıcısı durumu + öğrendiği menü haritaları */}
      <LucaOperatorDurum />

      {/* Kapsam notu */}
      <div
        className="flex flex-shrink-0 items-start gap-2 rounded-xl px-4 py-2.5 text-xs"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(250,250,249,0.7)',
        }}
      >
        <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />
        <span>
          <b style={{ color: '#fafaf9' }}>Yapabildikleri:</b> senin bilgisayarında <b style={{ color: '#fafaf9' }}>kendi
          Chrome penceresini</b> açar (günlük tarayıcına karışmaz), Luca menüsünü <b style={{ color: '#fafaf9' }}>kendi
          keşfeder</b>, ekranı bulup açar, okur ve doldurur; mükellef/mali veriyi de görür.
          <b style={{ color: '#fafaf9' }}> Gönder/Kaydet/Onayla/Tahakkuk</b> gibi geri dönülmez adımlarda durur,
          ne yapacağını özetler ve senin onayını bekler. Bilmediği işi önce ekrandan ve
          <b style={{ color: '#fafaf9' }}> geçen dönemin kaydından</b> öğrenmeye çalışır.
        </span>
      </div>

      {/* Öğrenilen beceriler */}
      <LucaSkillsPanel />

      {/* Sohbet — kalan alanı doldurur */}
      <div className="min-h-0 flex-1">
        <LucaOperatorChat />
      </div>
    </div>
  );
}
