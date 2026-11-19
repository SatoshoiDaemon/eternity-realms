import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { loadOfficialContent } from '../content/registry';
import { createCharacter, createInitialGameState } from '../domain/model';
import type { GameState } from '../domain/types';
import type { NodeGraph } from '../nodes/graph';
import type { CombatState, CombatLogEntry } from '../combat/types';
import type { ExpeditionCombatRecord } from '../domain/types';
import { PhaseTwoPanels } from './PhaseTwoPanels';

vi.mock('../nodes/graph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../nodes/graph')>();
  return { ...actual, compileConstruction: vi.fn(actual.compileConstruction) };
});
import { compileConstruction } from '../nodes/graph';

const content = loadOfficialContent();
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
  it('shows the expedition roster, enemy tag counterplay, and material forge', () => {
    render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Expedições e bestiário' })).toBeInTheDocument();
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
        now={25}
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
        now={1234}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
    fireEvent.change(screen.getByLabelText('Examinar criatura'), {
      target: { value: 'core:quarry-stalker' },
    });
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
        now={10}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Receita'), { target: { value: 'forge:iron-maul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fabricar equipamento' }));
    expect(await screen.findByText('Alterações salvas.')).toBeInTheDocument();
    expect(current.character?.inventory['gear:iron-maul']).toBe(1);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        now={11}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Equipar' }));
    expect(current.character?.equipment.primary).toBe('gear:iron-maul');
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        now={12}
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
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Buscar nós'), { target: { value: 'dano' } });
    fireEvent.change(screen.getByLabelText('Filtrar categoria'), { target: { value: 'effect' } });
    fireEvent.change(screen.getByLabelText('Catálogo de nós'), {
      target: { value: 'core:effect-damage' },
    });
    fireEvent.change(screen.getByLabelText('Conectar a'), { target: { value: 'form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar e conectar nó' }));
    const addedNode = [...container.querySelectorAll<HTMLButtonElement>('.graph-node')].find(
      (node) => node.textContent?.includes('effect-damage-5'),
    )!;
    const quantityInputs = screen.getAllByLabelText(/quantidade/);
    fireEvent.change(quantityInputs.at(-1)!, { target: { value: '75' } });
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
    if (content.glyphs[0])
      fireEvent.change(screen.getByLabelText('Glyph'), { target: { value: content.glyphs[0].id } });
    fireEvent.change(screen.getByLabelText('Glyph'), { target: { value: '' } });
    if (content.sigils[0])
      fireEvent.change(screen.getByLabelText('Sigil'), { target: { value: content.sigils[0].id } });
    fireEvent.change(screen.getByLabelText('Sigil'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'ability' } });
    expect(container.querySelector('.graph-nodes')).toHaveStyle({ transform: 'scale(1)' });
  });

  it('reports invalid or locked graphs and handles storage errors outside Error objects', async () => {
    const updateCharacter = vi.fn(async () => {
      throw 'storage unavailable';
    });
    const view = render(
      <PhaseTwoPanels
        state={game()}
        content={content}
        now={10}
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
        now={10}
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
        now={1234}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
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
        now={1235}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Equipar build' }));
    expect(current.character?.abilities).toContain(graph.id);
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={content}
        now={1236}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
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
        now={1237}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
    fireEvent.change(screen.getByLabelText('Examinar criatura'), {
      target: { value: 'core:echo-wraith' },
    });
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
        now={1238}
        updateCharacter={updateCharacter}
      />,
    );
    fireEvent.change(screen.getByLabelText('Examinar criatura'), {
      target: { value: durableEnemy.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Executar simulação' }));
    expect(screen.getByText(/vencedor: não decidido/)).toBeInTheDocument();
    view.rerender(
      <PhaseTwoPanels
        state={current}
        content={{ ...content, enemies: new Map() }}
        now={1238}
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
        now={40}
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
        now={41}
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
    const combat: CombatState = {
      id: 'combat:one',
      seed: 3,
      rngState: 3,
      nowMs: 1000,
      actors: [],
      log: [logEntry],
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
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByText(/core:lost-foundry · 1 derrotas/));
    fireEvent.click(screen.getByText(/combat:one · 1 eventos/));
    expect(screen.getByText(/1\.0s — Hero hits enemy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alternar detalhes' }));
    expect(screen.getByText(/"damageFinal": 8/)).toBeInTheDocument();
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
        now={10}
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
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
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
        now={10}
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
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Examinar criatura'), {
      target: { value: 'core:ashen-sovereign' },
    });
    expect(screen.getByRole('option', { name: 'Soberano das Cinzas · Chefe' })).toBeInTheDocument();
  });

  it('renders modded bestiary and equipment fallbacks and old combat history shapes', () => {
    const state = game();
    state.character!.equipment.primary = 'missing:weapon';
    const enemy = {
      ...content.enemies.get('core:quarry-stalker')!,
      id: 'mod:elite-stalker',
      name: 'Elite Stalker',
      tags: ['mod:missing-tag'],
      elite: true,
      boss: false,
    };
    const enemies = new Map(content.enemies);
    enemies.set(enemy.id, enemy);
    const recipe = {
      ...content.recipes.values().next().value!,
      id: 'mod:unknown-input',
      inputs: { 'missing:material': 2 },
    };
    const recipes = new Map(content.recipes);
    recipes.set(recipe.id, recipe);
    const customContent = { ...content, enemies, recipes };
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
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Examinar criatura'), { target: { value: enemy.id } });
    expect(screen.getByRole('option', { name: 'Elite Stalker · Elite' })).toBeInTheDocument();
    expect(screen.getByText(/mod:missing-tag/)).toBeInTheDocument();
    expect(screen.getByText('primary: missing:weapon')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /missing:material ×2/ })).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/mod:old · 0 derrotas/)[0]!);
    expect(screen.getByText(/missing:relic ×2/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/mod:old · 0 derrotas/)[0]!);
    fireEvent.click(screen.getAllByText(/mod:old · 0 derrotas/)[1]!);
    expect(screen.getByText(/sem drops/)).toBeInTheDocument();

    const legacy = game();
    legacy.combatRecords = undefined as unknown as GameState['combatRecords'];
    const emptyEnemyView = render(
      <PhaseTwoPanels
        state={legacy}
        content={{ ...content, enemies: new Map() }}
        now={10}
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
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Construções salvas'), { target: { value: graph.id } });
    const stale = game();
    view.rerender(
      <PhaseTwoPanels
        state={stale}
        content={content}
        now={10}
        updateCharacter={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar selecionada' }));
    expect(screen.getByLabelText('Nome da construção')).toHaveValue('Nova construção');
  });
});
