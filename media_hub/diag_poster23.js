// 关键：对话框通过 this.$refs.textPosterDialog.show(cache) 打开
// show方法设置dialogVisible=true，加载模板数据
// 问题可能是image-selector组件的_prefetchTextPoster预加载是在hover/点击时才调用
// 或者 _textPosterCache 是 null，导致 show(null) 时调用 initLoad() 异步加载
// 解决方案：先调用_prefetchTextPoster等待预加载完成，再调用show
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
            console.log('  [page-' + msg.type() + ']', t.slice(0, 300));
        }
    });

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const token = page.url().match(/token=(\d+)/)?.[1];

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove()));

    // 填标题和正文
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(TITLE);
    await page.waitForTimeout(300);
    await page.locator('.ProseMirror').nth(1).click();
    await page.keyboard.type('测试文字海报');
    await page.waitForTimeout(500);

    // 核心：通过Vue $refs调用正确的流程
    console.log('=== 步骤1: 调用_prefetchTextPoster预加载 ===');
    const prefetchResult = await page.evaluate(async () => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return { ok: false, reason: 'vm not found' };
        if (!vm._prefetchTextPoster) return { ok: false, reason: 'no _prefetchTextPoster' };

        // 调用_prefetchTextPoster并等待缓存
        await vm._prefetchTextPoster();

        // 等待缓存被设置
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (vm._textPosterCache) {
                return {
                    ok: true,
                    cacheKeys: Object.keys(vm._textPosterCache),
                    sessionId: vm._textPosterCache.session_id,
                    templateCount: vm._textPosterCache.poster_list?.length
                };
            }
        }
        return { ok: false, reason: 'cache not set after 10s', hasCache: !!vm._textPosterCache };
    });
    console.log('预加载结果:', prefetchResult);

    if (!prefetchResult.ok) {
        console.log('预加载失败');
        await browser.close();
        return;
    }

    // 步骤2: 调用$refs.textPosterDialog.show(cache)打开对话框
    console.log('\n=== 步骤2: 调用$refs.textPosterDialog.show ===');
    const showResult = await page.evaluate(async () => {
        const vm = document.querySelector('.image-selector')?.__vue__;
        if (!vm) return { ok: false };
        const dialogRef = vm.$refs.textPosterDialog;
        if (!dialogRef) return { ok: false, reason: 'no textPosterDialog ref' };

        // show方法接受cache参数
        dialogRef.show(vm._textPosterCache);

        // 等待对话框渲染
        await new Promise(r => setTimeout(r, 3000));

        // 检查对话框状态
        return {
            ok: true,
            dialogVisible: dialogRef.dialogVisible,
            allPostersLen: dialogRef.allPosters?.length,
            posterListLen: dialogRef.posterList?.length,
            sessionId: dialogRef.sessionId,
            promptText: dialogRef.promptText
        };
    });
    console.log('show结果:', showResult);

    // 等待并检查DOM
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(DBG, 'poster_after_show.png'), fullPage: true });

    // 检查对话框DOM
    const domState = await page.evaluate(() => {
        const wrps = [...document.querySelectorAll('.weui-desktop-dialog__wrp')];
        const dlg = document.querySelector('.text_poster_dialog');
        return {
            wrpCount: wrps.length,
            wrpsVisible: wrps.filter(w => w.getBoundingClientRect().width > 100).length,
            dlgHTML: dlg?.innerHTML?.slice(0, 2000) || 'null',
            dlgChildCount: dlg?.children.length,
            dlgChildTags: dlg ? [...dlg.children].map(c => c.tagName + '.' + c.className?.toString().slice(0, 50) + ' display=' + getComputedStyle(c).display) : []
        };
    });
    console.log('\nDOM状态:');
    console.log('  wrpCount:', domState.wrpCount, 'visible:', domState.wrpsVisible);
    console.log('  dlg children:', domState.dlgChildCount);
    domState.dlgChildTags.forEach(t => console.log('   ', t));
    console.log('  dlg HTML[0..500]:', domState.dlgHTML?.slice(0, 500));

    // 步骤3: 填入标题文字
    console.log('\n=== 步骤3: 填入文字 ===');
    const textResult = await page.evaluate(async (title) => {
        function findVue(el, depth = 0) {
            if (depth > 20) return null;
            if (el?.__vue__) return el.__vue__;
            for (const child of el?.children || []) {
                const f = findVue(child, depth + 1);
                if (f) return f;
            }
            return null;
        }
        const dlgEl = document.querySelector('.text_poster_dialog');
        const dvm = findVue(dlgEl);
        if (!dvm) return { ok: false, reason: 'dvm not found' };

        // 填入promptText
        dvm.promptText = title;
        dvm.hasUserAction = true;
        // 触发input事件
        dvm.$nextTick && await dvm.$nextTick();
        await new Promise(r => setTimeout(r, 200));

        return {
            ok: true,
            promptText: dvm.promptText,
            hasUserAction: dvm.hasUserAction,
            canGenerate: !dvm.selectedIndex < 0 || !dvm.promptText.trim() || dvm.generating
        };
    }, TITLE);
    console.log('填入文字结果:', textResult);

    // 步骤4: 点击生成/确定按钮
    console.log('\n=== 步骤4: 查找并触发生成 ===');

    // 先看看对话框有哪些按钮
    await page.waitForTimeout(1000);
    const buttons = await page.evaluate(() => {
        const wrp = document.querySelector('.weui-desktop-dialog__wrp');
        if (!wrp) {
            // 查找text_poster_dialog内的所有按钮
            const dlg = document.querySelector('.text_poster_dialog');
            if (!dlg) return [];
            return [...dlg.querySelectorAll('button, .weui-desktop-btn, [class*="btn"]')].map(btn => ({
                text: btn.textContent?.trim().slice(0, 30),
                class: btn.className?.toString().slice(0, 80),
                visible: btn.offsetParent !== null,
                disabled: btn.disabled
            }));
        }
        return [...wrp.querySelectorAll('button, .weui-desktop-btn')].map(btn => ({
            text: btn.textContent?.trim().slice(0, 30),
            class: btn.className?.toString().slice(0, 80),
            visible: btn.offsetParent !== null,
            disabled: btn.disabled
        }));
    });
    console.log('对话框按钮:', JSON.stringify(buttons, null, 2));

    // 找生成按钮（可能是"生成"或"确定"）
    const generateBtn = buttons.find(b =>
        (b.text.includes('生成') || b.text.includes('确定') || b.text.includes('完成')) && b.visible
    );
    console.log('找到按钮:', generateBtn);

    if (generateBtn) {
        // 通过Vue方法调用，而不是DOM click
        const genResult = await page.evaluate(async () => {
            function findVue(el, depth = 0) {
                if (depth > 20) return null;
                if (el?.__vue__) return el.__vue__;
                for (const child of el?.children || []) {
                    const f = findVue(child, depth + 1);
                    if (f) return f;
                }
                return null;
            }
            const dlgEl = document.querySelector('.text_poster_dialog');
            const dvm = findVue(dlgEl);
            if (!dvm) return { ok: false, reason: 'dvm not found' };

            // 查找生成/提交方法
            const proto = Object.getPrototypeOf(dvm);
            const methods = Object.getOwnPropertyNames(proto).filter(m => {
                try { return typeof proto[m] === 'function' && m !== 'constructor'; } catch(e) { return false; }
            });

            // 找可能的提交方法
            const submitMethods = methods.filter(m =>
                m.includes('submit') || m.includes('generat') || m.includes('confirm') ||
                m.includes('ok') || m.includes('apply') || m.includes('done') || m.includes('insert')
            );

            console.log('可能的提交方法:', submitMethods);

            // 尝试调用每个方法
            for (const methodName of submitMethods) {
                try {
                    const r = await proto[methodName].call(dvm);
                    console.log(`调用${methodName}结果:`, JSON.stringify(r)?.slice(0, 200));
                    if (dvm.generating) {
                        return { ok: true, method: methodName, generating: true };
                    }
                } catch(e) {
                    console.log(`调用${methodName}异常:`, e.message?.slice(0, 100));
                }
            }

            return { ok: false, methods: submitMethods, allMethods: methods.slice(0, 30) };
        });
        console.log('生成方法调用结果:', JSON.stringify(genResult, null, 2).slice(0, 2000));

        // 等待生成完成
        if (genResult.generating || genResult.ok) {
            console.log('\n=== 等待生成完成 ===');
            for (let i = 0; i < 20; i++) {
                await page.waitForTimeout(5000);
                const genState = await page.evaluate(() => {
                    function findVue(el, depth = 0) {
                        if (depth > 20) return null;
                        if (el?.__vue__) return el.__vue__;
                        for (const child of el?.children || []) {
                            const f = findVue(child, depth + 1);
                            if (f) return f;
                        }
                        return null;
                    }
                    const dlgEl = document.querySelector('.text_poster_dialog');
                    const dvm = findVue(dlgEl);
                    return {
                        generating: dvm?.generating,
                        hasGenerated: dvm?.hasGenerated,
                        posterListLen: dvm?.posterList?.length,
                        submitting: dvm?.submitting
                    };
                });
                console.log(`  ${(i+1)*5}s: generating=${genState.generating}, hasGenerated=${genState.hasGenerated}, posters=${genState.posterListLen}`);
                if (genState.hasGenerated && !genState.generating) {
                    console.log('生成完成!');
                    await page.screenshot({ path: path.join(DBG, 'poster_generated.png'), fullPage: true });
                    break;
                }
            }
        }
    }

    await page.waitForTimeout(2000);
    await browser.close();
})();
