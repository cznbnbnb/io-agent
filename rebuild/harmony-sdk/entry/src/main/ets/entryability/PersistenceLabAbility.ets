import { UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { LiveSyncTargetFile, PersistenceLab } from '../PersistenceLab';
import { TaskMailboxLab } from '../TaskMailboxLab';
import { MaterialDeletionLab } from '../MaterialDeletionLab';

// Independent synthetic filesystem diagnostic; never imports AppRuntime,
// RecordingService or Bluetooth. The fixture is confined to its own directory.
export default class PersistenceLabAbility extends UIAbility {
  onCreate(want:Want):void{
    const phase=want.parameters?.phase as string||'';
    const runId=want.parameters?.run_id as string||'';
    if(['material-delete-seed','material-delete-resume'].includes(phase)){
      AppStorage.setOrCreate('persistenceLabScope','P21/P32 合成资料删除恢复：只处理独立测试目录，不录音、不连接眼镜、不联网、不删除用户记录。');
      const report=new MaterialDeletionLab().run(this.context.filesDir,phase,runId);
      AppStorage.setOrCreate('persistenceLabStatus',report.phase+' · '+report.status+' · '+report.checks.length+' 项'+(report.error?' · '+report.error:''));return;
    }
    AppStorage.setOrCreate('persistenceLabScope',['transport-live','coordinator-live','coordinator-resume','coordinator-offline','coordinator-online'].includes(phase)?
      '仅处理独立目录内的合成资料，会测试自有服务器 HTTPS；不连接眼镜、不录音、不执行任务。':
      '仅处理独立目录内的合成资料，不连接眼镜、不录音、不上传。');
    if(['task-seed','task-resume'].includes(phase)){
      AppStorage.setOrCreate('persistenceLabScope','P43 合成任务文件实验：不联网、不连接眼镜、不录音、不执行 Agent 任务。');
      new TaskMailboxLab().run(this.context.filesDir,phase,runId).then(report=>{
        AppStorage.setOrCreate('persistenceLabStatus',report.phase+' · '+report.status+' · '+report.checks.length+' 项'+(report.error?' · '+report.error:''));
      }).catch(()=>{AppStorage.setOrCreate('persistenceLabStatus','task-mailbox · failed');});return;
    }
    if(['coordinator-live','coordinator-resume','coordinator-offline','coordinator-online'].includes(phase)){
      new PersistenceLab().runCoordinatedLive(this.context.filesDir,phase,runId).then(report=>{
        AppStorage.setOrCreate('persistenceLabStatus',report.phase+' · '+report.status+' · '+report.checks.length+' 项'+(report.error?' · '+report.error:''));
      }).catch(()=>{AppStorage.setOrCreate('persistenceLabStatus','coordinator · failed');});
      return;
    }
    if(phase==='transport-live'){
      // Real network phase. An operator-supplied target is persisted into the app's
      // private directory before use; the ability stays alive while the pump settles.
      const parameters=want.parameters??{};
      const pushed=new LiveSyncTargetFile();
      pushed.base_url=parameters.base_url as string||'';pushed.token=parameters.token as string||'';
      pushed.owner_id=parameters.owner_id as string||'';pushed.producer_id=parameters.producer_id as string||'';
      pushed.server_id=parameters.server_id as string||'';
      new PersistenceLab().runLive(this.context.filesDir,phase,runId,pushed).then(report=>{
        AppStorage.setOrCreate('persistenceLabStatus',report.phase+' · '+report.status+' · '+report.checks.length+' 项'+(report.error?' · '+report.error:''));
      }).catch((error:Error)=>{
        AppStorage.setOrCreate('persistenceLabStatus','transport-live · failed · '+error.message);
      });
      return;
    }
    const report=new PersistenceLab().run(this.context.filesDir,phase,runId);
    AppStorage.setOrCreate('persistenceLabStatus',report.phase+' · '+report.status+' · '+report.checks.length+' 项'+(report.error?' · '+report.error:''));
  }
  onWindowStageCreate(stage:window.WindowStage):void{stage.loadContent('pages/PersistenceLab');}
}
