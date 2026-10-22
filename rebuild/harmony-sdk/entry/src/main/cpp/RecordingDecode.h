#pragma once
#include "opus.h"
#include <cstdint>
#include <cstring>

// Shared by the Harmony N-API bridge and the host regression test. This profile
// is deliberately narrow; a different recording format must not decode as PCM.
inline bool DecodeRecordingPacket(OpusDecoder* decoder, const uint8_t* input,
                                  size_t length, uint8_t* output, size_t capacity) {
  if (!output || capacity < 1280) return false;
  std::memset(output, 0, 1280);
  if (!decoder || !input || length != 240 ||
      opus_packet_get_nb_samples(input, 240, 16000) != 320) return false;
  opus_int16 pcm[640] = {};
  const int samples = opus_decode(decoder, input, 240, pcm, 320, 0);
  if (samples != 320) { std::memset(pcm, 0, sizeof(pcm)); return false; }
  for (int i = 0; i < 640; ++i) {
    output[2*i] = static_cast<uint16_t>(pcm[i]) & 255;
    output[2*i+1] = static_cast<uint16_t>(pcm[i]) >> 8;
  }
  std::memset(pcm, 0, sizeof(pcm));
  return true;
}
