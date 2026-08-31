// 获取create API的完整响应，然后调用generate生成海报
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    let createResp = null;
    let generateResp = null;
    let confirmResp = null;

    page.on('response', async res => {
        const url = res.url();
        if (!url.includes('webtextposter')) return;
        try {
            const body = await res.text();
            const action = url.match(/action=(\w+)/)?.[1];
            const parsed = JSON.parse(body);
            if (action === 'create') {
                createResp = parsed;
                require('fs').writeFileSync(path.join(DBG, 'poster_create_resp.json'), JSON.stringify(parsed, null, 2));
                console.log('create response saved, poster_list count:', parsed.poster_list?.length);
            } else if (action === 'generate' || action === 'compose' || action === 'make') {
                generateResp = parsed;
                require('fs').writeFileSync(path.join(DBG, 'poster_generate_resp.json'), JSON.stringify(parsed, null, 2));
                console.log('generate response saved:', action);
            } else if (action === 'confirm' || action === 'insert' || action === 'apply' || action === 'use') {
                confirmResp = parsed;
                require('fs').writeFileSync(path.join(DBG, 'poster_confirm_resp.json'), JSON.stringify(parsed, null, 2));
                console.log('confirm response saved:', action);
            } else {
                console.log('other poster action:', action, body.slice(0, 200));
            }
        } catch(e) {
            console.log('parse error:', e.message);
        }
    });

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
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 点击文字海报触发create API
    await page.hover('.image-selector__add');
    await page.waitForTimeout(500);
    const posterBtn = page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' });
    await posterBtn.first().click({ timeout: 5000 });

    // 等待create响应
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(2000);
        if (createResp) break;
    }

    if (!createResp || createResp.base_resp?.ret !== 0) {
        console.log('create failed');
        await browser.close();
        return;
    }

    console.log('\n=== create响应关键字段 ===');
    console.log('base_resp:', createResp.base_resp);
    console.log('session_id:', createResp.session_id);
    console.log('poster_list length:', createResp.poster_list?.length);
    if (createResp.poster_list?.length > 0) {
        const tpl = createResp.poster_list[0];
        console.log('第一个模板字段:', Object.keys(tpl));
        tpl.cos_url && console.log('cos_url:', tpl.cos_url?.slice(0, 80));
        tpl.template_id && console.log('template_id:', tpl.template_id);
        tpl.style && console.log('style:', tpl.style);
        tpl.text_color && console.log('text_color:', tpl.text_color);
        tpl.bg_color && console.log('bg_color:', tpl.bg_color);
    }

    // 随机选一个模板，直接在页面JS中调用Vue组件的generate方法
    console.log('\n=== 尝试通过Vue组件生成海报 ===');

    // 先看create返回的字段有哪些其他关键信息
    console.log('createResp所有顶层key:', Object.keys(createResp));

    // 尝试直接调用generate API
    const templates = createResp.poster_list || [];
    if (templates.length > 0) {
        const randomTpl = templates[Math.floor(Math.random() * templates.length)];
        console.log('随机选择模板 id:', randomTpl.template_id, 'style:', randomTpl.style);

        // 通过page.evaluate调用generate
        const genResult = await page.evaluate(async ({ token, sessionId, title, tpl }) => {
            const formData = new URLSearchParams();
            formData.append('session_id', sessionId);
            formData.append('text', title);
            formData.append('template_id', tpl.template_id);
            formData.append('style', tpl.style || '');

            // 尝试所有可能的action名称
            const actions = ['generate', 'compose', 'create_poster', 'make', 'render'];
            for (const action of actions) {
                try {
                    const url = `/cgi-bin/webtextposter?action=${action}&token=${token}&lang=zh_CN&f=json&ajax=1`;
                    const res = await fetch(url, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: formData.toString()
                    });
                    const data = await res.json();
                    if (data.base_resp?.ret === 0) {
                        return { action, data };
                    }
                    // 记录失败的
                    console.log(`action=${action}: ret=${data.base_resp?.ret}, err=${data.base_resp?.err_msg}`);
                } catch(e) {
                    console.log(`action=${action} error:`, e.message);
                }
            }
            return { error: 'all actions failed' };
        }, { token, sessionId: createResp.session_id, title: TITLE, tpl: randomTpl });

        console.log('\ngenerate结果:', JSON.stringify(genResult, null, 2).slice(0, 2000));
    }

    await page.waitForTimeout(3000);
    await browser.close();
})();
