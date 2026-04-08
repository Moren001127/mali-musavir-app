'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateTaxpayerSchema, CreateTaxpayerDto, TaxpayerType } from '@mali-musavir/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Building2, User } from 'lucide-react';

const inputCls = 'input-base w-full';
const labelCls = 'block text-sm font-medium mb-1.5';

export default function YeniMukellefPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateTaxpayerDto>({
    resolver: zodResolver(CreateTaxpayerSchema),
    defaultValues: { type: TaxpayerType.TUZEL_KISI },
  });

  const type = watch('type');

  const create = useMutation({
    mutationFn: (data: CreateTaxpayerDto) =>
      api.post('/taxpayers', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxpayers'] });
      toast.success('Mükellef başarıyla eklendi');
      router.push('/panel/mukellefler');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Mükellef eklenirken hata oluştu';
      toast.error(Array.isArray(msg) ? msg.join(', ') : msg);
    },
  });

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Yeni Mükellef"
        subtitle="Mükellef bilgilerini girin"
        backHref="/panel/mukellefler"
      />

      <form onSubmit={handleSubmit((d) => create.mutate(d))} className="space-y-4">

        {/* Tip Seçimi */}
        <div className="card p-5">
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            Mükellef Tipi
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: TaxpayerType.TUZEL_KISI, label: 'Tüzel Kişi', sub: 'Ltd, A.Ş., Kooperatif vb.', icon: Building2 },
              { value: TaxpayerType.GERCEK_KISI, label: 'Gerçek Kişi', sub: 'Şahıs, esnaf, serbest meslek', icon: User },
            ].map(({ value, label, sub, icon: Icon }) => (
              <label
                key={value}
                className="flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all duration-150 border-2"
                style={{
                  borderColor: type === value ? 'var(--gold)' : 'var(--border)',
                  background: type === value ? 'var(--gold-pale)' : 'var(--bg)',
                }}
              >
                <input {...register('type')} type="radio" value={value} className="hidden" />
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: type === value ? 'var(--gold)' : 'var(--border)',
                    color: type === value ? 'white' : 'var(--text-muted)',
                  }}
                >
                  <Icon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Temel Bilgiler */}
        <div className="card p-5 space-y-4">
          <p className="text-sm font-bold" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            Temel Bilgiler
          </p>

          {type === TaxpayerType.TUZEL_KISI ? (
            <div>
              <label className={labelCls} style={{ color: 'var(--text)' }}>Şirket Adı *</label>
              <input {...register('companyName')} className={`${inputCls} ${errors.companyName ? 'input-error' : ''}`} placeholder="ABC Ltd. Şti." />
              {errors.companyName && <p className="text-red-500 text-xs mt-1">{errors.companyName.message}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} style={{ color: 'var(--text)' }}>Ad *</label>
                <input {...register('firstName')} className={`${inputCls} ${errors.firstName ? 'input-error' : ''}`} placeholder="Ahmet" />
                {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName.message}</p>}
              </div>
              <div>
                <label className={labelCls} style={{ color: 'var(--text)' }}>Soyad *</label>
                <input {...register('lastName')} className={`${inputCls} ${errors.lastName ? 'input-error' : ''}`} placeholder="Yılmaz" />
                {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName.message}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--text)' }}>
                {type === TaxpayerType.TUZEL_KISI ? 'VKN (10 hane) *' : 'TCKN (11 hane) *'}
              </label>
              <input
                {...register('taxNumber')}
                className={`${inputCls} font-mono ${errors.taxNumber ? 'input-error' : ''}`}
                placeholder={type === TaxpayerType.TUZEL_KISI ? '1234567890' : '12345678901'}
                maxLength={type === TaxpayerType.TUZEL_KISI ? 10 : 11}
              />
              {errors.taxNumber && <p className="text-red-500 text-xs mt-1">{errors.taxNumber.message}</p>}
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text)' }}>Vergi Dairesi *</label>
              <input {...register('taxOffice')} className={`${inputCls} ${errors.taxOffice ? 'input-error' : ''}`} placeholder="Kadıköy VD" />
              {errors.taxOffice && <p className="text-red-500 text-xs mt-1">{errors.taxOffice.message}</p>}
            </div>
          </div>
        </div>

        {/* İletişim */}
        <div className="card p-5 space-y-4">
          <p className="text-sm font-bold" style={{ color: 'var(--text)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            İletişim <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>(isteğe bağlı)</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--text)' }}>E-posta</label>
              <input {...register('email')} type="email" className={inputCls} placeholder="info@sirket.com" />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text)' }}>Telefon</label>
              <input {...register('phone')} className={inputCls} placeholder="+90 532 000 0000" />
            </div>
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--text)' }}>Adres</label>
            <textarea {...register('address')} rows={2} className={`${inputCls} resize-none`} placeholder="İstanbul, Türkiye" />
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--text)' }}>Notlar</label>
            <textarea {...register('notes')} rows={2} className={`${inputCls} resize-none`} placeholder="Mükellefle ilgili özel notlar..." />
          </div>
        </div>

        {/* Hata özeti */}
        {Object.keys(errors).length > 0 && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <p className="font-semibold text-red-700 mb-1">Lütfen eksik alanları doldurun:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-red-600 text-xs">
              {Object.entries(errors).map(([f, e]: any) => (
                <li key={f}>{e?.message ?? f}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Aksiyonlar */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push('/panel/mukellefler')}
            className="btn-secondary flex-1"
          >
            İptal
          </button>
          <button type="submit" disabled={create.isPending} className="btn-primary flex-1">
            {create.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Kaydediliyor...
              </span>
            ) : (
              'Mükellef Ekle'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
