// 精确诊断文字海报：通过详细DOM分析找到正确按钮并点击
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
    await page.keyboard.type('测试文字海报功能');
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(DBG, 'poster_initial.png'), fullPage: true });

    // 获取所有"文字海报"按钮的详细信息
    const posterDetails = await page.evaluate(() => {
        const allBtns = [...document.querySelectorAll('a, button, span')];
        const results = [];
        for (const btn of allBtns) {
            if (btn.textContent?.trim() === '文字海报') {
                const rect = btn.getBoundingClientRect();
                // 获取从按钮到body的完整祖先链
                let ancestors = [];
                let el = btn;
                for (let i = 0; i < 8 && el; i++) {
                    ancestors.push({
                        tag: el.tagName,
                        class: el.className?.toString().slice(0, 80),
                        id: el.id
                    });
                    el = el.parentElement;
                }
                results.push({
                    tag: btn.tagName,
                    class: btn.className?.toString(),
                    id: btn.id,
                    href: btn.href,
                    visible: btn.offsetParent !== null,
                    rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                    onclick: btn.getAttribute('onclick'),
                    ancestors: ancestors
                });
            }
        }
        return results;
    });
    console.log('"文字海报"按钮详情:');
    posterDetails.forEach((b, i) => {
        console.log(`\n按钮 ${i}:`, JSON.stringify(b, null, 2));
    });

    // 查找 js_posterImage 或 poster 相关class
    const posterClasses = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[class*="poster"], [class*="Poster"], [class*="text-poster"], [data-action*="poster"]').forEach(el => {
            results.push({
                tag: el.tagName,
                class: el.className?.toString().slice(0, 100),
                text: el.textContent?.trim().slice(0, 40),
                visible: el.offsetParent !== null
            });
        });
        return results;
    });
    console.log('\nposter相关class元素:', JSON.stringify(posterClasses, null, 2));

    // 查找图片上传区域的wrapper，看里面有什么操作按钮
    const uploadWrapper = await page.evaluate(() => {
        // 找包含"本地上传"和"文字海报"的容器
        const localBtn = [...document.querySelectorAll('.pop-opr__button')].find(b => b.textContent?.trim() === '本地上传' && b.offsetParent !== null);
        if (!localBtn) return null;
        // 找到上传区域的根容器
        let container = localBtn;
        for (let i = 0; i < 10; i++) {
            container = container.parentElement;
            if (!container) break;
            if (container.classList?.contains('weui-desktop-upload__btn__wrp') ||
                container.className?.includes('upload') && container.className?.includes('wrp')) break;
        }
        // 获取这个容器的兄弟/同级中的操作按钮
        const wrp = container?.closest('[class*="upload"]') || container?.parentElement?.parentElement;
        return {
            containerClass: wrp?.className?.toString(),
            containerHTML: wrp?.innerHTML?.slice(0, 3000),
            // 这个容器下的所有可见按钮
            buttons: [...(wrp?.querySelectorAll('a, button') || [])].map(b => ({
                text: b.textContent?.trim().slice(0, 20),
                class: b.className?.toString().slice(0, 80),
                visible: b.offsetParent !== null
            })).filter(b => b.text && b.text.length < 20)
        };
    });
    console.log('\n图片上传区域:', JSON.stringify(uploadWrapper, null, 2));

    // 精确点击图片区域的"文字海报"按钮——用坐标点击
    const visiblePosterBtns = posterDetails.filter(b => b.visible && b.rect.top > 100);
    if (visiblePosterBtns.length > 0) {
        // 选择在图片区域的那个（y坐标最大的，因为在图片区下方）
        const btn = visiblePosterBtns.sort((a, b) => b.rect.top - a.rect.top)[0];
        console.log('\n点击按钮:', btn.rect, btn.class);
        await page.mouse.click(btn.rect.left + btn.rect.w / 2, btn.rect.top + btn.rect.h / 2);
        await page.waitForTimeout(3000);

        await page.screenshot({ path: path.join(DBG, 'poster_after_precise_click.png'), fullPage: false });

        // 检查对话框
        const dialog = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('.weui-desktop-dialog__wrp, [class*="dialog"]');
            for (const d of dialogs) {
                const rect = d.getBoundingClientRect();
                if (rect.width > 300 && rect.height > 200 && d.offsetParent !== null) {
                    return {
                        class: d.className?.toString().slice(0, 100),
                        text: d.textContent?.trim().slice(0, 500),
                        btns: [...d.querySelectorAll('button, a, [class*="btn"]')].map(b => ({
                            text: b.textContent?.trim().slice(0, 20),
                            class: b.className?.toString().slice(0, 60)
                        })).filter(b => b.text && b.text.length < 20)
                    };
                }
            }
            return null;
        });
        console.log('\n弹出对话框:', JSON.stringify(dialog, null, 2));
    }

    await browser.close();
})();
