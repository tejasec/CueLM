import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { DOMSerializer, Fragment } from '@tiptap/pm/model';
import { createSingleLineClipboardSerializer } from '../src/lib/utils/clipboard-copy.ts';

// ProseMirror's real serializer runs against this small DOM. No HTML reparsing is provided:
// moving a content-hole target out of its parent must not be needed to style a copy.
class TestNode {
  constructor(nodeType, tagName = '', text = '') {
    this.nodeType = nodeType;
    this.tagName = tagName.toUpperCase();
    this.text = text;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
  }
  appendChild(child) {
    if (child.nodeType === 11) {
      for (const node of [...child.childNodes]) this.appendChild(node);
      return child;
    }
    if (child.parentNode) {
      const siblings = child.parentNode.childNodes;
      siblings.splice(siblings.indexOf(child), 1);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'style') {
      for (const declaration of value.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 0) continue;
        const key = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        this.style[key] = declaration.slice(colon + 1).trim();
      }
    }
  }
  matches(selector) { return selector.split(',').includes(this.tagName.toLowerCase()); }
  querySelectorAll(selector) {
    return this.childNodes.flatMap(child => [
      ...(child.nodeType === 1 && child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  get textContent() { return this.text + this.childNodes.map(child => child.textContent).join(''); }
}
const document = {
  createElement: tag => new TestNode(1, tag),
  createTextNode: text => new TestNode(3, '', text),
  createDocumentFragment: () => new TestNode(11),
};
const options = { document };
const schemaForTest = () => getSchema([
  StarterKit, Table, TableRow, TableCell, TableHeader, Details, DetailsSummary, DetailsContent,
]);
const paragraph = (schema, text, attrs = null) => schema.node('paragraph', attrs, schema.text(text));
function tableForTest(schema, attrs = {}, header = false) {
  const cell = (text, attributes = {}) => schema.node(header ? 'tableHeader' : 'tableCell', attributes, paragraph(schema, text));
  return schema.node('table', null, [
    schema.node('tableRow', null, [cell('alpha', attrs), cell('beta')]),
    schema.node('tableRow', null, [cell('gamma'), cell('delta')]),
  ]);
}
const cells = dom => dom.querySelectorAll('th,td').map(cell => cell.textContent);

// Regression: DOMSerializer.fromSchema caches its result. Mutating it for clipboard styling
// used to detach <tbody> while saving HTML tables, even when the edit was elsewhere in the note.
test('installing clipboard serialization never changes the shared save serializer', () => {
  const schema = schemaForTest();
  const shared = DOMSerializer.fromSchema(schema);
  const serializeFragment = shared.serializeFragment;
  for (let i = 0; i < 3; i++) {
    const clipboard = createSingleLineClipboardSerializer(schema);
    assert.notEqual(clipboard, shared);
    assert.equal(DOMSerializer.fromSchema(schema), shared);
    assert.equal(shared.serializeFragment, serializeFragment);
    assert.deepEqual(cells(shared.serializeNode(tableForTest(schema), options)), ['alpha', 'beta', 'gamma', 'delta']);
    const savedParagraph = shared.serializeNode(paragraph(schema, 'Saved prose'), options);
    assert.deepEqual(savedParagraph.style, {}, 'clipboard spacing must not leak into saved HTML');
  }
});

for (const [name, attrs, header] of [
  ['headerless', {}, false],
  ['header', {}, true],
  ['resized', { colwidth: [200] }, false],
  ['merged', { colspan: 2, rowspan: 2 }, false],
]) {
  test(`${name} tables keep their rows and cells when copied and saved repeatedly`, () => {
    const schema = schemaForTest();
    const table = tableForTest(schema, attrs, header);
    const shared = DOMSerializer.fromSchema(schema);
    const clipboard = createSingleLineClipboardSerializer(schema);
    for (let i = 0; i < 3; i++) {
      const copied = clipboard.serializeFragment(Fragment.from(table), options);
      assert.deepEqual(cells(copied), ['alpha', 'beta', 'gamma', 'delta']);
      assert.equal(copied.querySelectorAll('tbody').length, 1);
      assert.equal(copied.querySelectorAll('tr').length, 2);
      for (const p of copied.querySelectorAll('p')) {
        assert.equal(p.style.lineHeight, '100%');
        assert.equal(p.style.margin, '0');
      }
      const saved = shared.serializeNode(table, options);
      assert.deepEqual(cells(saved), ['alpha', 'beta', 'gamma', 'delta']);
      assert.equal(saved.querySelectorAll('tbody')[0].parentNode, saved);
      for (const p of saved.querySelectorAll('p')) assert.deepEqual(p.style, {});
      const firstCell = saved.querySelectorAll('th,td')[0];
      if (attrs.colspan) assert.equal(firstCell.attributes.colspan, String(attrs.colspan));
      if (attrs.rowspan) assert.equal(firstCell.attributes.rowspan, String(attrs.rowspan));
      if (attrs.colwidth) assert.equal(firstCell.attributes.colwidth, '200');
    }
  });
}

test('clipboard serialization preserves explicit table-body targets and existing children', () => {
  const schema = schemaForTest();
  const table = tableForTest(schema);
  const parent = document.createElement('table');
  const target = parent.appendChild(document.createElement('tbody'));
  const sentinel = target.appendChild(document.createElement('tr'));
  const clipboard = createSingleLineClipboardSerializer(schema);
  assert.equal(clipboard.serializeFragment(table.content, options, target), target);
  assert.equal(target.parentNode, parent);
  assert.equal(target.childNodes[0], sentinel);
  assert.equal(target.querySelectorAll('tr').length, 3);
  assert.deepEqual(cells(target), ['alpha', 'beta', 'gamma', 'delta']);
});

test('copying a row or cell fragment never reparses away its table markup', () => {
  const schema = schemaForTest();
  const table = tableForTest(schema);
  const clipboard = createSingleLineClipboardSerializer(schema);
  const rows = clipboard.serializeFragment(table.content, options);
  assert.equal(rows.querySelectorAll('tr').length, 2);
  assert.deepEqual(cells(rows), ['alpha', 'beta', 'gamma', 'delta']);
  const rowCells = clipboard.serializeFragment(table.firstChild.content, options);
  assert.equal(rowCells.querySelectorAll('td').length, 2);
  assert.deepEqual(cells(rowCells), ['alpha', 'beta']);
});

test('nested details, lists and formatting survive copies without changing saved HTML', () => {
  const schema = schemaForTest();
  const bold = schema.marks.bold.create();
  const marked = schema.node('paragraph', { textAlign: 'center' }, schema.text('Bold content', [bold]));
  const quote = schema.node('blockquote', null, marked);
  const list = schema.node('bulletList', null, schema.node('listItem', null, paragraph(schema, 'Item')));
  const details = schema.node('details', null, [
    schema.node('detailsSummary', null, schema.text('Summary')),
    schema.node('detailsContent', null, [quote, list, tableForTest(schema)]),
  ]);
  const clipboard = createSingleLineClipboardSerializer(schema);
  const copied = clipboard.serializeFragment(Fragment.from(details), options);
  assert.equal(copied.querySelectorAll('summary')[0].textContent, 'Summary');
  assert.equal(copied.querySelectorAll('strong')[0].textContent, 'Bold content');
  assert.equal(copied.querySelectorAll('li')[0].textContent, 'Item');
  assert.equal(copied.querySelectorAll('blockquote')[0].style.lineHeight, '100%');
  assert.equal(copied.querySelectorAll('blockquote')[0].style.margin, undefined);
  assert.deepEqual(cells(copied), ['alpha', 'beta', 'gamma', 'delta']);
  const saved = DOMSerializer.fromSchema(schema).serializeNode(details, options);
  assert.equal(saved.querySelectorAll('summary')[0].textContent, 'Summary');
  assert.equal(saved.querySelectorAll('strong')[0].textContent, 'Bold content');
  assert.equal(saved.querySelectorAll('li')[0].textContent, 'Item');
  assert.deepEqual(cells(saved), ['alpha', 'beta', 'gamma', 'delta']);
  for (const block of saved.querySelectorAll('p,li,blockquote')) assert.equal(block.style.lineHeight, undefined);
});

test('single spacing preserves existing styles and includes an explicit paragraph target', () => {
  const schema = schemaForTest();
  const clipboard = createSingleLineClipboardSerializer(schema);
  const target = document.createElement('p');
  target.setAttribute('style', 'text-align: center; line-height: 1.5; margin: 8px; color: red');
  assert.equal(clipboard.serializeFragment(Fragment.from(schema.text('Centered')), options, target), target);
  assert.equal(target.textContent, 'Centered');
  assert.deepEqual(target.style, { textAlign: 'center', lineHeight: '100%', margin: '0', color: 'red' });
});
