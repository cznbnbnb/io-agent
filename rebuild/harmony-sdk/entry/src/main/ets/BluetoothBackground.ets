import { common, wantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { BusinessError } from '@kit.BasicServicesKit';

// One native Bluetooth task per app. No fake audio, wake lock, or background mic.
export class BluetoothBackground {
  targetAbility: string = 'EntryAbility';
  active: boolean = false;
  pending: boolean = false;
  note: string = '后台保持未开启';
  changed: () => void = (): void => {};
  revoked: () => void = (): void => {};
  private generation: number = 0;
  private context: common.Context | undefined = undefined;
  private chain: Promise<void> = Promise.resolve();
  private listening: boolean = false;
  private cancelled = (_: backgroundTaskManager.ContinuousTaskCancelInfo): void => this.lost('系统已结束后台任务');
  private suspended = (_: backgroundTaskManager.ContinuousTaskSuspendInfo): void => this.lost('系统已暂停后台任务');

  private lost(note: string): void {
    if (!this.active && !this.pending) return;
    this.stop(note); this.revoked();
  }
  private unlisten(): void {
    if (!this.listening) return;
    try { backgroundTaskManager.off('continuousTaskCancel', this.cancelled); } catch (_) {}
    try { backgroundTaskManager.off('continuousTaskSuspend', this.suspended); } catch (_) {}
    this.listening = false;
  }
  start(context: common.Context): Promise<void> {
    if (this.active || this.pending) return this.chain;
    // Bind the notification to the requesting Ability even if another Ability
    // in this process previously selected a different lab/default target.
    const abilityName = (context as common.UIAbilityContext).abilityInfo?.name || this.targetAbility;
    if (abilityName !== 'EntryAbility' && abilityName !== 'SuggestionLabAbility' && abilityName !== 'DailyLabAbility') return Promise.reject(new Error('background-target-invalid'));
    this.context = context; const token = ++this.generation;
    this.pending = true; this.note = '正在申请蓝牙后台任务…'; this.changed();
    this.chain = this.chain.catch((): void => {}).then(async (): Promise<void> => {
      if (token !== this.generation) return;
      let requested = false;
      try {
        this.listening = true;
        backgroundTaskManager.on('continuousTaskCancel', this.cancelled);
        backgroundTaskManager.on('continuousTaskSuspend', this.suspended);
        const agent = await wantAgent.getWantAgent({
          wants: [{ bundleName: 'org.turboio.harmony.research', abilityName: abilityName }],
          operationType: wantAgent.OperationType.START_ABILITY,
          requestCode: 11, wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
        });
        if (token !== this.generation) return;
        requested = true;
        await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.BLUETOOTH_INTERACTION, agent);
        if (token !== this.generation) {
          await backgroundTaskManager.stopBackgroundRunning(context); return;
        }
        this.active = true; this.note = '系统已授予蓝牙后台任务 · 锁屏表现待实测';
      } catch (error) {
        if (requested) { try { await backgroundTaskManager.stopBackgroundRunning(context); } catch (_) {} }
        if (token === this.generation) {
          this.active = false;
          this.note = '后台任务未获准 · 错误码 ' + ((error as BusinessError).code || 0);
        }
      } finally {
        if (token === this.generation) this.pending = false;
        if (!this.active) this.unlisten();
        this.changed();
      }
    });
    return this.chain;
  }
  stop(note: string = '后台保持已关闭'): Promise<void> {
    const needsStop = this.active || this.pending;
    const token = ++this.generation; this.active = false; this.pending = false; this.note = note;
    this.unlisten(); this.changed(); const context = this.context;
    this.chain = this.chain.catch((): void => {}).then(async (): Promise<void> => {
      if (!context || !needsStop) return;
      try { await backgroundTaskManager.stopBackgroundRunning(context); }
      catch (error) {
        if (token === this.generation) {
          this.note = '后台保持已禁用；系统任务释放未确认 · 错误码 ' + ((error as BusinessError).code || 0);
          this.changed();
        }
      }
    });
    return this.chain;
  }
}
