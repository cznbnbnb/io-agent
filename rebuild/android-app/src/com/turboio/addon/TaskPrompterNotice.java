package com.turboio.addon;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** One durable notice display. Recovery can only continue its timer or stop, never start voice. */
final class TaskPrompterNotice {
 final String did,peer,binding;final long until;final boolean cancelled;
 private TaskPrompterNotice(String did,String peer,String binding,long until,boolean cancelled){this.did=TaskConnection.text(did,128);this.peer=TaskConnection.text(peer,256);this.binding=binding;this.until=until;this.cancelled=cancelled;TaskWire.require(until>0&&(binding==null||binding.matches("[a-f0-9]{64}")),"TASK_NOTICE_OWNER_INVALID");}
 static TaskPrompterNotice create(String did,String peer,String binding,long duration,long now){return new TaskPrompterNotice(did,peer,binding,now+Math.max(1,Math.min(180000,duration)),false);}
 static TaskPrompterNotice read(String value){try{Map<String,Object> v=WireJson.map(WireJson.read(value.getBytes(StandardCharsets.UTF_8)));return new TaskPrompterNotice((String)v.get("did"),(String)v.get("peer"),(String)v.get("binding"),TaskWire.positive(v.get("until")),Boolean.TRUE.equals(v.get("cancelled")));}catch(RuntimeException bad){return null;}}
 String encode(){return new String(WireJson.bytes(WireJson.object("did",did,"peer",peer,"binding",binding,"until",until,"cancelled",cancelled)),StandardCharsets.UTF_8);}
 TaskPrompterNotice cancel(){return new TaskPrompterNotice(did,peer,binding,until,true);}
 boolean matches(String binding){return binding==null||binding.equals(this.binding);}
 long remaining(String peer,boolean allowed,long now){return this.peer.equals(peer)&&allowed&&!cancelled?Math.max(0,until-now):0;}
}
