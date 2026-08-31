// 诊断文字海报功能：入口按钮→打开对话框→填入文字→生成海报→选模板→确定
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '文字海报诊断测试-' + Date.now().toString().slice(-4);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];
    console.log('token:', token);

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));
    console.log('✓ 编辑器已加载');

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(500);

    // 填正文
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('文字海报测试内容');
    await page.waitForTimeout(500);

    // 截图看工具栏区域
    await page.screenshot({ path: path.join(DBG, 'poster_toolbar.png'), fullPage: false });

    // 查找"文字海报"相关按钮
    console.log('\n=== 查找文字海报按钮 ===');
    const buttons = await page.evaluate(() => {
        const results = [];
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            if (el.children.length === 0 && el.textContent?.includes('海报') && el.getBoundingClientRect().width > 10) {
                results.push({
                    tag: el.tagName,
                    text: el.textContent?.trim().slice(0, 30),
                    class: el.className?.toString().slice(0, 60),
                    visible: el.getBoundingClientRect().top > 0
                });
            }
        }
        return results;
    });
    console.log('含"海报"的文字元素:', JSON.stringify(buttons, null, 2));

    // 查找工具栏图标按钮
    const toolbarBtns = await page.evaluate(() => {
        const results = [];
        const allElements = document.querySelectorAll('[class*="toolbar"] *, [class*="tool"] *, [class*="btn"] *, [class*="icon"] *');
        for (const el of allElements) {
            if (el.children.length === 0 && el.textContent?.trim() && el.getBoundingClientRect().width > 20) {
                results.push({
                    tag: el.tagName,
                    text: el.textContent?.trim().slice(0, 30),
                    class: el.className?.toString().slice(0, 60),
                    parent: el.parentElement?.className?.toString().slice(0, 50)
                });
            }
        }
        return results.slice(0, 50);
    });
    console.log('\n工具栏按钮:', JSON.stringify(toolbarBtns.slice(0, 30), null, 2));

    // 找包含"文字海报"或"海报"的可点击元素
    const clickable = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[class*="btn"], [class*="tool"], button, a, [role="button"], [class*="menu"]').forEach(el => {
            const text = el.textContent?.trim().slice(0, 40);
            if (text && text.includes('海报')) {
                results.push({
                    tag: el.tagName,
                    text: text,
                    class: el.className?.toString().slice(0, 80),
                    href: el.href?.slice(0, 80),
                    visible: el.offsetParent !== null
                });
            }
        });
        return results;
    });
    console.log('\n可点击海报元素:', JSON.stringify(clickable, null, 2));

    await page.screenshot({ path: path.join(DBG, 'poster_before_click.png') });

    // 尝试点击找到的按钮
    if (clickable.length > 0) {
        const visibleBtn = clickable.find(b => b.visible);
        if (visibleBtn) {
            console.log('\n尝试点击:', visibleBtn.text);
            await page.evaluate((text) => {
                const els = [...document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="tool"]')].filter(el => el.textContent?.trim().includes(text));
                const visible = els.find(el => el.offsetParent !== null);
                if (visible) visible.click();
            }, visibleBtn.text.replace(/海报.*/, '海报'));
            await page.waitForTimeout(3000);
        }
    }

    await page.screenshot({ path: path.join(DBG, 'poster_after_click.png') });

    // 检查是否弹出了对话框
    const dialogInfo = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('.weui-desktop-dialog__wrp, [class*="dialog"], [class*="modal"], [class*="popup"]');
        const results = [];
        for (const d of dialogs) {
            const rect = d.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100) {
                results.push({
                    class: d.className?.toString().slice(0, 80),
                    text: d.textContent?.trim().slice(0, 200),
                    inputCount: d.querySelectorAll('input, textarea, [contenteditable]').length,
                    btnCount: d.querySelectorAll('button, [class*="btn"]').length,
                    visible: d.offsetParent !== null
                });
            }
        }
        return results;
    });
    console.log('\n弹出的对话框:', JSON.stringify(dialogInfo, null, 2));

    await browser.close();
    console.log('\n=== 完成 ===');
})();
