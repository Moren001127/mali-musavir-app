'use client';
import Link from 'next/link';
import { CheckCircle2, FileCheck, FileInput, FileText, Receipt, UploadCloud, Workflow } from 'lucide-react';
import './is-akisi-hatti.css';

/**
 * Bu Ay İş Akışı — SÜREÇ HATTI (2026-09-21 gece, Muzaffer Bey: "daha farklı bir tasarım").
 * Altı eşit kutucuk yerine: aşamalara dağılım çubuğu + tek çizgi üzerinde birbirine bağlı altı düğüm.
 * Veri ve bağlantılar aynı (`/taxpayers/workflow/queue` sayaçları, tıklayınca ilgili modül).
 * Görünüm yalnız CSS'te (`is-akisi-hatti.css`): koyu tema A varsayılan, beyaz tema D ezer.
 */

export type IsAkisiSayaclari = { evrak: number; yukleme: number; islenme: number; kontrol: number; beyanname: number; tamam: number };

const BOS: IsAkisiSayaclari = { evrak: 0, yukleme: 0, islenme: 0, kontrol: 0, beyanname: 0, tamam: 0 };

const ASAMALAR: Array<{ key: keyof IsAkisiSayaclari; label: string; sub: string; href: string; icon: any }> = [
  { key: 'evrak', label: 'Evrak Bekliyor', sub: 'Mükelleften gelecek', href: '/panel/is-yuku', icon: FileInput },
  { key: 'yukleme', label: 'Yükleme', sub: 'Sisteme yüklenecek', href: '/panel/kdv-kontrol', icon: UploadCloud },
  { key: 'islenme', label: 'Fatura İşleme', sub: 'Belge merkezi', href: '/panel/fatura-isleme', icon: Receipt },
  { key: 'kontrol', label: 'KDV Kontrol', sub: 'Kontrol bekliyor', href: '/panel/kdv-kontrol', icon: FileCheck },
  { key: 'beyanname', label: 'Beyanname', sub: 'Hazırlanacak', href: '/panel/beyannameler', icon: FileText },
  { key: 'tamam', label: 'Tamamlandı', sub: 'Bu ay kapandı', href: '/panel/is-yuku', icon: CheckCircle2 },
];

export function IsAkisiHatti({ counts, total, activeCount }: { counts?: IsAkisiSayaclari; total: number; activeCount: number }) {
  const c = counts || BOS;
  const akista = total || Object.values(c).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const aktifIs = c.islenme + c.kontrol + c.beyanname;
  const tamam = c.tamam;
  const disinda = Math.max(activeCount - akista, 0);
  const yuzde = (v: number) => (akista > 0 ? Math.round((v / akista) * 100) : 0);
  const dolu = ASAMALAR.filter((a) => (c[a.key] || 0) > 0);

  return (
    <section className="wf" data-workflow-panel aria-label="Bu ay iş akışı">
      <header className="wf-band">
        <span className="wf-band-icon" aria-hidden="true"><Workflow size={17} /></span>
        <div className="wf-band-text">
          <h3>Bu Ay İş Akışı</h3>
          <p>{akista} mükellef akışta · {activeCount} aktif mükellef</p>
        </div>
        <div className="wf-band-chips">
          <span className="wf-chip" data-tone="indigo">{aktifIs} aktif</span>
          <span className="wf-chip" data-tone="green">{tamam} tamam</span>
          {disinda > 0 && <span className="wf-chip" data-tone="slate">{disinda} dışında</span>}
        </div>
      </header>

      <div className="wf-body">
        {/* Aşamalara dağılım: tek çubuk, her aşama kendi renginde, genişlik mükellef sayısıyla orantılı */}
        <div className="wf-dist">
          <div className="wf-dist-head">
            <span className="wf-dist-title">Aşamalara dağılım</span>
            <span className="wf-dist-done"><b>%{yuzde(tamam)}</b> tamamlandı</span>
          </div>
          <div className="wf-dist-bar" data-empty={dolu.length === 0 ? 'true' : undefined} role="img" aria-label={ASAMALAR.map((a) => `${a.label} ${c[a.key] || 0}`).join(', ')}>
            {dolu.map((a) => (
              <span key={a.key} className="wf-dist-seg" data-stage={a.key} style={{ flexGrow: c[a.key] }} title={`${a.label}: ${c[a.key]} mükellef (%${yuzde(c[a.key])})`}>
                {yuzde(c[a.key]) >= 8 && <em>{c[a.key]}</em>}
              </span>
            ))}
          </div>
        </div>

        {/* Süreç hattı: düğümler tek çizgi üzerinde, soldan sağa akış */}
        <ol className="wf-rail">
          {ASAMALAR.map((a, i) => {
            const v = c[a.key] || 0;
            const Icon = a.icon;
            return (
              <li key={a.key} className="wf-step" data-stage={a.key} data-empty={v === 0 ? 'true' : undefined} data-last={i === ASAMALAR.length - 1 ? 'true' : undefined}>
                <Link href={a.href} className="wf-step-link" title={`${a.label} — ${a.sub}`}>
                  <span className="wf-node" aria-hidden="true"><Icon size={19} /></span>
                  <span className="wf-num">{v}</span>
                  <span className="wf-label">{a.label}</span>
                  <span className="wf-sub">{a.sub}</span>
                  <span className="wf-pct">%{yuzde(v)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
