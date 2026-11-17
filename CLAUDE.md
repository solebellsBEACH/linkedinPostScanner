# LinkedIn Post Scanner — contexto do projeto

Extensão Chrome MV3, TypeScript estrito, sem framework, sem backend. Rola o feed do
LinkedIn, extrai os posts, resume com a chave de IA do próprio usuário, detecta vagas
e calcula match com o perfil. Tudo roda dentro do navegador.

Fonte da verdade do produto: `docs/SPEC.md`. Leia antes de escrever código.

## Invariantes (violar = bug)

1. Loop de scroll vive no **content script**. O service worker MV3 morre em ~30s.
2. Chamadas de IA e streaming vivem nas **páginas de UI** (sidepanel/dashboard). Nunca no SW.
3. Comunicação por **Port** de longa duração. Nunca polling de `chrome.storage`.
4. Seletores: só `data-testid`, `data-component-type`, `aria-label`, `role`,
   `componentkey`, texto normalizado pt/en. **Nunca** classes CSS (`k4d*`, `artdeco-*`).
5. Proibido: `eval`, `new Function`, CDP, Puppeteer, backend, proxy, serverless,
   `/voyager/`, `/jobs-guest/`, `innerHTML` com texto do feed.
6. Texto de terceiros sempre via `textContent`. UI em **pt-BR**.
7. Persistência: IndexedDB para dados, `chrome.storage.local` para preferências e chaves.
8. Seletor ausente nunca lança exceção: fallback em cascata + `console.warn('[PR] ...')`.

## Fatos do DOM (medidos na build 2026 — não re-descobrir)

- Scroll root é **`main#workspace`**. `window.scrollY` fica `0`;
  `document.documentElement.scrollHeight === innerHeight`.
- Feed virtualizado: filhos de `[data-testid="mainFeed"]` têm `data-lazy-mount-id`
  e `data-virtualized-item`. Nós são reciclados.
- `.feed-shared-update-v2`, `[data-urn]`, `[data-id^="urn:li:activity"]` retornam **0**.
- Busca de posts: `[data-testid="lazy-column"][data-component-type="LazyColumn"]`.
- Texto do post: `[data-testid="expandable-text-box"]`; truncado quando existe
  `[data-testid="expandable-text-button"]`.
- **"Show more" do feed é expansão de texto, não paginação.**
- Paginação real: `[data-testid="load-more"]` ou botão com texto exato
  `show more results` / `ver mais resultados` / `mostrar mais resultados` / `load more`
  / `carregar mais` / `show more posts` / `ver mais publicações`.
- Fim de lista: `"Are these results helpful?"` (busca), `"Do you find this post valuable?"`
  (feed), rodapé `"About Accessibility"`.
- `aria-label` úteis: `"Open control menu for post by {Nome}"`, `"Hide post by {Nome}"`,
  `"Follow {Nome}"`.
- Toast de erro/limite: `[data-testid="toasts-title"]`. Modais: `[data-testid="dialog-content"]`.
- `scrollTop` programático sozinho **não** dispara carregamento — precisa `WheelEvent`
  real + `scrollIntoView` na sentinela (IntersectionObserver).

## Comandos

```bash
npm run typecheck   # tsc --noEmit · deve sair limpo
npm run build       # gera dist/ com 4 bundles + estáticos
npm run watch       # rebuild contínuo
npm run zip         # empacota dist/ para distribuição
```

Carregar no Chrome: `chrome://extensions` → Modo do desenvolvedor →
**Carregar sem compactação → `dist/`** (não a raiz do repo).
Depois de cada mudança: **Recarregar** no card da extensão + `Ctrl+R` na aba do LinkedIn
(o content script só atualiza com reload da aba).

## Mapa de arquivos

```
build.mjs  tsconfig.json  package.json  .gitignore
public/manifest.json  public/icons/*
src/sw.ts
src/content/{index,scroll,extract,profile}.ts
src/shared/{types,idb,storage,errors,messaging,providers,ai,summarize,jobs,ui}.ts
src/shared/theme.css
src/sidepanel/{index.html,main.ts,style.css}
src/dashboard/{index.html,main.ts,router.ts,style.css}
src/dashboard/pages/{common,overview,jobs,job,history,chat,settings}.ts
```

Bundles de saída: `content.js` (IIFE) · `sw.js`, `sidepanel.js`, `dashboard.js` (ESM).

## APIs de IA (fetch direto do cliente)

- **anthropic** — `POST https://api.anthropic.com/v1/messages`
  headers: `x-api-key`, `anthropic-version: 2023-06-01`,
  **`anthropic-dangerous-direct-browser-access: true`** (sem este header a origem da
  extensão é bloqueada).
- **openai** — `POST https://api.openai.com/v1/chat/completions` · `Authorization: Bearer`
- **gemini** — `POST https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key=`
- **groq** — `POST https://api.groq.com/openai/v1/chat/completions` · Bearer
- **ollama** — `POST http://localhost:11434/api/chat` · sem auth

Chaves em `chrome.storage.local` (`aiKeys.<provider>`), mascaradas na UI,
nunca em log, nunca no export JSON.

## Convenções

- TS strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`. Zero `any`.
- Nenhuma dependência de runtime. esbuild é a única tool além do TypeScript.
- Arquivos e identificadores em inglês; texto de UI em pt-BR.
- Logs de diagnóstico com prefixo `[PR]`.

## Portões de aceite (bloqueiam avanço de fase)

1. `dist/` carrega no Chrome sem erro.
2. `window.scrollY === 0` durante todo o scroll (prova que rola `main#workspace`).
3. Contador de posts cresce monotonicamente por 20 rodadas.
4. Matar o service worker não interrompe o scroll.
5. Chamada à Anthropic funciona a partir do side panel.

## Como responder a mim

- Implemente só o que eu pedir nesta mensagem; não refatore arquivos fora do escopo.
- Ao terminar: liste arquivos criados/alterados, rode `npm run typecheck && npm run build`,
  e escreva um bloco "TESTE MANUAL" com os passos no Chrome.
- Se um fato do DOM não bater com este arquivo, **diga** e registre em `NOTES.md`.
