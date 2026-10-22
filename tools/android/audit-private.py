"""Reuse upstream audit patterns on the actual fifth DEX and our source overlay.
Only reads public source and the candidate APK; never reads private key/config dirs.
"""
import ast,hashlib,io,json,pathlib,re,sys,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]/'rebuild'/'android-app'
sys.path.insert(0,str(ROOT))
from assemble import public_assets
tree=ast.parse((ROOT/'upstream/android-addon/tests/PrivateArtifactAudit.py').read_text(encoding='utf-8'))
patterns=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PATTERNS' for t in n.targets))
hits=[];count=0
def check(name,data):
    global count
    count+=1
    if any(re.search(p,data) for p in patterns):hits.append(name)
active={p.name:p for p in (ROOT/'upstream/android-addon/src/com/turboio/addon').glob('*.java')}
active.update({p.name:p for p in (ROOT/'src/com/turboio/addon').glob('*.java')})
for name,p in sorted(active.items()):check(name,p.read_bytes())
with zipfile.ZipFile(sys.argv[1]) as apk:
    dex=apk.read('classes5.dex');check('classes5.dex',dex)
    if dex!=(ROOT/'build/dex/classes.dex').read_bytes():raise ValueError('Stale add-on DEX')
    for banned in [b'Lcom/turboio/addon/ReaderWeb;',b'Lcom/turboio/addon/ReaderWebProtocol;',b'weread_cookie',b'Lcom/turboio/addon/CardFlowTest;',b'Lcom/turboio/addon/MusicFlowTest;',b'Lcom/turboio/addon/HostPolicyTest;',b'Lcom/turboio/addon/TaskConnectionTest;',b'FakeMain']:
        if banned in dex:raise ValueError('Excluded code/test double packaged')
    if re.search(rb'llm-[a-z0-9-]+\.[a-z0-9.-]*aliyuncs\.com',dex):raise ValueError('Private tenant packaged')
    for name,p in public_assets().items():
        data=apk.read(name)
        if data!=p.read_bytes():raise ValueError('Asset differs from source')
        check(name,data)
        if name.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(data)) as nested:
                if sorted(nested.namelist())!=['app.json','manifest.json']:raise ValueError('Unexpected nested resource')
                for item in nested.namelist():check(name+'/'+item,nested.read(item))
result={'schema':1,'checked_owned_inputs':count,'credential_pattern_hits':hits,'public_assets_match_sources':True,'test_doubles_absent':True,'addon_dex_sha256':hashlib.sha256(dex).hexdigest(),'scope':'owned source, fifth DEX and allowlisted assets; vendor DEX is preserved, not scanned'}
print(json.dumps(result))
if hits:sys.exit(1)
