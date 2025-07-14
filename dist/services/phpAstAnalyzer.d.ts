export interface PhpAstAnalysis {
    ast: any;
    structure: {
        controllers: string[];
        models: string[];
        routes: string[];
        views: string[];
        framework: string;
        database: string;
        auth: string;
    };
    summary: string;
}
export declare class PhpAstAnalyzer {
    private parser;
    constructor();
    private extractStructureFromAst;
    parseFile(filePath: string): PhpAstAnalysis;
    private detectFramework;
    private detectDatabase;
    private detectAuth;
}
//# sourceMappingURL=phpAstAnalyzer.d.ts.map