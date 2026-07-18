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

  // Seçili ID geçerliyse kullan, yoksa tek online cihazı otomatik seç
  const activeDevice =
    onlineDevices.find((d) => d.deviceId === preferredId) ??
    (onlineDevices.length === 1 ? onlineDevices[0] : null);

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
