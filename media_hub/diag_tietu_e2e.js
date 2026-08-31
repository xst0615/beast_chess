// 贴图模式完整发布流程：标题 → AI生成图片 → 应用到正文 → 保存草稿
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '一只可爱的柴犬趴在樱花树下，粉色花瓣飘落，日式治愈系插画';
const TITLE = '贴图测试-' + Date.now().toString().slice(-4);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];
    console.log('token:', token);

    // 方式1: 从首页"新的创作"→"贴图"
    // 方式2: 直接访问 createType=8
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    console.log('编辑器URL:', page.url().slice(0, 120));

    // 移除残留对话框
    const removed = await page.evaluate(() => {
        const wrps = document.querySelectorAll('.weui-desktop-dialog__wrp');
        wrps.forEach(w => w.remove());
        return wrps.length;
    });
    console.log('移除残留对话框:', removed);

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(500);
    console.log('✓ 标题已填:', TITLE);

    // AI 生成图片
    console.log('\n=== AI 生成图片 ===');
    await page.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await page.waitForTimeout(3000);

    const dialogOpen = await page.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        return wrp ? wrp.getBoundingClientRect().width > 0 : false;
    });
    if (!dialogOpen) { console.log('❌ AI 对话框未打开'); await browser.close(); return; }
    console.log('✓ AI 对话框已打开');

    const initImgs = await page.evaluate(() =>
        document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0
    );

    const ta = page.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await page.waitForTimeout(500);
    await page.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });
    console.log('已发送生成请求...');

    let generated = false;
    for (let i = 0; i < 18; i++) {
        await page.waitForTimeout(5000);
        const state = await page.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, generating: true };
            const imgs = wrp.querySelectorAll('img').length;
            const text = wrp.textContent || '';
            return { imgs, generating: text.includes('生成中') || !!wrp.querySelector('[class*="loading"], [class*="spin"]') };
        });
        if ((i + 1) % 6 === 0) console.log(`等待 ${(i + 1) * 5}s: 图片=${state.imgs}, 生成中=${state.generating}`);
        if (state.imgs > initImgs && !state.generating) { generated = true; break; }
    }
    if (!generated) { console.log('❌ 生成超时'); await browser.close(); return; }
    console.log('✓ AI 图片已生成');
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_generated.png') });

    // 点击"应用"插入正文
    const applyResult = await page.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { ok: false };
        const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
            el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用'
        );
        if (btns.length === 0) return { ok: false };
        btns[btns.length - 1].click();
        return { ok: true };
    });
    await page.waitForTimeout(4000);

    const bodyImgs = await page.evaluate(() => ({
        count: document.querySelectorAll('.ProseMirror img, #js_content img').length,
    }));
    console.log(`✓ 正文图片数: ${bodyImgs.count}`);
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_inserted.png') });

    // 关闭对话框
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await page.waitForTimeout(800);

    // 贴图模式：检查是否需要设置封面（createType=8 是图片消息，封面可能就是图片本身）
    // 尝试直接保存
    console.log('\n=== 保存草稿 ===');
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_before_save.png'), fullPage: true });

    await page.locator('text=保存为草稿').first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    // 检查是否有弹窗/提示
    const dialogCheck = await page.evaluate(() => {
        const wrps = [...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-dialog, [class*="dialog"], [class*="alert"]')].filter(w => {
            const r = w.getBoundingClientRect();
            return r.width > 100 && r.height > 50;
        });
        return wrps.map(w => ({
            class: w.className?.toString().slice(0, 60),
            text: w.textContent?.trim().slice(0, 150),
        }));
    });
    console.log('保存后弹窗:', JSON.stringify(dialogCheck, null, 2));
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_after_save.png'), fullPage: true });

    // 点击可能的确定按钮
    await page.locator('button:has-text("确定"), button:has-text("确认"), button:has-text("知道了")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const saveResult = await page.evaluate(() => {
        const text = document.body.textContent || '';
        return {
            hasSuccess: text.includes('已保存') || text.includes('保存成功'),
            url: location.href.slice(0, 100),
        };
    });
    console.log('保存结果:', JSON.stringify(saveResult));
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_final.png'), fullPage: true });

    await browser.close();
    console.log('\n=== 测试完成 ===');
})();
