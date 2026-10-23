package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Business-17 manuscript transfer against a simulated glasses puller; no device. */
public final class PrompterFileTest {
 static int checks;
 static void yes(boolean v){checks++;if(!v)throw new AssertionError("prompter file check "+checks);}
 interface Run{void run();}
 static void rejects(Run r){checks++;try{r.run();}catch(RuntimeException expected){return;}throw new AssertionError("expected rejection "+checks);}
 static PrompterFile.Message glasses(int type,String uuid,long chunk,long start,long size){PrompterFile.Message m=new PrompterFile.Message();m.type=type;m.uuid=uuid;m.chunkId=chunk;m.start=start;m.size=size;return m;}
 public static void main(String[] args){
  String did="0f8f6d2e-7a1b-4c3d-8e9f-001122334455";byte[] text=String.join("",Collections.nCopies(300,"长问题测试，")).getBytes(StandardCharsets.UTF_8);
  PrompterFile.Outbound f=new PrompterFile.Outbound(did,text,"0123456789abcdef0123456789abcdef");
  PrompterFile.Message info=PrompterFile.decode(f.info());yes(info.type==1&&info.uuid.equals(did)&&info.fileName.equals(did)&&info.fileSize==text.length&&info.busId==17&&info.md5.length()==32);
  // A pull before the glasses' ACK, another DID, or an oversized request is refused or ignored.
  rejects(()->f.receive(PrompterFile.encode(glasses(3,did,1,0,4096))));
  yes(f.receive(PrompterFile.encode(glasses(2,"other-did",0,0,0)))==null&&!f.acknowledged);
  yes(f.receive(PrompterFile.encode(glasses(2,did,0,0,0)))==null&&f.acknowledged);
  long start=0;int chunk=1;List<byte[]> received=new ArrayList<>();
  while(start<text.length){PrompterFile.Message out=f.receive(PrompterFile.encode(glasses(3,did,chunk,start,4096)));yes(out!=null&&out.type==4&&out.start==start&&out.data.length==out.size);
   PrompterFile.Message wire=PrompterFile.decode(PrompterFile.encode(out));yes(Arrays.equals(wire.data,out.data)&&wire.chunkId==chunk);f.committed(out);received.add(out.data);start+=out.size;chunk++;}
  yes(f.sentBytes==text.length);int n=0;for(byte[] b:received)n+=b.length;byte[] all=new byte[n];int at=0;for(byte[] b:received){System.arraycopy(b,0,all,at,b.length);at+=b.length;}yes(Arrays.equals(all,text));
  // Same chunk id with a different range conflicts; success completes only after every byte.
  rejects(()->f.receive(PrompterFile.encode(glasses(3,did,1,4096,4096))));
  PrompterFile.Message ok=new PrompterFile.Message();ok.type=5;ok.uuid=did;yes(f.receive(PrompterFile.encode(ok))==null&&f.complete);
  PrompterFile.Outbound early=new PrompterFile.Outbound(did,text,"0123456789abcdef0123456789abcdef");early.receive(PrompterFile.encode(glasses(2,did,0,0,0)));rejects(()->early.receive(PrompterFile.encode(ok)));
  PrompterFile.Outbound peerCancel=new PrompterFile.Outbound(did,text,"0123456789abcdef0123456789abcdef");PrompterFile.Message cancel=new PrompterFile.Message();cancel.type=6;cancel.uuid=did;rejects(()->peerCancel.receive(PrompterFile.encode(cancel)));
  yes(PrompterFile.decode(peerCancel.cancel("user-stop")).type==6);
  rejects(()->PrompterFile.decode(new byte[]{(byte)0x0a,(byte)0x05,1}));rejects(()->new PrompterFile.Outbound("bad uuid!",text,"0123456789abcdef0123456789abcdef"));
  rejects(()->new PrompterFile.Outbound(did,new byte[48001],"0123456789abcdef0123456789abcdef"));
  System.out.println("prompter file transfer: "+checks+" assertions passed");
 }
}
