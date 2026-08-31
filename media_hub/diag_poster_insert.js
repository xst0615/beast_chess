// 完整流程：生成海报 → 通过image-selector的insert回调插入图片 → 保存草稿
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '文字海报测试-' + Date.now();

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        const t = msg.text();
        if (msg.type() === 'error' && !t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
            console.log('  [page-err]', t.slice(0, 200));
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    let token = page.url().match(/token=(\d+)/)?.[1];
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    token = page.url().match(/token=(\d+)/)?.[1] || token;

    // 先关闭所有弹窗
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);

    // 填正文描述
    const bodyEditor = page.locator('.ProseMirror').nth(1);
    await bodyEditor.click();
    await page.keyboard.type('这是一张由AI文字海报生成的图片');
    await page.waitForTimeout(500);

    // === 生成文字海报 ===
    console.log('=== 生成文字海报 ===');
    const posterResult = await page.evaluate(async ({ title }) => {
        async function posterApi(action, data) {
            const token = new URLSearchParams(location.search).get('token') || '';
            const resp = await fetch(`/cgi-bin/webtextposter?action=${action}&token=${token}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'data=' + encodeURIComponent(JSON.stringify(data))
            });
            return await resp.json();
        }

        const init = await posterApi('create', { prompt: "", action_mode: 0 });
        if (init.base_resp?.ret !== 0) return { ok: false, error: 'init failed' };

        const specList = (init.template_config || []).map(t => {
            const styles = t.support_style || [];
            return { template_id: t.template_id, style: styles.length ? styles[Math.floor(Math.random()*styles.length)] : '' };
        });

        const gen = await posterApi('create', {
            prompt: title, action_mode: 1,
            session_id: init.session_id, data_buf: "", spec_list: specList
        });
        if (gen.base_resp?.ret !== 0 || !gen.poster_list?.length) return { ok: false, error: 'gen failed' };

        const idx = Math.floor(Math.random() * gen.poster_list.length);
        const selected = gen.poster_list[idx];

        const ins = await posterApi('insert', {
            session_id: gen.session_id || init.session_id,
            template_id: selected.template_id, style: selected.style,
            cos_url: selected.cos_url || "", data_buf: gen.data_buf || "",
            prompt: title
        });

        return {
            ok: ins.base_resp?.ret === 0,
            file_id: ins.file_id,
            cdn_url: ins.cdn_url,
            pic_id: ins.pic_id
        };
    }, { title: TITLE });

    console.log('海报生成:', posterResult.ok ? '成功' : '失败');
    if (posterResult.ok) {
        console.log('  file_id:', posterResult.file_id);
        console.log('  cdn_url:', posterResult.cdn_url?.slice(0, 80));
    } else {
        console.log('  错误:', posterResult.error);
        await browser.close();
        return;
    }

    // === 将海报图片插入贴图编辑器 ===
    // 贴图模式的图片区域需要研究如何添加
    // 方法1: 找到图片上传/添加区域，通过拖拽或API方式插入
    // 方法2: 使用image-selector组件的Vue方法
    console.log('\n=== 分析图片选择器结构 ===');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(DBG, 'before_insert.png'), fullPage: true });

    const selectorInfo = await page.evaluate(() => {
        // 查找image-selector组件
        const selector = document.querySelector('.image-selector');
        const vm = selector?.__vue__;
        if (!vm) return { found: false };

        return {
            found: true,
            innerListLen: vm.innerList?.length,
            hasFormatList: typeof vm.formatList === 'function',
            hasOnTextPosterInsert: typeof vm.onTextPosterInsert === 'function',
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(vm)).filter(m => 
                typeof vm[m] === 'function' && m !== 'constructor'
            ).slice(0, 30)
        };
    });
    console.log('image-selector信息:', selectorInfo);

    // 通过Vue调用onTextPosterInsert来插入图片
    console.log('\n=== 通过Vue组件方法插入图片 ===');
    const insertResult = await page.evaluate(async ({ file_id, cdn_url }) => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return { ok: false, error: 'vm not found' };

        // onTextPosterInsert接收(imageList, metaData)
        const imageList = [{
            file_id: file_id,
            url: cdn_url,
            cdn_url: cdn_url,
            name: 'text_poster.jpg',
            size: 0
        }];

        const metaData = {
            prompt: '', sessionId: '', dataBuf: '',
            allPosters: [], templateConfig: [],
            styleIndexMap: {}, selectedIndex: 0,
            templateId: '', style: '', picId: ''
        };

        // 设置_textPosterEditIdx为-1表示新增（非编辑）
        vm._textPosterEditIdx = -1;

        // 调用onTextPosterInsert
        try {
            await vm.onTextPosterInsert(imageList, metaData);
            return { ok: true, innerListLen: vm.innerList?.length, selected: vm.selected };
        } catch(e) {
            return { ok: false, error: e.message, stack: e.stack?.slice(0, 500) };
        }
    }, { file_id: posterResult.file_id, cdn_url: posterResult.cdn_url });

    console.log('插入结果:', insertResult);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(DBG, 'after_insert.png'), fullPage: true });

    // 检查innerList状态
    const afterInsert = await page.evaluate(() => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        return {
            innerListLen: vm.innerList?.length,
            items: vm.innerList?.map(i => ({
                file_id: i.file_id,
                url: i.url?.slice?.(0, 60) || i.url,
                cdn_url: i.cdn_url?.slice?.(0, 60) || i.cdn_url,
                _isTextPoster: i._isTextPoster,
                seq: i.seq
            })),
            selected: vm.selected
        };
    });
    console.log('\n插入后innerList:', afterInsert.innerListLen);
    afterInsert.items?.forEach((it, i) => console.log(`  [${i}]`, JSON.stringify(it)));

    // === 保存草稿 ===
    console.log('\n=== 保存草稿 ===');
    // 查找保存按钮
    const saveBtn = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, .weui-desktop-btn')];
        const candidates = btns.filter(b => {
            const t = b.textContent?.trim();
            return (t.includes('保存') || t.includes('存草稿') || t.includes('草稿')) && b.offsetParent !== null;
        });
        return candidates.map(b => ({ text: b.textContent?.trim(), class: b.className?.toString().slice(0, 60) }));
    });
    console.log('保存按钮候选:', saveBtn);

    // 点击保存
    try {
        await page.locator('.weui-desktop-btn_primary').filter({ hasText: '保存' }).first().click({ timeout: 5000 });
        await page.waitForTimeout(5000);
    } catch(e) {
        console.log('primary保存按钮未找到，尝试其他方式:', e.message?.slice(0, 100));
        // 尝试用JS触发保存
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const saveBtn = btns.find(b => b.textContent?.includes('保存') && b.offsetParent);
            if (saveBtn) saveBtn.click();
        });
        await page.waitForTimeout(5000);
    }

    await page.screenshot({ path: path.join(DBG, 'after_save.png'), fullPage: true });

    // 检查保存结果
    const saveResult = await page.evaluate(() => {
        // 查找toast/提示信息
        const toasts = [...document.querySelectorAll('.weui-toast, .weui-toptips, [class*="toast"], [class*="msg"]')];
        const visible = toasts.filter(t => t.offsetParent !== null);
        // 检查body中的错误信息
        const bodyText = document.body.innerText;
        const hasError = bodyText.includes('失败') || bodyText.includes('错误') || bodyText.includes('不能为空');
        const errorText = hasError ? bodyText.match(/[^.]{0,50}(失败|错误|不能为空)[^.]{0,50}/)?.[0] : null;
        return {
            toastCount: visible.length,
            toasts: visible.map(t => t.textContent?.trim().slice(0, 100)),
            url: location.href,
            hasError,
            errorText
        };
    });
    console.log('保存结果:', saveResult);

    await page.waitForTimeout(3000);
    await browser.close();
})();
