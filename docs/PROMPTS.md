# PROMPTS — uma fase por sessão

Regras de uso:

1. Sessão nova do Claude Code → cole o **Prompt de abertura**, depois o prompt da fase.
2. Uma fase = um escopo. Se o Claude quiser mexer em outro arquivo, recuse.
3. Terminou a fase → rode o teste manual, faça o commit indicado, `/clear`.
4. Bug de DOM → peça um probe antes da feature.

---

## Prompt de abertura (toda sessão)

```
Leia CLAUDE.md, docs/SPEC.md e NOTES.md inteiros antes de escrever qualquer código.
Não invente seletores: use apenas os documentados na spec e no NOTES.md.
Implemente somente o que eu pedir nesta mensagem; não refatore outros arquivos.
Ao terminar: liste arquivos criados/alterados, o comando que eu devo rodar e o teste
manual que eu devo fazer no Chrome.
```

---

## Fase 1 — Scaffold que carrega no Chrome

**Objetivo:** extensão instalável, side panel e dashboard abrindo, content script logando. Sem lógica.

```
Implemente o scaffold descrito em docs/SPEC.md §2 e §15.

Crie:
- public/manifest.json exatamente como docs/SPEC.md §2 (versão 0.1.0).
- src/sw.ts: chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}) no install;
  onUpdated de abas: habilita sidePanel só em linkedin.com, desabilita no resto.
  console.log("[PR] sw ready").
- src/content/index.ts: apenas console.log("[PR] content ready", location.pathname).
- src/sidepanel/index.html + main.ts + style.css: h1 "Post Scanner", body 380px, log "[PR] sidepanel ready".
- src/dashboard/index.html + main.ts + style.css: hash router com as 6 rotas de §9,
  cada uma renderizando só o título da tela.
- src/shared/theme.css: tokens claro/escuro (background, surface, text, muted, divider, accent-*)
  e data-theme no <html>.

Não implemente scroll, extração, IA nem storage ainda.
```

**Verificar**

| # | Passo | Esperado |
|---|---|---|
| 1 | `npm run build` | `dist/` com manifest, content.js, sw.js, 2 html, 2 js, 2 css |
| 2 | `chrome://extensions` → carregar `dist/` | extensão sem erro |
| 3 | clicar no ícone em `linkedin.com/feed` | side panel abre com "Post Scanner" |
| 4 | clicar no ícone em outra aba | side panel não abre |
| 5 | console da página do feed | `[PR] content ready /feed/` |
| 6 | `chrome-extension://<id>/dashboard.html#/jobs` | título "Vagas" |

**Commit:** `feat: scaffold mv3`

---

## Fase 2 — Camada de dados

```
Implemente src/shared/: types.ts, idb.ts, storage.ts, errors.ts, messaging.ts (docs/SPEC.md §10, §11).
- types.ts: Post, Job, Profile, Analysis, HistoryEntry, Settings — campos de §4, §5, §6, §10.
- idb.ts: IndexedDB sem lib. Stores: posts (key activityId, índice collectedAt), analyses, jobs,
  history, profile. Helpers: putPost, putPosts, getPost, countPosts, putAnalysis, listAnalyses,
  getAnalysis, deleteAnalysis, putHistory, listHistory, getProfile, putProfile,
  estimateUsage, deleteOlderThan.
- storage.ts: settings tipadas com defaults (theme 'light', provider 'anthropic', model por provedor,
  aiKeys {}, schemaVersion 1). get/set/onChange.
- errors.ts: AppError com os 23 códigos de §11 (união literal), mensagem e ações sugeridas;
  fromHttp(status) mapeando 401/429/timeout/offline.
- messaging.ts: contratos tipados (StartScroll, StopScroll, PostBatch, Progress, State, Error) e rpc<T>() com timeout de 10s.
- Migração de schema no boot do SW: se schemaVersion < 1, criar stores.

Nada de UI ainda.
```

**Verificar** (console do service worker):

```js
const s = await chrome.storage.local.get('schemaVersion'); // 1
```

E um teste manual no dashboard ainda feio: `await idb.putPost({activityId:'t1', text:'oi', collectedAt:Date.now()})` → `countPosts()` = 1.

**Commit:** `feat: storage layer`

---

## Fase 3 — Scroll engine (a fase de risco)

