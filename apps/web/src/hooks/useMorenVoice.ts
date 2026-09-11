'use client';
import { useSyncExternalStore } from 'react';
import { morenVoice, type VoiceSnapshot } from '@/lib/moren-voice-session';

/**
 * Global canlı ses oturumunu izler (tek kaynak: lib/moren-voice-session.ts).
 * Her bileşen aynı anlık durumu görür; start/stop morenVoice üzerinden.
 */
export function useMorenVoice(): VoiceSnapshot {
  return useSyncExternalStore(morenVoice.subscribe, morenVoice.getSnapshot, morenVoice.getSnapshot);
}
