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
} from 'lucide-react';
import { automationsApi, type ParsedAutomation } from '@/lib/automations';

const GOLD = '#d4b876';

/**
 * Yeni Otomasyon Oluşturma — Faz 2 UI.
 *
 * Akış:
 *  1. Kullanıcı textarea'ya Türkçe cümle yazar.
 *  2. "Önizle" → backend parser çalışır, ParsedAutomation döner.
 *  3. Önizleme paneli açılır: insan-okur açıklama + adımlar + uyarılar.
 *  4. "Kur ve Aktif Et" → POST /automations + PATCH /:id/status (ACTIVE).
 *  5. Liste sayfasına yönlen.
 */
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

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error('Önizleme yok');
      const created = await automationsApi.create({
        prompt,
        title: parsed.title,
        description: parsed.description,
        triggerType: parsed.triggerType,
        triggerConfig: parsed.triggerConfig,
        steps: parsed.steps,
      });
      // Hemen ACTIVE'e geçir
      await automationsApi.setStatus(created.id, 'ACTIVE');
      return created;
    },
    onSuccess: (created) => {
      toast.success(`"${created.title}" oluşturuldu ve aktif edildi`);
      router.push('/panel/otomasyonlar');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Kaydetme başarısız';
      toast.error(msg);
    },
  });

  const EXAMPLES: Array<{ category: string; cumle: string; note?: string }> = [
    // Zamanlı
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
      note: 'Eşik takibi: cron + branch_if pattern',
    },
    // Olay-tetikli
    {
      category: 'Olay-tetikli',
      cumle:
        "Bir müvekkilin evrak geldi alanı işaretlenince bana bildirim at: 'X müvekkilinin evrakları teslim alındı.'",
    },
    {
      category: 'Olay-tetikli',
      cumle:
        "Yeni bir müvekkil eklendiğinde bana hoşgeldin bildirimi at ve müvekkele WhatsApp şablonu gönder.",
    },
    {
      category: 'Olay-tetikli',
      cumle:
        "Müvekkil portala belge yüklediğinde belgenin başlığıyla beraber bana bildirim at.",
    },
    {
      category: 'Olay-tetikli',
      cumle:
        "Müvekkil WhatsApp'tan bana mesaj attığında mesaj içeriği ve müvekkel adıyla beraber bildirim oluştur.",
    },
    // Karmaşık
    {
      category: 'Karmaşık',
      cumle:
        "Her ayın 5'inde tüm aktif müvekkeller için: KDV durumunu kontrol et, eksikse müvekkele şablon mesaj gönder, eksik olanların listesini bana e-postala.",
      note: 'for_each + branch_if',
    },
    {
      category: 'Karmaşık',
      cumle:
        "Her gün sabah 8'de geciken müvekkelleri listele, 5'ten fazlaysa bana acil bildirim, az ise sadece e-posta at.",
      note: 'branch_if then/else',
    },
  ];

  const groupedExamples = EXAMPLES.reduce<Record<string, typeof EXAMPLES>>(
    (acc, ex) => {
      (acc[ex.category] = acc[ex.category] || []).push(ex);
      return acc;
    },
    {},
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Üst başlık */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-lg p-2 text-stone-500 dark:text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-200 dark:text-stone-200"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6" style={{ color: GOLD }} />
          <h1 className="text-2xl font-serif text-stone-800 dark:text-stone-100">Yeni Otomasyon</h1>
        </div>
      </div>

      <p className="mb-6 text-sm text-stone-600 dark:text-stone-300">
        Otomatik yapılmasını istediğin işi Türkçe yaz. Moren AI cümleyi okuyup uygun
        otomasyonu kuracak. Sen önizlemeyi inceleyip onayladığında çalışmaya başlar.
      </p>

      {/* Cümle textarea */}
      <div className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-sm">
        <label className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-200">
          Ne yapmasını istiyorsun?
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Örn: Her ayın 22'sinde KDV beyannamesi gecikenlere WhatsApp at..."
          className="min-h-[120px] w-full resize-y rounded-lg border border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 p-3 font-mono text-sm text-stone-800 dark:text-stone-100 outline-none focus:border-amber-400 focus:bg-white dark:focus:bg-stone-900 dark:bg-stone-900"
          maxLength={2000}
          disabled={parseMutation.isPending}
        />
        <div className="mt-1 flex justify-between text-xs text-stone-500 dark:text-stone-400 dark:text-stone-500">
          <span>{prompt.length} / 2000</span>
          <span>Daha açık yazarsan, daha doğru kurar.</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => parseMutation.mutate(prompt)}
            disabled={prompt.trim().length < 5 || parseMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition disabled:opacity-50"
            style={{ backgroundColor: GOLD }}
          >
            {parseMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {parseMutation.isPending ? 'Cümle çevriliyor…' : 'Önizle'}
          </button>
          {parsed && (
            <button
              onClick={() => {
                setParsed(null);
                parseMutation.mutate(prompt);
              }}
              disabled={parseMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-4 py-2 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 dark:bg-stone-800"
            >
              Yeniden Üret
            </button>
          )}
        </div>

        {/* Örnek cümleler — kategorize */}
        <details className="mt-5 group" open>
          <summary className="cursor-pointer text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-stone-800 dark:hover:text-stone-100">
            Örnek cümleler (tıklayınca kullanılır)
          </summary>
          <div className="mt-3 space-y-4">
            {Object.entries(groupedExamples).map(([category, items]) => (
              <div key={category}>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  {category}
                </h4>
                <ul className="space-y-1.5">
                  {items.map((ex, i) => (
                    <li key={i}>
                      <button
                        onClick={() => setPrompt(ex.cumle)}
                        className="block w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3 text-left text-xs text-stone-700 dark:text-stone-200 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      >
                        <div>{ex.cumle}</div>
                        {ex.note && (
                          <div className="mt-1 text-[10px] text-stone-500 dark:text-stone-400 italic">
                            {ex.note}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Önizleme paneli */}
      {parsed && <PreviewPanel parsed={parsed} onConfirm={() => createMutation.mutate()} confirming={createMutation.isPending} />}
    </div>
  );
}

function PreviewPanel({
  parsed,
  onConfirm,
  confirming,
}: {
  parsed: ParsedAutomation;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const hasSteps = parsed.steps.steps.length > 0;
  const lowConfidence = parsed.confidence < 0.6;

  return (
    <div className="mt-6 rounded-2xl border-2 bg-white dark:bg-stone-900 shadow-md" style={{ borderColor: GOLD }}>
      <div className="border-b border-stone-200 dark:border-stone-700 px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-stone-500 dark:text-stone-400 dark:text-stone-500">
          <CheckCircle2 className="h-4 w-4" style={{ color: GOLD }} />
          Önizleme
        </div>
        <h2 className="mt-1 text-xl font-serif text-stone-800 dark:text-stone-100">{parsed.title}</h2>
        {parsed.description && (
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{parsed.description}</p>
        )}
      </div>

      <div className="space-y-5 px-6 py-5">
        {/* İnsan-okur açıklama */}
        <div className="rounded-lg bg-amber-50 dark:bg-stone-800 p-4 text-sm leading-relaxed text-stone-800 dark:text-stone-100 border border-amber-200 dark:border-amber-900/40">
          {parsed.humanReadablePreview}
        </div>

        {/* Tetikleyici + maliyet */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoCard
            icon={<TriggerIcon t={parsed.triggerType} />}
            label="Tetikleyici"
            value={triggerLabel(parsed.triggerType, parsed.triggerConfig)}
          />
          <InfoCard
            icon={<Zap className="h-4 w-4" style={{ color: GOLD }} />}
            label="Tahmini maliyet"
            value={
              parsed.estimatedCostPerRun > 0
                ? `~$${parsed.estimatedCostPerRun.toFixed(3)} / çalışma`
                : 'Çalışma başına 0 USD (Claude çağrısı yok)'
            }
          />
        </div>

        {/* Adımlar */}
        {hasSteps && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-200">Adımlar</h3>
            <ol className="space-y-2 text-xs">
              {parsed.steps.steps.map((step: any, i: number) => (
                <StepItem key={step.id ?? i} step={step} depth={0} index={i + 1} />
              ))}
            </ol>
          </div>
        )}

        {/* Uyarılar */}
        {!hasSteps && (
          <div className="flex gap-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-800 dark:text-rose-200">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              Bu cümleyi mevcut araçlarımla bir otomasyon olarak kuramadım. Önizleme paneline
              yazılan açıklamaya bak; cümleyi daha açık ifade ederek tekrar dene.
            </div>
          </div>
        )}

        {lowConfidence && hasSteps && (
          <div className="flex gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <b>Güven puanı düşük ({Math.round(parsed.confidence * 100)}%).</b> Cümlende bazı
              belirsizlikler var. Önizlemeyi dikkatli oku — beklediğin gibi olmayan bir varsayım
              yapmış olabilirim.
            </div>
          </div>
        )}

        {parsed.privacyNotice && (
          <div className="flex gap-2 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-blue-900 dark:text-blue-200">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <div>{parsed.privacyNotice}</div>
          </div>
        )}

        {/* Aksiyon butonları */}
        {hasSteps && (
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 dark:border-stone-800 pt-4">
            <button
              onClick={onConfirm}
              disabled={confirming}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              style={{ backgroundColor: GOLD }}
            >
              {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
              Kur ve Aktif Et
            </button>
            <button
              disabled
              title="Faz 4 — gelecek sürüm"
              className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-4 py-2 text-sm text-stone-400 dark:text-stone-500"
            >
              Adımları Manuel Düzenle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 dark:text-stone-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm text-stone-800 dark:text-stone-100">{value}</div>
    </div>
  );
}

function StepItem({ step, depth, index }: { step: any; depth: number; index: number }) {
  const isFlow = ['for_each', 'branch_if', 'parallel', 'wait'].includes(step.tool);
  return (
    <li
      className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 p-3"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: isFlow ? '#94a3b8' : GOLD }}
        >
          {index}
        </span>
        <div className="flex-1">
          <code className="rounded bg-white dark:bg-stone-900 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:text-stone-200">
            {step.tool}
          </code>
          {step.outputAs && (
            <span className="ml-2 text-[11px] text-stone-500 dark:text-stone-400 dark:text-stone-500">
              → <code className="text-stone-700 dark:text-stone-200">{step.outputAs}</code>
            </span>
          )}
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-stone-600 dark:text-stone-300">
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
          <div className="text-[10px] uppercase text-stone-500 dark:text-stone-400 dark:text-stone-500">then:</div>
          <ol className="space-y-1">
            {step.then.map((s: any, i: number) => (
              <StepItem key={s.id ?? i} step={s} depth={depth + 1} index={i + 1} />
            ))}
          </ol>
        </div>
      )}
      {Array.isArray(step.else) && step.else.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase text-stone-500 dark:text-stone-400 dark:text-stone-500">else:</div>
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
  if (t === 'CRON') return <Clock className="h-4 w-4" style={{ color: GOLD }} />;
  if (t === 'WEBHOOK') return <Webhook className="h-4 w-4" style={{ color: GOLD }} />;
  return <Sparkles className="h-4 w-4" style={{ color: GOLD }} />;
}

function triggerLabel(
  type: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL',
  cfg: Record<string, unknown>,
): string {
  if (type === 'CRON' && typeof cfg.cron === 'string') return `Zamanlı (${cfg.cron})`;
  if (type === 'EVENT' && typeof cfg.eventName === 'string') return `Olay: ${cfg.eventName}`;
  if (type === 'WEBHOOK') return 'Webhook (dış HTTP isteği)';
  return 'Manuel (sadece tıkla)';
}
