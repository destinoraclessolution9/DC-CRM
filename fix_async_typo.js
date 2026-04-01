const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

const regex = /app\.async\s+/g;
let count = 0;
code = code.replace(regex, (match) => {
    count++;
    return 'app.';
});

console.log(`Global fixes applied: ${count} app.async patterns.`);
fs.writeFileSync(FILE_PATH, code);
