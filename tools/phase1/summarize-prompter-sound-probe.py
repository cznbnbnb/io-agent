"""Produce a content-free diagnostic report from an owned phone sound probe.

Raw layouts, audio, transcripts, and full native logs must remain private.
This reports observations; it does not approve speech-follow or speaker identity.
"""
import argparse
import array
import hashlib
import json
import math
import re
import sys
import wave
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_directory', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--did', required=True)
    parser.add_argument('--round', required=True, type=int)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f-]{36}', args.did) or args.round < 1:
        raise ValueError('INVALID_OWN_PROMPTER_ID')
    base = args.private_directory
    fixture, capture = read(base/'own-recording.json'), read(base/'retrieval.json')
    manifest = read(base/'own-manifest.json')
    if fixture['synthetic'] is not True or capture['own_test'] is not True or fixture['uuid'] != manifest['uuid']:
        raise ValueError('NOT_OWNED_CAPTURE')
    if not all(manifest[k] is True for k in ('completed', 'valid', 'wavReady')):
        raise ValueError('INCOMPLETE_CAPTURE')
    wav_path = base/'environment.wav'
    if sha(wav_path) != capture['wave_sha256']:
        raise ValueError('CAPTURE_WAVE_CHANGED')
    with wave.open(str(wav_path), 'rb') as source:
        frames, rate, channels = source.getnframes(), source.getframerate(), source.getnchannels()
        if (rate, channels, source.getsampwidth()) != (16000, 2, 2):
            raise ValueError('UNEXPECTED_WAVE_FORMAT')
        pcm = array.array('h', source.readframes(frames))
    if sys.byteorder != 'little':
        pcm.byteswap()
    if len(pcm) != frames*channels:
        raise ValueError('INCOMPLETE_PCM')
    channel_stats = []
    for channel in range(channels):
        samples = pcm[channel::channels]
        channel_stats.append({'index': channel, 'rms': math.sqrt(sum(v*v for v in samples)/frames),
                              'peak': max(abs(v) for v in samples), 'nonzero_samples': sum(v != 0 for v in samples),
                              'clipped_samples': sum(abs(v) >= 32767 for v in samples)})
    transcript = read(base/'own-transcript-private.json')
    logs = list(dict.fromkeys((base/'follow-before-start-private.log').read_text(encoding='utf-8-sig').splitlines() +
                             (base/'follow-after-stop-private.log').read_text(encoding='utf-8-sig').splitlines()))
    own_lines = [line for line in logs if 'did='+args.did+' ' in line]
    def observed(fragment):
        return any(fragment in line for line in own_lines)
    peaks = []
    for line in logs:
        match = re.search(r'follow audio source=local round=(\d+) packets=(\d+) samples=(\d+) rms=(\d+) texts=(\d+)', line)
        if match and int(match[1]) == args.round:
            peaks.append(tuple(map(int, match.groups()[1:])))
    closing = [line for line in own_lines if 'phase=closing ' in line]
    if not peaks or not closing or not observed('type=6 action=2 code=1'):
        raise ValueError('INCOMPLETE_FOLLOW_OBSERVATION')
    latest_close = closing[-1]
    received = int(re.search(r' audio=(\d+) ', latest_close)[1])
    tail = logs[logs.index(latest_close)+1:]
    closed_idle = any('prompter state did= phase=idle ' in line and ' audio='+str(received)+' ' in line for line in tail)
    retained = {name: sha(base/('before-'+name+'.bin')) == sha(base/('after-'+name+'.bin'))
                for name in ('canonical', 'audio', 'original_asr')}
    before, after = read(base/'before-outbox.bin'), read(base/'after-outbox.bin')
    prior = {row['queue_id']: row for row in before['rows']}
    current = {row['queue_id']: row for row in after['rows']}
    prior_rows_preserved = all(current.get(key) == value for key, value in prior.items())
    if not all(retained.values()) or not prior_rows_preserved or not closed_idle:
        raise ValueError('RETENTION_OR_EXIT_REQUIRES_REVIEW')
    queue = read(base/'asr-final.json')
    pending_jobs = sum(job['status'] not in ('succeeded', 'failed', 'cancelled') for job in queue['jobs'])
    package = (base/'package-dump-private.txt').read_text(encoding='utf-8-sig')
    report = {
        'kind': 'real_phone_normal_recording_vs_prompter_input', 'candidate': '0.1.71',
        'native_version_name_observed': bool(re.search(r'"versionName"\s*:\s*"0\.1\.71"', package)),
        'native_expected_version_code_present': bool(re.search(r'"versionCode"\s*:\s*10071\b', package)),
        'normal_recording': {'take': capture['take'], 'wave_sha256': sha(wav_path), 'sample_rate': rate,
                             'seconds': frames/rate, 'frames': frames, 'channels': channel_stats,
                             'complete': True, 'asr_state': capture['asr_state'], 'utterances': len(transcript['utterances']),
                             'speech_seconds': transcript['speechSeconds'], 'covered_frames': transcript['covered_frames'],
                             'source_frames': transcript['source_frames'], 'boundary_processing': transcript['boundary_processing']},
        'desktop_output_during_recording': read(base/'output-during-recording.json'),
        'desktop_output_during_follow': read(base/'output-during-follow.json'),
        'follow': {'did': args.did, 'round': args.round, 'ready': observed('phase=ready '),
                   'start_ack': observed('type=3 action=2 code=1'), 'received_packets': received,
                   'rms_observations': len(peaks), 'all_observed_rms_zero': all(row[2] == 0 for row in peaks),
                   'observed_samples_per_packet': sorted({row[1] for row in peaks}),
                   'asr_text_events': sum('follow asr source=local round='+str(args.round)+' ' in line for line in logs),
                   'recognition_position_sends': sum('prompter tx ' in line and 'type=8 action=1' in line for line in own_lines),
                   'exit_ack': True, 'final_idle': closed_idle},
        'retained_source_bytes': retained, 'prior_outbox_rows_preserved': prior_rows_preserved,
        'outbox_bytes_unchanged': sha(base/'before-outbox.bin') == sha(base/'after-outbox.bin'),
        'additional_outbox_rows': len(set(current)-set(prior)), 'final_pending_asr_jobs': pending_jobs,
        'source_identity_verified': False, 'speech_follow_accepted': False,
        'scope': 'Digital output and normal recording work; sampled prompter PCM is silent. No lens, person/channel identity, accuracy or speech-follow acceptance.'
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'report': str(args.output), 'normal_recording_seconds': frames/rate,
                      'follow_received_packets': received, 'follow_rms_samples': len(peaks),
                      'prior_rows_preserved': prior_rows_preserved, 'additional_outbox_rows': report['additional_outbox_rows'],
                      'pending_asr_jobs': pending_jobs, 'speech_follow_accepted': False}))


if __name__ == '__main__':
    main()
