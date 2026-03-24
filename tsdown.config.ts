import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  entry: [
    'src/index.ts',
    'src/dutch-entry.ts',
    'src/dubov-entry.ts',
    'src/burstein-entry.ts',
    'src/lim-entry.ts',
    'src/double-entry.ts',
    'src/team-entry.ts',
  ],
  format: 'esm',
  minify: true,
  outDir: 'dist',
  platform: 'neutral',
  sourcemap: 'hidden',
});
