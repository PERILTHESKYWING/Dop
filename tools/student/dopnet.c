/*
 * DopNet inference runtime: freestanding C for WebAssembly (SIMD128). Built by build.sh.
 * The network, the board bytes and the .dopnet format are in scripts/student/README.md;
 * scripts/student/model.py is the reference this must match.
 *
 * Layout and method
 *  - Stem (9x9 over 13 sparse binary planes): computed sparsely and incrementally. Two
 *    position-major accumulators [361][C] per board (black to move, white to move) start
 *    from a constant map (bias + the on-board plane) and get a flipped 9x9 kernel slice
 *    scattered in for every active (feature, point). A small LRU cache of recent boards
 *    lets a new board be derived from the nearest cached one by undoing/redoing only the
 *    points that differ (NNUE-style), with a from-scratch recompute every MAX_CHAIN steps.
 *  - Trunk: planar activations, one zero-bordered plane per channel (stride PS): rows of
 *    20 floats, column 0 zero, so a row's right neighbour column is the next row's zero.
 *  - Ternary 3x3 convolutions have no multiplications. Each kernel row (3 taps in
 *    {-1,0,1}) is, up to sign and a one-point shift, one of 9 "row patterns" of the
 *    input (m, m+r, m-r, l+r, l-r, l+m+r, l+m-r, l-m+r, l-m-r for left/middle/right
 *    neighbours), computed once per layer. An output channel is then a list of pattern
 *    offsets to add and a list to subtract, about one entry per non-zero kernel row
 *    (instead of one per non-zero weight). A block of positions stays in registers while
 *    the lists are walked; then scale, bias and the activation.
 *  - Heads: global pooling, 1x1 convolutions and small dense layers, all float32.
 *  - Outputs are raw logits; the caller (src/lib/student/runtime.ts) applies sigmoids.
 *
 * Calling sequence: dn_alloc (the .dopnet blob and a tensor table) -> dn_load; then per
 * position: write 361 bytes at dn_board(), dn_eval(toPlay, komi) (stem, blocks 1..E,
 * exit heads at dn_out_exit()), and if the exit is not taken dn_finish(ownership)
 * (blocks E+1..N, final heads at dn_out_final()).
 */

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

typedef unsigned char u8;
typedef unsigned int u32;
typedef int i32;

typedef float f4 __attribute__((vector_size(16)));
typedef float f4u __attribute__((vector_size(16), aligned(4)));
typedef i32 i4 __attribute__((vector_size(16)));

#define EXPORT(n) __attribute__((export_name(#n)))
#define INLINE static inline __attribute__((always_inline))
#define NOINLINE static __attribute__((noinline))
#define COLD static __attribute__((noinline, minsize)) /* load-time code: small over fast */

#define SZ 19
#define NPTS 361
#define PW 20        /* padded row: column 0 is zero (it is also the previous row's right border) */
#define PS 448       /* padded plane stride: OFS + rows 0..20 (420) plus zero slack */
#define OFS 3        /* plane offset so that point (0,0), and most pattern reads, are 16-byte aligned */
#define P0 (OFS + PW + 1) /* padded index of point (0,0) */
#define PIX(y, x) (OFS + ((y) + 1) * PW + (x) + 1)
#ifndef VB
#define VB 6         /* vectors per register block (V8 keeps 6 accumulators + 6 loads in xmm registers) */
#endif
#define CHUNK (4 * VB)
#define SPAN 384     /* padded positions P0..P0+383 cover every point (a multiple of CHUNK) */
#if SPAN % CHUNK
#error SPAN must be a multiple of CHUNK
#endif
#define NPAT 9       /* row patterns per input channel */
#ifndef GCI
#define GCI 16       /* input channels per group: a group's pattern window (~38 KB) stays in L1 */
#endif
#define PPS 432      /* pattern plane stride: positions 0..431 (reads reach 3..428) */
#define GUARD 4      /* zero floats before each activation buffer (pattern of position 0 reads x[-1]) */
#define SLACK 64
#define BOARD_PAD 368
#define NKERN 12     /* stem kernels: own stone l=0..3, opp stone l=0..3, ko, recency 1..3 */
#define CACHE_N 8
#define MAX_DIFF 48
#define MAX_CHAIN 32
#define MAX_BLOCKS 64

/* ------------------------------------------------------------------ small helpers */

INLINE f4 ld(const float *p) { return *(const f4u *)p; }
INLINE void st(float *p, f4 v) { *(f4u *)p = v; }
INLINE f4 splat(float x) { return (f4){x, x, x, x}; }
INLINE f4 relu4(f4 v) {
#ifdef __wasm_simd128__
  return (f4)wasm_f32x4_pmax((v128_t)v, wasm_f32x4_splat(0.0f));
#else
  i4 m = v > (f4){0, 0, 0, 0};
  return (f4)((i4)v & m);
#endif
}
INLINE f4 max4(f4 a, f4 b) {
#ifdef __wasm_simd128__
  return (f4)wasm_f32x4_pmax((v128_t)a, (v128_t)b);
#else
  i4 m = b > a;
  return (f4)(((i4)b & m) | ((i4)a & ~m));
#endif
}
INLINE float hsum(f4 v) { return (v[0] + v[1]) + (v[2] + v[3]); }
INLINE float hmax(f4 v) {
  float a = v[0] > v[1] ? v[0] : v[1], b = v[2] > v[3] ? v[2] : v[3];
  return a > b ? a : b;
}

