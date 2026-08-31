/**
 * Media Hub - 多平台自媒体一键发布与数据看板
 * 后端：Express + Playwright 浏览器自动化
 *
 * 平台：微信公众号 / 百家号 / 头条号
 * 功能：登录管理 / 一键发布 / 数据采集 / 素材管理 / 定时发布
 */

const express = require('express');
const { chromium } = require('playwright');
const cron = require('node-cron');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ===== 路径常量 =====
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
const ARTICLE_FILE = path.join(DATA_DIR, 'articles.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedules.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// 确保目录存在
[DATA_DIR, SESSION_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ===== 中间件 =====
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: UPLOAD_DIR });

// ===== 全局状态 =====
let browser = null;
const loginBrowsers = {}; // 平台 -> 正在登录的浏览器实例

// 平台配置
const PLATFORMS = {
    weixin: {
        name: '微信公众号',
        loginUrl: 'https://mp.weixin.qq.com/',
        editorUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=1&t=media/appmsg_list_v2&action=list&type=10&sub_type=draft',
        statsUrl: 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN',
        sessionFile: path.join(SESSION_DIR, 'weixin.json'),
        color: '#07c160',
    },
    baijia: {
        name: '百家号',
        loginUrl: 'https://baijiahao.baidu.com',
        editorUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=news',
        statsUrl: 'https://baijiahao.baidu.com/builder/app/data/statistics',
        sessionFile: path.join(SESSION_DIR, 'baijia.json'),
        color: '#2932e1',
    },
    toutiao: {
        name: '头条号',
        loginUrl: 'https://mp.toutiao.com/auth/page/login',
        editorUrl: 'https://mp.toutiao.com/profile_v4/graphic/publish',
        statsUrl: 'https://mp.toutiao.com/profile_v4/graphic/statistics',
        sessionFile: path.join(SESSION_DIR, 'toutiao.json'),
        color: '#f04142',
    },
};

// ==================== 浏览器管理 ====================

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }
    return browser;
}

async function createContext(platform) {
    const cfg = PLATFORMS[platform];
    const b = await getBrowser();
    const ctxOptions = {
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
        permissions: ['clipboard-read', 'clipboard-write'],
        // 关键：headless 模式 UA 含 "HeadlessChrome"，微信等平台会检测并拒绝会话
        // 覆盖为正常 Chrome UA
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    };
    // 加载已保存的登录态
    if (fs.existsSync(cfg.sessionFile)) {
        ctxOptions.storageState = cfg.sessionFile;
    }
    return b.newContext(ctxOptions);
}

// ==================== 登录管理 ====================

