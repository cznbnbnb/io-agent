package com.turboio.addon;
public final class SessionPairingCodeTest {
 public static void main(String[] args){String id="12345678-1234-1234-1234-123456789abc",code=new String(new char[64]).replace('\0','a');String text="io-agent-pair/1:"+id+":"+code;
  SessionPairingCode a=SessionPairingCode.parse(text),b=SessionPairingCode.parse("https://cznbnb.cn/io-api/v1/connect#id="+id+"&code="+code);if(!a.body().equals(b.body()))throw new AssertionError();
  for(String bad:new String[]{text+":extra",text.replace(code,"short"),"https://evil.example/io-api/v1/connect#id="+id+"&code="+code,"https://cznbnb.cn/io-api/v1/connect?x=1#id="+id+"&code="+code,"https://cznbnb.cn@evil.example/io-api/v1/connect#id="+id+"&code="+code}){try{SessionPairingCode.parse(bad);throw new AssertionError();}catch(IllegalArgumentException expected){}}
  System.out.println("session pairing parser: QR/string equivalence and 5 invalid inputs passed");
 }
}
