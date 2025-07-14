"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const phpAstAnalyzer_1 = require("./services/phpAstAnalyzer");
const path_1 = __importDefault(require("path"));
const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: npx ts-node src/analyzeSample.ts <path-to-php-file>');
    process.exit(1);
}
const analyzer = new phpAstAnalyzer_1.PhpAstAnalyzer();
const absPath = path_1.default.isAbsolute(filePath) ? filePath : path_1.default.join(process.cwd(), filePath);
try {
    const analysis = analyzer.parseFile(absPath);
    console.log('--- Structure ---');
    console.log(JSON.stringify(analysis.structure, null, 2));
    console.log('\n--- Summary ---');
    console.log(analysis.summary);
}
catch (err) {
    console.error('Error analyzing file:', err);
}
//# sourceMappingURL=analyzeSample.js.map