'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Card, Spinner, PageTitle } from '../_lib/shared';

export default function MukellefProfil() {
  const { data: me, isLoading } = useQuery({ queryKey: ['portal-me'], queryFn: () => taxpayerApi.get('/portal/me').then((r) => r.data) });

  if (isLoading) return (<div><PageTitle ust="Hesap" baslik="Profilim" /><Spinner /></div>);

  const ad = me?.companyName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || '—';
  const rows: Array<[string, string]> = [
    ['Ünvan / Ad', ad],
    ['Tür', me?.type === 'TUZEL_KISI' ? 'Tüzel Kişi' : me?.type === 'GERCEK_KISI' ? 'Gerçek Kişi' : '—'],
    ['Vergi Dairesi', me?.taxOffice || '—'],
    ['E-posta', me?.email || '—'],
    ['Telefon', me?.phone || '—'],
    ['Portal e-postası', me?.portalEmail || '—'],
  ];

  return (
    <div>
      <PageTitle ust="Hesap" baslik="Profilim" />
      <Card>
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-3 gap-4">
              <span className="text-[12.5px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.4)' }}>{k}</span>
              <span className="text-[13.5px] text-right" style={{ color: '#fafaf9' }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
      <p className="text-[12px] mt-3" style={{ color: 'rgba(250,250,249,0.35)' }}>
        Bilgilerinizde düzeltme gerekiyorsa müşavirinizle iletişime geçin.
      </p>
    </div>
  );
}
