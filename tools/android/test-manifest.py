"""Compare semantic manifest trees: only explicit launcher/label/version additions."""
import copy,json,pathlib,struct,sys,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]/'rebuild'/'android-app'
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'upstream/android-addon'))
from background_manifest import patch as background
from product_manifest import patch,ACTIVITY,HOST,MAIN,LAUNCHER,NS
def tree(data):
    u16=lambda b,p:struct.unpack_from('<H',b,p)[0]
    u32=lambda b,p:struct.unpack_from('<I',b,p)[0]
    chunks=[];at=8
    while at<len(data):n=u32(data,at+4);chunks.append(data[at:at+n]);at+=n
    pool=next(c for c in chunks if u16(c,0)==1);utf=bool(u32(pool,16)&256);start=u32(pool,20);strings=[]
    def length(pos):
        value=pool[pos] if utf else u16(pool,pos);pos+=1 if utf else 2;high=128 if utf else 32768
        if value&high:value=((value&(high-1))<<(8 if utf else 16))|(pool[pos] if utf else u16(pool,pos));pos+=1 if utf else 2
        return value,pos
    for i in range(u32(pool,8)):
        pos=start+u32(pool,28+i*4);n,pos=length(pos)
        if utf:n,pos=length(pos)
        strings.append(pool[pos:pos+n*(1 if utf else 2)].decode('utf-8' if utf else 'utf-16le'))
    stack=[];root=None
    for c in chunks:
        if u16(c,0)==0x102:
            node={'name':strings[u32(c,20)],'attrs':{},'children':[]};base=16+u16(c,24)
            for i in range(u16(c,28)):
                p=base+i*u16(c,26);ns=u32(c,p);name=strings[u32(c,p+4)];typ=c[p+15];value=u32(c,p+16)
                node['attrs'][(strings[ns] if ns!=0xffffffff else '')+'|'+name]=(typ,strings[value] if typ==3 else value)
            if stack:stack[-1]['children'].append(node)
            else:root=node
            stack.append(node)
        elif u16(c,0)==0x103:stack.pop()
    return root
with zipfile.ZipFile(ROOT/'.private/hosts/RayNeo-1.0.10-258-original.apk') as z:original=background(z.read('AndroidManifest.xml'))
patched=patch(original)
assert patch(patched)==patched
before=tree(original);after=tree(patched);expected=copy.deepcopy(before)
product=json.loads((ROOT/'product.json').read_text(encoding='utf-8'))
package=product.get('application_id','com.rayneo.venus.pub')
pending=[expected]
while pending:
    node=pending.pop();pending.extend(node['children'])
    for name,(typ,value) in list(node['attrs'].items()):
        if typ==3 and (value=='com.rayneo.venus.pub' or value.startswith('com.rayneo.venus.pub.')):
            node['attrs'][name]=(typ,package+value[len('com.rayneo.venus.pub'):])
key=lambda name:NS+'|'+name
expected['attrs'][key('versionCode')]=(16,product['version_code']);expected['attrs'][key('versionName')]=(3,product['version'])
app=next(c for c in expected['children'] if c['name']=='application');new_app=next(c for c in after['children'] if c['name']=='application')
expected['children'].insert(expected['children'].index(app),{'name':'uses-permission','attrs':{key('name'):(3,'android.permission.REQUEST_INSTALL_PACKAGES')},'children':[]})
app['attrs'][key('label')]=(3,'iO Agent')
host=next(c for c in app['children'] if c['name']=='activity' and c['attrs'].get(key('name'))==(3,HOST))
def launcher(node):return node['name']=='intent-filter' and {(c['name'],c['attrs'].get(key('name'))) for c in node['children']}>= {('action',(3,MAIN)),('category',(3,LAUNCHER))}
old=[c for c in host['children'] if launcher(c)];assert len(old)==1
own=next(c for c in new_app['children'] if c['name']=='activity' and c['attrs'].get(key('name'))==(3,ACTIVITY))
assert product['launcher']==HOST and product['rayneo_account_required_for_local_features'] is True
assert own['attrs']=={key('name'):(3,ACTIVITY),key('exported'):(18,0),key('label'):(3,'iO Agent')}
assert own['children']==[]
app['children'].append(own)
assert expected==after,'An unrelated manifest node/attribute changed'
assert after['attrs']['|package']==(3,package)
print('Product manifest: passed (explicit installation identity, stock classes/login launcher retained, old entry private)')
