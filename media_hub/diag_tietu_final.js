// 贴图模式端到端：标题→正文→AI配图→保存→验证草稿箱
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '一只可爱的柴犬趴在樱花树下，粉色花瓣飘落';
const TITLE = '贴图E2E-' + Date.now().toString().slice(-4);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];
    console.log('✓ token:', token);

    // 打开贴图编辑器
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));
    console.log('✓ 贴图编辑器已打开');

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(500);

    // 填正文（必填！）
    const body = page.locator('.ProseMirror').nth(1);
    await body.click();
    await page.evaluate(() => {
        const blob = new Blob(['<p>这是一段贴图描述文字</p>'], { type: 'text/html' });
        navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
    });
    await page.waitForTimeout(300);
    await page.keyboard.press('Meta+V');
    await page.waitForTimeout(1000);
    console.log('✓ 标题和正文已填');

    // AI 配图
    console.log('\n=== AI 配图 ===');
    await page.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await page.waitForTimeout(3000);

    const initImgs = await page.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0);
    const ta = page.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await page.waitForTimeout(500);
    await page.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });
    console.log('已发送生成请求...');

    let generated = false;
    for (let i = 0; i < 18; i++) {
        await page.waitForTimeout(5000);
        const s = await page.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, gen: true };
            const imgs = wrp.querySelectorAll('img').length;
            const t = wrp.textContent || '';
            return { imgs, gen: t.includes('生成中') || !!wrp.querySelector('[class*="loading"]') };
        });
        if ((i + 1) % 4 === 0) console.log(`等待 ${(i + 1) * 5}s: 图片=${s.imgs}`);
        if (s.imgs > initImgs && !s.gen) { generated = true; break; }
    }
    if (!generated) { console.log('❌ 生成超时'); await browser.close(); return; }
    console.log('✓ AI 图片已生成');

    // 应用
    await page.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el => el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用');
        if (btns.length > 0) btns[btns.length - 1].click();
    });
    await page.waitForTimeout(4000);
    const cnt = await page.evaluate(() => document.querySelectorAll('.ProseMirror img, #js_content img').length);
    console.log(`✓ 正文图片数: ${cnt}`);

    // 关闭对话框
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));
    await page.waitForTimeout(800);

    // 保存
    console.log('\n=== 保存草稿 ===');
    await page.locator('text=保存为草稿').first().click({ timeout: 10000 });
    await page.waitForTimeout(5000);

    // 检查错误提示
    const errors = await page.evaluate(() => {
        const errs = [...document.querySelectorAll('.js_error_msg, [class*="error"], [class*="alert"]')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 50 && el.textContent?.trim();
        });
        return errs.map(el => el.textContent?.trim().slice(0, 80));
    });
    if (errors.length > 0) console.log('⚠ 错误提示:', errors);

    await page.locator('button:has-text("确定"), button:has-text("知道了")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const saveOk = await page.evaluate(() => {
        const t = document.body.textContent || '';
        return { hasSuccess: t.includes('已保存') || t.includes('保存成功'), url: location.href.slice(0, 80) };
    });
    console.log('保存结果:', JSON.stringify(saveOk));
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_saved.png') });

    // 验证草稿箱
    console.log('\n=== 验证草稿箱 ===');
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);
    const found = (await page.evaluate(() => document.body?.innerText || '')).includes(TITLE);
    console.log(found ? `✓✓ 草稿箱找到"${TITLE}"` : `✗ 草稿箱未找到"${TITLE}"`);
    await page.screenshot({ path: path.join(DBG, 'tietu_e2e_draftbox.png') });

    await browser.close();
    console.log('\n=== 完成 ===');
})();
