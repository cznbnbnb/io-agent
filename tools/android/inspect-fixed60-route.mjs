// Source evidence for the exact host's SDK submission path, not a runtime/OTA acceptance test.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {HOST,classFile} from '../../rebuild/android-app/host-107.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app'),host=path.join(root,'build/host-107');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const input=path.join(root,'.private/hosts/RayNeo-1.0.7-230-original.apk');
if(sha(fs.readFileSync(input))!==HOST.sha256)throw new Error('Pinned host input differs');
function method(descriptor,headers,required){
 const file=classFile(host,descriptor),source=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
 // A patched stage contains both the saved original and its guard wrapper; prefer the saved original.
 const header=headers.find(header=>source.split(header+'\n').length===2);if(!header)throw new Error('Missing unique SDK method '+descriptor);
 const start=source.indexOf(header+'\n'),end=source.indexOf('.end method',start);if(end<start)throw new Error('Incomplete SDK method');
 const body=source.slice(start,end+11);for(const anchor of required)if(!body.includes(anchor))throw new Error('SDK route changed: '+anchor);
 return {descriptor,file:path.relative(host,file),method:header,sha256:sha(body),required};
}
const manager=method('LY3/u;',['.method public final t(LY3/S;Lkotlin/jvm/functions/Function2;)V'],[
 'iput-object p2, p1, LY3/S;->k:Lkotlin/jvm/functions/Function2;',
 'iput-object p0, p1, LY3/S;->j:Lk4/p;',
 'invoke-static {p1}, LY3/V;->o(LY3/S;)V',
 'invoke-interface {p2, p1, p0}, Lkotlin/jvm/functions/Function2;->invoke(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;'
]);
const queue=method('LY3/V;',['.method public static ioAgentOriginal_o(LY3/S;)V','.method public static o(LY3/S;)V'],[
 'iget-object v2, p0, LY3/S;->b:Ljava/lang/String;',
 'invoke-static {v2}, LY3/V;->h(Ljava/lang/String;)Lj4/u;',
 'invoke-static {v4, p0, v5, v3}, LY3/b0;->b(LY3/b0;LY3/S;LY3/x;Lj4/w;)LY3/p;',
 'invoke-virtual {v5, v4, p0}, Ljava/util/concurrent/ConcurrentHashMap;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;',
 'invoke-static {p0, v3}, Lcc/c;->t(Lk4/b;LY3/p;)V'
]);
const resolver=method('LY3/b0;',['.method public static b(LY3/b0;LY3/S;LY3/x;Lj4/w;)LY3/p;'],[
 'iget-object v4, v0, LY3/S;->e:[B',
 'iget-object v8, v0, LY3/S;->c:Lj4/h;',
 'iput-object v4, v7, Lq4/e;->e:[B',
 'invoke-virtual {v7}, Lq4/e;->a()Lq4/f;',
 'invoke-virtual {v4}, Lq4/f;->a()[B',
 'Current linked device is nil'
]);
const result={schema:1,at:new Date().toISOString(),kind:'static source evidence from pinned host decode; original SDK submission bodies retained',host:HOST.version,host_apk_sha256:HOST.sha256,proofs:[manager,queue,resolver],conclusions:{submission_enters_queue_synchronously_with_same_message_object:true,sdk_owns_rnlink_frame_resolution:true,sdk_requires_current_linked_device:true,callback_is_not_installation_or_boot_proof:true},remaining:['Exercise the owned SDK send/receipt adapter in the full APK.','Review actual 1.0.7 Dart official download/install route; no 1.0.5 libapp offsets reused.','Fresh real-glasses boot/idle, candidate install/boot and lens observations remain unverified.'],native_library_modified:false,device_io:false,runtime_tested:false};
fs.writeFileSync(path.join(root,'fixed60-107-route-audit.json'),JSON.stringify(result,null,2)+'\n');console.log('Android107 OTA SDK source route: 3 method proofs; no device/network/native-library write.');
