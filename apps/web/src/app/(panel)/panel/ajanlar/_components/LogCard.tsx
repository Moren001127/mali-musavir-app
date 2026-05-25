'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { parseAgentMessage, buildFieldRows, FieldRow } from '@/lib/log-format';
import { LogFieldTable, LogSummary } from './LogFieldTable';

export interface LogEvent {
  id: string;
  ts: string;
  agent?: string;
  status: string;
  mukellef?: string;
  firma?: string;
  fisNo?: string;
  hesapKodu?: string;
  kdv?: string;
  tutar?: number | string;
  message?: string;
  action?: string;
  meta?: any;
}

export function statusStyle(status: string) {
  switch (status) {
    case 'onaylandi':
    case 'basarili':
    case 'ok':
      return { color: '#7aa07c', icon: '✓', label: 'ONAY', bg: 'rgba(60,120,70,.05)', border: '#4d7c4f' };
    case 'hata':
    case 'error':
      return { color: '#d97070', icon: '✗', label: 'HATA', bg: 'rgba(180,50,50,.07)', border: '#b04040' };
    case 'atlandi':
    case 'skip':
      return { color: '#b89870', icon: '↷', label: 'ATLA', bg: 'rgba(180,120,40,.05)', border: '#92744a' };
    case 'demirbas':
      return { color: '#a78bfa', icon: '⏩', label: 'DEMR', bg: 'rgba(168,85,247,.06)', border: '#8b6db5' };
    default:
      return { color: '#94a3b8', icon: '•', label: 'INFO', bg: 'rgba(148,163,184,.04)', border: '#6b6b6b' };
  }
}

function collectWarnings(event: LogEvent, rows: FieldRow[]) {
  const warnings: string[] = [];
  for (const row of rows) {
    if (row.status === 'warning') {
      warnings.push(`${row.label}: ${row.meta || 'kontrol gerekli'}`);
    }
  }

  const onaylandi = ['onaylandi', 'basarili', 'ok'].includes(String(event.status || '').toLowerCase());
  const missingCritical = rows.filter((row) =>
    row.status === 'missing' && /^(Tarih|Matrah|KDV|Cari|Belge|Toplam Tutar|Onay)/i.test(row.label),
  );
  if (onaylandi && missingCritical.length > 0) {
    warnings.push(`Onayli kayitta eksik alan: ${missingCritical.map((r) => r.label).join(', ')}`);
  }

  const trace = event.meta?.decisionTrace;
  const traceReason = trace?.karar?.sebep || event.meta?.sebep;
  if (traceReason && /uyusma|fark|eksik|bos|emin|sapma|risk/i.test(String(traceReason))) {
    warnings.push(String(traceReason).slice(0, 120));
  }

  return [...new Set(warnings)];
}

function DecisionTraceBox({ trace }: { trace: any }) {
  const belge = trace?.belge || {};
  const ekran = trace?.ekran || {};
  const karar = trace?.karar || {};
  const hesapSayisi = Array.isArray(ekran?.hesapKodlari) ? ekran.hesapKodlari.length : null;
  const parts = [
    belge?.belgeNo ? `Belge ${belge.belgeNo}` : null,
    belge?.kdvOrani ? `KDV ${belge.kdvOrani}` : null,
    belge?.ocrToplam ? `OCR ${belge.ocrToplam}` : null,
    ekran?.tutar ? `Mihsap ${ekran.tutar}` : null,
    hesapSayisi !== null ? `${hesapSayisi} kod` : null,
  ].filter(Boolean);

  return (
    <div
      className="mt-1.5 rounded px-2 py-1.5 text-[11px]"
      style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.04)', color: '#8f8f8f' }}
    >
      <span className="font-semibold" style={{ color: '#b8a06f' }}>Karar izi:</span>{' '}
      {parts.length > 0 ? parts.join(' | ') : 'detay yok'}
      {karar?.sebep && (
        <span style={{ color: '#b0b0b0' }}> | {String(karar.sebep).slice(0, 160)}</span>
      )}
    </div>
  );
}

