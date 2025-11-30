type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  guildId?: string;
  command?: string;
  scope?: string;
  requestId?: string;
  event?: string;
}

function serialize(level: LogLevel, message: string, ctx?: LogContext, extra?: unknown): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (ctx?.guildId) payload.guildId = ctx.guildId;
  if (ctx?.command) payload.command = ctx.command;
  if (ctx?.scope) payload.scope = ctx.scope;
  if (ctx?.requestId) payload.requestId = ctx.requestId;
  if (ctx?.event) payload.event = ctx.event;
  if (extra) payload.extra = extra;
  return JSON.stringify(payload);
}

export const logger = {
  debug(message: string, ctx?: LogContext, extra?: unknown) {
    console.debug(serialize('debug', message, ctx, extra));
  },
  info(message: string, ctx?: LogContext, extra?: unknown) {
    console.info(serialize('info', message, ctx, extra));
  },
  warn(message: string, ctx?: LogContext, extra?: unknown) {
    console.warn(serialize('warn', message, ctx, extra));
  },
  error(message: string, ctx?: LogContext, extra?: unknown) {
    console.error(serialize('error', message, ctx, extra));
  },
};
