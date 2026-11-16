import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { get } from 'svelte/store';
import { SourceController } from '../src/lib/editor/source/controller.ts';
import { previewDestination, previewSpans } from '../src/lib/editor/source/live-preview.ts';
import { editorMode, sourceMode, livePreviewMode, selectEditorMode } from '../src/lib/editor/mode.ts';

function fixture(text) {
  const controller = new SourceController();
  controller.load(text + '\n\nCaret');
  controller.select(controller.state.doc.length);
  return controller;
}
const hidden = state => previewSpans(state).filter(span => span.kind === 'hide').map(span => state.sliceDoc(span.from, span.to));

test('preview decorates headings, emphasis, code, lists, links and images without changing Markdown', () => {
  const raw = '# Heading\n\n**bold** *italic* ~~gone~~ `code` [link](https://example.com)\n\n- [ ] task\n- [X] done\n- bullet\n\n![alt](image.png "title")';
  const c = fixture(raw), doc = c.state.doc;
  const spans = previewSpans(c.state);
  for (const name of ['lp-heading lp-h1', 'lp-strong', 'lp-emphasis', 'lp-strike', 'lp-inline-code', 'lp-link']) assert.ok(spans.some(span => span.className === name), name);
  assert.deepEqual(spans.filter(span => span.kind === 'checkbox').map(span => span.checked), [false, true]);
  assert.equal(spans.find(span => span.kind === 'image').href, 'image.png');
  assert.equal(spans.find(span => span.kind === 'image').label, 'alt');
  assert.equal(spans.filter(span => span.kind === 'bullet').length, 1);
  assert.equal(c.state.doc, doc);
  assert.ok(hidden(c.state).includes('**'));
});

test('all selected lines reveal syntax, including backwards and multiple Unicode selections', () => {
  const c = fixture('**日本語😀**\n\n*second*\n\n~~third~~');
  c.dispatch({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) });
  c.dispatch({ selection: EditorSelection.create([EditorSelection.range(10, 2), EditorSelection.range(15, 17)]) });
  const hide = hidden(c.state);
  assert.ok(!hide.includes('**'));
  assert.ok(!hide.includes('*'));
  assert.ok(hide.includes('~~'));
  assert.deepEqual(previewSpans(c.state, undefined, true).filter(span => span.kind === 'hide').map(span => c.state.sliceDoc(span.from, span.to)), hide);
});

test('fenced literal Markdown is not interpreted and fences reveal together while editing the block', () => {
  const c = fixture('```md\n**not bold**\n![not an image](x.png)\n```');
  assert.ok(!previewSpans(c.state).some(span => ['image', 'checkbox'].includes(span.kind) || span.className === 'lp-strong'));
  assert.deepEqual(hidden(c.state), ['```md', '```']);
  c.select(12);
  assert.deepEqual(hidden(c.state), []);
});

test('raw HTML, tables, math and unresolved wiki/reference links remain literal source', () => {
  const c = fixture('<div>**raw** <img src="https://bad.invalid/x"></div>\n\n$$\nx*y*z\n$$\n\n| A | B |\n|---|---|\n| **raw** | cell |\n\n[[Wiki]]\n\n[ref][label]\n\n[label]: example.png');
  assert.deepEqual(previewSpans(c.state).filter(span => span.kind !== 'line'), []);
});

test('math blocks suppress headings and images across blank lines without suppressing the following Markdown', () => {
  const c = fixture('$$\n# Literal math heading\n\n![not an image](secret.png)\n\n**not bold**\n$$\n\n# Real heading\n\nText $x*y*z$ and **real bold**');
  const spans = previewSpans(c.state);
  assert.equal(spans.filter(span => span.className?.includes('lp-h1')).length, 1);
  assert.ok(!spans.some(span => span.kind === 'image'));
  assert.deepEqual(spans.filter(span => span.className === 'lp-strong').map(span => c.state.sliceDoc(span.from, span.to)), ['**real bold**']);
  assert.ok(!spans.some(span => span.className === 'lp-emphasis'));
});

