import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContentPacks, loadOfficialContent } from '../content/registry';
import type { ContentCatalog } from '../content/registry';
import type { SystemDefinition, ItemDefinition } from '../content/schema';
import { createCharacter, createInitialGameState } from '../domain/model';
import type { GameState } from '../domain/types';
import { testCatalog, testPack } from '../test/fixtures';
import { DEVICE_SETTINGS_KEY, type StoragePort } from './device-settings';
import { createSaveFile } from '../persistence/save-format';
import { GameApp, Icon } from './GameApp';
import { persistProfile, PROFILE_STORE_KEY } from './profile-store';
import { createLocalBackup, LOCAL_BACKUPS_KEY } from './local-backups';
import { MOD_STORE_KEY } from './mod-store';

const nativeMocks = vi.hoisted(() => ({
  native: false,
  configure: vi.fn(async () => undefined),
  setMetadata: vi.fn(async () => undefined),
  setSnapshot: vi.fn(async ({ payload }: { payload: string }) => {
    if (!payload) return;
  }),
  writeBackup: vi.fn(async () => ({ id: 'manual-1.json', createdAt: 1_000 })),
  listBackups: vi.fn(async () => ({
    backups: [{ id: 'manual-1.json', createdAt: 1_000, characterName: 'Aria', automatic: false }],
  })),
  readBackup: vi.fn(async () => ({ payload: '' })),
  cancelNotifications: vi.fn(async () => undefined),
  scheduleNotifications: vi.fn(
    async (request: {
      notifications: Array<{
        id: number;
        title: string;
        body: string;
        isExactNotification?: boolean;
        schedule: { at: Date };
      }>;
    }) => request.notifications.map(({ id }) => id),
  ),
  checkPermissions: vi.fn(async () => ({ display: 'denied' })),
  requestPermissions: vi.fn(async () => ({ display: 'granted' })),
  writeFile: vi.fn(async () => ({ uri: 'content://save' })),
  share: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativeMocks.native },
  registerPlugin: () => ({
    configure: nativeMocks.configure,
    setMetadata: nativeMocks.setMetadata,
    setSnapshot: nativeMocks.setSnapshot,
    writeBackup: nativeMocks.writeBackup,
    listBackups: nativeMocks.listBackups,
    readBackup: nativeMocks.readBackup,
  }),
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: nativeMocks.cancelNotifications,
    schedule: nativeMocks.scheduleNotifications,
    checkPermissions: nativeMocks.checkPermissions,
    requestPermissions: nativeMocks.requestPermissions,
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: nativeMocks.writeFile },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: nativeMocks.share } }));

class MemoryRepository {
  state: GameState | null;
  failNext = false;
  failNextError: unknown = new Error('Database unavailable.');
  returnNullNext = false;
  transactionCount = 0;
  loadCount = 0;

  constructor(initial: GameState | null = null) {
    this.state = initial;
  }

  async load() {
    this.loadCount += 1;
    return this.state;
  }

  async transact(reducer: (state: GameState | null) => GameState): Promise<GameState> {
    this.transactionCount += 1;
    if (this.failNext) {
      this.failNext = false;
      throw this.failNextError;
    }
    const current = this.returnNullNext ? null : this.state;
    this.returnNullNext = false;
    const next = reducer(current);
    this.state = { ...next, revision: (current?.revision ?? 0) + 1 };
    return this.state;
  }
}

class MemoryStorage implements StoragePort {
  values = new Map<string, string>([['eternity-realms:changelog-seen:v1', '0.1.0']]);
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MissingRemainingProfileStorage extends MemoryStorage {
  private readsUntilMissing = 0;

  override getItem(key: string) {
    if (key === PROFILE_STORE_KEY && this.readsUntilMissing > 0) {
      this.readsUntilMissing -= 1;
      if (this.readsUntilMissing === 0) return '[]';
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string) {
    const previousCount =
      key === PROFILE_STORE_KEY ? JSON.parse(super.getItem(key) ?? '[]').length : 0;
    super.setItem(key, value);
    if (key === PROFILE_STORE_KEY && previousCount > 1 && JSON.parse(value).length === 1)
      this.readsUntilMissing = 2;
  }
}

function gameWithCharacter(name = 'Aria') {
  const state = createInitialGameState();
  const character = createCharacter({
    id: `character-${name}`,
    name,
    raceId: 'human',
    classId: 'wanderer',
  });
  character.energy.reserves = { aura: 40, mana: 25, chi: 15 };
  state.character = character;
  return state;
}

async function mountApp(
  options: {
    state?: GameState | null;
    content?: ReturnType<typeof loadOfficialContent>;
    clock?: () => number;
    storage?: StoragePort;
    makeId?: () => string;
  } = {},
) {
  const repository = new MemoryRepository(options.state ?? null);
  const storage = options.storage ?? new MemoryStorage();
  const view = render(
    <GameApp
      repository={repository}
      content={options.content ?? loadOfficialContent()}
      clock={options.clock ?? (() => 1_000)}
      storage={storage}
      makeId={options.makeId ?? (() => 'generated-id')}
    />,
  );
  await screen.findByRole('heading', { name: 'Eternity Realms' });
  await waitFor(() => expect(repository.state).not.toBeNull());
  return { repository, storage, ...view };
}

function tab(name: string) {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Navegação principal' })).getByRole('button', {
      name,
    }),
  );
}

async function openSettings(category?: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir configurações' }));
  if (!category) return;
  const navigation = await screen.findByRole('navigation', { name: 'Configurações' });
  fireEvent.click(within(navigation).getByRole('button', { name: category }));
}

