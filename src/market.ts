import { Router } from 'express';
import { formatEther, parseAbi, zeroAddress, type Address } from 'viem';
import { client } from './chain';
import { CityGameAbi, CityLandAbi, CitySaleAbi, CityTokenAbi } from './abi';
import { CITY_ADDRESS, GAME_ADDRESS, LAND_ADDRESS, NONCIRCULATING, SALE_ADDRESS } from './config';
import { wrap } from './security';
import tokenomics from './shared/tokenomics.json';

const PairAbi = parseAbi(['function getReserves() view returns (uint112, uint112, uint32)', 'function token0() view returns (address)']);

/* ------------------------------------------------------------------ ETH / USD */
let ethUsd: { at: number; usd: number | null; source: string } = { at: 0, usd: null, source: 'none' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
export async function getEthUsd() {
  if (Date.now() - ethUsd.at < 60_000 && ethUsd.usd) return ethUsd;
  const cg = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
  let usd = Number(cg?.ethereum?.usd);
  let source = 'coingecko';
  if (!Number.isFinite(usd) || usd <= 0) {
    const cb = await fetchJson('https://api.coinbase.com/v2/prices/ETH-USD/spot');
    usd = Number(cb?.data?.amount);
    source = 'coinbase';
  }
  if (Number.isFinite(usd) && usd > 0) ethUsd = { at: Date.now(), usd, source };
  else ethUsd = { ...ethUsd, at: Date.now() - 45_000 }; // keep the last good price, retry soon
  return ethUsd;
}

/* ------------------------------------------------------------------ tokenomics */
const read = <T>(address: Address | undefined, abi: unknown, functionName: string, args: unknown[] = []) =>
  address
    ? (client.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never }) as Promise<T>).catch(() => null as T | null)
    : Promise.resolve(null as T | null);

let cache: { at: number; value: unknown } | null = null;

