import { IslerSayfasi } from '../_components/ofis/IslerSayfasi';

export const metadata = {
  title: 'Ekip · İş geçmişi',
};

/** /panel/ekip/isler — iş listesi + iş paneli. Gövde: _components/ofis/IslerSayfasi.tsx */
export default function EkipIslerPage() {
  return <IslerSayfasi />;
}
