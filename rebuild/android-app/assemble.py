"""Build and audit the derivative while preserving all unmodified vendor entries."""
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import zipfile

ROOT=pathlib.Path(__file__).resolve().parent
# Pinned 1.0.10 launcher resource variants; keep IDs and every unrelated asset.
LAUNCHER_ICONS={name:ROOT/'branding'/f'launcher-{size}.png' for name,size in
               [('res/8X.png',48),('res/Dw.png',72),('res/M2.png',96),
                ('res/Gd.png',144),('res/5p.png',192)]}
sys.path.insert(0,str(ROOT/'upstream'/'android-addon'))
from addon_assets import assets
from background_manifest import patch as patch_manifest
from product_manifest import patch as patch_product
from native_route110 import MEMBER as ROUTE_MEMBER, patch_library, report as route_report

def native_preparation():
    product=json.loads((ROOT/'product.json').read_text(encoding='utf-8'))
    mode=product.get('official_ota_preparation',False)
    guarded=product.get('official_ota_guarded',False)
    if type(mode) is not bool or type(guarded) is not bool or mode and guarded or (mode or guarded) and product.get('ota_writes_enabled') is not False:
        raise ValueError('Official source routing requires exclusive preparation/guarded profile and no native sender writes')
    return mode or guarded

def public_assets():
    result=assets()
    result.update({'assets/io-agent/zxing-LICENSE.txt':ROOT/'vendor/zxing/LICENSE',
                   'assets/io-agent/LICENSE.txt':ROOT/'upstream'/'LICENSE',
                   'assets/io-agent/NOTICE.txt':ROOT/'upstream'/'NOTICE',
                   'assets/io-agent/upstream-lock.json':ROOT/'upstream-lock.json',
                   'assets/io-agent/product.json':ROOT/'product.json'})
    icon_root=ROOT/'vendor'/'lucide'
    icon_manifest=json.loads((icon_root/'manifest.json').read_text())
    if hashlib.sha256((icon_root/'LICENSE').read_bytes()).hexdigest()!=icon_manifest['license_sha256']:
        raise ValueError('Lucide license does not match the pinned source')
    if hashlib.sha256((icon_root/'FEATHER-LICENSE').read_bytes()).hexdigest()!=icon_manifest['feather_license_sha256']:
        raise ValueError('Feather license does not match the pinned source')
    result['assets/io-agent/lucide-LICENSE.txt']=icon_root/'LICENSE'
    result['assets/io-agent/feather-LICENSE.txt']=icon_root/'FEATHER-LICENSE'
    result['assets/io-agent/lucide-manifest.json']=icon_root/'manifest.json'
    for name,digest in icon_manifest['png_sha256'].items():
        path=icon_root/'png'/f'{name}.png'
        if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            raise ValueError(f'Lucide asset does not match the pinned render: {name}')
        result[f'assets/io-agent/icons/{name}.png']=path
    return result

def add_notices(destination):
    with zipfile.ZipFile(destination,'a') as out:
        for name,p in public_assets().items():
            if not name.startswith('assets/io-agent/'):continue
            content=p.read_bytes()
            if name in out.namelist():
                if out.read(name)!=content:raise ValueError('Conflicting attribution')
            else:out.writestr(name,content,compress_type=zipfile.ZIP_DEFLATED)

def signature(name):
    return bool(re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))',name,re.I))

