import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { PrompterProbeControl,PrompterProbeSnapshot } from './PrompterProbeControl';
import { teleprompter } from './TeleprompterService';
import { probeSession } from './ProbeSession';

export function prompterProbeSnapshot():PrompterProbeSnapshot{
  const p=teleprompter,v=new PrompterProbeSnapshot();
  v.active=p.active;v.phase=p.phase;v.connected=probeSession.features.state.connected;v.foreground=probeSession.foreground;
  v.can_stop=v.connected&&p.canRequestExit;v.mode=p.mode;v.progress=p.progress;v.pending_writes=p.pendingWrites;
  v.file_complete=p.fileComplete;v.business_ready=p.preparationReady;
  v.query_state=p.lastQueryState;v.query_failure=p.lastQueryFailure;v.exit_evidence=p.cleanupEvidence;
  if(v.active&&v.connected&&p.cleanupSessionId){
    const bytes=new util.TextEncoder().encodeInto(probeSession.peerDeviceId+'\n'+String(probeSession.auth.connectionGeneration)+'\n'+p.cleanupSessionId);
    const hash=cryptoFramework.createMd('SHA256');
    try{hash.updateSync({data:bytes});const digest=hash.digestSync().data;
      try{v.binding=Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('');}finally{digest.fill(0);}
    }finally{bytes.fill(0);}
  }
  return v;
}
export function makePrompterProbeControl(read:(name:string)=>string|undefined,write:(name:string,value:string)=>void,capacity:()=>void):PrompterProbeControl{
  return new PrompterProbeControl({now:()=>Date.now(),read,write,capacity,view:prompterProbeSnapshot,stop:()=>teleprompter.stopAndWait()});
}
