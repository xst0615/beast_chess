// Hook fetch和XMLHttpRequest来拦截所有poster请求的完整参数
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // 在页面加载前就注入hook
    await page.addInitScript(() => {
        window.__posterCalls = [];
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            const opts = args[1] || {};
            if (url && (url.includes('poster') || url.includes('textposter'))) {
                window.__posterCalls.push({
                    type: 'fetch',
                    method: opts.method || 'GET',
                    url,
                    body: opts.body?.toString()?.slice(0, 2000),
                    ts: Date.now()
                });
            }
            return origFetch.apply(this, args);
        };
        const OrigXHR = XMLHttpRequest;
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;
        OrigXHR.prototype.open = function(method, url, ...rest) {
            this.__posterUrl = url;
            this.__posterMethod = method;
            return origOpen.call(this, method, url, ...rest);
        };
        OrigXHR.prototype.send = function(body) {
            if (this.__posterUrl && (this.__posterUrl.includes('poster') || this.__posterUrl.includes('textposter'))) {
                window.__posterCalls.push({
                    type: 'xhr',
                    method: this.__posterMethod,
                    url: this.__posterUrl,
                    body: body?.toString()?.slice(0, 2000),
                    ts: Date.now()
                });
                // 也拦截响应
                this.addEventListener('load', () => {
                    window.__posterCalls.push({
                        type: 'xhr_resp',
                        url: this.__posterUrl,
                        status: this.status,
                        body: this.responseText?.slice(0, 3000),
                        ts: Date.now()
                    });
                });
            }
            return origSend.call(this, body);
        };
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 点击文字海报（打开对话框）
    await page.hover('.image-selector__add');
    await page.waitForTimeout(500);
    const posterBtn = page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' });
    await posterBtn.first().click({ timeout: 5000 });
    await page.waitForTimeout(5000);

    // 读取hook记录
    let calls = await page.evaluate(() => window.__posterCalls);
    console.log('=== 点击后捕获的请求 ===');
    calls.forEach((c, i) => {
        console.log(`\n[${i+1}] ${c.type} ${c.method} ${c.url.split('?')[0]}?action=${c.url.match(/action=(\w+)/)?.[1] || '?'}`);
        if (c.body) console.log('  body:', c.body.slice(0, 500));
        if (c.type === 'xhr_resp') {
            try {
                const p = JSON.parse(c.body);
                console.log('  resp keys:', Object.keys(p));
                console.log('  resp ret:', p.base_resp?.ret);
                if (p.cos_url) console.log('  cos_url:', p.cos_url.slice(0, 100));
                if (p.poster_list) console.log('  poster_list count:', p.poster_list.length);
                if (p.url) console.log('  url:', p.url.slice(0, 100));
            } catch(e) {
                console.log('  resp (raw):', c.body.slice(0, 200));
            }
        }
    });

    // 对话框可能没渲染UI，但我们可以直接调用Vue方法来模拟
    // 找到image-selector组件，调用生成方法
    console.log('\n=== 尝试通过Vue方法生成 ===');
    const vueMethods = await page.evaluate(() => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return 'vm not found';
        const proto = Object.getPrototypeOf(vm);
        const methods = Object.getOwnPropertyNames(proto).filter(m => {
            try { return typeof proto[m] === 'function'; } catch(e) { return false; }
        });
        // 找poster相关方法
        const posterMethods = methods.filter(m => m.toLowerCase().includes('poster') || m.toLowerCase().includes('text'));
        return { posterMethods, allMethods: methods.slice(0, 50) };
    });
    console.log('poster相关方法:', vueMethods.posterMethods || vueMethods);

    // 等用户手动操作（如果headless=false）
    console.log('\n请在浏览器中手动操作文字海报功能...');
    console.log('30秒后读取所有请求...');
    await page.waitForTimeout(30000);

    calls = await page.evaluate(() => window.__posterCalls);
    console.log('\n=== 所有poster请求（手动操作后）===');
    calls.forEach((c, i) => {
        const action = c.url.match(/action=(\w+)/)?.[1] || '?';
        console.log(`\n[${i+1}] ${c.type} ${c.method} action=${action}`);
        if (c.body) console.log('  body:', c.body.slice(0, 800));
        if (c.type.includes('resp') || c.type === 'xhr_resp') {
            try {
                const p = typeof c.body === 'string' ? JSON.parse(c.body) : c.body;
                console.log('  resp ret:', p.base_resp?.ret, 'err:', p.base_resp?.err_msg);
                if (p.cos_url) console.log('  cos_url:', p.cos_url.slice(0, 120));
                if (p.url) console.log('  url:', p.url.slice(0, 120));
                if (p.poster_list) console.log('  poster_list len:', p.poster_list.length);
                if (p.media_id) console.log('  media_id:', p.media_id);
                if (p.img_url) console.log('  img_url:', p.img_url.slice(0, 120));
            } catch(e) {}
        }
    });

    await browser.close();
})();
