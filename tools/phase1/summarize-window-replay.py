"""Check saved-source replay artifacts without publishing words or source IDs."""
import argparse
import hashlib
import json
from pathlib import Path

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def latest(root):
    return read(sorted((root/'materials').rglob('revision-*.json'))[-1])

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    for key in ['root','journal','original','manifest','output']:
        p.add_argument('--'+key,required=True,type=Path)
    p.add_argument('--previous',type=Path)
    a=p.parse_args();journal=read(a.journal);manifest=read(a.manifest)
    assert journal['phase']=='completed' and all(not s['capture'] for s in journal['samples'])
    audio=next((a.root/'lifelog').rglob('audio.ogg'));raw=audio.read_bytes()
    assert 0<len(raw)<=16000000
    digest=lambda b:hashlib.sha256(b).hexdigest()
    results=[read(f)['result'] for f in (a.root/'asr-windows').rglob('*.json')]
    results.sort(key=lambda r:r['windowStartFrame']);assert results
    intervals=[(r['windowStartFrame'],r['windowEndFrame']) for r in results]
    continuous=intervals[0][0]==0 and all(x[1]==y[0] for x,y in zip(intervals,intervals[1:])) and intervals[-1][1]==results[-1]['frames']
    def owned(r,u):
        begin,end=r['windowStartFrame']*60000,r['windowEndFrame']*60000
        return u['alignment']=='token_starts' and len(u['tokens'])==len(u['tokenStarts']) and all(
            begin<=round(t*1000000)<end or round(t*1000000)==end==r['frames']*60000 for t in u['tokenStarts'])
    aligned=all(r['boundaryProcessing'] in ['token_starts','no_speech'] and all(owned(r,u) for u in r['utterances']) for r in results)
    prefixes=all(0<r['sourcePrefixBytes']<=len(raw) and digest(raw[:r['sourcePrefixBytes']])==r['sourcePrefixSha256'] for r in results)
    material=latest(a.root);budget=read(a.root/'asr-worker-budget.json')
    same_source=digest(raw)==digest(a.original.read_bytes())==journal['replaySourceSha256']
    out={'kind':'actual_device_saved_source_replay_verification','version':manifest['version'],
         'signed_hap_sha256':manifest['signed_hap_sha256'],'phase':journal['phase'],
         'source_bytes':len(raw),'source_sha256':digest(raw),'original_and_copy_unchanged':same_source,
         'windows':intervals,'continuous_core_coverage':continuous,'model_token_starts_owned_by_core':aligned,
         'all_committed_prefix_hashes_verified':prefixes,
         'owned_token_counts':[sum(len(u.get('tokens',[])) for u in r['utterances']) for r in results],
         'total_attempt_elapsed_ms':journal['finished']-journal['attemptStarted'],
         'material':{k:material[k] for k in ['revision','text_revision','speaker_processing','boundary_processing']},
         'utterances':len(material['utterances']),'text_chars':len(material['text']),
         'budget_sequence':budget['sequence'],'remaining_rows_accounting':[r['accounting'] for r in budget['rows']],
         'scope':{'new_acquisition':False,'background_replay':any(s['screenKnown'] and not s['screenActive'] for s in journal['samples']),
                  'screen_off_samples':sum(s['screenKnown'] and not s['screenActive'] for s in journal['samples']),'accuracy_accepted':False,
                  'speaker_identity_accepted':False,'parallel_capture_accepted':False,'uncharged_or_eight_hour_accepted':False}}
    if a.previous:
        old=latest(a.previous)
        out['same_utterance_texts_as_previous']=[u['text'] for u in old['utterances']]==[u['text'] for u in material['utterances']]
        out['same_rendered_text_as_previous']=old['text']==material['text']
    out['verified']=continuous and aligned and prefixes and same_source
    a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:out[k] for k in ['version','verified','windows','total_attempt_elapsed_ms']}))
