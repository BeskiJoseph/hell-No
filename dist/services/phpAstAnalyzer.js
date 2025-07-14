"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhpAstAnalyzer = void 0;
const fs_1 = __importDefault(require("fs"));
const PhpParser = require('php-parser');
class PhpAstAnalyzer {
    constructor() {
        this.parser = new PhpParser({
            ast: { withPositions: true },
            parser: { extractDoc: true },
            lexer: { all_tokens: true }
        });
    }
    extractStructureFromAst(ast) {
        const controllers = [];
        const models = [];
        const routes = [];
        let auth = 'none';
        let database = 'unknown';
        function walk(node) {
            if (!node)
                return;
            if (node.kind === 'class') {
                if (node.name && node.name.name) {
                    const className = node.name.name;
                    if (className.toLowerCase().includes('controller')) {
                        controllers.push(className);
                    }
                    else if (className.toLowerCase().includes('model')) {
                        models.push(className);
                    }
                }
            }
            if (node.kind === 'function') {
                if (node.name && node.name.name) {
                    routes.push(node.name.name);
                }
            }
            for (const key in node) {
                if (node[key] && typeof node[key] === 'object') {
                    if (Array.isArray(node[key])) {
                        node[key].forEach(walk);
                    }
                    else {
                        walk(node[key]);
                    }
                }
            }
        }
        walk(ast);
        return {
            controllers,
            models,
            routes,
            views: [],
            framework: 'unknown',
            auth,
            database
        };
    }
    parseFile(filePath) {
        const code = fs_1.default.readFileSync(filePath, 'utf-8');
        const ast = this.parser.parseCode(code);
        const structure = this.extractStructureFromAst(ast);
        return {
            ast,
            structure,
            summary: 'Basic structure extracted from AST'
        };
    }
    detectFramework(ast) {
        return 'unknown';
    }
    detectDatabase(ast) {
        return 'unknown';
    }
    detectAuth(ast) {
        return 'unknown';
    }
}
exports.PhpAstAnalyzer = PhpAstAnalyzer;
//# sourceMappingURL=phpAstAnalyzer.js.map