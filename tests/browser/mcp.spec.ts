import { test, expect, type Page } from '@playwright/test';
let errors:string[];
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(()=>{expect(errors).toEqual([]);});
const settings=(page:Page)=>page.evaluate(()=>(window as any).mcpSettingsFixture.snapshot());
const editor=(page:Page)=>page.evaluate(()=>(window as any).mcpEditorFixture.snapshot());
const id='a'.repeat(32);

test('real Settings Integrations defaults off, enables read-only and copies a packaged configuration',async({page},testInfo)=>{
  await page.goto('/?fixture=mcp');
  const toggle=page.getByRole('switch',{name:'Allow MCP access to this vault'});
  await expect(toggle).toBeEnabled();await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('radio',{name:'Read-only',exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'Copy client configuration'})).toBeDisabled();
  await toggle.click();await expect(toggle).toBeChecked();
  expect((await settings(page)).mode).toBe('read');
  await page.getByRole('button',{name:'Copy client configuration'}).click();
  await expect(page.getByRole('status')).toContainText('Configuration copied');
  const copied=JSON.parse((await settings(page)).clipboard);
  expect(copied.mcpServers.helixnotes.command).toBe('/opt/HelixNotes/helixnotes');
  expect(copied.mcpServers.helixnotes.args[0]).toBe('--mcp-stdio');
  expect(JSON.stringify(copied)).not.toMatch(/secret|token|node_modules|\.mjs/);
  await page.screenshot({path:testInfo.outputPath('mcp-settings-desktop.png'),fullPage:true});
});

for (const platform of [{name:'Android',android:true,ios:false},{name:'iOS',android:false,ios:true}]) {
  test(`${platform.name} hides desktop MCP settings and never starts its listeners or native calls`,async({page})=>{
    const components:string[]=[];
    page.on('request',request=>{if(/\/McpSettings\.svelte(?:\?|$)/.test(request.url()))components.push(request.url());});
    await page.addInitScript(flags=>Object.assign(window,{__HELIX_PLATFORM__:{mobile:true,...flags}}),{android:platform.android,ios:platform.ios});
    await page.setViewportSize({width:390,height:844});
    await page.goto('/?fixture=mcp');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button',{name:'General',exact:true})).toHaveClass(/active/);
    await expect(page.getByRole('button',{name:'Integrations',exact:true})).toHaveCount(0);
    await expect(page.locator('.mcp-settings')).toHaveCount(0);
    expect(components).toEqual([]);
    await page.evaluate(()=>(window as any).mcpSettingsFixture.install());
    expect((await settings(page)).calls.filter((call:any)=>call.command.startsWith('mcp_'))).toEqual([]);
    await page.getByRole('button',{name:'Editor',exact:true}).click();
    await expect(page.getByRole('button',{name:'Editor',exact:true})).toHaveClass(/active/);
  });
}

