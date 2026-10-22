// Real production AudioNapi.cpp and Opus, with simulated NAPI environments.
// This verifies environment ownership/stream continuity, not Ark Worker routing.
#include <vector>
#include <string>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <algorithm>
#include "../entry/src/main/cpp/AudioNapi.cpp"
struct FakeValue {std::vector<uint8_t> bytes;};
struct FakeEnv {
  std::vector<napi_property_descriptor> properties;
  std::vector<FakeValue*> values;
  void(*cleanup)(void*)=nullptr;void* data=nullptr;std::string error;
  ~FakeEnv(){if(cleanup)cleanup(data);for(auto value:values)delete value;}
};
struct FakeInfo {void* data;napi_value arg;};
napi_status napi_get_cb_info(napi_env,napi_callback_info info,size_t* count,napi_value* args,napi_value*,void** data){if(args&&*count)args[0]=info->arg;if(data)*data=info->data;return napi_ok;}
napi_status napi_add_env_cleanup_hook(napi_env env,void(*cleanup)(void*),void* data){assert(!env->cleanup);env->cleanup=cleanup;env->data=data;return napi_ok;}
napi_status napi_throw_error(napi_env env,const char*,const char* error){env->error=error;return napi_ok;}
napi_status napi_get_undefined(napi_env,napi_value* value){*value=nullptr;return napi_ok;}
napi_status napi_is_arraybuffer(napi_env,napi_value value,bool* result){*result=value!=nullptr;return napi_ok;}
napi_status napi_get_arraybuffer_info(napi_env,napi_value value,void** data,size_t* size){*data=value->bytes.data();*size=value->bytes.size();return napi_ok;}
napi_status napi_create_arraybuffer(napi_env env,size_t size,void** data,napi_value* result){auto value=new FakeValue();value->bytes.resize(size);env->values.push_back(value);*result=value;*data=value->bytes.data();return napi_ok;}
napi_status napi_define_properties(napi_env env,napi_value,size_t count,const napi_property_descriptor* props){env->properties.insert(env->properties.end(),props,props+count);return napi_ok;}
void napi_module_register(napi_module*){}
napi_value Call(FakeEnv& env,const char* name,napi_value arg=nullptr){
 auto prop=std::find_if(env.properties.begin(),env.properties.end(),[&](const napi_property_descriptor& p){return std::string(p.utf8name)==name;});assert(prop!=env.properties.end());
 FakeInfo info{prop->data,arg};env.error.clear();auto value=prop->method(&env,&info);assert(env.error.empty());return value;
}
void Verify(const char* reset,const char* decode,const char* close,int channels,int samples){
 FakeEnv a,b;Init(&a,nullptr);Init(&b,nullptr);assert(a.data!=b.data);
 Call(a,reset);Call(b,reset);
 int error=0;auto encoder=opus_encoder_create(16000,channels,OPUS_APPLICATION_AUDIO,&error);assert(error==OPUS_OK);
 auto reference=opus_decoder_create(16000,channels,&error);assert(error==OPUS_OK);
 opus_encoder_ctl(encoder,OPUS_SET_BITRATE(samples==960?32000:96000));opus_encoder_ctl(encoder,OPUS_SET_VBR(0));
 std::vector<opus_int16> input(samples*channels),expected(samples*channels);FakeValue packet;packet.bytes.resize(240);
 for(int frame=0;frame<30;frame++){
  for(int i=0;i<samples;i++)for(int ch=0;ch<channels;ch++)input[i*channels+ch]=static_cast<opus_int16>(11000*std::sin(2*3.141592653589793*(370+ch*140)*(frame*samples+i)/16000.0));
  const int n=opus_encode(encoder,input.data(),samples,packet.bytes.data(),240);assert(n>0&&n<=240);
  if(n<240)assert(opus_packet_pad(packet.bytes.data(),n,240)==OPUS_OK);
  // Another environment is repeatedly reset/closed between packets of A.
  Call(b,reset);Call(b,close);
  const auto actual=Call(a,decode,&packet);assert(actual&&actual->bytes.size()==expected.size()*2);
  assert(opus_decode(reference,packet.bytes.data(),240,expected.data(),samples,0)==samples);
  for(size_t i=0;i<expected.size();i++)assert(static_cast<int16_t>(actual->bytes[i*2]|actual->bytes[i*2+1]<<8)==expected[i]);
 }
 Call(a,close);opus_decoder_destroy(reference);opus_encoder_destroy(encoder);
}
int main(){
 Verify("recordingReset","recordingDecode","recordingClose",2,320);
 Verify("lifelogReset","lifelogDecode","lifelogClose",1,960);
 Verify("reset","decode","close",1,320);
 std::puts("PASS: actual AudioNapi + Opus continuity across simulated environment reset/close for recording, lifelog, voice; cleanup hooks registered per environment");
}
