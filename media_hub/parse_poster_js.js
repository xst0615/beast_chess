const fs = require('fs');
const path = require('path');

const jsFile = path.join(__dirname, 'data', 'debug', 'poster_js_1.js');
let text = fs.readFileSync(jsFile, 'utf-8');

const dialogIdx = text.indexOf('name:"text-poster-dialog"');
const chunk = text.slice(dialogIdx, dialogIdx + 25000);

// 找methods块（从"methods:{"开始，到匹配的"}"结束）
const methodsIdx = chunk.indexOf('methods:{');
console.log('methods idx:', methodsIdx);

let braceCount = 0;
let start = methodsIdx + 'methods:{'.length - 1; // include the {
let end = start;
for (let i = start; i < chunk.length; i++) {
    if (chunk[i] === '{') braceCount++;
    if (chunk[i] === '}') {
        braceCount--;
        if (braceCount === 0) { end = i + 1; break; }
    }
}
const methodsBlock = chunk.slice(start, end);
console.log('methods block length:', methodsBlock.length);

// 找所有.post调用及URL
const postRegex = /\.post\(\{url:"([^"]+)"[^}]*data:\{([^}]+)\}[^}]*\},function/gs;
let m;
const posts = [];
while ((m = postRegex.exec(methodsBlock)) !== null) {
    const url = m[1];
    const dataStr = m[2];
    posts.push({ url, dataStr: dataStr.slice(0, 300), pos: m.index });
}
console.log('\n=== post调用 ===');
posts.forEach((p, i) => {
    console.log(`\n[${i}] url: ${p.url}`);
    console.log(`  data: ${p.dataStr}`);
});

// 找方法名
const nameRegex = /(\w+):function\s+[A-Z]\(/g;
const names = new Set();
while ((m = nameRegex.exec(methodsBlock)) !== null) {
    names.add(m[1]);
}
console.log('\n=== 方法名列表 ===');
console.log([...names].join(', '));

// 重点: 找包含"generat"的方法
console.log('\n=== 含generat的方法上下文 ===');
names.forEach(n => {
    if (n.toLowerCase().includes('generat')) {
        const fnStart = methodsBlock.indexOf(n + ':function');
        if (fnStart >= 0) {
            // 找这个方法的完整代码
            let bc = 0, fnEnd = fnStart;
            for (let i = fnStart; i < methodsBlock.length; i++) {
                if (methodsBlock[i] === '{') bc++;
                if (methodsBlock[i] === '}') { bc--; if (bc === 0) { fnEnd = i+1; break; } }
            }
            console.log(`\n方法 ${n}:`);
            console.log(methodsBlock.slice(fnStart, fnEnd).slice(0, 2000));
        }
    }
});

// 找包含"confirm"或"submit"或"insert"的方法
['confirm', 'submit', 'insert', 'ok', 'done', 'apply', 'finish', 'use'].forEach(key => {
    names.forEach(n => {
        if (n.toLowerCase().includes(key)) {
            const fnStart = methodsBlock.indexOf(n + ':function');
            if (fnStart >= 0) {
                let bc = 0, fnEnd = fnStart;
                for (let i = fnStart; i < methodsBlock.length; i++) {
                    if (methodsBlock[i] === '{') bc++;
                    if (methodsBlock[i] === '}') { bc--; if (bc === 0) { fnEnd = i+1; break; } }
                }
                const fn = methodsBlock.slice(fnStart, fnEnd);
                if (fn.includes('.post(') || fn.includes('insert')) {
                    console.log(`\n方法 ${n} (含post/insert):`);
                    console.log(fn.slice(0, 2000));
                }
            }
        }
    });
});

fs.writeFileSync(path.join(__dirname, 'data', 'debug', 'poster_methods.js'), methodsBlock);
console.log('\nmethods saved.');
