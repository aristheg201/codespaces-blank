const fs = require('node:fs');
const p = 'manager/src/renderer/src/App.tsx';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
if (!s.includes('export function App()')) throw new Error('App named export marker missing');
s = s.replace('export function App()', 'function App()');
if (!s.trimEnd().endsWith('}')) throw new Error('Unexpected App source ending');
s = `${s.trimEnd()}\n\nexport default App;\n`;
fs.writeFileSync(p, s);
console.log('Manager 6.0.6 App default export patched.');
