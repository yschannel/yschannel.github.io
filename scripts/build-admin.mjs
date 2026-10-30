import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('admin/dist', { recursive: true });
await build({ entryPoints: ['admin/editor.js'], bundle: true, format: 'esm', minify: true, outfile: 'admin/dist/editor.js', legalComments: 'eof' });
for (const file of ['index.html', 'editor.css']) await copyFile(`admin/${file}`, `admin/dist/${file}`);
console.log('Editor built in admin/dist');
