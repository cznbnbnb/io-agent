import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {reject} from './json.mjs';

const HOUR=3600000,DAY=24*HOUR,APP_ID=0x694F5472;
// 独立侧账本：不迁移主资料库，不保存正文、令牌、查询参数或原始 URL。
export class TrafficLedger{
  constructor(file,serverId,{clock=Date.now}={}){
    this.clock=clock;this.writes=0;this.db=new DatabaseSync(file);
    try{
      this.db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const app=this.db.prepare('PRAGMA application_id').get().application_id;
      const version=this.db.prepare('PRAGMA user_version').get().user_version;
      if(app===0&&version===0&&!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()){
        this.db.exec(`BEGIN IMMEDIATE;
          PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
          CREATE TABLE binding(server_id TEXT NOT NULL) STRICT;
          CREATE TABLE buckets(hour INTEGER NOT NULL,owner TEXT NOT NULL,producer TEXT NOT NULL,route TEXT NOT NULL,method TEXT NOT NULL,status INTEGER NOT NULL,
            requests INTEGER NOT NULL,request_bytes INTEGER NOT NULL,response_bytes INTEGER NOT NULL,
            PRIMARY KEY(hour,owner,producer,route,method,status)) STRICT;
          CREATE TABLE recent(seq INTEGER PRIMARY KEY,at INTEGER NOT NULL,owner TEXT NOT NULL,producer TEXT NOT NULL,
            route TEXT NOT NULL,method TEXT NOT NULL,status INTEGER NOT NULL,request_bytes INTEGER NOT NULL,response_bytes INTEGER NOT NULL,duration_ms INTEGER NOT NULL) STRICT;
          CREATE INDEX recent_owner_time ON recent(owner,at);`);
        try{this.db.prepare('INSERT INTO binding VALUES (?)').run(serverId);this.db.exec('COMMIT');}
        catch(error){this.db.exec('ROLLBACK');throw error;}
      }else if(app!==APP_ID||version!==1)throw new Error('TRAFFIC_DATABASE_UNRECOGNIZED');
      if(this.db.prepare('SELECT server_id FROM binding').get()?.server_id!==serverId)throw new Error('TRAFFIC_SERVER_MISMATCH');
      this.prune();
    }catch(error){this.db.close();throw error;}
  }
  prune(){
    this.db.prepare('DELETE FROM buckets WHERE hour<?').run(this.clock()-30*DAY);
    this.db.prepare('DELETE FROM recent WHERE at<? OR seq <= COALESCE((SELECT max(seq)-10000 FROM recent),0)').run(this.clock()-2*DAY);
  }
  record({owner,producer,route,method,status,request_bytes,response_bytes,duration_ms}){
    if(![owner,producer].every(value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value))||
      !['identity','materials','changes','inbox','tasks','requests','answers','messages','receipts','events','other'].includes(route)||
      !['GET','POST','OTHER'].includes(method)||!Number.isInteger(status)||status<100||status>599||
      ![request_bytes,response_bytes,duration_ms].every(value=>Number.isSafeInteger(value)&&value>=0))throw new Error('TRAFFIC_RECORD_INVALID');
    const now=this.clock(),hour=Math.floor(now/HOUR)*HOUR;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare(`INSERT INTO buckets VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(hour,owner,producer,route,method,status)
        DO UPDATE SET requests=requests+1,request_bytes=request_bytes+excluded.request_bytes,response_bytes=response_bytes+excluded.response_bytes`)
        .run(hour,owner,producer,route,method,status,request_bytes,response_bytes);
      this.db.prepare('INSERT INTO recent(at,owner,producer,route,method,status,request_bytes,response_bytes,duration_ms) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(now,owner,producer,route,method,status,request_bytes,response_bytes,duration_ms);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(++this.writes%128===0)this.prune();
  }
  snapshot(owner,hours=24){
    if(!Number.isInteger(hours)||hours<1||hours>168)reject(400,'INVALID_QUERY');
    const since=(Math.floor(this.clock()/HOUR)-hours+1)*HOUR;
    const producers=this.db.prepare(`SELECT producer AS producer_id,SUM(requests) AS requests,SUM(request_bytes) AS request_bytes,SUM(response_bytes) AS response_bytes,
      SUM(CASE WHEN status>=400 THEN requests ELSE 0 END) AS errors FROM buckets WHERE owner=? AND hour>=? GROUP BY producer ORDER BY producer`).all(owner,since);
    const recent=this.db.prepare(`SELECT at,producer AS producer_id,route,method,status,request_bytes,response_bytes,duration_ms FROM recent WHERE owner=? AND at>=? ORDER BY seq DESC LIMIT 50`).all(owner,since);
    return {available:true,window_from:new Date(since).toISOString(),hours,producers,recent,
      totals:producers.reduce((sum,row)=>{for(const key of ['requests','request_bytes','response_bytes','errors'])sum[key]+=row[key];return sum;},{requests:0,request_bytes:0,response_bytes:0,errors:0})};
  }
  close(){this.db.close();}
}

export function trafficObservation(req){
  const started=performance.now();
  return {principal:null,route:'other',request_bytes:0,started,
    record(ledger,status,responseBytes){
      if(!ledger||!this.principal)return;
      ledger.record({owner:this.principal.owner,producer:this.principal.producer,route:this.route,
        method:['GET','POST'].includes(req.method)?req.method:'OTHER',status,request_bytes:this.request_bytes,
        response_bytes:responseBytes,duration_ms:Math.max(0,Math.round(performance.now()-started))});
    }};
}
