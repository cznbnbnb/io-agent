"""Publish lifelog text/corrections using the existing checked, backed-up release flow.
Only this owner's paired computers gain text read/correct; old session grants stay scoped.
"""
import argparse,base64,hashlib,importlib.util,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('admin_release',Path(__file__).with_name('deploy-admin-login.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
FILES=['store.mjs','http.mjs','devices.mjs','lifelog-text.mjs','admin-console.mjs','admin/index.html','admin/console.js','admin/style.css']
REMOTE=release.REMOTE.replace('switched=False','changed=[]\nswitched=False')
REMOTE=REMOTE.replace(" if profile=='notifications':",''' smoke=smoke.replace('s.close();', """const agent=s.devices.enroll({owner:'caller601-admin-codex',role:'agent',label:'QA text'});const writer=s.mint({owner:'caller601-admin-codex',producer:'qa-text',scopes:['materials:write']});
 const source={id:'text-'+'a'.repeat(64),date:'2026-11-02',timezone:'Asia/Shanghai',kind:'transcript',started_at:'2026-11-02T01:00:00Z',ended_at:'2026-11-02T02:00:00Z',blocks:[{id:'clip',kind:'utterance',text:'raw'}],related_ids:[]};
 s.lifelog.upload(writer.token,{base_revision:0,source});s.lifelog.correction(agent.token,{request_id:'qa-edit',material_id:source.id,expected_source_revision:1,expected_revision:0,agent:'QA',reason:'test',evidence:['fixture'],edits:[{block_id:'clip',text:'corrected'}]});
 assert.equal(s.lifelog.read(agent.token,{}).items[0].text,'corrected');source.blocks[0].text='new raw';s.lifelog.upload(writer.token,{base_revision:1,source});assert.equal(s.lifelog.read(agent.token,{}).items[0].text,'corrected');assert.equal(s.lifelog.head(writer.token,{id:source.id}).revision,2);s.close();""")
 if profile=='notifications':''')
needle=" subprocess.run(['systemctl','start',service],check=True,timeout=30)"
grant=''' with sqlite3.connect('/var/lib/turboio-material/materials.sqlite') as db:
  rows=db.execute("SELECT c.token_id,c.scopes FROM credentials c JOIN device_tokens t ON t.token_id=c.token_id JOIN devices d ON d.device_id=t.device_id WHERE d.owner=? AND d.role='agent' AND d.revoked_at IS NULL AND c.revoked=0 AND c.expires>? AND NOT EXISTS(SELECT 1 FROM session_bindings b WHERE b.owner=d.owner AND b.producer=d.producer)",(owner,int(time.time()*1000))).fetchall()
  for token_id,old in rows:
   scopes=json.loads(old);additional=[s for s in ['lifelog:read','lifelog:correct'] if s not in scopes]
   if additional:changed.append([token_id,old]);db.execute('UPDATE credentials SET scopes=? WHERE token_id=?',(json.dumps(scopes+additional),token_id))
  (backup/'scope-before.json').write_text(json.dumps(changed));os.chmod(backup/'scope-before.json',0o600)
'''
REMOTE=REMOTE.replace(needle,grant+needle,1)
REMOTE=REMOTE.replace("'grants_changed':False", "'grants_changed':len(changed),'single_session_grants_unchanged':True")
pos=REMOTE.rindex(needle)
REMOTE=REMOTE[:pos]+''' with sqlite3.connect('/var/lib/turboio-material/materials.sqlite') as db:
  for token_id,old in changed:db.execute('UPDATE credentials SET scopes=? WHERE token_id=?',(old,token_id))
'''+REMOTE[pos:]
# The existing gateway has a 300 KiB default. Increase only the two authenticated
# text-write routes; retain HTTPS redirection, timeouts, headers and no access log.
REMOTE=REMOTE.replace("switched=False", """nginx=pathlib.Path('/etc/nginx/sites-enabled/ev').resolve();nginx_before=nginx.read_bytes();(backup/'nginx-before.conf').write_bytes(nginx_before)
text=nginx_before.decode();start=text.index('  location /io-api/v1/ {');end=text.index('\\n  }',start)+4;original=text[start:end]
assert original.count('client_max_body_size 300k;')==1,'NGINX_BASELINE_CHANGED'
blocks=[]
for route,limit in [('source','5m'),('correct','1m')]:
 blocks.append(original.replace('location /io-api/v1/', 'location = /io-api/v1/lifelog-text/'+route).replace('proxy_pass http://127.0.0.1:3401/v1/;', 'proxy_pass http://127.0.0.1:3401/v1/lifelog-text/'+route+';').replace('client_max_body_size 300k;', 'client_max_body_size '+limit+';'))
nginx_after=nginx_before if all(block in text for block in blocks) else (text[:start]+'\\n\\n'.join(blocks)+'\\n\\n'+text[start:]).encode()
switched=False""")
REMOTE=REMOTE.replace(" shutil.rmtree(stage)\n for attempt", " nginx.write_bytes(nginx_after);subprocess.run(['nginx','-t'],check=True,capture_output=True,timeout=20);subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)\n shutil.rmtree(stage)\n for attempt")
REMOTE=REMOTE.replace(" subprocess.run(['systemctl','stop',service],check=True,timeout=30)\n for name,item", " nginx.write_bytes(nginx_before);subprocess.run(['nginx','-t'],check=True,capture_output=True,timeout=20);subprocess.run(['systemctl','reload','nginx'],check=True,timeout=20)\n subprocess.run(['systemctl','stop',service],check=True,timeout=30)\n for name,item")

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline',required=True);p.add_argument('--baseline-json');p.add_argument('--owner',required=True);p.add_argument('--out',required=True);p.add_argument('--apply',action='store_true');args=p.parse_args();data={};published=json.loads(Path(args.baseline_json).read_text())['source_sha256'] if args.baseline_json else None
 for name in FILES:
  path='rebuild/material-server/'+name;body=(ROOT/path).read_bytes();old=subprocess.run(['git','show',args.baseline+':'+path],cwd=ROOT,capture_output=True)
  assert old.returncode==0 or name=='lifelog-text.mjs','BASELINE_UNAVAILABLE: '+name
  data[name]={'before':published[name] if published else hashlib.sha256(old.stdout).hexdigest() if old.returncode==0 else None,'after':hashlib.sha256(body).hexdigest(),'body':base64.b64encode(body).decode()}
 script='data='+repr(data)+'\nowner='+repr(args.owner)+'\napply='+repr(args.apply)+"\nprofile='lifelog-text'\n"+REMOTE
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@43.142.59.131','sudo -n python3 -'],input=script,text=True,capture_output=True,timeout=120)
 if r.returncode:raise SystemExit('LIFELOG_RELEASE_FAILED: '+r.stderr[-2500:])
 report=json.loads(r.stdout);Path(args.out).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
