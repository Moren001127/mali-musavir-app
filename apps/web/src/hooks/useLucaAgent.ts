'use client';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentsApi, type AgentHealthDevice } from '@/lib/agents';

const LS_KEY = 'preferred_luca_agent_deviceId';
// Aynı sekmede localStorage değişikliği 'storage' event'i üretmez;
// TopBar'daki seçici ile açık sayfalar senkron kalsın diye kendi event'imiz.
const CHANGE_EVENT = 'luca-agent-preferred-changed';

export interface LucaAgentInfo {
  deviceId: string;
  workerName: string | null;
  lastPing: string;
  stale: boolean;
}

export function useLucaAgent() {
  const [preferredId, setPreferredId] = useState<string | null>(null);

  useEffect(() => {
    setPreferredId(localStorage.getItem(LS_KEY));
    const sync = () => setPreferredId(localStorage.getItem(LS_KEY));
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const { data: health } = useQuery({
    queryKey: ['agent-health-luca'],
    queryFn: () => agentsApi.healthSummary(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const localDevices: LucaAgentInfo[] = (
    health?.agents.find((a) => a.agent === 'luca')?.devices ?? []
  )
    .filter((d: AgentHealthDevice) => d.isLocal && d.deviceId)
    .map((d: AgentHealthDevice) => ({
      deviceId: d.deviceId!,
      workerName: d.workerName,
      lastPing: d.lastPing,
      stale: d.stale,
    }));

  const onlineDevices = localDevices.filter((d) => !d.stale);

  // KULLANICI VİZYONU (2026-08-10, 2026-09-25'te yeniden teyit): "bilgisayarlarda ajan olmayacak;
  //   her şey sunucuda; hangi bilgisayardan portala girersem gireyim Luca'dan çek/aktar çalışsın."
  //   → İş yönlendirmesi elle seçime BAĞLI OLMAMALI.
  //
  // 2026-09-25 DÜZELTME — bu kural yazılmıştı ama seçim kalıbı hatalıydı:
  //   /vps|headless|runner|radore/ deseni OPERATÖR cihazını da yakalıyordu
  //   ("vps-radore-luca-operator"). Operatör ajanı ayrı bir iş türü ("operator") sayılır;
  //   veri çekme işleri ("local-node") ona teslim EDİLEMEZ. Ekran operatörü seçince iş
  //   "kimsenin alamayacağı" hâle geliyor ve 24 saat sırada bekleyip sessizce iptal
  //   ediliyordu. Canlı ölçüm (2026-09-25): hedefi böyle kurulan 207 işin tamamı hiç
  //   başlamadan ölmüş; sunucu veri ajanına gidenler %79-96 başarılı.
  //   Çözüm: veri ajanı seçiminde "-operator" ile bitenler ELENİR.
  const isOperator = (d: LucaAgentInfo) => /-operator$/i.test(d.deviceId);
  // Bilgisayara kurulu ajan (Chrome uzantısı, DEV-*) artık iş almaz — sahip kararı.
  const isBilgisayar = (d: LucaAgentInfo) => /^DEV-/i.test(d.deviceId);
  const sunucuVeriAjani = (d: LucaAgentInfo) =>
    /vps|headless|runner|radore|cekme/i.test(`${d.deviceId} ${d.workerName || ''}`)
    && !isOperator(d) && !isBilgisayar(d);

  const sunucuAdaylari = onlineDevices.filter(sunucuVeriAjani);
  // Elle seçime yalnız o cihaz uygun bir SUNUCU veri ajanıysa saygı duyulur; kullanıcının
  // eski tarayıcısında kalmış bir bilgisayar/operatör seçimi işi öldürmesin.
  const elleSecilen = sunucuAdaylari.find((d) => d.deviceId === preferredId);
  const activeDevice =
    elleSecilen ??
    sunucuAdaylari[0] ??
    // Hiç sunucu ajanı yoksa: tek bir uygun cihaz varsa ona düş (acil durum), yoksa null.
    (onlineDevices.filter((d) => !isOperator(d) && !isBilgisayar(d)).length === 1
      ? onlineDevices.filter((d) => !isOperator(d) && !isBilgisayar(d))[0]
      : null);

  function setPreferred(deviceId: string | null) {
    if (deviceId) localStorage.setItem(LS_KEY, deviceId);
    else localStorage.removeItem(LS_KEY);
    setPreferredId(deviceId);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return {
    /** Şu an kullanılacak agent'ın deviceId'si (veya null — hiç online yok / seçilmedi) */
    preferredDeviceId: activeDevice?.deviceId ?? null,
    /** localStorage'daki HAM seçim (fallback uygulanmadan) — seçici UI bunun üstünde çalışır */
    preferredIdRaw: preferredId,
    activeDevice,
    onlineDevices,
    allDevices: localDevices,
    setPreferred,
  };
}