// 启动可见浏览器让用户手动登录，完成后自动保存登录态
app.post('/api/login/:platform', async (req, res) => {
    const { platform } = req.params;
    const cfg = PLATFORMS[platform];
    if (!cfg) return res.status(404).json({ error: '未知平台' });

    // 如果已有登录浏览器在运行，先关闭
    if (loginBrowsers[platform]) {
        try { await loginBrowsers[platform].close(); } catch (e) {}
    }

    try {
        // 启动有头浏览器（可见窗口）
        const loginBrowser = await chromium.launch({
            headless: false,
            args: ['--window-size=1000,720'],
        });
        loginBrowsers[platform] = loginBrowser;

        const ctx = await loginBrowser.newContext({ locale: 'zh-CN' });
        const page = await ctx.newPage();
        await page.goto(cfg.loginUrl);

        // 注入提示条
        await page.addInitScript(() => {
            window.__checkLogin = () => document.cookie.length > 0;
        });

        res.json({ message: `${cfg.name} 登录窗口已打开，请在浏览器中完成登录。登录成功后点击"保存登录态"。` });

        // 轮询检测登录成功（最多等10分钟）
        // 实际保存由 /api/login/:platform/save 触发
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 保存登录态
app.post('/api/login/:platform/save', async (req, res) => {
    const { platform } = req.params;
    const cfg = PLATFORMS[platform];
    if (!cfg) return res.status(404).json({ error: '未知平台' });

    const loginBrowser = loginBrowsers[platform];
    if (!loginBrowser) return res.status(400).json({ error: '没有正在进行的登录会话' });

    try {
        const contexts = loginBrowser.contexts();
        if (contexts.length === 0) return res.status(400).json({ error: '浏览器已关闭' });

        // 保存 storageState（cookie + localStorage）
        await contexts[0].storageState({ path: cfg.sessionFile });

        // 关闭登录浏览器
        await loginBrowser.close();
        delete loginBrowsers[platform];

        res.json({ message: `${cfg.name} 登录态已保存` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 检查登录状态
app.get('/api/status', async (req, res) => {
    const status = {};
    for (const [key, cfg] of Object.entries(PLATFORMS)) {
        status[key] = {
            name: cfg.name,
            color: cfg.color,
            loggedIn: fs.existsSync(cfg.sessionFile),
        };
    }
    res.json(status);
});

// ==================== 文章管理 ====================

function loadArticles() {
    try { return JSON.parse(fs.readFileSync(ARTICLE_FILE, 'utf8')); }
    catch (e) { return []; }
}

function saveArticles(data) {
    fs.writeFileSync(ARTICLE_FILE, JSON.stringify(data, null, 2));
}

// 文章列表
app.get('/api/articles', (req, res) => {
    res.json(loadArticles());
});

// 新建/保存草稿
app.post('/api/articles', (req, res) => {
    const articles = loadArticles();
    const article = {
        id: Date.now().toString(),
        title: req.body.title || '无标题',
        content: req.body.content || '',
        cover: req.body.cover || '',
        aiCoverPrompt: req.body.aiCoverPrompt || '',
        platforms: req.body.platforms || [],
        status: req.body.status || 'draft', // draft | scheduled | published
        createdAt: Date.now(),
        updatedAt: Date.now(),
        publishedAt: null,
        publishResults: {},
    };
    articles.unshift(article);
    saveArticles(articles);
    res.json(article);
});

// 更新文章
app.put('/api/articles/:id', (req, res) => {
    const articles = loadArticles();
    const idx = articles.findIndex(a => a.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '文章不存在' });
    Object.assign(articles[idx], req.body, { updatedAt: Date.now() });
    saveArticles(articles);
    res.json(articles[idx]);
});

// 删除文章
app.delete('/api/articles/:id', (req, res) => {
    let articles = loadArticles();
    articles = articles.filter(a => a.id !== req.params.id);
    saveArticles(articles);
    res.json({ message: '已删除' });
});

// 上传封面图
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    res.json({ url: '/uploads/' + req.file.filename, filename: req.file.filename });
});

// ==================== 发布逻辑 ====================

/**
 * 向内容可编辑区域粘贴 HTML 内容
 */
async function pasteHtml(page, selector, html) {
    await page.click(selector);
    await page.evaluate((htmlContent) => {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([item]);
    }, html);
    await page.waitForTimeout(300);
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+V');
    await page.waitForTimeout(500);
}

// #region debug-point weixin-publish
const DBG_DIR = path.join(DATA_DIR, 'debug');
if (!fs.existsSync(DBG_DIR)) fs.mkdirSync(DBG_DIR, { recursive: true });

async function dbgShot(page, step) {
    const ts = Date.now();
    const file = path.join(DBG_DIR, `weixin_${step}_${ts}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    console.log(`[DBG-WEIXIN] screenshot: ${step} → ${file}`);
}

function dbgLog(step, msg) {
    console.log(`[DBG-WEIXIN] ${step}: ${msg}`);
}
// #endregion debug-point weixin-publish

// 微信公众号发布（贴图模式，createType=8）
async function publishWeixin(article) {
    const ctx = await createContext('weixin');
    const page = await ctx.newPage();
    // 贴图发布流程：首页取 token → 直接打开贴图编辑器(createType=8) → 填标题/正文 → AI配图插入正文 → 保存为草稿
    try {
        // 1. 访问首页获取 token
        dbgLog('step1-token', '访问 mp.weixin.qq.com 首页获取 token');
        await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        const token = (page.url().match(/token=(\d+)/) || [])[1];
        if (!token) {
            dbgLog('step1-ERROR', '未获取到 token，登录态已过期');
            await dbgShot(page, 'step1-no-token');
            await ctx.close();
            return { success: false, error: '微信公众号登录态已过期，请重新登录' };
        }
        dbgLog('step1-token', `token = ${token}`);

        // 2. 直接打开贴图编辑器（createType=8），无需经过"新的创作"下拉菜单
        dbgLog('step2-editor', '打开贴图编辑器(createType=8)');
        const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&createType=8&token=${token}&lang=zh_CN`;
        await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(6000);

        // 登录态二次校验
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '').catch(() => '');
        if (page.url().includes('login') || bodyText.includes('请重新登录') || bodyText.includes('扫码登录')) {
            dbgLog('step2-ERROR', '页面是登录页，登录态已过期');
            await dbgShot(page, 'step2-login-redirect');
            await ctx.close();
            return { success: false, error: '微信公众号登录态已过期，请重新登录' };
        }

        // 移除残留对话框（编辑器加载时可能残留对话框）
        const initRemoved = await page.evaluate(() => {
            const wrps = document.querySelectorAll('.weui-desktop-dialog__wrp');
            wrps.forEach(w => w.remove());
            return wrps.length;
        });
        if (initRemoved > 0) dbgLog('step2-clean', `已移除 ${initRemoved} 个残留对话框`);

        dbgLog('step2-editor', `贴图编辑器已加载: ${page.url().slice(0, 100)}`);
        await dbgShot(page, 'step2-editor');

        // 3. 填标题（贴图编辑器：第一个 ProseMirror 是标题）
        dbgLog('step3-title', `填入标题: "${article.title}"`);
        const titleEditor = page.locator('.ProseMirror').first();
        await titleEditor.waitFor({ state: 'visible', timeout: 15000 });
        await titleEditor.click();
        await page.keyboard.type(article.title);
        dbgLog('step3-title', '标题填入成功');

        // 4. 填正文/描述（贴图模式正文必填，否则保存报"文字消息正文不能为空"）
        //    第二个 ProseMirror 是正文区域（share-text__input），使用剪贴板粘贴 HTML 保留格式
        dbgLog('step4-content', '填入正文描述');
        const bodyEditor = page.locator('.ProseMirror').nth(1);
        await bodyEditor.waitFor({ state: 'visible', timeout: 15000 });
        await bodyEditor.click();
        await page.waitForTimeout(300);
        // 准备 HTML 内容：提取 body 内容，去掉 style/script 等无关标签
        let contentHtml = article.content || '';
        if (!contentHtml.trim()) {
            contentHtml = `<p>${article.title}</p>`;
        } else {
            // 如果是完整 HTML 文档，提取 body 内的内容
            if (/<\/?html/i.test(contentHtml) || /<!DOCTYPE/i.test(contentHtml)) {
                const bodyMatch = contentHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch) {
                    contentHtml = bodyMatch[1];
                }
            }
            // 去掉 <style> 和 <script> 块
            contentHtml = contentHtml.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
            // 去掉 <!DOCTYPE>, <html>, <head>, <meta>, <link>, <title> 等文档级标签
            contentHtml = contentHtml.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '').replace(/<meta[^>]*>/gi, '').replace(/<link[^>]*>/gi, '').replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '');
            // 如果提取后为空，用标题兜底
            if (!contentHtml.trim()) contentHtml = `<p>${article.title}</p>`;
            // 如果是纯文本（无 HTML 标签），按换行分段
            if (!/<[a-z][^>]*>/i.test(contentHtml)) {
                contentHtml = contentHtml.split(/\n/).map(l => l.trim()).filter(l => l).map(l => `<p>${l}</p>`).join('');
            }
        }
        // 通过剪贴板粘贴 HTML（ProseMirror 支持富文本粘贴）
        const pasteOk = await page.evaluate(async (html) => {
            const editor = document.querySelectorAll('.ProseMirror')[1];
            if (!editor) return false;
            editor.focus();

            // 方式1: 尝试 Clipboard API 写入，然后由外层键盘粘贴
            try {
                const blob = new Blob([html], { type: 'text/html' });
                const item = new ClipboardItem({ 'text/html': blob });
                await navigator.clipboard.write([item]);
            } catch(e) {
                // headless 模式可能无权限，忽略
            }

            // 方式2: 直接派发 paste 事件（不依赖系统剪贴板）
            try {
                const dt = new DataTransfer();
                dt.setData('text/html', html);
                dt.setData('text/plain', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
                const pasteEvent = new ClipboardEvent('paste', {
                    clipboardData: dt,
                    bubbles: true,
                    cancelable: true
                });
                editor.dispatchEvent(pasteEvent);
            } catch(e) {}

            return true;
        }, contentHtml);
        await page.waitForTimeout(300);
        // 尝试用键盘粘贴（配合上面的剪贴板写入）
        await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+V').catch(() => {});
        await page.waitForTimeout(1000);
        // 验证正文是否已填入：检查编辑器是否有文本内容
        const bodyCheck = await page.evaluate(() => {
            const editor = document.querySelectorAll('.ProseMirror')[1];
            return editor ? (editor.textContent?.trim().length > 0) : false;
        });
        if (!bodyCheck) {
            // 兜底：如果粘贴失败，用 keyboard.type 输入纯文本
            dbgLog('step4-content', '粘贴失败，回退到 keyboard.type 纯文本输入');
            const plainText = contentHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
            await page.keyboard.type(plainText || article.title);
            await page.waitForTimeout(500);
        }
        dbgLog('step4-content', `正文描述填入成功: "${contentHtml.replace(/<[^>]+>/g,'').trim().slice(0, 30)}..."`);
        await dbgShot(page, 'step4-content-filled');

        // 5. 文字海报：将标题转换为海报图片（随机选择模板效果）
        dbgLog('step5-poster', `生成文字海报，标题: "${article.title}"`);
        let posterInserted = false;
        try {
            const posterResult = await page.evaluate(async (title) => {
                async function posterApi(action, data) {
                    const token = new URLSearchParams(location.search).get('token') || '';
                    const resp = await fetch(`/cgi-bin/webtextposter?action=${action}&token=${token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: 'data=' + encodeURIComponent(JSON.stringify(data))
                    });
                    return resp.json();
                }

                const init = await posterApi('create', { prompt: "", action_mode: 0 });
                if (init.base_resp?.ret !== 0) return { ok: false, error: 'init failed: ' + (init.base_resp?.err_msg || 'unknown') };

                const specList = (init.template_config || []).map(t => {
                    const styles = t.support_style || [];
                    return { template_id: t.template_id, style: styles.length ? styles[Math.floor(Math.random() * styles.length)] : '' };
                });

                const gen = await posterApi('create', {
                    prompt: title, action_mode: 1,
                    session_id: init.session_id, data_buf: "", spec_list: specList
                });
                if (gen.base_resp?.ret !== 0 || !gen.poster_list?.length) {
                    return { ok: false, error: 'generate failed: ' + (gen.base_resp?.err_msg || 'no posters') };
                }

                const idx = Math.floor(Math.random() * gen.poster_list.length);
                const selected = gen.poster_list[idx];

                const ins = await posterApi('insert', {
                    session_id: gen.session_id || init.session_id,
                    template_id: selected.template_id, style: selected.style,
                    cos_url: selected.cos_url || "", data_buf: gen.data_buf || "",
                    prompt: title
                });

                return {
                    ok: ins.base_resp?.ret === 0,
                    file_id: ins.file_id,
                    cdn_url: ins.cdn_url,
                    selectedIdx: idx,
                    totalPosters: gen.poster_list.length
                };
            }, article.title);

            if (posterResult.ok) {
                dbgLog('step5-poster', `✓ 海报生成成功（共${posterResult.totalPosters}个，选第${posterResult.selectedIdx}个），file_id=${posterResult.file_id}`);

                await page.waitForTimeout(500);
                const insertOk = await page.evaluate(async ({ file_id, cdn_url }) => {
                    const vm = document.querySelector('.image-selector')?.__vue__;
                    if (!vm) return { ok: false, error: 'image-selector vm not found' };

                    const imageItem = { file_id, url: cdn_url, cdn_url, name: 'text_poster.jpg', size: 0 };
                    await vm.formatList([imageItem]);
                    await vm.$nextTick();
                    await new Promise(r => setTimeout(r, 800));

                    const newItem = vm.innerList[vm.innerList.length - 1];
                    if (newItem) {
                        vm.$set(newItem, '_isTextPoster', true);
                        vm.selected = newItem.seq;
                        vm.onChange();
                        if (vm.updateRecommendTopic) vm.updateRecommendTopic();
                        return { ok: true, innerListLen: vm.innerList.length, selected: vm.selected };
                    }
                    return { ok: false, error: 'new item not found after formatList' };
                }, { file_id: posterResult.file_id, cdn_url: posterResult.cdn_url });

                if (insertOk.ok) {
                    posterInserted = true;
                    dbgLog('step5-poster', `✓ 海报已插入图片选择器（innerList=${insertOk.innerListLen}, selected=${insertOk.selected}）`);
                } else {
                    dbgLog('step5-poster', `海报插入选择器失败: ${insertOk.error}`);
                }
            } else {
                dbgLog('step5-poster', `海报生成失败: ${posterResult.error}`);
            }
        } catch (e) {
            dbgLog('step5-poster', `文字海报异常（不影响保存）: ${e.message}`);
            await page.evaluate(() => document.querySelectorAll('.weui-desktop-dialog__wrp').forEach(w => w.remove())).catch(() => { });
        }
        await dbgShot(page, 'step5-poster-done');

        // 6. 点击"保存为草稿"
        dbgLog('step6-save', '点击"保存为草稿"');
        await page.locator('text=保存为草稿').first().click({ timeout: 10000 });
        await page.waitForTimeout(3000);
        // 可能出现的确认弹窗
        await page.locator('button:has-text("确定"), button:has-text("确认"), button:has-text("知道了")').first().click({ timeout: 3000 }).catch(() => { });
        await page.waitForTimeout(3000);
        await dbgShot(page, 'step6-after-save');

        // 7. 校验保存结果
        const saveResult = await page.evaluate(() => {
            const text = document.body.textContent || '';
            return {
                hasSuccess: text.includes('已保存') || text.includes('保存成功'),
                url: location.href.slice(0, 100),
            };
        });
        dbgLog('step7-verify', `保存结果: ${JSON.stringify(saveResult)}`);

        // 回到草稿箱验证
        await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=${token}&lang=zh_CN`, { waitUntil: 'networkidle' }).catch(() => { });
        await page.waitForTimeout(4000);
        const listText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
        const found = listText.includes(article.title);
        dbgLog('step7-verify', found ? `✓ 草稿箱中找到"${article.title}"` : `✗ 草稿箱中未找到"${article.title}"`);
        await dbgShot(page, 'step7-verify');

        await ctx.close();
        return {
            success: found || saveResult.hasSuccess,
            message: (found || saveResult.hasSuccess) ? '已成功保存到微信公众号草稿箱（贴图）' : '已点击保存，请手动检查草稿箱',
            debug: { screenshots: fs.readdirSync(DBG_DIR).filter(f => f.startsWith('weixin_')).map(f => '/data/debug/' + f) },
        };
    } catch (e) {
        dbgLog('ERROR', e.message);
        await dbgShot(page, 'error').catch(() => { });
        await ctx.close();
        return { success: false, error: `微信公众号发布失败: ${e.message}` };
    }
}

// 百家号发布
async function publishBaijia(article) {
    const ctx = await createContext('baijia');
    const page = await ctx.newPage();

    // 1. 进入发布页
    await page.goto('https://baijiahao.baidu.com/builder/rc/edit?type=news');
    await page.waitForTimeout(3000);

    // 登录态检测
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '').catch(() => '');
    if (page.url().includes('login') || bodyText.includes('登录') && !bodyText.includes('正文')) {
        await ctx.close();
        return { success: false, error: '百家号登录态已过期，请重新登录' };
    }

    // 2. 填标题
    const titleInput = page.locator('input[placeholder*="标题"], .title-input input, #title').first();
    await titleInput.fill(article.title).catch(async () => {
        await titleInput.click();
        await page.keyboard.type(article.title);
    });

    // 3. 填正文
    const editor = page.locator('.ql-editor, [contenteditable="true"], .editor-content').first();
    await editor.click();
    await page.evaluate((html) => {
        const blob = new Blob([html], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([item]);
    }, article.content || article.title);
    await page.waitForTimeout(300);
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+V');
    await page.waitForTimeout(1000);

    // 4. 发布
    const pubBtn = page.locator('button:has-text("发布"), button:has-text("提交")').first();
    const pubCount = await pubBtn.count();
    if (pubCount === 0) {
        await page.screenshot({ path: path.join(DATA_DIR, 'debug', `baijia_no_btn_${Date.now()}.png`), fullPage: true });
        await ctx.close();
        return { success: false, error: '未找到百家号发布按钮，可能页面结构已变更' };
    }
    await pubBtn.click({ timeout: 5000 });
    await page.waitForTimeout(3000);

    // 检查是否有确认弹窗
    await page.locator('button:has-text("确认"), button:has-text("确定")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);

    await ctx.close();
    return { success: true, message: '已提交到百家号' };
}

// 头条号发布
async function publishToutiao(article) {
    const ctx = await createContext('toutiao');
    const page = await ctx.newPage();

    // 1. 进入发布页
    await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish');
    await page.waitForTimeout(3000);

    // 登录态检测
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '').catch(() => '');
    if (page.url().includes('login') || page.url().includes('sso/login') || bodyText.includes('扫码登录') && !bodyText.includes('正文')) {
        await ctx.close();
        return { success: false, error: '头条号登录态已过期，请重新登录' };
    }

    // 2. 填标题
    const titleInput = page.locator('input[placeholder*="标题"], .article-title input, [data-testid="title"]').first();
    const titleCount = await titleInput.count();
    if (titleCount === 0) {
        await page.screenshot({ path: path.join(DATA_DIR, 'debug', `toutiao_no_title_${Date.now()}.png`), fullPage: true });
        await ctx.close();
        return { success: false, error: '未找到头条号标题输入框，可能页面结构已变更' };
    }
    await titleInput.fill(article.title).catch(async () => {
        await titleInput.click();
        await page.keyboard.type(article.title);
    });

    // 3. 填正文
    const editor = page.locator('.ProseMirror, [contenteditable="true"], .ql-editor').first();
    await editor.click();
    await page.evaluate((html) => {
        const blob = new Blob([html], { type: 'text/html' });
        const item = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([item]);
    }, article.content || article.title);
    await page.waitForTimeout(300);
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+V');
    await page.waitForTimeout(1000);

    // 4. 发布
    const pubBtn = page.locator('button:has-text("发布"), button:has-text("发表")').first();
    const pubCount = await pubBtn.count();
    if (pubCount === 0) {
        await page.screenshot({ path: path.join(DATA_DIR, 'debug', `toutiao_no_btn_${Date.now()}.png`), fullPage: true });
        await ctx.close();
        return { success: false, error: '未找到头条号发布按钮，可能页面结构已变更' };
    }
    await pubBtn.click({ timeout: 5000 });
    await page.waitForTimeout(3000);

    await ctx.close();
    return { success: true, message: '已发布到头条号' };
}

const PUBLISHERS = { weixin: publishWeixin, baijia: publishBaijia, toutiao: publishToutiao };

// 发布接口
app.post('/api/publish', async (req, res) => {
    const { articleId, platforms } = req.body;
    const articles = loadArticles();
    const article = articles.find(a => a.id === articleId);
    if (!article) return res.status(404).json({ error: '文章不存在' });

    const results = {};
    for (const platform of platforms) {
        const cfg = PLATFORMS[platform];
        if (!cfg) { results[platform] = { success: false, error: '未知平台' }; continue; }
        if (!fs.existsSync(cfg.sessionFile)) {
            results[platform] = { success: false, error: `${cfg.name} 未登录，请先登录` };
            continue;
        }
        try {
            const result = await PUBLISHERS[platform](article);
            results[platform] = result;
        } catch (err) {
            results[platform] = { success: false, error: err.message };
        }
    }

    // 更新文章状态
    article.publishResults = results;
    article.status = 'published';
    article.publishedAt = Date.now();
    saveArticles(articles);

    res.json({ results, article });
});

// ==================== 数据采集 ====================

// 微信公众号数据
async function fetchWeixinStats() {
    const ctx = await createContext('weixin');
    const page = await ctx.newPage();
    await page.goto('https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN');
    await page.waitForTimeout(4000);

    // 从页面提取数据（微信公众号首页有概览数据）
    const stats = await page.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '0';
        return {
            platform: '微信公众号',
            // 首页概览数字（选择器可能随版本变化）
            followers: getText('.weui-desktop-data__value, .data-item .num'),
            reads: getText('.weui-desktop-data__desc + .weui-desktop-data__value'),
            // 以下为占位，实际需进入图文分析页
            articles: '0',
            likes: '0',
        };
    }).catch(() => ({ platform: '微信公众号', error: '数据获取失败，可能登录态过期' }));

    await ctx.close();
    return stats;
}

// 百家号数据
async function fetchBaijiaStats() {
    const ctx = await createContext('baijia');
    const page = await ctx.newPage();
    await page.goto('https://baijiahao.baidu.com/builder/app/data/statistics');
    await page.waitForTimeout(4000);

    const stats = await page.evaluate(() => {
        const getText = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : '0';
        };
        return {
            platform: '百家号',
            followers: getText('.fans-count, .stat-num'),
            reads: getText('.read-count, .stat-num:nth-child(2)'),
            articles: getText('.article-count'),
            likes: getText('.like-count'),
        };
    }).catch(() => ({ platform: '百家号', error: '数据获取失败' }));

    await ctx.close();
    return stats;
}

// 头条号数据
async function fetchToutiaoStats() {
    const ctx = await createContext('toutiao');
    const page = await ctx.newPage();
    await page.goto('https://mp.toutiao.com/profile_v4/graphic/statistics');
    await page.waitForTimeout(4000);

    const stats = await page.evaluate(() => {
        const getText = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : '0';
        };
        return {
            platform: '头条号',
            followers: getText('.followers-count, .stat-value'),
            reads: getText('.read-count, .stat-value'),
            articles: getText('.article-count'),
            likes: getText('.like-count'),
        };
    }).catch(() => ({ platform: '头条号', error: '数据获取失败' }));

    await ctx.close();
    return stats;
}

const STATS_FETCHERS = { weixin: fetchWeixinStats, baijia: fetchBaijiaStats, toutiao: fetchToutiaoStats };

// 数据看板接口
app.get('/api/stats', async (req, res) => {
    const { platforms } = req.query;
    const targetPlatforms = platforms ? platforms.split(',') : Object.keys(PLATFORMS);

    const results = {};
    for (const platform of targetPlatforms) {
        const cfg = PLATFORMS[platform];
        if (!cfg) continue;
        if (!fs.existsSync(cfg.sessionFile)) {
            results[platform] = { platform: cfg.name, error: '未登录' };
            continue;
        }
        try {
            results[platform] = await STATS_FETCHERS[platform]();
        } catch (err) {
            results[platform] = { platform: cfg.name, error: err.message };
        }
    }
    res.json(results);
});

// ==================== 定时发布 ====================

function loadSchedules() {
    try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); }
    catch (e) { return []; }
}

