import { testKey } from '../../shared/ai';
import { isAppError } from '../../shared/errors';
import {
  clearAll,
  getPostsSince,
  listAnalyses,
  listHistory,
  listJobs,
  getProfile,
} from '../../shared/idb';
import { DEFAULT_MODEL, PROVIDER_INFO, PROVIDER_ORDER } from '../../shared/providers';
import {
  getApiKey,
  getSchemaVersion,
  getSettings,
  getTheme,
  setApiKey,
  setSettings,
  setTheme,
} from '../../shared/storage';
import { applyTheme, formatCount, h } from '../../shared/ui';
import type { Provider } from '../../shared/storage';
import { card, cardTitle, pageHeader } from './common';

function download(filename: string, data: string): void {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  void chrome.downloads.download({ url, filename, saveAs: true }).finally(() => {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

export async function renderSettings(): Promise<HTMLElement> {
  const [settings, theme, schemaVersion] = await Promise.all([getSettings(), getTheme(), getSchemaVersion()]);
  const info = PROVIDER_INFO[settings.provider];

  const status = h('p', { class: 'settings-status', text: '' });
  const keyInput = h('input', {
    class: 'input',
    type: 'password',
    placeholder: info.needsKey ? 'cole a chave do provedor' : 'este provedor não usa chave',
    autocomplete: 'off',
    spellcheck: 'false',
    disabled: info.needsKey ? undefined : true,
  }) as HTMLInputElement;

  const existingKey = await getApiKey(settings.provider);

  const providerHint = h('p', { class: 'field-hint', text: info.hint });
  const aboutProvider = h('dd', { text: info.label });
  const keyHint = h('p', {
    class: 'field-hint',
    text: existingKey
      ? 'Existe uma chave salva para este provedor. Ela nunca sai do seu navegador.'
      : 'A chave fica só no chrome.storage.local.',
  });

  // ---------------------------------------------------------------- tema

  const themeButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Tema' });
  for (const option of [
    { id: 'light' as const, label: 'Claro' },
    { id: 'dark' as const, label: 'Escuro' },
  ]) {
    const button = h('button', {
      class: `segmented-btn ${theme === option.id ? 'is-active' : ''}`,
      type: 'button',
      onClick: async () => {
        await setTheme(option.id);
        applyTheme(option.id);
        for (const other of themeButtons.querySelectorAll('button')) other.classList.toggle('is-active', other === button);
      },
    }) as HTMLButtonElement;
    button.textContent = option.label;
    themeButtons.append(button);
  }

  // ---------------------------------------------------------------- provedor + modelo

  const providerSelect = h('select', { class: 'input', 'aria-label': 'Provedor de IA' }) as HTMLSelectElement;
  for (const provider of PROVIDER_ORDER) {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = PROVIDER_INFO[provider].label;
    if (provider === settings.provider) option.selected = true;
    providerSelect.append(option);
  }

  const modelInput = h('input', {
    class: 'input',
    type: 'text',
    value: settings.model,
    list: 'model-options',
    'aria-label': 'Modelo',
  }) as HTMLInputElement;

  const modelList = h('datalist', { id: 'model-options' });
  for (const model of info.models) {
    const option = document.createElement('option');
    option.value = model;
    modelList.append(option);
  }

  providerSelect.addEventListener('change', async () => {
    const provider = providerSelect.value as Provider;
    const next = { provider, model: DEFAULT_MODEL[provider] };
    await setSettings(next);
    modelInput.value = next.model;
    modelList.replaceChildren();
    for (const model of PROVIDER_INFO[provider].models) {
      const option = document.createElement('option');
      option.value = model;
      modelList.append(option);
    }
    const nextInfo = PROVIDER_INFO[provider];
    keyInput.disabled = !nextInfo.needsKey;
    keyInput.placeholder = nextInfo.needsKey ? 'cole a chave do provedor' : 'este provedor não usa chave';
    providerHint.textContent = nextInfo.hint;
    aboutProvider.textContent = nextInfo.label;
    status.textContent = `Provedor alterado para ${nextInfo.label}.`;
    void refreshKeyPlaceholder();
  });

  async function refreshKeyPlaceholder(): Promise<void> {
    const provider = providerSelect.value as Provider;
    const stored = await getApiKey(provider);
    keyInput.value = '';
    keyInput.placeholder = stored ? 'chave salva · digite para substituir' : 'cole a chave do provedor';
    keyHint.textContent = stored
      ? 'Existe uma chave salva para este provedor. Ela nunca sai do seu navegador.'
      : 'A chave fica só no chrome.storage.local.';
  }

  modelInput.addEventListener('change', () => {
    void setSettings({ model: modelInput.value.trim() });
  });

  // ---------------------------------------------------------------- chave

  const saveKeyButton = h('button', { class: 'btn', type: 'button' }, 'Salvar chave') as HTMLButtonElement;
  saveKeyButton.addEventListener('click', async () => {
    const provider = providerSelect.value as Provider;
    const typed = keyInput.value.trim();
    await setApiKey(provider, typed);
    keyInput.value = '';
    status.textContent = typed.length === 0 ? 'Chave removida.' : 'Chave salva.';
    await refreshKeyPlaceholder();
  });

  const testButton = h('button', { class: 'btn btn-primary', type: 'button' }, 'Testar conexão') as HTMLButtonElement;
  testButton.addEventListener('click', async () => {
    const provider = providerSelect.value as Provider;
    testButton.disabled = true;
    status.textContent = 'Testando…';
    try {
      const typed = keyInput.value.trim();
      if (typed.length > 0) await setApiKey(provider, typed);
      const apiKey = await getApiKey(provider);
      const ms = await testKey(provider, modelInput.value.trim() || DEFAULT_MODEL[provider], apiKey);
      status.textContent = `Conectado · ${ms} ms (${PROVIDER_INFO[provider].label} / ${modelInput.value || DEFAULT_MODEL[provider]})`;
    } catch (err) {
      const code = isAppError(err) ? err.code : 'NETWORK_OFFLINE';
      status.textContent = `Falhou (${code}). ${isAppError(err) ? (err.detail ?? '') : ''}`.trim();
    } finally {
      testButton.disabled = false;
      await refreshKeyPlaceholder();
    }
  });

  // ---------------------------------------------------------------- dados

  const dataStatus = h('p', { class: 'settings-status', text: '' });

  const exportButton = h('button', { class: 'btn', type: 'button' }, 'Exportar JSON') as HTMLButtonElement;
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    try {
      const [posts, analyses, jobs, history, profile] = await Promise.all([
        getPostsSince(0),
        listAnalyses(500),
        listJobs(),
        listHistory(500),
        getProfile(),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        posts,
        analyses,
        jobs,
        history,
        profile: profile ?? null,
      };
      download(`post-scanner-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
      dataStatus.textContent = `${formatCount(posts.length)} posts, ${formatCount(analyses.length)} análises exportados.`;
    } catch (err) {
      dataStatus.textContent = `Falha ao exportar: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      exportButton.disabled = false;
    }
  });

  const clearButton = h('button', { class: 'btn btn-danger', type: 'button' }, 'Limpar histórico') as HTMLButtonElement;
  let confirming = false;
  clearButton.addEventListener('click', async () => {
    if (!confirming) {
      confirming = true;
      clearButton.textContent = 'Confirmar limpeza';
      setTimeout(() => {
        confirming = false;
        clearButton.textContent = 'Limpar histórico';
      }, 5000);
      dataStatus.textContent = 'Isso apaga posts, análises, vagas e histórico. Configurações e perfil são mantidos.';
      return;
    }

    confirming = false;
    clearButton.textContent = 'Limpar histórico';
    await clearAll();
    dataStatus.textContent = 'Histórico limpo. Configurações e perfil preservados.';
  });

  const version = chrome.runtime.getManifest().version;
  const versionCard = card(
    cardTitle('Sobre'),
    h('dl', { class: 'facts' },
      h('dt', { text: 'Versão' }),
      h('dd', { text: version }),
      h('dt', { text: 'Schema dos dados' }),
      h('dd', { text: schemaVersion === undefined ? 'não inicializado' : String(schemaVersion) }),
      h('dt', { text: 'Provedor' }),
      aboutProvider,
    ),
    schemaVersion !== 1
      ? h('p', { class: 'settings-warn', text: 'Schema diferente do esperado: recarregue a extensão em chrome://extensions (VERSION_MISMATCH).' })
      : null,
  );

  const settingsCard = card(
    cardTitle('Preferências'),
    h('div', { class: 'field' }, h('label', { class: 'field-label', text: 'Tema' }), themeButtons),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', text: 'Provedor de IA' }),
      providerSelect,
      providerHint,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', text: 'Modelo' }),
      modelInput,
      modelList,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', text: 'Chave de API' }),
      keyInput,
      keyHint,
      h('div', { class: 'row-actions' }, saveKeyButton, testButton),
    ),
    status,
  );

  const dataCard = card(
    cardTitle('Dados'),
    h('p', { class: 'field-hint', text: 'O export não inclui nenhuma chave de API.' }),
    h('div', { class: 'row-actions' }, exportButton, clearButton),
    dataStatus,
  );

  return h('div', { class: 'page' }, pageHeader('Configurações', 'Tudo local: chaves, dados e preferências'), settingsCard, dataCard, versionCard);
}
