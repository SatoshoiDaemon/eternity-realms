import { describe, expect, it } from 'vitest';
import { t, userFacingError } from './i18n';

describe('localized user-facing errors', () => {
  it('uses the generic message when the error is missing or empty', () => {
    expect(userFacingError(null)).toBe(t('error.generic'));
    expect(userFacingError(new Error('  '))).toBe(t('error.generic'));
  });

  it('hides internal session and content identifiers', () => {
    expect(userFacingError(new Error('Unknown session: session-42'))).toBe(
      t('error.session.missing'),
    );
    expect(userFacingError(new Error('Unknown activity: activity-42'))).toBe(
      t('error.content.missing'),
    );
    expect(userFacingError(new Error('Unknown reward: reward-42'))).toBe(
      t('error.content.missing'),
    );
  });

  it('translates expected session validation failures', () => {
    expect(userFacingError(new Error('Session duration must be a positive safe integer.'))).toBe(
      t('error.session.duration'),
    );
    expect(userFacingError(new Error('There is no active session to cancel.'))).toBe(
      t('error.session.noActive'),
    );
    expect(userFacingError(new Error('A character is required before starting a session.'))).toBe(
      t('error.session.characterRequired'),
    );
  });

  it('keeps authored Portuguese errors and replaces known infrastructure errors', () => {
    expect(userFacingError(new Error('A fila não pôde ser salva.'))).toBe(
      'A fila não pôde ser salva.',
    );
    expect(userFacingError(new Error('sqlite transaction failed'))).toBe(t('error.generic'));
    expect(userFacingError(new Error('Database unavailable.'))).toBe(t('error.generic'));
  });
});
