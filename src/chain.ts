import { createPublicClient, http, type Address } from 'viem';
import { CityGameAbi, CityLandAbi, CityTokenAbi } from './abi';
import { CHAIN, CITY_ADDRESS, GAME_ADDRESS, LAND_ADDRESS, RPC_URL } from './config';

/** How a land looks before the game exists (or before its owner opens it): an empty island. */
const EMPTY_LAND = { activated: false, hallLevel: 0, lastSettle: 0, boost: 0, rate: 0, score: 0n, pending: 0n, totalClaimed: 0n, buildings: [] };
import type { ChainLand } from './shared/economy';

export const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL, { batch: true, retryCount: 3 }) });

export interface LandSnapshot {
  landId: number;
  owner: Address | null;
  land: ChainLand;
  chainTime: number;
  rateNow: number;
  boostNow: number;
  hallLevelNow: number;
  pendingNow: bigint;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toChainLand(v: any): ChainLand {
  return {
    activated: v.activated,
    hallLevel: Number(v.hallLevel),
    lastSettle: Number(v.lastSettle),
    boost: Number(v.boost),
    rate: Number(v.rate),
    score: BigInt(v.score),
    pending: BigInt(v.pending),
    totalClaimed: BigInt(v.totalClaimed),
    buildings: (v.buildings as any[]).map((b) => ({
      kind: Number(b.kind),
      x: Number(b.x),
      y: Number(b.y),
      level: Number(b.level),
      busy: Boolean(b.busy),
      readyAt: Number(b.readyAt),
      rate: Number(b.rate),
      boost: Number(b.boost),
      points: BigInt(b.points),
    })),
  };
}

export async function ownerOf(landId: number): Promise<Address | null> {
  try {
    return (await client.readContract({ address: LAND_ADDRESS!, abi: CityLandAbi, functionName: 'ownerOf', args: [BigInt(landId)] })) as Address;
  } catch {
    return null; // not minted
  }
}

export async function snapshot(landId: number): Promise<LandSnapshot | null> {
  const owner = await ownerOf(landId);
  if (!owner) return null;
  if (!GAME_ADDRESS) {
    return { landId, owner, land: { ...EMPTY_LAND, buildings: [] }, chainTime: Math.floor(Date.now() / 1000), rateNow: 0, boostNow: 0, hallLevelNow: 0, pendingNow: 0n };
  }
  const v: any = await client.readContract({ address: GAME_ADDRESS!, abi: CityGameAbi, functionName: 'getLand', args: [BigInt(landId)] });
  return {
    landId,
    owner,
    land: toChainLand(v),
    // the latest block can be minutes old on a quiet chain (blocks are only made for transactions),
    // so never let the NFT image lag behind the real time
    chainTime: Math.max(Number(v.timestamp), Math.floor(Date.now() / 1000)),
    rateNow: Number(v.rateNow),
    boostNow: Number(v.boostNow),
    hallLevelNow: Number(v.hallLevelNow),
    pendingNow: BigInt(v.pendingNow),
  };
}

export async function chainStats() {
  const [minted, maxSupply, stats, supply] = await Promise.all([
    client.readContract({ address: LAND_ADDRESS!, abi: CityLandAbi, functionName: 'totalMinted' }),
    client.readContract({ address: LAND_ADDRESS!, abi: CityLandAbi, functionName: 'maxSupply' }),
    GAME_ADDRESS ? client.readContract({ address: GAME_ADDRESS, abi: CityGameAbi, functionName: 'stats' }) : Promise.resolve([0n, 0n, 0n, 0n, 0n, 0n] as const),
    client.readContract({ address: CITY_ADDRESS!, abi: CityTokenAbi, functionName: 'totalSupply' }),
  ]);
  const [active, constructions, spent, burned, claimed, granted] = stats as readonly bigint[];
  return {
    landsMinted: Number(minted),
    maxSupply: Number(maxSupply),
    activeLands: Number(active),
    constructions: Number(constructions),
    citySpent: spent.toString(),
    cityBurned: burned.toString(),
    cityClaimed: claimed.toString(),
    cityGranted: granted.toString(),
    citySupply: (supply as bigint).toString(),
  };
}
