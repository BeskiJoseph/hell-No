export interface FileMapping {
    originalPath: string;
    newPath: string;
    type: 'controller' | 'model' | 'route' | 'middleware' | 'config' | 'util' | 'view';
}
export declare class StructureGenerator {
    private uploadDir;
    private dbConfigGenerator;
    constructor(uploadDir: string);
    createProjectStructure(projectId: string): Promise<void>;
    mapPhpToNodeStructure(phpFilePath: string, content: string): FileMapping;
    private isController;
    private isModel;
    private isRoute;
    private isMiddleware;
    private isConfig;
    private convertToCamelCase;
    private convertToKebabCase;
    private createMainIndex;
    private createPackageJson;
    private createTsConfig;
    private createReadme;
    private createPromptGuide;
    private createEnvExample;
}
//# sourceMappingURL=structureGenerator.d.ts.map