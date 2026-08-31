// 移除残留对话框后再触发 AI 配图
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

    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面');

    // 1. 移除所有残留的对话框 wrapper
    console.log('=== 移除残留对话框 ===');
    const removed = await editor.evaluate(() => {
        const wrps = document.querySelectorAll('.weui-desktop-dialog__wrp');
        const count = wrps.length;
        wrps.forEach(w => w.remove());
        return count;
    });
    console.log(`移除了 ${removed} 个对话框 wrapper`);

    // 2. 找到封面区域交互入口 - 用 js_share_type_none_image
    console.log('\n=== 点击封面交互区 ===');
    const coverBtn = editor.locator('.js_share_type_none_image').first();
    const coverBtnInfo = await coverBtn.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, text: el.textContent };
    }).catch(() => 'err');
    console.log('封面按钮信息:', JSON.stringify(coverBtnInfo));

    // 点击封面按钮
    await coverBtn.click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
    await editor.waitForTimeout(1500);

    // 检查 AI 菜单项是否可见
    const aiVisible = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
    console.log('AI 菜单项可见:', aiVisible);
    await editor.screenshot({ path: path.join(DBG, 'ai_clean_click.png') });

    // 3. 尝试点击 AI 配图
    if (aiVisible) {
        console.log('\n=== 点击 AI 配图 ===');
        await editor.locator('.js_img_from_ai').first().click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
    } else {
        // 直接用 evaluate 点击
        console.log('\n=== evaluate click AI 配图 ===');
        await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    }
    await editor.waitForTimeout(3000);

    // 检查对话框
    const dialogInfo = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { exists: false };
        const r = wrp.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0, display: getComputedStyle(wrp).display, text: wrp.textContent?.slice(0, 80) };
    });
    console.log('对话框:', JSON.stringify(dialogInfo, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'ai_clean_dialog.png') });

    // 4. 如果还是不行，尝试找 .add_cover 图标按钮
    if (!dialogInfo.visible) {
        console.log('\n=== 尝试 .add_cover 图标 ===');
        const addCover = editor.locator('.add_cover').first();
        const acCount = await addCover.count();
        console.log('.add_cover 数量:', acCount);
        if (acCount > 0) {
            const acInfo = await addCover.evaluate(el => {
                const r = el.getBoundingClientRect();
                return { w: r.width, h: r.height };
            }).catch(() => 'err');
            console.log('图标信息:', JSON.stringify(acInfo));
            await addCover.click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
            await editor.waitForTimeout(1500);
            const aiV2 = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
            console.log('AI 菜单项可见:', aiV2);
            await editor.screenshot({ path: path.join(DBG, 'ai_addcover_click.png') });

            if (aiV2) {
                await editor.locator('.js_img_from_ai').first().click({ timeout: 5000 });
                await editor.waitForTimeout(3000);
                const di = await editor.evaluate(() => {
                    const wrp = document.querySelector('.weui-desktop-dialog__wrp');
                    if (!wrp) return { exists: false };
                    const r = wrp.getBoundingClientRect();
                    return { visible: r.width > 0 && r.height > 0, text: wrp.textContent?.slice(0, 80) };
                });
                console.log('对话框:', JSON.stringify(di, null, 2));
                await editor.screenshot({ path: path.join(DBG, 'ai_addcover_dialog.png') });
            }
        }
    }

    await browser.close();
})();
