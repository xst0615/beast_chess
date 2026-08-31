// 拦截网络请求，同时用非headless模式+截图仔细看页面状态
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();

    // 拦截所有请求，记录和poster相关的
    const posterRequests = [];
    page.on('request', req => {
        const url = req.url();
        if (url.includes('poster') || url.includes('webtextposter')) {
            posterRequests.push({ method: req.method(), url: url.slice(0, 200), postData: req.postData()?.slice(0, 500) });
        }
    });
    page.on('response', async res => {
        const url = res.url();
        if (url.includes('poster') || url.includes('webtextposter')) {
            try {
                const body = await res.text();
                posterRequests.push({ type: 'response', url: url.slice(0, 200), status: res.status(), body: body.slice(0, 500) });
            } catch(e) {}
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 先截一张完整页面看布局
    await page.screenshot({ path: path.join(DBG, 'poster_full_page.png'), fullPage: true });

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 获取"文字海报"按钮的精确位置
    const btnPos = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(b => b.textContent?.trim() === '文字海报' && b.offsetParent !== null);
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return { top: rect.top, left: rect.left, w: rect.width, h: rect.height, visible: btn.offsetParent !== null, display: getComputedStyle(btn).display, visibility: getComputedStyle(btn).visibility, opacity: getComputedStyle(btn).opacity };
    });
    console.log('文字海报按钮位置:', btnPos);

    // 仔细检查按钮是否真的可见
    const btnVisibility = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.pop-opr__button')].filter(b => b.textContent?.trim() === '文字海报');
        return btns.map((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const style = getComputedStyle(btn);
            const parent = btn.closest('.pop-opr__item');
            const parentStyle = parent ? getComputedStyle(parent) : null;
            return {
                index: i,
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                pointerEvents: style.pointerEvents,
                parentDisplay: parentStyle?.display,
                parentVisibility: parentStyle?.visibility,
                parentOpacity: parentStyle?.opacity,
                parentClass: parent?.className
            };
        });
    });
    console.log('\n所有文字海报按钮可见性:', JSON.stringify(btnVisibility, null, 2));

    // 截图看按钮
    await page.screenshot({ path: path.join(DBG, 'poster_btns.png') });

    // 点击图片区域的"文字海报"按钮——它在image-selector__add下面
    // 可能有多个pop-opr__list，一个是正文区域的，一个是图片区域的
    // 我们需要点击图片区域（image-selector__add）下面的那个
    console.log('\n=== 查找图片区域的文字海报按钮 ===');
    const imgPosterBtn = await page.evaluate(() => {
        // 在image-selector__add区域内找
        const imgAdd = document.querySelector('.image-selector__add');
        if (!imgAdd) return 'image-selector__add not found';
        const btns = [...imgAdd.querySelectorAll('.pop-opr__button')].filter(b => b.textContent?.trim() === '文字海报');
        // 检查可见性
        return btns.map(btn => {
            const rect = btn.getBoundingClientRect();
            const style = getComputedStyle(btn);
            const li = btn.closest('.pop-opr__item');
            const liStyle = li ? getComputedStyle(li) : null;
            return {
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                liDisplay: liStyle?.display,
                liVisibility: liStyle?.visibility,
                liClass: li?.className
            };
        });
    });
    console.log('图片区域文字海报按钮:', JSON.stringify(imgPosterBtn, null, 2));

    // 查找图片上传区域的完整HTML
    const imgAreaHTML = await page.evaluate(() => {
        const imgAdd = document.querySelector('.image-selector__add');
        if (!imgAdd) return 'not found';
        return imgAdd.innerHTML.slice(0, 3000);
    });
    console.log('\n图片区域HTML[0..2000]:', imgAreaHTML.slice(0, 2000));

    // 可能图片区域的按钮默认是隐藏的(display:none)，需要先hover/click图片区域
    // 先点击图片上传区域
    console.log('\n=== 点击图片上传区域 ===');
    const imgArea = page.locator('.image-selector__add, .weui-desktop-upload__area, [class*="upload__area"]').first();
    try {
        await imgArea.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
    } catch(e) {
        console.log('点击图片区域失败:', e.message);
    }

    // 再次检查按钮可见性
    const btnVisAfter = await page.evaluate(() => {
        const imgAdd = document.querySelector('.image-selector__add');
        if (!imgAdd) return [];
        const btns = [...imgAdd.querySelectorAll('.pop-opr__button')].filter(b => b.textContent?.trim() === '文字海报');
        return btns.map(btn => {
            const rect = btn.getBoundingClientRect();
            const style = getComputedStyle(btn);
            return {
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity
            };
        });
    });
    console.log('点击后按钮可见性:', JSON.stringify(btnVisAfter, null, 2));

    await browser.close();
})();
