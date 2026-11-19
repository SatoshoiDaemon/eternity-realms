import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapGame } from './bootstrap';

vi.mock('./bootstrap', () => ({ bootstrapGame: vi.fn() }));

describe('browser entrypoint', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.mocked(bootstrapGame).mockReset();
    vi.resetModules();
  });

  it('shows a safe retry screen without exposing startup internals', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    vi.mocked(bootstrapGame)
      .mockRejectedValueOnce(new Error('database is locked: PRAGMA journal_mode'))
      .mockResolvedValueOnce(undefined as never);

    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Não foi possível iniciar o jogo'));
    expect(root.textContent).not.toContain('PRAGMA journal_mode');
    expect(root.querySelector('button')).toHaveTextContent('Tentar novamente');
    expect(bootstrapGame).toHaveBeenCalledWith(root);

    root.querySelector('button')?.click();
    await vi.waitFor(() => expect(bootstrapGame).toHaveBeenCalledTimes(2));
  });

  it('does nothing when the root element is absent', async () => {
    await import('./main');
    expect(bootstrapGame).not.toHaveBeenCalled();
  });

  it('renders a readable message for non-Error startup failures', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    vi.mocked(bootstrapGame).mockRejectedValueOnce('unexpected');

    await import('./main');
    await vi.waitFor(() =>
      expect(root.textContent).toContain('O jogo não conseguiu abrir os dados locais.'),
    );
    expect(root.textContent).not.toContain('unexpected');
  });
});
