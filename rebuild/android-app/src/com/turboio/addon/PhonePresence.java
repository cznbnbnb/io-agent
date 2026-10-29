package com.turboio.addon;
import java.util.*;

/** Server reply is validated once. A lease starts at request dispatch, never
 * response arrival, so a delayed response cannot extend the old phone's term. */
final class PhonePresence {
 final String primary,device,account;final long revision,until,waitMillis,noticeAfter;final List<Phone> phones;
 static final class Phone {final String id,label;final boolean revoked;Phone(Map<String,Object> value){BoundedJson.keys(value,"device_id","label","revoked");id=TaskWire.text(value.get("device_id"),64,false);label=TaskWire.text(value.get("label"),64,false);TaskWire.require(value.get("revoked") instanceof Boolean,"PHONE_RESPONSE_INVALID");revoked=(Boolean)value.get("revoked");}}
 PhonePresence(byte[] raw,TaskDevice target,String account,long started){
  Map<String,Object> value=WireJson.map(WireJson.read(raw,65536,2000));BoundedJson.keys(value,"schema_version","server_id","owner_id","device_id","account_binding","primary_device_id","revision","notice_after_seq","lease_ms","wait_ms","phones");
  TaskWire.require("1.0".equals(value.get("schema_version"))&&target.server.equals(value.get("server_id"))&&target.owner.equals(value.get("owner_id"))&&target.deviceId.equals(value.get("device_id"))&&account.equals(value.get("account_binding")),"PHONE_IDENTITY_MISMATCH");
  this.account=account;device=target.deviceId;primary=TaskWire.text(value.get("primary_device_id"),64,false);revision=TaskWire.positive(value.get("revision"));noticeAfter=TaskWire.nonnegative(value.get("notice_after_seq"));long lease=TaskWire.nonnegative(value.get("lease_ms"));waitMillis=TaskWire.nonnegative(value.get("wait_ms"));TaskWire.require(lease<=20000&&waitMillis<=20000&&(lease==0||primary.equals(device)&&waitMillis==0),"PHONE_RESPONSE_INVALID");until=started+lease;
  List<Object> rows=WireJson.list(value.get("phones"));TaskWire.require(rows.size()<=128,"PHONE_RESPONSE_INVALID");List<Phone> parsed=new ArrayList<>();for(Object row:rows)parsed.add(new Phone(WireJson.map(row)));phones=Collections.unmodifiableList(parsed);
  TaskWire.require(phones.stream().anyMatch(p->p.id.equals(device)&&!p.revoked)&&phones.stream().anyMatch(p->p.id.equals(primary)),"PHONE_RESPONSE_INVALID");
 }
 boolean allowed(long elapsed){return primary.equals(device)&&elapsed<until;}
 String status(){return primary.equals(device)?waitMillis>0?"正在切换，等待旧手机退出":"当前主手机":"其他手机为主手机";}
 String fingerprint(){return primary+"/"+revision+"/"+(waitMillis>0)+"/"+phones.size();}
}
