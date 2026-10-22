import { TaskObject } from './TaskWire';
export function taskStageText(stage:string):string {
  if(stage==='server_stored')return '服务器已存储';
  if(stage==='phone_received')return '手机已收到';
  if(stage==='glasses_displayed')return '眼镜已显示';
  if(stage==='user_answered')return '用户已回答';
  if(stage==='agent_received')return 'Agent 已接收';
  if(stage==='task_resumed')return '原任务已继续';
  if(stage==='task_completed')return '任务已完成';
  if(stage==='cancel_requested')return '已请求取消';
  if(stage==='cancelled')return '已取消';
  if(stage==='expired')return '已过期';
  return '处理失败';
}
export function taskSendStateText(state:string):string {
  if(state==='queued')return '本机已保存，等待发送';
  if(state==='awaiting_refresh')return '答案草稿已保存，等待核对原问题';
  if(state==='sending')return '发送中';
  if(['reconcile','retry_wait'].includes(state))return '等待查账或重试';
  if(state==='server_stored')return '服务器已存储';
  if(state==='withdrawn_local')return '已从本机撤回，未发送';
  if(state==='expired')return '本次投递已过期';
  return '投递受阻';
}
export function taskObjectStateText(item:TaskObject,now:number):string {
  if(item.kind==='message')return '消息已收到';
  if(item.kind==='request'){
    if(item.state==='answered')return '已有答案';if(item.state==='withdrawn')return '问题已撤回';
    if(item.state==='expired'||Date.parse(item.expires_at)<=now)return '问题已过期';return '等待回答';
  }
  if(item.state==='queued')return item.command_expires_at&&Date.parse(item.command_expires_at)<=now?'委托期限已到，等待对账':'服务器已收到，等待电脑';
  if(item.state==='agent_received')return 'Agent 已接收';if(item.state==='running')return '执行中';
  if(item.state==='waiting_answer')return '任务等待回答';if(item.state==='cancel_requested')return '已请求取消，等待确认';
  if(item.state==='cancelled')return '任务已取消';if(item.state==='completed')return '任务已完成';
  if(item.state==='execution_unknown')return '执行状态不明，需要对账';if(item.state==='expired')return '任务已过期';return '任务失败';
}
export function taskErrorText(code:string):string {
  if(code.startsWith('TASK_VOICE_SOURCE')||code==='TASK_SOURCE_LEGACY')return '口述来源未确认或已变化，原文保留；请核对全文或发送记录';
  if(code==='TASK_GLASS_COPY_TOO_LONG')return '原问题或动作超出已验证的眼镜显示范围，请在手机完整回答';
  if(code==='TASK_REVIEW_CHANGED')return '完整草稿、原问题或显示条件已变化；请重新核对，未新增答案';
  if(['TASK_DECISION_PENDING_WRITE','TASK_DECISION_WRITER_STALE'].includes(code))return '草稿保存中断或已被其他操作更新；原记录已保留，请先检查';
  if(code==='TASK_DECISION_UID_LIMIT')return '本轮卡片尝试已达上限；完整草稿保留，请在手机核对提交';
  if(code==='TASK_GLASS_BUSY')return '眼镜未连接或有采集/显示/清理任务，请先处理占用';
  if(['TASK_GLASS_PEER_CHANGED','TASK_DECISION_CARD_BUSY'].includes(code))return '请连接原眼镜，先移除上轮卡片；草稿保留';
  if(code==='TASK_DECISION_MAPPING_REQUIRED')return '两项选择请先指定采用项；其他问题在手机完整回答';
  if(['TASK_DECISION_UNAVAILABLE','TASK_DECISION_RESUME_INVALID','TASK_DECISION_ALREADY_EXISTS'].includes(code))return '请先处理原草稿，恢复时重新核对原问题；已有内容保留';
  if(['TASK_PROFILE_CHANGED','TASK_SETTINGS_BUSY','TASK_NETWORK_BUSY'].includes(code))return '配置或网络操作正在切换，请稍后重试';
  if(['AUTH_REQUIRED','UNAUTHENTICATED'].includes(code))return '令牌已失效，请更新任务配置';
  if(['FORBIDDEN','TASK_ANSWER_FORBIDDEN','TASK_CANCEL_FORBIDDEN'].includes(code))return '当前身份缺少所需任务权限';
  if(['TASK_IDENTITY_MISMATCH','TASK_IDENTITY_CHANGED','ROUTE_MISMATCH','TASK_ROUTE_MISMATCH'].includes(code))return '身份或会话不匹配，内容未继续发送';
  if(['STALE_REQUEST','TASK_REFRESH_REQUIRED','REVISION_CONFLICT','TASK_REVISION_CONFLICT','TASK_REPLY_BINDING_STALE'].includes(code))return '问题或任务已更新，请刷新后重新确认';
  if(code==='ANSWER_ALREADY_ACCEPTED')return '另一个终端已先回答，请查看实际答案';
  if(code==='TASK_OPERATION_CONFLICT')return '这份答案已保存，不能覆盖原内容；请查看本机发送记录';
  if(['TASK_CLOSED','TASK_REQUEST_CLOSED','TASK_CANCEL_UNAVAILABLE','REQUEST_CLOSED'].includes(code))return '问题或任务已关闭，内容保留';
  if(code==='TASK_WITHDRAW_UNCERTAIN')return '曾尝试发送，需查账并请求取消，不能仅从本机撤回';
  if(['EXPIRED','TASK_DEADLINE_INVALID'].includes(code))return '期限已到或不合法，不会自动续期';
  if(['TASK_STORE_FULL','TASK_STORE_TOO_LARGE'].includes(code))return '本机任务记录已达容量上限，已有内容保留';
  if(['TASK_STORE_CORRUPT','TASK_WRITER_STALE','TASK_PERSIST_FAILED','TASK_NEEDS_ATTENTION','TASK_CONFIGURATION_FAILED'].includes(code))return '本机任务记录需要检查，已有内容保留';
  if(['TASK_IDENTITY_UNAVAILABLE','TASK_UNAVAILABLE','TRANSPORT_UNKNOWN','UNAVAILABLE'].includes(code))return '网络暂不可用，保留积压并等待重试';
  if(['REQUEST_NOT_FOUND','TASK_NOT_FOUND'].includes(code))return '原问题或任务不存在，内容保留';
  if(['TASK_OPTION_INVALID','INVALID_OPTIONS','TASK_COMMAND_INVALID','TASK_REPLY_BINDING_INVALID','TASK_REPLY_SOURCE_INVALID'].includes(code))return '请检查输入内容和当前选项';
  return '暂未完成，请刷新或查账';
}
