import fs from 'fs';
import path from 'path';
import { DatabaseConfigGenerator } from './databaseConfig';

export interface FileMapping {
  originalPath: string;
  newPath: string;
  type: 'controller' | 'model' | 'route' | 'middleware' | 'config' | 'util' | 'view';
}

export class StructureGenerator {
  private uploadDir: string;
  private dbConfigGenerator: DatabaseConfigGenerator;

  constructor(uploadDir: string) {
    this.uploadDir = uploadDir;
    this.dbConfigGenerator = new DatabaseConfigGenerator(uploadDir);
  }

  // Create standard Node.js project structure
  async createProjectStructure(projectId: string): Promise<void> {
    console.log(`Creating project structure for ${projectId}`);
    const projectDir = path.join(this.uploadDir, projectId);
    const convertedDir = path.join(projectDir, 'converted');

    console.log('Project directory:', projectDir);
    console.log('Converted directory:', convertedDir);

    // Check if project directory exists
    if (!fs.existsSync(projectDir)) {
      throw new Error(`Project directory does not exist: ${projectDir}`);
    }

    const folders = [
      'controllers',
      'models',
      'routes',
      'middlewares',
      'config',
      'utils',
      'types',
      'services'
    ];

    console.log('Creating folders:', folders);
    for (const folder of folders) {
      const folderPath = path.join(convertedDir, folder);
      console.log('Creating folder:', folderPath);
      await fs.promises.mkdir(folderPath, { recursive: true });
    }

    console.log('Creating project files...');
    // Create main index.ts file
    await this.createMainIndex(convertedDir);
    
    // Create package.json
    await this.createPackageJson(convertedDir);
    
    // Create tsconfig.json
    await this.createTsConfig(convertedDir);
    
    // Create README.md
    await this.createReadme(convertedDir);
    
    // Create prompt.md
    await this.createPromptGuide(convertedDir);
    
    // Create .env.example
    await this.createEnvExample(convertedDir);
    
    // Create database configuration
    await this.dbConfigGenerator.createDatabaseConfig(projectId);
    
    console.log('Project structure created successfully');
  }

  // Map PHP file paths to Node.js structure
  mapPhpToNodeStructure(phpFilePath: string, content: string): FileMapping {
    const fileName = path.basename(phpFilePath, '.php');
    const lowerFileName = fileName.toLowerCase();

    // Detect file type based on content and filename
    if (this.isController(content, fileName)) {
      return {
        originalPath: phpFilePath,
        newPath: `controllers/${this.convertToCamelCase(fileName)}.ts`,
        type: 'controller'
      };
    }

    if (this.isModel(content, fileName)) {
      return {
        originalPath: phpFilePath,
        newPath: `models/${this.convertToCamelCase(fileName)}.ts`,
        type: 'model'
      };
    }

    if (this.isRoute(content, fileName)) {
      return {
        originalPath: phpFilePath,
        newPath: `routes/${this.convertToKebabCase(fileName)}.ts`,
        type: 'route'
      };
    }

    if (this.isMiddleware(content, fileName)) {
      return {
        originalPath: phpFilePath,
        newPath: `middlewares/${this.convertToCamelCase(fileName)}.ts`,
        type: 'middleware'
      };
    }

    if (this.isConfig(content, fileName)) {
      return {
        originalPath: phpFilePath,
        newPath: `config/${this.convertToCamelCase(fileName)}.ts`,
        type: 'config'
      };
    }

    // Default to utils
    return {
      originalPath: phpFilePath,
      newPath: `utils/${this.convertToCamelCase(fileName)}.ts`,
      type: 'util'
    };
  }

