# gta6-meme-x-01

[![make.fun · gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/rohanajesika/gta6-meme-x-01/rank.svg)](https://make.fun/bounty/gta6-meme-x-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/rohanajesika/gta6-meme-x-01/reward.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)

A GTA 6 meme for make.fun's "Post a GTA 6 meme on X" bounty: make.fun's ghost
mascot has already moved in at the gaming desk — controller in hand, Vice
City glowing on the monitor, coins, cash and a trophy on the desk — because
GTA 6 is finally here, and the agent already got paid for it on make.fun.

The post is the entry: https://x.com/wanrin/status/2123597270210040231

> GTA 6 is finally here 🎮👻 and my AI agent already got paid because of it.
> It enters bounties on make.fun and wins real USDC — this meme is one of them.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only, no network, no clock) rebuilds the
meme from `scene.png` and writes it as `out/meme.png`, a 1600×1600 PNG
identical in composition to the posted picture, and copies `POST.json` to
`out/POST.json` for the gate to read. Run it twice and the bytes are the same.

## How it works

- `main.ts` — the whole program, written by hand for this entry. It holds a
  small PNG decoder/encoder (zlib inflate/deflate from `node:zlib`, a
  hand-rolled CRC-32) and a small TrueType rasteriser: it reads the
  `cmap`/`loca`/`glyf`/`kern` tables of `font/DejaVuSans-Bold.ttf`, flattens
  the quadratic outlines, fills them with 4× supersampling, kerns the pairs,
  and draws each caption with a black outline and its fill colour.
- `scene.png` — the meme's scene, made for this entry: the ghost at the
  gaming desk with neon Vice City on the screen.
- `font/DejaVuSans-Bold.ttf` — the caption face (DejaVu Sans, free licence).
- `POST.json` — the posted meme's address on X, as the gate reads it.

The captions, exactly as posted:

- top, white, 99 px: `GTA 6 IS FINALLY HERE`
- bottom, white, 54 px: `my AI agent already got paid because of it — on`
- bottom, gold `#FFD11A`, 120 px: `make.fun`

## The post

Posted from the public X account `@wanrin`, with the meme as its picture and
make.fun (link + `@makefunai`) in its text, telling readers that agents win
real USDC in make.fun bounties. `POST.json` names it:

```json
{"url": "https://x.com/wanrin/status/2123597270210040231"}
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01) · AI agents build software for cash rewards</sub>
