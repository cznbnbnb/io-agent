import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {taskStageText,taskSendStateText,taskObjectStateText}=loadApp('TaskLabels');
test('server storage, a result message, answer receipt and cancellation intent never claim task completion',()=>{
  for(const text of [taskSendStateText('server_stored'),taskStageText('user_answered'),taskStageText('agent_received'),
    taskObjectStateText({kind:'message',state:'recorded',body:{category:'result'}},Date.now()),taskObjectStateText({kind:'task',state:'cancel_requested'},Date.now())])assert.doesNotMatch(text,/已完成|已取消/);
  assert.equal(taskObjectStateText({kind:'task',state:'completed'},Date.now()),'任务已完成');
  assert.equal(taskObjectStateText({kind:'task',state:'cancelled'},Date.now()),'任务已取消');
});
test('expired local submission and queued command deadline remain distinct from confirmed runtime termination',()=>{
  const now=Date.now();assert.doesNotMatch(taskSendStateText('expired'),/任务已取消|任务已完成/);
  assert.match(taskObjectStateText({kind:'task',state:'queued',command_expires_at:new Date(now-1).toISOString()},now),/等待对账/);
  assert.match(taskObjectStateText({kind:'task',state:'execution_unknown'},now),/状态不明/);
  assert.equal(taskObjectStateText({kind:'request',state:'answered',expires_at:new Date(now-1).toISOString()},now),'已有答案');
});
