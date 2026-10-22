// 主题模式：跟随系统 / 浅色 / 深色，应用内切换并持久化到 filesDir/theme-mode.json。
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';

export class ThemeMode {
  private static file: string = '';
  private static mode: number = -1;   // -1 跟随系统，0 深色，1 浅色

  private static read(): number {
    try { return JSON.parse(fs.readTextSync(ThemeMode.file) as string).mode as number; } catch (_) { return -1; }
  }

  // 启动时调用：读持久化并套用到应用。
  static init(context: common.UIAbilityContext): void {
    ThemeMode.file = context.filesDir + '/theme-mode.json';
    ThemeMode.mode = ThemeMode.read();
    ThemeMode.apply(context, ThemeMode.mode);
  }

  static current(): number { return ThemeMode.mode; }

  static label(): string { return ThemeMode.mode === 0 ? '深色' : ThemeMode.mode === 1 ? '浅色' : '跟随'; }

  // 循环：跟随系统 → 浅色 → 深色 → 跟随系统。
  static cycle(context: common.UIAbilityContext): number {
    ThemeMode.mode = ThemeMode.mode === -1 ? 1 : ThemeMode.mode === 1 ? 0 : -1;
    ThemeMode.apply(context, ThemeMode.mode);
    try {
      const f = fs.openSync(ThemeMode.file, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      try { fs.writeSync(f.fd, JSON.stringify({ mode: ThemeMode.mode })); fs.fsyncSync(f.fd); } finally { fs.closeSync(f); }
    } catch (_) {}
    return ThemeMode.mode;
  }

  private static apply(context: common.UIAbilityContext, mode: number): void {
    try {
      const app = context.getApplicationContext();
      app.setColorMode(mode === 0 ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
        : mode === 1 ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT
        : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (_) {}
  }
}
