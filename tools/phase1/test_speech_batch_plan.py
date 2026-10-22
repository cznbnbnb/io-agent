import unittest
from speech_batch_plan import speech_spans, batch_spans, source_sample, map_token_starts


class SpeechBatchTests(unittest.TestCase):
    def test_padding_preserves_edges_and_merges_overlap_without_duplicate_audio(self):
        self.assertEqual(speech_spans(10000, [(100, 1000), (1100, 1500), (9500, 9900)], 200), ((0, 1700), (9300, 10000)))

    def test_silence_produces_no_batch_and_cannot_manufacture_speech(self):
        self.assertEqual(batch_spans(speech_spans(160000, [])), ())

    def test_discontinuous_samples_map_exactly_and_separator_is_unowned(self):
        batch, = batch_spans(((16000, 32000), (160000, 176000)), seam=1600)
        self.assertEqual(batch.samples, 33600)
        self.assertEqual(source_sample(batch, 15999), 31999)
        self.assertIsNone(source_sample(batch, 16000))
        self.assertIsNone(source_sample(batch, 17599))
        self.assertEqual(source_sample(batch, 17600), 160000)
        self.assertEqual(source_sample(batch, batch.samples), 176000)
        for bad in [-1, batch.samples+1, float('nan'), True]:
            self.assertIsNone(source_sample(batch, bad))

    def test_short_groups_obey_limit_while_long_speech_is_explicit_passthrough(self):
        batches = batch_spans(((0, 10000), (20000, 30000), (40000, 210000), (220000, 230000)), maximum=16000, seam=1000)
        self.assertEqual([len(b.pieces) for b in batches], [1, 1, 1, 1])
        self.assertEqual([b.long_passthrough for b in batches], [False, False, True, False])
        self.assertEqual(sum(p.source_end-p.source_start for b in batches for p in b.pieces), 200000)

    def test_invalid_vad_ranges_fail_before_processing(self):
        for ranges in [[(10, 10)], [(-1, 20)], [(0, 101)], [(30, 50), (10, 20)], [(0, 30), (20, 40)], [(True, 10)]]:
            with self.assertRaises(ValueError):speech_spans(100, ranges, 0)
        with self.assertRaises(ValueError):batch_spans(((0, 10),), maximum=1)
        with self.assertRaises(ValueError):speech_spans(100, [(0, 1)]*1001)

    def test_every_retained_sample_occurs_once_in_original_order(self):
        spans = speech_spans(100000, [(1000, 3000), (10000, 12000), (50000, 54000), (98000, 100000)], 500)
        batches = batch_spans(spans, maximum=16000, seam=777)
        expected = [i for a, b in spans for i in range(a, b)]
        restored = [source_sample(batch, i) for batch in batches for i in range(batch.samples)]
        self.assertEqual([i for i in restored if i is not None], expected)

    def test_separator_token_requires_whole_batch_fallback_without_dropping_words(self):
        batch,=batch_spans(((16000,32000),(160000,176000)),seam=1600)
        self.assertEqual(map_token_starts(batch,[.5,1.1,2.1]),(1.5,10.0,11.0))
        self.assertIsNone(map_token_starts(batch,[.5,1.05,1.5]))

    def test_unusable_model_timestamps_fail_without_guessing_original_time(self):
        batch,=batch_spans(((16000,32000),))
        for times in [[],[.5,.1],[float('nan')],[True],[-1],[2]]:
            self.assertIsNone(map_token_starts(batch,times))


if __name__ == '__main__':unittest.main()
