const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

// Regex to find await DataStore.method(...).chainedMethod
// Targets DataStore.getAll and DataStore.getById
const regex = /await\s+(DataStore\.(?:getAll|getById)\s*\([^)]+\))\.(filter|map|find|forEach|some|every|reduce|sort|slice)/g;

let count = 0;
const newCode = code.replace(regex, (match, p1, p2) => {
    count++;
    return `(await ${p1}).${p2}`;
});

if (count > 0) {
    fs.writeFileSync(FILE_PATH, newCode);
    console.log(`Successfully fixed ${count} chaining patterns in ${FILE_PATH}`);
} else {
    console.log(`No chaining patterns found in ${FILE_PATH}`);
}
