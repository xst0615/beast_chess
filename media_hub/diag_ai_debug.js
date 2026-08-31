// 精确复现实际发布流程，调试 AI 配图对话框
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

    // 填标题
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('AI封面测试');
    // 填正文（和实际流程完全一致）
    const bodyEditor = editor.locator('.ProseMirror').nth(1);
    await bodyEditor.waitFor({ state: 'visible', timeout: 15000 });
    await bodyEditor.click();
    const html = '<p>测试 AI 生成封面。</p>';
    await editor.evaluate((htmlContent) => {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([item]);
    }, html);
    await editor.waitForTimeout(300);
    await editor.keyboard.press('Meta+V');
    await editor.waitForTimeout(1500);

    console.log('=== 正文已粘贴，开始 AI 配图 ===');

    // 滚动到封面区域
    const coverArea = editor.locator('#js_cover_null, .js_cover_opr, .setting-group__cover, text=拖拽或选择封面').first();
    await coverArea.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await editor.waitForTimeout(500);

    // 检查 coverArea 状态
    const coverInfo = await coverArea.evaluate(el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { tag: el.tagName, class: el.className, visible: r.width > 0 && r.height > 0, size: `${r.width}x${r.height}`, display: style.display, visibility: style.visibility };
    }).catch(() => 'error');
    console.log('封面区域信息:', JSON.stringify(coverInfo));

    // hover
    await coverArea.hover({ timeout: 5000 }).catch(e => console.log('hover 失败:', e.message.split('\n')[0]));
    await editor.waitForTimeout(800);

    // 检查 AI 菜单项是否可见
    const aiVisible = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
    console.log('AI 菜单项是否可见:', aiVisible);

    // 检查下拉菜单状态
    const menuInfo = await editor.evaluate(() => {
        const ai = document.querySelector('.js_img_from_ai');
        if (!ai) return null;
        const r = ai.getBoundingClientRect();
        const style = getComputedStyle(ai);
        const parent = ai.closest('.pop-opr__list, .tpl_dropdown_menu, [class*="dropdown"]');
        const parentInfo = parent ? { class: parent.className, display: getComputedStyle(parent).display, visibility: getComputedStyle(parent).visibility } : null;
        return { visible: r.width > 0 && r.height > 0, size: `${r.width}x${r.height}`, display: style.display, visibility: style.visibility, parent: parentInfo };
    });
    console.log('AI 菜单项信息:', JSON.stringify(menuInfo, null, 2));

    // 点击
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);

    // 检查对话框是否出现
    const dialogInfo = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { exists: false };
        const r = wrp.getBoundingClientRect();
        const style = getComputedStyle(wrp);
        return {
            exists: true,
            visible: r.width > 0 && r.height > 0,
            size: `${r.width}x${r.height}`,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            class: wrp.className,
            text: wrp.textContent?.slice(0, 100),
        };
    });
    console.log('对话框信息:', JSON.stringify(dialogInfo, null, 2));

    await editor.screenshot({ path: path.join(DBG, 'ai_debug_after_click.png') });

    // 尝试另一种方法：直接找到 AI 配图按钮并 Playwright click
    if (!dialogInfo.visible) {
        console.log('\n=== 对话框未出现，尝试 Playwright click ===');
        // 先 hover 确保下拉菜单打开
        await coverArea.hover({ timeout: 5000 }).catch(() => {});
        await editor.waitForTimeout(800);
        // 用 Playwright click force:true
        await editor.locator('.js_img_from_ai').first().click({ force: true, timeout: 5000 }).catch(e => console.log('force click 失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(3000);

        const dialogInfo2 = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { exists: false };
            const r = wrp.getBoundingClientRect();
            const style = getComputedStyle(wrp);
            return { visible: r.width > 0 && r.height > 0, display: style.display, visibility: style.visibility, opacity: style.opacity, text: wrp.textContent?.slice(0, 100) };
        });
        console.log('第二次对话框信息:', JSON.stringify(dialogInfo2, null, 2));
        await editor.screenshot({ path: path.join(DBG, 'ai_debug_force_click.png') });
    }

    await browser.close();
})();
