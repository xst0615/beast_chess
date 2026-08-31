// 展开文章设置后尝试 AI 配图
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

    await editor.locator('.ProseMirror').first().click();
    await editor.keyboard.type('测试AI封面');

    // 1. 检查"文章设置"按钮状态
    console.log('=== 检查文章设置 ===');
    const settingsBtn = editor.locator('text=文章设置').first();
    const settingsCount = await settingsBtn.count();
    console.log('文章设置按钮数量:', settingsCount);
    if (settingsCount > 0) {
        const btnInfo = await settingsBtn.evaluate(el => ({
            class: el.className,
            text: el.textContent?.trim(),
        })).catch(() => 'err');
        console.log('按钮信息:', JSON.stringify(btnInfo));

        // 点击展开
        await settingsBtn.click({ timeout: 5000 }).catch(e => console.log('点击失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(1000);
        console.log('已点击文章设置');

        // 检查封面区域是否可见
        const coverOpInfo = await editor.locator('.js_cover_opr').first().evaluate(el => {
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height, display: getComputedStyle(el).display };
        }).catch(() => 'err');
        console.log('封面操作区信息:', JSON.stringify(coverOpInfo));
    }

    // 2. 检查所有包含"封面"的可交互元素
    console.log('\n=== 封面相关元素 ===');
    const coverEls = await editor.evaluate(() => {
        return [...document.querySelectorAll('*')].filter(el => {
            const t = el.textContent?.trim() || '';
            const cls = el.className?.toString() || '';
            return (t.includes('封面') || cls.includes('cover')) && el.children.length === 0;
        }).map(el => {
            const r = el.getBoundingClientRect();
            return { tag: el.tagName, class: el.className?.toString().slice(0, 50), text: el.textContent?.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
        });
    });
    coverEls.forEach((e, i) => console.log(`${i}. [${e.tag}] class="${e.class}" ${e.w}x${e.h} text="${e.text}"`));

    // 3. 尝试用 jQuery trigger 触发 AI 配图
    console.log('\n=== jQuery trigger ===');
    const result = await editor.evaluate(() => {
        const el = document.querySelector('.js_img_from_ai');
        if (!el) return 'no element';
        // 尝试 jQuery trigger
        if (window.jQuery || window.$) {
            const jq = window.jQuery || window.$;
            jq(el).trigger('click');
            return 'jquery triggered';
        }
        // 尝试完整鼠标事件序列
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return 'native events dispatched';
    });
    console.log('触发结果:', result);
    await editor.waitForTimeout(3000);

    const dialogInfo = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { exists: false };
        const r = wrp.getBoundingClientRect();
        return { visible: r.width > 0 && r.height > 0, display: getComputedStyle(wrp).display, text: wrp.textContent?.slice(0, 80) };
    });
    console.log('对话框:', JSON.stringify(dialogInfo, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'ai_jquery_trigger.png') });

    // 4. 如果还不行，尝试找封面区域的真正交互入口
    if (!dialogInfo.visible) {
        console.log('\n=== 查找封面交互入口 ===');
        // 可能需要点击一个更大的容器
        const coverContainer = editor.locator('.setting-group__cover, .weui-desktop-form__item:has-text("封面"), .appmsg-editor__setting-group:has-text("封面")').first();
        const ccCount = await coverContainer.count();
        console.log('封面容器数量:', ccCount);
        if (ccCount > 0) {
            const ccInfo = await coverContainer.evaluate(el => {
                const r = el.getBoundingClientRect();
                return { w: r.width, h: r.height, text: el.textContent?.slice(0, 50) };
            }).catch(() => 'err');
            console.log('封面容器信息:', JSON.stringify(ccInfo));

            // 点击封面容器
            await coverContainer.click({ timeout: 5000 }).catch(e => console.log('click 失败:', e.message.split('\n')[0]));
            await editor.waitForTimeout(1500);

            // 检查 AI 项是否可见
            const aiVisible = await editor.locator('.js_img_from_ai').first().isVisible().catch(() => false);
            console.log('AI 菜单项可见:', aiVisible);

            await editor.screenshot({ path: path.join(DBG, 'ai_container_click.png') });

            if (aiVisible) {
                await editor.locator('.js_img_from_ai').first().click({ timeout: 5000 }).catch(e => console.log('AI click 失败:', e.message.split('\n')[0]));
                await editor.waitForTimeout(3000);
                const di = await editor.evaluate(() => {
                    const wrp = document.querySelector('.weui-desktop-dialog__wrp');
                    if (!wrp) return { exists: false };
                    const r = wrp.getBoundingClientRect();
                    return { visible: r.width > 0 && r.height > 0, text: wrp.textContent?.slice(0, 80) };
                });
                console.log('对话框:', JSON.stringify(di, null, 2));
                await editor.screenshot({ path: path.join(DBG, 'ai_container_dialog.png') });
            }
        }
    }

    await browser.close();
})();
