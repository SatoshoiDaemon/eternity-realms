import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameState } from '../domain/model';
import type { GameState } from '../domain/types';
import { loadContentPacks } from '../content/registry';
import { createTestState, testCatalog } from '../test/fixtures';
import { GameApp } from './GameApp';

class MemoryRepository {
  state: GameState | null;
  failNext = false;
  failWith: unknown = new Error('Database unavailable.');
  returnNullNext = false;

  constructor(initialState: GameState | null = null) {
    this.state = initialState;
  }

  async transact(reducer: (state: GameState | null) => GameState): Promise<GameState> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failWith;
    }
    const current = this.returnNullNext ? null : this.state;
    this.returnNullNext = false;
    const reduced = reducer(current);
    this.state = { ...reduced, revision: (current?.revision ?? 0) + 1 };
    return this.state;
  }
}

describe('mobile-first game flow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a character, runs 30 minutes of mining offline, receives one reward, and queues another session', async () => {
    const repository = new MemoryRepository();
    let now = 1_000;
    let nextId = 0;
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => now}
        makeId={() => `generated-${++nextId}`}
      />,
    );

    await screen.findByRole('heading', { name: 'Eternity Realms' });
    fireEvent.change(screen.getByLabelText('Nome do personagem'), { target: { value: 'Aria' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    expect(await screen.findByRole('heading', { name: 'Aria' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    expect(await screen.findByText('Mining · em andamento')).toBeInTheDocument();

    now += 1_800_000;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));

    const ironOre = await screen.findByText('Iron Ore');
    expect(ironOre.parentElement).toHaveTextContent('2');
    expect(screen.getByText('Nível 2')).toBeInTheDocument();
    expect(
      repository.state?.events.filter((event) => event.type === 'reward.granted'),
    ).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Atividade'), { target: { value: 'foraging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    expect(await screen.findByText('Foraging · em andamento')).toBeInTheDocument();
    expect(repository.state?.queue).toEqual(['generated-3']);
    expect(
      repository.state?.sessions.find((session) => session.id === 'generated-3')?.activityId,
    ).toBe('foraging');
  });

  it('lets the player cancel the active session without a reward and preserves the next session', async () => {
    const repository = new MemoryRepository();
    let id = 0;
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 500}
        makeId={() => `s${++id}`}
      />,
    );

    await screen.findByRole('heading', { name: 'Eternity Realms' });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await screen.findByRole('heading', { name: 'Aventureiro' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · em andamento');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · na fila');
    repository.failNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão ativa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão ativa' }));

    await waitFor(() => expect(repository.state?.sessions[0]?.status).toBe('cancelled'));
    expect(repository.state?.sessions[1]).toMatchObject({ status: 'active', startedAt: 500 });
    expect(repository.state?.character?.inventory).toEqual({});
  });

  it('shows persistence errors and can retry after the repository becomes available', async () => {
    const repository = new MemoryRepository();
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 0}
        makeId={() => 'character'}
      />,
    );
    await screen.findByRole('heading', { name: 'Eternity Realms' });
    repository.failNext = true;

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar progresso' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reports an unexpected message when a storage failure is not an Error object', async () => {
    const repository = new MemoryRepository();
    repository.failNext = true;
    repository.failWith = 'disk failure';
    render(
      <GameApp repository={repository} content={testCatalog} clock={() => 0} makeId={() => 'x'} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro inesperado.');
  });

  it('reports missing starter content instead of creating a broken character', async () => {
    const repository = new MemoryRepository();
    const emptyContent = loadContentPacks([
      { manifest: { id: 'empty', name: 'Empty', version: '1.0.0' }, records: [] },
    ]);
    render(
      <GameApp repository={repository} content={emptyContent} clock={() => 0} makeId={() => 'x'} />,
    );

    await screen.findByRole('heading', { name: 'Eternity Realms' });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nenhuma raça ou classe inicial foi carregada.',
    );
    expect(repository.state?.character).toBeNull();
  });

  it('uses a default character name and refreshes on foreground focus', async () => {
    const repository = new MemoryRepository();
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 0}
        makeId={() => 'default-id'}
      />,
    );

    await screen.findByRole('heading', { name: 'Eternity Realms' });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    expect(await screen.findByRole('heading', { name: 'Aventureiro' })).toBeInTheDocument();
    const previousRevision = repository.state?.revision;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(repository.state?.revision).toBeGreaterThan(previousRevision ?? 0));
  });

  it('lets the player choose an activity, edit a queued duration, and reorder the queue', async () => {
    const repository = new MemoryRepository();
    let id = 0;
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 0}
        makeId={() => `q${++id}`}
      />,
    );
    await screen.findByRole('heading', { name: 'Eternity Realms' });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await screen.findByRole('heading', { name: 'Aventureiro' });
    fireEvent.change(screen.getByLabelText('Atividade'), { target: { value: 'foraging' } });
    fireEvent.change(screen.getByLabelText('Duração (minutos)'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Foraging · em andamento');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Foraging · na fila');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByLabelText('Duração da sessão 3 em minutos');

    fireEvent.click(screen.getByRole('button', { name: 'Mover sessão 3 para cima' }));
    await waitFor(() => expect(repository.state?.queue).toEqual(['q2', 'q4', 'q3']));
    fireEvent.change(screen.getByLabelText('Duração da sessão 2 em minutos'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar duração' })[0]!);
    await waitFor(() =>
      expect(repository.state?.sessions.find((session) => session.id === 'q4')?.durationMs).toBe(
        90 * 60_000,
      ),
    );
  });

  it('shows actionable errors when adding, editing, reordering, or cancelling cannot be persisted', async () => {
    const repository = new MemoryRepository();
    let id = 0;
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 0}
        makeId={() => `e${++id}`}
      />,
    );
    await screen.findByRole('heading', { name: 'Eternity Realms' });
    repository.failNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await screen.findByRole('heading', { name: 'Aventureiro' });
    fireEvent.change(screen.getByLabelText('Duração (minutos)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session duration must be a positive safe integer.',
    );
    fireEvent.change(screen.getByLabelText('Duração (minutos)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · em andamento');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · na fila');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByLabelText('Duração da sessão 3 em minutos');
    repository.failNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mover sessão 3 para cima' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    repository.failNext = true;
    fireEvent.change(screen.getByLabelText('Duração da sessão 2 em minutos'), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar duração' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
  });

  it('rebuilds missing working state in UI actions when a repository returns no save', async () => {
    const repository = new MemoryRepository();
    let id = 0;
    render(
      <GameApp
        repository={repository}
        content={testCatalog}
        clock={() => 0}
        makeId={() => `n${++id}`}
      />,
    );
    await screen.findByRole('heading', { name: 'Eternity Realms' });
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await screen.findByRole('heading', { name: 'Aventureiro' });
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A character is required before starting a session.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · em andamento');
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão ativa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'There is no active session to cancel.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByText('Mining · na fila');
    repository.returnNullNext = true;
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar duração' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown session: n4');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão' }));
    await screen.findByLabelText('Duração da sessão 3 em minutos');
    repository.returnNullNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mover sessão 3 para cima' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown session: n5');
  });

  it('handles stale mod references and ignores background visibility refreshes', async () => {
    const content = { ...testCatalog, activities: new Map(testCatalog.activities) };
    const initial = createTestState();
    initial.character!.raceId = 'modded-race';
    initial.character!.inventory = { 'modded-item': 3 };
    initial.character!.activityState = 'active';
    initial.queue = ['active-session'];
    initial.sessions = [
      {
        id: 'active-session',
        activityId: 'mining',
        durationMs: 60_000,
        status: 'active',
        createdAt: 0,
        startedAt: 0,
      },
    ];
    const repository = new MemoryRepository(initial);
    render(
      <GameApp repository={repository} content={content} clock={() => 0} makeId={() => 'id'} />,
    );
    expect(await screen.findByText('modded-race')).toBeInTheDocument();
    expect(screen.getByText('modded-item')).toBeInTheDocument();
    expect(await screen.findByText('Mining · em andamento')).toBeInTheDocument();
    content.activities.delete('mining');
    fireEvent.change(screen.getByLabelText('Atividade'), { target: { value: 'foraging' } });
    expect(screen.getByText('mining · em andamento')).toBeInTheDocument();
    const revision = repository.state?.revision;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.state?.revision).toBe(revision);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('shows ids for queued content removed by a mod', async () => {
    const state = createTestState();
    state.character!.activityState = 'active';
    state.queue = ['active-session', 'queued-session'];
    state.sessions = [
      {
        id: 'active-session',
        activityId: 'mining',
        durationMs: 100_000,
        status: 'active',
        createdAt: 0,
        startedAt: 0,
      },
      {
        id: 'queued-session',
        activityId: 'removed-by-mod',
        durationMs: 100_000,
        status: 'queued',
        createdAt: 0,
      },
    ];
    const repository = new MemoryRepository(state);
    render(
      <GameApp repository={repository} content={testCatalog} clock={() => 0} makeId={() => 'id'} />,
    );

    expect(await screen.findByText('removed-by-mod · na fila')).toBeInTheDocument();
  });

  it('keeps missing queue references harmless in an otherwise empty save', async () => {
    const empty = { ...createInitialGameState(), queue: ['missing-session'] };
    const repository = new MemoryRepository(empty);
    render(
      <GameApp repository={repository} content={testCatalog} clock={() => 0} makeId={() => 'id'} />,
    );
    expect(await screen.findByRole('heading', { name: 'Crie seu personagem' })).toBeInTheDocument();
  });

  it('uses browser crypto when the caller does not inject an id generator', async () => {
    const repository = new MemoryRepository();
    const randomUUID = vi.fn(() => 'browser-generated-id');
    vi.stubGlobal('crypto', { randomUUID });
    render(<GameApp repository={repository} content={testCatalog} clock={() => 0} />);
    await screen.findByRole('heading', { name: 'Eternity Realms' });
    fireEvent.click(screen.getByRole('button', { name: 'Criar personagem' }));
    await screen.findByRole('heading', { name: 'Aventureiro' });
    expect(repository.state?.character?.id).toBe('browser-generated-id');
  });
});
