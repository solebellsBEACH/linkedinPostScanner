# NOTES — descobertas de campo

Formato: `data · o que medi · evidência · consequência`.
Só acrescente linhas. Nunca reescreva o histórico.

## 2026-11-16 — feed e busca de posts

- `main#workspace` é o scroll root. `scrollHeight=1904`, `clientHeight=941`,
  `window.scrollY=0`, `documentElement.scrollHeight === innerHeight`.
  → nunca usar `window.scrollTo`.
- Feed: filhos de `[data-testid="mainFeed"]` têm `data-lazy-mount-id` e
  `data-virtualized-item`. → contar filhos não mede progresso.
- `.feed-shared-update-v2`, `[data-urn]`, `[data-id^="urn:li:activity"]` retornaram
  **0 elementos**. → identidade do post vem do `href` do link do post.
- Busca: wrapper é `[data-testid="lazy-column"][data-component-type="LazyColumn"]`.
- `scrollTop` programático moveu a lista mas **não** disparou load em 4 iterações;
  um `Input.dispatchMouseEvent mouseWheel` via CDP travou a conexão.
  → usar scrollBy + WheelEvent + scrollIntoView na sentinela, nessa combinação.
- `expandable-text-button` ("… more") é expansão de texto do post, não paginação.
- Fim de lista: `"Are these results helpful?"` (busca), `"Do you find this post valuable?"`
  (feed), rodapé `"About Accessibility"`.
- Classes são hashes de build (`k4dlm5`, `k4dljs`…). → proibido como seletor.
- `/jobs-guest/jobs/api/jobPosting/<id>` responde 200 e depois **429** após ~65 chamadas
  rápidas. → a extensão não deve usar endpoint interno nenhum.

## 2026-11-17 — implementação das fases 3 a 11

- Extração usa `a[href*="urn:li:activity:"]` + caminhada até o card com
  `[data-testid="expandable-text-box"]`. → posts sem texto (só mídia) não são coletados.
- Contadores (reações/comentários/reposts) vêm de regex sobre o texto do card
  (`1.234`, `1,2 mil`, `1.2K`). → número aproximado, não oficial.
- Expansão de texto: click em `[data-testid="expandable-text-button"]` 1x por post,
  espera 1,2s e relê o card re-consultando o DOM (a virtualização recria o nó).
- Post que falha na extração entra em `seen` na primeira tentativa, senão o contador de
  progresso nunca zera e o loop vai até o teto de rodadas.
- Side panel e dashboard compartilham o IndexedDB (mesma origem da extensão);
  só o content script roda no origin da página e por isso nunca abre IndexedDB.
- IA faz streaming SSE de verdade (buffer por `\n\n`) para Anthropic/OpenAI/Groq e
  NDJSON para Ollama; Gemini não streama nesta versão.
