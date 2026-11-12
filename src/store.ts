import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

export interface LandRow {
  land_id: number;
  owner: string | null;
  activated: boolean;
  hall_level: number;
  buildings: number;
  rate: number;
  boost_bps: number;
  score: number;
  total_claimed: string;
  updated_at?: string;
}

export interface EventRow {
  id: string;
  block_number: number;
  log_index: number;
  tx_hash: string;
  event: string;
  land_id: number | null;
  player: string | null;
  kind: number | null;
  level: number | null;
  amount: string | null;
  created_at: string;
}

export interface AnnouncementRow {
  id: number;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
}
export type NewAnnouncement = Pick<AnnouncementRow, 'title' | 'body' | 'link'>;

export interface Store {
  name: string;
  announcements(limit: number): Promise<AnnouncementRow[]>;
  addAnnouncement(a: NewAnnouncement): Promise<AnnouncementRow>;
  deleteAnnouncement(id: number): Promise<boolean>;
  getSync(key: string): Promise<string | null>;
  setSync(key: string, value: string): Promise<void>;
  upsertLands(rows: LandRow[]): Promise<void>;
  insertEvents(rows: EventRow[]): Promise<void>;
  leaderboard(limit: number): Promise<LandRow[]>;
  activity(limit: number, landId?: number): Promise<EventRow[]>;
  landIds(): Promise<number[]>;
  holders(): Promise<number>;
}

class MemoryStore implements Store {
  name = 'memory';
  sync = new Map<string, string>();
  lands = new Map<number, LandRow>();
  events = new Map<string, EventRow>();
  news: AnnouncementRow[] = [];
  nextNewsId = 1;
  async announcements(limit: number) {
    return [...this.news].sort((a, b) => b.id - a.id).slice(0, limit);
  }
  async addAnnouncement(a: NewAnnouncement) {
    const row: AnnouncementRow = { id: this.nextNewsId++, title: a.title, body: a.body, link: a.link ?? null, created_at: new Date().toISOString() };
    this.news.push(row);
    return row;
  }
  async deleteAnnouncement(id: number) {
    const before = this.news.length;
    this.news = this.news.filter((n) => n.id !== id);
    return this.news.length < before;
  }
  async getSync(k: string) {
    return this.sync.get(k) ?? null;
  }
  async setSync(k: string, v: string) {
    this.sync.set(k, v);
  }
  async upsertLands(rows: LandRow[]) {
    rows.forEach((r) => this.lands.set(r.land_id, { ...r, updated_at: new Date().toISOString() }));
  }
  async insertEvents(rows: EventRow[]) {
    rows.forEach((r) => !this.events.has(r.id) && this.events.set(r.id, r));
  }
  async leaderboard(limit: number) {
    return [...this.lands.values()].filter((l) => l.activated).sort((a, b) => b.score - a.score || b.rate - a.rate).slice(0, limit);
  }
  async activity(limit: number, landId?: number) {
    return [...this.events.values()]
      .filter((e) => landId === undefined || e.land_id === landId)
      .sort((a, b) => b.block_number - a.block_number || b.log_index - a.log_index)
      .slice(0, limit);
  }
  async landIds() {
    return [...this.lands.keys()];
  }
  async holders() {
    return new Set([...this.lands.values()].map((l) => l.owner?.toLowerCase())).size;
  }
}

class SupabaseStore implements Store {
  name = 'supabase';
  constructor(private db: SupabaseClient) {}
  async announcements(limit: number) {
    const { data, error } = await this.db.from('cityhood_announcements').select('*').order('id', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []) as AnnouncementRow[];
  }
  async addAnnouncement(a: NewAnnouncement) {
    const { data, error } = await this.db.from('cityhood_announcements').insert({ title: a.title, body: a.body, link: a.link ?? null }).select('*').single();
    if (error) throw error;
    return data as AnnouncementRow;
  }
  async deleteAnnouncement(id: number) {
    const { data, error } = await this.db.from('cityhood_announcements').delete().eq('id', id).select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async getSync(k: string) {
    const { data, error } = await this.db.from('cityhood_sync').select('value').eq('key', k).maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  }
  async setSync(k: string, v: string) {
    const { error } = await this.db.from('cityhood_sync').upsert({ key: k, value: v });
    if (error) throw error;
  }
  async upsertLands(rows: LandRow[]) {
    if (!rows.length) return;
    const { error } = await this.db.from('cityhood_lands').upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'land_id' },
    );
    if (error) throw error;
  }
  async insertEvents(rows: EventRow[]) {
    if (!rows.length) return;
    const { error } = await this.db.from('cityhood_events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
  async leaderboard(limit: number) {
    const { data, error } = await this.db
      .from('cityhood_lands')
      .select('*')
      .eq('activated', true)
      .order('score', { ascending: false })
      .order('rate', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as LandRow[];
  }
  async activity(limit: number, landId?: number) {
    let q = this.db.from('cityhood_events').select('*').order('block_number', { ascending: false }).order('log_index', { ascending: false }).limit(limit);
    if (landId !== undefined) q = q.eq('land_id', landId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as EventRow[];
  }
  async landIds() {
    const out: number[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from('cityhood_lands').select('land_id').range(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []).map((r) => Number(r.land_id)));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async holders() {
    const { data, error } = await this.db.from('cityhood_lands').select('owner');
    if (error) throw error;
    return new Set((data ?? []).map((r) => String(r.owner).toLowerCase())).size;
  }
}

export const store: Store =
  SUPABASE_URL && SUPABASE_KEY ? new SupabaseStore(createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })) : new MemoryStore();
