// 测试多行格式正文
const TITLE = '格式正文测试-' + Date.now();
const CONTENT = '这是第一行正文\n这是第二行正文\n这是第三行正文';

(async () => {
    // 创建文章
    const createResp = await fetch('http://localhost:3000/api/articles', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ title: TITLE, content: CONTENT, platforms: ['weixin'], status: 'draft' })
    });
    const article = await createResp.json();
    console.log('文章ID:', article.id, '标题:', article.title);
    console.log('正文:', JSON.stringify(CONTENT));

    // 发布
    console.log('\n=== 保存到微信草稿箱 ===');
    const pubResp = await fetch('http://localhost:3000/api/publish', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ articleId: article.id, platforms: ['weixin'] })
    });
    const result = await pubResp.json();
    console.log('结果:', result.results?.weixin?.success ? '✅ 成功' : '❌ 失败');
    if (result.results?.weixin?.error) console.log('错误:', result.results.weixin.error);
})();
