import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve('rebuild/android-app/vendor/lucide');
const {Resvg}=require(path.resolve(process.argv[2]));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
for(const [name,expected] of Object.entries(manifest.source_sha256)){
 const source=fs.readFileSync(path.join(root,'icons',name+'.svg'));
 if(crypto.createHash('sha256').update(source).digest('hex')!==expected)throw Error('Source mismatch: '+name);
 const png=new Resvg(source.toString().replaceAll('currentColor','#ffffff'),{fitTo:{mode:'width',value:manifest.size}}).render().asPng();
 if(crypto.createHash('sha256').update(png).digest('hex')!==manifest.png_sha256[name])throw Error('Render mismatch; use '+manifest.renderer+': '+name);
 fs.writeFileSync(path.join(root,'png',name+'.png'),png);
}
console.log('Rendered '+Object.keys(manifest.png_sha256).length+' pinned Lucide icons.');
