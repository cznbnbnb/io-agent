#include "napi/native_api.h"
#include "opus.h"
#include "RecordingDecode.h"
#include "LifelogDecode.h"
#include <cstdint>
#include <cstring>
#include <new>
// Each Ark/NAPI environment owns its stream states. Main-thread recording and
// ASR Worker share this library but must never reset or close each other's Opus.
struct AudioState {
  OpusDecoder *decoder = nullptr;
  OpusDecoder *recordingDecoder = nullptr;
  OpusDecoder *lifelogDecoder = nullptr;
  OpusDecoder *prompterDecoder = nullptr;
  ~AudioState() {
    if(decoder)opus_decoder_destroy(decoder);
    if(recordingDecoder)opus_decoder_destroy(recordingDecoder);
    if(lifelogDecoder)opus_decoder_destroy(lifelogDecoder);
    if(prompterDecoder)opus_decoder_destroy(prompterDecoder);
  }
};
static AudioState *State(napi_env env,napi_callback_info info) {
  void *data=nullptr;size_t count=0;
  if(napi_get_cb_info(env,info,&count,nullptr,nullptr,&data)!=napi_ok)return nullptr;
  return static_cast<AudioState*>(data);
}
static void Cleanup(void *data) { delete static_cast<AudioState*>(data); }
static napi_value Fail(napi_env env, const char *message) { napi_throw_error(env, nullptr, message); return nullptr; }
static napi_value Reset(napi_env env, napi_callback_info info) {
  auto state=State(env,info);if(!state)return Fail(env,"opus-environment-missing");
  auto &decoder=state->decoder;
  if (decoder) opus_decoder_destroy(decoder);
  int error = 0; decoder = opus_decoder_create(16000, 1, &error);
  if (!decoder || error != OPUS_OK) return Fail(env, "opus-init-failed");
  napi_value result; napi_get_undefined(env,&result); return result;
}
static napi_value Close(napi_env env, napi_callback_info info) {
  auto state=State(env,info);if(!state)return Fail(env,"opus-environment-missing");
  auto &decoder=state->decoder;
  if (decoder) opus_decoder_destroy(decoder); decoder=nullptr;
  napi_value result; napi_get_undefined(env,&result); return result;
}
static napi_value DecodeMono(napi_env env, napi_callback_info info, bool prompter) {
  size_t count=1; napi_value args[1];
  if(napi_get_cb_info(env,info,&count,args,nullptr,nullptr)!=napi_ok||count!=1)return Fail(env,"opus-input");
  bool array=false; void *bytes=nullptr; size_t length=0;
  if(napi_is_arraybuffer(env,args[0],&array)!=napi_ok||!array||napi_get_arraybuffer_info(env,args[0],&bytes,&length)!=napi_ok||length==0||length>4096)return Fail(env,"opus-input");
  auto state=State(env,info);if(!state)return Fail(env,"opus-environment-missing");
  auto decoder=prompter?state->prompterDecoder:state->decoder;
  if(!decoder)return Fail(env,"opus-not-ready");
  int expected=opus_packet_get_nb_samples(static_cast<unsigned char*>(bytes),static_cast<opus_int32>(length),16000);
  if(expected<=0||expected>1920||expected%160)return Fail(env,"opus-frame-size");
  opus_int16 pcm[1920]={0};
  int samples=opus_decode(decoder,static_cast<unsigned char*>(bytes),static_cast<opus_int32>(length),pcm,1920,0);
  if(samples!=expected){std::memset(pcm,0,sizeof(pcm));return Fail(env,"opus-decode-failed");}
  void *out=nullptr;napi_value result;
  if(napi_create_arraybuffer(env,static_cast<size_t>(samples)*2,&out,&result)!=napi_ok){std::memset(pcm,0,sizeof(pcm));return Fail(env,"pcm-allocation-failed");}
  auto dst=static_cast<uint8_t*>(out);
  for(int i=0;i<samples;i++){dst[2*i]=static_cast<uint16_t>(pcm[i])&255;dst[2*i+1]=(static_cast<uint16_t>(pcm[i])>>8)&255;}
  std::memset(pcm,0,sizeof(pcm));return result;
}
static napi_value Decode(napi_env env,napi_callback_info info){return DecodeMono(env,info,false);}
static napi_value PrompterDecode(napi_env env,napi_callback_info info){return DecodeMono(env,info,true);}
static napi_value PrompterReset(napi_env env,napi_callback_info info){
  auto state=State(env,info);if(!state)return Fail(env,"prompter-environment-missing");
  auto &decoder=state->prompterDecoder;if(decoder)opus_decoder_destroy(decoder);
  int error=0;decoder=opus_decoder_create(16000,1,&error);
  if(!decoder||error!=OPUS_OK)return Fail(env,"prompter-init-failed");
  napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value PrompterClose(napi_env env,napi_callback_info info){
  auto state=State(env,info);if(!state)return Fail(env,"prompter-environment-missing");
  auto &decoder=state->prompterDecoder;if(decoder)opus_decoder_destroy(decoder);decoder=nullptr;
  napi_value result;napi_get_undefined(env,&result);return result;
}
// Recording uses a separate 16 kHz stereo decoder. Never reuse/reset live ASR's
// mono state. 240-byte packet size is the inspected V1 recording profile only.
static napi_value RecordingReset(napi_env env,napi_callback_info info){
  auto state=State(env,info);if(!state)return Fail(env,"recording-environment-missing");
  auto &recordingDecoder=state->recordingDecoder;
  if(recordingDecoder)opus_decoder_destroy(recordingDecoder);
  int error=0;recordingDecoder=opus_decoder_create(16000,2,&error);
  if(!recordingDecoder||error!=OPUS_OK)return Fail(env,"recording-init-failed");
  napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value RecordingClose(napi_env env,napi_callback_info info){
  auto state=State(env,info);if(!state)return Fail(env,"recording-environment-missing");
  auto &recordingDecoder=state->recordingDecoder;
  if(recordingDecoder)opus_decoder_destroy(recordingDecoder);recordingDecoder=nullptr;
  napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value RecordingDecode(napi_env env,napi_callback_info info){
  size_t count=1;napi_value args[1];bool array=false;void* bytes=nullptr;size_t length=0;
  if(napi_get_cb_info(env,info,&count,args,nullptr,nullptr)!=napi_ok||count!=1||
     napi_is_arraybuffer(env,args[0],&array)!=napi_ok||!array||
     napi_get_arraybuffer_info(env,args[0],&bytes,&length)!=napi_ok||length!=240)return Fail(env,"recording-packet-size");
  auto state=State(env,info);if(!state)return Fail(env,"recording-environment-missing");
  auto recordingDecoder=state->recordingDecoder;
  if(!recordingDecoder)return Fail(env,"recording-not-ready");
  uint8_t pcm[1280]={0};
  if(!DecodeRecordingPacket(recordingDecoder,static_cast<const uint8_t*>(bytes),length,pcm,sizeof(pcm)))return Fail(env,"recording-decode-failed");
  void* output=nullptr;napi_value result;
  if(napi_create_arraybuffer(env,1280,&output,&result)!=napi_ok){std::memset(pcm,0,sizeof(pcm));return Fail(env,"recording-allocation-failed");}
  std::memcpy(output,pcm,sizeof(pcm));
  std::memset(pcm,0,sizeof(pcm));return result;
}
// AlwaysOn (LifeLog) uses its own 16 kHz mono decoder: 60 ms frames, 240 bytes
// in, 1920 bytes (960 samples) out. Same isolation rule as recording.
static napi_value LifelogReset(napi_env env,napi_callback_info info){
  auto state=State(env,info);if(!state)return Fail(env,"lifelog-environment-missing");
  auto &lifelogDecoder=state->lifelogDecoder;
  if(lifelogDecoder)opus_decoder_destroy(lifelogDecoder);
  int error=0;lifelogDecoder=opus_decoder_create(16000,1,&error);
  if(!lifelogDecoder||error!=OPUS_OK)return Fail(env,"lifelog-init-failed");
  napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value LifelogClose(napi_env env,napi_callback_info info){
  auto state=State(env,info);if(!state)return Fail(env,"lifelog-environment-missing");
  auto &lifelogDecoder=state->lifelogDecoder;
  if(lifelogDecoder)opus_decoder_destroy(lifelogDecoder);lifelogDecoder=nullptr;
  napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value LifelogDecode(napi_env env,napi_callback_info info){
  size_t count=1;napi_value args[1];bool array=false;void* bytes=nullptr;size_t length=0;
  if(napi_get_cb_info(env,info,&count,args,nullptr,nullptr)!=napi_ok||count!=1||
     napi_is_arraybuffer(env,args[0],&array)!=napi_ok||!array||
     napi_get_arraybuffer_info(env,args[0],&bytes,&length)!=napi_ok||length!=240)return Fail(env,"lifelog-packet-size");
  auto state=State(env,info);if(!state)return Fail(env,"lifelog-environment-missing");
  auto lifelogDecoder=state->lifelogDecoder;
  if(!lifelogDecoder)return Fail(env,"lifelog-not-ready");
  uint8_t pcm[1920]={0};
  if(!DecodeLifelogPacket(lifelogDecoder,static_cast<const uint8_t*>(bytes),length,pcm,sizeof(pcm)))return Fail(env,"lifelog-decode-failed");
  void* output=nullptr;napi_value result;
  if(napi_create_arraybuffer(env,1920,&output,&result)!=napi_ok){std::memset(pcm,0,sizeof(pcm));return Fail(env,"lifelog-allocation-failed");}
  std::memcpy(output,pcm,sizeof(pcm));
  std::memset(pcm,0,sizeof(pcm));return result;
}
static napi_value Init(napi_env env,napi_value exports){
  auto state=new(std::nothrow) AudioState();
  if(!state)return Fail(env,"audio-allocation-failed");
  if(napi_add_env_cleanup_hook(env,Cleanup,state)!=napi_ok){delete state;return Fail(env,"audio-cleanup-registration-failed");}
  napi_property_descriptor props[]={ {"reset",nullptr,Reset,nullptr,nullptr,nullptr,napi_default,nullptr}, {"decode",nullptr,Decode,nullptr,nullptr,nullptr,napi_default,nullptr}, {"close",nullptr,Close,nullptr,nullptr,nullptr,napi_default,nullptr} };
  for(auto &prop:props)prop.data=state;
  napi_define_properties(env,exports,3,props);
  napi_property_descriptor recording[]={ {"recordingReset",nullptr,RecordingReset,nullptr,nullptr,nullptr,napi_default,nullptr}, {"recordingDecode",nullptr,RecordingDecode,nullptr,nullptr,nullptr,napi_default,nullptr}, {"recordingClose",nullptr,RecordingClose,nullptr,nullptr,nullptr,napi_default,nullptr} };
  for(auto &prop:recording)prop.data=state;
  napi_define_properties(env,exports,3,recording);
  napi_property_descriptor lifelog[]={ {"lifelogReset",nullptr,LifelogReset,nullptr,nullptr,nullptr,napi_default,nullptr}, {"lifelogDecode",nullptr,LifelogDecode,nullptr,nullptr,nullptr,napi_default,nullptr}, {"lifelogClose",nullptr,LifelogClose,nullptr,nullptr,nullptr,napi_default,nullptr} };
  for(auto &prop:lifelog)prop.data=state;
  napi_define_properties(env,exports,3,lifelog);
  napi_property_descriptor prompter[]={ {"prompterReset",nullptr,PrompterReset,nullptr,nullptr,nullptr,napi_default,nullptr}, {"prompterDecode",nullptr,PrompterDecode,nullptr,nullptr,nullptr,napi_default,nullptr}, {"prompterClose",nullptr,PrompterClose,nullptr,nullptr,nullptr,napi_default,nullptr} };
  for(auto &prop:prompter)prop.data=state;
  napi_define_properties(env,exports,3,prompter);return exports;
}
static napi_module module={1,0,nullptr,Init,"turbo_audio",nullptr,{0}};
extern "C" __attribute__((constructor)) void RegisterTurboAudio(){napi_module_register(&module);}
