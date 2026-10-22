"""Local, finite VAD/batching comparison. Reads only an authorized lab recording.

Uses installed project models, never network ASR, capture, deletion or publication.
This is a desktop benchmark, not HarmonyOS performance/accuracy acceptance.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import statistics
import time
from pathlib import Path
from speech_batch_plan import speech_spans, batch_spans, source_sample, map_token_starts


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def normalized(text):return ''.join(c for c in text if not c.isspace())


def edit_distance(a, b):
    row = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        next_row = [i]
        for j, y in enumerate(b, 1):next_row.append(min(next_row[-1]+1, row[j]+1, row[j-1]+(x != y)))
        row = next_row
    return row[-1]


def main():
    import numpy as np
    import sherpa_onnx as so
    import soundfile as sf
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--models', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--private-output', type=Path, required=True)
    a = p.parse_args()
    private_root = Path(__file__).resolve().parents[2]/'rebuild/phase1/device-private'
    if not a.private_output.resolve().is_relative_to(private_root.resolve()):raise ValueError('PRIVATE_OUTPUT_REQUIRED')
    if a.output.exists() or a.private_output.exists():raise ValueError('OUTPUT_ALREADY_EXISTS')
    if a.source.stat().st_size > 16000000:raise ValueError('SOURCE_TOO_LARGE')
    original_hash = digest(a.source)
    info=sf.info(a.source)
    if info.channels!=1 or not 31 < info.duration <= 90:raise ValueError('EXPECTED_BOUNDED_MONO_LAB_SOURCE')
    samples, rate = sf.read(a.source, dtype='float32', always_2d=True)
    if samples.shape[1] != 1:raise ValueError('EXPECTED_MONO_LAB_SOURCE')
    samples = samples[:, 0]
    original_rate = rate
    if rate != 16000:
        resampler = so.LinearResampler(rate, 16000, min(rate, 16000)*.45, 6)
        samples = resampler.resample(samples, flush=True);rate = 16000
    samples = np.asarray(samples, dtype=np.float32)
    if not 31*rate < len(samples) <= 90*rate:raise ValueError('EXPECTED_BOUNDED_LAB_SOURCE')
    model_paths = {key:a.models/name for key, name in [('asr','sensevoice/model.int8.onnx'),('tokens','sensevoice/tokens.txt'),('vad','vad/silero_vad.onnx')]}
    model_hashes = {key:digest(path) for key, path in model_paths.items()}
    before = time.perf_counter()
    recognizer = so.OfflineRecognizer.from_sense_voice(model=str(model_paths['asr']),tokens=str(model_paths['tokens']),language='zh',use_itn=True,num_threads=2,provider='cpu',debug=False)
    load_ms = (time.perf_counter()-before)*1000
    warmup = recognizer.create_stream();warmup.accept_waveform(rate,np.zeros(rate,dtype=np.float32));recognizer.decode_stream(warmup)

    def detect(audio):
        c = so.VadModelConfig();c.sample_rate=rate;c.num_threads=2;c.provider='cpu'
        c.silero_vad.model=str(model_paths['vad']);c.silero_vad.threshold=.5
        c.silero_vad.min_silence_duration=.5;c.silero_vad.min_speech_duration=.25
        c.silero_vad.window_size=512;c.silero_vad.max_speech_duration=12
        vad = so.VoiceActivityDetector(c,buffer_size_in_seconds=100)
        ranges=[];started=time.perf_counter()
        def drain():
            while not vad.empty():
                segment=vad.front;start=max(0,segment.start);end=min(len(audio),segment.start+len(segment.samples))
                if end>start:ranges.append((start,end))
                vad.pop()
        for at in range(0,len(audio),512):vad.accept_waveform(audio[at:at+512]);drain()
        vad.flush();drain()
        return ranges,(time.perf_counter()-started)*1000

    def transcribe(audio, batches):
        texts=[];details=[];mapped=0;unmapped=0;invalid=0;fallback=0;calls=[];started=time.perf_counter()
        for batch in batches:
            pcm=np.zeros(batch.samples,dtype=np.float32)
            for piece in batch.pieces:pcm[piece.packed_start:piece.packed_end]=audio[piece.source_start:piece.source_end]
            stream=recognizer.create_stream();stream.accept_waveform(rate,pcm)
            at=time.perf_counter();recognizer.decode_stream(stream);calls.append(round((time.perf_counter()-at)*1000,3))
            r=stream.result;text=r.text.strip();tokens=list(r.tokens);starts=list(r.timestamps)
            texts.append(text);alignment=bool(tokens) and len(tokens)==len(starts) and normalized(''.join(tokens).replace('▁',' '))==normalized(text)
            previous=0
            for t in starts:
                if not math.isfinite(t) or t<previous or t<0 or t>len(pcm)/rate:alignment=False
                previous=t
            original_starts=[]
            if alignment:
                for t in starts:
                    point=source_sample(batch,round(t*rate));original_starts.append(None if point is None else point/rate)
                    if point is None:unmapped+=1
                    else:mapped+=1
            elif text:invalid+=1
            requires_fallback=bool(text) and (not alignment or map_token_starts(batch,starts,rate) is None)
            if requires_fallback:fallback+=1
            details.append({'text':text,'tokens':tokens,'packed_starts':starts,'source_starts':original_starts,'alignment_usable':alignment,'requires_fallback':requires_fallback})
        return {'elapsed_ms':round((time.perf_counter()-started)*1000,3),'calls':len(batches),'call_ms':calls,'mapped_token_starts':mapped,'separator_token_starts_unowned':unmapped,'text_batches_without_usable_alignment':invalid,'batches_requiring_fallback':fallback},''.join(texts),details

    # Derived sparse fixture is explicitly synthetic, not another real recording.
    sparse=np.concatenate([np.zeros(8*rate,dtype=np.float32)]+[chunk for start in [2,10,20,28] for chunk in [samples[start*rate:(start+2)*rate],np.zeros(8*rate,dtype=np.float32)]])
    cases=[];private=[]
    for label,audio in [('original_continuous',samples),('derived_sparse_fixture',sparse)]:
        ranges,vad_ms=detect(audio);spans=speech_spans(len(audio),ranges,padding=2400)
        packed=batch_spans(spans,maximum=12*rate,seam=2560)
        independent=tuple(b for span in spans for b in batch_spans((span,),maximum=12*rate,seam=0))
        trials={'independent':[],'packed':[]};words={};private_trials=[]
        # ABBA reduces one-sided first-run/cache bias. Still only a tiny sample.
        for mode in ['independent','packed','packed','independent']:
            metrics,text,detail=transcribe(audio,independent if mode=='independent' else packed)
            trials[mode].append(metrics);words[mode]=text;private_trials.append({'mode':mode,'batches':detail})
        medians={mode:round(statistics.median(r['elapsed_ms'] for r in rows),3) for mode,rows in trials.items()}
        kept=sum(end-start for start,end in spans)
        cases.append({'case':label,'synthetic':label=='derived_sparse_fixture','source_seconds':len(audio)/rate,'vad_ms':round(vad_ms,3),'detected_spans':len(ranges),'padded_merged_spans':len(spans),'kept_seconds':kept/rate,'skipped_seconds':(len(audio)-kept)/rate,'packed_seconds':sum(b.samples for b in packed)/rate,'long_passthrough_batches':sum(b.long_passthrough for b in packed),'trials':trials,'median_ms':medians,'packed_over_independent_ratio':round(medians['packed']/medians['independent'],4) if medians['independent'] else None,'output_character_edit_distance':edit_distance(normalized(words['independent']),normalized(words['packed'])),'output_character_lengths':{mode:len(normalized(text)) for mode,text in words.items()}})
        cases[-1]['packed_requires_fallback']=any(row['batches_requiring_fallback'] for row in trials['packed'])
        private.append({'case':label,'vad_ranges':ranges,'padded_spans':spans,'trials':private_trials})
        print(json.dumps({'case':label,'medians_ms':medians,'baseline_calls':len(independent),'packed_calls':len(packed)},ensure_ascii=False),flush=True)
    if digest(a.source)!=original_hash:raise ValueError('ORIGINAL_CHANGED')
    result={'kind':'desktop_speech_batch_comparison','source_sha256':original_hash,'source_bytes':a.source.stat().st_size,'model_sha256':model_hashes,'runtime':{'platform':platform.system(),'architecture':platform.machine(),'python':platform.python_version(),'packages':{name:importlib.metadata.version(name) for name in ['sherpa-onnx','sherpa-onnx-core','numpy','soundfile']},'cpu_threads':2,'original_decode_rate':original_rate,'processing_rate':rate,'container_preskip_handled_by_libsndfile':True,'phone_decoder_timeline_equivalence_verified':False,'vad_input_chunk_samples':512,'phone_vad_chunk_equivalence_verified':False,'vad_min_speech_seconds':.25,'vad_min_silence_seconds':.5,'vad_max_speech_seconds':12,'padding_seconds':.15,'separator_seconds':.16,'batch_candidate_seconds':12},'model_load_ms':round(load_ms,3),'cases':cases,'scope':{'original_unchanged':True,'new_capture':False,'upload':False,'production_enabled':False,'phone_speed_measured':False,'accuracy_ground_truth_available':False,'speaker_identity_verified':False,'synthetic_separator_has_source_timestamp':False,'unmappable_tokens_must_fallback_before_production':True,'fallback_gate_exercised':True,'fallback_asr_cost_included_in_timing':False,'long_spans_are_not_split_or_cpu_bounded':True}}
    a.private_output.write_text(json.dumps(private,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()
