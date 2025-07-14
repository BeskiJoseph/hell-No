import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { PhpAstAnalyzer } from './phpAstAnalyzer';
import { analyzeWithGroq } from '../utils/groqClient';
import PHPParser from 'php-parser';
import * as recast from 'recast';
import * as babel from '@babel/parser';
import * as t from '@babel/types';
import { AIService } from './AIService';
import { StructureGenerator, FileMapping } from './structureGenerator';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

interface ConversionResult {
  file: string;
  success: boolean;
  result: string;
}

interface ConversionOptions {
  useAI: boolean;
  chunkSize: number;
  maxConcurrent: number;
}

interface ConversionStatus {
  status: 'in_progress' | 'completed' | 'error';
  progress: number;
  currentStep: string;
  completedFiles: number;
  totalFiles: number;
  error: string | undefined;
}

export class PHPConverter {
  private uploadDir: string;
  private parser: any;
  private options: ConversionOptions;
  private aiService: AIService;
  private structureGenerator: StructureGenerator;
  private conversionStatus: Map<string, ConversionStatus> = new Map();
  private readonly CHUNK_SIZE = 5;
  private readonly MAX_RETRIES = 3;

  constructor(uploadDir: string, options: Partial<ConversionOptions> = {}) {
    this.uploadDir = uploadDir;
    this.parser = new PHPParser.Engine({
      parser: { extractDoc: true, php7: true },
      ast: { withPositions: true }
    });
    this.options = {
      useAI: true,
      chunkSize: 5,
      maxConcurrent: 3,
      ...options
    };
    this.aiService = new AIService();
    this.structureGenerator = new StructureGenerator(uploadDir);
  }

