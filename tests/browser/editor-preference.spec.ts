import { test, expect } from '@playwright/test';
let errors:string[];
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/?fixture=preference');await expect(page.getByRole('radiogroup')).toBeVisible();});
test.afterEach(()=>{expect(errors).toEqual([]);});

test('Rich text is selected by default and all three choices persist without changing the current editor',async({page})=>{
  await expect(page.getByRole('radio',{name:'Rich text',exact:true})).toBeChecked();
  for(const [label,mode] of [['Live preview','live'],['Markdown source','source'],['Rich text','rich']]){
    await page.getByRole('radio',{name:label,exact:true}).check();
    await expect(page.getByRole('radio',{name:label,exact:true})).toBeChecked();
    await page.evaluate(()=>(window as any).preferenceFixture.restart());
    await expect(page.getByRole('radio',{name:label,exact:true})).toBeChecked();
    const state=await page.evaluate(()=>(window as any).preferenceFixture.snapshot());
    expect(state.mode).toBe(mode);expect(state.currentEditor).toBe('live');
  }
});

test('legacy Source preference migrates and failed saves keep the previously saved button selected',async({page})=>{
  await page.evaluate(()=>(window as any).preferenceFixture.legacy(true));
  await expect(page.getByRole('radio',{name:'Markdown source',exact:true})).toBeChecked();
  await page.evaluate(()=>(window as any).preferenceFixture.fail(true));
  await page.getByRole('radio',{name:'Live preview',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Disk full');
  await expect(page.getByRole('radio',{name:'Markdown source',exact:true})).toBeChecked();
  await page.evaluate(()=>(window as any).preferenceFixture.fail(false));
  await page.getByRole('radio',{name:'Rich text',exact:true}).check();
  await expect(page.getByRole('radio',{name:'Rich text',exact:true})).toBeChecked();
});

test('native radio keyboard navigation saves the next mode and the group fits longer translations on phones',async({page},testInfo)=>{
  await page.getByRole('radio',{name:'Rich text',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio',{name:'Live preview',exact:true})).toBeChecked();
  await expect(page.getByRole('radio',{name:'Live preview',exact:true})).toBeFocused();
  await page.setViewportSize({width:360,height:640});
  await page.evaluate(()=>(window as any).preferenceFixture.language('pt-PT'));
  const bounds=await page.getByRole('radiogroup').boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(360);
  const copy=await page.locator('.preference-copy').boundingBox();
  expect(copy!.width).toBeGreaterThanOrEqual(bounds!.width);
  expect(copy!.y+copy!.height).toBeLessThan(bounds!.y);
  expect((await page.locator('.preference-name').boundingBox())!.height).toBeLessThan(40);
  expect((await page.locator('.preference-description').boundingBox())!.height).toBeLessThan(100);
  await page.screenshot({path:testInfo.outputPath('editor-mode-buttons-phone.png'),fullPage:true});
});
