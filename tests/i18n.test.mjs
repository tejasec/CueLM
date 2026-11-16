import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import * as compiler from 'svelte/compiler';
import { IntlMessageFormat } from 'intl-messageformat';
import { get } from 'svelte/store';
import { catalogs, languageOptions, formatLabel, formatMessage, normalizeLanguage, resolveLocale } from '../src/lib/i18n/core.ts';
import { applyLanguage, language, locale, t, setUiText } from '../src/lib/i18n/index.ts';
import { formatDate, formatRelativeTime, dateBucketLabel, formatLocalDate, formatClockTime } from '../src/lib/utils/time.ts';
import { SourceController } from '../src/lib/editor/source/controller.ts';
import { EditorView } from '@codemirror/view';

function argumentsIn(ast) {
  const result = new Set();
  function visit(nodes) {
    for (const node of nodes) {
      if (node.type >= 1 && node.type <= 6) result.add(node.value);
      if (node.options) for (const option of Object.values(node.options)) visit(option.value);
      if (node.children) visit(node.children);
    }
  }
  visit(ast);
  return [...result].sort();
}

test('all bundled catalogs have matching keys, valid ICU messages and matching arguments', () => {
  assert.ok(Object.keys(catalogs.en).length > 1000);
  const reference = new Map(Object.entries(catalogs.en).map(([key, english]) => [
    key, argumentsIn(new IntlMessageFormat(english, 'en', undefined, { ignoreTag: true }).getAst()),
  ]));
  for (const [code, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs.en).sort(), code);
    for (const [key, text] of Object.entries(catalog)) {
      assert.ok(text.trim().length > 0, `${code}:${key} is empty`);
      const message = new IntlMessageFormat(text, code, undefined, { ignoreTag: true });
      assert.deepEqual(argumentsIn(message.getAst()), reference.get(key), `${code}:${key}`);
      for (const count of [0, 1, 2, 5, 11, 21, 22, 1.5]) {
        const values = Object.fromEntries(reference.get(key).map(name => [name, count]));
        assert.equal(typeof message.format(values), 'string', `${code}:${key}:${count}`);
      }
    }
  }
});

test('system locale matches all supported languages, Portuguese regions and ordered preferences', () => {
  for (const [tag, expected] of [
    ['en-AU', 'en'], ['ru-RU', 'ru'], ['ru_BY', 'ru'], ['nl-BE', 'nl'],
    ['de_AT.UTF-8', 'de'], ['es-MX', 'es'], ['fr-CA', 'fr'], ['it-CH', 'it'],
    ['pt', 'pt-PT'], ['pt-PT', 'pt-PT'], ['pt-AO', 'pt-PT'], ['pt-MZ', 'pt-PT'],
    ['pt_BR.UTF-8', 'pt-BR'], ['pt-Latn-BR', 'pt-BR'], ['pt-BR-u-ca-gregory', 'pt-BR'],
  ]) assert.equal(resolveLocale('system', [tag]), expected, tag);
  assert.equal(resolveLocale('system', ['ja-JP', 'nl-NL', 'en-GB']), 'nl');
  assert.equal(resolveLocale('system', ['ja-JP']), 'en');
  assert.equal(resolveLocale('system', []), 'en');
  for (const code of Object.keys(catalogs)) {
    assert.equal(normalizeLanguage(code), code);
    assert.equal(resolveLocale(code, ['ru-RU']), code, 'explicit setting overrides OS');
  }
  assert.equal(normalizeLanguage('pt-br'), 'pt-BR');
  for (const invalid of [null, undefined, '', 'ja', 'constructor', '__proto__', 42, {}]) assert.equal(normalizeLanguage(invalid), 'system');
});

