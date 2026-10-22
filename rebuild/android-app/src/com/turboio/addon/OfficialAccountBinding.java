package com.turboio.addon;
import java.io.*;import java.util.*;

/** Stable source namespace, separate from expiring access tokens and our server
 * credentials. The host adapter must verify the live login before using it. */
public final class OfficialAccountBinding {
 private final long accountId;private final String domain;public final String binding;
 private OfficialAccountBinding(long id,String domain){accountId=id;this.domain=domain;binding=TaskWire.hash(WireJson.bytes(WireJson.object("provider","rayneo","domain",domain,"account_id",Long.toString(id))));}
 public static OfficialAccountBinding read(byte[] userInfo){Map<String,Object> value=WireJson.map(WireJson.read(userInfo,65536,1000));Object id=value.get("accountId");MaterialWire.require(id instanceof Long&&(Long)id>0,"OFFICIAL_ACCOUNT_INVALID");String domain=MaterialWire.text(value.get("domain"),128,true);return new OfficialAccountBinding((Long)id,domain);}
 public boolean same(OfficialAccountBinding other){return other!=null&&binding.equals(other.binding);}
 public File cacheFile(File appFlutter){return new File(appFlutter,"api_cache_user_"+accountId+".hive");}
 @Override public String toString(){return "OfficialAccountBinding[redacted]";}
}
