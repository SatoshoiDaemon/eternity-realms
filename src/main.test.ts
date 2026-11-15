import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapGame } from './bootstrap';

vi.mock('./bootstrap', () => ({ bootstrapGame: vi.fn() }));

describe('browser entrypoint', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.mocked(bootstrapGame).mockReset();
    vi.resetModules();
  });

  it('starts bootstrap when the root exists and renders a local startup error', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    vi.mocked(bootstrapGame).mockRejectedValueOnce(new Error('SQLite unavailable.'));

    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toBe('SQLite unavailable.'));
    expect(bootstrapGame).toHaveBeenCalledWith(root);
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
    await vi.waitFor(() => expect(root.textContent).toBe('Ocorreu um erro inesperado.'));
  });
});
