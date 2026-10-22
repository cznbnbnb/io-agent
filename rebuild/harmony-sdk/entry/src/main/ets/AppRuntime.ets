import { common } from '@kit.AbilityKit';
import { probeSession } from './ProbeSession';
import { connectedServices } from './ConnectedServices';
import { localWorkspace } from './LocalWorkspace';
import { recordings, lifelog, voices, lifelogASR, materials, startRecordingServices, stopRecordingServices, prepareInteractiveAudio } from './RecordingService';
import { materialSyncService } from './MaterialSyncService';
import { taskService } from './TaskService';
import { notifications, suggestionTests, initializeNotifications } from './NotificationService';
import { teleprompter,initializeTeleprompter,disposeTeleprompter } from './TeleprompterService';
import { AsrEngineClient, AsrWorkerLifecycle } from './AsrEngine';
import { agentCapture,initializeAgentCapture,disposeAgentCapture } from './AgentCaptureService';
import { taskRecordingCapture,initializeTaskRecordingCapture,disposeTaskRecordingCapture,observeTaskRecordingAudio } from './TaskRecordingService';
import { taskSuggestions,initializeTaskSuggestions,disposeTaskSuggestions } from './TaskSuggestionService';
import { initializeDebugCards,disposeDebugCards } from './DebugCardService';

// Own device routing and workers at Ability lifetime, independent of page mounting.
export class AppRuntime {
  private initialized: boolean = false;
  private engine: AsrEngineClient | undefined = undefined;
  private ensureEngine(context:common.UIAbilityContext):void{
    if(!this.initialized)return;
    if(this.engine&&!this.engine.isClosed())return;
    this.engine=new AsrEngineClient(context.filesDir,(progress:number,note:string):void=>{
      if(!this.initialized)return;
      if(progress>=0)lifelogASR.progress=progress;
      if(note)lifelogASR.note=note;
      lifelogASR.changed();recordings.changed();
    },(event:AsrWorkerLifecycle):void=>lifelogASR.log('worker-client',JSON.stringify(event)));
    lifelogASR.engine=this.engine;lifelogASR.busy=false;
  }