/* ------------------------------------------------------------------ bump allocator */

extern u8 __heap_base;
static u32 heap_top;

static void *alloc(u32 n) {
  if (!heap_top) heap_top = (u32)(unsigned long)&__heap_base;
  u32 p = (heap_top + 15u) & ~15u;
  u32 end = p + n;
  if (end < p) return 0;
  u32 have = (u32)__builtin_wasm_memory_size(0) * 65536u;
  if (end > have) {
    u32 pages = (end - have + 65535u) / 65536u;
    if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return 0;
  }
  heap_top = end;
  __builtin_memset((void *)p, 0, n);
  return (void *)p;
}

EXPORT(dn_alloc) u32 dn_alloc(u32 n) { return (u32)(unsigned long)alloc(n); }

/* ------------------------------------------------------------------ the network */

typedef struct {
  const i32 *idx;   /* per (output channel, input group): npos pattern offsets to add, then nneg to subtract */
  const i32 *start; /* [C][ngroups]: first entry */
  const i32 *npos;
  const i32 *nneg;
  const float *s, *b;
} TConv;

typedef struct {
  TConv c1, c2;
  const float *gw, *gb; /* global pooling (null when the block has none) */
} Block;

static i32 C, NB, PC, VC, EVC;
static i32 EXB; /* blocks run before the exit heads (0: the net has no exit point) */
static Block blocks[MAX_BLOCKS];
static const float *stem_b, *stem_komi;
static const float *xp_w, *xp_b, *xpass_w, *xpass_b, *xv1_w, *xv1_b, *xv2_w, *xv2_b;
static const float *p1_w, *p1_b, *pg_w, *p2_w, *p2_b, *pass_w, *pass_b, *v1_w, *v1_b, *v2_w, *v2_b, *own_w, *own_b;

static float *kern; /* [NKERN][81][C], each 9x9 kernel flipped so a scatter is a forward copy */
static float *cmap; /* [361][C]: stem bias + the on-board plane */
static float *X;    /* residual stream [C][PS] */
static float *A;    /* relu(X), zero border: conv1 input and head input */
static float *H;    /* conv1 output (activated), zero border: conv2 input */
static float *pat;  /* row patterns of a conv input [C][NPAT][PPS] */
static float *part; /* partial sums of a chunk [C][CHUNK] between input groups */
static i32 NG;      /* input channel groups */
static float *tmp;  /* one padded plane for the 1x1 heads */
static float *qv, *gv, *hid, *pbias, *kv;
static u8 *board_in;
static float *out_exit;  /* 362 policy, win, lead/20, error */
static float *out_final; /* 362 policy, win, lead/20, 361 ownership */

typedef struct {
  u8 *board;     /* BOARD_PAD bytes, tail zero */
  float *acc[2]; /* [361][C]: 0 = black to move, 1 = white to move (komi not included) */
  i32 chain;     /* incremental steps since the last from-scratch stem */
  u32 used;
  i32 valid;
} Entry;

static Entry cache[CACHE_N];
static u32 clock_;
static i32 use_cache = 1;
static u32 n_incremental, n_full;

/* Tensor table order (matches TENSORS in runtime.ts). */
enum {
  T_STEM_W, T_STEM_B, T_STEM_KOMI,
  T_XP_W, T_XP_B, T_XPASS_W, T_XPASS_B, T_XV1_W, T_XV1_B, T_XV2_W, T_XV2_B,
  T_P1_W, T_P1_B, T_PG_W, T_P2_W, T_P2_B, T_PASS_W, T_PASS_B, T_V1_W, T_V1_B, T_V2_W, T_V2_B, T_OWN_W, T_OWN_B,
  T_BLOCKS /* + 8*i: conv1, s1, b1, conv2, s2, b2, gpool.w, gpool.b */
};

/* ------------------------------------------------------------------ stem */

/* acc += ka - ks around point p (either kernel may be null). Kernels are [9][9][C] flipped:
 * entry (dy+4, dx+4) is the weight from an input at p to the output at p + (dy, dx). */
