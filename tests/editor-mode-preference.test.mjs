import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get } from 'svelte/store';
import { newNoteEditorMode, selectEditorMode, editorMode } from '../src/lib/editor/mode.ts';
import { setNewNoteEditorMode } from '../src/lib/api.ts';

test('fresh profiles default to Rich text and legacy Source preferences are retained',()=>{
  for(const config of [null,undefined,{}, {new_notes_in_source_mode:false}]) assert.equal(newNoteEditorMode(config),'rich');
  assert.equal(newNoteEditorMode({new_notes_in_source_mode:true}),'source');
  for(const mode of ['rich','live','source']) assert.equal(newNoteEditorMode({new_note_editor_mode:mode,new_notes_in_source_mode:true}),mode);
  assert.equal(newNoteEditorMode({new_note_editor_mode:'invalid',new_notes_in_source_mode:true}),'source');
});

test('new-note preferences only choose a mode when explicitly applied to a new note',()=>{
  selectEditorMode('live');
  const config={new_note_editor_mode:'rich'};
  assert.equal(newNoteEditorMode(config),'rich'); assert.equal(get(editorMode),'live');
  selectEditorMode(newNoteEditorMode(config)); assert.equal(get(editorMode),'rich');
});

test('preference writes use a dedicated partial command and propagate failure',async()=>{
  const before=globalThis.window, calls=[];
  globalThis.window={__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push({command,args});throw Error('disk full');}}};
  try {
    await assert.rejects(setNewNoteEditorMode('live'),/disk full/);
    assert.deepEqual(calls,[{command:'set_new_note_editor_mode',args:{mode:'live'}}]);
  } finally {if(before===undefined)delete globalThis.window;else globalThis.window=before;}
});

test('Settings has connected mode buttons and keeps the separate View-mode toggle',async()=>{
  const settings=await readFile(new URL('../src/lib/components/SettingsPanel.svelte',import.meta.url),'utf8');
  assert.match(settings,/<NewNoteEditorSetting value=\{newNoteMode\} onchange=\{saveNewNoteMode\}/);
  assert.doesNotMatch(settings,/class:on=\{newNotesInSourceMode\}/);
  assert.match(settings,/class:on=\{defaultViewMode\} role="switch"/);
  const editor=await readFile(new URL('../src/lib/components/Editor.svelte',import.meta.url),'utf8');
  assert.match(editor,/if \(isNewNote && !isViewer && !preservePresentation\) selectEditorMode\(newNoteEditorMode\(\$appConfig\)\)/);
});
