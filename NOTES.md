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
