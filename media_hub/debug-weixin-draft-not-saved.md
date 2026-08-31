# Debug: weixin-draft-not-saved

## Status: [RESOLVED - 已端到端验证]

## Root Cause（完整根因链，三层）
1. **缺少 token 参数**（主因）：微信公众号所有 cgi-bin 页面都要求 URL 带 `token` 查询参数（登录后访问首页重定向获得）。旧代码直接访问草稿列表 URL 不带 token，被微信拒绝，页面不渲染任何编辑器元素。
2. **旧的页面流程已失效**：旧代码用的草稿列表 URL（`t=media/appmsg_list_v2&action=list&type=10&sub_type=draft`）是旧版 UI；新版流程是：新草稿箱（`type=77&action=list_card`）→ 点"新的创作"→ 点菜单"文章"→ **编辑器在新标签页(popup)打开**（`appmsg_edit_v2`）。
3. **v2 编辑器元素变化**：可见标题是第一个 `.ProseMirror` contenteditable（`#title` textarea 是隐藏的同步目标，不能直接 fill）；正文是第二个 `.ProseMirror`。
   另外旧代码用 `.catch(() => {})` 静默吞错，导致始终返回 success:true。

## Fix（已实施并验证）
publishWeixin 重写为已验证流程：
1. 访问 `https://mp.weixin.qq.com/` 首页 → 从重定向 URL 提取 `token=(\d+)`；取不到则报"登录态过期"
2. 带 token 打开新草稿箱 `appmsg?begin=0&count=10&type=77&action=list_card&token=XXX&lang=zh_CN`
3. 点击"新的创作" → 下拉菜单点击"文章"（`text="文章"` 精确匹配，避免命中"文章模板"）
4. `waitForEvent('popup')` 接住编辑器新标签页（appmsg_edit_v2）
5. 标题：第一个 `.ProseMirror` click + keyboard.type
6. 正文：第二个 `.ProseMirror` click + 剪贴板粘贴 HTML（保留格式）
7. 点击"保存为草稿"（处理可能出现的确认弹窗）
8. 回草稿箱刷新，按标题校验草稿真实存在（返回值带最终校验结果）

## 验证结果（2026-08-26）
- 测试文章"测试文章-发布流程验证2"发布成功
- step8 校验：草稿箱中找到该文章
- API 返回 `{"success":true,"message":"已成功保存到微信公众号草稿箱"}`

## Symptom
点击发布到微信公众号，后端返回"已保存到草稿箱"，但在微信公众号后台看不到草稿。

## Hypotheses（历史）
1. **H1: 所有步骤的 error 被 .catch(() => {}) 静默吞掉** — 已证实
2. **H2: 剪贴板 API 在 headless 浏览器中不可用** — 未复现（context 已授权 clipboard 权限）
3. **H3: iframe 选择器不匹配** — 部分证实（v2 编辑器在主文档，不在 iframe）
4. **H4: "写新图文"按钮选择器不匹配** — 证实（新版入口是"新的创作"→"文章"）
5. **H5: "保存为草稿"按钮选择器不匹配** — 未证实（选择器本身有效）
6. **H6: 缺少 token 参数** — 证实（主因）
7. **H7: HeadlessChrome UA 被检测** — 未证实（带 token 后 headless 可正常访问）

## Instrumentation Plan
在 publishWeixin 函数每一步添加截图 + 日志，收集运行时证据。（已完成，日志保留在 server.js 的 dbgLog/dbgShot）
