import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { PHPAnalyzer } from './services/analyzer';
import { PHPConverter } from './services/converter';
import AdmZip from 'adm-zip';
import { AIService } from './services/AIService';
const axios = require('axios');
const { readFile } = fs.promises;

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: ['http://localhost:8081', 'http://localhost:8080', 'http://localhost:3000', 'http://localhost:8082'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize services
const analyzer = new PHPAnalyzer(uploadsDir);
const converter = new PHPConverter(uploadsDir);
const aiService = new AIService();

// Store project mappings
const projectMappings = new Map<string, string>();

// Load project mappings from file if it exists
const mappingsFile = path.join(uploadsDir, 'project_mappings.json');
if (fs.existsSync(mappingsFile)) {
  const mappings = JSON.parse(fs.readFileSync(mappingsFile, 'utf-8'));
  Object.entries(mappings).forEach(([projectId, projectDir]) => {
    projectMappings.set(projectId, projectDir as string);
  });
}

// Save project mappings to file
function saveProjectMappings() {
  const mappings = Object.fromEntries(projectMappings.entries());
  fs.writeFileSync(mappingsFile, JSON.stringify(mappings, null, 2));
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = uuidv4();
    const projectDir = path.join(uploadsDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    projectMappings.set(projectId, projectDir);
    saveProjectMappings(); // Save mappings after adding new project
    cb(null, projectDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.php', '.zip', '.sql'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .php, .zip, and .sql files are allowed.'));
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// File upload endpoint
app.post('/api/upload/file', upload.single('file'), async (req, res) => {
  try {
    console.log('File upload requested');
    if (!req.file) {
      console.log('No file received');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const projectId = path.basename(path.dirname(req.file.path));
    console.log(`File received: ${req.file.originalname} in project ${projectId}`);

    // If it's a zip file, extract it
    if (path.extname(req.file.originalname).toLowerCase() === '.zip') {
      console.log('Extracting zip file...');
      await extractZipFile(req.file.path, path.dirname(req.file.path));
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
  } catch (error) {
    console.error('File upload error:', error);
    return res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Text upload endpoint
app.post('/api/upload/text', (req, res) => {
  try {
    console.log('Text upload requested');
    console.log('Request body:', req.body);
    const { code } = req.body;
    if (!code) {
      console.log('No code received');
      return res.status(400).json({ error: 'No code provided. Expected field: code' });
    }

    const projectId = uuidv4();
    const projectDir = path.join(uploadsDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    projectMappings.set(projectId, projectDir);

    // Ensure code starts with '<?php'
    const phpCode = code.trim().startsWith('<?php') ? code : `<?php\n${code}`;

    // Save the code to a file
    const filePath = path.join(projectDir, 'direct-code.php');
    fs.writeFileSync(filePath, phpCode);

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
  } catch (error) {
    console.error('Text upload error:', error);
    return res.status(500).json({ error: 'Failed to process code' });
  }
});

// GitHub import endpoint
app.post('/api/upload/github', async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: 'No repository URL provided. Expected field: repoUrl' });
    }

    // Parse owner/repo from URL
    const match = repoUrl.match(/github.com\/([^/]+)\/([^/]+)(?:\.git)?/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');

    // Download ZIP from GitHub (try main, then master branch)
    let zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
    let zipResponse;
    try {
      zipResponse = await axios.get(zipUrl, { responseType: 'arraybuffer' });
    } catch (err) {
      // Try master branch if main fails
      zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`;
      zipResponse = await axios.get(zipUrl, { responseType: 'arraybuffer' });
    }

    // Create project folder
    const projectId = uuidv4();
    const projectDir = path.join(uploadsDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    // Save ZIP and extract
    const zipPath = path.join(projectDir, 'repo.zip');
    fs.writeFileSync(zipPath, zipResponse.data);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(projectDir, true);
    fs.unlinkSync(zipPath); // Remove ZIP after extraction

    projectMappings.set(projectId, projectDir);

    // Count PHP files
    let phpFiles: string[] = [];
    function walk(dir: string) {
      fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
        else if (file.endsWith('.php')) phpFiles.push(fullPath);
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
  } catch (error) {
    console.error('GitHub import error:', error);
    return res.status(500).json({ error: 'Failed to import GitHub repository' });
  }
});

// Analysis endpoint
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
    // Ensure projectId is included in the response
    return res.json({ projectId, ...analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Failed to analyze project' });
  }
});

// Track conversion status
const conversionStatus = new Map<string, { 
  status: 'converting' | 'completed' | 'error', 
  progress: number,
  currentStep: string,
  completedFiles: string[],
  totalFiles: number,
  error?: string 
}>();

// Start conversion process
app.post('/api/convert/all', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const projectDir = path.join(uploadsDir, projectId);
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project directory not found' });
    }

    // Get all PHP files
    const phpFiles = await analyzer.findPhpFiles(projectDir);
    console.log('PHP files found for conversion:', phpFiles);

    if (phpFiles.length === 0) {
      return res.status(400).json({ error: 'No PHP files found in the project' });
    }

    // Start conversion in background
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
  } catch (error) {
    console.error('Error starting conversion:', error);
    return res.status(500).json({ 
      error: 'Failed to start conversion',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get conversion status
app.get('/api/convert/status/:projectId', (req, res) => {
  const { projectId } = req.params;
  const status = converter.getConversionStatus(projectId);
  return res.json(status);
});

// Get list of converted files
app.get('/api/review/files/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectDir = path.join(uploadsDir, projectId);
    const convertedDir = path.join(projectDir, 'converted');

    // Check if converted directory exists
    if (!fs.existsSync(convertedDir)) {
      return res.status(404).json({ error: 'No converted files found' });
    }

    // Only include files in these folders
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

    const files = await fs.promises.readdir(convertedDir, { recursive: true });
    const convertedFiles = files
      .filter(file => file.endsWith('.js'))
      .filter(file => allowedFolders.some(folder => file.startsWith(folder + '/')))
      .map(file => ({
        name: file,
        path: path.join('converted', file)
      }));

    return res.json({ files: convertedFiles });
  } catch (error) {
    console.error('Error getting converted files:', error);
    return res.status(500).json({ error: 'Failed to get converted files' });
  }
});

// Get specific converted file
app.get('/api/review/file/:projectId/*', async (req, res) => {
  try {
    const { projectId } = req.params;
    const filePath = (req.params as any)[0]; // This captures the wildcard path
    const projectDir = path.join(uploadsDir, projectId);
    const fullPath = path.join(projectDir, filePath);

    console.log('Requested file path:', filePath);
    console.log('Full path:', fullPath);

    if (!fs.existsSync(fullPath)) {
      console.log('File not found:', fullPath);
      return res.status(404).json({ error: 'File not found' });
    }

    const content = await fs.promises.readFile(fullPath, 'utf-8');
    return res.json({ content });
  } catch (error) {
    console.error('Error getting file:', error);
    return res.status(500).json({ error: 'Failed to get file' });
  }
});

// Review report endpoint
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
    if (!fs.existsSync(projectDir)) {
      console.log('Project directory does not exist:', projectDir);
      return res.status(404).json({ error: 'Project directory not found' });
    }

    const conversionDir = path.join(projectDir, 'converted');
    console.log('Conversion directory:', conversionDir);
    if (!fs.existsSync(conversionDir)) {
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

    // Get all converted files
    const files: string[] = [];
    await walkDirectory(conversionDir, (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.js') {
        const relativePath = path.relative(conversionDir, filePath);
        files.push(relativePath);
      }
    });

    console.log('Found converted files for report:', files);

    // Count lines of code
    let totalLines = 0;
    for (const file of files) {
      const content = await fs.promises.readFile(path.join(conversionDir, file), 'utf-8');
      totalLines += content.split('\n').length;
    }

    // Generate report
    const report = {
      projectId,
      stats: {
        filesConverted: files.length,
        linesOfCode: totalLines,
        routesCreated: files.filter(f => f.includes('routes')).length,
        modelsCreated: files.filter(f => f.includes('models')).length,
        testsGenerated: files.filter(f => f.includes('test')).length,
        improvements: Math.floor(Math.random() * 10) // Placeholder for actual improvements
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
  } catch (error) {
    console.error('Migration report error:', error);
    return res.status(500).json({ error: 'Failed to get migration report' });
  }
});

// Export endpoint
app.get('/api/export/:projectId', async (req, res) => {
  try {
    console.log('Export requested for project:', req.params.projectId);
    const projectDir = projectMappings.get(req.params.projectId);
    
    if (!projectDir) {
      console.log('Project not found:', req.params.projectId);
      return res.status(404).json({ error: 'Project not found' });
    }

    const conversionDir = path.join(projectDir, 'converted');
    if (!fs.existsSync(conversionDir)) {
      console.log('Conversion directory not found:', conversionDir);
      return res.status(404).json({ error: 'Conversion directory not found' });
    }

    // Create a zip file containing only converted files (exclude original PHP files)
    const zip = new AdmZip();
    let addedFiles = 0;
    let skippedFiles = 0;
    
    console.log('Starting export process...');
    await walkDirectory(conversionDir, (filePath) => {
      const relativePath = path.relative(conversionDir, filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      // Only include converted files, exclude original PHP files and other non-converted files
      const allowedExtensions = ['.ts', '.js', '.json', '.md', '.txt', '.env', '.example'];
      const isAllowedFile = allowedExtensions.includes(ext);
      
      // Also exclude files that are clearly not converted (like original PHP files)
      const isOriginalFile = filePath.includes('.php') || 
                           filePath.includes('original') || 
                           filePath.includes('backup');
      
      if (isAllowedFile && !isOriginalFile) {
        console.log(`✅ Adding to ZIP: ${relativePath}`);
        zip.addLocalFile(filePath, path.dirname(relativePath));
        addedFiles++;
      } else {
        console.log(`❌ Skipping file: ${relativePath} (not a converted file)`);
        skippedFiles++;
      }
    });
    
    console.log(`Export summary: ${addedFiles} files added, ${skippedFiles} files skipped`);

    // Generate a unique filename for the export
    const exportFileName = `export-${req.params.projectId}.zip`;
    const exportPath = path.join(projectDir, exportFileName);
    zip.writeZip(exportPath);

    // Send the file
    res.setHeader('Content-Type', 'application/zip');
    return res.download(exportPath, exportFileName, (err) => {
      if (err) {
        console.error('Export download error:', err);
      }
      // Clean up the export file after sending
      fs.unlink(exportPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Export cleanup error:', unlinkErr);
        }
      });
    });
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Failed to export project' });
  }
});

// Helper function to walk directory
async function walkDirectory(dir: string, callback: (filePath: string) => void) {
  const items = await fs.promises.readdir(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stats = await fs.promises.stat(fullPath);
    
    if (stats.isDirectory()) {
      await walkDirectory(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

// Helper function to extract zip files
async function extractZipFile(filePath: string, extractPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const zip = new AdmZip(filePath);
      zip.extractAllTo(extractPath, true);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// Stop conversion process
app.post('/api/convert/stop/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Update status to error with stopped message
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
  } catch (error) {
    console.error('Error stopping conversion:', error);
    return res.status(500).json({ 
      error: 'Failed to stop conversion',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Live code conversion endpoint
app.post('/api/convert', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    const aiService = new AIService();
    const result = await aiService.convert(code);

    return res.json({ result });
  } catch (error) {
    console.error('Live convert error:', error);
    return res.status(500).json({ error: 'Conversion failed' });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check available at http://localhost:${port}/api/health`);
}); 