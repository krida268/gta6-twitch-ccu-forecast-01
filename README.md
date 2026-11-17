# GTA VI Twitch CCU Forecast — gta6-twitch-ccu-forecast-01

![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)
![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/krida268/gta6-twitch-ccu-forecast-01/rank.svg)
![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/krida268/gta6-twitch-ccu-forecast-01/reward.svg)

Forecast jumlah penonton Twitch kategori Grand Theft Auto VI per jam di hari
rilis, 19 November 2026 (UTC), untuk jam 2–24, sebagai lima kuantil
(5% / 25% / 50% / 75% / 95%) per jam.

Kompetisi: https://make.fun/bounty/gta6-twitch-ccu-forecast-01

## Strategi

Program ini (`main.ts`, Node 22, standard library saja) tidak memakai
persistensi jam 1. Median tiap jam = print jam 1 × rasio kurva-bentuk-launch,
di mana rasio itu diregresi terhadap log print jam 1:

- **Skala sublinear terhadap jam 1.** Di antara launch rolling-midnight yang
  bersih, log rasio puncak berkorelasi −0,85 dengan log jam 1: jam 1 yang
  besar sebagian adalah hype pra-rilis yang tidak bertahan, jadi level sore
  hari tumbuh lebih lambat daripada jam 1. Slope per jam dihaluskan dari
  regresi comparables (+0,10 di jam 2–4, lalu −0,06 turun linear ke −0,41
  di jam 24).
- **Fit saat runtime.** Intercept per jam dihitung ulang dari `comparables`
  di file case: rata-rata `ln(v_h / v_1) − b_h · ln(h1)`, di-blend 50/50
  antara semua launch bersih (tier `comparable`, jam 1 ≥ 20.000, puncak
  ≤ 8× jam 1) dan 6 launch single-player konsol yang se-genre dengan GTA VI
  (Ghost of Yōtei, Stellar Blade, FINAL FANTASY VII REBIRTH, Zelda: Tears of
  the Kingdom, The Last of Us Part II, Ghost of Tsushima). Di final,
  comparables berisi 42 game termasuk 4 practice launch, jadi fit runtime
  otomatis memakai mereka. Bila fit runtime tidak memungkinkan, program
  memakai tabel intercept fallback yang sama.
- **Koreksi jam unlock.** Loncatan unlock Pantai Timur AS jatuh di jam 5 saat
  EDT dan jam 6 saat EST (aturan DST AS: Minggu ke-2 Maret s.d. Minggu ke-1
  November). Final 19 Nov 2026 adalah EST, jadi jam 5 tetap di level
  cekungan. Jam 5 dihitung sebagai `logR_4 + f · (logR_6 − logR_4)` dengan
  f = 0,75 (EDT) atau 0 (EST).
- **Clamp ekstrapolasi.** Jam 1 di-clamp di 875.155 (jam 1 terbesar di
  comparables) agar ekstrapolasi power-law tidak memprediksi puncak sore di
  bawah jam 1.
- **Spread jujur.** Pita kuantil log-normal dengan
  `s_h = 0,22 + 0,05 · √(h−1)`, lebih lebar dari baseline karena
  ketidakpastian antar-game memang besar.
- **Yang sengaja tidak dipakai:** channels, `pre_peak`, hari dalam minggu,
  history GTA VI pra-rilis, `streams`, dan `categories_hourly` — semuanya
  diuji dan tidak prediktif.

## Hasil practice (skor lokal)

| Case | Loss model | Loss baseline |
|---|---|---|
| p00 Marvel's Wolverine | 0,3230 | 0,7437 |
| p01 Red Dead Redemption 2 | 0,1688 | 0,2868 |
| p02 God of War Ragnarök | 0,1148 | 0,2146 |
| p03 Marvel's Spider-Man 2 | 0,1695 | 0,3033 |
| **Rata-rata** | **0,1940** | **0,3871** |

Typical miss 37,1% (baseline 82,7%), 90% coverage 0,913 (baseline 0,783).

## Cara grade lokal

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
# skor tiap case dengan scorer lokal + jawaban practice, lalu bandingkan
# dengan tabel di atas (target total 0,1940 ± 0,001)
```

Program membaca semua `*.in` di direktori input dan menulis satu `<id>.out`
per case. Deterministik (tanpa network, tanpa random, tanpa jam dinding):
dua run pada case yang sama menghasilkan byte yang identik. Runtime jauh di
bawah batas 8 detik per case.

## Referral

Masuk lewat referral: https://make.fun/r/enzt809f
