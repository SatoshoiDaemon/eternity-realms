import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createCharacter, createInitialGameState } from '../domain/model';
import type { GameState } from '../domain/types';
import type { NodeGraph } from '../nodes/graph';
import type { CombatActor, CombatState, CombatLogEntry } from '../combat/types';
import type { ExpeditionCombatRecord } from '../domain/types';
import { redoGraphHistory, undoGraphHistory } from '../nodes/graph-history';
import { PhaseTwoPanels } from './PhaseTwoPanels';
import { nodeCategoryName } from './phase-two-format';

vi.mock('../nodes/graph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../nodes/graph')>();
  return { ...actual, compileConstruction: vi.fn(actual.compileConstruction) };
});
import { compileConstruction } from '../nodes/graph';

const content = loadOfficialContent();

function chooseOption(label: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}
const graph: NodeGraph = {
  schemaVersion: 1,
  id: 'construction:arena-test',
  name: 'Golpe de teste',
  kind: 'ability',
  rootId: 'source',
  glyphIds: [],
  nodes: [
    { instanceId: 'source', definitionId: 'core:source-caster', children: ['type'] },
    { instanceId: 'type', definitionId: 'core:type-physical', children: ['form'] },
    { instanceId: 'form', definitionId: 'core:form-weapon-strike', children: ['effect'] },
    {
      instanceId: 'effect',
      definitionId: 'core:effect-damage',
      parameters: { amount: 30 },
      children: [],
    },
  ],
};

function game(overrides: { construction?: boolean; records?: boolean } = {}): GameState {
  const character = createCharacter({
    id: 'hero',
    name: 'Hero',
    raceId: 'human',
    classId: 'wanderer',
  });
  character.attributes.physical = {
    vigor: 10,
    resistance: 2,
    speed: 10,
    dexterity: 5,
    precision: 5,
    strength: 5,
  };
  character.nodeLibrary = {
    schemaVersion: 1,
    unlockedNodeIds: [
      'core:source-caster',
      'core:type-physical',
      'core:form-weapon-strike',
      'core:effect-damage',
    ],
    constructions: overrides.construction
      ? [{ id: graph.id, graph, equipped: false, updatedAt: 1 }]
      : [],
  };
  character.inventory = { 'material-iron': 4, 'material-silver': 2 };
  const state = { ...createInitialGameState(), character };
  if (overrides.records) state.combatRecords = [];
  return state;
}