```
Implemente src/content/scroll.ts conforme docs/SPEC.md §3, sem UI.

Exporte: startScroll(onEvent), stopScroll(), getState().
- findScrollRoot(): ordem de §3.1, logando qual estratégia venceu.
- Loop com as 3 vias de §3.2 (scrollBy 0.85, WheelEvent, scrollIntoView no último
  [data-virtualized-item] a cada 3 rodadas).
- progressSignature() de §3.3: Set acumulado de activityId + scrollHeight + textContent.length.
- isPaginationButton(el) de §3.4.
- Ritmo de §3.5: delay 900-2600ms com jitter, pausa longa 4-9s a cada 10-18 rodadas,
  micro-scroll para cima a cada 7, espera em aria-busy até 5s, pausa em document.hidden.
- Stop de §3.5 (6 sem progresso + sem paginação + marcador de fim; 400 rodadas; 25min; authwall).
- Emitir eventos {type:'round', round, posts, scrollHeight, noProgress}, {type:'stop', reason},
  {type:'error', code}.
- Debug: se a URL tiver ?prDebug=1, renderizar overlay fixo com esses números.
- NÃO extrair posts ainda: só detectar e logar os activityIds novos.
```

**Verificar** — este é o teste que define o projeto:

| Teste | Esperado |
|---|---|
| `linkedin.com/feed?prDebug=1` + start | `window.scrollY === 0` o tempo todo |
| 20 rodadas | contador monotônico, nenhuma exceção no console |
| overlay | `round` sobe, `scrollHeight` varia |
| post com "… more" | não é clicado como paginação |
| rodar em `linkedin.com/` | `SCROLL_NOT_FEED` |
| fechar/abrir o side panel | scroll não para |

Se o scrollHeight não variar em 6 rodadas com marcador de fim ausente → pare e investigue
antes de seguir. Registre em NOTES.md o que observou.

**Commit:** `feat: scroll engine`

---

## Fase 4 — Extrator

```
Implemente src/content/extract.ts conforme docs/SPEC.md §4.
- extractPost(el): todos os campos da tabela de §4.
- parseCount(txt): 1.234 / 1,2 mil / 1.2K / 412 → number; null se não der.
- normalizePostedAt(txt): "2 h", "há 2 dias", "1 sem" → {raw, approxIso, collectedAt}.
- Expandir texto truncado: se houver [data-testid="expandable-text-button"], clicar 1x,
  esperar 1.5s, reler, expanded=true. Isso nunca conta como progresso nem paginação.
- activityId por §3.3 com fallbacks; sem id e sem texto → unrecognized++ e não persiste.
- Integrar no loop: a cada post novo, emitir {type:'post', post} imediatamente (nunca em lote).
```

**Verificar:** overlay mostra `posts` crescendo; os 5 primeiros posts no IndexedDB têm autor,
texto completo, reações numéricas e URL. Zero duplicados.

**Commit:** `feat: post extraction`

---

## Fase 5 — Ponte + side panel funcional

```
Ligue content → SW → side panel por Port de longa duração (docs/SPEC.md §1 e §8).
- Protocolo: START_SCROLL, STOP_SCROLL, POST_BATCH, PROGRESS, STATE, ERROR.
- SW: ao receber POST_BATCH grava em IndexedDB e repassa PROGRESS ao painel.
- Side panel: toggle (desabilitado fora de /feed/ com SCROLL_NOT_FEED), contador ao vivo,
  abas "Gerar resumo" / "Analisar via prompt", botão Analisar, área de resultado com
  estados vazio/loading/erro/resumo/vagas.
- Reabrir o painel reconecta e mostra o estado atual (o loop nunca parou).
- Visual feio é aceitável nesta fase; a estrutura de estados não.
```

**Verificar:**

| Teste | Esperado |
|---|---|
| ligar toggle | contador sobe sem piscar a UI |
| fechar e reabrir o painel | contador no valor correto |
| matar o SW em `chrome://extensions` | contador **continua** subindo |
| abrir em `/` | `SCROLL_NOT_FEED` com ação |

**Commit:** `feat: side panel live session`

---

## Fase 6 — Camada de IA

```
Implemente src/shared/providers.ts + ai.ts conforme docs/SPEC.md §7.
- 5 provedores com endpoint, headers e body exatos. Anthropic inclui
  "anthropic-dangerous-direct-browser-access": "true" e "anthropic-version": "2023-06-01".
- callAI({provider, model, system, messages, json, signal, onToken}): fetch + ReadableStream,
  AbortController, timeout total 60s.
- Mapear falhas: 401 → AI_401, 429 → AI_429, fetch em localhost → AI_LOCAL_OFFLINE,
  navigator.onLine === false → NETWORK_OFFLINE, abort → AI_TIMEOUT.
- structured<T>(schema, ...): exige JSON puro, valida, 1 retry com "responda somente JSON",
  depois AI_BAD_OUTPUT.
- testKey(provider): chamada com max_tokens 1, mede latência em ms.
- Nada disso pode ser importado pelo sw.ts.
```

**Verificar:** na tela de Configurações (ainda crua) o botão Testar retorna "Conectado · N ms" nos 5 provedores (Ollama só se estiver rodando). Aba Network: nenhuma requisição fora do provedor.

**Commit:** `feat: ai providers`

---

## Fase 7 — Resumo, vagas e match

