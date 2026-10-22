import { LifelogTranscript } from './LifelogASR';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { MaterialSpeaker, MaterialTextInput, MaterialUtterance } from './MaterialStore';

// Coverage includes processed silence. Utterance ends and VAD speech duration
// cannot tell us how much of the original recording has been processed.
export class MaterialCoverageInput {
  complete:boolean|undefined=undefined;coveredFrames:number=-1;sourceFrames:number=-1;frameMs:number=0;
}
export function materialSpeakerId(materialId:string,cluster:number):string{
  if(!/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(materialId)||!Number.isSafeInteger(cluster)||cluster<0)throw new Error('MATERIAL_SPEAKER_INPUT_INVALID');
  const bytes=new util.TextEncoder().encodeInto('segment-'+cluster.toString());const md=cryptoFramework.createMd('SHA256');
  try{md.updateSync({data:bytes});const digest=md.digestSync().data;
    const suffix=Array.from(digest).map((n:number):string=>n.toString(16).padStart(2,'0')).join('').slice(0,20);digest.fill(0);return materialId+'-s'+suffix;
  }finally{bytes.fill(0);}
}
export function materialTextInput(result:LifelogTranscript,text:string,channel:string,
  coverage:MaterialCoverageInput|undefined=undefined,materialId:string|undefined=undefined):MaterialTextInput{
  const input=new MaterialTextInput();input.text=text;input.channel=channel;
  input.speakerProcessing=result.speakerProcessing||'unknown';input.boundaryProcessing=result.boundaryProcessing||'unknown';
  const labels:Map<number,MaterialSpeaker>=new Map();
  if(materialId!==undefined){
    if(!/^mat-(recording|lifelog)-[0-9a-f]{32}$/.test(materialId))throw new Error('MATERIAL_SPEAKER_INPUT_INVALID');
    const metadataIds:number[]=[];
    for(const speaker of result.speakers||[]){
      if(!Number.isSafeInteger(speaker.index)||speaker.index<0||metadataIds.includes(speaker.index))throw new Error('MATERIAL_SPEAKER_INPUT_INVALID');
      metadataIds.push(speaker.index);
    }
    input.speakers=[];
  }
  input.utterances=result.utterances.map((part):MaterialUtterance=>{
    const row=new MaterialUtterance();row.start_ms=Math.round(part.start*1000);row.end_ms=Math.round(part.end*1000);
    row.text=part.text;row.speaker_id=part.speaker>=0?'segment-'+part.speaker:'';
    row.speaker_basis=part.speaker>=0?'segment_cluster':'unknown';
    if(materialId!==undefined){
      if(!Number.isSafeInteger(part.speaker)||part.speaker< -1)throw new Error('MATERIAL_SPEAKER_INPUT_INVALID');
      if(part.speaker>=0){
        let label=labels.get(part.speaker);
        if(!label){
          label=new MaterialSpeaker();label.speaker_id=materialSpeakerId(materialId,part.speaker);
          const index=labels.size;label.label='说话人 '+String.fromCharCode(65+index%26)+(index>=26?Math.floor(index/26).toString():'');
          const metadata=result.speakers?.find((speaker):boolean=>speaker.index===part.speaker),name=metadata?.name;
          // A local role match is a candidate label, never proof that this is the
          // user. Voice embeddings, role IDs and biographies remain local.
          if(typeof name==='string'&&name.trim()&&name.length<=80&&!/[\u0000-\u001f\u007f-\u009f]/.test(name)){label.label=name;label.label_basis='role_match';}
          label.is_self=false;labels.set(part.speaker,label);input.speakers?.push(label);
        }
        row.speaker_id=label.speaker_id;
      }
    }
    return row;
  });
  if(coverage){
    const valid=typeof coverage.complete==='boolean'&&[20,60].includes(coverage.frameMs)&&
      Number.isSafeInteger(coverage.sourceFrames)&&coverage.sourceFrames>=0&&
      Number.isSafeInteger(coverage.coveredFrames)&&coverage.coveredFrames>=0&&coverage.coveredFrames<=coverage.sourceFrames&&
      Number.isSafeInteger(coverage.sourceFrames*coverage.frameMs);
    if(!valid)throw new Error('MATERIAL_COVERAGE_INVALID');
    input.coveredMs=coverage.coveredFrames*coverage.frameMs;input.sourceMs=coverage.sourceFrames*coverage.frameMs;
    if(coverage.complete&&input.coveredMs!==input.sourceMs)throw new Error('MATERIAL_COVERAGE_INVALID');
    input.transcriptionState=coverage.complete?'complete':'partial';
  }
  return input;
}
