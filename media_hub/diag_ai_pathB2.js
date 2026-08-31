// 路径B修正: js_img_from_ai 入口插入正文 → 从正文选择设为封面 → 完成
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '星空下的灯塔，光束穿透云层，宁静海面，数字艺术';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN' });
    const page = await ctx.newPage();

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

    // 点击正文并输入标题（光标进入正文编辑区）
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面-路径B修正版');

    // ===== 阶段1: 正文入口 AI 生成并插入 =====
    console.log('=== 阶段1: 正文入口 AI 生成 ===');
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 用正文工具栏的 AI 配图（js_img_from_ai）
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);

    const dialogCheck = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };
        return { opened: wrp.getBoundingClientRect().width > 0 };
    });
    console.log('对话框打开:', dialogCheck.opened);
    if (!dialogCheck.opened) { await browser.close(); return; }

    const initImgs = await editor.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0);
    console.log(`初始图片数: ${initImgs}`);

    const ta = editor.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await editor.waitForTimeout(500);
    await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });
    console.log('已发送生成请求');

    let generated = false;
    for (let i = 0; i < 18; i++) {
        await editor.waitForTimeout(5000);
        const state = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, generating: true };
            const imgs = wrp.querySelectorAll('img').length;
            const text = wrp.textContent || '';
            const generating = text.includes('生成中') || !!wrp.querySelector('[class*="loading"], [class*="spin"]');
            return { imgs, generating };
        });
        if (state.imgs > initImgs && !state.generating) { generated = true; console.log(`✓ 生成完成（第${(i + 1) * 5}s，图片=${state.imgs}）`); break; }
    }
    if (!generated) { console.log('生成超时'); await browser.close(); return; }

    // 点击最新图片的"应用"（正文入口的按钮文本是"应用"）
    const applyResult = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
            el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用'
        );
        if (btns.length === 0) return { ok: false, reason: 'no btn' };
        btns[btns.length - 1].click();
        return { ok: true, count: btns.length, clicked: btns[btns.length - 1].textContent?.trim() };
    });
    console.log('点击应用:', JSON.stringify(applyResult));
    await editor.waitForTimeout(4000);

    // 验证正文图片
    const bodyImgs = await editor.evaluate(() => ({
        count: document.querySelectorAll('.ProseMirror img, #js_content img').length,
        srcs: [...document.querySelectorAll('.ProseMirror img, #js_content img')].map(i => i.src?.slice(0, 60)),
    }));
    console.log('正文图片:', JSON.stringify(bodyImgs, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'pathB2_inserted.png') });

    if (bodyImgs.count === 0) {
        console.log('正文插入失败！');
        await browser.close();
        return;
    }

    // ===== 阶段2: 关闭 AI 对话框，从正文选择封面 =====
    console.log('\n=== 阶段2: 从正文选择封面 ===');
    // 关闭 AI 对话框
    await editor.keyboard.press('Escape').catch(() => {});
    await editor.waitForTimeout(1000);
    // 强制移除（可能 Escape 没关闭）
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.waitForTimeout(800);

    // hover 封面区域
    const coverBtn = editor.locator('.js_share_type_none_image').first();
    await coverBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await coverBtn.hover({ timeout: 5000 }).catch(e => console.log('hover 失败:', e.message.split('\n')[0]));
    await editor.waitForTimeout(1200);

    // 检查"从正文选择"是否可见
    const selectVisible = await editor.evaluate(() => {
        const el = document.querySelector('.js_selectCoverFromContent');
        if (!el) return { exists: false };
        return { exists: true, visible: el.getBoundingClientRect().width > 0 };
    });
    console.log('从正文选择按钮可见:', selectVisible.visible);

    // 点击（无论可见与否都用 evaluate）
    await editor.evaluate(() => document.querySelector('.js_selectCoverFromContent')?.click());
    await editor.waitForTimeout(3000);

    // ===== 阶段3: 在 img-picker 对话框中选择图片 =====
    console.log('\n=== 阶段3: 选择图片 ===');
    const pickerState = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };
        const r = wrp.getBoundingClientRect();
        return {
            opened: r.width > 0,
            text: wrp.textContent?.slice(0, 120),
            imgCount: wrp.querySelectorAll('img').length,
            imgs: [...wrp.querySelectorAll('img')].map((i, idx) => ({
                idx, src: i.src?.slice(0, 70),
                w: Math.round(i.getBoundingClientRect().width),
                class: i.className?.toString().slice(0, 30),
                parentClass: i.parentElement?.className?.toString().slice(0, 40),
            })),
        };
    });
    console.log(JSON.stringify(pickerState, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'pathB2_picker.png') });

    if (!pickerState.opened || pickerState.imgCount === 0) {
        console.log('选择器未打开或无图片');
        await browser.close();
        return;
    }

    // 点击第一张图片（或可选择的图片项）
    const imgClicked = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        // 找可选择图片的容器（通常有 class 含 img/item/pic 且可点击）
        const imgItems = [...wrp.querySelectorAll('img')].filter(i => i.getBoundingClientRect().width > 50);
        if (imgItems.length === 0) return { ok: false };
        // 点击图片或其父容器
        const target = imgItems[0].closest('[class*="item"], [class*="pic"], [class*="select"]') || imgItems[0];
        target.click();
        return { ok: true, clickedClass: target.className?.toString().slice(0, 50) };
    });
    console.log('点击图片:', JSON.stringify(imgClicked));
    await editor.waitForTimeout(1500);
    await editor.screenshot({ path: path.join(DBG, 'pathB2_img_selected.png') });

    // 点击"下一步"
    const nextResult = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const nextBtns = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a')].filter(el =>
            el.textContent?.trim() === '下一步' && el.getBoundingClientRect().width > 0
        );
        if (nextBtns.length === 0) return { ok: false };
        nextBtns[0].click();
        return { ok: true };
    });
    console.log('点击下一步:', JSON.stringify(nextResult));
    await editor.waitForTimeout(3000);
    await editor.screenshot({ path: path.join(DBG, 'pathB2_next.png') });

    // 检查是否出现裁剪界面
    const cropState = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };
        const r = wrp.getBoundingClientRect();
        return {
            opened: r.width > 0,
            text: wrp.textContent?.slice(0, 150),
            hasFinish: [...wrp.querySelectorAll('button, .btn, [class*="btn"], a')].some(el =>
                el.textContent?.trim() === '完成' && el.getBoundingClientRect().width > 0
            ),
        };
    });
    console.log('下一步后状态:', JSON.stringify(cropState, null, 2));

    // 如果有"完成"按钮，点击它
    if (cropState.hasFinish) {
        console.log('\n=== 点击完成 ===');
        await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            const finishBtn = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a')].find(el =>
                el.textContent?.trim() === '完成' && el.getBoundingClientRect().width > 0
            );
            finishBtn?.click();
        });
        await editor.waitForTimeout(3000);
    }

    // ===== 阶段4: 最终验证封面 =====
    console.log('\n=== 阶段4: 最终封面验证 ===');
    const finalCover = await editor.evaluate(() => {
        const nullCover = document.querySelector('#js_cover_null');
        const coverArea = document.querySelector('#js_cover_area, .cover_appmsg_item, .setting-group__cover');
        const coverImgs = coverArea ? [...coverArea.querySelectorAll('img')].map(i => i.src?.slice(0, 60)) : [];
        return {
            nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false,
            coverImgs,
        };
    });
    console.log(JSON.stringify(finalCover, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'pathB2_final.png') });

    await browser.close();
})();
