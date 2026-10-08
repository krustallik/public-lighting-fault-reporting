import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { createBootstrapPool } from '../db/bootstrapPool.js';
import { createFirstAdmin } from '../services/bootstrapAdmin.service.js';

function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Bootstrap requires an interactive terminal.'));
  }
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    const bytes: number[] = [];
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stderr.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error('Bootstrap cancelled.'));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanup();
          resolve(Buffer.from(bytes).toString('utf8'));
          return;
        }
        if (byte === 8 || byte === 127) {
          if (bytes.length > 0) {
            bytes.pop();
            while (bytes.length > 0 && (bytes[bytes.length - 1] & 0xc0) === 0x80) bytes.pop();
          }
          continue;
        }
        if (byte >= 32) bytes.push(byte);
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (process.argv.slice(2).length > 0) throw new Error('Bootstrap does not accept command-line arguments.');
  const prompt = createInterface({ input: stdin, output: stderr });
  let pool: ReturnType<typeof createBootstrapPool> | undefined;
  try {
    const username = await prompt.question('Administrator username: ');
    const fullNameInput = await prompt.question('Administrator full name (optional): ');
    prompt.close();
    const password = await readHidden('Administrator password (hidden): ');
    const confirmation = await readHidden('Confirm administrator password (hidden): ');
    if (password !== confirmation) throw new Error('Passwords do not match.');
    pool = createBootstrapPool(process.env);
    await createFirstAdmin(pool, {
      username,
      ...(fullNameInput.trim() ? { fullName: fullNameInput } : {}),
      password,
    });
    console.info('First administrator created. Remove or rotate the bootstrap credential now.');
  } finally {
    prompt.close();
    if (pool) await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Administrator bootstrap failed.');
  process.exitCode = 1;
});
