// 用Playwright的真实鼠标操作（hover+click），而不是evaluate里的DOM click
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        const t = msg.text();
        if (msg.type() === 'error' && !t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
            console.log('  [page-' + msg.type() + ']', t.slice(0, 200));
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 先hover图片上传区域
    console.log('=== hover图片上传区域 ===');
    await page.hover('.image-selector__add');
    await page.waitForTimeout(800);

    // 截图看hover状态
    await page.screenshot({ path: path.join(DBG, 'poster_hover.png') });

    // 用Playwright的真实鼠标点击文字海报按钮
    // 注意：pop-opr__button文字是"文字海报"，在image-selector__add内
    const posterBtn = page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' });
    console.log('按钮count:', await posterBtn.count());

    if (await posterBtn.count() > 0) {
        // 检查可见性
        const visible = await posterBtn.first().isVisible();
        console.log('按钮可见:', visible);

        // hover到按钮上
        await posterBtn.first().hover();
        await page.waitForTimeout(500);

        console.log('点击按钮...');
        await posterBtn.first().click({ timeout: 10000 });
        console.log('点击完成');

        // 等待
        await page.waitForTimeout(5000);

        // 截图
        await page.screenshot({ path: path.join(DBG, 'poster_after_real_click.png'), fullPage: true });

        // 检查对话框
        const state = await page.evaluate(() => {
            const wrps = [...document.querySelectorAll('.weui-desktop-dialog__wrp')];
            const posterDialog = document.querySelector('.text_poster_dialog');
            return {
                wrpCount: wrps.length,
                wrps: wrps.map(w => ({
                    w: Math.round(w.getBoundingClientRect().width),
                    h: Math.round(w.getBoundingClientRect().height),
                    display: getComputedStyle(w).display,
                    text: w.textContent?.trim().slice(0, 200)
                })),
                posterDialogHTML: posterDialog?.innerHTML?.slice(0, 500) || 'null',
                posterDialogLen: posterDialog?.innerHTML?.length || 0
            };
        });
        console.log('\n点击后状态:');
        console.log('  wrpCount:', state.wrpCount);
        state.wrps.forEach(w => console.log('  wrp:', w.display, w.w+'x'+w.h, w.text?.slice(0,100)));
        console.log('  posterDialog len:', state.posterDialogLen);
        console.log('  posterDialog html:', state.posterDialogHTML?.slice(0, 300));

        if (state.wrpCount === 0 && state.posterDialogLen < 100) {
            // 还是不行，尝试mousedown/mouseup序列
            console.log('\n=== 尝试dispatchEvent触发click ===');
            await page.evaluate(() => {
                const imgAdd = document.querySelector('.image-selector__add');
                const btns = [...imgAdd.querySelectorAll('.pop-opr__button')];
                const posterBtn = btns.find(b => b.textContent?.trim() === '文字海报');
                if (posterBtn) {
                    // 触发mousedown、mouseup、click
                    const rect = posterBtn.getBoundingClientRect();
                    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2, button: 0 };
                    posterBtn.dispatchEvent(new MouseEvent('mousedown', opts));
                    posterBtn.dispatchEvent(new MouseEvent('mouseup', opts));
                    posterBtn.dispatchEvent(new MouseEvent('click', opts));
                    console.log('dispatched events on:', posterBtn.textContent);
                }
            });
            await page.waitForTimeout(5000);
            await page.screenshot({ path: path.join(DBG, 'poster_after_dispatch.png'), fullPage: true });

            const state2 = await page.evaluate(() => {
                const wrps = [...document.querySelectorAll('.weui-desktop-dialog__wrp')];
                return { wrpCount: wrps.length };
            });
            console.log('dispatchEvent后wrpCount:', state2.wrpCount);
        }
    }

    await browser.close();
})();
