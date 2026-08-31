// 完整流程：精确 send-btn 发送 → 等新生成 → 应用最新图片 → 验证封面
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '雪山日出，金色阳光洒在山峰上，云海翻腾，壮观风景摄影';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN' });
    const page = await ctx.newPage();

    // 监控关键 API
    const apiCalls = [];
    editor_api_handler = (res) => {
        const url = res.url();
        if ((url.includes('appmsg') || url.includes('cover') || url.includes('img_from') || url.includes('ai')) &&
            !url.includes('.js') && !url.includes('.css')) {
            apiCalls.push({ t: Date.now() % 100000, method: res.request().method(), url: url.slice(0, 120), status: res.status() });
        }
    };

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);

    await page.locator('text=新的创作').first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
    await page.locator('text="文章"').first().click({ timeout: 10000 });
    const editor = await popupPromise;
    await editor.waitForLoadState('domcontentloaded');
    await editor.waitForTimeout(5000);

    // 监听编辑器页的网络（用 response 事件在 ctx 上）
    ctx.on('response', (res) => {
        const url = res.url();
        if ((url.includes('cgi-bin') || url.includes('ai')) && (res.request().method() === 'POST' || url.includes('appmsg') || url.includes('cover') || url.includes('generate'))) {
            if (!url.includes('.js') && !url.includes('.css')) {
                apiCalls.push({ t: Date.now() % 100000, method: res.request().method(), url: url.slice(0, 130), status: res.status() });
            }
        }
    });

    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面-发送诊断');

    // 移除残留对话框
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 记录当前图片数（历史）
    const beforeImgs = await editor.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0).catch(() => -1);

    // 打开 AI 配图
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);

    const initImgCount = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        return wrp ? wrp.querySelectorAll('img').length : 0;
    });
    console.log(`初始图片数: ${initImgCount}`);

    // 输入提示词
    const ta = editor.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await editor.waitForTimeout(800);

    // 精确点击 send-btn（检查激活状态）
    const sendState = await editor.evaluate(() => {
        const btn = document.querySelector('.weui-desktop-dialog__wrp .send-btn');
        if (!btn) return null;
        return { class: btn.className, disabled: btn.className.includes('disabled') };
    });
    console.log('发送按钮状态:', JSON.stringify(sendState));

    apiCalls.length = 0;

    if (!sendState?.disabled) {
        console.log('\n=== 点击 .send-btn 发送 ===');
        await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });
        console.log('已点击发送');
    } else {
        console.log('发送按钮被禁用！尝试触发输入事件激活');
        await editor.locator('.chat_textarea').first().dispatchEvent('input');
        await editor.waitForTimeout(500);
        await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
    }

    // 等待生成（观察图片数增加）
    console.log('\n=== 等待新生成 ===');
    let newImgAppeared = false;
    for (let i = 0; i < 18; i++) {
        await editor.waitForTimeout(5000);
        const state = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, msg: 'no wrp' };
            const imgs = wrp.querySelectorAll('img').length;
            // 找最后一条对话消息
            const msgs = wrp.querySelectorAll('.chat_item, [class*="msg"], [class*="dialog-item"], [class*="chat-item"]');
            const lastMsg = msgs[msgs.length - 1]?.textContent?.trim().slice(0, 50);
            // 检查生成中状态（loading 或 生成中文本）
            const text = wrp.textContent || '';
            const generating = text.includes('生成中') || text.includes('正在') || !!wrp.querySelector('.loading, [class*="loading"], [class*="spin"]');
            return { imgs, lastMsg, generating };
        });
        console.log(`等待 ${(i + 1) * 5}s: 图片=${state.imgs}, 生成中=${state.generating}, 最后消息="${state.lastMsg}"`);

        if (state.imgs > initImgCount && !state.generating) {
            newImgAppeared = true;
            console.log('✓ 新图片已生成');
            break;
        }
        if (i % 4 === 3) {
            await editor.screenshot({ path: path.join(DBG, `send_wait_${i + 1}.png`) }).catch(() => {});
        }
    }
    console.log('API 调用:', JSON.stringify(apiCalls.slice(0, 15), null, 1));

    if (newImgAppeared) {
        await editor.screenshot({ path: path.join(DBG, 'send_generated.png') });

        // 点击最后一张图片对应的"应用"按钮（最后一个应用按钮）
        console.log('\n=== 点击最新图片的应用按钮 ===');
        const applyResult = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return null;
            const applyBtns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el => el.textContent?.trim() === '应用');
            if (applyBtns.length === 0) return { count: 0 };
            // 最后一个应用按钮 = 最新图片
            const last = applyBtns[applyBtns.length - 1];
            const r = last.getBoundingClientRect();
            last.click();
            return { count: applyBtns.length, clicked: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } };
        });
        console.log('应用点击结果:', JSON.stringify(applyResult));
        await editor.waitForTimeout(3000);

        // 检查应用后的状态
        console.log('\n=== 应用后状态检查 ===');
        const afterApply = await editor.evaluate(() => {
            const nullCover = document.querySelector('#js_cover_null');
            const coverArea = document.querySelector('#js_cover_area, .setting-group__cover');
            const coverImgs = coverArea ? [...coverArea.querySelectorAll('img')].map(i => i.src?.slice(0, 80)) : [];
            // 检查是否出现新的确认/裁剪对话框
            const dialogs = [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')].filter(d => {
                const r = d.getBoundingClientRect();
                return r.width > 0;
            }).map(d => d.textContent?.slice(0, 60));
            return {
                nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false,
                coverImgs,
                visibleDialogs: dialogs,
            };
        });
        console.log(JSON.stringify(afterApply, null, 2));
        await editor.screenshot({ path: path.join(DBG, 'send_applied.png') });
        console.log('API 调用（应用后）:', JSON.stringify(apiCalls.slice(-10), null, 1));
    }

    await browser.close();
})();
