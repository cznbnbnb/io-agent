"""Compare the known local speaker fixture; never export captured text/embeddings."""
import argparse
import json
import re
from pathlib import Path

FIXTURE = ('这是雷鸟眼镜的环境声音测试。现在只有电脑扬声器在播放声音。'
           '今天的测试编号是三七二五。请保留原始录音，分别检查左声道和右声道。'
           '这段话只用于测试，不需要添加待办，也不需要执行任务。')


def normalize(text):
    # Explicitly normalize digit glyphs, not word choices or homophones.
    digits = str.maketrans('0123456789', '零一二三四五六七八九')
    return ''.join(re.findall(r'[\u4e00-\u9fffA-Za-z]', text.translate(digits))).lower()


def distance(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[-1] + 1,
                               previous[j-1] + (x != y)))
        previous = current
    return previous[-1]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('private_dir', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    expected = normalize(FIXTURE)
    rows = []
    for channel in ['mix', 'left', 'right']:
        source = json.loads((args.private_dir / f'speaker25-audible-{channel}.json').read_text(encoding='utf-8'))
        utterances = source['utterances']
        actual = normalize(''.join(row['text'] for row in utterances))
        phrases = ['环境声音测试', '电脑扬声器', '保留原始录音', '左声道和右声道', '不需要执行任务']
        matches = sum(phrase in actual for phrase in phrases)
        verified = matches >= 3
        # An uncontrolled ambient source is not a valid reference for CER.
        edits = distance(expected, actual) if verified else None
        rows.append({'channel': channel, 'utterances': len(utterances),
                     'speakerClusters': len(source['speakers']),
                     'recognizedCharacters': len(actual), 'referenceCharacters': len(expected),
                     'fixtureVerified': verified, 'matchedFixturePhrases': matches,
                     'editDistance': edits, 'characterErrorRate': edits / len(expected) if verified else None,
                     'fixtureNumberFound': '三七二五' in actual,
                     'intervals': [{k: row[k] for k in ['start', 'end', 'speaker'] if k in row}
                                   for row in utterances]})
    report = {'kind': 'known_synthetic_fixture_comparison',
              'reference': FIXTURE,
              'normalization': 'remove punctuation/space; digit glyphs to Chinese digits; no homophone repair',
              'scope': 'CER withheld unless fixture phrases verified; no claim of single speaker, daily or two-person accuracy',
              'channels': rows}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(rows, ensure_ascii=False, indent=2))
