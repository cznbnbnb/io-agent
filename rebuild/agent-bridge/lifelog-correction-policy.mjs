// CLI-owned guidance, kept outside all user/source text. Shared by every entry.
export const CORRECTION_CUE='Before correcting lifelog text, read correction_guidance in daily/help. Preserve the source diary voice and perspective; put edit explanations in reason/evidence.';
export const CORRECTION_GUIDANCE=Object.freeze({
  format:'cz-iot-cli/lifelog-correction-guidance/1',
  content_role:'cli_guidance',
  default:'订正事实并保留原有文风；只有用户明确要求时才更换文体。事实准确优先于文风相似。',
  rules:Object.freeze([
    '每日总结和分段智记：先阅读原有正文，保持原来的日记口吻、叙述视角（如“你”）、时态、时间顺序和自然段节奏。不要改成工作报告、要点清单、审计说明或写给读者的解释。',
    '默认做最小必要修改。错字、型号、数量、时间和人物归属按证据修正；正确内容和自然衔接应保留。重大事实错误确需重组时可以重写相关段落，但仍写成同一天的日记。',
    '保留日期、标题和既有章节，除非它们本身有事实错误。不要添加“（订正版）”“订正说明”“已剔除”“经核对 speaker”等编辑痕迹；修改原因、依据和删改范围写在 reason/evidence，不放入 edits[].text。',
    '区分本人参与、本人主导和旁人讨论。不能把旁人的发言归为本人安排；也不能仅凭 speaker=others 或没有本人发言，就断言本人未参与或批量删除现场背景。依据原文上下文和外部证据判断，不能确认时不新增归属结论。',
    '不要为了模仿原文补造情绪、心理活动、评价、引语、因果或成果；也不要为保持篇幅而保留已证伪的事实。',
    '逐字转写：保持说话人和原话结构，只做有依据的识别与归属订正，不把转写改成日记、摘要或润色文章。后续事实或不确定补充使用 daily-note，不改写历史原话。',
    'summary_stale 时先取得 daily-history 中的原总结，再结合当前有效转写修正，并提交最新 dependencies_version；恢复可查询不等于需要换标题、换口吻或加说明段。',
    '提交前检查：事实修改均有证据；正文保留原文体且不夹编辑说明。提交后用 daily 回读对应 material_id，核对有效正文和订正版本，再报告实际生效。409 冲突必须重读合并。'
  ])
});
