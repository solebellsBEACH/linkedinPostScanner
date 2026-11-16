# SPEC — LinkedIn Post Scanner

Extensão Chrome MV3. Rola o feed, extrai posts, resume com IA do usuário, detecta vagas,
calcula match com o perfil. Side panel + dashboard.

**Regra-mãe: tudo roda dentro da extensão.** Sem backend, sem CDP/Puppeteer/Python,
sem proxy, sem serverless. Instalar e funcionar.

## 1. Arquitetura

| Contexto | Responsabilidade |
|---|---|
| content script | scroll engine (loop), extrator, leitura de perfil |
| service worker | roteia mensagens, abre side panel por aba, grava IndexedDB |
| side panel | toggle + contador ao vivo, resumo/prompt, **chamadas de IA** |
| dashboard | 6 rotas, histórico, chat, config, **chamadas de IA** |

Duas decisões inegociáveis:

1. Loop de scroll no content script (SW morre em ~30s).
2. Chamadas de IA nas páginas de UI (SW morre no meio de um stream de 40s).

Comunicação: `Port` de longa duração entre content script e side panel (contador ao vivo)
+ `chrome.runtime.sendMessage` para comandos pontuais. Nunca polling de `chrome.storage`.

## 2. Manifest

`manifest_version: 3`, `minimum_chrome_version: "116"`.

Permissões: `storage, unlimitedStorage, sidePanel, scripting, downloads, alarms, tabs`.

Hosts: `linkedin.com`, `br.linkedin.com`, `api.anthropic.com`, `api.openai.com`,
`generativelanguage.googleapis.com`, `api.groq.com`, `localhost:11434`, `127.0.0.1:11434`.

Content scripts: `/feed/*`, `/search/results/content/*`, `/in/*`.
`side_panel.default_path: "sidepanel.html"` · `options_page: "dashboard.html#/settings"`.

No SW: `setPanelBehavior({ openPanelOnActionClick: true })` e `setOptions({ tabId, path, enabled })`
apenas em abas do LinkedIn.

## 3. Scroll engine

### 3.1 Scroll root
1. `document.getElementById('workspace')` se `scrollHeight > clientHeight + 100`
2. ancestral de `[data-testid="mainFeed"]` / `[data-testid="lazy-column"]` com
   `overflowY: auto|scroll`
3. `document.scrollingElement`
4. `window` (último recurso, logar aviso)

### 3.2 Passo
```js
el.scrollBy({ top: 0.85 * el.clientHeight, behavior: 'instant' });
el.dispatchEvent(new WheelEvent('wheel', { deltaY: el.clientHeight * 0.8, bubbles: true, cancelable: true }));
// a cada 3 rodadas:
lastItem?.scrollIntoView({ block: 'end' });
```

### 3.3 Progresso (lista virtualizada)
`progresso = Δ(scrollHeight) || novos activityIds || Δ(textContent do lazy column)`

Identidade do post: `href` `/feed/update/urn:li:activity:(\d+)` → `componentkey` /
`data-lazy-mount-id` → `hash(autor + 80 chars)`. Manter `Set` **acumulado**.

### 3.4 Load more
Ordem: `[data-testid="load-more"]` → texto exato (`show more results`,
`ver mais resultados`, `mostrar mais resultados`, `load more`, `carregar mais`,
`ver mais publicações`, `show more posts`) → `[aria-label*="more results" i]`.
`scrollIntoView` + espera 400–900ms antes; 1,5–3s depois.

`isPaginationButton(el)` = `false` se `el.closest()` achar `[data-virtualized-item]`,
`[data-lazy-mount-id]`, `[role="dialog"]`, `.vjs-*`, `[data-testid="dialog-content"]`.

### 3.5 Ritmo e parada
Delay 900–2600ms com jitter; pausa de 4–9s a cada 10–18 rodadas; micro-scroll para cima
(−25%) a cada 7 rodadas; esperar até 5s em `aria-busy`/loader; pausar com `document.hidden`.

Parar: 6 rodadas sem progresso **e** sem paginação **e** marcador de fim visível;
ou > 400 rodadas; ou > 25 min; ou authwall (`/authwall`, `/login`, `/checkpoint`, `/uas/login`).

## 4. Extrator

