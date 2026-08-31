// 对比测试：不粘贴内容 vs 粘贴内容，看 AI 对话框是否能打开
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

    // 只填标题，不粘贴内容
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面');

    console.log('=== 不粘贴内容，直接 hover + click ===');

    // 使用正确的 CSS 选择器
    const coverArea = editor.locator('#js_cover_null').first();
    const coverCount = await coverArea.count();
    console.log('coverArea (#js_cover_null) 数量:', coverCount);

    if (coverCount > 0) {
        await coverArea.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await editor.waitForTimeout(500);
        await coverArea.hover({ timeout: 5000 }).catch(e => console.log('hover 失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(800);

        // 检查 AI 菜项是否可见
        const aiVisible = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
        console.log('AI 菜单项可见:', aiVisible);

        // 点击
        await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
        await editor.waitForTimeout(3000);

        // 检查对话框
        const dialogInfo = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { exists: false };
            const r = wrp.getBoundingClientRect();
            const style = getComputedStyle(wrp);
            return {
                visible: r.width > 0 && r.height > 0,
                display: style.display,
                text: wrp.textContent?.slice(0, 80),
            };
        });
        console.log('对话框:', JSON.stringify(dialogInfo, null, 2));
        await editor.screenshot({ path: path.join(DBG, 'ai_nopaste_test.png') });
    } else {
        // 尝试其他选择器
        const alt1 = await editor.locator('.js_cover_opr').count();
        const alt2 = await editor.locator('.setting-group__cover').count();
        const alt3 = await editor.locator('text=拖拽或选择封面').count();
        console.log(`备选: .js_cover_opr=${alt1}, .setting-group__cover=${alt2}, text=拖拽或选择封面=${alt3}`);

        // 用文本选择器
        const textCover = editor.locator('text=拖拽或选择封面').first();
        if (alt3 > 0) {
            await textCover.hover({ timeout: 5000 }).catch(e => console.log('text hover 失败:', e.message.split('\n')[0]));
            await editor.waitForTimeout(800);
            const aiVisible = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
            console.log('AI 菜单项可见:', aiVisible);
            await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
            await editor.waitForTimeout(3000);
            const dialogInfo = await editor.evaluate(() => {
                const wrp = document.querySelector('.weui-desktop-dialog__wrp');
                if (!wrp) return { exists: false };
                const r = wrp.getBoundingClientRect();
                return { visible: r.width > 0 && r.height > 0, display: getComputedStyle(wrp).display, text: wrp.textContent?.slice(0, 80) };
            });
            console.log('对话框:', JSON.stringify(dialogInfo, null, 2));
            await editor.screenshot({ path: path.join(DBG, 'ai_nopaste_text.png') });
        }
    }

    await browser.close();
})();
