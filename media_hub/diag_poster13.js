// 关键：按钮是pop-opr__button但可能在图片区域默认隐藏，需要先让图片区域显示按钮
// 贴图模式页面中，"文字海报"按钮在图片选择区域，需要先确保图片区域处于激活状态
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
        if (msg.type() === 'error') console.log('  [page-error]', msg.text().slice(0, 200));
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 核心问题：贴图编辑器页面有两个区域的"文字海报"按钮
    // 1. 图片选择区域(image-selector__add)的pop-opr__list
    // 2. 正文输入区域(share-text__addon)的pop-opr__list
    // 需要找到图片选择区域的那个可见的"文字海报"按钮

    // 先分析所有pop-opr__list
    console.log('=== 分析所有pop-opr区域 ===');
    const listAnalysis = await page.evaluate(() => {
        const lists = [...document.querySelectorAll('.pop-opr__list')];
        return lists.map((list, i) => {
            const btns = [...list.querySelectorAll('.pop-opr__button')].map(b => b.textContent?.trim());
            const rect = list.getBoundingClientRect();
            // 查找父容器
            let parent = list;
            for (let j = 0; j < 5; j++) {
                parent = parent.parentElement;
                if (!parent) break;
                if (parent.classList.contains('image-selector__add') ||
                    parent.classList.contains('share-text__addon') ||
                    parent.classList.contains('image-selector')) break;
            }
            return {
                index: i,
                btns: btns,
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                parentClass: parent?.className?.toString().slice(0, 80),
                visible: list.offsetParent !== null,
                childCount: list.children.length
            };
        });
    });
    listAnalysis.forEach(l => {
        console.log(`列表${l.index}: pos=(${l.rect.top},${l.rect.left}) size=${l.rect.w}x${l.rect.h} visible=${l.visible} parent=${l.parentClass}`);
        console.log(`  按钮: ${l.btns.join(', ')}`);
    });

    // 关键！AI配图按钮是用 js_ai_image_entry class标识的
    // 同理文字海报可能也有类似的js_xxx类
    console.log('\n=== 查找包含poster的class ===');
    const posterEls = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="poster"]')].map(el => ({
            tag: el.tagName,
            class: el.className?.toString().slice(0, 100),
            text: el.textContent?.trim().slice(0, 50),
            visible: el.offsetParent !== null
        }));
    });
    console.log(JSON.stringify(posterEls, null, 2));

    // 找到js_ai_image_entry的同级li中的文字海报
    console.log('\n=== AI配图按钮同级元素 ===');
    const aiSiblings = await page.evaluate(() => {
        const aiBtn = document.querySelector('.js_ai_image_entry');
        if (!aiBtn) return 'not found';
        const list = aiBtn.parentElement; // pop-opr__list
        return [...list.children].map(li => ({
            class: li.className,
            text: li.textContent?.trim().slice(0, 20),
            visible: li.offsetParent !== null
        }));
    });
    console.log(JSON.stringify(aiSiblings, null, 2));

    // AI配图按钮已经成功使用过了，它的选择器是 .js_ai_image_entry .pop-opr__button
    // 现在找文字海报对应的入口li
    // 在image-selector__add区域，文字海报是最后一个li
    console.log('\n=== 精确点击图片区域的文字海报 ===');
    // 方法：在 image-selector__add 区域找到所有pop-opr__button中文字为"文字海报"的
    const posterBtnLocator = page.locator('.image-selector__add .pop-opr__list .pop-opr__button').filter({ hasText: '文字海报' }).first();

    // 检查是否存在
    const btnCount = await posterBtnLocator.count();
    console.log('图片区域文字海报按钮数量:', btnCount);

    if (btnCount > 0) {
        // 检查可见性
        const isVisible = await posterBtnLocator.isVisible().catch(() => false);
        console.log('按钮可见:', isVisible);

        if (!isVisible) {
            // 图片区域的按钮可能默认隐藏，需要先hover图片区域
            console.log('尝试hover图片区域...');
            await page.hover('.image-selector__add');
            await page.waitForTimeout(500);
        }

        // 用scrollIntoView确保可见
        await posterBtnLocator.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);

        // 截图
        await page.screenshot({ path: path.join(DBG, 'poster_before_precise.png') });

        // 点击
        try {
            await posterBtnLocator.click({ timeout: 5000 });
            console.log('点击成功');
        } catch(e) {
            console.log('点击失败，尝试force点击:', e.message);
            await posterBtnLocator.click({ force: true, timeout: 5000 });
        }
        await page.waitForTimeout(4000);

        await page.screenshot({ path: path.join(DBG, 'poster_after_precise.png') });

        // 检查对话框
        const dlgState = await page.evaluate(() => {
            const dlg = document.querySelector('.text_poster_dialog');
            return {
                htmlLen: dlg?.innerHTML?.length || 0,
                hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
                maskDisplay: dlg?.querySelector('.weui-desktop-mask')?.style.display,
                text: dlg?.textContent?.trim().slice(0, 200)
            };
        });
        console.log('对话框状态:', dlgState);

        // 如果对话框还是没打开，检查是否有其他遮罩或问题
        if (!dlgState.hasDialog) {
            // 直接用JS调用image-selector的__vue__方法
            console.log('\n=== JS直接调用onAddByTextPoster ===');
            await page.evaluate(async () => {
                const vm = document.querySelector('.image-selector')?.__vue__;
                if (vm) {
                    // 先等预加载完成
                    if (vm._prefetchTextPoster) await vm._prefetchTextPoster();
                    vm.onAddByTextPoster();
                }
            });
            await page.waitForTimeout(5000);

            const dlgState2 = await page.evaluate(() => {
                const dlg = document.querySelector('.text_poster_dialog');
                function findVue(el, depth = 0) {
                    if (depth > 15) return null;
                    if (el?.__vue__) return el.__vue__;
                    for (const child of el?.children || []) {
                        const found = findVue(child, depth + 1);
                        if (found) return found;
                    }
                    return null;
                }
                const dvm = findVue(dlg);
                return {
                    htmlLen: dlg?.innerHTML?.length || 0,
                    hasDialog: dlg?.querySelector('.weui-desktop-dialog') !== null,
                    dialogVisible: dvm?.dialogVisible,
                    dvmFound: !!dvm
                };
            });
            console.log('JS调用后状态:', dlgState2);
            await page.screenshot({ path: path.join(DBG, 'poster_after_js.png') });
        }
    }

    await browser.close();
})();