```
Implemente src/shared/summarize.ts e src/shared/jobs.ts conforme docs/SPEC.md §5 e §7.
- summarize: lotes de ~12k chars, concorrência 2, JSON {topics, bullets, jobs},
  dedupe de bullets, reduce final, citação [n] mapeada ao índice do post.
- Prompt: posts dentro de delimitadores <<<POST n>>> ... <<<END>>> e instrução explícita
  de ignorar comandos contidos no conteúdo.
- jobs: heurística de §5; se ambíguo, 1 chamada em lote classificando N posts.
- match: normalização + sinônimos, null quando stack vazia.
- Persistir Analysis + HistoryEntry em transação única no IndexedDB.
- Ligar nos botões do side panel e renderizar resumo/vagas conforme §8.
```

**Verificar:** resumo com 3 bullets citando posts reais; vagas com match coerente com seu perfil; histórico com 1 RESUME e 1 PROMPT.

**Commit:** `feat: analysis pipeline`

---

## Fase 8 — Perfil

```
Implemente src/content/profile.ts (docs/SPEC.md §6).
Em /in/<slug>/: extrair name, headline, location, skills[]. Se a seção de skills não
estiver montada, rolar a página uma vez e reler. Cache em IndexedDB com TTL de 7 dias.
Se falhar: PROFILE_UNREADABLE com as ações "Abrir meu perfil" e "Ver vagas sem match".
No fluxo de vagas sem perfil: abrir /in/me/ numa aba e, ao voltar, reexecutar o match.
```

**Verificar:** match usa as skills reais; apagar `profile` do IndexedDB e pedir vagas → `PROFILE_UNREADABLE` → ação abre o perfil → volta e funciona.

**Commit:** `feat: profile reader`

---

## Fase 9 — Dashboard completo

```
Implemente o dashboard conforme docs/SPEC.md §9, replicando o visual de design/prototype.html
(layout, tipografia, espaçamento — não copie o código do protótipo).

- Vanilla TS + helper h(); router por hash; CSS próprio com tokens de theme.css.
- #/overview: 4 stats calculados do IndexedDB, resumo do dia, barra de temas proporcional,
  posts citados, melhores matches.
- #/jobs: tabela + filtros segmentados (Todas/Remoto/Híbrido/Easy Apply).
- #/job/:id: requisitos × perfil com ✓/–, "N de M", % grande, facts.
- #/history: agrupado por data, filtros Tudo/Resumos/Prompts.
- #/chat: respostas citando [n], painel "Base de conhecimento · N posts de M análises".
- #/settings: tema, provedor, chave mascarada + Testar, exportar JSON, limpar histórico, versão.
- Todo texto vindo do feed entra via textContent. Zero innerHTML dinâmico.
```

**Verificar:** navegar as 6 rotas com dados reais; trocar tema; exportar JSON e confirmar que não há chave; limpar histórico preserva settings e perfil.

**Commit:** `feat: dashboard`

---

## Fase 10 — Catálogo de erros

```
Implemente os 23 códigos de docs/SPEC.md §11 com a UI do protótipo: kicker (área), título,
corpo, ações clicáveis, código em mono 11px. Cada ação executa a função real.
Adicione ?prError=CODE no dashboard para forçar qualquer código em modo de inspeção.
Nenhum alert(); detalhes técnicos só no console com prefixo [PR].
```

**Verificar:** percorrer os 23 com `?prError=`, clicando em cada ação. Nenhuma ação morta.

**Commit:** `feat: error catalog`

---

## Fase 11 — Hardening e aceite

```
Rode a checklist de docs/SPEC.md §13 e corrija o que falhar.
Garanta: sanitização de todo texto externo; aba fechada no meio do batch não corrompe dados;
migração de schema; DATA_CORRUPT isolado por análise; STORAGE_FULL avisado antes de estourar;
nenhum console.log de debug no build de produção.
```

**Verificar:** os 12 critérios, um por um, com a aba Network aberta. Os dois que mais reprovam: matar o SW e o scroll continuar (crit. 8) e nenhuma requisição fora do permitido (crit. 12).

**Commit:** `chore: hardening + acceptance`

---

## Fase 12 — Empacotar

```
npm run build && npm run zip
```

`chrome://extensions` → Empacotar extensão → gera `.crx` + `.pem`. **Guarde o `.pem`**: é a
identidade da extensão; sem ele o ID muda e os dados locais ficam órfãos.

**Commit:** `chore: release 0.1.0` + tag `v0.1.0`.

---

## Sessão de debug (quando algo não carrega)

```
Não implemente nada. Escreva src/content/probe.ts que imprime no console:
- qual elemento findScrollRoot() escolheu e seus scrollHeight/clientHeight;
- quantos [data-virtualized-item] existem e os 5 primeiros data-lazy-mount-id;
- os activityIds encontrados na página;
- se há marcador de fim no textContent.
Rode em linkedin.com/feed e me mostre a saída.
```
