import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadOfficialContent, type ContentCatalog } from '../content/registry';
import {
  cancelActiveSession,
  editQueuedSession,
  enqueueSession,
  getSessionProgress,
  reconcileSessions,
  reorderQueuedSession,
} from '../domain/session-engine';
import { createCharacter, createInitialGameState } from '../domain/model';
import type { GameState, Session } from '../domain/types';
import './game-app.css';

export interface GameRepositoryPort {
  transact(reducer: (current: GameState | null) => GameState): Promise<GameState>;
}

interface GameAppProps {
  repository: GameRepositoryPort;
  content?: ContentCatalog;
  clock?: () => number;
  makeId?: () => string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

function describeSession(session: Session, activityName: string): string {
  if (session.status === 'active') {
    return `${activityName} · em andamento`;
  }
  return `${activityName} · na fila`;
}

export function GameApp({
  repository,
  content = loadOfficialContent(),
  clock = Date.now,
  makeId = () => crypto.randomUUID(),
}: GameAppProps) {
  const [state, setState] = useState<GameState | null>(null);
  const [name, setName] = useState('');
  const [activityId, setActivityId] = useState(content.activities.keys().next().value ?? '');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState('');
  const queuedSessions = useMemo(() => {
    const sessions = new Map((state?.sessions ?? []).map((session) => [session.id, session]));
    return (state?.queue ?? []).flatMap((sessionId) => {
      const session = sessions.get(sessionId);
      return session ? [session] : [];
    });
  }, [state]);

  const refresh = useCallback(async () => {
    try {
      const next = await repository.transact((current) =>
        reconcileSessions(current ?? createInitialGameState(), clock(), content),
      );
      setState(next);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [clock, content, repository]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refresh]);

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [refresh]);

  const createCharacterAction = async () => {
    setErrorMessage('');
    try {
      const next = await repository.transact((current) => {
        const race = content.races.values().next().value;
        const characterClass = content.classes.values().next().value;
        if (!race || !characterClass) {
          throw new Error('Nenhuma raça ou classe inicial foi carregada.');
        }
        return {
          ...(current ?? createInitialGameState()),
          character: createCharacter({
            id: makeId(),
            name: name.trim() || 'Aventureiro',
            raceId: race.id,
            classId: characterClass.id,
          }),
        };
      });
      setState(next);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const addSessionAction = async () => {
    setErrorMessage('');
    try {
      const next = await repository.transact((current) =>
        enqueueSession(
          current ?? createInitialGameState(),
          { id: makeId(), activityId, durationMs: Number(durationMinutes) * 60_000 },
          content,
          clock(),
        ),
      );
      setState(next);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const cancelSessionAction = async () => {
    setErrorMessage('');
    try {
      const next = await repository.transact((current) =>
        cancelActiveSession(current ?? createInitialGameState(), clock()),
      );
      setState(next);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const saveDurationAction = async (session: Session) => {
    setErrorMessage('');
    try {
      const next = await repository.transact((current) =>
        editQueuedSession(
          current ?? createInitialGameState(),
          session.id,
          {
            durationMs: Number(durationDrafts[session.id] ?? session.durationMs / 60_000) * 60_000,
          },
          content,
        ),
      );
      setState(next);
      setDurationDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[session.id];
        return nextDrafts;
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const moveSessionUpAction = async (session: Session) => {
    setErrorMessage('');
    try {
      const next = await repository.transact((current) => {
        const game = current ?? createInitialGameState();
        return reorderQueuedSession(game, session.id, game.queue.indexOf(session.id) - 1);
      });
      setState(next);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const character = state?.character ?? null;
  const activeSession = queuedSessions.find((session) => session.status === 'active');
  const progress = activeSession ? getSessionProgress(activeSession, clock()) : null;

  return (
    <main className="game-shell">
      <header className="game-header">
        <div>
          <p className="eyebrow">RPG idle offline</p>
          <h1>Eternity Realms</h1>
        </div>
        <button className="quiet-button" onClick={() => void refresh()} type="button">
          Atualizar progresso
        </button>
      </header>

      {errorMessage && (
        <p className="error-banner" role="alert">
          {errorMessage}
        </p>
      )}

      {!character ? (
        <section className="panel character-creation" aria-labelledby="create-heading">
          <p className="eyebrow">Começo de jornada</p>
          <h2 id="create-heading">Crie seu personagem</h2>
          <label htmlFor="character-name">Nome do personagem</label>
          <input
            id="character-name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Aventureiro"
          />
          <button
            className="primary-button"
            onClick={() => void createCharacterAction()}
            type="button"
          >
            Criar personagem
          </button>
        </section>
      ) : (
        <>
          <section className="panel character-card" aria-labelledby="character-heading">
            <div>
              <p className="eyebrow">Personagem</p>
              <h2 id="character-heading">{character.name}</h2>
              <p className="muted">
                {content.races.get(character.raceId)?.name ?? character.raceId}
              </p>
            </div>
            <div className="level-badge">
              <strong>Nível {character.level}</strong>
              <span>
                {character.experience.current} / {content.rules.experiencePerLevel} XP
              </span>
            </div>
          </section>

          <section className="panel" aria-labelledby="activities-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Planejamento</p>
                <h2 id="activities-heading">Atividades</h2>
              </div>
              <span className="queue-count">{state!.queue.length} / 5 sessões</span>
            </div>
            <div className="session-form">
              <label>
                Atividade
                <select value={activityId} onChange={(event) => setActivityId(event.target.value)}>
                  {[...content.activities.values()].map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activity.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Duração (minutos)
                <input
                  type="number"
                  min="1"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                />
              </label>
              <button
                className="primary-button"
                onClick={() => void addSessionAction()}
                type="button"
              >
                Adicionar sessão
              </button>
            </div>

            {activeSession && progress && (
              <div className="active-session">
                <div className="session-title-row">
                  <strong>
                    {describeSession(
                      activeSession,
                      content.activities.get(activeSession.activityId)?.name ??
                        activeSession.activityId,
                    )}
                  </strong>
                  <span>
                    {Math.floor(progress.elapsedMs / 60_000)} /{' '}
                    {Math.ceil(activeSession.durationMs / 60_000)} min
                  </span>
                </div>
                <progress
                  aria-label="Progresso da sessão ativa"
                  max={1}
                  value={progress.fraction}
                />
                <button
                  className="danger-button"
                  onClick={() => void cancelSessionAction()}
                  type="button"
                >
                  Cancelar sessão ativa
                </button>
              </div>
            )}

            <ol className="queue-list" aria-label="Fila de sessões">
              {queuedSessions.map((session, index) => {
                const activityName =
                  content.activities.get(session.activityId)?.name ?? session.activityId;
                if (session.status === 'active') {
                  return null;
                }
                return (
                  <li key={session.id} className="queue-item">
                    <div>
                      <strong>{describeSession(session, activityName)}</strong>
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
                          setDurationDrafts((drafts) => ({
                            ...drafts,
                            [session.id]: event.target.value,
                          }))
                        }
                      />
                      <button
                        className="quiet-button"
                        onClick={() => void saveDurationAction(session)}
                        type="button"
                      >
                        Salvar duração
                      </button>
                      <button
                        className="quiet-button"
                        aria-label={`Mover sessão ${index + 1} para cima`}
                        disabled={index <= 1}
                        onClick={() => void moveSessionUpAction(session)}
                        type="button"
                      >
                        ↑
                      </button>
                    </div>
                  </li>
                );
              })}
              {queuedSessions.length === 0 && (
                <li className="empty-state">Nenhuma sessão na fila.</li>
              )}
            </ol>
          </section>

          <section className="panel" aria-labelledby="inventory-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Pertences</p>
                <h2 id="inventory-heading">Inventário</h2>
              </div>
              <span className="muted">Sem limite de espaço</span>
            </div>
            {Object.entries(character.inventory).length > 0 ? (
              <ul className="inventory-list">
                {Object.entries(character.inventory).map(([itemId, quantity]) => (
                  <li key={itemId}>
                    <span>{content.items.get(itemId)?.name ?? itemId}</span>
                    <strong>{quantity}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Seu inventário está vazio.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