  initialize(context: common.UIAbilityContext): void {
    if (this.initialized) return;
    this.initialized = true;
    lifelogASR.requireWorker = true;
    initializeTeleprompter(context);
    initializeNotifications(context.filesDir);
    suggestionTests.initialize(context.filesDir);
    probeSession.onNotification = (peer: string, payload: Uint8Array): void => {
      notifications.receive(peer, payload); suggestionTests.receive(peer, payload);taskSuggestions.receive(peer,payload);
    };
    probeSession.onNotificationDisconnected = (): void => { notifications.disconnected(); suggestionTests.disconnected();taskSuggestions.pause('眼镜连接已断开；保留原卡清理记录和草稿'); };
    probeSession.onPrompter = (peer: string, business: number, payload: Uint8Array): void => teleprompter.receive(peer, business, payload);
    probeSession.onPrompterDisconnected = (): void => teleprompter.disconnected();
    probeSession.onPrompterConnected = (): void => teleprompter.connected();
    probeSession.onPrompterSuspend = (): Promise<boolean> => Promise.all([teleprompter.stopAndWait(),agentCapture.stopAndWait(),taskSuggestions.stopAndWait()]).then((results:boolean[]):boolean=>results.every((value:boolean):boolean=>value));
    probeSession.prompterOccupied = (): boolean => teleprompter.active;
    probeSession.onRecording = (peer: string, payload: Uint8Array): void => {
      taskService.voiceSources.observe(peer,probeSession.auth.connectionGeneration,14,payload);
      observeTaskRecordingAudio(peer,probeSession.auth.connectionGeneration,payload);recordings.receive(peer,payload);
    };
    probeSession.onRecordingDisconnected = (): void => recordings.disconnected();
    probeSession.recordingOccupied = (): boolean => recordings.occupied;
    probeSession.onLifelog = (peer: string, payload: Uint8Array): void => lifelog.receive(peer, payload);
    probeSession.onLifelogLauncher = (payload: Uint8Array): void => lifelog.receiveLauncher(payload);
    probeSession.onLifelogDisconnected = (): void => lifelog.disconnected();
    probeSession.onLifelogConnected = (): void => { lifelog.connected().catch((): void => {}); };
    probeSession.lifelogOccupied = (): boolean => lifelog.occupied;
    probeSession.voice.beforeBegin = (): Promise<void> => {prepareInteractiveAudio();return lifelog.suspendForVoice();};
    probeSession.voice.onRoundEnded = (): void => {
      if(probeSession.voice.active||probeSession.voice.pendingWrites||probeSession.voice.cleanupRequired)return;
      lifelog.resumeAfterVoice().catch(():void=>{lifelog.note='AI 对话结束，智记恢复待重试';lifelog.changed();});
    };
    probeSession.onTodo = (peer: string, payload: Uint8Array): void => localWorkspace.receiveTodo(peer, payload);
    localWorkspace.setTodoTransport({
      peer:():string=>probeSession.peerDeviceId,ready:():boolean=>this.initialized&&probeSession.todoConnected(),
      foreground:():boolean=>probeSession.foreground,lease:():number=>probeSession.todoEpoch,
      send:(business:number,payload:Uint8Array):Promise<void>=>probeSession.auth.sendBusiness(business,payload)
    });
    probeSession.onTodoLifecycle=():void=>localWorkspace.todoConnectionChanged();
    probeSession.voice.completed = (id: string, text: string, answer: string, model: string): void => {
      localWorkspace.conversation(id, text, answer, model).catch((): void => {
        localWorkspace.note = '回答已收到，但本机存档失败'; localWorkspace.changed();
      });
    };
    try { recordings.initialize(context); } catch (_) { recordings.note = '录音目录读取失败，原件保留'; }
    try { lifelog.initialize(context); } catch (_) { lifelog.note = '智记目录读取失败，原件保留'; }
    try {
      lifelogASR.initialize(context);
      this.ensureEngine(context);
      voices.initialize(context.filesDir); lifelogASR.registry = voices;
      startRecordingServices(context.filesDir,():void=>this.ensureEngine(context),():void=>{
        this.engine?.close();this.ensureEngine(context);
      });
      materialSyncService.initialize(context.filesDir,materials);
      // Load large models only when a transcription is requested, on the worker.
    } catch (_) { lifelogASR.note = '离线转写初始化未完成，请重新打开应用'; }
    // Task routing does not depend on model/capture initialization succeeding.
    taskService.initialize(context.filesDir);
    initializeAgentCapture(context);
    initializeTaskRecordingCapture(context);
    initializeTaskSuggestions(context.filesDir);
    probeSession.onAgentCapture=(peer:string,business:number,payload:Uint8Array,epoch:number):boolean=>agentCapture.receive(peer,business,payload,epoch);
    probeSession.onAgentCaptureDisconnected=():void=>{taskService.voiceSources.disconnected();taskRecordingCapture.disconnected();agentCapture.disconnected();};
    localWorkspace.load(context).then(():void=>{if(this.initialized)localWorkspace.todoConnectionChanged();}).catch((): void => {
      localWorkspace.note = '本机资料暂不可读'; localWorkspace.changed();
    });
    connectedServices.start();
    try{initializeDebugCards(context);}catch{ /* Optional local diagnostics must not stop normal services. */ }
  }

  dispose(): void {
    if(!this.initialized)return;
    probeSession.voice.connected(false);
    localWorkspace.setTodoTransport(undefined);probeSession.onTodoLifecycle=():void=>{};
    disposeDebugCards();
    stopRecordingServices();
    disposeTaskSuggestions();
    disposeTaskRecordingCapture();
    disposeTeleprompter();
    disposeAgentCapture();
    materialSyncService.dispose().catch(():void=>{});
    taskService.dispose().catch(():void=>{});
    lifelog.dispose();
    notifications.disconnected();
    suggestionTests.disconnected();
    connectedServices.stop();
    this.engine?.close(); this.engine = undefined;
    lifelogASR.engine = undefined;lifelogASR.busy=false;
    // 销毁后断开旧运行时订阅，避免重建或实验入口继续调用已释放业务。
    probeSession.onRecording=():void=>{};probeSession.onRecordingDisconnected=():void=>{};
    probeSession.recordingOccupied=():boolean=>false;
    probeSession.onLifelog=():void=>{};probeSession.onLifelogLauncher=():void=>{};
    probeSession.onLifelogDisconnected=():void=>{};probeSession.onLifelogConnected=():void=>{};
    probeSession.lifelogOccupied=():boolean=>false;
    probeSession.onNotification=():void=>{};probeSession.onNotificationDisconnected=():void=>{};
    probeSession.onPrompter=():void=>{};probeSession.onPrompterDisconnected=():void=>{};probeSession.onPrompterConnected=():void=>{};
    probeSession.onPrompterSuspend=():Promise<boolean>=>Promise.resolve(true);probeSession.prompterOccupied=():boolean=>false;
    probeSession.onAgentCapture=():boolean=>false;probeSession.onAgentCaptureDisconnected=():void=>{};
    probeSession.onTodo=():void=>{};
    probeSession.voice.beforeBegin=async():Promise<void>=>{};
    probeSession.voice.onRoundEnded=():void=>{};
    probeSession.voice.completed=():void=>{};
    this.initialized = false;
  }
}

export const appRuntime: AppRuntime = new AppRuntime();
