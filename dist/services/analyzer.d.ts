import fs from 'fs';
export declare const readFile: typeof fs.readFile.__promisify__;
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
export declare class PHPAnalyzer {
    private uploadDir;
    constructor(uploadDir: string);
    analyzeProject(projectId: string): Promise<AnalysisResult>;
    private analyzeStructure;
    private generateFileTree;
    private analyzeSummary;
    private walkDirectory;
    findPhpFiles(dir: string): Promise<string[]>;
    private countTotalLines;
}
export {};
//# sourceMappingURL=analyzer.d.ts.map