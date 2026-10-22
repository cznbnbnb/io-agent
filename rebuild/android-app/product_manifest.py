"""Keep the stock login launcher; retain a private old-shortcut redirect activity.
No credential, device certificate, signature or server-auth bypass is introduced.
"""
import struct,json,pathlib
U=0xffffffff
NS='http://schemas.android.com/apk/res/android'
ACTIVITY='com.turboio.addon.AgentActivity'
HOST='com.rayneo.venus.MainActivity'
MAIN='android.intent.action.MAIN'
LAUNCHER='android.intent.category.LAUNCHER'
def patch(data):
    product=json.loads((pathlib.Path(__file__).parent/'product.json').read_text(encoding='utf-8'))
    if product['schema']!=1 or product['version_code']<=230:raise ValueError('Invalid product version')
    u16=lambda b,p:struct.unpack_from('<H',b,p)[0]
    u32=lambda b,p:struct.unpack_from('<I',b,p)[0]
    if u16(data,0)!=3 or u32(data,4)!=len(data):raise ValueError('Invalid AXML')
    chunks=[];at=8
    while at<len(data):
        size=u32(data,at+4)
        if size<8 or at+size>len(data):raise ValueError('AXML chunk bounds')
        chunks.append(data[at:at+size]);at+=size
    pi=next(i for i,c in enumerate(chunks) if u16(c,0)==1);pool=chunks[pi]
    count,styles,flags,start,style_start=struct.unpack_from('<IIIII',pool,8)
    if styles or style_start:raise ValueError('Styled string pool unsupported')
    utf=bool(flags&256)
    def length(pos):
        value=pool[pos] if utf else u16(pool,pos);pos+=1 if utf else 2;high=128 if utf else 32768
        if value&high:value=((value&(high-1))<<(8 if utf else 16))|(pool[pos] if utf else u16(pool,pos));pos+=1 if utf else 2
        return value,pos
    strings=[]
    for i in range(count):
        pos=start+u32(pool,28+i*4);n,pos=length(pos)
        if utf:n,pos=length(pos)
        strings.append(pool[pos:pos+n*(1 if utf else 2)].decode('utf-8' if utf else 'utf-16le'))
    if ACTIVITY in strings:return data
    required=['manifest','application','activity','intent-filter','action','category','name','exported','label','versionCode','versionName',NS,MAIN,LAUNCHER,HOST]
    if any(s not in strings for s in required):raise ValueError('Missing host manifest vocabulary')
    idx={s:strings.index(s) for s in required};raw=pool[start:];offsets=[]
    for s in [ACTIVITY,'iO Agent',product['version']]:
        idx[s]=len(strings);strings.append(s);offsets.append(len(raw))
        raw+=(bytes([len(s),len(s)])+s.encode()+b'\0') if utf else struct.pack('<H',len(s))+s.encode('utf-16le')+b'\0\0'
    raw+=b'\0'*(-len(raw)%4);new_start=start+len(offsets)*4
    chunks[pi]=struct.pack('<HHIIIIII',1,28,new_start+len(raw),len(strings),0,flags&~1,new_start,0)+pool[28:start]+struct.pack('<'+'I'*len(offsets),*offsets)+raw
    mapping=next(c for c in chunks if u16(c,0)==0x180)
    def rid(name):
        pos=8+idx[name]*4
        if pos+4>len(mapping):raise ValueError('Framework attribute missing')
        return u32(mapping,pos)
    if any(rid(name)!=value for name,value in [('name',0x01010003),('exported',0x01010010),('label',0x01010001),('versionCode',0x0101021b),('versionName',0x0101021c)]):raise ValueError('Unexpected attribute mapping')
    def attrs(chunk):
        base=16+u16(chunk,24);size=u16(chunk,26)
        if size!=20:raise ValueError('AXML attribute size')
        return [(base+i*size,u32(chunk,base+i*size+4),chunk[base+i*size+15],u32(chunk,base+i*size+16)) for i in range(u16(chunk,28))]
    def begin(name,values=()):
        blob=b''.join(struct.pack('<IIIHBBI',idx[NS],idx[n],v if typ==3 else U,8,0,typ,v) for n,typ,v in sorted(values,key=lambda value:rid(value[0])))
        return struct.pack('<HHIII',0x102,16,36+len(blob),0,U)+struct.pack('<IIHHHHHH',U,idx[name],20,20,len(values),0,0,0)+blob
    def end(name):return struct.pack('<HHIIIII',0x103,16,24,0,U,U,idx[name])
    stack=[];skip=set();filter_start=None;filter_names=[];host_depth=None;removed=0;label_changed=False
    for i,c in enumerate(chunks):
        typ=u16(c,0)
        if typ==0x102:
            name=strings[u32(c,20)];values={strings[n]:v for _,n,t,v in attrs(c) if t==3}
            stack.append(name)
            if name=='manifest':
                out=bytearray(c);changed=set()
                for pos,n,t,v in attrs(c):
                    if n==idx['versionName']:
                        struct.pack_into('<I',out,pos+8,idx[product['version']]);out[pos+15]=3;struct.pack_into('<I',out,pos+16,idx[product['version']]);changed.add('name')
                    elif n==idx['versionCode']:
                        struct.pack_into('<I',out,pos+8,U);out[pos+15]=16;struct.pack_into('<I',out,pos+16,product['version_code']);changed.add('code')
                if changed!={'name','code'}:raise ValueError('Missing manifest version')
                chunks[i]=bytes(out)
            if name=='application':
                out=bytearray(c)
                for pos,n,t,v in attrs(c):
                    if n==idx['label']:
                        struct.pack_into('<I',out,pos+8,idx['iO Agent']);out[pos+15]=3;struct.pack_into('<I',out,pos+16,idx['iO Agent']);label_changed=True
                chunks[i]=bytes(out)
            if name=='activity' and values.get('name')==idx[HOST]:host_depth=len(stack)
            if name=='intent-filter' and host_depth is not None:filter_start=i;filter_names=[]
            if filter_start is not None and name in ['action','category']:filter_names.append(values.get('name'))
        elif typ==0x103:
            name=strings[u32(c,20)]
            if not stack or stack[-1]!=name:raise ValueError('AXML nesting')
            if name=='intent-filter' and filter_start is not None:
                if idx[MAIN] in filter_names and idx[LAUNCHER] in filter_names:removed+=1
                filter_start=None
            if name=='activity' and host_depth==len(stack):host_depth=None
            stack.pop()
    if stack or removed!=1 or not label_changed:raise ValueError('Expected exactly one host launcher and app label')
    result=[];inserted=0
    for i,c in enumerate(chunks):
        if i in skip:continue
        if u16(c,0)==0x103 and u32(c,20)==idx['application']:
            result.extend([begin('activity',[('name',3,idx[ACTIVITY]),('exported',18,0),('label',3,idx['iO Agent'])]),end('activity')]);inserted+=1
        result.append(c)
    if inserted!=1:raise ValueError('Missing application closing node')
    body=b''.join(result);return struct.pack('<HHI',3,8,len(body)+8)+body
