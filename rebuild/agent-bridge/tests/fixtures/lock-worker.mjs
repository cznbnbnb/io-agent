import {BridgeRunLock} from '../../run-lock.mjs';
const [stateFile,identityText,scope]=process.argv.slice(2);
let lease;
try{
  lease=BridgeRunLock.acquire({stateFile,identity:JSON.parse(identityText),...(scope?{scope}:{})});
  process.send?.({ready:true});
  process.on('message',message=>{if(message?.type==='release'){lease.release();process.exit(0);}});
  process.on('disconnect',()=>{lease.release();process.exit(0);});
}catch(error){process.send?.({error:error.code??'LOCK_FAILED'});process.exitCode=1;process.disconnect?.();}
