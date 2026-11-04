package com.turboio.addon;
import java.net.URI;import java.util.*;

/** Public release metadata, validated once before it reaches the updater. */
final class AppRelease {
 final String version,url,sha256,signer;final long code,bytes;final List<String> notes;
 AppRelease(byte[] json,String installedPackage){
  Map<String,Object> v=WireJson.map(WireJson.read(json));BoundedJson.keys(v,"schema","application_id","version","version_code","url","bytes","sha256","signer_sha256","host_version","notes");
  MaterialWire.require(Long.valueOf(1).equals(v.get("schema"))&&installedPackage.equals(v.get("application_id"))&&"1.0.10".equals(v.get("host_version")),"UPDATE_RELEASE_INCOMPATIBLE");
  version=MaterialWire.text(v.get("version"),64,false);MaterialWire.require(version.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-z0-9]+)?"),"UPDATE_RELEASE_INVALID");code=MaterialWire.positive(v.get("version_code"));bytes=MaterialWire.positive(v.get("bytes"));MaterialWire.require(bytes<=1073741824L,"UPDATE_RELEASE_INVALID");
  sha256=MaterialWire.text(v.get("sha256"),64,false);signer=MaterialWire.text(v.get("signer_sha256"),64,false);MaterialWire.require(sha256.matches("[a-f0-9]{64}")&&signer.matches("[a-f0-9]{64}"),"UPDATE_RELEASE_INVALID");
  url=MaterialWire.text(v.get("url"),256,false);URI uri=URI.create(url);MaterialWire.require("https".equals(uri.getScheme())&&"cznbnb.cn".equals(uri.getHost())&&uri.getPort()==-1&&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null&&uri.getPath().matches("/io-updates/iO-Agent-Android-[A-Za-z0-9.-]+\\.apk"),"UPDATE_RELEASE_INVALID");
  List<String> lines=new ArrayList<>();for(Object item:WireJson.list(v.get("notes")))lines.add(MaterialWire.text(item,500,false));MaterialWire.require(lines.size()<=20,"UPDATE_RELEASE_INVALID");notes=Collections.unmodifiableList(lines);
 }
}
