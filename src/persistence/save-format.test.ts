import { describe, expect, it } from 'vitest';
import { createTestState } from '../test/fixtures';
import { createSaveFile, parseSaveFile, SAVE_FORMAT_VERSION } from './save-format';
import type { GameState } from '../domain/types';

const metadata = {
  applicationVersion: '0.2.0',
  databaseVersion: 2,
  exportedAt: 1_700_000_000_000,
  modDependencies: ['core', 'test.mod', 'test.mod'],
};

describe('versioned save files', () => {
  it('exports an integrity-checked envelope with independent app, database, and save versions', () => {
    const source = createSaveFile(createTestState(), metadata);
    const parsed = parseSaveFile(source);

    expect(JSON.parse(source)).toMatchObject({
      formatVersion: SAVE_FORMAT_VERSION,
      applicationVersion: '0.2.0',
      databaseVersion: 2,
      modDependencies: ['core', 'test.mod'],
    });
    expect(parsed.gameState.character?.name).toBe('Test Hero');
    expect(parsed.metadata).toEqual({ ...metadata, modDependencies: ['core', 'test.mod'] });
    expect(parsed.migratedFrom).toBe(SAVE_FORMAT_VERSION);
  });

  it('preserves the selected Sem Afinidade stage in the save payload', () => {
    const state = createTestState();
    state.character!.energy = {
      affinity: 'unaffiliated',
      unaffiliatedStage: 'incomplete',
      reserves: {},
    };
    const parsed = parseSaveFile(createSaveFile(state, metadata));

    expect(parsed.gameState.character?.energy).toEqual({
      affinity: 'unaffiliated',
      unaffiliatedStage: 'incomplete',
      reserves: {},
    });
  });

  it('migrates legacy raw saves and fills new optional fields without changing the game state version', () => {
    const legacy = { ...createTestState() } as Record<string, unknown>;
    delete legacy.combatRecords;
    delete legacy.missionClaims;
    const parsed = parseSaveFile(JSON.stringify(legacy));

    expect(parsed.gameState.schemaVersion).toBe(1);
    expect(parsed.gameState.missionClaims).toEqual([]);
    expect(parsed.gameState.combatRecords).toEqual([]);
    expect(parsed.metadata.databaseVersion).toBe(0);
    expect(parsed.migratedFrom).toBe(0);
  });

  it('rejects malformed JSON, unexpected roots, invalid metadata, and future save formats', () => {
    expect(() => parseSaveFile('{')).toThrow('O arquivo de save não contém JSON válido.');
    expect(() => parseSaveFile('null')).toThrow(
      'O arquivo de save não corresponde ao formato esperado.',
    );
    expect(() => parseSaveFile('[]')).toThrow(
      'O arquivo de save não corresponde ao formato esperado.',
    );
    expect(() => parseSaveFile(JSON.stringify({ formatVersion: 1 }))).toThrow(
      'Os metadados do save estão inválidos.',
    );
    const future = JSON.parse(createSaveFile(createTestState(), metadata)) as Record<
      string,
      unknown
    >;
    future.formatVersion = 99;
    expect(() => parseSaveFile(JSON.stringify(future))).toThrow(
      'Formato de save incompatível: 99.',
    );
    future.formatVersion = SAVE_FORMAT_VERSION;
    future.databaseVersion = 99;
    expect(() => parseSaveFile(JSON.stringify(future))).toThrow('versão de banco mais recente: 99');
  });

  it('rejects corrupted current and legacy state payloads', () => {
    const source = createSaveFile(createTestState(), metadata);
    const envelope = JSON.parse(source) as { gameState: GameState };
    envelope.gameState.revision = -1;
    expect(() => parseSaveFile(JSON.stringify(envelope))).toThrow(
      'A integridade dos dados do save não pôde ser validada.',
    );
    expect(() => createSaveFile(envelope.gameState, metadata)).toThrow();
    expect(() => parseSaveFile(JSON.stringify({ schemaVersion: 2 }))).toThrow(
      'A integridade dos dados do save não pôde ser validada.',
    );
  });
});