NOINLINE void scatter(float *acc, i32 p, const float *ka, const float *ks) {
  i32 py = p / SZ, px = p % SZ;
  i32 x0 = px < 4 ? 0 : px - 4, x1 = px > SZ - 5 ? SZ - 1 : px + 4;
  i32 y0 = py < 4 ? 0 : py - 4, y1 = py > SZ - 5 ? SZ - 1 : py + 4;
  i32 n = (x1 - x0 + 1) * C;
  for (i32 y = y0; y <= y1; y++) {
    float *a = acc + (y * SZ + x0) * C;
    i32 ko = ((y - py + 4) * 9 + (x0 - px + 4)) * C;
    if (ka && ks) {
      const float *pa = ka + ko, *ps = ks + ko;
      for (i32 i = 0; i < n; i += 4) st(a + i, ld(a + i) + (ld(pa + i) - ld(ps + i)));
    } else if (ka) {
      const float *pa = ka + ko;
      for (i32 i = 0; i < n; i += 4) st(a + i, ld(a + i) + ld(pa + i));
    } else {
      const float *ps = ks + ko;
      for (i32 i = 0; i < n; i += 4) st(a + i, ld(a + i) - ld(ps + i));
    }
  }
}

INLINE const float *K(i32 slot) { return slot < 0 ? 0 : kern + slot * 81 * C; }

/* Stem kernel of a board byte's stone part for orientation o (0: black is "own"). */
INLINE i32 stone_slot(u32 b, i32 o) {
  u32 s = b & 3;
  if (s == 0 || s == 3) return -1;
  i32 l = (b >> 2) & 3;
  return (i32)s == 1 + o ? l : 4 + l;
}
INLINE i32 ko_slot(u32 b) { return (b & 16) ? 8 : -1; }
INLINE i32 rec_slot(u32 b) {
  i32 r = (b >> 5) & 3;
  return r ? 8 + r : -1;
}

NOINLINE void stem_scratch(const u8 *bd, float *a0, float *a1) {
  __builtin_memcpy(a0, cmap, NPTS * C * 4);
  __builtin_memcpy(a1, cmap, NPTS * C * 4);
  for (i32 p = 0; p < NPTS; p++) {
    u32 b = bd[p];
    i32 s0 = stone_slot(b, 0);
    if (s0 >= 0) {
      scatter(a0, p, K(s0), 0);
      scatter(a1, p, K(stone_slot(b, 1)), 0);
    }
    if (b & 16) {
      scatter(a0, p, K(8), 0);
      scatter(a1, p, K(8), 0);
    }
    i32 r = rec_slot(b);
    if (r >= 0) {
      scatter(a0, p, K(r), 0);
      scatter(a1, p, K(r), 0);
    }
  }
}

/* Point p changes from byte o to byte n: undo o's features and add n's. */
static void stem_update(i32 p, u32 o, u32 n, float *a0, float *a1) {
  i32 so = stone_slot(o, 0), sn = stone_slot(n, 0);
  if (so != sn) {
    scatter(a0, p, K(sn), K(so));
    scatter(a1, p, K(stone_slot(n, 1)), K(stone_slot(o, 1)));
  }
  i32 ko = ko_slot(o), kn = ko_slot(n);
  if (ko != kn) {
    scatter(a0, p, K(kn), K(ko));
    scatter(a1, p, K(kn), K(ko));
  }
  i32 ro = rec_slot(o), rn = rec_slot(n);
  if (ro != rn) {
    scatter(a0, p, K(rn), K(ro));
    scatter(a1, p, K(rn), K(ro));
  }
}

INLINE u32 diff_mask16(const u8 *a, const u8 *b) {
#ifdef __wasm_simd128__
  return wasm_i8x16_bitmask(wasm_i8x16_ne(wasm_v128_load(a), wasm_v128_load(b)));
#else
  u32 m = 0;
  for (i32 j = 0; j < 16; j++) m |= (u32)(a[j] != b[j]) << j;
  return m;
#endif
}

static i32 count_diff(const u8 *a, const u8 *b) {
  i32 n = 0;
  for (i32 i = 0; i < BOARD_PAD; i += 16) n += __builtin_popcount(diff_mask16(a + i, b + i));
  return n;
}

/* Kernel scatters to build a board from scratch / from another board (both orientations). */
NOINLINE i32 scratch_cost(const u8 *bd) {
  i32 n = 0;
  for (i32 p = 0; p < NPTS; p++) {
    u32 b = bd[p];
    n += (stone_slot(b, 0) >= 0) + ((b & 16) != 0) + (rec_slot(b) >= 0);
  }
  return 2 * n;
}

NOINLINE i32 update_cost(const u8 *nb, const u8 *ob) {
  i32 n = 0;
  for (i32 i = 0; i < BOARD_PAD; i += 16) {
    u32 m = diff_mask16(nb + i, ob + i);
    while (m) {
      i32 p = i + __builtin_ctz(m);
      m &= m - 1;
      u32 o = ob[p], b = nb[p];
      /* a two-kernel delta costs about 1.5 single scatters */
      i32 so = stone_slot(o, 0), sn = stone_slot(b, 0);
      if (so != sn) n += (so >= 0 && sn >= 0) ? 3 : 2;
      i32 ko = ko_slot(o), kn = ko_slot(b);
      if (ko != kn) n += 2;
      i32 ro = rec_slot(o), rn = rec_slot(b);
      if (ro != rn) n += (ro >= 0 && rn >= 0) ? 3 : 2;
    }
  }
  return n;
}

