import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { Candidate, DiscoveryReport, ProbeReport, BleHandshakeReport, runProtocolSelfTest } from 'turbo_core';
import { VersionProbeReport } from 'turbo_core';
import { GuestAuthProbeReport } from 'turbo_core';
import { probeSession } from '../ProbeSession';
import { FeaturePanel } from './FeaturePanel';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { lifelog } from '../RecordingService';

@Extend(Button)
function chipBtn() {
  .backgroundColor($r('app.color.input_bg'))
  .fontColor($r('app.color.text_primary'))
}


@Entry
@Component
struct Diagnostics {
  @State diagTab: string = '设备';

  @State showTools: boolean = false;
  @State scanStatus: string = '扫描尚未开始';
  @State scanning: boolean = false;
  @State candidates: Candidate[] = [];
  @State probeStatus: string = '未建立诊断连接';
  @State detail: string = '配对认证、唤醒与业务消息尚未接入';
  @State services: string[] = [];
  @State battery: number = -1;
  @State byteCount: number = 0;
  @State busy: boolean = false;
  @State requesting: boolean = false;
  @State codecStatus: string = '离线协议自检尚未运行';
  @State testAudioNote: string = '';
  @State codecChecks: string[] = [];
  @State deviceName: string = '';
  @State nameSource: string = '';
  @State nameStatus: string = '尚未读取标准设备名称';
  @State transportBusy: boolean = false;
  @State transportStatus: string = '通知通道尚未检查';
  @State transportDetail: string = '只协商 MTU、订阅通知，不发送认证或业务包';
  @State versionBusy: boolean = false;
  @State versionStatus: string = '版本交换尚未测试';
  @State versionDetail: string = '';
  @State authBusy: boolean = false;
  @State authStatus: string = '普通认证尚未测试';
  @State authDetail: string = '';
  @State hasVersionBaseline: boolean = false;

  aboutToAppear(): void {
    probeSession.onAuth = (report: GuestAuthProbeReport): void => {
      this.authBusy = ['connecting', 'version', 'proof', 'pairing', 'connected'].includes(report.stage);
      this.authStatus = report.stage === 'connected' ? 'BLE 认证连接保持中 · 系统已配对' : `连接状态：${report.stage}`;
      this.authDetail = `MTU ${report.mtu} · 发 ${report.txBytes} B / 收 ${report.rxBytes} B · 保持 ${report.connectedSeconds} 秒\n系统配对 ${report.bonded} · 眼镜配对通知 ${report.peerPairStatus}\n电量 ${report.battery < 0 ? '待回报' : `${report.battery}%`} · 状态回报 ${report.statusReplies}\n${report.statusQuery}\n${report.lastMessage}\n${report.reason}`;
    };
    probeSession.onVersion = (report: VersionProbeReport): void => {
      this.versionBusy = ['connecting', 'waiting-version'].includes(report.stage);
      this.hasVersionBaseline = report.stage === 'received';
      this.versionStatus = report.stage === 'received' ? '已收到眼镜版本回包 · 尚未认证' : `版本交换：${report.stage}`;
      this.versionDetail = `MTU ${report.mtu} · 发 ${report.txBytes} B / 收 ${report.rxBytes} B · ${report.reason}\n协议 ${report.protocolVersion} · 设备标识 ${report.peerIdentifierBytes} B\n${report.fields.join('  ')}`;
    };
    probeSession.onHandshake = (report: BleHandshakeReport): void => {
      this.transportBusy = !['idle', 'closed', 'failed'].includes(report.stage);
      this.transportStatus = report.stage === 'ready' ? '通知订阅已就绪 · 业务未认证' :
        report.reason === 'transport-timeout' ? '通知检查已结束 · 20 秒保护' : `通知通道：${report.stage}`;
      this.transportDetail = `MTU ${report.mtu} · 收到 ${report.rxBytes} B · 发出 ${report.txBytes} B${report.reason ? ' · ' + report.reason : ''}`;
    };
    probeSession.onDiscovery = (report: DiscoveryReport): void => {
      this.scanStatus = report.status;
      this.scanning = report.scanning;
      this.candidates = report.candidates.slice();
    };
    probeSession.onProbe = (report: ProbeReport): void => {
      this.probeStatus = report.status;
      this.detail = report.detail;
      this.services = report.services.slice();
      this.battery = report.battery;
      this.byteCount = report.receivedBytes;
      this.busy = report.busy;
      this.deviceName = report.deviceName;
      this.nameSource = report.nameSource;
      this.nameStatus = report.nameStatus;
    };
  }