test('editing needs confirmation and failed permission saves keep the previous grant selected',async({page})=>{
  await page.goto('/?fixture=mcp');const toggle=page.getByRole('switch',{name:'Allow MCP access to this vault'});await expect(toggle).toBeEnabled();await toggle.click();
  await page.getByRole('radio',{name:'Allow editing',exact:true}).click();
  await expect(page.getByRole('radio',{name:'Read-only',exact:true})).toBeChecked();
  expect((await settings(page)).calls.filter((call:any)=>call.command==='mcp_set_access'&&call.args.mode==='write')).toHaveLength(0);
  await page.evaluate(()=>{const f=(window as any).mcpSettingsFixture;f.confirm(true);f.fail(true);});
  await page.getByRole('radio',{name:'Allow editing',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Could not persist');
  await expect(page.getByRole('radio',{name:'Read-only',exact:true})).toBeChecked();
  await page.evaluate(()=>(window as any).mcpSettingsFixture.fail(false));
  await page.getByRole('radio',{name:'Allow editing',exact:true}).click();
  await expect(page.getByRole('radio',{name:'Allow editing',exact:true})).toBeChecked();
  await toggle.click();await expect(toggle).not.toBeChecked();expect((await settings(page)).mode).toBe('off');
});

test('saved-vault scope can revoke unavailable storage without switching the editor vault',async({page})=>{
  await page.goto('/?fixture=mcp');await expect(page.getByRole('switch')).toBeEnabled();await page.getByRole('switch').click();
  await page.evaluate(()=>(window as any).mcpSettingsFixture.offlineOther());
  await page.getByRole('combobox',{name:'Choose vault'}).click();await page.getByRole('option',{name:/Archive/}).click();
  await expect(page.getByRole('alert')).toContainText('Storage unavailable');await expect(page.getByRole('switch')).toBeChecked();
  await expect(page.getByRole('button',{name:'Copy client configuration'})).toBeDisabled();
  await page.getByRole('switch').click();await expect(page.getByRole('switch')).not.toBeChecked();
  const state=await settings(page);expect(state.mode).toBe('read');expect(state.modes['/offline/Archive']).toBe('off');
  expect(state.calls.filter((call:any)=>call.command==='mcp_set_access').at(-1).args.vault.path).toBe('/offline/Archive');
  expect(state.calls.some((call:any)=>/open_vault|choose_external_vault/.test(call.command))).toBe(false);
});

test('permission/help rows remain readable in a narrow dark translated layout',async({page},testInfo)=>{
  await page.goto('/?fixture=mcp');await expect(page.getByRole('switch')).toBeEnabled();
  await page.evaluate(()=>{const f=(window as any).mcpSettingsFixture;f.narrow();f.dark();f.language('ru');});
  await page.setViewportSize({width:360,height:740});
  await expect(page.getByRole('heading',{name:'Доступ через MCP'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const permission=await page.locator('fieldset').boundingBox();expect(permission!.width).toBeGreaterThan(280);
  await page.screenshot({path:testInfo.outputPath('mcp-settings-phone-dark.png'),fullPage:true});
});

test('production Editor freezes and reloads an MCP change without resetting its presentation or Edit/View choice',async({page})=>{
  await page.goto('/?fixture=mcp-editor');await expect(page.locator('.cm-content')).toContainText('Original body');
  await expect.poll(async()=>(await editor(page)).readonly).toBe(false);
  await page.evaluate(id=>(window as any).mcpEditorFixture.prepare(id),id);
  const frozen=await editor(page);expect(frozen.replies.at(-1).accepted).toBe(true);expect(frozen.busy).toBe(true);expect(frozen.pending).toBe(true);
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','false');
  await page.keyboard.type('must not be entered');expect((await editor(page)).body).toBe(frozen.body);
  await page.evaluate(id=>{const f=(window as any).mcpEditorFixture;f.changeDisk('# Note\n\nChanged by MCP\n');return f.finish(id);},id);
  await expect(page.locator('.cm-content')).toContainText('Changed by MCP');
  const done=await editor(page);expect(done.busy).toBe(false);expect(done.dirty).toBe(false);expect(done.readonly).toBe(false);expect(done.mode).toBe('source');
});

test('an empty Untitled note keeps Live preview after metadata changes instead of applying its new-note Rich preference',async({page})=>{
  await page.goto('/?fixture=mcp-editor');await expect(page.locator('.cm-content')).toContainText('Original body');
  await page.evaluate(()=>(window as any).mcpEditorFixture.emptyUntitled());
  await expect.poll(async()=>(await editor(page)).mode).toBe('live');
  // Switching through Rich text serializes an empty document with a trailing newline.
  await expect.poll(async()=>(await editor(page)).body).toMatch(/^\n?$/);
  await page.evaluate(id=>(window as any).mcpEditorFixture.prepare(id),id);expect((await editor(page)).replies.at(-1).accepted).toBe(true);
  await page.evaluate(async id=>{const f=(window as any).mcpEditorFixture;f.pinDisk();await f.finish(id);},id);
  const state=await editor(page);expect(state.mode).toBe('live');expect(state.readonly).toBe(false);expect(state.dirty).toBe(false);expect(state.raw).toContain('pinned: true');
});

test('production Editor rejects an MCP write while a source draft is dirty',async({page})=>{
  await page.goto('/?fixture=mcp-editor');await expect(page.locator('.cm-content')).toContainText('Original body');
  await page.locator('.cm-content').click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' unsaved draft');
  const before=await editor(page);expect(before.dirty).toBe(true);
  await page.evaluate(id=>(window as any).mcpEditorFixture.prepare(id),id);
  const after=await editor(page);expect(after.replies.at(-1).accepted).toBe(false);expect(after.body).toBe(before.body);expect(after.dirty).toBe(true);expect(after.busy).toBe(false);
});

test('an initial IME composition is refused without briefly making the editor inert',async({page})=>{
  await page.goto('/?fixture=mcp-editor');await expect(page.locator('.cm-content')).toContainText('Original body');
  await page.locator('.cm-content').evaluate(element=>element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));
  await page.evaluate(id=>(window as any).mcpEditorFixture.prepare(id),id);
  const state=await editor(page);expect(state.replies.at(-1).accepted).toBe(false);expect(state.busyValues).toEqual([false]);expect(state.body).toContain('Original body');
  await page.locator('.cm-content').evaluate(element=>element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''})));
});

test('an unchanged MCP finish does not reset the source undo history',async({page})=>{
  await page.goto('/?fixture=mcp-editor');await expect(page.locator('.cm-content')).toContainText('Original body');
  await page.locator('.cm-content').click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' saved addition');
  expect(await page.evaluate(()=>(window as any).mcpEditorFixture.save())).toBe(true);
  await page.evaluate(async id=>{const f=(window as any).mcpEditorFixture;await f.prepare(id);await f.finish(id);},id);
  await page.locator('.cm-content').click();await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async()=>(await editor(page)).body).not.toContain('saved addition');
});