  async convertAll(projectId: string): Promise<void> {
    console.log(`Starting conversion for project ${projectId}`);
    const projectDir = path.join(this.uploadDir, projectId);
    
    try {
      // Initialize conversion status
      this.conversionStatus.set(projectId, {
        status: 'in_progress',
        progress: 0,
        currentStep: 'initializing',
        completedFiles: 0,
        totalFiles: 0,
        error: undefined
      });

      console.log('Checking if project directory exists:', projectDir);
      if (!fs.existsSync(projectDir)) {
        throw new Error(`Project directory does not exist: ${projectDir}`);
      }

      // Create project structure first
      console.log('Creating project structure...');
      try {
        await this.structureGenerator.createProjectStructure(projectId);
        console.log('Project structure created successfully');
      } catch (structureError) {
        console.error('Error creating project structure:', structureError);
        throw new Error(`Failed to create project structure: ${structureError}`);
      }

      // Get all PHP files
      console.log('Searching for PHP files...');
      const phpFiles = await this.findPHPFiles(projectDir);
      console.log(`Found ${phpFiles.length} PHP files to convert`);

      if (phpFiles.length === 0) {
        console.log('No PHP files found, checking directory contents...');
        const items = await fs.promises.readdir(projectDir);
        console.log('Directory contents:', items);
        throw new Error('No PHP files found in project directory');
      }

      // Update total files count
      this.updateStatus(projectId, {
        totalFiles: phpFiles.length,
        currentStep: 'converting'
      });

      // Process files in chunks
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
          } catch (error) {
            console.error(`Error converting file ${file}:`, error);
            // Don't throw here, continue with other files
          }
        }));
      }

      // Mark conversion as complete
      this.updateStatus(projectId, {
        status: 'completed',
        progress: 100,
        currentStep: 'completed'
      });
      console.log(`Conversion completed for project ${projectId}`);

    } catch (error) {
      console.error(`Conversion failed for project ${projectId}:`, error);
      this.updateStatus(projectId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Conversion failed'
      });
      throw error;
    }
  }

  private updateStatus(projectId: string, updates: Partial<ConversionStatus>): void {
    const currentStatus = this.conversionStatus.get(projectId);
    if (currentStatus) {
      this.conversionStatus.set(projectId, {
        ...currentStatus,
        ...updates
      });
      console.log(`Updated status for project ${projectId}:`, this.conversionStatus.get(projectId));
    }
  }

  private async convertFile(filePath: string, projectId: string): Promise<void> {
    console.log(`Converting file: ${filePath}`);
    let retries = 0;

    while (retries < this.MAX_RETRIES) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const converted = await this.convertPHPToNode(content);
        
        // Get project directory
        const projectDir = path.join(this.uploadDir, projectId);
        const convertedDir = path.join(projectDir, 'converted');
        
        // Map PHP file to Node.js structure
        const fileMapping = this.structureGenerator.mapPhpToNodeStructure(filePath, content);
        const outputPath = path.join(convertedDir, fileMapping.newPath);
        
        // Ensure the output directory exists
        await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
        
        // Validate that the converted content looks like TypeScript/JavaScript code
        if (!this.isValidCode(converted)) {
          console.warn(`Warning: Converted content for ${filePath} may not be valid code`);
          console.warn('Content preview:', converted.substring(0, 200) + '...');
        }
        
        // Write the converted file
        await fs.promises.writeFile(outputPath, converted, 'utf8');
        
        console.log(`Successfully converted ${filePath} to ${outputPath} (${fileMapping.type})`);
        return;
      } catch (error) {
        retries++;
        console.error(`Attempt ${retries} failed for ${filePath}:`, error);
        
        if (retries === this.MAX_RETRIES) {
          throw new Error(`Failed to convert ${filePath} after ${this.MAX_RETRIES} attempts`);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }

  private async findPHPFiles(dir: string): Promise<string[]> {
    console.log(`Searching for PHP files in directory: ${dir}`);
    const files: string[] = [];
    
    try {
      const items = await fs.promises.readdir(dir);
      console.log(`Found ${items.length} items in directory`);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = await fs.promises.stat(fullPath);
        
        if (stat.isDirectory()) {
          console.log(`Found directory: ${fullPath}`);
          const subDirFiles = await this.findPHPFiles(fullPath);
          files.push(...subDirFiles);
        } else if (item.endsWith('.php')) {
          console.log(`Found PHP file: ${fullPath}`);
          files.push(fullPath);
        }
      }
      
      console.log(`Total PHP files found: ${files.length}`);
      return files;
    } catch (error) {
      console.error(`Error searching for PHP files in ${dir}:`, error);
      throw error;
    }
  }

  private async convertPHPToNode(phpCode: string): Promise<string> {
    if (this.options.useAI) {
      // Send only the PHP code, not the AST
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
      } catch (error) {
        console.error('AI conversion failed:', error);
        // Fall back to AST transformation if AI fails
        console.log('Falling back to AST transformation...');
        return this.transformAst(phpCode);
      }
    } else {
      // Use AST transformation for simple cases
      console.log('Using AST transformation for conversion...');
      const result = this.transformAst(phpCode);
      console.log('AST transformation completed');
      return result;
    }
  }

  private processAIResponse(response: string): string {
    // Extract code from AI response - look for TypeScript, JavaScript, or plain code blocks
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
    
    // If no code blocks found, return the response as-is (might be plain code)
    console.log('No code blocks found in AI response, returning as-is');
    return response.trim();
  }

  private isValidCode(content: string): boolean {
    // Basic validation to check if content looks like TypeScript/JavaScript code
    const trimmed = content.trim();
    
    // Check if it's empty or too short
    if (trimmed.length < 10) {
      return false;
    }
    
    // Check if it contains common code patterns
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

  private transformAst(phpCode: string): string {
    console.log('Starting AST transformation...');
    // Basic AST transformation logic
    const ast = this.parser.parseEval(phpCode);
    const convertedCode = this.mapPhpAstToJsAst(ast);
    const result = recast.print(convertedCode).code;
    console.log('AST mapped to JavaScript');
    console.log('AST printed to code');
    return result;
  }

  private mapPhpAstToJsAst(phpAst: any): any {
    if (!phpAst) return null;

    switch (phpAst.kind) {
      case 'program':
        return t.program(
          phpAst.children.map((child: any) => this.mapPhpAstToJsAst(child))
        );

      case 'echo':
        return t.expressionStatement(
          t.callExpression(
            t.identifier('console.log'),
            [this.mapPhpAstToJsAst(phpAst.expressions[0])]
          )
        );

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
        return t.assignmentExpression(
          '=',
          this.mapPhpAstToJsAst(phpAst.left),
          this.mapPhpAstToJsAst(phpAst.right)
        );

      case 'function':
        return t.functionDeclaration(
          t.identifier(phpAst.name),
          phpAst.arguments.map((arg: any) => t.identifier(arg.name.replace('$', ''))),
          t.blockStatement(
            phpAst.body.map((stmt: any) => this.mapPhpAstToJsAst(stmt))
          )
        );

      case 'if':
        return t.ifStatement(
          this.mapPhpAstToJsAst(phpAst.test),
          t.blockStatement(
            phpAst.body.map((stmt: any) => this.mapPhpAstToJsAst(stmt))
          ),
          phpAst.alternate ? t.blockStatement(
            phpAst.alternate.map((stmt: any) => this.mapPhpAstToJsAst(stmt))
          ) : null
        );

      case 'while':
        return t.whileStatement(
          this.mapPhpAstToJsAst(phpAst.test),
          t.blockStatement(
            phpAst.body.map((stmt: any) => this.mapPhpAstToJsAst(stmt))
          )
        );

      case 'for':
        return t.forStatement(
          this.mapPhpAstToJsAst(phpAst.init),
          this.mapPhpAstToJsAst(phpAst.test),
          this.mapPhpAstToJsAst(phpAst.update),
          t.blockStatement(
            phpAst.body.map((stmt: any) => this.mapPhpAstToJsAst(stmt))
          )
        );

      case 'foreach':
        return t.forOfStatement(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(phpAst.key ? phpAst.key.name.replace('$', '') : 'item'),
              null
            )
          ]),
          this.mapPhpAstToJsAst(phpAst.source),
          t.blockStatement(
            phpAst.body.map((stmt: any) => this.mapPhpAstToJsAst(stmt))
          )
        );

      case 'array':
        return t.arrayExpression(
          phpAst.items.map((item: any) => this.mapPhpAstToJsAst(item))
        );

      case 'call':
        return t.callExpression(
          this.mapPhpAstToJsAst(phpAst.what),
          phpAst.arguments.map((arg: any) => this.mapPhpAstToJsAst(arg))
        );

      case 'methodcall':
        return t.memberExpression(
          this.mapPhpAstToJsAst(phpAst.what),
          t.identifier(phpAst.name),
          false
        );

      case 'propertylookup':
        return t.memberExpression(
          this.mapPhpAstToJsAst(phpAst.what),
          t.identifier(phpAst.offset.name),
          false
        );

      case 'bin':
        if (phpAst.type === '&&' || phpAst.type === '||') {
          return t.logicalExpression(
            this.mapLogicalOperator(phpAst.type),
            this.mapPhpAstToJsAst(phpAst.left),
            this.mapPhpAstToJsAst(phpAst.right)
          );
        }
        return t.binaryExpression(
          this.mapPhpOperator(phpAst.type),
          this.mapPhpAstToJsAst(phpAst.left),
          this.mapPhpAstToJsAst(phpAst.right)
        );

      default:
        console.warn('Unhandled PHP AST node kind:', phpAst.kind);
        return t.expressionStatement(t.stringLiteral(`TODO: Handle ${phpAst.kind}`));
    }
  }

  private mapPhpOperator(operator: string): t.BinaryExpression['operator'] {
    const operatorMap: { [key: string]: t.BinaryExpression['operator'] } = {
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
      '.': '+' // PHP string concatenation becomes JS addition
    };
    return operatorMap[operator] || '+'; // Default to addition if operator not found
  }

  private mapLogicalOperator(operator: string): t.LogicalExpression['operator'] {
    const operatorMap: { [key: string]: t.LogicalExpression['operator'] } = {
      '&&': '&&',
      '||': '||'
    };
    return operatorMap[operator] || '&&'; // Default to AND if operator not found
  }

  private async generateProjectFiles(projectPath: string, convertedPath: string): Promise<void> {
    // Generate package.json
    const packageJson = {
      name: path.basename(projectPath),
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

    await writeFile(
      path.join(convertedPath, 'package.json'),
      JSON.stringify(packageJson, null, 2),
      'utf8'
    );

    // Generate README.md
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

    await writeFile(
      path.join(convertedPath, 'README.md'),
      readme,
      'utf8'
    );
  }

  async convert(phpCode: string, fileName: string): Promise<ConversionResult> {
    try {
      // Remove BOM and trim whitespace
      const cleanCode = phpCode.replace(/^\uFEFF/, '').trim();

      // Ensure code starts with '<?php'
      if (!cleanCode.startsWith('<?php')) {
        console.error('PHP file does not start with <?php:', fileName);
        throw new Error('PHP file must start with <?php');
      }

      // Log the first few characters for debugging
      console.log('First few characters of PHP code:', cleanCode.substring(0, 50));

      // Parse PHP code
      let ast;
      try {
        ast = this.parser.parseEval(cleanCode);
      } catch (parseError) {
        console.error('Failed to parse PHP file:', fileName, parseError);
        throw parseError;
      }
      const result = await this.convertPHPToNode(cleanCode);
      return { file: fileName, success: true, result };
    } catch (error) {
      console.error(`Error parsing PHP file ${fileName}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { file: fileName, success: false, result: `Failed to parse PHP file: ${errorMessage}` };
    }
  }

  getConversionStatus(projectId: string): ConversionStatus {
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