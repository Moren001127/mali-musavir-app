'use client';

import { useState, useMemo } from 'react';
import {
  Settings, Cloud, FileText, Plug, BookOpen,
  Search, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import {
  taxpayerName,
  taxpayerType,
  taxpayerBookType,
  taxpayerTaxNumber,
  taxpayerSearchMatch,
} from '../_lib/taxpayer';

/* ════════════════════════════════════════════════════════════════════
   MÜKELLEFLER PANELİ — Mihsap referansı
   Her mukellef satırında 5 hızlı işlem ikonu:
     1) Mukellef Ayar      (Settings)
     2) Yükleme Menüsü     (Cloud — drag-drop & QR mobil)
     3) GIB Portal         (FileText — e-Arşiv satış çekme)
     4) Entegratör         (Plug — e-Fatura sağlayıcı config)
     5) Hesap Planı        (BookOpen — Luca senkron)
   ════════════════════════════════════════════════════════════════════ */

type Props = {
  taxpayers: Array<any>;
  loading: boolean;
  onRefresh: () => void;
  onSelectTaxpayer: (id: string) => void;
};

type ActionId = 'ayar' | 'yukle' | 'gib' | 'entegrator' | 'hesap';

const ACTIONS: Array<{
  id: ActionId;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
}> = [
  { id: 'ayar',       label: 'Mukellef Ayarları', desc: 'Defter türü, KDV, stok',          icon: Settings, color: '#9ca3af' },
  { id: 'yukle',      label: 'Belge Yükle',       desc: 'Alış/Satış/Banka — drag-drop',     icon: Cloud,    color: '#60a5fa' },
  { id: 'gib',        label: 'GİB e-Arşiv',       desc: 'GİB portalından satış çek',        icon: FileText, color: '#f97316' },
  { id: 'entegrator', label: 'Entegratör',         desc: 'e-Logo, Uyumsoft, Paraşüt vb.',    icon: Plug,     color: '#10b981' },
  { id: 'hesap',      label: 'Hesap Planı',       desc: 'Luca senkron + yeni hesap',         icon: BookOpen, color: '#a78bfa' },
];

export default function MukelleflerPanel({ taxpayers, loading, onRefresh, onSelectTaxpayer }: Props) {
  const [search, setSearch] = useState('');
  const [activeDialog, setActiveDialog] = useState<{ action: ActionId; taxpayer: any } | null>(null);

  const filtered = useMemo(() => {
    if (!search) return taxpayers;
    return taxpayers.filter((t) => taxpayerSearchMatch(t, search));
  }, [taxpayers, search]);

  return (
    <div className="p-6">
      {/* Üst eylem barı */}
      <div className="flex items-center gap-3 mb-5">
        <div className="text-[20px] font-semibold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-heading)' }}>
          Mükellefler
        </div>
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} kayıt
        </div>

        <div className="flex-1" />
      </div>

      {/* Arama */}
      <div
        className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Search size={15} style={{ color: 'var(--text-muted)' }} />
        <input
          placeholder="Mükellef adı veya VKN ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: 'var(--text)' }}
        />
      </div>

      {/* Tablo */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>VERGİ NO</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>FİRMA / AD</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>TİP</th>
              <th className="text-left px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>DEFTER</th>
              <th className="text-right px-3 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>HIZLI İŞLEMLER</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  Yükleniyor...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  {search ? 'Eşleşen mukellef yok' : 'Henüz mukellef eklenmemiş'}
                </td>
              </tr>
            )}
            {filtered.map((t, idx) => (
              <tr
                key={t.id}
                className="group transition-colors"
                style={{
                  borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--border-soft)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <td className="px-4 py-2.5 text-[12.5px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {taxpayerTaxNumber(t)}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onSelectTaxpayer(t.id)}
                    className="text-[13px] font-medium text-left hover:underline"
                    style={{ color: 'var(--text)' }}
                  >
                    {taxpayerName(t)}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {taxpayerType(t)}
                </td>
                <td className="px-3 py-2.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {taxpayerBookType(t)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    {ACTIONS.map((a) => {
                      const Icon = a.icon;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          title={`${a.label} — ${a.desc}`}
                          onClick={() => setActiveDialog({ action: a.id, taxpayer: t })}
                          className="p-2 rounded-md transition-all"
                          style={{
                            background: 'transparent',
                            color: a.color,
                            border: '1px solid transparent',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = `${a.color}15`;
                            e.currentTarget.style.borderColor = `${a.color}40`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'transparent';
                          }}
                        >
                          <Icon size={15} strokeWidth={1.8} />
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onSelectTaxpayer(t.id)}
                      className="ml-1 p-2 rounded-md transition-colors"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                      title="Detaya git"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hızlı işlem dialog'u */}
      {activeDialog && (
        <QuickActionDialog
          action={activeDialog.action}
          taxpayer={activeDialog.taxpayer}
          onClose={() => setActiveDialog(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

/* ─── Hızlı işlem modal yer tutucusu ─── */
function QuickActionDialog({
  action, taxpayer, onClose, onRefresh,
}: { action: ActionId; taxpayer: any; onClose: () => void; onRefresh: () => void }) {
  const a = ACTIONS.find((x) => x.id === action)!;
  const Icon = a.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="p-2 rounded-lg"
              style={{ background: `${a.color}20`, color: a.color }}
            >
              <Icon size={18} />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                {a.label}
              </div>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {taxpayer.name}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
          >
            <div className="text-[13.5px] font-medium mb-1" style={{ color: 'var(--text)' }}>
              {action === 'yukle' && 'Belge yükleme paneli (Alış/Satış/Banka, drag-drop, QR mobil) buraya gelecek.'}
              {action === 'gib' && 'GİB e-Arşiv satış çekim ekranı (tarih aralığı + Sorgula + Talimat Ver + Güvenli Çıkış).'}
              {action === 'entegrator' && 'e-Fatura entegratör config (Sağlayıcı + kullanıcı + şifre + Talimat).'}
              {action === 'hesap' && 'Hesap planı (Luca senkron + yeni hesap aç + fatura işlerken eşleştirme).'}
              {action === 'ayar' && 'Mukellef ayarları (defter türü, KDV ayır, stok, tevkifat vs.)'}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Bu sayfa bir sonraki sürümde aktif olacak.
            </div>
          </div>
        </div>

        <div
          className="px-6 py-3 flex justify-end gap-2"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12.5px] rounded-md font-medium transition-colors"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
