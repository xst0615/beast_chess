// 测试完整HTML文档作为正文
const TITLE = '水象的小时候：眼泪是世界的雨季';
const CONTENT = `<!DOCTYPE html> 
<html lang="zh-CN"> 
<head> 
    <meta charset="UTF-8"> 
    <title>水象的小时候：眼泪是世界的雨季</title> 
    <style> 
        body { font-family: sans-serif; line-height: 1.8; color: #333; }
        h1 { font-size: 24px; color: #1a1a1a; border-bottom: 2px solid #eaeaea; }
        p { margin-bottom: 16px; text-align: justify; }
        ul { background-color: #f4f8fb; padding: 20px; border-left: 4px solid #4a90e2; }
        li { margin-bottom: 12px; }
        strong { color: #2c3e50; }
    </style> 
</head> 
<body> 
<div class="article-container"> 
    <h1>《水象的小时候：眼泪是世界的雨季》</h1> 
    <p>如果要给水象星座（巨蟹、天蝎、双鱼）的童年画一张像，"小哭包"这三个字绝对逃不掉。</p> 
    <p>那时候的他们，眼泪简直就像是开在眼睛里的水龙头，拧都拧不紧。</p> 
    <p>但很少有人明白，<strong>水象小时候的眼泪，从来不是为了索取什么，而是他们感知世界的方式太直接了。</strong></p> 
    <ul> 
        <li><strong>小双鱼的眼泪</strong>是给别人的。</li> 
        <li><strong>小巨蟹的眼泪</strong>是给安全感的。</li> 
        <li><strong>小天蝎的眼泪</strong>则是带着屈辱和倔强的。</li> 
    </ul> 
    <p>眼泪，是小水象人面对这个庞大、嘈杂且有些冷酷的世界时，唯一掌握的语言。</p> 
</div> 
</body> 
</html>`;

(async () => {
    const createResp = await fetch('http://localhost:3000/api/articles', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ title: TITLE, content: CONTENT, platforms: ['weixin'], status: 'draft' })
    });
    const article = await createResp.json();
    console.log('文章ID:', article.id, '标题:', article.title);

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
