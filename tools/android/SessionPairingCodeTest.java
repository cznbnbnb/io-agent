package com.turboio.addon;
public final class SessionPairingCodeTest {
 public static void main(String[] args){String id="12345678-1234-1234-1234-123456789abc",code=new String(new char[64]).replace('\0','a');String text="io-agent-pair/1:"+id+":"+code;
  SessionPairingCode a=SessionPairingCode.parse(text),b=SessionPairingCode.parse("https://cznbnb.cn/io-api/v1/connect#id="+id+"&code="+code);if(!a.body().equals(b.body()))throw new AssertionError();
  for(String bad:new String[]{text+":extra",text.replace(code,"short"),"https://evil.example/io-api/v1/connect#id="+id+"&code="+code,"https://cznbnb.cn/io-api/v1/connect?x=1#id="+id+"&code="+code,"https://cznbnb.cn@evil.example/io-api/v1/connect#id="+id+"&code="+code}){try{SessionPairingCode.parse(bad);throw new AssertionError();}catch(IllegalArgumentException expected){}}
  TaskDevice d=TaskDevice.issued(TaskDeviceTest.reply(TaskDeviceTest.TOKEN,"phone-11111111",TaskDeviceTest.DEVICE,"phone","2026-10-25T06:00:00.000Z","2026-10-24T18:00:00.000Z"),TaskDevice.BASE,null,TaskDeviceTest.NOW);
  java.util.Map<String,Object> metadata=WireJson.object("runtime","codex","topic","测试","workspace","/synthetic","route",WireJson.object("computer_id","computer-test","agent_id","io-current-codex","project_id","project","session_id","session"));
  java.util.Map<String,Object> preview=WireJson.object("id",id,"owner_id",d.owner,"expires_at","2026-10-24T07:00:00.000Z","metadata",metadata);
  if(new SessionPairingCode.Preview(a,d,"Synthetic",preview).computer)throw new AssertionError("old grant widened");
  metadata.put("mode","computer");if(!new SessionPairingCode.Preview(a,d,"Synthetic",preview).computer)throw new AssertionError("computer grant missing");
  metadata.put("mode","unknown");try{new SessionPairingCode.Preview(a,d,"Synthetic",preview);throw new AssertionError();}catch(IllegalArgumentException expected){}
  System.out.println("session pairing parser: QR/string equivalence and 5 invalid inputs passed");
 }
}
