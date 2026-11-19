import { useMemo, useState } from 'react';
import type { ContentCatalog } from '../content/registry';
import { advanceCombat, createCombatState } from '../combat/combat-engine';
import type { CombatActor, CombatState } from '../combat/types';
import { createCharacterCombatActor } from '../combat/player-actor';
import { equipItem, forgeItem, unequipItem, type EquipmentSlot } from '../domain/forge';
import type { Character, GameState } from '../domain/types';
import { compileConstruction, validateConstruction, type NodeGraph } from '../nodes/graph';
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
  now: number;
  updateCharacter: (update: (character: Character) => Character) => Promise<void>;
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

export function PhaseTwoPanels({ state, content, now, updateCharacter }: PhaseTwoPanelsProps) {
  const character = state.character!;
  const [enemyId, setEnemyId] = useState([...content.enemies.keys()][0] ?? '');
  const [recipeId, setRecipeId] = useState([...content.recipes.keys()][0] ?? '');
  const [graph, setGraph] = useState<NodeGraph>(starterGraph);
  const [selectedParent, setSelectedParent] = useState('form');
  const [newDefinitionId, setNewDefinitionId] = useState(content.nodes[0]?.id ?? '');
  const [copyId, setCopyId] = useState('construction:copy');
  const [nodeSearch, setNodeSearch] = useState('');
  const [nodeCategory, setNodeCategory] = useState('all');
  const [zoom, setZoom] = useState(1);
  const [selectedConstructionId, setSelectedConstructionId] = useState('');
  const [arena, setArena] = useState<CombatState | null>(null);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState(false);
  const unlocked = new Set(character.nodeLibrary?.unlockedNodeIds ?? []);
  const constructions = character.nodeLibrary?.constructions ?? [];
  const equippedConstructions = constructionPriority(character).map((id) =>
    constructions.find((entry) => entry.id === id)!,
  );
  const combatRecords = state.combatRecords ?? [];
  const canvasDefinitions = useMemo(
    () => new Map(content.nodes.map((node) => [node.id, node])),
    [content.nodes],
  );
  const filteredNodes = content.nodes.filter(
    (node) =>
      (nodeCategory === 'all' || node.category === nodeCategory) &&
      node.name.toLocaleLowerCase().includes(nodeSearch.toLocaleLowerCase()),
  );

  const persist = async (update: (current: Character) => Character) => {
    try {
      await updateCharacter(update);
      setMessage('Alterações salvas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar.');
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
    setGraph((current) => ({
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
    setGraph((current) => ({
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
      setMessage(`Desbloqueie em Dungeons/Raids: ${[...new Set(locked)].join(', ')}.`);
      return;
    }
    try {
      compileConstruction(graph, content.nodes, content.glyphs, content.sigils);
      await persist((current) => saveConstruction(current, graph, now));
      setSelectedConstructionId(graph.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Construção inválida.');
    }
  };

  const runArena = () => {
    try {
      const saved = constructions.find((item) => item.id === selectedConstructionId);
      const enemy = content.enemies.get(enemyId);
      if (!saved || !enemy) throw new Error('Selecione uma construção salva e um inimigo.');
      const action = compileConstruction(
        saved.graph,
        content.nodes,
        content.glyphs,
        content.sigils,
      ).action;
      const actor = createCharacterCombatActor(character, content.items, content.rules.combat, [
        action,
      ]);
      actor.side = 'party';
      actor.actionPriority = [action.id, ...actor.actionPriority];
      const initial = createCombatState(
        `arena:${now}:${saved.id}:${enemy.id}`,
        [actor, emptyCombatActor(enemy, `arena-enemy:${enemy.id}`)],
        now >>> 0,
        {},
        [...content.enemyTags.values()],
      );
      setArena(advanceCombat(initial, 30_000));
      setMessage(
        'Simulação de 30 segundos concluída; o resultado usa o motor de combate da expedição.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha na arena.');
    }
  };

  return (
    <>
      <section className="panel" aria-labelledby="expedition-codex-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Exploração</p>
            <h2 id="expedition-codex-heading">Expedições e bestiário</h2>
          </div>
        </div>
        <ul className="inventory-list">
          {[...content.expeditions.values()].map((expedition) => (
            <li key={expedition.id}>
              <span>
                <strong>{expedition.name}</strong>
                <br />
                <small>{expedition.description}</small>
                <br />
                <small>
                  Encontros:{' '}
                  {expedition.encounters
                    .map((entry) => content.enemies.get(entry.enemyId)?.name ?? entry.enemyId)
                    .join(' · ')}
                </small>
              </span>
              <strong>{expedition.activityKind.toUpperCase()}</strong>
            </li>
          ))}
        </ul>
        <label>
          Examinar criatura
          <select value={enemyId} onChange={(event) => setEnemyId(event.target.value)}>
            {[...content.enemies.values()].map((enemy) => (
              <option key={enemy.id} value={enemy.id}>
                {enemy.name}
                {enemy.boss ? ' · Chefe' : enemy.elite ? ' · Elite' : ''}
              </option>
            ))}
          </select>
        </label>
        {content.enemies.get(enemyId) && (
          <article className="codex-card">
            <h3>{content.enemies.get(enemyId)!.name}</h3>
            <p>{content.enemies.get(enemyId)!.description}</p>
            <p>
              HP {content.enemies.get(enemyId)!.hp.current} · Tenacidade{' '}
              {content.enemies.get(enemyId)!.tenacity.current} · Velocidade{' '}
              {content.enemies.get(enemyId)!.attributes.speed}
            </p>
            <p>
              Tags:{' '}
              {content.enemies
                .get(enemyId)!
                .tags.map((id) => content.enemyTags.get(id)?.name ?? id)
                .join(', ')}
            </p>
            <ul>
              {content.enemies
                .get(enemyId)!
                .tags.map((id) => content.enemyTags.get(id))
                .filter(Boolean)
                .map((tag) => (
                  <li key={tag!.id}>
                    <strong>{tag!.name}:</strong> {tag!.description} — contrajogo:{' '}
                    {tag!.interactions.map((entry) => entry.counterplay).join('; ')}
                  </li>
                ))}
            </ul>
            <p>
              Propriedades:{' '}
              {content.enemies
                .get(enemyId)!
                .tags.flatMap((id) => content.enemyTags.get(id)?.properties ?? [])
                .join(', ')}
            </p>
          </article>
        )}
      </section>

      <section className="panel" aria-labelledby="forge-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Equipamento</p>
            <h2 id="forge-heading">Forja e builds</h2>
          </div>
        </div>
        <label>
          Receita
          <select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
            {[...content.recipes.values()].map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name} ·{' '}
                {Object.entries(recipe.inputs)
                  .map(([id, count]) => `${content.items.get(id)?.name ?? id} ×${count}`)
                  .join(', ')}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary-button"
          onClick={() => void persist((current) => forgeItem(current, content, recipeId))}
          type="button"
        >
          Fabricar equipamento
        </button>
        <h3>Equipado</h3>
        <ul className="inventory-list">
          {(
            ['primary', 'secondary', 'head', 'chest', 'legs', 'hands', 'feet'] as EquipmentSlot[]
          ).map((slot) => {
            const value = character.equipment[slot];
            const id = typeof value === 'string' ? value : undefined;
            return (
              <li key={slot}>
                <span>
                  {slot}: {id ? (content.items.get(id)?.name ?? id) : 'vazio'}
                </span>
                {id && (
                  <button
                    className="quiet-button"
                    onClick={() => void persist((current) => unequipItem(current, content, slot))}
                    type="button"
                  >
                    Retirar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <h3>Itens equipáveis no inventário</h3>
        <ul className="inventory-list">
          {Object.entries(character.inventory)
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
                  Equipar
                </button>
              </li>
            ))}
        </ul>
        <h3>Prioridade de habilidades automáticas</h3>
        {equippedConstructions.length === 0 ? (
          <p className="muted">
            Equipe uma construção salva para adicioná-la ao combate automático.
          </p>
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
                      aria-label={`Priorizar ${construction.graph.name}`}
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
                      aria-label={`Despriorizar ${construction.graph.name}`}
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

      <section className="panel" aria-labelledby="node-editor-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Criação ativa</p>
            <h2 id="node-editor-heading">Editor universal de nós</h2>
          </div>
          <span className="muted">{unlocked.size} nós desbloqueados</span>
        </div>
        <label>
          Nome da construção
          <input
            value={graph.name}
            onChange={(event) => setGraph((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Identificador
          <input
            value={graph.id}
            onChange={(event) => setGraph((current) => ({ ...current, id: event.target.value }))}
          />
        </label>
        <label>
          Tipo
          <select
            value={graph.kind}
            onChange={(event) =>
              setGraph((current) => ({ ...current, kind: event.target.value as NodeGraph['kind'] }))
            }
          >
            {[
              'spell',
              'ability',
              'technique',
              'weapon',
              'armor',
              'rune',
              'consumable',
              'summon',
              'other',
            ].map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <div className="queue-actions" aria-label="Controles de zoom do canvas">
          <button
            className="quiet-button"
            onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))}
            type="button"
            aria-label="Diminuir zoom"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="quiet-button"
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
            type="button"
            aria-label="Aumentar zoom"
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
          aria-label="Canvas do grafo de nós"
        >
          <p className="muted">
            Canvas · selecione um nó para escolher onde conectar o próximo. Arraste nós do catálogo
            para o canvas ou use os controles de toque.
          </p>
          <div
            className="graph-nodes"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
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
        <label>
          Buscar nós
          <input
            value={nodeSearch}
            onChange={(event) => setNodeSearch(event.target.value)}
            placeholder="Nome do nó"
          />
        </label>
        <label>
          Filtrar categoria
          <select value={nodeCategory} onChange={(event) => setNodeCategory(event.target.value)}>
            <option value="all">Todas</option>
            {['source', 'type', 'form', 'effect', 'modifier', 'sacrifice'].map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          Catálogo de nós
          <select
            value={newDefinitionId}
            onChange={(event) => setNewDefinitionId(event.target.value)}
          >
            {filteredNodes.map((node) => (
              <option key={node.id} value={node.id} disabled={!unlocked.has(node.id)}>
                {unlocked.has(node.id) ? '◆' : '🔒'} {node.category} · {node.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Conectar a
          <select
            value={selectedParent}
            onChange={(event) => setSelectedParent(event.target.value)}
          >
            {graph.nodes.map((node) => (
              <option key={node.instanceId} value={node.instanceId}>
                {canvasDefinitions.get(node.definitionId)?.name ?? node.instanceId} (
                {node.instanceId})
              </option>
            ))}
          </select>
        </label>
        <button
          className="quiet-button"
          disabled={!unlocked.has(newDefinitionId)}
          draggable
          onDragStart={(event) => event.dataTransfer.setData('text/plain', newDefinitionId)}
          onClick={() => addGraphNode(newDefinitionId, selectedParent)}
          type="button"
        >
          Adicionar e conectar nó
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
                  setGraph((current) => ({
                    ...current,
                    nodes: current.nodes.map((entry) =>
                      entry.instanceId === node.instanceId
                        ? {
                            ...entry,
                            parameters: { ...entry.parameters, amount: Number(event.target.value) },
                          }
                        : entry,
                    ),
                  }))
                }
              />
            </label>
          ) : null;
        })}
        <label>
          Glyph
          <select
            value={graph.glyphIds[0] ?? ''}
            onChange={(event) =>
              setGraph((current) => ({
                ...current,
                glyphIds: event.target.value ? [event.target.value] : [],
              }))
            }
          >
            <option value="">Nenhum</option>
            {content.glyphs.map((glyph) => (
              <option key={glyph.id} value={glyph.id}>
                {glyph.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sigil
          <select
            value={graph.sigilIds?.[0] ?? ''}
            onChange={(event) =>
              setGraph((current) => ({
                ...current,
                sigilIds: event.target.value ? [event.target.value] : [],
              }))
            }
          >
            <option value="">Nenhum</option>
            {content.sigils.map((sigil) => (
              <option key={sigil.id} value={sigil.id}>
                {sigil.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" onClick={() => void saveGraph()} type="button">
          Validar e salvar grafo
        </button>
        <label>
          Construções salvas
          <select
            value={selectedConstructionId}
            onChange={(event) => setSelectedConstructionId(event.target.value)}
          >
            <option value="">Selecione</option>
            {constructions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.graph.name} ({entry.id})
              </option>
            ))}
          </select>
        </label>
        {selectedConstructionId && (
          <div className="queue-actions">
            <button
              className="quiet-button"
              onClick={() => {
                const found = constructions.find((entry) => entry.id === selectedConstructionId);
                if (found) setGraph(structuredClone(found.graph));
              }}
              type="button"
            >
              Editar selecionada
            </button>
            <button
              className="quiet-button"
              onClick={() =>
                void persist((current) =>
                  duplicateConstruction(current, selectedConstructionId, copyId, now),
                )
              }
              type="button"
            >
              Duplicar
            </button>
            <label className="sr-only" htmlFor="construction-copy-id">
              ID da cópia
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
                  void persist((current) => unequipConstruction(current, selectedConstructionId))
                }
                type="button"
              >
                Desequipar
              </button>
            ) : (
              <button
                className="quiet-button"
                onClick={() =>
                  void persist((current) => equipConstruction(current, selectedConstructionId))
                }
                type="button"
              >
                Equipar build
              </button>
            )}
          </div>
        )}
        <div className="arena-box">
          <h3>Arena de testes</h3>
          <p>
            Executa a construção selecionada contra o inimigo atual no mesmo motor orientado a
            eventos.
          </p>
          <button
            className="primary-button"
            disabled={!selectedConstructionId}
            onClick={runArena}
            type="button"
          >
            Executar simulação
          </button>
          {arena && (
            <>
              <p>
                Tempo virtual: {arena.nowMs} ms · vencedor: {arena.winner ?? 'não decidido'}
              </p>
              <button
                className="quiet-button"
                onClick={() => setDetail((value) => !value)}
                type="button"
              >
                {detail ? 'Resumo' : 'Ver log detalhado'}
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
        {message && (
          <p className="muted" role="status">
            {message}
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="combat-history-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Relatórios</p>
            <h2 id="combat-history-heading">Combates recentes</h2>
          </div>
        </div>
        {combatRecords.length ? (
          combatRecords
            .slice()
            .reverse()
            .map((record) => (
              <details key={record.id}>
                <summary>
                  {record.expeditionId} · {record.kills} derrotas · {record.deaths} mortes ·{' '}
                  {record.experience} XP
                </summary>
                <p>
                  Seed {record.seed} · {record.virtualDurationMs} ms ·{' '}
                  {record.drops
                    .map(
                      (drop) =>
                        `${content.items.get(drop.itemId)?.name ?? drop.itemId} ×${drop.quantity}`,
                    )
                    .join(', ') || 'sem drops'}
                </p>
                {record.combats.map((combat) => (
                  <details key={combat.id}>
                    <summary>
                      {combat.id} · {combat.log.length} eventos
                    </summary>
                    <pre className="combat-log">
                      {logText(combat)}
                      {detail ? `\n\n${JSON.stringify(combat.log, null, 2)}` : ''}
                    </pre>
                    <button
                      className="quiet-button"
                      onClick={() => setDetail((value) => !value)}
                      type="button"
                    >
                      Alternar detalhes
                    </button>
                  </details>
                ))}
              </details>
            ))
        ) : (
          <p className="empty-state">Ainda não há expedições concluídas com combate.</p>
        )}
      </section>
    </>
  );
}
