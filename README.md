# LinkedIn Post Scanner

Extensão Chrome (Manifest V3) que rola o feed do LinkedIn sozinha, extrai os posts, resume com a sua própria chave de IA, detecta vagas e calcula o match com o seu perfil. Tudo roda dentro do navegador — sem backend, sem automação externa.

## Instalar (modo desenvolvedor)

```bash
npm install
npm run build
```

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. **Carregar sem compactação** → selecione a pasta `dist/`
4. Abra `linkedin.com/feed` e clique no ícone da extensão

## Primeiro uso

1. **Dashboard → Configurações**: escolha o provedor, cole a chave e clique em **Testar conexão**.
2. Abra seu perfil (`linkedin.com/in/me`) uma vez — o perfil é lido e salvo para o cálculo de match.
3. Volte ao feed, abra o painel e ligue o **Scroll automático**.
4. Deixe rodar alguns minutos, depois clique em **Gerar resumo**.

Durante o desenvolvimento: `npm run watch` e, a cada mudança, clique em **Recarregar** na extensão e recarregue a aba.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `docs/SPEC.md` | especificação completa (arquitetura, DOM, IA, erros, aceite) |
| `CLAUDE.md` | invariantes e contexto que o Claude Code lê automaticamente |
| `NOTES.md` | descobertas de campo sobre o DOM do LinkedIn |
| `design/prototype.html` | protótipo visual de referência |

## Privacidade

Chaves de IA ficam em `chrome.storage.local`, nunca são exportadas nem enviadas a nenhum servidor além do provedor escolhido. Sem telemetria.
