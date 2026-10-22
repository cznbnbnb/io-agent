"""Real UI controls, allowlisted labels only; never enables sync or reads imports."""
from pathlib import Path
import subprocess, json, re, time
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]/'rebuild/android-app'
SERIAL=json.loads((ROOT/'.private/phone-login-install-2026-10-20/verified-target.json').read_text())['serial']
ADB=str(ROOT/'.tools/sdk/platform-tools/adb.exe');PKG='com.rayneo.venus.pub';TEMP='/data/local/tmp/io-material-ui.xml'
def call(args):
 result=subprocess.run([ADB,'-s',SERIAL]+args,capture_output=True,timeout=20)
 if result.returncode:raise RuntimeError('PHONE_UI_COMMAND_FAILED')
 return result.stdout.decode('utf-8','replace')
def nodes():
 try:
  call(['shell','uiautomator','dump',TEMP])
  return list(ET.fromstring(call(['exec-out','cat',TEMP])).iter('node'))
 finally:call(['shell','rm','-f',TEMP])
def wait_label(text):
 for _ in range(6):
  values=nodes()
  if any(n.get('package')==PKG and n.get('text')==text for n in values):return values
 raise RuntimeError('EXPECTED_MATERIAL_LABEL_NOT_READY')
def click(text):
 choices=[n for n in wait_label(text) if n.get('package')==PKG and n.get('text')==text and n.get('clickable')=='true' and n.get('enabled')=='true']
 if len(choices)!=1:raise RuntimeError('MATERIAL_BUTTON_AMBIGUOUS')
 match=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',choices[0].get('bounds',''))
 if not match:raise RuntimeError('MATERIAL_BUTTON_BOUNDS_INVALID')
 x,y,z,w=map(int,match.groups());call(['shell','input','tap',str((x+z)//2),str((y+w)//2)])
def open_material():
 click('iO Agent');click('资料同步');values=wait_label('尚未配置资料服务器')
 if not any(n.get('text')=='资料连接设置' for n in values):raise RuntimeError('MATERIAL_SETTINGS_ENTRY_MISSING')
 return True
def main():
 report={'schema':1,'candidate':'0.5.2-dev1 /10417','normal_ui':True,'sync_enabled':False,'real_materials_uploaded':False,'microphone_started':False,'registration_files_opened':False,'checks':{}}
 try:
  version=call(['shell','dumpsys','package',PKG])
  if 'versionCode=10417' not in version or 'versionName=0.5.2-dev1' not in version:raise RuntimeError('PHONE_CANDIDATE_MISMATCH')
  call(['shell','input','keyevent','KEYCODE_WAKEUP']);call(['shell','wm','dismiss-keyguard']);call(['shell','am','start','-n',PKG+'/com.rayneo.venus.MainActivity'])
  report['checks']['normal_entry_to_material_page']=open_material();click('资料连接设置');values=wait_label('核对并保存');labels={n.get('text') for n in values}
  required={'选择资料登记文件','读取电脑登记文件','允许将当前账号的智记同步到此服务器'}
  if not required.issubset(labels):raise RuntimeError('MATERIAL_SETTINGS_CONTROLS_MISSING')
  report['checks']['connection_settings_controls']=True;call(['shell','input','keyevent','KEYCODE_BACK']);wait_label('尚未配置资料服务器');report['checks']['settings_dismiss_without_save']=True
  call(['shell','am','force-stop',PKG]);call(['shell','am','start','-n',PKG+'/com.rayneo.venus.MainActivity']);report['checks']['process_restart_login_and_entry']=open_material()
  report['passed']=True
 except Exception as failure:
  message=str(failure);report['error']=message if re.fullmatch('[A-Z_]{3,80}',message) else type(failure).__name__;report['passed']=False
 finally:
  report['at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());(ROOT/'phone-material-ui-2026-10-21.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
 return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
