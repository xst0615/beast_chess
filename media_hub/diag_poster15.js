// 点击后等待更长时间，监听DOM变化，同时检查iframe
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');
const DBG = path.join(__dirname, 'data', 'debug');
const TITLE = '水象小时候都是小哭包';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
        const t = msg.text();
        if (msg.type() === 'error' && !t.includes('ERR_UNKNOWN') && !t.includes('status of 404')) {
            console.log('  [page-' + msg.type() + ']', t.slice(0, 200));
        }
    });

    // 记录DOM新增的dialog类元素
    const newDialogs = [];
    await page.exposeBinding('onDomChange', (source, mutations) => {
        // not used
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 在点击前启动MutationObserver监听DOM变化
    await page.evaluate(() => {
        window.__domLog = [];
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes.length > 0) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === 1) {
                            const cls = node.className?.toString() || '';
                            if (cls.includes('dialog') || cls.includes('poster') || cls.includes('mask') || cls.includes('Dialog')) {
                                window.__domLog.push({
                                    time: Date.now(),
                                    tag: node.tagName,
                                    class: cls.slice(0, 150),
                                    parent: m.target.className?.toString().slice(0, 80),
                                    width: node.getBoundingClientRect?.()?.width || 0
                                });
                            }
                            // 子元素里可能有
                            node.querySelectorAll?.('.weui-desktop-dialog__wrp, [class*="poster"]').forEach(el => {
                                window.__domLog.push({
                                    time: Date.now(),
                                    tag: el.tagName,
                                    class: el.className?.toString().slice(0, 150),
                                    parent: node.tagName + '.' + (node.className?.toString().slice(0, 50) || ''),
                                    width: el.getBoundingClientRect?.()?.width || 0,
                                    isChild: true
                                });
                            });
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.__observer = observer;
    });

    // 记录点击时间
    const clickTime = Date.now();

    // 点击文字海报按钮（精确：图片区域的pop-opr__button，文本为"文字海报"）
    console.log('=== 点击文字海报按钮 ===');
    const clicked = await page.evaluate(() => {
        const imgAdd = document.querySelector('.image-selector__add');
        if (!imgAdd) return false;
        const btn = imgAdd.querySelector('.pop-opr__button');
        // 找文字海报
        const btns = [...imgAdd.querySelectorAll('.pop-opr__button')];
        const posterBtn = btns.find(b => b.textContent?.trim() === '文字海报');
        if (posterBtn) {
            posterBtn.click();
            return true;
        }
        return false;
    });
    console.log('点击成功:', clicked);

    // 等待并轮询
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(2000);
        const state = await page.evaluate((clickTime) => {
            const wrps = [...document.querySelectorAll('.weui-desktop-dialog__wrp')];
            const iframes = [...document.querySelectorAll('iframe')];
            return {
                elapsed: Date.now() - clickTime,
                wrpCount: wrps.length,
                wrps: wrps.map(w => ({
                    w: Math.round(w.getBoundingClientRect().width),
                    h: Math.round(w.getBoundingClientRect().height),
                    display: getComputedStyle(w).display,
                    text: w.textContent?.trim().slice(0, 100)
                })),
                iframeCount: iframes.length,
                iframes: iframes.map(f => ({ src: f.src?.slice(0, 100), w: f.offsetWidth, h: f.offsetHeight })),
                domLog: window.__domLog.slice(-10),
                domLogCount: window.__domLog.length
            };
        }, clickTime);
        console.log(`\n等待${state.elapsed}ms:`);
        console.log('  dialog wrappers:', state.wrpCount);
        state.wrps.forEach(w => console.log('    ', w.display, w.w + 'x' + w.h, w.text?.slice(0, 80)));
        console.log('  iframes:', state.iframeCount);
        state.iframes.forEach(f => console.log('    ', f.w + 'x' + f.h, f.src));
        console.log('  DOM新增:', state.domLogCount);
        state.domLog.forEach(d => console.log('    ', d.tag + '.' + d.class.slice(0, 60), d.isChild ? '(child)' : '', 'w=' + d.width));

        if (state.wrpCount > 0) {
            await page.screenshot({ path: path.join(DBG, 'poster_dialog_' + Date.now() + '.png'), fullPage: true });
            break;
        }
    }

    // 如果还是没有，检查pop-opr__list是否是在鼠标悬浮时才显示
    // 文字海报可能是在点击本地上传区域的"+"按钮后弹出的选项
    console.log('\n=== 检查是否需要先点击图片上传区域(+) ===');
    // 找image-selector__add内的"+"按钮或上传区域
    const uploadArea = await page.evaluate(() => {
        const add = document.querySelector('.image-selector__add');
        if (!add) return 'not found';
        // 找可能的触发按钮
        const btns = [...add.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 20 && r.height > 20 && el.children.length <= 2;
        }).slice(0, 10).map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 80),
            text: el.textContent?.trim().slice(0, 30),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height)
        }));
        return btns;
    });
    console.log('图片区域内元素:', JSON.stringify(uploadArea, null, 2));

    await browser.close();
})();
