import { test, expect } from '@playwright/test';

const snapshot = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).previewFixture.snapshot());
async function choose(page: import('@playwright/test').Page, name: string) {
	await page.getByRole('combobox', { name: /Editor mode/ }).click();
	await page.getByRole('option', { name, exact: true }).click();
}
let errors: string[];
test.beforeEach(async ({ page }) => {
	errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.goto('/');
	await expect(page.locator('.cm-editor')).toBeVisible();
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('renders inline, reveals selected syntax, and preserves the source for copying', async ({ page, context }, testInfo) => {
	await expect(page.locator('.lp-h1')).toHaveText('Heading');
	await expect(page.locator('.lp-strong')).toHaveText('bold');
	await expect(page.locator('.lp-strike')).toHaveText('gone');
	await expect(page.locator('.lp-image img')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('live-preview-desktop.png'), fullPage: true });
	const before = await snapshot(page);
	await page.evaluate(() => { const f = (window as any).previewFixture; f.select(f.initial.indexOf('**bold**'), f.initial.indexOf('[Example]') - 2); });
	await expect(page.locator('.lp-strong')).toHaveText('**bold**');
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.keyboard.press('ControlOrMeta+c');
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toBe(before.text.slice(before.text.indexOf('**bold**'), before.text.indexOf('[Example]') - 2));
	expect((await snapshot(page)).edits).toBe(0);
	await page.evaluate(() => (window as any).previewFixture.select(0));
	await page.locator('.lp-link').click({ modifiers: ['ControlOrMeta'] });
	expect((await snapshot(page)).opened).toEqual(['https://example.org']);
});

test('source/live switching keeps the same editor, selection, unsaved text and undo/redo', async ({ page }) => {
	await page.evaluate(() => {
		(window as any).originalEditor = document.querySelector('.cm-content');
		const f = (window as any).previewFixture; f.select(9); f.insert(' draft');
	});
	const before = await snapshot(page);
	await choose(page, 'Markdown source');
	await expect(page.locator('.lp-image')).toHaveCount(0);
	await expect(page.locator('.cm-gutters')).toBeVisible();
	await choose(page, 'Live preview');
	await expect(page.locator('.lp-image')).toHaveCount(1);
	expect(await page.evaluate(() => document.querySelector('.cm-content') === (window as any).originalEditor)).toBe(true);
	expect(await snapshot(page)).toEqual(before);
	await page.evaluate(() => (window as any).previewFixture.undo());
	expect((await snapshot(page)).text).toBe(await page.evaluate(() => (window as any).previewFixture.initial));
	await page.evaluate(() => (window as any).previewFixture.redo());
	expect((await snapshot(page)).text).toBe(before.text);
});

test('task clicks change one Markdown character, are undoable, and cannot write in View mode', async ({ page }) => {
	const initial = (await snapshot(page)).text;
	await page.evaluate(() => { const f = (window as any).previewFixture; f.select(0); f.insert('Prefix\n\n'); });
	await page.getByRole('checkbox', { name: 'Toggle task' }).first().click();
	expect((await snapshot(page)).text).toBe('Prefix\n\n' + initial.replace('- [ ] First task', '- [x] First task'));
	expect((await snapshot(page)).edits).toBe(2);
	await page.evaluate(() => (window as any).previewFixture.undo());
	expect((await snapshot(page)).text).toBe('Prefix\n\n' + initial);
	await page.evaluate(() => (window as any).previewFixture.undo());
	expect((await snapshot(page)).text).toBe(initial);
	await page.evaluate(() => (window as any).previewFixture.readOnly(true));
	await expect(page.getByRole('checkbox').first()).toBeDisabled();
	const before = await snapshot(page);
	await page.locator('.cm-content').click();
	await page.keyboard.type('must not write');
	expect((await snapshot(page)).text).toBe(before.text);
});

test('image editing and language/context changes preserve source, selection and undo', async ({ page }) => {
	await page.evaluate(() => {
		(window as any).originalImage = document.querySelector('.lp-image img');
		const f = (window as any).previewFixture; f.select(0); f.insert('Prefix\n\n');
	});
	await expect.poll(() => page.evaluate(() => document.querySelector('.lp-image img') === (window as any).originalImage)).toBe(true);
	const initial = (await snapshot(page)).text;
	await page.getByRole('button', { name: 'Edit image source' }).click();
	await expect(page.locator('.lp-image')).toHaveCount(0);
	const selected = await snapshot(page);
	expect(initial.slice(selected.anchor, selected.head)).toBe('![sample](sample.png)');
	await page.evaluate(() => { const f = (window as any).previewFixture; f.language('ru'); f.context('other-vault'); });
	await expect(page.getByRole('combobox', { name: /Режим редактора/ })).toBeVisible();
	expect(await snapshot(page)).toEqual(selected);
	await page.evaluate(() => (window as any).previewFixture.select(0));
	await expect(page.locator('.lp-image')).toHaveCount(1);
	expect((await snapshot(page)).text).toBe(initial);
});

test('mode switches retain the viewport anchor away from the start of a long note', async ({ page }) => {
	await page.evaluate(() => { const f = (window as any).previewFixture; const text = 'Caret\n\n' + '## Heading\n\nParagraph **text**\n\n'.repeat(300); f.load(text); f.reveal(text.indexOf('## Heading', 3500)); });
	await expect.poll(() => page.evaluate(() => (window as any).previewFixture.top())).toBeGreaterThan(1000);
	const top = await page.evaluate(() => (window as any).previewFixture.top());
	const before = await snapshot(page);
	await choose(page, 'Markdown source');
	await choose(page, 'Live preview');
	expect(Math.abs((await page.evaluate(() => (window as any).previewFixture.top())) - top)).toBeLessThan(150);
	expect(await snapshot(page)).toEqual(before);
});

test('unsafe links and raw HTML stay source and cannot create executable preview DOM', async ({ page }) => {
	await page.evaluate(() => (window as any).previewFixture.load('Caret\n\n<img src=x onerror="window.previewInjected=true">\n\n![bad](javascript:alert)\n\n[bad](data:text/html,secret)\n\n$$\n# literal math heading\n\n![private](secret.png)\n\nx*y*z\n$$'));
	await expect(page.locator('.lp-image')).toHaveCount(0);
	await expect(page.locator('.cm-content img')).toHaveCount(0);
	await expect(page.locator('.lp-link')).toHaveCount(0);
	await expect(page.locator('.lp-h1')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).previewInjected)).toBeUndefined();
	expect((await snapshot(page)).edits).toBe(0);
});

test('keyboard menu works at phone width and large notes remain virtualized', async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 360, height: 640 });
	await page.evaluate(() => (window as any).previewFixture.dark());
	const picker = page.getByRole('combobox', { name: /Editor mode/ });
	await picker.focus(); await page.keyboard.press('Enter');
	await page.locator('.cm-scroller').evaluate(element=>element.dispatchEvent(new Event('scroll')));
	await expect(page.getByRole('listbox')).toBeVisible();
	const bounds = await page.getByRole('listbox').boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('listbox')).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath('live-preview-phone.png'), fullPage: true });
	await page.evaluate(() => (window as any).previewFixture.load('Caret\n\n' + '## Heading\n\n**text**\n\n'.repeat(5000)));
	await expect(page.locator('.lp-h2').first()).toBeVisible();
	expect(await page.locator('.cm-line').count()).toBeLessThan(200);
	expect((await snapshot(page)).edits).toBe(0);
});
