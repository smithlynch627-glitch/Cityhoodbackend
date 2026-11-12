import 'dotenv/config';
import { defineChain, isAddress, type Address } from 'viem';

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

const env = process.env;
const addr = (v?: string) => (v && isAddress(v) ? (v as Address) : undefined);

export const CHAIN = env.CHAIN === 'mainnet' ? robinhood : robinhoodTestnet;
export const RPC_URL = env.RPC_URL || CHAIN.rpcUrls.default.http[0];
export const LAND_ADDRESS = addr(env.LAND_ADDRESS);
export const CITY_ADDRESS = addr(env.CITY_ADDRESS);
export const GAME_ADDRESS = addr(env.GAME_ADDRESS);
export const SALE_ADDRESS = addr(env.SALE_ADDRESS);
export const CONTRACTS_READY = !!(LAND_ADDRESS && CITY_ADDRESS && GAME_ADDRESS);
/** Token + Land NFT are live (the game can come later): sale, mint, NFT metadata and images all work. */
export const NFT_READY = !!(LAND_ADDRESS && CITY_ADDRESS);
/** The game contract is deployed. Without it every land is shown as an empty island. */
export const GAME_READY = CONTRACTS_READY;
/** Wallets whose $CITY doesn't count as circulating (game pools, unsold sale, team lock, treasury…). */
export const NONCIRCULATING = (env.NONCIRCULATING_ADDRESSES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => isAddress(s)) as Address[];
/** Private key of the sale voucher signer (a dedicated key that holds no funds). */
export const SALE_SIGNER_KEY = (env.SALE_SIGNER_PRIVATE_KEY || '').trim();
/** Minutes a sale voucher stays valid. */
export const VOUCHER_MINUTES = Number(env.VOUCHER_MINUTES || 20);
export const START_BLOCK = BigInt(env.START_BLOCK || '0');

export const PORT = Number(env.PORT || 8080);
export const PUBLIC_API_URL = (env.PUBLIC_API_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
export const SITE_URL = (env.SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
export const CORS_ORIGIN = (env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Admin password for the admin panel and admin API. Leave empty to disable admin routes. */
export const ADMIN_TOKEN = env.ADMIN_TOKEN || '';

/** Signs user and admin sessions. Required in production; a random one is used locally (sessions reset on restart). */
export const SESSION_SECRET = env.SESSION_SECRET || '';
export const IS_PROD = env.NODE_ENV === 'production' || !!env.RAILWAY_ENVIRONMENT;

/** X (Twitter) OAuth 2.0 app — developer.x.com → your app → User authentication settings. */
export const X_CLIENT_ID = env.X_CLIENT_ID || '';
export const X_CLIENT_SECRET = env.X_CLIENT_SECRET || '';
export const X_CALLBACK_URL = (env.X_CALLBACK_URL || `${(env.PUBLIC_API_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/$/, '')}/api/x/callback`).trim();
/** Optional app bearer token for automatic task checks through the X API (needs a paid X API tier). */
export const X_BEARER_TOKEN = env.X_BEARER_TOKEN || '';
/** Default project X handle (can be changed in the admin panel). */
export const X_HANDLE = (env.X_HANDLE || 'cityhood').replace(/^@/, '');

export const SUPABASE_URL = env.SUPABASE_URL || '';
export const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

export const POLL_MS = Number(env.POLL_MS || 8000);
export const LOG_CHUNK = BigInt(env.LOG_CHUNK || 2000);
export const REFRESH_MINUTES = Number(env.REFRESH_MINUTES || 10);
