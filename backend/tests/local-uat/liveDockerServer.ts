import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLiveDockerServerSecrets } from './liveDockerSecrets.js';

async function startLiveDockerUat(): Promise<void> {
  const emailEnabled = process.env.EMAIL_VERIFICATION_ENABLED === 'true';
  loadLiveDockerServerSecrets(emailEnabled);
  const { startLiveProviderUat } = await import('./liveServer.js');
  await startLiveProviderUat();
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && invokedFile === fileURLToPath(import.meta.url)) {
  void startLiveDockerUat().catch(() => {
    console.error('Live Docker UAT refused to start because its provider or local safety configuration is incomplete.');
    process.exitCode = 1;
  });
}
