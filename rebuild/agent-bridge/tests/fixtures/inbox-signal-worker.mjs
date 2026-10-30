import fs from 'node:fs';import {SharedInboxSignal} from '../../inbox-signal.mjs';
const {config,directory}=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const signal=new SharedInboxSignal(config,{directory});signal.start();
const timer=setInterval(()=>process.send({leader:Boolean(signal.lock),snapshot:signal.snapshot()}),50);
process.on('message',async msg=>{if(msg==='stop'){clearInterval(timer);await signal.stop();process.exit(0);}});
