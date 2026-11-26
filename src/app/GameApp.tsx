import { Capacitor } from '@capacitor/core';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadOfficialContent, type ContentCatalog } from '../content/registry';
import { claimMission, getMissionProgress } from '../domain/mission-engine';
import { craftRecipe } from '../domain/crafting';
import { consumeItem } from '../domain/item-use';
import {
  getAllImplantDefinitions,
  getAlchemicalLoad,
  getBrokenImplantIds,
  getDedalusSyndrome,
  getImplantCapacity,
  getInstalledImplants,
  installImplant,
  removeBrokenImplant,
} from '../domain/implants';
import { createCharacter, createInitialGameState } from '../domain/model';
import { awardExperience, grantItems, spendAttributePoint } from '../domain/progression';
import {
  selectEnergyPath,
  selectManaAffinities,
  sealManaAffinities,
  type EnergyPath,
} from '../domain/mana-affinities';
import {
  cancelActiveSession,
  editQueuedSession,
  enqueueSession,
  getSessionProgress,
  reconcileSessions,
  reorderQueuedSession,
} from '../domain/session-engine';
import type { Character, GameState, Session } from '../domain/types';
import {
  configureAutomaticBackups,
  isNativeBackupAvailable,
  listNativeBackups,
  readNativeBackup,
  setBackupSnapshot,
  setBackupMetadata,
  writeNativeBackup,
} from '../native/backup-scheduler';
import {
  localNotificationPort,
  notifyMissionReady,
  requestLocalNotificationPermission,
  syncSessionNotification,
} from '../native/session-notifications';
import { createLocalBackup, listLocalBackups, restoreLocalBackup } from './local-backups';
import {
  assertModDependenciesAvailable,
  importContentMod,
  getModStatuses,
  loadInstalledContent,
  removeInstalledMod,
  setModEnabled,
  type ModStatus,
} from './mod-store';
import {
  listProfiles,
  loadProfile,
  persistProfile,
  removeProfile,
  requireProfile,
  type ProfileSummary,
} from './profile-store';
import { parseSaveFile, createSaveFile } from '../persistence/save-format';
import {
  loadDeviceSettings,
  saveDeviceSettings,
  applyDeviceSettings,
  type DeviceSettings,
  type StoragePort,
} from './device-settings';
import {
  APPLICATION_VERSION,
  bundledChangelogs,
  checkLatestRelease,
  getUnseenChangelogs,
  recordChangelogSeen,
} from './changelog';
import { DebugLog } from './debug-log';
import { t, type TranslationKey, userFacingError } from './i18n';
import { GameSelect } from './GameSelect';
import type {
  BackupSummary,
  DebugAction,
  DebugLevel,
  DebugSubsystem,
  InstalledModSummary,
} from './SettingsScreen';
import './game-app.css';
import { unequipItem, type EquipmentSlot } from '../domain/forge';
import { unlockNodes } from '../nodes/library';
import { exportTextFile } from '../native/file-actions';
import { MarketPanel } from './MarketPanel';

export interface GameRepositoryPort {
  transact(reducer: (current: GameState | null) => GameState): Promise<GameState>;
  load?(): Promise<GameState | null>;
}

interface GameAppProps {
  repository: GameRepositoryPort;
  content?: ContentCatalog;
  clock?: () => number;
  makeId?: () => string;
  storage?: StoragePort;
}

type MainTab = 'activities' | 'combat' | 'home' | 'missions' | 'character';
type CombatView =
  'expeditions' | 'quests' | 'dungeons' | 'raids' | 'bestiary' | 'arena' | 'records';
type CharacterView =
  'overview' | 'equipment' | 'inventory' | 'skills' | 'forge' | 'nodes' | 'implants';

const OFFICIAL_CONTENT = loadOfficialContent();
const SettingsScreen = lazy(() =>
  import('./SettingsScreen').then((module) => ({ default: module.SettingsScreen })),
);
const PhaseTwoPanels = lazy(() =>
  import('./PhaseTwoPanels').then((module) => ({ default: module.PhaseTwoPanels })),
);
function sameGameSnapshot(left: GameState, right: GameState): boolean {
  return JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 });
}
function localizedStatLabel(id: string): string {
  const keys: Record<string, TranslationKey> = {
    vigor: 'phase.attribute.vigor',
    resistance: 'phase.attribute.resistance',
    speed: 'phase.attribute.speed',
    dexterity: 'phase.attribute.dexterity',
    precision: 'phase.attribute.precision',
    strength: 'phase.attribute.strength',
    aura: 'energy.aura',
    chi: 'energy.chi',
    mana: 'energy.mana',
    spirit: 'energy.spirit',
    none: 'energy.none',
    unaffiliated: 'energy.unaffiliated.incomplete',
    unawakened: 'energy.unawakened',
    fire: 'energy.fire',
    earth: 'energy.earth',
    shadow: 'energy.shadow',
    poison: 'energy.poison',
    light: 'energy.light',
    air: 'energy.air',
    water: 'energy.water',
  };
  const key = keys[id.toLowerCase()];
  return key ? t(key) : id;
}
const emptySettingsStorage: StoragePort = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
const navigation: Array<{ id: MainTab; label: string; icon: string }> = [
  { id: 'activities', label: t('nav.activities'), icon: 'spark' },
  { id: 'combat', label: t('nav.combat'), icon: 'sword' },
  { id: 'home', label: t('nav.home'), icon: 'home' },
  { id: 'missions', label: t('nav.missions'), icon: 'scroll' },
  { id: 'character', label: t('nav.character'), icon: 'person' },
];

const activityCategories = [
  {
    id: 'training',
    label: t('activity.category.training'),
    values: ['training', 'meditation', 'study'],
  },
  { id: 'gathering', label: t('activity.category.gathering'), values: ['gathering', 'collection'] },
  {
    id: 'production',
    label: t('activity.category.production'),
    values: ['production', 'crafting'],
  },
  { id: 'profession', label: t('activity.category.profession'), values: ['profession', 'skill'] },
  { id: 'skills', label: t('activity.category.skills'), values: ['development'] },
  { id: 'market', label: t('activity.category.market'), values: [] },
  { id: 'all', label: t('activity.category.all'), values: ['all'] },
] as const;

const combatNavigation: Array<{ id: CombatView; label: string }> = [
  { id: 'expeditions', label: t('combat.expeditions') },
  { id: 'quests', label: t('combat.quests') },
  { id: 'dungeons', label: t('combat.dungeons') },
  { id: 'raids', label: t('combat.raids') },
  { id: 'bestiary', label: t('combat.bestiary') },
  { id: 'arena', label: t('combat.arena') },
  { id: 'records', label: t('combat.records') },
];

const characterNavigation: Array<{ id: CharacterView; label: string }> = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'equipment', label: 'Equipamentos' },
  { id: 'inventory', label: 'Inventário' },
  { id: 'skills', label: 'Habilidades' },
  { id: 'implants', label: 'Implantes' },
  { id: 'forge', label: 'Forja' },
  { id: 'nodes', label: 'Construções' },
];
const changelogCategoryKeys = {
  added: 'settings.changelog.added',
  improved: 'settings.changelog.improved',
  changed: 'settings.changelog.changed',
  fixed: 'settings.changelog.fixed',
  removed: 'settings.changelog.removed',
  technical: 'settings.changelog.technical',
} as const;

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    spark: 'M12 2 14 9l7 3-7 2-2 8-2-8-7-2 7-3 2-7Z',
    sword: 'm4 20 5-5m-2-2L18 2l4 4-11 11m-2-4 4 4m-8 3 3-3',
    home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1V10Z',
    scroll: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6',
    person: 'M20 21a8 8 0 0 0-16 0m8-11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3m10-10h-3M5 12H2m17.07 7.07-2.12-2.12M7.05 7.05 4.93 4.93m14.14 0-2.12 2.12M7.05 16.95l-2.12 2.12',
    back: 'm15 18-6-6 6-6M9 12h12',
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}

function OrbitMark() {
  return (
    <svg className="arcane-orbit" viewBox="0 0 240 240" aria-hidden="true">
      <circle className="orbit-ring orbit-ring-a" cx="120" cy="120" r="91" />
      <circle className="orbit-ring orbit-ring-b" cx="120" cy="120" r="71" />
      <path className="orbit-star" d="m120 30 14 73 73 17-73 14-14 73-14-73-73-14 73-17 14-73Z" />
      <path className="orbit-core" d="m120 84 10 26 26 10-26 10-10 26-10-26-26-10 26-10 10-26Z" />
    </svg>
  );
}

function getSessionName(session: Session, content: ContentCatalog): string {
  return `${content.activities.get(session.activityId)?.name ?? session.activityId} · ${session.status === 'active' ? t('common.active') : t('common.queued')}`;
}

