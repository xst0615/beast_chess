// 检查 insert_ai_pic 是否插入正文 + 探索封面专用选项
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const PROMPT = '碧海蓝天白色沙滩椰子树，度假风情，高清摄影';

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
    await editor.keyboard.type('测试AI封面-验证insert语义');

    // 移除残留对话框
    await editor.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 打开 AI 配图并发送
    await editor.evaluate(() => document.querySelector('.js_img_from_ai')?.click());
    await editor.waitForTimeout(3000);
    const initImgCount = await editor.evaluate(() => document.querySelector('.weui-desktop-dialog__wrp')?.querySelectorAll('img').length || 0);
    console.log(`初始图片数: ${initImgCount}`);

    const ta = editor.locator('.chat_textarea').first();
    await ta.click();
    await ta.fill(PROMPT);
    await editor.waitForTimeout(500);
    await editor.locator('.weui-desktop-dialog__wrp .send-btn').first().click({ timeout: 5000 });

    // 等待生成
    let generated = false;
    for (let i = 0; i < 18; i++) {
        await editor.waitForTimeout(5000);
        const state = await editor.evaluate(() => {
            const wrp = document.querySelector('.weui-desktop-dialog__wrp');
            if (!wrp) return { imgs: 0, generating: true };
            const imgs = wrp.querySelectorAll('img').length;
            const text = wrp.textContent || '';
            const generating = text.includes('生成中') || !!wrp.querySelector('[class*="loading"], [class*="spin"]');
            return { imgs, generating };
        });
        if (state.imgs > initImgCount && !state.generating) { generated = true; break; }
        if (i === 17) console.log('生成超时');
    }
    console.log('生成完成:', generated);

    if (!generated) { await browser.close(); return; }

    // 记录正文图片数（应用前）
    const bodyImgsBefore = await editor.evaluate(() => document.querySelectorAll('.ProseMirror img, #js_content img, .edui-body-container img').length);

    // 点击最新图片的"应用"
    await editor.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        const applyBtns = [...wrp.querySelectorAll('.ai-image-op-btn')].filter(el => el.textContent?.trim() === '应用');
        applyBtns[applyBtns.length - 1].click();
    });
    await editor.waitForTimeout(3000);

    // 检查正文是否插入了图片
    const bodyImgsAfter = await editor.evaluate(() => {
        const imgs = document.querySelectorAll('.ProseMirror img, #js_content img, .edui-body-container img');
        return { count: imgs.length, srcs: [...imgs].map(i => i.src?.slice(0, 70)) };
    });
    console.log(`\n正文图片: 应用前=${bodyImgsBefore}, 应用后=${bodyImgsAfter.count}`);
    console.log('图片 src:', JSON.stringify(bodyImgsAfter.srcs, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'insert_check_body.png') });

    // 检查封面状态
    const coverState = await editor.evaluate(() => {
        const nullCover = document.querySelector('#js_cover_null');
        return { nullCoverVisible: nullCover ? nullCover.getBoundingClientRect().width > 0 : false };
    });
    console.log('封面状态:', JSON.stringify(coverState));

    // 如果图片插入正文了，检查右键/点击图片的菜单（是否有"设为封面"）
    if (bodyImgsAfter.count > 0) {
        console.log('\n=== 检查图片操作菜单 ===');
        const firstImg = editor.locator('.ProseMirror img, #js_content img').first();
        await firstImg.click({ timeout: 5000 }).catch(e => console.log('点击图片失败:', e.message.split('\n')[0]));
        await editor.waitForTimeout(2000);

        // 查找弹出的菜单
        const menuItems = await editor.evaluate(() => {
            // 找所有可见的菜单/浮层
            const menus = [...document.querySelectorAll('[class*="menu"], [class*="popover"], [class*="tooltip"], [class*="pop"], [class*="dropdown"]')].filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 20 && r.height > 20;
            });
            return menus.map(m => ({
                class: m.className?.toString().slice(0, 50),
                text: m.textContent?.trim().slice(0, 60),
            }));
        });
        console.log('可见菜单:', JSON.stringify(menuItems, null, 2));
        await editor.screenshot({ path: path.join(DBG, 'insert_img_menu.png') });
    }

    // 重新检查封面下拉菜单的所有选项（移除对话框后）
    console.log('\n=== 封面下拉菜单选项 ===');
    // 关闭可能残留的对话框
    await editor.keyboard.press('Escape').catch(() => {});
    await editor.waitForTimeout(1000);

    // 悬停封面区域触发下拉
    const coverBtn = editor.locator('.js_share_type_none_image').first();
    await coverBtn.hover({ timeout: 5000 }).catch(() => {});
    await editor.waitForTimeout(1000);

    // 列出下拉菜单所有项
    const menuOpts = await editor.evaluate(() => {
        // .js_cover_opr 是下拉菜单容器
        const opr = document.querySelector('.js_cover_opr');
        if (!opr) return { found: false };
        const r = opr.getBoundingClientRect();
        const items = [...opr.querySelectorAll('*')].filter(el => el.children.length === 0 && el.textContent?.trim() && el.getBoundingClientRect().width > 0).map(el => ({
            tag: el.tagName, class: el.className?.toString().slice(0, 50), text: el.textContent?.trim().slice(0, 30)
        }));
        return { found: true, visible: r.width > 0, w: Math.round(r.width), h: Math.round(r.height), items };
    });
    console.log(JSON.stringify(menuOpts, null, 2));
    await editor.screenshot({ path: path.join(DBG, 'insert_cover_menu.png') });

    await browser.close();
})();
