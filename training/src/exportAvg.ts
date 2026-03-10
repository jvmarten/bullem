import { loadCheckpoint, exportStrategy } from './cfr/index.js';

const cpFile = process.argv[2] ?? 'training/checkpoints/cfr-checkpoint-5000000.json';
const name = process.argv[3] ?? 'cfr-2p-v2-5M-average';

const engine = loadCheckpoint(cpFile);
console.log(`Loaded: ${engine.iterations} iters, ${engine.nodeCount} info sets`);

const avgPath = exportStrategy(engine, name, 'average');
console.log(`Average strategy exported: ${avgPath}`);
