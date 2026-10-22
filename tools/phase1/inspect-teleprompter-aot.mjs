import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Local original-App inspection only. This is not a firmware capability test.
const root=process.cwd(),lib=path.join(root,'reverse/libapp/libapp.so');
const digest=crypto.createHash('sha256').update(fs.readFileSync(lib)).digest('hex');
if(digest!=='eba61c2b6c161b05da0c68018d81240257eb4986037f746f8646f40f641be6dc')throw Error('original app library differs from inspected baseline');
const pool=new Map();
for(const line of fs.readFileSync(path.join(root,'reverse/blutter-out/pp.txt'),'utf8').split(/\r?\n/)){
 const m=/^\[pp\+0x([0-9a-f]+)\] (.*)$/.exec(line);if(m)pool.set(parseInt(m[1],16),m[2].slice(0,240));
}
const names=new Map();
for(const m of fs.readFileSync(path.join(root,'reverse/blutter-out/ida_script/addNames.py'),'utf8').matchAll(/idaapi\.set_name\(0x([0-9a-f]+), "([^"]+)"\)/g))names.set(parseInt(m[1],16),m[2]);
const ranges=[['position_dispatch',0x14a70b0,0x14a789c],['position_mapper',0x14a7920,0x14a9060],['line_mapper_build',0x14a9060,0x14ab100]];
const dump=path.join(process.env.DEVECO_HOME||'D:/APP/DevEcoStudio','sdk/default/openharmony/native/llvm/bin/llvm-objdump.exe');
const output=[];
for(const [label,start,end] of ranges){
 const result=spawnSync(dump,['-D','--triple=aarch64',`--start-address=0x${start.toString(16)}`,`--stop-address=0x${end.toString(16)}`,lib],{encoding:'utf8',maxBuffer:4*1024*1024});
 if(result.status!==0)throw Error('local disassembly failed');
 const bases=new Map(),rows=[];
 for(const line of result.stdout.split(/\r?\n/)){
  const m=/^\s*([0-9a-f]+):\s+[0-9a-f]{8}\s+([a-z.]+)\s*(.*)$/.exec(line);if(!m)continue;
  const [,,op,args]=m;let reference;
  const load=/^x\d+, \[(x\d+)(?:, #(\d+))?\]/.exec(args);
  if(op==='ldr'&&load){const base=load[1]==='x27'?0:bases.get(load[1]);if(base!==undefined){const offset=base+Number(load[2]||0);if(pool.has(offset))reference={offset:'0x'+offset.toString(16),value:pool.get(offset)};}}
  const call=op==='bl'?/^0x([0-9a-f]+)/.exec(args):undefined;
  const target=call?parseInt(call[1],16):undefined;
  rows.push({address:'0x'+m[1],instruction:op+' '+args,...reference&&{pool:reference},...target!==undefined&&{call:'0x'+target.toString(16),name:names.get(target)||null}});
  const dest=/^(x\d+),/.exec(args);
  if(dest&&!['str','stur','stp','cmp','tst','cbz','cbnz','tbz','tbnz'].includes(op))bases.delete(dest[1]);
  const add=op==='add'?/^(x\d+), x27, #(\d+), lsl #12/.exec(args):undefined;
  if(add)bases.set(add[1],Number(add[2])*4096);
 }
 output.push({label,start:'0x'+start.toString(16),end:'0x'+end.toString(16),rows});
}
const target=path.join(root,'rebuild/phase1/teleprompter-aot-position-2026-10-15.json');
fs.writeFileSync(target,JSON.stringify({kind:'local_aot_linear_annotation',library_sha256:digest,limit:'Pool-register annotation is a linear aid, not full control-flow reconstruction or device verification.',ranges:output},null,2)+'\n');
for(const section of output){console.log(section.label);for(const row of section.rows.filter(v=>v.pool&&/LineMapper|_byteTable|_lineStart|_paragraphOrig|pageOffset|highLightOffset/.test(v.pool.value)))console.log(JSON.stringify(row));}
