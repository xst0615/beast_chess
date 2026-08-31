// 最终完整流程: AI生成 → 插入正文 → 从正文选择 → 设为封面
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '夜空中璀璨银河横跨山谷，湖面倒影星光，风光摄影';

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

    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试-AI封面-最终完整流程');

    // ===== 阶段1: AI 生成并插入正文 =====
    console.log('=== 阶段1: AI 生成并插入正文 ===');
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);
    const initImgs = await editor.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0);

    const ta = editor.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await editor.waitForTimeout(500);
    await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });

    let generated = false;
    for (let i = 0; i < 18; i++) {
        await editor.waitForTimeout(5000);
        const state = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, generating: true };
            const imgs = wrp.querySelectorAll('img').length;
            const text = wrp.textContent || '';
            return { imgs, generating: text.includes('生成中') || !!wrp.querySelector('[class*="loading"], [class*="spin"]') };
        });
        if (state.imgs > initImgs && !state.generating) { generated = true; break; }
    }
    console.log('生成完成:', generated);
    if (!generated) { await browser.close(); return; }

    await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
            el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用'
        );
        btns[btns.length - 1]?.click();
    });
    await editor.waitForTimeout(4000);
    const bodyCount = await editor.evaluate(() => document.querySelectorAll('.ProseMirror img, #js_content img').length);
    console.log('正文图片数:', bodyCount);
    if (bodyCount === 0) { console.log('插入失败'); await browser.close(); return; }

    // ===== 阶段2: 从正文选择 =====
    console.log('\n=== 阶段2: 从正文选择封面 ===');
    await editor.keyboard.press('Escape').catch(() => {});
    await editor.waitForTimeout(1000);
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.waitForTimeout(800);

    const coverBtn = editor.locator('.js_share_type_none_image').first();
    await coverBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await coverBtn.hover({ timeout: 5000 }).catch(() => {});
    await editor.waitForTimeout(1200);
    await editor.evaluate(() => document.querySelector('.js_selectCoverFromContent')?.click());
    await editor.waitForTimeout(3000);

    // ===== 阶段3: 选择 AI 图片 =====
    console.log('\n=== 阶段3: 选择 AI 图片 ===');
    const imgItems = await editor.evaluate(() => {
        const items = document.querySelectorAll('.appmsg_content_img_item');
        return [...items].map((el, i) => {
            const r = el.getBoundingClientRect();
            const bgSpan = el.querySelector('.appmsg_content_img');
            return { i, w: Math.round(r.width), bg: bgSpan ? getComputedStyle(bgSpan).backgroundImage.slice(0, 80) : null };
        });
    });
    console.log('可选图片项:', JSON.stringify(imgItems, null, 2));

    if (imgItems.length === 0) { console.log('无图片可选'); await browser.close(); return; }

    // 点击第一个图片项（用 Playwright 真实点击以确保事件触发）
    const firstItem = editor.locator('.appmsg_content_img_item').first();
    await firstItem.click({ timeout: 5000 }).catch(e => console.log('点击失败，用 evaluate:', e.message.split('\n')[0]));
    await editor.waitForTimeout(1500);

    // 检查选中状态
    const selectedState = await editor.evaluate(() => {
        const items = document.querySelectorAll('.appmsg_content_img_item');
        return [...items].map(el => ({
            class: el.className?.toString(),
            hasSelected: !!el.querySelector('[class*="selected"], .selected') || el.className?.includes('selected'),
        }));
    });
    console.log('选中状态:', JSON.stringify(selectedState));
    await editor.screenshot({ path: path.join(DBG, 'final_selected.png') });

    // ===== 阶段4: 下一步 =====
    console.log('\n=== 阶段4: 下一步 ===');
    await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const nextBtn = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a, div')].find(el =>
            el.textContent?.trim() === '下一步' && el.getBoundingClientRect().width > 0 && el.children.length === 0
        );
        nextBtn?.click();
    });
    await editor.waitForTimeout(3000);
    await editor.screenshot({ path: path.join(DBG, 'final_next.png') });

    // 检查下一步后的状态（可能是裁剪界面）
    const afterNext = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };
        const visible = wrp.getBoundingClientRect().width > 0;
        const btns = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a, div')].filter(el =>
            el.getBoundingClientRect().width > 0 && el.children.length === 0 && el.textContent?.trim()
        ).map(el => el.textContent?.trim());
        return { opened: visible, text: wrp.textContent?.slice(0, 100), btns: [...new Set(btns)] };
    });
    console.log('下一步后:', JSON.stringify(afterNext, null, 2));

    // ===== 阶段5: 确认 =====
    console.log('\n=== 阶段5: 点击确认 ===');
    await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return false;
        const confirmBtn = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a, div')].find(el =>
            (el.textContent?.trim() === '确认' || el.textContent?.trim() === '完成') &&
            el.getBoundingClientRect().width > 0 && el.children.length === 0
        );
        if (confirmBtn) { confirmBtn.click(); return true; }
        return false;
    });
    await editor.waitForTimeout(4000);

    // ===== 阶段6: 最终验证 =====
    console.log('\n=== 阶段6: 最终封面验证 ===');
    const finalCover = await editor.evaluate(() => {
        const nullCover = document.querySelector('#js_cover_null');
        // 封面区域可能有多张图（2.35:1 和 1:1 裁剪）
        const coverImgs = [...document.querySelectorAll('.cover_appmsg_item img, #js_cover_area img, .js_cover_area img')].map(i => i.src?.slice(0, 70));
        // 也检查背景图形式的封面
        const bgCover = [...document.querySelectorAll('.cover_appmsg_item [style*="background"], #js_cover_area [style*="background"]')].map(el => el.style?.backgroundImage?.slice(0, 70));
        const dialogOpen = !!document.querySelector('.weui-desktop-dialog__wrp') && document.querySelector('.weui-desktop-dialog__wrp').getBoundingClientRect().width > 0;
        return {
            nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false,
            coverImgs,
            bgCover,
            dialogOpen,
        };
    });
    console.log(JSON.stringify(finalCover, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'final_cover.png') });

    await browser.close();
})();