export async function getTokenomics() {
  if (cache && Date.now() - cache.at < 20_000) return cache.value;
  const total = BigInt(tokenomics.totalSupply) * 10n ** 18n;
  const [supply, pair, buyTax, sellTax, trading, limits, maxTx, maxWallet, taxCollected, saleInfo, pools, minted, maxLands, eth] = await Promise.all([
    read<bigint>(CITY_ADDRESS, CityTokenAbi, 'totalSupply'),
    read<Address>(CITY_ADDRESS, CityTokenAbi, 'mainPair'),
    read<number>(CITY_ADDRESS, CityTokenAbi, 'buyTaxBps'),
    read<number>(CITY_ADDRESS, CityTokenAbi, 'sellTaxBps'),
    read<boolean>(CITY_ADDRESS, CityTokenAbi, 'tradingEnabled'),
    read<boolean>(CITY_ADDRESS, CityTokenAbi, 'limitsInEffect'),
    read<bigint>(CITY_ADDRESS, CityTokenAbi, 'maxTxAmount'),
    read<bigint>(CITY_ADDRESS, CityTokenAbi, 'maxWalletAmount'),
    read<bigint>(CITY_ADDRESS, CityTokenAbi, 'totalTaxCollected'),
    Promise.all([
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'packPrice'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'totalSold'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'totalRaised'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'buyers'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'available'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'maxPerWallet'),
      read<boolean>(SALE_ADDRESS, CitySaleAbi, 'voucherRequired'),
      read<boolean>(SALE_ADDRESS, CitySaleAbi, 'paused'),
      read<Address>(SALE_ADDRESS, CitySaleAbi, 'usdg'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'usdgPackPrice'),
      read<bigint>(SALE_ADDRESS, CitySaleAbi, 'totalRaisedUsdg'),
    ]),
    read<readonly [bigint, bigint, bigint]>(GAME_ADDRESS, CityGameAbi, 'pools'),
    read<bigint>(LAND_ADDRESS, CityLandAbi, 'totalMinted'),
    read<bigint>(LAND_ADDRESS, CityLandAbi, 'maxSupply'),
    getEthUsd(),
  ]);
  const totalSupply = supply ?? total;

  // non-circulating balances (pools, unsold sale, team lock, treasury, …)
  const holders = [...new Set([...(GAME_ADDRESS ? [GAME_ADDRESS] : []), ...(SALE_ADDRESS ? [SALE_ADDRESS] : []), ...NONCIRCULATING].map((a) => a.toLowerCase()))] as Address[];
  const balances = await Promise.all(holders.map((h) => read<bigint>(CITY_ADDRESS, CityTokenAbi, 'balanceOf', [h])));
  const locked = balances.reduce<bigint>((s, b) => s + (b ?? 0n), 0n);
  const circulating = supply ? (totalSupply > locked ? totalSupply - locked : 0n) : 0n;

  // price: DEX pool when it has liquidity, otherwise the sale price
  const [packPrice, sold, raised, buyers, available, maxPerWallet, voucherRequired, salePaused, usdg, usdgPackPrice, raisedUsdg] = saleInfo;
  const usdgOn = !!usdg && usdg !== zeroAddress && !!usdgPackPrice;
  const salePrice = packPrice ? Number(formatEther(packPrice)) / tokenomics.sale.packSize : Number(tokenomics.sale.packPriceEth) / tokenomics.sale.packSize;
  let dexPrice: number | null = null;
  if (pair && pair !== zeroAddress) {
    const [reserves, token0] = await Promise.all([read<readonly [bigint, bigint, number]>(pair, PairAbi, 'getReserves'), read<Address>(pair, PairAbi, 'token0')]);
    if (reserves && token0) {
      const cityIsToken0 = token0.toLowerCase() === CITY_ADDRESS?.toLowerCase();
      const rc = cityIsToken0 ? reserves[0] : reserves[1];
      const re = cityIsToken0 ? reserves[1] : reserves[0];
      if (rc > 0n && re > 0n) dexPrice = Number(formatEther(re)) / Number(formatEther(rc));
    }
  }
  const priceEth = dexPrice ?? salePrice;
  const supplyNum = Number(formatEther(totalSupply));
  const circNum = Number(formatEther(circulating));
  const usd = eth.usd;

  const value = {
    symbol: tokenomics.symbol,
    initialSupply: tokenomics.totalSupply,
    totalSupply: supplyNum,
    burned: Math.max(0, tokenomics.totalSupply - supplyNum),
    circulating: circNum,
    nonCirculating: Number(formatEther(locked)),
    allocations: tokenomics.allocations,
    price: { eth: priceEth, usd: usd ? priceEth * usd : null, source: dexPrice ? 'dex' : 'sale', saleEth: salePrice, dexEth: dexPrice },
    ethUsd: usd,
    fdv: { eth: priceEth * supplyNum, usd: usd ? priceEth * supplyNum * usd : null },
    marketCap: { eth: priceEth * circNum, usd: usd ? priceEth * circNum * usd : null },
    sale: {
      packSize: tokenomics.sale.packSize,
      packPriceWei: (packPrice ?? 0n).toString(),
      packPriceEth: packPrice ? formatEther(packPrice) : tokenomics.sale.packPriceEth,
      maxPerWallet: maxPerWallet ? Number(formatEther(maxPerWallet)) : tokenomics.sale.maxPerWallet,
      landsPerWallet: tokenomics.sale.landsPerWallet,
      sold: sold ? Number(formatEther(sold)) : 0,
      available: available ? Number(formatEther(available)) : null,
      allocation: tokenomics.allocations.find((a) => a.key === 'sale')?.amount ?? 0,
      raisedEth: raised ? Number(formatEther(raised)) : 0,
      // USDG has 6 decimals
      usdg: usdgOn ? usdg : null,
      packPriceUsdg: usdgOn ? Number(usdgPackPrice) / 1e6 : null,
      raisedUsdg: raisedUsdg ? Number(raisedUsdg) / 1e6 : 0,
      buyers: buyers ? Number(buyers) : 0,
      voucherRequired: voucherRequired ?? true,
      paused: salePaused ?? false,
    },
    tax: {
      buyBps: buyTax ?? tokenomics.tax.buyBps,
      sellBps: sellTax ?? tokenomics.tax.sellBps,
      maxBps: tokenomics.tax.maxBps,
      tradingEnabled: trading ?? false,
      limitsInEffect: limits ?? true,
      maxTx: maxTx ? Number(formatEther(maxTx)) : null,
      maxWallet: maxWallet ? Number(formatEther(maxWallet)) : null,
      collected: taxCollected ? Number(formatEther(taxCollected)) : 0,
      pair: pair && pair !== zeroAddress ? pair : null,
    },
    pools: pools ? { mining: Number(formatEther(pools[0])), airdrop: Number(formatEther(pools[1])), recycled: Number(formatEther(pools[2])) } : null,
    lands: { minted: minted ? Number(minted) : 0, maxSupply: maxLands ? Number(maxLands) : tokenomics.land.maxSupply },
    updatedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), value };
  return value;
}

export const market = Router();
market.get(
  '/api/tokenomics',
  wrap(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=15').json(await getTokenomics());
  }),
);
market.get(
  '/api/price/eth',
  wrap(async (_req, res) => {
    const p = await getEthUsd();
    res.set('Cache-Control', 'public, max-age=30').json({ usd: p.usd, source: p.source, at: new Date(p.at).toISOString() });
  }),
);
