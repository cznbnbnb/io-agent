"""Offline inventory only: never patch libraries, create a firmware or use ADB."""
import hashlib,json,pathlib,re,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]/'rebuild'/'android-app'
legacy=(ROOT/'upstream/android-addon/official-ota-source.mjs').read_text(encoding='utf-8')
legacy_sha=re.search(r"sourceSHA='([a-f0-9]{64})'",legacy).group(1)
with zipfile.ZipFile(ROOT/'.private/hosts/RayNeo-1.0.7-230-original.apk') as apk:
    data=apk.read('lib/arm64-v8a/libapp.so')
slots=[]
for route in ['/xrlauncherapi/v1/signApi/gray/upgrade','/xrlauncherhwapi/v1/signApi/gray/upgrade']:
    pattern=route.encode('ascii');offset=0;positions=[]
    while True:
        offset=data.find(pattern,offset)
        if offset<0:break
        positions.append({'offset':offset,'prefix_matches_upstream_serialized_length':offset>0 and data[offset-1]==128+len(pattern)*2});offset+=len(pattern)
    slots.append({'route':route,'occurrences':positions})
candidate=json.loads((ROOT.parent/'phase1/firmware-suggest60-ota-2026-10-19.json').read_text(encoding='utf-8-sig'))['candidate']
result={'schema':1,'kind':'offline_read_only_inventory','host_version':'1.0.7','host_code':230,
        'library_sha256':hashlib.sha256(data).hexdigest(),'library_bytes':len(data),
        'upstream_android105_library_sha256':legacy_sha,'upstream105_exact_library_match':hashlib.sha256(data).hexdigest()==legacy_sha,
        'route_strings':slots,
        'upstream_firmware_profile':'TAP1-TEST-01 / Strix OS 1.0.4.12',
        'required_candidate':candidate,
        'upstream_firmware_profile_matches_project_candidate':False,
        'library_modified':False,'firmware_read_or_sent':False,'device_io':False,
        'automatic_105_patch_or_candidate_reuse_allowed':False,
        'remaining':['audit Android107 official update/download/Mode2/slice/installation path; URL presence alone is insufficient','implement exact fixed60 candidate manifest and recovery gates','fresh boot and idle evidence before glasses takeover','real installation/boot/lens acceptance']}
(ROOT/'ota-107-inspection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:result[k] for k in ['library_sha256','upstream105_exact_library_match','route_strings','upstream_firmware_profile_matches_project_candidate','library_modified','device_io']}))
