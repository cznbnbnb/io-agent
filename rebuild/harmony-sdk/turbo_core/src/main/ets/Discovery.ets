import { access, ble, connection } from '@kit.ConnectivityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { AttemptGate, inspectAdvertisement, candidateName, displayDeviceName } from './ProbePolicy';

export class Candidate {
  id: string = '';
  label: string = '';
  rssi: number = 0;
  classic: boolean = false;
  serviceMatched: boolean = false;
  deviceName: string = '';
  nameSource: string = '';
}

export class DiscoveryReport {
  status: string = '待扫描';
  candidates: Candidate[] = [];
  scanning: boolean = false;
}

export class Discovery {
  private gate: AttemptGate = new AttemptGate();
  private timer: number = -1;
  private listener: ((results: ble.ScanResult[]) => void) | undefined = undefined;
  private report: DiscoveryReport = new DiscoveryReport();
  private update: (value: DiscoveryReport) => void;

  constructor(update: (value: DiscoveryReport) => void) { this.update = update; }

  start(): void {
    this.stop();
    this.report = new DiscoveryReport();
    const token = this.gate.begin();
    this.listener = (results: ble.ScanResult[]): void => {
      if (!this.gate.accepts(token)) { return; }
      for (const result of results) {
        const info = inspectAdvertisement(new Uint8Array(result.data));
        const reportedName = displayDeviceName(result.deviceName || '');
        const advertisedName = info.malformed ? '' : info.localName;
        const name = advertisedName || reportedName;
        if (!candidateName(name) && (!info.hasRayNeoService || info.malformed)) { continue; }
        let candidate = this.report.candidates.find((item: Candidate) => !item.classic && item.id === result.deviceId);
        if (candidate === undefined) {
          if (this.report.candidates.length >= 32) { continue; }
          candidate = new Candidate();
          candidate.id = result.deviceId;
          candidate.label = `BLE 候选 ${this.report.candidates.length + 1}`;
          this.report.candidates.push(candidate);
        }
        candidate.rssi = result.rssi;
        candidate.serviceMatched = candidate.serviceMatched || (!info.malformed && info.hasRayNeoService);
        if (name.length > 0) {
          candidate.deviceName = name;
          candidate.nameSource = advertisedName ? '广播名称' : '系统扫描名称';
        }
      }
      this.update(this.report);
    };
    try {
      if (access.getState() !== access.BluetoothState.STATE_ON) {
        this.stop();
        this.report.status = '请先在系统设置开启蓝牙'; this.update(this.report); return;
      }
      // Only existing system bonds: never create/remove a bond automatically.
      for (const id of connection.getPairedDevices()) {
        let name = '';
        try { name = connection.getRemoteDeviceName(id); } catch (_) { continue; }
        if (!candidateName(name)) { continue; }
        if (this.report.candidates.length >= 32) { break; }
        const candidate = new Candidate();
        candidate.id = id;
        candidate.classic = true;
        candidate.deviceName = displayDeviceName(name);
        candidate.nameSource = '系统配对记录';
        candidate.label = `系统已配对候选 ${this.report.candidates.length + 1}`;
        this.report.candidates.push(candidate);
      }
      ble.on('BLEDeviceFind', this.listener);
      // Harmony requires null for an unfiltered scan; [] fails with 401 on API 24.
      // Candidate selection remains local and no connection is made by scanning.
      ble.startBLEScan(null, { interval: 0, dutyMode: ble.ScanDuty.SCAN_MODE_LOW_POWER });
      this.report.scanning = true;
      this.report.status = '扫描中 · 15 秒自动停止';
      this.timer = setTimeout(() => { this.stop(); }, 15000);
      this.update(this.report);
    } catch (error) {
      this.stop();
      this.report.status = `扫描未启动 · 错误码 ${(error as BusinessError).code}`;
      this.update(this.report);
    }
  }

  stop(): void {
    this.gate.cancel();
    if (this.timer !== -1) { clearTimeout(this.timer); this.timer = -1; }
    if (this.listener !== undefined) {
      try { ble.stopBLEScan(); } catch (_) {}
      try { ble.off('BLEDeviceFind', this.listener); } catch (_) {}
      this.listener = undefined;
    }
    if (this.report.scanning) {
      this.report.scanning = false;
      this.report.status = `扫描结束 · ${this.report.candidates.length} 个候选（未认证）`;
      this.update(this.report);
    }
  }
}
