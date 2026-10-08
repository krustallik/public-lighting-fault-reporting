import { build } from 'vite';

for (const app of ['public', 'admin']) {
  await build({ configFile: `apps/${app}/vite.config.ts` });
}
