# DopNet: the student network

A small network made for this site: taught by KataGo's big networks on the positions
people actually play, small enough to search fast on a phone. Four ideas are built in:

1. **Distilled** from a strong teacher (kata1 b18/b28) on amateur and professional
   positions, not trained from zero by self-play.
2. **Search inside the network**: part of the targets are the teacher's *search* results
   (hundreds of visits), so one look of the student aims at what a search would say.
3. **Incremental first layer** (NNUE-style): a wide 9x9 pattern layer over the stones. A
   move changes a handful of inputs, so the runtime updates this layer from the last
   position it saw instead of recomputing it.
4. **Ternary weights** (-1, 0, +1 with one scale per channel) in every 3x3 layer: no
   multiplications, zeros skipped, 2 bits per weight.
5. **Early exit**: a second set of heads halfway up the trunk with a confidence output.
   When it is confident, the rest of the trunk is skipped.

The student is only used where it measures better than the network it would replace
(scripts/student/gate.ts); until then the site keeps using KataGo's b10.

Files:

| file | what |
| --- | --- |
| `src/lib/student/encode.ts` | position → 361 board bytes (the input contract below) |
| `scripts/student/label.ts` | teacher labels: native KataGo on sampled game positions → `.dpd` records |
| `scripts/student/model.py` | the network in PyTorch, with ternary training |
| `scripts/student/train.py` | training (distillation, early-exit heads) |
| `scripts/student/export.py` | checkpoint → `.dopnet` file + reference outputs |
| `tools/student/dopnet.c` | the runtime (WebAssembly SIMD), built by `tools/student/build.sh` |
| `src/lib/student/` | loading the runtime, the engine backend, the worker |
| `scripts/student/gate.ts` | student vs b10 on reference positions; decides `enabled` |

## Input contract: board bytes

19x19 only. Points are `y * 19 + x` (row-major, like the rest of the site). Each point is
one byte, **colour-absolute**:

| bits | meaning |
| --- | --- |
| 0-1 | stone: 0 empty, 1 black, 2 white |
| 2-3 | liberties of the chain on this point: 0 = empty or 4+, 1, 2, 3 |
| 4 | ko: an empty point the side to move may not play now (simple ko) |
| 5-6 | recency: 0 none, 1 = point of the last move, 2 = the move before, 3 = the one before that (passes mark nothing) |

Plus `toPlay` (1 black, 2 white) and `komi` (points for White).

## Network (format 1)

From the board bytes and the side to move (own = the side to move):

| plane | 1 where |
| --- | --- |
| 0 | own stone |
| 1 | opponent stone |
| 2, 3, 4 | own stone in a chain with 1, 2, 3 liberties |
| 5, 6, 7 | opponent stone in a chain with 1, 2, 3 liberties |
| 8 | ko bit |
| 9, 10, 11 | recency 1, 2, 3 |
| 12 | on the board (every point) |

`selfKomi = (toPlay == white ? komi : -komi) / 10`.

All convolutions are PyTorch `Conv2d` semantics (cross-correlation, zero padding,
"same" size). `C` channels, `N` blocks, exit after block `E`, global-pooling blocks `G`.
`pool(t)` = concat(mean over the 361 points of each channel, max over the 361 points of each
channel), a vector of `2C`. Linear weights are `[out, in]`.

```
x  = conv9x9(planes; stem.w [C,13,9,9]) + stem.b + selfKomi * stem.komi      (per channel)
for i in 1..N:
    h = conv3x3(relu(x); T(block<i>.conv1)) * block<i>.s1 + block<i>.b1
    if i in G:
        h += block<i>.gpool.w @ pool(relu(h)) + block<i>.gpool.b             (per channel)
    h = conv3x3(relu(h); T(block<i>.conv2)) * block<i>.s2 + block<i>.b2
    x = x + h
    if i == E: exit heads on x
final heads on x (after block N)
```

`T(w)` is a ternary tensor (-1, 0, +1); `s` holds each output channel's scale (batch norm
folded in).

