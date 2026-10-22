// Short-window admission policy. Formal power/thermal thresholds remain subject
// to the P72 same-scene official-app comparison.
export class TranscriptionConditions {
  foreground: boolean = false;
  bluetoothLease: boolean = false;
  charging: boolean = false;
  batteryPercent: number = -1;
  thermalKnown: boolean = false;
  thermalLimited: boolean = false;
  interactiveAudio: boolean = false;
  workerReady: boolean = false;
  freeBytes: number = -1;
  usedWorkerMs: number = 0;
}
export class TranscriptionAdmission {
  allowed: boolean = false;
  reason: string = '';
  retryAfterMs: number = 60000;
}
export function admitTranscription(c: TranscriptionConditions, refine: boolean = false): TranscriptionAdmission {
  const out = new TranscriptionAdmission();
  if (!c.workerReady) out.reason = 'worker_unavailable';
  else if (c.interactiveAudio) out.reason = 'interactive_audio';
  else if (!c.foreground && !c.bluetoothLease) out.reason = 'background_unavailable';
  else if (c.freeBytes < 64 * 1024 * 1024) out.reason = 'storage_low_or_unknown';
  else if (!c.thermalKnown || c.thermalLimited) out.reason = 'thermal_limited_or_unknown';
  else if (c.batteryPercent < 0 || (!c.charging && c.batteryPercent < 20)) out.reason = 'battery_low_or_unknown';
  else if (refine && !c.charging) out.reason = 'refinement_waiting_charge';
  else if (c.usedWorkerMs >= 20000) out.reason = 'window_budget_exhausted';
  else { out.allowed = true; out.reason = 'admitted'; out.retryAfterMs = 0; }
  return out;
}
