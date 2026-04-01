const fs = require('fs');

const FILE_PATH = process.argv[2] || 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

const JS_KEYWORDS = new Set([
     'if', 'while', 'for', 'switch', 'catch', 'try', 'return', 'yield', 'with', 'else', 'do', 'finally', 'var'
]);

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
        if (start > 0 && c[start-1] === '.') continue;
        
        const header = m[0];
        const isAsync = header.includes('async');
        const name = m[2] || m[5] || m[7] || null;
        if (name && JS_KEYWORDS.has(name)) continue;
        if (name === 'appLogic') continue;

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

function transform() {
    // PRE-PASS: Fix easy arrow functions
    code = code.replace(/(?<!\basync\s+)([\w$]+)\s*=>\s*(await\b)/g, 'async $1 => $2');
    code = code.replace(/(?<!\basync\s+)\(([^)]*)\)\s*=>\s*(await\b)/g, 'async ($1) => $2');

    let changed = true, iterations = 0;
    while (changed && iterations < 30) {
        changed = false; iterations++;
        const functions = getAllFunctions(code);
        const awaits = [];
        const awaitRegex = /\bawait\b/g;
        let m;
        while ((m = awaitRegex.exec(code)) !== null) awaits.push(m.index);
        
        const needsAsync = [];
        for (const awaitIdx of awaits) {
            let inner = null;
            for (const f of functions) {
                if (awaitIdx >= f.bodyStart && awaitIdx < f.bodyEnd) {
                    if (!inner || (f.bodyEnd - f.bodyStart < inner.bodyEnd - inner.bodyStart)) inner = f;
                }
            }
            if (inner && !inner.isAsync) {
                if (!needsAsync.find(n => n.start === inner.start)) needsAsync.push(inner);
            }
        }
        
        const asyncNames = new Set(functions.filter(f => f.isAsync && f.name).map(f => f.name));
        ['push', 'pop', 'shift', 'unshift', 'map', 'filter', 'forEach', 'find', 'some', 'every', 'reduce', 'var'].forEach(n => asyncNames.delete(n));

        const callFixes = [];
        for (const name of asyncNames) {
            const callRegex = new RegExp(`(^|[^a-zA-Z0-9_$])(${name})\\s*\\(`, 'g');
            while ((m = callRegex.exec(code)) !== null) {
                const callIdx = m.index + m[1].length;
                const prefix = code.substring(Math.max(0, callIdx - 20), callIdx);
                if (/\b(function|const|let|var|await|get|set|async)\s*$/.test(prefix)) continue;
                if (/\bawait\s+$/.test(prefix)) continue;
                callFixes.push({ index: callIdx, name });
            }
        }
        
        const allChanges = [
            ...needsAsync.map(f => ({ type: 'async', index: f.start, f })),
            ...callFixes.map(c => ({ type: 'await', index: c.index }))
        ].sort((a, b) => b.index - a.index);
        
        const uniqueChanges = [];
        const seen = new Set();
        for (const ch of allChanges) {
            const key = ch.type + ch.index;
            if (!seen.has(key)) { uniqueChanges.push(ch); seen.add(key); }
        }
        
        if (uniqueChanges.length > 0) {
            for (const ch of uniqueChanges) {
                if (ch.type === 'async') {
                    const f = ch.f;
                    let replacement = '';
                    if (f.header.includes('=>')) {
                        if (f.header.includes('=')) replacement = f.header.replace(/=\s*(async\s+)?/, '= async ');
                        else replacement = 'async ' + f.header;
                    } else if (f.header.includes('function')) {
                        replacement = f.header.replace('function', 'async function');
                    } else {
                        replacement = 'async ' + f.header;
                    }
                    if (code.substring(f.start, f.start + f.header.length) === f.header && !f.isAsync) {
                        code = code.substring(0, f.start) + replacement + code.substring(f.start + f.header.length);
                        changed = true;
                    }
                } else {
                    code = code.substring(0, ch.index) + 'await ' + code.substring(ch.index);
                    changed = true;
                }
            }
            if (changed) console.log(`Iteration ${iterations}: Applied changes.`);
        }
    }
    fs.writeFileSync(FILE_PATH, code);
}

transform();
console.log("Done.");
