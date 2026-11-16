import { test, expect, type Page } from '@playwright/test';

const snapshot = (page: Page) => page.evaluate(() => (window as any).vaultFixture.snapshot());
const nativeOpens = (state: any) => state.calls.filter((call: any) => ['open_vault','restore_external_vault'].includes(call.command));
async function menu(page: Page) { await page.getByRole('button', { name: /Switch vault:/ }).click(); }
const vaultRow = (page: Page, path: string) => page.getByRole('menuitemradio').filter({ hasText: path });
let errors: string[];
test.beforeEach(async ({ page }) => {
	errors=[]; page.on('pageerror', error=>errors.push(error.message));
	await page.goto('/?fixture=vault');
	await expect(page.locator('.cm-editor')).toBeVisible();
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('duplicate names show paths and saved-vault selection publishes one atomic native response', async ({ page }, testInfo) => {
	await page.evaluate(() => (window as any).vaultFixture.edit(' unsaved draft'));
	await menu(page);
	await expect(vaultRow(page,'/notes/Work')).toHaveAttribute('aria-checked','true');
	await expect(vaultRow(page,'/archive/Work')).toHaveAttribute('aria-checked','false');
	await page.screenshot({path:testInfo.outputPath('vault-switcher-desktop.png'),fullPage:true});
	await vaultRow(page,'/archive/Work').click();
	await expect.poll(async()=> (await snapshot(page)).active.path).toBe('/archive/Work');
	const state=await snapshot(page);
	expect(state.destroyed).toEqual([{locked:true,owner:'/notes/Work'}]);
	expect(state.editor.text).not.toContain('unsaved draft');
	expect(nativeOpens(state)).toHaveLength(1);
	expect(nativeOpens(state)[0].args).toEqual({path:'/archive/Work',requireExisting:true,expected:{path:'/notes/Work',bookmarkId:null}});
	expect(state.calls.some((call:any)=>call.command==='get_app_config')).toBe(false);
	await menu(page); await expect(vaultRow(page,'/archive/Work')).toHaveAttribute('aria-checked','true');
	await page.evaluate(()=>(window as any).vaultFixture.edit(' keep this draft'));
	const dirty=await snapshot(page);
	await vaultRow(page,'/archive/Work').click();
	expect((await snapshot(page)).editor.text).toBe(dirty.editor.text);
	expect((await snapshot(page)).editor.dirty).toBe(true);
	expect((await snapshot(page)).saves).toBe(dirty.saves);
});

test('save failure keeps the draft and editor and never starts native activation', async ({ page }) => {
	await page.evaluate(() => { const f=(window as any).vaultFixture; f.edit(' 日本語 😀'); f.failSave(true); (window as any).oldEditor=document.querySelector('.cm-content'); });
	const before=await snapshot(page);
	await menu(page); await vaultRow(page,'/archive/Work').click();
	await expect(page.getByRole('alert')).toContainText('could not be saved');
	const after=await snapshot(page);
	expect(after.active).toEqual(before.active); expect(after.editor.text).toBe(before.editor.text);
	expect(after.editor.dirty).toBe(true); expect(after.editor.readonly).toBe(false);
	expect(nativeOpens(after)).toHaveLength(0); expect(after.destroyed).toEqual([]);
	expect(await page.evaluate(()=>document.querySelector('.cm-content')===(window as any).oldEditor)).toBe(true);
});

test('unavailable destinations retain the current vault and allow retry without losing text', async ({ page }) => {
	await page.evaluate(() => { const f=(window as any).vaultFixture; f.edit(' safe text'); f.failOpen(true); });
	const text=(await snapshot(page)).editor.text;
	await menu(page); await vaultRow(page,'/archive/Work').click();
	await expect(page.getByRole('alert')).toContainText('Folder unavailable');
	const failed=await snapshot(page);
	expect(failed.active.path).toBe('/notes/Work'); expect(failed.editor.text).toBe(text);
	expect(failed.editor.readonly).toBe(false); expect(failed.destroyed).toEqual([]);
	await page.evaluate(()=>(window as any).vaultFixture.failOpen(false));
	await vaultRow(page,'/archive/Work').click();
	await expect.poll(async()=> (await snapshot(page)).active.path).toBe('/archive/Work');
	await menu(page); await vaultRow(page,'/notes/Work').click();
	await expect.poll(async()=> (await snapshot(page)).editor.text).toBe(text);
});

test('pending switches freeze interaction and reject overlapping requests', async ({ page }) => {
	await page.evaluate(()=>(window as any).vaultFixture.hold(true));
	await menu(page); await vaultRow(page,'/archive/Work').click();
	await expect.poll(async()=>nativeOpens(await snapshot(page)).length).toBe(1);
	await expect(page.getByRole('menuitemradio').first()).toBeDisabled();
	expect((await snapshot(page)).editor.readonly).toBe(true);
	expect(await page.evaluate(()=>(window as any).vaultFixture.switchToB())).toBe('busy');
	const before=(await snapshot(page)).editor.text;
	await page.keyboard.type('must not enter the frozen editor');
	expect((await snapshot(page)).editor.text).toBe(before);
	await page.evaluate(()=>(window as any).vaultFixture.release());
	await expect.poll(async()=> (await snapshot(page)).active.path).toBe('/archive/Work');
	expect(nativeOpens(await snapshot(page))).toHaveLength(1);
});

test('Add cancellation does not save, while choosing a folder registers it and switches', async ({ page }) => {
	await page.evaluate(()=>(window as any).vaultFixture.edit(' draft before folder picker'));
	const before=await snapshot(page);
	await menu(page); await page.getByRole('menuitem',{name:'Add vault…'}).click();
	await expect(page.getByRole('menu')).toHaveCount(0);
	const cancelled=await snapshot(page);
	expect(cancelled.active).toEqual(before.active); expect(cancelled.editor.text).toBe(before.editor.text);
	expect(cancelled.saves).toBe(0); expect(nativeOpens(cancelled)).toHaveLength(0);
	await page.evaluate(()=>(window as any).vaultFixture.folder('/notes/New vault'));
	await menu(page); await page.getByRole('menuitem',{name:'Add vault…'}).click();
	await expect(page.getByRole('button',{name:'Switch vault: New vault'})).toBeVisible();
	const opened=await snapshot(page);
	expect(nativeOpens(opened)[0].args.requireExisting).toBe(false);
	expect(opened.destroyed).toEqual([{locked:true,owner:'/notes/Work'}]);
});

test('Manage uses the save gate without activating another vault', async ({ page }) => {
	await page.evaluate(()=>(window as any).vaultFixture.edit(' saved before managing'));
	const before=(await snapshot(page)).editor.text;
	await menu(page); await page.getByRole('menuitem',{name:'Manage Vaults'}).click();
	await expect(page.getByRole('heading',{name:'Vault management fixture'})).toBeVisible();
	expect(nativeOpens(await snapshot(page))).toHaveLength(0);
	await page.evaluate(()=>(window as any).vaultFixture.back());
	await expect(page.locator('.cm-editor')).toBeVisible();
	expect((await snapshot(page)).editor.text).toBe(before);
});

test('keyboard navigation, type-ahead and dismissal do not drag or maximize the window', async ({ page }) => {
	const trigger=page.getByRole('button',{name:'Switch vault: Work'});
	await trigger.focus(); await page.keyboard.press('ArrowDown');
	await page.locator('.cm-scroller').evaluate(element=>element.dispatchEvent(new Event('scroll')));
	await expect(page.getByRole('menu')).toBeVisible();
	await expect(vaultRow(page,'/notes/Work')).toBeFocused();
	await page.keyboard.press('End'); await expect(page.getByRole('menuitem',{name:'Manage Vaults'})).toBeFocused();
	await page.keyboard.press('Home'); await page.keyboard.press('p');
	await expect(vaultRow(page,'/home/user/Notes/Personal')).toBeFocused();
	await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0); await expect(trigger).toBeFocused();
	await trigger.click(); await page.locator('section').click({position:{x:10,y:10}});
	await expect(page.getByRole('menu')).toHaveCount(0);
	expect((await snapshot(page)).calls.filter((call:any)=>/start_dragging|toggle_maximize/.test(call.command))).toHaveLength(0);
});

test('narrow dark layouts, long names and language changes retain readable menu paths', async ({ page },testInfo) => {
	await page.evaluate(()=>(window as any).vaultFixture.mobile());
	await page.setViewportSize({width:360,height:640});
	await page.evaluate(()=>(window as any).vaultFixture.dark());
	await menu(page);
	const bounds=await page.getByRole('menu').boundingBox();
	expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(360);
	await expect(vaultRow(page,'/long/very-long-vault-folder/with-a-distinct-location')).toBeVisible();
	const before=(await snapshot(page)).editor.text;
	await page.evaluate(()=>(window as any).vaultFixture.language('ru'));
	await expect(page.getByRole('menuitem',{name:'Добавить хранилище…'})).toBeVisible();
	expect((await snapshot(page)).editor.text).toBe(before);
	expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
	await page.screenshot({path:testInfo.outputPath('vault-switcher-phone-dark.png'),fullPage:true});
});

test('a long current name fits the real title bar at a narrow desktop width', async ({ page }) => {
	await menu(page);
	await vaultRow(page,'/long/very-long-vault-folder/with-a-distinct-location').click();
	await page.setViewportSize({width:640,height:640});
	await expect(page.getByRole('button',{name:/Switch vault: A very long vault name/})).toBeVisible();
	const right=await page.getByRole('button',{name:'Close',exact:true}).boundingBox();
	expect(right!.x+right!.width).toBeLessThanOrEqual(640);
	expect(await page.locator('.titlebar').evaluate(element=>element.scrollWidth)).toBeLessThanOrEqual(640);
});

test.describe('mobile vault selection',()=>{
	test.use({hasTouch:true,viewport:{width:390,height:844}});
	for(const platform of [{name:'Android',android:true,ios:false},{name:'iOS',android:false,ios:true}]){
		test(`${platform.name} keeps saved-vault switching and sends Add through mobile management`,async({page})=>{
			await page.addInitScript(flags=>Object.assign(window,{__HELIX_PLATFORM__:{mobile:true,...flags}}),{android:platform.android,ios:platform.ios});
			await page.reload();await expect(page.locator('.cm-editor')).toBeVisible();
			await page.evaluate(()=>(window as any).vaultFixture.edit(' mobile draft'));
			const text=(await snapshot(page)).editor.text;
			await page.getByRole('button',{name:'Switch vault: Work',exact:true}).tap();
			await vaultRow(page,'/archive/Work').tap();
			await expect.poll(async()=>(await snapshot(page)).active.path).toBe('/archive/Work');
			await page.getByRole('button',{name:'Switch vault: Work',exact:true}).tap();
			await vaultRow(page,'/notes/Work').tap();
			await expect.poll(async()=>(await snapshot(page)).editor.text).toBe(text);
			await page.getByRole('button',{name:'Switch vault: Work',exact:true}).tap();
			await page.getByRole('menuitem',{name:'Add vault…'}).tap();
			await expect(page.getByRole('heading',{name:'Vault management fixture'})).toBeVisible();
			expect((await snapshot(page)).calls.some((call:any)=>call.command==='plugin:dialog|open'||call.command.startsWith('mcp_'))).toBe(false);
		});
	}
});

test('security-scoped vaults restore by bookmark and accept a refreshed provider path', async ({ page }) => {
	await page.evaluate(()=>(window as any).vaultFixture.bookmarks());
	await menu(page); await page.getByRole('menuitemradio').filter({hasText:'Files B'}).click();
	await expect.poll(async()=> (await snapshot(page)).active).toEqual({path:'/resolved/book-b',bookmarkId:'book-b'});
	const state=await snapshot(page);
	expect(nativeOpens(state)[0]).toEqual({command:'restore_external_vault',args:{bookmarkId:'book-b',expected:{path:'/notes/Work',bookmarkId:null}}});
	await expect(page.getByRole('button',{name:'Switch vault: Files B'})).toBeVisible();
});
