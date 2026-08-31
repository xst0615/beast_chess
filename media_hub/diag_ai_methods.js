// 用 click（非 hover）打开封面下拉菜单，再触发 AI 配图
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

    // 只填标题
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面');

    console.log('=== 方法1: click 封面区域打开下拉 ===');
    // 用 text 选择器点击封面区域
    const coverText = editor.locator('text=拖拽或选择封面').first();
    const coverTextCount = await coverText.count();
    console.log('text=拖拽或选择封面 数量:', coverTextCount);

    if (coverTextCount > 0) {
        await coverText.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await editor.waitForTimeout(500);
        await coverText.click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(1000);

        // 检查 AI 项是否可见
        const aiVisible = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
        console.log('AI 菜单项可见:', aiVisible);

        // 截图
        await editor.screenshot({ path: path.join(DBG, 'ai_method1_after_click.png') });

        // 用 evaluate click AI 项
        await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
        await editor.waitForTimeout(3000);

        const dialogInfo = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { exists: false };
            const r = wrp.getBoundingClientRect();
            return { visible: r.width > 0 && r.height > 0, display: getComputedStyle(wrp).display, text: wrp.textContent?.slice(0, 80) };
        });
        console.log('对话框:', JSON.stringify(dialogInfo, null, 2));
        await editor.screenshot({ path: path.join(DBG, 'ai_method1_dialog.png') });
    }

    // 如果方法1失败，尝试方法2: 直接用 Playwright 点击 .js_cover_opr 区域
    console.log('\n=== 方法2: 点击 .js_cover_opr ===');
    const coverOp = editor.locator('.js_cover_opr').first();
    const coverOpCount = await coverOp.count();
    console.log('.js_cover_opr 数量:', coverOpCount);
    if (coverOpCount > 0) {
        const opInfo = await coverOp.evaluate(el => {
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height, display: getComputedStyle(el).display };
        }).catch(() => 'err');
        console.log('.js_cover_opr 信息:', JSON.stringify(opInfo));

        // 用 Playwright 直接 click
        await coverOp.click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(1000);
        const aiVisible2 = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
        console.log('AI 菜单项可见:', aiVisible2);
        await editor.screenshot({ path: path.join(DBG, 'ai_method2_after_click.png') });
    }

    // 方法3: 用 Playwright 直接 click .js_img_from_ai (force)
    console.log('\n=== 方法3: force click .js_img_from_ai ===');
    await editor.locator('.js_img_from_ai').first().click({ force: true, timeout: 5000 }).catch(e => console.log('force click 失败:', e.message.split('\n')[0]));
    await editor.waitForTimeout(3000);
    const dialogInfo3 = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { exists: false };
        const r = wrp.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0, display: getComputedStyle(wrp).display, text: wrp.textContent?.slice(0, 80) };
    });
    console.log('对话框:', JSON.stringify(dialogInfo3, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'ai_method3_dialog.png') });

    await browser.close();
})();
