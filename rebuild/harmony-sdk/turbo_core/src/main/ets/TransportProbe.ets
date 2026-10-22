import { ble, socket, constant } from '@kit.ConnectivityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { AttemptGate, validBattery, decodeDeviceName } from './ProbePolicy';
import { Candidate } from './Discovery';

export class ProbeReport {
  status: string = '未连接';
  detail: string = '传输诊断不代表眼镜业务认证成功';
  services: string[] = [];
  battery: number = -1;
  receivedBytes: number = 0;
  busy: boolean = false;
  deviceName: string = '';
  nameSource: string = '';
  nameStatus: string = '尚未读取标准设备名称';
}

export class TransportProbe {
  private gate: AttemptGate = new AttemptGate();
  private gatt: ble.GattClientDevice | undefined = undefined;
  private socketId: number = -1;
  private timer: number = -1;
  private report: ProbeReport = new ProbeReport();
  private update: (value: ProbeReport) => void;
  private gattListener: ((state: ble.BLEConnectionChangeState) => void) | undefined = undefined;
  private sppListener: ((bytes: ArrayBuffer) => void) | undefined = undefined;

  constructor(update: (value: ProbeReport) => void) { this.update = update; }

  inspect(candidate: Candidate): void {
    this.close();
    this.report = new ProbeReport();
    this.report.deviceName = candidate.deviceName || '';
    this.report.nameSource = candidate.nameSource || '';
    this.report.busy = true;
    this.report.status = '正在建立诊断连接';
    const token = this.gate.begin();
    this.timer = setTimeout(() => {
      if (!this.gate.accepts(token)) { return; }
      this.close();
      this.report.status = '诊断已结束 · 20 秒保护';
      this.report.detail = '保留本轮结果；没有执行业务认证或发送业务指令';
      this.update(this.report);
    }, 20000);
    this.update(this.report);
    try {
      if (candidate.classic) { this.inspectSpp(candidate.id, token); }
      else { this.inspectGatt(candidate.id, token); }
    } catch (error) { this.fail(token, (error as BusinessError).code); }
  }

  private inspectGatt(id: string, token: number): void {
    try {
    const client = ble.createGattClientDevice(id);
    this.gatt = client;
    this.gattListener = (event: ble.BLEConnectionChangeState): void => {
      if (!this.gate.accepts(token)) { return; }
      if (event.state === constant.ProfileConnectionState.STATE_CONNECTED) {
        this.report.status = 'GATT 已连接 · 业务未认证';
        this.update(this.report);
        this.readServices(client, token);
      } else if (event.state === constant.ProfileConnectionState.STATE_DISCONNECTED) {
        this.close();
        this.report.status = 'GATT 已断开';
        this.update(this.report);
      }
    };
    client.on('BLEConnectionStateChange', this.gattListener);
    client.connect();
    } catch (error) { this.fail(token, (error as BusinessError).code); }
  }

