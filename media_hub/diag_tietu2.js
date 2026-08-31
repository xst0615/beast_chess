// 深入探测贴图编辑器：AI 配图入口、图片区域、完整结构
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    // 直接用 createType=8 访问贴图编辑器
    const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`;
    console.log('直接访问贴图编辑器:', editorUrl.slice(0, 120));
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    await page.screenshot({ path: path.join(DBG, 'tietu_full.png'), fullPage: true });
    console.log('URL:', page.url().slice(0, 120));

    // 1. 列出工具栏所有按钮（找 AI 相关）
    console.log('\n=== 工具栏按钮 ===');
    const toolbarBtns = await page.evaluate(() => {
        const toolbars = document.querySelectorAll('[class*="toolbar"], [class*="insert"], [class*="tool_bar"]');
        const all = [];
        toolbars.forEach(tb => {
            const items = [...tb.querySelectorAll('*')].filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 15 && r.height > 15 && el.children.length <= 2 && el.textContent?.trim();
            });
            items.forEach(el => {
                all.push({
                    tag: el.tagName,
                    class: el.className?.toString().slice(0, 60),
                    text: el.textContent?.trim().slice(0, 20),
                    title: el.title,
                });
            });
        });
        // 也查找含 ai/AI/img/image 的元素
        const aiEls = [...document.querySelectorAll('[class*="ai"], [class*="AI"], [class*="img_from"]')].map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 80),
            text: el.textContent?.trim().slice(0, 30),
            w: Math.round(el.getBoundingClientRect().width),
        }));
        return { toolbarItems: all.slice(0, 40), aiEls };
    });
    console.log('AI 相关元素:', JSON.stringify(toolbarBtns.aiEls, null, 2));

    // 2. 找 AI 配图按钮（js_img_from_ai / js_aiImage）
    console.log('\n=== AI 配图按钮检查 ===');
    const aiBtns = await page.evaluate(() => {
        const els = {
            js_img_from_ai: document.querySelector('.js_img_from_ai') ? { exists: true } : { exists: false },
            js_aiImage: document.querySelector('.js_aiImage') ? { exists: true } : { exists: false },
            js_ai_image: document.querySelector('[class*="ai-image"], [class*="ai_image"]') ? { exists: true } : { exists: false },
        };
        // 也搜索包含"AI"的可点击元素
        const allAi = [...document.querySelectorAll('*')].filter(el => {
            const t = el.textContent?.trim();
            const r = el.getBoundingClientRect();
            return t === 'AI 配图' && r.width > 0 && el.children.length === 0;
        }).map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 80),
            w: Math.round(el.getBoundingClientRect().width),
            parentClass: el.parentElement?.className?.toString().slice(0, 80),
        }));
        return { ...els, allAi };
    });
    console.log(JSON.stringify(aiBtns, null, 2));

    // 3. 查找图片区域/图片列表容器
    console.log('\n=== 图片容器 ===');
    const imgAreas = await page.evaluate(() => {
        // 查找可能的图片区域
        const selectors = [
            '[class*="image-list"]', '[class*="img-list"]', '[class*="pic-list"]',
            '[class*="image-area"]', '[class*="img-area"]', '[class*="pic-area"]',
            '[class*="image-container"]', '[class*="upload-area"]',
            '[class*="content_img"]', '[class*="tietu"]', '[class*="photo"]',
            '[id*="image"]', '[id*="photo"]',
        ];
        const results = [];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.width > 50 && r.height > 30) {
                    results.push({
                        sel,
                        tag: el.tagName,
                        class: el.className?.toString().slice(0, 60),
                        id: el.id,
                        w: Math.round(r.width),
                        h: Math.round(r.height),
                        text: el.textContent?.trim().slice(0, 80),
                    });
                }
            });
        });
        return results.slice(0, 20);
    });
    console.log(JSON.stringify(imgAreas, null, 2));

    // 4. 输入标题后，查看主编辑区结构
    console.log('\n=== 输入标题后结构 ===');
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('测试贴图发布');
    await page.waitForTimeout(1000);

    // 移除残留对话框后，尝试点击 js_img_from_ai
    await page.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 检查封面相关元素
    console.log('\n=== 封面/设置区域 ===');
    const coverInfo = await page.evaluate(() => {
        const coverNull = document.querySelector('#js_cover_null');
        const coverArea = document.querySelector('#js_cover_area');
        const shareTypeNone = document.querySelector('.js_share_type_none_image');
        const shareTypeImage = document.querySelector('.js_share_type_image');
        const settingGroups = [...document.querySelectorAll('[class*="setting"]')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 100 && r.height > 20;
        }).map(el => ({
            class: el.className?.toString().slice(0, 60),
            text: el.textContent?.trim().slice(0, 60),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
        }));
        return {
            coverNull: coverNull ? { w: Math.round(coverNull.getBoundingClientRect().width) } : null,
            coverArea: coverArea ? { w: Math.round(coverArea.getBoundingClientRect().width) } : null,
            shareTypeNone: shareTypeNone ? { text: shareTypeNone.textContent?.trim(), w: Math.round(shareTypeNone.getBoundingClientRect().width) } : null,
            settingGroups,
        };
    });
    console.log(JSON.stringify(coverInfo, null, 2));

    await page.screenshot({ path: path.join(DBG, 'tietu_structure.png'), fullPage: true });

    // 5. 尝试点击 AI 配图看是否能打开对话框
    console.log('\n=== 尝试点击 js_img_from_ai ===');
    const aiClickResult = await page.evaluate(() => {
        const el = document.querySelector('.js_img_from_ai');
        if (!el) return { found: false };
        el.click();
        return { found: true, clicked: true };
    });
    console.log('点击结果:', aiClickResult);
    await page.waitForTimeout(3000);

    const dialogAfter = await page.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };
        const r = wrp.getBoundingClientRect();
        return {
            opened: r.width > 0,
            text: wrp.textContent?.slice(0, 100),
            hasTextarea: !!wrp.querySelector('.chat_textarea'),
            imgCount: wrp.querySelectorAll('img').length,
        };
    });
    console.log('AI 对话框:', JSON.stringify(dialogAfter, null, 2));
    await page.screenshot({ path: path.join(DBG, 'tietu_ai_dialog.png'), fullPage: true });

    await browser.close();
})();