NOINLINE void apply_diffs(const u8 *nb, const u8 *ob, float *a0, float *a1) {
  for (i32 i = 0; i < BOARD_PAD; i += 16) {
    u32 m = diff_mask16(nb + i, ob + i);
    while (m) {
      i32 p = i + __builtin_ctz(m);
      m &= m - 1;
      stem_update(p, ob[p], nb[p], a0, a1);
    }
  }
}

/* The stem accumulator of board_in for orientation o, from the cache when possible. */
NOINLINE const float *stem_acc(i32 o) {
  const u8 *bd = board_in;
  clock_++;
  if (!use_cache) {
    Entry *e = &cache[0];
    stem_scratch(bd, e->acc[0], e->acc[1]);
    e->valid = 0;
    n_full++;
    return e->acc[o];
  }
  i32 best = -1, bestd = 1 << 30;
  for (i32 i = 0; i < CACHE_N; i++) {
    if (!cache[i].valid) continue;
    i32 d = count_diff(bd, cache[i].board);
    if (d < bestd) bestd = d, best = i;
  }
  if (best >= 0 && bestd == 0) {
    cache[best].used = clock_;
    n_incremental++;
    return cache[best].acc[o];
  }
  i32 v = -1;
  for (i32 i = 0; i < CACHE_N; i++) {
    if (i == best) continue;
    if (!cache[i].valid) { v = i; break; }
    if (v < 0 || cache[i].used < cache[v].used) v = i;
  }
  Entry *e = &cache[v];
  i32 inc = best >= 0 && bestd <= MAX_DIFF && cache[best].chain < MAX_CHAIN &&
            update_cost(bd, cache[best].board) <= scratch_cost(bd);
  if (inc) {
    Entry *s = &cache[best];
    __builtin_memcpy(e->acc[0], s->acc[0], NPTS * C * 4);
    __builtin_memcpy(e->acc[1], s->acc[1], NPTS * C * 4);
    apply_diffs(bd, s->board, e->acc[0], e->acc[1]);
    e->chain = s->chain + 1;
    n_incremental++;
  } else {
    stem_scratch(bd, e->acc[0], e->acc[1]);
    e->chain = 0;
    n_full++;
  }
  __builtin_memcpy(e->board, bd, BOARD_PAD);
  e->valid = 1;
  e->used = clock_;
  return e->acc[o];
}

/* X = acc + selfKomi * stem.komi (to planar), A = relu(X). Borders stay zero. Four points
 * of a row by four channels at a time (4x4 transposes); the last group of a row overlaps. */
