export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type LogSubsystem =
  'app' | 'sessions' | 'combat' | 'persistence' | 'mods' | 'nodes' | 'notifications';

export interface GameLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  subsystem: LogSubsystem;
  message: string;
  details?: Record<string, unknown>;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export class DebugLog {
  private entries: GameLogEntry[] = [];
  private sequence = 0;

  constructor(
    private readonly maximumEntries = 2_000,
    private readonly clock: () => number = Date.now,
  ) {}

  write(
    level: LogLevel,
    subsystem: LogSubsystem,
    message: string,
    details?: Record<string, unknown>,
  ): GameLogEntry {
    const entry: GameLogEntry = {
      id: `log-${this.clock()}-${++this.sequence}`,
      timestamp: this.clock(),
      level,
      subsystem,
      message,
      ...(details ? { details: structuredClone(details) } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maximumEntries)
      this.entries.splice(0, this.entries.length - this.maximumEntries);
    return entry;
  }

  list(
    options: { verbose?: boolean; minimumLevel?: LogLevel; subsystem?: LogSubsystem } = {},
  ): GameLogEntry[] {
    const threshold = LEVEL_WEIGHT[options.minimumLevel ?? (options.verbose ? 'trace' : 'info')];
    return this.entries.filter(
      (entry) =>
        LEVEL_WEIGHT[entry.level] <= threshold &&
        (!options.subsystem || entry.subsystem === options.subsystem),
    );
  }

  format(
    options: { verbose?: boolean; minimumLevel?: LogLevel; subsystem?: LogSubsystem } = {},
  ): string[] {
    return this.list(options).map((entry) => {
      const prefix = options.verbose
        ? `${new Date(entry.timestamp).toISOString()} ${entry.level.toUpperCase()} ${entry.subsystem} ${entry.id}`
        : `${entry.level.toUpperCase()} ${entry.subsystem}`;
      const details = entry.details && options.verbose ? ` ${JSON.stringify(entry.details)}` : '';
      return `${prefix} ${entry.message}${details}`;
    });
  }

  clear(): void {
    this.entries = [];
  }
}
