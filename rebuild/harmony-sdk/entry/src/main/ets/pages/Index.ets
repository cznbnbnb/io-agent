import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { Candidate, DiscoveryReport } from 'turbo_core';
import { probeSession } from '../ProbeSession';
import { ThemeMode } from '../ThemeMode';
import { connectedServices } from '../ConnectedServices';
import { FeatureInfo, dailyFeatures, displayFeatures } from '../FeatureCatalog';
import { FeaturePanel } from './FeaturePanel';
import { LibraryPanel } from './LibraryPanel';

@Entry
@Component
struct Index {
  @StorageLink('turboTopInset') topInset: number = 0;
  @StorageLink('turboBottomInset') bottomInset: number = 0;
  @State wide: boolean = false;
  @State page: string = '首页';
  @State feature: string = '模型';
  @State detail: boolean = false;
  @State pairing: boolean = false;
  @State phase: string = 'idle';
  @State note: string = '';
  @State battery: number = -1;
  @State saved: boolean = false;
  @State firmwareHeld: boolean = false;
  @State autoConnect: boolean = true;
  @State backgroundOn: boolean = false;
  @State backgroundBusy: boolean = false;
  @State backgroundNote: string = '';
  @State name: string = 'RayNeo iO';
  @State scanning: boolean = false;
  @State requesting: boolean = false;
  @State scanNote: string = '允许蓝牙后，查找附近的眼镜';
  @State candidates: Candidate[] = [];
  @State themeLabel: string = '跟随';
  private scroller: Scroller = new Scroller();
  private readonly tabs: string[] = ['首页', '功能', '资料', '设置'];
  private readonly featureTabs: string[] = ['模型', '电脑任务', '智记', '导航', '录音', '待办', '提词器', '天气', '卡片', '通知', '设备'];

