// Forecast penonton Twitch per jam di hari rilis GTA VI (gta6-twitch-ccu-forecast-01).
//
// Model: median tiap jam = print jam 1 x rasio kurva-bentuk-launch, di mana rasio
// itu diregresi terhadap log print jam 1 (skala sublinear: jam 1 besar -> kurva
// lebih datar). Intercept di-fit saat runtime dari comparables di file case
// (blend 50/50 antara semua launch rolling-midnight yang bersih dan subset
// single-player konsol), slope mengikuti rumus per jam, lalu ada koreksi jam 5
// menurut DST Amerika (loncatan unlock Pantai Timur jatuh di jam 5 saat EDT,
// jam 6 saat EST) dan pita kuantil log-normal yang melebar pelan.
//
// Node 22, standard library saja. Deterministik: tanpa network, tanpa random,
// tanpa jam dinding. Membaca semua *.in di direktori input, menulis satu
// <id>.out per case ke direktori output.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Kuantil normal baku untuk level [0.05, 0.25, 0.5, 0.75, 0.95].
const Z_VALUES = [-1.645, -0.674, 0, 0.674, 1.645];

// Jam 1 terbesar di comparables; di atas ini rasio tidak diekstrapolasi lagi.
const H1_CLAMP = 875155;

// Ambang filter comparables.
const MIN_H1 = 20000;
const MAX_PEAK_RATIO = 8;

// Launch single-player konsol yang se-genre dengan GTA VI.
const STORY_SINGLE_PLAYER = new Set([
  "Ghost of Yōtei",
  "Stellar Blade",
  "FINAL FANTASY VII REBIRTH",
  "The Legend of Zelda: Tears of the Kingdom",
  "The Last of Us Part II",
  "Ghost of Tsushima",
]);

// Intercept fallback (jam 2..24), dipakai bila fit runtime tidak memungkinkan.
// Nilai-nilai ini adalah hasil fit yang sama atas comparables practice.
const FALLBACK_INTERCEPTS: Record<number, number> = {
  2: -1.3, 3: -1.596, 4: -1.651, 5: 0.516, 6: 0.839, 7: 0.984, 8: 1.155,
  9: 1.368, 10: 1.583, 11: 1.841, 12: 2.14, 13: 2.498, 14: 2.852,
  15: 3.236, 16: 3.537, 17: 3.799, 18: 4.08, 19: 4.369, 20: 4.618,
  21: 4.834, 22: 5.01, 23: 5.164, 24: 5.29,
};

// Slope log-rasio terhadap log jam 1: cekungan dini hari hampir tidak
// tergantung jam 1, lalu makin negatif seiring jam (puncak sore sublinear).
function slopeForHour(hour: number): number {
  if (hour <= 4) return 0.1;
  return -0.06 - 0.0185 * (hour - 5);
}

// Spread log kuantil: lebar dan tumbuh pelan dengan akar jam.
function spreadForHour(hour: number): number {
  return 0.22 + 0.05 * Math.sqrt(hour - 1);
}

// Minggu ke-n (1-based) di bulan tertentu, sebagai tanggal UTC.
function nthWeekdayOfMonth(year: number, monthZeroBased: number, weekday: number, n: number): number {
  const firstDay = new Date(Date.UTC(year, monthZeroBased, 1)).getUTCDay();
  const firstOccurrence = 1 + ((weekday - firstDay + 7) % 7);
  return firstOccurrence + 7 * (n - 1);
}

// Apakah day_start jatuh dalam DST Amerika (Minggu ke-2 Maret s.d. Minggu
// ke-1 November)? Di luar rentang itu Amerika memakai waktu standar (EST).
function isUsDaylightTime(dayStartMs: number): boolean {
  const year = new Date(dayStartMs).getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthWeekdayOfMonth(year, 2, 0, 2));
  const dstEnd = Date.UTC(year, 10, nthWeekdayOfMonth(year, 10, 0, 1));
  return dayStartMs >= dstStart && dayStartMs < dstEnd;
}

interface ComparableGame {
  hourOne: number;
  viewersByHour: Map<number, number>;
}

