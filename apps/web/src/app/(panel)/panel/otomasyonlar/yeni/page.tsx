'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  Wand2,
  Webhook,
  Zap,
  ChevronLeft,
  ShieldAlert,
  FileText,
} from 'lucide-react';
import { automationsApi, describeCron, describeEvent, type ParsedAutomation } from '@/lib/automations';

// ── Otomasyon modülü imza paleti (koyu zemin, mor imza) ──
const VIOLET = '#a855f7';
const VIOLET_SOFT = '#c084fc';
const GOLD = '#d4b876';
const BG = '#0f0d0b';
const CARD = '#15110d';
const CARD2 = '#1c1712';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const GREEN = '#4ade80';
const RED = '#f87171';
const AMBER = '#fbbf24';
const BLUE = '#60a5fa';

export default function YeniOtomasyonPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [parsed, setParsed] = useState<ParsedAutomation | null>(null);

  const parseMutation = useMutation({
    mutationFn: (p: string) => automationsApi.parse(p),
    onSuccess: (data) => {
      setParsed(data);
      if (data.steps.steps.length === 0) {
        toast.warning('Cümle anlaşıldı ama mevcut araçlarla yapılamayacak bir istek görüldü.');
      } else if (data.confidence < 0.6) {
        toast.warning('Önizlemeyi dikkatli kontrol et — güven puanı düşük.');
      } else {
        toast.success('Önizleme hazır');
      }
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Cümle parse edilemedi';
      toast.error(msg);
      setParsed(null);
    },
  });

  // activate=false ise DRAFT olarak bırakılır (düşük güvende önerilir).
  const createMutation = useMutation({
    mutationFn: async (activate: boolean) => {
      if (!parsed) throw new Error('Önizleme yok');
      const created = await automationsApi.create({
        prompt,
        title: parsed.title,
        description: parsed.description,
        triggerType: parsed.triggerType,
        triggerConfig: parsed.triggerConfig,
        steps: parsed.steps,
        estimatedCostPerRun: parsed.estimatedCostPerRun,
      });
      if (activate) {
        await automationsApi.setStatus(created.id, 'ACTIVE');
      }
      return { created, activate };
    },
    onSuccess: ({ created, activate }) => {
      toast.success(
        activate
          ? `"${created.title}" oluşturuldu ve aktif edildi`
          : `"${created.title}" taslak olarak kaydedildi`,
      );
      router.push(activate ? '/panel/otomasyonlar' : `/panel/otomasyonlar/${created.id}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Kaydetme başarısız');
    },
  });

  const EXAMPLES: Array<{ category: string; cumle: string; note?: string }> = [
    {
      category: 'Zamanlı',
      cumle:
        "Her Pazartesi sabah 9'da bu hafta beyanname tarihi yaklaşan müvekkillerin listesini hazırla ve bana bildirim gönder.",
    },
    {
      category: 'Zamanlı',
      cumle:
        "Her ayın 22'sinde KDV beyannamesi henüz verilmemiş müvekkillere WhatsApp şablonu at, listesini de bana e-posta gönder.",
    },
    {
      category: 'Zamanlı',
      cumle:
        "Her saat tahsilat riski yüksek müvekkellerin sayısını kontrol et, 5'i geçtiyse bana acil bildirim at.",
      note: 'Eşik takibi: cron + branch_if',
    },
    {
      category: 'Olay-tetikli',
      cumle:
        "Bir müvekkilin evrak geldi alanı işaretlenince bana bildirim at: 'X müvekkilinin evrakları teslim alındı.'",
    },
    {
      category: 'Olay-tetikli',
      cumle: "Yeni bir müvekkil eklendiğinde bana hoşgeldin bildirimi at ve müvekkele WhatsApp şablonu gönder.",
    },
    {
      category: 'Olay-tetikli',
      cumle: "Müvekkil portala belge yüklediğinde belgenin başlığıyla beraber bana bildirim at.",
    },
    {
      category: 'Karmaşık',
      cumle:
        "Her ayın 5'inde tüm aktif müvekkeller için: KDV durumunu kontrol et, eksikse müvekkele şablon mesaj gönder, eksik olanların listesini bana e-postala.",
      note: 'for_each + branch_if',
    },
  ];

  const grouped = EXAMPLES.reduce<Record<string, typeof EXAMPLES>>((acc, ex) => {
    (acc[ex.category] = acc[ex.category] || []).push(ex);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-16" style={{ color: TEXT }}>
      {/* ── Başlık ── */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: LINE,
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(168,85,247,0.18), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(212,184,118,0.14), transparent 46%), #0f0d0b',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'linear-gradient(90deg, #a855f7, #c084fc, #60a5fa, #4ade80, #d4b876)' }}
        />
        <button
          onClick={() => router.push('/panel/otomasyonlar')}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: MUTED }}
        >
          <ChevronLeft size={14} /> Otomasyonlarım
        </button>
        <h1 className="mt-2 flex items-center gap-2.5 text-[26px] font-semibold leading-tight">
          <span
            className="grid h-10 w-10 place-items-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', boxShadow: '0 6px 18px rgba(168,85,247,0.40)' }}
          >
            <Wand2 size={20} style={{ color: '#1a1410' }} />
          </span>
          Yeni Otomasyon
        </h1>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
          Otomatik yapılmasını istediğin işi Türkçe yaz. Moren AI cümleyi okuyup uygun otomasyonu
          kurar. Önizlemeyi inceleyip onayladığında çalışmaya başlar.
        </p>
      </header>

      {/* ── Yetenek kartı ── */}
      <details className="rounded-xl border p-3 text-[12px]" style={{ borderColor: LINE, background: CARD }}>
        <summary className="cursor-pointer font-medium" style={{ color: TEXT }}>
          Moren AI Otomasyon ne yapabilir, ne yapamaz?
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold" style={{ color: GREEN }}>YAPABİLİR</div>
            <ul className="space-y-1" style={{ color: MUTED }}>
              <li>• Mükellef / mizan / fatura / beyan verisi sorgular</li>
              <li>• In-app bildirim, e-posta, WhatsApp şablon mesajı gönderir</li>
              <li>• Fişi MIHSAP'tan çekip Word üretir, yazıcıya gönderir</li>
              <li>• Resmî Gazete'yi anahtar kelimeyle tarar, özetler</li>
              <li>• Zamanlı (her gün/hafta/ay) çalışır — Türkiye saatiyle</li>
              <li>• Olaylar: evrak değişimi, müvekkel kaydı, WA mesajı, belge yükleme, KDV kilidi</li>
              <li>• for_each / branch_if / parallel / wait / format_list akış kontrolü</li>
            </ul>
          </div>
          <div>
            <div className="mb-1 font-semibold" style={{ color: RED }}>YAPAMAZ (henüz)</div>
            <ul className="space-y-1" style={{ color: MUTED }}>
              <li>• Luca'ya doğrudan fiş atma</li>
              <li>• PDF/Resim OCR (belge metne çevirme)</li>
              <li>• SMS gönderme (sağlayıcı bağlı değil)</li>
              <li>• "Fatura oluşunca" / "WhatsApp'tan belge gelince" tetiklenme</li>
              <li>• Webhook ile dış sistemden tetiklenme (kapalı)</li>
              <li>• Allowlist dışı sitelerden veri çekme</li>
              <li>• Dakikadan kısa (saniye/gerçek zamanlı) çalışma</li>
            </ul>
          </div>
        </div>
        <div
          className="mt-3 rounded-lg border p-2"
          style={{ borderColor: `${AMBER}40`, background: `${AMBER}12`, color: TEXT }}
        >
          <strong style={{ color: AMBER }}>İpucu:</strong> Yapamayacağı bir şey istersen güven puanı 0
          ile "yapamıyorum" mesajı görürsün. Sistem sessizce yanlış otomasyon kurmaz.
        </div>
      </details>

      {/* ── Cümle girişi ── */}
      <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: CARD }}>
        <label className="mb-2 block text-[13px] font-medium" style={{ color: TEXT }}>
          Ne yapmasını istiyorsun?
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Örn: Her ayın 22'sinde KDV beyannamesi gecikenlere WhatsApp at…"
          className="min-h-[120px] w-full resize-y rounded-lg border p-3 font-mono text-[13px] outline-none"
          style={{ borderColor: LINE, background: CARD2, color: TEXT }}
          maxLength={2000}
          disabled={parseMutation.isPending}
        />
        <div className="mt-1 flex justify-between text-[11px]" style={{ color: MUTED }}>
          <span>{prompt.length} / 2000</span>
          <span>Daha açık yazarsan daha doğru kurar.</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => parseMutation.mutate(prompt)}
            disabled={prompt.trim().length < 5 || parseMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#1a1410' }}
          >
            {parseMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {parseMutation.isPending ? 'Cümle çevriliyor…' : 'Önizle'}
          </button>
          {parsed && (
            <button
              onClick={() => {
                setParsed(null);
                parseMutation.mutate(prompt);
              }}
              disabled={parseMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium"
              style={{ borderColor: LINE, color: TEXT }}
            >
              Yeniden Üret
            </button>
          )}
        </div>

        {/* Örnekler */}
        <details className="mt-5" open>
          <summary className="cursor-pointer text-[13px] font-medium" style={{ color: MUTED }}>
            Örnek cümleler (tıklayınca kullanılır)
          </summary>
          <div className="mt-3 space-y-4">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: VIOLET_SOFT }}>
                  {cat}
                </h4>
                <ul className="space-y-1.5">
                  {items.map((ex, i) => (
                    <li key={i}>
                      <button
                        onClick={() => setPrompt(ex.cumle)}
                        className="block w-full rounded-lg border p-3 text-left text-[12px] transition-colors"
                        style={{ borderColor: LINE, background: CARD2, color: TEXT }}
                      >
                        <div>{ex.cumle}</div>
                        {ex.note && (
                          <div className="mt-1 text-[10px] italic" style={{ color: MUTED }}>{ex.note}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* ── Önizleme ── */}
      {parsed && (
        <PreviewPanel
          parsed={parsed}
          confirming={createMutation.isPending}
          onConfirm={(activate) => createMutation.mutate(activate)}
        />
      )}
    </div>
  );
}

function PreviewPanel({
  parsed,
  onConfirm,
  confirming,
}: {
  parsed: ParsedAutomation;
  onConfirm: (activate: boolean) => void;
  confirming: boolean;
}) {
  const hasSteps = parsed.steps.steps.length > 0;
  const lowConfidence = parsed.confidence < 0.6;

  return (
    <section className="overflow-hidden rounded-2xl border-2" style={{ borderColor: `${VIOLET}66`, background: CARD }}>
      <div className="border-b px-5 py-4" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider" style={{ color: VIOLET_SOFT }}>
          <CheckCircle2 size={15} /> Önizleme
        </div>
        <h2 className="mt-1 text-[19px] font-semibold" style={{ color: TEXT }}>{parsed.title}</h2>
        {parsed.description && <p className="mt-1 text-[13px]" style={{ color: MUTED }}>{parsed.description}</p>}
      </div>

      <div className="space-y-4 px-5 py-5">
        {/* İnsan-okur açıklama */}
        <div
          className="rounded-lg border p-4 text-[13px] leading-relaxed"
          style={{ borderColor: `${VIOLET}33`, background: `${VIOLET}10`, color: TEXT }}
        >
          {parsed.humanReadablePreview}
        </div>

        {/* Tetik + maliyet */}
        <div className="grid grid-cols-2 gap-3">
          <Info
            icon={<TriggerIcon t={parsed.triggerType} />}
            label="Tetikleyici"
            value={triggerLabel(parsed.triggerType, parsed.triggerConfig)}
          />
          <Info
            icon={<Zap size={15} style={{ color: VIOLET_SOFT }} />}
            label="Tahmini maliyet"
            value={
              parsed.estimatedCostPerRun > 0
                ? `~$${parsed.estimatedCostPerRun.toFixed(3)} / çalışma`
                : 'Çalışma başına $0 (AI çağrısı yok)'
            }
          />
        </div>

        {/* Adımlar */}
        {hasSteps && (
          <div>
            <h3 className="mb-2 text-[13px] font-medium" style={{ color: TEXT }}>Adımlar</h3>
            <ol className="space-y-2 text-[12px]">
              {parsed.steps.steps.map((step: any, i: number) => (
                <StepItem key={step.id ?? i} step={step} depth={0} index={i + 1} />
              ))}
            </ol>
          </div>
        )}

        {/* Yapamıyorum */}
        {!hasSteps && (
          <div className="flex gap-2 rounded-lg border p-3 text-[13px]" style={{ borderColor: `${RED}55`, background: `${RED}14`, color: '#fecaca' }}>
            <AlertTriangle size={18} className="shrink-0" />
            <div>
              Bu cümleyi mevcut araçlarımla bir otomasyon olarak kuramadım. Açıklamaya bak; cümleyi daha
              açık ifade ederek tekrar dene.
            </div>
          </div>
        )}

        {/* Düşük güven */}
        {lowConfidence && hasSteps && (
          <div className="flex gap-2 rounded-lg border p-3 text-[13px]" style={{ borderColor: `${AMBER}55`, background: `${AMBER}14`, color: '#fde68a' }}>
            <AlertTriangle size={18} className="shrink-0" />
            <div>
              <b>Güven puanı düşük (%{Math.round(parsed.confidence * 100)}).</b> Cümlende bazı belirsizlikler
              var. Aşağıda <b>"Taslak Kaydet"</b> önerilir — önce Dry-Run ile dene, doğruysa aktif et.
            </div>
          </div>
        )}

        {/* Gizlilik */}
        {parsed.privacyNotice && (
          <div className="flex gap-2 rounded-lg border p-3 text-[13px]" style={{ borderColor: `${BLUE}55`, background: `${BLUE}14`, color: '#bfdbfe' }}>
            <ShieldAlert size={18} className="shrink-0" />
            <div>{parsed.privacyNotice}</div>
          </div>
        )}

        {/* Aksiyonlar */}
        {hasSteps && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: LINE }}>
            {lowConfidence ? (
              <>
                <button
                  onClick={() => onConfirm(false)}
                  disabled={confirming}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#1a1410' }}
                >
                  {confirming && <Loader2 size={16} className="animate-spin" />}
                  <FileText size={15} /> Taslak Kaydet
                </button>
                <button
                  onClick={() => onConfirm(true)}
                  disabled={confirming}
                  className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                  style={{ borderColor: LINE, color: TEXT }}
                >
                  Yine de Aktif Et
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onConfirm(true)}
                  disabled={confirming}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #a855f7, #c084fc)', color: '#1a1410' }}
                >
                  {confirming && <Loader2 size={16} className="animate-spin" />} Kur ve Aktif Et
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  disabled={confirming}
                  className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                  style={{ borderColor: LINE, color: TEXT }}
                >
                  <FileText size={15} /> Taslak Kaydet
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: LINE, background: CARD2 }}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[13px]" style={{ color: TEXT }}>{value}</div>
    </div>
  );
}

function StepItem({ step, depth, index }: { step: any; depth: number; index: number }) {
  const isFlow = ['for_each', 'branch_if', 'parallel', 'wait', 'format_list'].includes(step.tool);
  return (
    <li className="rounded-lg border p-3" style={{ borderColor: LINE, background: CARD2, marginLeft: depth * 14 }}>
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
          style={{ background: isFlow ? '#64748b' : VIOLET, color: '#1a1410' }}
        >
          {index}
        </span>
        <div className="flex-1">
          <code className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: '#0b0907', color: VIOLET_SOFT }}>
            {step.tool}
          </code>
          {step.outputAs && (
            <span className="ml-2 text-[11px]" style={{ color: MUTED }}>
              → <code style={{ color: TEXT }}>{step.outputAs}</code>
            </span>
          )}
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px]" style={{ color: MUTED }}>
            {JSON.stringify(step.args, null, 2)}
          </pre>
        </div>
      </div>
      {Array.isArray(step.steps) && step.steps.length > 0 && (
        <ol className="mt-2 space-y-1">
          {step.steps.map((s: any, i: number) => (
            <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
          ))}
        </ol>
      )}
      {Array.isArray(step.then) && step.then.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase" style={{ color: MUTED }}>then:</div>
          <ol className="space-y-1">
            {step.then.map((s: any, i: number) => (
              <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
            ))}
          </ol>
        </div>
      )}
      {Array.isArray(step.else) && step.else.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase" style={{ color: MUTED }}>else:</div>
          <ol className="space-y-1">
            {step.else.map((s: any, i: number) => (
              <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

function TriggerIcon({ t }: { t: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL' }) {
  if (t === 'CRON') return <Clock size={15} style={{ color: VIOLET_SOFT }} />;
  if (t === 'WEBHOOK') return <Webhook size={15} style={{ color: VIOLET_SOFT }} />;
  return <Sparkles size={15} style={{ color: VIOLET_SOFT }} />;
}

function triggerLabel(type: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL', cfg: Record<string, unknown>): string {
  if (type === 'CRON' && typeof cfg.cron === 'string') return `${describeCron(cfg.cron)} (${cfg.cron})`;
  if (type === 'EVENT' && typeof cfg.eventName === 'string') return describeEvent(cfg.eventName);
  if (type === 'WEBHOOK') return 'Webhook (dış HTTP isteği)';
  return 'Manuel (sadece tıkla)';
}
