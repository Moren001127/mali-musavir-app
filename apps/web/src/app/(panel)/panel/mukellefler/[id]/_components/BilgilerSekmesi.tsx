'use client';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileCheck, Lock, Phone, Settings2, Shield, Sparkles, UserCog, Workflow } from 'lucide-react';
import { MukellefiyetlerCard } from '@/components/mukellef/MukellefiyetlerCard';
import { TaxpayerPortalCredentialsCard } from '@/components/portal-automation/PortalCredentialCards';
import { portalAutomationApi, type PortalProvider } from '@/lib/portal-automation';
import { LINE, MUTED, R_ALAN, SELECT_CLS, TEXT, cleanTrPhone, formatTrPhone } from '../_lib/tema';
import { TAXPAYER_KIND_OPTIONS, applyTaxpayerKind, taxpayerKindFromForm, type DefterTuru, type FormState, type TaxpayerKind } from '../_lib/form';
import { AccordionRow } from './ortak/AccordionRow';
import { Field } from './ortak/Field';
import { FormCluster } from './ortak/FormCluster';
import { InputBase } from './ortak/InputBase';
import { SectionSaveButton } from './ortak/SectionSaveButton';
import { Segmented } from './ortak/Segmented';
import { ToggleRow } from './ortak/ToggleRow';
import { YetkililerSection } from './YetkililerBolumu';
import { OTOMATIK_SORGU_IKON, OTOMATIK_SORGU_RENK, OtomatikSorguAyari, otomatikSorguTanimli } from './OtomatikSorguAyari';

// ============================================================
// BİLGİLER SEKMESİ — tek katmanlı akordeon satırları
// ============================================================
type BilgiSectionId =
  | 'musteri'
  | 'mukellefiyet'
  | 'yetkili'
  | 'iletisim'
  | 'giris'
  | 'vergiSifre'
  | 'sgkSifre'
  | 'bagkur'
  | 'entegrator'
  | 'otomasyon'
  | 'otomatikSorgu'
  | 'sistem';

