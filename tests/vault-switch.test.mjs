import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { activeVaultIdentity, createVaultSwitch, mergeVaultActivation, sameVault, vaultEventMatches, vaultDisplayName, vaultIdentity, vaultIdentityKey } from '../src/lib/utils/vault-switch.ts';
import { openVault, restoreExternalVault } from '../src/lib/api.ts';

const a = { path: '/notes/Work', name: 'Work' }, b = { path: '/archive/Work', name: 'Work' };
const config = vault => ({ active_vault: vault.path, active_bookmark_id: vault.bookmark_id ?? null, vaults: [a,b], language: 'en', theme: 'dark' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
function fixture(overrides = {}) {
  let current = config(a), draft = 'Unsaved 日本語 😀', frozen = false;
  const calls = [];
  const hooks = {
    current: () => activeVaultIdentity(current),
    busy: value => calls.push(['busy', value]),
    acquire: async () => { calls.push(['save', draft]); frozen = true; return () => { calls.push(['release']); frozen = false; }; },
    open: async (target, expected) => { calls.push(['open',target,expected]); assert.equal(frozen,true); return config(target); },
    commit: async next => { calls.push(['commit']); assert.equal(frozen,true); current = next; },
    manage: async () => { calls.push(['manage']); assert.equal(frozen,true); },
    ...overrides,
  };
  return { switcher: createVaultSwitch(hooks), hooks, calls, get current(){ return current; }, set current(value){ current=value; }, get draft(){ return draft; }, get frozen(){ return frozen; } };
}

test('switch saves and freezes before opening, then commits before releasing', async () => {
  const f = fixture();
  assert.equal(await f.switcher.switchTo(b), 'done');
  assert.deepEqual(f.calls.map(call=>call[0]), ['busy','save','open','commit','release','busy']);
  assert.deepEqual(f.calls[2][2], {path:a.path,bookmarkId:null});
  assert.equal(f.current.active_vault,b.path); assert.equal(f.frozen,false);
});

test('failed save blocks native activation without discarding the draft', async () => {
  const f = fixture({acquire:async()=>null});
  assert.equal(await f.switcher.switchTo(b),'blocked');
  assert.equal(f.current.active_vault,a.path); assert.equal(f.draft,'Unsaved 日本語 😀');
  assert.deepEqual(f.calls,[['busy',true],['busy',false]]);
});

test('failed native activation keeps old configuration and draft, releases editing, and allows retry', async () => {
  let fail = true;
  const f = fixture({open:async()=>{if(fail)throw Error('disk unavailable');return config(b);}});
  await assert.rejects(f.switcher.switchTo(b), /disk unavailable/);
  assert.equal(f.current.active_vault,a.path); assert.equal(f.draft,'Unsaved 日本語 😀'); assert.equal(f.frozen,false);
  fail=false; assert.equal(await f.switcher.switchTo(b),'done');
});

test('only one switch can wait for native activation at a time', async () => {
  const wait = deferred(), entered = deferred();
  const f = fixture({open:async()=>{entered.resolve();return wait.promise;}});
  const first = f.switcher.switchTo(b); await entered.promise;
  assert.equal(await f.switcher.switchTo(a),'busy'); assert.equal(await f.switcher.manage(),'busy');
  assert.equal(f.current.active_vault,a.path); assert.equal(f.frozen,true);
  wait.resolve(config(b)); assert.equal(await first,'done'); assert.equal(f.frozen,false);
});

test('choosing the active vault is a no-op even if its note is dirty', async () => {
  const f=fixture(); assert.equal(await f.switcher.switchTo(a),'done');
  assert.deepEqual(f.calls.map(call=>call[0]),['busy','busy']); assert.equal(f.draft,'Unsaved 日本語 😀');
});

test('cancelling Add does not save or activate anything', async () => {
  const f=fixture(); assert.equal(await f.switcher.add(async()=>null),'cancelled');
  assert.deepEqual(f.calls,[['busy',true],['busy',false]]); assert.equal(f.current.active_vault,a.path);
});

test('Add marks its selected folder as explicit initialization, not a saved-vault switch', async () => {
  const f=fixture(); const next={path:'/new/folder',bookmarkId:null,existing:false};
  assert.equal(await f.switcher.add(async()=>next),'done');
  assert.deepEqual(f.calls.find(call=>call[0]==='open')[1],next);
});

test('origin changes during a picker or save invalidate the transition', async () => {
  const f=fixture();
  assert.equal(await f.switcher.add(async()=>{f.current=config(b);return {path:'/new',bookmarkId:null,existing:false};}),'stale');
  assert.ok(!f.calls.some(call=>call[0]==='save'));
  let releases=0;
  const g=fixture({acquire:async()=>{g.current=config(b);return ()=>releases++;}});
  assert.equal(await g.switcher.switchTo(b),'stale'); assert.equal(releases,1);
  assert.ok(!g.calls.some(call=>call[0]==='open'));
});

test('the editor stays frozen until asynchronous UI teardown completes', async () => {
  const entered=deferred(), teardown=deferred();
  const f=fixture({commit:async()=>{entered.resolve();await teardown.promise;}});
  const pending=f.switcher.switchTo(b); await entered.promise;
  assert.equal(f.frozen,true); assert.ok(!f.calls.some(call=>call[0]==='release'));
  teardown.resolve(); await pending; assert.equal(f.frozen,false);
});

test('Manage uses the same save gate but does not open a vault', async () => {
  const f=fixture(); assert.equal(await f.switcher.manage(),'done');
  assert.deepEqual(f.calls.map(call=>call[0]),['busy','save','manage','release','busy']);
  const g=fixture({acquire:async()=>null}); assert.equal(await g.switcher.manage(),'blocked');
  assert.ok(!g.calls.some(call=>call[0]==='manage'));
});

test('picker and save exceptions leave the transition retryable', async () => {
  const f=fixture(); await assert.rejects(f.switcher.add(async()=>{throw Error('picker error');}), /picker error/);
  assert.equal(await f.switcher.switchTo(b),'done');
  const g=fixture({acquire:async()=>{throw Error('save error');}});
  await assert.rejects(g.switcher.switchTo(b), /save error/);
  assert.deepEqual(g.calls,[['busy',true],['busy',false]]);
});

test('vault identity distinguishes duplicate names, paths, bookmarks and delimiter characters', () => {
  assert.equal(sameVault(vaultIdentity(a),vaultIdentity(b)),false);
  assert.equal(sameVault({path:'/old',bookmarkId:'book'},{path:'/resolved',bookmarkId:'book'}),true);
  assert.equal(sameVault({path:'/same',bookmarkId:'one'},{path:'/same',bookmarkId:'two'}),false);
  assert.equal(sameVault({path:'/same',bookmarkId:null},{path:'/same',bookmarkId:'book'}),false);
  assert.notEqual(vaultIdentityKey({path:'a|b',bookmarkId:'c'}),vaultIdentityKey({path:'a',bookmarkId:'b|c'}));
  assert.equal(vaultDisplayName({path:'C:\\Notes\\Work\\',name:''}),'Work');
  assert.equal(vaultDisplayName({path:'/',name:''}),'/');
});

test('late sync events cannot mark a different path or bookmark as running or complete', () => {
  const active={path:'/vault/Work',bookmarkId:'book-b'};
  assert.equal(vaultEventMatches({vault_path:'/vault/Work',bookmark_id:'book-a'},active),false);
  assert.equal(vaultEventMatches({vault_path:'/vault/Work'},active),false);
  assert.equal(vaultEventMatches({vault_path:'/other/Work',bookmark_id:'book-b'},active),false);
  assert.equal(vaultEventMatches({vault_path:'/vault/Work/',bookmark_id:'book-b'},active),true);
  assert.equal(vaultEventMatches({vault_path:'C:\\Vault\\Work'}, {path:'C:/Vault/Work',bookmarkId:null}),true);
  assert.equal(vaultEventMatches({},active),false);
});

test('activation publication preserves live language/theme preferences and newer per-vault timestamps', () => {
  const old={...config(a),language:'ru',theme:'custom',vaults:[{...a,last_sync_time:'2026-11-14T12:00:00Z'},b]};
  const next={...config(b),vaults:[{...a,last_sync_time:'2026-11-13T12:00:00Z'},b,{path:'/new',name:'New'}]};
  const merged=mergeVaultActivation(old,next);
  assert.equal(merged.active_vault,b.path); assert.equal(merged.language,'ru'); assert.equal(merged.theme,'custom');
  assert.equal(merged.vaults[0].last_sync_time,old.vaults[0].last_sync_time);
  assert.equal(merged.vaults.length,3); assert.equal(old.vaults.length,2);
});

test('activation API uses one atomic response and passes expected identity and existing-folder intent', async () => {
  const before=globalThis.window, calls=[], snapshot=config(b), expected={path:a.path,bookmarkId:null};
  globalThis.window={__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push({command,args});return snapshot;}}};
  try {
    assert.equal(await openVault(b.path,{existing:true,expected}),snapshot);
    assert.equal(await restoreExternalVault('bookmark',expected),snapshot);
    assert.deepEqual(calls,[
      {command:'open_vault',args:{path:b.path,requireExisting:true,expected}},
      {command:'restore_external_vault',args:{bookmarkId:'bookmark',expected}},
    ]);
  } finally { if(before===undefined)delete globalThis.window;else globalThis.window=before; }
});

test('application integration keys vault layouts, freezes interaction, and guards disposed editor releases', async () => {
  const page=await readFile(new URL('../src/routes/+page.svelte',import.meta.url),'utf8');
  assert.match(page,/\{#key JSON\.stringify\(\[\$appConfig\?\.active_vault \?\? null, \$appConfig\?\.active_bookmark_id \?\? null\]\)\}/);
  const layout=await readFile(new URL('../src/lib/components/AppLayout.svelte',import.meta.url),'utf8');
  assert.match(layout,/inert=\{vaultSwitchBusy\}/);
  assert.match(layout,/await editor\.beginPathMutation\(\)/);
  assert.match(layout,/if \(vaultSwitchBusy\) \{ e\.preventDefault\(\); return; \}/);
  const editor=await readFile(new URL('../src/lib/components/Editor.svelte',import.meta.url),'utf8');
  assert.match(editor,/if \(released \|\| editorDisposed\) return;/);
});
