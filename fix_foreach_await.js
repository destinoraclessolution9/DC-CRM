const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

function findClosingBrace(content, startPos) {
    let depth = 1;
    for (let i = startPos; i < content.length; i++) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function transform() {
    let changed = true;
    let totalFixed = 0;

    while (changed) {
        changed = false;
        // Match .forEach( (item) => {  OR  .forEach( item => {
        // We use a regex that finds the start of exactly the problematic loops
        const regex = /([\w$]+)\.forEach\s*\(\s*(?:async\s*)?\(?([a-zA-Z0-9_$,\s]*)\)?\s*=>\s*\{/g;
        let m;
        
        while ((m = regex.exec(code)) !== null) {
            const fullMatch = m[0];
            const collection = m[1];
            const params = m[2].trim();
            const startIdx = m.index;
            const bodyStartIdx = startIdx + fullMatch.length;
            
            const endIdx = findClosingBrace(code, bodyStartIdx);
            if (endIdx === -1) continue;
            
            // Check if there's a ); after the }
            const afterEnd = code.substring(endIdx + 1, endIdx + 5);
            if (!afterEnd.includes(')')) continue;
            
            const body = code.substring(bodyStartIdx, endIdx);
            
            if (body.includes('await ')) {
                // Determine replacement
                // Simple case: (item) => ...
                // Complex case: (item, index) => ... (We'll skip manual index for now or handle it)
                let replacementHeader = '';
                if (params.includes(',')) {
                    const p = params.split(',').map(s => s.trim());
                    replacementHeader = `let ${p[1]} = 0; for (const ${p[0]} of ${collection}) {`;
                    // Note: This prefixing of index might be messy if not careful, 
                    // but for CRM typical loops it's usually just (item).
                } else {
                    replacementHeader = `for (const ${params} of ${collection}) {`;
                }
                
                const footerIdx = code.indexOf(')', endIdx);
                const semicolonIdx = code.indexOf(';', footerIdx);
                let finalEndIdx = footerIdx + 1;
                if (semicolonIdx !== -1 && semicolonIdx < footerIdx + 3) finalEndIdx = semicolonIdx + 1;
                
                const newLoop = replacementHeader + body + "}";
                if (params.includes(',')) {
                    // add index increment if needed... actually let's keep it simple for now.
                    // If it has index, use [].entries()
                    const p = params.split(',').map(s => s.trim());
                    const header = `for (const [${p[1]}, ${p[0]}] of ${collection}.entries()) {`;
                    code = code.substring(0, startIdx) + header + body + "}" + code.substring(finalEndIdx);
                } else {
                    code = code.substring(0, startIdx) + replacementHeader + body + "}" + code.substring(finalEndIdx);
                }
                
                totalFixed++;
                changed = true;
                break; // Restart loop to avoid offset issues
            }
        }
    }
    
    fs.writeFileSync(FILE_PATH, code);
    console.log(`Successfully fixed ${totalFixed} forEach loops in ${FILE_PATH}`);
}

transform();