  aboutToDisappear(): void {
    probeSession.onDiscovery = (_: DiscoveryReport): void => {};
    probeSession.onProbe = (_: ProbeReport): void => {};
    probeSession.onHandshake = (_: BleHandshakeReport): void => {};
    probeSession.onVersion = (_: VersionProbeReport): void => {};
    probeSession.onAuth = (_: GuestAuthProbeReport): void => {};
  }

  private async importTestAudio(): Promise<void> {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const doc = new picker.DocumentViewPicker(context);
      const picked = await doc.select({ maxSelectNumber: 1, fileSuffixFilters: ['.ogg'] });
      const uri = picked && picked.length ? picked[0] : '';
      if (!uri) { this.testAudioNote = '已取消'; return; }
      const f = fs.openSync(uri, fs.OpenMode.READ_ONLY);
      let bytes: Uint8Array;
      try {
        const size = fs.statSync(f.fd).size;
        bytes = new Uint8Array(size);
        let off = 0;
        while (off < size) {
          const chunk = new ArrayBuffer(Math.min(262144, size - off));
          const n = fs.readSync(f.fd, chunk);
          if (n <= 0) break;
          bytes.set(new Uint8Array(chunk, 0, n), off);
          off += n;
        }
      } finally { fs.closeSync(f); }
      const ended = Date.now();
      const name = lifelog.importSegment(bytes, ended - 37000, ended);
      this.testAudioNote = '已导入分段 ' + name.slice(-8) + '，到「功能 → 智记」点转写验证';
    } catch (error) {
      this.testAudioNote = '导入失败：' + (error as Error).message;
    }
  }

  private async scan(): Promise<void> {
    if (this.requesting || this.busy || this.transportBusy || this.versionBusy || this.authBusy) { return; }
    this.requesting = true;
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(
        context, ['ohos.permission.ACCESS_BLUETOOTH']);
      if (result.authResults.length !== 1 || result.authResults[0] !== 0) {
        this.scanStatus = '未授予蓝牙权限；请在系统应用权限中允许'; return;
      }
      if (!probeSession.foreground) { return; }
      probeSession.discovery.start();
    } catch (error) {
      this.scanStatus = `无法扫描 · 错误码 ${(error as BusinessError).code}`;
    } finally { this.requesting = false; }
  }

  private confirmInspect(candidate: Candidate): void {
    this.getUIContext().showAlertDialog({
      title: candidate.deviceName || (candidate.classic ? '验证 SPP 传输通道？' : '读取眼镜名称与服务？'),
      message: '仅测试你选中的候选设备。名称或广播匹配不代表已认证。请确认这是你的眼镜，且没有录音、提词或对话；连接可能影响另一台手机的连接。20 秒自动停止，不发业务指令，不解绑。',
      primaryButton: { value: '取消', action: (): void => {} },
      secondaryButton: { value: '开始本次诊断', action: (): void => { probeSession.inspect(candidate); } }
    });
  }

  private confirmNotifications(candidate: Candidate): void {
    this.getUIContext().showAlertDialog({
      title: '检查通知通道？',
      message: '仅限你的空闲测试眼镜。将建立 20 秒连接、协商 MTU 并开启私有接收通知，可能短暂影响原手机连接。不会发送认证或业务包，不配对、不解绑、不保存通知正文；订阅本身会写系统通知配置，不是完全只读。',
      primaryButton: { value: '取消', action: (): void => {} },
      secondaryButton: { value: '仅检查通知通道', action: (): void => { probeSession.inspectNotifications(candidate); } }
    });
  }

  private confirmVersion(candidate: Candidate): void {
    this.getUIContext().showAlertDialog({
      title: '发送一次版本交换？',
      message: '仅测试已选眼镜。会发送一个版本请求，读取协议标识/版本后关闭；不发认证、配对或解绑命令。可能影响另一手机连接。请确认眼镜空闲。',
      primaryButton: { value: '取消', action: (): void => {} },
      secondaryButton: { value: '发送版本请求', action: (): void => {
        this.requesting = true;
        probeSession.inspectVersion(candidate, this.getUIContext().getHostContext() as common.UIAbilityContext)
          .catch(() => { this.versionStatus = '版本请求准备失败 · 未读取或替换旧身份'; })
          .finally(() => { this.requesting = false; });
      } }
    });
  }

  private confirmAuth(candidate: Candidate): void {
    this.getUIContext().showAlertDialog({
      title: '连接并系统配对眼镜？',
      message: '确认眼镜已解除原绑定、蓝灯闪烁且没有任务。认证通过后请求鸿蒙系统蓝牙配对，保持前台连接直到你停止或退出 App。可能出现系统配对确认；不复用官方账号和密钥，业务初始化仍在验证。',
      primaryButton: {value:'取消', action:():void=>{}},
      secondaryButton: {value:'已解绑，执行认证', action:():void=>{
        this.requesting = true;
        probeSession.inspectAuth(candidate, this.getUIContext().getHostContext() as common.UIAbilityContext)
          .catch(()=>{this.authStatus='认证准备失败 · 请先读取本轮版本基线';})
          .finally(()=>{this.requesting=false;});
      }}
    });
  }

  build() {
    Scroll() {
      Column({ space: 20 }) {
        Button('返回首页').chipBtn().onClick(() => { this.getUIContext().getRouter().back(); })
        Row({ space: 8 }) {
          Text('TURBO IO').fontSize(14).fontWeight(FontWeight.Bold).fontColor($r('app.color.brand'))
          Blank()
          Text('原生鸿蒙 · VOICE 09').fontSize(11).fontColor($r('app.color.text_muted'))
        }.width('100%')
        Column({ space: 10 }) {
          Text('让眼镜，连上鸿蒙。').fontSize(28).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary'))
          Text(`API ${deviceInfo.sdkApiVersion} · 前台诊断 · 不依赖官方 App`)
            .fontSize(13).fontColor($r('app.color.text_muted'))
        }.width('100%').alignItems(HorizontalAlign.Start)
        Button(this.showTools ? '返回连接与诊断' : '打开功能工作台').width('100%')
          .backgroundColor($r('app.color.brand_deep')).onClick(()=>{this.showTools=!this.showTools;})
        if (this.showTools) {
          FeaturePanel({ tab: $diagTab })
        } else {
        Column({ space: 8 }) {
          Text('添加眼镜 · 无需登录').fontSize(20).fontColor($r('app.color.text_primary'))
          Text('1 发现眼镜 → 2 确认设备 → 3 配对认证 → 4 初始化')
            .fontSize(13).fontColor($r('app.color.text_muted')).lineHeight(22)
          Text('首次连接先在原 App 解绑并忽略蓝牙记录，再长按眼镜按钮约 5 秒进入配对模式。认证后完成系统配对，保持前台连接并读取状态；当前还不是完整业务客户端。')
            .fontSize(13).fontColor($r('app.color.text_secondary')).lineHeight(22)
        }.padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20).width('100%')
          .alignItems(HorizontalAlign.Start)

        Column({ space: 10 }) {
          Text('第一阶段 / 传输发现').fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
          Text('连接会话会验证眼镜证明、请求系统配对和读取通用状态。连接成功不代表语音、录音等业务已经可用；退出 App 将主动断开。')
            .fontSize(14).fontColor($r('app.color.text_secondary')).lineHeight(22)
          Text('不需要模型 Key；不申请麦克风或联网权限；不记录原始报文和设备地址。')
            .fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(20)
        }.padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20).width('100%')
          .alignItems(HorizontalAlign.Start)

        Column({ space: 10 }) {
          Text('协议核心 / 离线自检').fontSize(18).fontColor($r('app.color.text_primary'))
          Text('验证本机 CRC、帧、TLV、原生 SHA-256 和状态门禁。只用合成数据，不连接眼镜。')
            .fontSize(13).fontColor($r('app.color.text_secondary')).lineHeight(21)
          Button('运行离线自检').backgroundColor($r('app.color.brand_deep')).fontColor($r('app.color.brand_soft'))
            .enabled(!this.busy && !this.transportBusy && !this.versionBusy && !this.authBusy && !this.scanning && !this.requesting)
            .onClick(() => {
              const report = runProtocolSelfTest();
              this.codecStatus = `${report.passed}/${report.total} 项通过 · 不代表眼镜认证成功`;
              this.codecChecks = report.lines.slice();
            })
          Text(this.codecStatus).fontSize(13).fontColor($r('app.color.brand'))
          ForEach(this.codecChecks, (line: string) => {
            Text(line).fontSize(12).fontColor($r('app.color.text_secondary'))
          })
        }.padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20).width('100%')
          .alignItems(HorizontalAlign.Start)

        Column({ space: 10 }) {
          Text('开发调试 / 离线转写自验').fontSize(18).fontColor($r('app.color.text_primary'))
          Text('从文件选择器挑一段 OGG（60ms·240 字节帧），封装成本机智记分段；随后到「功能 → 智记」点转写，可在无眼镜环境验证 Worker 转写链路。')
            .fontSize(13).fontColor($r('app.color.text_secondary')).lineHeight(21)
          Button('导入测试音频段（OGG）').chipBtn().width('100%')
            .onClick(() => { this.importTestAudio(); })
          Text(this.testAudioNote).fontSize(13).fontColor($r('app.color.brand'))
        }.padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20).width('100%')
          .alignItems(HorizontalAlign.Start)

        Column({ space: 12 }) {
          Text(this.scanStatus).fontSize(15).fontColor($r('app.color.text_primary'))
          Button(this.scanning ? '停止扫描' : '授权并扫描眼镜 · 15 秒')
            .width('100%').height(48).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand'))
            .enabled(!this.busy && !this.transportBusy && !this.versionBusy && !this.authBusy && !this.requesting)
            .onClick(() => {
              if (this.scanning) { probeSession.discovery.stop(); }
              else { this.scan(); }
            })
          ForEach(this.candidates, (candidate: Candidate) => {
            Column({ space: 6 }) {
              Text(candidate.deviceName || candidate.label).fontColor($r('app.color.text_primary')).fontSize(18)
              Text(candidate.deviceName ? `${candidate.nameSource} · 名称不代表已认证` : '尚无名称，可读取标准设备名称')
                .fontSize(12).fontColor($r('app.color.text_muted'))
              Text(candidate.classic ? '经典蓝牙 · 已有系统配对记录 · 非业务绑定证明' :
                `RSSI ${candidate.rssi} dBm · ${candidate.serviceMatched ? 'B81D 服务匹配' : '仅名称匹配'}`)
                .fontSize(12).fontColor($r('app.color.text_muted'))
              Button(candidate.classic ? '检查 SPP 通道' : '读取名称与服务').chipBtn()
                .backgroundColor($r('app.color.brand_deep')).fontColor($r('app.color.brand_soft')).enabled(!this.busy && !this.transportBusy && !this.versionBusy && !this.authBusy && !this.requesting)
                .onClick(() => { this.confirmInspect(candidate); })
              if (!candidate.classic) {
                Button('检查通知通道 · 不认证').backgroundColor($r('app.color.card_raise')).fontColor($r('app.color.info'))
                  .enabled(!this.busy && !this.transportBusy && !this.versionBusy && !this.authBusy && !this.requesting)
                  .onClick(() => { this.confirmNotifications(candidate); })
                Button('版本交换 · 单次真机').backgroundColor($r('app.color.purple_bg')).fontColor($r('app.color.purple'))
                  .enabled(!this.busy && !this.transportBusy && !this.versionBusy && !this.authBusy && !this.requesting)
                  .onClick(() => { this.confirmVersion(candidate); })
                Button('连接眼镜 · 认证与配对').backgroundColor($r('app.color.warm_bg')).fontColor($r('app.color.warm'))
                  .enabled(this.hasVersionBaseline && !this.busy && !this.transportBusy && !this.versionBusy && !this.authBusy && !this.requesting)
                  .onClick(() => { this.confirmAuth(candidate); })
              }
            }.width('100%').padding(16).backgroundColor($r('app.color.card_bg')).borderRadius(16)
              .alignItems(HorizontalAlign.Start)
          }, (candidate: Candidate): string => `${candidate.classic}-${candidate.id}`)
          Text('没有候选时，先确认眼镜在附近并已唤亮。不要为扫描擅自重置或清理原绑定。')
            .fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(20)
        }.width('100%').alignItems(HorizontalAlign.Start)

        Column({ space: 8 }) {
          Text('握手传输 / LINK 02').fontSize(18).fontColor($r('app.color.text_primary'))
          Text(this.transportStatus).fontSize(15).fontColor($r('app.color.brand'))
          Text(this.transportDetail).fontSize(12).fontColor($r('app.color.text_secondary')).lineHeight(20)
          Text('通知检查不发送握手。版本/普通认证必须单独选择；MTU 与通知就绪不代表绑定成功。')
            .fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(20)
          Button('停止通知检查').enabled(this.transportBusy).backgroundColor($r('app.color.warm_bg')).fontColor($r('app.color.danger'))
            .onClick(() => { probeSession.stop(); })
        }.width('100%').padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20)
          .alignItems(HorizontalAlign.Start)

        Column({ space: 8 }) {
          Text('版本交换 / WIRE 03').fontSize(18).fontColor($r('app.color.text_primary'))
          Text(this.versionStatus).fontSize(15).fontColor($r('app.color.brand'))
          Text(this.versionDetail).fontSize(12).fontColor($r('app.color.text_secondary')).lineHeight(20)
          Button('停止版本交换').enabled(this.versionBusy || this.requesting).backgroundColor($r('app.color.warm_bg')).fontColor($r('app.color.danger'))
            .onClick(() => { probeSession.stop(); })
        }.width('100%').padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20).alignItems(HorizontalAlign.Start)

        Column({ space: 8 }) {
          Text('连接会话 / CONNECT 06').fontSize(18).fontColor($r('app.color.text_primary'))
          Text(this.authStatus).fontSize(15).fontColor($r('app.color.brand'))
          Text(this.authDetail).fontSize(12).fontColor($r('app.color.text_secondary')).lineHeight(20)
          Button('断开本次连接').enabled(this.authBusy || this.requesting).backgroundColor($r('app.color.warm_bg')).fontColor($r('app.color.danger'))
            .onClick(()=>{probeSession.stop();})
        }.width('100%').padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20).alignItems(HorizontalAlign.Start)

        Column({ space: 10 }) {
          Text('连接观察').fontColor($r('app.color.text_primary')).fontSize(18).fontWeight(FontWeight.Medium)
          Text(this.probeStatus).fontSize(16).fontColor($r('app.color.brand'))
          Text(this.deviceName || '设备名称尚未读出').fontSize(20).fontColor($r('app.color.text_primary'))
          Text(this.nameSource ? `${this.nameStatus} · ${this.nameSource}` : this.nameStatus)
            .fontSize(12).fontColor($r('app.color.text_muted'))
          Text(this.detail).fontSize(13).fontColor($r('app.color.text_secondary')).lineHeight(21)
          Text(`标准电量：${this.battery < 0 ? '未知' : this.battery + '%'}   接收：${this.byteCount} B`)
            .fontSize(13).fontColor($r('app.color.text_secondary'))
          ForEach(this.services, (service: string) => {
            Text(service).fontFamily('monospace').fontSize(11).fontColor($r('app.color.text_muted')).width('100%')
          })
          Button('停止本次诊断').enabled(this.busy).backgroundColor($r('app.color.warm_bg')).fontColor($r('app.color.danger'))
            .onClick(() => { probeSession.stop(); })
        }.width('100%').padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(20)
          .alignItems(HorizontalAlign.Start)
        Text('锁屏或退到后台会关闭诊断连接。已接入认证、系统配对、状态读取。功能工作台包含业务迁移测试入口；完整语音、后台待命尚未完成。')
          .fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(20).width('100%')
        }
      }.padding({ left: 24, right: 24, top: 24, bottom: 32 }).width('100%').constraintSize({ maxWidth: 720 })
    }.width('100%').height('100%').backgroundColor($r('app.color.page_bg'))
  }
}
