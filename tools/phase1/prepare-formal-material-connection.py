"""Inspect or explicitly renew the existing formal material identities.

Default mode is read-only. --issue reserves one new remote run and local private
directory; it never repeats a mint after an uncertain reply. --recover only
reads that same remote run. No materials, website, service or schema changes.
Bearer values travel through captured SSH stdout into ACL-protected files only.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
OWNER = 'turboio-user'
SERVER = '80384449-a5c6-4630-bf1b-524a30454c92'
BASE = 'https://cznbnb.cn/io-api/v1/'
TTL_MS = 86400000
PLATFORM = 'harmony'
ROLES = {'phone': {'producer_id': 'phone-harmony', 'scopes': ['materials:write']},
         'reader': {'producer_id': 'pc-query', 'scopes': ['materials:read', 'changes:read']}}
RUN_PATTERN = r'[a-z0-9][a-z0-9-]{0,47}'
UUID_PATTERN = r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
ERROR_CODES = {'RUN_ID_INVALID', 'REMOTE_OPERATION_FAILED', 'REMOTE_RESULT_NOT_CONFIRMED',
    'REMOTE_BINDING_MISMATCH', 'REMOTE_SERVICE_NOT_ACTIVE', 'REMOTE_DATABASE_MISMATCH',
    'REMOTE_EXISTING_ROLE_MISSING', 'REMOTE_RUN_EXISTS_USE_RECOVER', 'REMOTE_RUN_NOT_FOUND',
    'REMOTE_PRIVATE_PATH_INVALID', 'REMOTE_MANIFEST_INVALID', 'REMOTE_MINT_FAILED',
    'REMOTE_CREDENTIAL_INVALID', 'REMOTE_CREDENTIAL_MISSING', 'REMOTE_CREDENTIAL_DATABASE_MISMATCH',
    'LOCAL_PRIVATE_PATH_INVALID', 'LOCAL_RUN_EXISTS_USE_RECOVER', 'LOCAL_PRIVATE_FILE_CONFLICT',
    'LOCAL_PRIVATE_FILE_INVALID', 'FORMAL_CONNECTION_FAILED', 'PUBLIC_REDIRECT_REFUSED',
    'PUBLIC_IDENTITY_UNAVAILABLE', 'PUBLIC_IDENTITY_INVALID', 'PUBLIC_IDENTITY_MISMATCH',
    'PUBLIC_CREDENTIAL_EXPIRED', 'PUBLIC_SCHEMA_UNSUPPORTED', 'PUBLIC_REPORT_INVALID'}

sys.path.insert(0, str(ROOT / 'rebuild/agent-bridge/hermes'))
from enroll_home import protect_directory, write_new

spec = importlib.util.spec_from_file_location('formal_io_publisher', TOOLS / 'deploy-server-release.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def require(value, code):
    if not value:
        raise ValueError(code)


def safe_error(error):
    code = str(error)
    return code if code in ERROR_CODES else 'FORMAL_CONNECTION_FAILED'


def strict_json(data, code='LOCAL_PRIVATE_FILE_INVALID'):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, code)
            result[key] = value
        return result
    try:
        return json.loads(data.decode('utf-8') if isinstance(data, bytes) else data,
                          object_pairs_hook=pairs, parse_constant=lambda _: require(False, code))
    except Exception:
        raise ValueError(code) from None


def expiry_ms(text, code='REMOTE_CREDENTIAL_INVALID'):
    require(isinstance(text, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z', text), code)
    try:
        return int(datetime.fromisoformat(text[:-1] + '+00:00').timestamp() * 1000)
    except Exception:
        raise ValueError(code) from None


def credential(value):
    require(isinstance(value, dict) and set(value) == {'token', 'token_id', 'expires_at'} and
            isinstance(value['token'], str) and re.fullmatch(r'[A-Za-z0-9_-]{43}', value['token']) and
            isinstance(value['token_id'], str) and re.fullmatch(UUID_PATTERN, value['token_id']),
            'REMOTE_CREDENTIAL_INVALID')
    expiry_ms(value['expires_at'])
    return value


# All remote commands and paths are fixed. Parameters and Python source are
# delivered on stdin; no token, SSH material or user-supplied shell text is argv.
REMOTE_SOURCE = r'''
import contextlib,hashlib,json,os,pathlib,re,sqlite3,stat,subprocess,time
from datetime import datetime,timezone
DB=pathlib.Path('/var/lib/turboio-material/materials.sqlite')
RUN_PARENT=pathlib.Path('/var/lib/turboio-material/formal-connections')
NODE='/opt/turboio/node22/bin/node'
CLI='/opt/turboio/rebuild/material-server/cli.mjs'
SERVICE='turboio-material.service'
OWNER='turboio-user'
SERVER='80384449-a5c6-4630-bf1b-524a30454c92'
TTL=86400000
PLATFORM='harmony'
ROLES={'phone':{'producer_id':'phone-harmony','scopes':['materials:write']},
       'reader':{'producer_id':'pc-query','scopes':['materials:read','changes:read']}}
UUID_PATTERN=r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
REMOTE_ERRORS={'REMOTE_OPERATION_FAILED','REMOTE_SERVICE_NOT_ACTIVE','REMOTE_DATABASE_MISMATCH',
 'REMOTE_EXISTING_ROLE_MISSING','REMOTE_RUN_EXISTS_USE_RECOVER','REMOTE_RUN_NOT_FOUND',
 'REMOTE_PRIVATE_PATH_INVALID','REMOTE_MANIFEST_INVALID','REMOTE_MINT_FAILED',
 'REMOTE_CREDENTIAL_INVALID','REMOTE_CREDENTIAL_MISSING','REMOTE_CREDENTIAL_DATABASE_MISMATCH'}
ALL_SCOPES={'materials:write','materials:read','changes:read','tasks:write','tasks:read','tasks:update',
 'requests:write','requests:read','answers:write','messages:receive','messages:write',
 'receipts:phone','receipts:agent','receipts:storage','operations:read'}
def require(value,code):
 if not value: raise ValueError(code)
def code(error):
 value=str(error)
 return value if value in REMOTE_ERRORS else 'REMOTE_OPERATION_FAILED'
def utc(ms): return datetime.fromtimestamp(ms/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def strict_json(data,error):
 def pairs(items):
  out={}
  for k,v in items:
   require(k not in out,error);out[k]=v
  return out
 try: return json.loads(data,object_pairs_hook=pairs,parse_constant=lambda _:require(False,error))
 except Exception: raise ValueError(error) from None
def expiry(text):
 require(isinstance(text,str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z',text),'REMOTE_CREDENTIAL_INVALID')
 try: return int(datetime.fromisoformat(text[:-1]+'+00:00').timestamp()*1000)
 except Exception: raise ValueError('REMOTE_CREDENTIAL_INVALID') from None
def sync_dir(directory):
 fd=os.open(directory,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
 try: os.fsync(fd)
 finally: os.close(fd)
def private_dir(directory):
 require(directory.resolve()==directory.absolute() and directory.is_dir() and not directory.is_symlink(),'REMOTE_PRIVATE_PATH_INVALID')
 info=directory.stat()
 require(os.name!='posix' or (info.st_mode&0o077==0 and info.st_uid==os.geteuid()),'REMOTE_PRIVATE_PATH_INVALID')
def read_json(file,error='REMOTE_CREDENTIAL_INVALID'):
 info=file.lstat()
 require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=8192 and not file.is_symlink(),error)
 require(os.name!='posix' or (info.st_mode&0o077==0 and info.st_uid==os.geteuid()),error)
 fd=os.open(file,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_BINARY',0))
 try:
  parts=[];total=0
  while total<=8192:
   part=os.read(fd,8193-total)
   if not part: break
   parts.append(part);total+=len(part)
  data=b''.join(parts);require(len(data)<=8192 and len(data)==info.st_size and os.fstat(fd).st_size==info.st_size,error)
  return strict_json(data.decode('utf-8'),error)
 finally: os.close(fd)
def write_json(file,value):
 fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
 with os.fdopen(fd,'w',encoding='utf-8') as out:
  out.write(json.dumps(value,separators=(',',':'))+'\n');out.flush();os.fsync(out.fileno())
 sync_dir(file.parent)
def command(args):
 result=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,timeout=20)
 require(result.returncode==0 and len(result.stdout)<=16384,'REMOTE_OPERATION_FAILED')
 return result.stdout.decode('utf-8').strip()
def database():
 require(DB.is_file() and not DB.is_symlink() and DB.resolve()==DB.absolute(),'REMOTE_DATABASE_MISMATCH')
 connection=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=5)
 try:
  require(connection.execute('PRAGMA user_version').fetchone()[0]==2,'REMOTE_DATABASE_MISMATCH')
  values=dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('server_id','cursor_secret')"))
  require(values.get('server_id')==SERVER and isinstance(values.get('cursor_secret'),str) and bool(values['cursor_secret']),'REMOTE_DATABASE_MISMATCH')
 except Exception:
  connection.close();raise
 return connection
def preflight():
 require(command(['systemctl','is-active',SERVICE])=='active','REMOTE_SERVICE_NOT_ACTIVE')
 counts={};existing={}
 with contextlib.closing(database()) as connection:
  # Android joins the established user space with a separate producer. Require
  # both original formal roles as anchors before allowing first enrollment.
  if PLATFORM=='android':
   for producer in ('phone-harmony','pc-query'):
    require(connection.execute('SELECT COUNT(*) FROM credentials WHERE owner=? AND producer=?',(OWNER,producer)).fetchone()[0]>0,'REMOTE_EXISTING_ROLE_MISSING')
  for role,definition in ROLES.items():
   bindings=(OWNER,definition['producer_id'])
   counts[role]=connection.execute('SELECT COUNT(*) FROM credentials WHERE owner=? AND producer=?',bindings).fetchone()[0]
   require(counts[role]>0 or (PLATFORM=='android' and role=='phone' and definition['producer_id']=='phone-android'),'REMOTE_EXISTING_ROLE_MISSING')
   existing[role]=[]
   for token_id,scopes,expires,revoked in connection.execute('SELECT token_id,scopes,expires,revoked FROM credentials WHERE owner=? AND producer=? ORDER BY expires DESC LIMIT 16',bindings):
    require(isinstance(token_id,str) and re.fullmatch(UUID_PATTERN,token_id),'REMOTE_DATABASE_MISMATCH')
    parsed=strict_json(scopes,'REMOTE_DATABASE_MISMATCH')
    require(isinstance(parsed,list) and len(parsed)<=32 and all(isinstance(s,str) and s in ALL_SCOPES for s in parsed),'REMOTE_DATABASE_MISMATCH')
    existing[role].append({'token_id':token_id,'scopes':parsed,'expires_at':utc(expires),'revoked':bool(revoked)})
 return {'service_active':True,'database_version':2,'server_id':SERVER,'existing_role_counts':counts,'existing_credentials':existing}
def manifest(root,run_id):
 value=read_json(root/'manifest.json','REMOTE_MANIFEST_INVALID')
 require(set(value)=={'schema','run_id','owner_id','server_id','roles','ttl_ms','started_at'} and value['schema']==1 and
  value['run_id']==run_id and value['owner_id']==OWNER and value['server_id']==SERVER and value['roles']==ROLES and value['ttl_ms']==TTL,'REMOTE_MANIFEST_INVALID')
 expiry(value['started_at']);return value
def journal(root,run_id):
 out={'run_exists':root.exists() or root.is_symlink(),'manifest_present':False,'intent_roles':[],'issued_roles':[],
      'credential_file_roles':[],'complete_record':False}
 if not out['run_exists']: return out
 private_dir(root);manifest(root,run_id);out['manifest_present']=True
 for role in ROLES:
  for suffix,key in [('intent','intent_roles'),('issued','issued_roles')]:
   file=root/(role+'-'+suffix+'.json')
   if file.exists() or file.is_symlink():
    value=read_json(file,'REMOTE_MANIFEST_INVALID')
    expected={'schema','run_id','role','phase'} if suffix=='intent' else {'schema','run_id','role','phase','token_id','expires_at'}
    require(set(value)==expected and value['schema']==1 and value['run_id']==run_id and value['role']==role and value['phase']==suffix,'REMOTE_MANIFEST_INVALID')
    if suffix=='issued':
     require(isinstance(value['token_id'],str) and re.fullmatch(UUID_PATTERN,value['token_id']),'REMOTE_MANIFEST_INVALID');expiry(value['expires_at'])
    out[key].append(role)
  if (root/(role+'.json')).exists(): out['credential_file_roles'].append(role)
 if (root/'complete.json').exists():
  value=read_json(root/'complete.json','REMOTE_MANIFEST_INVALID')
  require(value=={'schema':1,'run_id':run_id,'issued_roles':list(ROLES)},'REMOTE_MANIFEST_INVALID');out['complete_record']=True
 return out
def read_credential(root,role,started_at):
 file=root/(role+'.json')
 require(file.exists() or file.is_symlink(),'REMOTE_CREDENTIAL_MISSING')
 value=read_json(file)
 require(isinstance(value,dict) and set(value)=={'token','token_id','expires_at'} and isinstance(value['token'],str) and
  re.fullmatch(r'[A-Za-z0-9_-]{43}',value['token']) and isinstance(value['token_id'],str) and re.fullmatch(UUID_PATTERN,value['token_id']),'REMOTE_CREDENTIAL_INVALID')
 expires=expiry(value['expires_at']);started=expiry(started_at)
 # TTL is fixed in the sole mint argv and verified by the server CLI. A later
 # role can be issued well after the run starts; recover must not impose an
 # invented run-relative 60-second ceiling on its exact DB-bound expiration.
 require(started<expires,'REMOTE_CREDENTIAL_INVALID')
 with contextlib.closing(database()) as connection:
  row=connection.execute('SELECT owner,producer,scopes,expires,revoked,digest FROM credentials WHERE token_id=?',(value['token_id'],)).fetchone()
 require(row is not None and row[0]==OWNER and row[1]==ROLES[role]['producer_id'] and
  set(strict_json(row[2],'REMOTE_CREDENTIAL_DATABASE_MISMATCH'))==set(ROLES[role]['scopes']) and row[3]==expires and row[4]==0 and
  row[5]==hashlib.sha256(value['token'].encode('ascii')).hexdigest(),'REMOTE_CREDENTIAL_DATABASE_MISMATCH')
 return value
def run_remote(parameters):
 global PLATFORM,ROLES
 platform=parameters.get('platform','harmony')
 require(platform in ('harmony','android'),'REMOTE_OPERATION_FAILED')
 PLATFORM=platform
 ROLES={'phone':{'producer_id':'phone-'+platform,'scopes':['materials:write']},
        'reader':{'producer_id':'pc-query','scopes':['materials:read','changes:read']}}
 run_id=parameters.get('run_id','');mode=parameters.get('mode','')
 require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}',run_id) and mode in ('inspect','issue','recover'),'REMOTE_OPERATION_FAILED')
 root=RUN_PARENT/run_id;output={'run_id':run_id,'owner_id':OWNER,'server_id':SERVER,'roles':ROLES,'status':'failed','issuance_started':False}
 values={}
 try:
  output['metadata']=preflight();output['journal']=journal(root,run_id)
  if mode=='inspect': output['status']='inspected';return output
  if mode=='issue':
   require(not output['journal']['run_exists'],'REMOTE_RUN_EXISTS_USE_RECOVER')
   require(RUN_PARENT.parent.resolve()==RUN_PARENT.parent.absolute(),'REMOTE_PRIVATE_PATH_INVALID')
   if not RUN_PARENT.exists(): RUN_PARENT.mkdir(mode=0o700);sync_dir(RUN_PARENT.parent)
   private_dir(RUN_PARENT)
   try: root.mkdir(mode=0o700,exist_ok=False)
   except FileExistsError: raise ValueError('REMOTE_RUN_EXISTS_USE_RECOVER') from None
   sync_dir(RUN_PARENT);output['issuance_started']=True
   record={'schema':1,'run_id':run_id,'owner_id':OWNER,'server_id':SERVER,'roles':ROLES,'ttl_ms':TTL,'started_at':utc(int(time.time()*1000))}
   write_json(root/'manifest.json',record)
   for role,definition in ROLES.items():
    # A durable intent precedes each single O_EXCL CLI issuance. Nothing in
    # recover or inspect re-enters this loop, even after an uncertain reply.
    write_json(root/(role+'-intent.json'),{'schema':1,'run_id':run_id,'role':role,'phase':'intent'})
    preflight()
    try:
     returned=strict_json(command([NODE,CLI,'mint','--db',str(DB),'--owner',OWNER,'--producer',definition['producer_id'],
      '--scopes',','.join(definition['scopes']),'--ttl-ms',str(TTL),'--out',str(root/(role+'.json'))]),'REMOTE_MINT_FAILED')
    except Exception: raise ValueError('REMOTE_MINT_FAILED') from None
    value=read_credential(root,role,record['started_at'])
    require(returned=={'token_id':value['token_id'],'expires_at':value['expires_at']},'REMOTE_MINT_FAILED')
    values[role]=value
    write_json(root/(role+'-issued.json'),{'schema':1,'run_id':run_id,'role':role,'phase':'issued',
      'token_id':value['token_id'],'expires_at':value['expires_at']})
   write_json(root/'complete.json',{'schema':1,'run_id':run_id,'issued_roles':list(ROLES)})
   output['status']='issued'
  else:
   require(output['journal']['run_exists'],'REMOTE_RUN_NOT_FOUND')
   record=manifest(root,run_id)
   for role in ROLES:
    if not (root/(role+'.json')).exists(): continue
    values[role]=read_credential(root,role,record['started_at'])
   require(set(values)==set(ROLES),'REMOTE_CREDENTIAL_MISSING');output['status']='recovered'
  output['journal']=journal(root,run_id)
 except Exception as error:
  output['error']=code(error);output['status']='partial' if values else 'failed'
  try: output['journal']=journal(root,run_id)
  except Exception: output['journal']={'run_exists':root.exists(),'journal_unavailable':True}
 if mode!='inspect': output['credentials']=values
 return output
'''


def connect():
    # macOS uses the already configured OpenSSH identity and pinned known host.
    # Keep Windows' existing private helper and never request a password in logs.
    return publisher.connect() if os.name == 'nt' else 'openssh'


def remote(connection, mode, run_id):
    require(mode in {'inspect', 'issue', 'recover'} and re.fullmatch(RUN_PATTERN, run_id), 'RUN_ID_INVALID')
    script = REMOTE_SOURCE + '\nprint(json.dumps(run_remote(' + repr({'mode': mode, 'run_id': run_id, 'platform': PLATFORM}) + ')))\n'
    if connection == 'openssh':
        child = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                                '-o', 'ConnectTimeout=10', 'ubuntu@43.142.59.131',
                                'sudo -n /usr/bin/python3 -'], input=script.encode('utf-8'),
                               capture_output=True, timeout=90)
        data = child.stdout
        require(child.returncode == 0 and len(data) <= 65536, 'REMOTE_RESULT_NOT_CONFIRMED')
    else:
        stdin, stdout, stderr = connection.exec_command('sudo -n /usr/bin/python3 -', timeout=90)
        stdin.write(script)
        stdin.flush()
        stdin.channel.shutdown_write()
        data = stdout.read(65537)
        stderr.read(4097)  # Never print remote stderr or a secret-bearing envelope.
        require(stdout.channel.recv_exit_status() == 0 and len(data) <= 65536, 'REMOTE_RESULT_NOT_CONFIRMED')
    result = strict_json(data, 'REMOTE_RESULT_NOT_CONFIRMED')
    require(isinstance(result, dict) and result.get('run_id') == run_id and result.get('owner_id') == OWNER and
            result.get('server_id') == SERVER and result.get('roles') == ROLES, 'REMOTE_BINDING_MISMATCH')
    return result


def public_remote(value):
    """Whitelist observed metadata; never attach the remote credential envelope."""
    allowed_status = {'inspected', 'issued', 'recovered', 'partial', 'failed'}
    require(value.get('status') in allowed_status, 'REMOTE_RESULT_NOT_CONFIRMED')
    out = {'status': value['status'], 'issuance_started': value.get('issuance_started') is True}
    if 'error' in value:
        require(value['error'] in ERROR_CODES, 'REMOTE_RESULT_NOT_CONFIRMED')
        out['error'] = value['error']
    metadata = value.get('metadata')
    if metadata is not None:
        require(isinstance(metadata, dict) and set(metadata) == {'service_active', 'database_version', 'server_id',
                'existing_role_counts', 'existing_credentials'} and metadata['service_active'] is True and
                metadata['database_version'] == 2 and metadata['server_id'] == SERVER and
                set(metadata['existing_role_counts']) == set(ROLES) and set(metadata['existing_credentials']) == set(ROLES),
                'REMOTE_RESULT_NOT_CONFIRMED')
        for role in ROLES:
            count = metadata['existing_role_counts'][role]
            rows = metadata['existing_credentials'][role]
            require(type(count) is int and (count > 0 or (count == 0 and PLATFORM == 'android' and role == 'phone')) and
                    isinstance(rows, list) and len(rows) <= 16 and (count != 0 or not rows), 'REMOTE_RESULT_NOT_CONFIRMED')
            for row in rows:
                require(isinstance(row, dict) and set(row) == {'token_id', 'expires_at', 'scopes', 'revoked'} and
                        isinstance(row['token_id'], str) and re.fullmatch(UUID_PATTERN, row['token_id']) and
                        type(row['revoked']) is bool and isinstance(row['scopes'], list) and len(row['scopes']) <= 32 and
                        all(isinstance(scope, str) and re.fullmatch(r'[a-z]+:[a-z]+', scope) for scope in row['scopes']),
                        'REMOTE_RESULT_NOT_CONFIRMED')
                expiry_ms(row['expires_at'], 'REMOTE_RESULT_NOT_CONFIRMED')
        out['metadata'] = metadata
    journal = value.get('journal')
    if journal is not None:
        require(isinstance(journal, dict) and set(journal).issubset({'run_exists', 'manifest_present', 'intent_roles',
                'issued_roles', 'credential_file_roles', 'complete_record', 'journal_unavailable'}), 'REMOTE_RESULT_NOT_CONFIRMED')
        for key, entry in journal.items():
            if key.endswith('_roles'):
                require(isinstance(entry, list) and len(entry) <= 2 and len(entry) == len(set(entry)) and all(role in ROLES for role in entry),
                        'REMOTE_RESULT_NOT_CONFIRMED')
            else:
                require(type(entry) is bool, 'REMOTE_RESULT_NOT_CONFIRMED')
        out['journal'] = journal
    return out


def private_directory(run_id, mode):
    parent = ROOT / 'rebuild/material-server/private'
    require(parent.resolve() == parent.absolute() and parent.is_dir() and not parent.is_symlink(), 'LOCAL_PRIVATE_PATH_INVALID')
    target = parent / ('formal-' + run_id)
    require(not target.is_symlink(), 'LOCAL_PRIVATE_PATH_INVALID')
    if mode == 'issue':
        require(not target.exists(), 'LOCAL_RUN_EXISTS_USE_RECOVER')
        target.mkdir(mode=0o700)
    elif not target.exists():
        target.mkdir(mode=0o700)
    require(target.resolve() == target.absolute() and target.is_dir(), 'LOCAL_PRIVATE_PATH_INVALID')
    protect_directory(target)
    return target


def read_private(file):
    require(file.is_file() and not file.is_symlink() and file.stat().st_nlink == 1 and file.stat().st_size <= 8192,
            'LOCAL_PRIVATE_FILE_INVALID')
    return strict_json(file.read_bytes())


def save_private(file, value, recover=False):
    if file.exists() or file.is_symlink():
        require(recover and read_private(file) == value, 'LOCAL_PRIVATE_FILE_CONFLICT')
        return
    write_new(file, value)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('PUBLIC_REDIRECT_REFUSED')


def verify_identity(opener, role, value):
    value = credential(value)
    require(expiry_ms(value['expires_at']) > int(datetime.now(timezone.utc).timestamp() * 1000), 'PUBLIC_CREDENTIAL_EXPIRED')
    request = Request(BASE + 'identity', method='GET', headers={'Authorization': 'Bearer ' + value['token'], 'Accept': 'application/json'})
    try:
        response = opener.open(request, timeout=10)
    except HTTPError as error:
        error.close()
        raise ValueError('PUBLIC_IDENTITY_UNAVAILABLE') from None
    with response:
        require(response.status == 200 and response.headers.get_content_type() == 'application/json' and
                not response.headers.get('Content-Encoding'), 'PUBLIC_IDENTITY_INVALID')
        data = response.read(16385)
        require(len(data) <= 16384, 'PUBLIC_IDENTITY_INVALID')
    identity = strict_json(data, 'PUBLIC_IDENTITY_INVALID')
    require(isinstance(identity, dict) and identity.get('schema_version') == '1.0' and identity.get('server_id') == SERVER and
            identity.get('owner_id') == OWNER and identity.get('producer_id') == ROLES[role]['producer_id'] and
            isinstance(identity.get('scopes'), list) and len(identity['scopes']) <= 16 and
            all(isinstance(scope, str) for scope in identity['scopes']) and
            set(identity['scopes']) == set(ROLES[role]['scopes']) and len(identity['scopes']) == len(set(identity['scopes'])) and
            identity.get('expires_at') == value['expires_at'], 'PUBLIC_IDENTITY_MISMATCH')
    require(expiry_ms(identity['expires_at']) > int(datetime.now(timezone.utc).timestamp() * 1000), 'PUBLIC_CREDENTIAL_EXPIRED')
    versions = identity.get('material_schema_versions')
    require(isinstance(versions, list) and len(versions) <= 16 and all(isinstance(item, str) and len(item) <= 16 and re.fullmatch(r'\d+\.\d+', item) for item in versions)
            and '1.2' in versions, 'PUBLIC_SCHEMA_UNSUPPORTED')
    return {'owner_id': OWNER, 'producer_id': ROLES[role]['producer_id'], 'server_id': SERVER,
            'token_id': value['token_id'], 'expires_at': value['expires_at'], 'scopes': ROLES[role]['scopes'],
            'material_schema_versions': versions, 'http_status': 200}


def persist_report(report):
    target = ROOT / ('rebuild/phase1/formal-material-connection-' + report['run_id'] + '.json')
    history = []
    if target.exists():
        require(not target.is_symlink() and target.stat().st_size <= 131072, 'PUBLIC_REPORT_INVALID')
        previous = strict_json(target.read_bytes(), 'PUBLIC_REPORT_INVALID')
        require(previous.get('schema') == 1 and previous.get('run_id') == report['run_id'] and
                previous.get('mode') in {'inspect', 'issue', 'recover'} and
                previous.get('status') in {'inspected', 'ready', 'partial', 'failed', 'issue_observation_unknown'}, 'PUBLIC_REPORT_INVALID')
        history = previous.get('history', [])
        require(isinstance(history, list) and len(history) <= 16, 'PUBLIC_REPORT_INVALID')
        for event in history + [{key: previous[key] for key in ['at', 'mode', 'status'] if key in previous}]:
            require(isinstance(event, dict) and set(event) == {'at', 'mode', 'status'} and
                    isinstance(event['at'], str) and len(event['at']) <= 40 and
                    re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00', event['at']) and
                    event['mode'] in {'inspect', 'issue', 'recover'} and event['status'] in
                    {'inspected', 'ready', 'partial', 'failed', 'issue_observation_unknown'}, 'PUBLIC_REPORT_INVALID')
        history = history + [{key: previous[key] for key in ['at', 'mode', 'status'] if key in previous}]
    report['history'] = history[-16:]
    temporary = target.with_name('.formal-' + uuid.uuid4().hex + '.partial')
    write_new(temporary, report)
    os.replace(temporary, target)


def main(argv=None):
    global PLATFORM, ROLES
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--platform', choices=['harmony', 'android'], default='harmony')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--inspect', action='store_true')
    modes.add_argument('--issue', action='store_true')
    modes.add_argument('--recover', action='store_true')
    args = parser.parse_args(argv)
    PLATFORM = args.platform
    ROLES = {'phone': {'producer_id': 'phone-' + PLATFORM, 'scopes': ['materials:write']},
             'reader': {'producer_id': 'pc-query', 'scopes': ['materials:read', 'changes:read']}}
    if not re.fullmatch(RUN_PATTERN, args.run_id):
        print(json.dumps({'status': 'failed', 'error': 'RUN_ID_INVALID'}))
        return 1
    mode = 'issue' if args.issue else 'recover' if args.recover else 'inspect'
    report = {'schema': 1, 'at': datetime.now(timezone.utc).isoformat(), 'run_id': args.run_id, 'mode': mode,
              'status': 'failed', 'owner_id': OWNER, 'server_id': SERVER, 'roles': ROLES, 'credential_ttl_ms': TTL_MS,
              'tool_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'material_requests_sent': 0,
              'platform': PLATFORM,
              'scope': 'formal user-space identities; Android uses independent phone producer; new credential rows and private files only; no material/site/schema/service mutation',
              'not_verified': ['physical phone import and upload', 'automatic credential rotation', 'background sync']}
    connection = None
    issue_dispatched = False
    try:
        directory = private_directory(args.run_id, mode) if mode != 'inspect' else None
        connection = connect()
        inspected = remote(connection, 'inspect', args.run_id)
        report['inspection'] = public_remote(inspected)
        require(inspected['status'] == 'inspected', inspected.get('error', 'REMOTE_OPERATION_FAILED'))
        if mode == 'inspect':
            report['status'] = 'inspected'
        else:
            require(mode != 'issue' or not inspected['journal']['run_exists'], 'REMOTE_RUN_EXISTS_USE_RECOVER')
            issue_dispatched = mode == 'issue'
            result = remote(connection, mode, args.run_id)
            report['remote'] = public_remote(result)
            issue_dispatched = False  # A parsed, bound result describes remote issuance.
            values = result.get('credentials', {})
            require(isinstance(values, dict) and set(values).issubset(ROLES), 'REMOTE_CREDENTIAL_INVALID')
            recover = mode == 'recover'
            save_private(directory / 'manifest.json', {'schema': 1, 'run_id': args.run_id, 'owner_id': OWNER,
                'server_id': SERVER, 'roles': ROLES, 'ttl_ms': TTL_MS}, recover)
            report['credentials_received'] = {}
            for role, value in values.items():
                credential(value)
                save_private(directory / (role + '.json'), value, recover)
                report['credentials_received'][role] = {key: value[key] for key in ['token_id', 'expires_at']}
            require(result['status'] in {'issued', 'recovered'} and set(values) == set(ROLES), result.get('error', 'REMOTE_CREDENTIAL_MISSING'))
            opener = build_opener(ProxyHandler({}), HTTPSHandler(), NoRedirect())
            report['public_identity'] = {role: verify_identity(opener, role, value) for role, value in values.items()}
            phone = values['phone']
            import_value = {'format': 'turboio-material-sync/1', 'base_url': BASE.rstrip('/'), 'owner_id': OWNER,
                'producer_id': ROLES['phone']['producer_id'], 'server_id': SERVER, 'token': phone['token'],
                'token_id': phone['token_id'], 'expires_at': phone['expires_at']}
            save_private(directory / 'connection.json', import_value, recover)
            save_private(directory / 'query-config.json', {'schema_version': '1.0', 'base_url': BASE, 'owner_id': OWNER,
                'producer_id': ROLES['reader']['producer_id'], 'server_id': SERVER, 'credential_file': 'reader.json', 'timeout_ms': 10000}, recover)
            save_private(directory / 'verified.json', {'schema': 1, 'run_id': args.run_id, 'public_identity': report['public_identity']}, recover)
            report['status'] = 'ready'
    except Exception as error:
        report['error'] = safe_error(error)
        report['status'] = 'issue_observation_unknown' if issue_dispatched else 'partial' if report.get('credentials_received') else 'failed'
    finally:
        if connection and connection != 'openssh':
            connection.close()
    try:
        persist_report(report)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'mode': mode, 'run_id': args.run_id, 'error': safe_error(error)}))
        return 1
    print(json.dumps({'status': report['status'], 'mode': mode, 'run_id': args.run_id, 'error': report.get('error')}))
    return 0 if report['status'] in {'inspected', 'ready'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