test('unsafe destinations never become images or clickable links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,script', 'data:image/svg+xml;base64,PHN2Zz4=', 'vbscript:x', 'file:///etc/passwd', 'java&#x73;cript:x', 'https://example.org/\u0000']) assert.equal(previewDestination(value), null, value);
  for (const value of ['photo%20one.png', '../images/pic.png', 'https://example.org/pic.png', 'C:\\Vault\\pic.png', '#heading', 'mailto:me@example.org']) assert.equal(previewDestination(value), value);
  const c = fixture('![bad](javascript:alert)\n\n[bad](data:text/html,x)');
  assert.ok(!previewSpans(c.state).some(span => span.kind === 'image' || span.href));
});

test('empty link labels remain source instead of creating invalid zero-length decorations', () => {
  const c = fixture('[](https://example.org)\n\n![](sample.png)');
  const spans = previewSpans(c.state);
  assert.ok(spans.every(span => span.kind !== 'mark' || span.to > span.from));
  assert.ok(!spans.some(span => span.className === 'lp-link'));
  assert.equal(spans.find(span => span.kind === 'image').label, '');
});

test('source/live switching retains the exact Text, selection, dirty count and both undo branches', () => {
  let edits = 0;
  const c = new SourceController((_, edited) => { if (edited) edits++; });
  c.load('# Original\n\nUnicode 日本語😀');
  c.replace(' draft', c.state.doc.length);
  c.select(14, 20);
  const doc = c.state.doc, selection = c.state.selection;
  for (let i = 0; i < 4; i++) {
    c.setLivePreview(true, { context: '/vault/Note.md' });
    c.setLabels('Write', 'Live preview');
    c.setLivePreview(false);
    assert.equal(c.state.doc, doc);
    assert.equal(c.state.selection, selection);
  }
  assert.equal(edits, 1);
  assert.equal(c.undo(), true);
  assert.equal(c.state.doc.toString(), '# Original\n\nUnicode 日本語😀');
  c.setLivePreview(true);
  assert.equal(c.redo(), true);
  assert.equal(c.state.doc.toString(), doc.toString());
  c.load('Other note');
  assert.equal(c.undo(), false);
});

test('preview read-only mode renders selected syntax without enabling writes', () => {
  const c = fixture('# Heading\n\n- [ ] Task');
  c.select(0);
  assert.ok(!hidden(c.state).includes('# '));
  c.configure(true, true);
  c.setLivePreview(true);
  assert.ok(hidden(c.state).includes('# '));
  assert.equal(c.state.readOnly, true);
  c.setLivePreview(false);
  assert.equal(c.state.readOnly, true);
});

test('viewport decoration work is bounded and does not scan offscreen code-block lines', () => {
  const c = fixture('```md\n' + 'plain\n'.repeat(10000) + '```');
  ensureSyntaxTree(c.state, c.state.doc.length, 500);
  const from = 3000, to = 3300;
  const spans = previewSpans(c.state, [{ from, to }]);
  assert.ok(spans.length < 120, `${spans.length} decorations`);
  assert.ok(spans.every(span => span.from >= c.state.doc.lineAt(from).from && span.to <= to));
});

test('mode selection preserves existing defaults and legacy toggles remember the last Markdown presentation', () => {
  selectEditorMode('rich'); livePreviewMode.set(false);
  assert.equal(get(editorMode), 'rich');
  selectEditorMode('live'); assert.equal(get(sourceMode), true); assert.equal(get(editorMode), 'live');
  sourceMode.set(false); assert.equal(get(editorMode), 'rich');
  sourceMode.set(true); assert.equal(get(editorMode), 'live');
  selectEditorMode('source'); assert.equal(get(editorMode), 'source');
  selectEditorMode('invalid'); assert.equal(get(editorMode), 'source');
  selectEditorMode('rich'); livePreviewMode.set(false);
});
