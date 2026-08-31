// 修复：等待formatList异步完成，手动设置selected并触发onChange
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '文字海报测试-' + Date.now();

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') {
            const t = msg.text();
            if (!t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
                console.log('  [page-err]', t.slice(0, 300));
            }
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    let token = page.url().match(/token=(\d+)/)?.[1];
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    token = page.url().match(/token=(\d+)/)?.[1] || token;
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题+正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('AI文字海报生成');
    await page.waitForTimeout(500);

    // 生成海报
    console.log('=== 生成海报 ===');
    const poster = await page.evaluate(async (title) => {
        async function api(action, data) {
            const t = new URLSearchParams(location.search).get('token') || '';
            const r = await fetch(`/cgi-bin/webtextposter?action=${action}&token=${t}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'data=' + encodeURIComponent(JSON.stringify(data))
            });
            return r.json();
        }
        const init = await api('create', {prompt:"",action_mode:0});
        const specList = (init.template_config||[]).map(t=>({template_id:t.template_id,style:(t.support_style||[])[Math.floor(Math.random()*(t.support_style||[]).length)]||''}));
        const gen = await api('create', {prompt:title,action_mode:1,session_id:init.session_id,data_buf:"",spec_list:specList});
        const idx = Math.floor(Math.random()*gen.poster_list.length);
        const sel = gen.poster_list[idx];
        const ins = await api('insert', {session_id:gen.session_id||init.session_id,template_id:sel.template_id,style:sel.style,cos_url:sel.cos_url||"",data_buf:gen.data_buf||"",prompt:title});
        return {ok: ins.base_resp?.ret===0, file_id: ins.file_id, cdn_url: ins.cdn_url};
    }, TITLE);
    console.log('海报:', poster.ok ? '成功' : '失败', 'file_id:', poster.file_id);
    if (!poster.ok) { await browser.close(); return; }

    // 插入图片到image-selector并等待异步完成
    console.log('\n=== 插入图片到选择器 ===');
    await page.evaluate(async ({file_id, cdn_url}) => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) throw new Error('no vm');

        // 等待现有formatList完成
        const origLen = vm.innerList.length;

        // 手动调用formatList（这是onTextPosterInsert内部的核心逻辑）
        const imageItem = { file_id, url: cdn_url, cdn_url, name: 'poster.jpg', size: 0 };
        await vm.formatList([imageItem]);

        // 等待Vue更新
        await vm.$nextTick();
        await new Promise(r => setTimeout(r, 500));

        // 获取刚添加的item
        const newItem = vm.innerList[vm.innerList.length - 1];
        if (newItem) {
            vm.$set(newItem, '_isTextPoster', true);
            vm.selected = newItem.seq;
            console.log('selected set to:', vm.selected, 'innerList len:', vm.innerList.length);
            vm.onChange();
            vm.updateRecommendTopic && vm.updateRecommendTopic();
        }
    }, {file_id: poster.file_id, cdn_url: poster.cdn_url});

    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(DBG, 'poster_inserted2.png'), fullPage: true });

    // 检查状态
    const state = await page.evaluate(() => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        return {
            innerListLen: vm.innerList?.length,
            selected: vm.selected,
            items: vm.innerList?.map(i => ({seq:i.seq, file_id:i.file_id, _isTextPoster:i._isTextPoster})),
            coverSet: !!document.querySelector('.cover-preview img, [class*="cover"] img')
        };
    });
    console.log('插入后状态:', JSON.stringify(state, null, 2));

    // 点击"保存为草稿"
    console.log('\n=== 点击保存为草稿 ===');
    const saveClicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, a, [role="button"], span, div')];
        const saveBtn = btns.find(b => {
            const t = b.textContent?.trim();
            return (t === '保存为草稿' || t === '存草稿') && b.offsetParent !== null && b.getBoundingClientRect().width > 20;
        });
        if (saveBtn) {
            saveBtn.click();
            return { clicked: true, tag: saveBtn.tagName, text: saveBtn.textContent?.trim() };
        }
        return { clicked: false };
    });
    console.log('保存按钮点击:', saveClicked);

    await page.waitForTimeout(8000);
    await page.screenshot({ path: path.join(DBG, 'poster_saved2.png'), fullPage: true });

    // 检查结果
    const result = await page.evaluate(() => {
        const body = document.body.innerText;
        const url = location.href;
        const errors = [];
        ['不能为空','失败','错误'].forEach(k => {
            if (body.includes(k)) {
                const m = body.match(new RegExp(`[^\\n]{0,30}${k}[^\\n]{0,30}`));
                if (m) errors.push(m[0]);
            }
        });
        // 查找成功提示
        const success = body.includes('保存成功') || body.includes('已保存') || url.includes('appmsgid=');
        // 查找图片预览
        const imgs = [...document.images].filter(i => i.src.includes('mmbiz') && i.getBoundingClientRect().width > 50);
        return { url, errors, success, imgCount: imgs.length, imgSrcs: imgs.slice(0,3).map(i => i.src.slice(0,80)) };
    });
    console.log('\n保存结果:');
    console.log('  url:', result.url);
    console.log('  success:', result.success);
    console.log('  errors:', result.errors);
    console.log('  图片数:', result.imgCount);
    console.log('  图片:', result.imgSrcs);

    await page.waitForTimeout(3000);
    await browser.close();
})();
