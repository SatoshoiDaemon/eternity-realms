import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../domain/types';
import {
  IDLE_QUEUE_NOTIFICATION_ID,
  notifyMissionReady,
  requestLocalNotificationPermission,
  REWARD_NOTIFICATION_ID,
  SESSION_NOTIFICATION_ID,
  syncSessionNotification,
  type LocalNotificationPort,
} from './session-notifications';

const activeSession: Session = {
  id: 's-1',
  activityId: 'mining',
  durationMs: 60_000,
  status: 'active',
  createdAt: 0,
  startedAt: 0,
  elapsedMs: 20_000,
  lastObservedAt: 30_000,
};

function notificationMock(): LocalNotificationPort & {
  cancel: ReturnType<typeof vi.fn>;
  schedule: ReturnType<typeof vi.fn>;
} {
  return { cancel: vi.fn(async () => undefined), schedule: vi.fn(async () => undefined) };
}

describe('Android session notification scheduling', () => {
  it('replaces a scheduled notification using persisted elapsed progress', async () => {
    const plugin = notificationMock();
    await syncSessionNotification(plugin, activeSession, 10_000, {
      sessionComplete: true,
      rewards: false,
      queueIdle: false,
    });

    expect(plugin.cancel).toHaveBeenCalledWith({
      notifications: [
        { id: SESSION_NOTIFICATION_ID },
        { id: REWARD_NOTIFICATION_ID },
        { id: IDLE_QUEUE_NOTIFICATION_ID },
      ],
    });
    expect(plugin.schedule).toHaveBeenCalledWith({
      notifications: [
        expect.objectContaining({
          id: SESSION_NOTIFICATION_ID,
          isExactNotification: false,
          schedule: { at: new Date(50_000) },
        }),
      ],
    });
  });

  it('cancels stale notifications when disabled, idle, queued, or given an unsafe target time', async () => {
    const plugin = notificationMock();
    await syncSessionNotification(plugin, activeSession, 10_000, false);
    await syncSessionNotification(plugin, undefined, 10_000, true);
    await syncSessionNotification(plugin, { ...activeSession, status: 'queued' }, 10_000, true);
    await syncSessionNotification(
      plugin,
      { ...activeSession, elapsedMs: 0, lastObservedAt: undefined },
      Number.MAX_SAFE_INTEGER - 10,
      true,
    );
    expect(plugin.cancel).toHaveBeenCalledTimes(4);
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it('schedules independent reward and idle queue notifications and can notify a newly ready mission', async () => {
    const plugin = notificationMock();
    await syncSessionNotification(
      plugin,
      activeSession,
      10_000,
      { sessionComplete: false, rewards: true, queueIdle: true },
      1,
    );
    const notifications = plugin.schedule.mock.calls[0]?.[0].notifications;
    expect(notifications?.map((notification: { id: number }) => notification.id)).toEqual([
      REWARD_NOTIFICATION_ID,
      IDLE_QUEUE_NOTIFICATION_ID,
    ]);
    expect(
      notifications?.every(
        (notification: { isExactNotification?: boolean }) =>
          notification.isExactNotification === false,
      ),
    ).toBe(true);
    await syncSessionNotification(
      plugin,
      activeSession,
      10_000,
      { sessionComplete: false, rewards: false, queueIdle: true },
      2,
    );
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
    await notifyMissionReady(plugin, 8_001, 'Primeiros passos', 20_000);
    expect(plugin.schedule.mock.calls[1]?.[0].notifications[0]).toMatchObject({
      id: 8_001,
      title: 'Missão concluída',
      isExactNotification: false,
      schedule: { at: new Date(20_000) },
    });
  });

  it('requests permission only when it is not already granted', async () => {
    const granted = {
      checkPermissions: vi.fn(async () => ({ display: 'granted' })),
      requestPermissions: vi.fn(async () => ({})),
    };
    const denied = {
      checkPermissions: vi.fn(async () => ({ display: 'denied' })),
      requestPermissions: vi.fn(async () => ({})),
    };
    await requestLocalNotificationPermission(granted);
    await requestLocalNotificationPermission(denied);
    expect(granted.requestPermissions).not.toHaveBeenCalled();
    expect(denied.requestPermissions).toHaveBeenCalledOnce();
  });
});
