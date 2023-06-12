import {Node, ParseResult, transformSync, traverse} from "@babel/core";
import {
    Expression,
    ExpressionStatement,
    Identifier, MemberExpression,
    Program, VariableDeclaration
} from "@babel/types";
import generate from "@babel/generator";
import {NodePath} from "@babel/traverse";
const babelPresetMinify = require("babel-preset-minify");

const CTX_IDENTIFIER: Identifier = {
    type: 'Identifier',
    name: '_C'
};

const ALLOWED_GLOBALS = [
    'console',
    'Math',
    '_C'
];

export function makeReturnStatement(node: ParseResult) {
    const lastStatement = node.program.body[node.program.body.length - 1];
    if (lastStatement.type !== 'ExpressionStatement')
        throw new Error("bad if");

    node.program.body[node.program.body.length - 1] = {
        type: 'ReturnStatement',
        argument: lastStatement.expression
    };
}

export function rewriteJs(node: ParseResult, debugComment: string): Expression {
    replaceGlobalWrites(node);
    return {
        type: 'ArrowFunctionExpression',
        params: [CTX_IDENTIFIER],
        expression: false,
        async: false,
        body: {
            type: 'BlockStatement',
            body: node.program.body,
            directives: node.program.directives,
            innerComments: [{
                type: 'CommentLine',
                value: ' ' + debugComment
            }]
        }
    };
}

function replaceGlobalWrites(node: Node) {
    traverse(node, {
        Identifier(path: NodePath<Identifier>) {
            if (path.scope.getBinding(path.node.name))
                return;
            if (path.isBindingIdentifier() || (path as NodePath<Identifier>).isReferencedIdentifier()) {
                if (ALLOWED_GLOBALS.indexOf(path.node.name) !== -1)
                    return;

                path.replaceWith<MemberExpression>({
                    type: 'MemberExpression',
                    object: CTX_IDENTIFIER,
                    property: path.node,
                    computed: false
                })
            }
        }
    });
}

function wrapJs(expressions: Expression[]): Program {
    const inner: ExpressionStatement = {
        type: 'ExpressionStatement',
        expression: {
            type: 'AssignmentExpression',
            operator: '=',
            left: {
                type: 'Identifier',
                name: 'scriptblob_js'
            },
            right: {
                type: 'ArrayExpression',
                elements: expressions
            }
        }
    };
    return {
        type: 'Program',
        body: [inner],
        sourceType: 'script',
        sourceFile: 'scriptblob.js',
        directives: []
    };
}

export function genJs(expressions: Expression[]): {code: string, minCode: string, minMap: string} {
    const program = wrapJs(expressions);
    const programGen = generate(program);
    const transformed = transformSync(programGen.code, {
        babelrc: false,
        configFile: false,
        presets: [[babelPresetMinify, {}]],
        sourceMaps: true,
        comments: false,
        minified: true
    });
    return {code: programGen!.code, minCode: transformed!.code!, minMap: JSON.stringify(transformed!.map)};
}