// Ambil jam 1..24 sebuah comparable dari array hourly-nya. Mengembalikan
// null bila game bukan tier comparable, atau jam 1 tidak ada / tidak valid.
function parseComparable(raw: any): ComparableGame | null {
  const unlockText = typeof raw?.unlock === "string" ? raw.unlock : "";
  if (!unlockText.includes("Tier: comparable")) return null;
  if (!Array.isArray(raw?.hourly)) return null;
  const dayStartMs = Date.parse(raw.day_start);
  if (!Number.isFinite(dayStartMs)) return null;

  const viewersByHour = new Map<number, number>();
  for (const point of raw.hourly) {
    const atMs = Date.parse(point?.from);
    const viewers = Number(point?.viewers);
    if (!Number.isFinite(atMs) || !Number.isFinite(viewers) || viewers <= 0) continue;
    const hour = Math.round((atMs - dayStartMs) / 3600000) + 1;
    if (hour < 1 || hour > 24) continue;
    if (!viewersByHour.has(hour)) viewersByHour.set(hour, viewers);
  }
  const hourOne = viewersByHour.get(1);
  if (hourOne === undefined || hourOne <= 0) return null;
  return { hourOne, viewersByHour };
}

// Saring comparables ke launch rolling-midnight yang bersih: tier comparable,
// jam 1 minimal 20 ribu, dan puncak (jam 2..24) paling banyak 8x jam 1.
// Filter ini membuang launch simultan-global (jam 1 hampir kosong) dan yang
// terkontaminasi early access.
// Satu game lolos filter bentuk-launch: jam 1 minimal 20 ribu dan puncak
// (jam 2..24) paling banyak 8x jam 1.
function isCleanLaunch(game: ComparableGame): boolean {
  if (game.hourOne < MIN_H1) return false;
  let peak = 0;
  for (let h = 2; h <= 24; h++) {
    const v = game.viewersByHour.get(h);
    if (v !== undefined && v > peak) peak = v;
  }
  return peak > 0 && peak / game.hourOne <= MAX_PEAK_RATIO;
}

function selectCleanLaunches(rawComparables: any[]): ComparableGame[] {
  const clean: ComparableGame[] = [];
  if (!Array.isArray(rawComparables)) return clean;
  for (const raw of rawComparables) {
    const game = parseComparable(raw);
    if (game === null) continue;
    if (!isCleanLaunch(game)) continue;
    clean.push(game);
  }
  return clean;
}

// Fit intercept per jam atas satu kelompok game, dengan slope yang sudah
// ditentukan: a_h = rata-rata [ ln(v_h / v_1) - b_h * ln(h1) ].
function fitIntercepts(games: ComparableGame[]): Map<number, number> {
  const fitted = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const b = slopeForHour(h);
    let sum = 0;
    let count = 0;
    for (const game of games) {
      const v = game.viewersByHour.get(h);
      if (v === undefined || v <= 0) continue;
      sum += Math.log(v / game.hourOne) - b * Math.log(game.hourOne);
      count++;
    }
    if (count > 0) fitted.set(h, sum / count);
  }
  return fitted;
}

// Forecast baseline house (persistensi): dipakai hanya bila tidak ada
// comparables sama sekali untuk di-fit.
function baselineForecast(p1: number): { hours: { hour: number; q: number[] }[] } {
  const hours: { hour: number; q: number[] }[] = [];
  for (let h = 2; h <= 24; h++) {
    const spread = 0.15 * Math.sqrt(h - 1);
    const q = Z_VALUES.map((z) => roundTwo(p1 * Math.exp(z * spread)));
    hours.push({ hour: h, q: clampQuantiles(q) });
  }
  return { hours };
}

function roundTwo(x: number): number {
  return Math.round(x * 100) / 100;
}

// Jaga kuantil tetap dalam (0, 1e9] dan non-decreasing (pembulatan bisa
// menyamakan dua kuantil yang berdekatan, itu dibolehkan).
function clampQuantiles(q: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const value of q) {
    let v = Number.isFinite(value) ? value : 0;
    if (v <= 0) v = 0.01;
    if (v > 1e9) v = 1e9;
    if (v < prev) v = prev;
    out.push(v);
    prev = v;
  }
  return out;
}

