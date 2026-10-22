#pragma once
#include "opus.h"
#include <cstdint>
#include <cstring>

// AlwaysOn (LifeLog / 全天智记) audio profile, inspected from Strix OS 1.0.4.12:
// 240-byte packet carries a 60 ms SILK-WB mono Opus frame: 960 samples at 16 kHz.
// The recording profile (20 ms stereo, 320 samples) must not decode through here.
inline bool DecodeLifelogPacket(OpusDecoder* decoder, const uint8_t* input,
                                size_t length, uint8_t* output, size_t capacity) {
  if (!output || capacity < 1920) return false;
  std::memset(output, 0, 1920);
  if (!decoder || !input || length != 240 ||
      opus_packet_get_nb_samples(input, 240, 16000) != 960) return false;
  opus_int16 pcm[960] = {};
  const int samples = opus_decode(decoder, input, 240, pcm, 960, 0);
  if (samples != 960) { std::memset(pcm, 0, sizeof(pcm)); return false; }
  for (int i = 0; i < 960; ++i) {
    output[2*i] = static_cast<uint16_t>(pcm[i]) & 255;
    output[2*i+1] = static_cast<uint16_t>(pcm[i]) >> 8;
  }
  std::memset(pcm, 0, sizeof(pcm));
  return true;
}
