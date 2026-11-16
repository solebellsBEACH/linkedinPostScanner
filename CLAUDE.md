# LinkedIn Post Scanner

Extensão Chrome MV3 que lê o feed do LinkedIn, extrai posts, resume com IA do usuário, detecta vagas e calcula match com o perfil.

**Leia `docs/SPEC.md` inteiro antes de escrever qualquer código. Ele é a fonte da verdade.**
Os prompts de cada fase estão em `docs/PROMPTS.md`.

## Invariantes (nunca violar)

1. O loop de scroll roda no content script. NUNCA no service worker.
2. Chamadas de IA rodam nas páginas de UI (`sidepanel`, `dashboard`). NUNCA no SW.
3. Seletores apenas `data-testid`, `data-component-type`, `aria-label` ou texto normalizado. Nunca classes `k4d*` / `artdeco-*`.
4. Proibido: `eval`, CDP, Puppeteer, backend, `/voyager/`, `innerHTML` com texto do feed.
5. Sem framework. TypeScript estrito. Toda mensagem ao usuário em pt-BR.

## DOM real medido (build 2026)

- Scroll root: `main#workspace`. `window.scrollY` permanece 0.
- Feed virtualizado: filhos com `data-lazy-mount-id` e `data-virtualized-item`; nós reciclados.
- `.feed-shared-update-v2`, `[data-urn]`, `[data-id^="urn:li:activity"]` = 0 elementos.
- Busca: `[data-testid="lazy-column"][data-component-type="LazyColumn"]`.
- Fim de lista: "Are these results helpful?" (busca) / "Do you find this post valuable?" (feed) / rodapé "About Accessibility".
- "Show more" do feed é expansão de texto do post, não paginação.

## Comandos

```bash
npm run build      # gera dist/ (é o que se carrega no Chrome)
npm run watch      # rebuild automático
npm run typecheck  # tsc --noEmit
```

Carregar: `chrome://extensions` → modo desenvolvedor → "Carregar sem compactação" → `dist/`.
Depois de cada build: clicar em Recarregar na extensão e recarregar a aba do LinkedIn.

## Fluxo de trabalho

- Implemente **somente** o escopo pedido na mensagem atual. Não refatore outros arquivos.
- Bug de DOM → primeiro escreva um probe que imprime os dados, depois implemente.
- Ao descobrir um fato novo do DOM, atualize `NOTES.md` **e** `docs/SPEC.md` §3/§4 na mesma resposta.
- Ao terminar uma tarefa: liste arquivos criados/alterados e o teste manual que o usuário deve fazer.

## Debug

- `?prDebug=1` na URL do LinkedIn: overlay com `{rodada, posts, scrollHeight, semProgresso}`.
- `?prError=CODE` no dashboard: força um erro do catálogo para inspeção visual.
- Logs do content script: console da página, contexto "LinkedIn Post Scanner".
- Logs do SW: `chrome://extensions` → "service worker".
