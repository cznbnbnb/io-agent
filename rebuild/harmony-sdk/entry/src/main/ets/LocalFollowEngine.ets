import { fileIo as fs } from '@kit.CoreFileKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { OnlineRecognizer,OnlineRecognizerConfig,OnlineStream,Samples } from 'sherpa_onnx';
import { prompterModelSHA,prompterTokensSHA } from './PrompterModel';
import { LocalFollowReply } from './LocalFollowWire';
// Used exclusively inside PrompterWorker. No capture storage or network.
export class LocalFollowEngine {
  private recognizer:OnlineRecognizer|undefined=undefined;private stream:OnlineStream|undefined=undefined;
  private previous:string='';private sentence:number=1;
  private verify(path:string,expected:string):void{
    if(!fs.accessSync(path))throw new Error('MODEL_MISSING');const file=fs.openSync(path,fs.OpenMode.READ_ONLY);const hash=cryptoFramework.createMd('SHA256');
    const buffer=new Uint8Array(1048576);
    try{while(true){const n=fs.readSync(file.fd,buffer.buffer);if(n===0)break;if(!Number.isSafeInteger(n)||n<0||n>buffer.length)throw new Error('MODEL_READ');const chunk=buffer.slice(0,n);try{hash.updateSync({data:chunk});}finally{chunk.fill(0);}}
      const digest=hash.digestSync().data;let result='';for(const b of digest)result+=b.toString(16).padStart(2,'0');digest.fill(0);if(result!==expected)throw new Error('MODEL_HASH');
    }finally{buffer.fill(0);fs.closeSync(file);}
  }
  load(directory:string):void{
    if(!directory.endsWith('/prompter-ctc-zh-2025-04-01'))throw new Error('MODEL_DIRECTORY');
    this.verify(directory+'/model.int8.onnx',prompterModelSHA);this.verify(directory+'/tokens.txt',prompterTokensSHA);
    const config=new OnlineRecognizerConfig();config.modelConfig.zipformer2Ctc.model=directory+'/model.int8.onnx';config.modelConfig.tokens=directory+'/tokens.txt';config.modelConfig.numThreads=2;
    config.modelConfig.provider='cpu';config.modelConfig.debug=false;config.featConfig.sampleRate=16000;config.featConfig.featureDim=80;config.decodingMethod='greedy_search';
    config.enableEndpoint=true;config.rule2MinTrailingSilence=0.7;config.rule3MinUtteranceLength=20;
    this.recognizer=new OnlineRecognizer(config);this.pause();
  }
  begin():void{if(!this.recognizer)throw new Error('MODEL_NOT_READY');this.stream=this.recognizer.createStream();this.previous='';this.sentence=1;}
  pause():void{this.stream=undefined;this.previous='';}
  finish():LocalFollowReply{
    if(!this.recognizer||!this.stream)throw new Error('STREAM_NOT_READY');
    const stream=this.stream,tail=new Float32Array(8000);const reply=new LocalFollowReply();
    try{
      stream.acceptWaveform({samples:tail,sampleRate:16000});stream.inputFinished();
      let loops=0;while(this.recognizer.isReady(stream)){if(++loops>64)throw new Error('DECODE_BACKLOG');this.recognizer.decode(stream);}
      reply.text=this.recognizer.getResult(stream).text.trim();if(reply.text.length>4000)throw new Error('TEXT_LIMIT');
      reply.id=this.sentence;reply.final=true;return reply;
    }finally{tail.fill(0);this.pause();}
  }
  append(pcm:Uint8Array):LocalFollowReply{
    if(!this.recognizer||!this.stream||!pcm.length||pcm.length%2||pcm.length>4096)throw new Error('PCM_INVALID');
    const samples=new Float32Array(pcm.length/2);for(let i=0;i<samples.length;i++){let value=pcm[2*i]|pcm[2*i+1]<<8;if(value>=32768)value-=65536;samples[i]=value/32768;}
    const began=Date.now();const reply=new LocalFollowReply();
    try{const input:Samples={samples,sampleRate:16000};this.stream.acceptWaveform(input);let loops=0;while(this.recognizer.isReady(this.stream)){if(++loops>64)throw new Error('DECODE_BACKLOG');this.recognizer.decode(this.stream);}
      const text=this.recognizer.getResult(this.stream).text.trim();if(text.length>4000)throw new Error('TEXT_LIMIT');const final=this.recognizer.isEndpoint(this.stream);
      if(text&&(text!==this.previous||final)){reply.text=text;reply.final=final;reply.id=this.sentence;this.previous=text;}
      if(final){this.recognizer.reset(this.stream);this.previous='';this.sentence++;}
    }finally{samples.fill(0);reply.decodeMs=Math.max(0,Date.now()-began);}
    return reply;
  }
}