NOINLINE void stem_to_trunk(const float *acc, float sk) {
  for (i32 c = 0; c < C; c++) kv[c] = sk * stem_komi[c];
  for (i32 y = 0; y < SZ; y++) {
    for (i32 x0 = 0; x0 < SZ; x0 += 4) {
      i32 x = x0 + 4 <= SZ ? x0 : SZ - 4;
      const float *ap = acc + (y * SZ + x) * C;
      i32 d = PIX(y, x);
      for (i32 c = 0; c < C; c += 4) {
        f4 k = ld(kv + c);
        f4 r0 = ld(ap + c) + k, r1 = ld(ap + C + c) + k, r2 = ld(ap + 2 * C + c) + k, r3 = ld(ap + 3 * C + c) + k;
        f4 lo01 = __builtin_shufflevector(r0, r1, 0, 4, 1, 5), lo23 = __builtin_shufflevector(r2, r3, 0, 4, 1, 5);
        f4 hi01 = __builtin_shufflevector(r0, r1, 2, 6, 3, 7), hi23 = __builtin_shufflevector(r2, r3, 2, 6, 3, 7);
        f4 t[4] = {__builtin_shufflevector(lo01, lo23, 0, 1, 4, 5), __builtin_shufflevector(lo01, lo23, 2, 3, 6, 7),
                   __builtin_shufflevector(hi01, hi23, 0, 1, 4, 5), __builtin_shufflevector(hi01, hi23, 2, 3, 6, 7)};
        for (i32 j = 0; j < 4; j++) {
          st(X + (c + j) * PS + d, t[j]);
          st(A + (c + j) * PS + d, relu4(t[j]));
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ trunk */

/* Zero every padded position that is not a point (convolutions write garbage there). */
NOINLINE void zero_border(float *buf) {
  for (i32 c = 0; c < C; c++) {
    float *pl = buf + c * PS;
    for (i32 i = 0; i < P0; i++) pl[i] = 0;
    for (i32 r = 2; r <= SZ; r++) pl[OFS + r * PW] = 0;
    for (i32 i = OFS + (SZ + 1) * PW; i < PS; i++) pl[i] = 0;
  }
}

/* Row patterns of every input channel at padded positions 0..PPS-1 (l, m, r = x[p-1], x[p], x[p+1]). */
NOINLINE void patterns(const float *in) {
  for (i32 ci = 0; ci < C; ci++) {
    const float *x = in + ci * PS;
    float *o = pat + ci * NPAT * PPS;
    for (i32 i = 0; i < PPS; i += 4) {
      f4 l = ld(x + i - 1), m = ld(x + i), r = ld(x + i + 1);
      f4 gp = l + r, gm = l - r;
      st(o + i, m);
      st(o + PPS + i, m + r);
      st(o + 2 * PPS + i, m - r);
      st(o + 3 * PPS + i, gp);
      st(o + 4 * PPS + i, gm);
      st(o + 5 * PPS + i, gp + m);
      st(o + 6 * PPS + i, gm + m);
      st(o + 7 * PPS + i, gp - m);
      st(o + 8 * PPS + i, gm - m);
    }
  }
}

enum { M_RELU, M_LIN, M_RES };

/* Entries hold byte offsets (no scaling in the inner loop). */
#define AT(base, off) ((const float *)((const char *)(base) + (off)))

/* out = epilogue(sum of + entries - sum of - entries) over padded positions P0..P0+SPAN-1, from
 * the row patterns in pat. Input channels go in groups (partial sums kept in part) so the
 * pattern window of one chunk of positions stays in the L1 cache. */
INLINE void tconv(const TConv *tc, float *out, float *out2, const i32 mode) {
  for (i32 p0 = P0; p0 < P0 + SPAN; p0 += CHUNK) {
    const float *base = pat + p0;
    for (i32 g = 0; g < NG; g++) {
      for (i32 co = 0; co < C; co++) {
        const i32 cg = co * NG + g;
        const i32 *e = tc->idx + tc->start[cg];
        const i32 np = tc->npos[cg], nn = tc->nneg[cg];
        float *pp = part + co * CHUNK;
        f4 a[VB];
        for (i32 j = 0; j < VB; j++) a[j] = g ? ld(pp + 4 * j) : splat(0);
        for (i32 k = 0; k < np; k++) {
          const float *s = AT(base, e[k]);
          for (i32 j = 0; j < VB; j++) a[j] += ld(s + 4 * j);
        }
        e += np;
        for (i32 k = 0; k < nn; k++) {
          const float *s = AT(base, e[k]);
          for (i32 j = 0; j < VB; j++) a[j] -= ld(s + 4 * j);
        }
        if (g < NG - 1) {
          for (i32 j = 0; j < VB; j++) st(pp + 4 * j, a[j]);
          continue;
        }
        const f4 sc = splat(tc->s[co]), bi = splat(tc->b[co]);
        float *o = out + co * PS + p0;
        float *r = mode == M_RES ? out2 + co * PS + p0 : o;
        for (i32 j = 0; j < VB; j++) {
          f4 v = a[j] * sc + bi;
          if (mode == M_RES) v += ld(o + 4 * j);
          if (mode != M_RELU) st(o + 4 * j, v);
          if (mode != M_LIN) st(r + 4 * j, relu4(v));
        }
      }
    }
  }
}

NOINLINE void conv_relu(const TConv *tc, const float *in, float *out) {
  patterns(in);
  tconv(tc, out, 0, M_RELU);
}
NOINLINE void conv_lin(const TConv *tc, const float *in, float *out) {
  patterns(in);
  tconv(tc, out, 0, M_LIN);
}
NOINLINE void conv_res(const TConv *tc, const float *in, float *x, float *a) {
  patterns(in);
  tconv(tc, x, a, M_RES);
}

/* q = [mean, max] over the board of relu(buf) (borders zero). */
NOINLINE void pool(const float *buf, float *q) {
  for (i32 c = 0; c < C; c++) {
    const float *pl = buf + c * PS;
    f4 s0 = splat(0), s1 = s0, m0 = s0, m1 = s0;
    for (i32 i = 0; i < PS; i += 8) {
      f4 u = relu4(ld(pl + i)), w = relu4(ld(pl + i + 4));
      s0 += u, s1 += w;
      m0 = max4(m0, u), m1 = max4(m1, w);
    }
    q[c] = hsum(s0 + s1) / 361.0f;
    q[C + c] = hmax(max4(m0, m1));
  }
}

static float dot(const float *a, const float *b, i32 n) {
  f4 s = splat(0);
  i32 i = 0;
  for (; i + 4 <= n; i += 4) s += ld(a + i) * ld(b + i);
  float r = hsum(s);
  for (; i < n; i++) r += a[i] * b[i];
  return r;
}

/* out[o] = W[o] . x + b[o] (optionally relu); W is [nout][nin]. */
NOINLINE void dense(float *out, const float *W, const float *x, const float *b, i32 nout, i32 nin, i32 relu) {
  for (i32 o = 0; o < nout; o++) {
    float v = dot(W + o * nin, x, nin) + b[o];
    out[o] = relu && v < 0 ? 0 : v;
  }
}

NOINLINE void run_block(const Block *bk) {
  if (bk->gw) {
    conv_lin(&bk->c1, A, H);
    zero_border(H);
    pool(H, qv);
    dense(gv, bk->gw, qv, bk->gb, C, 2 * C, 0);
    for (i32 c = 0; c < C; c++) {
      float *pl = H + c * PS;
      f4 g = splat(gv[c]);
      for (i32 i = P0; i < P0 + SPAN; i += 4) st(pl + i, relu4(ld(pl + i) + g));
    }
  } else {
    conv_relu(&bk->c1, A, H);
  }
  zero_border(H);
  conv_res(&bk->c2, H, X, A);
  zero_border(A);
}

/* dst[point] = w . A[:, point] + b */
NOINLINE void head_1x1(const float *w, float b, float *dst) {
  for (i32 p0 = P0; p0 < P0 + SPAN; p0 += CHUNK) {
    f4 a[VB];
    for (i32 j = 0; j < VB; j++) a[j] = splat(b);
    for (i32 c = 0; c < C; c++) {
      const f4 wv = splat(w[c]);
      const float *s = A + c * PS + p0;
      for (i32 j = 0; j < VB; j++) a[j] += wv * ld(s + 4 * j);
    }
    for (i32 j = 0; j < VB; j++) st(tmp + p0 + 4 * j, a[j]);
  }
  for (i32 y = 0; y < SZ; y++)
    for (i32 x = 0; x < SZ; x++) dst[y * SZ + x] = tmp[PIX(y, x)];
}

NOINLINE void exit_heads(void) {
  pool(A, qv);
  head_1x1(xp_w, xp_b[0], out_exit);
  out_exit[NPTS] = dot(xpass_w, qv, 2 * C) + xpass_b[0];
  dense(hid, xv1_w, qv, xv1_b, EVC, 2 * C, 1);
  dense(out_exit + NPTS + 1, xv2_w, hid, xv2_b, 3, EVC, 0);
}

NOINLINE void final_heads(i32 own) {
  pool(A, qv);
  for (i32 k = 0; k < PC; k++) pbias[k] = p1_b[k] + dot(pg_w + k * 2 * C, qv, 2 * C);
  const f4 pb2 = splat(p2_b[0]);
  for (i32 p0 = P0; p0 < P0 + SPAN; p0 += CHUNK) {
    float *t = tmp + p0;
    for (i32 j = 0; j < VB; j++) st(t + 4 * j, pb2);
    for (i32 k = 0; k < PC; k++) {
      const float *w = p1_w + k * C;
      f4 a[VB];
      for (i32 j = 0; j < VB; j++) a[j] = splat(pbias[k]);
      for (i32 c = 0; c < C; c++) {
        const f4 wv = splat(w[c]);
        const float *s = A + c * PS + p0;
        for (i32 j = 0; j < VB; j++) a[j] += wv * ld(s + 4 * j);
      }
      const f4 w2 = splat(p2_w[k]);
      for (i32 j = 0; j < VB; j++) st(t + 4 * j, ld(t + 4 * j) + w2 * relu4(a[j]));
    }
  }
  for (i32 y = 0; y < SZ; y++)
    for (i32 x = 0; x < SZ; x++) out_final[y * SZ + x] = tmp[PIX(y, x)];
  out_final[NPTS] = dot(pass_w, qv, 2 * C) + pass_b[0];
  dense(hid, v1_w, qv, v1_b, VC, 2 * C, 1);
  dense(out_final + NPTS + 1, v2_w, hid, v2_b, 2, VC, 0);
  if (own) head_1x1(own_w, own_b[0], out_final + NPTS + 3);
}

/* ------------------------------------------------------------------ loading */

/* Row (a,b,c) of a ternary kernel -> pattern plane, shift and sign (0 for an all-zero row).
 * Patterns: 0 m, 1 m+r, 2 m-r, 3 l+r, 4 l-r, 5 l+m+r, 6 l+m-r, 7 l-m+r, 8 l-m-r. */
COLD i32 row_entry(i32 a, i32 b, i32 c, i32 *k, i32 *shift) {
  i32 n = (a != 0) + (b != 0) + (c != 0);
  if (n == 0) return 0;
  if (n == 1) {
    *k = 0, *shift = a ? -1 : c ? 1 : 0;
    return a + b + c;
  }
  if (!c) { /* (a,b,0) = a * (l + (b/a) m): pattern m+r or m-r one point left */
    *k = b == a ? 1 : 2, *shift = -1;
    return a;
  }
  if (!a) { /* (0,b,c) */
    *k = c == b ? 1 : 2, *shift = 0;
    return b;
  }
  *shift = 0;
  if (!b) { /* (a,0,c) */
    *k = c == a ? 3 : 4;
    return a;
  }
  *k = 5 + (b == a ? 0 : 2) + (c == a ? 0 : 1); /* (a,b,c) = a * (l + (b/a) m + (c/a) r) */
  return a;
}

INLINE i32 t2_at(const u8 *packed, u32 i) {
  u32 code = (packed[i >> 2] >> ((i & 3) * 2)) & 3;
  return code == 1 ? 1 : code == 3 ? -1 : code == 0 ? 0 : 9;
}

COLD i32 prep_tconv(TConv *tc, const u8 *packed, const float *s, const float *b) {
  i32 *start = alloc(C * NG * 4), *npos = alloc(C * NG * 4), *nneg = alloc(C * NG * 4);
  i32 *idx = alloc((u32)C * C * 3 * 4 + 4);
  if (!start || !npos || !nneg || !idx) return -2;
  i32 total = 0;
  for (i32 co = 0; co < C; co++)
    for (i32 g = 0; g < NG; g++) {
      i32 cg = co * NG + g, c0 = g * GCI, c1 = c0 + GCI < C ? c0 + GCI : C;
      start[cg] = total;
      for (i32 pass = 0; pass < 2; pass++) { /* + entries first, then - entries */
        i32 count = 0;
        for (i32 ci = c0; ci < c1; ci++)
          for (i32 ky = 0; ky < 3; ky++) {
            u32 i = (u32)(((co * C + ci) * 3 + ky) * 3);
            i32 a = t2_at(packed, i), bb = t2_at(packed, i + 1), c = t2_at(packed, i + 2);
            if (a == 9 || bb == 9 || c == 9) return -4;
            i32 k = 0, sh = 0, sign = row_entry(a, bb, c, &k, &sh);
            if (sign == (pass ? -1 : 1)) idx[total + count++] = ((ci * NPAT + k) * PPS + (ky - 1) * PW + sh) * 4;
          }
        if (pass == 0) npos[cg] = count;
        else nneg[cg] = count;
        total += count;
      }
    }
  tc->idx = idx, tc->start = start, tc->npos = npos, tc->nneg = nneg, tc->s = s, tc->b = b;
  return 0;
}

COLD void fill_kernel(float *dst, const float *w, i32 pa, i32 pb) {
  for (i32 dy = 0; dy < 9; dy++)
    for (i32 dx = 0; dx < 9; dx++)
      for (i32 c = 0; c < C; c++) {
        i32 tap = (8 - dy) * 9 + (8 - dx);
        float v = w[(c * 13 + pa) * 81 + tap];
        if (pb >= 0) v += w[(c * 13 + pb) * 81 + tap];
        dst[(dy * 9 + dx) * C + c] = v;
      }
}

COLD i32 prep_stem(const float *w) {
  kern = alloc(NKERN * 81 * C * 4);
  cmap = alloc(NPTS * C * 4);
  float *k12 = alloc(81 * C * 4);
  if (!kern || !cmap || !k12) return -2;
  for (i32 l = 0; l < 4; l++) {
    fill_kernel(kern + l * 81 * C, w, 0, l ? 1 + l : -1);       /* own stone, liberties l */
    fill_kernel(kern + (4 + l) * 81 * C, w, 1, l ? 4 + l : -1); /* opponent stone */
  }
  for (i32 k = 8; k < 12; k++) fill_kernel(kern + k * 81 * C, w, k, -1); /* ko, recency 1..3 */
  fill_kernel(k12, w, 12, -1);
  for (i32 p = 0; p < NPTS; p++)
    for (i32 c = 0; c < C; c++) cmap[p * C + c] = stem_b[c];
  for (i32 p = 0; p < NPTS; p++) scatter(cmap, p, k12, 0);
  return 0;
}

/* Returns 0, or -1 bad config, -2 out of memory, -3 missing tensor, -4 bad ternary code. */
EXPORT(dn_load) __attribute__((minsize)) i32 dn_load(i32 c, i32 n, i32 e, i32 pc, i32 vc, i32 evc, const u32 *table) {
  if (C) return -1; /* one network per instance */
  if (c <= 0 || c % 4 || c > 1024 || n <= 0 || n > MAX_BLOCKS || pc <= 0 || vc <= 0 || evc <= 0) return -1;
  C = c, NB = n, PC = pc, VC = vc, EVC = evc;
  NG = (C + GCI - 1) / GCI;
  EXB = e >= 1 && e <= n ? e : 0;
#define F(i) ((const float *)(unsigned long)table[i])
  for (i32 i = 0; i < T_BLOCKS; i++)
    if (!table[i]) return -3;
  stem_b = F(T_STEM_B), stem_komi = F(T_STEM_KOMI);
  xp_w = F(T_XP_W), xp_b = F(T_XP_B), xpass_w = F(T_XPASS_W), xpass_b = F(T_XPASS_B);
  xv1_w = F(T_XV1_W), xv1_b = F(T_XV1_B), xv2_w = F(T_XV2_W), xv2_b = F(T_XV2_B);
  p1_w = F(T_P1_W), p1_b = F(T_P1_B), pg_w = F(T_PG_W), p2_w = F(T_P2_W), p2_b = F(T_P2_B);
  pass_w = F(T_PASS_W), pass_b = F(T_PASS_B), v1_w = F(T_V1_W), v1_b = F(T_V1_B), v2_w = F(T_V2_W), v2_b = F(T_V2_B);
  own_w = F(T_OWN_W), own_b = F(T_OWN_B);
  i32 rc = prep_stem(F(T_STEM_W));
  if (rc) return rc;
  for (i32 i = 0; i < n; i++) {
    const u32 *t = table + T_BLOCKS + 8 * i;
    for (i32 j = 0; j < 6; j++)
      if (!t[j]) return -3;
    Block *bk = &blocks[i];
    if ((rc = prep_tconv(&bk->c1, (const u8 *)(unsigned long)t[0], F(T_BLOCKS + 8 * i + 1), F(T_BLOCKS + 8 * i + 2)))) return rc;
    if ((rc = prep_tconv(&bk->c2, (const u8 *)(unsigned long)t[3], F(T_BLOCKS + 8 * i + 4), F(T_BLOCKS + 8 * i + 5)))) return rc;
    bk->gw = t[6] ? F(T_BLOCKS + 8 * i + 6) : 0;
    bk->gb = t[6] ? F(T_BLOCKS + 8 * i + 7) : 0;
    if (bk->gw && !bk->gb) return -3;
  }
#undef F
  u32 plane = ((u32)C * PS + GUARD + SLACK) * 4;
  X = alloc(plane), A = alloc(plane), H = alloc(plane);
  pat = alloc(((u32)C * NPAT * PPS + SLACK) * 4);
  part = alloc((u32)C * CHUNK * 4);
  if (!X || !A || !H || !pat || !part) return -2;
  X += GUARD, A += GUARD, H += GUARD;
  tmp = alloc((PS + SLACK) * 4);
  i32 hn = pc > vc ? pc : vc;
  hn = hn > evc ? hn : evc;
  qv = alloc(2 * C * 4), gv = alloc(C * 4), kv = alloc(C * 4), hid = alloc(hn * 4), pbias = alloc(pc * 4);
  board_in = alloc(BOARD_PAD);
  out_exit = alloc(368 * 4);
  out_final = alloc(728 * 4);
  if (!X || !A || !H || !tmp || !qv || !gv || !kv || !hid || !pbias || !board_in || !out_exit || !out_final) return -2;
  for (i32 i = 0; i < CACHE_N; i++) {
    cache[i].board = alloc(BOARD_PAD);
    cache[i].acc[0] = alloc(NPTS * C * 4);
    cache[i].acc[1] = alloc(NPTS * C * 4);
    if (!cache[i].board || !cache[i].acc[0] || !cache[i].acc[1]) return -2;
  }
  return 0;
}

/* ------------------------------------------------------------------ evaluation */

EXPORT(dn_board) u32 dn_board(void) { return (u32)(unsigned long)board_in; }
EXPORT(dn_out_exit) u32 dn_out_exit(void) { return (u32)(unsigned long)out_exit; }
EXPORT(dn_out_final) u32 dn_out_final(void) { return (u32)(unsigned long)out_final; }

static i32 board_o; /* orientation of the position being evaluated */

/* Stem from the cache (or from scratch) for board_in, then blocks 1..E and the exit heads.
 * Returns 1 when the exit heads were computed (out_exit), 0 when the net has none. */
EXPORT(dn_eval) i32 dn_eval(i32 to_play, float komi) {
  board_o = to_play == 2;
  const float *acc = stem_acc(board_o);
  float sk = (to_play == 2 ? komi : -komi) / 10.0f;
  stem_to_trunk(acc, sk);
  for (i32 i = 0; i < EXB; i++) run_block(&blocks[i]);
  if (!EXB) return 0;
  exit_heads();
  return 1;
}

/* Blocks E+1..N and the final heads (ownership when own != 0) into out_final. */
EXPORT(dn_finish) void dn_finish(i32 own) {
  for (i32 i = EXB; i < NB; i++) run_block(&blocks[i]);
  final_heads(own);
}

/* Benchmark aid: only the stem (cache rules apply) for board_in. */
EXPORT(dn_stem) void dn_stem(i32 to_play) { stem_to_trunk(stem_acc(to_play == 2), 0); }

EXPORT(dn_set_cache) void dn_set_cache(i32 on) {
  use_cache = on != 0;
  for (i32 i = 0; i < CACHE_N; i++) cache[i].valid = 0;
}

/* 0: stems taken from the cache (updated or reused), 1: stems computed from scratch. */
EXPORT(dn_stats) u32 dn_stats(i32 which) { return which == 0 ? n_incremental : which == 1 ? n_full : 0; }
