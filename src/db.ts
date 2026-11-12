/**
 * Tiny table layer used by Citizenship, Grab Land and the admin panel.
 * Production: Supabase (service-role key, server-side only). Local dev: an in-memory copy with the same
 * behaviour, so every feature is written once.
 *
 * Conditional updates (`update(table, where, patch)`) are a single SQL UPDATE … WHERE … on Supabase, so
 * they are atomic: e.g. claiming a Grab Land code only succeeds while its status is still 'unused'.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

export type Op = { gt: unknown } | { gte: unknown } | { lt: unknown } | { lte: unknown } | { neq: unknown } | { in: unknown[] } | { ilike: string } | { is: null };
export type Where = Record<string, unknown>;
export interface SelectOpts {
  where?: Where;
  order?: [string, 'asc' | 'desc'][];
  limit?: number;
  offset?: number;
  /** OR-search: any of these columns ilike %q% */
  search?: { cols: string[]; q: string };
}

export interface DB {
  name: string;
  select<T = Row>(table: string, opts?: SelectOpts): Promise<T[]>;
  one<T = Row>(table: string, where: Where): Promise<T | null>;
  count(table: string, where?: Where): Promise<number>;
  insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]>;
  update<T = Row>(table: string, where: Where, patch: Row): Promise<T[]>;
  upsert<T = Row>(table: string, rows: Row | Row[], onConflict: string): Promise<T[]>;
  remove(table: string, where: Where): Promise<number>;
  /** Atomic counters (points). Supabase: SQL function cityhood_add_points. */
  addPoints(userId: string, delta: number): Promise<number>;
  /** Next citizen number. Supabase: SQL function cityhood_next_citizen_no. */
  nextCitizenNo(): Promise<number>;
}
export type Row = Record<string, unknown>;

const T = (t: string) => `cityhood_${t}`;
const isOp = (v: unknown): v is Op => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 1 && ['gt', 'gte', 'lt', 'lte', 'neq', 'in', 'ilike', 'is'].includes(Object.keys(v as object)[0]);

/* ------------------------------------------------------------------ memory */
class MemoryDB implements DB {
  name = 'memory';
  private tables = new Map<string, Row[]>();
  private citizenSeq = 0;

