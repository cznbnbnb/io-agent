import fs from 'node:fs';
import {MaterialStore} from '../store.mjs';
const [db,input,mode]=process.argv.slice(2),{token,e,kind}=JSON.parse(fs.readFileSync(input));
const store=new MaterialStore(db,{clock:()=>Date.parse('2026-10-11T02:00:00Z')});
if(mode==='crash'||mode==='lost-reply'){
  const exec=store.db.exec.bind(store.db);store.db.exec=sql=>{
    if(sql==='COMMIT'&&mode==='crash')process.exit(73);
    const result=exec(sql);if(sql==='COMMIT'&&mode==='lost-reply')process.exit(74);return result;
  };
}
let result;
try{result=kind?store.queueSubmit(token,e,kind):store.submit(token,e);}
catch(error){store.close();process.stdout.write(JSON.stringify({error:error?.code??'UNKNOWN'}));process.exit(0);}
store.close();process.stdout.write(JSON.stringify(result));
