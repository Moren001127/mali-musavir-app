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
import EntegratorDialog from '../_dialogs/EntegratorDialog';
import UploadDialog from '../_dialogs/UploadDialog';
import GibPortalDialog from '../_dialogs/GibPortalDialog';
import HesapPlaniDialog from '../_dialogs/HesapPlaniDialog';
import MukellefAyarDialog from '../_dialogs/MukellefAyarDialog';

type Props = {
  taxpayers: Array<any>;
  loading: boolean;
  period: string;
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
  bg: string;
}> = [
  { id: 'ayar',       label: 'Mukellef Ayarları', desc: 'Defter türü, KDV, stok',       icon: Settings, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  { id: 'yukle',      label: 'Belge Yükle',       desc: 'Alış/Satış/Banka — drag-drop', icon: Cloud,    color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  { id: 'gib',        label: 'GİB e-Arşiv',       desc: 'GİB portalından satış çek',    icon: FileText, color: '#fb923c', bg: 'rgba(251,146,60,0.12)'  },
  { id: 'entegrator', label: 'Entegratör',         desc: 'e-Logo, Uyumsoft, Paraşüt',   icon: Plug,     color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  { id: 'hesap',      label: 'Hesap Planı',        desc: 'Luca senkron + yeni hesap',   icon: BookOpen, color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
];

const TIP_STYLE: Record<string, { color: string; bg: string }> = {
  Bireysel:  { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  Kurumsal:  { color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
};

const DEFTER_STYLE: Record<string, { color: string; bg: string }> = {
  İşletme:  { color: '#2dd4bf', bg: 'rgba(45,212,191,0.1)'  },
  Bilanço:  { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)'  },
};

export default function MukelleflerPanel({ taxpayers, loading, period, onRefresh, onSelectTaxpayer }: Props) {
  const [search, setSearch] = useState('');
  const [activeDialog, setActiveDialog] = useState<{ action: ActionId; taxpayer: any } | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return taxpayers;
    return taxpayers.filter((t) => taxpayerSearchMatch(t, search));
  }, [taxpayers, search]);

  return (
    <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Başlık */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#fafaf9', letterSpacing: '-0.3px' }}>Mükellefler</span>
        <span style={{ fontSize: 12.5, color: 'rgba(250,250,249,0.4)', fontWeight: 500 }}>{filtered.length} kayıt</span>
      </div>

      {/* Arama */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', borderRadius: 10, marginBottom: 16,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <Search size={14} style={{ color: 'rgba(250,250,249,0.3)', flexShrink: 0 }} />
        <input
          placeholder="Mükellef adı veya VKN ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#fafaf9' }}
        />
      </div>

      {/* Tablo */}
      <div style={{
        flex: 1, overflowY: 'auto',
        borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(250,250,249,0.35)', whiteSpace: 'nowrap' }}>VERGİ NO</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(250,250,249,0.35)' }}>FİRMA / AD</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(250,250,249,0.35)' }}>TİP</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(250,250,249,0.35)' }}>DEFTER</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(250,250,249,0.35)', whiteSpace: 'nowrap' }}>HIZLI İŞLEMLER</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.3)' }}>
                  Yükleniyor...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'rgba(250,250,249,0.3)' }}>
                  {search ? 'Eşleşen mükellef bulunamadı' : 'Henüz mükellef eklenmemiş'}
                </td>
              </tr>
            )}
            {filtered.map((t, idx) => {
              const tip    = taxpayerType(t);
              const defter = taxpayerBookType(t);
              const tipStyle    = TIP_STYLE[tip]    || { color: 'rgba(250,250,249,0.5)', bg: 'rgba(255,255,255,0.06)' };
              const defterStyle = DEFTER_STYLE[defter] || { color: 'rgba(250,250,249,0.5)', bg: 'rgba(255,255,255,0.06)' };
              const isHovered = hoveredRow === t.id;

              return (
                <tr
                  key={t.id}
                  onMouseEnter={() => setHoveredRow(t.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                    background: isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                    transition: 'background 0.12s',
                  }}
                >
                  {/* VERGİ NO */}
                  <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'rgba(250,250,249,0.5)', letterSpacing: '0.04em' }}>
                      {taxpayerTaxNumber(t)}
                    </span>
                  </td>

                  {/* FİRMA / AD */}
                  <td style={{ padding: '13px 12px', maxWidth: 360 }}>
                    <button
                      type="button"
                      onClick={() => onSelectTaxpayer(t.id)}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        textAlign: 'left', display: 'block', width: '100%',
                      }}
                    >
                      <span style={{
                        display: 'block', fontSize: 14, fontWeight: 600,
                        color: '#fafaf9', lineHeight: 1.3,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {taxpayerName(t)}
                      </span>
                    </button>
                  </td>

                  {/* TİP */}
                  <td style={{ padding: '13px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                      fontSize: 11.5, fontWeight: 600,
                      color: tipStyle.color, background: tipStyle.bg,
                    }}>
                      {tip}
                    </span>
                  </td>

                  {/* DEFTER */}
                  <td style={{ padding: '13px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                      fontSize: 11.5, fontWeight: 600,
                      color: defterStyle.color, background: defterStyle.bg,
                    }}>
                      {defter}
                    </span>
                  </td>

                  {/* HIZLI İŞLEMLER */}
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      {ACTIONS.map((a) => {
                        const Icon = a.icon;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            title={`${a.label} — ${a.desc}`}
                            onClick={() => setActiveDialog({ action: a.id, taxpayer: t })}
                            style={{
                              width: 32, height: 32, borderRadius: 8,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: a.bg,
                              border: `1px solid ${a.color}30`,
                              color: a.color,
                              cursor: 'pointer',
                              transition: 'transform 0.1s, filter 0.1s',
                              flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'scale(1.12)';
                              e.currentTarget.style.filter = 'brightness(1.2)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'scale(1)';
                              e.currentTarget.style.filter = 'brightness(1)';
                            }}
                          >
                            <Icon size={15} strokeWidth={1.9} />
                          </button>
                        );
                      })}

                      {/* Detay ok */}
                      <button
                        type="button"
                        onClick={() => onSelectTaxpayer(t.id)}
                        title="Detaya git"
                        style={{
                          width: 32, height: 32, borderRadius: 8, marginLeft: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: 'rgba(250,250,249,0.4)',
                          cursor: 'pointer',
                          transition: 'color 0.1s, border-color 0.1s',
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = '#fafaf9';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'rgba(250,250,249,0.4)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                        }}
                      >
                        <ChevronRight size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dialog'lar */}
      {activeDialog?.action === 'entegrator' && (
        <EntegratorDialog
          taxpayer={activeDialog.taxpayer}
          onClose={() => { setActiveDialog(null); onRefresh(); }}
        />
      )}
      {activeDialog?.action === 'yukle' && (
        <UploadDialog
          taxpayer={activeDialog.taxpayer}
          period={period}
          onClose={() => { setActiveDialog(null); onRefresh(); }}
        />
      )}
      {activeDialog?.action === 'gib' && (
        <GibPortalDialog
          taxpayer={activeDialog.taxpayer}
          onClose={() => { setActiveDialog(null); onRefresh(); }}
        />
      )}
      {activeDialog?.action === 'hesap' && (
        <HesapPlaniDialog
          taxpayer={activeDialog.taxpayer}
          onClose={() => { setActiveDialog(null); onRefresh(); }}
        />
      )}
      {activeDialog?.action === 'ayar' && (
        <MukellefAyarDialog
          taxpayer={activeDialog.taxpayer}
          onClose={() => { setActiveDialog(null); onRefresh(); }}
        />
      )}
    </div>
  );
}
