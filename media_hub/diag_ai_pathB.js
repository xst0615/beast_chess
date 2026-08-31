// 路径B: AI生成 → 使用(插入正文) → "从正文选择"设为封面
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '极简主义山峦剪影，落日余晖，渐变色天空';

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
    await editor.keyboard.type('测试AI封面-路径B完整流程');

    // ===== 阶段1: AI 生成并插入正文 =====
    console.log('=== 阶段1: AI 生成 ===');
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.evaluate(() => document.querySelector('.js_aiImage')?.click());
    await editor.waitForTimeout(3000);

    const initImgs = await editor.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0);
    console.log(`初始图片数: ${initImgs}`);

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
            const generating = text.includes('生成中') || !!wrp.querySelector('[class*="loading"], [class*="spin"]');
            return { imgs, generating };
        });
        if (state.imgs > initImgs && !state.generating) { generated = true; break; }
    }
    console.log('生成完成:', generated);
    if (!generated) { await browser.close(); return; }

    // 点击"使用"（最新的）
    await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
            el.textContent?.trim() === '使用' || el.textContent?.trim() === '应用'
        );
        btns[btns.length - 1].click();
    });
    await editor.waitForTimeout(3000);

    // 验证正文图片
    const bodyImgs = await editor.evaluate(() => document.querySelectorAll('.ProseMirror img, #js_content img').length);
    console.log(`正文图片数: ${bodyImgs}`);
    await editor.screenshot({ path: path.join(DBG, 'pathB_body_inserted.png') });

    // ===== 阶段2: 从正文选择设为封面 =====
    console.log('\n=== 阶段2: 从正文选择封面 ===');

    // 先确保没有残留对话框
    await editor.keyboard.press('Escape').catch(() => {});
    await editor.waitForTimeout(800);
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.waitForTimeout(500);

    // hover 封面区域触发下拉
    const coverBtn = editor.locator('.js_share_type_none_image').first();
    await coverBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await coverBtn.hover({ timeout: 5000 }).catch(e => console.log('hover 失败:', e.message.split('\n')[0]));
    await editor.waitForTimeout(1200);

    // 检查"从正文选择"按钮
    const selectFromContent = await editor.evaluate(() => {
        const el = document.querySelector('.js_selectCoverFromContent');
        if (!el) return { exists: false };
        const r = el.getBoundingClientRect();
        return { exists: true, visible: r.width > 0, text: el.textContent?.trim() };
    });
    console.log('从正文选择按钮:', JSON.stringify(selectFromContent));
    await editor.screenshot({ path: path.join(DBG, 'pathB_cover_menu.png') });

    if (!selectFromContent.exists) {
        console.log('按钮不存在，尝试其他方式');
        // 检查 pop-opr 状态
        const popState = await editor.evaluate(() => {
            const pops = [...document.querySelectorAll('.pop-opr__button')].map(el => ({
                class: el.className?.toString().slice(0, 40), text: el.textContent?.trim(),
                visible: el.getBoundingClientRect().width > 0
            }));
            return pops;
        });
        console.log('pop-opr 按钮:', JSON.stringify(popState, null, 2));
        await browser.close();
        return;
    }

    // 点击"从正文选择"
    await editor.evaluate(() => document.querySelector('.js_selectCoverFromContent')?.click());
    await editor.waitForTimeout(3000);

    // 检查出现的图片选择对话框
    console.log('\n=== 检查图片选择界面 ===');
    const selectDialog = await editor.evaluate(() => {
        const wrps = [...document.querySelectorAll('.weui-desktop-dialog__wrp, .dialog_wrp, [class*="select-cover"], [class*="cover-select"]')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 100 && r.height > 100;
        });
        return wrps.map(w => ({
            class: w.className?.toString().slice(0, 60),
            text: w.textContent?.trim().slice(0, 100),
            imgCount: w.querySelectorAll('img').length,
            imgs: [...w.querySelectorAll('img')].slice(0, 5).map(i => i.src?.slice(0, 60)),
            btns: [...w.querySelectorAll('button, .btn, [class*="btn"]')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.textContent?.trim().slice(0, 15)),
        }));
    });
    console.log(JSON.stringify(selectDialog, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'pathB_select_dialog.png') });

    await browser.close();
})();
