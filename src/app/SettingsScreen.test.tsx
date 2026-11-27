import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultDeviceSettings, type DeviceSettings } from './device-settings';
import {
  SettingsScreen,
  type BackupSummary,
  type DebugAction,
  type DebugLevel,
  type DebugSubsystem,
  type InstalledModSummary,
} from './SettingsScreen';

const backupItems: BackupSummary[] = [
  { id: 'auto-1', createdAt: 10, characterName: 'Aria', automatic: true },
  { id: 'manual-1', createdAt: 9, characterName: 'Aria', automatic: false },
];
const modItems: InstalledModSummary[] = [
  {
    id: 'loaded',
    name: 'Loaded',
    version: '1.0.0',
    author: 'Krieg',
    compatibility: '0.1.0',
    origin: 'local',
    dependencies: ['eternity.core'],
    enabled: true,
    loaded: true,
  },
  {
    id: 'failed',
    name: 'Failed',
    version: '2.0.0',
    dependencies: [],
    enabled: false,
    loaded: false,
    error: 'Missing dependency.',
  },
];

function renderSettings(
  options: {
    settings?: DeviceSettings;
    characters?: Array<{ id: string; name: string; level: number; active: boolean }>;
    backups?: BackupSummary[];
    mods?: InstalledModSummary[];
    logs?: string[];
    updateMessage?: string;
  } = {},
) {
  const actions = {
    back: vi.fn(),
    createCharacter: vi.fn(async () => undefined),
    switchCharacter: vi.fn(async () => undefined),
    resetCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
    exportSave: vi.fn(async () => undefined),
    createBackup: vi.fn(async () => undefined),
    restoreBackup: vi.fn(async () => undefined),
    importSave: vi.fn(async () => undefined),
    importMod: vi.fn(async () => undefined),
    toggleMod: vi.fn(),
    removeMod: vi.fn(),
    permission: vi.fn(async () => undefined),
    checkUpdates: vi.fn(async () => undefined),
    debug: vi.fn(async (action: DebugAction) => {
      void action;
    }),
    logFilter: vi.fn((level: DebugLevel, subsystem: DebugSubsystem) => {
      void [level, subsystem];
    }),
    copyLogs: vi.fn(async () => undefined),
    exportLogs: vi.fn(async () => undefined),
    openChangelog: vi.fn(),
  };
  function Harness() {
    const [settings, setSettings] = useState(options.settings ?? defaultDeviceSettings);
    return (
      <SettingsScreen
        settings={settings}
        updateSettings={(update) => setSettings((current) => update(current))}
        version="0.1.0"
        build="test"
        characters={options.characters ?? []}
        backups={options.backups ?? []}
        mods={options.mods ?? []}
        logs={options.logs ?? []}
        logLevel="trace"
        logSubsystem="all"
        updateMessage={options.updateMessage ?? ''}
        onBack={actions.back}
        onCreateCharacter={actions.createCharacter}
        onSwitchCharacter={actions.switchCharacter}
        onResetCharacter={actions.resetCharacter}
        onDeleteCharacter={actions.deleteCharacter}
        onExportSave={actions.exportSave}
        onCreateBackup={actions.createBackup}
        onRestoreBackup={actions.restoreBackup}
        onImportSave={actions.importSave}
        onImportMod={actions.importMod}
        onToggleMod={actions.toggleMod}
        onRemoveMod={actions.removeMod}
        onNotificationPermission={actions.permission}
        onCheckUpdates={actions.checkUpdates}
        onDebugAction={actions.debug}
        onLogFilter={actions.logFilter}
        onCopyLogs={actions.copyLogs}
        onExportLogs={actions.exportLogs}
        changelog={{ '0.1.0': ['Nova navegação', 'Backup local'] }}
        onOpenChangelog={actions.openChangelog}
      />
    );
  }
  const view = render(<Harness />);
  return { ...view, actions };
}

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

