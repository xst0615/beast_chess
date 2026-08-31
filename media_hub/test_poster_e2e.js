// 端到端测试：创建文章→存草稿→验证文字海报
const TITLE = '文字海报端到端测试-' + Date.now();

(async () => {
    // 1. 创建文章
    console.log('=== 1. 创建文章 ===');
    const createResp = await fetch('http://localhost:3000/api/articles', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            title: TITLE,
            content: '<p>文字海报功能测试正文</p>',
            platforms: ['weixin'],
            status: 'draft'
        })
    });
    const article = await createResp.json();
    console.log('文章ID:', article.id);

    // 2. 调用发布接口保存草稿
    console.log('\n=== 2. 保存到微信草稿箱 ===');
    const pubResp = await fetch('http://localhost:3000/api/publish', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ articleId: article.id, platforms: ['weixin'] })
    });
    const result = await pubResp.json();
    console.log('发布结果:', JSON.stringify(result, null, 2));

    if (result.results?.weixin?.success) {
        console.log('\n✅ 测试通过！文字海报草稿保存成功');
    } else {
        console.log('\n❌ 测试失败:', result.results?.weixin?.error || result.error);
    }
})();