test('language autonyms and native catalogs stay in sync with the shared registry', async () => {
  const codes = languageOptions.map(option => option.code);
  assert.deepEqual([...codes].sort(), Object.keys(catalogs).sort());
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(codes.slice(0, 2), ['en', 'ru']);
  for (const code of ['nl', 'de', 'es', 'fr', 'it', 'pt-PT', 'pt-BR']) assert.ok(codes.includes(code), code);
  assert.equal(languageOptions.find(option => option.code === 'pt-PT').name, 'Português (Portugal)');
  assert.equal(languageOptions.find(option => option.code === 'pt-BR').name, 'Português (Brasil)');
  const native = await readFile(new URL('../src-tauri/src/i18n.rs', import.meta.url), 'utf8');
  const nativeCodes = [...native.matchAll(/include_str!\("[^"\n]*\/locales\/([^/]+)\.json"\)/g)].map(match => match[1]);
  assert.deepEqual(nativeCodes.sort(), [...codes].sort());
  assert.match(native, /include_str!\("[^"\n]*languages\.json"\)/);
});

test('Portuguese variants use their own vocabulary and preserve interpolation', () => {
  for (const [key, portugal, brazil] of [
    ['ui.file', 'Ficheiro', 'Arquivo'], ['ui.save', 'Guardar', 'Salvar'],
    ['ui.settings', 'Definições', 'Configurações'], ['ui.password', 'Palavra-passe', 'Senha'],
    ['ui.download', 'Transferir', 'Baixar'],
  ]) {
    assert.equal(formatMessage('pt-PT', key), portugal);
    assert.equal(formatMessage('pt-BR', key), brazil);
  }
  for (const code of ['pt-PT', 'pt-BR']) {
    assert.equal(formatMessage(code, 'count.notes', { count: 0 }), '0 notas');
    assert.equal(formatMessage(code, 'count.notes', { count: 1 }), '1 nota');
    assert.equal(formatMessage(code, 'count.notes', { count: 2 }), '2 notas');
  }
});

test('French and Italian contractions and Dutch apostrophes survive ICU parsing', () => {
  assert.match(formatMessage('fr', 'ui.could_not_open_this_note'), /d'ouvrir/);
  assert.match(formatMessage('it', 'ui.you_are_on_the_latest_version'), /l'ultima/);
  assert.equal(formatMessage('nl', 'ui.photos'), "Foto's");
  for (const code of Object.keys(catalogs)) {
    const title = 'A {count} <tag> "quoted" note';
    assert.ok(formatMessage(code, 'ui.create_note', { value0: title }).includes(title), code);
  }
});

test('Russian plurals handle one, few, many, teens and decimal counts', () => {
  for (const [count, noun] of [[0, 'заметок'], [1, 'заметка'], [2, 'заметки'], [5, 'заметок'], [11, 'заметок'], [21, 'заметка'], [22, 'заметки'], [25, 'заметок'], [1.5, 'заметки']]) {
    assert.ok(formatMessage('ru', 'count.notes', { count }).endsWith(noun), String(count));
  }
  assert.equal(formatMessage('en', 'count.notes', { count: 1 }), '1 note');
  assert.equal(formatMessage('en', 'count.notes', { count: 2 }), '2 notes');
});

test('interpolation keeps user strings as data, not ICU syntax or executable HTML', () => {
  const title = '<img src=x onerror=alert(1)> {count, plural, other {injected}}';
  const result = formatMessage('ru', 'ui.create_note', { value0: title });
  assert.equal(result, `Создать заметку «${title}»`);
  assert.equal(formatMessage('en', 'language.saveFailed', { error: new Error('disk full') }), 'Could not save the language setting: Error: disk full');
});

test('unknown and malformed translations fall back without breaking the interface', () => {
  catalogs.en['test.fallback'] = 'English {name}';
  try {
    for (const code of Object.keys(catalogs).filter(code => code !== 'en')) {
      assert.equal(formatMessage(code, 'test.fallback', { name: 'fallback' }), 'English fallback', `${code}: missing`);
      catalogs[code]['test.fallback'] = '{broken';
      assert.equal(formatMessage(code, 'test.fallback', { name: 'fallback' }), 'English fallback', `${code}: invalid`);
      assert.equal(formatMessage(code, 'test.missing'), 'test.missing', code);
    }
  } finally {
    for (const catalog of Object.values(catalogs)) delete catalog['test.fallback'];
  }
});

test('language changes reactively update existing translator subscriptions and preserve IDs', () => {
  const results = [];
  const stop = t.subscribe(translate => results.push(translate('ui.settings')));
  applyLanguage('ru');
  assert.equal(get(language), 'ru');
  assert.equal(get(locale), 'ru');
  assert.equal(results.at(-1), 'Настройки');
  assert.equal(formatLabel('ru', 'Open Tasks'), 'Открыть задачи');
  assert.equal(formatLabel('ru', 'unregistered app label'), 'unregistered app label');
  applyLanguage('en');
  assert.equal(results.at(-1), 'Settings');
  stop();
});

test('explicit node-view bindings update only UI controls, not adjacent note content', () => {
  const button = { textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const note = { textContent: 'Settings' };
  applyLanguage('en');
  setUiText(button, 'ui.copy');
  setUiText(button, 'ui.passphrase', {}, 'placeholder');
  assert.equal(button.textContent, 'Copy');
  applyLanguage('ru');
  assert.equal(button.textContent, 'Копировать');
  assert.equal(button.attributes.placeholder, 'Парольная фраза');
  assert.equal(note.textContent, 'Settings');
  applyLanguage('en');
});

test('display dates follow the UI locale without changing persisted dates or inserted times', () => {
  const date = new Date(2026, 5, 10, 14, 7);
  assert.notEqual(formatDate(date.toISOString(), 'en'), formatDate(date.toISOString(), 'ru'));
  assert.match(dateBucketLabel(new Date(2025, 5, 10).toISOString(), date, 'ru'), /июн/);
  assert.match(formatRelativeTime(new Date(Date.now() - 120000).toISOString(), 'ru'), /мин/);
  assert.equal(formatLocalDate(date), '2026-06-10');
  assert.equal(formatClockTime(date, '24h'), '14:07');
});

test('source editor language changes preserve the draft, selection and undo history', () => {
  let edits = 0;
  const source = new SourceController(() => edits++);
  source.load('Existing note');
  source.replace(' draft', source.state.doc.length, source.state.doc.length);
  source.select(2, 5);
  const before = edits;
  source.setLabels('Начните писать...', 'Исходный текст Markdown');
  assert.equal(source.state.doc.toString(), 'Existing note draft');
  assert.equal(source.state.selection.main.anchor, 2);
  assert.equal(source.state.selection.main.head, 5);
  assert.equal(edits, before, 'language changes must not mark the note dirty');
  assert.equal(source.undo(), true);
  assert.equal(source.state.doc.toString(), 'Existing note');
  source.load('Another note');
  assert.ok(source.state.facet(EditorView.contentAttributes).some(attrs => attrs['aria-label'] === 'Исходный текст Markdown'));
});

test('static interface text is translated rather than left hardcoded in templates', async () => {
  const directory = new URL('../src/lib/components/', import.meta.url);
  const allowed = new Set(['HelixNotes', 'CueLM', 'WebDAV', 'English']); // brand, protocol, language autonym
  const failures = [];
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.svelte'))) {
    const source = await readFile(new URL(file, directory), 'utf8');
    const ast = compiler.parse(source, { modern: true });
    function fragment(value, tag) { for (const node of value?.nodes ?? []) visit(node, tag); }
    function visit(node, tag = '') {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Text' && /[A-Za-z]{2}/.test(node.data.trim()) && !['code', 'pre', 'kbd', 'svg'].includes(tag) && !allowed.has(node.data.trim())) {
        failures.push(`${file}: ${node.data.trim()}`);
      }
      if (node.fragment) fragment(node.fragment, node.name || tag);
      for (const key of ['body', 'consequent', 'alternate', 'fallback', 'pending', 'then', 'catch']) {
        if (node[key]?.nodes) fragment(node[key], node.name || tag);
        else if (node[key]) visit(node[key], node.name || tag);
      }
    }
    fragment(ast.fragment, '');
  }
  assert.deepEqual(failures, []);
});

test('the community translation example stays in sync with the English catalog', async () => {
  const example = JSON.parse(await readFile(new URL('../docs/translations/example.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(example).length > 0);
  for (const [key, text] of Object.entries(example)) assert.equal(text, catalogs.en[key], key);
});

test('the language selector renders its popup in the app rather than delegating colors to the OS', async () => {
  const source = await readFile(new URL('../src/lib/components/SettingsPanel.svelte', import.meta.url), 'utf8');
  assert.match(source, /<ThemedSelect[^>]+id="interface-language"/);
  assert.doesNotMatch(source, /<select[^>]+id="interface-language"/);
  const select = await readFile(new URL('../src/lib/components/ThemedSelect.svelte', import.meta.url), 'utf8');
  for (const selector of ['select-trigger', 'select-menu', 'select-option']) {
    const rule = select.match(new RegExp(`\\n\\t\\.${selector}\\s*\\{([^}]+)\\}`))[1];
    assert.match(rule, /background:\s*var\(--bg-secondary\)/, selector);
    assert.match(rule, /color:\s*var\(--text-primary\)/, selector);
  }
  assert.match(select, /role="combobox"/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /role="option" aria-selected/);
  assert.match(select, /aria-activedescendant/);
  assert.match(select, /\.select-trigger:focus-visible\s*\{\s*outline:\s*2px solid var\(--accent\)/);
});

test('UI lookup is not applied to user-authored note titles', async () => {
  const editor = await readFile(new URL('../src/lib/components/Editor.svelte', import.meta.url), 'utf8');
  assert.doesNotMatch(editor, /\$uiLabel\((?:entry\.title|note\.meta\.title|\$activeNote\.meta\.title)\)/);
});
