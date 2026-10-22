// Independent-process fixture: receives only a temporary synthetic credential.
import fs from 'node:fs';
import {MaterialStore} from '../store.mjs';
const input=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const store=new MaterialStore(process.argv[2],{clock:()=>input.now});
try{
  const result=store.reconcileRequest(input.token,input.request_id,input.command);
  console.log(JSON.stringify({changed:result.changed,state:result.item.state}));
}finally{store.close();}
