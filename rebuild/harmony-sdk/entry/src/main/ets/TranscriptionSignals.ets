import { batteryInfo, thermal, power } from '@kit.BasicServicesKit';
import { statfs } from '@kit.CoreFileKit';
import { TranscriptionConditions } from './TranscriptionBudget';

export class DeviceBudgetSignals {
  conditions: TranscriptionConditions = new TranscriptionConditions();
  thermalLevel: number = -1;
  screenActive: boolean = false;
  screenKnown: boolean = false;
}
// Read-only adapter. Unknown signals remain fail-closed; never substitutes 0%/cool.
export async function readTranscriptionSignals(filesDir: string): Promise<DeviceBudgetSignals> {
  const out = new DeviceBudgetSignals();
  try {
    const capacity = batteryInfo.batterySOC;
    if (Number.isFinite(capacity) && capacity >= 0 && capacity <= 100) out.conditions.batteryPercent = capacity;
    const state = batteryInfo.chargingStatus;
    out.conditions.charging = state === batteryInfo.BatteryChargeState.ENABLE || state === batteryInfo.BatteryChargeState.FULL;
  } catch (_) {}
  try {
    const level = thermal.getLevel();
    if (Number.isInteger(level) && level >= 0 && level <= 7) {
      out.thermalLevel = level; out.conditions.thermalKnown = true;
      out.conditions.thermalLimited = level >= thermal.ThermalLevel.WARM;
    }
  } catch (_) {}
  try { out.screenActive = power.isActive(); out.screenKnown = true; } catch (_) {}
  try { out.conditions.freeBytes = await statfs.getFreeSize(filesDir); } catch (_) {}
  return out;
}
