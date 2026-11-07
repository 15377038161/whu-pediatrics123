import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.next-training/**', '.next-exam/**',
    'deliverables/**',
    'dist/**',
    'node_modules/**',
    'demo/**',
    'backups/**',
    'output/**',
    'outputs/**',
    'docs/**',
    'qa/**',
  ]),
]);
