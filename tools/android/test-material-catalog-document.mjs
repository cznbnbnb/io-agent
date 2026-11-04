import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.join(workspace,'rebuild/android-app/src/com/turboio/addon');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'io-material-document-'));
const classes=['MaterialCatalog','MaterialVisibility','OfficialLifelogDiscovery','OfficialDayContext','OfficialLifelogInventory','OfficialLifelogJson','OfficialAccountBinding','MaterialTimeline','LifelogInsightStore','OfficialLifelogInsight','MaterialLocalLibrary','AtomicDocument','OfficialLifelogSnapshot','LifelogRevisionMapper','MaterialDocument','MaterialExportCache','MaterialWire','MaterialConnection','WireJson','TaskWire','TaskConnection'];
const files=classes.map(name=>path.join(source,name+'.java')).concat(path.join(workspace,'rebuild/android-app/upstream/android-addon/src/com/turboio/addon/BoundedJson.java'),path.join(workspace,'tools/android/MaterialCatalogDocumentTest.java'),path.join(workspace,'tools/android/MaterialLocalLibraryTest.java'),path.join(workspace,'tools/android/OfficialDayContextTest.java'));
function run(command,args){const result=spawnSync(command,args,{cwd:workspace,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.error||result.status!==0)throw new Error(result.stderr||result.error?.message||'MATERIAL_DOCUMENT_TEST_FAILED');if(result.stdout)process.stdout.write(result.stdout);}
try{run('javac',['-encoding','UTF-8','-sourcepath',source+path.delimiter+path.join(workspace,'rebuild/android-app/upstream/android-addon/src/com/turboio/addon'),'-d',output,...files]);run('java',['-cp',output,'com.turboio.addon.MaterialCatalogDocumentTest',path.join(workspace,'docs/contracts/material-v1.2.json')]);run('java',['-cp',output,'com.turboio.addon.MaterialLocalLibraryTest']);run('java',['-cp',output,'com.turboio.addon.OfficialDayContextTest']);}finally{fs.rmSync(output,{recursive:true,force:true});}
