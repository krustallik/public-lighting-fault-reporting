import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLiveDockerDatabaseSecrets } from './liveDockerSecrets.js';

async function initializeLiveDockerUat(): Promise<void> {
  loadLiveDockerDatabaseSecrets();
  await import('./dockerInit.js');
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && invokedFile === fileURLToPath(import.meta.url)) {
  void initializeLiveDockerUat().catch(() => {
    console.error('Live Docker UAT database initialization failed its local safety checks.');
    process.exitCode = 1;
  });
}
