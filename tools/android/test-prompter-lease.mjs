// JVM checks for PrompterLease (task prompter sessions released after power-off or show expiry).
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),root=path.join(workspace,'rebuild/android-app'),out=path.join(root,'build/prompter-lease-tests');fs.mkdirSync(out,{recursive:true});
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:workspace,encoding:'utf8',timeout:90000});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error||r.status!==0)throw Error('Prompter lease check failed: '+cmd);return r.stdout;}
run('javac',['-encoding','UTF-8','-d',out,path.join(root,'src/com/turboio/addon/PrompterLease.java'),path.join(workspace,'tools/android/PrompterLeaseTest.java')]);
if(!/prompter lease: \d+ assertions passed/.test(run('java',['-cp',out,'com.turboio.addon.PrompterLeaseTest'])))throw Error('Missing test result');
