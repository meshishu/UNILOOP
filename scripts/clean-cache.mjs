import fs from 'node:fs';
import path from 'node:path';

const cacheDir = path.resolve('apps/web/.next/cache');
if (fs.existsSync(cacheDir)) {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  console.log('Successfully cleaned .next/cache before deployment.');
}
