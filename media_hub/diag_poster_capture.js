// 通过CDP监控所有网络请求，找到文字海报生成的API
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // 记录所有请求
    const allRequests = [];
    page.on('request', req => {
        const url = req.url();
        if (url.includes('mp.weixin') && !url.includes('.js') && !url.includes('.css') && !url.includes('.png') && !url.includes('.jpg') && !url.includes('.gif') && !url.includes('mmbiz.qpic.cn')) {
            allRequests.push({ method: req.method(), url: url.slice(0, 300), postData: req.postData()?.slice(0, 500), ts: Date.now() });
        }
    });
    page.on('response', async res => {
        const url = res.url();
        if (url.includes('webtextposter') || url.includes('textposter') || (url.includes('poster') && !url.includes('.js') && !url.includes('.css'))) {
            try {
                const body = await res.text();
                allRequests.push({ type: 'RESPONSE', url: url.slice(0, 300), status: res.status(), body: body.slice(0, 1000), ts: Date.now() });
            } catch(e) {}
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
    await page.keyboard.type('测试');
    await page.waitForTimeout(500);

    console.log('页面加载完成，等待手动操作...');
    console.log('请手动点击"文字海报"按钮，生成海报，选择模板，点击确定');
    console.log('60秒后自动关闭并输出请求日志...');

    // 等待60秒让用户手动操作
    await page.waitForTimeout(60000);

    console.log('\n=== 捕获的API请求 ===');
    allRequests.forEach((r, i) => {
        console.log(`\n[${i+1}] ${r.method || r.type} ${r.url}`);
        if (r.postData) console.log('  POST:', r.postData.slice(0, 300));
        if (r.body) console.log('  Response:', r.body.slice(0, 500));
        if (r.status) console.log('  Status:', r.status);
    });

    await browser.close();
})();
