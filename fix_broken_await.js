const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

// 1. Fix "app.await " or ".await "
const regex1 = /(\.|app\.)await\s+/g;
let count1 = 0;
code = code.replace(regex1, (match, prefix) => {
    count1++;
    return prefix;
});

// 2. Fix "await app.XYZ" inside HTML attributes
const regex2 = /(on[a-zA-Z]+)\s*=\s*(["'])(?:async\s+)?await\s+/g;
let count2 = 0;
code = code.replace(regex2, (match, event, quote) => {
    count2++;
    return `${event}=${quote}`;
});

// 3. Fix any " await " leftovers in HTML
const regex3 = /(on[a-zA-Z]+="[^"]*)\s+await\s+/g;
let count3 = 0;
code = code.replace(regex3, (match, prefix) => {
    count3++;
    return `${prefix} `;
});

console.log(`Global fixes applied: ${count1} broken property awaits, ${count2} standard attribute awaits, ${count3} nested attribute awaits.`);
fs.writeFileSync(FILE_PATH, code);
