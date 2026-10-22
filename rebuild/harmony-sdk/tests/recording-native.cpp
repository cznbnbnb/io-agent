#include "../entry/src/main/cpp/RecordingDecode.h"
#include <cassert>
#include <cmath>
#include <iostream>

int main() {
  int error = 0;
  OpusEncoder* encoder = opus_encoder_create(16000, 2, OPUS_APPLICATION_AUDIO, &error);
  assert(encoder && error == OPUS_OK);
  assert(opus_encoder_ctl(encoder, OPUS_SET_BITRATE(96000)) == OPUS_OK);
  assert(opus_encoder_ctl(encoder, OPUS_SET_VBR(0)) == OPUS_OK);
  assert(opus_encoder_ctl(encoder, OPUS_SET_FORCE_CHANNELS(2)) == OPUS_OK);
  OpusDecoder* decoder = opus_decoder_create(16000, 2, &error);
  assert(decoder && error == OPUS_OK);
  uint8_t packet[240], output[1280];
  opus_int16 source[640];
  double energyLeft = 0, energyRight = 0;
  for (int frame = 0; frame < 30; ++frame) {
    for (int i = 0; i < 320; ++i) {
      const double t = (frame*320+i)/16000.0;
      source[2*i] = 0;  // Regression: speech solely on right must survive.
      source[2*i+1] = static_cast<opus_int16>(12000*std::sin(2*3.141592653589793*440*t));
    }
    assert(opus_encode(encoder, source, 320, packet, sizeof(packet)) == 240);
    assert(DecodeRecordingPacket(decoder, packet, 240, output, sizeof(output)));
    if (frame > 5) for (int i = 0; i < 320; ++i) {
      const int16_t left = static_cast<int16_t>(output[4*i] | (output[4*i+1] << 8));
      const int16_t right = static_cast<int16_t>(output[4*i+2] | (output[4*i+3] << 8));
      energyLeft += static_cast<double>(left)*left;
      energyRight += static_cast<double>(right)*right;
    }
  }
  assert(energyRight > 1e10 && energyLeft < energyRight*0.02);
  assert(!DecodeRecordingPacket(decoder, packet, 239, output, sizeof(output)));
  for (auto b : output) assert(b == 0);
  assert(!DecodeRecordingPacket(nullptr, packet, 240, output, sizeof(output)));
  assert(!DecodeRecordingPacket(decoder, packet, 240, output, 10));
  uint8_t wrongDuration[240] = {};
  // A valid 10 ms Opus frame padded to the recording byte width is still refused.
  const int n = opus_encode(encoder, source, 160, wrongDuration, sizeof(wrongDuration));
  assert(n > 0 && n <= 240);
  assert(opus_packet_pad(wrongDuration, n, 240) == OPUS_OK);
  assert(!DecodeRecordingPacket(decoder, wrongDuration, 240, output, sizeof(output)));
  opus_decoder_destroy(decoder); opus_encoder_destroy(encoder);
  std::cout << "PASS real Opus stereo/right-channel decode, length and duration guards\n";
}