`activityId`, `author`, `authorHeadline`, `text` (`expandable-text-box`), `reactions`
(parser pt/en: `1.234`, `1,2 mil`, `1.2K`), `comments`, `reposts`, `postedAt`,
`collectedAt`, `isSponsored` ("Promovido"), `isRepost` ("repostou"), `mediaType`
(`.vjs-*` → video), `url`, `expanded`.

Se houver `expandable-text-button`: clicar **1x por post**, esperar 1,5s, reler,
marcar `expanded: true`. Nunca contar como progresso nem como paginação.

Post sem id e sem texto → incrementa `unrecognized` (alimenta "Resumo parcial: N posts").
Persistir incrementalmente a cada post via Port → IndexedDB.

## 5. Vagas + match

Heurística: `vaga|contratando|hiring|oportunidade|remoto|CLT|PJ|Easy Apply`
**e** ≥1 termo de stack. Ambíguo → classificar via IA em lote (JSON estrito).

```
normalizar + sinônimos: react/reactjs, node/nodejs, ts/typescript, next/nextjs, nest/nestjs
have  = stack ∩ profile.skills
match = round(|have| / |stack| * 100)      // null se |stack| == 0
cor:  >=80 accent · >=60 texto · <60 neutro
```

Filtros do dashboard: Todas / Remoto / Híbrido / Easy Apply.

## 6. Perfil

`/in/<slug>/` → `name`, `headline`, `location`, `skills[]`. Skills fora do DOM: rolar a
página do perfil uma vez e reler. Cache IndexedDB com TTL 7 dias.
Falha → `PROFILE_UNREADABLE` com ações "Abrir meu perfil" / "Ver vagas sem match".

## 7. IA

| Provedor | Endpoint | Auth |
|---|---|---|
| Anthropic | `/v1/messages` | `x-api-key` + `anthropic-version` + `anthropic-dangerous-direct-browser-access: true` |
| OpenAI | `/v1/chat/completions` | `Bearer` |
| Gemini | `/v1beta/models/{m}:generateContent` | `?key=` |
| Groq | `/openai/v1/chat/completions` | `Bearer` |
| Ollama | `localhost:11434/api/chat` | — |

Chave em `chrome.storage.local`, mascarada. Botão Testar = `max_tokens: 1` → "Conectado · 312 ms".

Resumo map-reduce: lotes de ~12k chars, concorrência 2, saída JSON
`{ topics:[{name,count}], bullets:[{text,refs[]}], jobs:[] }`, dedupe de bullets,
reduce final, citação `[n]` ligada ao índice do post.

Streaming com `ReadableStream` + `AbortController`; timeout total 60s.
Saída estruturada: JSON puro, 1 retry, depois `AI_BAD_OUTPUT`.
Posts vão em delimitadores; system prompt manda ignorar instruções dentro deles.

## 8. Side panel (380px)

Header `Post Scanner` + link `Dashboard ↗` · linha "Scroll automático" com toggle e
"• N posts lidos" · abas `Gerar resumo` / `Analisar via prompt` · CTA · área de resultado
(vazio | loading | erro | resumo | vagas).

Resumo: número grande + bullets `01/02/03` + "Ver análise completa".
Vagas: até 3 com match colorido + "Ver análise completa".
Erro: kicker, título, corpo, ações, código mono 11px.
Toggle só habilita em `/feed/`; fora disso `SCROLL_NOT_FEED`.

## 9. Dashboard

| Rota | Conteúdo |
|---|---|
| `#/overview` | 4 stats (posts 7d, resumos, vagas, match médio) · resumo do dia · barra de temas · posts citados · melhores matches |
| `#/jobs` | tabela Match/Vaga/Local/Modelo/Stack/Publicada + filtros |
| `#/job/:id` | requisitos × perfil (✓/–) "N de M" · % match · facts |
| `#/history` | agrupado por data, tipos RESUME/PROMPT, filtros |
| `#/chat` | respostas citando `[n]` · "Base de conhecimento · N posts de M análises" |
| `#/settings` | tema, provedor, chave + Testar, exportar JSON, limpar histórico, versão |

Tema via `data-theme` (light/dark). Sem asset remoto.

## 10. Persistência

- IndexedDB: `posts` (key `activityId`, índice `collectedAt`), `analyses`, `jobs`,
  `history`, `profile`.
- `chrome.storage.local`: settings, tema, provedor, `aiKeys`, `schemaVersion`.
- `unlimitedStorage` obrigatório.
- Export JSON via `chrome.downloads` — **sem chaves**.
- Limpar histórico preserva settings e perfil.
- `schemaVersion` + migração no boot; major divergente → `VERSION_MISMATCH`.
- JSON inválido numa análise → `DATA_CORRUPT` isolado.

