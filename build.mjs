// Build da extensão: 4 bundles + arquivos estáticos → dist/
// Uso: node build.mjs [--watch]
import { build, context } from 'esbuild';
import { copyFile, mkdir, rm, cp, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

const WATCH = process.argv.includes('--watch');
const DIST = 'dist';

/** Cada bundle tem formato próprio por causa das regras do MV3. */
const ENTRIES = [
  // Content script não pode ser módulo ES → IIFE.
  { entry: 'src/content/index.ts', out: 'content.js', format: 'iife' },
  // SW é módulo (declarado no manifest como type: module).
  { entry: 'src/sw.ts', out: 'sw.js', format: 'esm' },
  // Páginas de UI são <script type="module">.
  { entry: 'src/sidepanel/main.ts', out: 'sidepanel.js', format: 'esm' },
  { entry: 'src/dashboard/main.ts', out: 'dashboard.js', format: 'esm' },
];

/** Arquivos copiados como estão. */
const STATIC = [
  ['public/manifest.json', 'manifest.json'],
  ['src/sidepanel/index.html', 'sidepanel.html'],
  ['src/dashboard/index.html', 'dashboard.html'],
  ['src/shared/theme.css', 'theme.css'],
  ['src/sidepanel/style.css', 'sidepanel.css'],
  ['src/dashboard/style.css', 'dashboard.css'],
];

const STATIC_DIRS = [['public/icons', 'icons']];

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyStatics() {
  const missing = [];
  for (const [from, to] of STATIC) {
    if (!(await exists(from))) {
      missing.push(from);
      continue;
    }
    await mkdir(dirname(join(DIST, to)), { recursive: true });
    await copyFile(from, join(DIST, to));
  }
  for (const [from, to] of STATIC_DIRS) {
    if (!(await exists(from))) {
      missing.push(from + '/');
      continue;
    }
    await cp(from, join(DIST, to), { recursive: true });
  }
  return missing;
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const missingEntries = [];
  for (const { entry } of ENTRIES) {
    if (!(await exists(entry))) missingEntries.push(entry);
  }
  if (missingEntries.length) {
    console.error('\n[build] Faltando arquivos de entrada:');
    for (const m of missingEntries) console.error('  - ' + m);
    console.error('\nCrie os stubs da Fase 1 (docs/PROMPTS.md) e rode de novo.\n');
    process.exit(1);
  }

  const options = (e) => ({
    entryPoints: [e.entry],
    outfile: join(DIST, e.out),
    bundle: true,
    format: e.format,
    target: 'chrome116',
    platform: 'browser',
    sourcemap: WATCH ? 'inline' : false,
    minify: !WATCH,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  if (WATCH) {
    const ctxs = await Promise.all(ENTRIES.map((e) => context(options(e))));
    await Promise.all(ctxs.map((c) => c.watch()));
    const missing = await copyStatics();
    if (missing.length) console.warn('[build] estáticos ausentes (ok no início):', missing);
    console.log('[build] watching… (recarregue a extensão no Chrome após cada mudança)');
    return;
  }

  await Promise.all(ENTRIES.map((e) => build(options(e))));
  const missing = await copyStatics();
  if (missing.length) {
    console.warn('\n[build] Estáticos ausentes:');
    for (const m of missing) console.warn('  - ' + m);
  }
  console.log('\n[build] dist/ pronto → chrome://extensions → Recarregar\n');
}

main().catch((err) => {
  console.error('[build] falhou:', err);
  process.exit(1);
});