export function SessionProgress({
  session,
  clock,
  content,
}: {
  session: Session;
  clock: () => number;
  content: ContentCatalog;
}) {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(clock()), 1_000);
    return () => window.clearInterval(timer);
  }, [clock]);
  const progress = getSessionProgress(session, now);
  return (
    <div className="session-progress-view">
      <div className="progress-orb" aria-hidden="true">
        <OrbitMark />
        <span>{Math.round(progress.fraction * 100)}%</span>
      </div>
      <div className="progress-copy">
        <div className="session-title-row">
          <strong>{getSessionName(session, content)}</strong>
          <span>
            {Math.floor(progress.elapsedMs / 60_000)} / {Math.ceil(session.durationMs / 60_000)} min
          </span>
        </div>
        <div
          className="arcane-progress"
          role="progressbar"
          aria-label={t('session.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.fraction * 100)}
        >
          <svg viewBox="0 0 100 8" preserveAspectRatio="none">
            <rect x="0" y="1" width="100" height="6" rx="3" />
            <rect
              className="progress-fill"
              x="0"
              y="1"
              width={`${Math.max(1, progress.fraction * 100)}%`}
              height="6"
              rx="3"
            />
          </svg>
        </div>
        <span className="muted">{t('session.universalFlow')}</span>
      </div>
    </div>
  );
}

function AppError({ message }: { message: string }) {
  return message ? (
    <p className="error-banner" role="alert">
      {message}
    </p>
  ) : null;
}

function AppTabs({ active, onChange }: { active: MainTab; onChange: (tab: MainTab) => void }) {
  return (
    <nav className="game-bottom-nav" aria-label={t('nav.main')}>
      {navigation.map((entry) => (
        <button
          key={entry.id}
          className={`nav-button ${entry.id === 'home' ? 'home-button' : ''}`}
          type="button"
          aria-current={active === entry.id ? 'page' : undefined}
          onClick={() => onChange(entry.id)}
        >
          <span className="nav-icon">
            <Icon name={entry.icon} />
          </span>
          <span>{entry.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function GameApp({
  repository,
  content: suppliedContent,
  clock = Date.now,
  makeId = () => crypto.randomUUID(),
  storage: suppliedStorage,
}: GameAppProps) {
  const storage = suppliedStorage ?? emptySettingsStorage;
  const [content, setContent] = useState<ContentCatalog>(() => {
    if (suppliedContent) return suppliedContent;
    try {
      return loadInstalledContent(storage);
    } catch {
      return OFFICIAL_CONTENT;
    }
  });
  const [mods, setMods] = useState<ModStatus[]>(() => getModStatuses(storage));
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(() =>
    loadDeviceSettings(storage),
  );
  const [state, setState] = useState<GameState | null>(null);
  const [name, setName] = useState('');
  const [activityId, setActivityId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<MainTab>('home');
  const [combatView, setCombatView] = useState<CombatView>('expeditions');
  const [activityCategory, setActivityCategory] = useState<string>('all');
  const [activityDetailId, setActivityDetailId] = useState<string | null>(null);
  const [characterView, setCharacterView] = useState<CharacterView>('overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [profiles, setProfiles] = useState<ProfileSummary[]>(() => listProfiles(storage));
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logLevel, setLogLevel] = useState<DebugLevel>('trace');
  const [logSubsystem, setLogSubsystem] = useState<DebugSubsystem>('all');
  const [updateMessage, setUpdateMessage] = useState('');
  const [showChangelog, setShowChangelog] = useState(
    () => getUnseenChangelogs(storage.getItem('eternity-realms:changelog-seen:v1')).length > 0,
  );
  const [unseenNotes, setUnseenNotes] = useState(() =>
    getUnseenChangelogs(storage.getItem('eternity-realms:changelog-seen:v1')),
  );
  const [missionCadence, setMissionCadence] = useState<'main' | 'secondary' | 'daily' | 'weekly'>(
    'main',
  );
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventorySort, setInventorySort] = useState('name');
  const logger = useRef(new DebugLog(2_000, clock));
  const refreshInFlight = useRef<Promise<GameState> | null>(null);
  const lastBackgroundRefresh = useRef(0);
  const [settingError, setSettingError] = useState('');
  const [notificationPermissionRevision, setNotificationPermissionRevision] = useState(0);
  const previousMissionState = useRef<GameState | null>(null);
  const lastNotificationSync = useRef<string | null>(null);
  const activeContent = suppliedContent ?? content;

  const persistProfileState = useCallback(
    (next: GameState) => {
      if (!next.character) return;
      try {
        persistProfile(
          storage,
          next,
          clock(),
          mods.filter((mod) => mod.enabled).map((mod) => mod.id),
        );
        const updatedProfiles = listProfiles(storage);
        setProfiles((current) =>
          JSON.stringify(current) === JSON.stringify(updatedProfiles) ? current : updatedProfiles,
        );
      } catch (error) {
        logger.current.write(
          'warn',
          'persistence',
          'Não foi possível atualizar o índice de personagens.',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    },
    [clock, mods, storage],
  );

  const refresh = useCallback((): Promise<GameState> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    let persistLoadedState = true;
    const task = (async () => {
      if (repository.load) {
        const current = await repository.load();
        if (current) {
          const reconciled = reconcileSessions(current, clock(), activeContent);
          if (sameGameSnapshot(current, reconciled)) {
            persistLoadedState = Boolean(
              current.character &&
              !profiles.some((profile) => profile.id === current.character?.id),
            );
            return current;
          }
        }
      }
      return repository.transact((current) =>
        reconcileSessions(current ?? createInitialGameState(), clock(), activeContent),
      );
    })();
    refreshInFlight.current = task;
    void task
      .then((next) => {
        setState((previous) => (previous && sameGameSnapshot(previous, next) ? previous : next));
        if (persistLoadedState) persistProfileState(next);
        setErrorMessage('');
        logger.current.write('debug', 'sessions', 'Sessões reconciliadas.', {
          revision: next.revision,
          activeSession: next.queue[0] ?? null,
        });
      })
      .catch((error: unknown) => {
        setErrorMessage(userFacingError(error));
        logger.current.write('error', 'persistence', 'Falha ao reconciliar o save.', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      })
      .finally(() => {
        refreshInFlight.current = null;
      });
    return task;
  }, [activeContent, clock, persistProfileState, profiles, repository]);

  const transact = useCallback(
    async (
      reducer: (current: GameState | null) => GameState,
      subsystem:
        'app' | 'sessions' | 'combat' | 'persistence' | 'mods' | 'nodes' | 'notifications' = 'app',
    ) => {
      try {
        const next = await repository.transact(reducer);
        setState(next);
        persistProfileState(next);
        setErrorMessage('');
        setStatusMessage('');
        logger.current.write('info', subsystem, 'Estado do jogo atualizado.', {
          revision: next.revision,
          characterId: next.character?.id ?? null,
        });
        return next;
      } catch (error) {
        const message = userFacingError(error);
        setErrorMessage(message);
        logger.current.write('error', subsystem, 'A operação falhou.', {
          error: message,
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },
    [persistProfileState, repository],
  );

  const runSafely = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      const message = userFacingError(error);
      setErrorMessage(message);
      logger.current.write('error', 'app', 'Ação da interface falhou.', {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }, []);

  const claimMissionReward = useCallback(
    (missionId: string) => {
      void runSafely(() =>
        transact(
          (current) =>
            claimMission(current ?? createInitialGameState(), missionId, clock(), activeContent),
          'app',
        ),
      );
    },
    [activeContent, clock, runSafely, transact],
  );

  const craftRecipeAction = useCallback(
    (recipeId: string) =>
      runSafely(async () => {
        await transact((current) => {
          const state = current ?? createInitialGameState();
          if (!state.character) {
            throw new Error('Crie um personagem antes de alterar equipamentos ou construções.');
          }
          const craftId = `${state.character.id}:craft:${state.revision + 1}:${recipeId}`;
          return craftRecipe(state, activeContent, recipeId, craftId, clock());
        }, 'app');
      }),
    [activeContent, clock, runSafely, transact],
  );

  const consumeItemAction = useCallback(
    (itemId: string) =>
      runSafely(async () => {
        await transact((current) => {
          const state = current ?? createInitialGameState();
          const useId = `${state.character?.id ?? 'character'}:use:${state.revision + 1}:${itemId}`;
          return consumeItem(state, activeContent, itemId, useId, clock());
        }, 'app');
      }),
    [activeContent, clock, runSafely, transact],
  );

  const installImplantAction = useCallback(
    (implantId: string) =>
      runSafely(async () => {
        await transact((current) => {
          const game = current ?? createInitialGameState();
          if (!game.character) throw new Error('Crie um personagem antes de instalar implantes.');
          const operationId = `${game.character.id}:implant:${game.revision + 1}:${implantId}`;
          return installImplant(game, activeContent, implantId, operationId, clock());
        }, 'app');
      }),
    [activeContent, clock, runSafely, transact],
  );

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh, storage]);

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState !== 'visible') return;
      const now = clock();
      if (now - lastBackgroundRefresh.current < 900) return;
      lastBackgroundRefresh.current = now;
      void refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [clock, refresh]);

  useEffect(() => {
    const root = document.documentElement;
    applyDeviceSettings(deviceSettings, root);
    try {
      saveDeviceSettings(deviceSettings, storage);
    } catch {
      /* local storage may be unavailable */
    }
    void configureAutomaticBackups(
      deviceSettings.backup.frequency,
      deviceSettings.backup.retention,
    ).catch((error: unknown) => {
      logger.current.write(
        'warn',
        'persistence',
        'Não foi possível atualizar o agendamento de backups.',
        { error: error instanceof Error ? error.message : String(error) },
      );
    });
    void setBackupMetadata(
      APPLICATION_VERSION,
      mods.filter((mod) => mod.enabled).map((mod) => mod.id),
    ).catch(() => undefined);
  }, [deviceSettings, mods, storage]);

  useEffect(() => {
    if (!isNativeBackupAvailable() || !state || deviceSettings.backup.frequency === 'off') return;
    void setBackupSnapshot(JSON.stringify(state)).catch((error: unknown) => {
      logger.current.write(
        'warn',
        'persistence',
        'Não foi possível atualizar o estado do backup automático.',
        { error: error instanceof Error ? error.message : String(error) },
      );
    });
  }, [deviceSettings.backup.frequency, state]);

  const activeSession = useMemo(() => {
    if (!state) return undefined;
    const sessionMap = new Map(state.sessions.map((session) => [session.id, session]));
    const activeId = state.queue[0];
    const candidate = activeId ? sessionMap.get(activeId) : undefined;
    return candidate?.status === 'active' ? candidate : undefined;
  }, [state]);

  const notificationSyncSignature = JSON.stringify([
    activeSession?.id ?? null,
    activeSession?.activityId ?? null,
    activeSession?.status ?? null,
    activeSession?.startedAt ?? null,
    activeSession?.durationMs ?? null,
    state?.queue.length ?? 0,
    deviceSettings.notifications.sessionComplete,
    deviceSettings.notifications.rewards,
    deviceSettings.notifications.queueIdle,
    notificationPermissionRevision,
  ]);

  useEffect(() => {
    if (!activeSession) return undefined;
    const checkpoint = () => {
      void repository
        .transact((current) =>
          reconcileSessions(current ?? createInitialGameState(), clock(), activeContent),
        )
        .then((next) => {
          setState((previous) => {
            if (
              !previous ||
              JSON.stringify(previous.queue) !== JSON.stringify(next.queue) ||
              previous.character?.experience.total !== next.character?.experience.total
            )
              return next;
            const before = previous.sessions.find((session) => session.id === activeSession.id);
            const after = next.sessions.find((session) => session.id === activeSession.id);
            return before?.elapsedMs === after?.elapsedMs &&
              before?.lastObservedAt === after?.lastObservedAt
              ? previous
              : next;
          });
          persistProfileState(next);
        })
        .catch((error: unknown) => {
          logger.current.write(
            'error',
            'persistence',
            'Falha ao salvar o checkpoint da sessão ativa.',
            { error: error instanceof Error ? error.message : String(error) },
          );
        });
    };
    const timer = window.setInterval(checkpoint, 15_000);
    return () => window.clearInterval(timer);
  }, [activeContent, activeSession, clock, persistProfileState, repository]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (lastNotificationSync.current === notificationSyncSignature) return;
    lastNotificationSync.current = notificationSyncSignature;
    void syncSessionNotification(
      localNotificationPort,
      activeSession,
      clock(),
      {
        sessionComplete: deviceSettings.notifications.sessionComplete,
        rewards: deviceSettings.notifications.rewards,
        queueIdle: deviceSettings.notifications.queueIdle,
      },
      state?.queue.length ?? 0,
    ).catch((error: unknown) =>
      logger.current.write(
        'warn',
        'notifications',
        'Falha ao sincronizar a notificação de sessão.',
        { error: error instanceof Error ? error.message : String(error) },
      ),
    );
  }, [
    activeSession,
    clock,
    deviceSettings.notifications.queueIdle,
    deviceSettings.notifications.rewards,
    deviceSettings.notifications.sessionComplete,
    notificationPermissionRevision,
    notificationSyncSignature,
    state?.queue.length,
  ]);

  useEffect(() => {
    const previous = previousMissionState.current;
    previousMissionState.current = state;
    if (
      !Capacitor.isNativePlatform() ||
      !previous ||
      !state ||
      !deviceSettings.notifications.missions
    )
      return;
    const now = clock();
    for (const mission of activeContent.missions.values()) {
      const before = getMissionProgress(previous, mission.id, now, activeContent);
      const after = getMissionProgress(state, mission.id, now, activeContent);
      if (!before.complete && after.complete && !after.claimed) {
        let hash = 0;
        for (const char of `${after.missionId}@${after.periodKey}`)
          hash = Math.imul(hash ^ char.charCodeAt(0), 31);
        const notificationId = 8_000 + (Math.abs(hash) % 1_000_000);
        void notifyMissionReady(localNotificationPort, notificationId, mission.name, now).catch(
          (error: unknown) =>
            logger.current.write(
              'warn',
              'notifications',
              'Falha ao notificar uma missão disponível.',
              {
                missionId: mission.id,
                error: error instanceof Error ? error.message : String(error),
              },
            ),
        );
      }
    }
  }, [activeContent, clock, deviceSettings.notifications.missions, state]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      const source = isNativeBackupAvailable()
        ? listNativeBackups()
        : Promise.resolve(listLocalBackups(storage));
      void source.then(setBackups).catch(() => setBackups(listLocalBackups(storage)));
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [state, storage]);

  useEffect(() => {
    setLogs(
      logger.current.format({
        verbose: deviceSettings.verboseLogs,
        minimumLevel: logLevel,
        ...(logSubsystem === 'all' ? {} : { subsystem: logSubsystem }),
      }),
    );
  }, [deviceSettings.verboseLogs, errorMessage, logLevel, logSubsystem, state, statusMessage]);

  const updateSettings = (update: (current: DeviceSettings) => DeviceSettings) => {
    const next = update(deviceSettings);
    try {
      saveDeviceSettings(next, storage);
      setSettingError('');
      setErrorMessage('');
    } catch (error) {
      setSettingError(userFacingError(error));
      setErrorMessage('');
    }
    setDeviceSettings(next);
  };

  const createCharacterAction = async (characterName = name) => {
    setErrorMessage('');
    try {
      await transact((current) => {
        const base = current ?? createInitialGameState();
        const race = activeContent.races.values().next().value;
        const characterClass = activeContent.classes.values().next().value;
        if (!race || !characterClass)
          throw new Error('Nenhuma raça ou classe inicial foi carregada.');
        const character = createCharacter({
          id: makeId(),
          name: characterName.trim() || 'Aventureiro',
          raceId: race.id,
          classId: characterClass.id,
        });
        const next: GameState = { ...createInitialGameState(), revision: base.revision, character };
        return next;
      });
      setName('');
      setTab('home');
      setSettingsOpen(false);
    } catch {
      /* Error is surfaced by transact. */
    }
  };

  const updateCharacterAction = useCallback(
    async (update: (current: Character) => Character) => {
      await transact((current) => {
        const game = current ?? createInitialGameState();
        if (!game.character)
          throw new Error('Crie um personagem antes de alterar equipamentos ou construções.');
        return { ...game, character: update(game.character) };
      }, 'nodes');
    },
    [transact],
  );

  const addSessionAction = async (selectedActivityId = activityId) => {
    try {
      await transact(
        (current) =>
          enqueueSession(
            current ?? createInitialGameState(),
            {
              id: makeId(),
              activityId: selectedActivityId,
              durationMs: Number(durationMinutes) * 60_000,
            },
            activeContent,
            clock(),
          ),
        'sessions',
      );
    } catch {
      /* Error is surfaced by transact. */
    }
  };

  const cancelSessionAction = async () => {
    try {
      await transact(
        (current) => cancelActiveSession(current ?? createInitialGameState(), clock()),
        'sessions',
      );
    } catch {
      /* Error is surfaced by transact. */
    }
  };

  const saveDurationAction = async (session: Session) => {
    try {
      await transact(
        (current) =>
          editQueuedSession(
            current ?? createInitialGameState(),
            session.id,
            {
              durationMs:
                Number(durationDrafts[session.id] ?? session.durationMs / 60_000) * 60_000,
            },
            activeContent,
          ),
        'sessions',
      );
      setDurationDrafts((drafts) => {
        const next = { ...drafts };
        delete next[session.id];
        return next;
      });
    } catch {
      /* Error is surfaced by transact. */
    }
  };

  const moveSessionUpAction = async (session: Session, position: number) => {
    try {
      await transact(
        (current) =>
          reorderQueuedSession(current ?? createInitialGameState(), session.id, position - 1),
        'sessions',
      );
    } catch {
      /* Error is surfaced by transact. */
    }
  };

  const activeState = state ?? createInitialGameState();
  const character = activeState.character;
  const queuedSessions = useMemo(() => {
    const sessions = new Map(activeState.sessions.map((session) => [session.id, session]));
    return activeState.queue.flatMap((sessionId) => {
      const session = sessions.get(sessionId);
      return session ? [session] : [];
    });
  }, [activeState]);

  const refreshBackups = async () => {
    const list = isNativeBackupAvailable() ? await listNativeBackups() : listLocalBackups(storage);
    setBackups(list);
    return list;
  };

  const createBackup = async () => {
    if (!state) return;
    const payload = createSaveFile(state, {
      applicationVersion: APPLICATION_VERSION,
      databaseVersion: 2,
      exportedAt: clock(),
      modDependencies: mods.filter((mod) => mod.enabled).map((mod) => mod.id),
    });
    if (isNativeBackupAvailable()) await writeNativeBackup(payload);
    else
      createLocalBackup(
        storage,
        state,
        clock(),
        deviceSettings.backup.retention,
        mods.filter((mod) => mod.enabled).map((mod) => mod.id),
      );
    await refreshBackups();
    setStatusMessage('Backup criado e validado.');
  };

  const exportSave = async () => {
    if (!state) return;
    const payload = createSaveFile(state, {
      applicationVersion: APPLICATION_VERSION,
      databaseVersion: 2,
      exportedAt: clock(),
      modDependencies: mods.filter((mod) => mod.enabled).map((mod) => mod.id),
    });
    const fileName = `eternity-realms-${character?.id ?? 'save'}.json`;
    await exportTextFile(
      fileName,
      payload,
      `Save de ${character?.name ?? 'personagem'}`,
      'application/json',
    );
    setStatusMessage('Save validado e preparado para exportação.');
  };

  const importSave = async (file: File) => {
    const parsed = parseSaveFile(await file.text());
    assertModDependenciesAvailable(parsed.metadata.modDependencies, mods);
    if (state) await createBackup();
    const next = await transact(() => parsed.gameState, 'persistence');
    persistProfileState(next);
    await refreshBackups();
    setStatusMessage(`Save importado. Formato de origem ${parsed.migratedFrom}.`);
  };

  const restoreBackup = async (id: string) => {
    const parsed = isNativeBackupAvailable()
      ? parseSaveFile(await readNativeBackup(id))
      : restoreLocalBackup(storage, id);
    if (!parsed) throw new Error('Backup não encontrado.');
    assertModDependenciesAvailable(parsed.metadata.modDependencies, mods);
    if (state) await createBackup();
    const next = await transact(() => parsed.gameState, 'persistence');
    persistProfileState(next);
    setStatusMessage('Backup restaurado após validação de integridade.');
  };

  const createCharacterFromSettings = async (newName: string) => {
    if (state?.character) persistProfileState(state);
    await createCharacterAction(newName);
    setSettingsOpen(true);
  };

  const switchCharacter = async (id: string) => {
    if (!state) return;
    persistProfileState(state);
    const profile = requireProfile(storage, id);
    await transact(() => profile, 'persistence');
    setSettingsOpen(true);
    setStatusMessage('Personagem trocado.');
  };

  const resetCharacter = async () => {
    if (!character) return;
    await createBackup();
    const reset = createInitialGameState();
    reset.character = createCharacter({
      id: character.id,
      name: character.name,
      raceId: character.raceId,
      classId: character.classId,
    });
    await transact(() => reset, 'persistence');
    setStatusMessage('Progresso do personagem redefinido.');
  };

  const deleteCharacter = async () => {
    if (!character) return;
    await createBackup();
    removeProfile(storage, character.id);
    const remaining = listProfiles(storage);
    if (remaining[0]) {
      const profile = loadProfile(storage, remaining[0].id);
      await transact(() => profile ?? createInitialGameState(), 'persistence');
    } else {
      await transact(() => createInitialGameState(), 'persistence');
    }
    setProfiles(listProfiles(storage));
    setStatusMessage('Personagem excluído após a criação de um backup.');
  };

  const importMod = async (file: File) => {
    const next = importContentMod(storage, await file.text());
    setMods(getModStatuses(storage));
    if (!suppliedContent) setContent(loadInstalledContent(storage));
    setStatusMessage(`Mod ${next.at(-1)!.pack.manifest.name} instalado e carregado.`);
  };

  const toggleMod = (id: string, enabled: boolean) => {
    try {
      setModEnabled(storage, id, enabled);
      setMods(getModStatuses(storage));
      if (!suppliedContent) setContent(loadInstalledContent(storage));
      setStatusMessage(enabled ? 'Mod habilitado e carregado.' : 'Mod desabilitado.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao alterar o mod.');
      setMods(getModStatuses(storage));
    }
  };

  const removeMod = (id: string) => {
    try {
      removeInstalledMod(storage, id);
      setMods(getModStatuses(storage));
      if (!suppliedContent) setContent(loadInstalledContent(storage));
      setStatusMessage('Mod removido.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao remover o mod.');
    }
  };

  const debugAction = async (action: DebugAction) => {
    if (action === 'inspect') {
      setStatusMessage(
        JSON.stringify(
          {
            revision: state?.revision,
            characterId: character?.id,
            queue: state?.queue,
            sessions: state?.sessions,
            processedEventCount: state?.processedEventIds.length,
            rngSeeds: state?.combatRecords?.map((record) => record.seed) ?? [],
          },
          null,
          2,
        ),
      );
      return;
    }
    if (action === 'validate-mods') {
      const statuses = getModStatuses(storage);
      setStatusMessage(
        statuses.some((mod) => mod.error)
          ? 'Há erros no carregamento de mods.'
          : `Validação concluída: ${statuses.length} mods instalados.`,
      );
      return;
    }
    if (!state?.character)
      throw new Error('Crie um personagem antes de usar as ferramentas de desenvolvimento.');
    if (action === 'advance') {
      const future = clock() + 3_600_000;
      await transact(
        (current) => reconcileSessions(current ?? createInitialGameState(), future, activeContent),
        'sessions',
      );
      setStatusMessage('Uma hora de tempo virtual foi processada pela reconciliação de sessões.');
      return;
    }
    if (action === 'combat') {
      const combatActivity = [...activeContent.activities.values()].find(
        (activity) => activity.expeditionId,
      );
      if (!combatActivity) throw new Error('Nenhuma expedição de combate está carregada.');
      const startedAt = clock();
      const sessionId = makeId();
      await transact((current) => {
        const enqueued = enqueueSession(
          current ?? createInitialGameState(),
          { id: sessionId, activityId: combatActivity.id, durationMs: 1_000 },
          activeContent,
          startedAt,
        );
        return reconcileSessions(enqueued, startedAt + 1_000, activeContent);
      }, 'combat');
      setStatusMessage(`Simulação concluída para ${combatActivity.name}.`);
      return;
    }
    await transact(
      (current) => {
        const game = current ?? createInitialGameState();
        if (!game.character)
          throw new Error('Crie um personagem antes de usar as ferramentas de desenvolvimento.');
        if (action === 'nodes')
          return {
            ...game,
            character: unlockNodes(
              game.character,
              activeContent.nodes.map((node) => node.id),
            ),
          };
        const eventPrefix = `debug:${makeId()}`;
        const update =
          action === 'xp'
            ? awardExperience(game.character, 100, activeContent.rules, eventPrefix)
            : grantItems(game.character, { 'iron-ore': 5 }, eventPrefix);
        const events = update.events.map((event) => ({ ...event, occurredAt: clock() }));
        return {
          ...game,
          character: update.character,
          events: [...game.events, ...events],
          processedEventIds: [...game.processedEventIds, ...events.map((event) => event.id)],
        };
      },
      action === 'nodes' ? 'nodes' : 'app',
    );
    setStatusMessage(
      action === 'xp'
        ? '100 XP concedidos.'
        : action === 'nodes'
          ? 'Nós carregados desbloqueados.'
          : 'Cinco minérios adicionados.',
    );
  };

  const openChangelog = () => {
    setUnseenNotes(bundledChangelogs);
    setShowChangelog(true);
  };

  const closeChangelog = () => {
    recordChangelogSeen(storage, APPLICATION_VERSION);
    setShowChangelog(false);
  };

  const checks = async () => {
    setUpdateMessage('Verificando versões…');
    try {
      const latest = await checkLatestRelease(deviceSettings.updateChannel);
      setUpdateMessage(
        latest
          ? `${t('settings.updates.available')}: ${latest.version}${latest.preview ? ' · preview' : ''}`
          : t('settings.updates.current'),
      );
    } catch {
      setUpdateMessage(t('settings.updates.offline'));
    }
  };

  const visibleActivities = useMemo(
    () =>
      [...activeContent.activities.values()].filter(
        (activity) =>
          !activity.expeditionId &&
          (activityCategory === 'all' ||
            activityCategories
              .find((category) => category.id === activityCategory)
              ?.values.includes(activity.category as never)),
      ),
    [activeContent, activityCategory],
  );
  const combatActivityOptions = useMemo(
    () =>
      [...activeContent.activities.values()].filter((activity) => {
        if (!activity.expeditionId) return false;
        if (combatView === 'expeditions') return true;
        const expedition = activeContent.expeditions.get(activity.expeditionId);
        const expected =
          combatView === 'quests'
            ? 'quest'
            : combatView === 'dungeons'
              ? 'dungeon'
              : combatView === 'raids'
                ? 'raid'
                : null;
        return expected === null || expedition?.activityKind === expected;
      }),
    [activeContent, combatView],
  );
  const categories = useMemo(
    () =>
      Object.entries(character?.inventory ?? {})
        .filter(
          ([id, quantity]) =>
            quantity > 0 &&
            (activeContent.items.get(id)?.name ?? id)
              .toLocaleLowerCase()
              .includes(inventorySearch.toLocaleLowerCase()),
        )
        .sort((a, b) =>
          inventorySort === 'quantity'
            ? b[1] - a[1]
            : (activeContent.items.get(a[0])?.name ?? a[0]).localeCompare(
                activeContent.items.get(b[0])?.name ?? b[0],
              ),
        ),
    [activeContent.items, character?.inventory, inventorySearch, inventorySort],
  );

  const renderActivityQueue = () => (
    <section className="panel queue-panel" aria-labelledby="queue-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t('activity.progress')}</p>
          <h2 id="queue-heading">{t('activity.queue')}</h2>
        </div>
        <span className="queue-count">{queuedSessions.length} / 5</span>
      </div>
      {activeSession && (
        <SessionProgress session={activeSession} clock={clock} content={activeContent} />
      )}
      <ol className="queue-list" aria-label={t('session.queueLabel')}>
        {queuedSessions.map((session, index) =>
          session.status === 'active' ? null : (
            <li key={session.id} className="queue-item">
              <div>
                <strong>{getSessionName(session, activeContent)}</strong>
                <span>{Math.ceil(session.durationMs / 60_000)} min</span>
              </div>
              <div className="queue-actions">
                <label className="sr-only" htmlFor={`duration-${session.id}`}>
                  Duração da sessão {index + 1} em minutos
                </label>
                <input
                  id={`duration-${session.id}`}
                  type="number"
                  min="1"
                  value={durationDrafts[session.id] ?? String(session.durationMs / 60_000)}
                  onChange={(event) =>
                    setDurationDrafts((drafts) => ({ ...drafts, [session.id]: event.target.value }))
                  }
                />
                <button
                  className="quiet-button"
                  onClick={() => void saveDurationAction(session)}
                  type="button"
                >
                  {t('activity.saveDuration')}
                </button>
                <button
                  className="quiet-button"
                  aria-label={t('activity.moveUpPosition').replace('{position}', String(index + 1))}
                  disabled={index <= 1}
                  onClick={() => void moveSessionUpAction(session, index)}
                  type="button"
                >
                  ↑
                </button>
              </div>
            </li>
          ),
        )}
        {queuedSessions.length === 0 && <li className="empty-state">{t('activity.noQueue')}</li>}
      </ol>
      {activeSession && (
        <button className="danger-button" onClick={() => void cancelSessionAction()} type="button">
          {t('common.cancel')}
        </button>
      )}
    </section>
  );

  const activityPlanner = (options = visibleActivities) => (
    <section className="panel" aria-labelledby="activity-planner-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t('activity.action')}</p>
          <h2 id="activity-planner-heading">{t('activity.planning')}</h2>
        </div>
      </div>
      <GameSelect
        id="activity-select"
        label={t('activity.pick')}
        value={
          options.some((activity) => activity.id === activityId)
            ? activityId
            : (options[0]?.id ?? '')
        }
        options={options.map((activity) => ({ value: activity.id, label: activity.name }))}
        onChange={setActivityId}
      />
      <div className="session-form">
        <label>
          {t('activity.duration')}
          <input
            type="number"
            min="1"
            max="10080"
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={!character || queuedSessions.length >= 5 || options.length === 0}
          onClick={() =>
            void addSessionAction(
              options.some((activity) => activity.id === activityId) ? activityId : options[0]!.id,
            )
          }
          type="button"
        >
          {t('activity.add')}
        </button>
      </div>
      {options.length === 0 && <p className="empty-state">{t('activity.emptyCategory')}</p>}
    </section>
  );

  const home = () => (
    <section className="screen-stack" aria-labelledby="home-heading">
      {!character ? (
        <section className="hero-panel onboarding-panel">
          <OrbitMark />
          <p className="eyebrow">{t('activity.vibe')}</p>
          <h1 id="home-heading">{t('app.create.heading')}</h1>
          <p>{t('app.create.description')}</p>
          <label htmlFor="character-name">{t('app.create.name')}</label>
          <input
            id="character-name"
            autoComplete="off"
            maxLength={48}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('app.namePlaceholder')}
          />
          <button
            className="primary-button"
            onClick={() => void createCharacterAction()}
            type="button"
          >
            {t('app.create.submit')}
          </button>
        </section>
      ) : (
        <>
          <section className="hero-panel home-hero" aria-labelledby="home-heading">
            <div className="hero-art">
              <OrbitMark />
              <img src="/assets/eternity-sword.png" alt="" />
            </div>
            <div className="hero-content">
              <p className="eyebrow">{t('home.greeting')}</p>
              <h1 id="home-heading">{character.name}</h1>
              <p className="muted">
                {activeContent.races.get(character.raceId)?.name ?? character.raceId} ·{' '}
                {activeContent.classes.get(character.classId)?.name ?? character.classId}
              </p>
              <div className="level-badge">
                <strong>
                  {t('common.level')} {character.level}
                </strong>
                <span>
                  {character.experience.current} / {activeContent.rules.experiencePerLevel} XP
                </span>
              </div>
              <div
                className="arcane-progress"
                role="progressbar"
                aria-label={t('character.levelProgress')}
                aria-valuemin={0}
                aria-valuemax={activeContent.rules.experiencePerLevel}
                aria-valuenow={character.experience.current}
              >
                <svg viewBox="0 0 100 8" preserveAspectRatio="none">
                  <rect x="0" y="1" width="100" height="6" rx="3" />
                  <rect
                    className="progress-fill"
                    x="0"
                    y="1"
                    width={`${Math.min(100, (character.experience.current / activeContent.rules.experiencePerLevel) * 100)}%`}
                    height="6"
                    rx="3"
                  />
                </svg>
              </div>
            </div>
            <div className="hero-rune">
              ER<span>✦</span>
            </div>
          </section>
          {activeSession ? (
            <section className="panel active-session-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t('home.active')}</p>
                  <h2>
                    {activeContent.activities.get(activeSession.activityId)?.name ??
                      activeSession.activityId}
                  </h2>
                </div>
                <button
                  className="quiet-button"
                  onClick={() =>
                    setTab(
                      activeContent.activities.get(activeSession.activityId)?.expeditionId
                        ? 'combat'
                        : 'activities',
                    )
                  }
                  type="button"
                >
                  {t('character.activityOpen')}
                </button>
              </div>
              <SessionProgress session={activeSession} clock={clock} content={activeContent} />
            </section>
          ) : (
            <section className="panel idle-panel">
              <p className="eyebrow">{t('home.nextChapter')}</p>
              <h2>{t('home.idle')}</h2>
              <button className="primary-button" onClick={() => setTab('activities')} type="button">
                {t('home.open.activities')}
              </button>
            </section>
          )}
          <div className="home-grid">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t('home.queue')}</p>
                  <h2>{t('home.universalQueue')}</h2>
                </div>
                <button className="quiet-button" onClick={() => setTab('activities')} type="button">
                  {t('character.nextQueue')}
                </button>
              </div>
              <ol className="compact-queue">
                {queuedSessions.slice(0, 4).map((session, index) => (
                  <li key={session.id}>
                    <span className="queue-index">0{index + 1}</span>
                    <span>
                      {activeContent.activities.get(session.activityId)?.name ?? session.activityId}
                    </span>
                    <span>
                      {session.status === 'active'
                        ? '●'
                        : `${Math.ceil(session.durationMs / 60_000)} min`}
                    </span>
                  </li>
                ))}
              </ol>
              {queuedSessions.length === 0 && (
                <p className="empty-state">{t('home.empty.queue')}</p>
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t('home.recent')}</p>
                  <h2>{t('home.recentTitle')}</h2>
                </div>
              </div>
              <ul className="recent-events">
                {activeState.events
                  .filter(
                    (event) =>
                      event.type === 'item.acquired' ||
                      event.type === 'reward.granted' ||
                      event.type === 'experience.gained',
                  )
                  .slice(-4)
                  .reverse()
                  .map((event) => (
                    <li key={event.id}>
                      <span>
                        {event.type === 'item.acquired'
                          ? (activeContent.items.get(event.itemId)?.name ?? event.itemId)
                          : event.type === 'experience.gained'
                            ? `+${event.amount} XP`
                            : 'Sessão concluída'}
                      </span>
                      <time dateTime={new Date(event.occurredAt).toISOString()}>
                        {new Date(event.occurredAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </li>
                  ))}
              </ul>
              {!activeState.events.some(
                (event) =>
                  event.type === 'item.acquired' ||
                  event.type === 'reward.granted' ||
                  event.type === 'experience.gained',
              ) && <p className="empty-state">{t('home.nextAchievements')}</p>}
            </section>
          </div>
          <div className="quick-actions">
            <button className="arcane-action" onClick={() => setTab('combat')} type="button">
              <Icon name="sword" />
              <span>{t('home.open.combat')}</span>
            </button>
            <button className="arcane-action" onClick={() => setTab('character')} type="button">
              <Icon name="person" />
              <span>{t('home.open.character')}</span>
            </button>
            <button className="arcane-action" onClick={() => setTab('missions')} type="button">
              <Icon name="scroll" />
              <span>{t('home.missionsShortcut')}</span>
            </button>
          </div>
        </>
      )}
    </section>
  );

  const activities = () => {
    const selectedActivity = activityDetailId
      ? activeContent.activities.get(activityDetailId)
      : undefined;
    const completedSessions = selectedActivity
      ? activeState.sessions.filter(
          (session) => session.activityId === selectedActivity.id && session.status === 'completed',
        )
      : [];
    const pendingSessions = selectedActivity
      ? queuedSessions.filter((session) => session.activityId === selectedActivity.id)
      : [];
    const reward = selectedActivity
      ? activeContent.rewards.get(selectedActivity.rewardId)
      : undefined;
    const relatedSkills = selectedActivity
      ? [...activeContent.skills.values()].filter((skill) =>
          skill.activityIds.includes(selectedActivity.id),
        )
      : [];

    if (activityCategory === 'market') {
      return character ? (
        <MarketPanel
          character={character}
          content={activeContent}
          clock={clock}
          updateCharacter={updateCharacterAction}
        />
      ) : (
        <section className="panel empty-state">{t('character.noCharacter')}</section>
      );
    }

    if (selectedActivity) {
      return (
        <section className="screen-stack" aria-labelledby="activity-detail-heading">
          <button
            className="quiet-button back-button"
            onClick={() => setActivityDetailId(null)}
            type="button"
          >
            {t('activity.backToList')}
          </button>
          <article className="hero-panel activity-detail-panel">
            <div className="activity-sigil" aria-hidden="true">
              <Icon name="spark" />
            </div>
            <p className="eyebrow">
              {activityCategories.find((category) =>
                category.values.includes(selectedActivity.category as never),
              )?.label ?? t('activity.category.fallback')}
            </p>
            <h1 id="activity-detail-heading">{selectedActivity.name}</h1>
            <p>{selectedActivity.description}</p>
            <div className="activity-progress-summary">
              <div>
                <strong>{completedSessions.length}</strong>
                <span>{t('activity.completedCycles')}</span>
              </div>
              <div>
                <strong>{pendingSessions.length}</strong>
                <span>{t('activity.pendingCycles')}</span>
              </div>
              <div>
                <strong>
                  {Math.floor(
                    completedSessions.reduce((total, session) => total + session.durationMs, 0) /
                      60_000,
                  )}{' '}
                  {t('common.minutes')}
                </strong>
                <span>{t('activity.completedTime')}</span>
              </div>
            </div>
          </article>
          <section className="panel activity-benefits-panel">
            <h2>{t('activity.benefits')}</h2>
            {reward ? (
              <>
                {reward.description && <p>{reward.description}</p>}
                <div className="benefit-tags">
                  {reward.experience > 0 && <span>+{reward.experience} XP</span>}
                  {reward.items.map((item) => (
                    <span key={item.itemId}>
                      {activeContent.items.get(item.itemId)?.name ?? item.itemId} ×{item.quantity}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p>{t('activity.noBenefits')}</p>
            )}
            <h3>{t('activity.skillsImproved')}</h3>
            {relatedSkills.length ? (
              <ul className="activity-skill-list">
                {relatedSkills.map((skill) => (
                  <li key={skill.id}>
                    <strong>{skill.name}</strong>
                    <span>{skill.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('activity.noRelatedSkills')}</p>
            )}
          </section>
          <section className="panel">
            <h2>{t('activity.requirementsHeading')}</h2>
            <p>{t('activity.requirements')}</p>
          </section>
          {activityPlanner([selectedActivity])}
          {renderActivityQueue()}
        </section>
      );
    }

    return (
      <section className="screen-stack" aria-labelledby="activities-heading">
        <div className="screen-intro">
          <p className="eyebrow">{t('activity.routine')}</p>
          <h1 id="activities-heading">{t('activity.heading')}</h1>
          <p>{t('activity.description')}</p>
        </div>
        <div className="category-rail" role="group" aria-label={t('activity.categoryLabel')}>
          {activityCategories.map((category) => (
            <button
              key={category.id}
              className="category-chip"
              type="button"
              aria-pressed={activityCategory === category.id}
              onClick={() => setActivityCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
        <section className="activity-grid" aria-label={t('activity.available')}>
          {visibleActivities.map((activity) => {
            const reward = activeContent.rewards.get(activity.rewardId);
            const relatedSkills = [...activeContent.skills.values()].filter((skill) =>
              skill.activityIds.includes(activity.id),
            );
            return (
              <article className="activity-card" key={activity.id}>
                <div className="activity-sigil">
                  <Icon name="spark" />
                </div>
                <p className="eyebrow">
                  {activityCategories.find((category) =>
                    category.values.includes(activity.category as never),
                  )?.label ?? t('activity.category.fallback')}
                </p>
                <h2>{activity.name}</h2>
                <p>{activity.description}</p>
                <div className="benefit-tags">
                  {reward?.experience ? <span>+{reward.experience} XP</span> : null}
                  {reward?.items.map((item) => (
                    <span key={item.itemId}>
                      {activeContent.items.get(item.itemId)?.name ?? item.itemId} ×{item.quantity}
                    </span>
                  ))}
                  {relatedSkills.map((skill) => (
                    <span key={skill.id}>{skill.name}</span>
                  ))}
                </div>
                <small className="muted">{t('activity.requirements')}</small>
                <button
                  className="quiet-button"
                  onClick={() => {
                    setActivityDetailId(activity.id);
                    setActivityId(activity.id);
                  }}
                  type="button"
                >
                  {t('activity.openDetails')}
                </button>
                <button
                  className="quiet-button"
                  disabled={!character || queuedSessions.length >= 5}
                  onClick={() => void addSessionAction(activity.id)}
                  type="button"
                >
                  {t('activity.addQueue')}
                </button>
              </article>
            );
          })}
          {visibleActivities.length === 0 && (
            <article className="panel empty-state">{t('activity.empty')}</article>
          )}
        </section>
        {activityPlanner()}
        {renderActivityQueue()}
      </section>
    );
  };

  const combat = () => (
    <section className="screen-stack" aria-labelledby="combat-heading">
      <div className="screen-intro">
        <p className="eyebrow">{t('combat.exploration')}</p>
        <h1 id="combat-heading">{t('combat.heading')}</h1>
        <p>{t('combat.description')}</p>
      </div>
      <div className="subnav-rail" role="tablist" aria-label={t('combat.areas')}>
        {combatNavigation.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={combatView === entry.id}
            className="subnav-button"
            type="button"
            onClick={() => setCombatView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {combatView === 'expeditions' ||
      combatView === 'quests' ||
      combatView === 'dungeons' ||
      combatView === 'raids' ? (
        <>
          <PhaseTwoPanels
            state={activeState}
            content={activeContent}
            clock={clock}
            updateCharacter={updateCharacterAction}
            onCraft={craftRecipeAction}
            view="expeditions"
            expeditionKind={
              combatView === 'quests'
                ? 'quest'
                : combatView === 'dungeons'
                  ? 'dungeon'
                  : combatView === 'raids'
                    ? 'raid'
                    : undefined
            }
          />
          {activityPlanner(combatActivityOptions)}
        </>
      ) : combatView === 'bestiary' ? (
        <PhaseTwoPanels
          state={activeState}
          content={activeContent}
          clock={clock}
          updateCharacter={updateCharacterAction}
          onCraft={craftRecipeAction}
          view="bestiary"
        />
      ) : combatView === 'arena' ? (
        <PhaseTwoPanels
          state={activeState}
          content={activeContent}
          clock={clock}
          updateCharacter={updateCharacterAction}
          onCraft={craftRecipeAction}
          view="arena"
        />
      ) : (
        <PhaseTwoPanels
          state={activeState}
          content={activeContent}
          clock={clock}
          updateCharacter={updateCharacterAction}
          onCraft={craftRecipeAction}
          view="records"
        />
      )}
    </section>
  );

  const missions = () => {
    const visibleMissions = [...activeContent.missions.values()].filter(
      (mission) => mission.cadence === missionCadence,
    );
    return (
      <section className="screen-stack" aria-labelledby="missions-heading">
        <div className="screen-intro">
          <p className="eyebrow">{t('missions.objectives')}</p>
          <h1 id="missions-heading">{t('missions.heading')}</h1>
          <p>{t('missions.description')}</p>
        </div>
        <div className="subnav-rail" role="tablist" aria-label={t('missions.periodLabel')}>
          {(['main', 'secondary', 'daily', 'weekly'] as const).map((cadence) => (
            <button
              key={cadence}
              role="tab"
              aria-selected={missionCadence === cadence}
              className="subnav-button"
              type="button"
              onClick={() => setMissionCadence(cadence)}
            >
              {t(`missions.${cadence}`)}
            </button>
          ))}
        </div>
        {visibleMissions.map((mission) => {
          const progress = getMissionProgress(activeState, mission.id, clock(), activeContent);
          return (
            <article className="panel mission-card" key={mission.id}>
              <div className="mission-emblem">
                <Icon name="scroll" />
              </div>
              <div>
                <p className="eyebrow">{t(`missions.${missionCadence}`)}</p>
                <h2>{mission.name}</h2>
                <p>{mission.description}</p>
                <div
                  className="arcane-progress"
                  role="progressbar"
                  aria-label={t('missions.progress')}
                  aria-valuemin={0}
                  aria-valuemax={progress.target}
                  aria-valuenow={progress.progress}
                >
                  <svg viewBox="0 0 100 8" preserveAspectRatio="none">
                    <rect x="0" y="1" width="100" height="6" rx="3" />
                    <rect
                      className="progress-fill"
                      x="0"
                      y="1"
                      width={`${(progress.progress / progress.target) * 100}%`}
                      height="6"
                      rx="3"
                    />
                  </svg>
                </div>
                <p className="muted">
                  {t('missions.progress')}: {progress.progress} / {progress.target}
                </p>
                {progress.lockedReason && <p className="muted">{progress.lockedReason}</p>}
                <div className="benefit-tags">
                  {mission.reward.experience > 0 && <span>+{mission.reward.experience} XP</span>}
                  {Object.entries(mission.reward.items).map(([id, quantity]) => (
                    <span key={id}>
                      {activeContent.items.get(id)?.name ?? id} ×{quantity}
                    </span>
                  ))}
                  {Object.entries(mission.reward.currencies ?? {}).map(([currency, amount]) => (
                    <span key={currency}>
                      +{amount} {currency}
                    </span>
                  ))}
                </div>
              </div>
              <button
                className={
                  progress.complete && !progress.claimed
                    ? 'primary-button reward-button'
                    : 'quiet-button'
                }
                disabled={!progress.available || !progress.complete || progress.claimed}
                onClick={() => claimMissionReward(mission.id)}
                type="button"
              >
                {progress.claimed
                  ? t('missions.claimed')
                  : progress.complete
                    ? t('missions.claim')
                    : t('missions.notReady')}
              </button>
            </article>
          );
        })}
        {visibleMissions.length === 0 && (
          <p className="panel empty-state">{t('missions.noContent')}</p>
        )}
      </section>
    );
  };

  const characterScreen = () => {
    if (!character)
      return (
        <section className="screen-stack">
          <div className="panel">
            <h1>{t('character.heading')}</h1>
            <p>{t('character.noCharacter')}</p>
          </div>
        </section>
      );
    const slots: Array<{ id: EquipmentSlot; label: string }> = [
      { id: 'head', label: t('equipment.head') },
      { id: 'chest', label: t('equipment.chest') },
      { id: 'legs', label: t('equipment.legs') },
      { id: 'hands', label: t('equipment.hands') },
      { id: 'feet', label: t('equipment.feet') },
      { id: 'primary', label: t('equipment.primary') },
      { id: 'secondary', label: t('equipment.secondary') },
    ];
    const implantCatalog = getAllImplantDefinitions(activeContent);
    const installedImplants = getInstalledImplants(character, activeContent);
    const installedImplantIds = new Set(installedImplants.map((implant) => implant.id));
    const brokenImplantIds = new Set(getBrokenImplantIds(character));
    const implantCapacity = getImplantCapacity(character);
    const implantLoad = getAlchemicalLoad(character, activeContent);
    const manaAffinityDefinitions = activeContent.energies.get('energy:mana')?.affinities ?? [];
    const selectedManaAffinities = character.energy.affinities ?? [];
    const wallet = character.extensions.wallet;
    const fragmentBalance =
      typeof wallet === 'object' && wallet !== null && 'fragments' in wallet
        ? Number((wallet as Record<string, unknown>).fragments ?? 0)
        : 0;
    return (
      <section className="screen-stack" aria-labelledby="character-heading">
        <div className="screen-intro">
          <p className="eyebrow">{t('character.sheet')}</p>
          <h1 id="character-heading">{character.name}</h1>
          <p>
            {activeContent.races.get(character.raceId)?.name ?? character.raceId} ·{' '}
            {activeContent.classes.get(character.classId)?.name ?? character.classId} · Nível{' '}
            {character.level}
          </p>
        </div>
        <div className="subnav-rail" role="tablist" aria-label={t('character.sections')}>
          {characterNavigation.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={characterView === entry.id}
              className="subnav-button"
              type="button"
              onClick={() => setCharacterView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {characterView === 'overview' ? (
          <>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t('character.attributes')}</p>
                  <h2>{t('character.capabilities')}</h2>
                </div>
                <span className="level-badge">
                  {t('common.level')} {character.level}
                </span>
              </div>
              <div className="attribute-grid">
                {Object.entries(character.attributes.physical).map(([key, value]) => (
                  <div className="attribute-cell" key={key}>
                    <span>{localizedStatLabel(key)}</span>
                    <strong>{value}</strong>
                    <button
                      className="quiet-button"
                      type="button"
                      aria-label={`Aumentar ${localizedStatLabel(key)}`}
                      disabled={Number(character.extensions.attributePoints ?? 0) < 1}
                      onClick={() =>
                        void updateCharacterAction((current) =>
                          spendAttributePoint(current, `physical:${key}`),
                        )
                      }
                    >
                      +1
                    </button>
                  </div>
                ))}
                {Object.entries(character.attributes.energetic).map(([key, value]) => (
                  <div className="attribute-cell" key={key}>
                    <span>{localizedStatLabel(key)}</span>
                    <strong>{value}</strong>
                    <button
                      className="quiet-button"
                      type="button"
                      aria-label={`Aumentar ${localizedStatLabel(key)}`}
                      disabled={Number(character.extensions.attributePoints ?? 0) < 1}
                      onClick={() =>
                        void updateCharacterAction((current) =>
                          spendAttributePoint(current, `energy:${key}`),
                        )
                      }
                    >
                      +1
                    </button>
                  </div>
                ))}
              </div>
              <p className="muted">
                Pontos de atributo disponíveis: {Number(character.extensions.attributePoints ?? 0)}
              </p>
            </section>
            <div className="character-detail-grid">
              <section className="panel">
                <p className="eyebrow">{t('character.race')}</p>
                <h2>{activeContent.races.get(character.raceId)?.name ?? character.raceId}</h2>
                <p>
                  {activeContent.races.get(character.raceId)?.description ??
                    'Raça carregada no save.'}
                </p>
              </section>
              <section className="panel">
                <p className="eyebrow">{t('character.class')}</p>
                <h2>{activeContent.classes.get(character.classId)?.name ?? character.classId}</h2>
                <p>
                  {activeContent.classes.get(character.classId)?.description ??
                    'Classe carregada no save.'}
                </p>
              </section>
              <section className="panel">
                <p className="eyebrow">{t('character.energy')}</p>
                <h2>{localizedStatLabel(character.energy.affinity)}</h2>
                <fieldset className="energy-choice-group">
                  <legend>{t('character.energyPath')}</legend>
                  <p className="muted">{t('character.energyPathPermanent')}</p>
                  <div className="category-rail">
                    {(
                      [
                        { id: 'mana', label: t('energy.mana') },
                        { id: 'aura', label: t('energy.aura') },
                        { id: 'unaffiliated', label: t('energy.none') },
                      ] as const
                    ).map((path) => (
                      <button
                        className="category-chip"
                        type="button"
                        key={path.id}
                        aria-pressed={character.energy.affinity === path.id}
                        disabled={
                          character.energy.affinity !== 'unawakened' &&
                          character.energy.affinity !== path.id
                        }
                        onClick={() =>
                          void updateCharacterAction((current) =>
                            selectEnergyPath(current, path.id as EnergyPath),
                          )
                        }
                      >
                        {path.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {character.energy.affinity === 'mana' && (
                  <fieldset className="energy-choice-group">
                    <legend>{t('character.manaAffinities')}</legend>
                    <p className="muted">{t('character.manaAffinitiesHelp')}</p>
                    <div className="category-rail">
                      {manaAffinityDefinitions.map((affinity) => {
                        const selected = selectedManaAffinities.includes(affinity.id);
                        return (
                          <button
                            className="category-chip"
                            type="button"
                            key={affinity.id}
                            aria-pressed={selected}
                            disabled={
                              character.extensions.manaAffinitiesLocked === true ||
                              (!selected && selectedManaAffinities.length >= 4)
                            }
                            onClick={() =>
                              void updateCharacterAction((current) => {
                                const currentSelection = current.energy.affinities ?? [];
                                const nextSelection = currentSelection.includes(affinity.id)
                                  ? currentSelection.filter((id) => id !== affinity.id)
                                  : [...currentSelection, affinity.id];
                                return selectManaAffinities(
                                  current,
                                  nextSelection,
                                  manaAffinityDefinitions,
                                );
                              })
                            }
                          >
                            {affinity.name}
                          </button>
                        );
                      })}
                    </div>
                    {character.extensions.manaAffinitiesLocked === true ? (
                      <p className="muted" role="status">
                        {t('character.manaAffinitiesSealed')}
                      </p>
                    ) : (
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={selectedManaAffinities.length === 0}
                        onClick={() =>
                          void updateCharacterAction((current) => sealManaAffinities(current))
                        }
                      >
                        {t('character.sealManaAffinities')}
                      </button>
                    )}
                  </fieldset>
                )}
                {character.energy.affinity === 'unaffiliated' && (
                  <p className="muted" role="status">
                    {t('character.unaffiliatedIncomplete')}
                  </p>
                )}
                <div className="energy-bars">
                  {Object.entries(character.energy.reserves).map(([id, amount]) => (
                    <div key={id}>
                      <span>{localizedStatLabel(id)}</span>
                      <strong>{amount}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : characterView === 'equipment' ? (
          <>
            <section className="panel equipment-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{t('character.equipmentSlots')}</p>
                  <h2>{t('character.equippedBuild')}</h2>
                </div>
              </div>
              <div className="equipment-grid">
                {slots.map((slot) => {
                  const itemId = character.equipment[slot.id];
                  return (
                    <div className={`equipment-slot ${itemId ? 'filled' : ''}`} key={slot.id}>
                      <span>{slot.label}</span>
                      <strong>
                        {typeof itemId === 'string'
                          ? (activeContent.items.get(itemId)?.name ?? itemId)
                          : t('character.empty')}
                      </strong>
                      {typeof itemId === 'string' && (
                        <button
                          className="quiet-button"
                          onClick={() =>
                            void updateCharacterAction((current) =>
                              unequipItem(current, activeContent, slot.id),
                            )
                          }
                          type="button"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            <PhaseTwoPanels
              state={activeState}
              content={activeContent}
              clock={clock}
              updateCharacter={updateCharacterAction}
              onCraft={craftRecipeAction}
              view="forge"
            />
          </>
        ) : characterView === 'inventory' ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t('character.unlimited')}</p>
                <h2>{t('character.inventory')}</h2>
              </div>
              <span className="muted">
                {Object.keys(character.inventory).length} {t('character.types')}
              </span>
            </div>
            <div className="inventory-toolbar">
              <label>
                {t('character.inventorySearch')}
                <input
                  value={inventorySearch}
                  onChange={(event) => setInventorySearch(event.target.value)}
                  placeholder={t('character.inventoryPlaceholder')}
                />
              </label>
              <GameSelect
                id="inventory-sort"
                label={t('character.sort')}
                value={inventorySort}
                options={[
                  { value: 'name', label: t('character.sort.name') },
                  { value: 'quantity', label: t('character.sort.quantity') },
                ]}
                onChange={setInventorySort}
              />
            </div>
            {categories.length ? (
              <ul className="inventory-list">
                {categories.map(([itemId, quantity]) => (
                  <li key={itemId}>
                    <span>
                      <strong>{activeContent.items.get(itemId)?.name ?? itemId}</strong>
                      <small>{activeContent.items.get(itemId)?.description ?? itemId}</small>
                    </span>
                    <strong>×{quantity}</strong>
                    {activeContent.items.get(itemId)?.consumable && (
                      <button
                        className="quiet-button"
                        type="button"
                        aria-label={`Usar ${activeContent.items.get(itemId)?.name ?? itemId}`}
                        disabled={quantity < 1}
                        onClick={() => consumeItemAction(itemId)}
                      >
                        Usar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{t('character.emptyInventory')}</p>
            )}
          </section>
        ) : characterView === 'skills' ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{t('character.skillDevelopment')}</p>
                <h2>{t('character.skills')}</h2>
              </div>
            </div>
            <div className="skill-grid">
              {[...activeContent.skills.values()].map((skill) => {
                const progress = character.skills[skill.id];
                return (
                  <article className="skill-card" key={skill.id}>
                    <span className="skill-glyph">✦</span>
                    <h3>{skill.name}</h3>
                    <p>{skill.description}</p>
                    <div className="arcane-progress">
                      <svg viewBox="0 0 100 8" preserveAspectRatio="none">
                        <rect x="0" y="1" width="100" height="6" rx="3" />
                        <rect
                          className="progress-fill"
                          x="0"
                          y="1"
                          width={`${Math.min(100, (progress?.experience ?? 0) % 100)}%`}
                          height="6"
                          rx="3"
                        />
                      </svg>
                    </div>
                    <p className="muted">
                      {t('common.level')} {progress?.level ?? 0} · {progress?.experience ?? 0} XP
                    </p>
                  </article>
                );
              })}
            </div>
            {activeContent.skills.size === 0 && (
              <p className="empty-state">{t('character.noSkills')}</p>
            )}
          </section>
        ) : characterView === 'implants' ? (
          <section className="panel implant-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Alquimia e cirurgia</p>
                <h2>Implantes alquímicos</h2>
              </div>
              <span className="level-badge">
                Carga {implantLoad} / {implantCapacity}
              </span>
            </div>
            <p>
              Síndrome de Dédalo:{' '}
              <strong>{getDedalusSyndrome(implantLoad, implantCapacity)}</strong>. Cada instalação
              custa 10.000 Fragmentos; exceder a capacidade é permitido e registra a consequência
              correspondente.
            </p>
            <div className="skill-grid">
              {implantCatalog.map((implant) => {
                const owned = character.inventory[implant.deviceItemId] ?? 0;
                const alreadyInstalled = installedImplantIds.has(implant.id);
                const broken = brokenImplantIds.has(implant.id);
                return (
                  <article className="skill-card" key={implant.id}>
                    <span className="skill-glyph">✦</span>
                    <h3>{implant.name}</h3>
                    <p>{String(implant.description ?? '')}</p>
                    <p className="muted">
                      {String(implant.rank)} · Carga {implant.charge} · Dispositivo: {owned} ·
                      Compra:{' '}
                      {Number(implant.acquisitionPriceFragments ?? 0).toLocaleString('pt-BR')}{' '}
                      Fragmentos · Cirurgia: 10.000 Fragmentos
                    </p>
                    {implant.implementedEffects.length > 0 && (
                      <p className="muted">
                        Em funcionamento: {implant.implementedEffects.join(', ')}.
                      </p>
                    )}
                    {implant.pendingEffects.length > 0 && (
                      <p className="muted">Pendente: {implant.pendingEffects.join(' ')}</p>
                    )}
                    {broken && (
                      <p className="muted">
                        Quebrado. Remoção disponível sem custo como adaptação; a documentação não
                        define taxa cirúrgica para remoção.
                      </p>
                    )}
                    <button
                      className={owned > 0 && !alreadyInstalled ? 'primary-button' : 'quiet-button'}
                      type="button"
                      disabled={
                        (alreadyInstalled && !broken) ||
                        (!broken && owned > 0 && fragmentBalance < 10_000)
                      }
                      onClick={() => {
                        if (broken) {
                          void updateCharacterAction((current) =>
                            removeBrokenImplant(current, activeContent, implant.id),
                          ).catch(() => undefined);
                        } else if (owned < 1) {
                          setTab('activities');
                          setActivityCategory('market');
                        } else {
                          installImplantAction(implant.id);
                        }
                      }}
                    >
                      {broken
                        ? 'Remover implante quebrado'
                        : alreadyInstalled
                          ? 'Instalado'
                          : owned > 0
                            ? 'Instalar'
                            : 'Adquirir na Loja de Fragmentos'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : characterView === 'forge' ? (
          <PhaseTwoPanels
            state={activeState}
            content={activeContent}
            clock={clock}
            updateCharacter={updateCharacterAction}
            onCraft={craftRecipeAction}
            view="forge"
          />
        ) : (
          <PhaseTwoPanels
            state={activeState}
            content={activeContent}
            clock={clock}
            updateCharacter={updateCharacterAction}
            onCraft={craftRecipeAction}
            view="nodes"
          />
        )}
      </section>
    );
  };

  const missionForChangelog = useMemo(
    () =>
      Object.fromEntries(
        bundledChangelogs.map((release) => [
          release.version,
          Object.values(release.changes).flat(),
        ]),
      ),
    [],
  );
  const screen = settingsOpen ? (
    <SettingsScreen
      settings={deviceSettings}
      updateSettings={updateSettings}
      version={APPLICATION_VERSION}
      build={import.meta.env.MODE}
      characters={profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        level: profile.level,
        active: profile.id === character?.id,
      }))}
      backups={backups}
      mods={mods as InstalledModSummary[]}
      logs={logs}
      logLevel={logLevel}
      logSubsystem={logSubsystem}
      updateMessage={updateMessage || statusMessage}
      onBack={() => setSettingsOpen(false)}
      onCreateCharacter={(newName) => runSafely(() => createCharacterFromSettings(newName))}
      onSwitchCharacter={(id) => runSafely(() => switchCharacter(id))}
      onResetCharacter={() => runSafely(resetCharacter)}
      onDeleteCharacter={() => runSafely(deleteCharacter)}
      onExportSave={() => runSafely(exportSave)}
      onCreateBackup={() => runSafely(createBackup)}
      onRestoreBackup={(id) => runSafely(() => restoreBackup(id))}
      onImportSave={(file) => runSafely(() => importSave(file))}
      onImportMod={(file) => runSafely(() => importMod(file))}
      onToggleMod={toggleMod}
      onRemoveMod={removeMod}
      onNotificationPermission={async () => {
        try {
          if (!Capacitor.isNativePlatform()) throw new Error(t('settings.notification.nativeOnly'));
          await requestLocalNotificationPermission();
          setNotificationPermissionRevision((revision) => revision + 1);
          setStatusMessage(t('settings.notification.permissionUpdated'));
        } catch (error) {
          setErrorMessage(
            error instanceof Error ? error.message : t('settings.notification.permissionError'),
          );
        }
      }}
      onCheckUpdates={checks}
      onDebugAction={(action) => runSafely(() => debugAction(action))}
      onLogFilter={(level, subsystem) => {
        setLogLevel(level);
        setLogSubsystem(subsystem);
      }}
      onCopyLogs={() =>
        runSafely(async () => {
          if (!navigator.clipboard) throw new Error(t('settings.logs.copyUnavailable'));
          await navigator.clipboard.writeText(logs.join('\n'));
          setStatusMessage(t('settings.logs.copied'));
        })
      }
      onExportLogs={() =>
        runSafely(() =>
          exportTextFile('eternity-realms-logs.txt', logs.join('\n'), 'Logs do Eternity Realms'),
        )
      }
      changelog={missionForChangelog}
      onOpenChangelog={openChangelog}
    />
  ) : tab === 'home' ? (
    home()
  ) : tab === 'activities' ? (
    activities()
  ) : tab === 'combat' ? (
    combat()
  ) : tab === 'missions' ? (
    missions()
  ) : (
    characterScreen()
  );

  return (
    <main className="game-app">
      <header className="game-header">
        <div className="brand-lockup">
          <img className="brand-sword" src="/assets/eternity-sword.png" alt="" />
          <div className="brand-copy">
            <p className="eyebrow">{t('app.subtitle')}</p>
            <h1>{t('app.wordmark')}</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="offline-indicator" aria-label={t('common.offline')}>
            <i /> {t('common.local')}
          </span>
          <button
            className="quiet-button"
            aria-label={t('session.updateProgress')}
            onClick={() => void refresh().catch(() => undefined)}
            type="button"
          >
            {t('session.refresh')}
          </button>
          <button
            className="icon-button"
            aria-label={t('app.settings')}
            onClick={() => {
              setSettingsOpen(true);
              void runSafely(refreshBackups);
            }}
            type="button"
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <div className="game-content">
        <AppError message={settingError || errorMessage} />
        {statusMessage && (
          <p className="status-banner" role="status">
            {statusMessage}
          </p>
        )}
        {state === null && !settingsOpen ? (
          <section className="screen-stack">
            <div className="panel loading-panel">
              <OrbitMark />
              <p>{t('app.loading')}</p>
            </div>
          </section>
        ) : (
          <Suspense
            fallback={
              <section className="screen-stack" aria-live="polite">
                <div className="panel loading-panel">
                  <OrbitMark />
                  <p>{t('common.loading')}</p>
                </div>
              </section>
            }
          >
            {screen}
          </Suspense>
        )}
      </div>
      <AppTabs
        active={settingsOpen ? 'home' : tab}
        onChange={(next) => {
          setSettingsOpen(false);
          setTab(next);
        }}
      />
      {showChangelog && (
        <div className="news-scrim">
          <section
            className="news-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="news-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {t('common.releaseVersion')} {unseenNotes.at(-1)!.version}
                </p>
                <h2 id="news-heading">{t('settings.changelog.heading')}</h2>
              </div>
              <button
                className="icon-button"
                aria-label={t('common.closeNews')}
                onClick={closeChangelog}
                type="button"
              >
                ×
              </button>
            </div>
            {unseenNotes.map((release) => (
              <article className="release-note" key={release.version}>
                <h3>
                  {release.version} <time dateTime={release.date}>{release.date}</time>
                </h3>
                {Object.entries(release.changes).map(([category, values]) =>
                  values.length ? (
                    <section key={category}>
                      <p className="eyebrow">
                        {t(changelogCategoryKeys[category as keyof typeof changelogCategoryKeys])}
                      </p>
                      <ul>
                        {values.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null,
                )}
              </article>
            ))}
            <button className="primary-button" onClick={closeChangelog} type="button">
              {t('common.continue')}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
