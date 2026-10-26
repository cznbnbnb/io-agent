#!/usr/bin/env python3
"""Copy unchanged compressed ZIP data; reproduce the complete signed APK byte for byte."""
import hashlib,json,struct,sys,zipfile
from pathlib import Path
MAGIC=b'IOAPK001'
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.digest()
def start(f,info):
 f.seek(info.header_offset);h=f.read(30)
 if len(h)!=30 or h[:4]!=b'PK\x03\x04':raise ValueError('ZIP local header invalid')
 name,extra=struct.unpack_from('<HH',h,26);return info.header_offset+30+name+extra
def create_delta(baseline,candidate,output):
 baseline,candidate,output=map(Path,(baseline,candidate,output))
 if max(baseline.stat().st_size,candidate.stat().st_size)>1073741824:raise ValueError('APK too large')
 spans=[]
 with zipfile.ZipFile(baseline) as az,zipfile.ZipFile(candidate) as bz,baseline.open('rb') as a,candidate.open('rb') as b:
  old={i.filename:i for i in az.infolist()}
  for n in sorted(bz.infolist(),key=lambda i:i.header_offset):
   o=old.get(n.filename)
   if not o or not n.compress_size or (o.CRC,o.compress_size,o.file_size,o.compress_type)!=(n.CRC,n.compress_size,n.file_size,n.compress_type):continue
   x,y=start(a,o),start(b,n);a.seek(x);b.seek(y);left=n.compress_size;equal=True
   while left:
    size=min(left,1048576)
    if a.read(size)!=b.read(size):equal=False;break
    left-=size
   if equal:spans.append((y,x,n.compress_size))
  commands=[];position=0
  for dest,source,size in spans:
   if dest<position:raise ValueError('ZIP spans overlap')
   if dest>position:commands.append((1,position,dest-position))
   commands.append((0,source,size));position=dest+size
  if position<candidate.stat().st_size:commands.append((1,position,candidate.stat().st_size-position))
  oldhash,newhash=digest(baseline),digest(candidate);proof=hashlib.sha256()
  with output.open('xb') as out:
   out.write(MAGIC+struct.pack('>qq',baseline.stat().st_size,candidate.stat().st_size)+oldhash+newhash+struct.pack('>i',len(commands)))
   for kind,offset,size in commands:
    out.write(bytes([kind]));out.write(struct.pack('>qq',offset,size) if kind==0 else struct.pack('>q',size));f=a if kind==0 else b;f.seek(offset);left=size
    while left:
     block=f.read(min(left,1048576))
     if not block:raise ValueError('Truncated APK')
     proof.update(block)
     if kind==1:out.write(block)
     left-=len(block)
  if proof.digest()!=newhash:output.unlink();raise ValueError('Reconstruction mismatch')
 return {'baseline_sha256':oldhash.hex(),'candidate_sha256':newhash.hex(),'apk_bytes':candidate.stat().st_size,'delta_bytes':output.stat().st_size,'commands':len(commands),'delta_sha256':digest(output).hex(),'reconstruction_hash_verified':True}
if __name__=='__main__':
 if len(sys.argv)!=4:raise SystemExit('Usage: apk-delta.py BASELINE.apk CANDIDATE.apk OUTPUT.delta')
 print(json.dumps(create_delta(*sys.argv[1:])))
