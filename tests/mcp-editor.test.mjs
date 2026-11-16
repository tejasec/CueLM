import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMcpWindowGate, registerMcpEditor } from '../src/lib/utils/mcp-editor.ts';
import { beginNoteNavigation, isCurrentNoteNavigation, cancelNoteNavigation } from '../src/lib/utils/note-navigation.ts';
const id='a'.repeat(32), other='b'.repeat(32), finish={id,vaultPath:'/vault',path:'/vault/note.md'};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

test('clean editors freeze before acknowledging and reload before navigation/input resume',async()=>{
  const calls=[], token=beginNoteNavigation();
  const gate=createMcpWindowGate({ready:()=>true,busy:value=>calls.push(['busy',value]),reply:async(id,accepted)=>{assert.equal(isCurrentNoteNavigation(token),false);calls.push(['reply',accepted]);},acquire:async()=>{calls.push(['acquire']);return async()=>{assert.equal(isCurrentNoteNavigation(token),false);calls.push(['reload']);};}});
  await gate.prepare(id);assert.deepEqual(calls,[['busy',true],['acquire'],['reply',true]]);
  await gate.finish(finish);assert.deepEqual(calls.slice(-2),[['reload'],['busy',false]]);assert.equal(isCurrentNoteNavigation(token),true);
});
test('dirty/busy editors refuse without leaving the window frozen',async()=>{
  const calls=[];const gate=createMcpWindowGate({ready:()=>true,busy:value=>calls.push(value),reply:async(id,accepted)=>calls.push(accepted),acquire:async()=>null});
  await gate.prepare(id);assert.deepEqual(calls,[true,false,false]);assert.equal(gate.requestId,null);
});
test('overlapping requests and stale finish events cannot release the current editor',async()=>{
  let released=0;const replies=[];
  const gate=createMcpWindowGate({ready:()=>true,busy:()=>{},reply:async(id,accepted)=>replies.push([id,accepted]),acquire:async()=>async()=>{released++;}});
  await gate.prepare(id);await gate.prepare(other);await gate.finish({...finish,id:other});assert.equal(released,0);assert.equal(gate.requestId,id);
  assert.deepEqual(replies,[[id,true],[other,false]]);await gate.finish(finish);assert.equal(released,1);
});
test('a native timeout during acquisition releases a late gate without a late acceptance',async()=>{
  const wait=deferred(), replies=[];let released=0;
  const gate=createMcpWindowGate({ready:()=>true,busy:()=>{},reply:async(id,accepted)=>replies.push(accepted),acquire:()=>wait.promise});
  const pending=gate.prepare(id);await gate.finish(finish);wait.resolve(async()=>{released++;});await pending;
  assert.deepEqual(replies,[]);assert.equal(released,1);assert.equal(gate.requestId,null);
});
test('disposing a window during acquisition does not leave an editor lease behind',async()=>{
  const wait=deferred();let released=0;
  const gate=createMcpWindowGate({ready:()=>true,busy:()=>{},reply:async()=>{},acquire:()=>wait.promise});
  const pending=gate.prepare(id);await gate.dispose();wait.resolve(async()=>{released++;});await pending;assert.equal(released,1);
});
test('duplicate finish messages wait for one reload and release only once',async()=>{
  const wait=deferred();let count=0;const busy=[];
  const gate=createMcpWindowGate({ready:()=>true,busy:value=>busy.push(value),reply:async()=>{},acquire:async()=>async()=>{count++;await wait.promise;}});
  await gate.prepare(id);const first=gate.finish(finish),second=gate.finish(finish);assert.equal(count,1);assert.deepEqual(busy,[true]);wait.resolve();await Promise.all([first,second]);assert.deepEqual(busy,[true,false]);
});
test('startup windows reject edits and invalid request IDs are ignored',async()=>{
  let acquires=0;const replies=[];
  const gate=createMcpWindowGate({ready:()=>false,busy:()=>{},reply:async(id,accepted)=>replies.push(accepted),acquire:async()=>{acquires++;return null;}});
  await gate.prepare('not-a-native-id');await gate.prepare(id);assert.equal(acquires,0);assert.deepEqual(replies,[false]);
});
test('editor registration is owner-safe and retired navigation stays cancelled after a freeze',async()=>{
  let first=0,second=0;const removeFirst=registerMcpEditor(async()=>{first++;return async()=>{};});const removeSecond=registerMcpEditor(async()=>{second++;return async()=>{};});removeFirst();
  const gate=createMcpWindowGate({ready:()=>true,busy:()=>{},reply:async()=>{}});const token=beginNoteNavigation();await gate.prepare(id);cancelNoteNavigation(token);await gate.finish(finish);removeSecond();
  assert.equal(first,0);assert.equal(second,1);assert.equal(isCurrentNoteNavigation(token),false);
});
test('dirty/IME preflight refuses before any inert/input-blocking transition',async()=>{
  const changes=[],replies=[];let acquired=false;const token=beginNoteNavigation();
  const remove=registerMcpEditor(async()=>{acquired=true;return async()=>{};},()=>false);
  const gate=createMcpWindowGate({ready:()=>true,busy:value=>changes.push(value),reply:async(id,accepted)=>replies.push(accepted)});
  await gate.prepare(id);remove();assert.equal(acquired,false);assert.deepEqual(changes,[]);assert.deepEqual(replies,[false]);assert.equal(isCurrentNoteNavigation(token),true);
});

test('production wiring guards dirty/IME edits, preserves presentation, and uses authoritative finish recovery',async()=>{
  const editor=await readFile(new URL('../src/lib/components/Editor.svelte',import.meta.url),'utf8');
  assert.match(editor,/\$editorDirty \|\| externalOperationBusy \|\| source\.view\?\.compositionStarted \|\| source\.view\?\.composing \|\| editor\?\.view\.composing/);
  assert.match(editor,/loadNote\(path, content\.content, undefined, true\)/);
  assert.match(editor,/isMobile \? \(\) => \{\} : registerMcpEditor/);
  const client=await readFile(new URL('../src/lib/mcp.ts',import.meta.url),'utf8');assert.match(client,/mcp_request_state/);
  assert.match(client,/if \(isMobile\) return \(\) => \{\};/);
  const native=await readFile(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');assert.match(native,/#\[cfg\(desktop\)\]\s*pub mod mcp;/);
  for(const command of ['mcp_status','mcp_set_access','mcp_client_config','mcp_editor_ready','mcp_request_state','mcp_active_request'])assert.match(native,new RegExp('#\\[cfg\\(desktop\\)\\]\\s*mcp::'+command));
  const page=await readFile(new URL('../src/routes/+page.svelte',import.meta.url),'utf8');assert.match(page,/inert=\{\$mcpBusy\}/);
});
