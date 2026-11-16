# NOTES — descobertas de campo

Registro cronológico do que foi medido no LinkedIn real. Toda entrada aqui deve ser
refletida em `docs/SPEC.md` §3/§4.

## 2026-11-16 — feed e busca (build 2026)

- Scroll root: `main#workspace` (`id="workspace"`). Rolar `window` não faz nada; `window.scrollY === 0`.
- Feed: filhos diretos de `[data-testid="mainFeed"]` têm `data-lazy-mount-id` + `data-virtualized-item`.
- `.feed-shared-update-v2` = 0, `[data-urn]` = 0, `[data-id^="urn:li:activity"]` = 0.
- Classes CSS são hashes por build (`k4dlm5 k4dljs …`) — inúteis como seletor.
- Busca: 2 elementos `[data-testid="lazy-column"]`; um com `data-component-type="LazyColumn"` e `componentkey`.
- `scrollTop = scrollHeight` **não** faz o LazyColumn crescer. Precisa de `WheelEvent` real + `scrollIntoView` no último item.
- Botão "Show more" do feed tem `y=-644` e vive fora de `[data-lazy-mount-id]` — é expansão de texto, não paginação.
- Fim do feed: "Do you find this post valuable? Yes No". Fim da busca: "Are these results helpful?" + rodapé.
- Botões de controle: `aria-label="Open control menu for post by {Nome}"`, `aria-label="Follow {Nome}"`.
- Texto do post: `[data-testid="expandable-text-box"]`; truncado quando existe `[data-testid="expandable-text-button"]`.
- Sem `[data-testid="load-more"]` visível nas duas páginas testadas (feed curto / busca curta).

## Pendente de medir

- [ ] Feed longo: quanto tempo até aparecer paginação real?
- [ ] `aria-busy` / loader durante carregamento de mais posts.
- [ ] Estrutura exata do card de vaga dentro do feed (quando houver).
- [ ] Seção de skills em `/in/<slug>/`: presente no DOM sem rolar?
