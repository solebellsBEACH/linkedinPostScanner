# SPEC — LinkedIn Post Scanner (v2)

Extensão Chrome Manifest V3. Lê o feed do LinkedIn rolando sozinha, extrai posts, resume com IA do usuário, detecta vagas e calcula match com o perfil, mostra tudo num side panel e num dashboard.

**Regra-mãe: tudo roda dentro da extensão.** Sem backend, sem CDP/Puppeteer/Python, sem proxy, sem função serverless. O usuário instala e funciona.

---

## 1. Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│ content script (linkedin.com/feed, /search/results/content, │
│                 /in/*)                                      │
│  • scroll engine (loop)   ← VIVE AQUI, nunca no SW          │
│  • extractor (posts, vagas)                                 │
│  • profile reader                                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ Port de longa duração
┌──────────────────────────▼──────────────────────────────────┐
│ service worker (efêmero)                                    │
│  • roteia mensagens, abre side panel por aba                │
│  • grava em IndexedDB                                       │
│  • NUNCA roda o loop, NUNCA chama IA                        │
└──────────────┬────────────────────────────┬─────────────────┘
               ▼                            ▼
      ┌─────────────────┐          ┌──────────────────────────┐
      │ side panel 380px│          │ dashboard.html#/rota     │
      │ • toggle+contador│         │ • 6 telas                │
      │ • resumo/prompt │          │ • chat/histórico/config  │
      │ • FAZ chamadas IA│         │ • TAMBÉM faz chamadas IA │
      └─────────────────┘          └──────────────────────────┘
```

Duas decisões inegociáveis:

1. **O loop de scroll mora no content script.** O service worker MV3 morre após ~30s ocioso; um loop de 25 minutos nele nunca termina.
2. **As chamadas de IA moram nas páginas de UI** (side panel / dashboard). O SW é encerrado no meio de um stream de 40s; página aberta não.

Comunicação: `Port` de longa duração entre content script e side panel (contador ao vivo) + `chrome.runtime.sendMessage` para comandos pontuais. Nunca polling de `chrome.storage`.

---

## 2. Manifest

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Post Scanner",
  "version": "0.1.0",
  "minimum_chrome_version": "116",
  "permissions": ["storage", "unlimitedStorage", "sidePanel", "scripting", "downloads", "alarms", "tabs"],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "https://br.linkedin.com/*",
    "https://api.anthropic.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.groq.com/*",
    "http://localhost:11434/*",
    "http://127.0.0.1:11434/*"
  ],
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [{
    "matches": [
      "https://www.linkedin.com/feed/*",
      "https://www.linkedin.com/search/results/content/*",
      "https://www.linkedin.com/in/*"
    ],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "side_panel": { "default_path": "sidepanel.html" },
  "action": { "default_title": "Post Scanner" },
  "options_page": "dashboard.html#/settings"
}
```

No SW: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` e `setOptions({ tabId, path, enabled })` apenas em abas do LinkedIn.

CSP padrão do MV3: nenhum `eval`, nenhum script remoto.

---

## 3. Scroll engine (content script)

### 3.1 Scroll root — nunca `window`

```
1. document.getElementById('workspace')       se scrollHeight > clientHeight + 100
2. ancestral mais próximo de [data-testid="mainFeed"] ou [data-testid="lazy-column"]
   com overflowY auto|scroll e scrollHeight > clientHeight + 100
3. document.scrollingElement
4. window  (último recurso; logar aviso)
```

`window.scrollY` fica 0 nas duas páginas; `document.documentElement.scrollHeight == innerHeight`. Rolar `window` não faz nada.

### 3.2 Passo de scroll

```js
el.scrollBy({ top: 0.85 * el.clientHeight, behavior: 'instant' });
el.dispatchEvent(new WheelEvent('wheel', { deltaY: el.clientHeight * 0.8, bubbles: true, cancelable: true }));
// a cada 3 rodadas, força a sentinela:
lastItem?.scrollIntoView({ block: 'end' });
```

O `LazyColumn` reage a wheel real + IntersectionObserver, não a `scrollTop` programático puro. As três vias juntas são obrigatórias.

### 3.3 Progresso — assinatura composta

Nós são reciclados (`data-virtualized-item`, `data-lazy-mount-id`). `.feed-shared-update-v2`, `[data-urn]`, `[data-id^="urn:li:activity"]` retornam **0** nesta build. Nunca contar filhos.

```
progresso = Δ(scrollHeight) || novos activityIds || Δ(textContent do lazy column)
```

Identidade do post, por prioridade:
1. `href` casando `/\/feed\/update\/urn:li:activity:(\d+)/` ou `/\/posts\/[^/?#]+/`
2. `componentkey` / `data-lazy-mount-id`
3. `hash(autor + 80 primeiros chars)`

Manter `Set` **acumulado**: o nó pode ser desmontado e o ID não pode ser perdido.

### 3.4 "Load more" — só paginação real

Ordem: `[data-testid="load-more"]` → botão com texto **exato** em {`show more results`, `ver mais resultados`, `mostrar mais resultados`, `load more`, `carregar mais`, `ver mais publicações`, `show more posts`} → `[aria-label*="more results" i]`.

Antes de clicar: `scrollIntoView` + espera 400–900ms. Depois: espera 1,5–3s.

`isPaginationButton(el)` retorna `false` se `el.closest()` achar `[data-virtualized-item]`, `[data-lazy-mount-id]`, `[role="dialog"]`, `.vjs-*` ou `[data-testid="dialog-content"]`.

O `"Show more"` do feed é expansão de texto do post, não paginação.

### 3.5 Ritmo e parada

- Delay base 900–2600ms com jitter; pausa de 4–9s a cada 10–18 rodadas.
- Micro-scroll para cima a cada 7 rodadas (−25% da altura).
- `aria-busy="true"` / loader / `[role=progressbar]` → aguardar até 5s sem clicar.
- Pausar com `document.hidden`; retomar em `visibilitychange`.
- **Parar** quando: 6 rodadas sem progresso **e** sem botão de paginação **e** marcador de fim visível (`"Are these results helpful?"`, `"Do you find this post valuable?"`, rodapé `"About Accessibility"`); ou > 400 rodadas; ou > 25 min; ou authwall.
- `/authwall`, `/login`, `/checkpoint`, `/uas/login` → `SCROLL_AUTH`.
- Toast com "limit"/"limite" → pausa 60s e reduz velocidade → `SCROLL_STALLED`.

---

## 4. Extrator de posts

| Campo | Origem |
|---|---|
| `activityId` | href `/feed/update/urn:li:activity:<id>` |
| `author`, `authorHeadline` | link `/in/<slug>`, `aria-label="Follow {nome}"` |
| `text` | `[data-testid="expandable-text-box"]` |
| `reactions` | parser pt/en: `1.234`, `1,2 mil`, `1.2K` |
| `comments`, `reposts` | contadores vizinhos |
| `postedAt` | `"2 h"`, `"há 2 dias"` → normalizar + `collectedAt` ISO |
| `isSponsored` | "Promovido" / "Promoted" |
| `isRepost` | "repostou" / "reposted" |
| `mediaType` | `video` se `.vjs-*`; `image` se `<img>` de conteúdo; `none` |
| `url` | URL canônica do post |

**Texto truncado:** se existir `[data-testid="expandable-text-button"]`, clicar **1x por post**, esperar 1,5s, reler, marcar `expanded: true`. Nunca contar como progresso nem como paginação.

Post sem `activityId` e sem texto → incrementa `unrecognized` e não persiste. Alimenta o aviso "Resumo parcial: N posts não foram reconhecidos".

Persistir **incrementalmente** (a cada post) via Port → IndexedDB. Nunca em lote no fim.

---

## 5. Vagas + match

Detecção por heurística: termos `vaga|contratando|hiring|oportunidade|remoto|CLT|PJ|Easy Apply` **e** ≥1 termo de stack. Se ambíguo, classificar via IA em lote (1 chamada para N posts, JSON estrito).

```ts
type Job = {
  id: string; title: string; company: string; loc: string;
  mode: 'remoto' | 'híbrido' | 'presencial';
  stack: string[]; posted: string; easyApply: boolean;
  url: string; sourceActivityId: string;
};
```

Match:

```
normalizar (lowercase, trim, remover .js) + sinônimos:
  react/reactjs, node/nodejs, ts/typescript, next/nextjs, nest/nestjs
have = stack ∩ profile.skills
match = round(|have| / |stack| * 100)     // null se |stack| == 0
cor: >=80 accent · >=60 texto · <60 neutro
```

Filtros do dashboard: Todas / Remoto / Híbrido / Easy Apply.

---

## 6. Perfil

Content script em `/in/<slug>/` extrai `name`, `headline`, `location`, `skills[]`. Se a seção de skills não estiver no DOM, rolar a própria página uma vez e reler. Cache em IndexedDB com TTL 7 dias. Falha → `PROFILE_UNREADABLE` com ações "Abrir meu perfil" e "Ver vagas sem match" (modo degradado).

---

## 7. Camada de IA (client-side)

| Provedor | Endpoint | Auth |
|---|---|---|
| Anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version: 2023-06-01` + **`anthropic-dangerous-direct-browser-access: true`** |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `Bearer` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent` | `?key=` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | `Bearer` |
| Ollama | `http://localhost:11434/api/chat` | nenhum |

O header `anthropic-dangerous-direct-browser-access` é obrigatório: sem ele a Anthropic bloqueia origem de extensão.

**Chave:** `chrome.storage.local` em `aiKeys.<provider>`, mascarada na UI (`sk-ant-…3f9a`). Botão Testar faz `max_tokens: 1` e mostra "Conectado · 312 ms". Nunca em log, nunca no export.

**Resumo (map-reduce):** posts em lotes de ~12k chars, concorrência 2, saída JSON:

```json
{ "topics": [{ "name": "IA em produto", "count": 14 }],
  "bullets": [{ "text": "…", "refs": ["urn:li:activity:123"] }],
  "jobs": [] }
```

Dedupe de bullets por similaridade; reduce final; citação `[n]` mapeada ao índice do post.

**Streaming:** `fetch` + `ReadableStream`, token a token. `AbortController` no botão Stop. Timeout total 60s → `AI_TIMEOUT`.

**Saída estruturada:** exigir JSON puro, validar com schema, 1 retry "responda somente JSON", depois `AI_BAD_OUTPUT`.

**Defesa contra prompt injection:** posts vão em delimitadores e o system prompt instrui explicitamente a ignorar comandos contidos neles.

---

## 8. Side panel (380px)

```
[ Post Scanner ]                         [Dashboard ↗]
──────────────────────────────────────────────────────
Scroll automático            [ toggle ]
• 47 posts lidos                         ● ativo
──────────────────────────────────────────────────────
  Gerar resumo   |   Analisar via prompt
──────────────────────────────────────────────────────
summary:  [ Gerar resumo dos posts ]   (disabled se 0 posts e scroll off)
prompt:   [textarea] + presets + [ Analisar ]
──────────────────────────────────────────────────────
resultados: vazio | loading | erro | resumo | vagas
```

- Contador por porta, incremental, sem re-render global.
- Resumo: número grande + bullets `01/02/03` + "Ver análise completa".
- Vagas: até 3 com match colorido + "Ver análise completa".
- Erro: kicker, título, corpo, ações, código mono 11px.
- Toggle só habilita em `/feed/`; fora disso `SCROLL_NOT_FEED`.

---

## 9. Dashboard (`dashboard.html#/<rota>`)

| Rota | Conteúdo |
|---|---|
| `#/overview` | 4 stats (posts 7d, resumos, vagas, match médio) · resumo do dia · barra de temas proporcional · posts citados · melhores matches |
| `#/jobs` | tabela Match / Vaga / Local / Modelo / Stack / Publicada + filtros |
| `#/job/:id` | requisitos × perfil (✓/–) com "N de M" · % match grande · facts |
| `#/history` | agrupado por data, tipos RESUME/PROMPT, filtros Tudo/Resumos/Prompts |
| `#/chat` | chat sobre o corpus, respostas citando `[n]`, "Base de conhecimento · N posts de M análises" |
| `#/settings` | tema, provedor, chave + Testar, exportar JSON, limpar histórico, versão |

Tema claro/escuro via `data-theme`. Sem fonte ou asset remoto.

---

## 10. Persistência

- **IndexedDB**: `posts` (key `activityId`, índice `collectedAt`), `analyses`, `jobs`, `history`, `profile`.
- **chrome.storage.local**: settings, tema, provedor, `aiKeys`, `schemaVersion`.
- `unlimitedStorage` no manifest (sem isso: 10MB e `STORAGE_FULL` em semanas).
- Escrita incremental por post; commit transacional por análise.
- Export JSON via `chrome.downloads` com Blob `{version, exportedAt, profile, posts, analyses}` — **sem chaves**.
- Limpar histórico: apaga `analyses`/`history`/`posts` antigos, preserva settings e perfil.
- `schemaVersion` + migração no boot. Major divergente → `VERSION_MISMATCH`.
- JSON inválido numa análise → `DATA_CORRUPT` isolado, sem derrubar o resto.

---

## 11. Catálogo de erros (23)

| Código | Área | Onde | Ações |
|---|---|---|---|
| `SCROLL_NOT_FEED` | Scroll | ext | Abrir o feed |
| `SCROLL_AUTH` | Scroll | ext | Entrar no LinkedIn |
| `SCROLL_STALLED` | Scroll | ext | Tentar de novo · Resumir o que foi lido |
| `DOM_CHANGED` | Scroll | ext | Verificar atualização |
| `SUMMARY_EMPTY` | Resumo | ext | Ligar scroll |
| `SUMMARY_TOO_FEW` | Resumo | ext | Ligar scroll |
| `PROMPT_EMPTY` | Prompt | ext | Usar um exemplo |
| `PROMPT_NO_RESULTS` | Prompt | ext | Ligar scroll · Editar prompt |
| `PROFILE_UNREADABLE` | Prompt | ext | Abrir meu perfil · Ver vagas sem match |
| `AI_NO_KEY` | IA | ext | Configurar chave |
| `AI_401` | IA | ext | Atualizar chave |
| `AI_429` | IA | ext | Tentar de novo · Trocar provedor |
| `AI_TIMEOUT` | IA | ext | Tentar de novo |
| `AI_LOCAL_OFFLINE` | IA | ext | Tentar de novo · Trocar provedor |
| `AI_BAD_OUTPUT` | IA | ext | Tentar de novo |
| `NETWORK_OFFLINE` | Conexão | ext | Tentar de novo |
| `EXT_UNAVAILABLE` | Dashboard | web/overview | Abrir extensões do Chrome |
| `VERSION_MISMATCH` | Dashboard | web/overview | Atualizar extensão |
| `STORAGE_FULL` | Dashboard | web/history | Exportar JSON · Limpar análises antigas |
| `DATA_CORRUPT` | Dashboard | web/history | Remover análise |
| `CHAT_FAILED` | Dashboard | web/chat | Tentar de novo |
| `CHAT_NO_CORPUS` | Dashboard | web/chat | Abrir extensão |
| `JOB_CLOSED` | Dashboard | web/job | Ver vagas parecidas |

Cada erro: código + título + corpo (o que aconteceu e por quê) + ações clicáveis. Nenhum `alert()`, nenhum stack trace na UI; detalhes só no console com prefixo `[PR]`.

---

## 12. Segurança e privacidade

- Nenhuma telemetria, analytics ou crash report externo.
- Nenhum `eval`, `new Function`, script remoto.
- Texto de post sempre via `textContent`, nunca `innerHTML`.
- Chaves fora do export e fora dos logs.
- Conteúdo de terceiros é dado, não instrução (prompt injection).

---

## 13. Critérios de aceite

1. Instalar `dist/` descompactada e funcionar sem processo externo.
2. `window.scrollY` permanece 0 durante todo o scroll.
3. 20 rodadas em `/feed/` sem exceção; contador cresce monotonicamente.
4. Não clica em `expandable-text-button` como paginação; não abre menu de post.
5. Sobrevive a navegação SPA `/feed/` → `/search/results/content/`.
6. Para sozinha com marcador de fim + 6 rodadas sem progresso.
7. Fechar a aba no meio do scroll: posts lidos continuam no dashboard.
8. Matar o service worker: o scroll **continua**.
9. Testar chave de IA de dentro do side panel funciona sem backend.
10. Export JSON não contém nenhuma chave.
11. Os 23 códigos reproduzíveis, com ação funcional.
12. Nenhuma requisição fora de `linkedin.com` + provedor escolhido.

---

## 14. Proibições

- Rodar scroll ou IA no service worker.
- Usar `window.scrollTo` como mecanismo principal.
- Usar classes `k4d*` / `artdeco-*` como seletor primário.
- Contar `.feed-shared-update-v2` (não existe nesta build).
- Depender de `scrollTop` programático sozinho.
- Chamar `/voyager/`, `/jobs-guest/` ou qualquer API interna do LinkedIn.
- Persistir posts em lote só no fim do scroll.
- Guardar ou exportar chaves de API.
- `innerHTML` com texto vindo do feed.

---

## 15. Mapa de arquivos

```
dist/                     saída do build (é o que se carrega no Chrome)
  manifest.json  content.js  sw.js
  sidepanel.html  sidepanel.js  sidepanel.css
  dashboard.html  dashboard.js dashboard.css
  theme.css  icons/

src/
  content/
    index.ts      bootstrap do content script, roteia por rota
    scroll.ts     findScrollRoot, loop, progressSignature, isPaginationButton
    extract.ts    extractPost, parseCount, normalizePostedAt
    profile.ts    readProfile
  shared/
    types.ts      Post, Job, Profile, Analysis, HistoryEntry, Settings
    idb.ts        wrapper IndexedDB
    storage.ts    chrome.storage.local tipado + defaults
    errors.ts     AppError + 23 códigos
    messaging.ts  contratos request/response + rpc()
    providers.ts  5 provedores, headers, endpoints
    ai.ts         callAI (stream), structured<T>()
    summarize.ts  map-reduce
    jobs.ts       detecção de vaga + match
    theme.css     tokens claro/escuro
  sidepanel/  index.html  main.ts  style.css
  dashboard/  index.html  main.ts  router.ts  style.css  pages/*.ts
  sw.ts

public/manifest.json  public/icons/
design/prototype.html   referência visual (não é código de produção)
docs/SPEC.md  docs/PROMPTS.md
```
