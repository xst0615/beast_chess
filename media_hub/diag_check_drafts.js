// 精确检查"API测试贴图-001"在各草稿箱列表的实际情况
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TARGET_TITLE = 'API测试贴图-001';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];
    console.log('token:', token);

    // 检查多个可能的草稿箱列表
    const lists = [
        { name: '新草稿箱(type=77,list_card)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN` },
        { name: '图文草稿(type=10)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&t=media/appmsg_list_v2&action=list&type=10&sub_type=draft&token=${token}&lang=zh_CN` },
        { name: '全部图文(type=10,no sub)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&t=media/appmsg_list_v2&action=list&type=10&token=${token}&lang=zh_CN` },
        { name: '图片/贴图(type=10,sub=img)', url: `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&t=media/appmsg_list_v2&action=list&type=10&sub_type=img&token=${token}&lang=zh_CN` },
    ];

    for (const lst of lists) {
        await page.goto(lst.url, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(4000);

        // 精确获取草稿卡片标题
        const info = await page.evaluate((title) => {
            const bodyText = document.body?.innerText || '';
            const found = bodyText.includes(title);
            // 找草稿卡片的标题元素
            const cards = [...document.querySelectorAll('[class*="card"] [class*="title"], [class*="appmsg"] [class*="title"], .weui-desktop-card__title, .draft-item-title, [class*="list"] [class*="title"]')].map(el => el.textContent?.trim().slice(0, 40)).filter(Boolean);
            // 找所有包含"测试"的文字节点
            const matches = [...document.querySelectorAll('*')].filter(el => {
                return el.children.length === 0 && el.textContent?.includes('测试') && el.getBoundingClientRect().width > 50;
            }).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 50), class: el.className?.toString().slice(0, 40) }));
            return { found, cards: cards.slice(0, 15), matches: matches.slice(0, 10) };
        }, TARGET_TITLE);
        console.log(`\n${lst.name}: ${info.found ? '✓ 找到' : '✗ 未找到'}`);
        console.log('  草稿卡片:', JSON.stringify(info.cards));
        if (info.matches.length > 0) console.log('  匹配项:', JSON.stringify(info.matches));
        await page.screenshot({ path: path.join(DBG, `check_${lst.name.split('(')[0].replace(/\//g, '_')}.png`), fullPage: true }).catch(() => {});
    }

    // 也直接调用微信 API 查询草稿列表
    console.log('\n=== 直接调用 API 查询 ===');
    const apiResults = await page.evaluate(async (token) => {
        const url = `https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN&f=json`;
        try {
            const res = await fetch(url, { credentials: 'include' });
            const text = await res.text();
            return { ok: true, text: text.slice(0, 500) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }, token);
    console.log('API 返回:', apiResults.text?.slice(0, 500));

    await browser.close();
    console.log('\n=== 完成 ===');
})();
