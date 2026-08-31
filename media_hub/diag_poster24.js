// dialogVisible=true但DOM没内容，可能是Vue的Teleport/portal
// 搜索整个document找包含poster相关内容的可见对话框
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        const t = msg.text();
        if (msg.type() === 'error' && !t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
            console.log('  [page-' + msg.type() + ']', t.slice(0, 300));
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试');
    await page.waitForTimeout(500);

    // 调用prefetch + show
    await page.evaluate(async () => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        await vm._prefetchTextPoster();
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (vm._textPosterCache) break;
        }
        vm.$refs.textPosterDialog.show(vm._textPosterCache);
    });

    await page.waitForTimeout(5000);

    // 搜索整个document中的可见dialog
    const searchResult = await page.evaluate(() => {
        // 查找所有可能的dialog wrapper
        const allWraps = [...document.querySelectorAll('[class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"]')];
        const visibleDialogs = allWraps.filter(el => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 200 && r.height > 200 && style.display !== 'none' && style.visibility !== 'hidden';
        });

        // 特别查找包含"文字海报"或"生成"文本的元素
        const posterTexts = [...document.querySelectorAll('*')].filter(el => {
            const text = el.textContent?.trim();
            return el.children.length === 0 && text &&
                (text === '文字海报' || text === '生成文字海报' || (text.includes('生成') && text.length < 10));
        }).map(el => ({
            text: el.textContent?.trim(),
            tag: el.tagName,
            class: el.className?.toString().slice(0, 80),
            top: Math.round(el.getBoundingClientRect().top),
            visible: el.offsetParent !== null
        }));

        // 查找.text_poster_dialog的完整outerHTML
        const dlg = document.querySelector('.text_poster_dialog');
        let dlgOuter = '';
        if (dlg) {
            // 深度查找所有元素
            function dump(el, depth = 0) {
                let str = '';
                const indent = '  '.repeat(depth);
                const r = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                str += `${indent}<${el.tagName.toLowerCase()} class="${el.className?.toString().slice(0,60) || ''}" style="display:${style.display};width:${Math.round(r.width)};height:${Math.round(r.height)};visibility:${style.visibility};opacity:${style.opacity}">\n`;
                for (const child of el.children) {
                    str += dump(child, depth + 1);
                }
                str += `${indent}</${el.tagName.toLowerCase()}>\n`;
                return str;
            }
            dlgOuter = dump(dlg);
        }

        // 查找body直接子元素中所有大尺寸元素
        const bodyChildren = [...document.body.children].map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                class: el.className?.toString().slice(0, 80),
                id: el.id,
                w: Math.round(r.width),
                h: Math.round(r.height),
                display: getComputedStyle(el).display
            };
        });

        return {
            visibleDialogCount: visibleDialogs.length,
            visibleDialogs: visibleDialogs.map(d => ({
                tag: d.tagName,
                class: d.className?.toString().slice(0, 100),
                w: Math.round(d.getBoundingClientRect().width),
                h: Math.round(d.getBoundingClientRect().height),
                text: d.textContent?.trim().slice(0, 100),
                parentClass: d.parentElement?.className?.toString().slice(0, 60)
            })),
            posterTexts,
            dlgDump: dlgOuter,
            bodyChildren: bodyChildren.filter(c => c.w > 100 || c.h > 100)
        };
    });

    console.log('=== 搜索结果 ===');
    console.log('可见dialog数:', searchResult.visibleDialogCount);
    searchResult.visibleDialogs.forEach(d => console.log(' ', d.tag + '.' + d.class, d.w+'x'+d.h, 'parent:'+d.parentClass, d.text?.slice(0,50)));
    console.log('\nposter文字元素:', searchResult.posterTexts.length);
    searchResult.posterTexts.forEach(p => console.log(' ', p.text, p.tag+'.'+p.class, 'top:'+p.top, 'visible:'+p.visible));
    console.log('\nbody大尺寸子元素:');
    searchResult.bodyChildren.forEach(c => console.log(' ', c.tag+(c.id?'#'+c.id:'')+'.'+c.class.slice(0,50), c.w+'x'+c.h, c.display));
    console.log('\n.text_poster_dialog DOM树:');
    console.log(searchResult.dlgDump.slice(0, 3000));

    await browser.close();
})();
