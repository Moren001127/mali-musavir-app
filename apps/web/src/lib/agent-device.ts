export function currentAgentDeviceId() {
  return typeof window !== 'undefined' ? (window as any).__morenAutoAgent?.deviceId : undefined;
}
