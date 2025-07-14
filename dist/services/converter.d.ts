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
export declare class PHPConverter {
    private uploadDir;
    private parser;
    private options;
    private aiService;
    private structureGenerator;
    private conversionStatus;
    private readonly CHUNK_SIZE;
    private readonly MAX_RETRIES;
    constructor(uploadDir: string, options?: Partial<ConversionOptions>);
    convertAll(projectId: string): Promise<void>;
    private updateStatus;
    private convertFile;
    private findPHPFiles;
    private convertPHPToNode;
    private processAIResponse;
    private isValidCode;
    private transformAst;
    private mapPhpAstToJsAst;
    private mapPhpOperator;
    private mapLogicalOperator;
    private generateProjectFiles;
    convert(phpCode: string, fileName: string): Promise<ConversionResult>;
    getConversionStatus(projectId: string): ConversionStatus;
}
export {};
//# sourceMappingURL=converter.d.ts.map