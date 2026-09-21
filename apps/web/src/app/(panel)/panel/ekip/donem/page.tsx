import { DonemSayfasi } from '../_components/ofis/DonemSayfasi';

export const metadata = {
  title: 'Ekip · Dönem tablosu',
};

/** /panel/ekip/donem — mükellef × aşama tablosu, çoklu seçim "Personele ver". Gövde: _components/ofis/DonemSayfasi.tsx */
export default function EkipDonemPage() {
  return <DonemSayfasi />;
}
