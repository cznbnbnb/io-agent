import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Read retained observations only. Never drives the phone or publishes archive
// bodies, arbitrary UI text, credentials, or other users' manuscript titles.
const root=process.cwd(),priv=path.join(root,'rebuild/phase1/device-private'),dir=path.join(priv,'manuscript067-evidence');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const evidence=file=>read(path.join(dir,file));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const textSha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const build=read(path.join(root,'rebuild/phase1/manuscript067-build-2026-10-14.json'));
const installed=evidence('install-ledger.json'),current=evidence('current-version-and-retention.json');
assert.equal(installed.version_code,10067);assert.equal(current.version_code,10067);
assert.equal(sha(path.join(root,build.signed_hap)),build.signed_hap_sha256);assert.equal(installed.hap_sha256,build.signed_hap_sha256);
const manifestPath=path.join(root,`rebuild/phase1/candidate-runs/${build.run_id}/source-hashes.json`),manifest=read(manifestPath);
assert.equal(sha(manifestPath),build.source_manifest_sha256);assert.equal(manifest.length,build.source_files);
for(const m of manifest)assert.equal(sha(path.join(root,'rebuild',m.path)),m.sha256.toLowerCase());
assert(Object.values(current.retained_bytes_unchanged).every(v=>v===true));
const baseline=evidence('workspace-before-install.json'),afterInstall=evidence('workspace-after-install.json');
assert.deepEqual(afterInstall,baseline);assert.equal(sha(path.join(dir,'workspace-before-install.xml')),sha(path.join(dir,'workspace-after-install.xml')));
const created=evidence('workspace-created.json'),edited=evidence('workspace-edited.json'),cold=evidence('workspace-edited-after-cold-settled.json');
const owned=created.entries.filter(e=>e.title==='20261014067'&&e.text==='06720261014');assert.equal(owned.length,1);const id=owned[0].id;
const updated=edited.entries.find(e=>e.id===id);assert(updated);assert.equal(updated.title,'2026101406702');assert.equal(updated.text,'0672026101402');
assert.equal(owned[0].revision,1);assert.equal(updated.revision,2);assert.equal(updated.created,owned[0].created);assert(updated.modified>=owned[0].modified);
assert.deepEqual(cold,edited);
function originalsUnchanged(store){assert.deepEqual(store.todos,baseline.todos);assert.deepEqual(store.entries.filter(e=>e.id!==id),baseline.entries);}
for(const store of [created,edited,cold])originalsUnchanged(store);
const cancelled=evidence('workspace-delete-cancel-settled.json');assert.deepEqual(cancelled,edited);
assert.equal(sha(path.join(dir,'workspace-delete-cancel-before.xml')),sha(path.join(dir,'workspace-delete-cancel-settled.xml')));
const deleted=evidence('workspace-delete-confirm-after.json'),deletedCold=evidence('workspace-deleted-after-cold.json');
assert.deepEqual(deleted,baseline);assert.deepEqual(deletedCold,baseline);assert(!deleted.entries.some(e=>e.id===id));
const coldEdit=evidence('edited-cold-ledger.json'),cancel=evidence('delete-cancel-ledger.json'),confirm=evidence('delete-confirm-ledger.json'),coldDelete=evidence('deleted-cold-ledger.json');
const fresh=evidence('deleted-fresh-idle-ledger.json'),preflight=evidence('deleted-cold-preflight.json');
assert(fresh.recording_idle&&fresh.lifelog_idle&&fresh.asr_idle&&!fresh.process_stopped);
assert.equal(fresh.pid,preflight.pid_before);assert.equal(fresh.pid,coldDelete.pid_before);
assert(Date.parse(preflight.at)-Date.parse(fresh.recording_observed_at)>=0&&Date.parse(preflight.at)-Date.parse(fresh.recording_observed_at)<=30000);
assert.notEqual(coldEdit.pid_before,coldEdit.pid_after);assert.equal(coldDelete.pid_before,coldEdit.pid_after);assert.equal(coldDelete.pid_after,current.pid);
assert.notEqual(coldDelete.pid_before,coldDelete.pid_after);
assert(coldEdit.saved_revision_read_back&&coldEdit.ordinary_modify_button_and_scroll_verified&&coldEdit.selected_revision_heading_verified);
assert(cancel.dialog_exact&&cancel.store_bytes_unchanged&&cancel.draft_preserved&&cancel.note_verified);
assert(confirm.dialog_exact&&confirm.owned_fixture_absent&&confirm.draft_preserved&&confirm.note_verified);
assert(coldDelete.deleted_fixture_absent&&coldDelete.workspace_bytes_unchanged);
function ownUi(file){const nodes=[];function collect(n){nodes.push(n.attributes);for(const c of n.children||[])collect(c);}collect(read(path.join(priv,file)));return nodes;}
function exactEditor(file,title,text){const nodes=ownUi(file);for(const [type,value] of [['TextInput',title],['TextArea',text]])assert.equal(nodes.filter(a=>a.type===type&&a.visible==='true'&&a.text===value&&a.enabled==='true').length,1);return true;}
exactEditor('manuscript067-saved-exact.json','20261014067','06720261014');
exactEditor('manuscript067-edited-exact.json','2026101406702','0672026101402');
exactEditor('manuscript067-cold-selected-editor-settled.json','2026101406702','0672026101402');
exactEditor('manuscript067-delete-cancel-editor-settled.json','2026101406702','0672026101402');
exactEditor('manuscript067-delete-confirm-editor.json','2026101406702','0672026101402');
const testLog=fs.readFileSync(path.join(root,'rebuild/phase1/manuscript067-full-app.log'),'utf8');
assert.match(testLog,/# pass 880\r?\n# fail 0\r?\n/);
const result={date:'2026-10-14',version:'0.1.67',synthetic:true,
 build:{run_id:build.run_id,hap_sha256:build.signed_hap_sha256,source_manifest_sha256:build.source_manifest_sha256,source_files_unchanged:manifest.length},
 installation:installed,current,
 fixture:{id,created_revision:1,edited_revision:2,original_created_time_preserved:true,original_body_sha256:textSha(owned[0].text),edited_body_sha256:textSha(updated.text),deleted_after_test:true},
 archive:{overlay_install_bytes_unchanged:true,unrelated_entries_and_todos_unchanged_at_every_stage:true,cancel_delete_bytes_unchanged:true,original_json_restored_after_delete:fs.readFileSync(path.join(dir,'workspace-before-install.json'),'utf8')===fs.readFileSync(path.join(dir,'workspace-deleted-after-cold.json'),'utf8'),original_entry_count:baseline.entries.length,original_todo_count:baseline.todos.length},
 native:{cold_edited:coldEdit,cancel_delete:cancel,confirm_delete:confirm,deleted_live_idle_preflight:fresh,cold_deleted:coldDelete},
 verification:{host_app_tests:880,native_create_and_same_id_revision_edit:true,native_cold_edited_row_and_modify_button:true,native_cancel_delete:true,native_owned_delete_and_draft_retention:true,native_deleted_row_absent_after_cold:true,native_import_valid_file:false,native_import_cancel:false,native_busy_or_stale_storage_faults:false,lens_verified:false,base08_complete:false},
 limitations:['The test edits and deletes only a numeric synthetic manuscript through the ordinary Library UI.','Storage failure, stale revision, busy save, and late picker/remount cases use explicit host platform substitutes.','The editing revision heading and exact loaded fields were observed; the separate selection status note disappeared and remains an open UI feedback issue.','No native valid-file import, EPUB import, lens observation, or official BASE-08 acceptance is claimed.'],
 retained_observation_failures:['Initial input command omitted HDC coordinate arguments and stopped before typing; the corrected command rechecked blank fields.','Cold selection status-note checks failed twice; revision heading and exact loaded draft were independently retained, without repeating the cold restart.','The native dialog uses Text action nodes; the first Button selector stopped with the dialog still open. It was purpose-checked again before cancel.','The save-modification button was outside the visible area after cancel; it was observed after scrolling, with no repeated dialog or store write.','The app header was missing during a journal preflight snapshot. Cold restart was not performed and a new live preflight was read.','Automatic approval rejected a proposed restart relying on an earlier idle snapshot. Live recording, lifelog, and ASR idle evidence was then reacquired before the approved restart.','The private script initially reparsed an already-converted UTC DateTime and rejected fresh evidence as expired. No restart occurred; DateTimeOffset comparison and a new live preflight resolved it.']};
const output=path.join(root,'rebuild/phase1/manuscript067-native-device-2026-10-14.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify({output,verification:result.verification,archive:result.archive})+'\n');
