import { PhpAstAnalyzer } from './services/phpAstAnalyzer';
import path from 'path';

// Get the PHP file path from command line arguments
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx ts-node src/analyzeSample.ts <path-to-php-file>');
  process.exit(1);
}

const analyzer = new PhpAstAnalyzer();
const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

try {
  const analysis = analyzer.parseFile(absPath);
  console.log('--- Structure ---');
  console.log(JSON.stringify(analysis.structure, null, 2));
  console.log('\n--- Summary ---');
  console.log(analysis.summary);
} catch (err) {
  console.error('Error analyzing file:', err);
} 