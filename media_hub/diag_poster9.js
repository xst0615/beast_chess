// 通过设置Vue实例dialogVisible=true打开文字海报，填入标题→生成→选模板→确定
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
    await page.keyboard.type('测试文字海报功能');
    await page.waitForTimeout(500);

    // 预加载海报数据 + 打开对话框
    console.log('=== 预加载并打开文字海报对话框 ===');
    await page.evaluate(async () => {
        // 先预加载
        const imgVm = document.querySelector('.image-selector')?.__vue__;
        if (imgVm?._prefetchTextPoster) {
            await imgVm._prefetchTextPoster();
        }
        // 找到text_poster_dialog的Vue实例
        function findVue(el, depth = 0) {
            if (depth > 15) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const found = findVue(child, depth + 1);
                if (found) return found;
            }
            return null;
        }
        const dlg = document.querySelector('.text_poster_dialog');
        const dvm = findVue(dlg);
        if (dvm) {
            dvm.dialogVisible = true;
        }
    });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(DBG, 'poster_dialog_opened.png'), fullPage: false });

    // 检查对话框状态
    const dlgState = await page.evaluate(() => {
        function findVue(el, depth = 0) {
            if (depth > 15) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const found = findVue(child, depth + 1);
                if (found) return found;
            }
            return null;
        }
        const dvm = findVue(document.querySelector('.text_poster_dialog'));
        if (!dvm) return { found: false };
        return {
            found: true,
            dialogVisible: dvm.dialogVisible,
            allPostersLen: dvm.allPosters?.length,
            posterListLen: dvm.posterList?.length,
            templateConfigLen: dvm.templateConfig?.length,
            hasGenerated: dvm.hasGenerated,
            promptText: dvm.promptText,
            html: document.querySelector('.text_poster_dialog')?.innerHTML?.slice(0, 3000)
        };
    });
    console.log('对话框状态:', JSON.stringify({ ...dlgState, html: dlgState.html?.slice(0, 500) }, null, 2));

    // 填入标题文字到输入框
    console.log('\n=== 填入标题文字 ===');
    await page.evaluate((title) => {
        function findVue(el, depth = 0) {
            if (depth > 15) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const found = findVue(child, depth + 1);
                if (found) return found;
            }
            return null;
        }
        const dvm = findVue(document.querySelector('.text_poster_dialog'));
        if (dvm) {
            dvm.promptText = title;
        }
    }, TITLE);
    await page.waitForTimeout(500);

    // 找输入框并通过DOM输入（确保Vue响应式更新）
    const textarea = page.locator('.text_poster_dialog textarea, .text_poster_dialog [contenteditable], .text_poster_dialog input[type="text"]').first();
    try {
        await textarea.waitFor({ state: 'visible', timeout: 5000 });
        await textarea.click();
        await page.waitForTimeout(200);
        // 先清空再输入
        await textarea.fill(TITLE);
        console.log('通过textarea输入:', TITLE);
    } catch(e) {
        console.log('未找到textarea，尝试通过JS设置promptText');
    }
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(DBG, 'poster_text_filled.png'), fullPage: false });

    // 查找并点击"生成海报"按钮
    console.log('\n=== 点击生成海报 ===');
    // 先看对话框里的所有按钮
    const dlgBtns = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        return [...dlg.querySelectorAll('button, a, [class*="btn"], [class*="generate"]')].map(b => ({
            text: b.textContent?.trim().slice(0, 30),
            class: b.className?.toString().slice(0, 80),
            visible: b.offsetParent !== null,
            disabled: b.disabled
        })).filter(b => b.text && b.text.length < 30);
    });
    console.log('对话框按钮:', JSON.stringify(dlgBtns, null, 2));

    // 点击生成海报按钮
    const genBtn = page.locator('.text_poster_dialog').locator('button, [class*="btn"]').filter({ hasText: '生成海报' }).first();
    try {
        await genBtn.waitFor({ state: 'visible', timeout: 5000 });
        await genBtn.click();
        console.log('已点击"生成海报"');
    } catch(e) {
        console.log('未找到"生成海报"按钮，尝试通过Vue方法生成');
        // 尝试调用Vue生成方法
        await page.evaluate(() => {
            function findVue(el, depth = 0) {
                if (depth > 15) return null;
                if (el?.__vue__) return el.__vue__;
                for (const child of el?.children || []) {
                    const found = findVue(child, depth + 1);
                    if (found) return found;
                }
                return null;
            }
            const dvm = findVue(document.querySelector('.text_poster_dialog'));
            if (dvm) {
                // 查找generate相关方法
                const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(dvm)).filter(m => typeof dvm[m] === 'function');
                console.log('Available methods:', methods);
            }
        });
    }

    // 等待海报生成
    for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(2000);
        const state = await page.evaluate(() => {
            function findVue(el, depth = 0) {
                if (depth > 15) return null;
                if (el?.__vue__) return el.__vue__;
                for (const child of el?.children || []) {
                    const found = findVue(child, depth + 1);
                    if (found) return found;
                }
                return null;
            }
            const dvm = findVue(document.querySelector('.text_poster_dialog'));
            return {
                generating: dvm?.generating,
                hasGenerated: dvm?.hasGenerated,
                posterListLen: dvm?.posterList?.length || 0,
                selectedIndex: dvm?.selectedIndex
            };
        });
        console.log(`  ${(i+1)*2}s: generating=${state.generating} hasGenerated=${state.hasGenerated} posters=${state.posterListLen} selected=${state.selectedIndex}`);
        if (state.hasGenerated && state.posterListLen > 0) break;
    }

    await page.screenshot({ path: path.join(DBG, 'poster_generated.png'), fullPage: false });

    // 随机选择一个模板
    console.log('\n=== 随机选择模板并确定 ===');
    await page.evaluate(() => {
        function findVue(el, depth = 0) {
            if (depth > 15) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const found = findVue(child, depth + 1);
                if (found) return found;
            }
            return null;
        }
        const dvm = findVue(document.querySelector('.text_poster_dialog'));
        if (dvm && dvm.posterList?.length > 0) {
            const idx = Math.floor(Math.random() * dvm.posterList.length);
            dvm.selectedIndex = idx;
            console.log('Selected template index:', idx);
        }
    });
    await page.waitForTimeout(500);

    // 点击模板缩略图（通过DOM点击确保选中）
    const templates = page.locator('.text_poster_dialog [class*="template"], .text_poster_dialog [class*="style"], .text_poster_dialog [class*="tpl"]');
    const templateCount = await templates.count();
    console.log('模板元素数量:', templateCount);
    if (templateCount > 0) {
        const randomIdx = Math.floor(Math.random() * Math.min(templateCount, 6));
        await templates.nth(randomIdx).click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
    }

    await page.screenshot({ path: path.join(DBG, 'poster_template_selected.png'), fullPage: false });

    // 点击"确定"按钮插入海报
    const confirmBtn = page.locator('.text_poster_dialog').locator('button, [class*="btn"]').filter({ hasText: '确定' }).first();
    try {
        await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
        await confirmBtn.click();
        console.log('已点击"确定"');
    } catch(e) {
        console.log('确定按钮点击失败:', e.message);
    }
    await page.waitForTimeout(5000);

    await page.screenshot({ path: path.join(DBG, 'poster_inserted.png'), fullPage: false });

    // 检查正文是否有海报图片
    const imgCount = await page.evaluate(() => {
        return document.querySelectorAll('.ProseMirror img, #js_content img, .share-text__input img').length;
    });
    console.log('\n正文图片数:', imgCount);

    await browser.close();
    console.log('\n=== 完成 ===');
})();
