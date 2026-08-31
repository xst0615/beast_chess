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

    page.on('console', msg => {
        const t = msg.text();
        if (msg.type() === 'error' && !t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
            console.log('  [page-' + msg.type() + ']', t.slice(0, 200));
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    let token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    token = page.url().match(/token=(\d+)/)?.[1] || token;
    console.log('token:', token);

    // 在页面中定义poster API函数
    await page.exposeFunction('nodeLog', (...args) => console.log('[page]', ...args));

    const result = await page.evaluate(async ({ token, title }) => {
        async function posterApi(action, data) {
            const resp = await fetch(`/cgi-bin/webtextposter?action=${action}&token=${token}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'data=' + encodeURIComponent(JSON.stringify(data))
            });
            return await resp.json();
        }

        // Step1: init
        const init = await posterApi('create', { prompt: "", action_mode: 0 });
        console.log('init ret:', init.base_resp?.ret);

        if (init.base_resp?.ret !== 0) {
            return { ok: false, step: 'init', error: init.base_resp?.err_msg };
        }

        // Build spec_list: 随机选style
        const specList = (init.template_config || []).map(t => {
            const styles = t.support_style || [];
            return { template_id: t.template_id, style: styles.length ? styles[Math.floor(Math.random()*styles.length)] : '' };
        });

        // Step2: generate
        const gen = await posterApi('create', {
            prompt: title,
            action_mode: 1,
            session_id: init.session_id,
            data_buf: "",
            spec_list: specList
        });
        console.log('gen ret:', gen.base_resp?.ret, 'posters:', gen.poster_list?.length);

        if (gen.base_resp?.ret !== 0 || !gen.poster_list?.length) {
            return { ok: false, step: 'generate', error: gen.base_resp?.err_msg, data: gen };
        }

        // Random select one
        const idx = Math.floor(Math.random() * gen.poster_list.length);
        const selected = gen.poster_list[idx];

        // Step3: insert
        const ins = await posterApi('insert', {
            session_id: gen.session_id || init.session_id,
            template_id: selected.template_id,
            style: selected.style,
            cos_url: selected.cos_url || "",
            data_buf: gen.data_buf || "",
            prompt: title
        });
        console.log('insert ret:', ins.base_resp?.ret, 'cdn_url:', ins.cdn_url?.slice?.(0, 80));

        return { ok: ins.base_resp?.ret === 0, init, gen, selected, insert: ins, selectedIdx: idx };
    }, { token, title: TITLE });

    console.log('\n=== 最终结果 ===');
    console.log('success:', result.ok);
    if (!result.ok) {
        console.log('failed at:', result.step, result.error);
        if (result.data) console.log('error data:', JSON.stringify(result.data).slice(0, 500));
    } else {
        console.log('session_id:', result.init.session_id);
        console.log('模板数:', result.init.template_config?.length);
        console.log('生成海报数:', result.gen.poster_list?.length);
        console.log('选择第:', result.selectedIdx, '个');
        console.log('file_id:', result.insert.file_id);
        console.log('cdn_url:', result.insert.cdn_url);

        if (result.insert.cdn_url) {
            const imgResp = await page.request.get(result.insert.cdn_url);
            const imgBuf = await imgResp.body();
            fs.writeFileSync(path.join(DBG, 'poster_preview.jpg'), imgBuf);
            console.log('\n✅ 海报已保存到 data/debug/poster_preview.jpg');
        }
    }

    await page.waitForTimeout(2000);
    await browser.close();
})();
