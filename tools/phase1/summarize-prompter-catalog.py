"""Freeze bounded catalog evidence without exposing raw UI, audio or identities.

Reads retained native evidence. It does not operate devices or infer lens output
from a completed GATT promise. The latest log snapshot is named round-B but its
only actual catalog transmission belongs to round A.
"""
import argparse, hashlib, json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PHASE=ROOT/'rebuild/phase1'
PRIVATE=PHASE/'device-private'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def write(name,value):
    (PHASE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def walk(node):
    if isinstance(node,dict):
        yield node
        for v in node.values(): yield from walk(v)
    elif isinstance(node,list):
        for v in node: yield from walk(v)

def native():
    evidence=PRIVATE/'catalog073-evidence'
    install=read(evidence/'install-ledger.json')
    assert install['installed'] and install['version']=='0.1.73' and install['version_code']==10073
    assert install['pid_before']!=install['pid_after']
    fixture=read(evidence/'fixture-A.json')
    assert fixture=={'synthetic':True,'unsaved':True,'title':'标题增量测试甲','utf8_bytes':225}
    raw=evidence/'round-B-private.log'
    lines=raw.read_text(encoding='utf-8-sig').splitlines()
    owned=[line for line in lines if re.search(r'\s'+re.escape(install['pid_after'])+r'\s',line) and '/org.turboio.harmony.research/TurboIO:' in line]
    sent=[line for line in owned if 'prompter catalog tx ' in line]
    assert len(sent)==1
    match=re.search(r'did=([0-9a-f-]{36}) operation=batchAdd count=1 owned=2$',sent[0])
    assert match
    did=match[1]
    selected=[line for line in owned if f'did={did} ' in line]
    def event(fragment):
        hits=[line for line in selected if fragment in line]
        assert hits, fragment
        return hits[-1].split()[1]
    times={
        'prepare_response':event('type=2 action=2 code=1'),
        'file_complete_response':event('file-rx did='+did+' type=5 match=true'),
        'business_ready':event('type=2 action=2 code=7'),
        'joint_ready':event('phase=ready progress=100'),
        'catalog_write_completed':sent[0].split()[1],
        'start_response':event('type=3 action=2 code=1'),
        'exit_response':event('type=6 action=2 code=1')
    }
    idle=[line for line in owned if 'prompter state did= phase=idle ' in line]
    assert idle and idle[-1].split()[1]>times['exit_response']
    times['idle']=idle[-1].split()[1]
    assert times['file_complete_response']<=times['joint_ready']<=times['catalog_write_completed']<times['start_response']<times['exit_response']
    preservation={}
    for key,expected in install['retained_hashes'].items():
        a,b=evidence/f'before-{key}.bin',evidence/f'after-{key}.bin'
        assert a.read_bytes()==b.read_bytes()
        assert digest(a)==expected==digest(b)
        preservation[key]={'sha256':expected,'unchanged_across_install':True}
    old=read(evidence/'after-catalog.bin')
    assert old['schema']==1 and len(old['items'])==1
    assert old['items'][0]['did']=='c77eb2eb-6224-40da-94b7-91ceb5ff6791'
    titles=[n['attributes'].get('text','') for n in walk(read(PRIVATE/'catalog073-B-title-observed.json'))
            if isinstance(n.get('attributes'),dict) and n['attributes'].get('type')=='TextInput']
    assert len(titles)==1 and len(titles[0])==14
    assert '标题增量测试甲' in titles[0] and '标题增量测试乙' in titles[0]
    assert not (evidence/'fixture-B.json').exists()
    result={
        'kind':'native_single_catalog_delta_and_existing_control_evidence','version':'0.1.73','versionCode':10073,
        'date':'2026-10-15','timezone':'Asia/Shanghai','synthetic':True,'unsaved':True,
        'signedHapSha256':install['hap_sha256'],'actualCoverInstall':True,'processChanged':True,
        'fixtureTitle':fixture['title'],'utf8Bytes':225,'did':did,'mode':2,
        'fileBusiness':17,'catalogBusiness':20,'catalogOuterType':1,'catalogAction':2,'catalogInnerType':3,
        'catalogTransmitLogCount':1,'ownedInventoryAfterPersistReported':2,'deltaItems':1,
        'timestamps':times,'startAndExitDeviceResponses':True,'finalObservedSessionIdle':True,
        'catalogAllReceivedObserved':any('prompter catalog observed action=1 type=3 ' in line for line in owned),
        'nativeLogSha256':digest(raw),'installPreservation':preservation,
        'preexistingOwnedRowsReadAfterUpgrade':1,'postRoundCatalogIndependentlyRead':False,
        'postRoundProtectedFilesIndependentlyRead':False,
        'roundB':{'transmitted':False,'fixturePresent':False,'exactTitleGuardSatisfied':False,
                  'observedSyntheticTitleLength':14,'observation':'inputText appended both owned fixture titles; script stopped before body verification and send'},
        'coldRestartVerified':False,'secondTitleVerified':False,'titleLensVerified':False,
        'unknownGlassesInventoryPreservedVerified':False,'base08Accepted':False,
        'limits':'A GATT write completion, file/control responses and App-owned inventory count do not prove a readable title or retention of unknown glasses files. Latest saved native observation is historical; no current phone state is inferred.'
    }
    write('catalog073-native-2026-10-15.json',result)
    return result

def build(run_id):
    run=PHASE/'candidate-runs'/run_id
    status,sign,final=map(read,[run/'status.json',run/'sign-status.json',run/'sign-finalization-status.json'])
    assert status['phase']=='complete' and status['compileSucceeded']
    assert sign['phase']=='complete' and sign['signingSucceeded']
    assert final['phase']=='complete' and final['verified'] and final['nativeSignature']['verified']
    hap=Path(final['hap']['path'])
    assert hap.stat().st_size==final['hap']['bytes']
    assert digest(hap)==final['hap']['sha256'].lower()==sign['hap']['sha256'].lower()
    count=int(status['versionCode'])-10000
    audit=read(PHASE/f'catalog{count:03d}-source-audit-2026-10-15.json')
    assert audit['passed'] and audit['runId']==run_id
    info={'kind':'catalog_candidate_build_freeze','version':status['versionName'],'versionCode':status['versionCode'],
          'runId':run_id,'realCompileSucceeded':True,'officialSignatureVerified':True,
          'signedHapBytes':final['hap']['bytes'],'signedHapSha256':digest(hap),
          'sourceFiles':final['sourceFiles'],'postBuildSourcePathAndHashAuditPassed':True,
          'nativeEvidenceVersion':'0.1.73' if count==73 else None,
          'installedThisCandidate':count==73}
    if count==74:
        old=read(PHASE/'candidate-runs/20261015-042958812-5d84e54b/source-hashes.json')
        new=read(run/'source-hashes.json')
        a,b={r['path']:r['sha256'] for r in old},{r['path']:r['sha256'] for r in new}
        assert a.keys()==b.keys()
        changes=sorted(k for k in a if a[k]!=b[k])
        assert changes==sorted(['harmony-sdk/AppScope/app.json5','harmony-sdk/entry/src/main/ets/TeleprompterCatalog.ets','harmony-sdk/tests/teleprompter-catalog.test.mjs'])
        info['sourceChangesSinceNative073']=changes
        info['native073EvidenceNotRetrospectivelyReassigned']=True
        tap=(PHASE/'catalog074-targeted.log').read_text(encoding='utf-8-sig')
        assert '# tests 40' in tap and '# pass 40' in tap and '# fail 0' in tap
        info['currentTargetedTests']={'total':40,'passed':40,'failed':0,'sha256':digest(PHASE/'catalog074-targeted.log')}
    else:
        tap=(PHASE/'catalog073-full-app.log').read_text(encoding='utf-8-sig')
        assert '# tests 922' in tap and '# pass 922' in tap and '# fail 0' in tap
        info['fullAppTests']={'total':922,'passed':922,'failed':0,'sha256':digest(PHASE/'catalog073-full-app.log')}
    write(f'catalog{count:03d}-build-freeze-2026-10-15.json',info)
    return info

if __name__=='__main__':
    args=argparse.ArgumentParser()
    args.add_argument('--run-id')
    option=args.parse_args()
    n=native()
    b=build(option.run_id) if option.run_id else None
    print(json.dumps({'nativeVersion':n['version'],'catalogWrites':n['catalogTransmitLogCount'],
                      'titleLensVerified':False,'build':b},ensure_ascii=False))
