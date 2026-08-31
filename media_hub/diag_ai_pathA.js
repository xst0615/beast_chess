// 路径A: 封面菜单的 AI 配图 (js_aiImage) —— 测试是否直接设为封面
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '抽象几何拼贴画，蓝色和橙色渐变，现代设计感';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN' });
    const page = await ctx.newPage();

    const apiCalls = [];
    ctx.on('response', (res) => {
        const url = res.url();
        if (url.includes('mpaigenpic') || url.includes('cover') || url.includes('appmsg')) {
            if (url.includes('cgi-bin') && !url.includes('.js')) {
                apiCalls.push({ t: Date.now() % 100000, method: res.request().method(), url: url.replace('https://mp.weixin.qq.com', '').slice(0, 100) });
            }
        }
    });

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

    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面-封面菜单AI路径');

    // 移除残留对话框
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 步骤1: 触发封面下拉菜单并点击 js_aiImage
    console.log('=== 步骤1: 打开封面下拉菜单 ===');
    const coverBtn = editor.locator('.js_share_type_none_image').first();
    await coverBtn.hover({ timeout: 5000 }).catch(e => console.log('hover 失败:', e.message.split('\n')[0]));
    await editor.waitForTimeout(1200);

    // 检查 js_aiImage 是否可见
    const aiImageVisible = await editor.evaluate(() => {
        const el = document.querySelector('.js_aiImage');
        if (!el) return { exists: false };
        const r = el.getBoundingClientRect();
        return { exists: true, visible: r.width > 0, w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log('js_aiImage 状态:', JSON.stringify(aiImageVisible));
    await editor.screenshot({ path: path.join(DBG, 'pathA_menu.png') });

    if (!aiImageVisible.exists) {
        console.log('js_aiImage 不存在!');
        await browser.close();
        return;
    }

    // 点击 js_aiImage（用 Playwright click 如果可见，否则 evaluate）
    if (aiImageVisible.visible) {
        await editor.locator('.js_aiImage').first().click({ timeout: 5000 });
        console.log('已用 Playwright click 点击 js_aiImage');
    } else {
        await editor.evaluate(() => document.querySelector('.js_aiImage')?.click());
        console.log('已用 evaluate click 点击 js_aiImage');
    }
    await editor.waitForTimeout(3000);

    // 步骤2: 检查 AI 对话框
    console.log('\n=== 步骤2: 检查 AI 对话框 ===');
    const dialogState = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };
        const r = wrp.getBoundingClientRect();
        return {
            opened: r.width > 0,
            text: wrp.textContent?.slice(0, 100),
            hasTextarea: !!wrp.querySelector('.chat_textarea'),
            imgCount: wrp.querySelectorAll('img').length,
        };
    });
    console.log('对话框:', JSON.stringify(dialogState, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'pathA_dialog.png') });

    if (!dialogState.opened) {
        console.log('对话框未打开，退出');
        await browser.close();
        return;
    }

    // 步骤3: 输入提示词并发送
    console.log('\n=== 步骤3: 输入并发送 ===');
    const initImgs = dialogState.imgCount;
    const ta = editor.locator('.chat_textarea').first();
    if (dialogState.hasTextarea) {
        await ta.click();
        await ta.fill(PROMPT);
        await editor.waitForTimeout(500);
        await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });
        console.log('已发送');
    } else {
        console.log('无输入框!');
        await browser.close();
        return;
    }

    // 步骤4: 等待生成
    let generated = false;
    for (let i = 0; i < 18; i++) {
        await editor.waitForTimeout(5000);
        const state = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, generating: true, opened: false };
            const imgs = wrp.querySelectorAll('img').length;
            const text = wrp.textContent || '';
            const generating = text.includes('生成中') || !!wrp.querySelector('[class*="loading"], [class*="spin"]');
            return { imgs, generating, opened: wrp.getBoundingClientRect().width > 0 };
        });
        if (i % 3 === 2) console.log(`等待 ${(i + 1) * 5}s: 图片=${state.imgs}, 生成中=${state.generating}, 对话框=${state.opened}`);
        if (state.imgs > initImgs && !state.generating) { generated = true; break; }
        if (!state.opened && i > 2) { console.log('对话框已关闭（可能已自动应用）'); break; }
    }
    console.log('生成完成:', generated);
    await editor.screenshot({ path: path.join(DBG, 'pathA_generated.png') });

    // 步骤5: 点击最新图片的"使用"/"应用"按钮
    console.log('\n=== 步骤5: 使用/应用 ===');
    // 先列出所有 op 按钮的文本
    const opBtns = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return [];
        return [...wrp.querySelectorAll('.ai-image-op-btn')].map(el => ({
            text: el.textContent?.trim(), visible: el.getBoundingClientRect().width > 0
        }));
    });
    console.log('所有 op 按钮:', JSON.stringify(opBtns));

    const applyInfo = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp || wrp.getBoundingClientRect().width === 0) return { dialogOpen: false };
        const applyBtns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
            el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用'
        );
        if (applyBtns.length === 0) return { dialogOpen: true, applyCount: 0 };
        const last = applyBtns[applyBtns.length - 1];
        last.click();
        return { dialogOpen: true, applyCount: applyBtns.length, clickedText: last.textContent?.trim() };
    });
    console.log('应用结果:', JSON.stringify(applyInfo));
    await editor.waitForTimeout(4000);

    // 步骤6: 检查封面是否已设置（核心验证）
    console.log('\n=== 步骤6: 封面状态 ===');
    const coverCheck = await editor.evaluate(() => {
        const nullCover = document.querySelector('#js_cover_null');
        const coverArea = document.querySelector('#js_cover_area, .setting-group__cover, .cover_appmsg_item');
        const coverImgs = coverArea ? [...coverArea.querySelectorAll('img')].map(i => i.src?.slice(0, 70)) : [];
        const allCoverImgs = [...document.querySelectorAll('.cover_appmsg_item img, #js_cover img, .js_cover img')].map(i => i.src?.slice(0, 70));
        return {
            nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false,
            coverAreaImgCount: coverImgs.length,
            coverImgs,
            otherCoverImgs: allCoverImgs,
        };
    });
    console.log(JSON.stringify(coverCheck, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'pathA_applied.png') });
    console.log('\nAPI 调用:', JSON.stringify(apiCalls, null, 1));

    await browser.close();
})();
