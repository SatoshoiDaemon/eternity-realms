import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCapacitorRepository } from './persistence/open-capacitor-repository';
import { bootstrapGame } from './bootstrap';

vi.mock('./persistence/open-capacitor-repository', () => ({
  openCapacitorRepository: vi.fn(),
}));

describe('application bootstrap', () => {
  beforeEach(() => {
    vi.mocked(openCapacitorRepository).mockReset();
  });

  it('mounts the game after the local SQLite repository is ready', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const repository = { transact: vi.fn(async (reducer) => reducer(null)) };
    vi.mocked(openCapacitorRepository).mockResolvedValue(repository as never);

    await bootstrapGame(root);

    expect(await screen.findByRole('heading', { name: 'Eternity Realms' })).toBeInTheDocument();
  });

  it('fails clearly when the HTML root element is missing', async () => {
    await expect(bootstrapGame(null)).rejects.toThrow('App root element #root was not found.');
    expect(openCapacitorRepository).not.toHaveBeenCalled();
  });

  it('propagates local database startup errors to the entrypoint', async () => {
    vi.mocked(openCapacitorRepository).mockRejectedValue(new Error('SQLite unavailable.'));
    await expect(bootstrapGame(document.createElement('div'))).rejects.toThrow(
      'SQLite unavailable.',
    );
  });
});
