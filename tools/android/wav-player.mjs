// macOS counterpart of the guard's PowerShell SoundPlayer: load, report READY,
// wait at most 60 s for the start file, play once with afplay, report DONE.
// Exit 0 played, 2 failed, 3 never released. Owns no deadline or stop.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const [wavPath,readyFile,playFile,doneFile]=process.argv.slice(2);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 if(!wavPath||!readyFile||!playFile||!doneFile)process.exit(2);
 const wav=fs.readFileSync(wavPath);if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')process.exit(2);
 fs.writeFileSync(readyFile,'READY');
 const until=Date.now()+60000;while(!fs.existsSync(playFile)){if(Date.now()>until)process.exit(3);await pause(50);}
 const played=spawnSync('/usr/bin/afplay',[wavPath],{stdio:'ignore'});if(played.error||played.status!==0)process.exit(2);
 fs.writeFileSync(doneFile,'DONE');process.exit(0);
}catch{process.exit(2);}
