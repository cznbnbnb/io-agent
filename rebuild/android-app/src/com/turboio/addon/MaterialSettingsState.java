package com.turboio.addon;
import java.util.*;

/** Plaintext contract inside authenticated settings envelopes. The old slot is
 * a paused projection; changed old-version settings are never silently ignored. */
final class MaterialSettingsState {
 static byte[] legacy(MaterialConfig config){return config.enabled(false).encode();}
 static byte[] encode(MaterialConfig config){return WireJson.bytes(WireJson.object("schema",2,"config",WireJson.read(config.encode()),"legacy_sha256",TaskWire.hash(legacy(config))));}
 static MaterialConfig decode(byte[] current,byte[] legacy){
  Map<String,Object> value=WireJson.map(WireJson.read(current,16384,250));BoundedJson.keys(value,"schema","config","legacy_sha256");MaterialWire.require(MaterialWire.positive(value.get("schema"))==2,"MATERIAL_CONFIG_INVALID");MaterialConfig config=MaterialConfig.decode(WireJson.bytes(value.get("config")));
  MaterialWire.require(legacy!=null&&value.get("legacy_sha256").equals(TaskWire.hash(MaterialConfig.decode(legacy).encode()))&&value.get("legacy_sha256").equals(TaskWire.hash(legacy(config))),"MATERIAL_LEGACY_CONFIG_CHANGED");return config;
 }
}
