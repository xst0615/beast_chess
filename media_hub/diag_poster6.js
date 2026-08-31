// 直接调用Vue实例方法触发文字海报对话框
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 调用Vue方法 onAddByTextPoster 打开对话框
    console.log('=== 调用 Vue onAddByTextPoster ===');
    await page.evaluate(() => {
        const imgSelector = document.querySelector('.image-selector');
        if (imgSelector?.__vue__) {
            imgSelector.__vue__.onAddByTextPoster();
        }
    });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(DBG, 'poster_vue_open.png'), fullPage: false });

    // 检查对话框是否完全加载
    const dialogState = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        if (!dlg) return { found: false };
        return {
            found: true,
            maskDisplay: dlg.querySelector('.weui-desktop-mask')?.style.display,
            innerHTML: dlg.innerHTML.slice(0, 5000),
            children: dlg.children.length,
            text: dlg.textContent?.trim().slice(0, 500),
            // 查找输入框和按钮
            inputs: [...dlg.querySelectorAll('input, textarea, [contenteditable]')].map(el => ({
                tag: el.tagName,
                type: el.type,
                class: el.className?.toString().slice(0, 60),
                placeholder: el.placeholder
            })),
            buttons: [...dlg.querySelectorAll('button, a, [class*="btn"]')].map(b => ({
                text: b.textContent?.trim().slice(0, 20),
                class: b.className?.toString().slice(0, 80)
            })).filter(b => b.text && b.text.length < 20)
        };
    });
    console.log('对话框状态:', JSON.stringify(dialogState, null, 2));

    if (dialogState.found && dialogState.innerHTML?.length > 100) {
        console.log('\n=== 对话框已打开，查找输入区域和按钮 ===');
        // 找"生成海报"按钮
        const genBtns = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            return [...dlg.querySelectorAll('button, a, [class*="btn"], [class*="generate"]')].map(b => ({
                text: b.textContent?.trim(),
                class: b.className?.toString().slice(0, 80),
                visible: b.offsetParent !== null
            })).filter(b => b.text?.includes('生成') || b.text?.includes('确定') || b.text?.includes('取消'));
        });
        console.log('生成/确定/取消按钮:', JSON.stringify(genBtns, null, 2));

        // 找文字输入框
        const textInput = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            // 可能是textarea、input或contenteditable
            const editable = dlg.querySelector('[contenteditable]');
            const textarea = dlg.querySelector('textarea');
            const input = dlg.querySelector('input[type="text"]');
            return {
                hasEditable: !!editable,
                hasTextarea: !!textarea,
                hasInput: !!input,
                editableClass: editable?.className,
                textareaClass: textarea?.className,
                inputClass: input?.className
            };
        });
        console.log('输入框类型:', textInput);

        await page.screenshot({ path: path.join(DBG, 'poster_dialog_open.png'), fullPage: false });
    }

    await browser.close();
})();
