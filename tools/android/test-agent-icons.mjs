import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root=path.resolve('rebuild/android-app/vendor/lucide'),m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.match(m.commit,/^[a-f0-9]{40}$/);const license=fs.readFileSync(path.join(root,'LICENSE'));assert.equal(hash(license),m.license_sha256);assert.match(license.toString(),/ISC License/);const feather=fs.readFileSync(path.join(root,'FEATHER-LICENSE'));assert.equal(hash(feather),m.feather_license_sha256);assert.match(feather.toString(),/MIT License/);
for(const [name,expected] of Object.entries(m.source_sha256)){
 assert.equal(hash(fs.readFileSync(path.join(root,'icons',name+'.svg'))),expected,name+' source');const png=fs.readFileSync(path.join(root,'png',name+'.png'));
 assert.equal(hash(png),m.png_sha256[name],name+' render');assert.equal(png.readUInt32BE(16),m.size);assert.equal(png.readUInt32BE(20),m.size);assert.equal(png[25],6,name+' transparent RGBA');
}
console.log('Lucide assets: '+Object.keys(m.png_sha256).length+' source/render hashes, dimensions and complete license passed.');
