const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
const code = fs.readFileSync(FILE_PATH, 'utf8');

const JS_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'try', 'return', 'yield', 'with', 'else', 'do', 'finally', 'var']);

function getFuncBodyEnd(content, startPos) {
    let depth = 0, inString = null, i = startPos;
    while (i < content.length) {
        const char = content[i];
        if (!inString) {
            if (char === '{') depth++;
            else if (char === '}') { depth--; if (depth === 0) return i; }
            else if (char === '"' || char === "'" || char === "`") inString = char;
        } else if (char === inString && content[i-1] !== '\\') inString = null;
        i++;
    }
    return -1;
}

function findExpressionEnd(content, startPos) {
    let depth = 0, inString = null, i = startPos;
    while (i < content.length) {
        const char = content[i];
        if (!inString) {
            if (char === '(' || char === '[' || char === '{') depth++;
            else if (char === ')' || char === ']' || char === '}') { if (depth === 0) return i; depth--; }
            else if (char === ',' || char === ';' || char === '\n') { if (depth === 0) return i; }
            else if (char === '"' || char === "'" || char === "`") inString = char;
        } else if (char === inString && content[i-1] !== '\\') inString = null;
        i++;
    }
    return i;
}

function getAllFunctions(c) {
    const list = [];
    const regex = /\b(async\s+)?(?:(?:(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(\{)?)|(?:function\s+([a-zA-Z_$][\w$]*)?\s*\([^)]*\)\s*(\{)?)|(?:([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*(\{)?)|(?:(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(\{)?))/g;
    
    let m;
    while ((m = regex.exec(c)) !== null) {
        const start = m.index;
        const header = m[0];
        const isAsync = header.includes('async');
        const name = m[2] || m[5] || m[7] || 'anonymous';
        
        let bodyStart, bodyEnd;
        if (header.includes('{')) {
            bodyStart = c.indexOf('{', start);
            bodyEnd = getFuncBodyEnd(c, bodyStart);
        } else {
            bodyStart = start + header.length;
            bodyEnd = findExpressionEnd(c, bodyStart);
        }
        
        if (bodyEnd !== -1) {
            list.push({ start, bodyStart, bodyEnd, header, isAsync, name });
        }
    }
    return list;
}

const functions = getAllFunctions(code);
const awaitingErrors = [];

const awaitRegex = /\bawait\b/g;
let m;
while ((m = awaitRegex.exec(code)) !== null) {
    const awaitIdx = m.index;
    
    // Check if this await is inside a string
    let inString = false;
    let quote = null;
    for (let i = 0; i < awaitIdx; i++) {
        const char = code[i];
        if (!quote && (char === '"' || char === "'" || char === "`")) { quote = char; inString = true; }
        else if (quote && char === quote && code[i-1] !== '\\') { quote = null; inString = false; }
    }
    if (inString) continue;

    let inner = null;
    for (const f of functions) {
        if (awaitIdx >= f.bodyStart && awaitIdx < f.bodyEnd) {
            if (!inner || (f.bodyEnd - f.bodyStart < inner.bodyEnd - inner.bodyStart)) inner = f;
        }
    }
    
    if (!inner || !inner.isAsync) {
        const line = code.substring(0, awaitIdx).split('\n').length;
        awaitingErrors.push({ line, func: inner ? inner.name : 'top-level' });
    }
}

if (awaitingErrors.length > 0) {
    console.log(`Found ${awaitingErrors.length} await-outside-async violations:`);
    awaitingErrors.forEach(err => console.log(`Line ${err.line}: await in ${err.func}`));
} else {
    console.log("No await-outside-async violations found! (Regular code only, strings ignored)");
}