function saveSchedules(data) {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2));
}

const scheduledJobs = {};

// 初始化定时任务
function initSchedules() {
    const schedules = loadSchedules();
    schedules.forEach(s => {
        if (!s.executed && s.cron && s.articleId) {
            scheduleJob(s);
        }
    });
}

function scheduleJob(s) {
    if (scheduledJobs[s.id]) scheduledJobs[s.id].stop();
    scheduledJobs[s.id] = cron.schedule(s.cron, async () => {
        console.log(`[定时发布] 执行任务: ${s.id}`);
        const articles = loadArticles();
        const article = articles.find(a => a.id === s.articleId);
        if (!article) return;

        const results = {};
        for (const platform of s.platforms) {
            try {
                results[platform] = await PUBLISHERS[platform](article);
            } catch (err) {
                results[platform] = { success: false, error: err.message };
            }
        }

        article.publishResults = results;
        article.status = 'published';
        article.publishedAt = Date.now();
        saveArticles(articles);

        // 标记已执行
        const schedules = loadSchedules();
        const sched = schedules.find(x => x.id === s.id);
        if (sched) { sched.executed = true; saveSchedules(schedules); }
        if (scheduledJobs[s.id]) { scheduledJobs[s.id].stop(); delete scheduledJobs[s.id]; }
    });
}

