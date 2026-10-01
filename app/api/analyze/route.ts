import { NextRequest } from "next/server";
import {
  resolveId, getPersona, getOwnedGames, loadCache, saveCache, fetchAppDetail,
  sleep, headerImage, STORE_DELAY_MS, type Game,
} from "@/lib/steam";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

function splitList(s: string | null) {
  return (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const key = process.env.STEAM_API_KEY;
  const region = sp.get("region") || "us";
  const famIdents = splitList(sp.get("family"));
  const candIdents = splitList(sp.get("candidates"));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Client disconnects must NOT abort the fetch loop — keep filling the
      // cache so a single run always completes. Sends just become no-ops.
      let alive = true;
      const send = (event: string, data: unknown) => {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          alive = false;
        }
      };

      try {
        if (!key) throw new Error("STEAM_API_KEY not set in .env.local");
        if (candIdents.length === 0) throw new Error("Add at least one candidate.");

        // 1) Resolve everyone + fetch libraries
        send("status", { phase: "resolving", message: "Resolving profiles…" });
        type Person = { ident: string; steamid: string; games: Game[]; name: string; avatar: string; private: boolean };
        const order = [...famIdents, ...candIdents];
        const people: Record<string, Person> = {};
        for (const ident of order) {
          if (people[ident]) continue;
          const steamid = await resolveId(key, ident);
          const games = await getOwnedGames(key, steamid);
          people[ident] = { ident, steamid, games: games ?? [], name: ident, avatar: "", private: games === null };
        }
        const summaries = await getPersona(key, Object.values(people).map((p) => p.steamid));
        for (const p of Object.values(people)) {
          p.name = summaries[p.steamid]?.name ?? p.ident;
          p.avatar = summaries[p.steamid]?.avatar ?? "";
        }
        send("people", {
          members: famIdents.map((i) => people[i]).map(pub),
          candidates: candIdents.map((i) => people[i]).map(pub),
        });

        // Ownership maps (known immediately, before any detail fetch)
        const famOwned = new Set<string>();
        for (const i of famIdents) for (const g of people[i].games) famOwned.add(String(g.appid));
        const candOwners: Record<string, string[]> = {};
        for (const i of candIdents)
          for (const g of people[i].games) (candOwners[String(g.appid)] ??= []).push(people[i].steamid);

        const cache = loadCache(region);
        const emitGame = (appid: string) => {
          const det = cache[appid];
          if (!det?.shareable || famOwned.has(appid)) return; // not new to family
          for (const sid of candOwners[appid] ?? [])
            send("game", { steamid: sid, appid, name: det.name, price: det.price, img: headerImage(appid) });
        };

        // 2) Fetch store details. Candidate-relevant games FIRST so cards fill fast.
        const allAppids = Array.from(new Set(Object.values(people).flatMap((p) => p.games.map((g) => String(g.appid)))));
        const isRelevant = (a: string) => candOwners[a] && !famOwned.has(a);
        const relevant = allAppids.filter(isRelevant);
        const rest = allAppids.filter((a) => !isRelevant(a));

        // Instantly surface already-cached relevant games
        for (const a of relevant) if (a in cache) emitGame(a);

        const todo = [...relevant, ...rest].filter((a) => !(a in cache));
        send("status", {
          phase: "details",
          message: `Fetching store details (${todo.length} new, ${allAppids.length - todo.length} cached)…`,
          total: allAppids.length, done: allAppids.length - todo.length,
        });

        let done = allAppids.length - todo.length;
        for (let n = 0; n < todo.length; n++) {
          const appid = todo[n];
          cache[appid] = await fetchAppDetail(appid, region);
          done++;
          emitGame(appid);
          if (n % 10 === 0 || n === todo.length - 1) saveCache(region, cache);
          send("progress", { done, total: allAppids.length, name: cache[appid].name });
          await sleep(STORE_DELAY_MS);
        }
        saveCache(region, cache);

        // 3) Final authoritative totals
        const shareableSet = (p: Person) =>
          new Set(p.games.map((g) => String(g.appid)).filter((a) => cache[a]?.shareable));
        const valueOf = (ids: Iterable<string>) => {
          let v = 0;
          for (const a of ids) v += cache[a]?.price ?? 0;
          return v;
        };
        const baseline = new Set<string>();
        for (const i of famIdents) for (const a of shareableSet(people[i])) baseline.add(a);
        const gameInfo = (a: string) => ({ appid: a, name: cache[a]?.name ?? a, price: cache[a]?.price ?? 0, img: headerImage(a) });

        const sharedList = (p: Person) =>
          [...shareableSet(p)].sort((x, y) => (cache[y]?.price ?? 0) - (cache[x]?.price ?? 0)).map(gameInfo);

        const contribution = (p: Person) => {
          const share = shareableSet(p);
          const newIds = [...share].filter((a) => !baseline.has(a));
          newIds.sort((x, y) => (cache[y]?.price ?? 0) - (cache[x]?.price ?? 0));
          return {
            name: p.name, steamid: p.steamid, avatar: p.avatar, private: p.private,
            totalGames: p.games.length, totalShareable: share.size,
            newGames: newIds.length, newValue: valueOf(newIds),
            overlapPct: share.size ? Math.round((100 * (share.size - newIds.length)) / share.size) : 0,
            games: newIds.map(gameInfo),
            shareableGames: sharedList(p),
          };
        };

        send("result", {
          region,
          family: {
            members: famIdents.map((i) => ({
              ...pub(people[i]),
              shareable: shareableSet(people[i]).size,
              shareableValue: valueOf(shareableSet(people[i])),
              shareableGames: sharedList(people[i]),
            })),
            baselineCount: baseline.size, baselineValue: valueOf(baseline),
          },
          candidates: candIdents.map((i) => contribution(people[i])),
        });
        send("done", {});
      } catch (e: any) {
        send("error", { message: e?.message ?? String(e) });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

function pub(p: { name: string; steamid: string; avatar: string; private: boolean; games: { appid: number }[] }) {
  return { name: p.name, steamid: p.steamid, avatar: p.avatar, private: p.private, totalGames: p.games.length };
}
