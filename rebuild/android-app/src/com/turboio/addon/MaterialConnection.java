package com.turboio.addon;

import java.net.URI;import java.util.*;

/** Existing material-sync connection contract; separate from all computer task credentials. */
final class MaterialConnection {
 static final String FORMAT="turboio-material-sync/1";
 final String base,owner,producer,server,expires;final String pairing,refreshSecret,accountBinding;final long expiresAt;private final Map<String,Object> values;
 private MaterialConnection(Map<String,Object> input,long now){
  boolean paired="turboio-material-sync/2".equals(input.get("format"));
  if(paired)BoundedJson.keys(input,"format","base_url","owner_id","producer_id","server_id","token","token_id","expires_at","pairing_id","refresh_secret","account_binding");else BoundedJson.keys(input,"format","base_url","owner_id","producer_id","server_id","token","token_id","expires_at");
  for(Object value:input.values())MaterialWire.text(value,2048,false);
  MaterialWire.require((paired||FORMAT.equals(input.get("format"))),"MATERIAL_IMPORT_FORMAT");base=base((String)input.get("base_url"));
  owner=principal(input.get("owner_id"));producer=principal(input.get("producer_id"));server=principal(input.get("server_id"));
  MaterialWire.require(((String)input.get("token")).matches("[A-Za-z0-9_-]{43}"),"MATERIAL_TOKEN_INVALID");
  MaterialWire.require(((String)input.get("token_id")).matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"),"MATERIAL_TOKEN_ID_INVALID");
  pairing=paired?principal(input.get("pairing_id")):"";refreshSecret=paired?MaterialWire.text(input.get("refresh_secret"),43,false):"";accountBinding=paired?MaterialWire.text(input.get("account_binding"),64,false):"";
  MaterialWire.require(!paired||refreshSecret.matches("[A-Za-z0-9_-]{43}")&&accountBinding.matches("[a-f0-9]{64}"),"MATERIAL_PAIRING_INVALID");
  expires=(String)input.get("expires_at");expiresAt=MaterialWire.time(expires);MaterialWire.require(paired||expiresAt>now,"MATERIAL_IMPORT_EXPIRED");
  values=Collections.unmodifiableMap(WireJson.map(WireJson.copy(input)));
 }
 static MaterialConnection parse(byte[] bytes,long now){MaterialWire.require(bytes!=null&&bytes.length<=8192,"MATERIAL_IMPORT_BUDGET");return new MaterialConnection(WireJson.map(WireJson.read(bytes)),now);}
 private static String principal(Object value){String s=MaterialWire.text(value,128,false);MaterialWire.require(s.matches("[A-Za-z0-9_.:-]{1,128}"),"MATERIAL_IDENTITY_INVALID");return s;}
 private static String base(String value){try{
  URI u=new URI(value);String host=u.getHost(),p=u.getRawPath();
  MaterialWire.require("https".equals(u.getScheme())&&host!=null&&host.matches("[A-Za-z0-9.-]+")&&!host.startsWith(".")&&!host.endsWith(".")&&!host.contains("..")&&(u.getPort()==-1||u.getPort()==443)&&u.getRawUserInfo()==null&&u.getRawQuery()==null&&u.getRawFragment()==null,"MATERIAL_TARGET_INVALID");
  MaterialWire.require(p!=null&&p.matches("(?:/[A-Za-z0-9._-]+)*/v1/?")&&!Arrays.asList(p.split("/",-1)).contains(".")&&!Arrays.asList(p.split("/",-1)).contains(".."),"MATERIAL_TARGET_INVALID");return value.endsWith("/")?value.substring(0,value.length()-1):value;
 }catch(Exception invalid){throw new IllegalArgumentException("MATERIAL_TARGET_INVALID");}}
 String token(){return (String)values.get("token");}byte[] encode(){return WireJson.bytes(values);}
 String binding(){return TaskWire.hash(WireJson.bytes(WireJson.object("base",base,"owner",owner,"producer",producer,"server",server)));}
 boolean paired(){return !pairing.isEmpty();}
 boolean renewDue(long now){return paired()&&expiresAt-now<=43200000L;}
 byte[] pairingBody(){return WireJson.bytes(WireJson.object("pairing_id",pairing,"account_binding",accountBinding));}
 MaterialConnection legacy(){Map<String,Object> v=new LinkedHashMap<>(values);v.put("format",FORMAT);v.remove("pairing_id");v.remove("refresh_secret");v.remove("account_binding");return new MaterialConnection(v,0);}
 MaterialConnection renewed(byte[] raw,long now){
  Map<String,Object> r=WireJson.map(WireJson.read(raw,8192,100));BoundedJson.keys(r,"owner_id","producer_id","server_id","pairing_id","account_binding","token","token_id","expires_at");
  for(String k:new String[]{"owner_id","producer_id","server_id","pairing_id","account_binding"})MaterialWire.require(values.get(k).equals(r.get(k)),"MATERIAL_IDENTITY_MISMATCH");
  Map<String,Object> v=new LinkedHashMap<>(values);for(String k:new String[]{"token","token_id","expires_at"})v.put(k,r.get(k));MaterialConnection next=new MaterialConnection(v,0);MaterialWire.require(next.expiresAt>now&&next.expiresAt<=now+90000000L,"MATERIAL_EXPIRY_MISMATCH");return next;
 }
 String preview(){return base+"\n资料所有者："+owner+"\n手机："+producer+"\n服务："+server+(paired()?"\n长期配对 · 自动续期":"\n有效期："+expires);}
 Set<String> identity(byte[] raw,long now,boolean requireVersion){
  Map<String,Object> v=WireJson.map(WireJson.read(raw));MaterialWire.require(expiresAt>now&&"1.0".equals(v.get("schema_version"))&&owner.equals(v.get("owner_id"))&&producer.equals(v.get("producer_id"))&&server.equals(v.get("server_id")),"MATERIAL_IDENTITY_MISMATCH");
  MaterialWire.require(MaterialWire.time(v.get("expires_at"))==expiresAt,"MATERIAL_EXPIRY_MISMATCH");MaterialWire.require(WireJson.list(v.get("scopes")).contains("materials:write"),"MATERIAL_WRITE_SCOPE_REQUIRED");
  Set<String> versions=new HashSet<>();if(v.containsKey("material_schema_versions")){List<Object> list=WireJson.list(v.get("material_schema_versions"));MaterialWire.require(list.size()<=16,"MATERIAL_SCHEMA_INVALID");for(Object item:list){String s=MaterialWire.text(item,16,false);MaterialWire.require(s.matches("[0-9]+\\.[0-9]+"),"MATERIAL_SCHEMA_INVALID");versions.add(s);}}
  MaterialWire.require(!requireVersion||versions.contains("1.2"),"MATERIAL_SCHEMA_UNSUPPORTED");return versions;
 }
}
