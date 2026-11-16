# LinkedIn Post Scanner

Extensão Chrome (Manifest V3): rola o feed do LinkedIn, extrai posts, resume com a sua chave de IA e calcula match de vagas. Tudo dentro do navegador — sem backend.

## Rodar

```bash
npm install
npm run build     # gera dist/
npm run watch     # rebuild contínuo
npm run typecheck
```

1. `chrome://extensions` → **Modo do desenvolvedor**
2. **Carregar sem compactação** → pasta `dist/`
3. Abra `linkedin.com/feed` e clique no ícone

## Estrutura

```
public/manifest.json      manifest MV3
public/icons/             ícones
build.mjs                 esbuild → dist/ (content IIFE, SW/UI ESM)
src/content/index.ts      content script (loop de scroll vive aqui)
src/sw.ts                 service worker (só roteia)
src/sidepanel/            painel lateral 380px
src/dashboard/            dashboard.html#/rota
src/shared/theme.css      tokens claro/escuro
```

## Regras que não se quebram

- Loop de scroll no content script, nunca no service worker (ele morre em ~30s).
- Chamadas de IA nas páginas de UI (sidepanel/dashboard), nunca no SW.
- Seletores só `data-testid` / `aria-label` / texto. Classes `k4d*` mudam a cada deploy.
- Sem `eval`, sem backend, sem endpoints internos do LinkedIn (`/voyager/`).
