type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  guildId?: string;
  command?: string;
  scope?: string;
  requestId?: string;
  event?: string;
}

// ── colours ────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  gray:   '\x1b[90m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
} as const;

const LEVEL_FMT: Record<LogLevel, string> = {
  debug: `${c.gray}DEBG${c.reset}`,
  info:  `${c.cyan}INFO${c.reset}`,
  warn:  `${c.yellow}WARN${c.reset}`,
  error: `${c.red}${c.bold}ERR!${c.reset}`,
};

const isTTY = Boolean((process.stdout as any).isTTY);

// ── pretty formatter ────────────────────────────────────────────────────────
function pretty(level: LogLevel, message: string, ctx?: LogContext, extra?: unknown): string {
  const now = new Date();
  const hms = now.toTimeString().slice(0, 8);
  const ms  = String(now.getMilliseconds()).padStart(3, '0');
  const ts  = `${c.gray}${hms}.${ms}${c.reset}`;

  const tag = ctx?.scope
    ? `${c.dim}[${ctx.scope}${ctx.event ? `/${ctx.event}` : ''}]${c.reset}`
    : '';

  const guild = ctx?.guildId
    ? ` ${c.gray}guild=${ctx.guildId.slice(-6)}${c.reset}`
    : '';

  let extraStr = '';
  if (extra !== undefined && extra !== null) {
    if (extra instanceof Error) {
      extraStr = ` ${c.gray}${extra.message}${c.reset}`;
    } else if (typeof extra === 'object') {
      const pairs = Object.entries(extra as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      if (pairs) extraStr = ` ${c.gray}${pairs}${c.reset}`;
    }
  }

  return `${ts}  ${LEVEL_FMT[level]}  ${tag} ${c.bold}${message}${c.reset}${guild}${extraStr}`;
}

// ── JSON formatter (production / piped) ────────────────────────────────────
function json(level: LogLevel, message: string, ctx?: LogContext, extra?: unknown): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (ctx?.guildId)   payload.guildId   = ctx.guildId;
  if (ctx?.command)   payload.command   = ctx.command;
  if (ctx?.scope)     payload.scope     = ctx.scope;
  if (ctx?.requestId) payload.requestId = ctx.requestId;
  if (ctx?.event)     payload.event     = ctx.event;
  if (extra)          payload.extra     = extra;
  return JSON.stringify(payload);
}

function format(level: LogLevel, message: string, ctx?: LogContext, extra?: unknown): string {
  return isTTY ? pretty(level, message, ctx, extra) : json(level, message, ctx, extra);
}

export const logger = {
  debug(message: string, ctx?: LogContext, extra?: unknown) {
    console.debug(format('debug', message, ctx, extra));
  },
  info(message: string, ctx?: LogContext, extra?: unknown) {
    console.info(format('info', message, ctx, extra));
  },
  warn(message: string, ctx?: LogContext, extra?: unknown) {
    console.warn(format('warn', message, ctx, extra));
  },
  error(message: string, ctx?: LogContext, extra?: unknown) {
    console.error(format('error', message, ctx, extra));
  },
};
