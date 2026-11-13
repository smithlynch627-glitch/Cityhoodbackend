import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { CHAIN, CITY_ADDRESS, CONTRACTS_READY, CORS_ORIGIN, GAME_ADDRESS, GAME_READY, IS_PROD, LAND_ADDRESS, NFT_READY, PORT, PUBLIC_API_URL, SALE_ADDRESS, SITE_URL } from './config';
import { chainStats, snapshot } from './chain';
import { indexerState, startIndexer } from './indexer';
import { development, landPngAsync, landSvg, metadataFor, sampleCity } from './render';
import { store } from './store';
import { db } from './db';
import { DEFAULT_CATALOG } from './shared/economy';
import { getSettings, publicSettings } from './settings';
import { citizens, seedTasks } from './citizens';
import { share } from './share';
import { grab } from './grab';
import { market } from './market';
import { admin, requireAdmin } from './admin';
import { startJobs } from './jobs';
import { HttpError } from './security';
import { TtlCache } from './cache';
import tokenomics from './shared/tokenomics.json';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// NFT metadata and images are public (wallets and marketplaces read them from anywhere). Everything else
// only answers the site itself in production (CORS_ORIGIN, or SITE_URL when that isn't set).
const PUBLIC_PATHS = /^\/(api\/(metadata|image|contract-metadata|collection|tokenomics|price)|c\/|health)/;
const siteOrigins = CORS_ORIGIN.length ? CORS_ORIGIN : IS_PROD ? [SITE_URL] : '*';
app.use(
  cors((req, cb) =>
    cb(null, {
      origin: PUBLIC_PATHS.test(req.path) ? '*' : siteOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  ),
);
// gzip JSON and HTML (images are already compressed)
app.use(compression({ threshold: 1024, filter: (req, res) => !/^image\//.test(String(res.getHeader('Content-Type') ?? '')) && compression.filter(req, res) }));
app.use(express.json({ limit: '64kb' }));
app.use(citizens);
app.use(share);
app.use(grab);
app.use(market);
app.use(admin);

/* ------------------------------ tiny TTL cache ------------------------------ */
const cache = new TtlCache<unknown>(4000);
/** rendered images are big, so they get their own, smaller cache */
const images = new TtlCache<unknown>(250);
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T> | T): Promise<T> {
  const c = key.startsWith('png:') || key.startsWith('svg:') || key === 'collection' ? images : cache;
  return c.get(key, ttlMs, fn) as Promise<T>;
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const intParam = (v: unknown, def: number, max: number) => Math.max(1, Math.min(max, Number.parseInt(String(v ?? def), 10) || def));
const landParam = (v: string) => {
  const id = Number.parseInt(String(v).replace(/\.(png|svg|json)$/, ''), 10);
  if (!Number.isFinite(id) || id < 1 || id > 10_000_000) throw Object.assign(new Error('Invalid land id'), { status: 400 });
  return id;
};
const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const requireContracts = (_req: Request, res: Response, next: NextFunction) => {
  if (!NFT_READY) return res.status(503).json({ error: 'Contracts not configured on the server (LAND_ADDRESS, CITY_ADDRESS).' });
  next();
};

/* ---------------------------------- routes ---------------------------------- */
app.get('/', (_req, res) => res.json({ name: 'CITYHOOD API', chain: CHAIN.name, docs: ['/health', '/api/stats', '/api/leaderboard', '/api/activity', '/api/announcements', '/api/land/:id', '/api/metadata/:id', '/api/image/:id.svg', '/api/image/:id.png'] }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    chain: CHAIN.id,
    contracts: CONTRACTS_READY,
    nft: NFT_READY,
    game: GAME_READY,
    store: store.name,
    db: db.name,
    indexer: { running: indexerState.running, lastBlock: indexerState.lastBlock.toString(), head: indexerState.head.toString(), lastError: indexerState.lastError || null },
  });
});

app.get('/api/config', (_req, res) => {
  res.json({ chainId: CHAIN.id, chainName: CHAIN.name, land: LAND_ADDRESS ?? null, city: CITY_ADDRESS ?? null, game: GAME_ADDRESS ?? null, sale: SALE_ADDRESS ?? null, catalog: DEFAULT_CATALOG });
});

/** Public site settings: footer links, X handle, Citizenship switches. */
app.get(
  '/api/site',
  wrap(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=10').json(publicSettings(await getSettings()));
  }),
);

app.get(
  '/api/stats',
  requireContracts,
  wrap(async (_req, res) => {
    const s = await cached('stats', 20_000, async () => ({ ...(await chainStats()), holders: await store.holders().catch(() => 0) }));
    res.set('Cache-Control', 'public, max-age=20').json(s);
  }),
);

app.get(
  '/api/leaderboard',
  wrap(async (req, res) => {
    const limit = intParam(req.query.limit, 50, 200);
    const rows = await cached(`lb:${limit}`, 15_000, () => store.leaderboard(limit));
    res.set('Cache-Control', 'public, max-age=15').json({ rows });
  }),
);

app.get(
  '/api/activity',
  wrap(async (req, res) => {
    const limit = intParam(req.query.limit, 20, 100);
    const land = req.query.land ? landParam(String(req.query.land)) : undefined;
    const rows = await cached(`act:${limit}:${land ?? ''}`, 8_000, () => store.activity(limit, land));
    res.set('Cache-Control', 'public, max-age=8').json({ rows });
  }),
);

/* ------------------------------- mailbox news ------------------------------- */
app.get(
  '/api/announcements',
  wrap(async (req, res) => {
    const limit = intParam(req.query.limit, 20, 50);
    const rows = await cached(`news:${limit}`, 30_000, () => store.announcements(limit));
    res.set('Cache-Control', 'public, max-age=30').json({ rows });
  }),
);

app.post(
  '/api/admin/announcements',
  requireAdmin,
  wrap(async (req, res) => {
    const title = cleanText(req.body?.title, 120);
    const body = cleanText(req.body?.body, 2000);
    const rawLink = cleanText(req.body?.link, 500);
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
    let link: string | null = null;
    if (rawLink) {
      try {
        const u = new URL(rawLink);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
        link = u.toString();
      } catch {
        return res.status(400).json({ error: 'link must be an http(s) URL' });
      }
    }
    const row = await store.addAnnouncement({ title, body, link });
    cache.deletePrefix('news:');
    res.status(201).json(row);
  }),
);

app.delete(
  '/api/admin/announcements/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const ok = await store.deleteAnnouncement(id);
    cache.deletePrefix('news:');
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  }),
);

