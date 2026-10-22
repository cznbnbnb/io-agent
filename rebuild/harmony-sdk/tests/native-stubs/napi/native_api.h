#pragma once
#if defined(_MSC_VER)
// Only suppress the OHOS module constructor attribute in this host harness.
#define __attribute__(x)
#endif
#include <cstddef>
struct FakeEnv;struct FakeValue;struct FakeInfo;
using napi_env=FakeEnv*;using napi_value=FakeValue*;using napi_callback_info=FakeInfo*;
using napi_callback=napi_value(*)(napi_env,napi_callback_info);
using napi_addon_register_func=napi_value(*)(napi_env,napi_value);
enum napi_status {napi_ok=0,napi_invalid_arg=1};enum napi_property_attributes{napi_default=0};
struct napi_property_descriptor{const char* utf8name;napi_value name;napi_callback method;napi_callback getter;napi_callback setter;napi_value value;napi_property_attributes attributes;void* data;};
struct napi_module{int version;unsigned flags;const char* filename;napi_addon_register_func init;const char* name;void* priv;void* reserved[4];};
napi_status napi_get_cb_info(napi_env,napi_callback_info,size_t*,napi_value*,napi_value*,void**);
napi_status napi_add_env_cleanup_hook(napi_env,void(*)(void*),void*);
napi_status napi_throw_error(napi_env,const char*,const char*);
napi_status napi_get_undefined(napi_env,napi_value*);
napi_status napi_is_arraybuffer(napi_env,napi_value,bool*);
napi_status napi_get_arraybuffer_info(napi_env,napi_value,void**,size_t*);
napi_status napi_create_arraybuffer(napi_env,size_t,void**,napi_value*);
napi_status napi_define_properties(napi_env,napi_value,size_t,const napi_property_descriptor*);
void napi_module_register(napi_module*);
