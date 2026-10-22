import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(`${process.env.DEVECO_HOME || '/Applications/DevEco-Studio.app/Contents'}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript`);
const source = fs.readFileSync(new URL('../entry/src/main/ets/entryability/SuggestionLabAbility.ets', import.meta.url), 'utf8');
test('lab lifecycle routes explicit diagnostic recording and suggestion results but blocks assistant execution', async () => {
  const calls = [], probe = { background: {}, voice: {}, resume: async context => { calls.push(['resume', context]); }, suspend: () => calls.push('suspend'), stop: () => calls.push('stop') };
  const suggestion = { initialize: dir => calls.push(['init', dir]), receive: (...args) => calls.push(['rx', ...args]), disconnected: () => calls.push('disconnect') };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(name) {
    if (name === '@kit.AbilityKit') return { UIAbility: class {} };
    if (name === '../BackgroundLabSession') return { backgroundLab: { observeAuth: () => {}, resume: () => {}, stop: () => {} } };
    if (name === '../RecordingLabSession') return { recordingLab: { initialize:()=>{}, recorder:{receive:()=>{},active:false,busy:false},disconnected:()=>{},dispose:()=>{} } };
    if (name === '../ProbeSession') return { probeSession: probe };
    if (name === '../NotificationService') return { suggestionTests: suggestion };
    throw Error(`Forbidden lab dependency: ${name}`);
  } });
  const ability = new module.exports.default(); ability.context = { filesDir: '/synthetic' };
  ability.onCreate(); assert.equal(probe.background.targetAbility, 'SuggestionLabAbility'); assert.equal(probe.voice.canBegin(), false);
  probe.onNotification('synthetic-peer', Uint8Array.of(1)); assert.equal(calls.at(-1)[0], 'rx');
  ability.onWindowStageCreate({ loadContent: page => calls.push(['page', page]) });
  assert.equal(calls.at(-1)[1], 'pages/SuggestionLab');
  ability.onForeground(); await Promise.resolve(); assert.equal(calls.at(-1)[0], 'resume');
  ability.onBackground(); ability.onDestroy(); assert.equal(probe.foreground, false); assert.equal(calls.at(-1), 'stop');
});
test('experiment page and module keep ordinary recording runtime out of lab entry', () => {
  const base = new URL('../entry/src/main/', import.meta.url);
  const queue = ['ets/entryability/SuggestionLabAbility.ets', 'ets/pages/SuggestionLab.ets'], seen = new Set();
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    const text = fs.readFileSync(new URL(file, base), 'utf8');
    for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const child = new URL(match[1] + '.ets', new URL(file, base));
      assert(!/\/(RecordingService|AppRuntime|ConnectedServices)\.ets$/.test(child.pathname), `Unsafe dependency ${child.pathname}`);
      queue.push(decodeURIComponent(child.href.slice(base.href.length)));
    }
  }
  const manifest = JSON.parse(fs.readFileSync(new URL('module.json5', base), 'utf8'));
  const lab = manifest.module.abilities.find(a => a.name === 'SuggestionLabAbility');
  assert(lab); assert(!lab.skills); assert.equal(manifest.module.mainElement, 'EntryAbility');
});