Exit heads (on `t = relu(x)` after block E, `q = pool(t)`):

```
policy[p] = exit.policy.w · t[:, p] + exit.policy.b          (361 logits)
pass      = exit.pass.w · q + exit.pass.b
v         = exit.v2.w @ relu(exit.v1.w @ q + exit.v1.b) + exit.v2.b   (3: win logit, lead/20, error logit)
```

`sigmoid(error logit)` predicts how far the exit's win rate is from the teacher's (plus half
its policy disagreement). The runtime exits when it is below `exitThreshold`.

Final heads (on `t = relu(x)` after block N, `q = pool(t)`):

```
a[:, p]   = relu(head.p1.w @ t[:, p] + head.p1.b + head.pg.w @ q)    (policyC)
policy[p] = head.p2.w · a[:, p] + head.p2.b
pass      = head.pass.w · q + head.pass.b
v         = head.v2.w @ relu(head.v1.w @ q + head.v1.b) + head.v2.b  (2: win logit, lead/20)
own[p]    = head.own.w · t[:, p] + head.own.b                       (pre-tanh, side to move)
```

All outputs are for the side to move: `sigmoid(win logit)` is its win rate, `20 * lead` its
lead in points.

## `.dopnet` file

Little-endian.

```
"DOPN"            4 bytes
version           u32 = 1
headerBytes       u32
header            JSON, UTF-8, padded with spaces to a multiple of 4
blob              tensors; each tensor's offset is relative to the blob start, 4-byte aligned
```

Header: `{ format: 1, name, size: 19, C, N, E, G: [...], policyC, valueC, exitValueC,
exitThreshold, planes: 13, meta: {...}, tensors: { name: { shape, dtype, offset, bytes } } }`.

`dtype` is `f32` or `t2`. `t2` is ternary, flattened row-major, four weights per byte,
weight `i` in bits `2*(i%4)` and up: `0` = 0, `1` = +1, `3` = -1.

Tensors: `stem.w [C,13,9,9]`, `stem.b [C]`, `stem.komi [C]`; per block
`block<i>.conv1 [C,C,3,3] t2`, `block<i>.s1 [C]`, `block<i>.b1 [C]`, `block<i>.conv2`,
`block<i>.s2`, `block<i>.b2`, and for `i` in G `block<i>.gpool.w [C,2C]`,
`block<i>.gpool.b [C]`; `exit.policy.w [C]`, `exit.policy.b [1]`, `exit.pass.w [2C]`,
`exit.pass.b [1]`, `exit.v1.w [exitValueC,2C]`, `exit.v1.b`, `exit.v2.w [3,exitValueC]`,
`exit.v2.b [3]`; `head.p1.w [policyC,C]`, `head.p1.b`, `head.pg.w [policyC,2C]`,
`head.p2.w [policyC]`, `head.p2.b [1]`, `head.pass.w [2C]`, `head.pass.b [1]`,
`head.v1.w [valueC,2C]`, `head.v1.b`, `head.v2.w [2,valueC]`, `head.v2.b [2]`,
`head.own.w [C]`, `head.own.b [1]`.

## `.dpd` training records

Fixed 840-byte records, little-endian:

| offset | type | field |
| --- | --- | --- |
| 0 | u8[361] | board bytes |
| 361 | u8 | toPlay |
| 362 | u8 | source: 1 professional, 2 amateur, 3 AI |
| 363 | u8 | 0 |
| 364 | f32 | komi |
| 368 | f32 | teacher win rate, side to move |
| 372 | f32 | teacher lead, side to move |
| 376 | u32 | teacher visits (1 = the raw network) |
| 380 | 24 x (u16 point, u16 probability x 65535) | teacher policy (search: visit shares), 361 = pass, unused = 65535 |
| 476 | i8[361] | teacher ownership x 127, side to move |
| 837 | u8 | 1 if ownership is present |
| 838 | u8[2] | 0 |
