"""Verify rebuilt host DEX retains every defined class/member and only nine hooks.
This is structural evidence; it does not prove device/runtime compatibility.
"""
import hashlib,json,pathlib,struct,sys,zipfile,zlib
ROOT=pathlib.Path(__file__).resolve().parents[2]/'rebuild'/'android-app'
def symbols(data):
    if data[:8]!=b'dex\n039\0':raise ValueError('Expected host DEX 039')
    u32=lambda at:struct.unpack_from('<I',data,at)[0]
    u16=lambda at:struct.unpack_from('<H',data,at)[0]
    if u32(32)!=len(data) or u32(8)!=zlib.adler32(data[12:])&0xffffffff or data[12:32]!=hashlib.sha1(data[32:]).digest():raise ValueError('Invalid DEX integrity')
    def var(at):
        value=0
        for i in range(5):
            b=data[at];at+=1;value|=(b&127)<<(i*7)
            if b<128:return value,at
        raise ValueError('Malformed ULEB')
    strings=[]
    for i in range(u32(56)):
        _,at=var(u32(u32(60)+i*4));strings.append(data[at:data.index(0,at)].decode('utf-8',errors='replace'))
    types=[strings[u32(u32(68)+i*4)] for i in range(u32(64))]
    protos=[]
    for i in range(u32(72)):
        at=u32(76)+i*12;params=u32(at+8)
        protos.append('('+(''.join(types[u16(params+4+j*2)] for j in range(u32(params))) if params else '')+')'+types[u32(at+4)])
    methods=[strings[u32(u32(92)+i*8+4)]+protos[u16(u32(92)+i*8+2)] for i in range(u32(88))]
    fields=[strings[u32(u32(84)+i*8+4)]+':'+types[u16(u32(84)+i*8+2)] for i in range(u32(80))]
    classes={}
    for i in range(u32(96)):
        at=u32(100)+i*32;owner=types[u32(at)];pos=u32(at+24);counts=[];members={}
        if pos:
            for _ in range(4):n,pos=var(pos);counts.append(n)
            for kind,count in enumerate(counts):
                index=0
                for _ in range(count):
                    delta,pos=var(pos);index+=delta;access,pos=var(pos)
                    if kind>=2:_,pos=var(pos)
                    name=('method:' if kind>=2 else 'field:')+(methods if kind>=2 else fields)[index]
                    if name in members:raise ValueError('Duplicate DEX member')
                    members[name]=access
        classes[owner]={'access':u32(at+4),'super':types[u32(at+8)] if u32(at+8)!=0xffffffff else None,'members':members}
    return classes
def audit(apk):
    with zipfile.ZipFile(ROOT/'.private/hosts/RayNeo-1.0.10-258-original.apk') as source,zipfile.ZipFile(apk) as after:
        original={};rebuilt={}
        for dex in ['classes2.dex','classes3.dex']:original.update(symbols(source.read(dex)));rebuilt.update(symbols(after.read(dex)))
    if original.keys()!=rebuilt.keys():raise ValueError('Host class set changed')
    hooks={'Lcom/rayneo/rayneo_venus_sdk_plugin/e;':{'c'},'Lm9/c$c;':{'onAsrResult','onNlpResult','onResponseComplete'},'Lcom/rayneo/venus/MainActivity;':{'onPostResume'},'Lcom/rayneo/venus/VenusApplication;':{'onCreate'},'Lcom/rayneo/rayneo_venus_sdk_plugin/k;':{'z'},'LO4/Y;':{'s'},'LO4/v;':{'u'}}
    renamed=0;member_count=0
    for owner,definition in original.items():
        expected=dict(definition['members'])
        for member in list(expected):
            if not member.startswith('method:'):continue
            name=member[7:].split('(',1)[0]
            if name not in hooks.get(owner,set()):continue
            prefix='ioAgentOriginal_' if owner=='LO4/Y;' else 'turboioOriginal_'
            expected['method:'+prefix+member[7:]]=expected[member];renamed+=1
        actual=rebuilt[owner]
        if actual['members']!=expected or actual['access']!=definition['access'] or actual['super']!=definition['super']:raise ValueError('Unexpected class/member change: '+owner)
        member_count+=len(definition['members'])
    if renamed!=9:raise ValueError('Unexpected hook count')
    return {'schema':1,'host_dex_integrity':'passed','host_classes_retained':len(original),'original_members_retained':member_count,'explicit_wrappers':renamed,'runtime_tested':False}
if __name__=='__main__':
    report=audit(sys.argv[1]);(ROOT/'dex-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
