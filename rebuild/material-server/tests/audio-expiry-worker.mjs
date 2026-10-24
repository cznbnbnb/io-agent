import {DatabaseSync} from 'node:sqlite';
import {expireAudioFile} from '../audio-expiry.mjs';
const [file,serverId,mode]=process.argv.slice(2),original=DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec=function(sql){
  if(sql==='COMMIT'&&mode==='before')process.exit(85);
  const value=original.call(this,sql);
  if(sql==='COMMIT'&&mode==='after')process.exit(86);
  return value;
};
expireAudioFile(file,serverId);
