const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
const code = fs.readFileSync(FILE_PATH, 'utf8');

const regex = /\.forEach\s*\(\s*(?:async\s*)?\(?([a-zA-Z0-9_$,\s]*)\)?\s*=>\s*\{/g;
let m;
const matches = [];

while ((m = regex.exec(code)) !== null) {
    const startIdx = m.index;
    const params = m[1];
    
    // Find matching closing brace
    let depth = 1;
    let endIdx = -1;
    for (let i = m.index + m[0].length; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
            depth--;
            if (depth === 0) {
                endIdx = i;
                break;
            }
        }
    }
    
    if (endIdx !== -1) {
        const body = code.substring(m.index, endIdx + 2); // include });
        if (body.includes('await ')) {
            const line = code.substring(0, startIdx).split('\n').length;
            matches.push({ line, startIdx, endIdx, params, body });
        }
    }
}

if (matches.length > 0) {
    console.log(`Found ${matches.length} forEach loops with await:`);
    matches.forEach(match => {
        console.log(`Line ${match.line}: forEach(${match.params})`);
    });
} else {
    console.log('No forEach loops with await found.');
}
