// 사용법: node build.js  → index.template.html + rk-engine.js + rk-ai.js + rk-net.js 를 합쳐 index.html 생성
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
let html = read('index.template.html');
html = html.replace('/*__ENGINE__*/', () => read('rk-engine.js')).replace('/*__AI__*/', () => read('rk-ai.js')).replace('/*__NET__*/', () => read('rk-net.js'));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('index.html 생성 완료 (' + Math.round(html.length / 1024) + 'KB)');
