// 通过Vue组件状态控制文字海报对话框显示（修正console监听）
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // 监听页面console
    page.on('console', msg => {
        if (msg.type() === 'log' || msg.type() === 'error') {
            console.log('  [page]', msg.text().slice(0, 200));
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
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 查看Vue实例的所有data属性和方法
    console.log('=== Vue组件 data 和 methods ===');
    const vueInfo = await page.evaluate(() => {
        const imgSelector = document.querySelector('.image-selector');
        const vm = imgSelector?.__vue__;
        if (!vm) return { found: false };
        return {
            found: true,
            posterData: Object.keys(vm.$data || {}).filter(k => k.toLowerCase().includes('poster')).map(k => ({
                key: k,
                value: typeof vm.$data[k] === 'object' ? JSON.stringify(vm.$data[k]).slice(0, 500) : String(vm.$data[k]).slice(0, 200)
            })),
            posterMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(vm)).filter(k => k.toLowerCase().includes('poster')),
            boolData: Object.keys(vm.$data || {}).filter(k => typeof vm.$data[k] === 'boolean').map(k => ({ key: k, value: vm.$data[k] })),
            showData: Object.keys(vm.$data || {}).filter(k => k.includes('show') || k.includes('visible') || k.includes('dialog') || k.includes('popup') || k.includes('TextPoster')).map(k => ({ key: k, value: typeof vm.$data[k] === 'object' ? JSON.stringify(vm.$data[k]).slice(0, 300) : String(vm.$data[k]).slice(0, 200) }))
        };
    });
    console.log(JSON.stringify(vueInfo, null, 2));

    // 也检查 text_poster_dialog 子组件的 Vue 实例
    console.log('\n=== text_poster_dialog Vue实例 ===');
    const dialogVueInfo = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        // 递归查找子组件
        function findVue(el, depth = 0) {
            if (depth > 10) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const found = findVue(child, depth + 1);
                if (found) return found;
            }
            return null;
        }
        const dvm = findVue(dlg);
        if (!dvm) return { found: false };
        return {
            found: true,
            dataKeys: Object.keys(dvm.$data || {}),
            propsKeys: Object.keys(dvm.$props || {}),
            data: Object.keys(dvm.$data || {}).reduce((acc, k) => {
                const v = dvm.$data[k];
                acc[k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 100);
                return acc;
            }, {}),
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(dvm)).filter(m => {
                const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(dvm), m);
                return desc && typeof desc.value === 'function';
            })
        };
    });
    console.log(JSON.stringify(dialogVueInfo, null, 2));

    // 先预加载，再调用 onAddByTextPoster
    console.log('\n=== 预加载 + 打开对话框 ===');
    await page.evaluate(async () => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        await vm._prefetchTextPoster();
        // 预加载后查看text poster相关的data
        const posterKeys = Object.keys(vm.$data).filter(k => k.toLowerCase().includes('poster') || k.toLowerCase().includes('textposter'));
        window._posterDebug = {};
        for (const k of posterKeys) {
            window._posterDebug[k] = JSON.stringify(vm.$data[k]).slice(0, 500);
        }
    });
    await page.waitForTimeout(2000);

    const posterDataAfterPrefetch = await page.evaluate(() => window._posterDebug);
    console.log('预加载后poster data:', JSON.stringify(posterDataAfterPrefetch, null, 2));

    await browser.close();
})();
