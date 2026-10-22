"""Fetch a small pinned source-only reference; never install or run upstream."""
import hashlib
import json
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[2]
REPO = 'Tobi1chi/OpenRayneo'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('REFERENCE_REDIRECT_REFUSED')
opener = build_opener(NoRedirect())
def get(url, limit):
    with opener.open(Request(url, headers={'User-Agent':'TurboIO-source-reference/1','Accept':'application/vnd.github+json'}), timeout=25) as response:
        data=response.read(limit+1)
    if len(data)>limit: raise ValueError('REFERENCE_TOO_LARGE')
    return data
head=json.loads(get(f'https://api.github.com/repos/{REPO}/commits/main',262144))
commit=head['sha']
if len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit): raise ValueError('INVALID_COMMIT')
tree=json.loads(get(f'https://api.github.com/repos/{REPO}/git/trees/{commit}?recursive=1',1048576))
if tree.get('truncated'): raise ValueError('TRUNCATED_TREE')
entries={e['path']:e for e in tree['tree'] if e['type']=='blob'}
selected=['LICENSE','README.md','docs/display-protocol.md','docs/recording.md','docs/asr.md','docs/text-layout.md',
          'Sources/OpenRayneoBridge/DisplayController.swift','Sources/OpenRayneoBridge/SpeechController.swift',
          '.agents/skills/openrayneo-api/SKILL.md']
selected += [p for p in entries if p.startswith('Sources/OpenRayneoBridge/') and any(x in p.lower() for x in ('protocol','audio','opus')) and p.endswith('.swift')]
selected=list(dict.fromkeys(selected))
directory=ROOT/'rebuild/phase1/research'/('openrayneo-'+commit)
directory.mkdir(parents=True,exist_ok=False)
proof=[];total=0
for name in selected:
    entry=entries.get(name)
    if entry is None: continue
    if entry.get('size',0)>524288: raise ValueError('REFERENCE_FILE_TOO_LARGE')
    data=get(f'https://raw.githubusercontent.com/{REPO}/{commit}/{name}',524288)
    total+=len(data)
    if total>2097152: raise ValueError('REFERENCE_TOTAL_TOO_LARGE')
    git=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if git!=entry['sha']: raise ValueError('GIT_BLOB_MISMATCH')
    target=directory/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    proof.append({'path':name,'bytes':len(data),'git_blob_sha1':git,'sha256':hashlib.sha256(data).hexdigest(),
                  'source':f'https://github.com/{REPO}/blob/{commit}/{name}'})
report={'schema':1,'repository':f'https://github.com/{REPO}','commit':commit,'upstream_commit_time':head['commit']['committer']['date'],
        'source_only':True,'upstream_code_executed':False,'device_pairing_changed':False,'bytes':total,'files':proof}
(directory/'reference-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'commit':commit,'files':len(proof),'bytes':total,'directory':str(directory),'executed':False}))
