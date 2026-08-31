// 点击后等待更长时间，尝试用各种方式让对话框渲染出来
// 同时在页面上下文中直接调用Vue组件的内部方法
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
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 点击文字海报
    await page.hover('.image-selector__add');
    await page.waitForTimeout(500);
    const posterBtn = page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' });
    await posterBtn.first().click({ timeout: 5000 });
    console.log('已点击文字海报按钮');

    // 等待create API完成并轮询对话框状态
    let found = false;
    for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(2000);
        const state = await page.evaluate(() => {
            // 检查.text_poster_dialog的所有子元素
            const dlg = document.querySelector('.text_poster_dialog');
            if (!dlg) return { found: false };
            const children = [...dlg.children].map(c => ({
                tag: c.tagName,
                class: c.className?.toString().slice(0, 80),
                display: getComputedStyle(c).display,
                w: Math.round(c.getBoundingClientRect().width),
                h: Math.round(c.getBoundingClientRect().height),
                childCount: c.children.length
            }));
            const html = dlg.innerHTML.length;
            // 也检查是否有weui-desktop-dialog在其他位置（teleport到body）
            const allDialogs = [...document.querySelectorAll('.weui-desktop-dialog')].filter(d => {
                const r = d.getBoundingClientRect();
                return r.width > 100 && r.height > 100;
            });
            // 检查mask
            const mask = dlg.querySelector('.weui-desktop-mask');
            const maskVisible = mask ? getComputedStyle(mask).display !== 'none' : false;
            return {
                htmlLen: html,
                children,
                maskVisible,
                visibleDialogs: allDialogs.length,
                dialogDetails: allDialogs.map(d => ({
                    w: Math.round(d.getBoundingClientRect().width),
                    h: Math.round(d.getBoundingClientRect().height),
                    class: d.className?.toString().slice(0, 100),
                    parentClass: d.parentElement?.className?.toString().slice(0, 80)
                }))
            };
        });

        console.log(`\n等待${(i+1)*2}s: htmlLen=${state.htmlLen}, children=${state.children?.length}, visibleDialogs=${state.visibleDialogs}, mask=${state.maskVisible}`);
        if (state.children) {
            state.children.forEach(c => console.log(`  ${c.tag}.${c.class.slice(0,50)} display=${c.display} ${c.w}x${c.h} children=${c.childCount}`));
        }
        if (state.dialogDetails?.length > 0) {
            state.dialogDetails.forEach(d => console.log(`  可见dialog: ${d.w}x${d.h} parent=${d.parentClass} class=${d.class.slice(0,60)}`));
        }

        if (state.visibleDialogs > 0 || (state.children && state.children.some(c => c.w > 100 && c.tag !== 'DIV'?.includes('mask')))) {
            found = true;
            break;
        }
    }

    await page.screenshot({ path: path.join(DBG, 'poster_wait_result.png'), fullPage: true });

    // 如果对话框还是没渲染，尝试在Vue层面触发完整流程
    // 直接设置dialog的所有数据属性
    if (!found) {
        console.log('\n=== 尝试Vue层面强制渲染对话框 ===');
        const vueResult = await page.evaluate(async (title) => {
            function findVue(el, depth = 0) {
                if (depth > 20) return null;
                if (el?.__vue__) return el.__vue__;
                for (const child of el?.children || []) {
                    const f = findVue(child, depth + 1);
                    if (f) return f;
                }
                return null;
            }

            // 找到image-selector组件
            const imgSel = document.querySelector('.image-selector');
            const imgVm = imgSel?.__vue__;
            if (!imgVm) return 'image-selector vm not found';

            // 调用_prefetchTextPoster预加载
            if (imgVm._prefetchTextPoster) {
                await imgVm._prefetchTextPoster();
            }

            // 找到text_poster_dialog组件
            const dialogEl = document.querySelector('.text_poster_dialog');
            const dialogVm = findVue(dialogEl);
            if (!dialogVm) return 'dialog vm not found';

            // 打印所有数据key
            const dataKeys = Object.keys(dialogVm.$data || {});
            console.log('dialog data keys:', dataKeys);

            // 打印所有计算属性
            const computed = {};
            for (const key of dataKeys) {
                try {
                    const val = dialogVm[key];
                    computed[key] = typeof val === 'function' ? '[fn]' : Array.isArray(val) ? `arr(${val.length})` : typeof val === 'object' ? JSON.stringify(val).slice(0,100) : val;
                } catch(e) {}
            }
            console.log('dialog data:', computed);

            // 尝试设置visible=true
            dialogVm.visible = true;
            dialogVm.dialogVisible = true;
            dialogVm.show = true;

            // 尝试填入文字
            dialogVm.promptText = title;
            dialogVm.text = title;
            dialogVm.inputText = title;

            dialogVm.$forceUpdate();
            await new Promise(r => setTimeout(r, 100));
            dialogVm.$nextTick && await dialogVm.$nextTick();

            return { dataKeys, computed };
        }, TITLE);
        console.log('Vue结果:', JSON.stringify(vueResult, null, 2).slice(0, 1000));

        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(DBG, 'poster_after_vue2.png'), fullPage: true });
    }

    // 现在尝试更直接的方式：直接构造API调用，使用session_id
    // 先获取session_id（从之前create API的结果）
    console.log('\n=== 直接调用API生成海报 ===');
    const apiResult = await page.evaluate(async ({ title, token }) => {
        // 先调用create获取session_id
        const createUrl = `/cgi-bin/webtextposter?action=create&token=${token}&lang=zh_CN&f=json&ajax=1`;
        const createResp = await fetch(createUrl, { credentials: 'include' });
        const createData = await createResp.json();
        if (createData.base_resp?.ret !== 0) {
            return { step: 'create', error: createData.base_resp };
        }

        const sessionId = createData.session_id;
        const templates = createData.poster_list || [];
        const tpl = templates[Math.floor(Math.random() * templates.length)];

        // 尝试不同的action和参数组合
        const actions = ['compose', 'generate', 'render', 'make_poster', 'create_image'];
        for (const action of actions) {
            // 尝试不同的参数名组合
            const paramSets = [
                { session_id: sessionId, text: title, template_id: tpl.template_id, style: tpl.style },
                { session_id: sessionId, content: title, template_id: tpl.template_id, style: tpl.style },
                { sessionid: sessionId, text: title, templateid: tpl.template_id, poster_style: tpl.style },
                { token, session_id: sessionId, text: title, template_id: tpl.template_id, style: tpl.style },
            ];

            for (const params of paramSets) {
                const formData = new URLSearchParams();
                for (const [k, v] of Object.entries(params)) {
                    formData.append(k, v);
                }
                try {
                    const url = `/cgi-bin/webtextposter?action=${action}&token=${token}&lang=zh_CN&f=json&ajax=1`;
                    const resp = await fetch(url, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: formData.toString()
                    });
                    const data = await resp.json();
                    if (data.base_resp?.ret === 0) {
                        return { step: action, success: true, data, template: tpl };
                    }
                    // 只记录第一个组合的错误
                    if (paramSets.indexOf(params) === 0) {
                        console.log(`action=${action}: ret=${data.base_resp?.ret}, err=${data.base_resp?.err_msg}`);
                    }
                } catch(e) {
                    console.log(`action=${action} error:`, e.message);
                }
            }
        }

        return { step: 'all', error: 'all failed', sessionId, templateCount: templates.length };
    }, { title: TITLE, token });

    console.log('\nAPI直接调用结果:', JSON.stringify(apiResult, null, 2).slice(0, 3000));

    await browser.close();
})();