  private async readServices(client: ble.GattClientDevice, token: number): Promise<void> {
    try {
      const services = await client.getServices();
      if (!this.gate.accepts(token)) { return; }
      this.report.services = [];
      let battery: ble.BLECharacteristic | undefined = undefined;
      let deviceName: ble.BLECharacteristic | undefined = undefined;
      for (const service of services) {
        this.report.services.push(service.serviceUuid);
        for (const characteristic of service.characteristics) {
          this.report.services.push(`  ${characteristic.characteristicUuid}`);
          const properties = characteristic.properties;
          if (properties !== undefined) {
            this.report.services.push(`    属性：读=${properties.read === true} 写=${properties.write === true} 无响应写=${properties.writeNoResponse === true} 通知=${properties.notify === true} 指示=${properties.indicate === true}`);
          }
          if (service.serviceUuid.toLowerCase() === '00001800-0000-1000-8000-00805f9b34fb' &&
            characteristic.characteristicUuid.toLowerCase() === '00002a00-0000-1000-8000-00805f9b34fb') {
            deviceName = characteristic;
          }
          if (service.serviceUuid.toLowerCase() === '0000180f-0000-1000-8000-00805f9b34fb' &&
            characteristic.characteristicUuid.toLowerCase() === '00002a19-0000-1000-8000-00805f9b34fb') {
            battery = characteristic;
          }
        }
      }
      this.report.detail = '服务发现完成；仅读标准名称和标准电量，不读私有特征、不订阅音频';
      this.update(this.report);
      if (deviceName !== undefined) {
        try {
          const named = await client.readCharacteristicValue(deviceName);
          if (!this.gate.accepts(token)) { return; }
          const name = decodeDeviceName(new Uint8Array(named.characteristicValue));
          this.report.nameStatus = name ? '标准设备名称读取成功' : '标准名称为空或 UTF-8 无效';
          if (name) { this.report.deviceName = name; this.report.nameSource = '眼镜 GATT 1800/2A00'; }
        } catch (error) {
          if (!this.gate.accepts(token)) { return; }
          this.report.nameStatus = `标准名称读取失败 · 错误码 ${(error as BusinessError).code}`;
        }
      } else { this.report.nameStatus = '未找到标准名称特征 2A00'; }
      this.update(this.report);
      if (battery !== undefined) {
        const result = await client.readCharacteristicValue(battery);
        if (!this.gate.accepts(token)) { return; }
        this.report.battery = validBattery(new Uint8Array(result.characteristicValue));
        this.update(this.report);
      } else {
        this.report.detail = '未找到标准电量服务；私有电量协议须完成认证后再接入';
        this.update(this.report);
      }
    } catch (error) { this.fail(token, (error as BusinessError).code); }
  }

  private inspectSpp(id: string, token: number): void {
    // Static candidate from Android 1.0.4 V3.p. Not an identity or auth proof.
    const options: socket.SppOptions = {
      uuid: '99999999-9999-9999-9999-999999999999',
      secure: true,
      type: socket.SppType.SPP_RFCOMM
    };
    socket.sppConnect(id, options, (error: BusinessError, socketId: number): void => {
      if (!this.gate.accepts(token)) {
        if (!error && socketId >= 0) { try { socket.sppCloseClientSocket(socketId); } catch (_) {} }
        return;
      }
      if (error) { this.fail(token, error.code); return; }
      if (!Number.isInteger(socketId) || socketId < 0) { this.fail(token, 2900099); return; }
      this.socketId = socketId;
      this.sppListener = (bytes: ArrayBuffer): void => {
        if (!this.gate.accepts(token)) { return; }
        // Keep counts only. Never persist raw frames, authentication material or audio.
        this.report.receivedBytes += bytes.byteLength;
        this.update(this.report);
      };
      try {
        socket.on('sppRead', socketId, this.sppListener);
        this.report.status = 'SPP 已连接 · 业务未认证';
        this.report.detail = '只统计接收字节数；不发送、不保存报文；20 秒后关闭';
        this.update(this.report);
      } catch (caught) { this.fail(token, (caught as BusinessError).code); }
    });
  }

  private fail(token: number, code: number): void {
    if (!this.gate.accepts(token)) { return; }
    this.close();
    this.report.status = `连接／发现失败 · 错误码 ${code}`;
    this.report.detail = '没有自动重试、解绑或重置；服务不匹配和业务认证失败不是同一件事';
    this.update(this.report);
  }

  close(): void {
    this.gate.cancel();
    if (this.timer !== -1) { clearTimeout(this.timer); this.timer = -1; }
    if (this.gatt !== undefined) {
      if (this.gattListener !== undefined) {
        try { this.gatt.off('BLEConnectionStateChange', this.gattListener); } catch (_) {}
      }
      try { this.gatt.disconnect(); } catch (_) {}
      try { this.gatt.close(); } catch (_) {}
      this.gatt = undefined;
      this.gattListener = undefined;
    }
    if (this.socketId >= 0) {
      if (this.sppListener !== undefined) {
        try { socket.off('sppRead', this.socketId, this.sppListener); } catch (_) {}
      }
      try { socket.sppCloseClientSocket(this.socketId); } catch (_) {}
      this.socketId = -1;
      this.sppListener = undefined;
    }
    this.report.busy = false;
    this.report.status = '诊断连接已关闭';
    this.update(this.report);
  }
}
