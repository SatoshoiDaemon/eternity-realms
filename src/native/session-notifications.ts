import { LocalNotifications } from '@capacitor/local-notifications';
import { getSessionProgress } from '../domain/session-engine';
import type { Session } from '../domain/types';

export const SESSION_NOTIFICATION_ID = 7301;
export const REWARD_NOTIFICATION_ID = 7302;
export const IDLE_QUEUE_NOTIFICATION_ID = 7303;

export interface LocalNotificationPort {
  cancel(options: { notifications: Array<{ id: number }> }): Promise<unknown>;
  schedule(options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      isExactNotification: false;
      schedule: { at: Date };
    }>;
  }): Promise<unknown>;
}

export async function syncSessionNotification(
  plugin: LocalNotificationPort,
  session: Session | undefined,
  now: number,
  preferences: boolean | { sessionComplete: boolean; rewards: boolean; queueIdle: boolean },
  queueLength = session ? 1 : 0,
): Promise<void> {
  await plugin.cancel({
    notifications: [
      SESSION_NOTIFICATION_ID,
      REWARD_NOTIFICATION_ID,
      IDLE_QUEUE_NOTIFICATION_ID,
    ].map((id) => ({ id })),
  });
  const settings =
    typeof preferences === 'boolean'
      ? { sessionComplete: preferences, rewards: false, queueIdle: false }
      : preferences;
  if (
    (!settings.sessionComplete && !settings.rewards && !settings.queueIdle) ||
    !session ||
    session.status !== 'active'
  )
    return;
  const { elapsedMs } = getSessionProgress(session, now);
  const remainingMs = Math.max(0, session.durationMs - elapsedMs);
  const notificationAt = now + remainingMs;
  if (!Number.isSafeInteger(notificationAt) || !Number.isFinite(new Date(notificationAt).getTime()))
    return;
  const notifications = [];
  if (settings.sessionComplete)
    notifications.push({
      id: SESSION_NOTIFICATION_ID,
      title: 'Sessão concluída',
      body: 'Sua sessão terminou. Confira o progresso da jornada.',
      isExactNotification: false as const,
      schedule: { at: new Date(notificationAt) },
    });
  if (settings.rewards)
    notifications.push({
      id: REWARD_NOTIFICATION_ID,
      title: 'Recompensas disponíveis',
      body: 'Os recursos e a experiência da sessão foram adicionados ao personagem.',
      isExactNotification: false as const,
      schedule: { at: new Date(notificationAt) },
    });
  if (settings.queueIdle && queueLength === 1)
    notifications.push({
      id: IDLE_QUEUE_NOTIFICATION_ID,
      title: 'Fila de sessões ociosa',
      body: 'Todas as sessões planejadas foram concluídas. Organize a próxima fila.',
      isExactNotification: false as const,
      schedule: { at: new Date(notificationAt) },
    });
  if (!notifications.length) return;
  await plugin.schedule({
    notifications,
  });
}

export async function notifyMissionReady(
  plugin: LocalNotificationPort,
  id: number,
  missionName: string,
  now: number,
): Promise<void> {
  await plugin.schedule({
    notifications: [
      {
        id,
        title: 'Missão concluída',
        body: `${missionName}: sua recompensa pode ser resgatada.`,
        isExactNotification: false as const,
        schedule: { at: new Date(now) },
      },
    ],
  });
}

export interface NotificationPermissionPort {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<unknown>;
}

export async function requestLocalNotificationPermission(
  plugin: NotificationPermissionPort = LocalNotifications,
): Promise<void> {
  const permission = await plugin.checkPermissions();
  if (permission.display === 'granted') return;
  await plugin.requestPermissions();
}

export const localNotificationPort: LocalNotificationPort = {
  cancel: (options) => LocalNotifications.cancel(options),
  schedule: (options) => LocalNotifications.schedule(options),
};
