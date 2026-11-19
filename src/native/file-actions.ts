import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface FileExportPort {
  isNative(): boolean;
  writeFile(options: {
    path: string;
    data: string;
    directory: 'CACHE';
    encoding: 'utf8';
  }): Promise<{ uri: string }>;
  share(options: {
    title: string;
    text: string;
    url: string;
    dialogTitle: string;
  }): Promise<unknown>;
  download(filename: string, content: string, mimeType: string): void;
}

export async function exportTextFile(
  filename: string,
  content: string,
  title: string,
  mimeType = 'text/plain',
  port: FileExportPort = {
    isNative: () => Capacitor.isNativePlatform(),
    writeFile: (options) =>
      Filesystem.writeFile({ ...options, directory: Directory.Cache, encoding: Encoding.UTF8 }),
    share: (options) => Share.share(options),
    download: (name, data, type) => {
      const url = URL.createObjectURL(new Blob([data], { type }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    },
  },
): Promise<void> {
  if (!filename.trim()) throw new Error('O nome do arquivo não pode ficar vazio.');
  if (port.isNative()) {
    const file = await port.writeFile({
      path: filename,
      data: content,
      directory: 'CACHE',
      encoding: 'utf8',
    });
    await port.share({ title, text: title, url: file.uri, dialogTitle: title });
    return;
  }
  port.download(filename, content, mimeType);
}
