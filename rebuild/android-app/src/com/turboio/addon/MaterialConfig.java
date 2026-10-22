package com.turboio.addon;
import java.util.*;

/** Persisted material target bound to a specific official account. */
final class MaterialConfig {
 final MaterialConnection connection;final String account;final boolean enabled;
 MaterialConfig(MaterialConnection connection,String account,boolean enabled){MaterialWire.require(connection!=null&&account!=null&&account.matches("[a-f0-9]{64}"),"MATERIAL_ACCOUNT_INVALID");this.connection=connection;this.account=account;this.enabled=enabled;}
 byte[] encode(){return WireJson.bytes(WireJson.object("schema",1,"connection",WireJson.read(connection.encode()),"account",account,"enabled",enabled));}
 static MaterialConfig decode(byte[] bytes){Map<String,Object> value=WireJson.map(WireJson.read(bytes,12288,200));BoundedJson.keys(value,"schema","connection","account","enabled");MaterialWire.require(MaterialWire.positive(value.get("schema"))==1&&value.get("enabled") instanceof Boolean,"MATERIAL_CONFIG_INVALID");return new MaterialConfig(MaterialConnection.parse(WireJson.bytes(value.get("connection")),0),MaterialWire.text(value.get("account"),64,false),(Boolean)value.get("enabled"));}
 MaterialConfig enabled(boolean value){return new MaterialConfig(connection,account,value);}
 String fingerprint(){return TaskWire.hash(encode());}
 void replaceAllowed(MaterialConfig next){MaterialWire.require(!connection.binding().equals(next.connection.binding())||account.equals(next.account),"MATERIAL_ACCOUNT_REBIND_REFUSED");}
}
