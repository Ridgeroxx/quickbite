import * as esbuild from 'esbuild';
import packageJson from './package.json' with { type: 'json' };
// Exclude external dependencies from the bundle
const external = Object.keys(packageJson.dependencies || {});

await esbuild.build({
  entryPoints: ['./src/index.ts'], // Ensure this matches your main entry file
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/index.mjs',
  sourcemap: true,
  external,
  tsconfig: 'tsconfig.json',
});