// Test-only reference runtime adapter. It speaks the adapter-host protocol and
// exercises every action the bridge accepts. It is NOT a real agent runtime.
import readline from 'node:readline';

const mode=process.argv[2]??'accept';
let workCount=0;
let events=[];
const reply=frame=>process.stdout.write(JSON.stringify(frame)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const frame=JSON.parse(line);
  if(frame.type==='hello')return reply({id:frame.id,ok:true,
    capabilities:{can_execute:mode!=='observe',runtime:'reference-test',mode,child_pid:process.pid,async_events:['async','admission-probe','answer-intake-probe'].includes(mode),graceful_shutdown:mode==='graceful',
      admission_probe_v1:mode==='bad-admission-capability'?'yes':mode==='admission-probe',
      answer_intake_probe_v1:mode==='bad-answer-intake-capability'?'yes':mode==='answer-intake-probe'}});
  if(mode==='admission-probe'&&frame.type==='admission_probe')return reply({id:frame.id,ok:true,admission:{status:'not_proven'}});
  if(mode==='answer-intake-probe'&&frame.type==='answer_intake_probe')return reply({id:frame.id,ok:true,answer_intake:{status:'not_proven'}});
  if(mode==='graceful'&&frame.type==='shutdown'){
    setTimeout(()=>{import('node:fs').then(fs=>{fs.writeFileSync(process.argv[3],'cleanup-confirmed');reply({id:frame.id,ok:true});process.exit(0);});},100);
    return;
  }
  if(mode==='async'){
    if(frame.type==='events')return reply({id:frame.id,ok:true,events});
    if(frame.type==='events_ack'){
      events=events.filter(event=>!frame.event_ids.includes(event.event_id));return reply({id:frame.id,ok:true});
    }
    if(frame.type==='item'&&frame.item.kind==='task'&&frame.item.state==='queued'){
      events.push({event_id:`question-${frame.item.object_id}`,delivery_id:frame.delivery_id,actions:[{
        action:'request',request_id:`request-${frame.item.object_id}`,runtime_request_id:'synthetic-wait-id',
        mode:'choice',question:'合成子进程问题',options:[{option_id:'A',label:'A'},{option_id:'B',label:'B'}]}]});
      return reply({id:frame.id,ok:true,actions:[{action:'task_state',state:'agent_received'}]});
    }
    if(frame.type==='answer'){
      events.push({event_id:`complete-${frame.request.body.task_id}`,delivery_id:frame.delivery_id,
        actions:[{action:'task_state',state:'completed'}]});
      return reply({id:frame.id,ok:true,actions:[]});
    }
  }
  workCount++;
  if(mode==='garbage-once'&&workCount===1)return void process.stdout.write('not json\n');
  if(mode==='valid-then-garbage')return void process.stdout.write(JSON.stringify({id:frame.id,ok:true,actions:[]})+'\nnot json\n');
  if(mode==='unknown-id')return reply({id:frame.id+100,ok:true,actions:[]});
  if(mode==='missing-actions')return reply({id:frame.id,ok:true});
  if(mode==='silent')return;                                   // never answers work frames
  if(mode==='garbage')return void process.stdout.write('not json\n');
  if(mode==='crash')return void process.exit(9);               // dies while work is in flight
  if(mode==='observe')return reply({id:frame.id,ok:true,actions:[{action:'none'}]});
  if(frame.type==='item'&&frame.item.kind==='task'&&frame.item.state==='queued')
    return reply({id:frame.id,ok:true,actions:[
      {action:'task_state',state:'agent_received'},
      {action:'receipt',stage:'agent_received',subject_kind:'task',subject_id:frame.item.object_id,subject_revision:frame.item.revision}]});
  if(frame.type==='item'&&frame.item.kind==='message')return reply({id:frame.id,ok:true,actions:[{action:'none'}]});
  if(frame.type==='answer')return reply({id:frame.id,ok:true,actions:[
    {action:'receipt',stage:'agent_received',subject_kind:'answer',subject_id:frame.answer.object_id,subject_revision:1}]});
  return reply({id:frame.id,ok:true,actions:[]});
});
