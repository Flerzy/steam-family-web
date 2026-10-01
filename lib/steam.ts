import fs from "fs";
import path from "path";

const API = "https://api.steampowered.com";
const STORE = "https://store.steampowered.com/api";

const FAMILY_SHARE_CATEGORY_ID = 62;
const FAMILY_SHARE_CATEGORY_TEXT = "family sharing";
export const STORE_DELAY_MS = 1500;

// Shared with the Python CLI so already-fetched games are reused.
const CACHE_DIR = path.join(process.cwd(), "..", "steam-family-share", ".cache");

export type AppDetail = { shareable: boolean; price: number; name: string; known: boolean };
export type Game = { appid: number; name: string; playtime_forever: number };

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function headerImage(appid: number | string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

async function getJson(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "steam-family-web/1.0" } });
      if (res.status === 429) {
        await sleep(STORE_DELAY_MS * (i + 2));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status}: check STEAM_API_KEY`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000);
    }
  }
  return null;
}

export function normalizeIdent(raw: string): string {
  let ident = raw.trim();
  if (ident.includes("steamcommunity.com")) ident = ident.split("steamcommunity.com")[1];
  ident = ident.replace(/^\/+|\/+$/g, "").replace(/^@/, "");
  const low = ident.toLowerCase();
  if (low.startsWith("id/") || low.startsWith("profiles/")) ident = ident.split("/").slice(1).join("/");
  return ident.replace(/^\/+|\/+$/g, "");
}

export async function resolveId(key: string, raw: string): Promise<string> {
  const ident = normalizeIdent(raw);
  if (/^\d{17}$/.test(ident)) return ident;
  const data = await getJson(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(ident)}`);
  if (data?.response?.success === 1) return data.response.steamid;
  throw new Error(`Could not resolve "${raw}" to a SteamID.`);
}

export async function getPersona(key: string, ids: string[]) {
  const out: Record<string, { name: string; visibility: number; avatar: string }> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).join(",");
    const data = await getJson(`${API}/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${chunk}`);
    for (const p of data?.response?.players ?? []) {
      out[p.steamid] = {
        name: p.personaname ?? p.steamid,
        visibility: p.communityvisibilitystate ?? 0,
        avatar: p.avatarmedium ?? "",
      };
    }
  }
  return out;
}

export async function getOwnedGames(key: string, steamid: string): Promise<Game[] | null> {
  const url = `${API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`;
  const data = await getJson(url);
  const resp = data?.response ?? {};
  if (!("games" in resp)) return null; // private or none
  return resp.games as Game[];
}

function cacheFile(region: string) {
  return path.join(CACHE_DIR, `appdetails_${region}.json`);
}

export function loadCache(region: string): Record<string, AppDetail> {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(region), "utf-8"));
  } catch {
    return {};
  }
}

export function saveCache(region: string, cache: Record<string, AppDetail>) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile(region), JSON.stringify(cache));
}

export async function fetchAppDetail(appid: string, region: string): Promise<AppDetail> {
  const url = `${STORE}/appdetails?appids=${appid}&cc=${region}&l=en&filters=basic,categories,price_overview`;
  const data = await getJson(url);
  const entry: AppDetail = { shareable: false, price: 0, name: appid, known: false };
  const node = data?.[appid];
  if (node?.success && node.data && typeof node.data === "object") {
    const d = node.data;
    entry.known = true;
    entry.name = d.name ?? appid;
    const cats = d.categories ?? [];
    entry.shareable = cats.some(
      (c: any) => c.id === FAMILY_SHARE_CATEGORY_ID || (c.description ?? "").toLowerCase().includes(FAMILY_SHARE_CATEGORY_TEXT)
    );
    if (d.price_overview) entry.price = d.price_overview.final ?? 0;
  }
  return entry;
}
