// 尝试强制点击文字海报按钮 + 直接设置Vue属性触发渲染
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
        if (t.includes('poster') || t.includes('Poster') || msg.type() === 'error') {
            console.log(`  [page-${msg.type()}]`, t.slice(0, 200));
        }
    });

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

    await page.screenshot({ path: path.join(DBG, 'poster_before_force_click.png') });

    // 方式1: 强制点击文字海报按钮
    console.log('=== 方式1: force: true 点击 ===');
    try {
        await page.locator('.pop-opr__button', { hasText: '文字海报' }).first().click({ force: true, timeout: 5000 });
        console.log('force点击成功');
    } catch(e) {
        console.log('force点击失败:', e.message);
    }
    await page.waitForTimeout(3000);

    let dlgState = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        return {
            htmlLen: dlg?.innerHTML?.length || 0,
            hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
            text: dlg?.textContent?.trim().slice(0, 200)
        };
    });
    console.log('点击后状态:', dlgState);
    await page.screenshot({ path: path.join(DBG, 'poster_after_force_click.png') });

    // 方式2: 通过image-selector区域hover后再点击
    if (!dlgState.hasDialog) {
        console.log('\n=== 方式2: hover图片区域后点击 ===');
        await page.hover('.image-selector__add');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(DBG, 'poster_hover.png') });
        try {
            await page.locator('.image-selector .pop-opr__button', { hasText: '文字海报' }).first().click({ force: true, timeout: 5000 });
            console.log('hover后点击成功');
        } catch(e) {
            console.log('hover后点击失败:', e.message);
        }
        await page.waitForTimeout(3000);
        dlgState = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            return {
                htmlLen: dlg?.innerHTML?.length || 0,
                hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
                text: dlg?.textContent?.trim().slice(0, 200)
            };
        });
        console.log('hover后状态:', dlgState);
        await page.screenshot({ path: path.join(DBG, 'poster_after_hover_click.png') });
    }

    // 方式3: 直接调用onAddByTextPoster但用$nextTick确保更新
    if (!dlgState.hasDialog) {
        console.log('\n=== 方式3: Vue $set + $nextTick ===');
        await page.evaluate(async () => {
            const imgVm = document.querySelector('.image-selector')?.__vue__;
            // 先预加载
            if (imgVm?._prefetchTextPoster) {
                await imgVm._prefetchTextPoster();
            }
            // 调用 onAddByTextPoster
            if (imgVm?.onAddByTextPoster) {
                try {
                    const ret = imgVm.onAddByTextPoster();
                    if (ret instanceof Promise) await ret;
                } catch(e) {
                    console.log('onAddByTextPoster error:', e.message);
                }
            }
        });
        // 等待多个$nextTick
        for (let i = 0; i < 10; i++) {
            await page.waitForTimeout(500);
            dlgState = await page.evaluate(() => {
                const dlg = document.querySelector('.text_poster_dialog');
                return {
                    htmlLen: dlg?.innerHTML?.length || 0,
                    hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
                    childCount: dlg?.children.length || 0
                };
            });
            if (dlgState.hasDialog) break;
        }
        console.log('Vue方法后状态:', dlgState);
    }

    // 方式4: 检查text_poster_dialog的子组件是否在transfer/teleport中
    if (!dlgState.hasDialog) {
        console.log('\n=== 方式4: 查找dialog位置 ===');
        const dialogLocation = await page.evaluate(() => {
            // 搜索所有weui-desktop-dialog
            const allDialogs = [...document.querySelectorAll('.weui-desktop-dialog, [class*="text_poster"]')];
            return allDialogs.map(d => ({
                class: d.className?.toString().slice(0, 100),
                text: d.textContent?.trim().slice(0, 100),
                visible: d.offsetParent !== null,
                parentClass: d.parentElement?.className?.toString().slice(0, 80),
                rect: { top: Math.round(d.getBoundingClientRect().top), left: Math.round(d.getBoundingClientRect().left) }
            }));
        });
        console.log('所有dialog:', JSON.stringify(dialogLocation, null, 2));
    }

    await page.screenshot({ path: path.join(DBG, 'poster_final.png'), fullPage: true });

    await browser.close();
})();
