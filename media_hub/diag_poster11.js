// 深入分析onAddByTextPoster方法源码，理解对话框为什么不显示
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试');
    await page.waitForTimeout(500);

    // 获取onAddByTextPoster方法源码
    console.log('=== onAddByTextPoster 源码 ===');
    const methodSource = await page.evaluate(() => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return 'not found';
        const fn = vm.onAddByTextPoster;
        return fn.toString();
    });
    console.log(methodSource);

    // 获取_prefetchTextPoster源码
    console.log('\n=== _prefetchTextPoster 源码 ===');
    const prefetchSource = await page.evaluate(() => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return 'not found';
        return vm._prefetchTextPoster.toString();
    });
    console.log(prefetchSource);

    // 获取text_poster_dialog组件的所有方法
    console.log('\n=== text_poster_dialog 组件方法源码 ===');
    const dialogMethods = await page.evaluate(() => {
        function findVue(el, depth = 0) {
            if (depth > 15) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const found = findVue(child, depth + 1);
                if (found) return found;
            }
            return null;
        }
        const dvm = findVue(document.querySelector('.text_poster_dialog'));
        if (!dvm) return 'not found';
        const results = {};
        const proto = Object.getPrototypeOf(dvm);
        const methodNames = Object.getOwnPropertyNames(proto).filter(m => {
            try { return typeof proto[m] === 'function' && m !== 'constructor'; } catch(e) { return false; }
        });
        for (const m of methodNames) {
            results[m] = proto[m].toString().slice(0, 500);
        }
        return results;
    });
    for (const [name, src] of Object.entries(dialogMethods)) {
        console.log(`\n--- ${name} ---`);
        console.log(src);
    }

    await browser.close();
})();
