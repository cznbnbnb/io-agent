import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const settle=()=>new Promise(r=>setImmediate(r));
function setup(overrides={}){const streams=[],audioCalls=[],positions=[],errors=[];let configWait;
 class ServiceConfig{asrHost='';asrModel='';asrKey='';modelKey='';uploadToken='';}
 class SecureServiceConfig{async load(){if(configWait)await configWait;return {asrHost:'test.aliyuncs.com',asrModel:'qwen-audio-3.0-asr-flash-streaming',asrKey:'synthetic-asr',modelKey:'do-not-copy',uploadToken:'do-not-copy'};}}
 class ContinuousASR{constructor(){streams.push(this);this.appended=[];}async start(config,task){this.config=config;this.task=task;}append(pcm){this.appended.push(pcm.slice());this.original=pcm;}close(){}}
 const audio={prompterReset(){audioCalls.push('reset');},prompterClose(){audioCalls.push('close');},prompterDecode(buffer){audioCalls.push('decode');audio.packet=new Uint8Array(buffer);return new Uint8Array([1,0,2,0]).buffer;},reset(){throw Error('voice decoder must remain untouched');},close(){throw Error('voice decoder must remain untouched');}};
 const cryptoFramework={createRandom:()=>({generateRandomSync:n=>({data:new Uint8Array(n).fill(7)})})};
 const {TeleprompterFollow}=loadApp('TeleprompterFollow',{'libturbo_audio.so':audio,'./ContinuousASR':{ContinuousASR},'./RemoteServices':{ServiceConfig,SecureServiceConfig},'@kit.CryptoArchitectureKit':{cryptoFramework},...overrides});
 const f=new TeleprompterFollow();f.onPosition=p=>positions.push(p);f.onError=n=>errors.push(n);return {f,streams,audioCalls,positions,errors,audio,wait:p=>configWait=p};}
test('real follow owner copies only ASR config, uses its dedicated decoder, and wipes transient compressed/PCM buffers',async()=>{
 const s=setup();await s.f.prepare('今天完整检查雷鸟眼镜朗读跟随。');await s.f.begin();const stream=s.streams[0];assert.equal(stream.config.asrKey,'synthetic-asr');assert.equal(stream.config.modelKey,'');assert.equal(stream.config.uploadToken,'');
 const underlying=new Uint8Array([99,4,5,99]);s.f.opus(underlying.subarray(1,3));assert.deepEqual([...stream.appended[0]],[1,0,2,0]);assert(s.audio.packet.every(v=>v===0));assert(stream.original.every(v=>v===0));assert.deepEqual([...underlying],[99,4,5,99]);
 stream.onText('今天完整检查雷鸟眼镜朗读跟随',true,1);assert.equal(s.positions.length,1);s.f.pause();const before=s.audioCalls.length;s.f.opus(new Uint8Array([4,5]));assert.equal(s.audioCalls.length,before);s.f.stop();assert.equal(stream.config.asrKey,'');
});
test('local follow neither reads cloud keys nor opens a cloud stream, and synchronous failure cannot be masked by received-audio success',async()=>{
 let loads=0,prepares=0,owner;
 class SecureServiceConfig{load(){loads++;throw Error('cloud key access forbidden');}}
 class PrompterModelStore{initialize(){}async ensure(){return '/synthetic/prompter-ctc-zh-2025-04-01';}}
 class LocalFollowASR{constructor(){owner=this;}async prepare(){prepares++;}async begin(){}pause(){}close(){}append(){this.onError('本机音频积压');}waitForExit(){return Promise.resolve();}}
 const s=setup({'./RemoteServices':{SecureServiceConfig},'./PrompterModel':{PrompterModelStore},'./LocalFollowASR':{LocalFollowASR}}),notes=[];s.f.onStatus=n=>notes.push(n);
 await s.f.prepare('今天完整检查雷鸟眼镜朗读跟随。','local');await s.f.begin();assert.equal(loads,0);assert.equal(s.streams[0].config,undefined);assert.equal(prepares,1);
 owner.onText('今天完整检查雷鸟眼镜朗读跟随',true,1);assert.equal(s.positions.length,1);s.f.opus(new Uint8Array([4,5]));assert.equal(s.errors.at(-1),'本机音频积压');assert(!notes.some(n=>n.startsWith('已收到眼镜跟随音频')));assert.equal(s.f.listening,false);s.f.stop();
});
test('canceled model extraction cannot create a Worker or revive a prepared manuscript',async()=>{
 let release,prepares=0;class PrompterModelStore{ensure(){return new Promise(r=>release=r);}}
 class LocalFollowASR{async prepare(){prepares++;}pause(){}close(){}}
 const s=setup({'./PrompterModel':{PrompterModelStore},'./LocalFollowASR':{LocalFollowASR}});const preparing=s.f.prepare('今天完整检查雷鸟眼镜朗读跟随。','local');s.f.stop();release('/synthetic/prompter-ctc-zh-2025-04-01');await assert.rejects(preparing,/取消/);assert.equal(prepares,0);assert.equal(s.f.matcher,undefined);
});
test('late vault loading or prior ASR output cannot revive an exited or restarted follow owner',async()=>{
 const s=setup();let release;s.wait(new Promise(r=>release=r));const preparing=s.f.prepare('今天完整检查雷鸟眼镜朗读跟随。');await settle();s.f.stop();release();await assert.rejects(preparing,/取消/);assert.equal(s.f.matcher,undefined);
 s.wait(null);await s.f.prepare('今天完整检查雷鸟眼镜朗读跟随。');await s.f.begin();const old=s.streams[0].onText;s.f.pause();await s.f.begin();old('今天完整检查雷鸟眼镜朗读跟随',true,1);assert.equal(s.positions.length,0);s.f.stop();
});
