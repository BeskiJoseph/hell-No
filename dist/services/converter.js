"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHPConverter = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const php_parser_1 = __importDefault(require("php-parser"));
const recast = __importStar(require("recast"));
const t = __importStar(require("@babel/types"));
const AIService_1 = require("./AIService");
const structureGenerator_1 = require("./structureGenerator");
const readFile = (0, util_1.promisify)(fs_1.default.readFile);
const writeFile = (0, util_1.promisify)(fs_1.default.writeFile);
const mkdir = (0, util_1.promisify)(fs_1.default.mkdir);
class PHPConverter {
    constructor(uploadDir, options = {}) {
        this.conversionStatus = new Map();
        this.CHUNK_SIZE = 5;
        this.MAX_RETRIES = 3;
        this.uploadDir = uploadDir;
        this.parser = new php_parser_1.default.Engine({
            parser: { extractDoc: true, php7: true },
            ast: { withPositions: true }
        });
        this.options = {
            useAI: true,
            chunkSize: 5,
            maxConcurrent: 3,
            ...options
        };
        this.aiService = new AIService_1.AIService();
        this.structureGenerator = new structureGenerator_1.StructureGenerator(uploadDir);
    }
    async convertAll(projectId) {
        console.log(`Starting conversion for project ${projectId}`);
        const projectDir = path_1.default.join(this.uploadDir, projectId);
        try {
            this.conversionStatus.set(projectId, {
                status: 'in_progress',
                progress: 0,
                currentStep: 'initializing',
                completedFiles: 0,
                totalFiles: 0,
                error: undefined
            });
            console.log('Checking if project directory exists:', projectDir);
            if (!fs_1.default.existsSync(projectDir)) {
                throw new Error(`Project directory does not exist: ${projectDir}`);
            }
            console.log('Creating project structure...');
            try {
                await this.structureGenerator.createProjectStructure(projectId);
                console.log('Project structure created successfully');
            }
            catch (structureError) {
                console.error('Error creating project structure:', structureError);
                throw new Error(`Failed to create project structure: ${structureError}`);
            }
            console.log('Searching for PHP files...');
            const phpFiles = await this.findPHPFiles(projectDir);
            console.log(`Found ${phpFiles.length} PHP files to convert`);
            if (phpFiles.length === 0) {
                console.log('No PHP files found, checking directory contents...');
                const items = await fs_1.default.promises.readdir(projectDir);
                console.log('Directory contents:', items);
                throw new Error('No PHP files found in project directory');
            }
            this.updateStatus(projectId, {
                totalFiles: phpFiles.length,
                currentStep: 'converting'
            });
            for (let i = 0; i < phpFiles.length; i += this.CHUNK_SIZE) {
                const chunk = phpFiles.slice(i, i + this.CHUNK_SIZE);
                console.log(`Processing chunk ${i / this.CHUNK_SIZE + 1} of ${Math.ceil(phpFiles.length / this.CHUNK_SIZE)}`);
                await Promise.all(chunk.map(async (file) => {
                    try {
                        await this.convertFile(file, projectId);
                        this.updateStatus(projectId, {
                            completedFiles: (this.conversionStatus.get(projectId)?.completedFiles || 0) + 1,
                            progress: Math.round(((i + 1) / phpFiles.length) * 100)
                        });
                    }
                    catch (error) {
                        console.error(`Error converting file ${file}:`, error);
                    }
                }));
            }
            this.updateStatus(projectId, {
                status: 'completed',
                progress: 100,
                currentStep: 'completed'
            });
            console.log(`Conversion completed for project ${projectId}`);
        }
        catch (error) {
            console.error(`Conversion failed for project ${projectId}:`, error);
            this.updateStatus(projectId, {
                status: 'error',
                error: error instanceof Error ? error.message : 'Conversion failed'
            });
            throw error;
        }
    }
    updateStatus(projectId, updates) {
        const currentStatus = this.conversionStatus.get(projectId);
        if (currentStatus) {
            this.conversionStatus.set(projectId, {
                ...currentStatus,
                ...updates
            });
            console.log(`Updated status for project ${projectId}:`, this.conversionStatus.get(projectId));
        }
    }
    async convertFile(filePath, projectId) {
        console.log(`Converting file: ${filePath}`);
        let retries = 0;
        while (retries < this.MAX_RETRIES) {
            try {
                const content = await fs_1.default.promises.readFile(filePath, 'utf-8');
                const converted = await this.convertPHPToNode(content);
                const projectDir = path_1.default.join(this.uploadDir, projectId);
                const convertedDir = path_1.default.join(projectDir, 'converted');
                const fileMapping = this.structureGenerator.mapPhpToNodeStructure(filePath, content);
                const outputPath = path_1.default.join(convertedDir, fileMapping.newPath);
                await fs_1.default.promises.mkdir(path_1.default.dirname(outputPath), { recursive: true });
                if (!this.isValidCode(converted)) {
                    console.warn(`Warning: Converted content for ${filePath} may not be valid code`);
                    console.warn('Content preview:', converted.substring(0, 200) + '...');
                }
                await fs_1.default.promises.writeFile(outputPath, converted, 'utf8');
                console.log(`Successfully converted ${filePath} to ${outputPath} (${fileMapping.type})`);
                return;
            }
            catch (error) {
                retries++;
                console.error(`Attempt ${retries} failed for ${filePath}:`, error);
                if (retries === this.MAX_RETRIES) {
                    throw new Error(`Failed to convert ${filePath} after ${this.MAX_RETRIES} attempts`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            }
        }
    }
    async findPHPFiles(dir) {
        console.log(`Searching for PHP files in directory: ${dir}`);
        const files = [];
        try {
            const items = await fs_1.default.promises.readdir(dir);
            console.log(`Found ${items.length} items in directory`);
            for (const item of items) {
                const fullPath = path_1.default.join(dir, item);
                const stat = await fs_1.default.promises.stat(fullPath);
                if (stat.isDirectory()) {
                    console.log(`Found directory: ${fullPath}`);
                    const subDirFiles = await this.findPHPFiles(fullPath);
                    files.push(...subDirFiles);
                }
                else if (item.endsWith('.php')) {
                    console.log(`Found PHP file: ${fullPath}`);
                    files.push(fullPath);
                }
            }
            console.log(`Total PHP files found: ${files.length}`);
            return files;
        }
        catch (error) {
            console.error(`Error searching for PHP files in ${dir}:`, error);
            throw error;
        }
    }
    async convertPHPToNode(phpCode) {
        if (this.options.useAI) {
            const prompt = `Convert the following PHP code to idiomatic Node.js/Express.js code.\nInclude proper error handling, async/await patterns, and modern JavaScript practices.\n\nPHP code:\n${phpCode}`;
            let aiResponse;
            try {
                console.log('Calling AI service for conversion...');
                aiResponse = await this.aiService.convert(prompt);
                console.log('AI conversion response received');
                console.log('Raw AI response:', aiResponse);
                if (!aiResponse) {
                    throw new Error('Empty response from AI service');
                }
                const processedResponse = this.processAIResponse(aiResponse);
                console.log('Processed AI response:', processedResponse);
                return processedResponse;
            }
            catch (error) {
                console.error('AI conversion failed:', error);
                console.log('Falling back to AST transformation...');
                return this.transformAst(phpCode);
            }
        }
        else {
            console.log('Using AST transformation for conversion...');
            const result = this.transformAst(phpCode);
            console.log('AST transformation completed');
            return result;
        }
    }
    processAIResponse(response) {
        const patterns = [
            /```typescript\n([\s\S]*?)\n```/,
            /```javascript\n([\s\S]*?)\n```/,
            /```ts\n([\s\S]*?)\n```/,
            /```js\n([\s\S]*?)\n```/,
            /```\n([\s\S]*?)\n```/
        ];
        for (const pattern of patterns) {
            const codeMatch = response.match(pattern);
            if (codeMatch) {
                console.log('Extracted code from AI response using pattern:', pattern);
                return codeMatch[1].trim();
            }
        }
        console.log('No code blocks found in AI response, returning as-is');
        return response.trim();
    }
    isValidCode(content) {
        const trimmed = content.trim();
        if (trimmed.length < 10) {
            return false;
        }
        const codePatterns = [
            /function\s+\w+\s*\(/,
            /const\s+\w+\s*=/,
            /let\s+\w+\s*=/,
            /var\s+\w+\s*=/,
            /import\s+/,
            /export\s+/,
            /class\s+\w+/,
            /interface\s+\w+/,
            /console\.log/,
            /return\s+/,
            /if\s*\(/,
            /for\s*\(/,
            /while\s*\(/
        ];
        return codePatterns.some(pattern => pattern.test(trimmed));
    }
    transformAst(phpCode) {
        console.log('Starting AST transformation...');
        const ast = this.parser.parseEval(phpCode);
        const convertedCode = this.mapPhpAstToJsAst(ast);
        const result = recast.print(convertedCode).code;
        console.log('AST mapped to JavaScript');
        console.log('AST printed to code');
        return result;
    }
    mapPhpAstToJsAst(phpAst) {
        if (!phpAst)
            return null;
        switch (phpAst.kind) {
            case 'program':
                return t.program(phpAst.children.map((child) => this.mapPhpAstToJsAst(child)));
            case 'echo':
                return t.expressionStatement(t.callExpression(t.identifier('console.log'), [this.mapPhpAstToJsAst(phpAst.expressions[0])]));
            case 'string':
                return t.stringLiteral(phpAst.value);
            case 'number':
                return t.numericLiteral(phpAst.value);
            case 'boolean':
                return t.booleanLiteral(phpAst.value);
            case 'null':
                return t.nullLiteral();
            case 'variable':
                return t.identifier(phpAst.name.replace('$', ''));
            case 'assign':
                return t.assignmentExpression('=', this.mapPhpAstToJsAst(phpAst.left), this.mapPhpAstToJsAst(phpAst.right));
            case 'function':
                return t.functionDeclaration(t.identifier(phpAst.name), phpAst.arguments.map((arg) => t.identifier(arg.name.replace('$', ''))), t.blockStatement(phpAst.body.map((stmt) => this.mapPhpAstToJsAst(stmt))));
            case 'if':
                return t.ifStatement(this.mapPhpAstToJsAst(phpAst.test), t.blockStatement(phpAst.body.map((stmt) => this.mapPhpAstToJsAst(stmt))), phpAst.alternate ? t.blockStatement(phpAst.alternate.map((stmt) => this.mapPhpAstToJsAst(stmt))) : null);
            case 'while':
                return t.whileStatement(this.mapPhpAstToJsAst(phpAst.test), t.blockStatement(phpAst.body.map((stmt) => this.mapPhpAstToJsAst(stmt))));
            case 'for':
                return t.forStatement(this.mapPhpAstToJsAst(phpAst.init), this.mapPhpAstToJsAst(phpAst.test), this.mapPhpAstToJsAst(phpAst.update), t.blockStatement(phpAst.body.map((stmt) => this.mapPhpAstToJsAst(stmt))));
            case 'foreach':
                return t.forOfStatement(t.variableDeclaration('const', [
                    t.variableDeclarator(t.identifier(phpAst.key ? phpAst.key.name.replace('$', '') : 'item'), null)
                ]), this.mapPhpAstToJsAst(phpAst.source), t.blockStatement(phpAst.body.map((stmt) => this.mapPhpAstToJsAst(stmt))));
            case 'array':
                return t.arrayExpression(phpAst.items.map((item) => this.mapPhpAstToJsAst(item)));
            case 'call':
                return t.callExpression(this.mapPhpAstToJsAst(phpAst.what), phpAst.arguments.map((arg) => this.mapPhpAstToJsAst(arg)));
            case 'methodcall':
                return t.memberExpression(this.mapPhpAstToJsAst(phpAst.what), t.identifier(phpAst.name), false);
            case 'propertylookup':
                return t.memberExpression(this.mapPhpAstToJsAst(phpAst.what), t.identifier(phpAst.offset.name), false);
            case 'bin':
                if (phpAst.type === '&&' || phpAst.type === '||') {
                    return t.logicalExpression(this.mapLogicalOperator(phpAst.type), this.mapPhpAstToJsAst(phpAst.left), this.mapPhpAstToJsAst(phpAst.right));
                }
                return t.binaryExpression(this.mapPhpOperator(phpAst.type), this.mapPhpAstToJsAst(phpAst.left), this.mapPhpAstToJsAst(phpAst.right));
            default:
                console.warn('Unhandled PHP AST node kind:', phpAst.kind);
                return t.expressionStatement(t.stringLiteral(`TODO: Handle ${phpAst.kind}`));
        }
    }
    mapPhpOperator(operator) {
        const operatorMap = {
            '+': '+',
            '-': '-',
            '*': '*',
            '/': '/',
            '%': '%',
            '==': '==',
            '===': '===',
            '!=': '!=',
            '!==': '!==',
            '<': '<',
            '>': '>',
            '<=': '<=',
            '>=': '>=',
            '.': '+'
        };
        return operatorMap[operator] || '+';
    }
    mapLogicalOperator(operator) {
        const operatorMap = {
            '&&': '&&',
            '||': '||'
        };
        return operatorMap[operator] || '&&';
    }
    async generateProjectFiles(projectPath, convertedPath) {
        const packageJson = {
            name: path_1.default.basename(projectPath),
            version: '1.0.0',
            description: 'Converted from PHP to Node.js',
            main: 'index.js',
            scripts: {
                start: 'node index.js',
                dev: 'nodemon index.js'
            },
            dependencies: {
                express: '^4.18.2',
                'body-parser': '^1.20.2',
                cors: '^2.8.5',
                dotenv: '^16.3.1'
            },
            devDependencies: {
                nodemon: '^3.0.2',
                '@types/node': '^20.10.0',
                typescript: '^5.3.0'
            }
        };
        await writeFile(path_1.default.join(convertedPath, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');
        const readme = `# Converted Project

This project was automatically converted from PHP to Node.js.

## Setup
1. Install dependencies: \`npm install\`
2. Start the server: \`npm start\`
3. For development: \`npm run dev\`

## Notes
- This is an automatically converted project
- Review the code and make necessary adjustments
- Update dependencies as needed
`;
        await writeFile(path_1.default.join(convertedPath, 'README.md'), readme, 'utf8');
    }
    async convert(phpCode, fileName) {
        try {
            const cleanCode = phpCode.replace(/^\uFEFF/, '').trim();
            if (!cleanCode.startsWith('<?php')) {
                console.error('PHP file does not start with <?php:', fileName);
                throw new Error('PHP file must start with <?php');
            }
            console.log('First few characters of PHP code:', cleanCode.substring(0, 50));
            let ast;
            try {
                ast = this.parser.parseEval(cleanCode);
            }
            catch (parseError) {
                console.error('Failed to parse PHP file:', fileName, parseError);
                throw parseError;
            }
            const result = await this.convertPHPToNode(cleanCode);
            return { file: fileName, success: true, result };
        }
        catch (error) {
            console.error(`Error parsing PHP file ${fileName}:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { file: fileName, success: false, result: `Failed to parse PHP file: ${errorMessage}` };
        }
    }
    getConversionStatus(projectId) {
        return this.conversionStatus.get(projectId) || {
            status: 'in_progress',
            progress: 0,
            currentStep: 'initializing',
            completedFiles: 0,
            totalFiles: 0,
            error: undefined
        };
    }
}
exports.PHPConverter = PHPConverter;
//# sourceMappingURL=converter.js.map