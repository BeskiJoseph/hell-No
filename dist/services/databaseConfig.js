"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseConfigGenerator = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DatabaseConfigGenerator {
    constructor(uploadDir) {
        this.uploadDir = uploadDir;
    }
    async createDatabaseConfig(projectId) {
        const projectDir = path_1.default.join(this.uploadDir, projectId);
        const configDir = path_1.default.join(projectDir, 'converted', 'config');
        await this.createDatabaseFile(configDir);
        await this.createDatabaseTypes(projectDir);
    }
    async createDatabaseFile(configDir) {
        const databaseContent = `import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/converted_app';

export const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  } catch (error) {
    console.error('MongoDB disconnection error:', error);
  }
};

// Handle connection events
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

process.on('SIGINT', async () => {
  await disconnectDB();
  process.exit(0);
});
`;
        await fs_1.default.promises.writeFile(path_1.default.join(configDir, 'database.ts'), databaseContent, 'utf8');
    }
    async createDatabaseTypes(projectDir) {
        const typesDir = path_1.default.join(projectDir, 'converted', 'types');
        const typesContent = `// Database Types

export interface BaseDocument {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDocument extends BaseDocument {
  email: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
  isActive: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Request/Response Types
export interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  role?: 'user' | 'admin';
}

export interface UpdateUserRequest {
  email?: string;
  name?: string;
  role?: 'user' | 'admin';
  isActive?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: Omit<UserDocument, 'password'>;
}

// Error Types
export interface ValidationError {
  field: string;
  message: string;
}

export interface ApiError {
  status: number;
  message: string;
  errors?: ValidationError[];
}
`;
        await fs_1.default.promises.writeFile(path_1.default.join(typesDir, 'database.ts'), typesContent, 'utf8');
    }
}
exports.DatabaseConfigGenerator = DatabaseConfigGenerator;
//# sourceMappingURL=databaseConfig.js.map