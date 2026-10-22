import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

// A single private cleanup record, not a replay queue. Never stores display text.
export interface DisplayCleanupPorts {
  load: () => string;
  save: (json: string) => void;
}
export class DisplayCleanupStore implements DisplayCleanupPorts {
  private path: string = '';
  initialize(filesDir: string, name: string = 'display-cleanup.json'): void {
    if (!filesDir || filesDir.endsWith('/') || filesDir.endsWith('\\')) throw new Error('DISPLAY_DIRECTORY');
    if (!['display-cleanup.json', 'notification-cleanup.json', 'teleprompter-cleanup.json', 'voice-cleanup.json', 'recording-cleanup.json', 'lifelog-cleanup.json'].includes(name)) throw new Error('DISPLAY_RECORD_NAME');
    this.path = filesDir + '/' + name;
  }
  load(): string {
    if (!this.path) throw new Error('DISPLAY_NOT_INITIALIZED');
    if (fs.accessSync(this.path + '.partial')) throw new Error('DISPLAY_PARTIAL_RECORD');
    if (!fs.accessSync(this.path)) return '';
    const size=fs.statSync(this.path).size;
    if (size < 1 || size > 1024) throw new Error('DISPLAY_RECORD_SIZE');
    return fs.readTextSync(this.path);
  }
  save(json: string): void {
    if (!this.path) throw new Error('DISPLAY_NOT_INITIALIZED');
    const bytes = new util.TextEncoder().encodeInto(json);
    try {
      if (bytes.length > 1024) throw new Error('DISPLAY_RECORD_SIZE');
      const file = fs.openSync(this.path + '.partial', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const part = bytes.slice(offset);
          try {
            const written = fs.writeSync(file.fd, part.buffer);
            if (!Number.isSafeInteger(written) || written < 1 || written > part.length) throw new Error('DISPLAY_RECORD_WRITE');
            offset += written;
          } finally { part.fill(0); }
        }
        fs.fsyncSync(file.fd);
      } finally { fs.closeSync(file); }
      fs.renameSync(this.path + '.partial', this.path);
    } finally { bytes.fill(0); }
  }
}
