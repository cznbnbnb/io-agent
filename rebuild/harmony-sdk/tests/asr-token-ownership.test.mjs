import test from 'node:test';import assert from 'node:assert/strict';import {loadApp} from './load-app.mjs';
const {validAsrTokens,renderAsrTokens,ownsAsrToken}=loadApp('AsrTokenOwnership');
test('adjacent half-open windows assign equal-boundary tokens once, including final punctuation',()=>{
 const starts=[0,0.9,1,1,1.1,2];
 const windows=[[0,1],[1,2]].map(([a,b])=>starts.map((s,i)=>ownsAsrToken(s,a,b,2)?i:-1).filter(i=>i>=0));
 assert.deepEqual(windows,[[0,1],[2,3,4,5]]);
 assert.equal(ownsAsrToken(0.3,0.1+0.2,0.6,1),true);
 assert.equal(ownsAsrToken(NaN,0,1,1),false);
});
test('only matching, monotonic, bounded model starts are accepted; ITN text is never guessed',()=>{
 assert.equal(renderAsrTokens(['▁hello','▁world','!']),'hello world!');
 assert(validAsrTokens('hello world!',['▁hello','▁world','!'],[0,.4,.8],0,1));
 for(const [text,tokens,starts] of [['12',['一','二'],[0,.4]],['甲乙',['甲','乙'],[.4,.1]],['甲',['甲'],[2]],['甲',['甲'],[NaN]],['甲',['甲'],[]],['甲',['甲\n'],[0]],['',[],[]]])
  assert.equal(validAsrTokens(text,tokens,starts,0,1),false);
 assert.equal(validAsrTokens('甲',undefined,undefined,0,1),false);
});
