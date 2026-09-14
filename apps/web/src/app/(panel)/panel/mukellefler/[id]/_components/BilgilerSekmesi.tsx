'use client';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileCheck, Lock, Phone, Settings2, Shield, Sparkles, UserCog, Workflow } from 'lucide-react';
import { MukellefiyetlerCard } from '@/components/mukellef/MukellefiyetlerCard';
import { TaxpayerPortalCredentialsCard } from '@/components/portal-automation/PortalCredentialCards';
import { portalAutomationApi, type PortalProvider } from '@/lib/portal-automation';
import { cleanTrPhone, formatTrPhone } from '../_lib/tema';
import { TAXPAYER_KIND_OPTIONS, applyTaxpayerKind, taxpayerKindFromForm, type DefterTuru, type FormState, type TaxpayerKind } from '../_lib/form';
import { AccordionRow } from './ortak/AccordionRow';
import { AlanCifti, AlanEk, AlanGirdi, AlanMetin, AlanSecim, Anahtar, FormAltBilgi, FormGrup, Satir, Secici } from './ortak/Form';
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
    const tuzel = form.type === 'TUZEL_KISI';
    const alan = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

    if (section === 'musteri') {
      return (
        <div className="space-y-4">
          <FormGrup baslik="Kimlik" aciklama="Tip, unvan ve vergi numarası">
            <Satir etiket="Mükellef tipi" genis>
              <Secici
                value={taxpayerKindFromForm(form)}
                onChange={(v) => applyTaxpayerKind(v as TaxpayerKind, setForm)}
                options={TAXPAYER_KIND_OPTIONS}
              />
            </Satir>
            {tuzel ? (
              <Satir etiket="Şirket adı" zorunlu genis>
                <AlanGirdi value={form.companyName} onChange={alan('companyName')} required autoComplete="organization" />
              </Satir>
            ) : (
              <>
                <Satir etiket="Ad" zorunlu>
                  <AlanGirdi value={form.firstName} onChange={alan('firstName')} required />
                </Satir>
                <Satir etiket="Soyad" zorunlu>
                  <AlanGirdi value={form.lastName} onChange={alan('lastName')} required />
                </Satir>
              </>
            )}
            <Satir etiket={tuzel ? 'VKN' : 'TCKN'} zorunlu ipucu={tuzel ? '10 hane' : '11 hane'}>
              <AlanGirdi
                mono
                inputMode="numeric"
                value={form.taxNumber}
                onChange={(e) => setForm((p) => ({ ...p, taxNumber: e.target.value.replace(/\D/g, '').slice(0, tuzel ? 10 : 11) }))}
                maxLength={tuzel ? 10 : 11}
                required
              />
            </Satir>
            <Satir etiket="Vergi dairesi" zorunlu>
              <AlanGirdi value={form.taxOffice} onChange={alan('taxOffice')} required />
            </Satir>
            <Satir etiket="İşe başlama">
              <AlanGirdi type="date" value={form.startDate} onChange={alan('startDate')} />
            </Satir>
            <Satir etiket="İşi bırakma" ipucu="Boş bırakılırsa mükellef faal sayılır.">
              <AlanGirdi type="date" value={form.endDate} onChange={alan('endDate')} />
            </Satir>
          </FormGrup>

          <FormGrup baslik="Sicil ve faaliyet" aciklama="Ticaret sicili, MERSİS, oda ve NACE">
            <Satir etiket="Ticaret sicil no">
              <AlanGirdi value={form.ticaretSicilNo} onChange={alan('ticaretSicilNo')} />
            </Satir>
            <Satir etiket="MERSİS no">
              <AlanGirdi mono inputMode="numeric" value={form.mersisNo} onChange={alan('mersisNo')} />
            </Satir>
            <Satir etiket="Oda sicil no">
              <AlanGirdi value={form.odaSicilNo} onChange={alan('odaSicilNo')} />
            </Satir>
            <Satir etiket="NACE kodu">
              <AlanGirdi mono value={form.naceKodu} onChange={alan('naceKodu')} placeholder="00.00.00" />
            </Satir>
            <Satir etiket="Faaliyet / sektör" genis ipucu="Fatura eşleştirmede kullanılır — ör. yemek üretimi, inşaat malzemeleri toptan ticareti, lokanta.">
              <AlanGirdi value={form.faaliyetAciklama} onChange={alan('faaliyetAciklama')} />
            </Satir>
          </FormGrup>

          <FormGrup baslik="Adres ve görsel">
            <Satir etiket="Adres" genis hizala="ust">
              <AlanMetin rows={2} value={form.address} onChange={alan('address')} />
            </Satir>
            <Satir etiket="Logo adresi" genis ipucu="Kartta ve mükellef portalında gösterilir.">
              <AlanGirdi value={form.logoUrl} onChange={alan('logoUrl')} placeholder="https://…" />
            </Satir>
          </FormGrup>

          <FormAltBilgi onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
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
          <div className="grid gap-4 lg:grid-cols-2">
            {/* REHBER: her numaranın yanında kime ait olduğu. WhatsApp Mesajlar ekranında firma adı yerine
                bu ad görünür; numara → mükellef eşleştirmesi değişmez. */}
            <FormGrup baslik="Telefonlar" aciklama="numara · kime ait" sutun={1}>
              {form.phones.map((phone, index) => (
                <Satir key={index} etiket={index === 0 ? 'Ana telefon' : `Telefon ${index + 1}`}>
                  <AlanCifti>
                    <AlanGirdi
                      type="tel"
                      inputMode="numeric"
                      mono
                      value={formatTrPhone(phone)}
                      onChange={(e) =>
                        setForm((prev) => {
                          const phones = [...prev.phones];
                          phones[index] = cleanTrPhone(e.target.value);
                          return { ...prev, phones };
                        })
                      }
                      placeholder="0(5__) ___ __ __"
                    />
                    <AlanGirdi
                      value={form.telefonAdlari[index] || ''}
                      onChange={(e) =>
                        setForm((prev) => {
                          const telefonAdlari = [...prev.telefonAdlari];
                          telefonAdlari[index] = e.target.value;
                          return { ...prev, telefonAdlari };
                        })
                      }
                      placeholder="Kime ait"
                    />
                  </AlanCifti>
                </Satir>
              ))}
            </FormGrup>
            <FormGrup baslik="E-posta" sutun={1}>
              {form.emails.map((email, index) => (
                <Satir key={index} etiket={index === 0 ? 'Ana e-posta' : `E-posta ${index + 1}`}>
                  <AlanGirdi
                    type="email"
                    value={email}
                    onChange={(e) =>
                      setForm((prev) => {
                        const emails = [...prev.emails];
                        emails[index] = e.target.value;
                        return { ...prev, emails };
                      })
                    }
                    placeholder="ad@firma.com"
                  />
                </Satir>
              ))}
            </FormGrup>
          </div>
          <FormGrup baslik="Resmî ve web">
            <Satir etiket="KEP adresi">
              <AlanGirdi type="email" value={form.kepAdresi} onChange={alan('kepAdresi')} placeholder="firma@hs01.kep.tr" />
            </Satir>
            <Satir etiket="Web sitesi">
              <AlanGirdi value={form.webSitesi} onChange={alan('webSitesi')} placeholder="www.firma.com" />
            </Satir>
          </FormGrup>
          <FormAltBilgi onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
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
        <div className="space-y-4">
          <FormGrup baslik="Bağ-Kur">
            <Satir etiket="Bağ-Kur sicil no" ipucu="Bağ-Kur ve e-Devlet şifreleri giriş bilgileri bölümünden yönetilir.">
              <AlanGirdi mono value={form.bagkurSicilNo} onChange={alan('bagkurSicilNo')} />
            </Satir>
          </FormGrup>
          <FormAltBilgi onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'entegrator') {
      return (
        <div className="space-y-4">
          <FormGrup baslik="E-Fatura" aciklama="Sağlayıcı ve mükellefiyet durumu">
            <Satir etiket="Entegratör">
              <AlanSecim value={form.eFaturaEntegrator} onChange={alan('eFaturaEntegrator')}>
                <option value="">Seçiniz</option>
                <option value="GIB_PORTAL">GİB Portal</option>
                <option value="UYUMSOFT">Uyumsoft</option>
                <option value="BILGENET">BilgeNet</option>
                <option value="FORIBA">Foriba</option>
                <option value="IZIBIZ">İzibiz</option>
                <option value="DIGER">Diğer</option>
              </AlanSecim>
            </Satir>
            <Satir etiket="E-Fatura mükellefi" ipucu="Fatura sorgulama modüllerinde varsayılan kanal.">
              <Anahtar
                checked={form.isEFaturaMukellefi}
                onChange={(checked) => setForm((p) => ({ ...p, isEFaturaMukellefi: checked }))}
              />
            </Satir>
          </FormGrup>
          <FormAltBilgi onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'otomasyon') {
      return (
        <div className="space-y-4">
          <FormGrup baslik="Evrak akışı" aciklama="Aylık evrak teslimi ve WhatsApp mesajları">
            <Satir etiket="Teslim son günü" ipucu="Her ayın bu gününe kadar evrak beklenir (1–30).">
              <span className="relative block max-w-[180px]">
                <AlanGirdi type="number" min={1} max={30} inputMode="numeric" mono value={form.evrakTeslimGunu} onChange={alan('evrakTeslimGunu')} className="pr-12" />
                <AlanEk>gün</AlanEk>
              </span>
            </Satir>
            <div className="hidden md:block" />
            <Satir etiket="Evrak talep mesajı" ipucu="Aylık evrak akışı için WhatsApp hatırlatması gönderilir.">
              <Anahtar
                checked={form.whatsappEvrakTalep}
                onChange={(checked) => setForm((p) => ({ ...p, whatsappEvrakTalep: checked }))}
              />
            </Satir>
            <Satir etiket="Evrak geldi onayı" ipucu="Evrak geldi işaretlenince mükellefe bilgilendirme mesajı gider.">
              <Anahtar
                checked={form.whatsappEvrakGeldi}
                onChange={(checked) => setForm((p) => ({ ...p, whatsappEvrakGeldi: checked }))}
              />
            </Satir>
          </FormGrup>
          <FormAltBilgi onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
        </div>
      );
    }

    if (section === 'otomatikSorgu') {
      return taxpayerId ? <OtomatikSorguAyari taxpayerId={taxpayerId} deger={otomatikSorgu} /> : null;
    }

    return (
      <div className="space-y-4">
        <FormGrup baslik="Defter" aciklama="Defter türü ve Mihsap eşleşmesi">
          <Satir etiket="Defter türü">
            <Secici
              value={form.defterTuru}
              onChange={(v) => setForm((p) => ({ ...p, defterTuru: v as DefterTuru, mihsapDefterTuru: v === 'ISLETME' ? 'DEFTER_BEYAN' : 'BILANCO' }))}
              options={[{ value: 'BILANCO', label: 'Bilanço' }, { value: 'ISLETME', label: 'İşletme defteri' }]}
            />
          </Satir>
          <Satir etiket="Mihsap defter türü">
            <AlanSecim
              value={form.mihsapDefterTuru}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  mihsapDefterTuru: e.target.value,
                  defterTuru: e.target.value === 'DEFTER_BEYAN' ? 'ISLETME' : 'BILANCO',
                }))
              }
            >
              <option value="BILANCO">Bilanço</option>
              <option value="DEFTER_BEYAN">Defter Beyan</option>
            </AlanSecim>
          </Satir>
        </FormGrup>
        <FormGrup baslik="Sistem eşleşmesi" aciklama="Luca ve Mihsap kimlikleri">
          <Satir etiket="Luca slug" ipucu="Luca'daki firma kısa adı.">
            <AlanGirdi mono value={form.lucaSlug} onChange={alan('lucaSlug')} />
          </Satir>
          <Satir etiket="Mihsap ID">
            <AlanGirdi mono value={form.mihsapId} onChange={alan('mihsapId')} />
          </Satir>
        </FormGrup>
        <FormAltBilgi onSave={onSave} saving={saving} hasRecord={!!taxpayerId} />
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
