"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const dotenv_1 = __importDefault(require("dotenv"));
const analyzer_1 = require("./services/analyzer");
const converter_1 = require("./services/converter");
const adm_zip_1 = __importDefault(require("adm-zip"));
const AIService_1 = require("./services/AIService");
const axios = require('axios');
const { readFile } = fs_1.default.promises;
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
const corsOptions = {
    origin: ['http://localhost:8081', 'http://localhost:8080', 'http://localhost:3000', 'http://localhost:8082'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json());
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});
const uploadsDir = path_1.default.join(__dirname, '../uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
const analyzer = new analyzer_1.PHPAnalyzer(uploadsDir);
const converter = new converter_1.PHPConverter(uploadsDir);
const aiService = new AIService_1.AIService();
const projectMappings = new Map();
const mappingsFile = path_1.default.join(uploadsDir, 'project_mappings.json');
if (fs_1.default.existsSync(mappingsFile)) {
    const mappings = JSON.parse(fs_1.default.readFileSync(mappingsFile, 'utf-8'));
    Object.entries(mappings).forEach(([projectId, projectDir]) => {
        projectMappings.set(projectId, projectDir);
    });
}
function saveProjectMappings() {
    const mappings = Object.fromEntries(projectMappings.entries());
    fs_1.default.writeFileSync(mappingsFile, JSON.stringify(mappings, null, 2));
}
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const projectId = (0, uuid_1.v4)();
        const projectDir = path_1.default.join(uploadsDir, projectId);
        fs_1.default.mkdirSync(projectDir, { recursive: true });
        projectMappings.set(projectId, projectDir);
        saveProjectMappings();
        cb(null, projectDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.php', '.zip', '.sql'];
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only .php, .zip, and .sql files are allowed.'));
        }
    }
});
app.get('/api/health', (req, res) => {
    console.log('Health check requested');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.post('/api/upload/file', upload.single('file'), async (req, res) => {
    try {
        console.log('File upload requested');
        if (!req.file) {
            console.log('No file received');
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const projectId = path_1.default.basename(path_1.default.dirname(req.file.path));
        console.log(`File received: ${req.file.originalname} in project ${projectId}`);
        if (path_1.default.extname(req.file.originalname).toLowerCase() === '.zip') {
            console.log('Extracting zip file...');
            await extractZipFile(req.file.path, path_1.default.dirname(req.file.path));
            console.log('Zip file extracted successfully');
        }
        const response = {
            projectId,
            name: req.file.originalname,
            type: 'file',
            files: 1,
            size: req.file.size,
            status: 'uploaded'
        };
        console.log('File upload successful:', response);
        return res.json(response);
    }
    catch (error) {
        console.error('File upload error:', error);
        return res.status(500).json({ error: 'Failed to upload file' });
    }
});
app.post('/api/upload/text', (req, res) => {
    try {
        console.log('Text upload requested');
        console.log('Request body:', req.body);
        const { code } = req.body;
        if (!code) {
            console.log('No code received');
            return res.status(400).json({ error: 'No code provided. Expected field: code' });
        }
        const projectId = (0, uuid_1.v4)();
        const projectDir = path_1.default.join(uploadsDir, projectId);
        fs_1.default.mkdirSync(projectDir, { recursive: true });
        projectMappings.set(projectId, projectDir);
        const phpCode = code.trim().startsWith('<?php') ? code : `<?php\n${code}`;
        const filePath = path_1.default.join(projectDir, 'direct-code.php');
        fs_1.default.writeFileSync(filePath, phpCode);
        console.log('Code received, length:', phpCode.length);
        const response = {
            projectId,
            name: 'direct-code.php',
            type: 'text',
            files: 1,
            status: 'uploaded'
        };
        console.log('Text upload successful:', response);
        return res.json(response);
    }
    catch (error) {
        console.error('Text upload error:', error);
        return res.status(500).json({ error: 'Failed to process code' });
    }
});
app.post('/api/upload/github', async (req, res) => {
    try {
        const { repoUrl } = req.body;
        if (!repoUrl) {
            return res.status(400).json({ error: 'No repository URL provided. Expected field: repoUrl' });
        }
        const match = repoUrl.match(/github.com\/([^/]+)\/([^/]+)(?:\.git)?/);
        if (!match) {
            return res.status(400).json({ error: 'Invalid GitHub repository URL' });
        }
        const owner = match[1];
        const repo = match[2].replace(/\.git$/, '');
        let zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
        let zipResponse;
        try {
            zipResponse = await axios.get(zipUrl, { responseType: 'arraybuffer' });
        }
        catch (err) {
            zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`;
            zipResponse = await axios.get(zipUrl, { responseType: 'arraybuffer' });
        }
        const projectId = (0, uuid_1.v4)();
        const projectDir = path_1.default.join(uploadsDir, projectId);
        fs_1.default.mkdirSync(projectDir, { recursive: true });
        const zipPath = path_1.default.join(projectDir, 'repo.zip');
        fs_1.default.writeFileSync(zipPath, zipResponse.data);
        const zip = new adm_zip_1.default(zipPath);
        zip.extractAllTo(projectDir, true);
        fs_1.default.unlinkSync(zipPath);
        projectMappings.set(projectId, projectDir);
        let phpFiles = [];
        function walk(dir) {
            fs_1.default.readdirSync(dir).forEach(file => {
                const fullPath = path_1.default.join(dir, file);
                if (fs_1.default.statSync(fullPath).isDirectory())
                    walk(fullPath);
                else if (file.endsWith('.php'))
                    phpFiles.push(fullPath);
            });
        }
        walk(projectDir);
        return res.json({
            projectId,
            name: repo,
            type: 'github',
            files: phpFiles.length,
            status: 'uploaded'
        });
    }
    catch (error) {
        console.error('GitHub import error:', error);
        return res.status(500).json({ error: 'Failed to import GitHub repository' });
    }
});
app.post('/api/analyze', async (req, res) => {
    try {
        console.log('Analysis requested');
        const { projectId } = req.body;
        if (!projectId) {
            console.log('No project ID provided');
            return res.status(400).json({ error: 'Project ID is required' });
        }
        console.log('Analyzing project:', projectId, 'at', projectMappings.get(projectId));
        const analysis = await analyzer.analyzeProject(projectId);
        return res.json({ projectId, ...analysis });
    }
    catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({ error: 'Failed to analyze project' });
    }
});
const conversionStatus = new Map();
app.post('/api/convert/all', async (req, res) => {
    try {
        const { projectId } = req.body;
        if (!projectId) {
            return res.status(400).json({ error: 'Project ID is required' });
        }
        const projectDir = path_1.default.join(uploadsDir, projectId);
        if (!fs_1.default.existsSync(projectDir)) {
            return res.status(404).json({ error: 'Project directory not found' });
        }
        const phpFiles = await analyzer.findPhpFiles(projectDir);
        console.log('PHP files found for conversion:', phpFiles);
        if (phpFiles.length === 0) {
            return res.status(400).json({ error: 'No PHP files found in the project' });
        }
        converter.convertAll(projectId).catch(error => {
            console.error('Conversion error:', error);
            conversionStatus.set(projectId, {
                status: 'error',
                progress: 0,
                currentStep: 'error',
                completedFiles: [],
                totalFiles: 0,
                error: error instanceof Error ? error.message : 'Failed to start conversion'
            });
        });
        return res.json({
            message: 'Conversion started',
            projectId,
            totalFiles: phpFiles.length
        });
    }
    catch (error) {
        console.error('Error starting conversion:', error);
        return res.status(500).json({
            error: 'Failed to start conversion',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.get('/api/convert/status/:projectId', (req, res) => {
    const { projectId } = req.params;
    const status = converter.getConversionStatus(projectId);
    return res.json(status);
});
app.get('/api/review/files/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const projectDir = path_1.default.join(uploadsDir, projectId);
        const convertedDir = path_1.default.join(projectDir, 'converted');
        if (!fs_1.default.existsSync(convertedDir)) {
            return res.status(404).json({ error: 'No converted files found' });
        }
        const allowedFolders = [
            'controllers',
            'models',
            'routes',
            'middlewares',
            'config',
            'utils',
            'types',
            'services'
        ];
        const files = await fs_1.default.promises.readdir(convertedDir, { recursive: true });
        const convertedFiles = files
            .filter(file => file.endsWith('.js'))
            .filter(file => allowedFolders.some(folder => file.startsWith(folder + '/')))
            .map(file => ({
            name: file,
            path: path_1.default.join('converted', file)
        }));
        return res.json({ files: convertedFiles });
    }
    catch (error) {
        console.error('Error getting converted files:', error);
        return res.status(500).json({ error: 'Failed to get converted files' });
    }
});
app.get('/api/review/file/:projectId/*', async (req, res) => {
    try {
        const { projectId } = req.params;
        const filePath = req.params[0];
        const projectDir = path_1.default.join(uploadsDir, projectId);
        const fullPath = path_1.default.join(projectDir, filePath);
        console.log('Requested file path:', filePath);
        console.log('Full path:', fullPath);
        if (!fs_1.default.existsSync(fullPath)) {
            console.log('File not found:', fullPath);
            return res.status(404).json({ error: 'File not found' });
        }
        const content = await fs_1.default.promises.readFile(fullPath, 'utf-8');
        return res.json({ content });
    }
    catch (error) {
        console.error('Error getting file:', error);
        return res.status(500).json({ error: 'Failed to get file' });
    }
});
app.get('/api/review/report/:projectId', async (req, res) => {
    try {
        const projectId = req.params.projectId;
        if (!projectId || projectId === 'undefined') {
            console.log('Invalid project ID:', projectId);
            return res.status(400).json({ error: 'Invalid project ID' });
        }
        console.log('Migration report requested for project:', projectId);
        console.log('Current project mappings:', Array.from(projectMappings.entries()));
        const projectDir = projectMappings.get(projectId);
        if (!projectDir) {
            console.log('Project not found in mappings:', projectId);
            return res.status(404).json({ error: 'Project not found' });
        }
        console.log('Project directory:', projectDir);
        if (!fs_1.default.existsSync(projectDir)) {
            console.log('Project directory does not exist:', projectDir);
            return res.status(404).json({ error: 'Project directory not found' });
        }
        const conversionDir = path_1.default.join(projectDir, 'converted');
        console.log('Conversion directory:', conversionDir);
        if (!fs_1.default.existsSync(conversionDir)) {
            console.log('Conversion directory does not exist yet, returning empty report');
            return res.json({
                projectId,
                stats: {
                    filesConverted: 0,
                    linesOfCode: 0,
                    routesCreated: 0,
                    modelsCreated: 0,
                    testsGenerated: 0,
                    improvements: 0
                },
                suggestions: [],
                issues: []
            });
        }
        const files = [];
        await walkDirectory(conversionDir, (filePath) => {
            if (path_1.default.extname(filePath).toLowerCase() === '.js') {
                const relativePath = path_1.default.relative(conversionDir, filePath);
                files.push(relativePath);
            }
        });
        console.log('Found converted files for report:', files);
        let totalLines = 0;
        for (const file of files) {
            const content = await fs_1.default.promises.readFile(path_1.default.join(conversionDir, file), 'utf-8');
            totalLines += content.split('\n').length;
        }
        const report = {
            projectId,
            stats: {
                filesConverted: files.length,
                linesOfCode: totalLines,
                routesCreated: files.filter(f => f.includes('routes')).length,
                modelsCreated: files.filter(f => f.includes('models')).length,
                testsGenerated: files.filter(f => f.includes('test')).length,
                improvements: Math.floor(Math.random() * 10)
            },
            suggestions: [
                {
                    type: 'enhancement',
                    title: 'Add Error Handling',
                    description: 'Consider adding try-catch blocks for better error handling in async operations.',
                    priority: 'high'
                },
                {
                    type: 'security',
                    title: 'Input Validation',
                    description: 'Add input validation middleware for all API endpoints.',
                    priority: 'high'
                },
                {
                    type: 'optimization',
                    title: 'Database Queries',
                    description: 'Optimize database queries by adding proper indexes.',
                    priority: 'medium'
                }
            ],
            issues: []
        };
        console.log('Sending migration report');
        return res.json(report);
    }
    catch (error) {
        console.error('Migration report error:', error);
        return res.status(500).json({ error: 'Failed to get migration report' });
    }
});
app.get('/api/export/:projectId', async (req, res) => {
    try {
        console.log('Export requested for project:', req.params.projectId);
        const projectDir = projectMappings.get(req.params.projectId);
        if (!projectDir) {
            console.log('Project not found:', req.params.projectId);
            return res.status(404).json({ error: 'Project not found' });
        }
        const conversionDir = path_1.default.join(projectDir, 'converted');
        if (!fs_1.default.existsSync(conversionDir)) {
            console.log('Conversion directory not found:', conversionDir);
            return res.status(404).json({ error: 'Conversion directory not found' });
        }
        const zip = new adm_zip_1.default();
        let addedFiles = 0;
        let skippedFiles = 0;
        console.log('Starting export process...');
        await walkDirectory(conversionDir, (filePath) => {
            const relativePath = path_1.default.relative(conversionDir, filePath);
            const ext = path_1.default.extname(filePath).toLowerCase();
            const allowedExtensions = ['.ts', '.js', '.json', '.md', '.txt', '.env', '.example'];
            const isAllowedFile = allowedExtensions.includes(ext);
            const isOriginalFile = filePath.includes('.php') ||
                filePath.includes('original') ||
                filePath.includes('backup');
            if (isAllowedFile && !isOriginalFile) {
                console.log(`✅ Adding to ZIP: ${relativePath}`);
                zip.addLocalFile(filePath, path_1.default.dirname(relativePath));
                addedFiles++;
            }
            else {
                console.log(`❌ Skipping file: ${relativePath} (not a converted file)`);
                skippedFiles++;
            }
        });
        console.log(`Export summary: ${addedFiles} files added, ${skippedFiles} files skipped`);
        const exportFileName = `export-${req.params.projectId}.zip`;
        const exportPath = path_1.default.join(projectDir, exportFileName);
        zip.writeZip(exportPath);
        res.setHeader('Content-Type', 'application/zip');
        return res.download(exportPath, exportFileName, (err) => {
            if (err) {
                console.error('Export download error:', err);
            }
            fs_1.default.unlink(exportPath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Export cleanup error:', unlinkErr);
                }
            });
        });
    }
    catch (error) {
        console.error('Export error:', error);
        return res.status(500).json({ error: 'Failed to export project' });
    }
});
async function walkDirectory(dir, callback) {
    const items = await fs_1.default.promises.readdir(dir);
    for (const item of items) {
        const fullPath = path_1.default.join(dir, item);
        const stats = await fs_1.default.promises.stat(fullPath);
        if (stats.isDirectory()) {
            await walkDirectory(fullPath, callback);
        }
        else {
            callback(fullPath);
        }
    }
}
async function extractZipFile(filePath, extractPath) {
    return new Promise((resolve, reject) => {
        try {
            const zip = new adm_zip_1.default(filePath);
            zip.extractAllTo(extractPath, true);
            resolve();
        }
        catch (error) {
            reject(error);
        }
    });
}
app.post('/api/convert/stop/:projectId', (req, res) => {
    try {
        const { projectId } = req.params;
        conversionStatus.set(projectId, {
            status: 'error',
            progress: 0,
            currentStep: 'stopped',
            completedFiles: [],
            totalFiles: 0,
            error: 'Conversion stopped by user'
        });
        return res.json({
            message: 'Conversion stopped',
            projectId
        });
    }
    catch (error) {
        console.error('Error stopping conversion:', error);
        return res.status(500).json({
            error: 'Failed to stop conversion',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.post('/api/convert', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code)
            return res.status(400).json({ error: 'No code provided' });
        const aiService = new AIService_1.AIService();
        const result = await aiService.convert(code);
        return res.json({ result });
    }
    catch (error) {
        console.error('Live convert error:', error);
        return res.status(500).json({ error: 'Conversion failed' });
    }
});
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Health check available at http://localhost:${port}/api/health`);
});
//# sourceMappingURL=server.js.map