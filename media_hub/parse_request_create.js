const fs = require('fs');
const path = require('path');

const methodsBlock = fs.readFileSync(path.join(__dirname, 'data', 'debug', 'poster_methods.js'), 'utf-8');

// 获取_requestCreate方法
const fnName = '_requestCreate';
const fnStart = methodsBlock.indexOf(fnName + ':function');
console.log(`_requestCreate 位置: ${fnStart}`);

let bc = 0, fnEnd = fnStart;
for (let i = fnStart; i < methodsBlock.length; i++) {
    if (methodsBlock[i] === '{') bc++;
    if (methodsBlock[i] === '}') { bc--; if (bc === 0) { fnEnd = i+1; break; } }
}
const requestCreate = methodsBlock.slice(fnStart, fnEnd);
console.log('\n=== _requestCreate方法完整代码 ===');
console.log(requestCreate);

// 同时看看initLoad方法
const initStart = methodsBlock.indexOf('initLoad:function');
bc = 0; fnEnd = initStart;
for (let i = initStart; i < methodsBlock.length; i++) {
    if (methodsBlock[i] === '{') bc++;
    if (methodsBlock[i] === '}') { bc--; if (bc === 0) { fnEnd = i+1; break; } }
}
console.log('\n=== initLoad方法 ===');
console.log(methodsBlock.slice(initStart, fnEnd));

// 解析_requestCreate中的API调用参数
console.log('\n=== 关键参数解析 ===');
const createMatch = requestCreate.match(/action=create[^}]*data:\{([^}]+)\}/);
if (createMatch) {
    console.log('create data参数片段:', createMatch[1]);
}
const composeMatch = requestCreate.match(/action=compose[^}]*data:\{([^}]+)\}/);
if (composeMatch) {
    console.log('compose data参数片段:', composeMatch[1]);
}
// 搜索所有action值
const actionMatches = [...requestCreate.matchAll(/action=(\w+)/g)];
console.log('所有action值:', actionMatches.map(m => m[1]));
