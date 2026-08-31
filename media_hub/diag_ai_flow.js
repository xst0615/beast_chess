// 探测 AI 配图对话框：同意条款 → 输入提示词 → 选宽高比 → 发送 → 等待生成 → 应用
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');

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

    // 填标题
    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('AI编程入门指南');

    // 打开 AI 配图
    await editor.locator('#js_cover_null, .js_cover_opr, text=拖拽或选择封面').first().hover({ timeout: 5000 }).catch(() => {});
    await editor.waitForTimeout(800);
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);
    await editor.screenshot({ path: path.join(DBG, 'ai_dialog_opened.png') });
    console.log('✓ AI 配图对话框已打开');

    // 1. 检查并勾选"同意条款"复选框
    console.log('\n=== 1. 同意条款 ===');
    const checkbox = editor.locator('.weui-desktop-dialog input[type="checkbox"], .weui-desktop-dialog .weui-desktop-form__checkbox').first();
    const cbCount = await checkbox.count();
    console.log('复选框数量:', cbCount);
    if (cbCount > 0) {
        const isChecked = await checkbox.isChecked().catch(() => false);
        console.log('当前是否已勾选:', isChecked);
        if (!isChecked) {
            await checkbox.click({ force: true }).catch(e => console.log('点击复选框失败:', e.message.split('\n')[0]));
            await editor.waitForTimeout(500);
            console.log('已勾选复选框');
        }
    } else {
        // 可能是其他形式
        const agreeText = await editor.evaluate(() => {
            const all = [...document.querySelectorAll('*')];
            const el = all.find(e => e.textContent?.includes('已阅读并同意'));
            return el ? { tag: el.tagName, class: el.className, html: el.outerHTML.slice(0, 200) } : null;
        });
        console.log('同意条款元素:', JSON.stringify(agreeText, null, 2));
    }

    // 2. 查看宽高比选项
    console.log('\n=== 2. 宽高比选项 ===');
    const ratios = await editor.evaluate(() => {
        return [...document.querySelectorAll('.weui-desktop-dialog [class*="ratio"], .weui-desktop-dialog [class*="aspect"]')].map(el => ({
            class: el.className?.toString().slice(0, 80),
            text: el.textContent?.trim().slice(0, 20),
        }));
    });
    console.log('宽高比元素:', JSON.stringify(ratios, null, 2));

    // 找所有可点击的比例选项文字
    const ratioTexts = await editor.evaluate(() => {
        const dialog = document.querySelector('.weui-desktop-dialog');
        if (!dialog) return [];
        return [...dialog.querySelectorAll('span, div, li, a, button')].filter(el => {
            const t = el.textContent?.trim() || '';
            return ['1:1', '2.35:1', '16:9', '3:4', '4:3'].includes(t) && el.children.length === 0;
        }).map(el => ({
            tag: el.tagName, text: el.textContent?.trim(), class: el.className?.toString().slice(0, 60),
        }));
    });
    console.log('宽高比选项:', JSON.stringify(ratioTexts));

    // 3. 查看风格选项
    console.log('\n=== 3. 风格选项 ===');
    const styles = await editor.evaluate(() => {
        const dialog = document.querySelector('.weui-desktop-dialog');
        if (!dialog) return [];
        return [...dialog.querySelectorAll('span, div, li, a, button')].filter(el => {
            const t = el.textContent?.trim() || '';
            return ['不限', '纯真', '动漫', '清新', '日漫', '极简', '胶片', '电影', '糖果色', '水彩', '水墨', '像素'].includes(t) && el.children.length === 0;
        }).map(el => ({
            tag: el.tagName, text: el.textContent?.trim(), class: el.className?.toString().slice(0, 60),
        }));
    });
    console.log('风格选项:', JSON.stringify(styles));

    // 4. 查看提示词输入框
    console.log('\n=== 4. 提示词输入框 ===');
    const prompt = editor.locator('.weui-desktop-dialog textarea.chat_textarea').first();
    const pCount = await prompt.count();
    console.log('提示词输入框数量:', pCount);
    if (pCount > 0) {
        const ph = await prompt.getAttribute('placeholder');
        console.log('placeholder:', ph);
    }

    // 5. 查看发送按钮
    console.log('\n=== 5. 发送按钮 ===');
    const sendBtn = editor.locator('.weui-desktop-dialog .send-btn').first();
    const sCount = await sendBtn.count();
    console.log('发送按钮数量:', sCount);
    if (sCount > 0) {
        const cls = await sendBtn.getAttribute('class');
        console.log('按钮class:', cls, '(disabled?', cls?.includes('disabled'), ')');
    }

    // 6. 尝试输入提示词并选择 2.35:1（封面比例）后发送
    console.log('\n=== 6. 尝试生成 ===');
    if (pCount > 0) {
        await prompt.click();
        await prompt.fill('一个程序员在电脑前编写代码，屏幕上显示着代码');
        await editor.waitForTimeout(500);
        console.log('已输入提示词');

        // 选 2.35:1（如果存在）
        const ratioEl = editor.locator('.weui-desktop-dialog').locator('text=2.35:1').first();
        if (await ratioEl.count() > 0) {
            await ratioEl.click({ timeout: 3000 }).catch(() => {});
            console.log('已选宽高比 2.35:1');
            await editor.waitForTimeout(500);
        }

        // 检查发送按钮是否可用
        const sendClass = await sendBtn.getAttribute('class');
        console.log('发送按钮class:', sendClass);

        await editor.screenshot({ path: path.join(DBG, 'ai_before_send.png') });

        // 点击发送
        if (sendClass && !sendClass.includes('disabled')) {
            await sendBtn.click({ timeout: 5000 }).catch(e => console.log('发送失败:', e.message.split('\n')[0]));
            console.log('已点击发送，等待生成...');

            // 轮询等待生成完成（最多 60 秒）
            for (let i = 0; i < 12; i++) {
                await editor.waitForTimeout(5000);
                const hasNew = await editor.evaluate(() => {
                    const items = document.querySelectorAll('.weui-desktop-dialog .ai-image-item');
                    return items.length;
                });
                console.log(`  ${(i+1)*5}s: ai-image-item 数量 = ${hasNew}`);
                if (hasNew > 0) break;
            }

            await editor.screenshot({ path: path.join(DBG, 'ai_after_gen.png') });

            // 查找"应用"按钮
            const applyBtn = editor.locator('.weui-desktop-dialog').locator('text=应用').first();
            const aCount = await applyBtn.count();
            console.log('应用按钮数量:', aCount);
        } else {
            console.log('发送按钮被禁用，可能需要先勾选同意条款');
        }
    }

    await browser.close();
})();
