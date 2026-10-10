"""DopNet in PyTorch (see README.md for the exact network the runtime computes).

Training keeps float "shadow" weights for every 3x3 layer and uses their ternary version
(-1/0/+1 times a per-channel scale) in the forward pass, with the straight-through
estimator for gradients (Ternary Weight Networks, Li & Liu 2016). Batch norm follows each
3x3 convolution and the stem and is folded away at export.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SIZE = 19
POINTS = SIZE * SIZE
PLANES = 13


def ternarize(w: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Per output channel: T in {-1,0,1} and scale alpha (TWN: threshold 0.7 * mean |w|)."""
    flat = w.reshape(w.shape[0], -1)
    delta = 0.7 * flat.abs().mean(dim=1, keepdim=True)
    mask = (flat.abs() > delta).float()
    t = torch.sign(flat) * mask
    alpha = (flat.abs() * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
    return t.reshape(w.shape), alpha


class TernaryConv3x3(nn.Module):
    def __init__(self, c_in: int, c_out: int):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(c_out, c_in, 3, 3) * (2.0 / (c_in * 9)) ** 0.5)
        # A fresh network first learns with float weights (train.py), then ternary.
        self.quant = True

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if not self.quant:
            return F.conv2d(x, self.weight, padding=1)
        t, alpha = ternarize(self.weight)
        wq = t * alpha.view(-1, 1, 1, 1)
        # Straight-through: forward with the ternary weights, gradient as if float.
        w = self.weight + (wq - self.weight).detach()
        return F.conv2d(x, w, padding=1)


def pool(t: torch.Tensor) -> torch.Tensor:
    return torch.cat([t.mean(dim=(2, 3)), t.amax(dim=(2, 3))], dim=1)


class Block(nn.Module):
    def __init__(self, c: int, gpool: bool):
        super().__init__()
        self.conv1 = TernaryConv3x3(c, c)
        self.bn1 = nn.BatchNorm2d(c)
        self.gpool = nn.Linear(2 * c, c) if gpool else None
        self.conv2 = TernaryConv3x3(c, c)
        self.bn2 = nn.BatchNorm2d(c)
        nn.init.zeros_(self.bn2.weight)  # each block starts as the identity

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.bn1(self.conv1(F.relu(x)))
        if self.gpool is not None:
            h = h + self.gpool(pool(F.relu(h)))[:, :, None, None]
        h = self.bn2(self.conv2(F.relu(h)))
        return x + h


class DopNet(nn.Module):
    def __init__(self, c: int = 64, blocks: int = 6, exit_block: int = 3, gpool=(2, 4, 6), policy_c: int = 32, value_c: int = 64, exit_value_c: int = 32):
        super().__init__()
        self.cfg = dict(C=c, N=blocks, E=exit_block, G=list(gpool), policyC=policy_c, valueC=value_c, exitValueC=exit_value_c)
        self.stem = nn.Conv2d(PLANES, c, 9, padding=4, bias=False)
        self.stem_bn = nn.BatchNorm2d(c)
        self.stem_komi = nn.Parameter(torch.zeros(c))
        self.blocks = nn.ModuleList([Block(c, (i + 1) in gpool) for i in range(blocks)])
        # Exit heads.
        self.exit_policy = nn.Conv2d(c, 1, 1)
        self.exit_pass = nn.Linear(2 * c, 1)
        self.exit_v1 = nn.Linear(2 * c, exit_value_c)
        self.exit_v2 = nn.Linear(exit_value_c, 3)
        # Final heads.
        self.p1 = nn.Conv2d(c, policy_c, 1)
        self.pg = nn.Linear(2 * c, policy_c, bias=False)
        self.p2 = nn.Conv2d(policy_c, 1, 1)
        self.pass_ = nn.Linear(2 * c, 1)
        self.v1 = nn.Linear(2 * c, value_c)
        self.v2 = nn.Linear(value_c, 2)
        self.own = nn.Conv2d(c, 1, 1)

    def forward(self, planes: torch.Tensor, self_komi: torch.Tensor, full: bool = True):
        """planes [B,13,19,19], self_komi [B] (already / 10).

        Returns dict with exit_policy [B,362], exit_value [B,3] and, when full, policy
        [B,362], value [B,2], own [B,361]."""
        x = self.stem_bn(self.stem(planes)) + self_komi[:, None, None, None] * self.stem_komi[None, :, None, None]
        out = {}
        for i, blk in enumerate(self.blocks):
            x = blk(x)
            if i + 1 == self.cfg['E']:
                t = F.relu(x)
                q = pool(t)
                pol = self.exit_policy(t).flatten(1)
                out['exit_policy'] = torch.cat([pol, self.exit_pass(q)], dim=1)
                out['exit_value'] = self.exit_v2(F.relu(self.exit_v1(q)))
                if not full:
                    return out
        t = F.relu(x)
        q = pool(t)
        a = F.relu(self.p1(t) + self.pg(q)[:, :, None, None])
        pol = self.p2(a).flatten(1)
        out['policy'] = torch.cat([pol, self.pass_(q)], dim=1)
        out['value'] = self.v2(F.relu(self.v1(q)))
        out['own'] = self.own(t).flatten(1)
        return out


# ------------------------------------------------------------------ inputs

def planes_from_bytes(board: np.ndarray, to_play: np.ndarray) -> np.ndarray:
    """board uint8 [B,361], to_play uint8 [B] (1/2) -> float32 [B,13,19,19] (README.md)."""
    b = board.astype(np.int32)
    stone = b & 3
    libs = (b >> 2) & 3
    ko = (b >> 4) & 1
    rec = (b >> 5) & 3
    own = to_play.astype(np.int32)[:, None]
    opp = 3 - own
    is_own = stone == own
    is_opp = stone == opp
    out = np.zeros((b.shape[0], PLANES, POINTS), dtype=np.float32)
    out[:, 0] = is_own
    out[:, 1] = is_opp
    for k in (1, 2, 3):
        out[:, 1 + k] = is_own & (libs == k)
        out[:, 4 + k] = is_opp & (libs == k)
    out[:, 8] = ko
    for k in (1, 2, 3):
        out[:, 8 + k] = rec == k
    out[:, 12] = 1
    return out.reshape(-1, PLANES, SIZE, SIZE)


def self_komi(komi: np.ndarray, to_play: np.ndarray) -> np.ndarray:
    return np.where(to_play == 2, komi, -komi).astype(np.float32) / 10.0


# The 8 board symmetries on point indices.
def _sym_maps() -> np.ndarray:
    maps = np.zeros((8, POINTS), dtype=np.int64)
    for s in range(8):
        for y in range(SIZE):
            for x in range(SIZE):
                xx, yy = x, y
                if s & 1:
                    xx = SIZE - 1 - xx
                if s & 2:
                    yy = SIZE - 1 - yy
                if s & 4:
                    xx, yy = yy, xx
                maps[s, y * SIZE + x] = yy * SIZE + xx
    return maps


SYM = _sym_maps()
