const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

// Read code and remove all "await AppDataStore" and "await  AppDataStore" to bypass syntax errors!
let code = fs.readFileSync('script.js', 'utf8');

// Some awaits were added manually by the user, causing syntax errors. We remove them before parsing.
// We also remove existing async keywords from the user's manual attempts so we can apply them uniformly based on AST.
code = code.replace(/await\s+AppDataStore/g, 'AppDataStore');

console.log('Parsing code...');
let ast;
try {
    ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx']
    });
} catch (e) {
    console.error('Initial parse failed: ', e.message);
    // If it fails, we locate the error line and see if there is another await.
    // We can just exit.
    process.exit(1);
}

const dataStoreMethods = ['getAll', 'getById', 'create', 'update', 'delete', 'query'];

console.log('Traversing and modifying AppDataStore calls...');
// First pass: add await to AppDataStore calls
traverse(ast, {
    CallExpression(path) {
        if (
            t.isMemberExpression(path.node.callee) &&
            t.isIdentifier(path.node.callee.object, { name: 'AppDataStore' }) &&
            t.isIdentifier(path.node.callee.property) &&
            dataStoreMethods.includes(path.node.callee.property.name)
        ) {
            // Check if it's already an AwaitExpression
            if (!t.isAwaitExpression(path.parent)) {
                path.replaceWith(t.awaitExpression(path.node));
            }
        }
    }
});

console.log('Traversing and replacing forEach loops...');
// Second pass: refactor forEach to for...of
traverse(ast, {
    CallExpression(path) {
        if (
            t.isMemberExpression(path.node.callee) &&
            t.isIdentifier(path.node.callee.property, { name: 'forEach' })
        ) {
            const args = path.node.arguments;
            if (args.length > 0 && (t.isArrowFunctionExpression(args[0]) || t.isFunctionExpression(args[0]))) {
                const callback = args[0];
                
                let hasAwait = false;
                path.get('arguments.0').traverse({
                    AwaitExpression(innerPath) {
                        hasAwait = true;
                    }
                });

                if (callback.async || hasAwait || callback.body.type === 'AwaitExpression') {
                    // Find the parent statement
                    const stmtPath = path.findParent(p => p.isStatement());
                    if (stmtPath && t.isExpressionStatement(stmtPath.node) && stmtPath.node.expression === path.node) {
                        const arrayExpr = path.node.callee.object;
                        const param = callback.params.length > 0 ? callback.params[0] : t.identifier('_item');
                        
                        let body = callback.body;
                        if (!t.isBlockStatement(body)) {
                            body = t.blockStatement([t.expressionStatement(body)]);
                        }
                        
                        const forOf = t.forOfStatement(
                            t.variableDeclaration('const', [t.variableDeclarator(param)]),
                            arrayExpr,
                            body
                        );
                        
                        stmtPath.replaceWith(forOf);
                    }
                }
            }
        }
    }
});

console.log('Traversing and ensuring async keywords...');
// Third pass: ensure any function containing an await is marked async
traverse(ast, {
    AwaitExpression(path) {
        let funcPath = path.findParent(p => p.isFunction() || p.isObjectMethod() || p.isClassMethod());
        if (funcPath) {
            funcPath.node.async = true;
        }
    }
});

console.log('Generating code...');
const output = generate(ast, {
    retainLines: true, // Keep original lines as much as possible for large files
    compact: false
}, code);

fs.writeFileSync('script.js', output.code);
console.log('Done!');
