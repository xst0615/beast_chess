// 诊断: 贴图保存后草稿箱找不到的问题
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '贴图诊断-' + Date.now().toString().slice(-4);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];
    console.log('token:', token);

    // 打开贴图编辑器
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    console.log('编辑器URL:', page.url().slice(0, 120));

    // 移除残留对话框
    await page.evaluate(() => {
        document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove());
    });

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(500);
    console.log('标题:', TITLE);

    // 监听网络请求，看保存时调用了什么 API
    const apiCalls = [];
    page.on('request', req => {
        const url = req.url();
        if (url.includes('appmsg') || url.includes('draft') || url.includes('save') || url.includes('commit')) {
            apiCalls.push({ method: req.method(), url: url.slice(0, 150), postData: req.postData()?.slice(0, 200) });
        }
    });
    page.on('response', async res => {
        const url = res.url();
        if ((url.includes('appmsg') || url.includes('draft') || url.includes('save') || url.includes('commit')) && res.request().method() === 'POST') {
            try {
                const body = await res.text();
                console.log(`\n[API响应] ${url.slice(0, 100)}`);
                console.log('  状态:', res.status());
                console.log('  正文:', body.slice(0, 300));
            } catch (e) {}
        }
    });

    // 点击保存
    console.log('\n=== 点击保存 ===');
    await page.locator('text=保存为草稿').first().click({ timeout: 10000 });
    await page.waitForTimeout(5000);

    // 截图保存后状态
    await page.screenshot({ path: path.join(DBG, 'diag_save_after.png'), fullPage: true });
    console.log('已截图: diag_save_after.png');

    // 打印所有 API 调用
    console.log('\n=== API 调用记录 ===');
    apiCalls.forEach((c, i) => console.log(`${i + 1}. [${c.method}] ${c.url}`));

    // 检查页面是否有错误提示
    const pageState = await page.evaluate(() => {
        const text = document.body.textContent || '';
        return {
            hasSuccess: text.includes('已保存') || text.includes('保存成功') || text.includes('成功'),
            hasError: text.includes('失败') || text.includes('错误') || text.includes('不能') || text.includes('无法'),
            errors: [...document.querySelectorAll('[class*="error"], [class*="alert"], [class*="warn"], [class*="toast"]')].map(el => ({
                class: el.className?.slice(0, 60),
                text: el.textContent?.trim().slice(0, 100),
                visible: el.getBoundingClientRect().width > 0,
            })).filter(e => e.visible),
            url: location.href,
        };
    });
    console.log('\n页面状态:', JSON.stringify(pageState, null, 2));

    // 检查不同类型的草稿箱
    console.log('\n=== 检查草稿箱（不同 type） ===');
    const draftTypes = [
        { name: '新版图文(type=77)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN` },
        { name: '图文(type=10)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&t=media/appmsg_list_v2&action=list&type=10&sub_type=draft&token=${token}&lang=zh_CN` },
        { name: '贴图/图片(type=10&subtype)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&t=media/appmsg_list_v2&action=list&type=10&sub_type=draft&token=${token}&lang=zh_CN` },
    ];

    for (const dt of draftTypes) {
        await page.goto(dt.url, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(3000);
        const text = await page.evaluate(() => document.body?.innerText || '');
        const found = text.includes(TITLE);
        // 获取页面中的草稿标题列表
        const drafts = await page.evaluate(() => {
            // 找草稿标题元素
            const items = [...document.querySelectorAll('[class*="card"] [class*="title"], [class*="appmsg"] [class*="title"], .weui-desktop-card__title, [class*="draft"] [class*="title"]')].map(el => el.textContent?.trim().slice(0, 30)).filter(Boolean);
            return items.slice(0, 10);
        });
        console.log(`${dt.name}: ${found ? '✓ 找到' : '✗ 未找到'} | 草稿列表: ${JSON.stringify(drafts)}`);
    }

    await page.screenshot({ path: path.join(DBG, 'diag_draftbox_final.png'), fullPage: true });
    await browser.close();
    console.log('\n=== 诊断完成 ===');
})();
