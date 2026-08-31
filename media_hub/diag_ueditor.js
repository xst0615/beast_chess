// 探测 UEditor 正文编辑器，并测试输入方式
const { chromium } = require('playwright');
const path = require('path');

const SESSION = path.join(__dirname, 'data', 'sessions', 'weixin.json');

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

    // 填标题
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('探测正文');
    await page.waitForTimeout(500);

    // 1. 探测 UEditor 内部结构
    console.log('=== UEditor 内部结构 ===');
    const ueditor = await page.evaluate(() => {
        const edui1 = document.querySelector('#edui1');
        if (!edui1) return { found: false };
        // UEditor 通常有 edui1_body -> edui1_editor_contents
        const body = edui1.querySelector('.edui-editor-body, [class*="editor-body"]');
        const contents = edui1.querySelector('[class*="editor-contents"], [class*="content"]');
        const iframe = edui1.querySelector('iframe');
        const editable = edui1.querySelector('[contenteditable="true"]');
        const textarea = edui1.querySelector('textarea');
        // 列出所有可能的编辑区域
        const allDivs = [...edui1.querySelectorAll('div')].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 100 && r.height > 50;
        }).map(el => ({
            class: el.className?.toString().slice(0, 70),
            id: el.id,
            contentEditable: el.contentEditable,
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
            text: el.textContent?.trim().slice(0, 40),
        }));
        return {
            found: true,
            hasBody: !!body,
            hasContents: !!contents,
            hasIframe: !!iframe,
            iframeSrc: iframe?.src?.slice(0, 80),
            iframeW: iframe ? Math.round(iframe.getBoundingClientRect().width) : 0,
            iframeH: iframe ? Math.round(iframe.getBoundingClientRect().height) : 0,
            hasEditable: !!editable,
            editableTag: editable?.tagName,
            editableClass: editable?.className?.toString().slice(0, 60),
            hasTextarea: !!textarea,
            textareaId: textarea?.id,
            allDivs: allDivs.slice(0, 10),
        };
    });
    console.log(JSON.stringify(ueditor, null, 2));

    // 2. 找 edui1_body 内的具体元素
    console.log('\n=== edui1_body 内容 ===');
    const bodyInfo = await page.evaluate(() => {
        const body = document.querySelector('.edui-editor-body, [class*="edui"][class*="body"]');
        if (!body) return { found: false };
        const r = body.getBoundingClientRect();
        return {
            found: true,
            class: body.className?.toString().slice(0, 80),
            w: Math.round(r.width),
            h: Math.round(r.height),
            children: [...body.children].map(c => ({
                tag: c.tagName,
                class: c.className?.toString().slice(0, 60),
                id: c.id,
                contentEditable: c.contentEditable,
                w: Math.round(c.getBoundingClientRect().width),
                h: Math.round(c.getBoundingClientRect().height),
            })),
        };
    });
    console.log(JSON.stringify(bodyInfo, null, 2));

    // 3. 找 edui1_content / js_content
    console.log('\n=== 正文容器 ===');
    const contentArea = await page.evaluate(() => {
        // 可能的正文容器
        const selectors = ['#js_content', '.edui-default', '[class*="edui-content"]', '[class*="editor-content"]', '.edui1_content', 'iframe[src*="edui"]'];
        const results = [];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                const r = el.getBoundingClientRect();
                results.push({
                    sel,
                    tag: el.tagName,
                    id: el.id,
                    class: el.className?.toString().slice(0, 60),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    contentEditable: el.contentEditable,
                    src: el.src?.slice(0, 80),
                });
            });
        });
        return results;
    });
    console.log(JSON.stringify(contentArea, null, 2));

    // 4. 尝试点击 UEditor 正文区域并输入
    console.log('\n=== 尝试在 UEditor 输入 ===');
    // 方法1：点击 edui1 区域然后打字
    const eduiBody = page.locator('[class*="edui-editor-body"], #edui1_body').first();
    const eduiCount = await eduiBody.count();
    console.log('edui-body 元素数:', eduiCount);

    if (eduiCount > 0) {
        await eduiBody.click({ timeout: 5000 }).catch(e => console.log('点击 edui-body 失败:', e.message.split('\n')[0]));
        await page.waitForTimeout(500);
        await page.keyboard.type('这是正文内容');
        await page.waitForTimeout(1000);

        // 检查是否输入成功
        const result = await page.evaluate(() => {
            const body = document.querySelector('[class*="edui-editor-body"], #edui1_body');
            return {
                text: body?.textContent?.slice(0, 50),
                html: body?.innerHTML?.slice(0, 200),
            };
        });
        console.log('输入结果:', JSON.stringify(result, null, 2));
    }

    // 5. 尝试直接通过 setContent 设置
    console.log('\n=== 尝试 UEditor API ===');
    const apiResult = await page.evaluate(() => {
        // UEditor 的 JS API
        if (typeof UE !== 'undefined') {
            const editors = UE.getEditors ? Object.keys(UE.getEditors()) : [];
            return { hasUE: true, editors };
        }
        return { hasUE: false };
    });
    console.log('UEditor API:', JSON.stringify(apiResult));

    // 如果有 UEditor 实例，尝试 setContent
    if (apiResult.hasUE && apiResult.editors?.length > 0) {
        const editorName = apiResult.editors[0];
        const setContentResult = await page.evaluate((name) => {
            try {
                const editor = UE.getEditor(name);
                editor.setContent('<p>这是通过API设置的正文内容</p>');
                return { ok: true, content: editor.getContent()?.slice(0, 100) };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }, editorName);
        console.log('setContent 结果:', JSON.stringify(setContentResult));
    }

    // 6. 检查是否有 iframe 正文（UEditor 可能用 iframe）
    console.log('\n=== 检查 iframe 正文 ===');
    const frames = page.frames();
    console.log('所有 frames:', frames.map(f => f.url().slice(0, 80)));

    // 检查 edui iframe
    for (const frame of frames) {
        if (frame.url().includes('edui') || frame.url().includes('content') || frame.url().includes('blank')) {
            console.log('找到可能的正文 iframe:', frame.url().slice(0, 100));
            try {
                const frameBody = await frame.evaluate(() => document.body?.innerHTML?.slice(0, 100));
                console.log('iframe body:', frameBody);
            } catch (e) {
                console.log('无法访问 iframe:', e.message.split('\n')[0]);
            }
        }
    }

    // 7. 直接在页面上查找所有 iframe 并检查
    const allIframes = await page.evaluate(() => {
        return [...document.querySelectorAll('iframe')].map(el => {
            const r = el.getBoundingClientRect();
            return {
                id: el.id,
                class: el.className?.toString().slice(0, 40),
                src: el.src?.slice(0, 100),
                w: Math.round(r.width),
                h: Math.round(r.height),
            };
        });
    });
    console.log('\n所有 iframe:', JSON.stringify(allIframes, null, 2));

    await browser.close();
    console.log('\n=== 探测完成 ===');
})();
