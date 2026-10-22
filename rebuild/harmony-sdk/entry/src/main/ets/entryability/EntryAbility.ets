import { UIAbility, ConfigurationConstant } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { probeSession } from '../ProbeSession';
import { ThemeMode } from '../ThemeMode';
import { appRuntime } from '../AppRuntime';
import { materialSyncService } from '../MaterialSyncService';
import { taskService } from '../TaskService';
import { localPlayback } from '../RecordingService';

export default class EntryAbility extends UIAbility {
  onCreate(): void { ThemeMode.init(this.context); appRuntime.initialize(this.context); }
  private mainWindow:window.Window|undefined=undefined;
  private updateInsets=():void=>{
    const main=this.mainWindow;if(!main)return;
    try {
      const ui=main.getUIContext();
      const top=main.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height;
      const bottom=main.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height;
      AppStorage.setOrCreate('turboTopInset',ui.px2vp(top));
      AppStorage.setOrCreate('turboBottomInset',ui.px2vp(bottom));
    }catch(_){}
  };
  private applySystemBar=():void=>{
    const main=this.mainWindow;if(!main)return;
    try {
      const dark=this.context.config.colorMode===ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      const content=dark?'#FFFFFF':'#000000';
      main.setWindowBackgroundColor(dark?'#121715':'#F5F6F2');
      main.setWindowSystemBarProperties({statusBarColor:'#00000000',navigationBarColor:'#00000000',statusBarContentColor:content,navigationBarContentColor:content});
    }catch(_){}
  };
  onConfigurationUpdate(): void { this.applySystemBar(); }
  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.getMainWindow().then(async(main:window.Window):Promise<void>=>{
      this.mainWindow=main;
      await main.setWindowLayoutFullScreen(true);
      this.applySystemBar();
      this.updateInsets();main.on('avoidAreaChange',this.updateInsets);
    }).catch((error:BusinessError)=>{hilog.warn(0,'TurboIO','Immersive setup code=%{public}d',error.code);});
    try {
      windowStage.loadContent('pages/Index', (error: BusinessError): void => {
        if (error.code) { hilog.error(0, 'TurboIO', 'Page load failed, code=%{public}d', error.code); }
      });
    } catch (error) {
      hilog.error(0, 'TurboIO', 'Window unavailable, code=%{public}d', (error as BusinessError).code);
    }
  }

  onForeground(): void { probeSession.resume(this.context); localPlayback.setForeground(true); materialSyncService.setForeground(true); taskService.setForeground(true); }

  onBackground(): void {
    localPlayback.setForeground(false);
    materialSyncService.setForeground(false);
    taskService.setForeground(false);
    probeSession.suspend();
  }

  onDestroy(): void {
    localPlayback.setForeground(false);
    if(this.mainWindow){try{this.mainWindow.off('avoidAreaChange',this.updateInsets);}catch(_){}this.mainWindow=undefined;}
    probeSession.foreground = false;
    probeSession.stop();
    appRuntime.dispose();
  }
}
