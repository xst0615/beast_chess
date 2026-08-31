// 点击"AI 配图"探测 AI 封面生成流程
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN' });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);

    await page.locator('text=新的创作').first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
    await page.locator('text="文章"').first().click({ timeout: 10000 });
    const editor = await popupPromise;
    await editor.waitForLoadState('domcontentloaded');
    await editor.waitForTimeout(5000);

    // 填标题（AI 配图可能需要标题作为生成提示词）
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('AI编程入门指南');

    // 悬停在封面区域上保持下拉菜单可见，然后点击"AI 配图"
    const coverArea = editor.locator('#js_cover_null, .js_cover_opr, text=拖拽或选择封面').first();
    await coverArea.hover({ timeout: 5000 }).catch(() => {});
    await editor.waitForTimeout(800);
    // AI 配图菜单项 class 是 js_img_from_ai，用 force click 绕过可见性检查
    console.log('=== 点击"AI 配图" ===');
    await editor.locator('.js_img_from_ai').first().click({ timeout: 5000, force: true }).catch(async (e) => {
        console.log('force click 失败，尝试 evaluate 直接点击:', e.message.split('\n')[0]);
        await editor.evaluate(() => {
            const el = document.querySelector('.js_img_from_ai');
            if (el) el.click();
        }).catch(() => {});
    });
    await editor.waitForTimeout(3000);
    await editor.screenshot({ path: path.join(DBG, 'ai_cover_step1.png') });

    // 查看弹窗/面板内容
    const panel = await editor.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="panel"], [class*="ai"], [class*="cover"]')];
        return dialogs.filter(el => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 100 && r.height > 100 && style.display !== 'none' && style.visibility !== 'hidden';
        }).map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 100) || '',
            text: el.textContent?.trim().slice(0, 300) || '',
        }));
    });
    console.log('=== 可见面板 ===');
    panel.forEach((p, i) => console.log(`${i}. [${p.tag}] class="${p.class}"\n   text="${p.text}"\n`));

    // 查找输入框、按钮
    const inputs = await editor.evaluate(() => {
        return [...document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"], button, a[class*="btn"]')].filter(el => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.display !== 'none';
        }).map(el => ({
            tag: el.tagName,
            type: el.type || '',
            class: el.className?.toString().slice(0, 60) || '',
            placeholder: el.placeholder || '',
            text: el.textContent?.trim().slice(0, 40) || '',
        }));
    });
    console.log('=== 可见输入/按钮 ===');
    inputs.forEach((e, i) => console.log(`${i}. [${e.tag}${e.type}] class="${e.class}" ph="${e.placeholder}" text="${e.text}"`));

    await browser.close();
})();