  // Helper methods to detect file types
  private isController(content: string, fileName: string): boolean {
    const controllerPatterns = [
      /class.*Controller/,
      /extends.*Controller/,
      /public function.*\(/,
      /return.*view\(/,
      /return.*json\(/
    ];
    
    return controllerPatterns.some(pattern => pattern.test(content)) ||
           fileName.toLowerCase().includes('controller');
  }

  private isModel(content: string, fileName: string): boolean {
    const modelPatterns = [
      /class.*Model/,
      /extends.*Model/,
      /protected \$table/,
      /protected \$fillable/,
      /public static function/
    ];
    
    return modelPatterns.some(pattern => pattern.test(content)) ||
           fileName.toLowerCase().includes('model');
  }

  private isRoute(content: string, fileName: string): boolean {
    const routePatterns = [
      /Route::/,
      /router->/,
      /get\(/,
      /post\(/,
      /put\(/,
      /delete\(/
    ];
    
    return routePatterns.some(pattern => pattern.test(content)) ||
           fileName.toLowerCase().includes('route');
  }

  private isMiddleware(content: string, fileName: string): boolean {
    const middlewarePatterns = [
      /middleware/,
      /auth/,
      /validate/,
      /handle\(/,
      /next\(/
    ];
    
    return middlewarePatterns.some(pattern => pattern.test(content)) ||
           fileName.toLowerCase().includes('middleware');
  }

  private isConfig(content: string, fileName: string): boolean {
    const configPatterns = [
      /config/,
      /database/,
      /connection/,
      /env/,
      /define\(/
    ];
    
    return configPatterns.some(pattern => pattern.test(content)) ||
           fileName.toLowerCase().includes('config');
  }

  // String conversion helpers
  private convertToCamelCase(str: string): string {
    return str.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
  }

  private convertToKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  // Create main index.ts file
  private async createMainIndex(convertedDir: string): Promise<void> {
    const indexContent = `import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/database';

// Import routes
import userRoutes from './routes/user-routes';
// Add more route imports as needed

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/users', userRoutes);
// Add more routes as needed

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(\`Server running on port \${PORT}\`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
`;

    await fs.promises.writeFile(path.join(convertedDir, 'index.ts'), indexContent);
  }

  // Create package.json
  private async createPackageJson(convertedDir: string): Promise<void> {
    const packageJson = {
      name: "converted-nodejs-app",
      version: "1.0.0",
      description: "PHP to Node.js converted application",
      main: "index.ts",
      scripts: {
        "start": "node dist/index.js",
        "dev": "ts-node index.ts",
        "build": "tsc",
        "test": "jest"
      },
      dependencies: {
        "express": "^4.18.2",
        "cors": "^2.8.5",
        "dotenv": "^16.3.1",
        "mongoose": "^8.0.0",
        "bcryptjs": "^2.4.3",
        "jsonwebtoken": "^9.0.2",
        "express-validator": "^7.0.1"
      },
      devDependencies: {
        "@types/express": "^4.17.21",
        "@types/cors": "^2.8.17",
        "@types/node": "^20.10.0",
        "@types/bcryptjs": "^2.4.6",
        "@types/jsonwebtoken": "^9.0.5",
        "typescript": "^5.3.0",
        "ts-node": "^10.9.1",
        "nodemon": "^3.0.2"
      }
    };

    await fs.promises.writeFile(
      path.join(convertedDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
  }

  // Create tsconfig.json
  private async createTsConfig(convertedDir: string): Promise<void> {
    const tsConfig = {
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        outDir: "./dist",
        rootDir: "./",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true
      },
      include: [
        "**/*"
      ],
      exclude: [
        "node_modules",
        "dist"
      ]
    };

    await fs.promises.writeFile(
      path.join(convertedDir, 'tsconfig.json'),
      JSON.stringify(tsConfig, null, 2)
    );
  }

  // Create README.md
  private async createReadme(convertedDir: string): Promise<void> {
    const readmeContent = `# PHP → Node.js Converted Project

This project was automatically converted from PHP to Node.js using AI-powered conversion tools.

## 🚀 Quick Start

\`\`\`bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials

# Run in development
npm run dev

# Build for production
npm run build
npm start
\`\`\`

## 📁 Project Structure

- \`controllers/\` - Business logic and request handlers
- \`models/\` - Database schemas and models
- \`routes/\` - API route definitions
- \`middlewares/\` - Authentication and validation middleware
- \`config/\` - Database and application configuration
- \`utils/\` - Helper functions and utilities
- \`types/\` - TypeScript type definitions
- \`services/\` - Business service layer

## 🔧 Features

- ✅ Express.js with TypeScript
- ✅ MongoDB with Mongoose (or configure for your database)
- ✅ JWT Authentication
- ✅ Input validation
- ✅ Error handling middleware
- ✅ CORS enabled
- ✅ Environment variable configuration

## 📝 Notes

- This is an automatically converted project
- Review and test all functionality before production use
- Some manual adjustments may be needed for complex logic
- Check the \`prompt.md\` file for AI guidance on extending features

## 🤝 Contributing

1. Review the converted code
2. Add missing functionality
3. Improve error handling
4. Add comprehensive tests
5. Update documentation

## 📄 License

This project is converted from PHP source code.
`;

    await fs.promises.writeFile(path.join(convertedDir, 'README.md'), readmeContent);
  }

  // Create prompt.md
  private async createPromptGuide(convertedDir: string): Promise<void> {
    const promptContent = `# AI Prompt Guide

This file contains prompts you can use with AI assistants to extend or improve this converted Node.js application.

## 🏗️ Adding New Features

### Authentication
> "Add JWT-based authentication with role-based access control using middleware in Express and Mongoose. Include user registration, login, and protected routes."

### Database Operations
> "Add CRUD operations for [Entity] with Mongoose schema, validation, and proper error handling. Include pagination and search functionality."

### API Endpoints
> "Create RESTful API endpoints for [Resource] with proper HTTP status codes, validation, and error handling."

### Middleware
> "Add input validation middleware using express-validator for all API endpoints with custom error messages."

## 🔧 Common Improvements

### Error Handling
> "Implement comprehensive error handling with custom error classes, logging, and proper HTTP status codes."

### Validation
> "Add request validation using Joi or express-validator with custom error messages and sanitization."

### Testing
> "Create unit tests using Jest for controllers, models, and middleware with proper mocking."

### Documentation
> "Generate API documentation using Swagger/OpenAPI with examples and proper descriptions."

## 📋 Project Structure Guidelines

- All controllers are in \`controllers/\`
- Routes are in \`routes/\` and linked to controllers
- DB logic handled in \`models/\` with Mongoose
- Auth middleware is in \`middlewares/auth.ts\`
- Helper functions in \`utils/\`
- Type definitions in \`types/\`
- Business logic in \`services/\`

## 🎯 Best Practices

1. Use TypeScript interfaces for all data structures
2. Implement proper error handling with try-catch blocks
3. Use async/await for all asynchronous operations
4. Add input validation for all API endpoints
5. Use environment variables for configuration
6. Implement proper logging
7. Add comprehensive error messages
8. Use middleware for cross-cutting concerns

## 🔍 Code Quality

> "Review this code and suggest improvements for performance, security, and maintainability. Include specific code examples."

## 🚀 Deployment

> "Create Docker configuration for this Node.js application with proper environment setup and production optimizations."
`;

    await fs.promises.writeFile(path.join(convertedDir, 'prompt.md'), promptContent);
  }

  // Create .env.example
  private async createEnvExample(convertedDir: string): Promise<void> {
    const envContent = `# Application Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/your_database
# For PostgreSQL: DATABASE_URL=postgresql://user:password@localhost:5432/database

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d

# CORS Configuration
CORS_ORIGIN=http://localhost:3000

# Logging
LOG_LEVEL=info

# Optional: External Services
# REDIS_URL=redis://localhost:6379
# AWS_ACCESS_KEY_ID=your_aws_key
# AWS_SECRET_ACCESS_KEY=your_aws_secret
`;

    await fs.promises.writeFile(path.join(convertedDir, '.env.example'), envContent);
  }
} 