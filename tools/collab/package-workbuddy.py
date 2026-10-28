"""Build a source-only portable question CLI with a recursively closed dependency allowlist."""
from pathlib import Path
import argparse,ast,hashlib,json,re,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[2];BRIDGE=ROOT/'rebuild/agent-bridge'
def files():
 found=set()
 def js(p):
  p=p.resolve();p.relative_to(BRIDGE)
  if p in found:return
  found.add(p)
  for rel in re.findall(r"(?:^|;)\s*import\s+(?:[^;]*?\s+from\s*)?['\"]([^'\"]+)['\"]",p.read_text(),re.MULTILINE):
   if rel.startswith('.'):js(p.parent/rel)
   elif not rel.startswith('node:'):raise ValueError('EXTERNAL_DEPENDENCY: '+rel)
 def py(p):
  p=p.resolve()
  if p in found:return
  found.add(p)
  for node in ast.walk(ast.parse(p.read_text())):
   if isinstance(node,ast.ImportFrom) and node.module:
    for folder in [p.parent,BRIDGE/'questions',BRIDGE/'hermes']:
     dep=folder/(node.module.split('.')[0]+'.py')
     if dep.exists():py(dep);break
 for name in ['questions/cli.mjs','device.mjs','connector.mjs']:js(BRIDGE/name)
 for name in ['questions/tool.py','questions/adapter.py','hermes/enroll_home.py']:py(BRIDGE/name)
 found.add(BRIDGE/'questions/DAILY-SUMMARIES.md')
 found.add(BRIDGE/'questions/NATIVE-TODOS.md')
 found.add(BRIDGE/'hosts/codex-desktop-profile.json')
 return found
if __name__=='__main__':
 parser=argparse.ArgumentParser(description='Build the source-only cz-iot-cli package')
 parser.add_argument('--output',type=Path,default=ROOT/'outputs/cz-iot-cli.zip')
 output=parser.parse_args().output;output.parent.mkdir(parents=True,exist_ok=True)
 payload={str(p.relative_to(ROOT)).replace('\\','/'):p.read_bytes() for p in files()}
 for p in (ROOT/'tools/collab/workbuddy-package').iterdir():
  if p.is_file() and (p.suffix in ['.md','.mjs'] or p.name=='package.json'):payload[p.name]=p.read_bytes()
 payload['rebuild/agent-bridge/vendor/qrcode-LICENSE']=(BRIDGE/'vendor/qrcode-LICENSE').read_bytes()
 payload['rebuild/agent-bridge/package.json']=(BRIDGE/'package.json').read_bytes()
 manifest={'format':'cz-iot-cli-package/1','name':'cz-iot-cli','entrypoint':'cz-iot-cli.mjs','compatibility_entrypoints':['io-agent.mjs'],'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'contains_credentials':False,'files':{p:hashlib.sha256(b).hexdigest() for p,b in sorted(payload.items())}}
 payload['MANIFEST.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
 with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
  for p,b in sorted(payload.items()):
   assert not any(x in p.split('/') for x in ['private','.private','.git','node_modules','__pycache__'])
   info=zipfile.ZipInfo('cz-iot-cli/'+p,(2026,10,28,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(0o100755 if p=='cz-iot-cli.mjs' else 0o100644)<<16;z.writestr(info,b)
 print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'files':len(payload),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