  aboutToAppear(): void {
    probeSession.onConnection = (): void => this.refresh();
    probeSession.onDiscovery = (report: DiscoveryReport): void => {
      this.scanning = report.scanning; this.scanNote = report.status;
      this.candidates = report.candidates.filter((item: Candidate): boolean => !item.classic);
    };
    this.themeLabel = ThemeMode.label(); this.refresh();
  }
  aboutToDisappear(): void {
    probeSession.onConnection = (): void => {};
    probeSession.onDiscovery = (_: DiscoveryReport): void => {};
    probeSession.discovery.stop();
  }
  onBackPress(): boolean {
    if (this.pairing) { this.pairing = false; probeSession.discovery.stop(); return true; }
    if (this.detail) { this.detail = false; this.scroller.scrollEdge(Edge.Top); return true; }
    if (this.page !== '首页') { this.switchPage('首页'); return true; }
    return false;
  }
  private refresh(): void {
    connectedServices.connectionChanged();
    const value = probeSession.connection;
    this.phase = value.phase; this.note = value.note; this.battery = value.battery;
    this.saved = value.saved; this.autoConnect = value.autoConnect; this.name = value.name;
    this.firmwareHeld = probeSession.firmwareOccupied;
    this.backgroundOn = probeSession.background.active; this.backgroundBusy = probeSession.background.pending;
    this.backgroundNote = probeSession.background.note;
  }
  private connecting(): boolean { return ['connecting', 'authenticating', 'initializing', 'retrying', 'scanning'].includes(this.phase); }
  private phaseLabel(): string {
    if (this.phase === 'ready') return '已连接';
    if (this.phase === 'permission') return '等待蓝牙授权';
    if (this.phase === 'authenticating') return '正在认证';
    if (this.phase === 'initializing') return '正在读取状态';
    if (this.phase === 'retrying') return '正在重连';
    if (this.phase === 'scanning') return '正在扫描恢复';
    if (this.phase === 'connecting') return '正在连接';
    if (this.phase === 'failed') return '连接未完成';
    return '未连接';
  }
  private featureTitle(): string { return this.feature === '模型' ? 'AI 助手' : this.feature === '设备' ? '眼镜设置' : this.feature === '卡片' ? '文字卡片' : this.feature === '通知' ? '文字通知' : this.feature; }
  private title(): string { return this.pairing ? '连接眼镜' : this.detail ? this.featureTitle() : this.page === '首页' ? '你的随身空间' : this.page; }
  private switchPage(page: string): void {
    probeSession.discovery.stop(); this.page = page; this.pairing = false; this.detail = false;
    this.scroller.scrollEdge(Edge.Top);
  }
  private openFeature(target: string): void {
    probeSession.discovery.stop(); this.feature = target; this.page = '功能'; this.detail = true; this.pairing = false;
    this.scroller.scrollEdge(Edge.Top);
  }
  private async permission(): Promise<boolean> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.ACCESS_BLUETOOTH']);
    return result.authResults.length === 1 && result.authResults[0] === 0;
  }
  private async permissionAndScan(): Promise<void> {
    if (this.requesting || this.connecting() || this.phase === 'ready') return;
    this.requesting = true;
    try {
      if (!await this.permission()) { this.scanNote = '蓝牙权限未允许，可在系统权限设置中开启'; return; }
      if (probeSession.foreground && this.pairing) probeSession.discovery.start();
    } catch (_) { this.scanNote = '无法开始扫描，请检查手机蓝牙'; }
    finally { this.requesting = false; }
  }
  private async primaryAction(): Promise<void> {
    if (this.connecting() || this.requesting) return;
    if (this.phase === 'ready') { this.openFeature('模型'); return; }
    if (!this.saved) { this.pairing = true; this.scroller.scrollEdge(Edge.Top); return; }
    this.requesting = true;
    try {
      if (!await this.permission()) { this.note = '请在系统权限设置中允许蓝牙'; return; }
      await probeSession.reconnect(this.getUIContext().getHostContext() as common.UIAbilityContext);
    } catch (_) { this.note = '暂时无法连接，请检查手机蓝牙'; }
    finally { this.requesting = false; }
  }
  private choose(candidate: Candidate): void {
    if (this.connecting()) return;
    this.getUIContext().showAlertDialog({
      title: this.saved ? '核对并恢复原眼镜' : '连接这副眼镜',
      message: this.saved ? '将核对原眼镜身份，认证与状态回读成功后才更新连接地址；身份不符时保留原记录。无需再次解绑或清资料。' : '请核对附近眼镜并使其处于可连接状态。系统出现配对提示时，请确认。',
      primaryButton: { value: '取消', action: (): void => {} },
      secondaryButton: { value: '连接', action: (): void => {
        const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
        const connecting = this.saved ? probeSession.recoverSavedAddress(candidate, context) : probeSession.connect(candidate, context);
        connecting.catch((): void => { this.scanNote = '连接未完成，请重试'; });
      } }
    });
  }

  @Builder
  statusBadge() {
    Row({ space: 6 }) {
      Circle().width(6).height(6).fill(this.phase === 'ready' ? $r('app.color.brand') : $r('app.color.text_muted'))
      Text(this.phaseLabel()).fontSize(12).fontColor(this.phase === 'ready' ? $r('app.color.brand') : $r('app.color.text_secondary'))
    }.padding({ left: 12, right: 12, top: 7, bottom: 7 }).backgroundColor($r('app.color.input_bg')).borderRadius(20)
  }
  @Builder
  header() {
    Row({ space: 12 }) {
      if (this.detail || this.pairing) {
        Button({ type: ButtonType.Circle }) { Text('‹').fontSize(28).fontColor($r('app.color.text_primary')) }
          .width(44).height(44).backgroundColor($r('app.color.card_bg')).accessibilityText('返回').onClick((): void => { this.onBackPress(); })
      }
      Column({ space: 5 }) {
        Text('TURBO IO').fontSize(10).letterSpacing(2).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_muted'))
        Text(this.title()).fontSize(this.wide ? 30 : 26).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary')).maxLines(1)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      this.statusBadge()
    }.width('100%').padding({ left: 24, right: 24, top: 18, bottom: 18 })
  }
  @Builder
  deviceCard() {
    Column({ space: 0 }) {
      Row() {
        Text('我的眼镜').fontSize(12).fontColor($r('app.color.text_secondary'))
        Blank()
        Button('眼镜设置  ›').fontSize(12).fontColor($r('app.color.brand')).backgroundColor(Color.Transparent).height(36).onClick((): void => this.openFeature('设备'))
      }.width('100%').padding({ left: 6 })
      Image($r('app.media.rayneo_home_hero')).width('100%').height(this.wide ? 208 : 164).objectFit(ImageFit.Contain).accessibilityText('雷鸟 iO 眼镜')
      Row() {
        Column({ space: 5 }) {
          Text(this.name).fontSize(23).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary'))
          Text(this.phase === 'ready' ? '已准备好，选择一项功能开始' : this.saved ? '已记住这副眼镜' : '连接眼镜，开始随身体验').fontSize(13).fontColor($r('app.color.text_secondary')).maxLines(2)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Column({ space: 4 }) {
          Text(this.phase === 'ready' && this.battery >= 0 ? this.battery + '%' : '—').fontSize(26).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary'))
          Text('眼镜电量').fontSize(11).fontColor($r('app.color.text_muted'))
        }
      }.width('100%').margin({ bottom: 22 })
      Button(this.firmwareHeld ? '升级结果待核对' : this.phase === 'ready' ? '打开 AI 助手  ↗' : this.connecting() ? '正在连接…' : this.saved ? '重新连接' : '连接我的眼镜')
        .width('100%').height(50).fontSize(16).fontWeight(FontWeight.Medium).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand'))
        .borderRadius(16).enabled(!this.firmwareHeld && !this.connecting() && !this.requesting).onClick((): void => { this.primaryAction(); })
      if (this.firmwareHeld) {
        Text('固件传输结果待核对，普通连接已暂停。恢复检查不会自动重新升级。').fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(19).width('100%').margin({ top: 12 })
        // Connection-only recovery: the firmware journal stays untouched and
        // no OTA prepare/start path is enabled by this one-shot scan.
        Button('扫描恢复连接（不重传）').width('100%').height(44).fontColor($r('app.color.brand')).backgroundColor(Color.Transparent)
          .onClick((): void => {
            probeSession.firmwareReconnectAllowed = true;
            this.pairing = true; this.scroller.scrollEdge(Edge.Top); this.permissionAndScan();
          })
      }
      if (this.note) { Text(this.note).fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(19).width('100%').margin({ top: 12 }) }
      if (this.saved && this.phase === 'failed' && !probeSession.firmwareOccupied) {
        Button('扫描恢复').width('100%').height(44).fontColor($r('app.color.brand')).backgroundColor(Color.Transparent)
          .onClick((): void => { this.pairing = true; this.scroller.scrollEdge(Edge.Top); this.permissionAndScan(); })
      }
      if (this.connecting()) { Button('取消连接').fontSize(13).fontColor($r('app.color.text_secondary')).backgroundColor(Color.Transparent).onClick((): void => probeSession.stop()) }
    }.width('100%').padding(22).backgroundColor($r('app.color.card_bg')).border({ width: 0.5, color: $r('app.color.border') }).borderRadius(28)
  }
  @Builder
  featureTile(item: FeatureInfo) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 0 }) {
        Image(item.icon).width(24).height(24).fillColor($r('app.color.brand')).margin({ bottom: 16 })
        Text(item.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.text_primary')).margin({ bottom: 6 })
        Text(item.description).fontSize(12).fontColor($r('app.color.text_secondary')).lineHeight(18).maxLines(2)
      }.alignItems(HorizontalAlign.Start).width('100%').padding(20)
    }.width('100%').height(148).backgroundColor($r('app.color.card_bg')).border({ width: 0.5, color: $r('app.color.border') }).borderRadius(22)
      .onClick((): void => this.openFeature(item.target)).accessibilityText(item.title)
  }
  @Builder
  featureGrid(items: FeatureInfo[], columns: number) {
    GridRow({ columns: columns, gutter: { x: 12, y: 12 } }) {
      ForEach(items, (item: FeatureInfo) => { GridCol() { this.featureTile(item) } }, (item: FeatureInfo): string => item.target)
    }.width('100%')
  }
  @Builder
  sectionTitle(title: string, subtitle: string) {
    Column({ space: 6 }) {
      Text(title).fontSize(20).fontWeight(FontWeight.Bold).fontColor($r('app.color.text_primary'))
      if (subtitle) { Text(subtitle).fontSize(13).fontColor($r('app.color.text_muted')).lineHeight(20) }
    }.alignItems(HorizontalAlign.Start).width('100%')
  }
  @Builder
  quickFunctions() {
    Column({ space: 16 }) {
      this.sectionTitle('现在想做什么', '把手机放下，让眼镜陪你完成。')
      this.featureGrid(dailyFeatures, 2)
      Button('回看资料与稿件  ›').width('100%').height(52).fontColor($r('app.color.brand')).backgroundColor($r('app.color.brand_deep')).borderRadius(18)
        .onClick((): void => this.switchPage('资料'))
    }.width('100%')
  }
  @Builder
  home() {
    if (this.wide) {
      Row({ space: 24 }) { Column() { this.deviceCard() }.layoutWeight(5); Column() { this.quickFunctions() }.layoutWeight(7) }
        .width('100%').alignItems(VerticalAlign.Top)
    } else { Column({ space: 28 }) { this.deviceCard(); this.quickFunctions() }.width('100%') }
  }
  @Builder
  catalog() {
    Column({ space: 18 }) {
      this.sectionTitle('随身工具', '选一项功能，开始使用。')
      this.featureGrid(dailyFeatures, this.wide ? 3 : 2)
      Column({ space: 16 }) { this.sectionTitle('眼前的信息', '天气、提醒，还有你想看到的文字。'); this.featureGrid(displayFeatures, this.wide ? 3 : 2) }.margin({ top: 10 })
    }.width('100%')
  }
  @Builder
  featureSwitcher() {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(this.featureTabs, (target: string) => {
          Button(target === '模型' ? 'AI 助手' : target).height(36).fontSize(13)
            .fontColor(this.feature === target ? $r('app.color.on_brand') : $r('app.color.text_secondary'))
            .backgroundColor(this.feature === target ? $r('app.color.brand') : $r('app.color.card_bg')).borderRadius(18)
            .onClick((): void => { this.feature = target; this.scroller.scrollEdge(Edge.Top); })
        }, (target: string): string => target)
      }.padding({ left: 24, right: 24 })
    }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%').height(48)
  }
  @Builder
  wizard() {
    Column({ space: 20 }) {
      this.sectionTitle('让它找到你', '打开手机蓝牙，将眼镜放在附近。首次连接时，长按眼镜按钮至蓝灯闪烁。')
      Text(this.scanNote).fontSize(14).fontColor($r('app.color.text_secondary')).lineHeight(22)
      if (this.phase !== 'ready') {
        Button(this.scanning ? '停止查找' : '查找我的眼镜').width('100%').height(50).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand'))
          .enabled(!this.requesting && !this.connecting()).onClick((): void => { if (this.scanning) probeSession.discovery.stop(); else this.permissionAndScan(); })
        if (this.scanning && this.candidates.length === 0) {
          Row({ space: 12 }) { LoadingProgress().width(24).height(24); Text('正在查找附近的眼镜…').fontSize(14).fontColor($r('app.color.text_muted')) }.padding(24)
        }
        ForEach(this.candidates, (candidate: Candidate) => {
          Column({ space: 12 }) {
            Text(candidate.deviceName || candidate.label).fontSize(20).fontColor($r('app.color.text_primary'))
            Text(candidate.serviceMatched ? '已识别眼镜服务' : '请核对设备名称').fontSize(13).fontColor($r('app.color.text_muted'))
            Button('连接').width('100%').height(44).backgroundColor($r('app.color.brand')).fontColor($r('app.color.on_brand'))
              .enabled(!this.connecting()).onClick((): void => this.choose(candidate))
          }.width('100%').padding(22).backgroundColor($r('app.color.card_bg')).borderRadius(24)
        }, (candidate: Candidate): string => candidate.id)
      }
      Text(this.note).fontSize(14).fontColor($r('app.color.text_secondary')).lineHeight(22)
      if (this.connecting()) { Button('取消连接').onClick((): void => probeSession.stop()) }
      if (this.phase === 'ready') { Button('完成').width('100%').onClick((): void => { this.pairing = false; }) }
      Text(this.saved ? '扫描后选择眼镜可核对身份并恢复连接，不会自动替换成另一副眼镜。' : '请先核对眼镜名称与连接状态；系统配对提示出现后再确认。').fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(21)
    }.width('100%').constraintSize({ maxWidth: 600 }).alignItems(HorizontalAlign.Start)
  }
  @Builder
  settingsRow(title: string, description: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Column({ space: 5 }) { Text(title).fontSize(16).fontColor($r('app.color.text_primary')); Text(description).fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(18) }
          .alignItems(HorizontalAlign.Start).layoutWeight(1)
        Text('›').fontSize(24).fontColor($r('app.color.text_muted'))
      }.padding(20).width('100%')
    }.width('100%').backgroundColor($r('app.color.card_bg')).borderRadius(18).onClick(action)
  }
  @Builder
  settings() {
    Column({ space: 14 }) {
      this.sectionTitle('连接与偏好', '')
      Row({ space: 14 }) {
        Column({ space: 5 }) { Text('自动连接').fontSize(16).fontColor($r('app.color.text_primary')); Text('打开应用时，连接已记住的眼镜').fontSize(12).fontColor($r('app.color.text_muted')) }
          .alignItems(HorizontalAlign.Start).layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.autoConnect }).selectedColor($r('app.color.brand')).onChange((value: boolean): void => { probeSession.setAutoConnect(value); })
      }.width('100%').padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(18)
      Row({ space: 14 }) {
        Column({ space: 5 }) { Text('后台连接').fontSize(16).fontColor($r('app.color.text_primary')); Text(this.backgroundNote).fontSize(12).fontColor($r('app.color.text_muted')).lineHeight(18) }
          .alignItems(HorizontalAlign.Start).layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.backgroundOn }).selectedColor($r('app.color.brand')).enabled(!this.backgroundBusy && this.phase === 'ready')
          .onChange((value: boolean): void => { if (!probeSession.background.pending && value !== probeSession.background.active) probeSession.setBackground(value); })
      }.width('100%').padding(20).backgroundColor($r('app.color.card_bg')).borderRadius(18)
      this.settingsRow('眼镜设置', '亮度、唤醒、显示与隐私', (): void => this.openFeature('设备'))
      this.settingsRow('语音与模型', '配置识别服务和 AI 助手', (): void => this.openFeature('模型'))
      this.settingsRow('外观', this.themeLabel === '跟随' ? '跟随系统' : this.themeLabel, (): void => { ThemeMode.cycle(this.getUIContext().getHostContext() as common.UIAbilityContext); this.themeLabel = ThemeMode.label(); })
      this.settingsRow('连接向导', '查找眼镜，完成连接', (): void => { this.switchPage('首页'); this.pairing = true; })
      this.settingsRow('连接诊断', '查看连接过程与错误信息', (): void => { this.getUIContext().getRouter().pushUrl({ url: 'pages/Diagnostics' }); })
      Button('断开连接').width('100%').height(48).fontColor($r('app.color.danger')).backgroundColor($r('app.color.danger_bg')).borderRadius(16)
        .enabled(this.phase === 'ready' || this.connecting()).onClick((): void => probeSession.stop())
      Text('断开后可从首页手动重新连接。').fontSize(12).fontColor($r('app.color.text_muted'))
    }.width('100%').constraintSize({ maxWidth: 640 }).alignItems(HorizontalAlign.Start)
  }
  private tabIcon(tab: string): Resource {
    return tab === '首页' ? $r('app.media.ic_tab_glasses') : tab === '功能' ? $r('app.media.ic_tab_grid') : tab === '资料' ? $r('app.media.ic_library') : $r('app.media.ic_tab_gear');
  }
  build() {
    Column() {
      this.header()
      if (this.detail && !this.wide && !this.pairing) { this.featureSwitcher() }
      Scroll(this.scroller) {
        Column() {
          if (this.pairing) { this.wizard() }
          else if (this.page === '首页') { this.home() }
          else if (this.page === '功能' && this.detail) { FeaturePanel({ tab: $feature, wide: this.wide }) }
          else if (this.page === '功能') { this.catalog() }
          else if (this.page === '资料') { LibraryPanel({ category: '资料',onManuscriptEditorRequest:():void=>this.scroller.scrollEdge(Edge.Top) }) }
          else { this.settings() }
        }.width('100%').constraintSize({ maxWidth: 1160 }).padding({ left: this.wide ? 32 : 24, right: this.wide ? 32 : 24, top: 8, bottom: 28 })
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      Row() {
        ForEach(this.tabs, (tab: string) => {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 5 }) {
              Image(this.tabIcon(tab)).width(22).height(22).fillColor(this.page === tab ? $r('app.color.brand') : $r('app.color.text_muted'))
              Text(tab).fontSize(11).fontColor(this.page === tab ? $r('app.color.brand') : $r('app.color.text_muted'))
            }.width('100%').height(60).justifyContent(FlexAlign.Center)
          }.layoutWeight(1).backgroundColor(Color.Transparent).borderRadius(14).accessibilityText(tab + (this.page === tab ? '，当前页面' : ''))
            .onClick((): void => this.switchPage(tab))
        }, (tab: string): string => tab)
      }.width('100%').padding({ left: this.wide ? 100 : 8, right: this.wide ? 100 : 8, top: 6, bottom: this.bottomInset + 6 })
        .backgroundColor($r('app.color.card_bg')).border({ width: { top: 0.5 }, color: $r('app.color.border') })
    }.width('100%').height('100%').padding({ top: this.topInset }).backgroundColor($r('app.color.page_bg'))
      .onAreaChange((_before: Area, after: Area): void => { const width = Number(after.width); if (width > 0) this.wide = width >= 720; })
  }
}
