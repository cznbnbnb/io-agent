import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';

const directory=fileURLToPath(new URL('./skills/cz-lifelog-correct/',import.meta.url));
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Offline access to the same complete workflow shipped by the updater. */
export function lifelogSkill(args=[]){
 const [action,...values]=args;
 if(![undefined,'read','check'].includes(action)||action==='read'&&values.length>1||action!=='read'&&values.length)fail('SKILL_ARGUMENT_INVALID');
 const bundle=JSON.parse(fs.readFileSync(path.join(directory,'BUNDLE.json'),'utf8'));
 if(bundle.format!=='cz-lifelog-correct-bundle/1'||bundle.name!=='cz-lifelog-correct'||!Number.isSafeInteger(bundle.version)||bundle.version<1)fail('SKILL_BUNDLE_INVALID');
 const info={name:bundle.name,version:bundle.version,directory,entrypoint:path.join(directory,bundle.entrypoint),helper:path.join(directory,bundle.helper),files:Object.keys(bundle.files),read_command:'cz-iot-cli skill read',check_command:'cz-iot-cli skill check',helper_argv:['python',path.join(directory,bundle.helper)],content_role:'cli_guidance',requires_agent_evidence_review:true};
 if(action==='read'){
  const file=values[0]??bundle.entrypoint;if(!Object.hasOwn(bundle.files,file))fail('SKILL_FILE_NOT_FOUND');
  return{name:info.name,version:info.version,file,path:path.join(directory,file),content_role:'cli_guidance',content:fs.readFileSync(path.join(directory,file),'utf8')};
 }
 if(action==='check'){
  for(const [name,digest] of Object.entries(bundle.files))if(createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')!==digest)fail('SKILL_FILE_HASH_MISMATCH');
  return{...info,verified:true,checked_files:Object.keys(bundle.files).length};
 }
 return info;
}
