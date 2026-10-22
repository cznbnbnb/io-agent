// Executes the actual ETS controller after transpilation; mocked radio is NOT hardware acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as policy from '../turbo_core/src/main/ets/ProbePolicy.ts';

const require = createRequire(import.meta.url);
const deveco = process.env.DEVECO_HOME || '/Applications/DevEco-Studio.app/Contents';
const ts = require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const coreUrl = new URL('../turbo_core/src/main/ets/', import.meta.url);

function setup() {
  const reports = [], timers = new Map(), clients = [], callbacks = [], closedSockets = [], reads = new Map();
  let scanListener, nextTimer = 1;
  const modules = new Map();
  const state = { scanning: false, bluetooth: 2, paired: [] };
  const radio = {
    constant: { ProfileConnectionState: { STATE_CONNECTED: 2, STATE_DISCONNECTED: 0 } },
    access: { BluetoothState: { STATE_ON: 2 }, getState: () => state.bluetooth },
    connection: { getPairedDevices: () => state.paired, getRemoteDeviceName: () => 'RayNeo' },
    ble: {
      ScanDuty: { SCAN_MODE_LOW_POWER: 0 },
      on: (_, fn) => { scanListener = fn; }, off: () => {},
      startBLEScan: filters => {
        // Match native unfiltered-scan contract; [] is not a valid substitute.
        if (filters !== null) throw { code: 401 };
        state.scanning = true;
      }, stopBLEScan: () => { state.scanning = false; },
      createGattClientDevice: () => {
        const client = {
          listener: undefined, closed: false, disconnected: false, services: [],
          on: (_, fn) => { client.listener = fn; }, off: () => {}, connect: () => {},
          disconnect: () => { client.disconnected = true; }, close: () => { client.closed = true; },
          getServices: async () => client.services,
          readCharacteristicValue: async (characteristic) => characteristic
        };
        clients.push(client); return client;
      }
    },
    socket: {
      SppType: { SPP_RFCOMM: 0 },
      sppConnect: (id, options, callback) => { callbacks.push(callback); assert.equal(options.secure, true); },
      sppCloseClientSocket: id => closedSockets.push(id),
      on: (_, id, fn) => reads.set(id, fn), off: (_, id) => reads.delete(id)
      // Deliberately NO sppWrite or characteristic write: probe must not send.
    }
  };
  function load(name) {
    if (name === './ProbePolicy') return policy;
    if (modules.has(name)) return modules.get(name);
    const source = fs.readFileSync(new URL(`${name.replace('./', '')}.ets`, coreUrl), 'utf8');
    const output = ts.transpileModule(source, {
      fileName: 'controller.ts', compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(output, {
      exports: module.exports, module,
      require: id => id === '@kit.ConnectivityKit' ? radio : load(id),
      setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
      clearTimeout: id => timers.delete(id),
      Uint8Array, ArrayBuffer
    });
    modules.set(name, module.exports); return module.exports;
  }
  const probe = new (load('./TransportProbe').TransportProbe)(report => reports.push(structuredClone(report)));
  const discovery = new (load('./Discovery').Discovery)(report => reports.push(structuredClone(report)));
  return { probe, discovery, reports, timers, clients, callbacks, closedSockets, reads, state,
    discover: rows => scanListener(rows),
    last: () => reports.at(-1) };
}
const candidate = (classic = false) => ({ id: 'synthetic-test-device', classic });
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('GATT uses service discovery and never claims authentication', async () => {
  const ctx = setup(); ctx.probe.inspect(candidate());
  ctx.clients[0].listener({ state: 2 }); await settle();
  assert.match(ctx.last().status, /业务未认证/);
  assert.equal(ctx.last().battery, -1);
  assert.match(ctx.last().detail, /未找到标准电量/);
});
test('only standard battery service gets read', async () => {
  const ctx = setup(); ctx.probe.inspect(candidate());
  ctx.clients[0].services = [{ serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb', characteristics: [{
    characteristicUuid: '00002a19-0000-1000-8000-00805f9b34fb', characteristicValue: Uint8Array.of(54).buffer
  }] }];
  ctx.clients[0].listener({ state: 2 }); await settle();
  assert.equal(ctx.last().battery, 54);
});
test('GATT late service result cannot overwrite closed session', async () => {
  const ctx = setup(); ctx.probe.inspect(candidate());
  ctx.clients[0].listener({ state: 2 }); ctx.probe.close(); await settle();
  assert.equal(ctx.last().busy, false);
  assert.equal(ctx.last().services.length, 0);
  assert.equal(ctx.clients[0].closed, true);
});
test('GATT failure releases resources with an error code', async () => {
  const ctx = setup(); ctx.probe.inspect(candidate());
  ctx.clients[0].getServices = async () => { throw { code: 2900099 }; };
  ctx.clients[0].listener({ state: 2 }); await settle();
  assert.match(ctx.last().status, /2900099/);
  assert.equal(ctx.clients[0].closed, true);
  assert.equal(ctx.timers.size, 0);
});
test('SPP success counts bytes only; auto closes at 20 seconds', () => {
  const ctx = setup(); ctx.probe.inspect(candidate(true)); ctx.callbacks[0](undefined, 8);
  ctx.reads.get(8)(new ArrayBuffer(123));
  assert.equal(ctx.last().receivedBytes, 123);
  assert.match(ctx.last().status, /业务未认证/);
  const timer = [...ctx.timers.values()][0]; assert.equal(timer.delay, 20000); timer.fn();
  assert.deepEqual(ctx.closedSockets, [8]); assert.equal(ctx.last().busy, false);
});
test('SPP success arriving after cancellation closes late socket', () => {
  const ctx = setup(); ctx.probe.inspect(candidate(true)); ctx.probe.close();
  ctx.callbacks[0](undefined, 9);
  assert.deepEqual(ctx.closedSockets, [9]); assert.equal(ctx.reads.size, 0);
});
test('SPP old generation cannot overwrite a new attempt', () => {
  const ctx = setup(); ctx.probe.inspect(candidate(true)); ctx.probe.inspect(candidate(true));
  ctx.callbacks[0](undefined, 10); ctx.callbacks[1](undefined, 11);
  assert.deepEqual(ctx.closedSockets, [10]);
  assert.equal(ctx.reads.has(11), true); assert.equal(ctx.reads.has(10), false);
});
test('SPP negative socket is rejected', () => {
  const ctx = setup(); ctx.probe.inspect(candidate(true)); ctx.callbacks[0](undefined, -1);
  assert.match(ctx.last().status, /失败/); assert.equal(ctx.reads.size, 0);
});
test('SPP error cancels timeout without retrying', () => {
  const ctx = setup(); ctx.probe.inspect(candidate(true)); ctx.callbacks[0]({ code: 2900004 }, -1);
  assert.match(ctx.last().status, /2900004/); assert.equal(ctx.timers.size, 0);
  assert.equal(ctx.callbacks.length, 1);
});
test('scanning has 15-second bound, filters and deduplicates', () => {
  const ctx = setup(); ctx.discovery.start();
  const good = { deviceId: 'one', deviceName: '', data: Uint8Array.of(3, 3, 0x1d, 0xb8).buffer, rssi: -55 };
  const other = { deviceId: 'two', deviceName: 'unrelated', data: new ArrayBuffer(0), rssi: -55 };
  ctx.discover([good, good, other]); assert.equal(ctx.last().candidates.length, 1);
  const timer = [...ctx.timers.values()][0]; assert.equal(timer.delay, 15000); timer.fn();
  assert.equal(ctx.last().scanning, false); assert.equal(ctx.state.scanning, false);
  ctx.discover([{ ...good, deviceId: 'late' }]); assert.equal(ctx.last().candidates.length, 1);
});
test('bluetooth off does not attempt discovery', () => {
  const ctx = setup(); ctx.state.bluetooth = 0; ctx.discovery.start();
  assert.equal(ctx.state.scanning, false); assert.equal(ctx.timers.size, 0);
  assert.match(ctx.last().status, /开启蓝牙/);
});

