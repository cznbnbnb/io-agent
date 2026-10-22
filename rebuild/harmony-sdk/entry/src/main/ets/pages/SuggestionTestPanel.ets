import { suggestionTests } from '../NotificationService';

@Component
export struct SuggestionTestPanel {
  @State note: string = '';
  @State busy: boolean = false;
  @State active: boolean = false;
  @State observed: boolean = false;
  @State titleText: string = '建议卡实验';
  @State bodyText: string = '只记录选择，不创建待办';
  @State evidence: string = '';
  private visible: boolean = false;
  aboutToAppear(): void { this.visible = true; suggestionTests.changed = (): void => this.refresh(); this.refresh(); }
  aboutToDisappear(): void { this.visible = false; suggestionTests.changed = (): void => {}; }
  private refresh(): void {
    if (!this.visible) return;
    this.note = suggestionTests.note; this.busy = suggestionTests.busy;
    this.active = suggestionTests.active; this.observed = suggestionTests.phase === 'observed';
    this.evidence = suggestionTests.events.slice(-8).join('\n');
  }
  private run(work: () => Promise<void>): void { work().catch((error: Error): void => { this.refresh(); this.note = error.message; }); }
  build() {
    Column({ space: 12 }) {
      Text('原厂建议卡 · 隔离实验').fontSize(17).fontColor($r('app.color.text_primary')).width('100%')
      Text('仅记录选择，不创建待办。当前眼镜静止约5秒收起，旋转后重新计时；60秒是App清理期限，不代表镜片停留时长。').fontSize(13).fontColor($r('app.color.warm'))
      TextInput({ text: this.titleText, placeholder: '实验标题' }).maxLength(16).onChange((v: string): void => { this.titleText = v; })
      TextArea({ text: this.bodyText, placeholder: '实验正文' }).maxLength(48).height(80).onChange((v: string): void => { this.bodyText = v; })
      Button('下发一张实验卡').enabled(!this.busy && !this.active).onClick((): void => this.run(() => suggestionTests.start(this.titleText, this.bodyText)))
      Row({ space: 8 }) {
        Button('回执 0 成功').enabled(!this.busy && this.observed).onClick((): void => this.run(() => suggestionTests.acknowledge(0)))
        Button('回执 3 失败').enabled(!this.busy && this.observed).onClick((): void => this.run(() => suggestionTests.acknowledge(3)))
      }
      Button('移除实验卡 / 重试清理').enabled(!this.busy && this.active).onClick((): void => this.run(() => suggestionTests.remove()))
      Text(this.note).fontSize(13).fontColor($r('app.color.text_secondary')).width('100%')
      Text(this.evidence).fontSize(10).fontColor($r('app.color.text_muted')).copyOption(CopyOptions.LocalDevice).width('100%')
    }.padding(18).width('100%').backgroundColor($r('app.color.row_bg')).borderRadius(20)
  }
}
