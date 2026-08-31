// 测试不同方式在第二个 ProseMirror 输入内容后保存
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '贴图正文测试-' + Date.now().toString().slice(-4);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
    await page.waitForTimeout(500);
    console.log('标题:', TITLE);

    // 方式1：直接 keyboard.type 在第二个 ProseMirror 输入
    console.log('\n=== 方式1: keyboard.type ===');
    const body = page.locator('.ProseMirror').nth(1);
    await body.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('这是贴图的正文描述内容，用于测试保存是否成功。');
    await page.waitForTimeout(1000);

    // 检查是否输入成功
    const inputResult = await page.evaluate(() => {
        const pm = document.querySelectorAll('.ProseMirror')[1];
        return {
            text: pm?.textContent?.slice(0, 60),
            html: pm?.innerHTML?.slice(0, 200),
            hasPlaceholder: !!pm?.querySelector('.editor_placeholder'),
        };
    });
    console.log('输入后状态:', JSON.stringify(inputResult, null, 2));
    await page.screenshot({ path: path.join(DBG, 'tietu_body_typed.png') });

    // 监听保存 API
    let saveApiCalled = false;
    let saveApiResponse = null;
    page.on('response', async res => {
        const url = res.url();
        if (url.includes('operate_appmsg') && res.request().method() === 'POST' && !url.includes('pre_load')) {
            saveApiCalled = true;
            try { saveApiResponse = await res.text(); } catch (e) {}
            console.log(`\n[保存API] ${url.slice(0, 100)}`);
            console.log('  响应:', saveApiResponse?.slice(0, 300));
        }
    });

    // 保存
    console.log('\n=== 保存 ===');
    await page.locator('text=保存为草稿').first().click({ timeout: 10000 });
    await page.waitForTimeout(5000);

    // 检查错误
    const errors = await page.evaluate(() => {
        return [...document.querySelectorAll('.js_error_msg, [class*="error"]')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 50 && el.textContent?.trim();
        }).map(el => el.textContent?.trim().slice(0, 80));
    });
    console.log('错误提示:', errors);
    console.log('保存API调用:', saveApiCalled);

    await page.locator('button:has-text("确定"), button:has-text("知道了")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(DBG, 'tietu_save_result.png') });

    // 如果保存成功，验证草稿箱
    if (saveApiCalled && saveApiResponse) {
        console.log('\n=== 验证草稿箱 ===');
        await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(4000);
        const found = (await page.evaluate(() => document.body?.innerText || '')).includes(TITLE);
        console.log(found ? `✓✓ 草稿箱找到"${TITLE}"` : `✗ 草稿箱未找到"${TITLE}"`);
        await page.screenshot({ path: path.join(DBG, 'tietu_draftbox.png') });
    }

    await browser.close();
    console.log('\n=== 完成 ===');
})();
