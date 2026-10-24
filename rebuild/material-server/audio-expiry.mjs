import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const AUDIO_DB_APP_ID=0x694f4175;

/** Shared expiry rule. Caller owns the audio transaction; no text access. */
export function pruneExpiredAudio(db,now){
  if(!Number.isSafeInteger(now)||now<0)throw Error('AUDIO_EXPIRY_CLOCK');
  let objects=0,parts=0;
  for(const row of db.prepare("SELECT object_id,state FROM audio_objects WHERE (state='stored' AND expires<=?) OR (state='uploading' AND upload_expires<=?)").all(now,now)){
    parts+=db.prepare('DELETE FROM audio_parts WHERE object_id=?').run(row.object_id).changes;
    db.prepare('UPDATE audio_objects SET state=? WHERE object_id=?').run(row.state==='stored'?'expired':'abandoned',row.object_id);
    objects++;
  }
  return {objects,parts,at:new Date(now).toISOString()};
}

/** Standalone fallback survives a code rollback or stopped HTTP service.
 * It opens only an existing, explicitly bound audio database. No credentials,
 * text database, HTTP, object download or deadline rewrite is involved. */
export function expireAudioFile(file,serverId,{clock=Date.now}={}){
  if(!path.isAbsolute(file)||!file.endsWith('.audio.sqlite')||!/^[A-Za-z0-9_.-]{1,128}$/.test(serverId??''))throw Error('AUDIO_EXPIRY_ARGUMENT');
  const parent=path.dirname(file);
  if(fs.realpathSync(parent)!==parent)throw Error('AUDIO_EXPIRY_PATH');
  let info;
  try{info=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return {absent:true,objects:0,parts:0};throw e;}
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('AUDIO_EXPIRY_PATH');
  for(const suffix of ['-journal','-wal','-shm']){
    try{const s=fs.lstatSync(file+suffix);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('AUDIO_EXPIRY_PATH');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const db=new DatabaseSync(file);
  try{
    const opened=fs.lstatSync(file);
    if(opened.ino!==info.ino||opened.dev!==info.dev||opened.isSymbolicLink())throw Error('AUDIO_EXPIRY_PATH_CHANGED');
    if(db.prepare('PRAGMA application_id').get().application_id!==AUDIO_DB_APP_ID||db.prepare('PRAGMA user_version').get().user_version!==1)throw Error('AUDIO_DATABASE_UNRECOGNIZED');
    if(db.prepare('SELECT server_id FROM binding').all().length!==1||db.prepare('SELECT server_id FROM binding').get().server_id!==serverId)throw Error('AUDIO_SERVER_MISMATCH');
    if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')throw Error('AUDIO_EXPIRY_JOURNAL');
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; BEGIN IMMEDIATE;');
    try{const result=pruneExpiredAudio(db,clock());db.exec('COMMIT');return {...result,absent:false};}catch(e){db.exec('ROLLBACK');throw e;}
  }finally{db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length!==4||args[0]!=='--db'||args[2]!=='--server-id')throw Error('AUDIO_EXPIRY_ARGUMENT');
    console.log(JSON.stringify(expireAudioFile(args[1],args[3])));
  }catch(e){console.error(JSON.stringify({error:/^[A-Z_]{3,90}$/.test(e.message)?e.message:'AUDIO_EXPIRY_FAILED'}));process.exitCode=1;}
}
