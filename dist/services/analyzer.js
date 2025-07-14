"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHPAnalyzer = exports.readFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const adm_zip_1 = __importDefault(require("adm-zip"));
const phpAstAnalyzer_1 = require("./phpAstAnalyzer");
const groqClient_1 = require("../utils/groqClient");
exports.readFile = (0, util_1.promisify)(fs_1.default.readFile);
const readdir = (0, util_1.promisify)(fs_1.default.readdir);
const stat = (0, util_1.promisify)(fs_1.default.stat);
class PHPAnalyzer {
    constructor(uploadDir) {
        this.uploadDir = uploadDir;
    }
    async analyzeProject(projectId) {
        const projectPath = path_1.default.join(this.uploadDir, projectId);
        if (!fs_1.default.existsSync(projectPath)) {
            throw new Error('Project not found');
        }
        const files = await readdir(projectPath);
        const zipFile = files.find(file => file.toLowerCase().endsWith('.zip'));
        if (zipFile) {
            const zipPath = path_1.default.join(projectPath, zipFile);
            const zip = new adm_zip_1.default(zipPath);
            zip.extractAllTo(projectPath, true);
        }
        const fileTree = await this.generateFileTree(projectPath);
        const phpFiles = await this.findPhpFiles(projectPath);
        const sampleFiles = phpFiles.slice(0, 5);
        let filesContent = '';
        for (const file of sampleFiles) {
            const content = await (0, exports.readFile)(file, 'utf-8');
            filesContent += `File: ${file}\n${content}\n\n`;
        }
        const prompt = `You are an expert PHP-to-Node.js migration assistant.\nGiven the following PHP project files, analyze the project and provide a JSON object with the following structure:\n{\n  \"structure\": {\n    \"routes\": string[],\n    \"controllers\": string[],\n    \"models\": string[],\n    \"authType\": string,\n    \"database\": string\n  },\n  \"summary\": {\n    \"purpose\": string,\n    \"dependencies\": string[],\n    \"complexity\": \"low\"|\"medium\"|\"high\"\n  },\n  \"conversionSuggestions\": string\n}\nAnalyze the files and fill in the JSON fields.\n\n${filesContent}`;
        const aiResponse = await (0, groqClient_1.analyzeWithGroq)(prompt);
        let aiResult;
        try {
            aiResult = JSON.parse(aiResponse);
        }
        catch (e) {
            aiResult = {
                structure: { routes: [], controllers: [], models: [], authType: '', database: '' },
                summary: { purpose: aiResponse, dependencies: [], complexity: 'medium' },
                conversionSuggestions: ''
            };
        }
        return {
            structure: aiResult.structure,
            summary: aiResult.summary,
            fileTree
        };
    }
    async analyzeStructure(projectPath) {
        const routes = [];
        const controllers = [];
        const models = [];
        let authType = 'none';
        let database = 'unknown';
        const astAnalyzer = new phpAstAnalyzer_1.PhpAstAnalyzer();
        await this.walkDirectory(projectPath, async (filePath) => {
            if (path_1.default.extname(filePath).toLowerCase() === '.php') {
                try {
                    const analysis = astAnalyzer.parseFile(filePath);
                    if (analysis.structure.routes && analysis.structure.routes.length > 0) {
                        routes.push(...analysis.structure.routes.map(() => filePath));
                    }
                    if (analysis.structure.controllers && analysis.structure.controllers.length > 0) {
                        controllers.push(...analysis.structure.controllers.map(() => filePath));
                    }
                    if (analysis.structure.models && analysis.structure.models.length > 0) {
                        models.push(...analysis.structure.models.map(() => filePath));
                    }
                    if (analysis.structure.auth && analysis.structure.auth !== 'none') {
                        authType = analysis.structure.auth;
                    }
                    if (analysis.structure.database && analysis.structure.database !== 'unknown') {
                        database = analysis.structure.database;
                    }
                }
                catch (err) {
                    const content = await (0, exports.readFile)(filePath, 'utf-8');
                    if (content.includes('Route::') || content.includes('$router->')) {
                        routes.push(filePath);
                    }
                    if (content.includes('class') && content.includes('Controller')) {
                        controllers.push(filePath);
                    }
                    if (content.includes('class') && content.includes('Model')) {
                        models.push(filePath);
                    }
                    if (content.includes('Auth::') || content.includes('auth()->')) {
                        authType = 'laravel';
                    }
                    else if (content.includes('session_start()')) {
                        authType = 'session';
                    }
                    if (content.includes('DB::') || content.includes('Eloquent')) {
                        database = 'mysql';
                    }
                    else if (content.includes('PDO')) {
                        database = 'pdo';
                    }
                }
            }
        });
        return {
            routes,
            controllers,
            models,
            authType,
            database
        };
    }
    async generateFileTree(dirPath, basePath = '') {
        const items = await readdir(dirPath);
        const tree = [];
        for (const item of items) {
            const fullPath = path_1.default.join(dirPath, item);
            const relativePath = path_1.default.join(basePath, item);
            const stats = await stat(fullPath);
            if (stats.isDirectory()) {
                const children = await this.generateFileTree(fullPath, relativePath);
                tree.push({
                    name: item,
                    type: 'folder',
                    path: relativePath,
                    children
                });
            }
            else {
                tree.push({
                    name: item,
                    type: 'file',
                    path: relativePath
                });
            }
        }
        return tree;
    }
    async analyzeSummary(projectPath) {
        const dependencies = [];
        let complexity = 'low';
        let purpose = 'Unknown';
        const composerPath = path_1.default.join(projectPath, 'composer.json');
        if (fs_1.default.existsSync(composerPath)) {
            const composerContent = await (0, exports.readFile)(composerPath, 'utf-8');
            const composerJson = JSON.parse(composerContent);
            if (composerJson.require) {
                dependencies.push(...Object.keys(composerJson.require));
            }
        }
        const phpFiles = await this.findPhpFiles(projectPath);
        console.log('PHP files found for conversion:', phpFiles);
        const totalLines = await this.countTotalLines(phpFiles);
        if (totalLines > 10000) {
            complexity = 'high';
        }
        else if (totalLines > 5000) {
            complexity = 'medium';
        }
        if (phpFiles.some(file => file.includes('api'))) {
            purpose = 'API Service';
        }
        else if (phpFiles.some(file => file.includes('admin'))) {
            purpose = 'Admin Panel';
        }
        else if (phpFiles.some(file => file.includes('auth'))) {
            purpose = 'Authentication System';
        }
        return {
            purpose,
            dependencies,
            complexity
        };
    }
    async walkDirectory(dir, callback) {
        const items = await readdir(dir);
        for (const item of items) {
            const fullPath = path_1.default.join(dir, item);
            const stats = await stat(fullPath);
            if (stats.isDirectory()) {
                await this.walkDirectory(fullPath, callback);
            }
            else {
                await callback(fullPath);
            }
        }
    }
    async findPhpFiles(dir) {
        const files = [];
        await this.walkDirectory(dir, async (filePath) => {
            if (path_1.default.extname(filePath).toLowerCase() === '.php') {
                files.push(filePath);
            }
        });
        return files;
    }
    async countTotalLines(files) {
        let totalLines = 0;
        for (const file of files) {
            const content = await (0, exports.readFile)(file, 'utf-8');
            totalLines += content.split('\n').length;
        }
        return totalLines;
    }
}
exports.PHPAnalyzer = PHPAnalyzer;
//# sourceMappingURL=analyzer.js.map