// 创建定时任务
app.post('/api/schedules', (req, res) => {
    const { articleId, platforms, cron: cronExpr, runAt } = req.body;
    const schedules = loadSchedules();

    const sched = {
        id: Date.now().toString(),
        articleId,
        platforms,
        cron: cronExpr || null,        // cron 表达式（如 "0 10 * * 1" 每周一10点）
        runAt: runAt || null,           // 或指定时间（ISO 字符串）
        executed: false,
        createdAt: Date.now(),
    };

    // 如果指定了时间，生成 cron 表达式
    if (runAt && !cronExpr) {
        const d = new Date(runAt);
        sched.cron = `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
    }

    if (sched.cron) {
        scheduleJob(sched);
    }

    schedules.push(sched);
    saveSchedules(schedules);
    res.json(sched);
});

// 定时任务列表
app.get('/api/schedules', (req, res) => {
    res.json(loadSchedules());
});

// 删除定时任务
app.delete('/api/schedules/:id', (req, res) => {
    let schedules = loadSchedules();
    if (scheduledJobs[req.params.id]) { scheduledJobs[req.params.id].stop(); delete scheduledJobs[req.params.id]; }
    schedules = schedules.filter(s => s.id !== req.params.id);
    saveSchedules(schedules);
    res.json({ message: '已删除' });
});

// 调试截图访问
app.use('/data/debug', express.static(path.join(DATA_DIR, 'debug')));

// 调试：获取微信页面实际HTML结构
app.get('/api/debug/weixin/inspect', async (req, res) => {
    const ctx = await createContext('weixin');
    const page = await ctx.newPage();
    try {
        // 先看草稿列表页
        await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=1&t=media/appmsg_list_v2&action=list&type=10&sub_type=draft');
        await page.waitForTimeout(4000);
        const listUrl = page.url();
        const listTitle = await page.title();
        const listHtml = await page.evaluate(() => {
            // 提取所有按钮和链接的文字
            const btns = [...document.querySelectorAll('a, button, .weui-desktop-btn, [role="button"]')].map(el => ({
                tag: el.tagName, text: el.textContent?.trim().slice(0, 30), class: el.className?.slice(0, 60), id: el.id
            })).filter(b => b.text);
            return { btnCount: btns.length, buttons: btns.slice(0, 30) };
        });

        // 尝试点击新建图文
        await page.locator('a:has-text("图文"), a:has-text("新建"), .new-creation, .js_create_new').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // 尝试直接进入编辑器
        await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&lang=zh_CN');
        await page.waitForTimeout(4000);
        const editUrl = page.url();
        const editTitle = await page.title();

        // 提取编辑器页面的关键元素
        const editInfo = await page.evaluate(() => {
            const inputs = [...document.querySelectorAll('input, textarea, [contenteditable]')].map(el => ({
                tag: el.tagName, type: el.type, id: el.id, class: el.className?.slice(0, 80),
                placeholder: el.placeholder, contentEditable: el.contentEditable, name: el.name
            }));
            const iframes = [...document.querySelectorAll('iframe')].map(el => ({
                id: el.id, class: el.className?.slice(0, 80), src: el.src?.slice(0, 120)
            }));
            const btns = [...document.querySelectorAll('a, button, [role="button"]')].map(el => ({
                tag: el.tagName, text: el.textContent?.trim().slice(0, 30), class: el.className?.slice(0, 60), id: el.id
            })).filter(b => b.text);
            return { inputs: inputs.slice(0, 20), iframes, buttons: btns.slice(0, 20), bodyText: document.body?.innerText?.slice(0, 500) };
        });

        await page.screenshot({ path: path.join(DATA_DIR, 'debug', 'weixin_inspect_edit.png'), fullPage: true });

        await ctx.close();
        res.json({ list: { url: listUrl, title: listTitle, ...listHtml }, edit: { url: editUrl, title: editTitle, ...editInfo } });
    } catch (err) {
        await page.screenshot({ path: path.join(DATA_DIR, 'debug', 'weixin_inspect_error.png'), fullPage: true }).catch(() => {});
        await ctx.close();
        res.status(500).json({ error: err.message });
    }
});

// 调试日志查看
app.get('/api/debug/weixin', (req, res) => {
    const dir = path.join(DATA_DIR, 'debug');
    if (!fs.existsSync(dir)) return res.json({ screenshots: [] });
    const files = fs.readdirSync(dir).filter(f => f.startsWith('weixin_')).sort().reverse();
    res.json({ screenshots: files.map(f => ({ name: f, url: '/data/debug/' + f })) });
});

// ==================== 启动 ====================

app.listen(PORT, async () => {
    console.log(`\n  Media Hub 运行中: http://localhost:${PORT}\n`);
    console.log('  平台支持: 微信公众号 / 百家号 / 头条号');
    console.log('  首次使用请先在各平台登录并保存登录态\n');
    initSchedules();
});

// 优雅退出
process.on('SIGINT', async () => {
    if (browser) await browser.close();
    process.exit(0);
});
