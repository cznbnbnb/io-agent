// Official Android Emulator + the verified Android16 ARM translation environment.
// All large files live on D: in this workspace. Does not connect to a phone.
import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app');
const downloads=path.join(root,'.downloads'),sdk=path.join(root,'.tools/sdk');
if(process.argv.includes('--api30')&&process.argv.includes('--api36'))throw new Error('Choose one emulator API');
const inputs=[{name:'emulator',version:'37.2.12',url:'https://dl.google.com/android/repository/emulator-windows_x64-16428233.zip',size:455342868,sha1:'488ed747e82de7e9bb5247becd1ac043c7e5e85d',target:'emulator'}];
inputs.push(process.argv.includes('--api30')?
 {name:'google-apis-android30-x86_64',version:'30-r16',url:'https://dl.google.com/android/repository/sys-img/google_apis/x86_64-30_r16.zip',size:1438186618,sha1:'6ae21030eaadc041078444d3798e4b399f3e787d',target:'system-images/android-30/google_apis/x86_64'}:
 {name:'google-apis-android36-x86_64',version:'36-r7',url:'https://dl.google.com/android/repository/sys-img/google_apis/x86_64-36_r07.zip',size:1895447397,sha1:'c6bf44bdcd885bb902b4ba752d111a073ad7a817',target:'system-images/android-36/google_apis/x86_64'});
if(process.argv.includes('--list')){console.log(JSON.stringify(inputs,null,2));process.exit(0);}
async function download(input){
 const dest=path.join(downloads,path.basename(new URL(input.url).pathname)),part=dest+'.part';
 if(fs.existsSync(path.join(sdk,input.target)))return null;
 let offset=fs.existsSync(part)?fs.statSync(part).size:0;
 if(offset>input.size)throw new Error('Oversized partial download');
 if(!fs.existsSync(dest)&&offset<input.size){
  const response=await fetch(input.url,{headers:offset?{Range:`bytes=${offset}-`}:undefined});
  if(!response.ok)throw new Error(input.name+' HTTP '+response.status);
  if(offset&&response.status!==206)throw new Error('Server did not resume the known partial input');
  const file=await fsp.open(part,offset?'a':'wx');let last=offset;
  try{for await(const chunk of response.body){let at=0;while(at<chunk.length){const {bytesWritten}=await file.write(chunk,at,chunk.length-at);if(!bytesWritten)throw new Error('Download write failed');at+=bytesWritten;}offset+=chunk.length;if(offset>input.size)throw new Error('Download size exceeded');if(offset-last>128*1024**2){console.log(input.name+': '+Math.floor(offset/input.size*100)+'%');last=offset;}}await file.sync();}finally{await file.close();}
 }
 const ready=fs.existsSync(dest)?dest:part;const digest=crypto.createHash('sha1');for await(const chunk of fs.createReadStream(ready))digest.update(chunk);
 if(fs.statSync(ready).size!==input.size||digest.digest('hex')!==input.sha1)throw new Error('Official archive integrity mismatch: '+input.name);
 if(ready===part)await fsp.rename(part,dest);return dest;
}
await fsp.mkdir(downloads,{recursive:true});const free=fs.statfsSync(root);if(free.bavail*free.bsize<18*1024**3)throw new Error('18 GiB free required for emulator/image/staging');
const archives=await Promise.all(inputs.map(download));
for(let i=0;i<inputs.length;i++){
 const input=inputs[i],archive=archives[i];if(!archive){console.log('Present '+input.name);continue;}
 const target=path.join(sdk,input.target);
 const code=`import pathlib,sys,zipfile,shutil,os,zlib
src,dst=map(pathlib.Path,sys.argv[1:]);stage=pathlib.Path(str(dst)+'.extracting')
if dst.exists():raise SystemExit('Destination already exists')
with zipfile.ZipFile(src) as z:
 files=[i for i in z.infolist() if not i.is_dir()];tops={i.filename.split('/')[0] for i in files}
 if len(tops)!=1 or sum(i.file_size for i in files)>12*1024**3:raise SystemExit('Unexpected archive layout/budget')
 prefix=next(iter(tops))+'/'
 recovering=stage.exists();stage.mkdir(parents=True,exist_ok=recovering);expected=[]
 for info in files:
  name=info.filename
  if not name.startswith(prefix):raise SystemExit('Archive root mismatch')
  rel=pathlib.PurePosixPath(name[len(prefix):])
  if rel.is_absolute() or '..' in rel.parts or ':' in str(rel):raise SystemExit('Unsafe archive path')
  out=stage.joinpath(*rel.parts);expected.append(out.resolve())
  if recovering:
   if not out.is_file() or out.stat().st_size!=info.file_size:raise SystemExit('Incomplete extraction; inspect before repair')
   crc=0
   with open(out,'rb') as handle:
    for chunk in iter(lambda:handle.read(1024*1024),b''):crc=zlib.crc32(chunk,crc)
   if crc!=info.CRC:raise SystemExit('Extracted content differs')
  else:
   out.parent.mkdir(parents=True,exist_ok=True)
   with z.open(info) as a,open(out,'xb') as b:shutil.copyfileobj(a,b,1024*1024)
 if recovering and set(expected)!={p.resolve() for p in stage.rglob('*') if p.is_file()}:raise SystemExit('Unexpected staged files')
 stage.rename(dst)
`;
 const result=spawnSync('python',['-S','-X','utf8','-c',code,archive,target],{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw new Error('Extraction failed: '+input.name);
 await fsp.unlink(archive);console.log('Installed '+input.name);
}
await fsp.writeFile(path.join(root,'emulator-inputs.json'),JSON.stringify({schema:1,source:'Official Google SDK repository metadata',inputs,phone_io:false},null,2)+'\n');
console.log('Emulator tools ready');
