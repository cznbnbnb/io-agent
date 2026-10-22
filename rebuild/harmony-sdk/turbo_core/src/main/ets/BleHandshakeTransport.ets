import { ble, constant } from '@kit.ConnectivityKit';
import { util } from '@kit.ArkTS';
import { isOtaOutbound } from './FirmwareOta';
import { decodeFrame, decodeTlvs, authFields } from './ProtocolCodec';
import { readLauncherEnvelope } from './LauncherStatus';
import { fileMessage,readFileMessage } from './FileTransfer';
import { isPrompterCatalogAdd,MAX_PROMPTER_CATALOG_FRAME } from './TeleprompterCatalogProfile';
import { isSingleTodoDeleteJson } from './TodoCommands';

export const HANDSHAKE_SERVICE: string = '0000b81d-0000-1000-8000-00805f9b34fb';
export const HANDSHAKE_TX: string = 'ea8b70d5-2bd3-49ab-9c31-9c38b2c3c4f9';
export const HANDSHAKE_RX: string = '7db3e235-3608-41f3-a03c-955fcbd2ea4b';
export type BleHandshakeStage = 'idle' | 'connecting' | 'discovering' | 'mtu' | 'subscribing' | 'ready' | 'closed' | 'failed';
export class BleHandshakeReport {
  stage: BleHandshakeStage = 'idle';
  generation: number = 0;
  mtu: number = 23;
  txBytes: number = 0;
  rxBytes: number = 0;
  reason: string = '';
}

// Default: short handshake experiments. After verified authentication, owner may
// retain the foreground link and send only the explicitly enabled business types.
// Never unbind, persist RX, retry uncertain writes, or change frame metadata.
// Only protobuf file businesses 17/18 may span ATT writes. Official
// RNTransferSender uses 17 for SmallCore and 18 for FILE_TRANSFER_LAUNCHER.
// Owner must close on background. Native write completion is NOT a device ACK.
export class BleHandshakeTransport {
  private client: ble.GattClientDevice | undefined = undefined;
  private tx: ble.BLECharacteristic | undefined = undefined;
  private report: BleHandshakeReport = new BleHandshakeReport();
  private generation: number = 0;
  private active: boolean = false;
  private authenticatedLease: boolean = false;
  private lifetime: number = -1;
  private mtuTimer: number = -1;
  private writeTimer: number = -1;
  private writeBusy: boolean = false;
  private firmwareLease:boolean=false;
  private rejectWrite: ((error: Error) => void) | undefined = undefined;
  private connectionListener: ((state: ble.BLEConnectionChangeState) => void) | undefined = undefined;
  private valueListener: ((value: ble.BLECharacteristic) => void) | undefined = undefined;
  private mtuListener: ((mtu: number) => void) | undefined = undefined;
  private update: (report: BleHandshakeReport) => void;
  private received: (generation: number, bytes: Uint8Array) => void;
  constructor(update: (report: BleHandshakeReport) => void,
    received: (generation: number, bytes: Uint8Array) => void) {
    this.update = update; this.received = received;
  }