function forecastCase(caseData: any): { hours: { hour: number; q: number[] }[] } {
  const knownRow = Array.isArray(caseData?.known)
    ? caseData.known.find((row: any) => row?.hour === 1)
    : undefined;
  let p1 = Number(knownRow?.viewers);
  if (!Number.isFinite(p1) || p1 < 1) p1 = 1;

  const rawComparables = caseData?.comparables;
  if (!Array.isArray(rawComparables) || rawComparables.length === 0) {
    return baselineForecast(p1);
  }

  const pooled = selectCleanLaunches(rawComparables);

  // Intercept blend 50/50 dari fit runtime; bila kelompok pooled terlalu
  // kecil untuk di-fit (< 5 game), pakai tabel intercept fallback — program
  // tetap memakai model, bukan jatuh ke baseline persistensi.
  const blended = new Map<number, number>();
  if (pooled.length < 5) {
    for (let h = 2; h <= 24; h++) blended.set(h, FALLBACK_INTERCEPTS[h]);
  } else {
    // Subset single-player: nama game harus cocok dengan daftar SP-6. Karena
    // parseComparable membuang nama, pasangkan lagi lewat nama mentah di sini.
    const spGames: ComparableGame[] = [];
    for (const raw of rawComparables) {
      if (!STORY_SINGLE_PLAYER.has(raw?.name)) continue;
      const game = parseComparable(raw);
      if (game === null || !isCleanLaunch(game)) continue;
      spGames.push(game);
    }

    const pooledFit = fitIntercepts(pooled);
    const spFit = fitIntercepts(spGames);

    // Bila satu sisi kosong untuk suatu jam, pakai sisi lain; bila keduanya
    // kosong, pakai tabel fallback.
    for (let h = 2; h <= 24; h++) {
      const aPooled = pooledFit.get(h);
      const aSp = spFit.get(h);
      if (aPooled !== undefined && aSp !== undefined) blended.set(h, 0.5 * aPooled + 0.5 * aSp);
      else if (aPooled !== undefined) blended.set(h, aPooled);
      else if (aSp !== undefined) blended.set(h, aSp);
      else blended.set(h, FALLBACK_INTERCEPTS[h]);
    }
  }

  const p1c = Math.min(p1, H1_CLAMP);
  const logP1c = Math.log(p1c);

  // Log-rasio median per jam dari fit blend.
  const logRatio = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    logRatio.set(h, blended.get(h)! + slopeForHour(h) * logP1c);
  }

  // Koreksi jam 5: loncatan unlock Pantai Timur AS jatuh di jam 5 saat EDT
  // (75% kenaikan jam 4->6 sudah terjadi) dan di jam 6 saat EST (jam 5
  // tetap di level cekungan).
  const dayStartMs = Date.parse(caseData.day_start);
  const daylight = Number.isFinite(dayStartMs) ? isUsDaylightTime(dayStartMs) : false;
  const rise = logRatio.get(6)! - logRatio.get(4)!;
  logRatio.set(5, logRatio.get(4)! + (daylight ? 0.75 : 0) * rise);

  const hours: { hour: number; q: number[] }[] = [];
  for (let h = 2; h <= 24; h++) {
    const spread = spreadForHour(h);
    const center = logRatio.get(h)!;
    const q = Z_VALUES.map((z) => roundTwo(p1 * Math.exp(center + z * spread)));
    hours.push({ hour: h, q: clampQuantiles(q) });
  }
  return { hours };
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outputDir, { recursive: true });

  const files = readdirSync(inputDir)
    .filter((name) => name.endsWith(".in"))
    .sort();
  for (const name of files) {
    const caseData = JSON.parse(readFileSync(join(inputDir, name), "utf-8"));
    const id = typeof caseData?.id === "string" && caseData.id.length > 0
      ? caseData.id
      : name.replace(/\.in$/, "");
    const forecast = forecastCase(caseData);
    writeFileSync(join(outputDir, `${id}.out`), JSON.stringify(forecast));
  }
}

main();
