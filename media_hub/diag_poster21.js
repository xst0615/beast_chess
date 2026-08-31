// mask已经显示，但对话框内容没渲染
// 深入检查.text_poster_dialog组件的完整DOM树和Vue状态
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

    // Hook fetch拦截poster请求
    await page.addInitScript(() => {
        window.__posterLog = [];
        const origFetch = window.fetch;
        window.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('webtextposter')) {
                const action = url.match(/action=(\w+)/)?.[1];
                window.__posterLog.push({ type: 'req', action, method: init?.method || 'GET', body: init?.body?.toString()?.slice(0, 500) });
            }
            const resp = await origFetch.apply(this, arguments);
            if (url.includes('webtextposter')) {
                const clone = resp.clone();
                try {
                    const text = await clone.text();
                    window.__posterLog.push({ type: 'resp', action: url.match(/action=(\w+)/)?.[1], body: text.slice(0, 5000) });
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

    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试');
    await page.waitForTimeout(500);

    // 点击文字海报
    await page.hover('.image-selector__add');
    await page.waitForTimeout(500);
    await page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' }).first().click({ timeout: 5000 });

    // 等待mask和create API完成
    console.log('等待create API和对话框渲染...');
    let sessionId = null;
    let posterList = null;
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(2000);
        const log = await page.evaluate(() => window.__posterLog);
        const createResp = log.find(l => l.type === 'resp' && l.action === 'create');
        if (createResp && !sessionId) {
            try {
                const p = JSON.parse(createResp.body);
                sessionId = p.session_id;
                posterList = p.poster_list;
                console.log(`create完成(${i*2+2}s): sessionId=${sessionId}, 模板数=${posterList?.length}`);
            } catch(e) {}
        }
        // 检查DOM
        const dom = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            if (!dlg) return { htmlLen: 0 };
            return {
                htmlLen: dlg.innerHTML.length,
                childCount: dlg.children.length,
                outerHTML: dlg.outerHTML.slice(0, 2000)
            };
        });
        if (dom.htmlLen > 200) {
            console.log(`对话框内容已渲染(${i*2+2}s): htmlLen=${dom.htmlLen}`);
            console.log(dom.outerHTML.slice(0, 1000));
            break;
        }
        if (i === 19) {
            console.log(`最终状态(${i*2+2}s): htmlLen=${dom.htmlLen}, childCount=${dom.childCount}`);
        }
    }

    await page.screenshot({ path: path.join(DBG, 'poster_deep.png'), fullPage: true });

    // 即使UI没渲染，我们已经有sessionId和模板列表
    // 直接在Vue组件上调用方法来完成流程
    if (sessionId && posterList) {
        console.log('\n=== 有sessionId，尝试通过Vue组件方法生成海报 ===');
        // 随机选模板
        const tpl = posterList[Math.floor(Math.random() * posterList.length)];
        console.log('随机模板:', tpl.template_id, tpl.style);

        // 在Vue组件上调用方法
        const genResult = await page.evaluate(async ({ title, sessionId, tpl }) => {
            function findVue(el, depth = 0) {
                if (depth > 20) return null;
                if (el?.__vue__) return el.__vue__;
                for (const child of el?.children || []) {
                    const f = findVue(child, depth + 1);
                    if (f) return f;
                }
                return null;
            }

            // 查找所有Vue组件，找有posterList/sessionId/promptText的
            function findAllVue(root, results = [], depth = 0) {
                if (depth > 25) return results;
                if (root?.__vue__) {
                    const vm = root.__vue__;
                    const keys = Object.keys(vm.$data || {});
                    const hasPoster = keys.some(k => k.toLowerCase().includes('poster') || k.toLowerCase().includes('session'));
                    if (hasPoster) {
                        const data = {};
                        for (const k of keys) {
                            const v = vm.$data[k];
                            data[k] = typeof v === 'function' ? '[fn]' : Array.isArray(v) ? `arr(${v.length})` : typeof v === 'object' ? JSON.stringify(v).slice(0,200) : String(v).slice(0,100);
                        }
                        const proto = Object.getPrototypeOf(vm);
                        const methods = Object.getOwnPropertyNames(proto).filter(m => {
                            try { return typeof proto[m] === 'function' && m !== 'constructor'; } catch(e) { return false; }
                        });
                        results.push({ tag: root.tagName, class: root.className?.toString().slice(0,60), data, methods });
                    }
                }
                for (const child of root?.children || []) {
                    findAllVue(child, results, depth + 1);
                }
                return results;
            }

            const vms = findAllVue(document.body);
            console.log('找到poster相关Vue组件数:', vms.length);
            vms.forEach((vm, i) => {
                console.log(`组件${i}: ${vm.tag}.${vm.class}`);
                console.log('  data:', JSON.stringify(vm.data).slice(0, 500));
                console.log('  methods:', vm.methods.join(', '));
            });

            // 找包含text_poster_dialog的组件
            const dialogVm = vms.find(vm => vm.class.includes('text_poster_dialog'));
            if (!dialogVm) return { error: 'dialog vm not found', vmCount: vms.length };

            // 获取实际Vue实例
            const dlgEl = document.querySelector('.text_poster_dialog');
            const dvm = findVue(dlgEl);

            // 设置数据
            dvm.sessionId = sessionId;
            dvm.session_id = sessionId;
            dvm.posterList = tpl ? (dvm.posterList || []) : [];
            // 设置输入文字
            const textKeys = ['promptText', 'text', 'inputText', 'posterText', 'content'];
            for (const k of textKeys) {
                if (k in dvm.$data || k in dvm) dvm[k] = title;
            }

            // 查找生成/确定方法
            const proto = Object.getPrototypeOf(dvm);
            const allMethods = Object.getOwnPropertyNames(proto).filter(m => {
                try { return typeof proto[m] === 'function'; } catch(e) { return false; }
            });

            const generateMethods = allMethods.filter(m =>
                m.includes('generate') || m.includes('compose') || m.includes('create') ||
                m.includes('confirm') || m.includes('submit') || m.includes('ok') ||
                m.includes('apply') || m.includes('use') || m.includes('select')
            );

            console.log('可能的生成/确认方法:', generateMethods);

            // 尝试调用生成方法
            let result = { tried: [] };
            for (const methodName of generateMethods) {
                try {
                    const fn = proto[methodName];
                    if (fn.length === 0) {
                        const r = await fn.call(dvm);
                        result.tried.push({ method: methodName, result: JSON.stringify(r).slice(0, 300) });
                    } else if (fn.length <= 2) {
                        // 可能需要参数
                        const r = await fn.call(dvm, tpl);
                        result.tried.push({ method: methodName, result: JSON.stringify(r).slice(0, 300) });
                    }
                } catch(e) {
                    result.tried.push({ method: methodName, error: e.message?.slice(0, 200) });
                }
                // 等待一下看看有没有API调用
                await new Promise(r => setTimeout(r, 2000));
                const newLogs = window.__posterLog.slice(-5);
                const newReq = newLogs.find(l => l.type === 'req' && l.action !== 'create' && l.action !== 'prefetch');
                if (newReq) {
                    result.foundMethod = methodName;
                    result.lastRequest = newReq;
                    break;
                }
            }

            return result;
        }, { title: TITLE, sessionId, tpl });

        console.log('Vue方法调用结果:', JSON.stringify(genResult, null, 2).slice(0, 3000));

        await page.waitForTimeout(5000);

        // 检查是否有新的poster请求
        const allLogs = await page.evaluate(() => window.__posterLog);
        console.log('\n=== 所有poster请求 ===');
        allLogs.forEach((l, i) => {
            if (l.type === 'req') {
                console.log(`[${i+1}] REQ ${l.method} action=${l.action}`);
                if (l.body) console.log('  body:', l.body.slice(0, 500));
            } else {
                try {
                    const p = JSON.parse(l.body);
                    console.log(`[${i+1}] RESP action=${l.action} ret=${p.base_resp?.ret}`);
                    if (p.cos_url) console.log('  cos_url:', p.cos_url.slice(0, 100));
                    if (p.url) console.log('  url:', p.url.slice(0, 100));
                    if (p.media_id) console.log('  media_id:', p.media_id);
                    if (p.img_url) console.log('  img_url:', p.img_url.slice(0, 100));
                    console.log('  keys:', Object.keys(p).join(', '));
                } catch(e) {
                    console.log(`[${i+1}] RESP parse error`);
                }
            }
        });
    }

    await browser.close();
})();
