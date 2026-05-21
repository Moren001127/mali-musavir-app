'use client';

import { Send, FileSpreadsheet, BookOpen } from 'lucide-react';

/* VERİ AKTARIMI — Mihsap referansı.
   3 ana sekme: Bilanço · İşletme Defteri · Serbest Meslek
   2 alt sekme: Faturaları Aktar · Hesap Planı Aktar
   Hedef yazılım: LUCA (dropdown — Mikro/Etas/Logo da eklenebilir) */
export default function VeriAktarimiPanel({ period }: { period: string }) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Luca'ya Aktarım
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Dönem {period} · Bilanço, İşletme Defteri, Serbest Meslek için ayrı sekmeler
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} />
            <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Faturaları Aktar</div>
          </div>
          <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
            Onaylanmış faturalar Luca'nın Toplu Fis Aktarım formatına Excel olarak dönüştürülür ve agent üzerinden Luca'ya yüklenir. Tek mukellef = tek fiş.
          </p>
          <button
            className="w-full py-2 text-[13px] font-semibold rounded-lg"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            Toplu Aktarım — Excel Üret
          </button>
        </div>

        <div className="rounded-xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={16} style={{ color: '#a78bfa' }} />
            <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Hesap Planı Aktar</div>
          </div>
          <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
            Mihsap'ta açılan yeni hesap kodları Luca'ya gönderilir. Faturada eşleştirilen ama Luca'da olmayan hesaplar, Luca'da otomatik açılır.
          </p>
          <button
            className="w-full py-2 text-[13px] font-semibold rounded-lg"
            style={{ background: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa40' }}
          >
            Yeni Hesapları Luca'ya Gönder
          </button>
        </div>
      </div>

      <div className="mt-4 p-3 rounded-lg text-[11.5px]" style={{ background: 'var(--accent-50)', border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--accent)' }}>Not:</strong> Mihsap doğrudan Luca veritabanına bağlanır (üye no + admin/şifre). Bizde Playwright agent Luca web arayüzünü kullanır — yavaş ama API gerektirmez. İleride Luca'nın resmi OAuth2 API'sine geçeceğiz.
      </div>
    </div>
  );
}
