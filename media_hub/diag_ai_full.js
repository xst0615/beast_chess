// 完整 AI 封面生成流程验证：移除残留对话框 → 点击 AI 配图 → 输入提示词 → 生成 → 应用
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '程序员在电脑前专注编码，屏幕上有代码，暖色调，扁平插画风格';

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
    await editor.keyboard.type('测试AI封面-完整流程');

    // 步骤1: 移除残留对话框
    console.log('=== 步骤1: 移除残留对话框 ===');
    const removed = await editor.evaluate(() => {
        const wrps = document.querySelectorAll('.weui-desktop-dialog__wrp');
        wrps.forEach(w => w.remove());
        return wrps.length;
    });
    console.log(`移除 ${removed} 个残留对话框`);

    // 步骤2: 点击 AI 配图
    console.log('\n=== 步骤2: 打开 AI 配图 ===');
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);

    const dialogOpened = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return false;
        const r = wrp.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });
    console.log('AI 对话框已打开:', dialogOpened);
    await editor.screenshot({ path: path.join(DBG, 'full_step2_opened.png') });

    if (!dialogOpened) {
        console.log('对话框未打开，退出');
        await browser.close();
        return;
    }

    // 步骤3: 输入提示词
    console.log('\n=== 步骤3: 输入提示词 ===');
    const textareaInfo = await editor.evaluate(() => {
        const ta = document.querySelector('.chat_textarea');
        if (!ta) return null;
        const r = ta.getBoundingClientRect();
        return { visible: r.width > 0, w: r.width, h: r.height, placeholder: ta.placeholder };
    });
    console.log('输入框信息:', JSON.stringify(textareaInfo));

    if (textareaInfo?.visible) {
        const ta = editor.locator('.chat_textarea').first();
        await ta.click();
        await ta.fill(PROMPT);
        await editor.waitForTimeout(500);
        console.log('已输入提示词');

        // 检查生成按钮状态
        const sendInfo = await editor.evaluate(() => {
            const btn = document.querySelector('.send-btn, .chat_send_btn, [class*="send"]');
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return { class: btn.className, visible: r.width > 0, text: btn.textContent?.trim() };
        });
        console.log('发送按钮:', JSON.stringify(sendInfo));
        await editor.screenshot({ path: path.join(DBG, 'full_step3_prompt.png') });

        // 步骤4: 点击发送
        console.log('\n=== 步骤4: 发送生成请求 ===');
        const sendBtn = editor.locator('.weui-desktop-dialog__wrp .send-btn, .weui-desktop-dialog__wrp [class*="send"]').first();
        const sendCount = await sendBtn.count();
        console.log('发送按钮数量:', sendCount);
        if (sendCount > 0) {
            await sendBtn.click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
            console.log('已点击发送');
        }
    } else {
        console.log('未找到可见输入框，检查对话框结构');
        const structure = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            const inputs = wrp ? [...wrp.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')].map(el => ({
                tag: el.tagName, class: el.className?.toString().slice(0, 40),
                visible: el.getBoundingClientRect().width > 0
            })) : [];
            return inputs;
        });
        console.log('可输入元素:', JSON.stringify(structure, null, 2));
    }

    // 步骤5: 轮询等待生成
    console.log('\n=== 步骤5: 等待生成 ===');
    let generated = false;
    for (let i = 0; i < 12; i++) {
        await editor.waitForTimeout(5000);
        const state = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { wrp: false };
            const text = wrp.textContent || '';
            const applyBtns = [...wrp.querySelectorAll('*')].filter(el => 
                el.children.length === 0 && /^应用$/.test(el.textContent?.trim() || '')
            );
            const imgs = wrp.querySelectorAll('img').length;
            return {
                wrp: true,
                hasApply: applyBtns.length > 0,
                applyCount: applyBtns.length,
                imgCount: imgs,
                textSnippet: text.slice(0, 60),
            };
        });
        console.log(`等待 ${(i + 1) * 5}s: 应用按钮=${state.applyCount}, 图片=${state.imgCount}, 文本="${state.textSnippet}"`);
        if (state.hasApply) { generated = true; break; }
        await editor.screenshot({ path: path.join(DBG, `full_step5_wait_${i + 1}.png`) }).catch(() => {});
    }

    console.log('生成完成:', generated);

    if (generated) {
        // 步骤6: 应用封面
        console.log('\n=== 步骤6: 应用封面 ===');
        await editor.screenshot({ path: path.join(DBG, 'full_step6_generated.png') });
        const applied = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return false;
            const applyBtn = [...wrp.querySelectorAll('*')].find(el =>
                el.children.length === 0 && /^应用$/.test(el.textContent?.trim() || '')
            );
            if (applyBtn) { applyBtn.click(); return true; }
            return false;
        });
        console.log('点击应用:', applied);
        await editor.waitForTimeout(3000);

        // 检查封面是否已设置
        const coverSet = await editor.evaluate(() => {
            const coverImg = document.querySelector('#js_cover_area img, .setting-group__cover img, .js_appmsg_thumb img');
            const nullCover = document.querySelector('#js_cover_null');
            return {
                hasCoverImg: !!coverImg,
                coverSrc: coverImg?.src?.slice(0, 60),
                nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false,
            };
        });
        console.log('封面状态:', JSON.stringify(coverSet, null, 2));
        await editor.screenshot({ path: path.join(DBG, 'full_step6_applied.png') });
    }

    await browser.close();
})();
