import { common, abilityAccessCtrl } from '@kit.AbilityKit';
import { Candidate, DiscoveryReport } from 'turbo_core';
import { probeSession } from '../ProbeSession';
import { SuggestionTestPanel } from './SuggestionTestPanel';
import { backgroundLab } from '../BackgroundLabSession';
import { RecordingLabPanel } from './RecordingLabPanel';

@Entry
@Component
struct SuggestionLab {
  @State phase: string = 'idle';
  @State note: string = '正在读取已有连接';
  @State transportStage: string = 'idle';
  @State scanNote: string = '尚未扫描附近眼镜';
  @State candidates: Candidate[] = [];
  @State requesting: boolean = false;
  @State backgroundNote: string = '尚未运行后台只读实验';
  @State backgroundActive: boolean = false;
  aboutToAppear(): void {
    backgroundLab.changed = (): void => { this.backgroundNote = backgroundLab.note; this.backgroundActive = backgroundLab.active; };
    probeSession.onConnection = (): void => this.refresh(); this.refresh();
    probeSession.onDiscovery = (report: DiscoveryReport): void => {
      this.scanNote = report.status;
      this.candidates = report.candidates.filter((item: Candidate): boolean => !item.classic);
    };
  }
  aboutToDisappear(): void {
    backgroundLab.changed = (): void => {};
    probeSession.onConnection = (): void => {};
    probeSession.onDiscovery = (_: DiscoveryReport): void => {}; probeSession.discovery.stop();
  }
  private refresh(): void {
    this.phase = probeSession.connection.phase; this.note = probeSession.connection.note;
    this.transportStage = probeSession.connection.transportStage;
  }
  private async connectOrScan(scan: boolean): Promise<void> {
    if (this.requesting || this.phase === 'ready') return;
    this.requesting = true;
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context,
        ['ohos.permission.ACCESS_BLUETOOTH']);
      if (result.authResults.length !== 1 || result.authResults[0] !== 0) { this.note = '请允许蓝牙权限'; return; }
      if (!probeSession.foreground) return;
      if (scan) { probeSession.stop(); this.candidates = []; probeSession.discovery.start(); }
      else await probeSession.reconnect(context);
    } catch (_) { this.note = '连接或扫描未启动，请保留当前状态供排查'; }
    finally { this.requesting = false; }
  }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('P10/P12 隔离实验 · 0.1.33').fontSize(24).fontColor($r('app.color.text_primary'))
        Text('仅明确操作测试录音与转写，不启动日常智记、上传或历史音频清理。请先在原 App 停止采集，并关闭其他眼镜显示任务。').fontSize(14).fontColor($r('app.color.warm'))
        Text(this.phase + ' · ' + this.note).fontSize(14).fontColor($r('app.color.text_primary'))
        Text('蓝牙阶段：' + this.transportStage).fontSize(14).fontColor($r('app.color.text_primary'))
        RecordingLabPanel()
        Text(this.backgroundNote).fontSize(14).fontColor($r('app.color.text_primary'))
        Button('开始 90 秒后台只读实验').enabled(this.phase === 'ready' && !this.backgroundActive)
          .onClick((): void => { backgroundLab.start(this.getUIContext().getHostContext() as common.UIAbilityContext); })
        Button('结束后台实验').enabled(this.backgroundActive).onClick((): void => { backgroundLab.stop(); })
        Button('重连已保存眼镜').enabled(!this.requesting && this.phase !== 'ready')
          .onClick((): void => { this.connectOrScan(false); })
        Button('扫描核对已保存眼镜').enabled(!this.requesting && this.phase !== 'ready')
          .onClick((): void => { this.connectOrScan(true); })
        Text(this.scanNote).fontSize(14).fontColor($r('app.color.text_primary'))
        ForEach(this.candidates, (candidate: Candidate) => {
          Text(candidate.label + ' · ' + candidate.rssi + ' dBm · ' +
            (probeSession.matchesSavedAddress(candidate) ? '与保存地址一致' : '与保存地址不同，未替换身份'))
            .fontSize(14).fontColor($r('app.color.text_primary'))
          Button(probeSession.matchesSavedAddress(candidate) ? '连接此已保存眼镜' : '核对身份并恢复连接')
            .enabled(this.phase !== 'ready' && !this.requesting)
            .onClick((): void => {
              probeSession.recoverSavedAddress(candidate, this.getUIContext().getHostContext() as common.UIAbilityContext)
                .catch((): void => { this.note = '连接未完成，请保留状态供排查'; });
            })
        }, (candidate: Candidate): string => candidate.id)
        SuggestionTestPanel()
      }.padding({ left: 20, right: 20, top: 60, bottom: 40 }).width('100%')
    }.width('100%').height('100%').backgroundColor($r('app.color.background'))
  }
}
