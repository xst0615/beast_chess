// 方法：在页面JS中搜索webtextposter相关代码，找到完整的API调用参数
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // 拦截所有JS响应，搜索webtextposter相关代码
    const jsSources = [];
    page.on('response', async res => {
        const url = res.url();
        const ct = res.headers()['content-type'] || '';
        if ((url.includes('.js') || ct.includes('javascript')) && !url.includes('mmbiz.qpic.cn')) {
            try {
                const text = await res.text();
                if (text.includes('webtextposter') || text.includes('textposter') || text.includes('text_poster')) {
                    jsSources.push({ url: url.split('?')[0], text });
                }
            } catch(e) {}
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000);

    console.log('找到包含poster的JS文件数:', jsSources.length);
    for (const src of jsSources) {
        console.log('\n=== JS文件:', src.url.slice(-80));
        // 搜索webtextposter相关代码片段
        const idx = src.text.indexOf('webtextposter');
        if (idx >= 0) {
            const snippet = src.text.slice(Math.max(0, idx - 500), idx + 1000);
            console.log('webtextposter上下文:', snippet);
        }
        // 搜索action=compose等
        const composeIdx = src.text.indexOf('compose');
        if (composeIdx >= 0) {
            const snippet = src.text.slice(Math.max(0, composeIdx - 300), composeIdx + 500);
            console.log('compose上下文:', snippet.slice(0, 800));
        }
    }

    await browser.close();
})();
