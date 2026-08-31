// 等待Vue组件异步加载对话框内容，尝试不同触发方式
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 监听网络请求，看看文字海报需要预加载什么
    const apiCalls = [];
    page.on('response', async res => {
        const url = res.url();
        if (url.includes('poster') || url.includes('text_poster')) {
            try {
                const body = await res.text().catch(() => '');
                apiCalls.push({ url: url.slice(0, 150), status: res.status(), bodyPreview: body.slice(0, 300) });
            } catch (e) {}
        }
    });

    // 先调用 _prefetchTextPoster
    console.log('=== 调用 _prefetchTextPoster 预加载 ===');
    await page.evaluate(() => {
        const imgSelector = document.querySelector('.image-selector');
        if (imgSelector?.__vue__?._prefetchTextPoster) {
            imgSelector.__vue__._prefetchTextPoster();
        }
    });
    await page.waitForTimeout(3000);
    console.log('预加载API调用:', JSON.stringify(apiCalls, null, 2));

    // 再调用 onAddByTextPoster
    console.log('\n=== 调用 onAddByTextPoster 打开对话框 ===');
    await page.evaluate(() => {
        const imgSelector = document.querySelector('.image-selector');
        if (imgSelector?.__vue__) {
            imgSelector.__vue__.onAddByTextPoster();
        }
    });

    // 等待对话框内容加载（可能异步）
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const dlgContent = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            return {
                childCount: dlg?.children.length || 0,
                htmlLen: dlg?.innerHTML?.length || 0,
                hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
                text: dlg?.textContent?.trim().slice(0, 200)
            };
        });
        console.log(`等待 ${i+1}s: children=${dlgContent.childCount} htmlLen=${dlgContent.htmlLen} hasDialog=${dlgContent.hasDialog} text=${dlgContent.text?.slice(0, 50)}`);
        if (dlgContent.hasDialog || dlgContent.htmlLen > 500) break;
    }

    await page.screenshot({ path: path.join(DBG, 'poster_after_prefetch.png'), fullPage: false });

    // 获取对话框完整内容
    const fullDialog = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        if (!dlg) return { found: false };
        const wdDialog = dlg.querySelector('.weui-desktop-dialog');
        return {
            found: true,
            html: dlg.innerHTML.slice(0, 8000),
            wdDialogHTML: wdDialog?.innerHTML?.slice(0, 5000),
            text: dlg.textContent?.trim().slice(0, 500)
        };
    });
    console.log('\n对话框内容:', fullDialog.text);
    if (fullDialog.wdDialogHTML) {
        console.log('dialog HTML [0..3000]:', fullDialog.wdDialogHTML.slice(0, 3000));
    }

    // 如果对话框还没加载，尝试直接点击按钮（不用坐标，用locator）
    const dlgCheck = await page.evaluate(() => {
        return document.querySelector('.text_poster_dialog .weui-desktop-dialog') !== null;
    });
    if (!dlgCheck) {
        console.log('\n=== Vue方法无效，尝试真实点击 ===');
        // 用Playwright locator点击
        await page.locator('.pop-opr__list .pop-opr__item').filter({ hasText: '文字海报' }).locator('.pop-opr__button').click({ timeout: 5000 }).catch(e => console.log('点击失败:', e.message));
        await page.waitForTimeout(5000);

        const dlgAfter = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            return {
                htmlLen: dlg?.innerHTML?.length || 0,
                hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
                text: dlg?.textContent?.trim().slice(0, 300)
            };
        });
        console.log('真实点击后:', dlgAfter);
        await page.screenshot({ path: path.join(DBG, 'poster_real_click.png'), fullPage: false });
    }

    await browser.close();
})();
