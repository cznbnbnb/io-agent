package com.turboio.addon;
import android.app.Activity;import android.widget.*;
/** One visual flow for camera and pasted text; confirmation precedes server binding. */
final class AgentSessionPairUI {
 private final Activity activity;private final AgentUI.Screen screen;private final TaskRuntime runtime;private EditText input;private TextView status;private boolean busy,saving;private String page="entry",reviewSource="entry",draft="";private long previewGeneration;
 static void show(Activity a){new AgentSessionPairUI(a).entry();}
 private AgentSessionPairUI(Activity a){activity=a;screen=new AgentUI.Screen(a,"添加 Agent 会话");runtime=TaskRuntime.get(a);screen.backHandler(this::back);}
 private boolean visible(){return screen.dialog.isShowing()&&!activity.isFinishing()&&!activity.isDestroyed();}
 private void busy(boolean value){busy=value;controls(screen.body,!value);controls(screen.dock,!value);}
 private void controls(android.view.View view,boolean enabled){if(view instanceof Button||view instanceof EditText){view.setEnabled(enabled);view.setAlpha(enabled?1f:.55f);}if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)controls(group.getChildAt(i),enabled);}}
 private void clear(){screen.body.removeAllViews();screen.dock.removeAllViews();}
 private boolean back(){if(saving)return true;previewGeneration++;busy(false);if(page.equals("review")){if(reviewSource.equals("paste"))paste();else entry();return true;}if(page.equals("paste")){draft=input.getText().toString();entry();return true;}return false;}
 private void entry(){
  page="entry";clear();LinearLayout card=AgentUI.card(activity,screen.body);card.addView(AgentUI.text(activity,"连接当前对话",20,AgentUI.INK));AgentUI.gap(activity,card,10);
  card.addView(AgentUI.text(activity,"让电脑上的 Agent 在当前会话生成配对信息。扫码或粘贴字符串，核对后保存即可。",15,AgentUI.MUTED));
  AgentUI.button(activity,screen.body,"扫描二维码",true,()->AgentSessionScanner.scan(activity,text->{if(visible())preview(text);}));
  AgentUI.button(activity,screen.body,"粘贴配对字符串",false,this::paste);
  AgentUI.gap(activity,screen.body,20);status=AgentUI.text(activity,"保存后自动续期，无需每天重新配对。",14,AgentUI.MUTED);screen.body.addView(status);
 }
 private void paste(){
  page="paste";clear();screen.body.addView(AgentUI.text(activity,"粘贴配对字符串",20,AgentUI.INK));AgentUI.gap(activity,screen.body,12);
  screen.body.addView(AgentUI.text(activity,"复制 CLI 生成的完整字符串。扫码和粘贴会连接同一条会话。",14,AgentUI.MUTED));AgentUI.gap(activity,screen.body,16);
  input=AgentUI.input(activity);input.setText(draft);input.setHint("io-agent-pair/1:…");input.setMinLines(4);input.setMaxLines(7);input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE|android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(512)});screen.body.addView(input,new LinearLayout.LayoutParams(-1,-2));
  AgentUI.gap(activity,screen.body,12);status=AgentUI.text(activity,"配对信息 10 分钟内有效。",14,AgentUI.MUTED);screen.body.addView(status);
  AgentUI.button(activity,screen.dock,"读取会话信息",true,()->preview(input.getText().toString()));
 }
 private void preview(String text){
  if(busy)return;try{SessionPairingCode.parse(text);}catch(RuntimeException e){status.setText("配对字符串不完整，请重新复制或扫描。");return;}
  reviewSource=page;if(page.equals("paste"))draft=text;final long request=++previewGeneration;busy(true);status.setText("正在读取会话信息…");runtime.previewSession(text,(p,error)->{if(request!=previewGeneration||!visible())return;busy(false);if(!error.isEmpty()){status.setText(message(error));return;}confirm(p);});
 }
 private void field(LinearLayout card,String title,String value){card.addView(AgentUI.text(activity,title,13,AgentUI.MUTED));AgentUI.gap(activity,card,5);TextView text=AgentUI.text(activity,value,16,AgentUI.INK);text.setTextIsSelectable(true);card.addView(text);AgentUI.gap(activity,card,16);}
 private void confirm(SessionPairingCode.Preview p){
  page="review";clear();screen.body.addView(AgentUI.text(activity,"确认要连接的会话",20,AgentUI.INK));LinearLayout card=AgentUI.card(activity,screen.body);
  field(card,"Agent",p.runtime);field(card,"任务主题",p.topic);field(card,"工作区",p.workspace);field(card,"会话",String.valueOf(p.route.get("session_id")));field(card,"电脑",String.valueOf(p.route.get("computer_id")));
  status=AgentUI.text(activity,"这条会话的任务和回复将同步到当前手机账号。",14,AgentUI.MUTED);screen.body.addView(status);
  AgentUI.button(activity,screen.dock,"保存并绑定",true,()->{if(busy)return;saving=true;busy(true);status.setText("正在保存到服务器…");runtime.approveSession(p,(state,error)->{saving=false;busy(false);if(!visible())return;if(!error.isEmpty()){status.setText(message(error));return;}page="done";clear();LinearLayout done=AgentUI.card(activity,screen.body);done.addView(AgentUI.text(activity,"会话已绑定",20,AgentUI.INK));AgentUI.gap(activity,done,12);done.addView(AgentUI.text(activity,p.runtime+" · "+p.topic,16,AgentUI.INK));AgentUI.gap(activity,done,12);done.addView(AgentUI.text(activity,"让电脑上的 Agent 完成连接检查并加入任务，随后会出现在电脑连接列表中。",14,AgentUI.MUTED));AgentUI.button(activity,screen.dock,"完成",true,screen.dialog::dismiss);});});
 }
 private String message(String code){
  if(code.equals("PAIRING_EXPIRED"))return "配对信息已过期，请让 Agent 重新生成。";
  if(code.equals("PAIRING_ALREADY_BOUND"))return "这份配对信息已被其他账号使用，请重新生成。";
  if(code.equals("DIRECTORY_PAIRING_REQUIRED"))return "请先完成这台手机的账号配对，再添加 Agent 会话。";
  if(code.equals("SESSION_PAIRING_IDENTITY_CHANGED"))return "账号或手机连接已变化，请返回后重新核对。";
  return "暂时未能完成连接，请检查网络后重试。";
 }
}
