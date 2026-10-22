"""Generate the reviewable P14 wire schema and synthetic scenario fixtures."""
import json
from pathlib import Path
out = Path(__file__).resolve().parents[2] / 'docs' / 'contracts'
out.mkdir(parents=True, exist_ok=True)
def obj(props, required=None):
    return {'type':'object','additionalProperties':False,'properties':props,'required':list(props) if required is None else required}
string={'type':'string','minLength':1,'maxLength':512}
integer={'type':'integer','minimum':1}
time={'type':'string','format':'date-time'}
def enum(*v): return {'enum':list(v)}
def ref(v): return {'$ref':'#/$defs/'+v}
route=obj({k:string for k in ['computer_id','agent_id','project_id','session_id']})
utterance=obj({'utterance_id':string,'start_ms':{'type':'integer','minimum':0},'end_ms':{'type':'integer','minimum':0},'text':{'type':'string','maxLength':65536},'speaker_id':{'type':['string','null']},'speaker_basis':enum('unknown','segment_cluster','user_confirmed'),'overlap':{'type':'boolean'}})
defs={'route':route,'utterance':utterance}
defs['material']=obj({'material_id':string,'revision':integer,'base_revision':{'type':'integer','minimum':0},'operation':enum('upsert','delete'),'source':enum('recording','lifelog','agent_analysis'),'started_at':time,'ended_at':time,'completeness':enum('complete','partial','gap'),'text_revision':{'type':'integer','minimum':0},'utterances':{'type':'array','items':ref('utterance')},'audio':obj({'state':enum('local','stored_verified','missing','not_retained'),'sha256':{'type':['string','null'],'pattern':'^[0-9a-f]{64}$'},'object_id':{'type':['string','null']}})})
defs['message']=obj({'message_id':string,'revision':integer,'route':ref('route'),'task_id':string,'request_id':{'type':['string','null']},'channel':enum('command','question','answer','progress','result','cancel'),'text':{'type':'string','maxLength':65536}})
defs['receipt']=obj({'receipt_id':string,'subject_kind':enum('material','message','task','request','answer'),'subject_id':string,'subject_revision':integer,'stage':enum('server_stored','phone_received','glasses_displayed','user_answered','agent_received','task_resumed','task_completed','cancel_requested','cancelled','failed','expired'),'actor_id':string,'related_event_id':string,'error':{'oneOf':[{'type':'null'},obj({'code':string,'retryable':{'type':'boolean'},'detail':{'type':'string','maxLength':512}})]}})
defs['task']=obj({'task_id':string,'revision':integer,'route':ref('route'),'state':enum('queued','agent_received','running','waiting_answer','cancel_requested','cancelled','completed','failed','expired','execution_unknown'),'command':{'type':'string','minLength':1,'maxLength':65536},'allow_create_session':{'const':False}})
defs['request']=obj({'request_id':string,'revision':integer,'task_id':string,'route':ref('route'),'mode':enum('choice','free_text'),'question':{'type':'string','minLength':1,'maxLength':4096},'options':{'type':'array','maxItems':4,'items':obj({'option_id':string,'label':string})},'state':enum('pending','presented','answered','withdrawn','expired'),'runtime_request_id':{'type':['string','null']}})
defs['answer']=obj({'answer_id':string,'request_id':string,'request_revision':integer,'task_id':string,'route':ref('route'),'option_id':{'type':['string','null']},'text':{'type':'string','maxLength':65536},'input_source':enum('phone','voice','glasses_semantic'),'raw_action':{'const':None}})
schema={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://turboio.local/contracts/v1/event.schema.json','title':'Turbo IO minimal event v1.0','type':'object','additionalProperties':False,'required':['schema_version','event_id','idempotency_key','kind','producer_id','created_at','expires_at','body'],'properties':{'schema_version':{'const':'1.0'},'event_id':string,'idempotency_key':{'type':'string','minLength':8,'maxLength':256},'kind':enum('material.revision','message','receipt','task','request','answer'),'producer_id':string,'created_at':time,'expires_at':time,'body':{'type':'object'}},'$defs':defs,'allOf':[{'if':{'properties':{'kind':{'const':kind}}},'then':{'properties':{'body':ref(key)}}} for kind,key in [('material.revision','material'),('message','message'),('receipt','receipt'),('task','task'),('request','request'),('answer','answer')]]}
(out/'event-v1.schema.json').write_text(json.dumps(schema,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
route_data={'computer_id':'pc-demo','agent_id':'hermes-demo','project_id':'project-demo','session_id':'session-demo-stored'}
material={'material_id':'material-demo','revision':1,'base_revision':0,'operation':'upsert','source':'lifelog','started_at':'2026-10-10T02:00:00Z','ended_at':'2026-10-10T02:01:00Z','completeness':'complete','text_revision':1,'utterances':[{'utterance_id':'utterance-demo','start_ms':0,'end_ms':1000,'text':'合成样例：明天整理资料','speaker_id':'A','speaker_basis':'segment_cluster','overlap':False}],'audio':{'state':'local','sha256':None,'object_id':None}}
task={'task_id':'task-demo','revision':1,'route':route_data,'state':'queued','command':'合成任务：选 A 或 B，不执行外部操作','allow_create_session':False}
request={'request_id':'request-demo','revision':1,'task_id':'task-demo','route':route_data,'mode':'choice','question':'合成问题：选 A 还是 B？','options':[{'option_id':'A','label':'方案 A'},{'option_id':'B','label':'方案 B'}],'state':'pending','runtime_request_id':'srq-demo'}
answer={'answer_id':'answer-demo','request_id':'request-demo','request_revision':1,'task_id':'task-demo','route':route_data,'option_id':'A','text':'方案 A，但只生成预览','input_source':'voice','raw_action':None}
message={'message_id':'message-demo','revision':1,'route':route_data,'task_id':'task-demo','request_id':'request-demo','channel':'question','text':request['question']}
def event(kind,body,n,expiry='2026-10-10T03:00:00Z'):
    return {'schema_version':'1.0','event_id':'event-demo-'+str(n),'idempotency_key':'demo-key-'+str(n),'kind':kind,'producer_id':'phone-demo' if kind in ['material.revision','answer'] else 'agent-demo','created_at':'2026-10-10T02:02:00Z','expires_at':expiry,'body':body}
events=[event(k,b,n+1) for n,(k,b) in enumerate([('material.revision',material),('task',task),('request',request),('message',message),('answer',answer)])]
for i,stage in enumerate(['server_stored','glasses_displayed','user_answered','agent_received','task_resumed','task_completed']):
    subject='task' if stage in ['task_resumed','task_completed'] else 'answer' if stage in ['user_answered','agent_received'] else 'message'
    body={'receipt_id':'receipt-demo-'+str(i),'subject_kind':subject,'subject_id':subject+'-demo','subject_revision':1,'stage':stage,'actor_id':{'server_stored':'server-demo','glasses_displayed':'phone-demo','user_answered':'phone-demo'}.get(stage,'agent-demo'),'related_event_id':'event-demo-5' if subject=='answer' else 'event-demo-2' if subject=='task' else 'event-demo-4','error':None}
    events.append(event('receipt',body,6+i))
fixtures={
 'normal':{'description':'三组契约正常流程；显示回执需要真实显示证据，示例不证明设备能力','events':events,'expected':['stored','task_queued','request_pending','message_queued','answer_recorded']+['receipt_recorded']*6},
 'duplicate':{'description':'三组对象重传同事件；同请求第二终端回答竞争','events':[events[0],events[0],events[1],events[1],events[2],events[2],events[3],events[3],events[4],events[4],events[5],events[5],event('answer',{**answer,'answer_id':'answer-competing','option_id':'B'},99)],'expected':['stored','duplicate','task_queued','duplicate','request_pending','duplicate','message_queued','duplicate','answer_recorded','duplicate','receipt_recorded','duplicate','ANSWER_ALREADY_ACCEPTED']},
 'expired':{'description':'三组事件到期拒绝；超时资料投递不删除本地资料','events':[event(e['kind'],e['body'],i+1,'2026-10-10T02:02:01Z') for i,e in enumerate(events[:6])],'expected':['EXPIRED']*6},
 'offline-recovery':{'description':'三组离线队列重放同一事件；CAS保护更正，删除后旧补传不复活','events':[events[0],events[1],events[2],events[3],events[0],events[1],events[2],events[3],events[4],events[5],events[5],event('material.revision',{**material,'revision':2,'base_revision':1,'text_revision':2},80),event('material.revision',{**material,'revision':2,'base_revision':1},81),event('material.revision',{**material,'revision':3,'base_revision':2,'operation':'delete','utterances':[]},82),events[0]],'expected':['stored','task_queued','request_pending','message_queued','duplicate','duplicate','duplicate','duplicate','answer_recorded','receipt_recorded','duplicate','stored','REVISION_CONFLICT','deleted','duplicate']}}
for name,data in fixtures.items():
    data['server_now']='2026-10-10T02:03:00Z'
    (out/(name+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
