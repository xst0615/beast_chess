// 深入查看 text_poster_dialog 的DOM结构和触发机制
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
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
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 查看 text_poster_dialog 的完整结构
    console.log('=== text_poster_dialog 完整结构 ===');
    const dialogHTML = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        if (!dlg) return 'NOT FOUND';
        return {
            outerHTML: dlg.outerHTML.slice(0, 5000),
            style: dlg.getAttribute('style'),
            class: dlg.className,
            computedDisplay: getComputedStyle(dlg).display,
            computedVisibility: getComputedStyle(dlg).visibility,
            children: dlg.children.length
        };
    });
    console.log(JSON.stringify(dialogHTML, null, 2));

    // 查找文字海报按钮在哪个li中，是否有对应的JS事件绑定
    console.log('\n=== 文字海报按钮的父li和兄弟元素 ===');
    const posterLi = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(b => b.textContent?.trim() === '文字海报');
        if (!btn) return null;
        const li = btn.closest('.pop-opr__item');
        return {
            liClass: li?.className,
            liHTML: li?.outerHTML?.slice(0, 1000),
            liAttrs: li ? [...li.attributes].map(a => ({ name: a.name, value: a.value })) : null,
            // 看pop-opr__group-select-image的所有子按钮
            groupBtns: [...(li?.closest('.pop-opr__group-select-image')?.querySelectorAll('.pop-opr__button') || [])].map(b => ({
                text: b.textContent?.trim(),
                class: b.className,
                attr: [...b.attributes].map(a => ({ name: a.name, value: a.value.slice(0, 50) }))
            }))
        };
    });
    console.log(JSON.stringify(posterLi, null, 2));

    // 尝试用JS触发点击事件（dispatchEvent而不是直接.click()）
    console.log('\n=== 尝试JS事件触发文字海报 ===');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(b => b.textContent?.trim() === '文字海报');
        if (!btn) return;
        // 触发mousedown/mouseup/click
        ['mousedown', 'mouseup', 'click'].forEach(evt => {
            btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
        });
    });
    await page.waitForTimeout(2000);

    const dialogAfterClick = await page.evaluate(() => {
        const dlg = document.querySelector('.text_poster_dialog');
        return {
            display: dlg ? getComputedStyle(dlg).display : null,
            visibility: dlg ? getComputedStyle(dlg).visibility : null,
            hasContent: dlg?.innerHTML?.length > 100,
            html: dlg?.innerHTML?.slice(0, 3000)
        };
    });
    console.log('点击后dialog状态:', JSON.stringify(dialogAfterClick, null, 2));

    await page.screenshot({ path: path.join(DBG, 'poster_js_click.png'), fullPage: false });

    // 尝试找到触发text_poster_dialog的Vue组件方法
    // 查找 __vue__ 或 data-v 属性
    console.log('\n=== 查找Vue实例 ===');
    const vueInfo = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(b => b.textContent?.trim() === '文字海报');
        if (!btn) return null;
        // 向上找Vue实例
        let el = btn;
        for (let i = 0; i < 15; i++) {
            if (el.__vue__) {
                return {
                    found: true,
                    level: i,
                    tag: el.tagName,
                    class: el.className?.toString().slice(0, 80),
                    methods: Object.keys(el.__vue__).filter(k => typeof el.__vue__[k] === 'function' && k.includes('poster') || k.includes('Poster')).slice(0, 10),
                    data: Object.keys(el.__vue__.$data || {}).filter(k => k.includes('poster') || k.includes('Poster') || k.includes('show') || k.includes('dialog')).slice(0, 10)
                };
            }
            el = el.parentElement;
        }
        // 也查 dialog 上的Vue
        const dlg = document.querySelector('.text_poster_dialog');
        if (dlg?.__vue__) {
            return { found: true, onDialog: true };
        }
        return { found: false };
    });
    console.log(JSON.stringify(vueInfo, null, 2));

    // 尝试点击pop-opr__group-select-image中的"文字海报"的li
    // 这个可能需要先hover展开子菜单？
    console.log('\n=== 检查是否有hover菜单 ===');
    const hasSubmenu = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.pop-opr__button')].find(b => b.textContent?.trim() === '文字海报');
        if (!btn) return null;
        const li = btn.closest('.pop-opr__item');
        return {
            liClass: li?.className,
            parentListClass: li?.parentElement?.className,
            parentHTML: li?.parentElement?.outerHTML?.slice(0, 2000)
        };
    });
    console.log(JSON.stringify(hasSubmenu, null, 2));

    await browser.close();
})();
