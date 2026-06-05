/**
 * Otomasyon adımlarındaki {{degisken.alan}} pattern'lerini çözen yardımcı.
 *
 * Örnek:
 *   args = { to: "{{mukellef.phone}}", subject: "{{currentMonth}} hatırlatma" }
 *   context = { mukellef: { phone: "+90...", unvan: "..." }, currentMonth: "2026-05" }
 *   sonuç: { to: "+90...", subject: "2026-05 hatırlatma" }
 *
 * Destekler:
 *  - Düz değişken: {{gecikenler}}
 *  - Nested path: {{mukellef.phone}}
 *  - Array length: {{gecikenler.length}}
 *  - Array index: {{gecikenler.0.unvan}}
 *  - Built-in tokens: {{today}}, {{now}}, {{currentMonth}}, {{currentUser.email}}
 *  - JSON string'leri içindeki pattern'leri de tarar.
 */

export interface ResolveContext {
  /** Önceki step'lerin outputAs ile sakladıkları değerler */
  outputs: Record<string, unknown>;
  /** Tetikleyici payload'ı (event verisi, webhook body) */
  trigger?: Record<string, unknown>;
  /** Otomasyonu sahiplenen kullanıcı bilgileri */
  currentUser?: { id: string; email: string; firstName?: string; lastName?: string };
  /** Tenant bilgisi (örn. ofis adı) */
  tenant?: { id: string; name: string };
  /** Override: testlerde "now" sabitlemek için */
  now?: Date;
}

const TEMPLATE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Bir JSON-benzeri yapının içindeki tüm string template'leri çözer.
 * Object/array içinde dolaşır, sayılara/boolean'lara dokunmaz.
 */
export function resolveTemplates<T = unknown>(value: T, ctx: ResolveContext): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return resolveString(value, ctx) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplates(v, ctx)) as unknown as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveTemplates(v, ctx);
    }
    return result as unknown as T;
  }
  return value;
}

/**
 * Tek bir string içindeki tüm template'leri çözer.
 * Eğer string tamamen tek bir template ise (`"{{mukellef}}"`), o değişkenin
 * tam değeri döner (array, object dahil). Aksi halde string interpolation yapılır.
 */
function resolveString(input: string, ctx: ResolveContext): unknown {
  const match = input.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (match) {
    // Bütün string tek bir template ise: değişkenin tam değerini döndür (type preserved)
    return lookup(match[1], ctx);
  }
  // Karışık string: her template'i string'e çevirip yerine yaz
  return input.replace(TEMPLATE_PATTERN, (_full, expr) => {
    const v = lookup(expr.trim(), ctx);
    return v === undefined || v === null ? '' : stringify(v);
  });
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Path'i çözer: "mukellef.phone", "gecikenler.length", "gecikenler.0.unvan"
 */
function lookup(path: string, ctx: ResolveContext): unknown {
  const parts = path.split('.');
  const root = parts[0];

  // Built-in token'lar
  const builtIn = resolveBuiltIn(root, ctx);
  if (builtIn !== undefined) {
    return parts.length === 1 ? builtIn : descend(builtIn, parts.slice(1));
  }

  // Outputs (önceki step'lerden)
  if (Object.prototype.hasOwnProperty.call(ctx.outputs, root)) {
    return descend(ctx.outputs[root], parts.slice(1));
  }

  // Trigger payload
  if (ctx.trigger && Object.prototype.hasOwnProperty.call(ctx.trigger, root)) {
    return descend(ctx.trigger[root], parts.slice(1));
  }

  return undefined;
}

function descend(value: unknown, parts: string[]): unknown {
  let current: any = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (part === 'length' && (Array.isArray(current) || typeof current === 'string')) {
      return current.length;
    }
    // Sayısal index
    if (/^\d+$/.test(part) && Array.isArray(current)) {
      current = current[Number(part)];
      continue;
    }
    current = current[part];
  }
  return current;
}

/**
 * Bir tarihi Türkiye saatine (Europe/Istanbul, UTC+3) göre "YYYY-MM-DD" verir.
 * Sunucu UTC çalıştığı için gece yarısına yakın saatlerde gün/ay kaymasını önler.
 */
function istanbulYmd(date: Date): string {
  try {
    // en-CA locale ISO benzeri "2026-06-05" üretir.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function resolveBuiltIn(key: string, ctx: ResolveContext): unknown {
  const now = ctx.now ?? new Date();
  const ymd = istanbulYmd(now); // Türkiye saatine göre YYYY-MM-DD
  switch (key) {
    case 'today':
      return ymd;
    case 'now':
      return now.toISOString();
    case 'currentMonth':
      return ymd.slice(0, 7); // YYYY-MM (Türkiye ayı)
    case 'currentYear':
      return ymd.slice(0, 4);
    case 'currentUser':
      return ctx.currentUser;
    case 'tenant':
      return ctx.tenant;
    case 'trigger':
      return ctx.trigger;
    default:
      return undefined;
  }
}

/**
 * Bir koşul nesnesini değerlendirir (branch_if için).
 * { left, op, right } — left/right önce template-resolve edilmiş olmalı.
 */
export function evaluateCondition(
  condition: { left: unknown; op: string; right?: unknown },
): boolean {
  const { left, op, right } = condition;
  switch (op) {
    case '==':
      return left == right; // intentional loose comparison for "5" == 5
    case '!=':
      return left != right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'exists':
      return left !== undefined && left !== null && left !== '';
    case 'in':
      return Array.isArray(right) && right.includes(left as never);
    default:
      throw new Error(`Bilinmeyen koşul op: ${op}`);
  }
}
