import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function verifySnapshot(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'upstream-source-manifest.json'),'utf8'));
 const base=path.resolve(root,'upstream');
 for(const entry of manifest.files){
  const file=path.resolve(base,entry.path);
  if(!file.startsWith(base+path.sep))throw new Error('Invalid source manifest path');
  const content=fs.readFileSync(file);
  if(content.length!==entry.bytes||crypto.createHash('sha256').update(content).digest('hex')!==entry.sha256)throw new Error('Upstream source changed: '+entry.path);
 }
 return manifest.files.length;
}
