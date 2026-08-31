// mask出现了说明dialogVisible=true，但是内容没渲染
// 可能是Vue的$nextTick或者异步渲染问题，需要等待并检查组件状态
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

    // 拦截webtextposter请求
    const posterReqs = [];
    page.on('request', req => {
        if (req.url().includes('webtextposter') || req.url().includes('textposter')) {
            posterReqs.push({ method: req.method(), url: req.url().split('?')[0], action: req.url().match(/action=(\w+)/)?.[1] });
        }
    });
    page.on('response', async res => {
        if (res.url().includes('webtextposter') || res.url().includes('textposter')) {
            try {
                const body = await res.text();
                posterReqs.push({ type: 'resp', action: res.url().match(/action=(\w+)/)?.[1], status: res.status(), body: body.slice(0, 500) });
            } catch(e) {}
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
    await page.keyboard.type('测试');
    await page.waitForTimeout(500);

    await page.hover('.image-selector__add');
    await page.waitForTimeout(500);

    // 点击文字海报
    const posterBtn = page.locator('.image-selector__add .pop-opr__button', { hasText: '文字海报' });
    await posterBtn.first().click({ timeout: 5000 });
    console.log('点击完成');

    // 等待API请求（预加载模板）
    await page.waitForTimeout(8000);

    console.log('\n=== 拦截到的poster请求 ===');
    posterReqs.forEach(r => console.log(' ', r.type === 'resp' ? 'RESP' : r.method, r.action || '', r.status || '', r.body?.slice(0,200) || ''));

    // 检查对话框组件的Vue状态
    const dlgState = await page.evaluate(() => {
        function findVue(el, depth = 0) {
            if (depth > 20) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const f = findVue(child, depth + 1);
                if (f) return f;
            }
            return null;
        }

        const dlg = document.querySelector('.text_poster_dialog');
        if (!dlg) return { found: false };

        const dvm = findVue(dlg);
        if (!dvm) return { found: true, dvmFound: false };

        // 获取所有data属性
        const data = {};
        for (const key of Object.keys(dvm.$data || {})) {
            const val = dvm.$data[key];
            data[key] = typeof val === 'function' ? '[fn]' :
                val === null ? null :
                Array.isArray(val) ? `array(${val.length})` :
                typeof val === 'object' ? JSON.stringify(val).slice(0, 200) : val;
        }

        // 检查模板是否加载
        const posterList = dvm.posterList || dvm.poster_list || dvm.templates;
        return {
            found: true,
            dvmFound: true,
            data,
            posterListLen: posterList?.length || 0,
            dlgHTML: dlg.innerHTML.slice(0, 1000),
            children: dlg.children.length,
            childTags: [...dlg.children].map(c => c.tagName + '.' + c.className?.toString().slice(0,50))
        };
    });
    console.log('\n对话框状态:', JSON.stringify(dlgState, null, 2));

    await page.screenshot({ path: path.join(DBG, 'poster_after_wait.png'), fullPage: true });

    // 如果mask存在但对话框没有内容，说明是v-if/v-show条件不满足
    // 检查weui-desktop-mask后面的兄弟元素
    const maskSiblings = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        if (!dlg) return 'not found';
        const mask = dlg.querySelector('.weui-desktop-mask');
        if (!mask) return 'mask not found';
        // mask的下一个兄弟应该是dialog内容
        const next = mask.nextElementSibling;
        return {
            nextTag: next?.tagName,
            nextClass: next?.className?.toString(),
            nextHTML: next?.innerHTML?.slice(0, 500),
            nextDisplay: next ? getComputedStyle(next).display : 'none',
            allChildren: [...dlg.children].map(c => ({
                tag: c.tagName,
                class: c.className?.toString().slice(0, 80),
                display: getComputedStyle(c).display,
                childCount: c.children.length
            }))
        };
    });
    console.log('\nmask兄弟元素:', JSON.stringify(maskSiblings, null, 2));

    // 检查image-selector组件的posterLoading等状态
    const vmState = await page.evaluate(() => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return 'not found';
        const data = {};
        for (const key of Object.keys(vm.$data || {})) {
            const val = vm.$data[key];
            if (key.toLowerCase().includes('poster') || key.toLowerCase().includes('text')) {
                data[key] = typeof val === 'function' ? '[fn]' :
                    Array.isArray(val) ? `array(${val.length})` :
                    typeof val === 'object' ? JSON.stringify(val).slice(0, 200) : val;
            }
        }
        return data;
    });
    console.log('\nimage-selector poster相关状态:', JSON.stringify(vmState, null, 2));

    await browser.close();
})();
