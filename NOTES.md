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

## 2026-11-17 — provedor DeepSeek

- Adicionado `deepseek` (v0.2.0): `POST https://api.deepseek.com/v1/chat/completions`,
  `Authorization: Bearer`, SSE compatível com OpenAI (`choices[0].delta.content`).
- Modelos: `deepseek-chat` (padrão) e `deepseek-reasoner`. O reasoner emite
  `reasoning_content` antes do `content`; o parser ignora o primeiro e só
  concatena `delta.content` — o resumo sai certo, mas sem a cadeia de raciocínio.
- host_permissions inclui `https://api.deepseek.com/*`; sem isso o fetch da
  extensão é bloqueado por CORS/permite.
- Verificado sem navegador: bundle com fetch stubado devolve URL, header Bearer,
  body `stream:true` e streaming incremental (`["Olá", ", mundo"]`).

## 2026-11-17 — crash do loop por seletor inválido

- Sintoma: painel em `erro` / "O LinkedIn mudou o layout da página" logo ao ligar o scroll.
- Causa: `isPaginationButton()` chamava `el.closest('...,.vjs-*,...')`. `.vjs-*` não é
  seletor CSS válido → `SyntaxError` — capturado pelo `catch` do loop e mascarado como
  `DOM_CHANGED`. Não era mudança de layout.
- Correção: `[class*="vjs-"]` + `safeClosest()` que loga `[PR] seletor inválido` e devolve
  `null` em vez de lançar. Detalhe do erro agora inclui `err.name`.
- Consequência: um seletor errado nunca mais derruba o scroll silenciosamente; o console
  denuncia qual seletor quebrou.

## 2026-11-17 — testes de usabilidade automatizados (headless + CDP)

- Ambiente: Chrome for Testing 147 headless (`--load-extension=dist`, `--remote-debugging-port`,
  `--remote-allow-origins=*`). O Chrome branded 151 **ignora** `--load-extension`; o puppeteer
  Chromium aceita. IDs de extensão não assinada = sha256 do caminho absoluto (hex→a..p).
- Verificado: 6 rotas, estados vazios, troca de provedor (hint/modelo/Sobre), salvar chave,
  `Testar conexão` contra a API real da DeepSeek com chave falsa → `AI_401` com a mensagem do
  provedor (prova URL + header + mapeamento), tema escuro persistindo, 4 cartões de erro via
  `?prError=`, e — com dados semeados no IndexedDB — overview, tabela de vagas, detalhe com
  requisitos ✓/–, expansão do histórico e contagem do corpus do chat.
- 3 defeitos encontrados e corrigidos: hint/Sobre do provedor não atualizavam ao trocar o select;
  dashboard ficava com números velhos quando o painel gravava em outra aba (agora re-renderiza em
  `focus`/`visibilitychange`, com throttle de 1,5 s); `#/job?id=<id>` caía na visão geral.
- Não coberto (exige sessão logada): loop de scroll, extração, expansão de texto, dedupe,
  critérios de parada, contador ao vivo e sobrevivência à morte do SW.

## 2026-11-17 — teste real no feed logado: extrator descobria ~1 post

- Ambiente: Chrome 151 com cópia do perfil do usuário (`~/.config/google-chrome-debug`, sessão LinkedIn
  válida), extensão instalada via CDP `Extensions.loadUnpacked`. Sem porta de debug no perfil padrão
  (Chrome 136+ bloqueia), por isso a cópia.
- Medição no feed real: 9–16 `[data-testid="expandable-text-box"]` montados por tela, mas apenas
  **1–2** âncoras `a[href*="urn:li:activity:"]` no DOM inteiro. O loop rolava normalmente
  (scrollHeight 3.9k → 42k, rounds subindo), mas gravava 1 post por execução.
- Causa: `extractPosts` só descobria posts por âncora de atividade; em 2026 a maioria dos cards não
  linka o próprio URN. `findCard` também dependia dessa âncora.
- Correção: descoberta liderada pelo corpo do post (`expandable-text-box`) → sobe até o item
  virtualizado (`data-lazy-mount-id`/`data-virtualized-item`) → discrimina post de comentário pelo
  aria-label do menu ("Open control menu for post by") ou botão de reação → id por URN do card,
  depois `componentkey`, depois hash autor+texto (prefixos `ck:`/`h:`). Log de rodada passou a
  imprimir escalares em vez de objeto.
- Resultado medido após a correção: 40 s de rolagem → 2 → **24 posts** gravados (lotes de 8, 2 e 12),
  zero texto vazio, zero autor vazio.
- Pendências conhecidas: só 4/29 posts têm id numérico → os demais ficam com URL vazia (sem permalink);
  contador de comentários lido como 0; `authorHeadline` às vezes captura a linha de contexto social
  ("X likes this") em vez do cargo.
- Nota operacional: `chrome.runtime.reload()` via CDP derruba a inscrição da extensão carregada por
  `Extensions.loadUnpacked`; é preciso recarregar pelo chrome://extensions ou reabrir o navegador.
