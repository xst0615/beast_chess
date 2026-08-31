// 端到端测试: 完整发布流程（AI 封面 + 保存草稿）—— 复用 server.js 的新逻辑
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const AI_PROMPT = '水墨画风格的中国山水，云雾缭绕的黄山奇松，意境深远';

const TITLE = '测试AI封面-端到端' + Date.now().toString().slice(-4);
const CONTENT = '这是一篇测试 AI 封面生成的文章。正文内容用于验证完整流程。';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN' });
    const page = await ctx.newPage();

    // ===== 与 server.js 相同的导航流程 =====
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];
    if (!token) { console.log('❌ 未获取 token（登录态失效）'); await browser.close(); return; }
    console.log('✓ token:', token);

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);

    await page.locator('text=新的创作').first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
    await page.locator('text="文章"').first().click({ timeout: 10000 });
    const editor = await popupPromise;
    await editor.waitForLoadState('domcontentloaded');
    await editor.waitForTimeout(5000);
    console.log('✓ 编辑器已打开');

    // 填标题
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type(TITLE);

    // 填正文（粘贴 HTML 的方式与 server.js 一致）
    await editor.evaluate((html) => {
        const target = document.querySelectorAll('.ProseMirror')[1];
        if (target) {
            target.focus();
            const sel = window.getSelection();
            sel.selectAllChildren(target);
            document.execCommand('insertHTML', false, html);
        }
    }, `<p>${CONTENT}</p>`);
    await editor.waitForTimeout(1000);
    console.log('✓ 标题和正文已填充');

    // ===== AI 封面（server.js 新逻辑） =====
    console.log('\n=== AI 封面生成 ===');
    try {
        // ① 移除残留对话框
        const removed = await editor.evaluate(() => {
            const wrps = document.querySelectorAll('.weui-desktop-dialog__wrp');
            wrps.forEach(w => w.remove());
            return wrps.length;
        });
        if (removed > 0) console.log(`已移除 ${removed} 个残留对话框`);

        // ② 打开 AI 配图
        await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
        await editor.waitForTimeout(3000);
        const dialogOpen = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            return wrp ? wrp.getBoundingClientRect().width > 0 : false;
        });
        if (!dialogOpen) throw new Error('AI 配图对话框未能打开');
        console.log('✓ AI 配图对话框已打开');

        const initImgCount = await editor.evaluate(() =>
            document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0
        );

        // 输入提示词
        const promptInput = editor.locator('textarea.chat_textarea').first();
        await promptInput.waitFor({ state: 'visible', timeout: 5000 });
        await promptInput.click();
        await promptInput.fill(AI_PROMPT);
        await editor.waitForTimeout(500);

        // 发送
        await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });
        console.log('已发送生成请求...');

        // 等待生成
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
            if ((i + 1) % 6 === 0) console.log(`等待 ${(i + 1) * 5}s: 图片=${state.imgs}, 生成中=${state.generating}`);
            if (state.imgs > initImgCount && !state.generating) { generated = true; break; }
        }
        if (!generated) throw new Error('AI 生成超时');
        console.log('✓ AI 图片已生成');

        // ③ 点击"应用"插入正文
        const applyInfo = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { ok: false };
            const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
                el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用'
            );
            if (btns.length === 0) return { ok: false };
            btns[btns.length - 1].click();
            return { ok: true };
        });
        if (!applyInfo.ok) throw new Error('点击应用失败');
        await editor.waitForTimeout(4000);

        const bodyImgCount = await editor.evaluate(() =>
            document.querySelectorAll('.ProseMirror img, #js_content img').length
        );
        if (bodyImgCount === 0) throw new Error('AI 图片未插入正文');
        console.log(`✓ AI 图片已插入正文（${bodyImgCount} 张）`);

        // 关闭 AI 对话框
        await editor.keyboard.press('Escape').catch(() => {});
        await editor.waitForTimeout(1000);
        await editor.evaluate(() => {
            document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
        });
        await editor.waitForTimeout(800);

        // ④ 从正文选择设为封面
        const coverBtn = editor.locator('.js_share_type_none_image').first();
        await coverBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await coverBtn.hover({ timeout: 5000 }).catch(() => {});
        await editor.waitForTimeout(1200);
        await editor.evaluate(() => document.querySelector('.js_selectCoverFromContent')?.click());
        await editor.waitForTimeout(3000);

        // 选择第一张图片
        await editor.locator('.appmsg_content_img_item').first().click({ timeout: 5000 }).catch(async () => {
            await editor.evaluate(() => document.querySelector('.appmsg_content_img_item')?.click());
        });
        await editor.waitForTimeout(1500);
        console.log('✓ 已选择 AI 图片');

        // 下一步
        await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return;
            const nextBtn = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a, div')].find(el =>
                el.textContent?.trim() === '下一步' && el.getBoundingClientRect().width > 0 && el.children.length === 0
            );
            nextBtn?.click();
        });
        await editor.waitForTimeout(3000);

        // 确认
        await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return;
            const confirmBtn = [...wrp.querySelectorAll('button, .btn, [class*="btn"], a, div')].find(el =>
                (el.textContent?.trim() === '确认' || el.textContent?.trim() === '完成') &&
                el.getBoundingClientRect().width > 0 && el.children.length === 0
            );
            confirmBtn?.click();
        });
        await editor.waitForTimeout(4000);

        // 验证封面
        const coverState = await editor.evaluate(() => {
            const nullCover = document.querySelector('#js_cover_null');
            return { nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false };
        });
        if (coverState.nullCoverVisible) throw new Error('封面未设置成功');
        console.log('✓✓ AI 封面已设置成功！');
        await editor.screenshot({ path: path.join(DBG, 'e2e_cover_set.png') });
    } catch (e) {
        console.log('⚠ AI 封面失败（继续保存）:', e.message);
        await editor.screenshot({ path: path.join(DBG, 'e2e_ai_error.png') }).catch(() => {});
        // 清理对话框
        await editor.keyboard.press('Escape').catch(() => {});
        await editor.evaluate(() => {
            document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
        }).catch(() => {});
        await editor.waitForTimeout(500);
    }

    // ===== 保存为草稿 =====
    console.log('\n=== 保存草稿 ===');
    await editor.locator('text=保存为草稿').first().click({ timeout: 10000 });
    await editor.waitForTimeout(3000);
    // 可能的确认弹窗
    await editor.locator('button:has-text("确定"), button:has-text("确认")').first().click({ timeout: 3000 }).catch(() => {});
    await editor.waitForTimeout(3000);
    await editor.screenshot({ path: path.join(DBG, 'e2e_saved.png') }).catch(() => {});

    // 检查保存结果（页面是否返回列表或显示成功提示）
    const saveResult = await editor.evaluate(() => {
        const text = document.body.textContent || '';
        return {
            hasSuccess: text.includes('已保存') || text.includes('保存成功'),
            hasDraft: text.includes('草稿'),
            url: location.href.slice(0, 80),
        };
    });
    console.log('保存结果:', JSON.stringify(saveResult));

    await browser.close();
    console.log('\n=== 端到端测试完成 ===');
})();
