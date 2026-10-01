"use client";

import { useMemo, useRef, useState } from "react";
import { Users, Trophy, Loader2, Gamepad2, DollarSign, Search, TriangleAlert, ArrowLeftRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

type Game = { appid: string; name: string; price: number; img: string };
type Member = { name: string; steamid: string; avatar: string; private: boolean; totalGames: number; shareable?: number; shareableValue?: number; shareableGames?: Game[] };
type Candidate = {
  name: string; steamid: string; avatar: string; private: boolean;
  totalGames: number; totalShareable: number; newGames: number; newValue: number; overlapPct: number; games: Game[]; shareableGames?: Game[];
};
type Family = { members: Member[]; baselineCount: number; baselineValue: number };
type Person = { steamid: string; name: string; avatar: string; shareableGames: Game[] };

const CUR: Record<string, string> = { us: "$", uk: "£", eu: "€", ca: "C$", au: "A$" };

function GameThumb({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[92/43] w-full overflow-hidden bg-secondary/40">
      {failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted/30 px-1">
          <Gamepad2 className="h-4 w-4 text-muted-foreground/40" />
          <span className="line-clamp-2 text-center text-[10px] leading-tight text-muted-foreground/60">{game.name}</span>
        </div>
      ) : (
        <img
          src={game.img}
          alt={game.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function GameGrid({ games, money, variant = "full", initial }: {
  games: Game[]; money: (c: number) => string; variant?: "full" | "compact"; initial?: number;
}) {
  const cap = initial ?? (variant === "full" ? 24 : 12);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? games : games.slice(0, cap);
  const gridCls = variant === "full"
    ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
    : "grid grid-cols-2 gap-2 sm:grid-cols-3";
  return (
    <div>
      <div className={gridCls}>
        {shown.map((g) => (
          <div key={g.appid} className="group overflow-hidden rounded-md border bg-secondary/30">
            <GameThumb game={g} />
            <div className="flex items-center justify-between gap-1 px-2 py-1.5">
              <span className="truncate text-xs" title={g.name}>{g.name}</span>
              {g.price > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{money(g.price)}</span>}
            </div>
          </div>
        ))}
      </div>
      {games.length > cap && (
        <button onClick={() => setExpanded((v) => !v)} className="mt-2.5 text-sm font-medium text-primary hover:underline">
          {expanded ? "Show fewer" : `Show all ${games.length} games →`}
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const [family, setFamily] = useState("Flerzy,76561198871778233,76561198998205831,76561199064113159,76561198947348275");
  const [candidates, setCandidates] = useState("76561198185503026");
  const [region, setRegion] = useState("us");
  const [sort, setSort] = useState<"value" | "count">("value");

  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [family_, setFamily_] = useState<Family | null>(null);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const esRef = useRef<EventSource | null>(null);

  const blankRow = (c: Partial<Candidate>): Candidate => ({
    name: "", steamid: "", avatar: "", private: false, totalGames: 0,
    totalShareable: 0, newGames: 0, newValue: 0, overlapPct: 0, games: [], ...c,
  });

  const cur = CUR[region] ?? "$";
  const money = (cents: number) => `${cur}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const [pick, setPick] = useState<string[]>([]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (sort === "value" ? b.newValue - a.newValue : b.newGames - a.newGames)),
    [rows, sort]
  );

  // Everyone with a full shareable library (populated when the run finishes)
  const roster = useMemo(() => {
    const m: Record<string, Person> = {};
    for (const x of family_?.members ?? [])
      if (x.shareableGames) m[x.steamid] = { steamid: x.steamid, name: x.name, avatar: x.avatar, shareableGames: x.shareableGames };
    for (const c of rows)
      if (c.shareableGames) m[c.steamid] = { steamid: c.steamid, name: c.name, avatar: c.avatar, shareableGames: c.shareableGames };
    return m;
  }, [family_, rows]);

  const canCompare = Object.keys(roster).length > 0;
  const togglePick = (sid: string) =>
    setPick((p) => (p.includes(sid) ? p.filter((x) => x !== sid) : [...p, sid].slice(-2)));

  const comparison = useMemo(() => {
    if (pick.length !== 2 || !roster[pick[0]] || !roster[pick[1]]) return null;
    const A = roster[pick[0]], B = roster[pick[1]];
    const idsA = new Set(A.shareableGames.map((g) => g.appid));
    const idsB = new Set(B.shareableGames.map((g) => g.appid));
    const onlyA = A.shareableGames.filter((g) => !idsB.has(g.appid));
    const onlyB = B.shareableGames.filter((g) => !idsA.has(g.appid));
    const both = A.shareableGames.filter((g) => idsB.has(g.appid));
    const val = (arr: Game[]) => arr.reduce((s, g) => s + g.price, 0);
    return { A, B, onlyA, onlyB, both, valA: val(A.shareableGames), valB: val(B.shareableGames), valOnlyA: val(onlyA), valOnlyB: val(onlyB) };
  }, [pick, roster]);

  function run() {
    esRef.current?.close();
    setRunning(true); setFinished(false); setError(""); setRows([]); setFamily_(null); setProgress(null); setPick([]);
    setStatus("Starting…");

    const qs = new URLSearchParams({ family, candidates, region }).toString();
    const es = new EventSource(`/api/analyze?${qs}`);
    esRef.current = es;

    es.addEventListener("status", (e) => { const d = JSON.parse((e as MessageEvent).data); setStatus(d.message); if (d.total) setProgress({ done: d.done ?? 0, total: d.total }); });
    es.addEventListener("progress", (e) => { const d = JSON.parse((e as MessageEvent).data); setProgress({ done: d.done, total: d.total }); setStatus(`Fetched ${d.name}`); });
    es.addEventListener("people", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setFamily_({ members: d.members, baselineCount: 0, baselineValue: 0 });
      setRows(d.candidates.map((c: Partial<Candidate>) => blankRow(c)));
    });
    es.addEventListener("game", (e) => {
      const g = JSON.parse((e as MessageEvent).data) as { steamid: string } & Game;
      setRows((prev) => prev.map((r) => {
        if (r.steamid !== g.steamid || r.games.some((x) => x.appid === g.appid)) return r;
        const games = [...r.games, { appid: g.appid, name: g.name, price: g.price, img: g.img }].sort((a, b) => b.price - a.price);
        return { ...r, games, newGames: games.length, newValue: games.reduce((s, x) => s + x.price, 0) };
      }));
    });
    es.addEventListener("result", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setFamily_(d.family); setRows(d.candidates);
      setPick(d.candidates[0] ? [d.candidates[0].steamid] : []); // pre-select candidate; click a member to compare
    });
    es.addEventListener("error", (e) => { const d = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : null; if (d?.message) setError(d.message); setRunning(false); es.close(); });
    es.addEventListener("done", () => { setRunning(false); setFinished(true); setStatus("Done"); es.close(); });
  }

  const pct = progress ? Math.round((progress.done / Math.max(progress.total, 1)) * 100) : 0;

  return (
    <main className="container max-w-6xl py-10">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/15 p-2.5"><Gamepad2 className="h-7 w-7 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Steam Family Share Planner</h1>
            <p className="text-sm text-muted-foreground">Who adds the most new shareable games — and value — to your family?</p>
          </div>
        </div>
      </header>

      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Family (existing members)</label>
            <Input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="vanity names or SteamID64, comma-separated" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Candidates (to evaluate)</label>
            <Input value={candidates} onChange={(e) => setCandidates(e.target.value)} placeholder="vanity names or SteamID64, comma-separated" />
          </div>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Region</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                {Object.keys(CUR).map((r) => <option key={r} value={r} className="bg-background">{r.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">Rank by</span>
              <Button size="sm" variant={sort === "value" ? "default" : "outline"} onClick={() => setSort("value")}>Value</Button>
              <Button size="sm" variant={sort === "count" ? "default" : "outline"} onClick={() => setSort("count")}>Game count</Button>
            </div>
            <Button className="ml-auto" onClick={run} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {running ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(running || status) && (
        <Card className="mb-6">
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{status}
              </span>
              {progress && <span className="tabular-nums text-muted-foreground">{progress.done}/{progress.total} games ({pct}%)</span>}
            </div>
            <Progress value={pct} />
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-6 border-destructive/50">
          <CardContent className="flex items-center gap-2 pt-6 text-destructive">
            <TriangleAlert className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {family_ && family_.members.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> Family baseline</CardTitle>
            <CardDescription>
              {family_.baselineCount > 0
                ? <>{family_.baselineCount} unique shareable games · worth {money(family_.baselineValue)}{canCompare && " · click a member to compare, click a second to swap"}</>
                : "Resolving members…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {family_.members.map((m) => {
              const selected = pick.includes(m.steamid);
              return (
                <button
                  key={m.steamid}
                  disabled={!canCompare}
                  onClick={() => togglePick(m.steamid)}
                  className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-colors ${selected ? "border-primary bg-primary/15 ring-1 ring-primary" : "bg-secondary/40 hover:bg-secondary/70"} ${canCompare ? "cursor-pointer" : "cursor-default"}`}
                >
                  {m.avatar ? <img src={m.avatar} alt="" className="h-6 w-6 rounded-full" /> : <div className="h-6 w-6 rounded-full bg-muted" />}
                  <span className="text-sm">{m.name}</span>
                  {m.private ? <Badge variant="destructive">private</Badge>
                    : <span className="text-xs text-muted-foreground">{m.shareable ?? "—"} shareable</span>}
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {comparison && (
        <Card className="mb-6 border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              <span>{comparison.A.name}</span>
              <span className="text-muted-foreground">vs</span>
              <span>{comparison.B.name}</span>
              <button onClick={() => setPick([])} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-secondary" title="clear">
                <X className="h-4 w-4" />
              </button>
            </CardTitle>
            <CardDescription>
              {comparison.A.name}: {comparison.A.shareableGames.length} shareable ({money(comparison.valA)}) · {comparison.B.name}: {comparison.B.shareableGames.length} shareable ({money(comparison.valB)}) · <b className="text-foreground">{comparison.both.length}</b> in common
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {[
              { who: comparison.A, only: comparison.onlyA, val: comparison.valOnlyA, other: comparison.B },
              { who: comparison.B, only: comparison.onlyB, val: comparison.valOnlyB, other: comparison.A },
            ].map(({ who, only, val, other }) => (
              <div key={who.steamid} className="rounded-lg border bg-secondary/20 p-3">
                <div className="mb-1 flex items-center gap-2">
                  {who.avatar ? <img src={who.avatar} alt="" className="h-6 w-6 rounded-full" /> : <div className="h-6 w-6 rounded-full bg-muted" />}
                  <span className="font-medium">Only {who.name}</span>
                  <Badge variant="success" className="ml-auto">{only.length} games</Badge>
                  <Badge>{money(val)}</Badge>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">has that {other.name} doesn&apos;t</p>
                {only.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing unique — fully covered by {other.name}.</p>
                ) : (
                  <GameGrid games={only} money={money} variant="compact" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {sorted.map((c, i) => (
        <Card key={c.steamid} className={`mb-5 overflow-hidden ${pick.includes(c.steamid) ? "border-primary/50 ring-1 ring-primary" : ""}`}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              {i === 0 && sorted.length > 1 && <Trophy className="h-5 w-5 text-amber-400" />}
              <button
                disabled={!canCompare}
                onClick={() => togglePick(c.steamid)}
                className={`flex items-center gap-3 rounded-md ${canCompare ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                title={canCompare ? "click to compare" : undefined}
              >
                {c.avatar ? <img src={c.avatar} alt="" className="h-9 w-9 rounded-full" /> : <div className="h-9 w-9 rounded-full bg-muted" />}
                <CardTitle className="text-lg">{c.name}</CardTitle>
              </button>
              {c.private && <Badge variant="destructive">profile private — set Game details to Public</Badge>}
              <div className="ml-auto flex items-center gap-2">
                {running && !finished && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <Badge variant="success" className="gap-1"><Gamepad2 className="h-3 w-3" />{c.newGames} new</Badge>
                <Badge className="gap-1"><DollarSign className="h-3 w-3" />{money(c.newValue)}</Badge>
                {finished && <Badge variant="secondary">{c.overlapPct}% overlap</Badge>}
              </div>
            </div>
            <CardDescription>
              {c.totalGames} games owned{finished && ` · ${c.totalShareable} shareable`} · <b className="text-foreground">{c.newGames}</b> new to the family{" "}
              {finished ? "adding" : "so far, adding"} <b className="text-foreground">{money(c.newValue)}</b>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {c.games.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {finished ? "No new shareable games — everything is already covered by the family." : "Scanning library…"}
              </p>
            ) : (
              <GameGrid games={c.games} money={money} variant="full" />
            )}
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
