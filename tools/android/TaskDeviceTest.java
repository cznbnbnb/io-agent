package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Device-independent checks of one-time pairing: code input, issued credentials, renewal identity,
 * derived per-session connections and inbox route discovery. */
public final class TaskDeviceTest {
 static int checks;
 static void yes(boolean value){checks++;if(!value)throw new AssertionError("task device check "+checks);}
 static void fails(Runnable r,String code){checks++;try{r.run();}catch(IllegalArgumentException e){if(e.getMessage().equals(code))return;throw new AssertionError("expected "+code+" got "+e.getMessage());}throw new AssertionError("expected "+code);}
 static final long NOW=java.time.Instant.parse("2026-10-24T06:00:00Z").toEpochMilli();
 static final String TOKEN="A".repeat(43),OTHER="B".repeat(43),DEVICE="11111111-2222-4333-8444-555555555555";
 static byte[] reply(String token,String producer,String device,String role,String expires,String refresh){
  return WireJson.bytes(WireJson.object("token",token,"token_id","aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","expires_at",expires,"refresh_after",refresh,"device_id",device,"role",role,"label","我的手机",
   "owner_id","turboio-user","producer_id",producer,"server_id","80384449-a5c6-4630-bf1b-524a30454c92",
   "scopes",Arrays.asList("materials:write","materials:read","tasks:write","tasks:read","tasks:update","requests:read","answers:write","messages:receive","receipts:phone")));
 }
 static Map<String,Object> route(String session){Map<String,Object> r=new TreeMap<>();r.put("computer_id","io-mac-computer");r.put("agent_id","io-claude-code");r.put("project_id","rayneo-io-agent");r.put("session_id",session);return r;}
 static Object task(String id,String state,Map<String,Object> route){return WireJson.object("kind","task","object_id",id,"state",state,"body",WireJson.object("task_id",id,"route",route));}
 public static void main(String[] args){
  // Codes: spaces, dashes and case are normalized; ambiguous characters are refused.
  yes(TaskDevice.code(" abcde-fghjk ").equals("ABCDEFGHJK"));yes(new String(TaskDevice.pairBody("ABCDE FGHJK"),StandardCharsets.UTF_8).contains("ABCDEFGHJK"));
  fails(()->TaskDevice.code("ABCDE-FGHJ"),"PAIRING_CODE_INVALID");fails(()->TaskDevice.code("ABCDE-FGHJ0"),"PAIRING_CODE_INVALID");fails(()->TaskDevice.code("ABCDE-FGHJI"),"PAIRING_CODE_INVALID");fails(()->TaskDevice.code(null),"PAIRING_CODE_INVALID");
  // Issued credential: phone role and phone scopes are required; it survives encode/decode.
  TaskDevice d=TaskDevice.issued(reply(TOKEN,"phone-11111111",DEVICE,"phone","2026-10-25T06:00:00.000Z","2026-10-24T18:00:00.000Z"),TaskDevice.BASE,null,NOW);
  yes(d.owner.equals("turboio-user")&&d.producer.equals("phone-11111111")&&d.cursor.isEmpty()&&d.label.equals("我的手机"));
  yes(Arrays.equals(TaskDevice.decode(d.encode()).encode(),d.encode()));
  fails(()->TaskDevice.issued(reply(TOKEN,"agent-11111111",DEVICE,"agent","2026-10-25T06:00:00.000Z","2026-10-24T18:00:00.000Z"),TaskDevice.BASE,null,NOW),"TASK_DEVICE_INVALID");
  fails(()->TaskDevice.issued(reply(TOKEN,"phone-11111111",DEVICE,"phone","2026-10-24T05:00:00.000Z","2026-10-24T04:00:00.000Z"),TaskDevice.BASE,null,NOW),"TASK_IMPORT_EXPIRED");
  fails(()->TaskDevice.issued(reply(TOKEN,"phone-11111111",DEVICE,"phone","2026-10-25T06:00:00.000Z","2026-10-25T07:00:00.000Z"),TaskDevice.BASE,null,NOW),"TASK_DEVICE_INVALID");
  // Renewal is due after refresh_after, keeps the device, cursor and derived bindings, swaps the token.
  yes(!d.renewDue(NOW));yes(d.renewDue(d.refreshAt));yes(!d.renewDue(d.expiresAt));
  TaskDevice withCursor=d.withCursor("cursor-1");
  TaskDevice renewed=TaskDevice.issued(reply(OTHER,"phone-11111111",DEVICE,"phone","2026-10-25T18:00:00.000Z","2026-10-25T06:00:00.000Z"),TaskDevice.BASE,withCursor,NOW);
  yes(renewed.token.equals(OTHER)&&renewed.cursor.equals("cursor-1"));
  fails(()->TaskDevice.issued(reply(OTHER,"phone-22222222","22222222-2222-4333-8444-555555555555","phone","2026-10-25T18:00:00.000Z","2026-10-25T06:00:00.000Z"),TaskDevice.BASE,withCursor,NOW),"TASK_IDENTITY_MISMATCH");
  TaskConnection before=d.derive(route("s1"),NOW),after=renewed.derive(route("s1"),NOW);
  yes(before.binding().equals(after.binding()));yes(after.token().equals(OTHER)&&after.expires.equals("2026-10-25T18:00:00.000Z"));
  yes(!before.binding().equals(d.derive(route("s2"),NOW).binding()));yes(d.owns(before)&&renewed.owns(before));
  yes(before.session.equals("s1")&&before.agent.equals("io-claude-code"));
  // Discovery: only open tasks with four-ID routes, each route once.
  Map<String,Object> other=route("s3");other.put("session_id","bad session");
  Map<String,Object> page=WireJson.map(WireJson.object("items",Arrays.asList(task("t1","running",route("s1")),task("t2","queued",route("s1")),task("t3","completed",route("s2")),
   task("t4","waiting_answer",route("s4")),task("t5","running",other),WireJson.object("kind","message","object_id","m","state","stored","body",WireJson.object("route",route("s5"))))));
  List<Map<String,Object>> routes=TaskDevice.openRoutes(page);
  yes(routes.size()==2&&routes.get(0).get("session_id").equals("s1")&&routes.get(1).get("session_id").equals("s4"));
  for(String state:Arrays.asList("stop_requested","stop_unconfirmed","stopped","resume_requested","execution_unknown","cancel_requested")){
   List<Map<String,Object>> discovered=TaskDevice.openRoutes(WireJson.object("items",Arrays.asList(task("control-task",state,route("original-session")))));
   yes(discovered.size()==1&&discovered.get(0).get("session_id").equals("original-session"));
  }
  // A full registry gives up its oldest idle derived slot: never the default or one with unanswered
  // questions; paused first, then offline, then online. A re-derived route gets the same binding back.
  TaskProfiles full=TaskProfiles.empty();List<String> b=new ArrayList<>();
  for(int i=0;i<TaskProfiles.MAX;i++){TaskConnection c=d.derive(route("full-"+i),NOW);b.add(c.binding());full=full.upsert(c,true,NOW,i==0);}
  yes(full.profiles.size()==TaskProfiles.MAX&&full.selected.equals(b.get(0)));
  Set<String> none=new HashSet<>(),online=new HashSet<>(b.subList(0,6));
  TaskProfiles roomy=full.makeRoom(d,new HashSet<>(Arrays.asList(b.get(6))),online);
  yes(roomy.profiles.size()==TaskProfiles.MAX-1&&!roomy.profiles.stream().anyMatch(p->p.binding.equals(b.get(7))));
  yes(roomy.selected.equals(b.get(0)));
  TaskProfiles paused=full.enabled(b.get(12),false,NOW).makeRoom(d,none,none);
  yes(!paused.profiles.stream().anyMatch(p->p.binding.equals(b.get(12))));
  yes(full.makeRoom(d,none,new HashSet<>(b)).profiles.stream().noneMatch(p->p.binding.equals(b.get(1))));
  Set<String> allButDefault=new HashSet<>(b);allButDefault.remove(b.get(0));
  TaskProfiles fullFinal=full;fails(()->fullFinal.makeRoom(d,allButDefault,none),"TASK_PROFILES_FULL");
  yes(roomy.upsert(d.derive(route("newcomer"),NOW),true,NOW,false).profiles.size()==TaskProfiles.MAX);
  yes(d.derive(route("full-7"),NOW).binding().equals(b.get(7)));
  TaskProfiles small=TaskProfiles.empty().upsert(d.derive(route("only"),NOW),true,NOW,true);yes(small.makeRoom(d,none,none)==small);
  System.out.println("task device: "+checks+" checks passed");
 }
}
