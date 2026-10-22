// Public, pinned inputs only. Never installs an APK or operates the glasses.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=path.join(workspace,'rebuild/android-app');
const tools=path.join(root,'.tools'),downloads=path.join(root,'.downloads');
const upstream='f57cc82d0c810435653b684fbdd8c07c533a012f';
const inputs=[
 {name:'platform-tools',url:'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip',size:8044989,algorithm:'sha1',hash:'e03e78b1d80b396f1c3358e31251cb31740e1110',target:'sdk/platform-tools'},
 {name:'build-tools',url:'https://dl.google.com/android/repository/build-tools_r36_windows.zip',size:58699878,algorithm:'sha1',hash:'f16ccffd34de8790dede813a6c7d8e2c11a27b50',target:'sdk/build-tools/36.0.0'},
 {name:'platform',url:'https://dl.google.com/android/repository/platform-36-ext19_r01.zip',size:66057671,algorithm:'sha1',hash:'52e240c229cf2ad561ee262ebdfff266e180c585',target:'sdk/platforms/android-36'},
 {name:'apktool',url:'https://github.com/iBotPeaches/Apktool/releases/download/v2.12.1/apktool_2.12.1.jar',size:25926183,algorithm:'sha256',hash:'66cf4524a4a45a7f56567d08b2c9b6ec237bcdd78cee69fd4a59c8a0243aeafa',target:'apktool.jar'}
];
const exists=async p=>!!(await fs.stat(p).catch(()=>null));
await fs.mkdir(downloads,{recursive:true});await fs.mkdir(tools,{recursive:true});
async function fetchFile(url,dest,proof){
 if(await exists(dest)){
  const b=await fs.readFile(dest);
  if(!proof||(b.length===proof.size&&crypto.createHash(proof.algorithm).update(b).digest('hex')===proof.hash))return b;
  throw new Error('Existing input differs; inspect before replacing '+dest);
 }
 console.log('Downloading '+path.basename(dest));
 const r=await fetch(url,{headers:{'User-Agent':'Codex-Android-Implementation'}});
 if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
 const b=Buffer.from(await r.arrayBuffer());
 if(proof&&(b.length!==proof.size||crypto.createHash(proof.algorithm).update(b).digest('hex')!==proof.hash))throw new Error('Input integrity failure '+url);
 await fs.writeFile(dest,b,{flag:'wx'});return b;
}
function python(code,args){const r=spawnSync('python',['-c',code,...args],{stdio:'inherit'});if(r.status!==0)throw new Error('Extraction failed');}
const records=[];
for(const item of inputs){
 const target=path.join(tools,item.target);
 if(await exists(target)){console.log('Present '+item.name);records.push(item);continue;}
 const archive=path.join(downloads,path.basename(new URL(item.url).pathname));
 const b=await fetchFile(item.url,archive,item);
 if(item.name==='apktool')await fs.rename(archive,target);
 else{
  python(`import pathlib,sys,zipfile,os
src,dst=map(pathlib.Path,sys.argv[1:]);dst.mkdir(parents=True,exist_ok=False)
with zipfile.ZipFile(src) as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')];tops={n.split('/')[0] for n in names}
 if len(tops)!=1:raise SystemExit('Expected single SDK archive root')
 prefix=next(iter(tops))+'/'
 for n in names:
  rel=pathlib.PurePosixPath(n[len(prefix):])
  if not n.startswith(prefix) or rel.is_absolute() or '..' in rel.parts or ':' in str(rel):raise SystemExit('Unsafe archive path')
  p=dst.joinpath(*rel.parts);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(n))`,[archive,target]);
  await fs.unlink(archive);
 }
 records.push({...item,sha256:crypto.createHash('sha256').update(b).digest('hex')});
}
await fs.writeFile(path.join(tools,'tool-provenance.json'),JSON.stringify({schema:1,source:'Google SDK repository2-1.xml; Apktool v2.12.1 release',inputs:records},null,2)+'\n');
if(!process.argv.includes('--tools-only')){
 const dest=path.join(root,'upstream');
 if(await exists(dest))throw new Error('Upstream source already exists; never overwrite a working tree');
 const archive=path.join(downloads,'turbo-io-'+upstream+'.tar.gz');
 const b=await fetchFile('https://api.github.com/repos/Turbo1123/Turbo-IO/tarball/'+upstream,archive);
 python(`import pathlib,sys,tarfile,hashlib,json
src,dst=map(pathlib.Path,sys.argv[1:]);dst.mkdir(parents=True,exist_ok=False);rows=[]
prefixes=('android-addon/','app-gallery/');rootfiles={'LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','DEPENDENCIES.json'}
with tarfile.open(src,'r:gz') as t:
 for m in t:
  p=pathlib.PurePosixPath(m.name);rel=pathlib.PurePosixPath(*p.parts[1:]);s=str(rel)
  if not (s.startswith(prefixes) or s in rootfiles):continue
  if not m.isfile():continue
  if rel.is_absolute() or '..' in rel.parts or ':' in s:raise SystemExit('Unsafe source path')
  data=t.extractfile(m).read();out=dst.joinpath(*rel.parts);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
  rows.append({'path':s,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
(dst.parent/'upstream-source-manifest.json').write_text(json.dumps({'files':rows},indent=2),encoding='utf-8')
print('Selected upstream files:',len(rows))`,[archive,dest]);
 await fs.writeFile(path.join(root,'upstream-lock.json'),JSON.stringify({schema:1,repository:'https://github.com/Turbo1123/Turbo-IO',commit:upstream,archive_sha256:crypto.createHash('sha256').update(b).digest('hex'),selected:['android-addon/','app-gallery/','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','DEPENDENCIES.json'],upstream_original_checkout_unchanged:true},null,2)+'\n');
 await fs.unlink(archive);
}
console.log('Android tools ready: '+tools);
