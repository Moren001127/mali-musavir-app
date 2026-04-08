'use client';

export default function AyarlarPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>Ayarlar</h1>
        <p className="text-sm text-gray-500 mt-1">Sistem ve entegrasyon ayarları</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">📱</span>
          <h3 className="text-base font-semibold" style={{ color: 'var(--navy)' }}>WhatsApp Otomasyonu</h3>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
          WhatsApp entegrasyonu yakında aktif edilecek. Mükellef listesinde evrak hatırlatma ve bilgilendirme mesajları için telefon numaralarını ve tercihlerinizi şimdiden ayarlayabilirsiniz.
        </div>
      </div>

      <div className="card opacity-60">
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--navy)' }}>Diğer Ayarlar</h3>
        <p className="text-sm text-gray-400">Yakında eklenecek: Ofis bilgileri, logo, bildirim tercihleri...</p>
      </div>
    </div>
  );
}