test('discovery retains genuine names through nameless later advertisements', () => {
  const ctx = setup(); ctx.discovery.start();
  const row = {deviceId:'synthetic',deviceName:'RayNeo test',data:Uint8Array.of(3,3,0x1d,0xb8).buffer,rssi:-50};
  ctx.discover([row]);
  assert.equal(ctx.last().candidates[0].deviceName, 'RayNeo test');
  ctx.discover([{...row,deviceName:''}]);
  assert.equal(ctx.last().candidates[0].deviceName, 'RayNeo test');
});
test('GATT reads only standard name, records origin, and preserves metadata', async () => {
  const ctx = setup(); ctx.probe.inspect(candidate());
  const name = {characteristicUuid:'00002a00-0000-1000-8000-00805f9b34fb',characteristicValue:new TextEncoder().encode('RayNeo synthetic').buffer,properties:{read:true}};
  ctx.clients[0].services = [{serviceUuid:'00001800-0000-1000-8000-00805f9b34fb',characteristics:[name]},
    {serviceUuid:'0000b81d-0000-1000-8000-00805f9b34fb',characteristics:[{characteristicUuid:'private',properties:{notify:true}}]}];
  const requested=[]; ctx.clients[0].readCharacteristicValue=async c=>{requested.push(c.characteristicUuid);return c;};
  ctx.clients[0].listener({state:2}); await settle();
  assert.deepEqual(requested,[name.characteristicUuid]);
  assert.equal(ctx.last().deviceName,'RayNeo synthetic');
  assert.equal(ctx.last().nameSource,'眼镜 GATT 1800/2A00');
  assert.ok(ctx.last().services.some(s=>s.includes('通知=true')));
});
test('name read failure is nonfatal and late results cannot replace a new session', async () => {
  const ctx=setup();ctx.probe.inspect(candidate());
  const name={characteristicUuid:'00002a00-0000-1000-8000-00805f9b34fb',characteristicValue:new TextEncoder().encode('old').buffer};
  ctx.clients[0].services=[{serviceUuid:'00001800-0000-1000-8000-00805f9b34fb',characteristics:[name]}];
  ctx.clients[0].readCharacteristicValue=async()=>{throw {code:2900099};};
  ctx.clients[0].listener({state:2});await settle();
  assert.equal(ctx.last().busy,true);assert.match(ctx.last().nameStatus,/2900099/);
  let resolve;ctx.clients[0].readCharacteristicValue=()=>new Promise(r=>{resolve=r;});
  ctx.clients[0].listener({state:2});await settle();
  ctx.probe.close();ctx.probe.inspect(candidate());resolve(name);await settle();
  assert.equal(ctx.last().deviceName,'');assert.equal(ctx.last().nameStatus,'尚未读取标准设备名称');
});
