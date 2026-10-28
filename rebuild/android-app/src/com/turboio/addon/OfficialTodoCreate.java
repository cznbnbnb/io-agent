package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

/** Fixed stock 1.0.7 task-create boundary. Does not send HTTP, save an account,
 * emit a suggestion ACK, modify Isar, or invent a glasses event ID. */
final class OfficialTodoCreate {
 static final int MAX_CONTENT_LENGTH=48,MAX_RESPONSE_BYTES=65536;
 static final class Request {
  final String method="POST",path="/action/api/v2/tasks/create",content,clientId;
  private final byte[] body;
  private Request(String proposalId,String content){
   WireJson.require(proposalId!=null&&proposalId.matches("[A-Za-z0-9_.:-]{1,128}"),"TODO_PROPOSAL_ID_INVALID");
   WireJson.require(content!=null&&!content.isEmpty()&&content.length()<=MAX_CONTENT_LENGTH&&content.equals(content.trim()),"TODO_CONTENT_INVALID");
   for(int i=0;i<content.length();i++)WireJson.require(!Character.isISOControl(content.charAt(i))&&content.charAt(i)!='\u2028'&&content.charAt(i)!='\u2029',"TODO_CONTENT_INVALID");
   this.content=content;
   clientId=UUID.nameUUIDFromBytes(("io-agent-native-todo/1:"+proposalId).getBytes(StandardCharsets.UTF_8)).toString();
   // The stock source selection maps its RayNeo choice to this exact value.
   // sourceType, sourceId and calendar/due fields have no verified values here.
   body=WireJson.bytes(WireJson.object("content",content,"source","rayneoTasks","clientId",clientId));
  }
  byte[] body(){return body.clone();}
 }
 static Request request(String proposalId,String content){return new Request(proposalId,content);}

 /** API success proves cloud creation, not native-cache or lens visibility.
  * BaseIdDTO preserves opaque string IDs; JSON long IDs become decimal strings
  * without crossing a double/JavaScript-number representation. */
 static String createdId(byte[] response){
  WireJson.require(response!=null&&response.length<=MAX_RESPONSE_BYTES,"TODO_RESPONSE_BUDGET");
  Map<String,Object> root=WireJson.map(WireJson.read(OfficialLifelogJson.read(response).canonical));
  Object code=root.get("code");
  WireJson.require(Long.valueOf(0).equals(code)||(code instanceof BigDecimal&&((BigDecimal)code).signum()==0),"TODO_CREATE_REJECTED");
  Map<String,Object> data=WireJson.map(root.get("data"));
  Object source=data.get("source");
  WireJson.require(source==null||source.equals("rayneoTasks")||source.equals("rayneo"),"TODO_SOURCE_MISMATCH");
  Object raw=data.get("id");
  if(raw instanceof Long){WireJson.require((Long)raw>0,"TODO_CREATED_ID_INVALID");return raw.toString();}
  WireJson.require(raw instanceof String,"TODO_CREATED_ID_INVALID");String id=(String)raw;
  WireJson.require(!id.isEmpty()&&id.length()<=128&&id.equals(id.trim()),"TODO_CREATED_ID_INVALID");
  for(int i=0;i<id.length();i++)WireJson.require(!Character.isISOControl(id.charAt(i))&&id.charAt(i)!='\u2028'&&id.charAt(i)!='\u2029',"TODO_CREATED_ID_INVALID");
  return id;
 }
}
