import { useRef, useState } from 'react';
import type { DeviceSettings, ThemeId } from './device-settings';
import { GameSelect, type GameSelectOption } from './GameSelect';
import { t } from './i18n';

export type SettingsCategory =
  | 'appearance'
  | 'notifications'
  | 'characters'
  | 'saves'
  | 'mods'
  | 'development'
  | 'updates'
  | 'about';

export type DebugAction =
  'xp' | 'resource' | 'advance' | 'combat' | 'nodes' | 'inspect' | 'validate-mods';
export type DebugLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type DebugSubsystem =
  'all' | 'app' | 'sessions' | 'combat' | 'persistence' | 'mods' | 'nodes' | 'notifications';

export interface ManagedCharacterSummary {
  id: string;
  name: string;
  level: number;
  active: boolean;
}

export interface BackupSummary {
  id: string;
  createdAt: number;
  characterName: string;
  automatic: boolean;
}

export interface InstalledModSummary {
  id: string;
  name: string;
  version: string;
  author?: string;
  compatibility?: string;
  origin?: string;
  dependencies: string[];
  enabled: boolean;
  loaded: boolean;
  error?: string;
}

interface SettingsScreenProps {
  settings: DeviceSettings;
  updateSettings: (update: (current: DeviceSettings) => DeviceSettings) => void;
  version: string;
  build: string;
  characters: ManagedCharacterSummary[];
  backups: BackupSummary[];
  mods: InstalledModSummary[];
  logs: string[];
  logLevel: DebugLevel;
  logSubsystem: DebugSubsystem;
  updateMessage: string;
  onBack: () => void;
  onCreateCharacter: (name: string) => Promise<void>;
  onSwitchCharacter: (id: string) => Promise<void>;
  onResetCharacter: () => Promise<void>;
  onDeleteCharacter: () => Promise<void>;
  onExportSave: () => Promise<void>;
  onCreateBackup: () => Promise<void>;
  onRestoreBackup: (id: string) => Promise<void>;
  onImportSave: (file: File) => Promise<void>;
  onImportMod: (file: File) => Promise<void>;
  onToggleMod: (id: string, enabled: boolean) => void;
  onRemoveMod: (id: string) => void;
  onNotificationPermission: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onDebugAction: (action: DebugAction) => Promise<void>;
  onLogFilter: (level: DebugLevel, subsystem: DebugSubsystem) => void;
  onCopyLogs: () => Promise<void>;
  onExportLogs: () => Promise<void>;
  changelog: Record<string, string[]>;
  onOpenChangelog: () => void;
}

const categories: Array<{ id: SettingsCategory; label: string }> = [
  { id: 'appearance', label: t('settings.appearance') },
  { id: 'notifications', label: t('settings.notifications') },
  { id: 'characters', label: t('settings.characters') },
  { id: 'saves', label: t('settings.saves') },
  { id: 'mods', label: t('settings.mods') },
  { id: 'development', label: t('settings.development') },
  { id: 'updates', label: t('settings.updates') },
  { id: 'about', label: t('settings.about') },
];

const themeOptions: Array<{
  id: ThemeId;
  label: string;
  colors: string[];
}> = [
  {
    id: 'catppuccin-mocha',
    label: t('settings.theme.catppuccin'),
    colors: ['#1e1e2e', '#cba6f7', '#89b4fa', '#a6e3a1'],
  },
  {
    id: 'tokyo-night',
    label: t('settings.theme.tokyo'),
    colors: ['#1a1b26', '#7aa2f7', '#7dcfff', '#9ece6a'],
  },
  {
    id: 'monochrome',
    label: t('settings.theme.mono'),
    colors: ['#111111', '#f0f0f0', '#b3b3b3', '#ffffff'],
  },
  {
    id: 'gruvbox',
    label: t('settings.theme.gruvbox'),
    colors: ['#282828', '#d3869b', '#83a598', '#fabd2f'],
  },
];

function Toggle({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="setting-toggle">
      <span>{label}</span>
      <button
        className="switch-button"
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={onToggle}
      >
        <span />
      </button>
    </div>
  );
}

