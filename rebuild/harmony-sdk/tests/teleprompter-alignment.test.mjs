import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {TeleprompterAlignment}=loadApp('TeleprompterAlignment');
test('follow coordinates preserve original UTF-8 across punctuation, line breaks, and emoji',()=>{
 const text='😀今天测试雷鸟眼镜。\n下面检查朗读跟随能否继续工作。';const a=new TeleprompterAlignment(text);
 const one=a.match('今天测试雷鸟眼镜',true);assert(one);assert.equal(one.highLightOffset,new TextEncoder().encode('😀今天测试雷鸟眼镜').length);
 const two=a.match('下面检查朗读跟随能否继续工作',true);assert(two);assert(two.highLightOffset>one.highLightOffset);assert(a.boundary(two.pageOffset));assert(a.boundary(two.highLightOffset));assert(two.pageOffset<=two.highLightOffset);
 assert(!a.boundary(1));assert(!a.boundary(5));assert(!a.boundary(NaN));
});
test('unrelated speech, tiny phrases, duplicates and ambiguous repeated passages do not advance',()=>{
 const a=new TeleprompterAlignment('今天检查眼镜录音清楚。然后继续校对明天会议材料。');assert.equal(a.match('好的',true),undefined);assert.equal(a.match('今天晚上去吃火锅唱歌',true),undefined);
 const p=a.match('今天检查眼镜录音清楚',true);assert(p);assert.equal(a.match('今天检查眼镜录音清楚',true),undefined);
 const repeat=new TeleprompterAlignment('现在开始检查会议材料。现在开始检查会议材料。');assert.equal(repeat.match('现在开始检查会议材料',true),undefined);
});
test('bounded fuzzy match tolerates a small recognition omission, while manual reanchor permits deliberate rereading',()=>{
 const a=new TeleprompterAlignment('今天需要完整检查录音保存和字幕内容。然后准备明天的会议资料。');const p=a.match('今天需要完整检查录音保存字幕内容',true);assert(p);assert(p.confidence>=0.8);
 assert.equal(a.match('今天需要完整检查录音保存字幕内容',true),undefined);a.reanchor(0);assert(a.match('今天需要完整检查录音保存字幕内容',true));
});