def digest_entry(z,name):
    h=hashlib.sha256()
    with z.open(name) as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def assemble(source,hook,addon,destination):
    extra=public_assets()
    with zipfile.ZipFile(source) as z:
        names=z.namelist()
        if len(names)!=len(set(names)):raise ValueError('Duplicate source members')
        dex=[int(m.group(1) or 1) for n in names if (m:=re.fullmatch(r'classes(\d*)\.dex',n))]
        addon_name='classes'+str(max(dex)+1)+'.dex'
        if addon_name!='classes5.dex':raise ValueError('Unexpected source DEX layout')
        if set(extra)&set(names):raise ValueError('Asset collision')
        original_manifest=z.read('AndroidManifest.xml')
        manifest=patch_product(patch_manifest(original_manifest))
        for f in [hook/(dex+'-hooked.dex') for dex in ['classes2','classes3']]+[addon]:
            with open(f,'rb') as raw:
                if not raw.read(4)==b'dex\n':raise ValueError('Invalid DEX')
        temp=pathlib.Path(str(destination)+'.assembling')
        if temp.exists():raise ValueError('Existing partial assembly needs inspection')
        with zipfile.ZipFile(temp,'x',allowZip64=True) as out:
            for info in z.infolist():
                if signature(info.filename):continue
                if info.filename in ['classes2.dex','classes3.dex']:content=(hook/(info.filename[:-4]+'-hooked.dex')).read_bytes()
                elif info.filename=='AndroidManifest.xml':content=manifest
                elif info.filename in LAUNCHER_ICONS:content=LAUNCHER_ICONS[info.filename].read_bytes()
                elif info.filename==ROUTE_MEMBER and native_preparation():content=patch_library(z.read(info))
                else:content=z.read(info)
                out.writestr(info,content)
            for name,content in [(addon_name,pathlib.Path(addon).read_bytes()),*[(n,p.read_bytes()) for n,p in sorted(extra.items())]]:
                info=zipfile.ZipInfo(name,(2026,10,19,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
                out.writestr(info,content)
        temp.replace(destination)
    return audit(source,destination,hook,addon)

def audit(source,destination,hook,addon):
    extra=public_assets()
    with zipfile.ZipFile(source) as before,zipfile.ZipFile(destination) as after:
        a=set(before.namelist());b=set(after.namelist())
        if len(after.namelist())!=len(b):raise ValueError('Duplicate output members')
        expected=(a-{n for n in a if signature(n)})|set(extra)|{'classes5.dex'}
        if b!=expected:raise ValueError('Unexpected ZIP member difference')
        if not set(LAUNCHER_ICONS)<=a:raise ValueError('Pinned launcher resources missing')
        changed=[];preserved=0
        for name in a&b:
            if name in ['classes2.dex','classes3.dex']:expected_bytes=(hook/(name[:-4]+'-hooked.dex')).read_bytes()
            elif name=='AndroidManifest.xml':expected_bytes=patch_product(patch_manifest(before.read(name)))
            elif name in LAUNCHER_ICONS:expected_bytes=LAUNCHER_ICONS[name].read_bytes()
            elif name==ROUTE_MEMBER and native_preparation():expected_bytes=patch_library(before.read(name))
            else:
                if digest_entry(before,name)!=digest_entry(after,name):raise ValueError('Unexpected changed original '+name)
                preserved+=1;continue
            if after.read(name)!=expected_bytes:raise ValueError('Wrong replacement '+name)
            changed.append(name)
        if after.read('classes5.dex')!=pathlib.Path(addon).read_bytes():raise ValueError('Wrong addon DEX')
        for name,p in extra.items():
            if after.read(name)!=p.read_bytes():raise ValueError('Wrong public asset '+name)
        routing=native_preparation()
        return {'original_entries_preserved':preserved,'replaced':sorted(changed),'added_dex':'classes5.dex','public_assets':len(extra),'original_resources_and_native_libraries_preserved':False,'original_resources_preserved':False,'all_other_original_resources_preserved':True,'launcher_icons':sorted(LAUNCHER_ICONS),'all_other_original_native_libraries_preserved':True,'native_source_route':route_report() if routing else None,'source_dex_count':4,'device_installed':False}

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--add-notices':
        add_notices(pathlib.Path(sys.argv[2]));sys.exit(0)
    source,hook,addon,dest=map(pathlib.Path,sys.argv[1:5])
    if len(sys.argv)>5 and sys.argv[5]=='--audit':report=audit(source,dest,hook,addon)
    else:report=assemble(source,hook,addon,dest)
    print(json.dumps(report,ensure_ascii=False))
