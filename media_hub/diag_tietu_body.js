// 探测贴图编辑器中真正的"正文"输入区域
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');

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

    // 1. 找 js_content 区域（错误提示中提到 js_content）
    console.log('=== js_content 区域 ===');
    const jsContent = await page.evaluate(() => {
        const el = document.querySelector('#js_content');
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        return {
            found: true,
            tag: el.tagName,
            class: el.className?.toString().slice(0, 80),
            contentEditable: el.contentEditable,
            w: Math.round(r.width),
            h: Math.round(r.height),
            html: el.innerHTML.slice(0, 200),
            parent: el.parentElement?.tagName + '.' + el.parentElement?.className?.toString().slice(0, 50),
        };
    });
    console.log(JSON.stringify(jsContent, null, 2));

    // 2. 找所有 contenteditable 元素
    console.log('\n=== 所有 contenteditable 元素 ===');
    const editables = await page.evaluate(() => {
        return [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                id: el.id,
                class: el.className?.toString().slice(0, 60),
                w: Math.round(r.width),
                h: Math.round(r.height),
                visible: r.width > 0 && r.height > 0,
                placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder'),
            };
        });
    });
    console.log(JSON.stringify(editables, null, 2));

    // 3. 找所有 textarea
    console.log('\n=== 所有 textarea ===');
    const textareas = await page.evaluate(() => {
        return [...document.querySelectorAll('textarea')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                id: el.id,
                class: el.className?.toString().slice(0, 60),
                placeholder: el.placeholder,
                w: Math.round(r.width),
                h: Math.round(r.height),
                visible: r.width > 0 && r.height > 0,
            };
        });
    });
    console.log(JSON.stringify(textareas, null, 2));

    // 4. 找 ProseMirror 元素
    console.log('\n=== ProseMirror 元素 ===');
    const proses = await page.evaluate(() => {
        return [...document.querySelectorAll('.ProseMirror')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                class: el.className?.toString().slice(0, 60),
                id: el.id,
                w: Math.round(r.width),
                h: Math.round(r.height),
                placeholder: el.getAttribute('data-placeholder'),
                parent: el.parentElement?.tagName + '.' + el.parentElement?.className?.toString().slice(0, 40),
                html: el.innerHTML.slice(0, 100),
            };
        });
    });
    console.log(JSON.stringify(proses, null, 2));

    // 5. 查找 edui 编辑器（UEditor）
    console.log('\n=== UEditor/edui 区域 ===');
    const edu = await page.evaluate(() => {
        const eduis = document.querySelectorAll('[class*="edui"], [class*="editor"], [id*="ueditor"], [id*="edui"]');
        return [...eduis].map(el => {
            const r = el.getBoundingClientRect();
            if (r.width < 50 || r.height < 20) return null;
            return {
                tag: el.tagName,
                id: el.id,
                class: el.className?.toString().slice(0, 60),
                w: Math.round(r.width),
                h: Math.round(r.height),
            };
        }).filter(Boolean).slice(0, 15);
    });
    console.log(JSON.stringify(edu, null, 2));

    // 6. 找 iframes
    console.log('\n=== iframes ===');
    const iframes = await page.evaluate(() => {
        return [...document.querySelectorAll('iframe')].map(el => ({
            id: el.id,
            class: el.className?.toString().slice(0, 60),
            src: el.src?.slice(0, 100),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
        }));
    });
    console.log(JSON.stringify(iframes, null, 2));

    // 7. 尝试在第一个 ProseMirror 输入标题，然后查找变化
    console.log('\n=== 输入标题后检查 ===');
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('测试标题');
    await page.waitForTimeout(1000);

    // 再检查 ProseMirror
    const proses2 = await page.evaluate(() => {
        return [...document.querySelectorAll('.ProseMirror')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                class: el.className?.toString().slice(0, 40),
                id: el.id,
                w: Math.round(r.width),
                h: Math.round(r.height),
                text: el.textContent?.slice(0, 30),
                placeholder: el.getAttribute('data-placeholder'),
            };
        });
    });
    console.log('输入后 ProseMirror:', JSON.stringify(proses2, null, 2));

    // 8. 找"正文"相关的标签
    console.log('\n=== 正文相关标签 ===');
    const labels = await page.evaluate(() => {
        const all = [...document.querySelectorAll('*')].filter(el => {
            const t = el.textContent?.trim();
            const r = el.getBoundingClientRect();
            return t === '正文' && r.width > 0 && r.height > 0 && el.children.length === 0;
        });
        return all.map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 60),
            parent: el.parentElement?.tagName + '.' + el.parentElement?.className?.toString().slice(0, 60),
            parentNext: el.parentElement?.nextElementSibling?.tagName + '.' + el.parentElement?.nextElementSibling?.className?.toString().slice(0, 60),
        }));
    });
    console.log(JSON.stringify(labels, null, 2));

    await browser.close();
})();
