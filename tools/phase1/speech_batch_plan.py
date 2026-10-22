"""Isolated ASR experiment: immutable source spans and packed-to-source mapping.

No file writes, energy threshold, microphone assumptions or production dispatch.
Long speech spans remain individual; this prototype does not cut words to meet
a duration limit and must not be used as a CPU-budget enforcement mechanism.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Piece:
    source_start: int
    source_end: int
    packed_start: int
    packed_end: int


@dataclass(frozen=True)
class Batch:
    pieces: tuple[Piece, ...]
    samples: int
    long_passthrough: bool = False


def integer(value):
    return type(value) is int


def speech_spans(total, ranges, padding=2400):
    if not integer(total) or not 0 <= total <= 9_600_000 or not integer(padding) or not 0 <= padding <= 16000:
        raise ValueError('SPEECH_SOURCE_BOUNDS')
    if len(ranges) > 1000:
        raise ValueError('SPEECH_TOO_MANY_SPANS')
    padded = []
    previous_end = 0
    for start, end in ranges:
        if not integer(start) or not integer(end) or start < previous_end or not 0 <= start < end <= total:
            raise ValueError('SPEECH_SPAN_INVALID')
        previous_end = end
        a, b = max(0, start-padding), min(total, end+padding)
        if padded and a <= padded[-1][1]:
            padded[-1] = (padded[-1][0], max(b, padded[-1][1]))
        else:
            padded.append((a, b))
    return tuple(padded)


def batch_spans(spans, maximum=160000, seam=2560):
    if not integer(maximum) or not 16000 <= maximum <= 480000 or not integer(seam) or not 0 <= seam <= 8000:
        raise ValueError('SPEECH_BATCH_BOUNDS')
    if len(spans) > 1000:
        raise ValueError('SPEECH_TOO_MANY_SPANS')
    out, pieces, size, previous_end = [], [], 0, 0
    for start, end in spans:
        if not integer(start) or not integer(end) or start < previous_end or not 0 <= start < end <= 9_600_000:
            raise ValueError('SPEECH_SPAN_INVALID')
        previous_end = end
        length = end-start
        if pieces and size+seam+length > maximum:
            out.append(Batch(tuple(pieces), size));pieces, size = [], 0
        if length > maximum:
            out.append(Batch((Piece(start, end, 0, length),), length, True))
            continue
        at = size+(seam if pieces else 0)
        pieces.append(Piece(start, end, at, at+length));size = at+length
    if pieces:
        out.append(Batch(tuple(pieces), size))
    return tuple(out)


def source_sample(batch, sample):
    if not integer(sample) or not 0 <= sample <= batch.samples:
        return None
    for piece in batch.pieces:
        if piece.packed_start <= sample < piece.packed_end:
            return piece.source_start+sample-piece.packed_start
    if batch.pieces and sample == batch.samples:
        return batch.pieces[-1].source_end
    # Synthetic separator has no original timestamp. Never guess ownership.
    return None


def map_token_starts(batch, timestamps, rate=16000):
    """All-or-fallback: do not discard a separator token and hide lost text."""
    if not integer(rate) or not 8000 <= rate <= 48000 or not timestamps or len(timestamps)>65536:
        return None
    out=[];previous=0
    for value in timestamps:
        if type(value) not in (int,float) or not math.isfinite(value) or value<previous or not 0 <= value <= batch.samples/rate:
            return None
        previous=value;point=source_sample(batch,round(value*rate))
        if point is None:return None
        out.append(point/rate)
    return tuple(out)