export function SettingsScreen(props: SettingsScreenProps) {
  const [category, setCategory] = useState<SettingsCategory>('appearance');
  const [logSearch, setLogSearch] = useState('');
  const [newCharacterName, setNewCharacterName] = useState('');
  const [pendingAction, setPendingAction] = useState<'reset' | 'delete' | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const modInput = useRef<HTMLInputElement>(null);
  const selectedCategory = categories.find((entry) => entry.id === category)!;
  const languageOptions: GameSelectOption[] = [
    { value: 'pt-BR', label: t('settings.language.pt') },
  ];
  const frequencyOptions: GameSelectOption[] = [
    { value: 'off', label: t('settings.saves.frequency.off') },
    { value: 'daily', label: t('settings.saves.frequency.daily') },
    { value: 'weekly', label: t('settings.saves.frequency.weekly') },
  ];
  const channelOptions: GameSelectOption[] = [
    { value: 'stable', label: t('settings.updates.stable') },
    { value: 'preview', label: t('settings.updates.preview') },
  ];

  return (
    <section className="screen-stack" aria-labelledby="settings-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t('app.title')}</p>
          <h1 id="settings-heading">{t('settings.heading')}</h1>
        </div>
        <button className="quiet-button" onClick={props.onBack} type="button">
          {t('settings.back')}
        </button>
      </div>

      <div className="settings-layout">
        <nav className="settings-menu" aria-label={t('settings.heading')}>
          {categories.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={category === entry.id ? 'page' : undefined}
              onClick={() => setCategory(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="panel settings-panel" aria-label={selectedCategory.label}>
          <div className="section-copy">
            <p className="eyebrow">{t('settings.heading')}</p>
            <h2>{selectedCategory.label}</h2>
          </div>

          {category === 'appearance' && (
            <>
              <section aria-labelledby="theme-heading">
                <h3 id="theme-heading">{t('settings.theme')}</h3>
                <div className="settings-grid">
                  {themeOptions.map((theme) => (
                    <button
                      key={theme.id}
                      className="theme-choice"
                      type="button"
                      aria-pressed={props.settings.theme === theme.id}
                      onClick={() =>
                        props.updateSettings((current) => ({ ...current, theme: theme.id }))
                      }
                    >
                      <span>{theme.label}</span>
                      <span className="theme-swatch" aria-hidden="true">
                        {theme.colors.map((color) => (
                          <span key={color} style={{ backgroundColor: color }} />
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <label>
                {t('settings.fontSize')} · {Math.round(props.settings.fontScale * 100)}%
                <input
                  type="range"
                  min="85"
                  max="130"
                  step="5"
                  value={Math.round(props.settings.fontScale * 100)}
                  onChange={(event) =>
                    props.updateSettings((current) => ({
                      ...current,
                      fontScale: Number(event.target.value) / 100,
                    }))
                  }
                />
              </label>
              <label>
                {t('settings.effects')} · {props.settings.effectsIntensity}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={props.settings.effectsIntensity}
                  onChange={(event) =>
                    props.updateSettings((current) => ({
                      ...current,
                      effectsIntensity: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <Toggle
                label={t('settings.motion')}
                checked={props.settings.motion === 'reduced'}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    motion: current.motion === 'reduced' ? 'full' : 'reduced',
                  }))
                }
              />
              <Toggle
                label={t('settings.motion.off')}
                checked={props.settings.motion === 'off'}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    motion: current.motion === 'off' ? 'full' : 'off',
                  }))
                }
              />
              <GameSelect
                id="language-select"
                label={t('settings.language')}
                value={props.settings.language}
                options={languageOptions}
                onChange={() =>
                  props.updateSettings((current) => ({ ...current, language: 'pt-BR' }))
                }
              />
            </>
          )}

          {category === 'notifications' && (
            <>
              <Toggle
                label={t('settings.notifications.session')}
                checked={props.settings.notifications.sessionComplete}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    notifications: {
                      ...current.notifications,
                      sessionComplete: !current.notifications.sessionComplete,
                    },
                  }))
                }
              />
              <Toggle
                label={t('settings.notifications.idle')}
                checked={props.settings.notifications.queueIdle}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    notifications: {
                      ...current.notifications,
                      queueIdle: !current.notifications.queueIdle,
                    },
                  }))
                }
              />
              <Toggle
                label={t('settings.notifications.rewards')}
                checked={props.settings.notifications.rewards}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    notifications: {
                      ...current.notifications,
                      rewards: !current.notifications.rewards,
                    },
                  }))
                }
              />
              <Toggle
                label={t('settings.notifications.missions')}
                checked={props.settings.notifications.missions}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    notifications: {
                      ...current.notifications,
                      missions: !current.notifications.missions,
                    },
                  }))
                }
              />
              <button
                className="quiet-button"
                type="button"
                onClick={() => void props.onNotificationPermission()}
              >
                {t('settings.notification.permission')}
              </button>
            </>
          )}

          {category === 'characters' && (
            <>
              <div className="activity-grid">
                {props.characters.map((character) => (
                  <article className="setting-row" key={character.id}>
                    <strong>{character.name}</strong>
                    <span className="muted">
                      {t('common.level')} {character.level}
                      {character.active ? ` · ${t('settings.characters.current')}` : ''}
                    </span>
                    {!character.active && (
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => void props.onSwitchCharacter(character.id)}
                      >
                        {t('settings.characters.switch')}
                      </button>
                    )}
                  </article>
                ))}
                {props.characters.length === 0 && (
                  <p className="empty-state">{t('common.empty')}</p>
                )}
              </div>
              <form
                className="session-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void props.onCreateCharacter(newCharacterName);
                  setNewCharacterName('');
                }}
              >
                <label>
                  {t('settings.characters.create')}
                  <input
                    value={newCharacterName}
                    maxLength={48}
                    onChange={(event) => setNewCharacterName(event.target.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!newCharacterName.trim()}
                >
                  {t('settings.characters.create')}
                </button>
              </form>
              <div className="action-grid">
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => setPendingAction('reset')}
                >
                  {t('settings.characters.reset')}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => setPendingAction('delete')}
                >
                  {t('settings.characters.delete')}
                </button>
              </div>
              {pendingAction && (
                <div className="arcane-card" role="alert">
                  <p>
                    {pendingAction === 'reset'
                      ? t('settings.characters.resetConfirm')
                      : t('settings.characters.deleteConfirm')}
                  </p>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      const action =
                        pendingAction === 'reset'
                          ? props.onResetCharacter
                          : props.onDeleteCharacter;
                      setPendingAction(null);
                      void action();
                    }}
                  >
                    {t('settings.characters.confirm')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setPendingAction(null)}
                  >
                    {t('settings.characters.cancel')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onCreateBackup()}
                  >
                    {t('settings.saves.backup')}
                  </button>
                </div>
              )}
            </>
          )}

          {category === 'saves' && (
            <>
              <div className="action-grid">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void props.onExportSave()}
                >
                  {t('settings.saves.export')}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => importInput.current?.click()}
                >
                  {t('settings.saves.import')}
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => void props.onCreateBackup()}
                >
                  {t('settings.saves.backup')}
                </button>
              </div>
              <input
                ref={importInput}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                aria-label={t('settings.saves.import')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setPendingImport(file);
                  event.target.value = '';
                }}
              />
              {pendingImport && (
                <div className="arcane-card" role="alert">
                  <p>{t('settings.saves.confirmImport')}</p>
                  <p className="muted">
                    {pendingImport.name} · {Math.ceil(pendingImport.size / 1024)} KB. O save atual
                    será preservado em um backup antes da importação.
                  </p>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      const file = pendingImport;
                      setPendingImport(null);
                      void props.onImportSave(file);
                    }}
                  >
                    {t('settings.characters.confirm')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setPendingImport(null)}
                  >
                    {t('settings.characters.cancel')}
                  </button>
                </div>
              )}
              <GameSelect
                id="backup-frequency"
                label={t('settings.saves.frequency')}
                value={props.settings.backup.frequency}
                options={frequencyOptions}
                onChange={(frequency) =>
                  props.updateSettings((current) => ({
                    ...current,
                    backup: {
                      ...current.backup,
                      frequency: frequency as DeviceSettings['backup']['frequency'],
                    },
                  }))
                }
              />
              <label>
                {t('settings.saves.retention')} · {props.settings.backup.retention}
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={props.settings.backup.retention}
                  onChange={(event) =>
                    props.updateSettings((current) => ({
                      ...current,
                      backup: { ...current.backup, retention: Number(event.target.value) },
                    }))
                  }
                />
              </label>
              <ul className="inventory-list" aria-label={t('settings.saves')}>
                {props.backups.map((backup) => (
                  <li key={backup.id}>
                    <span>
                      {new Date(backup.createdAt).toLocaleString('pt-BR')} · {backup.characterName}
                      {backup.automatic
                        ? ` · ${t('settings.backup.automatic')}`
                        : ` · ${t('settings.backup.manual')}`}
                    </span>
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => setPendingRestore(backup.id)}
                    >
                      {t('settings.saves.restore')}
                    </button>
                  </li>
                ))}
                {props.backups.length === 0 && (
                  <li className="empty-state">{t('settings.saves.empty')}</li>
                )}
              </ul>
              {pendingRestore && (
                <div className="arcane-card" role="alert">
                  <p>{t('settings.saves.confirmRestore')}</p>
                  <p className="muted">{t('settings.saves.backupFirst')}</p>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      const id = pendingRestore;
                      setPendingRestore(null);
                      void props.onRestoreBackup(id);
                    }}
                  >
                    {t('settings.characters.confirm')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setPendingRestore(null)}
                  >
                    {t('settings.characters.cancel')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onCreateBackup()}
                  >
                    {t('settings.saves.backup')}
                  </button>
                </div>
              )}
            </>
          )}

          {category === 'mods' && (
            <>
              <button
                className="primary-button"
                type="button"
                onClick={() => modInput.current?.click()}
              >
                {t('settings.mods.import')}
              </button>
              <input
                ref={modInput}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                aria-label={t('settings.mods.import')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void props.onImportMod(file);
                  event.target.value = '';
                }}
              />
              <div className="activity-grid">
                {props.mods.map((mod) => (
                  <article className="mod-card" key={mod.id}>
                    <strong>{mod.name}</strong>
                    <span className="muted">
                      v{mod.version}
                      {mod.author ? ` · ${mod.author}` : ''}
                    </span>
                    <span className="muted">
                      {t('settings.mods.origin')}: {mod.origin ?? 'local'}
                      {mod.compatibility
                        ? ` · ${t('settings.mods.compatibility')}: ${mod.compatibility}`
                        : ''}
                    </span>
                    <span className="status-caption">
                      {mod.loaded
                        ? t('settings.mods.status.loaded')
                        : mod.error
                          ? t('settings.mods.status.error')
                          : t('settings.mods.status.disabled')}
                    </span>
                    <span className="muted">
                      {t('settings.mods.dependencies')}:{' '}
                      {mod.dependencies.join(', ') || t('settings.mods.noDependencies')}
                    </span>
                    {mod.error && <p role="alert">{mod.error}</p>}
                    <Toggle
                      label={mod.enabled ? t('settings.mods.disable') : t('settings.mods.enable')}
                      checked={mod.enabled}
                      onToggle={() => props.onToggleMod(mod.id, !mod.enabled)}
                    />
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => props.onRemoveMod(mod.id)}
                    >
                      {t('settings.mods.remove')}
                    </button>
                  </article>
                ))}
                {props.mods.length === 0 && (
                  <p className="empty-state">{t('settings.mods.empty')}</p>
                )}
              </div>
            </>
          )}

          {category === 'development' && (
            <>
              <Toggle
                label={t('settings.dev.enabled')}
                checked={props.settings.developerMode}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    developerMode: !current.developerMode,
                  }))
                }
              />
              <Toggle
                label={t('settings.dev.verbose')}
                checked={props.settings.verboseLogs}
                onToggle={() =>
                  props.updateSettings((current) => ({
                    ...current,
                    verboseLogs: !current.verboseLogs,
                  }))
                }
              />
              {props.settings.developerMode && (
                <div className="action-grid">
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('xp')}
                  >
                    {t('settings.dev.addXp')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('resource')}
                  >
                    {t('settings.dev.addItem')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('advance')}
                  >
                    {t('settings.dev.advance')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('combat')}
                  >
                    {t('settings.dev.simulate')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('nodes')}
                  >
                    {t('settings.dev.unlockNodes')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('inspect')}
                  >
                    {t('settings.dev.inspect')}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void props.onDebugAction('validate-mods')}
                  >
                    {t('settings.dev.validateMods')}
                  </button>
                </div>
              )}
              {props.settings.verboseLogs && (
                <>
                  <div className="section-heading">
                    <h3>{t('settings.dev.logs')}</h3>
                    <div className="queue-actions">
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => void props.onCopyLogs()}
                      >
                        {t('settings.dev.copyLogs')}
                      </button>
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => void props.onExportLogs()}
                      >
                        {t('settings.dev.exportLogs')}
                      </button>
                    </div>
                  </div>
                  <div className="log-filters">
                    <GameSelect
                      id="debug-log-level"
                      label={t('settings.dev.logLevel')}
                      value={props.logLevel}
                      options={[
                        { value: 'error', label: t('settings.dev.level.error') },
                        { value: 'warn', label: t('settings.dev.level.warn') },
                        { value: 'info', label: t('settings.dev.level.info') },
                        { value: 'debug', label: t('settings.dev.level.debug') },
                        { value: 'trace', label: t('settings.dev.level.trace') },
                      ]}
                      onChange={(value) =>
                        props.onLogFilter(value as DebugLevel, props.logSubsystem)
                      }
                    />
                    <GameSelect
                      id="debug-log-subsystem"
                      label={t('settings.dev.subsystem')}
                      value={props.logSubsystem}
                      options={[
                        { value: 'all', label: t('settings.dev.subsystem.all') },
                        { value: 'app', label: t('settings.dev.subsystem.app') },
                        { value: 'sessions', label: t('settings.dev.subsystem.sessions') },
                        { value: 'combat', label: t('settings.dev.subsystem.combat') },
                        { value: 'persistence', label: t('settings.dev.subsystem.persistence') },
                        { value: 'mods', label: t('settings.dev.subsystem.mods') },
                        { value: 'nodes', label: t('settings.dev.subsystem.nodes') },
                        {
                          value: 'notifications',
                          label: t('settings.dev.subsystem.notifications'),
                        },
                      ]}
                      onChange={(value) =>
                        props.onLogFilter(props.logLevel, value as DebugSubsystem)
                      }
                    />
                  </div>
                  <label className="log-search">
                    {t('settings.dev.searchLogs')}
                    <input
                      type="search"
                      value={logSearch}
                      placeholder={t('settings.dev.searchLogsPlaceholder')}
                      onChange={(event) => setLogSearch(event.target.value)}
                    />
                  </label>
                  <pre className="combat-log">
                    {props.logs
                      .filter((entry) =>
                        entry.toLocaleLowerCase().includes(logSearch.trim().toLocaleLowerCase()),
                      )
                      .join('\n') || t('settings.dev.logsEmpty')}
                  </pre>
                </>
              )}
            </>
          )}

          {category === 'updates' && (
            <>
              <p className="muted">
                {t('settings.version.installed')}: {props.version} · {t('settings.version.build')}{' '}
                {props.build}
              </p>
              <GameSelect
                id="update-channel"
                label={t('settings.update.channel')}
                value={props.settings.updateChannel}
                options={channelOptions}
                onChange={(updateChannel) =>
                  props.updateSettings((current) => ({
                    ...current,
                    updateChannel: updateChannel as DeviceSettings['updateChannel'],
                  }))
                }
              />
              <button
                className="primary-button"
                type="button"
                onClick={() => void props.onCheckUpdates()}
              >
                {t('settings.updates.check')}
              </button>
              {props.updateMessage && <p role="status">{props.updateMessage}</p>}
              <button className="quiet-button" type="button" onClick={props.onOpenChangelog}>
                {t('settings.changelog.heading')}
              </button>
              {Object.entries(props.changelog).map(([version, entries]) => (
                <details key={version}>
                  <summary>v{version}</summary>
                  <ul>
                    {entries.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </>
          )}

          {category === 'about' && (
            <>
              <h3>{t('settings.about.title')}</h3>
              <p className="muted">
                {t('settings.version.installed')} {props.version} · {t('settings.version.build')}{' '}
                {props.build} · {t('settings.about.license')}
              </p>
              <div className="action-grid">
                <a
                  className="quiet-button"
                  href="https://github.com/SatoshoiDaemon/eternity-realms"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('settings.about.source')}
                </a>
                <a
                  className="quiet-button"
                  href="https://discord.gg/trrN92Hspu"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('settings.about.discord')}
                </a>
              </div>
              <details>
                <summary>{t('settings.about.thirdParty')}</summary>
                <p>{t('settings.about.creditsText')}</p>
              </details>
              <p>
                <a
                  href="https://github.com/SatoshoiDaemon/eternity-realms/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('settings.about.releases')}
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
