package com.turboio.addon;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

public final class OfficialTodoCreateTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("Todo create assertion "+checks);}
 private static void denied(String code,Runnable action){try{action.run();throw new AssertionError("Invalid todo input accepted");}catch(IllegalArgumentException expected){yes(code==null||code.equals(expected.getMessage()));}}
 private static byte[] json(String value){return value.getBytes(StandardCharsets.UTF_8);}
 public static void main(String[] args){
  OfficialTodoCreate.Request first=OfficialTodoCreate.request("todo-synthetic-001","跟进明天的样品评审");
  yes(first.method.equals("POST"));yes(first.path.equals("/action/api/v2/tasks/create"));
  Map<String,Object> body=WireJson.map(WireJson.read(first.body()));
  yes(body.keySet().equals(new java.util.HashSet<>(Arrays.asList("content","source","clientId"))));
  yes(body.get("source").equals("rayneoTasks"));yes(body.get("content").equals(first.content));yes(body.get("clientId").equals(first.clientId));
  yes(UUID.fromString(first.clientId).version()==3);
  yes(first.clientId.equals(OfficialTodoCreate.request("todo-synthetic-001","另一次展示的同一提议").clientId));
  yes(!first.clientId.equals(OfficialTodoCreate.request("todo-synthetic-002",first.content).clientId));
  yes(Arrays.equals(first.body(),OfficialTodoCreate.request("todo-synthetic-001",first.content).body()));
  byte[] signing=first.body(),sending=first.body();yes(signing!=sending&&Arrays.equals(signing,sending));Arrays.fill(signing,(byte)'x');yes(Arrays.equals(first.body(),sending));
  String title="跟进 \"样品\" / 版本\\二 😀";yes(WireJson.map(WireJson.read(OfficialTodoCreate.request("todo-quoted",title).body())).get("content").equals(title));
  String limit="会".repeat(48);yes(OfficialTodoCreate.request("todo-max",limit).content.length()==48);
  for(String value:new String[]{null,""," "," 事项","事项 ","\n事项","事\n项","事\r项","事\t项","事\u0000项","事\u0085项","事\u2028项","事\u2029项",limit+"议"})denied("TODO_CONTENT_INVALID",()->OfficialTodoCreate.request("todo-invalid",value));
  denied("WIRE_SURROGATE",()->OfficialTodoCreate.request("todo-surrogate","坏\ud800"));
  for(String value:new String[]{null,""," ","a/b","a?b","a\nb","x".repeat(129)})denied("TODO_PROPOSAL_ID_INVALID",()->OfficialTodoCreate.request(value,"事项"));
  yes(OfficialTodoCreate.request("x".repeat(128),"事项").body().length>0);

  yes(OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":9007199254740993}}" )).equals("9007199254740993"));
  yes(OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":9223372036854775807}}" )).equals("9223372036854775807"));
  yes(OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":\"9223372036854775807\",\"source\":\"rayneoTasks\"}}" )).equals("9223372036854775807"));
  yes(OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":\"a1b2-opaque-id\",\"source\":\"rayneo\",\"sourceId\":null,\"listId\":null},\"msg\":\"ok\"}" )).equals("a1b2-opaque-id"));
  yes(OfficialTodoCreate.createdId(json("{\"code\":0,\"code\":0,\"data\":{\"id\":\"same\",\"id\":\"same\"}}" )).equals("same"));
  for(String code:new String[]{"0","0.0","0e0"})yes(OfficialTodoCreate.createdId(json("{\"code\":"+code+",\"data\":{\"id\":\"a\"}}" )).equals("a"));
  for(String code:new String[]{"1","401","-1","0.1","\"0\"","null","true"})denied("TODO_CREATE_REJECTED",()->OfficialTodoCreate.createdId(json("{\"code\":"+code+",\"data\":{\"id\":\"a\"}}")));
  for(String id:new String[]{"null","0","-1","1.5","1e3","true","{}","[]","\"\"","\" a\"","\"a\\n\"","\"a\\u0085b\"","\"a\\u2028b\"","\""+"a".repeat(129)+"\""})denied("TODO_CREATED_ID_INVALID",()->OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":"+id+"}}")));
  denied("TODO_CREATED_ID_INVALID",()->OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{}}")));
  for(String source:new String[]{"\"googleTasks\"","\"microsoftTodo\"","\"systemReminders\"","false","{}"})denied("TODO_SOURCE_MISMATCH",()->OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":\"a\",\"source\":"+source+"}}")));
  denied("OFFICIAL_DUPLICATE_CONFLICT",()->OfficialTodoCreate.createdId(json("{\"code\":0,\"data\":{\"id\":\"a\",\"id\":\"b\"}}")));
  for(String value:new String[]{"null","[]","{}","{\"code\":0}","{\"code\":0,\"data\":null}","{\"code\":0,\"data\":[]}","{","{\"code\":0}{}"})denied(null,()->OfficialTodoCreate.createdId(json(value)));
  denied(null,()->OfficialTodoCreate.createdId(new byte[]{(byte)0xc0,(byte)0xaf}));
  denied("TODO_RESPONSE_BUDGET",()->OfficialTodoCreate.createdId(null));denied("TODO_RESPONSE_BUDGET",()->OfficialTodoCreate.createdId(new byte[65537]));
  byte[] shortResponse=json("{\"code\":0,\"data\":{\"id\":\"max-budget\"}}"),padded=Arrays.copyOf(shortResponse,65536);Arrays.fill(padded,shortResponse.length,padded.length,(byte)' ');yes(OfficialTodoCreate.createdId(padded).equals("max-budget"));
  System.out.println("Todo create: "+checks+" synthetic checks passed");
 }
}