describe('phase two gameplay panels', () => {
  it('retains unknown node categories from mod content', () => {
    expect(nodeCategoryName('mod:astral')).toBe('mod:astral');
  });

  it('keeps graph history transitions idempotent and moves both stacks', () => {
    const history = { past: [] as NodeGraph[], future: [] as NodeGraph[] };
    expect(undoGraphHistory(history, graph)).toEqual({ graph, history, versionDelta: 0 });
    expect(redoGraphHistory(history, graph)).toEqual({ graph, history, versionDelta: 0 });

    const previous = { ...graph, name: 'Anterior' };
    const next = undoGraphHistory({ past: [previous], future: [] }, graph);
    expect(next).toEqual({
      graph: previous,
      history: { past: [], future: [graph] },
      versionDelta: 1,
    });
    expect(redoGraphHistory(next.history, next.graph)).toEqual({
      graph,
      history: { past: [previous], future: [] },
      versionDelta: 1,
    });
  });

  it('supports graph undo and redo and surfaces persistence errors from the node editor', async () => {
    render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        clock={() => 25}
        updateCharacter={vi.fn().mockRejectedValue(new Error('Falha ao persistir construção.'))}
      />,
    );
    const name = screen.getByLabelText('Nome da construção');
    fireEvent.change(name, { target: { value: 'Construção revisada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer alteração' }));
    expect(screen.getByLabelText('Nome da construção')).toHaveValue('Nova construção');
    fireEvent.click(screen.getByRole('button', { name: 'Refazer alteração' }));
    expect(screen.getByLabelText('Nome da construção')).toHaveValue('Construção revisada');
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar grafo' }));
    expect(await screen.findByText('Falha ao persistir construção.')).toBeInTheDocument();
  });

  it('shows the expedition roster, enemy tag counterplay, and material forge', () => {
    render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Expedições' })).toBeInTheDocument();
    expect(screen.getAllByText(/contrajogo:/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Forja e builds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fabricar equipamento' })).toBeInTheDocument();
  });

  it('validates and persists a construction graph through the player library', async () => {
    const updateCharacter = vi.fn(
      async (
        update: (
          character: ReturnType<typeof createCharacter>,
        ) => ReturnType<typeof createCharacter>,
      ) => {
        expect(update(game().character!)).toMatchObject({
          nodeLibrary: { constructions: [expect.objectContaining({ id: graph.id })] },
        });
      },
    );
    render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        clock={() => 25}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Identificador'), { target: { value: graph.id } });
    fireEvent.change(screen.getByLabelText('Nome da construção'), {
      target: { value: graph.name },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar grafo' }));
    await waitFor(() => expect(updateCharacter).toHaveBeenCalledOnce());
    expect(await screen.findByText('Alterações salvas.')).toBeInTheDocument();
  });

  it('runs a saved construction against an enemy using the shared combat engine', async () => {
    render(
      <PhaseTwoPanels
        state={game({ construction: true })}
        content={content}
        clock={() => 1234}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
        view="arena"
      />,
    );
    chooseOption('Construção salva para teste', 'Golpe de teste (construction:arena-test)');
    fireEvent.click(screen.getByRole('button', { name: 'Executar simulação' }));
    await waitFor(() =>
      expect(screen.getByText(/Simulação de 30 segundos concluída/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Tempo virtual:/)).toBeInTheDocument();
    expect(screen.getAllByText(/s —/).length).toBeGreaterThan(0);
  });

  it('forges, equips, replaces and removes real inventory gear through the panel', async () => {
    let current = game();
    const updateCharacter = vi.fn(
      async (
        update: (
          character: ReturnType<typeof createCharacter>,
        ) => ReturnType<typeof createCharacter>,
      ) => {
        current = { ...current, character: update(current.character!) };
      },
    );
    const view = render(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 10}
        updateCharacter={updateCharacter}
      />,
    );
    chooseOption('Receita', /Forjar malho de ferro/);
    fireEvent.click(screen.getByRole('button', { name: 'Fabricar equipamento' }));
    expect(await screen.findByText('Alterações salvas.')).toBeInTheDocument();
    expect(current.character?.inventory['gear:iron-maul']).toBe(1);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 11}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Equipar' }));
    expect(current.character?.equipment.primary).toBe('gear:iron-maul');
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 12}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retirar' }));
    expect(current.character?.equipment.primary).toBeNull();
    expect(current.character?.inventory['gear:iron-maul']).toBe(1);
    expect(updateCharacter).toHaveBeenCalledTimes(3);
  });

  it('drives touch, search, filter, zoom, node add/remove, parameter and glyph controls', () => {
    const unlockedState = game();
    unlockedState.character!.nodeLibrary!.unlockedNodeIds = content.nodes.map((node) => node.id);
    const { container } = render(
      <PhaseTwoPanels
        state={unlockedState}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const undo = screen.getByRole('button', { name: 'Desfazer alteração' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Refazer alteração' }) as HTMLButtonElement;
    undo.disabled = false;
    redo.disabled = false;
    act(() => {
      undo.click();
      redo.click();
    });
    fireEvent.change(screen.getByLabelText('Buscar nós'), { target: { value: 'dano' } });
    chooseOption('Filtrar categoria', 'Efeito');
    chooseOption('Catálogo de nós', '◆ Efeito · Dano');
    chooseOption('Conectar a', 'Golpe (form)');
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar nó' }));
    const addedNode = [...container.querySelectorAll<HTMLButtonElement>('.graph-node')].find(
      (node) => node.textContent?.includes('effect-damage-5'),
    )!;
    fireEvent.change(screen.getByLabelText('Quantidade', { exact: true }), {
      target: { value: '75' },
    });
    fireEvent.change(screen.getAllByLabelText('Dano · quantidade')[0]!, {
      target: { value: '33' },
    });
    const canvas = screen.getByLabelText('Canvas do grafo de nós');
    fireEvent.dragOver(canvas);
    const transfer = { getData: () => 'core:effect-damage' };
    fireEvent.drop(canvas, { dataTransfer: { getData: () => 'missing:definition' } });
    fireEvent.drop(canvas, { dataTransfer: { getData: () => '' } });
    fireEvent.drop(canvas, { dataTransfer: transfer });
    const rootNode = container.querySelector<HTMLButtonElement>('.graph-node')!;
    fireEvent.click(rootNode);
    fireEvent.dragOver(rootNode);
    fireEvent.drop(rootNode, { dataTransfer: { getData: () => '' } });
    fireEvent.drop(rootNode, { dataTransfer: transfer });
    fireEvent.click(addedNode.querySelector('[role="presentation"]')!);
    const catalogButton = screen.getByRole('button', { name: 'Adicionar e conectar nó' });
    fireEvent.dragStart(catalogButton, { dataTransfer: { setData: vi.fn() } });
    if (content.glyphs[0]) chooseOption('Glifo', content.glyphs[0].name);
    chooseOption('Glifo', 'Nenhum');
    if (content.sigils[0]) chooseOption('Sigilo', content.sigils[0].name);
    chooseOption('Sigilo', 'Nenhum');
    chooseOption('Tipo', 'Habilidade');
    expect(container.querySelector('.graph-nodes')).toHaveStyle({ transform: 'scale(1)' });
  });

  it('removes the selected graph node from the inspector', () => {
    const { container } = render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
        view="nodes"
      />,
    );
    expect(container.querySelectorAll('.graph-node')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Remover nó selecionado' }));
    expect(container.querySelectorAll('.graph-node')).toHaveLength(3);
  });

  it('handles an empty recipe list and missing graph connections in saved builds', () => {
    const emptyRecipes = { ...content, recipes: new Map() };
    const state = game({ construction: true });
    const saved = state.character!.nodeLibrary!.constructions[0]!;
    saved.graph = {
      ...saved.graph,
      nodes: saved.graph.nodes.map((node) =>
        node.instanceId === 'form' ? { ...node, children: ['missing-child'] } : node,
      ),
    };
    const view = render(
      <PhaseTwoPanels
        state={state}
        content={emptyRecipes}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
        view="forge"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Forja e builds' })).toBeInTheDocument();
    view.rerender(
      <PhaseTwoPanels
        state={state}
        content={emptyRecipes}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
        view="nodes"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar selecionada' }));
    expect(document.querySelectorAll('.graph-connections path')).toHaveLength(2);
  });

  it('reports invalid or locked graphs and handles storage errors outside Error objects', async () => {
    const updateCharacter = vi.fn(async () => {
      throw 'storage unavailable';
    });
    const view = render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        clock={() => 10}
        updateCharacter={updateCharacter as never}
      />,
    );
    fireEvent.change(screen.getByLabelText('Nome da construção'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar grafo' }));
    expect(screen.getByRole('status')).toHaveTextContent('Node graph id and name cannot be empty.');
    const locked = game();
    locked.character!.nodeLibrary!.unlockedNodeIds = [];
    view.rerender(
      <PhaseTwoPanels
        state={locked}
        content={content}
        clock={() => 10}
        updateCharacter={updateCharacter as never}
      />,
    );
    fireEvent.change(screen.getByLabelText('Nome da construção'), {
      target: { value: 'Locked graph' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar grafo' }));
    expect(screen.getByRole('status')).toHaveTextContent('Desbloqueie em Dungeons/Raids');
    fireEvent.click(screen.getByRole('button', { name: 'Fabricar equipamento' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível salvar.');
  });

  it('duplicates, equips, edits, tests, and unequips saved builds through the editor', async () => {
    let current = game({ construction: true });
    const updateCharacter = vi.fn(
      async (
        update: (
          character: ReturnType<typeof createCharacter>,
        ) => ReturnType<typeof createCharacter>,
      ) => {
        current = { ...current, character: update(current.character!) };
      },
    );
    const view = render(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 1234}
        updateCharacter={updateCharacter}
      />,
    );
    chooseOption('Construções salvas', 'Golpe de teste (construction:arena-test)');
    fireEvent.change(screen.getByLabelText('ID da cópia'), {
      target: { value: 'construction:copy-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await screen.findByText('Alterações salvas.');
    expect(current.character?.nodeLibrary?.constructions).toHaveLength(2);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 1235}
        updateCharacter={updateCharacter}
      />,
    );
    chooseOption('Construções salvas', 'Golpe de teste (construction:arena-test)');
    fireEvent.click(screen.getByRole('button', { name: 'Equipar build' }));
    expect(current.character?.abilities).toContain(graph.id);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 1236}
        updateCharacter={updateCharacter}
      />,
    );
    chooseOption('Construções salvas', 'Golpe de teste (construction:arena-test)');
    fireEvent.click(screen.getByRole('button', { name: 'Editar selecionada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desequipar' }));
    expect(current.character?.abilities).not.toContain(graph.id);
    const arenaContent = {
      ...content,
      nodes: content.nodes.map((node) =>
        node.id === 'core:effect-damage'
          ? { ...node, operation: { ...node.operation!, subtype: 'crushing' as const } }
          : node,
      ),
    };
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={arenaContent}
        clock={() => 1237}
        updateCharacter={updateCharacter}
      />,
    );
    chooseOption('Construções salvas', 'Golpe de teste (construction:arena-test)');
    chooseOption('Examinar criatura', 'Espectro do Eco');
    fireEvent.click(screen.getByRole('button', { name: 'Executar simulação' }));
    expect(await screen.findByText(/Simulação de 30 segundos concluída/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver log detalhado' }));
    expect(screen.getByRole('button', { name: 'Resumo' })).toBeInTheDocument();
    expect(screen.getByText(/base:ethereal/)).toBeInTheDocument();
    const durableEnemy = {
      ...content.enemies.get('core:quarry-stalker')!,
      id: 'mod:training-dummy',
      name: 'Training Dummy',
      hp: { current: 10_000_000, maximum: 10_000_000 },
      tenacity: { current: 10_000_000, maximum: 10_000_000 },
      tags: [],
      actions: [],
    };
    const arenaEnemies = new Map(content.enemies);
    arenaEnemies.set(durableEnemy.id, durableEnemy);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={{ ...arenaContent, enemies: arenaEnemies }}
        clock={() => 1238}
        updateCharacter={updateCharacter}
      />,
    );
    chooseOption('Examinar criatura', 'Training Dummy');
    fireEvent.click(screen.getByRole('button', { name: 'Executar simulação' }));
    expect(screen.getByText(/vencedor: não decidido/)).toBeInTheDocument();
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={{ ...content, enemies: new Map() }}
        clock={() => 1238}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Executar simulação' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Selecione uma construção salva e um inimigo.',
    );
  });

  it('changes the equipped-build priority from the combat loadout controls', async () => {
    let current = game({ construction: true });
    const secondGraph = { ...graph, id: 'construction:priority-two', name: 'Descarga' };
    current.character!.nodeLibrary!.constructions = [
      { id: graph.id, graph, equipped: true, updatedAt: 1 },
      { id: secondGraph.id, graph: secondGraph, equipped: true, updatedAt: 2 },
    ];
    current.character!.nodeLibrary!.actionPriority = [graph.id, secondGraph.id];
    current.character!.abilities = [graph.id, secondGraph.id];
    const updateCharacter = vi.fn(
      async (
        update: (
          character: ReturnType<typeof createCharacter>,
        ) => ReturnType<typeof createCharacter>,
      ) => {
        current = { ...current, character: update(current.character!) };
      },
    );
    const view = render(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 40}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Despriorizar Golpe de teste' }));
    await screen.findByText('Alterações salvas.');
    expect(current.character?.nodeLibrary?.actionPriority).toEqual([secondGraph.id, graph.id]);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        clock={() => 41}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Priorizar Golpe de teste' }));
    await waitFor(() =>
      expect(current.character?.nodeLibrary?.actionPriority).toEqual([graph.id, secondGraph.id]),
    );
  });

  it('displays saved expedition combat details and toggles their full records', () => {
    const logEntry: CombatLogEntry = {
      id: 'combat:event:1',
      timeMs: 1000,
      kind: 'attack',
      actorId: 'hero',
      targetId: 'enemy',
      actionId: 'strike',
      hit: true,
      evaded: false,
      blocked: false,
      damageInitial: 10,
      damageFinal: 8,
      modifiers: [{ id: 'armor', source: 'gear', stage: 'defense', value: 0.2 }],
      tagInteractions: [
        {
          tagId: 'base:armored',
          ruleId: 'base:armored:cut',
          interactionId: 'cut',
          reason: 'resisted',
        },
      ],
      hpChange: { before: 20, after: 12 },
      actorHpChange: { before: 10, after: 11 },
      tenacityChange: { before: 2, after: 0 },
      resourceChanges: [],
      effectsApplied: ['poison'],
      killed: false,
      message: 'Hero hits enemy',
    };
    const receivedEntry: CombatLogEntry = {
      ...logEntry,
      id: 'combat:event:2',
      actorId: 'enemy',
      targetId: 'hero',
      damageFinal: 3,
      message: 'enemy hits Hero',
    };
    const combat: CombatState = {
      id: 'combat:one',
      seed: 3,
      rngState: 3,
      nowMs: 1000,
      actors: [{ id: 'hero', side: 'party' } as CombatActor],
      log: [logEntry, receivedEntry],
      nextEventNumber: 2,
      environment: {},
    };
    const record: ExpeditionCombatRecord = {
      id: 'session:one',
      sessionId: 'session:one',
      expeditionId: 'core:lost-foundry',
      seed: 3,
      kills: 1,
      deaths: 0,
      experience: 5,
      drops: [{ rewardId: 'r1', itemId: 'material-iron', quantity: 2, sourceTableId: 'core:loot' }],
      unlockedNodeIds: ['core:source-caster'],
      virtualDurationMs: 60_000,
      combats: [combat],
      completedAt: 100,
    };
    const history = game();
    history.combatRecords = [record];
    render(
      <PhaseTwoPanels
        state={history}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByText(/Fundição Perdida · 1 inimigos derrotados/));
    expect(screen.getByText(/Dano causado: 8 · Dano recebido: 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Confronto 1 · 2 eventos/));
    expect(screen.getByText(/1\.0s — Hero hits enemy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exibir detalhes técnicos' }));
    expect(screen.getByText(/"damageFinal": 8/)).toBeInTheDocument();
    expect(screen.getByText(/ID do registro: session:one/)).toBeInTheDocument();
  });

  it('shows both compile error forms from graph saving and the arena', () => {
    const compile = vi.mocked(compileConstruction);
    const implementation = compile.getMockImplementation()!;
    const unlocked = game();
    unlocked.character!.nodeLibrary!.unlockedNodeIds = content.nodes.map((node) => node.id);
    const view = render(
      <PhaseTwoPanels
        state={unlocked}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    compile.mockImplementationOnce(() => {
      throw new Error('compiler error');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar grafo' }));
    expect(screen.getByRole('status')).toHaveTextContent('compiler error');
    compile.mockImplementationOnce(() => {
      throw 'compiler unavailable';
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar grafo' }));
    expect(screen.getByRole('status')).toHaveTextContent('Construção inválida.');

    const saved = game({ construction: true });
    view.rerender(
      <PhaseTwoPanels
        state={saved}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    chooseOption('Construções salvas', 'Golpe de teste (construction:arena-test)');
    compile.mockImplementationOnce(() => {
      throw 'arena unavailable';
    });
    fireEvent.click(screen.getByRole('button', { name: 'Executar simulação' }));
    expect(screen.getByRole('status')).toHaveTextContent('Falha na arena.');
    compile.mockImplementation(implementation);
  });

  it('handles unknown catalog definitions and missing optional state', () => {
    const state = game();
    state.character!.nodeLibrary = undefined;
    const view = render(
      <PhaseTwoPanels
        state={state}
        content={{ ...content, nodes: [] }}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText('0 nós desbloqueados')).toBeInTheDocument();
    expect(screen.getByText(/source-caster/)).toBeInTheDocument();
    expect(screen.getByText('Ainda não há expedições concluídas com combate.')).toBeInTheDocument();
    view.rerender(
      <PhaseTwoPanels
        state={state}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    chooseOption('Examinar criatura', 'Soberano das Cinzas · Chefe');
    expect(
      screen.getByRole('combobox', { name: 'Examinar criatura: Soberano das Cinzas · Chefe' }),
    ).toBeInTheDocument();
  });

  it('renders modded bestiary and equipment fallbacks and old combat history shapes', () => {
    const state = game();
    state.character!.equipment.primary = 'missing:weapon';
    const enemy = {
      ...content.enemies.get('core:quarry-stalker')!,
      id: 'mod:elite-stalker',
      name: 'Elite Stalker',
      tags: ['mod:missing-tag'],
      attributes: { ...content.enemies.get('core:quarry-stalker')!.attributes, custom: 4 },
      actions: [],
      lootTableId: undefined,
      elite: true,
      boss: false,
    };
    const enemies = new Map(content.enemies);
    enemies.set(enemy.id, enemy);
    const conditionalEnemy = {
      ...enemy,
      id: 'mod:conditional-stalker',
      name: 'Conditional Stalker',
      lootTableId: 'mod:conditional-loot',
    };
    enemies.set(conditionalEnemy.id, conditionalEnemy);
    const lootTables = new Map(content.lootTables);
    const conditionalLoot = content.lootTables.get('core:construct-drops')!;
    lootTables.set('mod:conditional-loot', {
      ...conditionalLoot,
      id: 'mod:conditional-loot',
      guaranteed: undefined,
      independent: undefined,
      exclusive: undefined,
      conditional: [
        ...(conditionalLoot.conditional ?? []),
        { id: 'missing-drop', when: [], drops: [{ itemId: 'missing:component', quantity: 2 }] },
      ],
    } as NonNullable<ReturnType<typeof content.lootTables.get>>);
    const recipe = {
      ...content.recipes.values().next().value!,
      id: 'mod:unknown-input',
      inputs: { 'missing:material': 2 },
    };
    const recipes = new Map(content.recipes);
    recipes.set(recipe.id, recipe);
    const customContent = { ...content, enemies, recipes, lootTables };
    const first: ExpeditionCombatRecord = {
      id: 'combat:old-item',
      sessionId: 'combat:old-item',
      expeditionId: 'mod:old',
      seed: 1,
      kills: 0,
      deaths: 0,
      experience: 0,
      drops: [
        {
          rewardId: 'drop:unknown',
          itemId: 'missing:relic',
          quantity: 2,
          sourceTableId: 'mod:loot',
        },
      ],
      unlockedNodeIds: [],
      virtualDurationMs: 0,
      combats: [],
      completedAt: 1,
    };
    const second = { ...first, id: 'combat:no-drops', sessionId: 'combat:no-drops', drops: [] };
    state.combatRecords = [first, second];
    render(
      <PhaseTwoPanels
        state={state}
        content={customContent}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByText('Detalhes da criatura'));
    expect(screen.getByText('Habilidades conhecidas')).toBeInTheDocument();
    expect(screen.getByText('Salto de emboscada')).toBeInTheDocument();
    expect(screen.getByText('Espólios conhecidos')).toBeInTheDocument();
    expect(screen.getByText('Ferro ×1')).toBeInTheDocument();
    expect(screen.getByText('Locais de encontro')).toBeInTheDocument();
    expect(screen.getAllByText('Fundição Perdida').length).toBeGreaterThan(1);
    chooseOption('Examinar criatura', 'Elite Stalker · Elite');
    expect(
      screen.getByRole('combobox', { name: 'Examinar criatura: Elite Stalker · Elite' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/mod:missing-tag/)).toBeInTheDocument();
    if (!(screen.getByText('Detalhes da criatura').closest('details') as HTMLDetailsElement).open) {
      fireEvent.click(screen.getByText('Detalhes da criatura'));
    }
    expect(screen.getByText('Mitigação física: 5%')).toBeInTheDocument();
    expect(screen.getByText('Habilidades conhecidas')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma habilidade registrada.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum item conhecido.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum local conhecido.')).toBeInTheDocument();
    expect(screen.getByText('Arma primária: missing:weapon')).toBeInTheDocument();
    chooseOption('Examinar criatura', 'Conditional Stalker · Elite');
    expect(screen.getByText('Adamantita ×1')).toBeInTheDocument();
    expect(screen.getByText('missing:component ×2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: /^Receita:/ }));
    expect(screen.getByRole('option', { name: /missing:material ×2/ })).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/mod:old · 0 inimigos derrotados/)[0]!);
    expect(screen.getByText(/missing:relic ×2/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/mod:old · 0 inimigos derrotados/)[0]!);
    fireEvent.click(screen.getAllByText(/mod:old · 0 inimigos derrotados/)[1]!);
    expect(screen.getByText(/sem drops/)).toBeInTheDocument();

    const legacy = game();
    legacy.combatRecords = undefined as unknown as GameState['combatRecords'];
    const emptyEnemyView = render(
      <PhaseTwoPanels
        state={legacy}
        content={{ ...content, enemies: new Map() }}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText('Ainda não há expedições concluídas com combate.')).toBeInTheDocument();
    expect(emptyEnemyView.container.querySelector('.codex-card')).toBeNull();
    emptyEnemyView.unmount();
  });

  it('does not overwrite the graph if a selected construction disappears', () => {
    const state = game({ construction: true });
    const view = render(
      <PhaseTwoPanels
        state={state}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    chooseOption('Construções salvas', 'Golpe de teste (construction:arena-test)');
    const stale = game();
    view.rerender(
      <PhaseTwoPanels
        state={stale}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar selecionada' }));
    expect(screen.getByLabelText('Nome da construção')).toHaveValue('Nova construção');
  });

  it('draws graph connections and supports undo and redo in the node editor', () => {
    const state = game();
    state.character!.nodeLibrary!.unlockedNodeIds = content.nodes.map((node) => node.id);
    const { container } = render(
      <PhaseTwoPanels
        state={state}
        content={content}
        clock={() => 10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
        view="nodes"
      />,
    );
    expect(container.querySelectorAll('.graph-connections path')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar nó' }));
    expect(container.querySelectorAll('.graph-node')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer alteração' }));
    expect(container.querySelectorAll('.graph-node')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Refazer alteração' }));
    expect(container.querySelectorAll('.graph-node')).toHaveLength(5);
    expect(
      screen.getByRole('region', { name: 'Propriedades do nó selecionado' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome da construção'), { target: { value: 'Ruptura' } });
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer alteração' }));
    expect(screen.getByLabelText('Nome da construção')).toHaveValue('Nova construção');
  });
});
