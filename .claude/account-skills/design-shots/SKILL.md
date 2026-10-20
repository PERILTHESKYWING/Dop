---
name: design-shots
description: Use when checking how a web design looks: take a fixed set of desktop and phone screenshots and measure them against a reference image before any critic or user sees them.
---
# Design shots

Same frames every round, and numbers instead of opinions where numbers exist.

## 1. Capture
- Headless Chromium via Playwright (in cloud sessions it is preinstalled; never run `playwright install`).
- Fixed set, saved in one folder per round (`shots/round-N/`):
  - desktop 1440x900 and 1280x800, phone 390x844 (deviceScaleFactor 2);
  - the top of each page, each scroll chapter or screen the change touches, and any open menu or popup;
  - a 2x crop of the detail being worked on (stones, wood, logo, text block).
- Wait for fonts, images and WebGL to settle (wait for network idle plus about 1.5 s; freeze animations or pick fixed timestamps for motion).
- Same theme, same data, same zoom every round. Name files `<page>-<viewport>-<step>.png`.

## 2. Measure against the reference
- Colour: sample the same regions in the shot and the reference (median rgb over a patch) and report the difference.
- Layout: check text sizes (computed font-size), anything that overlaps or is cut off (element boxes vs the viewport), and WCAG contrast for text.
- Proportions: main visual share of the screen (for example board height %).
- Put results in a small table: check, target, measured, pass or fail.

## 3. Hand off
- Show before/after pairs side by side (previous round vs this one, same frame).
- Give critics (see design-critic-panel) the shots plus the measurement table, so they judge taste and not things code can measure.
- If `/taste` rules exist, run them on the shots first.
- Report honestly: what passed, what failed, what was not checked.
