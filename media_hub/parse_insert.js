const fs = require('fs');
const text = fs.readFileSync('/Users/a58/58_self/beast_chess/media_hub/data/debug/poster_js_1.js', 'utf-8');

// 找onTextPosterInsert
const idx = text.indexOf('onTextPosterInsert:function');
if (idx >= 0) {
    let bc = 0, end = idx;
    for (let i = idx; i < text.length; i++) {
        if (text[i] === '{') bc++;
        if (text[i] === '}') { bc--; if (bc === 0) { end = i+1; break; } }
    }
    console.log(text.slice(idx, end).slice(0, 3000));
}