function category(name: string) {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Configurações' })).getByRole('button', { name }),
  );
}

describe('settings center', () => {
  it('changes themes, accessibility, language and visual intensity through local controls', () => {
    const { actions } = renderSettings();
    const catppuccinSwatches = screen
      .getByRole('button', { name: 'Catppuccin Mocha' })
      .querySelectorAll('.theme-swatch > span');
    const tokyoSwatches = screen
      .getByRole('button', { name: 'Tokyo Night' })
      .querySelectorAll('.theme-swatch > span');
    expect(catppuccinSwatches[1]?.getAttribute('style')).not.toBe(
      tokyoSwatches[1]?.getAttribute('style'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tokyo Night' }));
    expect(screen.getByRole('button', { name: 'Tokyo Night' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Monochrome' }));
    fireEvent.change(screen.getByLabelText(/Tamanho da fonte/), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/Intensidade dos efeitos visuais/), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Movimento reduzido' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Movimento reduzido' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Desativar animações' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Desativar animações' }));
    choose('Idioma', 'Português brasileiro');
    expect(actions.back).not.toHaveBeenCalled();
    category('Aparência e idioma');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao jogo' }));
    expect(actions.back).toHaveBeenCalledOnce();
  });

  it('toggles each notification preference and requests platform permission', () => {
    const { actions } = renderSettings();
    category('Notificações');
    for (const name of ['Conclusão de sessões', 'Fila ociosa', 'Recompensas', 'Missões']) {
      fireEvent.click(screen.getByRole('switch', { name }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Ativar notificações no Android' }));
    expect(actions.permission).toHaveBeenCalledOnce();
  });

  it('creates and switches characters and confirms destructive actions explicitly', () => {
    const { actions } = renderSettings({
      characters: [
        { id: 'aria', name: 'Aria', level: 4, active: true },
        { id: 'luna', name: 'Luna', level: 2, active: false },
      ],
    });
    category('Personagens');
    expect(screen.getByText('Nível 4 · atual')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar personagem' }));
    expect(actions.switchCharacter).toHaveBeenCalledWith('luna');
    fireEvent.change(screen.getByLabelText('Criar outro personagem'), { target: { value: 'Nyx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar outro personagem' }));
    expect(actions.createCharacter).toHaveBeenCalledWith('Nyx');

    fireEvent.click(screen.getByRole('button', { name: 'Redefinir progresso' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O progresso deste personagem será redefinido.',
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Criar backup agora' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar operação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir personagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    expect(actions.deleteCharacter).toHaveBeenCalledOnce();
    expect(actions.resetCharacter).not.toHaveBeenCalled();
  });

  it('exports, imports, restores, and configures backup retention with confirmation steps', () => {
    const { actions } = renderSettings({ backups: backupItems });
    category('Saves e backups');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar save' }));
    const pickerClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Importar save' }));
    expect(pickerClick).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Criar backup agora' }));
    fireEvent.change(screen.getByLabelText('Importar save'), { target: { files: [] } });
    const save = new File(['{}'], 'save.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Importar save'), { target: { files: [save] } });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Importar este save e substituir a jornada atual?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar operação' }));
    fireEvent.change(screen.getByLabelText('Importar save'), { target: { files: [save] } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    expect(actions.importSave).toHaveBeenCalledWith(save);
    choose('Frequência automática', 'Semanal');
    fireEvent.change(screen.getByLabelText(/Backups mantidos/), { target: { value: '12' } });
    expect(screen.getByText(/automático/)).toBeInTheDocument();
    expect(screen.getByText(/manual/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Restaurar backup' })[0]!);
    fireEvent.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Criar backup agora' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar operação' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Restaurar backup' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    expect(actions.restoreBackup).toHaveBeenCalledWith('manual-1');
    expect(actions.createBackup).toHaveBeenCalledTimes(2);
  });

  it('shows loading states and errors for mods and exposes enable, disable, import and remove', () => {
    const { actions } = renderSettings({ mods: modItems });
    category('Mods');
    expect(screen.getByText('Carregado')).toBeInTheDocument();
    expect(screen.getByText('Com erro')).toBeInTheDocument();
    expect(screen.getByText('Missing dependency.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Desabilitar mod' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar mod' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover mod' })[0]!);
    const pickerClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Importar mod local' }));
    expect(pickerClick).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Importar mod local'), { target: { files: [] } });
    expect(actions.toggleMod).toHaveBeenNthCalledWith(1, 'loaded', false);
    expect(actions.toggleMod).toHaveBeenNthCalledWith(2, 'failed', true);
    expect(actions.removeMod).toHaveBeenCalledWith('loaded');
  });

  it('exposes independent verbose logs, debug actions, filters and log export', () => {
    const { actions } = renderSettings({ logs: ['[debug] session:1', '[debug] combat:2'] });
    category('Desenvolvimento e debug');
    fireEvent.click(screen.getByRole('switch', { name: 'Habilitar logs verbosos' }));
    expect(screen.getByRole('heading', { name: 'Logs do jogo' })).toBeInTheDocument();
    expect(document.querySelector('.combat-log')).toHaveTextContent('[debug] session:1');
    fireEvent.change(screen.getByLabelText('Buscar nos logs'), {
      target: { value: 'combat' },
    });
    expect(document.querySelector('.combat-log')).toHaveTextContent('[debug] combat:2');
    expect(document.querySelector('.combat-log')).not.toHaveTextContent('[debug] session:1');
    fireEvent.change(screen.getByLabelText('Buscar nos logs'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar logs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar logs' }));
    choose('Nível mínimo', 'Depuração');
    choose('Subsistema', 'Sessões');
    fireEvent.click(screen.getByRole('switch', { name: 'Modo de desenvolvimento' }));
    for (const name of [
      'Conceder 100 XP',
      'Adicionar recurso de teste',
      'Avançar tempo virtual',
      'Simular combate',
      'Desbloquear nós carregados',
      'Inspecionar estado e RNG',
      'Validar mods carregados',
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(actions.debug.mock.calls.map(([action]) => action)).toEqual([
      'xp',
      'resource',
      'advance',
      'combat',
      'nodes',
      'inspect',
      'validate-mods',
    ]);
    expect(actions.logFilter).toHaveBeenNthCalledWith(1, 'debug', 'all');
    expect(actions.logFilter).toHaveBeenNthCalledWith(2, 'trace', 'sessions');
    expect(actions.copyLogs).toHaveBeenCalledOnce();
    expect(actions.exportLogs).toHaveBeenCalledOnce();
  });

  it('shows update checks, the changelog and institutional links', () => {
    const { actions } = renderSettings({
      updateMessage: 'Você está usando a versão mais recente.',
    });
    category('Novidades e atualizações');
    choose('Canal de atualizações', 'Prévia');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }));
    fireEvent.click(screen.getByRole('button', { name: 'Novidades' }));
    expect(screen.getByText('Nova navegação')).toBeInTheDocument();
    expect(actions.checkUpdates).toHaveBeenCalledOnce();
    expect(actions.openChangelog).toHaveBeenCalledOnce();
    category('Sobre');
    expect(screen.getByRole('heading', { name: 'Eternity Realms — by Krieg' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Código-fonte' })).toHaveAttribute(
      'href',
      'https://github.com/SatoshoiDaemon/eternity-realms',
    );
    expect(screen.getByRole('link', { name: 'Discord oficial' })).toHaveAttribute(
      'href',
      'https://discord.gg/trrN92Hspu',
    );
    fireEvent.click(screen.getByText('Créditos e licenças de terceiros'));
    expect(screen.getByText(/React, Vite, Capacitor/)).toBeInTheDocument();
  });
});
