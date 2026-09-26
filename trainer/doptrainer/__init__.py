"""Dop Trainer: a Go AI that teaches itself on your own GPU.

It drives KataGo's own self-play training pipeline (native self-play, shuffle, PyTorch training,
export) in a loop, rates every new network in matches against earlier ones, and serves the latest
network and the rating history to the Doppelgänger website on http://127.0.0.1:7474.
"""

__version__ = "0.1.0"

# The KataGo release whose binary and Python training scripts are used together.
# Both must come from the same release: the exported network format has to match the engine.
KATAGO_VERSION = "v1.18.1"
