import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { aiImageCandidates, protectAiMedia, restoreAiMedia } from '../src/lib/utils/ai-media.ts';
import { aiAsk, fetchAiModels } from '../src/lib/api.ts';

const vault = '/vault', note = '/vault/Work/Note.md';

test('AI image candidates resolve managed and note-relative files without fetching remote URLs', () => {
  const source = '![screen](../.helixnotes/attachments/screen.png)\n![local](photo%20one.webp)\n![repeat](photo%20one.webp)\n![remote](https://example.com/a.png)\n[PDF](doc.pdf)\n';
  assert.deepEqual(aiImageCandidates(source, note, vault), [
    { path: '/vault/.helixnotes/attachments/screen.png', name: 'screen.png' },
    { path: '/vault/Work/photo one.webp', name: 'photo one.webp' },
  ]);
});

test('code, math and comments do not become AI image candidates', () => {
  const source = '```md\n![secret](code.png)\n```\n\n`![inline](inline.png)`\n\n<!-- <img src="comment.png"> -->\n\n$$\n![math](math.png)\n$$\n';
  assert.deepEqual(aiImageCandidates(source, note, vault), []);
});

test('complete Markdown images, reference definitions and HTML images round-trip byte-for-byte', () => {
  const source = '# План\n\n![a](screens/a(b).png "hover")  \n![ref][shot]\n\n[shot]: photo.png "title"\n\n<div class="image-grid"><img src="one.png" title="a > b"><img src="two.png"></div>\n';
  const protectedText = protectAiMedia(source, 'test');
  assert.ok(protectedText.media.size >= 4);
  assert.equal(restoreAiMedia(protectedText.text, protectedText.media), source);
  assert.equal(restoreAiMedia('Edited\n'+protectedText.text, protectedText.media), 'Edited\n'+source);
});

test('encoded image data is protected in text-only requests, not silently sent as prompt text', () => {
  const source = '![embedded](data:image/png;base64,VERY_PRIVATE_PIXELS)\n';
  const protectedText = protectAiMedia(source, 'test');
  assert.ok(!protectedText.text.includes('VERY_PRIVATE_PIXELS'));
  assert.equal(restoreAiMedia(protectedText.text, protectedText.media), source);
});

test('missing and duplicated image markers refuse application; replacement metacharacters remain data', () => {
  const source = '![cost $&](x.png)\n';
  const { text, media } = protectAiMedia(source, 'test');
  assert.equal(restoreAiMedia(text, media), source);
  assert.equal(restoreAiMedia('No image', media), null);
  assert.equal(restoreAiMedia(text+text, media), null);
  assert.equal(restoreAiMedia('Plain result', new Map()), 'Plain result');
});

test('media protection ignores literal image examples in fenced code and comments', () => {
  const source = '```html\n<img src="code.png">\n```\n<!-- <img src="comment.png"> -->\n';
  const { text, media } = protectAiMedia(source, 'test');
  assert.equal(text, source); assert.equal(media.size, 0);
});

test('AI application rejects errored drafts even if a stale Apply handler is invoked', async () => {
  const source = await readFile(new URL('../src/lib/components/Editor.svelte', import.meta.url), 'utf8');
  const apply = source.slice(source.indexOf('async function aiApplyResult()'), source.indexOf('function aiDiscard()'));
  assert.match(apply, /if \(!origin \|\| !aiResult \|\| aiLoading \|\| aiError \|\| !canInsert\(origin\)\) return;/);
  assert.ok(apply.indexOf('|| aiError') < apply.indexOf('await forceSave()'));
});

test('model discovery sends only provider/key, and AI requests are text-only unless explicitly supplied images', async () => {
  const previous = globalThis.window, calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => { calls.push({ command, args }); return []; } } };
  try {
    await fetchAiModels('openai','fake-key');
    await aiAsk('summarize','Note text',null,'request');
    const images = { vaultPath: vault, notePath: note, paths: ['/vault/screen.png'] };
    const expected = { provider: 'openai', model: 'gpt-future', baseUrl: null };
    await aiAsk('describe_images','Protected note',null,'vision',images,expected);
    assert.deepEqual(calls[0], { command:'fetch_ai_models', args:{provider:'openai',apiKey:'fake-key'} });
    assert.equal(calls[1].args.imageContext,null);
    assert.deepEqual(calls[2].args.imageContext,images);
    assert.deepEqual(calls[2].args.expectedConfig,expected);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window=previous; }
});
