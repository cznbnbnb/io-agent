"""Apply the checked source-only CLI archive; local credentials are never package members."""
import argparse,hashlib,json,os,re,shutil,stat,tempfile,zipfile
from pathlib import Path,PurePosixPath

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--archive',type=Path,required=True);p.add_argument('--checksums',type=Path,required=True);p.add_argument('--check',action='store_true');args=p.parse_args()
 root=args.root.resolve();old=json.loads((root/'MANIFEST.json').read_text());assert isinstance(old,dict) and old.get('format')=='cz-iot-cli-package/1' and old.get('name')=='cz-iot-cli','UPDATE_INSTALL_INVALID'
 assert args.archive.stat().st_size<=4*1048576,'UPDATE_PACKAGE_TOO_LARGE'
 expected=args.checksums.read_text().strip().split();assert len(expected)==2 and expected[1]=='cz-iot-cli.zip' and re.fullmatch('[a-f0-9]{64}',expected[0]),'UPDATE_CHECKSUM_INVALID'
 body=args.archive.read_bytes();assert hashlib.sha256(body).hexdigest()==expected[0],'UPDATE_ARCHIVE_HASH_MISMATCH'
 payload={}
 with zipfile.ZipFile(args.archive) as archive:
  entries=archive.infolist();assert 1<len(entries)<=256 and sum(i.file_size for i in entries)<=16*1048576,'UPDATE_PACKAGE_TOO_LARGE'
  assert len({i.filename for i in entries})==len(entries),'UPDATE_PACKAGE_DUPLICATE'
  for item in entries:
   parts=PurePosixPath(item.filename).parts
   assert item.filename.startswith('cz-iot-cli/') and not item.is_dir() and not stat.S_ISLNK(item.external_attr>>16) and '\\' not in item.filename and all(re.fullmatch('[A-Za-z0-9_.-]+',part) and part not in {'.','..','private','.private','.io-agent','node_modules','__pycache__'} for part in parts),'UPDATE_PACKAGE_PATH_INVALID'
   name='/'.join(parts[1:]);assert name in {'MANIFEST.json','README.md','AGENTS.md','package.json','cz-iot-cli.mjs','io-agent.mjs','setup.mjs','update.mjs','update_package.py'} or name.startswith('rebuild/agent-bridge/'),'UPDATE_PACKAGE_PATH_INVALID'
   payload[name]=archive.read(item)
 assert {'MANIFEST.json','package.json','cz-iot-cli.mjs','io-agent.mjs','setup.mjs','update.mjs','update_package.py'}.issubset(payload),'UPDATE_MANIFEST_INVALID'
 manifest=json.loads(payload['MANIFEST.json']);assert isinstance(manifest,dict) and manifest.get('format')=='cz-iot-cli-package/1' and manifest.get('name')=='cz-iot-cli' and manifest.get('entrypoint')=='cz-iot-cli.mjs' and manifest.get('contains_credentials') is False and isinstance(manifest.get('source_commit'),str) and re.fullmatch('[a-f0-9]{40}',manifest['source_commit']),'UPDATE_MANIFEST_INVALID'
 inventory=manifest['files'];assert isinstance(inventory,dict) and set(inventory)==set(payload)-{'MANIFEST.json'},'UPDATE_MANIFEST_INVALID'
 for name,digest in inventory.items():assert isinstance(digest,str) and re.fullmatch('[a-f0-9]{64}',digest) and hashlib.sha256(payload[name]).hexdigest()==digest,'UPDATE_FILE_HASH_MISMATCH'
 version=json.loads(payload['package.json'])['version'];assert isinstance(version,str) and re.fullmatch('[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?',version),'UPDATE_VERSION_INVALID'
 changed={};parents=set()
 for name,data in payload.items():
  target=root/name
  for parent in [*target.relative_to(root).parents][:-1]:
   candidate=root/parent
   if candidate not in parents:assert not candidate.is_symlink() and (not candidate.exists() or candidate.is_dir()),'UPDATE_INSTALL_PATH_INVALID';parents.add(candidate)
  assert not target.is_symlink() and (not target.exists() or target.is_file()),'UPDATE_INSTALL_PATH_INVALID'
  before=target.read_bytes() if target.exists() else None
  if before!=data:changed[name]=before
 report={'cli_name':'cz-iot-cli','available':bool(changed),'updated':False,'check_only':args.check,'version':version,'source_commit':manifest['source_commit'],'changed_files':len(changed),'pairing_state_touched':False,'running_connectors_need_restart':False}
 if args.check or not changed:print(json.dumps(report));return
 stage=Path(tempfile.mkdtemp(prefix='.cz-iot-cli-update-',dir=root));committed=[];rollback_failed=False
 try:
  for name in changed:
   target=stage/'new'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(payload[name]);target.chmod(0o755 if name=='cz-iot-cli.mjs' else 0o644)
   if changed[name] is not None:
    backup=stage/'before'/name;backup.parent.mkdir(parents=True,exist_ok=True);backup.write_bytes(changed[name]);backup.chmod((root/name).stat().st_mode&0o777)
  # Publish metadata last. A normal file error restores the files changed in this run.
  for name in sorted(changed,key=lambda n:(n=='MANIFEST.json',n)):
   target=root/name;target.parent.mkdir(parents=True,exist_ok=True);os.replace(stage/'new'/name,target);committed.append(name)
  report.update(updated=True,running_connectors_need_restart=True);print(json.dumps(report))
 except OSError:
  try:
   for name in reversed(committed):
    if changed[name] is None:(root/name).unlink()
    else:os.replace(stage/'before'/name,root/name)
  except OSError:rollback_failed=True
  raise RuntimeError('UPDATE_ROLLBACK_FAILED' if rollback_failed else 'UPDATE_APPLY_FAILED')
 finally:
  if not rollback_failed:shutil.rmtree(stage)

if __name__=='__main__':
 try:main()
 except (AssertionError,RuntimeError,KeyError,ValueError,OSError,zipfile.BadZipFile) as error:
  code=str(error);code=code if re.fullmatch('UPDATE_[A-Z_]+',code) else 'UPDATE_PACKAGE_INVALID'
  print(json.dumps({'error':code}));raise SystemExit(1)
