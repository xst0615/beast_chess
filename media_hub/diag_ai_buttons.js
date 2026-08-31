// 精确诊断 AI 对话框内的按钮结构和应用流程
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '一只可爱的橘猫趴在键盘上睡觉，温暖阳光，插画风格';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN' });
    const page = await ctx.newPage();

    // 监听网络请求，捕捉生成和应用相关的 API
    const apiCalls = [];
    ctx.on('response', async (res) => {
        const url = res.url();
        if (url.includes('ai') || url.includes('img') || url.includes('cover') || url.includes('media')) {
            if (!url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.jpg')) {
                apiCalls.push({ url: url.slice(0, 100), status: res.status() });
            }
        }
    });

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
    await editor.keyboard.type('测试AI封面-按钮诊断');

    // 移除残留对话框
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 打开 AI 配图
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);

    // 步骤1: 详细列出对话框内所有可点击按钮
    console.log('=== 对话框内所有按钮 ===');
    const btns = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return [];
        return [...wrp.querySelectorAll('button, [class*="btn"], [class*="send"], [class*="submit"], a')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                class: (el.className?.toString() || '').slice(0, 60),
                text: el.textContent?.trim().slice(0, 20),
                w: Math.round(r.width), h: Math.round(r.height),
                visible: r.width > 0 && r.height > 0,
            };
        }).filter(b => b.visible);
    });
    btns.forEach((b, i) => console.log(`${i}. [${b.tag}] "${b.text}" class="${b.class}" ${b.w}x${b.h}`));

    // 步骤2: 输入提示词后，再列按钮（发送按钮可能变激活）
    console.log('\n=== 输入提示词后的按钮 ===');
    const ta = editor.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await editor.waitForTimeout(1000);

    const btns2 = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return [];
        return [...wrp.querySelectorAll('button, [class*="btn"], [class*="send"], [class*="submit"], a, [class*="icon"]')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                class: (el.className?.toString() || '').slice(0, 60),
                text: el.textContent?.trim().slice(0, 20),
                w: Math.round(r.width), h: Math.round(r.height),
                visible: r.width > 0 && r.height > 0,
            };
        }).filter(b => b.visible);
    });
    btns2.forEach((b, i) => console.log(`${i}. [${b.tag}] "${b.text}" class="${b.class}" ${b.w}x${b.h}`));

    // 步骤3: 检查 textarea 附近的兄弟元素（发送按钮通常紧邻输入框）
    console.log('\n=== 输入框附近结构 ===');
    const taSiblings = await editor.evaluate(() => {
        const ta = document.querySelector('.chat_textarea');
        if (!ta) return null;
        const parent = ta.parentElement;
        const parentInfo = { tag: parent.tagName, class: parent.className?.toString().slice(0, 60) };
        // 找父级和兄弟
        const sibs = [...parent.children].map(el => ({
            tag: el.tagName, class: (el.className?.toString() || '').slice(0, 50),
            text: el.textContent?.trim().slice(0, 15),
            isTa: el === ta,
        }));
        // 上一层
        const gp = parent.parentElement;
        const gpSibs = gp ? [...gp.children].map(el => ({
            tag: el.tagName, class: (el.className?.toString() || '').slice(0, 50),
            text: el.textContent?.trim().slice(0, 15),
        })) : [];
        return { parent: parentInfo, sibs, gpClass: gp?.className?.toString().slice(0, 60), gpSibs };
    });
    console.log(JSON.stringify(taSiblings, null, 2));

    // 步骤4: 清空 apiCalls，记录发送操作的网络请求
    apiCalls.length = 0;

    // 尝试方法: 用键盘 Enter 发送（很多聊天输入框支持）
    console.log('\n=== 尝试 Enter 发送 ===');
    await editor.keyboard.press('Enter');
    await editor.waitForTimeout(5000);

    // 检查是否开始生成（文本变化）
    const afterEnter = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return null;
        const text = wrp.textContent || '';
        return { text: text.slice(0, 120), imgCount: wrp.querySelectorAll('img').length };
    });
    console.log('Enter 后对话框状态:', JSON.stringify(afterEnter));
    console.log('网络请求:', JSON.stringify(apiCalls.slice(0, 10)));
    await editor.screenshot({ path: path.join(DBG, 'btn_after_enter.png') });

    await browser.close();
})();
