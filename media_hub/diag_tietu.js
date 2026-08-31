// 探测「贴图」入口和编辑器结构
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
    console.log('token:', token);

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);

    // 点击"新的创作"展开下拉
    await page.locator('text=新的创作').first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DBG, 'tietu_dropdown.png'), fullPage: true });

    // 列出下拉菜单项
    const menuItems = await page.evaluate(() => {
        // 找下拉菜单中的所有可选项
        const items = [...document.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 20) return false;
            const text = el.textContent?.trim();
            return ['文章', '贴图', '视频', '音频', '文字', '图片', '图集'].some(k => text === k);
        });
        return [...new Set(items.map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 50),
            text: el.textContent?.trim(),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
        })))].slice(0, 10);
    });
    console.log('下拉菜单项:', JSON.stringify(menuItems, null, 2));

    // 查找"贴图"按钮
    const tietuBtn = page.locator('text=贴图').first();
    const tietuCount = await tietuBtn.count();
    console.log('贴图按钮数量:', tietuCount);

    if (tietuCount > 0) {
        const tietuInfo = await tietuBtn.evaluate(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                class: el.className?.toString().slice(0, 80),
                text: el.textContent?.trim(),
                w: Math.round(r.width),
                h: Math.round(r.height),
                visible: r.width > 0 && r.height > 0,
                parent: {
                    tag: el.parentElement?.tagName,
                    class: el.parentElement?.className?.toString().slice(0, 80),
                }
            };
        }).catch(() => 'error');
        console.log('贴图按钮信息:', JSON.stringify(tietuInfo, null, 2));

        // 等待新标签页
        const popupPromise = page.waitForEvent('popup', { timeout: 15000 });
        await tietuBtn.click({ timeout: 5000 }).catch(async (e) => {
            console.log('Playwright click 失败，用 evaluate:', e.message.split('\n')[0]);
            await page.evaluate(() => {
                const els = [...document.querySelectorAll('*')].filter(el => el.textContent?.trim() === '贴图' && el.getBoundingClientRect().width > 10);
                if (els.length > 0) els[0].click();
            });
        });

        let editor = null;
        try {
            editor = await popupPromise;
            console.log('✓ 贴图编辑器在新标签页打开');
        } catch (e) {
            console.log('无新标签页，可能在当前页跳转');
            await page.waitForTimeout(3000);
            editor = page;
        }

        await editor.waitForLoadState('domcontentloaded');
        await editor.waitForTimeout(5000);
        console.log('贴图编辑器 URL:', editor.url().slice(0, 120));
        await editor.screenshot({ path: path.join(DBG, 'tietu_editor.png'), fullPage: true });

        // 分析编辑器页面结构
        console.log('\n=== 编辑器结构 ===');
        const pageInfo = await editor.evaluate(() => {
            const title = document.title;
            const inputs = [...document.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]')].map(el => {
                const r = el.getBoundingClientRect();
                return {
                    tag: el.tagName,
                    type: el.type,
                    class: el.className?.toString().slice(0, 50),
                    placeholder: el.placeholder,
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    visible: r.width > 0 && r.height > 0,
                    maxLength: el.maxLength,
                };
            }).filter(i => i.visible);

            // 找上传区域
            const uploadAreas = [...document.querySelectorAll('[class*="upload"], [class*="drop"], [class*="drag"], [class*="image-picker"], [class*="uploader"]')].map(el => {
                const r = el.getBoundingClientRect();
                return {
                    tag: el.tagName,
                    class: el.className?.toString().slice(0, 60),
                    text: el.textContent?.trim().slice(0, 50),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                };
            }).filter(u => u.w > 30 && u.h > 30);

            // 找按钮
            const btns = [...document.querySelectorAll('button, .btn, [class*="btn"], a')].filter(el => {
                const r = el.getBoundingClientRect();
                const text = el.textContent?.trim();
                return r.width > 30 && text && ['发表', '发布', '保存', '草稿', '预览', '下一步', '完成', '添加'].some(k => text.includes(k));
            }).map(el => ({
                tag: el.tagName,
                class: el.className?.toString().slice(0, 50),
                text: el.textContent?.trim().slice(0, 20),
                w: Math.round(el.getBoundingClientRect().width),
            }));

            return { title, inputs, uploadAreas: uploadAreas.slice(0, 10), btns: [...new Set(btns.map(b => JSON.stringify(b)))].map(s => JSON.parse(s)) };
        });
        console.log('页面标题:', pageInfo.title);
        console.log('\n输入字段:', JSON.stringify(pageInfo.inputs, null, 2));
        console.log('\n上传区域:', JSON.stringify(pageInfo.uploadAreas, null, 2));
        console.log('\n按钮:', JSON.stringify(pageInfo.btns, null, 2));
    } else {
        console.log('未找到"贴图"选项！');
        // 列出所有可能的创作类型
        const allOptions = await page.evaluate(() => {
            // 找"新的创作"点击后出现的所有菜单项
            return [...document.querySelectorAll('[class*="dropdown"] *, [class*="menu"] *, [class*="pop"] *')].filter(el => {
                const r = el.getBoundingClientRect();
                const t = el.textContent?.trim();
                return r.width > 30 && r.height > 10 && t && t.length < 10 && el.children.length === 0;
            }).map(el => el.textContent?.trim()).filter(Boolean);
        });
        console.log('菜单项:', [...new Set(allOptions)]);
    }

    await browser.close();
})();
