module.exports = function(fileInfo, api) {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);

    const dataStoreMethods = ['getAll', 'getById', 'create', 'update', 'delete', 'query'];

    // 1. Find DataStore calls and add await, then make parent async
    root.find(j.CallExpression, {
        callee: {
            type: 'MemberExpression',
            object: { name: 'DataStore' }
        }
    }).forEach(path => {
        if (path.node.callee.property && dataStoreMethods.includes(path.node.callee.property.name)) {
            // Check if it's already awaited
            if (path.parentPath.value.type !== 'AwaitExpression') {
                const awaited = j.awaitExpression(path.node);
                j(path).replaceWith(awaited);
                
                // Traverse up to find the closest function and make it async
                let p = path.parent;
                while (p != null) {
                    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod'].includes(p.value.type)) {
                        p.value.async = true;
                        break;
                    }
                    p = p.parent;
                }
            }
        }
    });

    // 2. Refactor forEach with async callbacks to for...of loops
    root.find(j.CallExpression, {
        callee: {
            type: 'MemberExpression',
            property: { name: 'forEach' }
        }
    }).forEach(path => {
        const args = path.node.arguments;
        if (args.length > 0 && ['ArrowFunctionExpression', 'FunctionExpression'].includes(args[0].type)) {
            const callback = args[0];
            if (callback.async) {
                // Determine the parent statement (ExpressionStatement)
                let exprPath = path;
                while (exprPath.value.type !== 'ExpressionStatement' && exprPath.parent != null) {
                    exprPath = exprPath.parent;
                }
                
                if (exprPath.value.type === 'ExpressionStatement' && exprPath.value.expression === path.node) {
                    const arrayExpr = path.node.callee.object;
                    const param = callback.params[0] || j.identifier('item');
                    
                    let body = callback.body;
                    if (body.type !== 'BlockStatement') {
                        body = j.blockStatement([j.expressionStatement(body)]);
                    }
                    
                    // Also make sure the parent function of the for...of is async!!
                    let p = exprPath.parent;
                    while (p != null) {
                        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(p.value.type)) {
                            p.value.async = true;
                            break;
                        }
                        p = p.parent;
                    }

                    const forOf = j.forOfStatement(
                        j.variableDeclaration('const', [j.variableDeclarator(param)]),
                        arrayExpr,
                        body
                    );
                    
                    j(exprPath).replaceWith(forOf);
                }
            }
        }
    });

    return root.toSource();
};
