'use client';

import { useCallback } from 'react';
import { ExternalLink, FileImage } from 'lucide-react';

const SABLON_URL = '/duyuru-sablonu.html';

export default function DuyurularPage() {
  const skinTemplate = useCallback((frame: HTMLIFrameElement | null) => {
    const doc = frame?.contentDocument;
    if (!doc) return;

    const inject = () => {
      if (!doc.head || doc.getElementById('moren-template-skin')) return;
      const style = doc.createElement('style');
      style.id = 'moren-template-skin';
      style.textContent = `
        html, body {
          background: #080705 !important;
        }

        body > div:first-child {
          background: #080705 !important;
        }

        button, input, textarea, select, [contenteditable="true"] {
          border-radius: 10px !important;
        }

        input, textarea, select, [contenteditable="true"] {
          background: #17130c !important;
          color: #f8eed1 !important;
          border: 1px solid rgba(212, 184, 118, 0.35) !important;
          box-shadow: none !important;
        }

        input::placeholder, textarea::placeholder {
          color: rgba(248, 238, 209, 0.42) !important;
        }
      `;
      doc.head.appendChild(style);
    };

    const polish = () => {
      inject();
      const nodes = Array.from(doc.querySelectorAll<HTMLElement>('body *'));
      for (const el of nodes) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const rect = el.getBoundingClientRect();

        if (
          text.includes('İpucu:') ||
          text.includes('Ipucu:') ||
          text.includes('Tweaks') ||
          text.includes('Format') ||
          text.includes('Varyasyon') ||
          text.includes('Layout')
        ) {
          const panel = findPanel(el);
          if (panel) {
            panel.style.background = '#17130c';
            panel.style.color = '#f8eed1';
            panel.style.borderColor = 'rgba(212, 184, 118, 0.28)';
            panel.style.boxShadow = '0 18px 40px rgba(0,0,0,0.28)';
          }
        }

        if (rect.height > 24 && rect.height < 180 && rect.width > 220 && text.length > 8) {
          const bg = getComputedStyle(el).backgroundColor;
          if (bg === 'rgb(255, 255, 255)' || bg === 'rgb(250, 249, 245)') {
            el.style.background = '#17130c';
            el.style.color = '#f8eed1';
            el.style.borderColor = 'rgba(212, 184, 118, 0.22)';
          }
        }
      }
    };

    const findPanel = (start: HTMLElement) => {
      let node: HTMLElement | null = start;
      for (let i = 0; i < 6 && node; i += 1) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 240 && rect.height > 40) return node;
        node = node.parentElement;
      }
      return start;
    };

    polish();
    setTimeout(polish, 800);
    setTimeout(polish, 1800);
  }, []);

  return (
    <div className="relative h-[calc(100vh-92px)] min-h-[760px] overflow-hidden rounded-xl border border-[#2b2619] bg-[#080705] shadow-2xl shadow-black/30">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-[#d4b876]/25 bg-black/55 px-3 py-2 text-sm font-semibold text-[#f8eed1] backdrop-blur">
        <FileImage size={16} className="text-[#d4b876]" />
        Moren Duyuru Şablonu
      </div>
      <div className="absolute right-4 top-4 z-10">
        <a
          href={SABLON_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-[#c8ad68]/40 bg-[#c8ad68] px-4 py-2 text-sm font-semibold text-[#111] shadow-lg shadow-black/30 transition hover:bg-[#d9bf7a]"
        >
          <ExternalLink size={16} />
          Yeni Sekmede Aç
        </a>
      </div>
      <iframe
        src={SABLON_URL}
        title="Moren Duyuru Şablonu"
        className="h-full w-full bg-[#080705]"
        style={{ border: 0 }}
        onLoad={(event) => skinTemplate(event.currentTarget)}
      />
    </div>
  );
}
