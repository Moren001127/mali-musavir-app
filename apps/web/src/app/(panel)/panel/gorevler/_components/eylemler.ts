import type { TaskStatus } from '@/lib/tasks';

/** Sayfa kabuğunun (page.tsx) satır/kart/panel bileşenlerine verdiği eylemler — tek sözleşme. */
export interface GorevEylemleri {
  /** Detay panelini aç */
  ac: (id: string) => void;
  tamamla: (id: string) => void;
  yenidenAc: (id: string) => void;
  baslat: (id: string) => void;
  iptal: (id: string) => void;
  sil: (id: string) => void;
  /** gunIso = YYYY-MM-DD */
  ertele: (id: string, gunIso: string) => void;
  notEkle: (id: string, icerik: string) => Promise<unknown>;
  sabitle: (id: string, pinned: boolean) => void;
  durumDegistir: (id: string, status: TaskStatus) => void;
  ekibeVer: (id: string, canli: boolean) => Promise<{ ok: boolean; isId?: string; error?: string }>;
  /** "Sizden istenen" ekip kalemini kapat */
  istekKapat: (id: string) => void;
}
