'use client';

import { ExternalLink, FileImage } from 'lucide-react';

const SABLON_URL = '/duyuru-sablonu.html';

export default function DuyurularPage() {
  return (
    <div className="flex h-[calc(100vh-92px)] min-h-[760px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#2b2619] bg-[#0d0b07] px-5 py-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#c8ad68]">
            Duyuru merkezi
          </div>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-white">
            <FileImage size={20} className="text-[#c8ad68]" />
            Moren Duyuru Şablonu
          </h2>
        </div>

        <a
          href={SABLON_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-[#c8ad68]/40 bg-[#c8ad68] px-4 py-2 text-sm font-semibold text-[#111] transition hover:bg-[#d9bf7a]"
        >
          <ExternalLink size={16} />
          Tam Ekran Aç
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#2b2619] bg-white">
        <iframe
          src={SABLON_URL}
          title="Moren Duyuru Şablonu"
          className="h-full w-full bg-white"
          style={{ border: 0 }}
        />
      </div>
    </div>
  );
}
