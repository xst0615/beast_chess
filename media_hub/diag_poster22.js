// 找到关键信息后：
// 1. _prefetchTextPoster: POST /cgi-bin/webtextposter?action=create, data: JSON.stringify({prompt:"", action_mode:0})
// 2. onAddByTextPoster: this.$refs.textPosterDialog.show(cache)
// 3. onTextPosterInsert: 接收[{file_id, cdn_url, url}]插入图片
// 现在需要找到对话框组件的show方法和compose/generate API
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // 拦截并保存所有JS文件
    const allJS = [];
    page.on('response', async res => {
        const url = res.url();
        const ct = res.headers()['content-type'] || '';
        if ((url.includes('.js') || ct.includes('javascript')) && !url.includes('mmbiz.qpic.cn') && url.includes('appmsg_edit')) {
            try {
                const text = await res.text();
                if (text.includes('textPoster') || text.includes('text_poster') || text.includes('posterDialog')) {
                    allJS.push({ url, text });
                    fs.writeFileSync(path.join(DBG, 'poster_js_' + allJS.length + '.js'), text);
                }
            } catch(e) {}
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(10000);

    console.log('找到JS文件数:', allJS.length);

    // 在JS中搜索posterDialog的show方法和compose API
    for (const src of allJS) {
        const text = src.text;
        // 搜索show方法
        const showIdx = text.indexOf('textPosterDialog') || text.indexOf('text_poster_dialog');
        if (showIdx >= 0) {
            // 搜索compose或generate API
            const composeIdx = text.indexOf('action=compose');
            const generateIdx = text.indexOf('action=generate');
            const makeIdx = text.indexOf('webtextposter');

            // 搜索所有webtextposter的action
            const actionRegex = /action=(\w+)[^"]*webtextposter|webtextposter[^"]*action=(\w+)/g;
            let match;
            const actions = new Set();
            while ((match = actionRegex.exec(text)) !== null) {
                actions.add(match[1] || match[2]);
            }
            console.log('\nwebtextposter actions found:', [...actions]);

            // 找到包含show:function或show()的部分
            const showPattern = /show\s*[=:]\s*(?:function|\()/g;
            let showMatch;
            while ((showMatch = showPattern.exec(text)) !== null) {
                const idx = showMatch.index;
                // 看是否在poster dialog组件内
                const context = text.slice(Math.max(0, idx - 200), idx + 800);
                if (context.includes('poster') || context.includes('Poster')) {
                    console.log('\n=== show方法上下文 ===');
                    console.log(context.slice(0, 1000));
                }
            }

            // 搜索包含webtextposter的所有调用点
            let searchStart = 0;
            while (true) {
                const pos = text.indexOf('webtextposter', searchStart);
                if (pos < 0) break;
                const context = text.slice(Math.max(0, pos - 400), pos + 400);
                console.log('\n=== webtextposter调用点 ===');
                console.log(context.slice(0, 800));
                searchStart = pos + 20;
            }
        }
    }

    // 直接在Vue组件中调用正确的API
    console.log('\n=== 直接用正确参数调用API ===');
    const result = await page.evaluate(async ({ title, token }) => {
        // 1. 调用create（正确参数格式：data字段是JSON字符串）
        const Cgi = window.Cgi || (() => {
            // 模拟Cgi.post
            return {
                post({ url, data, dataType }, callback) {
                    const formData = new URLSearchParams();
                    for (const [k, v] of Object.entries(data)) {
                        formData.append(k, v);
                    }
                    fetch(url.startsWith('http') ? url : (location.origin + url), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: formData.toString()
                    }).then(r => r.json()).then(d => callback(d)).catch(e => callback({ base_resp: { ret: -1, err_msg: e.message } }));
                }
            };
        })();

        // 直接用fetch模拟Cgi.post的格式
        const createUrl = `/cgi-bin/webtextposter?action=create&token=${token}&lang=zh_CN&f=json&ajax=1`;
        const createForm = new URLSearchParams();
        createForm.append('data', JSON.stringify({ prompt: title, action_mode: 0 }));
        const createResp = await fetch(createUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: createForm.toString()
        });
        const createData = await createResp.json();
        console.log('create ret:', createData.base_resp?.ret, 'session:', createData.session_id, 'templates:', createData.poster_list?.length);

        if (createData.base_resp?.ret !== 0) {
            return { step: 'create', error: createData.base_resp };
        }

        const sessionId = createData.session_id;
        const templates = createData.poster_list || [];
        const tpl = templates[Math.floor(Math.random() * templates.length)];

        // 2. 尝试compose API - 找JS中的参数
        const composeActions = ['compose', 'generate', 'render_poster', 'make', 'apply_style'];
        for (const action of composeActions) {
            // 尝试多种参数格式
            const paramVariants = [
                { data: JSON.stringify({ session_id: sessionId, text: title, template_id: tpl.template_id, style: tpl.style }) },
                { data: JSON.stringify({ session_id: sessionId, prompt: title, template_id: tpl.template_id, style: tpl.style, action_mode: 1 }) },
                { session_id: sessionId, text: title, template_id: tpl.template_id, style: tpl.style },
                { data: JSON.stringify({ session_id: sessionId, content: title, template: tpl.template_id, poster_style: tpl.style }) },
            ];

            for (const params of paramVariants) {
                const form = new URLSearchParams();
                for (const [k, v] of Object.entries(params)) {
                    form.append(k, v);
                }
                try {
                    const url = `/cgi-bin/webtextposter?action=${action}&token=${token}&lang=zh_CN&f=json&ajax=1`;
                    const resp = await fetch(url, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: form.toString()
                    });
                    const data = await resp.json();
                    console.log(`action=${action}, params=${Object.keys(params).join(',')}: ret=${data.base_resp?.ret}, err=${data.base_resp?.err_msg}`);
                    if (data.base_resp?.ret === 0) {
                        return { step: action, success: true, data, template: tpl };
                    }
                } catch(e) {
                    console.log(`action=${action} error:`, e.message);
                }
            }
        }

        return { step: 'all', error: 'not found', sessionId, templateCount: templates.length };
    }, { title: TITLE, token });

    console.log('\nAPI结果:', JSON.stringify(result, null, 2).slice(0, 3000));

    await browser.close();
})();
