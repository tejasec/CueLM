import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getDailyNoteTemplate, setDailyNoteTemplate, importDailyNoteTemplate } from '../src/lib/api.ts';

const saved = { raw: '# {{title}}\n{{date}}\n', content: '# {{title}}\n{{date}}\n', enabled: true };

test('template API calls are vault-scoped, carry the exact revision and let native code own the picker', async () => {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => { calls.push({ command, args }); return saved; } } };
  try {
    assert.equal(await getDailyNoteTemplate('/vault'), saved);
    assert.equal(await setDailyNoteTemplate('/vault', null, saved.raw), saved);
    assert.equal(await importDailyNoteTemplate('/vault', 'Import Markdown', saved.raw), saved);
    assert.deepEqual(calls, [
      { command: 'get_daily_note_template', args: { vaultPath: '/vault' } },
      { command: 'set_daily_note_template', args: { vaultPath: '/vault', template: null, expectedTemplate: saved.raw } },
      { command: 'import_daily_note_template', args: { vaultPath: '/vault', title: 'Import Markdown', expectedTemplate: saved.raw } },
    ]);
    assert.ok(calls.every(call => !('sourcePath' in call.args)), 'IPC callers cannot supply an arbitrary import source');
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('template API failures propagate without retrying or silently rewriting a note', async () => {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command) => { calls.push(command); throw new Error('disk full'); } } };
  try {
    await assert.rejects(setDailyNoteTemplate('/vault', 'draft', saved.raw), /disk full/);
    assert.deepEqual(calls, ['set_daily_note_template']);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('both daily-note entry points display creation errors instead of only logging them', async () => {
  for (const file of ['AppLayout.svelte', 'NoteList.svelte']) {
    const source = await readFile(new URL(`../src/lib/components/${file}`, import.meta.url), 'utf8');
    const handler = source.match(/console\.error\('Failed to (?:create\/open|open) daily note:'[\s\S]+?Could not display daily-note error:/)?.[0];
    assert.ok(handler, file);
    assert.match(handler, /navigationIsCurrent\(token\)/, file);
    assert.match(handler, /await showMessage\(/, file);
    assert.match(handler, /ui\.could_not_open_this_note/, file);
    assert.match(handler, /kind: 'error'/, file);
  }
});

test('the template editor isolates vault identity from language updates and guards late responses', async () => {
  const source = await readFile(new URL('../src/lib/components/DailyNoteTemplate.svelte', import.meta.url), 'utf8');
  assert.match(source, /const currentVault = \$derived\(vaultPath\)/);
  assert.match(source, /const vault = currentVault/);
  assert.match(source, /return \(\) => \{ generation\+\+; \}/);
  assert.match(source, /if \(request !== generation\) return/);
  assert.match(source, /setDailyNoteTemplate\(vault, template, value.raw\)/);
  assert.match(source, /save\(value.enabled \? null : value.content\)/, 'reenabling uses the retained body');
  assert.doesNotMatch(source, /\b(?:saveNote|createDailyNote|activeNote|editorDirty)\b/);
});
