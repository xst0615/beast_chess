// 深入 img-picker 对话框结构，找到可选择图片的元素形式
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '清晨森林薄雾弥漫，阳光穿过树梢，丁达尔效应，摄影';

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
    await editor.keyboard.type('测试-AI封面-picker结构');

    // ===== AI 生成并插入正文（同 pathB2） =====
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);
    const initImgs = await editor.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0);

    const ta = editor.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await editor.waitForTimeout(500);
    await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });

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
        if (state.imgs > initImgs && !state.generating) { generated = true; break; }
    }
    console.log('生成完成:', generated);
    if (!generated) { await browser.close(); return; }

    await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const btns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el =>
            el.textContent?.trim() === '应用' || el.textContent?.trim() === '使用'
        );
        btns[btns.length - 1]?.click();
    });
    await editor.waitForTimeout(4000);
    const bodyCount = await editor.evaluate(() => document.querySelectorAll('.ProseMirror img, #js_content img').length);
    console.log('正文图片数:', bodyCount);
    if (bodyCount === 0) { console.log('插入失败'); await browser.close(); return; }

    // ===== 打开 从正文选择 =====
    await editor.keyboard.press('Escape').catch(() => {});
    await editor.waitForTimeout(1000);
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });
    await editor.waitForTimeout(800);

    const coverBtn = editor.locator('.js_share_type_none_image').first();
    await coverBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await coverBtn.hover({ timeout: 5000 }).catch(() => {});
    await editor.waitForTimeout(1200);
    await editor.evaluate(() => document.querySelector('.js_selectCoverFromContent')?.click());
    await editor.waitForTimeout(3000);

    // ===== 深入检查 picker 对话框结构 =====
    console.log('\n=== picker 对话框完整结构 ===');
    const structure = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return { opened: false };

        // 1. 递归列出对话框的层级结构（限制深度4）
        const describe = (el, depth) => {
            if (depth > 4 || el.children.length > 30) {
                return { tag: el.tagName, class: el.className?.toString().slice(0, 50), children: el.children.length, truncated: true };
            }
            return {
                tag: el.tagName,
                class: el.className?.toString().slice(0, 50),
                text: el.children.length === 0 ? el.textContent?.trim().slice(0, 30) : undefined,
                style: el.style?.backgroundImage ? 'bg-img' : undefined,
                children: [...el.children].map(c => describe(c, depth + 1)),
            };
        };
        return { opened: true, structure: describe(wrp, 0) };
    });

    // 简化打印：只列出有背景图或图片的元素
    const bgElements = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return [];
        // 找所有有 background-image 的元素
        const els = [...wrp.querySelectorAll('*')].filter(el => {
            const bg = getComputedStyle(el).backgroundImage;
            return bg && bg !== 'none';
        });
        return els.map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 50),
            bg: getComputedStyle(el).backgroundImage.slice(0, 90),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
        }));
    });
    console.log('带背景图的元素:', JSON.stringify(bgElements, null, 2));

    // 检查 iframe
    const iframes = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return [];
        return [...wrp.querySelectorAll('iframe')].map(f => ({ src: f.src?.slice(0, 80), w: f.getBoundingClientRect().width }));
    });
    console.log('iframe:', JSON.stringify(iframes));

    // 检查所有可视的图片容器类元素
    const picContainers = await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) return [];
        return [...wrp.querySelectorAll('[class*="pic"], [class*="img"], [class*="item"], [class*="select"], [class*="choose"]')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 40 && r.height > 40;
        }).map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 60),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
            text: el.textContent?.trim().slice(0, 20),
            childTags: [...el.children].map(c => c.tagName).slice(0, 5).join(','),
        }));
    });
    console.log('图片容器类元素:', JSON.stringify(picContainers, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'picker_structure.png') });

    await browser.close();
})();