  snapshot(): BleHandshakeReport {
    const r = new BleHandshakeReport();
    r.stage = this.report.stage; r.generation = this.report.generation; r.mtu = this.report.mtu;
    r.txBytes = this.report.txBytes; r.rxBytes = this.report.rxBytes; r.reason = this.report.reason;
    return r;
  }
  private emit(): void { this.update(this.snapshot()); }
  private current(token: number): boolean { return this.active && token === this.generation; }
  open(deviceId: string): number {
    if (this.active) throw new Error('transport-busy');
    if (!deviceId || deviceId.length > 128 || this.generation >= Number.MAX_SAFE_INTEGER - 1) throw new Error('transport-input');
    const token = ++this.generation;
    this.report = new BleHandshakeReport(); this.report.generation = token;
    this.report.stage = 'connecting'; this.active = true;
    this.authenticatedLease = false;
    this.firmwareLease=false;
    this.lifetime = setTimeout(() => { if (this.current(token)) this.stop('failed', 'transport-timeout'); }, 20000);
    try {
      const client = ble.createGattClientDevice(deviceId); this.client = client;
      this.connectionListener = (event: ble.BLEConnectionChangeState): void => {
        if (!this.current(token)) return;
        if (event.state === constant.ProfileConnectionState.STATE_CONNECTED && this.report.stage === 'connecting') {
          this.report.stage = 'discovering'; this.emit();
          if (this.current(token)) this.discover(client, token);
        } else if (event.state === constant.ProfileConnectionState.STATE_DISCONNECTED) this.stop('failed', 'disconnected');
      };
      this.valueListener = (value: ble.BLECharacteristic): void => {
        if (!this.current(token) || this.report.stage !== 'ready' ||
          value.serviceUuid.toLowerCase() !== HANDSHAKE_SERVICE || value.characteristicUuid.toLowerCase() !== HANDSHAKE_RX) return;
        const size = value.characteristicValue.byteLength;
        if (size < 1 || size > this.report.mtu - 3 || (!this.authenticatedLease && this.report.rxBytes + size > 8192)) {
          this.stop('failed', 'receive-limit'); return;
        }
        this.report.rxBytes += size;
        const bytes = new Uint8Array(value.characteristicValue.slice(0));
        try { this.received(token, bytes); } catch (_) { if (this.current(token)) this.stop('failed', 'receive-handler'); }
        finally { bytes.fill(0); }
        if (this.current(token)) this.emit();
      };
      this.mtuListener = (mtu: number): void => {
        if (!this.current(token)) return;
        if (!Number.isInteger(mtu) || mtu < 23 || mtu > 517) { this.stop('failed', 'invalid-mtu'); return; }
        // A late negotiation after fallback must not change capacity mid-write.
        if (this.report.stage === 'mtu') this.finishMtu(client, token, mtu);
      };
      client.on('BLEConnectionStateChange', this.connectionListener);
      client.on('BLECharacteristicChange', this.valueListener);
      client.on('BLEMtuChange', this.mtuListener);
      this.emit();
      if (this.current(token)) client.connect();
    } catch (_) { if (this.current(token)) this.stop('failed', 'connect-failed'); }
    return token;
  }
  private rx: ble.BLECharacteristic | undefined = undefined;
  private async discover(client: ble.GattClientDevice, token: number): Promise<void> {
    try {
      const services = await client.getServices(); if (!this.current(token)) return;
      const matches = services.filter(s => s.serviceUuid.toLowerCase() === HANDSHAKE_SERVICE);
      if (matches.length !== 1) throw new Error('service-mismatch');
      const tx = matches[0].characteristics.filter(c => c.characteristicUuid.toLowerCase() === HANDSHAKE_TX);
      const rx = matches[0].characteristics.filter(c => c.characteristicUuid.toLowerCase() === HANDSHAKE_RX);
      if (tx.length !== 1 || rx.length !== 1 || tx[0].serviceUuid.toLowerCase() !== HANDSHAKE_SERVICE ||
        rx[0].serviceUuid.toLowerCase() !== HANDSHAKE_SERVICE || tx[0].properties?.writeNoResponse !== true ||
        rx[0].properties?.notify !== true) throw new Error('characteristic-mismatch');
      this.tx = tx[0]; this.rx = rx[0]; this.report.stage = 'mtu'; this.emit();
      if (!this.current(token)) return;
      this.mtuTimer = setTimeout(() => { if (this.current(token) && this.report.stage === 'mtu') this.finishMtu(client, token, 23); }, 2000);
      try { client.setBLEMtuSize(512); } catch (_) { this.finishMtu(client, token, 23); }
    } catch (_) { if (this.current(token)) this.stop('failed', 'discovery-failed'); }
  }
  private async finishMtu(client: ble.GattClientDevice, token: number, mtu: number): Promise<void> {
    if (!this.current(token) || this.report.stage !== 'mtu' || this.rx === undefined) return;
    if (this.mtuTimer !== -1) clearTimeout(this.mtuTimer); this.mtuTimer = -1;
    this.report.mtu = mtu; this.report.stage = 'subscribing'; this.emit();
    if (!this.current(token)) return;
    try {
      await client.setCharacteristicChangeNotification(this.rx, true);
      if (!this.current(token)) return;
      this.report.stage = 'ready'; this.emit();
    } catch (_) { if (this.current(token)) this.stop('failed', 'subscription-failed'); }
  }
  async send(token: number, bytes: Uint8Array): Promise<void> {
    if (!this.current(token) || this.report.stage !== 'ready' || this.client === undefined || this.tx === undefined) throw new Error('transport-not-ready');
    if (this.writeBusy) throw new Error('write-busy');
    // Only the two unfragmented, unencrypted handshake request forms are allowed.
    const frame = decodeFrame(bytes);
    if (frame.flags !== 0 || frame.address !== null || frame.slices.length !== 0) throw new Error('handshake-frame-profile');
    // ACK replies (head 0x55AA) carry no payload, only flow after authentication,
    // and skip the business whitelist below to reuse the common write path.
    if (frame.response && (!this.authenticatedLease || frame.payload.length !== 0)) throw new Error('handshake-frame-profile');
    const fileTransfer = !frame.response && this.authenticatedLease && [17,18].includes(frame.businessID);
    const catalogTransfer = !frame.response&&this.authenticatedLease&&frame.businessID===20&&isPrompterCatalogAdd(frame.payload);
    const otaTransfer=!frame.response&&this.authenticatedLease&&frame.businessID===9&&isOtaOutbound(frame.payload,this.firmwareLease);
    if(!frame.response&&this.firmwareLease&&frame.businessID!==9)throw new Error('firmware-exclusive');
    if (frame.response) { /* ACK frame: validated above. */ }
    else if(otaTransfer){if(bytes.length>52032)throw new Error('ota-send-profile');}
    else if(fileTransfer){const m=readFileMessage(frame.payload);try{if(![1,4,6].includes(m.type)||bytes.length>22010||(m.type===1&&m.busId!==frame.businessID))throw new Error('file-send-profile');fileMessage(m).fill(0);}finally{m.data.fill(0);}}
    else if(catalogTransfer){if(bytes.length>MAX_PROMPTER_CATALOG_FRAME)throw new Error('catalog-send-profile');}
    else if (this.authenticatedLease && [13,14,15,19,20,21,22].includes(frame.businessID)) {
      const envelope = readLauncherEnvelope(frame.payload);
      const types = frame.businessID === 21 ? [2,18,33,35] : frame.businessID === 20 ? [2,3,4,5,6,7,8] : frame.businessID === 14 ? [1,4,8,9,11,14] : frame.businessID === 22 ? [2,15] : frame.businessID === 15 ? [1,2,4,5,16,17,18,20] : frame.businessID === 13 ? [2,4,5,7,12,32,162,166,168] : [3,5,7];
      const singleTodoDelete = frame.businessID === 22 && envelope.type === 7 && envelope.binary.length === 0 && isSingleTodoDeleteJson(envelope.json);
      let prompterStateQuery:boolean=false;
      if(frame.businessID===20&&envelope.type===10&&envelope.binary.length===0){
        try{
          const query=JSON.parse(new util.TextDecoder().decodeToString(envelope.json)) as Record<string,Object>;
          prompterStateQuery=query!==null&&typeof query==='object'&&!Array.isArray(query)&&Object.keys(query).length===2&&
            query['action']===1&&typeof query['did']==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(query['did'] as string);
        }catch(_){/* Only the bounded, read-only request form is enabled. */}
      }
      if (!types.includes(envelope.type) && !singleTodoDelete && !prompterStateQuery) throw new Error('business-type-not-enabled');
    } else {
      if (frame.businessID !== 0x10) throw new Error('handshake-frame-profile');
      const outer = decodeTlvs(frame.payload);
      if (outer.length !== 1 || (outer[0].tag !== 0x11 && outer[0].tag !== 0x18)) throw new Error('handshake-message-only');
      if (outer[0].tag === 0x18) authFields(frame.payload, 0x18);
    }
    if (!fileTransfer && !catalogTransfer && !otaTransfer && bytes.length > this.report.mtu - 3) throw new Error('mtu-too-small-no-fragmentation');
    if (!this.authenticatedLease && this.report.txBytes + bytes.length > 1024) throw new Error('transmit-limit');
    const buffer = bytes.slice(); const client = this.client;
    this.writeBusy = true;
    try {
      for(let offset=0;offset<buffer.length;offset+=this.report.mtu-3){
      if(!this.current(token))throw new Error('transport-closed');
      const part=buffer.slice(offset,Math.min(buffer.length,offset+this.report.mtu-3));
      const characteristic: ble.BLECharacteristic = { serviceUuid: HANDSHAKE_SERVICE,
        characteristicUuid: HANDSHAKE_TX, characteristicValue: part.buffer, descriptors: [] };
      try{
      await new Promise<void>((resolve, reject) => {
        this.rejectWrite = reject;
        this.writeTimer = setTimeout(() => { if (this.current(token)) this.stop('failed', 'write-timeout'); }, 1500);
        client.writeCharacteristicValue(characteristic, ble.GattWriteType.WRITE_NO_RESPONSE).then(() => {
          if (!this.current(token)) return;
          resolve();
        }).catch(() => { if (this.current(token)) this.stop('failed', 'write-failed'); });
      });
      if (!this.current(token)) throw new Error('transport-closed');
      this.report.txBytes += part.length;
      // OTA slices are 51200-byte bursts of WRITE_NO_RESPONSE. Give the
      // controller/peer more drain time than ordinary business writes; a too
      // tight loop can exhaust the peer's slice retries before it can ask again.
      if(otaTransfer)await new Promise<void>((resolve):void=>{setTimeout(resolve,12);});
      }finally{part.fill(0);if(token===this.generation){if(this.writeTimer!==-1)clearTimeout(this.writeTimer);this.writeTimer=-1;this.rejectWrite=undefined;}}
      }
    } catch (error) {
      // 保留真实原因：write-failed / write-timeout / transport-closed 等
      const detail=(error as Error).message;
      if (this.current(token)) this.stop('failed', 'write-failed');
      throw new Error('handshake-write-failed:'+detail);
    } finally {
      buffer.fill(0);
      if (token === this.generation) {
        if (this.writeTimer !== -1) clearTimeout(this.writeTimer);
        this.writeTimer = -1; this.rejectWrite = undefined; this.writeBusy = false;
        if (this.current(token)) this.emit();
      }
    }
  }
  close(): void { if (this.active) this.stop('closed', 'cancelled'); }
  setFirmwareLease(token:number,value:boolean):void{
    if(!this.current(token)||!this.authenticatedLease||this.report.stage!=='ready'||this.writeBusy)throw new Error('ota-lease-not-ready');
    this.firmwareLease=value;
  }
  // Owner may retain a foreground session only AFTER verifying this connection's
  // peer proof. This does not enable business writes or imply initialization.
  retainAuthenticatedSession(token: number): void {
    if (!this.current(token) || this.report.stage !== 'ready' || this.writeBusy) throw new Error('transport-not-ready');
    this.authenticatedLease = true;
    if (this.lifetime !== -1) clearTimeout(this.lifetime);
    this.lifetime = -1;
  }
  private stop(stage: BleHandshakeStage, reason: string): void {
    this.active = false;
    for (const timer of [this.lifetime, this.mtuTimer, this.writeTimer]) if (timer !== -1) clearTimeout(timer);
    this.lifetime = -1; this.mtuTimer = -1; this.writeTimer = -1;
    const reject = this.rejectWrite; this.rejectWrite = undefined; this.writeBusy = false;
    const client = this.client; this.client = undefined; this.tx = undefined; this.rx = undefined;
    this.report.stage = stage; this.report.reason = reason;
    if (client !== undefined) {
      try { if (this.connectionListener !== undefined) client.off('BLEConnectionStateChange', this.connectionListener); } catch (_) {}
      try { if (this.valueListener !== undefined) client.off('BLECharacteristicChange', this.valueListener); } catch (_) {}
      try { if (this.mtuListener !== undefined) client.off('BLEMtuChange', this.mtuListener); } catch (_) {}
      try { client.disconnect(); } catch (_) {}
      try { client.close(); } catch (_) {}
    }
    this.connectionListener = undefined; this.valueListener = undefined; this.mtuListener = undefined;
    if (reject !== undefined) reject(new Error(reason));
    this.emit();
  }
}
