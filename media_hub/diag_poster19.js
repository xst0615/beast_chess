// 点击按钮后create API已成功返回，现在需要：
// 1. 找到对话框Vue组件，填入文字
// 2. 选择模板，触发生成
// 3. 获取生成的图片URL，插入正文
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        const t = msg.text();
        if (msg.type() === 'error' && !t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
            console.log('  [page-' + msg.type() + ']', t.slice(0, 200));
        }
    });

    // Hook所有poster请求，记录完整参数和响应
    await page.addInitScript(() => {
        window.__posterCalls = [];
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
            const opts = args[1] || {};
            const isPoster = url && (url.includes('webtextposter') || url.includes('textposter'));
            if (isPoster) {
                window.__posterCalls.push({ type: 'fetch_req', method: opts.method || 'GET', url, body: opts.body?.toString()?.slice(0, 2000) });
            }
            const resp = await origFetch.apply(this, args);
            if (isPoster) {
                const clone = resp.clone();
                try {
                    const text = await clone.text();
                    window.__posterCalls.push({ type: 'fetch_resp', url, body: text.slice(0, 5000) });
                } catch(e) {}
            }
            return resp;
        };
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报功能');
    await page.waitForTimeout(500);

    // 点击文字海报按钮
    await page.hover('.image-selector__add');
    await page.waitForTimeout(500);
    const posterBtn = page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' });
    await posterBtn.first().click({ timeout: 5000 });
    await page.waitForTimeout(5000);

    // 读取所有poster请求
    let calls = await page.evaluate(() => window.__posterCalls);
    console.log('=== 点击后的请求 ===');
    calls.forEach((c, i) => {
        const action = c.url.match(/action=(\w+)/)?.[1] || '?';
        if (c.type === 'fetch_req') {
            console.log(`[${i+1}] REQ ${c.method} action=${action}`);
            if (c.body) console.log('  body:', c.body.slice(0, 500));
        } else {
            try {
                const p = JSON.parse(c.body);
                console.log(`[${i+1}] RESP action=${action} ret=${p.base_resp?.ret}`);
                console.log('  keys:', Object.keys(p));
                if (p.session_id) console.log('  session_id:', p.session_id);
                if (p.poster_list) console.log('  poster_list len:', p.poster_list.length);
                if (p.poster_list?.[0]) {
                    console.log('  first tpl keys:', Object.keys(p.poster_list[0]));
                    console.log('  first tpl:', JSON.stringify(p.poster_list[0]).slice(0, 300));
                }
            } catch(e) {
                console.log(`[${i+1}] RESP (parse error):`, c.body.slice(0, 200));
            }
        }
    });

    // 获取create响应中的session_id
    const createCall = calls.find(c => c.type === 'fetch_resp' && c.url.includes('action=create'));
    let sessionId = null;
    let posterList = [];
    if (createCall) {
        try {
            const p = JSON.parse(createCall.body);
            sessionId = p.session_id;
            posterList = p.poster_list || [];
        } catch(e) {}
    }
    console.log('\nsessionId:', sessionId, '模板数:', posterList.length);

    if (!sessionId) {
        console.log('未获取到sessionId，失败');
        await browser.close();
        return;
    }

    // 现在直接在浏览器中模拟文字海报的完整流程：
    // 对话框组件可能因为v-if条件（比如需要模板加载完成）而没渲染
    // 我们绕过UI，直接调用后续API
    // 但需要知道generate API的正确参数格式

    // 方案：找到对话框Vue实例的方法，直接调用
    console.log('\n=== 查找对话框Vue组件及其方法 ===');
    const dialogInfo = await page.evaluate(() => {
        function findVue(el, depth = 0) {
            if (depth > 20) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const f = findVue(child, depth + 1);
                if (f) return f;
            }
            return null;
        }
        // 查找所有包含poster的Vue组件
        const all = [];
        document.querySelectorAll('*').forEach(el => {
            const vm = el.__vue__;
            if (vm) {
                const keys = Object.keys(vm.$data || {});
                const hasPoster = keys.some(k => k.toLowerCase().includes('poster'));
                if (hasPoster) {
                    const proto = Object.getPrototypeOf(vm);
                    const methods = Object.getOwnPropertyNames(proto).filter(m => {
                        try { return typeof proto[m] === 'function' && m !== 'constructor'; } catch(e) { return false; }
                    });
                    const data = {};
                    for (const k of keys) {
                        const v = vm.$data[k];
                        data[k] = typeof v === 'function' ? '[fn]' : Array.isArray(v) ? `arr(${v.length})` : typeof v === 'object' ? JSON.stringify(v).slice(0,100) : v;
                    }
                    all.push({ tag: el.tagName, class: el.className?.toString().slice(0,60), data, posterMethods: methods.filter(m => m.toLowerCase().includes('poster') || m.toLowerCase().includes('generate') || m.toLowerCase().includes('confirm')) });
                }
            }
        });
        return all;
    });
    dialogInfo.forEach(info => {
        console.log('\n组件:', info.tag + '.' + info.class);
        console.log('  data:', JSON.stringify(info.data).slice(0, 500));
        console.log('  poster相关方法:', info.posterMethods);
    });

    await browser.close();
})();
