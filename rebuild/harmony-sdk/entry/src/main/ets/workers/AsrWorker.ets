// 转写 Worker：模型加载、PCM 解码、VAD、SenseVoice、声纹提取全部在这条线程上跑，
// 主线程只做进度显示和角色卡匹配。模型从 filesDir/asr-models 读真实文件
// （Worker 拿不到主线程的 resourceManager，rawfile 已由主线程解包到磁盘）。
import { worker, ThreadWorkerGlobalScope, MessageEvents } from '@kit.ArkTS';
import { LifelogASR } from '../LifelogASR';
import { AsrWindowRequest } from '../AsrWindows';

interface WorkerJob { cmd: string; jobId: number; path: string; kind: string; filesDir: string; windowRequest?:AsrWindowRequest }

const port: ThreadWorkerGlobalScope = worker.workerPort;
const engine = new LifelogASR();
let currentJob: number = 0;
let running: boolean = false;
const queue: WorkerJob[] = [];

engine.changed = (): void => {
  port.postMessage({ type: 'progress', jobId: currentJob, progress: engine.progress, note: engine.note });
};

async function pump(): Promise<void> {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true; currentJob = job.jobId;
  try {
    if (job.cmd === 'init') {
      engine.initializeWorker(job.filesDir);
    } else if (job.cmd === 'health') {
      // Queue/lifecycle diagnostic only. Does not load models or read audio.
      port.postMessage({ type: 'result', jobId: job.jobId, note: 'worker_queue_ready' });
    } else if (job.cmd === 'load') {
      engine.warmup();
      port.postMessage({ type: 'result', jobId: job.jobId, note: engine.note });
    } else if(job.cmd==='codec_probe'){
      const report=await engine.checkWindowCodec(job.path);
      port.postMessage({type:'result',jobId:job.jobId,codecReport:report});
    } else if(job.cmd==='window'){
      if(!job.windowRequest)throw new Error('ASR_WINDOW_MISSING');
      const out=await engine.transcribeWindow(job.path,job.kind,job.windowRequest);
      port.postMessage({type:'result',jobId:job.jobId,transcript:out,note:engine.note});
    } else if (job.cmd === 'transcribe') {
      if(!['recording','recording_left','recording_right','lifelog'].includes(job.kind))throw new Error('asr-kind-invalid');
      const out = job.kind === 'lifelog' ? await engine.transcribe(job.path) :
        await engine.transcribeRecording(job.path,job.kind==='recording_left'?'left':job.kind==='recording_right'?'right':'mix');
      port.postMessage({ type: 'result', jobId: job.jobId, transcript: out, note: engine.note });
    }
  } catch (error) {
    port.postMessage({ type: 'error', jobId: job.jobId, message: (error as Error).message });
  }
  running = false;
  void pump();
}

port.onmessage = (e: MessageEvents): void => {
  queue.push(e.data as WorkerJob);
  void pump();
};
port.onmessageerror = (): void => {};
