'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mizanApi, bilancoApi, fmtTRY } from '@/lib/mizan';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Search, X, ChevronDown, Users, Calendar, Sparkles, Loader2,
  Trash2, Eye, Zap, Scale, CheckCircle2, XCircle, Download, Lock, Unlock,
} from 'lucide-react';

const GOLD = '#d4b876';

type Taxpayer = { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; };
function taxpayerName(t: Taxpayer): string {
  return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '(isim yok)';
}

export default function BilancoPage() {
  const qc = useQueryClient();
  const [taxpayerId, setTaxpayerId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedMizan, setSelectedMizan] = useState('');
  const [viewBilanco, setViewBilanco] = useState<any>(null);

  const { data: taxpayers = [] } = useQuery<Taxpayer[]>({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });
  const selectedTp = taxpayers.find((t) => t.id === taxpayerId);

  const { data: mizanList = [] } = useQuery<any[]>({
    queryKey: ['mizan-list', taxpayerId],
    queryFn: () => mizanApi.list(taxpayerId || undefined),
    enabled: !!taxpayerId,
  });

  const { data: bilancoList = [] } = useQuery<any[]>({
    queryKey: ['bilanco-list', taxpayerId],
    queryFn: () => bilancoApi.list(taxpayerId || undefined),
  });

  const latest = viewBilanco || bilancoList[0];

  // İlk render'da latest yoksa detayı çek
  const { data: latestFull } = useQuery<any>({
    queryKey: ['bilanco', latest?.id],
    queryFn: () => bilancoApi.get(latest.id),
    enabled: !!latest?.id,
  });

  const generateMut = useMutation({
    mutationFn: () => bilancoApi.generate({ mizanId: selectedMizan }),
    onSuccess: () => {
      toast.success('Bilanço oluşturuldu');
      qc.invalidateQueries({ queryKey: ['bilanco-list'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Oluşturulamadı'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => bilancoApi.remove(id),
    onSuccess: () => {
      toast.success('Bilanço silindi');
      qc.invalidateQueries({ queryKey: ['bilanco-list'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Silinemedi'),
  });

  const lockMut = useMutation({
    mutationFn: (args: { id: string; note?: string }) => bilancoApi.lock(args.id, args.note),
    onSuccess: () => { toast.success('Bilanço kesin kayıt'); qc.invalidateQueries({ queryKey: ['bilanco-list'] }); qc.invalidateQueries({ queryKey: ['bilanco'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kilitlenemedi'),
  });
  const unlockMut = useMutation({
    mutationFn: (args: { id: string; reason: string }) => bilancoApi.unlock(args.id, args.reason),
    onSuccess: () => { toast.success('Kilit açıldı'); qc.invalidateQueries({ queryKey: ['bilanco-list'] }); qc.invalidateQueries({ queryKey: ['bilanco'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Açılamadı'),
  });

  // Manuel düzeltme — 590 Dönem Net Kârı / 591 Dönem Net Zararı
  const [manuelKar, setManuelKar] = useState('');
  const [manuelZarar, setManuelZarar] = useState('');
  const duzeltmelerMut = useMutation({
    mutationFn: (args: { id: string; donemNetKari: number; donemNetZarari: number }) =>
      bilancoApi.updateDuzeltmeler(args.id, {
        donemNetKari: args.donemNetKari,
        donemNetZarari: args.donemNetZarari,
      }),
    onSuccess: () => {
      toast.success('Manuel düzeltme kaydedildi');
      qc.invalidateQueries({ queryKey: ['bilanco'] });
      qc.invalidateQueries({ queryKey: ['bilanco-list'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Kaydedilemedi'),
  });
  const parseLocale = (s: string): number => {
    const c = s.trim();
    if (!c) return 0;
    const n = parseFloat(c.replace(/\./g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  const handleLock = (id: string) => {
    const note = prompt('Kesin kayıt notu (opsiyonel — beyanname no vb.):') || '';
    if (!confirm('Bilanço kesin kayıt olarak işaretlenecek. Sonra düzeltme yapılamaz. Devam?')) return;
    lockMut.mutate({ id, note });
  };
  const handleUnlock = (id: string) => {
    const reason = prompt('Kilidi açma sebebi (en az 5 karakter):') || '';
    if (reason.length < 5) return toast.error('En az 5 karakter gerekli');
    unlockMut.mutate({ id, reason });
  };

  const filteredTp = taxpayers.filter((t) =>
    taxpayerName(t).toLowerCase().includes(pickerSearch.toLowerCase()),
  );

  const bilanco = latestFull;
  const aktif = bilanco?.aktif || {};
  const pasif = bilanco?.pasif || {};
  const fark = bilanco ? Number(bilanco.aktifToplami) - Number(bilanco.pasifToplami) : 0;
  const denk = Math.abs(fark) < 0.01;

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[26px] h-px" style={{ background: GOLD }} />
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
            <Sparkles size={10} className="inline mr-1" /> Mali Rapor
          </span>
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
          Bilanço
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
          Aktif ve Pasif hesap kalemlerini mizandan otomatik türet. Geçmiş dönemlerle karşılaştırma.
        </p>
      </div>

      {/* Komut barı */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[260px]">
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Users size={11} className="inline mr-1" /> Mükellef
            </label>
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none flex items-center gap-2 text-left"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <span className="flex-1 truncate" style={{ color: selectedTp ? '#fafaf9' : 'rgba(250,250,249,0.45)' }}>
                {selectedTp ? taxpayerName(selectedTp) : 'Mükellef seç…'}
              </span>
              {selectedTp && (
                <span onClick={(e) => { e.stopPropagation(); setTaxpayerId(''); setSelectedMizan(''); }} className="p-0.5 rounded">
                  <X size={13} />
                </span>
              )}
              <ChevronDown size={14} />
            </button>
          </div>

          <div className="flex-1 min-w-[240px]">
            <label className="text-[11px] uppercase font-bold tracking-[.12em] block mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Calendar size={11} className="inline mr-1" /> Kaynak Mizan
            </label>
            <select
              value={selectedMizan}
              onChange={(e) => setSelectedMizan(e.target.value)}
              disabled={!taxpayerId || mizanList.length === 0}
              className="w-full px-3 py-2.5 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            >
              <option value="" style={{ background: '#0f0d0b' }}>
                {!taxpayerId ? 'Önce mükellef seçin' : mizanList.length === 0 ? 'Mizan yok' : '— Mizan seçin —'}
              </option>
              {mizanList.map((m: any) => (
                <option key={m.id} value={m.id} style={{ background: '#0f0d0b' }}>{m.donem} · {m.donemTipi}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { if (!selectedMizan) return toast.error('Mizan seçin'); generateMut.mutate(); }}
            disabled={generateMut.isPending || !selectedMizan}
            className="px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
          >
            {generateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Mizandan Oluştur
          </button>
        </div>
      </div>

      {/* KPI */}
      {bilanco && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Aktif Toplamı" val={fmtTRY(bilanco.aktifToplami)} color={GOLD} />
            <Kpi label="Pasif Toplamı" val={fmtTRY(bilanco.pasifToplami)} color={GOLD} />
            <Kpi label="Özkaynaklar" val={fmtTRY(bilanco.ozkaynaklar)} color="#22c55e" />
            <Kpi label={denk ? '✓ Bilanço Denk' : `Fark: ${fmtTRY(fark)}`} val={fmtTRY(Math.abs(fark))} color={denk ? '#22c55e' : '#f43f5e'} />
          </div>
          {/* Kesin Kayıt ribbon */}
          <div className="flex items-center justify-between rounded-xl p-3" style={{
            background: bilanco.locked ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${bilanco.locked ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.05)'}`,
          }}>
            {bilanco.locked ? (
              <div className="flex items-center gap-2">
                <Lock size={14} style={{ color: '#22c55e' }} />
                <span className="text-[13px] font-semibold" style={{ color: '#22c55e' }}>Kesin Kayıt</span>
                <span className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.65)' }}>
                  · {bilanco.lockedAt ? new Date(bilanco.lockedAt).toLocaleString('tr-TR') : ''}
                  {bilanco.lockNote && ` · ${bilanco.lockNote}`}
                </span>
              </div>
            ) : (
              <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
                Bilanço değişikliklere açık. Kesin kayıt için bilanço denk olmalı (fark = 0).
              </div>
            )}
            <button
              onClick={() => bilanco.locked ? handleUnlock(bilanco.id) : handleLock(bilanco.id)}
              disabled={lockMut.isPending || unlockMut.isPending || (!bilanco.locked && !denk)}
              title={!bilanco.locked && !denk ? 'Bilanço denk değil, önce eşitle' : ''}
              className="px-3 py-1.5 rounded-lg text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-40"
              style={{
                background: bilanco.locked ? 'rgba(244,63,94,0.12)' : 'rgba(184,160,111,0.15)',
                color: bilanco.locked ? '#f43f5e' : GOLD,
                border: `1px solid ${bilanco.locked ? 'rgba(244,63,94,0.3)' : 'rgba(184,160,111,0.35)'}`,
              }}
            >
              {bilanco.locked ? <><Unlock size={12} /> Kilidi Aç</> : <><Lock size={12} /> Kesin Kayıt</>}
            </button>
          </div>
        </>
      )}

      {/* Aktif / Pasif iki sütun */}
      {bilanco && (
        <>
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
            <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
            Bilanço · {bilanco.tarih ? new Date(bilanco.tarih).toLocaleDateString('tr-TR') : bilanco.donem}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BilancoColumn
              baslik="AKTİF (VARLIKLAR)"
              toplam={Number(bilanco.aktifToplami)}
              gruplar={[
                { label: `I — DÖNEN VARLIKLAR · ${fmtTRY(bilanco.donenVarliklar)}`, kalemler: [
                  aktif.hazirDegerler, aktif.menkulKiymetler, aktif.ticariAlacaklar,
                  aktif.digerAlacaklar, aktif.stoklar, aktif.yillaraYayInsaat,
                  aktif.gelecekAylaraGiderler, aktif.digerDonenVarliklar,
                ].filter(Boolean) },
                { label: `II — DURAN VARLIKLAR · ${fmtTRY(bilanco.duranVarliklar)}`, kalemler: [
                  aktif.uzunAlacaklar, aktif.digerUzunAlacaklar, aktif.maliDuran,
                  aktif.maddiDuran, aktif.maddiOlmayanDuran, aktif.ozelTukenmeye,
                  aktif.gelecekYillaraGiderler, aktif.digerDuranVarliklar,
                ].filter(Boolean) },
              ]}
            />
            <BilancoColumn
              baslik="PASİF (KAYNAKLAR)"
              toplam={Number(bilanco.pasifToplami)}
              gruplar={[
                { label: `III — KISA VADELİ YABANCI KAYNAKLAR · ${fmtTRY(bilanco.kvYabanciKaynak)}`, kalemler: [
                  pasif.kvMaliBorclar, pasif.kvTicariBorclar, pasif.kvDigerBorclar,
                  pasif.alinanAvanslar, pasif.yillaraYayInsaatKV, pasif.odenecekVergi,
                  pasif.kvBorcGiderKars, pasif.kvGelAylaraGelir, pasif.digerKVYK,
                ].filter(Boolean) },
                { label: `IV — UZUN VADELİ YABANCI KAYNAKLAR · ${fmtTRY(bilanco.uvYabanciKaynak)}`, kalemler: [
                  pasif.uvMaliBorclar, pasif.uvTicariBorclar, pasif.uvDigerBorclar,
                  pasif.uvAlinanAvanslar, pasif.uvBorcGiderKars, pasif.uvGelYillaraGelir, pasif.digerUVYK,
                ].filter(Boolean) },
                { label: `V — ÖZKAYNAKLAR · ${fmtTRY(bilanco.ozkaynaklar)}`, kalemler: [
                  pasif.odenmisSermaye, pasif.sermayeYedekleri, pasif.karYedekleri,
                  pasif.gecmisKarZarar, pasif.donemKarZarar,
                ].filter(Boolean) },
              ]}
            />
          </div>

          {/* Manuel Düzeltme — 590 / 591 (geçici vergi dönemlerinde) */}
          {(() => {
            const mevcutDuzeltme = (bilanco.detay as any)?.duzeltmeler || {};
            const mevcutKar = Number(mevcutDuzeltme.donemNetKari) || 0;
            const mevcutZarar = Number(mevcutDuzeltme.donemNetZarari) || 0;
            const manuelVar = mevcutKar > 0 || mevcutZarar > 0;
            const gelirBagli = bilanco.gelirTablosuBagli || null;
            const otomatikKaynak = bilanco.otomatikKaynak || null;
            const isGecici = /GECICI/i.test(String(bilanco.donemTipi || ''));
            const getirGelirTablosu = () => {
              if (!gelirBagli) return;
              setManuelKar(gelirBagli.onerilenKar > 0 ? String(gelirBagli.onerilenKar).replace('.', ',') : '');
              setManuelZarar(gelirBagli.onerilenZarar > 0 ? String(gelirBagli.onerilenZarar).replace('.', ',') : '');
            };
            return (
              <div
                className="rounded-lg px-3 py-2 flex items-center flex-wrap gap-2 text-[12px]"
                style={{
                  background: 'rgba(184,160,111,0.04)',
                  border: '1px solid rgba(184,160,111,0.18)',
                }}
              >
                {/* Başlık + rozetler */}
                <div className="flex items-center gap-1.5">
                  <Scale size={12} style={{ color: GOLD }} />
                  <strong className="text-[12px]" style={{ color: GOLD }}>59 Net Kâr/Zarar</strong>
                  {isGecici && (
                    <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded" style={{ background: 'rgba(184,160,111,0.15)', color: GOLD, letterSpacing: '.06em' }}>
                      GEÇ.VERGİ
                    </span>
                  )}
                  {otomatikKaynak && !manuelVar && (
                    <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded flex items-center gap-0.5" style={{ background: 'rgba(34,197,94,0.14)', color: '#22c55e' }}>
                      <CheckCircle2 size={9} /> OTOMATİK
                    </span>
                  )}
                  {manuelVar && (
                    <span className="text-[9.5px] font-bold px-1.5 py-[1px] rounded" style={{ background: 'rgba(184,160,111,0.15)', color: GOLD }}>MANUEL</span>
                  )}
                </div>

                {/* Gelir tablosu link — inline */}
                {gelirBagli && (
                  <>
                    <span className="text-[11.5px] font-mono font-bold flex items-center gap-1" style={{ color: gelirBagli.donemNetKari >= 0 ? '#22c55e' : '#f43f5e' }}>
                      <Zap size={10} />
                      {gelirBagli.donemNetKari >= 0 ? 'Kâr' : 'Zarar'}: {fmtTRY(Math.abs(gelirBagli.donemNetKari))}
                    </span>
                    <button
                      onClick={getirGelirTablosu}
                      disabled={bilanco.locked}
                      className="px-2 py-0.5 rounded text-[10.5px] font-semibold"
                      style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
                    >
                      ↓ Getir
                    </button>
                  </>
                )}

                {/* Ayraç */}
                <span className="flex-1 min-w-[8px]" />

                {/* 590 input */}
                <label className="flex items-center gap-1">
                  <span className="text-[9.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.5)' }}>590</span>
                  <input
                    type="text"
                    placeholder={mevcutKar > 0 ? fmtTRY(mevcutKar) : (gelirBagli?.onerilenKar > 0 ? fmtTRY(gelirBagli.onerilenKar) : '0,00')}
                    value={manuelKar}
                    onChange={(e) => setManuelKar(e.target.value)}
                    disabled={bilanco.locked || duzeltmelerMut.isPending}
                    className="w-28 px-2 py-1 rounded text-[12px] border outline-none font-mono text-right"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(34,197,94,0.25)', color: '#22c55e' }}
                  />
                </label>

                {/* 591 input */}
                <label className="flex items-center gap-1">
                  <span className="text-[9.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.5)' }}>591</span>
                  <input
                    type="text"
                    placeholder={mevcutZarar > 0 ? fmtTRY(mevcutZarar) : (gelirBagli?.onerilenZarar > 0 ? fmtTRY(gelirBagli.onerilenZarar) : '0,00')}
                    value={manuelZarar}
                    onChange={(e) => setManuelZarar(e.target.value)}
                    disabled={bilanco.locked || duzeltmelerMut.isPending}
                    className="w-28 px-2 py-1 rounded text-[12px] border outline-none font-mono text-right"
                    style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(244,63,94,0.25)', color: '#f43f5e' }}
                  />
                </label>

                {/* Kaydet — kompakt buton */}
                <button
                  onClick={() => duzeltmelerMut.mutate({
                    id: bilanco.id,
                    donemNetKari: parseLocale(manuelKar),
                    donemNetZarari: parseLocale(manuelZarar),
                  })}
                  disabled={bilanco.locked || duzeltmelerMut.isPending}
                  className="px-3 py-1 rounded text-[11.5px] font-semibold"
                  style={{ background: GOLD, color: '#0a0906', opacity: bilanco.locked ? 0.5 : 1 }}
                  title="Kaydet & Yeniden Hesapla"
                >
                  {duzeltmelerMut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Kaydet'}
                </button>
              </div>
            );
          })()}

          {/* Denklik */}
          <div
            className="rounded-xl p-4 flex items-center justify-between"
            style={{
              background: denk ? 'rgba(34,197,94,0.06)' : 'rgba(244,63,94,0.06)',
              border: `1px solid ${denk ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)'}`,
            }}
          >
            <div className="flex items-center gap-2 text-[13px]">
              {denk ? <CheckCircle2 size={16} style={{ color: '#22c55e' }} /> : <XCircle size={16} style={{ color: '#f43f5e' }} />}
              <strong style={{ color: denk ? '#22c55e' : '#f43f5e' }}>{denk ? 'Bilanço Denk' : 'Bilanço Denk Değil'}</strong>
              <span style={{ color: 'rgba(250,250,249,0.65)' }}>
                · Aktif ({fmtTRY(bilanco.aktifToplami)}) = Pasif ({fmtTRY(bilanco.pasifToplami)})
              </span>
            </div>
            <span className="font-mono font-bold" style={{ color: denk ? '#22c55e' : '#f43f5e' }}>
              Fark: {fmtTRY(fark)}
            </span>
          </div>

          {/* ─── Finansal Oranlar ve Yorumlama ───────────────────── */}
          {bilanco.finansalOranlar && (
            <div>
              <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5 flex-wrap" style={{ color: '#fafaf9' }}>
                <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
                Finansal Oranlar
                {bilanco.oncekiDonemBilgi && (
                  <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa' }}>
                    Önceki: {bilanco.oncekiDonemBilgi.donem}
                  </span>
                )}
                {bilanco.finansalOzet && (
                  <span className="text-[11.5px] italic ml-auto" style={{ color: 'rgba(250,250,249,0.65)' }}>
                    {bilanco.finansalOzet}
                  </span>
                )}
              </h3>

              {/* 3 kategori × N kart */}
              {(() => {
                const kategoriler: Array<{ baslik: string; kod: 'likidite' | 'maliYapi' | 'karlilik'; renk: string }> = [
                  { baslik: 'Likidite', kod: 'likidite', renk: '#60a5fa' },
                  { baslik: 'Mali Yapı', kod: 'maliYapi', renk: GOLD },
                  { baslik: 'Kârlılık', kod: 'karlilik', renk: '#22c55e' },
                ];
                const yorumRenk = (y: string) => {
                  if (y.startsWith('✓')) return '#22c55e';
                  if (y.startsWith('⚠')) return '#f59e0b';
                  if (y.startsWith('✗')) return '#f43f5e';
                  return 'rgba(250,250,249,0.6)';
                };
                const trendIcon = (t: string | undefined) =>
                  t === 'up' ? '↑' : t === 'down' ? '↓' : t === 'flat' ? '→' : '';
                const trendRenk = (t: string | undefined, kod: string) => {
                  if (!t || t === 'flat') return 'rgba(250,250,249,0.4)';
                  // Kaldıraç ve borç/özk artması kötüdür — ters yorum
                  const tersMetrikler = ['kaldirac', 'borcOzk'];
                  if (tersMetrikler.includes(kod)) {
                    return t === 'up' ? '#f43f5e' : '#22c55e';
                  }
                  return t === 'up' ? '#22c55e' : '#f43f5e';
                };
                return (
                  <div className="space-y-4">
                    {kategoriler.map((kat) => {
                      const oranlar = (bilanco.finansalOranlar as any)[kat.kod] || [];
                      if (oranlar.length === 0) return null;
                      return (
                        <div key={kat.kod}>
                          <div className="text-[11px] uppercase font-bold tracking-[.2em] mb-2 flex items-center gap-2" style={{ color: kat.renk }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: kat.renk }} />
                            {kat.baslik}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {oranlar.map((o: any) => (
                              <div
                                key={o.kod}
                                className="rounded-xl p-4"
                                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[11px] uppercase font-bold tracking-[.1em]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                                    {o.ad}
                                  </span>
                                  <span className="text-[10px] font-mono" style={{ color: 'rgba(250,250,249,0.35)' }}>
                                    ideal {o.ideal}
                                  </span>
                                </div>
                                <div className="flex items-baseline justify-between mt-2">
                                  <span className="font-mono tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 700, color: kat.renk }}>
                                    {o.degerFmt}
                                  </span>
                                  {o.trend && (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[13px] font-bold" style={{ color: trendRenk(o.trend, o.kod) }}>
                                        {trendIcon(o.trend)}
                                      </span>
                                      <span className="text-[11px] font-mono" style={{ color: trendRenk(o.trend, o.kod) }}>
                                        {o.degisimYuzde > 0 ? '+' : ''}{o.degisimYuzde?.toFixed(1)}%
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {o.oncekiFmt && (
                                  <div className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                                    Önceki: {o.oncekiFmt}
                                  </div>
                                )}
                                <div className="text-[11.5px] mt-2 font-semibold" style={{ color: yorumRenk(o.yorum) }}>
                                  {o.yorum}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* Geçmiş Bilançolar */}
      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}>
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          Kayıtlı Bilançolar
          <span className="text-[10.5px] font-medium px-2 py-[2px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD }}>
            {bilancoList.length}
          </span>
        </h3>
        {bilancoList.length === 0 ? (
          <div className="rounded-xl py-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <Scale size={24} style={{ color: 'rgba(250,250,249,0.3)', margin: '0 auto 8px' }} />
            <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Henüz kayıtlı bilanço yok</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Oluşturma</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Mükellef</th>
                  <th className="px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Dönem</th>
                  <th className="px-4 py-3 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Aktif</th>
                  <th className="px-4 py-3 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>Özkaynak</th>
                  <th className="px-4 py-3 text-right text-[10.5px] font-bold uppercase tracking-[.08em]" style={{ color: 'rgba(250,250,249,0.45)' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {bilancoList.map((b: any, idx: number) => {
                  const dk = Math.abs(Number(b.aktifToplami) - Number(b.pasifToplami)) < 0.01;
                  return (
                    <tr key={b.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                      <td className="px-4 py-3 font-mono text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>{new Date(b.createdAt).toLocaleDateString('tr-TR')}</td>
                      <td className="px-4 py-3 font-medium">
                        {b.locked && <Lock size={11} style={{ color: '#22c55e', display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />}
                        {b.taxpayer ? taxpayerName(b.taxpayer) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {b.tarih ? new Date(b.tarih).toLocaleDateString('tr-TR') : b.donem}
                        {b.locked && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>KESİN</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono" style={{ color: dk ? GOLD : '#f43f5e', fontWeight: 600 }}>{fmtTRY(b.aktifToplami)}</td>
                      <td className="px-4 py-3 text-right font-mono" style={{ color: '#22c55e', fontWeight: 600 }}>{fmtTRY(b.ozkaynaklar)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          <button onClick={() => setViewBilanco(b)} className="p-1.5 rounded-md" style={{ color: GOLD, background: 'rgba(184,160,111,0.08)' }}>
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => { if (b.locked) return toast.error('Kesin kayıtlı silinemez'); if (confirm('Silinsin mi?')) deleteMut.mutate(b.id); }}
                            disabled={b.locked}
                            className="p-1.5 rounded-md disabled:opacity-30"
                            style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.08)' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mükellef Picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)' }} onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border flex flex-col overflow-hidden" style={{ background: 'rgba(17,14,12,0.98)', borderColor: 'rgba(255,255,255,0.05)', maxHeight: '84vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <h3 className="text-lg font-bold" style={{ color: '#fafaf9' }}>Mükellef Seç</h3>
              <button onClick={() => setPickerOpen(false)}><X size={16} /></button>
            </div>
            <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.05)' }}>
                <Search size={14} /><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Ara…" autoFocus className="flex-1 bg-transparent outline-none text-sm" style={{ color: '#fafaf9' }} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredTp.map((t) => (
                <button key={t.id} onClick={() => { setTaxpayerId(t.id); setPickerOpen(false); setPickerSearch(''); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg text-left" style={{ color: '#fafaf9', background: taxpayerId === t.id ? 'rgba(184,160,111,.08)' : 'transparent' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(255,255,255,0.05)' }}>{taxpayerName(t).charAt(0)}</div>
                  <span className="flex-1 truncate font-medium">{taxpayerName(t)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, val, color }: { label: string; val: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="text-[11px] font-bold uppercase tracking-[.1em] mb-2" style={{ color: 'rgba(250,250,249,0.5)' }}>{label}</div>
      <p className="leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color }}>{val}</p>
    </div>
  );
}

function BilancoColumn({
  baslik,
  toplam,
  gruplar,
}: {
  baslik: string;
  toplam: number;
  gruplar: Array<{ label: string; kalemler: Array<{ grup: string; toplam: number; hesaplar: Array<{ kod: string; ad: string; tutar: number }> }> }>;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <h4 style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600, color: GOLD, margin: 0, letterSpacing: '-0.01em' }}>{baslik}</h4>
        <div className="font-mono font-bold tabular-nums">{fmtTRY(toplam)}</div>
      </div>
      <div>
        {gruplar.map((g, gi) => (
          <div key={gi}>
            <div className="px-5 py-3 text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: GOLD, background: 'rgba(184,160,111,0.04)' }}>
              {g.label}
            </div>
            {g.kalemler.filter((k: any) => k && k.toplam !== 0).map((k: any, ki: number) => (
              <React.Fragment key={ki}>
                <div className="px-5 py-2 grid grid-cols-[1fr_auto] gap-3 text-[13px] items-center" style={{ borderTop: '1px solid rgba(255,255,255,0.02)' }}>
                  <div>{k.grup}</div>
                  <div className="font-mono tabular-nums text-[12.5px]">{fmtTRY(k.toplam)}</div>
                </div>
                {k.hesaplar?.slice(0, 6).map((h: any, hi: number) => (
                  <div key={hi} className="px-5 py-1.5 pl-10 grid grid-cols-[1fr_auto] gap-3 text-[12px] items-center" style={{ color: 'rgba(250,250,249,0.65)' }}>
                    <div><span style={{ color: GOLD, fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, marginRight: 8 }}>{h.kod}</span>{h.ad}</div>
                    <div className="font-mono tabular-nums text-[11.5px]">{fmtTRY(h.tutar)}</div>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
