// Actual child-process failure after a synthetic local effect. No Agent/tools.
import fs from 'node:fs';
import {BridgeState} from '../../state.mjs';
import {BridgeRunLock} from '../../run-lock.mjs';
const [filename,marker]=process.argv.slice(2),state=BridgeState.load(filename);
const lease=BridgeRunLock.acquire({stateFile:filename,identity:state.value.binding});lease.assertHeld();
await state.dispatch('item:task:task-1:1',()=>{
  const fd=fs.openSync(marker,'wx',0o600);
  fs.writeFileSync(fd,'1');fs.fsyncSync(fd);fs.closeSync(fd);
  process.exit(73);
});
