import { memo, useMemo, useRef, useState } from 'react';
import { GameSelect } from './GameSelect';
import type { ContentCatalog } from '../content/registry';
import { advanceCombat, createCombatState } from '../combat/combat-engine';
import type { CombatActor, CombatState } from '../combat/types';
import { createCharacterCombatActor } from '../combat/player-actor';
import { equipItem, forgeItem, unequipItem, type EquipmentSlot } from '../domain/forge';
import type { Character, GameState } from '../domain/types';
import { compileConstruction, validateConstruction, type NodeGraph } from '../nodes/graph';
import { redoGraphHistory, undoGraphHistory, type GraphHistory } from '../nodes/graph-history';
import { t, type TranslationKey } from './i18n';
import { nodeCategoryName } from './phase-two-format';
import {
  constructionPriority,
  duplicateConstruction,
  equipConstruction,
  moveConstructionPriority,
  saveConstruction,
  unequipConstruction,
} from '../nodes/library';

interface PhaseTwoPanelsProps {
  state: GameState;
  content: ContentCatalog;
  clock: () => number;
  updateCharacter: (update: (character: Character) => Character) => Promise<void>;
  onCraft?: (recipeId: string) => Promise<void>;
  view?: 'expeditions' | 'bestiary' | 'forge' | 'nodes' | 'arena' | 'records';
  expeditionKind?: 'quest' | 'dungeon' | 'raid';
}

const starterGraph: NodeGraph = {
  schemaVersion: 1,
  id: 'construction:new',
  name: 'Nova construção',
  kind: 'spell',
  rootId: 'source',
  glyphIds: [],
  nodes: [
    { instanceId: 'source', definitionId: 'core:source-caster', children: ['type'] },
    { instanceId: 'type', definitionId: 'core:type-physical', children: ['form'] },
    { instanceId: 'form', definitionId: 'core:form-weapon-strike', children: ['effect'] },
    { instanceId: 'effect', definitionId: 'core:effect-damage', children: [] },
  ],
};

function emptyCombatActor(
  enemy: NonNullable<ReturnType<ContentCatalog['enemies']['get']>>,
  id: string,
): CombatActor {
  return {
    ...enemy,
    id,
    speciesId: enemy.id,
    side: 'enemy',
    state: 'ready',
    nextEventAt: 0,
    tags: [...enemy.tags],
    position: { ...enemy.position },
  };
}

function logText(combat: CombatState): string {
  return combat.log
    .map((entry) => `${(entry.timeMs / 1000).toFixed(1)}s — ${entry.message}`)
    .join('\n');
}

