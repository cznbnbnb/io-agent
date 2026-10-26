import {createHash} from 'node:crypto';
import {CodexDesktopSession} from '../../rebuild/agent-bridge/hosts/codex-desktop.mjs';

// Read only the actual caller's native thread. No resume, prompt, stop, remote
// registration or transcript output. Does not need the shared device channel.
const thread=process.env.CODEX_THREAD_ID;
let session;
try {
  if(!thread||process.argv.length!==2)throw Error('CODEX_NATIVE_CALLER_REQUIRED');
  session=await CodexDesktopSession.connect(thread,{timeoutMs:15000});
  const state=await session.status(),metadata=await session.snapshot();
  console.log(JSON.stringify({schema:1,at:new Date().toISOString(),read_only:true,real_desktop_owner:true,
    thread_sha256:createHash('sha256').update(thread).digest('hex'),busy:state.busy,
    active_turn_known:typeof state.activeTurnId==='string',loaded_turns:state.loadedTurns,
    metadata_bytes:Buffer.byteLength(JSON.stringify(metadata)),input_sent:false,interrupt_sent:false,
    scope:'Pinned installed desktop sources, current caller owner discovery and metadata subscription. No input, stop, child-process cleanup or phone end-to-end proof.'}));
}catch(error){console.log(JSON.stringify({error:error.code??'CODEX_DESKTOP_PROBE_FAILED',input_sent:false,interrupt_sent:false}));process.exitCode=2;}
finally{session?.close();}
