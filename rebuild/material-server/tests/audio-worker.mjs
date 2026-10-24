import fs from 'node:fs';
import {MaterialStore} from '../store.mjs';
const [file,input,mode]=process.argv.slice(2),v=JSON.parse(fs.readFileSync(input));
const store=new MaterialStore(file,{clock:()=>v.now});
const exec=store.audio.db.exec.bind(store.audio.db);
store.audio.db.exec=sql=>{if(sql==='COMMIT'&&mode==='before')process.exit(73);const r=exec(sql);if(sql==='COMMIT'&&mode==='after')process.exit(74);return r;};
store.audio.finalize(v.token,v.id);store.close();
