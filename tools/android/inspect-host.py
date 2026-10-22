"""Read DEX ABI directly from an APK. Does not load vendor code or user data."""
import hashlib
import json
import struct
import sys
import zipfile

def inspect(data):
    if not data.startswith(b'dex\n'):
        raise ValueError('Not a DEX file')
    def u32(at): return struct.unpack_from('<I', data, at)[0]
    def u16(at): return struct.unpack_from('<H', data, at)[0]
    def var(at):
        n = 0
        for i in range(5):
            b = data[at]; at += 1; n |= (b & 127) << (7*i)
            if b < 128: return n, at
        raise ValueError('Malformed ULEB')
    strings = []
    for i in range(u32(56)):
        _, at = var(u32(u32(60)+4*i))
        strings.append(data[at:data.index(0, at)].decode('utf-8', errors='replace'))
    types = [strings[u32(u32(68)+4*i)] for i in range(u32(64))]
    protos = []
    for i in range(u32(72)):
        at = u32(76)+12*i; params = u32(at+8)
        args = ''.join(types[u16(params+4+2*j)] for j in range(u32(params))) if params else ''
        protos.append('('+args+')'+types[u32(at+4)])
    classes = {}
    for i in range(u32(88)):
        at=u32(92)+8*i
        owner=types[u16(at)]
        classes.setdefault(owner, {'methods':[], 'fields':[]})['methods'].append(strings[u32(at+4)]+protos[u16(at+2)])
    for i in range(u32(80)):
        at=u32(84)+8*i; owner=types[u16(at)]
        classes.setdefault(owner, {'methods':[], 'fields':[]})['fields'].append(strings[u32(at+4)]+':'+types[u16(at+2)])
    relevant={}
    for owner,c in classes.items():
        if any(m.startswith('onAsrResult(') for m in c['methods']) or owner.startswith(('Lcom/rayneo/rayneo_venus_sdk_plugin/','LY3/','Lj4/','Lk4/')) or owner in ['Lcom/rayneo/venus/MainActivity;','LE3/u;','LE3/Q;','LE3/V;','LP3/h;','LE3/b;','LP3/A;','LQ3/q;','Lcom/rayneo/airuntime/controller/NlpResult;']:
            relevant[owner]=c
    return relevant

if __name__=='__main__':
    source=sys.argv[1]
    with zipfile.ZipFile(source) as z:
        result={'source_sha256':hashlib.file_digest(open(source,'rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else None, 'dex':{}}
        for n in z.namelist():
            if n.startswith('classes') and n.endswith('.dex'):
                result['dex'][n]=inspect(z.read(n))
    print(json.dumps(result,ensure_ascii=False,indent=2))