app.get(
  '/api/land/:id',
  requireContracts,
  wrap(async (req, res) => {
    const id = landParam(String(req.params.id));
    const snap = await cached(`snap:${id}`, 10_000, () => snapshot(id));
    if (!snap) return res.status(404).json({ error: 'Land not minted' });
    const body = { ...snap, development: development(snap.land) };
    res.set('Cache-Control', 'public, max-age=10').json(JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))));
  }),
);

app.get(
  '/api/metadata/:id',
  requireContracts,
  wrap(async (req, res) => {
    const id = landParam(String(req.params.id));
    const snap = await cached(`snap:${id}`, 10_000, () => snapshot(id));
    if (!snap) return res.status(404).json({ error: 'Land not minted' });
    res.set('Cache-Control', 'public, max-age=60').json(metadataFor(id, snap.land, snap.chainTime, PUBLIC_API_URL, SITE_URL));
  }),
);

app.get(
  '/api/image/:file',
  requireContracts,
  wrap(async (req, res) => {
    const file = String(req.params.file);
    const id = landParam(file);
    const png = file.endsWith('.png');
    const snap = await cached(`snap:${id}`, 10_000, () => snapshot(id));
    if (!snap) return res.status(404).json({ error: 'Land not minted' });
    const stateKey = `${snap.land.buildings.length}:${snap.land.score}:${snap.hallLevelNow}:${snap.land.buildings.filter((b) => b.busy && b.readyAt > snap.chainTime).length}`;
    if (png) {
      const buf = await cached(`png:${id}:${stateKey}`, 10 * 60_000, () => landPngAsync(landSvg(id, snap.land, snap.chainTime, false)));
      res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=120').send(buf);
    } else {
      const svg = await cached(`svg:${id}:${stateKey}`, 10 * 60_000, async () => landSvg(id, snap.land, snap.chainTime, true));
      res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=120').send(svg);
    }
  }),
);

/** OpenSea collection metadata (contractURI). Royalties are read on-chain via ERC-2981. */
app.get('/api/contract-metadata', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').json({
    name: 'CITYHOOD Land',
    description: `${tokenomics.land.maxSupply.toLocaleString('en-US')} floating islands on Robinhood Chain. Every Land starts as an empty 16×16 island: build roads, homes and towers with $CITY and earn $CITY every hour. Each image is rendered live from on-chain state, so it always shows the real city, its development and its earning rate.`,
    image: `${PUBLIC_API_URL}/api/collection.png`,
    banner_image: `${PUBLIC_API_URL}/api/collection.png`,
    external_link: SITE_URL,
  });
});

app.get(
  '/api/collection.png',
  wrap(async (_req, res) => {
    const buf = await cached('collection', 24 * 3600_000, () => landPngAsync(landSvg(7, sampleCity(), 1, false), 800));
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=86400').send(buf);
  }),
);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[api]', err.message);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

const server = app.listen(PORT, (err?: Error) => {
  if (err) {
    console.error(`[api] could not listen on :${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`CITYHOOD API on :${PORT} · ${CHAIN.name} · store=${store.name} · db=${db.name} · contracts=${CONTRACTS_READY ? 'ready' : NFT_READY ? 'token + NFT (no game yet)' : 'missing'}`);
  if (NFT_READY) void startIndexer();
  void seedTasks().catch((e) => console.error('[tasks] seed failed:', e instanceof Error ? e.message : e));
  startJobs();
});
// keep connections from Railway's proxy open longer than the proxy does, so busy minutes don't turn into 502s
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;
void HttpError;
