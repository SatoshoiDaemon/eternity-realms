import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../domain/types';
import { testCatalog } from '../test/fixtures';
import { SessionProgress } from './GameApp';

const session: Session = {
  id: 'timer-session',
  activityId: 'mining',
  durationMs: 2_000,
  status: 'active',
  createdAt: 1_000,
  startedAt: 1_000,
  elapsedMs: 0,
  lastObservedAt: 1_000,
};

afterEach(() => vi.useRealTimers());

describe('active session progress clock', () => {
  it('updates progress once per second and removes its interval on unmount', () => {
    vi.useFakeTimers();
    let now = 1_000;
    const view = render(
      <SessionProgress session={session} content={testCatalog} clock={() => now} />,
    );
    expect(screen.getByRole('progressbar', { name: 'Progresso da sessão ativa' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    now = 2_000;
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('progressbar', { name: 'Progresso da sessão ativa' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
