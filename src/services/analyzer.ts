import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import { PhpAstAnalyzer } from './phpAstAnalyzer';
import { analyzeWithGroq } from '../utils/groqClient';

export const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

interface AnalysisResult {
  structure: {
    routes: string[];
    controllers: string[];
    models: string[];
    authType: string;
    database: string;
  };
  summary: {
    purpose: string;
    dependencies: string[];
    complexity: 'low' | 'medium' | 'high';
  };
  fileTree: FileNode[];
}

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: FileNode[];
}

export class PHPAnalyzer {
  private uploadDir: string;

  constructor(uploadDir: string) {
    this.uploadDir = uploadDir;
  }

  async analyzeProject(projectId: string): Promise<AnalysisResult> {
    const projectPath = path.join(this.uploadDir, projectId);
    
    // Check if project exists
    if (!fs.existsSync(projectPath)) {
      throw new Error('Project not found');
    }

    // Check if it's a zip file that needs extraction
    const files = await readdir(projectPath);
    const zipFile = files.find(file => file.toLowerCase().endsWith('.zip'));
    
    if (zipFile) {
      const zipPath = path.join(projectPath, zipFile);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(projectPath, true);
    }

    // Generate file tree
    const fileTree = await this.generateFileTree(projectPath);
    // Find PHP files
    const phpFiles = await this.findPhpFiles(projectPath);
    // Sample up to 5 PHP files for analysis
    const sampleFiles = phpFiles.slice(0, 5);
    let filesContent = '';
    for (const file of sampleFiles) {
      const content = await readFile(file, 'utf-8');
      filesContent += `File: ${file}\n${content}\n\n`;
    }
    // Prepare Groq prompt
    const prompt = `You are an expert PHP-to-Node.js migration assistant.\nGiven the following PHP project files, analyze the project and provide a JSON object with the following structure:\n{\n  \"structure\": {\n    \"routes\": string[],\n    \"controllers\": string[],\n    \"models\": string[],\n    \"authType\": string,\n    \"database\": string\n  },\n  \"summary\": {\n    \"purpose\": string,\n    \"dependencies\": string[],\n    \"complexity\": \"low\"|\"medium\"|\"high\"\n  },\n  \"conversionSuggestions\": string\n}\nAnalyze the files and fill in the JSON fields.\n\n${filesContent}`;
    // Call Groq
    const aiResponse = await analyzeWithGroq(prompt);
    let aiResult: any;
    try {
      aiResult = JSON.parse(aiResponse);
    } catch (e) {
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

  private async analyzeStructure(projectPath: string) {
    const routes: string[] = [];
    const controllers: string[] = [];
    const models: string[] = [];
    let authType = 'none';
    let database = 'unknown';
    const astAnalyzer = new PhpAstAnalyzer();

    // Walk through all PHP files
    await this.walkDirectory(projectPath, async (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.php') {
        try {
          const analysis = astAnalyzer.parseFile(filePath);
          // Use AST-based detection for structure
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
        } catch (err) {
          // fallback to string-based detection if AST fails
          const content = await readFile(filePath, 'utf-8');
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
          } else if (content.includes('session_start()')) {
            authType = 'session';
          }
          if (content.includes('DB::') || content.includes('Eloquent')) {
            database = 'mysql';
          } else if (content.includes('PDO')) {
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

  private async generateFileTree(dirPath: string, basePath: string = ''): Promise<FileNode[]> {
    const items = await readdir(dirPath);
    const tree: FileNode[] = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = path.join(basePath, item);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        const children = await this.generateFileTree(fullPath, relativePath);
        tree.push({
          name: item,
          type: 'folder',
          path: relativePath,
          children
        });
      } else {
        tree.push({
          name: item,
          type: 'file',
          path: relativePath
        });
      }
    }

    return tree;
  }

  private async analyzeSummary(projectPath: string) {
    const dependencies: string[] = [];
    let complexity: 'low' | 'medium' | 'high' = 'low';
    let purpose = 'Unknown';

    // Analyze composer.json if it exists
    const composerPath = path.join(projectPath, 'composer.json');
    if (fs.existsSync(composerPath)) {
      const composerContent = await readFile(composerPath, 'utf-8');
      const composerJson = JSON.parse(composerContent);
      
      if (composerJson.require) {
        dependencies.push(...Object.keys(composerJson.require));
      }
    }

    // Analyze project structure for complexity
    const phpFiles = await this.findPhpFiles(projectPath);
    console.log('PHP files found for conversion:', phpFiles);
    const totalLines = await this.countTotalLines(phpFiles);
    
    if (totalLines > 10000) {
      complexity = 'high';
    } else if (totalLines > 5000) {
      complexity = 'medium';
    }

    // Try to determine project purpose
    if (phpFiles.some(file => file.includes('api'))) {
      purpose = 'API Service';
    } else if (phpFiles.some(file => file.includes('admin'))) {
      purpose = 'Admin Panel';
    } else if (phpFiles.some(file => file.includes('auth'))) {
      purpose = 'Authentication System';
    }

    return {
      purpose,
      dependencies,
      complexity
    };
  }

  private async walkDirectory(dir: string, callback: (filePath: string) => Promise<void>) {
    const items = await readdir(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stats = await stat(fullPath);
      
      if (stats.isDirectory()) {
        await this.walkDirectory(fullPath, callback);
      } else {
        await callback(fullPath);
      }
    }
  }

  public async findPhpFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    await this.walkDirectory(dir, async (filePath) => {
      if (path.extname(filePath).toLowerCase() === '.php') {
        files.push(filePath);
      }
    });
    return files;
  }

  private async countTotalLines(files: string[]): Promise<number> {
    let totalLines = 0;
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      totalLines += content.split('\n').length;
    }
    return totalLines;
  }
} 