  private rows(t: string) {
    let r = this.tables.get(t);
    if (!r) this.tables.set(t, (r = []));
    return r;
  }
  private match(row: Row, where: Where = {}) {
    return Object.entries(where).every(([k, v]) => {
      const cur = row[k];
      if (!isOp(v)) return v === null ? cur === null || cur === undefined : cur === v;
      const [op, val] = Object.entries(v)[0] as [string, unknown];
      const cmp = (a: unknown, b: unknown) => (a as number | string) > (b as number | string) ? 1 : (a as number | string) < (b as number | string) ? -1 : 0;
      switch (op) {
        case 'gt': return cur != null && cmp(cur, val) > 0;
        case 'gte': return cur != null && cmp(cur, val) >= 0;
        case 'lt': return cur != null && cmp(cur, val) < 0;
        case 'lte': return cur != null && cmp(cur, val) <= 0;
        case 'neq': return cur !== val;
        case 'in': return (val as unknown[]).includes(cur);
        case 'ilike': return typeof cur === 'string' && new RegExp('^' + String(val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(cur);
        case 'is': return cur === null || cur === undefined;
      }
      return false;
    });
  }
  async select<R>(t: string, o: SelectOpts = {}) {
    let out = this.rows(t).filter((r) => this.match(r, o.where));
    if (o.search?.q) {
      const q = o.search.q.toLowerCase();
      out = out.filter((r) => o.search!.cols.some((c) => String(r[c] ?? '').toLowerCase().includes(q)));
    }
    if (o.order) {
      out = [...out].sort((a, b) => {
        for (const [c, dir] of o.order!) {
          const x = a[c] as number | string;
          const y = b[c] as number | string;
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x > y ? 1 : -1) * (dir === 'asc' ? 1 : -1);
        }
        return 0;
      });
    }
    const off = o.offset ?? 0;
    return out.slice(off, o.limit ? off + o.limit : undefined).map((r) => ({ ...r })) as R[];
  }
  async one<R>(t: string, where: Where) {
    const r = this.rows(t).find((x) => this.match(x, where));
    return (r ? { ...r } : null) as R | null;
  }
  async count(t: string, where?: Where) {
    return this.rows(t).filter((r) => this.match(r, where)).length;
  }
  async insert<R>(t: string, rows: Row | Row[]) {
    const list = Array.isArray(rows) ? rows : [rows];
    const now = new Date().toISOString();
    const out = list.map((r) => ({ id: randomUUID(), created_at: now, ...r }));
    this.rows(t).push(...out);
    return out.map((r) => ({ ...r })) as R[];
  }
  async update<R>(t: string, where: Where, patch: Row) {
    const out: Row[] = [];
    for (const r of this.rows(t)) if (this.match(r, where)) out.push(Object.assign(r, patch));
    return out.map((r) => ({ ...r })) as R[];
  }
  async upsert<R>(t: string, rows: Row | Row[], onConflict: string) {
    const list = Array.isArray(rows) ? rows : [rows];
    const keys = onConflict.split(',');
    const out: Row[] = [];
    for (const r of list) {
      const hit = this.rows(t).find((x) => keys.every((k) => x[k] === r[k]));
      if (hit) out.push(Object.assign(hit, r));
      else out.push(...(await this.insert<Row>(t, r)));
    }
    return out.map((r) => ({ ...r })) as R[];
  }
  async remove(t: string, where: Where) {
    const all = this.rows(t);
    const keep = all.filter((r) => !this.match(r, where));
    this.tables.set(t, keep);
    return all.length - keep.length;
  }
  async addPoints(userId: string, delta: number) {
    const u = this.rows('users').find((r) => r.id === userId);
    if (!u) return 0;
    u.points = Math.max(0, Number(u.points ?? 0) + delta);
    return u.points as number;
  }
  async nextCitizenNo() {
    return ++this.citizenSeq;
  }
}

/* ------------------------------------------------------------------ supabase */
class SupabaseDB implements DB {
  name = 'supabase';
  constructor(private sb: SupabaseClient) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private filter(q: any, where: Where = {}) {
    for (const [k, v] of Object.entries(where)) {
      if (!isOp(v)) q = v === null ? q.is(k, null) : q.eq(k, v);
      else {
        const [op, val] = Object.entries(v)[0] as [string, unknown];
        q = op === 'in' ? q.in(k, val as unknown[]) : op === 'is' ? q.is(k, null) : q[op](k, val);
      }
    }
    return q;
  }
  private fail(error: { message: string } | null) {
    if (error) throw new Error(`db: ${error.message}`);
  }
  async select<R>(t: string, o: SelectOpts = {}) {
    let q = this.filter(this.sb.from(T(t)).select('*'), o.where);
    if (o.search?.q) {
      const s = o.search.q.replace(/[,()%*]/g, ' ').trim();
      if (s) q = q.or(o.search.cols.map((c) => `${c}.ilike.%${s}%`).join(','));
    }
    for (const [c, dir] of o.order ?? []) q = q.order(c, { ascending: dir === 'asc', nullsFirst: false });
    if (o.limit) q = q.range(o.offset ?? 0, (o.offset ?? 0) + o.limit - 1);
    const { data, error } = await q;
    this.fail(error);
    return (data ?? []) as R[];
  }
  async one<R>(t: string, where: Where) {
    const { data, error } = await this.filter(this.sb.from(T(t)).select('*'), where).limit(1).maybeSingle();
    this.fail(error);
    return (data ?? null) as R | null;
  }
  async count(t: string, where?: Where) {
    const { count, error } = await this.filter(this.sb.from(T(t)).select('*', { count: 'exact', head: true }), where);
    this.fail(error);
    return count ?? 0;
  }
  async insert<R>(t: string, rows: Row | Row[]) {
    const { data, error } = await this.sb.from(T(t)).insert(rows).select('*');
    this.fail(error);
    return (data ?? []) as R[];
  }
  async update<R>(t: string, where: Where, patch: Row) {
    const { data, error } = await this.filter(this.sb.from(T(t)).update(patch), where).select('*');
    this.fail(error);
    return (data ?? []) as R[];
  }
  async upsert<R>(t: string, rows: Row | Row[], onConflict: string) {
    const { data, error } = await this.sb.from(T(t)).upsert(rows, { onConflict }).select('*');
    this.fail(error);
    return (data ?? []) as R[];
  }
  async remove(t: string, where: Where) {
    const { data, error } = await this.filter(this.sb.from(T(t)).delete(), where).select('*');
    this.fail(error);
    return (data ?? []).length;
  }
  async addPoints(userId: string, delta: number) {
    const { data, error } = await this.sb.rpc('cityhood_add_points', { p_user: userId, p_delta: delta });
    this.fail(error);
    return Number(data ?? 0);
  }
  async nextCitizenNo() {
    const { data, error } = await this.sb.rpc('cityhood_next_citizen_no');
    this.fail(error);
    return Number(data);
  }
}

export const db: DB =
  SUPABASE_URL && SUPABASE_KEY ? new SupabaseDB(createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })) : new MemoryDB();
