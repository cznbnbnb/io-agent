import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const identity = row => `${row.pid}:${row.started}`;

// Read-only. No signal is sent from this observer. Native tools retain their
// permission and cancellation paths. Keep identities, never argv or output.
export async function readProcessTable() {
  const {stdout} = await execute('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,uid=,lstart=,stat=,comm='],
    {encoding:'utf8', timeout:2000, maxBuffer:4*1024*1024});
  const rows = new Map();
  for (const line of stdout.trim().split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) throw new Error('PROCESS_WITNESS_TABLE_INVALID');
    const [,pid,ppid,pgid,uid,started,state,command] = match;
    rows.set(Number(pid), {pid:Number(pid), ppid:Number(ppid), pgid:Number(pgid), uid:Number(uid),
      started, state, executable:path.basename(command)});
  }
  return rows;
}

/** A live observer for a CLI engine which owns one session. It watches the
 * whole engine tree, plus observed groups and orphaned descendants. An engine
 * restart or a failed/overfull observation invalidates proof for its lifetime.
 * This cannot certify an arbitrary remote service or an intentionally escaped
 * daemon; callers also require a complete native-tool lifecycle ledger. */
export class ProcessWitness {
  #table; #now; #root; #known=new Map(); #groups=new Set(); #timer; #flight;
  #failed=false; #closed=false; #quietSince=null; #lastSample=0;
  #live=[]; #scopes=new Map();
  constructor({read=readProcessTable, clock=Date.now}={}) { this.#table=read; this.#now=clock; }
  async bind(pid) {
    if (this.#root || !Number.isSafeInteger(pid) || pid <= 1) throw new Error('PROCESS_WITNESS_ROOT_INVALID');
    const rows = await this.#table(), root = rows.get(pid);
    if (!root || root.uid !== process.getuid?.() || !['claude','claude.exe'].includes(root.executable) || root.state.startsWith('Z'))
      throw new Error('PROCESS_WITNESS_ROOT_UNTRUSTED');
    this.#root=root;
    await this.sample();
    this.#timer=setInterval(() => { void this.sample(); },150);
    this.#timer.unref();
  }
  async sample() {
    if (this.#closed || this.#failed || !this.#root) return false;
    if (this.#flight) return this.#flight;
    this.#flight=(async()=>{
      try {
        const rows=await this.#table(), root=rows.get(this.#root.pid);
        if (!root || identity(root)!==identity(this.#root) || root.executable!==this.#root.executable || root.state.startsWith('Z')) throw new Error('PROCESS_WITNESS_ROOT_CHANGED');
        if (this.#lastSample && this.#now()-this.#lastSample>1000) throw new Error('PROCESS_WITNESS_OBSERVATION_GAP');
        const owned=new Set([root.pid]);
        // Retain observed children after reparenting. PID reuse cannot inherit
        // their identity; group membership adds newly forked children too.
        for (const row of rows.values()) if (this.#known.get(row.pid)===identity(row) ||
            row.uid===root.uid && this.#groups.has(row.pgid)) owned.add(row.pid);
        let changed=true;
        while (changed) {
          changed=false;
          for (const row of rows.values()) if (!owned.has(row.pid) && owned.has(row.ppid)) { owned.add(row.pid); changed=true; }
        }
        const live=[];
        for (const pid of owned) {
          if (pid===root.pid) continue;
          const row=rows.get(pid);
          if (!row || row.uid!==root.uid) continue;
          this.#known.set(pid,identity(row));
          if (row.pgid!==root.pgid) this.#groups.add(row.pgid);
          if (!row.state.startsWith('Z')) live.push(identity(row));
        }
        if (this.#known.size>4096 || this.#groups.size>4096) throw new Error('PROCESS_WITNESS_LIMIT');
        this.#lastSample=this.#now();
        this.#live=live;
        if (live.length) this.#quietSince=null;
        else this.#quietSince??=this.#lastSample;
        for (const scope of this.#scopes.values()) {
          if (live.some(key=>!scope.baseline.has(key))) scope.quietSince=null;
          else scope.quietSince??=this.#lastSample;
        }
        return true;
      } catch { this.#failed=true; this.#quietSince=null; return false; }
      finally { this.#flight=null; }
    })();
    return this.#flight;
  }
  // Called by the broker while the native turn.start callback is still
  // awaiting its acknowledgement, before that turn may run tools. Existing
  // services/background tasks are unrelated work, never a kill target. Any
  // newly observed descendants (even of those services) still fence stop.
  async begin(turnId) {
    if (typeof turnId!=='string' || !turnId || this.#scopes.has(turnId) || this.#scopes.size>=1000)
      throw new Error('PROCESS_WITNESS_SCOPE_INVALID');
    if (!await this.sample()) throw new Error('PROCESS_WITNESS_UNAVAILABLE');
    this.#scopes.set(turnId,{baseline:new Set(this.#live),quietSince:this.#now()});
  }
  async inspect(turnId) {
    await this.sample();
    const now=this.#now(),scope=this.#scopes.get(turnId),quiet=scope?.quietSince;
    return {observed:!!this.#root && !this.#failed && !this.#closed,
      quiescent:!!scope && !!this.#root && !this.#failed && !this.#closed && quiet!==null &&
        now-quiet>=450 && now-this.#lastSample<=1000};
  }
  close() { this.#closed=true; clearInterval(this.#timer); }
}