export const PhaseTwoPanels = memo(function PhaseTwoPanels({
  state,
  content,
  clock,
  updateCharacter,
  onCraft,
  view,
  expeditionKind,
}: PhaseTwoPanelsProps) {
  const character = state.character;
  const [enemyId, setEnemyId] = useState([...content.enemies.keys()][0] ?? '');
  const [recipeId, setRecipeId] = useState([...content.recipes.keys()][0] ?? '');
  const [graph, setGraph] = useState<NodeGraph>(starterGraph);
  const graphRef = useRef(graph);
  const graphHistory = useRef<GraphHistory>({ past: [], future: [] });
  const [, setHistoryVersion] = useState(0);
  const [selectedParent, setSelectedParent] = useState('form');
  const [newDefinitionId, setNewDefinitionId] = useState(content.nodes[0]?.id ?? '');
  const [copyId, setCopyId] = useState('construction:copy');
  const [nodeSearch, setNodeSearch] = useState('');
  const [nodeCategory, setNodeCategory] = useState('all');
  const [zoom, setZoom] = useState(1);
  const [selectedConstructionId, setSelectedConstructionId] = useState(
    () => character?.nodeLibrary?.constructions?.[0]?.id ?? '',
  );
  const [arena, setArena] = useState<CombatState | null>(null);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(false);
  const unlocked = new Set(character?.nodeLibrary?.unlockedNodeIds ?? []);
  const constructions = character?.nodeLibrary?.constructions ?? [];
  const equippedConstructions = character
    ? constructionPriority(character).map((id) => constructions.find((entry) => entry.id === id)!)
    : [];
  const combatRecords = state.combatRecords ?? [];
  const selectedEnemy = content.enemies.get(enemyId);
  const selectedLootTable = selectedEnemy?.lootTableId
    ? content.lootTables.get(selectedEnemy.lootTableId)
    : undefined;
  const knownLoot = selectedLootTable
    ? [
        ...(selectedLootTable.guaranteed ?? []),
        ...(selectedLootTable.independent ?? []),
        ...(selectedLootTable.exclusive?.flatMap((entry) => entry.entries) ?? []),
        ...(selectedLootTable.conditional?.flatMap((entry) => entry.drops) ?? []),
      ]
    : [];
  const enemyLocations = selectedEnemy
    ? [...content.expeditions.values()].filter((expedition) =>
        expedition.encounters.some((encounter) => encounter.enemyId === selectedEnemy.id),
      )
    : [];
  const canvasDefinitions = useMemo(
    () => new Map(content.nodes.map((node) => [node.id, node])),
    [content.nodes],
  );
  const filteredNodes = content.nodes.filter(
    (node) =>
      (nodeCategory === 'all' || node.category === nodeCategory) &&
      node.name.toLocaleLowerCase().includes(nodeSearch.toLocaleLowerCase()),
  );
  const selectedGraphNode = graph.nodes.find((node) => node.instanceId === selectedParent);
  const selectedNodeDefinition = selectedGraphNode
    ? canvasDefinitions.get(selectedGraphNode.definitionId)
    : undefined;

  const updateGraph = (update: (current: NodeGraph) => NodeGraph) => {
    const next = update(graphRef.current);
    graphHistory.current.past = [...graphHistory.current.past, graphRef.current].slice(-50);
    graphHistory.current.future = [];
    graphRef.current = next;
    setGraph(next);
    setHistoryVersion((version) => version + 1);
  };

  const undoGraph = () => {
    const transition = undoGraphHistory(graphHistory.current, graphRef.current);
    graphHistory.current = transition.history;
    graphRef.current = transition.graph;
    setGraph(transition.graph);
    setHistoryVersion((version) => version + transition.versionDelta);
  };

  const redoGraph = () => {
    const transition = redoGraphHistory(graphHistory.current, graphRef.current);
    graphHistory.current = transition.history;
    graphRef.current = transition.graph;
    setGraph(transition.graph);
    setHistoryVersion((version) => version + transition.versionDelta);
  };

  const persist = async (update: (current: Character) => Character) => {
    try {
      await updateCharacter(update);
      setMessage(t('phase.saved'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('phase.saveFailed'));
    }
  };

  const addGraphNode = (definitionId: string, parentId: string) => {
    const definition = canvasDefinitions.get(definitionId);
    if (!definition) return;
    const suffix = definition.id
      .split(':')
      .at(-1)!
      .replaceAll(/[^a-zA-Z0-9_-]/g, '-');
    const instanceId = `${suffix}-${graph.nodes.length + 1}`;
    updateGraph((current) => ({
      ...current,
      nodes: current.nodes
        .map((node) =>
          node.instanceId === parentId
            ? { ...node, children: [...node.children, instanceId] }
            : node,
        )
        .concat({ instanceId, definitionId, children: [] }),
    }));
    setSelectedParent(instanceId);
  };

  const removeGraphNode = (instanceId: string) => {
    updateGraph((current) => ({
      ...current,
      nodes: current.nodes
        .filter((node) => node.instanceId !== instanceId)
        .map((node) => ({
          ...node,
          children: node.children.filter((child) => child !== instanceId),
        })),
    }));
  };

  const saveGraph = async () => {
    const errors = validateConstruction(graph, content.nodes, content.glyphs, content.sigils);
    const locked = graph.nodes.map((node) => node.definitionId).filter((id) => !unlocked.has(id));
    if (errors.length) {
      setMessage(errors.join(' '));
      return;
    }
    if (locked.length) {
      setMessage(`${t('phase.unlockInExpeditions')}: ${[...new Set(locked)].join(', ')}.`);
      return;
    }
    try {
      compileConstruction(graph, content.nodes, content.glyphs, content.sigils);
      await persist((current) => saveConstruction(current, graph, clock()));
      setSelectedConstructionId(graph.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('phase.invalidConstruction'));
    }
  };

  const runArena = () => {
    try {
      const saved = constructions.find((item) => item.id === selectedConstructionId);
      const enemy = content.enemies.get(enemyId);
      if (!saved || !enemy) throw new Error(t('phase.selectConstructionAndEnemy'));
      const action = compileConstruction(
        saved.graph,
        content.nodes,
        content.glyphs,
        content.sigils,
      ).action;
      const actor = createCharacterCombatActor(
        character!,
        content.items,
        content.rules.combat,
        [action],
        content.races.get(character!.raceId),
        content.systems,
      );
      actor.side = 'party';
      actor.actionPriority = [action.id, ...actor.actionPriority];
      const initial = createCombatState(
        `arena:${clock()}:${saved.id}:${enemy.id}`,
        [actor, emptyCombatActor(enemy, `arena-enemy:${enemy.id}`)],
        clock() >>> 0,
        {},
        [...content.enemyTags.values()],
      );
      setArena(advanceCombat(initial, 30_000));
      setMessage(t('phase.arenaCompleted'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('phase.arenaFailed'));
    }
  };

  if (
    !character &&
    (view === undefined || view === 'arena' || view === 'forge' || view === 'nodes')
  ) {
    return (
      <section className="panel empty-state" aria-live="polite">
        <p>{t('character.noCharacter')}</p>
      </section>
    );
  }

  return (
    <>
      {(!view || view === 'expeditions') && (
        <section className="panel" aria-labelledby="expedition-codex-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('phase.exploration')}</p>
              <h2 id="expedition-codex-heading">{t('phase.expeditions')}</h2>
            </div>
          </div>
          <ul className="inventory-list">
            {[...content.expeditions.values()]
              .filter((expedition) => !expeditionKind || expedition.activityKind === expeditionKind)
              .map((expedition) => (
                <li key={expedition.id}>
                  <span>
                    <strong>{expedition.name}</strong>
                    <br />
                    <small>{expedition.description}</small>
                    <br />
                    <small>
                      {t('phase.encounters')}:{' '}
                      {expedition.encounters
                        .map((entry) => content.enemies.get(entry.enemyId)?.name ?? entry.enemyId)
                        .join(' · ')}
                    </small>
                  </span>
                  <strong>{t(`combat.kind.${expedition.activityKind}` as TranslationKey)}</strong>
                </li>
              ))}
          </ul>
        </section>
      )}

      {(!view || view === 'bestiary') && (
        <section className="panel" aria-labelledby="bestiary-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('phase.codex')}</p>
              <h2 id="bestiary-heading">{t('phase.bestiary')}</h2>
            </div>
          </div>
          <GameSelect
            id="enemy-select"
            label={t('phase.inspectCreature')}
            value={enemyId}
            options={[...content.enemies.values()].map((enemy) => ({
              value: enemy.id,
              label: `${enemy.name}${enemy.boss ? ` · ${t('phase.boss')}` : enemy.elite ? ` · ${t('phase.elite')}` : ''}`,
            }))}
            onChange={setEnemyId}
          />
          {selectedEnemy && (
            <article className="codex-card">
              <h3>{selectedEnemy.name}</h3>
              <p>{selectedEnemy.description}</p>
              <p>
                {t('phase.hp')} {selectedEnemy.hp.current}/{selectedEnemy.hp.maximum} ·{' '}
                {t('phase.tenacity')} {selectedEnemy.tenacity.current}/
                {selectedEnemy.tenacity.maximum}
              </p>
              <p>
                {t('phase.tags')}:{' '}
                {selectedEnemy.tags.map((id) => content.enemyTags.get(id)?.name ?? id).join(', ')}
              </p>
              <ul>
                {selectedEnemy.tags
                  .map((id) => content.enemyTags.get(id))
                  .filter(Boolean)
                  .map((tag) => (
                    <li key={tag!.id}>
                      <strong>{tag!.name}:</strong> {tag!.description} — {t('phase.tagCounterplay')}
                      : {tag!.interactions.map((entry) => entry.counterplay).join('; ')}
                    </li>
                  ))}
              </ul>
              <details className="codex-details">
                <summary>{t('phase.details')}</summary>
                <h4>{t('phase.attributes')}</h4>
                <dl className="codex-stat-list">
                  {Object.entries(selectedEnemy.attributes).map(([id, amount]) => {
                    const key = `phase.attribute.${id}` as TranslationKey;
                    const label =
                      id in
                      {
                        vigor: true,
                        resistance: true,
                        speed: true,
                        dexterity: true,
                        precision: true,
                        strength: true,
                      }
                        ? t(key)
                        : id;
                    return (
                      <div key={id}>
                        <dt>{label}</dt>
                        <dd>{amount}</dd>
                      </div>
                    );
                  })}
                </dl>
                <h4>{t('phase.resistanceMitigation')}</h4>
                <ul className="codex-stat-list">
                  <li>
                    {t('phase.mitigationPhysical')}:{' '}
                    {Math.round(selectedEnemy.mitigation.physical * 100)}%
                  </li>
                  <li>
                    {t('phase.mitigationMagical')}:{' '}
                    {Math.round(selectedEnemy.mitigation.magical * 100)}%
                  </li>
                </ul>
                <h4>{t('phase.vulnerabilityCounterplay')}</h4>
                <ul className="codex-stat-list">
                  {selectedEnemy.tags.flatMap((id) => {
                    const tag = content.enemyTags.get(id);
                    return (tag?.interactions ?? []).map((interaction) => (
                      <li key={`${id}:${interaction.id}`}>
                        {tag?.name}: {interaction.counterplay}
                      </li>
                    ));
                  })}
                </ul>
                <h4>{t('phase.skills')}</h4>
                {selectedEnemy.actions.length ? (
                  <ul className="codex-stat-list">
                    {selectedEnemy.actions.map((action) => (
                      <li key={action.id}>{action.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('phase.noActions')}</p>
                )}
                <h4>{t('phase.knownLoot')}</h4>
                {knownLoot.length ? (
                  <ul className="codex-stat-list">
                    {knownLoot.map((entry, index) => (
                      <li key={`${entry.itemId}:${index}`}>
                        {content.items.get(entry.itemId)?.name ?? entry.itemId} ×{entry.quantity}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('phase.noKnownLoot')}</p>
                )}
                <h4>{t('phase.locations')}</h4>
                {enemyLocations.length ? (
                  <ul className="codex-stat-list">
                    {enemyLocations.map((expedition) => (
                      <li key={expedition.id}>{expedition.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('phase.noLocations')}</p>
                )}
              </details>
            </article>
          )}
        </section>
      )}

      {(!view || view === 'forge') && (
        <section className="panel" aria-labelledby="forge-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('phase.equipment')}</p>
              <h2 id="forge-heading">{t('phase.forgeBuilds')}</h2>
            </div>
          </div>
          <GameSelect
            id="recipe-select"
            label={t('phase.recipe')}
            value={recipeId}
            options={[...content.recipes.values()].map((recipe) => ({
              value: recipe.id,
              label: `${recipe.name} · ${Object.entries(recipe.inputs)
                .map(([id, count]) => `${content.items.get(id)?.name ?? id} ×${count}`)
                .join(', ')}`,
            }))}
            onChange={setRecipeId}
          />
          <button
            className="primary-button"
            onClick={() =>
              void (onCraft
                ? onCraft(recipeId)
                : persist((current) => forgeItem(current, content, recipeId)))
            }
            type="button"
          >
            {t('phase.craftEquipment')}
          </button>
          <h3>{t('phase.equipped')}</h3>
          <ul className="inventory-list">
            {(
              ['primary', 'secondary', 'head', 'chest', 'legs', 'hands', 'feet'] as EquipmentSlot[]
            ).map((slot) => {
              const value = character!.equipment[slot];
              const id = typeof value === 'string' ? value : undefined;
              return (
                <li key={slot}>
                  <span>
                    {t(`phase.gearSlot.${slot}` as TranslationKey)}:{' '}
                    {id ? (content.items.get(id)?.name ?? id) : t('phase.emptySlot')}
                  </span>
                  {id && (
                    <button
                      className="quiet-button"
                      onClick={() => void persist((current) => unequipItem(current, content, slot))}
                      type="button"
                    >
                      {t('phase.unequipItem')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <h3>{t('phase.equippableInventory')}</h3>
          <ul className="inventory-list">
            {Object.entries(character!.inventory)
              .filter(([id, count]) => count > 0 && content.items.get(id)?.slot)
              .map(([id, count]) => (
                <li key={id}>
                  <span>
                    {content.items.get(id)?.name} ×{count}
                  </span>
                  <button
                    className="quiet-button"
                    onClick={() => void persist((current) => equipItem(current, content, id))}
                    type="button"
                  >
                    {t('phase.equip')}
                  </button>
                </li>
              ))}
          </ul>
          <h3>{t('phase.autoSkillPriority')}</h3>
          {equippedConstructions.length === 0 ? (
            <p className="muted">{t('phase.equipConstructionHint')}</p>
          ) : (
            <ol className="inventory-list">
              {equippedConstructions.map((construction, index) => {
                const id = construction.id;
                return (
                  <li key={id}>
                    <span>{construction.graph.name}</span>
                    <div className="queue-actions">
                      <button
                        className="quiet-button"
                        disabled={index === 0}
                        aria-label={`${t('phase.prioritize')} ${construction.graph.name}`}
                        onClick={() =>
                          void persist((current) => moveConstructionPriority(current, id, -1))
                        }
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        className="quiet-button"
                        disabled={index === equippedConstructions.length - 1}
                        aria-label={`${t('phase.deprioritize')} ${construction.graph.name}`}
                        onClick={() =>
                          void persist((current) => moveConstructionPriority(current, id, 1))
                        }
                        type="button"
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {(!view || view === 'nodes' || view === 'arena') && (
        <section className="panel" aria-labelledby="node-editor-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('phase.activeCreation')}</p>
              <h2 id="node-editor-heading">
                {view === 'arena' ? t('phase.testArena') : t('phase.nodeEditor')}
              </h2>
            </div>
            {view !== 'arena' && (
              <span className="muted">
                {unlocked.size} {t('phase.nodesUnlocked')}
              </span>
            )}
          </div>
          {view !== 'arena' && (
            <div className="node-editor-content">
              <label>
                {t('phase.constructionName')}
                <input
                  value={graph.name}
                  onChange={(event) =>
                    updateGraph((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('phase.identifier')}
                <input
                  value={graph.id}
                  onChange={(event) =>
                    updateGraph((current) => ({ ...current, id: event.target.value }))
                  }
                />
              </label>
              <GameSelect
                id="construction-kind"
                label={t('phase.type')}
                value={graph.kind}
                options={[
                  'spell',
                  'ability',
                  'technique',
                  'weapon',
                  'armor',
                  'rune',
                  'consumable',
                  'summon',
                  'other',
                ].map((kind) => ({
                  value: kind,
                  label: t(`phase.nodeKind.${kind}` as TranslationKey),
                }))}
                onChange={(kind) =>
                  updateGraph((current) => ({ ...current, kind: kind as NodeGraph['kind'] }))
                }
              />
              <div className="queue-actions" aria-label={t('phase.graphHistory')}>
                <button
                  className="quiet-button"
                  aria-label={t('phase.undo')}
                  disabled={!graphHistory.current.past.length}
                  onClick={undoGraph}
                  type="button"
                >
                  {t('phase.undo')}
                </button>
                <button
                  className="quiet-button"
                  aria-label={t('phase.redo')}
                  disabled={!graphHistory.current.future.length}
                  onClick={redoGraph}
                  type="button"
                >
                  {t('phase.redo')}
                </button>
              </div>
              <div className="queue-actions" aria-label={t('phase.canvasZoom')}>
                <button
                  className="quiet-button"
                  onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))}
                  type="button"
                  aria-label={t('phase.zoomOut')}
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  className="quiet-button"
                  onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
                  type="button"
                  aria-label={t('phase.zoomIn')}
                >
                  +
                </button>
              </div>
              <div
                className="node-canvas"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData('text/plain');
                  if (id) addGraphNode(id, selectedParent);
                }}
                aria-label={t('phase.nodeCanvas')}
              >
                <p className="muted">{t('phase.canvasHelp')}</p>
                <div
                  className="graph-nodes"
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                >
                  <svg
                    className="graph-connections"
                    viewBox={`0 0 360 ${Math.max(1, graph.nodes.length) * 78}`}
                    preserveAspectRatio="none"
                    style={{ height: `${Math.max(1, graph.nodes.length) * 4.875}rem` }}
                    aria-label={t('phase.connections')}
                    role="img"
                  >
                    {graph.nodes.flatMap((node, sourceIndex) =>
                      node.children.flatMap((childId) => {
                        const targetIndex = graph.nodes.findIndex(
                          (candidate) => candidate.instanceId === childId,
                        );
                        if (targetIndex < 0) return [];
                        const startY = sourceIndex * 78 + 36;
                        const endY = targetIndex * 78 + 36;
                        return (
                          <path
                            key={`${node.instanceId}:${childId}`}
                            d={`M 180 ${startY} C 180 ${startY + 24}, 180 ${endY - 24}, 180 ${endY}`}
                          />
                        );
                      }),
                    )}
                  </svg>
                  {graph.nodes.map((node) => (
                    <button
                      key={node.instanceId}
                      className={
                        selectedParent === node.instanceId ? 'graph-node selected' : 'graph-node'
                      }
                      onClick={() => setSelectedParent(node.instanceId)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const id = event.dataTransfer.getData('text/plain');
                        if (id) addGraphNode(id, node.instanceId);
                      }}
                      type="button"
                    >
                      <strong>
                        {canvasDefinitions.get(node.definitionId)?.name ?? node.definitionId}
                      </strong>
                      <small>
                        {node.instanceId} → {node.children.join(', ') || '∅'}
                      </small>
                      {node.instanceId !== graph.rootId && (
                        <span
                          role="presentation"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeGraphNode(node.instanceId);
                          }}
                        >
                          ×
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <section className="node-inspector" aria-label={t('phase.nodeProperties')}>
                <div>
                  <p className="eyebrow">{t('phase.inspector')}</p>
                  <h3>{selectedNodeDefinition?.name ?? t('phase.selectNode')}</h3>
                  <p className="muted">
                    {selectedNodeDefinition?.description ?? t('phase.nodePropertiesHint')}
                  </p>
                  {selectedGraphNode && (
                    <small className="muted">
                      {selectedGraphNode.instanceId} ·{' '}
                      {selectedNodeDefinition?.category ?? selectedGraphNode.definitionId}
                    </small>
                  )}
                </div>
                {selectedGraphNode && selectedNodeDefinition?.parameters?.amount && (
                  <label>
                    {t('phase.amount')}
                    <input
                      type="number"
                      value={Number(
                        selectedGraphNode.parameters?.amount ??
                          selectedNodeDefinition.parameters.amount.default,
                      )}
                      onChange={(event) =>
                        updateGraph((current) => ({
                          ...current,
                          nodes: current.nodes.map((node) =>
                            node.instanceId === selectedGraphNode.instanceId
                              ? {
                                  ...node,
                                  parameters: {
                                    ...node.parameters,
                                    amount: Number(event.target.value),
                                  },
                                }
                              : node,
                          ),
                        }))
                      }
                    />
                  </label>
                )}
                {selectedGraphNode && selectedGraphNode.instanceId !== graph.rootId && (
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => removeGraphNode(selectedGraphNode.instanceId)}
                  >
                    {t('phase.removeNode')}
                  </button>
                )}
              </section>
              <label>
                {t('phase.searchNodesLabel')}
                <input
                  value={nodeSearch}
                  onChange={(event) => setNodeSearch(event.target.value)}
                  placeholder={t('phase.nodeName')}
                />
              </label>
              <GameSelect
                id="node-category"
                label={t('phase.filterCategory')}
                value={nodeCategory}
                options={[
                  { value: 'all', label: t('phase.nodeCategory.all') },
                  ...['source', 'type', 'form', 'effect', 'modifier', 'sacrifice'].map(
                    (category) => ({
                      value: category,
                      label: t(`phase.nodeCategory.${category}` as TranslationKey),
                    }),
                  ),
                ]}
                onChange={setNodeCategory}
              />
              <GameSelect
                id="node-catalog"
                label={t('phase.nodeCatalog')}
                value={newDefinitionId}
                options={filteredNodes.map((node) => ({
                  value: node.id,
                  label: `${unlocked.has(node.id) ? '◆' : '🔒'} ${nodeCategoryName(node.category)} · ${node.name}`,
                  disabled: !unlocked.has(node.id),
                }))}
                onChange={setNewDefinitionId}
              />
              <GameSelect
                id="node-parent"
                label={t('phase.connectTo')}
                value={selectedParent}
                options={graph.nodes.map((node) => ({
                  value: node.instanceId,
                  label: `${canvasDefinitions.get(node.definitionId)?.name ?? node.instanceId} (${node.instanceId})`,
                }))}
                onChange={setSelectedParent}
              />
              <button
                className="quiet-button"
                disabled={!unlocked.has(newDefinitionId)}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/plain', newDefinitionId)}
                onClick={() => addGraphNode(newDefinitionId, selectedParent)}
                type="button"
              >
                {t('phase.addConnectNode')}
              </button>
              {graph.nodes.map((node) => {
                const definition = canvasDefinitions.get(node.definitionId);
                const amount = definition?.parameters?.amount;
                return amount ? (
                  <label key={`${node.instanceId}-amount`}>
                    {definition!.name} · quantidade
                    <input
                      type="number"
                      value={Number(node.parameters?.amount ?? amount.default)}
                      onChange={(event) =>
                        updateGraph((current) => ({
                          ...current,
                          nodes: current.nodes.map((entry) =>
                            entry.instanceId === node.instanceId
                              ? {
                                  ...entry,
                                  parameters: {
                                    ...entry.parameters,
                                    amount: Number(event.target.value),
                                  },
                                }
                              : entry,
                          ),
                        }))
                      }
                    />
                  </label>
                ) : null;
              })}
              <GameSelect
                id="node-glyph"
                label={t('phase.glyph')}
                value={graph.glyphIds[0] ?? ''}
                options={[
                  { value: '', label: t('phase.none') },
                  ...content.glyphs.map((glyph) => ({ value: glyph.id, label: glyph.name })),
                ]}
                onChange={(glyphId) =>
                  updateGraph((current) => ({ ...current, glyphIds: glyphId ? [glyphId] : [] }))
                }
              />
              <GameSelect
                id="node-sigil"
                label={t('phase.sigil')}
                value={graph.sigilIds?.[0] ?? ''}
                options={[
                  { value: '', label: t('phase.none') },
                  ...content.sigils.map((sigil) => ({ value: sigil.id, label: sigil.name })),
                ]}
                onChange={(sigilId) =>
                  updateGraph((current) => ({ ...current, sigilIds: sigilId ? [sigilId] : [] }))
                }
              />
              <button className="primary-button" onClick={() => void saveGraph()} type="button">
                {t('phase.validateSaveGraph')}
              </button>
              <GameSelect
                id="saved-construction"
                label={t('phase.savedConstructions')}
                value={selectedConstructionId}
                options={[
                  { value: '', label: t('phase.select') },
                  ...constructions.map((entry) => ({
                    value: entry.id,
                    label: `${entry.graph.name} (${entry.id})`,
                  })),
                ]}
                onChange={setSelectedConstructionId}
              />
              {selectedConstructionId && (
                <div className="queue-actions">
                  <button
                    className="quiet-button"
                    onClick={() => {
                      const found = constructions.find(
                        (entry) => entry.id === selectedConstructionId,
                      );
                      if (found) {
                        const next = structuredClone(found.graph);
                        graphRef.current = next;
                        setGraph(next);
                        graphHistory.current = { past: [], future: [] };
                        setHistoryVersion((version) => version + 1);
                      }
                    }}
                    type="button"
                  >
                    {t('phase.editSelected')}
                  </button>
                  <button
                    className="quiet-button"
                    onClick={() =>
                      void persist((current) =>
                        duplicateConstruction(current, selectedConstructionId, copyId, clock()),
                      )
                    }
                    type="button"
                  >
                    {t('phase.duplicate')}
                  </button>
                  <label className="sr-only" htmlFor="construction-copy-id">
                    {t('phase.copyIdentifier')}
                  </label>
                  <input
                    id="construction-copy-id"
                    value={copyId}
                    onChange={(event) => setCopyId(event.target.value)}
                  />
                  {constructions.find((entry) => entry.id === selectedConstructionId)?.equipped ? (
                    <button
                      className="quiet-button"
                      onClick={() =>
                        void persist((current) =>
                          unequipConstruction(current, selectedConstructionId),
                        )
                      }
                      type="button"
                    >
                      {t('phase.unequipBuild')}
                    </button>
                  ) : (
                    <button
                      className="quiet-button"
                      onClick={() =>
                        void persist((current) =>
                          equipConstruction(current, selectedConstructionId),
                        )
                      }
                      type="button"
                    >
                      {t('phase.equipBuild')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {view !== 'nodes' && (
            <div className="arena-box">
              <h3>{t('phase.testArena')}</h3>
              <p>{t('phase.arenaDescription')}</p>
              {view === 'arena' && (
                <GameSelect
                  id="arena-construction"
                  label={t('phase.savedConstructionToTest')}
                  value={selectedConstructionId}
                  options={[
                    { value: '', label: t('phase.select') },
                    ...constructions.map((entry) => ({
                      value: entry.id,
                      label: `${entry.graph.name} (${entry.id})`,
                    })),
                  ]}
                  onChange={setSelectedConstructionId}
                />
              )}
              <button
                className="primary-button"
                disabled={!selectedConstructionId}
                onClick={runArena}
                type="button"
              >
                {t('phase.runSimulation')}
              </button>
              {arena && (
                <>
                  <p>
                    {t('phase.virtualTime')}: {arena.nowMs} ms · {t('phase.winner')}:{' '}
                    {arena.winner ?? t('phase.undecided')}
                  </p>
                  <button
                    className="quiet-button"
                    onClick={() => setDetail((value) => !value)}
                    type="button"
                  >
                    {detail ? t('phase.summary') : t('phase.viewDetailedLog')}
                  </button>
                  <pre className="combat-log">
                    {detail
                      ? arena.log
                          .map(
                            (entry) =>
                              `${entry.id}\n${entry.message}\nDano ${entry.damageInitial} → ${entry.damageFinal}; HP ${entry.hpChange?.before ?? '—'} → ${entry.hpChange?.after ?? '—'}; Tenacidade ${entry.tenacityChange?.before ?? '—'} → ${entry.tenacityChange?.after ?? '—'}\nModificadores: ${entry.modifiers.map((item) => `${item.id}=${item.value} (${item.source})`).join(', ') || 'nenhum'}\nTags: ${entry.tagInteractions.map((item) => `${item.tagId}/${item.ruleId}: ${item.reason}`).join(', ') || 'nenhuma'}`,
                          )
                          .join('\n\n')
                      : logText(arena)}
                  </pre>
                </>
              )}
            </div>
          )}
          {message && (
            <p className="muted" role="status">
              {message}
            </p>
          )}
        </section>
      )}

      {(!view || view === 'records') && (
        <section className="panel" aria-labelledby="combat-history-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('phase.reports')}</p>
              <h2 id="combat-history-heading">{t('phase.recentCombat')}</h2>
            </div>
          </div>
          {combatRecords.length ? (
            combatRecords
              .slice()
              .reverse()
              .map((record) => {
                const partyActorIds = new Set(
                  record.combats.flatMap((combat) =>
                    combat.actors
                      .filter((actor) => actor.side === 'party')
                      .map((actor) => actor.id),
                  ),
                );
                const combatLogs = record.combats.flatMap((combat) => combat.log);
                const damageDealt = combatLogs
                  .filter((entry) => partyActorIds.has(entry.actorId))
                  .reduce((total, entry) => total + entry.damageFinal, 0);
                const damageReceived = combatLogs
                  .filter((entry) => entry.targetId && partyActorIds.has(entry.targetId))
                  .reduce((total, entry) => total + entry.damageFinal, 0);
                const expedition = content.expeditions.get(record.expeditionId);
                const rewards = record.drops
                  .map(
                    (drop) =>
                      `${content.items.get(drop.itemId)?.name ?? drop.itemId} ×${drop.quantity}`,
                  )
                  .join(', ');
                return (
                  <details key={record.id}>
                    <summary>
                      {expedition?.name ?? record.expeditionId} · {record.kills}{' '}
                      {t('phase.enemiesDefeated')} · {record.deaths} {t('phase.deaths')} ·{' '}
                      {record.experience} XP
                    </summary>
                    <p>
                      {t('phase.damageDealt')}: {damageDealt} · {t('phase.damageReceived')}:{' '}
                      {damageReceived}
                    </p>
                    <p>{rewards || t('phase.noDrops')}</p>
                    {record.combats.map((combat, index) => (
                      <details key={combat.id}>
                        <summary>
                          {t('phase.combat')} {index + 1} · {combat.log.length} {t('phase.events')}
                        </summary>
                        <pre className="combat-log">
                          {logText(combat)}
                          {detail ? `\n\n${JSON.stringify(combat.log, null, 2)}` : ''}
                        </pre>
                      </details>
                    ))}
                    <button
                      className="quiet-button"
                      onClick={() => setDetail((value) => !value)}
                      type="button"
                    >
                      {detail ? t('phase.hideTechnicalDetails') : t('phase.showTechnicalDetails')}
                    </button>
                    {detail && (
                      <p className="muted">
                        {t('phase.recordId')}: {record.id} · {t('phase.sessionId')}:{' '}
                        {record.sessionId} · {t('phase.seed')}: {record.seed} ·{' '}
                        {t('phase.duration')}: {record.virtualDurationMs} ms ·{' '}
                        {t('phase.completedAt')}:{' '}
                        {new Date(record.completedAt).toLocaleString('pt-BR')}
                      </p>
                    )}
                  </details>
                );
              })
          ) : (
            <p className="empty-state">{t('phase.noCombatExpeditions')}</p>
          )}
        </section>
      )}
    </>
  );
});
