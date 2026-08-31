// 探测微信编辑器封面图区域和 AI 生成入口
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

    // 1. 查找封面图相关元素
    console.log('=== 封面图区域元素 ===');
    const coverEls = await editor.evaluate(() => {
        const all = [...document.querySelectorAll('*')];
        return all.filter(el => {
            const t = el.textContent?.trim() || '';
            const cls = el.className?.toString() || '';
            const id = el.id || '';
            return t.includes('封面') || t.includes('AI') || t.includes('生成') || cls.includes('cover') || cls.includes('ai-') || id.includes('cover');
        }).map(el => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
                tag: el.tagName,
                id: el.id || '',
                class: el.className?.toString().slice(0, 80) || '',
                text: el.textContent?.trim().slice(0, 60) || '',
                visible: r.width > 0 && r.height > 0 && style.display !== 'none',
                size: `${Math.round(r.width)}x${Math.round(r.height)}`,
            };
        }).filter((e, i, arr) => arr.findIndex(x => x.text === e.text && x.class === e.class) === i);
    });
    coverEls.forEach((e, i) => console.log(`${i}. [${e.tag}] id="${e.id}" class="${e.class}" 可见=${e.visible} 尺寸=${e.size} text="${e.text}"`));

    // 2. 页面中包含"AI"的文字
    console.log('\n=== 包含 AI/智能/生成 的文字 ===');
    const aiTexts = await editor.evaluate(() => {
        const all = [...document.querySelectorAll('a, button, span, div, li')];
        return all.filter(el => {
            const t = el.textContent?.trim() || '';
            return (t.includes('AI') || t.includes('智能') || t.includes('生成')) && t.length < 30 && el.children.length === 0;
        }).map(el => el.textContent?.trim());
    });
    [...new Set(aiTexts)].forEach(t => console.log('-', t));

    // 3. 截图封面区域
    await editor.screenshot({ path: path.join(DBG, 'cover_inspect.png') });

    // 4. 查找"拖拽或选择封面"区域并点击
    console.log('\n=== 点击封面区域 ===');
    const coverArea = editor.locator('text=拖拽或选择封面').first();
    if (await coverArea.count() > 0) {
        await coverArea.click({ timeout: 5000 }).catch(e => console.log('点击失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(2000);
        console.log('点击后 URL:', editor.url());
        await editor.screenshot({ path: path.join(DBG, 'cover_after_click.png') });

        // 查看点击后出现的元素（可能有上传/AI生成选项）
        const afterClickEls = await editor.evaluate(() => {
            const all = [...document.querySelectorAll('a, button, [role="tab"], [role="menuitem"], li, span, div')];
            return all.filter(el => {
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && el.children.length === 0;
            }).map(el => el.textContent?.trim().slice(0, 30)).filter(t => t && t.length < 20);
        });
        console.log('点击后可见文字选项:');
        [...new Set(afterClickEls)].forEach(t => console.log('-', t));
    }

    await browser.close();
})();
