// Runs actual TS/ETS sources with explicit mocked platform modules, not a replica.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const deveco=process.env.DEVECO_HOME || '/Applications/DevEco-Studio.app/Contents';
const ts=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
export function loadCore(entry, platform={}, globals={}) {
 const cache=new Map();
 function load(name) {
  if(Object.hasOwn(platform,name))return platform[name];
  if(name==='@kit.ArkTS')return {util:{TextDecoder:class{constructor(name='utf-8',options={fatal:true}){this.decoder=new TextDecoder(name,options);}decodeToString(bytes){return this.decoder.decode(bytes);}}}};
  if(!/^\.\/[A-Za-z][A-Za-z0-9]*$/.test(name))throw Error('Unexpected module '+name);
  if(cache.has(name))return cache.get(name);
  const stem=fileURLToPath(new URL(`../turbo_core/src/main/ets/${name.slice(2)}`,import.meta.url));
  const file=fs.existsSync(`${stem}.ts`)?`${stem}.ts`:`${stem}.ets`;
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:'core.ts',compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(output,{module,exports:module.exports,require:load,Uint8Array,ArrayBuffer,Error,...globals});
  cache.set(name,module.exports);return module.exports;
 }
 return load(entry);
}
