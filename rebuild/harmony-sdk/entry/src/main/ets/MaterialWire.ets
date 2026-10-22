import { util } from '@kit.ArkTS';
import { MaterialStore } from './MaterialStore';

// The sender must persist these identifiers and dates before the first attempt.
// No clock/random defaults: rebuilding a retry cannot silently make a new event.
export class MaterialEventIdentity {
  eventId:string='';idempotencyKey:string='';producerId:string='';createdAt:number=0;expiresAt:number=0;
}
export class WireMaterialUtterance {
  utterance_id:string='';start_ms:number|null=0;end_ms:number|null=0;text:string='';
  speaker_id:string|null=null;speaker_basis:string='unknown';overlap:boolean=false;
  source_range:WireMaterialSourceRange|undefined=undefined;
}
export class WireMaterialSourceRange {
  parent_utterance_id:string='';parent_revision:number=0;start_ms:number=0;end_ms:number=0;text_start:number=0;text_end:number=0;
}
export class WireMaterialSpeaker { speaker_id:string='';label:string='';label_basis:string='anonymous';is_self:boolean=false; }
export class WireMaterialText { format:string='markdown';text:string='';origin:string='none'; }
export class WireMaterialProcessing {
  transcription_state:string='unknown';covered_ms:number|null=null;source_ms:number|null=null;
  speaker:string='unknown';boundary:string='unknown';recognition_channel:string='unknown';user_edited:boolean=false;
}
export class WireMaterialAudio { state:string='missing';sha256:string|null=null;object_id:string|null=null; }
export class WireMaterialBody {
  material_id:string='';revision:number=1;base_revision:number=0;operation:string='upsert';source:string='recording';
  started_at:string='';ended_at:string='';completeness:string='partial';text_revision:number=0;
  utterances:WireMaterialUtterance[]=[];audio:WireMaterialAudio=new WireMaterialAudio();
  speakers:WireMaterialSpeaker[]|undefined=undefined;
  full_text:WireMaterialText=new WireMaterialText();processing:WireMaterialProcessing=new WireMaterialProcessing();
}
export class WireMaterialEvent {
  schema_version:string='1.1';event_id:string='';idempotency_key:string='';kind:string='material.revision';
  producer_id:string='';created_at:string='';expires_at:string='';body:WireMaterialBody=new WireMaterialBody();
}
function iso(ms:number):string{
  if(!Number.isSafeInteger(ms)||ms<0||!Number.isFinite(new Date(ms).getTime()))throw new Error('MATERIAL_EVENT_DATE_INVALID');
  return new Date(ms).toISOString();
}
// Read an explicit immutable revision. A retry never accidentally exports the
// latest text in place of the version originally queued. This performs no I/O
// outside MaterialStore reads and does not mark anything server_stored.
export function materialRevisionEvent(store:MaterialStore,id:string,revision:number,identity:MaterialEventIdentity):WireMaterialEvent{
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('MATERIAL_EVENT_REVISION_INVALID');
  if(typeof identity.eventId!=='string'||identity.eventId.length<1||identity.eventId.length>512||
    typeof identity.idempotencyKey!=='string'||identity.idempotencyKey.length<8||identity.idempotencyKey.length>256||
    typeof identity.producerId!=='string'||identity.producerId.length<1||identity.producerId.length>512||
    identity.expiresAt<=identity.createdAt)throw new Error('MATERIAL_EVENT_IDENTITY_INVALID');
  const event=new WireMaterialEvent();event.event_id=identity.eventId;event.idempotency_key=identity.idempotencyKey;
  event.producer_id=identity.producerId;event.created_at=iso(identity.createdAt);event.expires_at=iso(identity.expiresAt);
  const row=store.read(id,revision);if(!row)throw new Error('MATERIAL_NOT_FOUND');
  if(row.speakers!==undefined){
    event.schema_version='1.2';event.body.speakers=row.speakers.map((speaker):WireMaterialSpeaker=>{
      const out=new WireMaterialSpeaker();out.speaker_id=speaker.speaker_id;out.label=speaker.label;out.label_basis=speaker.label_basis;out.is_self=speaker.is_self;return out;
    });
  }else if(row.utterances.some((part):boolean=>part.source_range!==undefined||part.start_ms===null||part.end_ms===null))throw new Error('MATERIAL_EVENT_SCHEMA_REQUIRED');
  const body=event.body;body.material_id=row.material_id;body.revision=row.revision;body.base_revision=row.revision-1;
  body.operation=row.operation;body.source=row.source.kind;body.started_at=iso(row.source.started);body.ended_at=iso(row.source.ended);
  body.completeness=row.source.interrupted?'gap':row.source.complete?'complete':'partial';body.text_revision=row.text_revision;
  body.full_text.text=row.text;body.full_text.origin=row.text_origin;
  body.processing.transcription_state=row.transcription_state||'unknown';
  body.processing.covered_ms=row.covered_ms>=0?row.covered_ms:null;
  body.processing.source_ms=row.transcription_source_ms>=0?row.transcription_source_ms:null;
  body.processing.speaker=row.speaker_processing||'unknown';body.processing.boundary=row.boundary_processing||'unknown';
  body.processing.recognition_channel=row.recognition_channel;body.processing.user_edited=row.user_edited;
  if(!['unknown','mix','left','right','legacy_mix'].includes(body.processing.recognition_channel))throw new Error('MATERIAL_CHANNEL_INVALID');
  body.utterances=row.utterances.map((part):WireMaterialUtterance=>{
    const out=new WireMaterialUtterance();out.utterance_id=part.utterance_id;out.start_ms=part.start_ms;out.end_ms=part.end_ms;out.text=part.text;
    out.speaker_id=part.speaker_id||null;out.speaker_basis=part.speaker_basis==='user'?'user_confirmed':part.speaker_basis;out.overlap=part.overlap;
    if(part.source_range){
      const range=new WireMaterialSourceRange(),source=part.source_range;
      range.parent_utterance_id=source.parent_utterance_id;range.parent_revision=source.parent_revision;range.start_ms=source.start_ms;range.end_ms=source.end_ms;
      range.text_start=source.text_start;range.text_end=source.text_end;out.source_range=range;
    }
    return out;
  });
  body.audio.state=row.source.audioAvailable?'local':'missing';
  if(row.source.audioAvailable&&row.audio_checksum_state==='verified')body.audio.sha256=row.audio_sha256||null;
  // A verified local checksum does not prove the server has stored the audio.
  const payload=JSON.stringify(event),bytes=new util.TextEncoder().encodeInto(payload);const size=bytes.length;bytes.fill(0);
  // Optional 1.2 properties must be absent from the old strict object as well
  // as its serialized payload, rather than appearing as undefined own keys.
  if(size>262144)throw new Error('MATERIAL_EVENT_TOO_LARGE');return JSON.parse(payload) as WireMaterialEvent;
}
