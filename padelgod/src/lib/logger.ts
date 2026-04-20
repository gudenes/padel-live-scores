import pino, { type Logger } from 'pino';

export interface LoggerOptions {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  const isProduction = process.env.NODE_ENV === 'production';
  return pino({
    level: opts.level,
    base: { service: opts.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }),
  });
}
