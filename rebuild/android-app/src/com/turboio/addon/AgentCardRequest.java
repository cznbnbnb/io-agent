package com.turboio.addon;

import java.util.*;

/** Frozen original request and route, with full-copy native pages. Never contains a credential.
 * A free-text question is one page whose accept starts dictation on the phone; it is never an answer.
 * A confirm card shows a finished dictation draft; accept asks the phone to save exactly that text.
 * route() is the shared card/prompter rule; the question CLI mirrors it to tell the agent. */
final class AgentCardRequest {
 static final class Copy {final String title,source,content;Copy(String title,String source,String content){this.title=title;this.source=source;this.content=content;}}
 // 2026-10-22 lens probe (dev12): a 60-character card was cut after about 56 characters with no
 // ellipsis and the knob does not scroll text, so longer copy must never be sent as a card.
 static final int CONTENT_LIMIT=48;
 static final String VOICE_SUFFIX="；＋口述回答，删除留手机";
 // 2026-10-22 (user): paging through several option cards is too slow; 2026-10-22 (user, again):
 // even two paged options hide the other option and the asking session, and paging ends on the
 // phone. Every choice therefore goes to the prompter; only a short free-text question is a card.
 final String binding,fingerprint,owner,requestId,taskId,computer,agent,confirm;
 final long revision,expiresAt;final boolean voice,handoff;private final Map<String,Object> request;
 private AgentCardRequest(String binding,Map<String,Object> original,String computer,String agent,String confirm){
  TaskWire.require(binding!=null&&binding.matches("[a-f0-9]{64}"),"TASK_TARGET_CHANGED");
  this.binding=binding;request=TaskWire.object(WireJson.copy(original));TaskWire.require("request".equals(request.get("kind")),"TASK_REQUEST_INVALID");
  Map<String,Object> b=TaskWire.body(request),route=TaskWire.route(b.get("route"));
  TaskWire.require(TaskWire.id(computer).equals(route.get("computer_id"))&&TaskWire.id(agent).equals(route.get("agent_id")),"TASK_ROUTE_MISMATCH");
  this.computer=computer;this.agent=agent;requestId=(String)request.get("object_id");taskId=(String)b.get("task_id");revision=TaskWire.positive(request.get("revision"));expiresAt=TaskWire.stamp(request.get("expires_at"));
  voice="free_text".equals(b.get("mode"));fingerprint=TaskWire.requestFingerprint(request);this.confirm=confirm;handoff=voice||confirm!=null;
  TaskWire.require(confirm==null||(voice||"choice".equals(b.get("mode")))&&!confirm.trim().isEmpty()&&confirm.length()<=4096,"TASK_GLASS_PHONE_ANSWER");
  owner=TaskWire.hash(WireJson.bytes(confirm==null?WireJson.object("binding",binding,"request",fingerprint):WireJson.object("binding",binding,"request",fingerprint,"confirm",TaskWire.hash(confirm.getBytes(java.nio.charset.StandardCharsets.UTF_8)))));
 }
 static AgentCardRequest prepare(TaskConnection connection,Map<String,Object> request,Map<String,Object> parent,long now){
  TaskWire.object(request);TaskWire.object(parent);TaskWire.require(TaskWire.same(connection.route(),TaskWire.body(request).get("route"))&&TaskWire.canAnswer(request,parent,now),"TASK_REQUEST_CLOSED");
  AgentCardRequest frozen=new AgentCardRequest(connection.binding(),request,connection.computer,connection.agent,null);// Route first: a long question is a prompter question, not an over-long card.
  TaskWire.require("card".equals(route(TaskWire.body(frozen.request))),"TASK_GLASS_PROMPTER");frozen.checkCopy();return frozen;
 }
 /** A confirm card for a dictation that started from a card or from the prompter. */
 static AgentCardRequest prepareConfirm(TaskConnection connection,Map<String,Object> request,Map<String,Object> parent,long now,String text){
  TaskWire.object(request);TaskWire.object(parent);TaskWire.require(TaskWire.same(connection.route(),TaskWire.body(request).get("route"))&&TaskWire.canAnswer(request,parent,now),"TASK_REQUEST_CLOSED");
  return new AgentCardRequest(connection.binding(),request,connection.computer,connection.agent,null).confirming(text);
 }
 /** "card" only for a one-line free-text question that fits one card; every choice is "prompter". */
 static String route(Map<String,Object> body){
  String question=(String)body.get("question");List<Object> options=WireJson.list(body.get("options"));
  // A multi-line question or label cannot be a card, but the prompter shows it as written.
  if(!clean(question))return "prompter";for(Object o:options)if(!clean((String)WireJson.map(o).get("label")))return "prompter";
  return "free_text".equals(body.get("mode"))&&(question+VOICE_SUFFIX).length()<=CONTENT_LIMIT?"card":"prompter";
 }
 /** The prompter copy of a question: who asks, the whole question and every option, never shortened. */
 static String manuscript(Map<String,Object> body,Map<String,Object> task){
  StringBuilder t=new StringBuilder(header(body,task)+"\n\n"+body.get("question")+"\n");List<Object> options=WireJson.list(body.get("options"));
  for(int i=0;i<options.size();i++)t.append("\n").append(i+1).append(". ").append((String)WireJson.map(options.get(i)).get("label"));
  // Dictation stops at VoiceAnswerSession.CAPTURE_SECONDS, so the wearer is told the limit up front.
  return t.append(options.isEmpty()?"\n\n看完长按退出，然后在60秒内口述回答。":"\n\n看完长按退出，然后在60秒内说“选几”，可以补充要求。").toString();
 }
 // 2026-10-23 (user, by voice on the prompter): the header shows the conversation topic the asking agent
 // registered (the task command), not a session id. A registration without a topic falls back to the project.
 static final String DEFAULT_COMMAND_PREFIX="Continue the already-running registered ";
 static String header(Map<String,Object> body,Map<String,Object> task){
  Map<String,Object> route=WireJson.map(body.get("route"));Object raw=task==null?null:task.get("command");
  String topic=raw instanceof String?((String)raw).trim().split("\\R",2)[0].trim():"";
  if(topic.isEmpty()||topic.startsWith(DEFAULT_COMMAND_PREFIX))return route.get("agent_id")+" 提问 · 项目 "+route.get("project_id");
  return route.get("agent_id")+" 提问："+(topic.length()>40?topic.substring(0,39)+"…":topic);
 }
 private static String page(String question,int index,int size,String label){return question+" ["+(index+1)+"/"+size+"] "+label+"；＋选此项，删除"+(index+1<size?"下一项":"留手机");}
 List<String> labels(){List<String> out=new ArrayList<>();for(Object o:WireJson.list(TaskWire.body(request).get("options")))out.add((String)WireJson.map(o).get("label"));return out;}
 /** The same frozen question, now carrying the exact draft text the wearer is asked to confirm. */
 AgentCardRequest confirming(String text){TaskWire.require(confirm==null,"TASK_GLASS_PHONE_ANSWER");AgentCardRequest result=new AgentCardRequest(binding,request,computer,agent,text);result.checkCopy();return result;}
 static AgentCardRequest restore(Object raw){
  Map<String,Object> j=WireJson.map(raw);boolean confirming=j.containsKey("confirm");if(confirming)BoundedJson.keys(j,"schema","binding","fingerprint","request","computer","agent","confirm");else BoundedJson.keys(j,"schema","binding","fingerprint","request","computer","agent");TaskWire.require(TaskWire.positive(j.get("schema"))==1,"TASK_CARD_STORE_INVALID");
  AgentCardRequest result=new AgentCardRequest(TaskWire.text(j.get("binding"),64,false),WireJson.map(j.get("request")),TaskWire.id(j.get("computer")),TaskWire.id(j.get("agent")),confirming?TaskWire.text(j.get("confirm"),4096,false):null);
  // Copy limits changed between builds (the dev12 probe stored 60-120 character cards, dev13 set 48).
  // A restored record is only recovered and cleaned up, never shown again with its old copy, so an
  // old copy length must not leave the whole card runtime BLOCKED; copy() still guards any new show.
  TaskWire.require(result.fingerprint.equals(j.get("fingerprint"))&&(result.voice||"choice".equals(TaskWire.body(result.request).get("mode"))),"TASK_REQUEST_CHANGED");return result;
 }
 Object json(){Map<String,Object> value=WireJson.map(WireJson.object("schema",1,"binding",binding,"fingerprint",fingerprint,"request",WireJson.copy(request),"computer",computer,"agent",agent));if(confirm!=null)value.put("confirm",confirm);return value;}
 int size(){return handoff?1:WireJson.list(TaskWire.body(request).get("options")).size();}
 Object option(int index){TaskWire.require(!handoff,"TASK_GLASS_PHONE_ANSWER");return WireJson.map(WireJson.list(TaskWire.body(request).get("options")).get(index)).get("option_id");}
 String answerText(int index){TaskWire.require(!handoff,"TASK_GLASS_PHONE_ANSWER");return (String)WireJson.map(WireJson.list(TaskWire.body(request).get("options")).get(index)).get("label");}
 String operation(){return "agent-card-"+owner;}
 boolean matches(Map<String,Object> fresh,Map<String,Object> parent,long now){try{TaskWire.object(parent);return TaskWire.canAnswer(fresh,parent,now)&&fingerprint.equals(TaskWire.requestFingerprint(fresh));}catch(RuntimeException invalid){return false;}}
 Copy copy(int index){
  TaskWire.require(index>=0&&index<size(),"TASK_OPTION_INVALID");
  // Line breaks are shown as spaces; the saved answer keeps the draft exactly.
  // A dictated choice shows the recognised option; an unrecognised one shows the words as said.
  String spoken=confirm==null?null:voice?null:VoiceOption.confirmCopy(confirm,labels(),CONTENT_LIMIT);
  String content=confirm!=null?(spoken!=null?spoken:confirm.replaceAll("\\s*[\\r\\n]+\\s*"," ").trim()):voice?TaskWire.body(request).get("question")+VOICE_SUFFIX:page((String)TaskWire.body(request).get("question"),index,size(),answerText(index));
  // Conservative previously tested copy limits. Do not truncate a question, condition or option.
  TaskWire.require(content.length()<=CONTENT_LIMIT&&clean(agent)&&clean(computer)&&clean(content),"TASK_GLASS_COPY_TOO_LONG");
  // Native card headings have 16-character slots. Abbreviate presentation only: the
  // frozen route, owner and saved answer still contain the full original identifiers.
  return new Copy(cardName(agent),cardName(computer),content);
 }
 private static String cardName(String name){return name.length()<=16?name:name.substring(0,15)+"…";}
 private void checkCopy(){TaskWire.require(voice||"choice".equals(TaskWire.body(request).get("mode")),"TASK_GLASS_PHONE_ANSWER");for(int i=0;i<size();i++)copy(i);}
 private static boolean clean(String text){if(text.trim().isEmpty())return false;for(int i=0;i<text.length();i++)if(Character.isISOControl(text.charAt(i)))return false;return true;}
}
