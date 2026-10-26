package com.turboio.addon;

import java.util.Map;

/** One durable capture owner, independent of a question or delegated task.
 * Implementations keep their own provenance and journal schema. This contract
 * neither prepares a business target nor submits a reply/command.
 *
 * A stable implementation instance is also its state monitor: callers' compound
 * checks synchronize on that same instance. capturePermit/revokeOpening must not
 * wait for durable storage; revocation can only remove opening rights. */
interface CaptureSession {
 int CAPTURE_SECONDS=60;
 interface Cutoff {boolean armed(String token,String peerHash,long generation,long deadline);}
 /** Immutable last durable binding; not evidence that a stop has completed. */
 final class CapturePermit {
  final String token,peer,phase;final long generation,deadline;final boolean needsStop,opening;
  CapturePermit(Map<String,Object> state,boolean opening){token=(String)state.get("token");peer=(String)state.get("peer");phase=(String)state.get("phase");generation=TaskWire.nonnegative(state.get("generation"));deadline=TaskWire.nonnegative(state.get("deadline"));needsStop=Boolean.TRUE.equals(state.get("needs_stop"));this.opening=opening&&needsStop&&"CAPTURING".equals(phase);}
  CapturePermit(CapturePermit prior){token=prior.token;peer=prior.peer;phase=prior.phase;generation=prior.generation;deadline=prior.deadline;needsStop=prior.needsStop;opening=false;}
 }
 /** The issuing session must also retain and compare this exact object. Matching
  * fields alone never authorize idle evidence, including a newly constructed copy. */
 final class StopProbe {
  final CaptureSession owner;final long issued,generation;final String token,peer;
  StopProbe(CaptureSession owner,long issued,long generation,String token,String peer){this.owner=owner;this.issued=issued;this.generation=generation;this.token=token;this.peer=peer;}
 }
 boolean healthy();String phase();String token();boolean needsStop();Object snapshot();
 void revokeOpening(String token);CapturePermit capturePermit();
 boolean arm(String peer,long generation,long now,int seconds,Cutoff cutoff)throws Exception;
 boolean officialResult(String token,String peer,long generation,String text,boolean finished,long now)throws Exception;
 boolean failed(String token,String peer,long generation,String code,long now)throws Exception;
 boolean stop(String token,long now,boolean cancel)throws Exception;
 boolean stopSubmitted(String token,String peer,long generation,long now)throws Exception;
 boolean resumeCleanup(String peer,long generation,long now)throws Exception;
 boolean engineEnd(String token,long now)throws Exception;
 boolean engineSealed(String token,boolean terminal,long now)throws Exception;
 StopProbe probeStop(String peer,long generation,long now);
 boolean deviceIdle(StopProbe probe,String peer,long generation,long now,boolean idle)throws Exception;
 boolean finish()throws Exception;
 boolean cancelDraft(long now)throws Exception;
}
