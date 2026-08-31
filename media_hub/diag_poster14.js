// 关键洞察：文字海报对话框可能通过teleport渲染到body根级别，不在.text_poster_dialog内
// 直接监控点击前后body下所有.weui-desktop-dialog__wrp的变化
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') console.log('  [page-error]', msg.text().slice(0, 150));
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报功能');
    await page.waitForTimeout(500);

    // 点击前：记录body下的dialog数量
    const beforeCount = await page.evaluate(() => document.body.querySelectorAll('.weui-desktop-dialog__wrp').length);
    console.log('点击前body下dialog数量:', beforeCount);

    // 方法：直接点击图片上传区域下面的"文字海报"按钮
    // 先找到包含"文字海报"文本且在image-selector内的可见按钮
    console.log('\n=== 查找文字海报按钮 ===');
    const btnInfo = await page.evaluate(() => {
        // 找所有包含"文字海报"文本的元素
        const allEls = [...document.querySelectorAll('*')].filter(el => {
            const children = el.children;
            // 只找叶子级或按钮级元素
            return el.children.length <= 3 && el.textContent?.trim() === '文字海报';
        });
        return allEls.map(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            let parent = el;
            const chain = [];
            for (let i = 0; i < 8; i++) {
                parent = parent.parentElement;
                if (!parent) break;
                chain.push(parent.className?.toString().slice(0, 50) || parent.tagName);
                if (parent.classList.contains('image-selector__add') ||
                    parent.classList.contains('pop-opr__item') ||
                    parent.classList.contains('pop-opr')) break;
            }
            return {
                tag: el.tagName,
                class: el.className?.toString().slice(0, 100),
                text: el.textContent?.trim(),
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                visible: el.offsetParent !== null,
                display: style.display,
                parent: chain.join(' > ')
            };
        });
    });
    console.log('文字海报相关元素:');
    btnInfo.forEach(b => console.log(' ', JSON.stringify(b)));

    // 尝试多种方式点击
    // 方式1：直接点击包含"文字海报"的li元素（在image-selector区域内）
    console.log('\n=== 方式1: 点击image-selector区域内的文字海报li ===');
    const clickResult = await page.evaluate(() => {
        // 找image-selector内的文字海报li
        const imgSelector = document.querySelector('.image-selector__add');
        if (!imgSelector) return { ok: false, reason: 'image-selector__add not found' };
        const items = [...imgSelector.querySelectorAll('.pop-opr__item')];
        const posterItem = items.find(li => li.textContent?.trim() === '文字海报');
        if (!posterItem) return { ok: false, reason: '文字海报li not found', items: items.map(i => i.textContent?.trim()) };
        // 检查li是否隐藏
        const style = getComputedStyle(posterItem);
        const btnStyle = getComputedStyle(posterItem.querySelector('.pop-opr__button') || posterItem);
        posterItem.querySelector('.pop-opr__button')?.click();
        return { ok: true, liDisplay: style.display, btnDisplay: btnStyle.display };
    });
    console.log('点击结果:', clickResult);
    await page.waitForTimeout(4000);

    // 检查点击后body下的dialog
    const afterCount = await page.evaluate(() => {
        const wrps = [...document.body.querySelectorAll('.weui-desktop-dialog__wrp')];
        return {
            count: wrps.length,
            wrps: wrps.map(w => ({
                width: Math.round(w.getBoundingClientRect().width),
                height: Math.round(w.getBoundingClientRect().height),
                display: getComputedStyle(w).display,
                visible: w.getBoundingClientRect().width > 0,
                text: w.textContent?.trim().slice(0, 200),
                class: w.className?.toString().slice(0, 100)
            }))
        };
    });
    console.log('\n点击后body下dialog:', JSON.stringify(afterCount, null, 2));

    // 如果有对话框打开了
    if (afterCount.count > 0 && afterCount.wrps.some(w => w.visible)) {
        console.log('\n✓ 对话框打开了！截图');
        await page.screenshot({ path: path.join(DBG, 'poster_dialog_open.png'), fullPage: true });

        // 尝试填入文字并生成
        const dialog = page.locator('.weui-desktop-dialog__wrp').filter({ has: page.locator('.weui-desktop-dialog:visible') }).first();

        // 找输入框
        const inputs = await dialog.locator('textarea, input[type="text"], [contenteditable="true"]').all();
        console.log('对话框输入框数量:', inputs.length);
        for (const inp of inputs) {
            const tag = await inp.evaluate(el => el.tagName);
            const placeholder = await inp.getAttribute('placeholder') || '';
            console.log('  输入框:', tag, placeholder.slice(0, 50));
        }

        // 查找"生成"按钮
        const btns = await dialog.locator('button, .weui-desktop-btn, [class*="btn"]').all();
        for (const btn of btns) {
            const text = await btn.textContent();
            const visible = await btn.isVisible().catch(() => false);
            console.log('  按钮:', text?.trim().slice(0, 20), 'visible:', visible);
        }
    } else {
        console.log('\n✗ 对话框未打开，尝试Vue方式');
        await page.screenshot({ path: path.join(DBG, 'poster_no_dialog.png'), fullPage: true });

        // 尝试Vue方式：强制打开
        const vueResult = await page.evaluate(() => {
            function findVue(el, depth = 0) {
                if (depth > 20) return null;
                if (el?.__vue__) return el.__vue__;
                for (const child of el?.children || []) {
                    const f = findVue(child, depth + 1);
                    if (f) return f;
                }
                return null;
            }
            // 找text_poster_dialog组件
            const dialogEl = document.querySelector('.text_poster_dialog');
            if (!dialogEl) return 'dialog element not found';
            const dvm = findVue(dialogEl);
            if (!dvm) return 'dialog Vue not found';

            // 打印所有data属性
            const data = {};
            for (const key of Object.keys(dvm.$data || {})) {
                const val = dvm.$data[key];
                data[key] = typeof val === 'function' ? '[Function]' :
                    typeof val === 'object' ? JSON.stringify(val).slice(0, 100) : val;
            }
            console.log('dialog data keys:', Object.keys(dvm.$data || {}));
            console.log('dialog data:', data);

            // 查找打开方法
            const proto = Object.getPrototypeOf(dvm);
            const methods = Object.getOwnPropertyNames(proto).filter(m => {
                try { return typeof proto[m] === 'function' && m !== 'constructor'; } catch(e) { return false; }
            });
            console.log('dialog methods:', methods.join(', '));

            // 尝试设置dialogVisible
            dvm.dialogVisible = true;
            dvm.$forceUpdate();
            return { dataKeys: Object.keys(dvm.$data || {}), methods };
        });
        console.log('Vue结果:', JSON.stringify(vueResult, null, 2));

        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(DBG, 'poster_after_vue_force.png'), fullPage: true });
    }

    await browser.close();
})();
