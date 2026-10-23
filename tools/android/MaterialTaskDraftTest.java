package com.turboio.addon;

import java.nio.file.*;
import java.time.ZoneId;
import java.util.*;

/** Complete selected material revision, explicit instruction, exact task wire budgets; no Android/IO. */
public final class MaterialTaskDraftTest {
 private static int checks;
 private static void yes(boolean value){checks++;if(!value)throw new AssertionError("Material task draft check "+checks);}
 private interface Run {void run()throws Exception;}
 private static void rejects(String code,Run run)throws Exception{checks++;try{run.run();}catch(IllegalArgumentException expected){if(code.equals(expected.getMessage()))return;throw expected;}throw new AssertionError("Expected "+code);}
 private static MaterialCatalog.Entry entry(Map<String,Object> body,String state){Map<String,Object> row=WireJson.object("state",state,"error","");if(state.equals("server_stored"))row.put("ack",WireJson.object("stored_at","2026-10-23T00:00:00Z"));return new MaterialCatalog.Entry(body,row,ZoneId.of("Asia/Shanghai"));}
 public static void main(String[] args)throws Exception{
  Map<String,Object> fixture=WireJson.map(WireJson.read(Files.readAllBytes(Paths.get(args[0])))),event=WireJson.map(WireJson.list(fixture.get("events")).get(3)),body=WireJson.map(WireJson.copy(event.get("body")));
  MaterialCatalog.Entry source=entry(body,"queued");MaterialTaskDraft draft=new MaterialTaskDraft(source);
  long now=TaskWire.stamp("2026-10-19T10:00:00Z");TaskConnection connection=TaskConnection.parse(WireJson.bytes(TaskConnectionTest.sample()),now);
  String instruction="请提炼讨论结论。\n完整保留待办条件。",command=draft.command(connection,"material-task-operation",instruction,now);
  yes(command.startsWith(instruction));yes(command.endsWith(draft.document));yes(command.contains(source.fullText));yes(command.contains(source.id)&&command.contains("文字修订："+source.revision));
  for(MaterialCatalog.Segment segment:source.segments)yes(command.contains(segment.text)&&command.contains(segment.speaker)&&command.contains(MaterialDocument.segmentTime(segment)));
  yes(!draft.scope.equals("delegate"));yes(draft.same(entry(body,"server_stored")));
  Map<String,Object> revised=WireJson.map(WireJson.copy(body));revised.put("revision",source.revision+1);revised.put("base_revision",source.revision);MaterialTaskDraft other=new MaterialTaskDraft(entry(revised,"queued"));yes(!draft.scope.equals(other.scope));yes(!draft.same(other.entry));
  Map<String,Object> changed=WireJson.map(WireJson.copy(body));WireJson.map(changed.get("full_text")).put("text","另一段文字");yes(!draft.same(entry(changed,"queued")));
  rejects("MATERIAL_TASK_INSTRUCTION_REQUIRED",()->draft.command("  \n\t"));
  int one=draft.command("x").codePointCount(0,draft.command("x").length());String boundary="x".repeat(MaterialTaskDraft.MAX_COMMAND-one+1);
  String exact=draft.command(connection,"limit-operation",boundary,now);yes(exact.codePointCount(0,exact.length())==MaterialTaskDraft.MAX_COMMAND);rejects("MATERIAL_TASK_TOO_LARGE",()->draft.command(boundary+"x"));
  String unicode=draft.command(connection,"unicode-operation","😀".repeat(10000),now);yes(unicode.startsWith("😀".repeat(10000))&&unicode.endsWith(draft.document));
  // Escaped bytes can exceed the envelope budget even while Unicode characters still fit.
  rejects("MATERIAL_TASK_TOO_LARGE",()->draft.command(connection,"byte-operation","处理资料"+"\u0001".repeat(50000),now));
  Map<String,Object> huge=WireJson.map(WireJson.copy(body));WireJson.map(huge.get("full_text")).put("text","原".repeat(65536));rejects("MATERIAL_TASK_TOO_LARGE",()->new MaterialTaskDraft(entry(huge,"queued")));
  System.out.println("Material task draft: "+checks+" checks passed (full text/speakers/times, revision isolation, explicit instruction, exact Unicode and escaped-envelope limits, no clipping)");
 }
}
