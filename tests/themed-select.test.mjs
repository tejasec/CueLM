import assert from 'node:assert/strict';
import test from 'node:test';
import { findTypeaheadIndex, moveSelectIndex, typeaheadQuery } from '../src/lib/utils/select-navigation.ts';

const options = [
  { value: 'system', label: 'System default' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
];

test('dropdown arrows move the active option without wrapping or committing a value', () => {
  const before = structuredClone(options);
  assert.equal(moveSelectIndex(1, 10, 'ArrowDown'), 2);
  assert.equal(moveSelectIndex(1, 10, 'ArrowUp'), 0);
  assert.equal(moveSelectIndex(0, 10, 'ArrowUp'), 0);
  assert.equal(moveSelectIndex(9, 10, 'ArrowDown'), 9);
  assert.equal(moveSelectIndex(-1, 10, 'ArrowDown'), 0);
  assert.equal(moveSelectIndex(-1, 10, 'ArrowUp'), 9);
  assert.deepEqual(options, before);
});

test('Home and End reach both ends and empty menus have no active option', () => {
  assert.equal(moveSelectIndex(5, 10, 'Home'), 0);
  assert.equal(moveSelectIndex(5, 10, 'End'), 9);
  for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown']) assert.equal(moveSelectIndex(0, 0, key), -1);
  for (const key of ['Enter', 'Escape', 'Tab', ' ', 'D']) assert.equal(moveSelectIndex(1, 10, key), null);
});

test('type-to-select matches accents, case and Russian autonyms without changing their spelling', () => {
  assert.equal(findTypeaheadIndex(options, 'francais', 0), 6);
  assert.equal(findTypeaheadIndex(options, 'ESPA', 0), 5);
  assert.equal(findTypeaheadIndex(options, 'рус', 0), 2);
  assert.equal(findTypeaheadIndex(options, 'portugues (br', 0), 9);
  assert.equal(options[6].label, 'Français');
  assert.equal(options[9].label, 'Português (Brasil)');
});

test('repeated letters cycle through both Portuguese options, including across the menu boundary', () => {
  let query = typeaheadQuery('', 'p', 1000);
  let index = findTypeaheadIndex(options, query, 1);
  assert.equal(index, 8);
  query = typeaheadQuery(query, 'p', 50);
  index = findTypeaheadIndex(options, query, index);
  assert.equal(index, 9);
  query = typeaheadQuery(query, 'p', 50);
  assert.equal(findTypeaheadIndex(options, query, index), 8);
});

test('typing builds a prefix until timeout; missing and empty matches are safe', () => {
  assert.equal(typeaheadQuery('de', 'u', 50), 'deu');
  assert.equal(typeaheadQuery('de', 'f', 700), 'f');
  assert.equal(findTypeaheadIndex(options, 'deu', 4), 4);
  assert.equal(findTypeaheadIndex(options, 'unavailable', 4), -1);
  assert.equal(findTypeaheadIndex(options, '', 4), -1);
  assert.equal(findTypeaheadIndex([], 'd', -1), -1);
});
