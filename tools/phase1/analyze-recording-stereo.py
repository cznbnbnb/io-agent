"""Analyze an explicitly authorized lab WAV; never infer microphone/person identity."""
import argparse
import array
import hashlib
import json
import math
import sys
import wave
from pathlib import Path


def rms(values):
    return math.sqrt(sum(v * v for v in values) / len(values)) if values else 0


def analyze(path):
    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 2 or wav.getsampwidth() != 2:
            raise ValueError("Expected stereo PCM16 lab WAV")
        rate = wav.getframerate()
        pcm = array.array("h", wav.readframes(wav.getnframes()))
    if sys.byteorder != "little":
        pcm.byteswap()
    left, right = pcm[0::2], pcm[1::2]
    lr, rr = rms(left), rms(right)
    cross = sum(a * b for a, b in zip(left, right))
    norm = math.sqrt(sum(v * v for v in left) * sum(v * v for v in right))
    seconds = []
    for start in range(0, len(left), rate):
        a, b = left[start:start + rate], right[start:start + rate]
        seconds.append({"start": start / rate, "leftRms": round(rms(a), 3),
                        "rightRms": round(rms(b), 3),
                        "mixRms": round(rms([(x + y) / 2 for x, y in zip(a, b)]), 3)})
    return {"schema": 1, "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "rate": rate, "channels": 2, "seconds": len(left) / rate,
            "leftRms": round(lr, 3), "rightRms": round(rr, 3),
            "leftRightDb": round(20 * math.log10(lr / rr), 3) if lr and rr else None,
            "normalizedCrossCorrelation": round(cross / norm, 6) if norm else None,
            "identicalFrames": sum(a == b for a, b in zip(left, right)),
            "clippedLeft": sum(abs(v) >= 32767 for v in left),
            "clippedRight": sum(abs(v) >= 32767 for v in right),
            "identity": "unverified_channel_provenance", "windows": seconds}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = analyze(args.wav)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "windows"}, ensure_ascii=False))
