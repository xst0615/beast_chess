// 深入诊断文字海报功能——查看点击后的完整DOM结构
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

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    // 填正文
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报功能');
    await page.waitForTimeout(500);

    // 查找所有 pop-opr 按钮及其内容
    console.log('=== pop-opr 区域所有按钮 ===');
    const oprBtns = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.pop-opr__button, [class*="pop-opr"] a, [class*="pop-opr"] button').forEach(el => {
            results.push({
                tag: el.tagName,
                text: el.textContent?.trim().slice(0, 30),
                class: el.className?.toString().slice(0, 80),
                href: el.href?.slice(0, 80),
                visible: el.offsetParent !== null
            });
        });
        return results;
    });
    console.log(JSON.stringify(oprBtns, null, 2));

    // 查找文字海报按钮的父元素区域
    console.log('\n=== 文字海报按钮附近结构 ===');
    const posterBtnContext = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(el => el.textContent?.trim() === '文字海报');
        if (!btn) return 'not found';
        const parent = btn.closest('[class*="opr"]') || btn.parentElement?.parentElement;
        return {
            parentClass: parent?.className?.toString(),
            parentHTML: parent?.innerHTML?.slice(0, 2000),
            siblingBtns: [...parent?.querySelectorAll('a, button') || []].map(el => ({
                text: el.textContent?.trim().slice(0, 30),
                class: el.className?.toString().slice(0, 60)
            }))
        };
    });
    console.log(JSON.stringify(posterBtnContext, null, 2));

    // 查找图片插入区域——文字海报可能在图片操作区
    console.log('\n=== 图片区域相关按钮 ===');
    const imgBtns = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[class*="upload"] *, [class*="image"] *, [class*="img"] *, [class*="cover"] *, [class*="pic"] *').forEach(el => {
            if (el.children.length === 0 && el.textContent?.trim() && el.getBoundingClientRect().width > 10) {
                const txt = el.textContent.trim().slice(0, 30);
                if (txt.length < 15 && el.offsetParent !== null) {
                    results.push({ tag: el.tagName, text: txt, class: el.className?.toString().slice(0, 60) });
                }
            }
        });
        return [...new Set(results.map(r => JSON.stringify(r)))].map(r => JSON.parse(r)).slice(0, 30);
    });
    console.log(JSON.stringify(imgBtns, null, 2));

    // 先截图看当前状态
    await page.screenshot({ path: path.join(DBG, 'poster_explore_1.png'), fullPage: false });

    // 点击文字海报
    console.log('\n=== 点击文字海报按钮 ===');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(el => el.textContent?.trim() === '文字海报');
        btn?.click();
    });
    await page.waitForTimeout(3000);

    // 看弹出的内容完整HTML
    const popupHTML = await page.evaluate(() => {
        const popups = document.querySelectorAll('[class*="popup"], [class*="dialog"], [class*="modal"], [class*="editor_popup"]');
        const results = [];
        for (const p of popups) {
            const rect = p.getBoundingClientRect();
            if (rect.width > 200 && rect.height > 100 && p.offsetParent !== null) {
                results.push({
                    class: p.className?.toString().slice(0, 100),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    text: p.textContent?.trim().slice(0, 500),
                    html: p.innerHTML?.slice(0, 3000)
                });
            }
        }
        return results;
    });
    console.log('\n弹出窗口数量:', popupHTML.length);
    popupHTML.forEach((p, i) => {
        console.log(`\n--- 弹窗 ${i+1} (${p.class}) ---`);
        console.log('text:', p.text);
        console.log('html[0..1500]:', p.html?.slice(0, 1500));
    });

    await page.screenshot({ path: path.join(DBG, 'poster_explore_2.png'), fullPage: false });

    // 找"生成海报"按钮
    const genBtn = await page.evaluate(() => {
        const all = document.querySelectorAll('button, a, [class*="btn"], [role="button"]');
        for (const el of all) {
            if (el.textContent?.includes('生成海报') && el.offsetParent !== null) {
                return { text: el.textContent.trim(), class: el.className?.toString(), tag: el.tagName };
            }
        }
        return null;
    });
    console.log('\n"生成海报"按钮:', genBtn);

    await browser.close();
})();