## 11. Catálogo de erros (23)

| Código | Área | Onde | Ações |
|---|---|---|---|
| SCROLL_NOT_FEED | Scroll | ext | Abrir o feed |
| SCROLL_AUTH | Scroll | ext | Entrar no LinkedIn |
| SCROLL_STALLED | Scroll | ext | Tentar de novo · Resumir o que foi lido |
| DOM_CHANGED | Scroll | ext | Verificar atualização |
| SUMMARY_EMPTY | Resumo | ext | Ligar scroll |
| SUMMARY_TOO_FEW | Resumo | ext | Ligar scroll |
| PROMPT_EMPTY | Prompt | ext | Usar um exemplo |
| PROMPT_NO_RESULTS | Prompt | ext | Ligar scroll · Editar prompt |
| PROFILE_UNREADABLE | Prompt | ext | Abrir meu perfil · Ver vagas sem match |
| AI_NO_KEY | IA | ext | Configurar chave |
| AI_401 | IA | ext | Atualizar chave |
| AI_429 | IA | ext | Tentar de novo · Trocar provedor |
| AI_TIMEOUT | IA | ext | Tentar de novo |
| AI_LOCAL_OFFLINE | IA | ext | Tentar de novo · Trocar provedor |
| AI_BAD_OUTPUT | IA | ext | Tentar de novo |
| NETWORK_OFFLINE | Conexão | ext | Tentar de novo |
| EXT_UNAVAILABLE | Dashboard | overview | Abrir extensões do Chrome |
| VERSION_MISMATCH | Dashboard | overview | Atualizar extensão |
| STORAGE_FULL | Dashboard | history | Exportar JSON · Limpar análises antigas |
| DATA_CORRUPT | Dashboard | history | Remover análise |
| CHAT_FAILED | Dashboard | chat | Tentar de novo |
| CHAT_NO_CORPUS | Dashboard | chat | Abrir extensão |
| JOB_CLOSED | Dashboard | job | Ver vagas parecidas |

Nenhum `alert()`, nenhum stack trace na UI. Detalhe técnico só no console com `[PR]`.

## 12. Segurança

Sem telemetria. Sem `eval`/`new Function`/script remoto. Texto de post via `textContent`.
Chaves fora do export e dos logs. Conteúdo de terceiros é dado, não instrução.

## 13. Aceite

1. `dist/` carrega e funciona sem processo externo.
2. `window.scrollY === 0` durante todo o scroll.
3. 20 rodadas em `/feed/` sem exceção; contador monotônico.
4. Não clica em `expandable-text-button` como paginação.
5. Sobrevive a navegação SPA `/feed/` → `/search/results/content/`.
6. Para sozinha com marcador de fim + 6 rodadas sem progresso.
7. Fechar a aba no meio: posts lidos continuam no dashboard.
8. Matar o service worker: o scroll continua.
9. Testar chave de IA no side panel funciona sem backend.
10. Export JSON sem nenhuma chave.
11. Os 23 erros reproduzíveis com ação funcional.
12. Nenhuma requisição fora de `linkedin.com` + provedor escolhido.

## 14. Proibições

Loop ou IA no service worker · `window.scrollTo` como mecanismo principal · classes
`k4d*`/`artdeco-*` como seletor primário · contar `.feed-shared-update-v2` ·
`scrollTop` programático sozinho · `/voyager/` e `/jobs-guest/` · persistir posts só no
fim · guardar/exportar chaves · `innerHTML` com texto do feed.

## 15. Mapa de arquivos

```
dist/                          saída do build (é o que se carrega no Chrome)
  manifest.json  content.js  sw.js
  sidepanel.html sidepanel.js sidepanel.css
  dashboard.html dashboard.js dashboard.css
  theme.css  icons/

src/
  content/  index.ts scroll.ts extract.ts profile.ts
  shared/   types.ts idb.ts storage.ts errors.ts messaging.ts
            providers.ts ai.ts summarize.ts jobs.ts theme.css
  sidepanel/ index.html main.ts style.css
  dashboard/ index.html main.ts router.ts style.css pages/*.ts
  sw.ts

public/manifest.json  public/icons/
design/prototype.html          referência visual (não é código de produção)
docs/SPEC.md  CLAUDE.md  NOTES.md
```
