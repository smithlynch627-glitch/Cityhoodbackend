import { parseEventLogs, zeroAddress } from 'viem';
import { CityGameAbi, CityLandAbi } from './abi';
import { client, snapshot } from './chain';
import { GAME_ADDRESS, LAND_ADDRESS, LOG_CHUNK, POLL_MS, REFRESH_MINUTES, START_BLOCK } from './config';
import { store, type EventRow, type LandRow } from './store';
import { simulate, DEFAULT_CATALOG } from './shared/economy';

const ABI = [...CityGameAbi, ...CityLandAbi];
const GAME_EVENTS = new Set(['LandActivated', 'ConstructionStarted', 'ConstructionSpedUp', 'BuildingMoved', 'BuildingDemolished', 'RewardsClaimed']);

export const indexerState = { lastBlock: 0n, head: 0n, running: false, lastError: '' as string, lastRun: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function refreshLands(ids: number[]) {
  const snaps = await mapLimit(ids, 4, async (id) => {
    try {
      return await snapshot(id);
    } catch (e) {
      console.warn(`[indexer] snapshot #${id} failed:`, (e as Error).message);
      return null;
    }
  });
  const rows: LandRow[] = snaps
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const live = simulate(DEFAULT_CATALOG, s.land, s.chainTime);
      return {
        land_id: s.landId,
        owner: s.owner,
        activated: s.land.activated,
        hall_level: s.hallLevelNow,
        buildings: s.land.buildings.length,
        rate: Math.round(live.ratePerHourWithBoost),
        boost_bps: s.boostNow,
        score: Number(s.land.score),
        total_claimed: s.land.totalClaimed.toString(),
      };
    });
  await store.upsertLands(rows);
  return rows.length;
}

const blockTimes = new Map<bigint, number>();
async function blockTime(n: bigint) {
  const c = blockTimes.get(n);
  if (c) return c;
  const b = await client.getBlock({ blockNumber: n });
  const t = Number(b.timestamp);
  if (blockTimes.size > 5000) blockTimes.clear();
  blockTimes.set(n, t);
  return t;
}

async function step() {
  const head = await client.getBlockNumber();
  indexerState.head = head;
  if (indexerState.lastBlock >= head) return false;
  const from = indexerState.lastBlock + 1n;
  const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
  const logs = await client.getLogs({ address: GAME_ADDRESS ? [GAME_ADDRESS, LAND_ADDRESS!] : [LAND_ADDRESS!], fromBlock: from, toBlock: to });
  const decoded = parseEventLogs({ abi: ABI, logs, strict: false });
  const dirty = new Set<number>();
  const events: EventRow[] = [];
  for (const l of decoded) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (l.args ?? {}) as any;
    const isLand = l.address.toLowerCase() === LAND_ADDRESS!.toLowerCase();
    if (isLand) {
      if (l.eventName !== 'Transfer') continue;
      const id = Number(a.tokenId);
      dirty.add(id);
      if (a.from === zeroAddress) {
        events.push(row(l, 'Minted', id, a.to, null, null, null));
      }
      continue;
    }
    if (!GAME_EVENTS.has(l.eventName as string)) continue;
    const id = Number(a.landId);
    dirty.add(id);
    const player = a.player ?? a.owner ?? null;
    const amount = a.cost ?? a.amount ?? a.grant ?? null;
    events.push(row(l, l.eventName as string, id, player, a.kind ?? null, a.level ?? null, amount));
  }
  if (events.length) {
    const times = await mapLimit([...new Set(events.map((e) => BigInt(e.block_number)))], 4, async (b) => [b, await blockTime(b)] as const);
    const tm = new Map(times);
    events.forEach((e) => (e.created_at = new Date((tm.get(BigInt(e.block_number)) ?? Date.now() / 1000) * 1000).toISOString()));
    await store.insertEvents(events);
  }
  if (dirty.size) await refreshLands([...dirty]);
  indexerState.lastBlock = to;
  await store.setSync('lastBlock', to.toString());
  if (events.length) console.log(`[indexer] blocks ${from}-${to}: ${events.length} events, ${dirty.size} lands refreshed`);
  return to < head;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(l: any, event: string, landId: number, player: string | null, kind: number | null, level: number | null, amount: bigint | null): EventRow {
  return {
    id: `${l.transactionHash}:${l.logIndex}`,
    block_number: Number(l.blockNumber),
    log_index: Number(l.logIndex),
    tx_hash: l.transactionHash,
    event,
    land_id: landId,
    player,
    kind: kind === null ? null : Number(kind),
    level: level === null ? null : Number(level),
    amount: amount === null ? null : amount.toString(),
    created_at: new Date().toISOString(),
  };
}

export async function startIndexer() {
  if (indexerState.running) return;
  indexerState.running = true;
  const saved = await store.getSync('lastBlock').catch(() => null);
  indexerState.lastBlock = saved ? BigInt(saved) : START_BLOCK > 0n ? START_BLOCK - 1n : 0n;
  console.log(`[indexer] starting from block ${indexerState.lastBlock + 1n} (store: ${store.name})`);

  // periodic refresh — construction finishes without an event, so re-read active lands
  setInterval(async () => {
    try {
      const ids = await store.landIds();
      if (ids.length) {
        const n = await refreshLands(ids);
        console.log(`[indexer] periodic refresh: ${n} lands`);
      }
    } catch (e) {
      console.warn('[indexer] periodic refresh failed:', (e as Error).message);
    }
  }, REFRESH_MINUTES * 60_000);

  for (;;) {
    try {
      const more = await step();
      indexerState.lastError = '';
      indexerState.lastRun = Date.now();
      if (!more) await sleep(POLL_MS);
    } catch (e) {
      indexerState.lastError = (e as Error).message.slice(0, 300);
      console.warn('[indexer] error:', indexerState.lastError);
      await sleep(Math.min(60_000, POLL_MS * 3));
    }
  }
}
