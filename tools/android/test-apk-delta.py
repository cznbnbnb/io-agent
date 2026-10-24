import hashlib,importlib.util,json,os,struct,subprocess,tempfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('delta',ROOT/'tools/android/apk-delta.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
checks=0
with tempfile.TemporaryDirectory(prefix='io-apk-delta-') as tmp:
 d=Path(tmp);a=d/'old.apk';b=d/'new.apk';patch=d/'update.delta';out=d/'rebuilt.apk'
 for file,new in [(a,False),(b,True)]:
  with zipfile.ZipFile(file,'w') as z:
   z.writestr('unchanged.bin',bytes(range(256))*4096);z.writestr('change.txt','new contents and length' if new else 'old');z.writestr('another.bin',b'unchanged'*1024)
 report=mod.create_delta(a,b,patch);assert report['delta_bytes']<10000;checks+=1
 subprocess.run(['javac','-encoding','UTF-8','-d',str(d),str(ROOT/'tools/android/ApkDelta.java')],check=True)
 expected=hashlib.sha256(b.read_bytes()).hexdigest()
 def run(p=patch,base=a,sha=expected):return subprocess.run(['java','-cp',str(d),'com.turboio.tools.ApkDelta',str(base),str(p),str(out),sha],capture_output=True)
 assert run().returncode==0 and out.read_bytes()==b.read_bytes();checks+=1;out.unlink()
 raw=patch.read_bytes()
 def rejected(data,base=a,sha=expected):
  global checks
  p=d/'invalid.delta';p.write_bytes(data);assert run(p,base,sha).returncode!=0 and not out.exists();checks+=1
 rejected(raw[:40]);rejected(b'BADMAGIC'+raw[8:]);rejected(raw+b'extra');rejected(raw[:-1]);rejected(raw,sha='0'*64)
 wrong=d/'wrong.apk';wrong.write_bytes(a.read_bytes()[:-1]+b'!');rejected(raw,base=wrong)
 invalid=bytearray(raw);invalid[92]=99;rejected(invalid)
 invalid=bytearray(raw);struct.pack_into('>q',invalid,16,2**63-1);rejected(invalid)
 invalid=bytearray(raw);struct.pack_into('>i',invalid,88,100001);rejected(invalid)
 # Corrupt a literal but keep declared target hash: reject and remove only the partial output.
 invalid=bytearray(raw);assert invalid[92]==1;invalid[101]^=1;rejected(invalid)
 pos=92
 while raw[pos]!=0:pos+=9+struct.unpack_from('>q',raw,pos+1)[0]
 invalid=bytearray(raw);struct.pack_into('>q',invalid,pos+1,2**63-1);rejected(invalid)
 out.write_bytes(b'keep');assert run().returncode!=0 and out.read_bytes()==b'keep';checks+=1;out.unlink()
 target=d/'keep.txt';target.write_bytes(b'keep');out.symlink_to(target);assert run().returncode!=0 and target.read_bytes()==b'keep' and out.is_symlink();checks+=1;out.unlink()
 print(json.dumps({'checks':checks,'passed':True,'scope':'ZIP delta and Java assembler; exact output, altered/wrong/truncated patches, bounds and existing-output preservation. No device or installation.'}))