/** Etiket satırı (Segmented/Toggle gibi <label> ile sarılamayan alanlar için) — Field ile aynı görünüm. */
function Etiket({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[11.5px] font-medium" style={{ color: MUTED }}>{children}</span>;
}

export function BilgilerTab({
  form,
  setForm,
  taxpayerId,
  onSave,
  saving,
  otomatikSorgu,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  taxpayerId: string | null;
  onSave: () => void;
  saving: boolean;
  /** GET /taxpayers/:id → otomatikSorgu (null = varsayılan). Yeni kayıtta yok. */
  otomatikSorgu?: unknown;
}) {
  const { data: credentialData } = useQuery({
    queryKey: ['portal-automation-credentials'],
    queryFn: () => portalAutomationApi.credentials(),
    enabled: !!taxpayerId,
    staleTime: 30_000,
  });

  const credentialReady = (provider: Extract<PortalProvider, 'GIB_IVD' | 'SGK_EBILDIRGE'>) => {
    const rows = credentialData?.rows || [];
    return rows.some((credential) => {
      if (credential.provider !== provider || credential.taxpayerId !== taxpayerId || credential.isActive === false) return false;
      if (provider === 'SGK_EBILDIRGE') {
        return (
          !!String(credential.username || credential.userCode || '').trim() &&
          !!String(credential.workplaceCode || '').trim() &&
          !!credential.hasPassword &&
          !!credential.hasSecondaryPassword
        );
      }
      return !!String(credential.userCode || '').trim() && (!!credential.hasSecondaryPassword || !!credential.hasPassword);
    });
  };

  const hasGibCredential = credentialReady('GIB_IVD');
  const hasSgkCredential = credentialReady('SGK_EBILDIRGE');

  const sections: {
    id: BilgiSectionId;
    title: string;
    subtitle: string;
    icon: React.ElementType;
    show: boolean;
    filled: boolean;
    renk: string;
  }[] = [
    { id: 'musteri', title: 'Müşteri & Vergi Dairesi Bilgileri', subtitle: 'Ad, tip, VKN/TCKN, vergi dairesi, sicil ve adres', icon: Building2, show: true, filled: !!(form.companyName || form.firstName || form.taxNumber || form.taxOffice), renk: '#4f86c9' },
    { id: 'mukellefiyet', title: 'Mükellefiyet Bilgileri', subtitle: 'Vergi türleri ve dönemler', icon: FileCheck, show: !!taxpayerId, filled: !!taxpayerId, renk: '#5fcf8e' },
    { id: 'yetkili', title: 'Firma Yetkili Bilgileri', subtitle: 'Müdür, ortak, imza', icon: UserCog, show: !!taxpayerId, filled: false, renk: '#a78bfa' },
    { id: 'iletisim', title: 'İletişim Bilgileri', subtitle: 'Telefon, e-posta, KEP', icon: Phone, show: true, filled: form.phones.some(Boolean) || form.emails.some(Boolean) || !!form.kepAdresi, renk: '#a78bfa' },
    { id: 'giris', title: 'E-Devlet / E-Bildirge Giriş Bilgileri', subtitle: 'Portal kullanıcıları ve şifreler', icon: Lock, show: !!taxpayerId, filled: false, renk: '#d4b876' },
    { id: 'bagkur', title: 'Bağ-Kur Bilgileri', subtitle: 'Sicil bilgisi', icon: Shield, show: true, filled: !!form.bagkurSicilNo, renk: '#38bdf8' },
    { id: 'entegrator', title: 'E-Fatura Entegratör Bilgileri', subtitle: 'Sağlayıcı ve mükellefiyet', icon: Sparkles, show: true, filled: !!form.eFaturaEntegrator || form.isEFaturaMukellefi, renk: '#f472b6' },
    { id: 'otomasyon', title: 'Evrak & Otomasyon Bilgileri', subtitle: 'Teslim günü ve mesajlar', icon: Workflow, show: true, filled: !!form.evrakTeslimGunu || form.whatsappEvrakTalep || form.whatsappEvrakGeldi, renk: '#fb923c' },
    // 2026-09-14: gece sorgularını mükellef başına açıp kapatma (Kaydet'ten bağımsız). Yeni kayıtta gizli.
    { id: 'otomatikSorgu', title: 'Otomatik Sorgulama Ayarı', subtitle: 'Gece çalışan sorgular — mükellef başına aç/kapat', icon: OTOMATIK_SORGU_IKON, show: !!taxpayerId, filled: otomatikSorguTanimli(otomatikSorgu), renk: OTOMATIK_SORGU_RENK },
    { id: 'sistem', title: 'Defter & Sistem Bilgileri', subtitle: 'Luca / Mihsap eşleşme', icon: Settings2, show: true, filled: !!form.lucaSlug || !!form.mihsapId, renk: '#2dd4bf' },
  ];
  let credentialSections: typeof sections = [
    { id: 'vergiSifre', title: 'Vergi Dairesi Şifre Bilgileri', subtitle: 'Kullanıcı kodu ve şifre', icon: Lock, show: !!taxpayerId, filled: false, renk: '#d4b876' },
    { id: 'sgkSifre', title: 'E-Bildirge Giriş Bilgileri', subtitle: 'SGK kullanıcı adı, sistem şifresi ve işyeri şifresi', icon: Shield, show: !!taxpayerId, filled: false, renk: '#38bdf8' },
  ];
  credentialSections = credentialSections.map((section) => {
    if (section.id === 'vergiSifre') return { ...section, filled: hasGibCredential };
    if (section.id === 'sgkSifre') return { ...section, filled: hasSgkCredential };
    return section;
  });
  const hiddenSectionIds = new Set<BilgiSectionId>(['yetkili', 'giris', 'bagkur']);
  const visible = sections
    .filter((s) => s.show && !hiddenSectionIds.has(s.id))
    .flatMap((s) => (s.id === 'iletisim' ? [s, ...credentialSections.filter((c) => c.show)] : [s]));
  const [open, setOpen] = useState<BilgiSectionId | null>(null);

  const renderSection = (section: BilgiSectionId) => {
    if (section === 'musteri') {
      return (
        <div className="space-y-5">
          <FormCluster title="Temel bilgiler">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Etiket>Mükellef Tipi</Etiket>
                <Segmented
                  value={taxpayerKindFromForm(form)}
                  onChange={(v) => applyTaxpayerKind(v as TaxpayerKind, setForm)}
                  options={TAXPAYER_KIND_OPTIONS}
                />
              </div>

              {form.type === 'TUZEL_KISI' ? (
                <Field label="Şirket adı" required className="md:col-span-2">
                  <InputBase value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} required />
                </Field>
              ) : (
                <>
                  <Field label="Ad" required>
                    <InputBase value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} required />
                  </Field>
                  <Field label="Soyad" required>
                    <InputBase value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} required />
                  </Field>
                </>
              )}

              <Field label={form.type === 'TUZEL_KISI' ? 'VKN' : 'TCKN'} required>
                <InputBase
                  value={form.taxNumber}
                  onChange={(e) => setForm((p) => ({ ...p, taxNumber: e.target.value.replace(/\D/g, '').slice(0, form.type === 'TUZEL_KISI' ? 10 : 11) }))}
                  maxLength={form.type === 'TUZEL_KISI' ? 10 : 11}
                  required
                  className="font-mono"
                />
              </Field>
              <Field label="Logo URL">
                <InputBase value={form.logoUrl} onChange={(e) => setForm((p) => ({ ...p, logoUrl: e.target.value }))} />
              </Field>
            </div>
          </FormCluster>

          <FormCluster title="Vergi dairesi ve sicil">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Vergi dairesi" required>
                <InputBase value={form.taxOffice} onChange={(e) => setForm((p) => ({ ...p, taxOffice: e.target.value }))} required />
              </Field>
              <Field label="İşe başlama tarihi">
                <InputBase type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
              </Field>
              <Field label="İşi bırakma tarihi">
                <InputBase type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
              </Field>
              <Field label="NACE Kodu">
                <InputBase value={form.naceKodu} onChange={(e) => setForm((p) => ({ ...p, naceKodu: e.target.value }))} />
              </Field>
              <Field label="Faaliyet / Sektör (fatura eşleştirmede kullanılır)">
                <InputBase value={form.faaliyetAciklama} placeholder="ör. yemek üretimi, inşaat malzemeleri toptan ticareti, lokanta" onChange={(e) => setForm((p) => ({ ...p, faaliyetAciklama: e.target.value }))} />
              </Field>
              <Field label="Ticaret Sicil No">
                <InputBase value={form.ticaretSicilNo} onChange={(e) => setForm((p) => ({ ...p, ticaretSicilNo: e.target.value }))} />
              </Field>
              <Field label="MERSİS No">
                <InputBase value={form.mersisNo} onChange={(e) => setForm((p) => ({ ...p, mersisNo: e.target.value }))} className="font-mono" />
              </Field>
              <Field label="Oda Sicil No">
                <InputBase value={form.odaSicilNo} onChange={(e) => setForm((p) => ({ ...p, odaSicilNo: e.target.value }))} />
              </Field>
              <Field label="Adres" className="md:col-span-2">
                <InputBase value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              </Field>
            </div>
          </FormCluster>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'mukellefiyet') {
      return taxpayerId ? <MukellefiyetlerCard taxpayerId={taxpayerId} sgkCredentialReady={hasSgkCredential} /> : null;
    }

    if (section === 'yetkili') {
      return taxpayerId ? <YetkililerSection taxpayerId={taxpayerId} /> : null;
    }

    if (section === 'iletisim') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <FormCluster title="Telefonlar">
              {/* REHBER: her numaranın yanında kime ait olduğu. WhatsApp
                  Mesajlar ekranında firma adı yerine bu ad görünür; numara →
                  mükellef eşleştirmesi değişmez. */}
              <div className="space-y-2.5">
                {form.phones.map((phone, index) => (
                  <div key={index} className="flex gap-2">
                    <div className="flex-1">
                      <InputBase
                        type="tel"
                        inputMode="numeric"
                        value={formatTrPhone(phone)}
                        onChange={(e) =>
                          setForm((prev) => {
                            const phones = [...prev.phones];
                            phones[index] = cleanTrPhone(e.target.value);
                            return { ...prev, phones };
                          })
                        }
                        placeholder={index === 0 ? '0(5__) ___ __ __' : `Telefon ${index + 1}`}
                      />
                    </div>
                    <div className="w-[42%]">
                      <InputBase
                        value={form.telefonAdlari[index] || ''}
                        onChange={(e) =>
                          setForm((prev) => {
                            const telefonAdlari = [...prev.telefonAdlari];
                            telefonAdlari[index] = e.target.value;
                            return { ...prev, telefonAdlari };
                          })
                        }
                        placeholder="Ad Soyad"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </FormCluster>
            <FormCluster title="E-postalar">
              <div className="space-y-2.5">
                {form.emails.map((email, index) => (
                  <InputBase
                    key={index}
                    type="email"
                    value={email}
                    onChange={(e) =>
                      setForm((prev) => {
                        const emails = [...prev.emails];
                        emails[index] = e.target.value;
                        return { ...prev, emails };
                      })
                    }
                    placeholder={index === 0 ? 'Ana e-posta' : `E-posta ${index + 1}`}
                  />
                ))}
              </div>
            </FormCluster>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="KEP Adresi">
              <InputBase type="email" value={form.kepAdresi} onChange={(e) => setForm((p) => ({ ...p, kepAdresi: e.target.value }))} />
            </Field>
            <Field label="Web Sitesi">
              <InputBase value={form.webSitesi} onChange={(e) => setForm((p) => ({ ...p, webSitesi: e.target.value }))} />
            </Field>
          </div>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'vergiSifre') {
      return taxpayerId ? <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} provider="GIB_IVD" /> : null;
    }

    if (section === 'sgkSifre') {
      return taxpayerId ? <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} provider="SGK_EBILDIRGE" /> : null;
    }

    if (section === 'giris') {
      return taxpayerId ? <TaxpayerPortalCredentialsCard taxpayerId={taxpayerId} /> : null;
    }

    if (section === 'bagkur') {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Bağ-Kur Sicil No">
            <InputBase value={form.bagkurSicilNo} onChange={(e) => setForm((p) => ({ ...p, bagkurSicilNo: e.target.value }))} className="font-mono" />
          </Field>
          <div className="p-3 text-[13px]" style={{ border: `1px solid ${LINE}`, borderRadius: R_ALAN, color: MUTED }}>
            <div className="flex items-center gap-2 font-medium" style={{ color: TEXT }}>
              <Lock size={13} /> Giriş bilgileri
            </div>
            <p className="mt-1.5">Bağ-Kur ve e-Devlet şifreleri giriş bilgileri bölümünden yönetilir.</p>
          </div>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'entegrator') {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Entegratör">
              <select
                value={form.eFaturaEntegrator}
                onChange={(e) => setForm((p) => ({ ...p, eFaturaEntegrator: e.target.value }))}
                className={SELECT_CLS}
                style={{ colorScheme: 'dark' }}
              >
                <option value="">Seçiniz</option>
                <option value="GIB_PORTAL">GİB Portal</option>
                <option value="UYUMSOFT">Uyumsoft</option>
                <option value="BILGENET">BilgeNet</option>
                <option value="FORIBA">Foriba</option>
                <option value="IZIBIZ">İzibiz</option>
                <option value="DIGER">Diğer</option>
              </select>
            </Field>
            <div>
              <Etiket>E-Fatura Mükellefiyeti</Etiket>
              <ToggleRow
                checked={form.isEFaturaMukellefi}
                onChange={(checked) => setForm((p) => ({ ...p, isEFaturaMukellefi: checked }))}
                title="E-Fatura mükellefi"
                detail="Fatura sorgulama modüllerindeki varsayılan kanal."
              />
            </div>
          </div>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'otomasyon') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
            <Field label="Evrak teslim son günü">
              <InputBase
                type="number"
                min={1}
                max={30}
                value={form.evrakTeslimGunu}
                onChange={(e) => setForm((p) => ({ ...p, evrakTeslimGunu: e.target.value }))}
              />
            </Field>
            <div className="grid gap-2.5">
              <ToggleRow
                checked={form.whatsappEvrakTalep}
                onChange={(checked) => setForm((p) => ({ ...p, whatsappEvrakTalep: checked }))}
                title="Evrak talep mesajı"
                detail="Aylık evrak akışı için WhatsApp hatırlatması."
              />
              <ToggleRow
                checked={form.whatsappEvrakGeldi}
                onChange={(checked) => setForm((p) => ({ ...p, whatsappEvrakGeldi: checked }))}
                title="Evrak geldi onayı"
                detail="Evrak geldi işaretlendiğinde bilgilendirme mesajı."
              />
            </div>
          </div>
          <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'otomatikSorgu') {
      return taxpayerId ? <OtomatikSorguAyari taxpayerId={taxpayerId} deger={otomatikSorgu} /> : null;
    }

    return (
      <div className="space-y-5">
        <div>
          <Etiket>Defter türü</Etiket>
          <Segmented
            value={form.defterTuru}
            onChange={(v) => setForm((p) => ({ ...p, defterTuru: v as DefterTuru, mihsapDefterTuru: v === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO' }))}
            options={[{ value: 'BILANCO', label: 'Bilanço' }, { value: 'ISLETME', label: 'İşletme defteri' }]}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Luca slug">
            <InputBase value={form.lucaSlug} onChange={(e) => setForm((p) => ({ ...p, lucaSlug: e.target.value }))} />
          </Field>
          <Field label="Mihsap ID">
            <InputBase value={form.mihsapId} onChange={(e) => setForm((p) => ({ ...p, mihsapId: e.target.value }))} />
          </Field>
          <Field label="Mihsap defter türü">
            <select
              value={form.mihsapDefterTuru}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  mihsapDefterTuru: e.target.value,
                  defterTuru: e.target.value === 'DEFTER_BEYAN' ? 'ISLETME' : 'BILANCO',
                }))
              }
              className={SELECT_CLS}
              style={{ colorScheme: 'dark' }}
            >
              <option value="BILANCO">Bilanço</option>
              <option value="DEFTER_BEYAN">Defter Beyan</option>
            </select>
          </Field>
        </div>
        <SectionSaveButton onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {visible.map((s) => (
        <AccordionRow
          key={s.id}
          icon={s.icon}
          title={s.title}
          subtitle={s.subtitle}
          filled={s.filled}
          renk={s.renk}
          open={open === s.id}
          onToggle={() => setOpen((current) => (current === s.id ? null : s.id))}
        >
          {renderSection(s.id)}
        </AccordionRow>
      ))}
    </div>
  );
}