async function createCharacterInUI(name = 'Aventureiro') {
  if (name !== 'Aventureiro') {
    fireEvent.change(screen.getByLabelText('Nome do personagem'), { target: { value: name } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
  await screen.findByRole('heading', { name });
}

function fileWithText(text: string, name: string) {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}

afterEach(() => {
  nativeMocks.native = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Eternity Realms navigation and play flow', () => {
  it('keeps every main destination usable before a character is created', async () => {
    await mountApp({ state: createInitialGameState() });

    expect(screen.getByRole('heading', { name: 'Crie seu personagem' })).toBeInTheDocument();
    tab('Atividades');
    expect(
      await screen.findByRole('heading', { name: 'Atividades e sessões' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar sessão' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado' }));
    expect(
      screen.getByText('Crie um personagem na tela Início para acessar os sistemas de personagem.'),
    ).toBeInTheDocument();

    tab('Combate');
    expect(
      await screen.findByRole('heading', { name: 'Combate e exploração' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Expedições' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Arena' }));
    expect(
      screen.getByText('Crie um personagem na tela Início para acessar os sistemas de personagem.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Bestiário' }));
    expect(screen.getByRole('heading', { name: 'Bestiário' })).toBeInTheDocument();

    tab('Missões');
    expect(screen.getByRole('heading', { name: 'Missões' })).toBeInTheDocument();
    tab('Personagem');
    expect(
      screen.getByText('Crie um personagem na tela Início para acessar os sistemas de personagem.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
  });

  it('renders an icon fallback and the complete activity category set', async () => {
    const categorized = loadContentPacks([
      {
        manifest: { id: 'test.categories', name: 'Categories', version: '1.0.0' },
        records: [
          {
            id: 'item-only-reward',
            kind: 'reward',
            name: 'Reward',
            description: 'No experience.',
            experience: 0,
            items: [{ itemId: 'iron-ore', quantity: 1 }],
          },
          ...[
            ['training', 'training'],
            ['production', 'production'],
            ['profession', 'profession'],
            ['development', 'development'],
          ].map(([id, category]) => ({
            id: `${id}-activity`,
            kind: 'activity',
            name: `${id} activity`,
            description: 'Category coverage.',
            category,
            rewardId: 'item-only-reward',
          })),
        ],
      },
      testPack,
    ]);
    render(<Icon name="unknown-icon" />);
    expect(document.querySelector('svg path')).toHaveAttribute('d', expect.stringContaining('M12'));
    cleanup();

    await mountApp({ state: gameWithCharacter(), content: categorized });
    categorized.items.delete('iron-ore');
    tab('Atividades');
    for (const [category, activity] of [
      ['Treinamentos', 'training activity'],
      ['Coleta', 'Mining'],
      ['Produção', 'production activity'],
      ['Profissões', 'profession activity'],
      ['Desenvolvimento de skills', 'development activity'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: category }));
      expect(screen.getByRole('heading', { name: activity })).toBeInTheDocument();
    }
    expect(screen.getByText('iron-ore ×1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByRole('heading', { name: 'Foraging' })).toBeInTheDocument();
  });

  it('keeps unknown save references visible and handles empty content sections', async () => {
    const state = gameWithCharacter('Aria');
    state.character!.energy.affinity = 'legacy-energy';
    state.character!.raceId = 'legacy-race';
    state.character!.classId = 'legacy-class';
    state.character!.attributes.energetic = { mana: 11 };
    state.character!.inventory = { 'unknown-relic': 2 };
    state.sessions = [
      {
        id: 'active-legacy',
        activityId: 'mining',
        durationMs: 60_000,
        status: 'active',
        createdAt: 1_000,
        startedAt: 1_000,
        elapsedMs: 0,
        lastObservedAt: 1_000,
      },
      {
        id: 'queued-legacy',
        activityId: 'foraging',
        durationMs: 60_000,
        status: 'queued',
        createdAt: 1_000,
      },
    ];
    state.queue = ['active-legacy', 'queued-legacy'];
    state.events = [
      {
        id: 'old-item',
        type: 'item.acquired',
        itemId: 'unknown-item',
        quantity: 1,
        occurredAt: 1_000,
      },
    ];
    const content = loadContentPacks([testPack]);
    await mountApp({ state, content });
    await screen.findByRole('heading', { name: 'Aria' });
    content.races.delete('human');
    content.classes.delete('wanderer');
    content.items.delete('iron-ore');
    content.skills.clear();
    content.missions.clear();
    content.activities.delete('mining');
    content.activities.delete('foraging');
    tab('Atividades');
    fireEvent.click(screen.getByRole('button', { name: 'Treinamentos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    tab('Início');

    expect(screen.getByRole('heading', { name: 'mining' })).toBeInTheDocument();
    expect(screen.getByText('unknown-item')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar fila' }));
    expect(screen.getByText('foraging · na fila')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma atividade desta categoria/)).toBeInTheDocument();
    tab('Missões');
    expect(screen.getByText('Nenhuma missão foi incluída no conteúdo ativo.')).toBeInTheDocument();
    tab('Personagem');
    expect(screen.getByText('legacy-race')).toBeInTheDocument();
    expect(screen.getByText('Raça carregada no save.')).toBeInTheDocument();
    expect(screen.getByText('legacy-class')).toBeInTheDocument();
    expect(screen.getByText('Classe carregada no save.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'legacy-energy' })).toBeInTheDocument();
    expect(screen.getAllByText('Mana')).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: 'Habilidades' }));
    expect(screen.getByText('Nenhuma habilidade carregada.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Inventário' }));
    expect(screen.getAllByText('unknown-relic')).toHaveLength(2);
    expect(screen.getByText('×2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'absent' } });
    expect(screen.getByText('Seu inventário está vazio.')).toBeInTheDocument();
  });

  it('filters quest, dungeon, and raid activities and opens combat sessions in combat', async () => {
    const state = gameWithCharacter('Aria');
    state.sessions = [
      {
        id: 'dungeon-session',
        activityId: 'lost-foundry',
        durationMs: 60_000,
        status: 'active',
        createdAt: 1_000,
        startedAt: 1_000,
        elapsedMs: 0,
        lastObservedAt: 1_000,
      },
    ];
    state.queue = ['dungeon-session'];
    await mountApp({ state, content: loadOfficialContent() });
    for (const category of ['Quests', 'Dungeons', 'Raids', 'Expedições']) {
      tab('Combate');
      fireEvent.click(await screen.findByRole('tab', { name: category }));
      expect(screen.getByRole('heading', { name: 'Combate e exploração' })).toBeInTheDocument();
    }
    tab('Início');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('heading', { name: 'Combate e exploração' })).toBeInTheDocument();
  });

  it('falls back to official content, uses the default identifier, and reports corrupt enabled mods', async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'eternity-realms:mods:v1',
      JSON.stringify([
        {
          pack: {
            manifest: {
              id: 'broken.mod',
              name: 'Mod incompatível',
              version: '1.0.0',
              compatibleWith: '9.9.9',
            },
            records: [],
          },
          enabled: true,
        },
      ]),
    );
    vi.stubGlobal('crypto', { randomUUID: () => 'default-character-id' });
    const repository = new MemoryRepository();
    render(<GameApp repository={repository} storage={storage} clock={() => 1_000} />);
    fireEvent.change(await screen.findByLabelText('Nome do personagem'), {
      target: { value: 'Aria' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await screen.findByRole('heading', { name: 'Aria' });
    expect(repository.state?.character?.id).toBe('default-character-id');

    await openSettings('Mods');
    expect(screen.getByText(/declara compatibilidade com 9.9.9/)).toBeInTheDocument();
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Validar mods carregados' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Há erros no carregamento de mods.',
    );
  });

  it('loads imported mods into the active content catalogue when no custom pack is injected', async () => {
    const storage = new MemoryStorage();
    const repository = new MemoryRepository();
    render(<GameApp repository={repository} storage={storage} clock={() => 1_000} />);
    await screen.findByRole('button', { name: 'Criar personagem' });
    await openSettings('Mods');
    const pack = {
      manifest: { id: 'ui.test-pack', name: 'Pacote de interface', version: '1.0.0' },
      records: [
        {
          id: 'ui.test-shard',
          kind: 'item',
          name: 'Fragmento de teste',
          description: 'Item adicionado pelo gerenciador.',
          stackable: true,
        },
      ],
    };
    const file = fileWithText(JSON.stringify(pack), 'ui-test-pack.json');
    fireEvent.change(screen.getByLabelText('Importar mod local'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Pacote de interface instalado e carregado.',
      ),
    );
    expect(screen.getByText('Carregado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Desabilitar mod' }));
    await waitFor(() => expect(screen.getByText('Desabilitado')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Remover mod' }));
    await waitFor(() => expect(screen.queryByText('Pacote de interface')).not.toBeInTheDocument());
  });

  it('disables session actions without a character and recovers from refresh and settings storage failures', async () => {
    const base = new MemoryStorage();
    const storage: StoragePort = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === 'eternity-realms:device-settings:v1')
          throw new Error('Settings storage unavailable.');
        base.setItem(key, value);
      },
    };
    const { repository } = await mountApp({ storage, content: testCatalog });
    tab('Personagem');
    expect(
      screen.getByText('Crie um personagem na tela Início para acessar os sistemas de personagem.'),
    ).toBeInTheDocument();
    tab('Atividades');
    expect(screen.getByRole('button', { name: 'Adicionar sessão' })).toBeDisabled();

    repository.failNext = true;
    vi.spyOn(repository, 'load').mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.'),
    );
    await openSettings('Aparência e idioma');
    fireEvent.click(screen.getByRole('button', { name: 'Tokyo Night' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Settings storage unavailable.'),
    );
  });

  it('keeps diagnostics when profile persistence and refresh reject non-Error values', async () => {
    const base = new MemoryStorage();
    const storage: StoragePort = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === PROFILE_STORE_KEY) throw 'profile index is locked';
        base.setItem(key, value);
      },
    };
    const repository = new MemoryRepository(gameWithCharacter());
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 1_000}
        storage={storage}
      />,
    );
    await screen.findByRole('heading', { name: 'Aria' });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(document.querySelector('.combat-log')).toHaveTextContent(
      'Não foi possível atualizar o índice de personagens',
    );

    repository.failNext = true;
    repository.failNextError = 'database is read-only';
    tab('Atividades');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.'),
    );
    await openSettings('Desenvolvimento e debug');

    vi.spyOn(repository, 'load').mockRejectedValueOnce('offline');
    const loadSpy = vi.mocked(repository.load);
    fireEvent.focus(window);
    await waitFor(() => expect(loadSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.'),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(document.querySelector('.combat-log')).toHaveTextContent('Falha ao reconciliar o save');

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    const settingsErrorStorage: StoragePort = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === DEVICE_SETTINGS_KEY) throw 'settings are read-only';
        base.setItem(key, value);
      },
    };
    cleanup();
    const settingsRepository = new MemoryRepository(gameWithCharacter());
    render(
      <GameApp
        repository={settingsRepository}
        content={testCatalog}
        clock={() => 1_000}
        storage={settingsErrorStorage}
      />,
    );
    await screen.findByRole('heading', { name: 'Aria' });
    await openSettings('Aparência e idioma');
    fireEvent.click(screen.getByRole('button', { name: 'Tokyo Night' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.'),
    );
  });

  it('organizes the five destinations and their dedicated subsections', async () => {
    const state = gameWithCharacter();
    state.character!.skills['magic-skill'] = { level: 5, experience: 25, extensions: {} };
    const content = loadOfficialContent();
    const legacySkill = content.skills.get('study-training')!;
    content.skills.set('legacy-skill', {
      ...legacySkill,
      id: 'legacy-skill',
      name: 'Legacy skill',
      activityIds: [],
      experiencePerLevel: undefined,
      milestones: undefined,
    });
    await mountApp({ state, content });
    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Atividades', 'Combate', 'Início', 'Missões', 'Personagem']);

    tab('Atividades');
    expect(screen.getByRole('heading', { name: 'Atividades e sessões' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Treinamentos' }));
    expect(screen.getByRole('heading', { name: 'Meditação de Mana' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));

    tab('Combate');
    expect(
      await screen.findByRole('heading', { name: 'Combate e exploração' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Bestiário' }));
    expect(screen.getByRole('heading', { name: 'Bestiário' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Arena' }));
    expect(
      screen.getByRole('combobox', { name: 'Construção salva para teste: Selecione' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Registros' }));
    expect(screen.getByRole('heading', { name: 'Combates recentes' })).toBeInTheDocument();

    tab('Missões');
    expect(screen.getByRole('heading', { name: 'Missões' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Diárias' }));
    expect(screen.getByRole('heading', { name: 'Rotina diária' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Semanais' }));
    expect(screen.getByRole('heading', { name: 'Semana de expedições' })).toBeInTheDocument();

    tab('Personagem');
    expect(screen.getByRole('heading', { name: 'Capacidades' })).toBeInTheDocument();
    expect(screen.getAllByText('Aura')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Equipamentos' }));
    expect(screen.getByRole('heading', { name: 'Build equipada' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Inventário' }));
    expect(screen.getByRole('heading', { name: 'Inventário' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Habilidades' }));
    expect(screen.getByRole('heading', { name: 'Habilidades' })).toBeInTheDocument();
    const magicCard = screen.getByRole('heading', { name: 'Magia' }).closest('article');
    expect(magicCard).not.toBeNull();
    fireEvent.click(within(magicCard!).getByText('Marcos de progressão'));
    expect(within(magicCard!).getByText('Praticante · Nível 5 · Desbloqueado')).toBeInTheDocument();
    expect(within(magicCard!).getByText('Especialista · Nível 10 · Bloqueado')).toBeInTheDocument();
    expect(
      within(magicCard!).getByText('Aumenta em 10% o dano mágico de armas, técnicas e nós.'),
    ).toBeInTheDocument();
    const legacyCard = screen.getByRole('heading', { name: 'Legacy skill' }).closest('article');
    expect(legacyCard).not.toBeNull();
    expect(within(legacyCard!).getByText('Nível 0 · 0 / 100 XP')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Construções' }));
    expect(screen.getByRole('heading', { name: 'Editor universal de nós' })).toBeInTheDocument();

    tab('Início');
    expect(screen.getByText('As próximas conquistas aparecerão aqui.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Planejar atividades' }));
    expect(screen.getByRole('heading', { name: 'Atividades e sessões' })).toBeInTheDocument();
    tab('Início');
    fireEvent.click(screen.getByRole('button', { name: 'Explorar combate' }));
    expect(screen.getByRole('heading', { name: 'Combate e exploração' })).toBeInTheDocument();
    tab('Início');
    fireEvent.click(screen.getByRole('button', { name: 'Ver personagem' }));
    expect(screen.getByRole('heading', { name: 'Editor universal de nós' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Visão geral' }));
    expect(screen.getByRole('heading', { name: 'Capacidades' })).toBeInTheDocument();
    tab('Início');
    fireEvent.click(screen.getByRole('button', { name: 'Ver missões' }));
    expect(screen.getByRole('heading', { name: 'Missões' })).toBeInTheDocument();
  });

  it('starts from the packaged activity catalogue and opens an active session from home', async () => {
    const { repository } = await mountApp({
      state: gameWithCharacter('Aria'),
      content: loadOfficialContent(),
      makeId: () => 'gathering-session',
    });
    tab('Início');
    fireEvent.click(screen.getByRole('button', { name: 'Planejar atividades' }));
    fireEvent.click(screen.getByRole('button', { name: 'Coleta' }));
    expect(screen.getByRole('heading', { name: 'Mineração' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Duração em minutos'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Adicionar à fila' })[0]!);
    await waitFor(() => expect(repository.state?.queue).toEqual(['gathering-session']));
    tab('Início');
    expect(screen.getByRole('heading', { name: 'Mineração' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('heading', { name: 'Atividades e sessões' })).toBeInTheDocument();
  });

  it('opens a dedicated activity sheet with progress, rewards, requirements and session controls', async () => {
    const state = gameWithCharacter();
    state.sessions = [
      {
        id: 'mining-cycle-1',
        activityId: 'mining',
        durationMs: 120_000,
        status: 'completed',
        createdAt: 10,
        finishedAt: 120_010,
      },
    ];
    const { repository } = await mountApp({ state, makeId: () => 'mining-cycle-2' });
    tab('Atividades');
    const card = screen
      .getByRole('heading', { name: 'Mineração' })
      .closest<HTMLElement>('.activity-card');
    fireEvent.click(within(card!).getByRole('button', { name: 'Ver detalhes' }));
    expect(screen.getByRole('heading', { name: 'Mineração' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2 min')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Benefícios' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requisitos e progressão' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planejar sessão' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await waitFor(() => expect(repository.state?.queue).toContain('mining-cycle-2'));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar às atividades' }));
    expect(screen.getByRole('heading', { name: 'Atividades e sessões' })).toBeInTheDocument();
  });

  it('shows localized fallbacks for mod activities without rewards or linked skills', async () => {
    const content = {
      ...testCatalog,
      activities: new Map(testCatalog.activities),
      rewards: new Map(testCatalog.rewards),
    };
    const source = content.activities.get('mining')!;
    content.activities.set('arcane-routine', {
      ...source,
      id: 'arcane-routine',
      name: 'Rotina arcana',
      category: 'arcana',
      rewardId: 'missing-reward',
    });
    content.rewards.set('mod:unknown-item-reward', {
      ...content.rewards.get('mining-reward')!,
      id: 'mod:unknown-item-reward',
      items: [{ itemId: 'missing:crystal', quantity: 1 }],
    });
    content.activities.set('missing-drop-routine', {
      ...source,
      id: 'missing-drop-routine',
      name: 'Rotina de cristal',
      category: 'arcana',
      rewardId: 'mod:unknown-item-reward',
    });
    await mountApp({ state: gameWithCharacter('Aria'), content });
    tab('Atividades');
    const card = screen
      .getByRole('heading', { name: 'Rotina arcana' })
      .closest<HTMLElement>('.activity-card');
    fireEvent.click(within(card!).getByRole('button', { name: 'Ver detalhes' }));
    expect(screen.getByText('Atividade')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma recompensa específica foi definida.')).toBeInTheDocument();
    expect(
      screen.getByText('Nenhuma habilidade está vinculada a esta atividade.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar às atividades' }));
    const missingDropCard = screen
      .getByRole('heading', { name: 'Rotina de cristal' })
      .closest<HTMLElement>('.activity-card');
    fireEvent.click(within(missingDropCard!).getByRole('button', { name: 'Ver detalhes' }));
    expect(screen.getByText('missing:crystal ×1')).toBeInTheDocument();
  });

  it('keeps an unchanged SQLite refresh read-only to avoid redundant persistence and UI updates', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter() });
    expect(repository.transactionCount).toBe(0);
    const loadsBeforeRefresh = repository.loadCount;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(repository.loadCount).toBeGreaterThan(loadsBeforeRefresh));
    expect(repository.transactionCount).toBe(0);
  });

  it('checkpoints active sessions and reconciles when the app returns to the foreground', async () => {
    nativeMocks.native = true;
    nativeMocks.setSnapshot
      .mockRejectedValueOnce('snapshot service unavailable')
      .mockRejectedValueOnce(new Error('snapshot storage unavailable'));
    vi.useFakeTimers();
    let now = 1_000;
    const state = gameWithCharacter();
    state.sessions = [
      {
        id: 'foreground-session',
        activityId: 'mining',
        durationMs: 60_000,
        status: 'active',
        createdAt: now,
        startedAt: now,
        elapsedMs: 0,
        lastObservedAt: now,
      },
    ];
    state.queue = ['foreground-session'];
    const repository = new MemoryRepository(state);
    const storage = new MemoryStorage();
    storage.setItem(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({ backup: { frequency: 'daily', retention: 7 } }),
    );
    const view = render(
      <GameApp repository={repository} content={testCatalog} clock={() => now} storage={storage} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Aria' })).toBeInTheDocument();
    expect(nativeMocks.scheduleNotifications).toHaveBeenCalledTimes(1);
    expect(nativeMocks.setSnapshot).toHaveBeenCalledTimes(1);

    now += 15_000;
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.state?.sessions[0]).toMatchObject({
      elapsedMs: 15_000,
      lastObservedAt: 16_000,
    });
    expect(nativeMocks.scheduleNotifications).toHaveBeenCalledTimes(1);
    expect(nativeMocks.setSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.state?.sessions[0]).toMatchObject({
      elapsedMs: 15_000,
      lastObservedAt: 16_000,
    });

    const loads = repository.loadCount;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      fireEvent(document, new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(repository.loadCount).toBe(loads);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    now += 1_000;
    await act(async () => {
      fireEvent.focus(window);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.loadCount).toBeGreaterThan(loads);
    const loadsAfterFocus = repository.loadCount;
    await act(async () => {
      fireEvent.focus(window);
      await Promise.resolve();
    });
    expect(repository.loadCount).toBe(loadsAfterFocus);

    repository.failNext = true;
    repository.failNextError = 'disk unavailable';
    now += 15_000;
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.failNext).toBe(false);

    now += 30_000;
    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.state?.sessions[0]?.status).toBe('completed');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('creates and completes sessions once, keeping active progress when the clock moves backward', async () => {
    let now = 1_000;
    let serial = 0;
    const { repository } = await mountApp({
      content: testCatalog,
      clock: () => now,
      makeId: () => `s${++serial}`,
    });
    await createCharacterInUI('Aria');
    tab('Atividades');
    fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar atividade: Mining' }));
    fireEvent.click(screen.getByRole('option', { name: 'Mining' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · em andamento');
    expect(repository.state?.queue).toEqual(['s2']);

    now += 1_800_000;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(repository.state?.sessions[0]?.status).toBe('completed'));
    expect(repository.state?.character?.inventory['iron-ore']).toBe(2);
    expect(
      repository.state?.events.filter((event) => event.type === 'reward.granted'),
    ).toHaveLength(1);

    now = 10;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(repository.state?.sessions[0]?.status).toBe('completed'));
    expect(repository.state?.character?.inventory['iron-ore']).toBe(2);
    expect(
      repository.state?.events.filter((event) => event.type === 'reward.granted'),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · em andamento');
    now += 15_000;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(repository.state?.sessions[1]?.elapsedMs).toBe(15_000));
    now = 500;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() =>
      expect(repository.state?.sessions[1]).toMatchObject({ status: 'active', elapsedMs: 15_000 }),
    );
  });

  it('shows and records first-install news, then opens the release list from settings', async () => {
    const storage = new MemoryStorage();
    storage.values.delete('eternity-realms:changelog-seen:v1');
    await mountApp({ storage });
    expect(await screen.findByRole('dialog', { name: 'Novidades' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar jornada' }));
    expect(storage.getItem('eternity-realms:changelog-seen:v1')).toBe('0.1.0');
    await openSettings('Novidades e atualizações');
    fireEvent.click(screen.getByRole('button', { name: 'Novidades' }));
    expect(await screen.findByRole('dialog', { name: 'Novidades' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar novidades' }));
  });

  it('persists themes, motion, notification, backup and update preferences outside character saves', async () => {
    const { storage } = await mountApp();
    await openSettings('Aparência e idioma');
    fireEvent.click(screen.getByRole('button', { name: 'Tokyo Night' }));
    expect(document.documentElement.dataset.theme).toBe('tokyo-night');
    fireEvent.click(screen.getByRole('switch', { name: 'Movimento reduzido' }));
    expect(document.documentElement.dataset.motion).toBe('reduced');
    fireEvent.change(screen.getByLabelText(/Tamanho da fonte/), { target: { value: '115' } });
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.15');
    expect(JSON.parse(storage.getItem('eternity-realms:device-settings:v1') ?? '{}')).toMatchObject(
      { theme: 'tokyo-night', motion: 'reduced', fontScale: 1.15 },
    );

    await openSettings('Notificações');
    fireEvent.click(screen.getByRole('switch', { name: 'Conclusão de sessões' }));
    expect(
      JSON.parse(storage.getItem('eternity-realms:device-settings:v1') ?? '{}').notifications
        .sessionComplete,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ativar notificações no Android' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Notificações locais estão disponíveis na versão Android.',
    );

    await openSettings('Saves e backups');
    fireEvent.click(screen.getByRole('combobox', { name: 'Frequência automática: Desativada' }));
    fireEvent.click(screen.getByRole('option', { name: 'Diária' }));
    expect(
      JSON.parse(storage.getItem('eternity-realms:device-settings:v1') ?? '{}').backup.frequency,
    ).toBe('daily');
    await openSettings('Novidades e atualizações');
    fireEvent.click(screen.getByRole('combobox', { name: 'Canal de atualizações: Estável' }));
    fireEvent.click(screen.getByRole('option', { name: 'Prévia' }));
    expect(
      JSON.parse(storage.getItem('eternity-realms:device-settings:v1') ?? '{}').updateChannel,
    ).toBe('preview');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Não foi possível verificar sem conexão.',
      ),
    );
  });

  it('manages multiple characters and confirms reset and delete operations', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter('Aria') });
    await screen.findByText('Aria');
    await openSettings('Personagens');
    expect(screen.getByText('Aria')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Criar outro personagem'), {
      target: { value: 'Luna' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar outro personagem' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Luna'));
    expect(screen.getByText('Aria')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar personagem' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Aria'));

    fireEvent.click(screen.getByRole('button', { name: 'Redefinir progresso' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O progresso deste personagem será redefinido.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Aria'));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir personagem' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Este personagem e suas sessões serão excluídos.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar operação' }));
    expect(repository.state?.character?.name).toBe('Aria');

    fireEvent.click(screen.getByRole('button', { name: 'Excluir personagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Luna'));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir personagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character).toBeNull());
    expect(repository.state?.sessions).toEqual([]);
  });

  it('recovers to a clean state if the remaining profile disappears during deletion', async () => {
    const storage = new MissingRemainingProfileStorage();
    persistProfile(storage, gameWithCharacter('Aria'), 1_000);
    persistProfile(storage, gameWithCharacter('Luna'), 1_001);
    const { repository } = await mountApp({ state: gameWithCharacter('Aria'), storage });
    await openSettings('Personagens');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir personagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(
      'Personagem excluído após a criação de um backup.',
    );
  });

  it('surfaces a raw backup storage failure before resetting character progress', async () => {
    const base = new MemoryStorage();
    const storage: StoragePort = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === LOCAL_BACKUPS_KEY) throw 'backup storage is full';
        base.setItem(key, value);
      },
    };
    await mountApp({ state: gameWithCharacter('Aria'), storage });
    await openSettings('Personagens');
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir progresso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.'),
    );
  });

  it('keeps character actions safe without a character and detects a missing local backup', async () => {
    const storage = new MemoryStorage();
    await mountApp({ storage });
    await openSettings('Personagens');
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir progresso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir personagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));

    await openSettings('Saves e backups');
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }));
    await waitFor(() => expect(storage.getItem(LOCAL_BACKUPS_KEY)).toContain('manual-1000'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:empty-save'),
      revokeObjectURL: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar save' }));
    expect(click).toHaveBeenCalledOnce();

    storage.setItem(LOCAL_BACKUPS_KEY, '[]');
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Backup não encontrado.'),
    );
  });

  it('uses safe fallbacks while the save is loading and restores a backup into the loaded state', async () => {
    const storage = new MemoryStorage();
    createLocalBackup(storage, gameWithCharacter('Restaurada'), 900);
    const repository = new MemoryRepository();
    let resolveLoad: (state: GameState | null) => void = () => undefined;
    vi.spyOn(repository, 'load').mockImplementation(
      () => new Promise((resolve) => (resolveLoad = resolve)),
    );
    render(
      <GameApp
        repository={repository}
        storage={storage}
        content={testCatalog}
        clock={() => 1_000}
      />,
    );
    await screen.findByRole('button', { name: 'Abrir configurações' });
    await openSettings('Saves e backups');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }));
    expect(JSON.parse(storage.getItem(LOCAL_BACKUPS_KEY) ?? '[]')).toHaveLength(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Restaurada'));
    resolveLoad(repository.state);
  });

  it('uses a fresh state when creating a character and drops queue IDs absent from the save', async () => {
    const empty = createInitialGameState();
    empty.queue = ['removed-session'];
    const { repository } = await mountApp({ state: empty, content: testCatalog });
    tab('Atividades');
    expect(screen.getByText('Nenhuma sessão planejada.')).toBeInTheDocument();
    await openSettings('Personagens');
    fireEvent.change(screen.getByLabelText('Criar outro personagem'), {
      target: { value: 'Lua' },
    });
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Criar outro personagem' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Lua'));
  });

  it('ignores character switches while the save is still loading', async () => {
    const other = gameWithCharacter('Outro');
    const delayedStorage = new MemoryStorage();
    persistProfile(delayedStorage, other, 1_001);
    const delayedRepository = new MemoryRepository();
    let resolveLoad: (state: GameState | null) => void = () => undefined;
    vi.spyOn(delayedRepository, 'load').mockImplementation(
      () => new Promise((resolve) => (resolveLoad = resolve)),
    );
    render(<GameApp repository={delayedRepository} storage={delayedStorage} clock={() => 1_000} />);
    await screen.findByRole('button', { name: 'Abrir configurações' });
    await openSettings('Personagens');
    fireEvent.click(within(screen.getByText('Outro').closest('article')!).getByRole('button'));
    expect(delayedRepository.transactionCount).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao jogo' }));
    resolveLoad(gameWithCharacter('Atual'));
    await screen.findByRole('heading', { name: 'Atual' });
  });

  it('covers queued session edit, reorder, cancel and add fallbacks from a missing transaction state', async () => {
    const state = gameWithCharacter('Fila');
    state.sessions = [
      {
        id: 'active',
        activityId: 'mining',
        durationMs: 120_000,
        status: 'active',
        createdAt: 1_000,
        startedAt: 1_000,
        elapsedMs: 0,
        lastObservedAt: 1_000,
      },
      {
        id: 'queued-2',
        activityId: 'mining',
        durationMs: 120_000,
        status: 'queued',
        createdAt: 1_000,
      },
      {
        id: 'queued-3',
        activityId: 'mining',
        durationMs: 120_000,
        status: 'queued',
        createdAt: 1_000,
      },
    ];
    state.queue = ['active', 'queued-2', 'queued-3'];
    const { repository } = await mountApp({ state, clock: () => 1_000 });
    tab('Atividades');

    repository.returnNullNext = true;
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar duração' })[0]!);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'A sessão selecionada não está mais disponível',
      ),
    );
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mover sessão 3 para cima' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'A sessão selecionada não está mais disponível',
      ),
    );
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão ativa' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Não há sessão ativa para cancelar'),
    );
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Crie um personagem antes de iniciar uma sessão',
      ),
    );
  });

  it('reports startup reconciliation failures and checkpoints active sessions idempotently', async () => {
    const startupRepository = new MemoryRepository();
    startupRepository.failNext = true;
    vi.spyOn(startupRepository, 'load').mockResolvedValue(null);
    render(
      <GameApp repository={startupRepository} storage={new MemoryStorage()} clock={() => 1_000} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.');

    cleanup();
    let checkpoint: (() => void) | undefined;
    vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout) => {
      if (timeout === 15_000 && typeof handler === 'function') checkpoint = handler as () => void;
      return 17 as unknown as ReturnType<typeof window.setInterval>;
    });
    const state = gameWithCharacter('Checkpoint');
    state.sessions = [
      {
        id: 'checkpoint-active',
        activityId: 'mining',
        durationMs: 60_000,
        status: 'active',
        createdAt: 1_000,
        startedAt: 1_000,
        elapsedMs: 0,
        lastObservedAt: 1_000,
      },
    ];
    state.queue = ['checkpoint-active'];
    const storage = new MemoryStorage();
    const { repository } = await mountApp({ state, storage, clock: () => 1_000 });
    await waitFor(() => expect(checkpoint).toBeTypeOf('function'));
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    repository.failNext = true;
    repository.failNextError = new Error('checkpoint write failed');
    await act(async () => {
      checkpoint?.();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    repository.failNext = true;
    repository.failNextError = 'checkpoint write locked';
    await act(async () => {
      checkpoint?.();
      await Promise.resolve();
    });
    repository.returnNullNext = true;
    await act(async () => {
      checkpoint?.();
      await Promise.resolve();
    });
    expect(repository.transactionCount).toBeGreaterThanOrEqual(4);
  });

  it('covers settings mod error paths without changing the installed catalogue', async () => {
    const base = new MemoryStorage();
    let failure: unknown;
    const storage: StoragePort = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === MOD_STORE_KEY && failure) throw failure;
        base.setItem(key, value);
      },
    };
    await mountApp({ state: gameWithCharacter('Mods'), storage });
    await openSettings('Mods');
    const pack = {
      manifest: { id: 'failure.mod', name: 'Mod de falha', version: '1.0.0' },
      records: [],
    };
    fireEvent.change(screen.getByLabelText('Importar mod local'), {
      target: { files: [fileWithText(JSON.stringify(pack), 'failure.json')] },
    });
    await screen.findByText('Mod de falha');

    failure = new Error('toggle failed');
    fireEvent.click(screen.getByRole('switch', { name: 'Desabilitar mod' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('toggle failed');
    failure = 'toggle unavailable';
    fireEvent.click(screen.getByRole('switch', { name: 'Desabilitar mod' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao alterar o mod.');
    failure = new Error('remove failed');
    fireEvent.click(screen.getByRole('button', { name: 'Remover mod' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('remove failed');
    failure = 'remove unavailable';
    fireEvent.click(screen.getByRole('button', { name: 'Remover mod' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao remover o mod.');
  });

  it('runs development actions with missing optional state and missing transaction snapshots', async () => {
    const state = gameWithCharacter('Debug');
    state.combatRecords = undefined as unknown as GameState['combatRecords'];
    const { repository } = await mountApp({ state, content: loadOfficialContent() });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspecionar estado e RNG' }));
    expect(screen.getByRole('status')).toHaveTextContent('rngSeeds');

    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Simular combate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Crie um personagem antes de iniciar uma sessão',
      ),
    );
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Conceder 100 XP' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Crie um personagem'));
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Avançar tempo virtual' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('tempo virtual foi processada'),
    );
  });

  it('shows unknown activity, mission reward, and equipment references from older content', async () => {
    const custom = loadContentPacks([
      {
        ...testPack,
        manifest: { id: 'test.legacy', name: 'Legacy', version: '1.0.0' },
        records: [
          ...testPack.records,
          {
            id: 'legacy-activity',
            kind: 'activity',
            name: 'Atividade esquecida',
            description: 'Categoria antiga.',
            rewardId: 'mining-reward',
            category: 'arcana-legacy',
          },
        ],
      },
    ]);
    const { container } = await mountApp({ state: gameWithCharacter('Legado'), content: custom });
    tab('Atividades');
    expect(within(container).getByText('Atividade')).toBeInTheDocument();

    cleanup();
    const content = loadOfficialContent();
    const mission = [...content.missions.values()].find((entry) => entry.id === 'first-steps')!;
    mission.reward.items = { ...mission.reward.items, 'legacy:reward': 2 };
    const state = gameWithCharacter('Legado');
    state.events.push({
      id: 'legacy-completion',
      type: 'session.completed',
      occurredAt: 1_000,
      sessionId: 'legacy-session',
      activityId: 'mining',
    });
    state.character!.equipment.primary = 'legacy:blade';
    const { repository } = await mountApp({ state, content, clock: () => 1_000 });
    await screen.findByRole('heading', { name: 'Legado' });
    tab('Missões');
    expect(screen.getByText('legacy:reward ×2')).toBeInTheDocument();
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Resgatar recompensa' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Equipamentos' }));
    expect(await screen.findByText('legacy:blade')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Forja' }));
    expect(screen.getByRole('heading', { name: 'Forja e builds' })).toBeInTheDocument();
  });

  it('creates, lists, restores and exports validated saves', async () => {
    const { repository, storage } = await mountApp({
      state: gameWithCharacter('Aria'),
      clock: () => 10_000,
    });
    await openSettings('Saves e backups');
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Backup criado e validado.');
    expect(screen.getByText(/Aria · manual/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar backup' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Restaurar este backup');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Backup restaurado após validação de integridade.',
    );
    expect(repository.state?.character?.name).toBe('Aria');

    const createObjectURL = vi.fn(() => 'blob:save');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Exportar save' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(repository.state?.character?.id).toBe('character-Aria');
    expect(storage.getItem('eternity-realms:backups:v1')).toContain('manual-10000');
  });

  it('loads the custom mod manager and debug operations against real state', async () => {
    const { repository, storage } = await mountApp({
      state: gameWithCharacter('Aria'),
      content: testCatalog,
    });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conceder 100 XP' }));
    await waitFor(() => expect(repository.state?.character?.experience.total).toBe(100));
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear nós carregados' }));
    await waitFor(() =>
      expect(repository.state?.character?.nodeLibrary?.unlockedNodeIds).toContain(
        'core:source-caster',
      ),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(screen.getByRole('heading', { name: 'Logs do jogo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Validar mods carregados' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Validação concluída: 0 mods instalados.',
    );

    await openSettings('Mods');
    const pack = {
      manifest: { id: 'test.mod', name: 'Mod de teste', version: '1.0.0' },
      records: [],
    };
    const file = new File([JSON.stringify(pack)], 'test.mod.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(pack) });
    fireEvent.change(screen.getByLabelText('Importar mod local'), { target: { files: [file] } });
    await screen.findByText('Mod de teste');
    expect(storage.getItem('eternity-realms:mods:v1')).toContain('test.mod');
    fireEvent.click(screen.getByRole('switch', { name: 'Desabilitar mod' }));
    await waitFor(() =>
      expect(JSON.parse(storage.getItem('eternity-realms:mods:v1') ?? '[]')[0].enabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar mod' }));
    await waitFor(() =>
      expect(JSON.parse(storage.getItem('eternity-realms:mods:v1') ?? '[]')[0].enabled).toBe(true),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:enabled-mod-save'),
      revokeObjectURL: vi.fn(),
    });
    await openSettings('Saves e backups');
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backup criado'));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar save' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(storage.getItem(LOCAL_BACKUPS_KEY)).toContain('test.mod');
    await openSettings('Mods');
    fireEvent.click(screen.getByRole('button', { name: 'Remover mod' }));
    await waitFor(() =>
      expect(JSON.parse(storage.getItem('eternity-realms:mods:v1') ?? '[]')).toEqual([]),
    );

    const incompatible = {
      manifest: { id: 'old.mod', name: 'Mod antigo', version: '1.0.0', compatibleWith: '9.9.9' },
      records: [],
    };
    fireEvent.change(screen.getByLabelText('Importar mod local'), {
      target: { files: [fileWithText(JSON.stringify(incompatible), 'old.mod.json')] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('declara compatibilidade com 9.9.9');
  });

  it('recovers from a persistence failure and validates missing starter content', async () => {
    const { repository } = await mountApp({ content: testCatalog });
    repository.failNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.');
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    const noStarterContent = loadContentPacks([
      { manifest: { id: 'empty', name: 'Vazio', version: '1.0.0' }, records: [] },
    ]);
    cleanup();
    const emptyRepository = new MemoryRepository();
    render(
      <GameApp
        repository={emptyRepository}
        content={noStarterContent}
        storage={new MemoryStorage()}
        clock={() => 1}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Criar personagem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nenhuma raça ou classe inicial foi carregada.',
    );
  });

  it('logs Error objects from profile persistence failures when verbose logs are enabled', async () => {
    const base = new MemoryStorage();
    const storage: StoragePort = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (key === PROFILE_STORE_KEY) throw new Error('profile index is read-only');
        base.setItem(key, value);
      },
    };
    await mountApp({ state: gameWithCharacter('Aria'), storage });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(document.querySelector('.combat-log')).toHaveTextContent(
      'Não foi possível atualizar o índice de personagens',
    );
    expect(document.querySelector('.combat-log')).toHaveTextContent('profile index is read-only');
  });

  it('logs native backup, session, and mission notification Error failures', async () => {
    nativeMocks.native = true;
    nativeMocks.configure.mockRejectedValueOnce(new Error('backup schedule failed'));
    nativeMocks.scheduleNotifications.mockRejectedValueOnce(new Error('session notice failed'));
    let now = 1_000;
    const state = gameWithCharacter('Aria');
    state.sessions = [
      {
        id: 'mission-notice-session',
        activityId: 'mining',
        durationMs: 1_000,
        status: 'active',
        createdAt: now,
        startedAt: now,
        elapsedMs: 0,
        lastObservedAt: now,
      },
    ];
    state.queue = ['mission-notice-session'];
    const { repository } = await mountApp({ state, clock: () => now });
    await waitFor(() => expect(nativeMocks.configure).toHaveBeenCalled());
    await waitFor(() => expect(nativeMocks.scheduleNotifications).toHaveBeenCalledOnce());
    nativeMocks.scheduleNotifications.mockRejectedValueOnce(
      new Error('mission ready notice failed'),
    );
    now = 2_000;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() =>
      expect(repository.state?.events.some((event) => event.type === 'session.completed')).toBe(
        true,
      ),
    );
    await waitFor(() => expect(nativeMocks.scheduleNotifications).toHaveBeenCalledTimes(2));
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    const logs = document.querySelector('.combat-log');
    expect(logs).toHaveTextContent('Não foi possível atualizar o agendamento de backups');
    expect(logs).toHaveTextContent('backup schedule failed');
    expect(logs).toHaveTextContent('Falha ao sincronizar a notificação de sessão');
    expect(logs).toHaveTextContent('session notice failed');
    expect(logs).toHaveTextContent('Falha ao notificar uma missão disponível');
    expect(logs).toHaveTextContent('mission ready notice failed');
  });

  it('guards development actions without a character or combat content', async () => {
    await mountApp({ content: testCatalog });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conceder 100 XP' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Crie um personagem antes de usar as ferramentas de desenvolvimento.',
      ),
    );

    cleanup();
    await mountApp({ state: gameWithCharacter('Aria'), content: testCatalog });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simular combate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Nenhuma expedição de combate está carregada.',
      ),
    );
  });

  it('edits and reorders queued sessions, cancels the active cycle, and starts the next item', async () => {
    let serial = 0;
    const { repository } = await mountApp({
      state: gameWithCharacter(),
      content: testCatalog,
      makeId: () => `queue-${++serial}`,
    });
    tab('Atividades');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · em andamento');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await waitFor(() => expect(repository.state?.queue).toEqual(['queue-1', 'queue-2', 'queue-3']));

    const queuedDuration = screen.getByLabelText('Duração da sessão 2 em minutos');
    fireEvent.change(queuedDuration, { target: { value: '45' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar duração' })[0]!);
    await waitFor(() =>
      expect(
        repository.state?.sessions.find((session) => session.id === 'queue-2')?.durationMs,
      ).toBe(45 * 60_000),
    );
    fireEvent.change(screen.getByLabelText('Duração da sessão 2 em minutos'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar duração' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A duração da sessão deve ser um número inteiro positivo.',
    );
    fireEvent.change(screen.getByLabelText('Duração da sessão 2 em minutos'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mover sessão 3 para cima' }));
    await waitFor(() => expect(repository.state?.queue).toEqual(['queue-1', 'queue-3', 'queue-2']));

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão ativa' }));
    await waitFor(() =>
      expect(repository.state?.sessions.find((session) => session.id === 'queue-1')?.status).toBe(
        'cancelled',
      ),
    );
    await waitFor(() =>
      expect(repository.state?.sessions.find((session) => session.id === 'queue-3')?.status).toBe(
        'active',
      ),
    );
  });

  it('imports a valid save after preserving the old state and reports missing mod dependencies', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter('Original') });
    const imported = gameWithCharacter('Importado');
    const payload = createSaveFile(imported, {
      applicationVersion: '0.1.0',
      databaseVersion: 2,
      exportedAt: 4_000,
      modDependencies: [],
    });
    await openSettings('Saves e backups');
    const saveFile = fileWithText(payload, 'jornada.json');
    fireEvent.change(screen.getByLabelText('Importar save'), { target: { files: [saveFile] } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Importado'));

    const incompatible = createSaveFile(gameWithCharacter('Incompatível'), {
      applicationVersion: '0.1.0',
      databaseVersion: 2,
      exportedAt: 5_000,
      modDependencies: ['missing.mod'],
    });
    fireEvent.change(screen.getByLabelText('Importar save'), {
      target: { files: [fileWithText(incompatible, 'incompatível.json')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ative os mods exigidos por este save: missing.mod.',
    );
    expect(repository.state?.character?.name).toBe('Importado');
  });

  it('runs every development operation against the real game state and checks releases', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter('Aria') });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar recurso de teste' }));
    await waitFor(() => expect(repository.state?.character?.inventory['iron-ore']).toBe(5));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar tempo virtual' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Uma hora de tempo virtual foi processada',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simular combate' }));
    await waitFor(() => expect(repository.state?.combatRecords?.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Inspecionar estado e RNG' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('processedEventCount'),
    );

    await openSettings('Novidades e atualizações');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            tag_name: 'v0.2.0',
            html_url: 'https://github.com/SatoshoiDaemon/eternity-realms/releases/tag/v0.2.0',
            published_at: '2026-11-19T00:00:00Z',
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Novidades e atualizações')).getByRole('status'),
      ).toHaveTextContent('Nova versão disponível: 0.2.0'),
    );
    await openSettings('Sobre');
    expect(screen.getByRole('link', { name: 'Ver versões publicadas' })).toHaveAttribute(
      'href',
      'https://github.com/SatoshoiDaemon/eternity-realms/releases',
    );
  });

  it('handles current, preview, and offline update checks from settings', async () => {
    await mountApp({ state: gameWithCharacter('Aria') });
    await openSettings('Novidades e atualizações');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: 'v0.1.0',
            html_url: 'https://github.com/SatoshoiDaemon/eternity-realms/releases/tag/v0.1.0',
            published_at: '2026-11-19T00:00:00Z',
            prerelease: false,
            draft: false,
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Você está usando a versão mais recente.',
      ),
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Canal de atualizações: Estável' }));
    fireEvent.click(screen.getByRole('option', { name: 'Prévia' }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: 'v0.2.0-beta.1',
            html_url:
              'https://github.com/SatoshoiDaemon/eternity-realms/releases/tag/v0.2.0-beta.1',
            published_at: '2026-11-19T00:00:00Z',
            prerelease: true,
            draft: false,
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Nova versão disponível: 0.2.0-beta.1 · preview',
      ),
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Não foi possível verificar sem conexão.',
      ),
    );
  });

  it('filters, copies, and exports verbose logs with recoverable clipboard errors', async () => {
    await mountApp({ state: gameWithCharacter('Aria') });
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Nível mínimo: Rastreamento' }));
    fireEvent.click(screen.getByRole('option', { name: 'Aviso' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Subsistema: Todos' }));
    fireEvent.click(screen.getByRole('option', { name: 'Combate' }));
    expect(screen.getByRole('combobox', { name: 'Nível mínimo: Aviso' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Subsistema: Combate' })).toBeInTheDocument();

    vi.stubGlobal('navigator', { clipboard: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar logs' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'A cópia de logs não está disponível neste ambiente.',
      ),
    );

    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar logs' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Logs copiados.'));
    expect(writeText).toHaveBeenCalledOnce();

    const createObjectURL = vi.fn(() => 'blob:logs');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Exportar logs' }));
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logs');
  });

  it('claims a completed main mission and supports inventory search and sorting', async () => {
    const state = gameWithCharacter('Aria');
    state.events.push({
      id: 'first-completion',
      type: 'session.completed',
      occurredAt: 1_000,
      sessionId: 'done',
      activityId: 'mining',
    });
    state.character!.inventory = {
      'iron-ore': 7,
      'wild-herb': 3,
      'legacy:item-z': 2,
      'legacy:item-a': 1,
    };
    const { repository } = await mountApp({ state, clock: () => 1_000 });

    tab('Missões');
    fireEvent.click(screen.getByRole('button', { name: 'Resgatar recompensa' }));
    await waitFor(() => expect(repository.state?.missionClaims).toContain('first-steps@main'));
    expect(repository.state?.character?.experience.total).toBe(20);
    expect(screen.getByRole('button', { name: 'Recompensa resgatada' })).toBeDisabled();

    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Inventário' }));
    expect(screen.getAllByText('legacy:item-z')).toHaveLength(2);
    expect(screen.getAllByText('legacy:item-a')).toHaveLength(2);
    expect(screen.getByText('Minério de ferro')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'erva' } });
    expect(screen.getByText('Erva silvestre')).toBeInTheDocument();
    expect(screen.queryByText('Minério de ferro')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Ordenar: Nome' }));
    fireEvent.click(screen.getByRole('option', { name: 'Quantidade' }));
    const rows = screen.getAllByRole('listitem');
    expect(rows.findIndex((row) => row.textContent?.includes('Minério de ferro'))).toBeLessThan(
      rows.findIndex((row) => row.textContent?.includes('Erva silvestre')),
    );
  });

  it('uses a healing potion from the mobile inventory screen', async () => {
    const state = gameWithCharacter('Healer');
    state.character!.inventory['healing-potion'] = 1;
    state.character!.extensions.combatHp = 2;
    const { repository } = await mountApp({ state, clock: () => 1_000 });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Inventário' }));
    fireEvent.click(screen.getByRole('button', { name: 'Usar Poção de cura' }));
    await waitFor(() => expect(repository.state?.character?.inventory['healing-potion']).toBe(0));
    expect(repository.state?.character?.extensions.combatHp).toBe(5);
    expect(repository.state?.events.map((event) => event.type)).toContain('item.consumed');
  });

  it('installs an owned alchemical implant from the character screen', async () => {
    const state = gameWithCharacter('Implanter');
    state.character!.inventory['alchemical-implant-01'] = 1;
    state.character!.extensions.wallet = { fragments: 10_000 };
    state.character!.extensions.alchemicalCapacity = 5;
    const { repository } = await mountApp({ state, clock: () => 1_000 });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Implantes' }));
    expect(screen.getByRole('heading', { name: 'Implantes alquímicos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Instalar' }));
    await waitFor(() =>
      expect(repository.state?.character?.extensions.installedImplants).toEqual(['implant-01']),
    );
    expect(repository.state?.character?.inventory['alchemical-implant-01']).toBe(0);
    expect(repository.state?.character?.extensions.wallet).toEqual({ fragments: 0 });
    expect(repository.state?.events.at(-1)).toMatchObject({
      type: 'implant.installed',
      implantId: 'implant-01',
      capacity: 5,
      load: 1,
    });
  });

  it('spends attribute points on physical and energetic stats from the character overview', async () => {
    const state = gameWithCharacter('Attributes');
    state.character!.extensions.attributePoints = 2;
    state.character!.attributes.energetic.mana = 1;
    const { repository } = await mountApp({ state });
    tab('Personagem');
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar Força' }));
    await waitFor(() => expect(repository.state?.character?.attributes.physical.strength).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar Mana' }));
    await waitFor(() => expect(repository.state?.character?.attributes.energetic.mana).toBe(2));
    expect(repository.state?.character?.extensions.attributePoints).toBe(0);
  });

  it('keeps Chi training-only and disables energy allocation for Sem Afinidade', async () => {
    const state = gameWithCharacter('Chi cultivator');
    state.character!.attributes.energetic = { chi: 2, mana: 3, spirit: 1 };
    state.character!.extensions.attributePoints = 1;
    const { repository } = await mountApp({ state });
    tab('Personagem');

    expect(
      screen.getByText('O Chi cresce pelo cultivo de Aura e não recebe pontos diretamente.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aumentar Chi' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aumentar Mana' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sem afinidade' }));
    await waitFor(() => expect(repository.state?.character?.energy.affinity).toBe('unaffiliated'));
    expect(screen.getByRole('button', { name: 'Aumentar Mana' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aumentar Espírito' })).toBeDisabled();
    const reserves = screen.getByLabelText('Reservas de energia');
    expect(within(reserves).queryByText('Aura')).not.toBeInTheDocument();
    expect(within(reserves).queryByText('Chi')).not.toBeInTheDocument();
    expect(within(reserves).queryByText('Mana')).not.toBeInTheDocument();
  });

  it('limits direct Mana and Spirit allocation to Mana characters', async () => {
    const state = gameWithCharacter('Aura cultivator');
    state.character!.attributes.energetic = { chi: 0, mana: 0, spirit: 0 };
    state.character!.extensions.attributePoints = 1;
    const { repository } = await mountApp({ state });
    tab('Personagem');
    fireEvent.click(screen.getByRole('button', { name: 'Aura' }));
    await waitFor(() => expect(repository.state?.character?.energy.affinity).toBe('aura'));

    expect(screen.getByRole('button', { name: 'Aumentar Chi' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aumentar Mana' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aumentar Espírito' })).toBeDisabled();
    expect(
      screen.getAllByText('Mana e Espírito pertencem ao caminho de Mana.').length,
    ).toBeGreaterThan(0);
    const auraReserves = screen.getByLabelText('Reservas de energia');
    expect(within(auraReserves).getByText('Aura')).toBeInTheDocument();
    expect(within(auraReserves).getByText('Chi')).toBeInTheDocument();
    expect(within(auraReserves).queryByText('Mana')).not.toBeInTheDocument();
  });

  it('lets the player choose an energy path and Mana affinities with usable type nodes', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter('Elementalist') });
    tab('Personagem');
    fireEvent.click(screen.getByRole('button', { name: 'Mana' }));
    await waitFor(() => expect(repository.state?.character?.energy.affinity).toBe('mana'));
    expect(screen.getByRole('button', { name: 'Aura' })).toBeDisabled();
    const manaReserves = screen.getByLabelText('Reservas de energia');
    expect(within(manaReserves).getByText('Mana')).toBeInTheDocument();
    expect(within(manaReserves).queryByText('Aura')).not.toBeInTheDocument();
    expect(within(manaReserves).queryByText('Chi')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Água' }));
    fireEvent.click(screen.getByRole('button', { name: 'Terra' }));
    await waitFor(() =>
      expect(repository.state?.character?.energy.affinities).toEqual(['water', 'earth']),
    );
    expect(repository.state?.character?.nodeLibrary?.unlockedNodeIds).toEqual([
      'core:type-earth',
      'core:type-water',
    ]);
    expect(screen.getByRole('button', { name: 'Água' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Água' }));
    await waitFor(() => expect(repository.state?.character?.energy.affinities).toEqual(['earth']));
    expect(repository.state?.character?.nodeLibrary?.unlockedNodeIds).toContain('core:type-water');
    fireEvent.click(screen.getByRole('button', { name: 'Água' }));
    await waitFor(() =>
      expect(repository.state?.character?.energy.affinities).toEqual(['earth', 'water']),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Selar afinidades escolhidas' }));
    await waitFor(() =>
      expect(repository.state?.character?.extensions.manaAffinitiesLocked).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Água' })).toBeDisabled();
  });

  it('shows the active Incomplete Sem Afinidade effects after path selection', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter('Sem afinidade') });
    tab('Personagem');
    fireEvent.click(screen.getByRole('button', { name: 'Sem afinidade' }));
    await waitFor(() =>
      expect(repository.state?.character?.energy).toMatchObject({
        affinity: 'unaffiliated',
        unaffiliatedStage: 'incomplete',
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('+40 em cada atributo físico');
    expect(screen.getByRole('status')).toHaveTextContent('20% menos dano recebido');
    const reserves = screen.getByLabelText('Reservas de energia');
    expect(within(reserves).queryByText('Aura')).not.toBeInTheDocument();
    expect(within(reserves).queryByText('Mana')).not.toBeInTheDocument();
    expect(within(reserves).queryByText('Chi')).not.toBeInTheDocument();
  });

  it('renders currency rewards in the mission catalog', async () => {
    const official = loadOfficialContent();
    const baseMission = [...official.missions.values()][0]!;
    const missions = new Map(official.missions)
      .set('test:currency-reward', {
        ...baseMission,
        id: 'test:currency-reward',
        name: 'Contrato de recompensa',
        reward: { ...baseMission.reward, currencies: { fragments: 125 } },
      })
      .set('test:no-currency-reward', {
        ...baseMission,
        id: 'test:no-currency-reward',
        name: 'Contrato sem moeda',
        reward: { ...baseMission.reward, currencies: undefined },
      } as unknown as typeof baseMission);
    const content = { ...official, missions };
    await mountApp({ state: gameWithCharacter('Mission rewards'), content });
    tab('Missões');
    expect(await screen.findByText('+125 fragments')).toBeInTheDocument();
  });

  it('offers missing implant devices in the market and renders catalog fallbacks', async () => {
    const official = loadOfficialContent();
    const system = official.systems.get('system:alchemy')!;
    const entries = system.entries.map((entry) =>
      entry.id === 'implant-01'
        ? { ...entry, description: undefined, acquisitionPriceFragments: undefined }
        : entry,
    );
    const systems = new Map(official.systems).set('system:alchemy', {
      ...system,
      entries,
    } as SystemDefinition);
    const potion = official.items.get('healing-potion')!;
    const items = new Map(official.items).set('healing-potion', {
      ...potion,
      name: undefined,
    } as unknown as ItemDefinition);
    const content = { ...official, systems, items } as ContentCatalog;
    const state = gameWithCharacter('Market implant');
    state.character!.extensions.wallet = { fragments: undefined };
    state.character!.inventory['healing-potion'] = 1;
    const { repository } = await mountApp({ state, content });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Inventário' }));
    expect(screen.getByRole('button', { name: 'Usar healing-potion' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Implantes' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Adquirir na Loja de Fragmentos' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Mercado e orbes' })).toBeInTheDocument();
    expect(repository.state?.character?.extensions.wallet).toEqual({ fragments: undefined });
  });

  it('handles stale character actions when a transaction reload returns an empty save', async () => {
    const state = gameWithCharacter('Stale action');
    state.character!.inventory['healing-potion'] = 1;
    state.character!.inventory['alchemical-implant-01'] = 1;
    state.character!.extensions.wallet = { fragments: 10_000 };
    state.character!.extensions.alchemicalCapacity = 5;
    state.character!.extensions.installedImplants = ['implant-20'];
    state.character!.extensions.brokenImplants = ['implant-20'];
    const { repository } = await mountApp({ state });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Implantes' }));
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Instalar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Inventário' }));
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Usar Poção de cura' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Implantes' }));
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Remover implante quebrado' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('lets the player remove a soul anchor after its one use', async () => {
    const state = gameWithCharacter('Anchor');
    state.character!.extensions.installedImplants = ['implant-20'];
    state.character!.extensions.brokenImplants = ['implant-20'];
    state.character!.extensions.alchemicalCapacity = 5;
    state.character!.extensions.alchemicalLoad = 1;
    const { repository } = await mountApp({ state, clock: () => 1_000 });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Implantes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover implante quebrado' }));
    await waitFor(() =>
      expect(repository.state?.character?.extensions.installedImplants).toEqual([]),
    );
    expect(repository.state?.character?.extensions.brokenImplants).toEqual([]);
    expect(repository.state?.character?.extensions.alchemicalLoad).toBe(0);
  });

  it('uses equipment slots and the forge to craft and equip a weapon', async () => {
    const state = gameWithCharacter('Aria');
    state.character!.inventory = { 'material-iron': 4, 'wild-herb': 2 };
    const { repository } = await mountApp({ state });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Equipamentos' }));
    await screen.findByRole('heading', { name: 'Forja e builds' });
    fireEvent.click(screen.getByRole('button', { name: 'Fabricar equipamento' }));
    await waitFor(() => expect(repository.state?.character?.inventory['gear:iron-maul']).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Equipar' }));
    await waitFor(() =>
      expect(repository.state?.character?.equipment.primary).toBe('gear:iron-maul'),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Visão geral' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Equipamentos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(repository.state?.character?.equipment.primary).toBeNull());
    expect(repository.state?.character?.inventory['gear:iron-maul']).toBe(1);
  });

  it('rejects equipment changes if a transaction loses the character snapshot', async () => {
    const { repository } = await mountApp({ state: gameWithCharacter('Sem personagem') });
    tab('Personagem');
    fireEvent.click(screen.getByRole('tab', { name: 'Forja' }));
    await screen.findByRole('heading', { name: 'Forja e builds' });
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Fabricar equipamento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Crie um personagem antes de alterar equipamentos ou construções.',
    );
  });

  it('executes native backup, sharing and local notification integrations', async () => {
    nativeMocks.native = true;
    nativeMocks.checkPermissions.mockResolvedValue({ display: 'denied' });
    const state = gameWithCharacter('Aria');
    state.sessions = [
      {
        id: 'active-native',
        activityId: 'mining',
        durationMs: 1_000,
        status: 'active',
        createdAt: 1_000,
        startedAt: 1_000,
        elapsedMs: 0,
        lastObservedAt: 1_000,
      },
    ];
    state.queue = ['active-native'];
    let now = 1_000;
    const { repository } = await mountApp({ state, clock: () => now });
    await waitFor(() => expect(nativeMocks.scheduleNotifications).toHaveBeenCalled());
    expect(
      nativeMocks.scheduleNotifications.mock.calls
        .flatMap(([request]) => request.notifications)
        .every((notification) => notification.isExactNotification === false),
    ).toBe(true);
    expect(nativeMocks.cancelNotifications).toHaveBeenCalled();
    expect(nativeMocks.configure).toHaveBeenCalled();
    expect(nativeMocks.setMetadata).toHaveBeenCalled();

    await openSettings('Notificações');
    fireEvent.click(screen.getByRole('button', { name: 'Ativar notificações no Android' }));
    await waitFor(() => expect(nativeMocks.requestPermissions).toHaveBeenCalled());
    await openSettings('Saves e backups');
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }));
    await waitFor(() => expect(nativeMocks.writeBackup).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Exportar save' }));
    await waitFor(() => expect(nativeMocks.share).toHaveBeenCalled());
    expect(nativeMocks.writeFile).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao jogo' }));
    now = 3_000;
    nativeMocks.scheduleNotifications.mockRejectedValue('notification worker unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(repository.state?.sessions[0]?.status).toBe('completed'));
    await waitFor(() =>
      expect(
        nativeMocks.scheduleNotifications.mock.calls
          .flatMap(([request]) => request.notifications)
          .some((notification) => notification.title === 'Missão concluída'),
      ).toBe(true),
    );
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(screen.getByText(/Falha ao notificar uma missão disponível/)).toBeInTheDocument();

    nativeMocks.readBackup.mockResolvedValue({
      payload: createSaveFile(gameWithCharacter('Restaurado'), {
        applicationVersion: '0.1.0',
        databaseVersion: 2,
        exportedAt: now,
        modDependencies: [],
      }),
    });
    await openSettings('Saves e backups');
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(repository.state?.character?.name).toBe('Restaurado'));
    expect(nativeMocks.readBackup).toHaveBeenCalledWith({ id: 'manual-1.json' });
  });

  it('keeps the automatic backup snapshot synchronized without reopening SQLite from a worker', async () => {
    nativeMocks.native = true;
    const storage = new MemoryStorage();
    storage.setItem(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({ backup: { frequency: 'daily', retention: 7 } }),
    );

    await mountApp({ state: gameWithCharacter('Aria'), storage });
    await waitFor(() => expect(nativeMocks.setSnapshot).toHaveBeenCalled());

    const latestPayload = nativeMocks.setSnapshot.mock.calls.at(-1)?.[0]?.payload;
    expect(JSON.parse(latestPayload ?? '{}')).toMatchObject({ character: { name: 'Aria' } });
  });

  it('records native backup and session notification scheduling failures', async () => {
    nativeMocks.native = true;
    nativeMocks.configure.mockRejectedValue('worker unavailable');
    nativeMocks.setMetadata.mockRejectedValue(new Error('metadata unavailable'));
    nativeMocks.setSnapshot.mockRejectedValue('snapshot unavailable');
    nativeMocks.listBackups.mockRejectedValue('backup list unavailable');
    nativeMocks.scheduleNotifications.mockRejectedValue('notification service unavailable');
    nativeMocks.requestPermissions.mockRejectedValue('permission service unavailable');
    const state = gameWithCharacter('Aria');
    state.sessions = [
      {
        id: 'active-failure',
        activityId: 'mining',
        durationMs: 10_000,
        status: 'active',
        createdAt: 1_000,
        startedAt: 1_000,
        elapsedMs: 0,
        lastObservedAt: 1_000,
      },
    ];
    state.queue = ['active-failure'];
    const storage = new MemoryStorage();
    storage.setItem(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({ backup: { frequency: 'daily', retention: 7 } }),
    );
    await mountApp({ state, clock: () => 1_000, storage });
    await waitFor(() => expect(nativeMocks.listBackups).toHaveBeenCalled());
    await waitFor(() => expect(nativeMocks.setSnapshot).toHaveBeenCalled());
    await openSettings('Notificações');
    fireEvent.click(screen.getByRole('button', { name: 'Ativar notificações no Android' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Não foi possível ativar as notificações.',
      ),
    );
    await openSettings('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(document.querySelector('.combat-log')).toHaveTextContent(
      'Não foi possível atualizar o estado do backup automático',
    );
    expect(document.querySelector('.combat-log')).toHaveTextContent(
      'Não foi possível atualizar o agendamento de backups',
    );
    expect(document.querySelector('.combat-log')).toHaveTextContent(
      'Falha ao sincronizar a notificação de sessão',
    );
  });
});
