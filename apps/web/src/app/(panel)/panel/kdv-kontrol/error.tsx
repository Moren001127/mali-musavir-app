'use client';
import { useEffect } from 'react';
import Link from 'next/link';

export default function KdvKontrolError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[KDV Kontrol Hata]', error);
  }, [error]);

  return (
    <div className="min-h-[400px] flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-2xl border border-red-100 p-8 text-center shadow-sm">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">KDV Kontrol Sayfası Yüklenemedi</h2>
        <p className="text-sm text-gray-500 mb-4">
          Bir hata oluştu. Lütfen tekrar deneyin.
        </p>
        <div className="bg-red-50 rounded-lg p-3 mb-6 text-left">
          <p className="text-xs font-mono text-red-700 break-all">
            {error?.message || 'Bilinmeyen hata'}
          </p>
          {error?.digest && (
            <p className="text-xs text-red-400 mt-1">Kod: {error.digest}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg"
          >
            Tekrar Dene
          </button>
          <Link
            href="/panel/kdv-kontrol"
            className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 text-center"
          >
            Geri Dön
          </Link>
        </div>
      </div>
    </div>
  );
}
