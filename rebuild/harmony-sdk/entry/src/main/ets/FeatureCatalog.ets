export interface FeatureInfo {
  target: string;
  title: string;
  description: string;
  icon: Resource;
  hint: string;
}

export const dailyFeatures: FeatureInfo[] = [
  { target: '模型', title: 'AI 助手', description: '抬头提问，让回答随行', icon: $r('app.media.ic_model'), hint: '需配置服务' },
  { target: '电脑任务', title: '电脑任务', description: '文字委托，回答原任务的问题', icon: $r('app.media.ic_model'), hint: '接入验证中' },
  { target: '智记', title: '智记', description: '记录灵感，整理一天的片段', icon: $r('app.media.ic_record'), hint: '' },
  { target: '导航', title: '出行导航', description: '将下一步指引送到眼前', icon: $r('app.media.ic_nav'), hint: '需配置服务' },
  { target: '录音', title: '录音', description: '保存声音，按需转成文字', icon: $r('app.media.ic_record'), hint: '' },
  { target: '待办', title: '待办清单', description: '把要做的事带在身边', icon: $r('app.media.ic_todo'), hint: '' },
  { target: '提词器', title: '提词器', description: '准备好稿件，从容表达', icon: $r('app.media.ic_prompter'), hint: '' }
];

export const displayFeatures: FeatureInfo[] = [
  { target: '天气', title: '天气', description: '查看天气，同步到眼镜', icon: $r('app.media.ic_weather'), hint: '需配置服务' },
  { target: '卡片', title: '文字卡片', description: '在眼镜首页留一句提醒', icon: $r('app.media.ic_card'), hint: '' },
  { target: '通知', title: '文字通知', description: '向眼镜发送一条文字', icon: $r('app.media.ic_bell'), hint: '手动发送' }
];
