'use client';
import { useEffect, useState, useCallback } from 'react';
import { Cpu, Power, AlertTriangle, CheckCircle2, RefreshCw, ExternalLink, Download } from 'lucide-react';

type ExtStatus = {
  installed: boolean;
  count?: number;
  luca?: { tabs: number; running: boolean; version: string | null };
  mihsap?: { tabs: number; running: boolean; version: string | null };
  loading?: boolean;
  error?: string | null;
};

declare global {
  interface Window {
    __morenAutoAgent?: {
      installed: boolean;
      version: string;
      restartAll: () => Promise<any>;
      status: () => Promise<any>;
      ping: () => Promise<any>;
    };
  }
}

export default function AgentControlCard() {
  const [status, setStatus] = useState<ExtStatus>({ installed: false, loading: true });
  const [busy, setBusy] = useState(false);
  // v1.36.44: Backend'deki en güncel versiyon — yüklü versiyondan yeni ise banner çıkar.
  const [latest, setLatest] = useState<{ runtime?: string; extensionManifest?: string } | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.__morenAutoAgent) {
      setStatus({ installed: false, loading: false });
      return;
    }
    try {
      const s = await window.__morenAutoAgent.status();
      setStatus({
        installed: true,
        count: s.count,
        luca: s.luca,
        mihsap: s.mihsap,
        loading: false,
      });
    } catch (e: any) {
      setStatus({ installed: true, loading: false, error: String(e?.message || e) });
    }
  }, []);

  // Backend'in raporladığı en güncel versiyonu çek (5 dk'da bir yenile)
  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const r = await fetch('/api/v1/agent/version/latest');
        if (r.ok) setLatest(await r.json());
      } catch {}
    };
    fetchLatest();
    const t = setInterval(fetchLatest, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Bridge bazen sayfa yüklendikten ~200ms sonra hazır olur
    const t1 = setTimeout(refresh, 300);
    const t2 = setInterval(refresh, 5000);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [refresh]);

  const handleRestart = async () => {
    if (!window.__morenAutoAgent) return;
    setBusy(true);
    try {
      await window.__morenAutoAgent.restartAll();
      setTimeout(refresh, 1500);
    } catch (e: any) {
      console.error('Agent restart hata:', e);
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  };

  const handleOpenLuca = () => { window.location.href = '/panel/ajanlar/luca'; };
  const handleOpenMihsap = () => window.open('https://app.mihsap.com/', '_blank');

  if (status.loading) {
    return (
      <div style={cardStyle}>
        <div className="flex items-center gap-2 text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          <RefreshCw size={12} className="animate-spin" /> Extension kontrol ediliyor...
        </div>
      </div>
    );
  }

  if (!status.installed) {
    return (
      <div style={{ ...cardStyle, borderColor: 'rgba(245,158,11,0.25)' }}>
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center rounded-md w-9 h-9 shrink-0" style={{ background: 'rgba(245,158,11,0.12)', color: '#fcd34d' }}>
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-semibold mb-1" style={{ color: '#fafaf9' }}>Moren Auto-Agent yüklü değil</div>
            <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'rgba(250,250,249,0.6)' }}>
              Luca güvenlik kodlarını portal içinde yönetmek ve Mihsap'ı görünür sekmede çalıştırmak için Chrome extension'ını yükle:
            </p>
            <a
              href="/moren-auto-agent.zip"
              download="moren-auto-agent.zip"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12.5px] font-semibold mb-3 transition-all"
              style={{ background: '#d4b876', color: '#0c0a09' }}
            >
              <Download size={13} /> Extension İndir (.zip)
            </a>
            <ol className="text-[12px] mb-1 space-y-1 list-decimal list-inside" style={{ color: 'rgba(250,250,249,0.55)' }}>
              <li>İndirilen <code style={codeStyle}>moren-auto-agent.zip</code> dosyasını <strong style={{ color: '#fafaf9' }}>masaüstü</strong>na çıkart</li>
              <li><code style={codeStyle}>chrome://extensions/</code> aç</li>
              <li>Sağ üstten <strong style={{ color: '#fafaf9' }}>Geliştirici modu</strong> aç</li>
              <li><strong style={{ color: '#fafaf9' }}>Paketlenmemiş yükle</strong> → çıkartılan klasörü seç</li>
              <li>Bu sayfayı yenile</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  const lucaOk = status.luca?.running;
  const mihsapOk = status.mihsap?.running;
  const lucaTabs = status.luca?.tabs || 0;
  const mihsapTabs = status.mihsap?.tabs || 0;

  // v1.36.44: Versiyon karşılaştırma — yüklü < latest ise güncelleme banner'ı göster
  const installedVersion = status.luca?.version || status.mihsap?.version || null;
  const latestRuntime = latest?.runtime && latest.runtime !== 'unknown' ? latest.runtime : null;
  const guncellemeVar = installedVersion && latestRuntime && installedVersion !== latestRuntime;

  return (
    <div style={cardStyle}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center rounded-md w-8 h-8" style={{ background: 'rgba(212,184,118,0.12)', color: '#d4b876' }}>
            <Cpu size={16} />
          </div>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>Otomatik Agent Kontrolü</div>
            <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>Moren Auto-Agent extension üzerinden</div>
          </div>
        </div>
        <button
          onClick={handleRestart}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all disabled:opacity-50"
          style={{ background: '#d4b876', color: '#0c0a09' }}
        >
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Power size={12} />}
          {busy ? 'Yeniden başlatılıyor...' : 'Hepsini Başlat'}
        </button>
      </div>

      {guncellemeVar && (
        <div
          className="mb-3 p-2.5 rounded-md flex items-center justify-between gap-3"
          style={{ background: 'rgba(212,184,118,0.10)', border: '1px solid rgba(212,184,118,0.35)' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} style={{ color: '#d4b876' }} />
            <div className="text-[12px]" style={{ color: '#fafaf9' }}>
              <div className="font-semibold">Yeni güncelleme var: <span style={{ color: '#d4b876' }}>v{latestRuntime}</span></div>
              <div className="text-[11px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                Yüklü: v{installedVersion} — Sayfayı yenile (Ctrl+F5). Hâlâ eski ise extension'ı zip'ten yeniden yükle.
              </div>
            </div>
          </div>
          <a
            href="/moren-auto-agent.zip"
            download="moren-auto-agent.zip"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11.5px] font-semibold transition-all"
            style={{ background: '#d4b876', color: '#0c0a09', whiteSpace: 'nowrap' }}
          >
            <Download size={12} /> Yeni .zip
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <StatusPill
          label="Luca"
          tabs={lucaTabs}
          running={!!lucaOk}
          version={status.luca?.version}
          onOpen={handleOpenLuca}
          openTitle="Luca Oturum Yöneticisi"
        />
        <StatusPill
          label="Mihsap"
          tabs={mihsapTabs}
          running={!!mihsapOk}
          version={status.mihsap?.version}
          onOpen={handleOpenMihsap}
          openTitle="Mihsap'ı aç"
        />
      </div>
      <div className="mt-3 pt-3 flex items-center justify-between text-[11px]" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.45)' }}>
        <span>Başka bilgisayara kurmak için:</span>
        <a
          href="/moren-auto-agent.zip"
          download="moren-auto-agent.zip"
          className="inline-flex items-center gap-1 px-2 py-1 rounded transition-all"
          style={{ background: 'rgba(212,184,118,0.12)', color: '#d4b876', border: '1px solid rgba(212,184,118,0.25)' }}
          title="Extension .zip dosyasını indir"
        >
          <Download size={11} /> Extension İndir (.zip)
        </a>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  tabs,
  running,
  version,
  onOpen,
  openTitle,
}: {
  label: string;
  tabs: number;
  running: boolean;
  version?: string | null;
  onOpen: () => void;
  openTitle: string;
}) {
  let badge: { bg: string; color: string; text: string };
  if (tabs === 0) {
    badge = { bg: 'rgba(168,162,158,0.12)', color: '#a8a29e', text: 'Sekme yok' };
  } else if (running) {
    badge = { bg: 'rgba(74,222,128,0.12)', color: '#4ade80', text: `Çalışıyor v${version || '?'}` };
  } else {
    badge = { bg: 'rgba(251,113,133,0.12)', color: '#fb7185', text: 'Ölü' };
  }
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2">
        {running ? (
          <CheckCircle2 size={14} style={{ color: '#4ade80' }} />
        ) : (
          <AlertTriangle size={14} style={{ color: tabs === 0 ? '#a8a29e' : '#fb7185' }} />
        )}
        <span className="text-[12.5px] font-medium" style={{ color: '#fafaf9' }}>{label}</span>
        {tabs > 1 && <span className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>({tabs} sekme)</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-semibold px-2 py-[2px] rounded" style={{ background: badge.bg, color: badge.color }}>
          {badge.text}
        </span>
        {tabs === 0 && (
          <button onClick={onOpen} className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-[2px] rounded" style={{ background: 'rgba(184,160,111,0.1)', color: '#d4b876', border: '1px solid rgba(184,160,111,0.25)' }} title={openTitle}>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: '14px 16px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(212,184,118,0.18)',
};

const codeStyle: React.CSSProperties = {
  background: 'rgba(184,160,111,0.10)',
  color: '#d4b876',
  padding: '1px 6px',
  borderRadius: 3,
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
};
