import { describe, expect, it, vi } from 'vitest';
import { exportTextFile, type FileExportPort } from './file-actions';

describe('save and log file export', () => {
  it("shares a cache file through Android's native share sheet", async () => {
    const port: FileExportPort = {
      isNative: () => true,
      writeFile: vi.fn(async () => ({ uri: 'content://save' })),
      share: vi.fn(async () => undefined),
      download: vi.fn(),
    };
    await exportTextFile('save.json', '{"save":true}', 'Save do jogo', 'application/json', port);
    expect(port.writeFile).toHaveBeenCalledWith({
      path: 'save.json',
      data: '{"save":true}',
      directory: 'CACHE',
      encoding: 'utf8',
    });
    expect(port.share).toHaveBeenCalledWith({
      title: 'Save do jogo',
      text: 'Save do jogo',
      url: 'content://save',
      dialogTitle: 'Save do jogo',
    });
    expect(port.download).not.toHaveBeenCalled();
  });

  it('downloads a browser file without invoking native share APIs', async () => {
    const port: FileExportPort = {
      isNative: () => false,
      writeFile: vi.fn(),
      share: vi.fn(),
      download: vi.fn(),
    };
    await exportTextFile('logs.txt', 'debug line', 'Logs', 'text/plain', port);
    expect(port.download).toHaveBeenCalledWith('logs.txt', 'debug line', 'text/plain');
    expect(port.writeFile).not.toHaveBeenCalled();
    expect(port.share).not.toHaveBeenCalled();
  });

  it('rejects an empty filename before performing a platform action', async () => {
    const port: FileExportPort = {
      isNative: () => false,
      writeFile: vi.fn(),
      share: vi.fn(),
      download: vi.fn(),
    };
    await expect(exportTextFile('  ', 'content', 'Title', 'text/plain', port)).rejects.toThrow(
      'nome do arquivo',
    );
    expect(port.download).not.toHaveBeenCalled();
  });
});