function isModernAgentVersion(version: unknown) {
  const parts = String(version || '').split('.').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return false;
  const [major = 0, minor = 0, patch = 0] = parts;
  if (major > 1) return true;
  if (major < 1) return false;
  if (minor > 36) return true;
  if (minor < 36) return false;
  return patch >= 65;
}

export function LogCard({ event }: { event: LogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const d = new Date(event.ts);
  const t = d.toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' });
  const baseStyle = statusStyle(event.status);

  // Mesajı yapısal hale çevir
  const parsed = parseAgentMessage(event.message);
  const rows = buildFieldRows(event, parsed);
  const hasFields = rows.length > 0;
  const hasSummary = !!(parsed.sonuc || parsed.mihsapUyarisi || parsed.hata || parsed.rawLines.length);
  const warnings = collectWarnings(event, rows);
  const isSuccess = ['onaylandi', 'basarili', 'ok'].includes(String(event.status || '').toLowerCase());
  const agentVersionOk = isModernAgentVersion(event.meta?.agentVersion);
  const statusLower = String(event.status || '').toLowerCase();
  const needsAttention = warnings.length > 0 || ['atlandi', 'skip', 'hata', 'error'].includes(statusLower);
  const attentionText = parsed.sonuc?.text || parsed.hata || parsed.mihsapUyarisi || event.message || 'detay yok';
  const showSummary = hasSummary && !(needsAttention && !parsed.sonuc && !parsed.mihsapUyarisi && !parsed.hata);
  const visual = warnings.length > 0 && isSuccess
    ? { color: '#d4a94f', icon: '!', bg: 'rgba(180,120,40,.06)', label: 'UYARILI', border: '#a17835' }
    : baseStyle;
  const importantRows = rows.filter((row) =>
    ['Tarih', 'Belge No', 'Belge Türü', 'Belge TÃ¼rÃ¼', 'Matrah', 'KDV', 'Cari', 'Cari Hesab'].includes(row.label),
  );
  const missingCount = importantRows.filter((row) => row.status === 'missing').length;
  const warningCount = importantRows.filter((row) => row.status === 'warning' || row.status === 'empty-with-suggestion').length;

  return (
    <div
      className="px-3 py-2 rounded-lg transition-colors hover:brightness-110"
      style={{
        background: visual.bg,
        border: `1px solid ${visual.border}55`,
        borderLeft: `3px solid ${visual.border}`,
        boxShadow: '0 6px 18px rgba(0,0,0,0.14)',
      }}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span
          className="flex-shrink-0 inline-flex items-center justify-center rounded-md text-[10px] font-bold px-1.5 py-0.5 leading-none"
          style={{ background: visual.color + '2b', color: visual.color, minWidth: 52, height: 22 }}
        >
          {visual.icon} {visual.label}
        </span>
        <span className="text-[10.5px] tabular-nums flex-shrink-0 pt-1" style={{ color: '#6b6b6b' }}>
          {t}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap text-[12px] min-w-0">
          {event.firma && (
            <span className="font-semibold truncate max-w-[48ch]" style={{ color: '#b8a06f' }}>
              {event.firma}
            </span>
          )}
          {event.fisNo && (
            <span
              className="text-[10.5px] px-1.5 py-0.5 rounded tabular-nums leading-none"
              style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,0.55)' }}
            >
              #{event.fisNo}
            </span>
          )}
          {event.tutar != null && event.tutar !== '' && (
            <span
              className="text-[10.5px] px-1.5 py-0.5 rounded tabular-nums leading-none"
              style={{ background: 'rgba(255,255,255,.04)', color: 'rgba(250,250,249,0.55)' }}
            >
              {Number(event.tutar).toLocaleString('tr-TR')} TL
            </span>
          )}
            {missingCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded leading-none" style={{ background: 'rgba(214,95,95,0.12)', color: '#d97070' }}>
                {missingCount} eksik
              </span>
            )}
            {warningCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded leading-none" style={{ background: 'rgba(212,169,79,0.12)', color: '#d4a94f' }}>
                {warningCount} uyarı
              </span>
            )}
          </div>

          {(needsAttention || event.message) && (
            <div className="mt-1 truncate text-[11px]" style={{ color: needsAttention ? '#d8c18d' : '#8a8a8a' }}>
              {needsAttention && (
                <span className="font-semibold" style={{ color: visual.color }}>
                  {visual.label === 'ATLA' ? 'Atlama' : visual.label === 'HATA' ? 'Hata' : 'Not'}:{' '}
                </span>
              )}
              {needsAttention ? attentionText : event.message}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 h-6 w-6 rounded-md inline-flex items-center justify-center flex-shrink-0 transition-colors"
          style={{ color: 'rgba(250,250,249,0.42)', background: expanded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)' }}
          title={expanded ? 'Detayı kapat' : 'Detayı göster'}
          aria-label={expanded ? 'Detayı kapat' : 'Detayı göster'}
        >
          <ChevronDown
            size={14}
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 140ms ease' }}
          />
        </button>
      </div>

      {expanded && (
      <div className="mt-2 w-full min-w-0">

        {needsAttention && (
          <div
            className="rounded-md px-2 py-1.5 text-[11.5px]"
            style={{
              background: statusLower === 'skip' || statusLower === 'atlandi'
                ? 'rgba(184,152,112,0.10)'
                : 'rgba(212,169,79,0.10)',
              border: '1px solid rgba(212,169,79,0.18)',
              color: '#d8c18d',
            }}
          >
            <span className="font-semibold" style={{ color: visual.color }}>
              {visual.label === 'ATLA' ? 'Atlama sebebi' : visual.label === 'HATA' ? 'Hata sebebi' : 'Kontrol notu'}:
            </span>{' '}
            {attentionText}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5" style={{ color: '#d4a94f' }}>
            {warnings.slice(0, 4).map((w, i) => (
              <span
                key={`${w}-${i}`}
                className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(212,169,79,0.12)', border: '1px solid rgba(212,169,79,0.25)' }}
              >
                ! {w}
              </span>
            ))}
          </div>
        )}

        {hasFields && <LogFieldTable rows={rows} />}

        {event.meta?.decisionTrace && <DecisionTraceBox trace={event.meta.decisionTrace} />}
        {event.meta?.faturaDecisionCandidate?.onerilenler && (
          <DecisionTraceBox
            trace={{
              karar: {
                sebep: `Öneri: ${JSON.stringify(event.meta.faturaDecisionCandidate.onerilenler).slice(0, 180)}`,
              },
            }}
          />
        )}

        {showSummary && (
          <LogSummary
            sonuc={parsed.sonuc}
            mihsapUyarisi={parsed.mihsapUyarisi}
            hata={parsed.hata}
            rawLines={parsed.rawLines}
          />
        )}

        {/* Hiç structured veri yoksa düz mesaj göster (eski kayıtlar için) */}
        {!hasFields && !hasSummary && event.message && (
          <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a', lineHeight: '1.5' }}>
            {event.message}
          </div>
        )}

        {event.mukellef && (
          <div className="text-[10px] mt-1 truncate uppercase tracking-wide flex items-center gap-2" style={{ color: '#4a4a4a' }}>
            <span>{event.mukellef}</span>
            {/* Agent versiyonu — eski cache'den çalışan bookmarklet'i tespit etmek için.
                Beklenen sürüm v1.36.4. Daha eski görünüyorsa kullanıcı bookmarklet'i yenilemeli. */}
            {event.meta?.agentVersion && (
              <span
                className="text-[9px] px-1 rounded font-mono"
                title={
                  agentVersionOk
                    ? 'Agent güncel'
                    : `Agent eski sürüm (${event.meta.agentVersion}) — bookmarklet'i yenile, hard reload yap`
                }
                style={{
                  background:
                    agentVersionOk
                      ? 'rgba(34,197,94,0.10)'
                      : 'rgba(239,68,68,0.15)',
                  color:
                    agentVersionOk ? '#22c55e' : '#ef4444',
                }}
              >
                v{event.meta.agentVersion}
              </span>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
