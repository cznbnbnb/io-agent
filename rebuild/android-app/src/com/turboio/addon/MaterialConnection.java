package com.turboio.addon;

import java.net.URI;import java.util.*;

/** Existing material-sync connection contract; separate from all computer task credentials. */
final class MaterialConnection {
 static final String FORMAT="turboio-material-sync/1";
 final String base,owner,producer,server,expires;final long expiresAt;private final Map<String,Object> values;
 private MaterialConnection(Map<String,Object> input,long now){
  BoundedJson.keys(input,"format","base_url","owner_id","producer_id","server_id","token","token_id","expires_at");
  for(Object value:input.values())MaterialWire.text(value,2048,false);
  MaterialWire.require(FORMAT.equals(input.get("format")),"MATERIAL_IMPORT_FORMAT");base=base((String)input.get("base_url"));
  owner=principal(input.get("owner_id"));producer=principal(input.get("producer_id"));server=principal(input.get("server_id"));
  MaterialWire.require(((String)input.get("token")).matches("[A-Za-z0-9_-]{43}"),"MATERIAL_TOKEN_INVALID");
  MaterialWire.require(((String)input.get("token_id")).matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"),"MATERIAL_TOKEN_ID_INVALID");
  expires=(String)input.get("expires_at");expiresAt=MaterialWire.time(expires);MaterialWire.require(expiresAt>now,"MATERIAL_IMPORT_EXPIRED");
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
 String preview(){return base+"\n资料所有者："+owner+"\n手机："+producer+"\n服务："+server+"\n有效期："+expires;}
 Set<String> identity(byte[] raw,long now,boolean requireVersion){
  Map<String,Object> v=WireJson.map(WireJson.read(raw));MaterialWire.require(expiresAt>now&&"1.0".equals(v.get("schema_version"))&&owner.equals(v.get("owner_id"))&&producer.equals(v.get("producer_id"))&&server.equals(v.get("server_id")),"MATERIAL_IDENTITY_MISMATCH");
  MaterialWire.require(MaterialWire.time(v.get("expires_at"))==expiresAt,"MATERIAL_EXPIRY_MISMATCH");MaterialWire.require(WireJson.list(v.get("scopes")).contains("materials:write"),"MATERIAL_WRITE_SCOPE_REQUIRED");
  Set<String> versions=new HashSet<>();if(v.containsKey("material_schema_versions")){List<Object> list=WireJson.list(v.get("material_schema_versions"));MaterialWire.require(list.size()<=16,"MATERIAL_SCHEMA_INVALID");for(Object item:list){String s=MaterialWire.text(item,16,false);MaterialWire.require(s.matches("[0-9]+\\.[0-9]+"),"MATERIAL_SCHEMA_INVALID");versions.add(s);}}
  MaterialWire.require(!requireVersion||versions.contains("1.2"),"MATERIAL_SCHEMA_UNSUPPORTED");return versions;
 }
}
