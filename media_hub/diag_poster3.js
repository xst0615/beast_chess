// 点击"文字海报"按钮但不是正文区域的——应该是图片区域的按钮
// 用户截图显示的对话框有"生成海报"按钮和模板选择，可能是js_posterImage类
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 500 });
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
    await page.keyboard.type('水象小时候都是小哭包');
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 检查是否有 js_posterImage 或类似的文字海报按钮（AI配图旁边的可见按钮）
    const posterBtnInfo = await page.evaluate(() => {
        // 找可见的"文字海报"按钮——不是正文区域的，是图片区域的
        const allBtns = document.querySelectorAll('.pop-opr__button');
        const results = [];
        allBtns.forEach((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const text = btn.textContent?.trim();
            results.push({
                index: i,
                text: text,
                visible: btn.offsetParent !== null,
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                classes: btn.className,
                parentClasses: btn.parentElement?.className?.toString().slice(0, 80),
                // 查找特定class
                isPoster: btn.classList.contains('js_posterImage') || text === '文字海报'
            });
        });
        return results;
    });
    console.log('所有pop-opr__button:', JSON.stringify(posterBtnInfo.filter(b => b.visible), null, 2));

    // 点击可见的"文字海报"按钮（在图片区域的，不是正文区域的）
    // 注意：上面的结果中"文字海报"是第5个按钮（index=4），但点击它打开的是话题推荐
    // 也许是要先点击图片区域/封面区域才能看到"文字海报"选项？
    // 让我查看图片上传区域
    console.log('\n=== 图片上传区域结构 ===');
    const uploadArea = await page.evaluate(() => {
        // 贴图模式的图片上传区域
        const upload = document.querySelector('[class*="upload"]');
        if (!upload) return 'not found';
        return {
            class: upload.className?.toString(),
            html: upload.innerHTML?.slice(0, 3000)
        };
    });
    console.log(uploadArea);

    // 也检查cover区域
    const coverArea = await page.evaluate(() => {
        const cover = document.querySelector('[class*="cover"], [class*="thumb"]');
        if (!cover) return 'not found';
        return {
            class: cover.className?.toString().slice(0, 100),
            html: cover.innerHTML?.slice(0, 2000),
            text: cover.textContent?.trim().slice(0, 200)
        };
    });
    console.log('\n封面区域:', coverArea);

    await page.screenshot({ path: path.join(DBG, 'poster_area.png'), fullPage: true });

    // 先点图片上传区域(拖拽区)，看看会不会显示更多按钮
    console.log('\n=== 点击图片上传区域 ===');
    await page.evaluate(() => {
        // 点击拖拽区域
        const dragArea = document.querySelector('[class*="upload"] [class*="drag"], .weui-desktop-upload__area');
        if (dragArea) dragArea.click();
    });
    await page.waitForTimeout(2000);

    // 再找文字海报
    const posterBtn2 = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.pop-opr__button').forEach((btn, i) => {
            const rect = btn.getBoundingClientRect();
            if (btn.textContent?.trim() === '文字海报' && btn.offsetParent !== null) {
                results.push({ index: i, top: Math.round(rect.top), left: Math.round(rect.left), class: btn.className });
            }
        });
        return results;
    });
    console.log('可见"文字海报"按钮:', posterBtn2);

    await page.waitForTimeout(60000); // 保持浏览器打开60秒让我观察
    await browser.close();
})();
