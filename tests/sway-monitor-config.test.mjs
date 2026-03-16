import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logicalSize, overlaps, touches, normalizePositions,
  isTouchingAny, snapToAdjacentEdge, closeGaps, parseOutputs,
} from '../static/sway-monitor-config-logic.mjs';

// Build a minimal monitor object. w and h are the desired *logical* pixel dimensions.
function mon(x, y, w, h, { scale = 1, transform = 'normal', enabled = true } = {}) {
  return {
    x, y, enabled, scale, transform,
    make: 'Unknown', model: 'Unknown', serial: 'Unknown',
    modes: [{ width: w * scale, height: h * scale, refresh: 60 }],
    selMode: 0, color: '#fff',
    name: `output-${x}-${y}`,
  };
}

// ─── overlaps / touches contracts ────────────────────────────────────────────

test('overlaps: clearly overlapping rects', () => {
  assert.ok(overlaps(0, 0, 100, 100, 50, 50, 100, 100));
  assert.ok(overlaps(0, 0, 100, 100, 50, 0, 100, 100));
});

test('overlaps: touching rects share an edge but do NOT overlap', () => {
  assert.ok(!overlaps(0, 0, 100, 100, 100, 0, 100, 100));  // left/right
  assert.ok(!overlaps(0, 0, 100, 100, 0, 100, 100, 100));  // top/bottom
});

test('overlaps: rects with a gap', () => {
  assert.ok(!overlaps(0, 0, 100, 100, 101, 0, 100, 100));
});

test('touches: side-by-side rects share a vertical edge', () => {
  assert.ok(touches(0, 0, 100, 100, 100, 0, 100, 100));
});

test('touches: stacked rects share a horizontal edge', () => {
  assert.ok(touches(0, 0, 100, 100, 0, 100, 100, 100));
});

test('touches: corner touch counts', () => {
  assert.ok(touches(0, 0, 100, 100, 100, 100, 100, 100));
});

test('touches: 1px gap is not touching', () => {
  assert.ok(!touches(0, 0, 100, 100, 101, 0, 100, 100));
  assert.ok(!touches(0, 0, 100, 100, 0, 101, 100, 100));
});

test('touches: overlapping rects are not "touching"', () => {
  assert.ok(!touches(0, 0, 100, 100, 50, 0, 100, 100));
});

// ─── Bug 1: position normalisation ───────────────────────────────────────────

test('normalizePositions: single monitor at non-zero origin', () => {
  const { minX, minY } = normalizePositions([mon(320, 0, 1440, 960)]);
  assert.equal(minX, 320);
  assert.equal(minY, 0);
});

test('normalizePositions: two monitors, picks the lower bound', () => {
  const { minX, minY } = normalizePositions([
    mon(320, 0, 1440, 960),
    mon(1760, 0, 640, 480),
  ]);
  assert.equal(minX, 320);
  assert.equal(minY, 0);
});

test('normalizePositions: disabled monitors are excluded from the origin', () => {
  const { minX, minY } = normalizePositions([
    mon(0, 0, 1440, 960, { enabled: false }),
    mon(320, 100, 640, 480),
  ]);
  assert.equal(minX, 320);
  assert.equal(minY, 100);
});

test('normalizePositions: all disabled → origin stays 0,0', () => {
  const { minX, minY } = normalizePositions([
    mon(320, 100, 1440, 960, { enabled: false }),
  ]);
  assert.equal(minX, 0);
  assert.equal(minY, 0);
});

test('snapToAdjacentEdge: single monitor always snaps to origin', () => {
  const monitors = [mon(500, 300, 1440, 960)];
  snapToAdjacentEdge(monitors, 0);
  assert.equal(monitors[0].x, 0);
  assert.equal(monitors[0].y, 0);
});

// ─── Bug 2: gap when free axis was not clamped ───────────────────────────────
// Old algorithm: candidate (1920, 2000) had dist=0 and was accepted even though
// monitor[0] ends at y=1080, leaving a 920px vertical gap.

test('snapToAdjacentEdge: monitor with y-offset ends up actually touching', () => {
  const monitors = [mon(0, 0, 1920, 1080), mon(1920, 2000, 1920, 1080)];
  snapToAdjacentEdge(monitors, 1);
  const { w, h } = logicalSize(monitors[1]);
  assert.ok(
    touches(monitors[1].x, monitors[1].y, w, h, 0, 0, 1920, 1080),
    `monitor[1] at (${monitors[1].x},${monitors[1].y}) should touch monitor[0]`,
  );
});

// ─── Bug 3: monitors could overlap when snapping onto a third ────────────────
// Old algorithm: snapping B to right of A placed it exactly on top of C.

test('snapToAdjacentEdge: snapped monitor does not overlap any other', () => {
  // A and C in a row; B is dragged onto A's position
  const monitors = [
    mon(0, 0, 1920, 1080),    // A
    mon(1920, 0, 1920, 1080), // C
    mon(500, 0, 1920, 1080),  // B (overlapping A)
  ];
  snapToAdjacentEdge(monitors, 2);
  const { w, h } = logicalSize(monitors[2]);
  assert.ok(!overlaps(monitors[2].x, monitors[2].y, w, h, 0,    0, 1920, 1080), 'must not overlap A');
  assert.ok(!overlaps(monitors[2].x, monitors[2].y, w, h, 1920, 0, 1920, 1080), 'must not overlap C');
  assert.ok(isTouchingAny(monitors, 2), 'must still touch at least one monitor');
});

// ─── Bug 4: moving the middle monitor left a gap between its neighbours ───────
// Real-data layout from clipboard: eDP-1 | DP-9 | DP-8

test('closeGaps: removing the middle monitor closes the gap (real-data layout)', () => {
  // eDP-1: (0,0) logical 1440×960  (2880×1920 @ scale 2)
  // DP-9:  (1440,0) logical 640×480 (640×480 @ scale 1) — the middle monitor
  // DP-8:  (2080,0) logical 5120×2160 (5120×2160 @ scale 1)
  const monitors = [
    mon(0,    0, 1440, 960),
    mon(1440, 0,  640, 480),  // middle
    mon(2080, 0, 5120, 2160),
  ];

  // Yank DP-9 far away (simulating a drag to a distant position)
  monitors[1].x = 9999;
  monitors[1].y = 9999;
  snapToAdjacentEdge(monitors, 1);
  closeGaps(monitors, 1);

  assert.ok(isTouchingAny(monitors, 0), 'eDP-1 must touch something after gap is closed');
  assert.ok(isTouchingAny(monitors, 2), 'DP-8 must touch something after gap is closed');
});

// ─── logicalSize: transform swaps dimensions ─────────────────────────────────

test('logicalSize: 90-degree transform swaps width and height', () => {
  const m = mon(0, 0, 1080, 1920, { transform: '90' });
  // physical 1080×1920, transform 90° → logical 1920×1080
  // (mon helper sets modes[0] = {width: 1080, height: 1920}; scale=1)
  const { w, h } = logicalSize(m);
  assert.equal(w, 1920);
  assert.equal(h, 1080);
});

test('logicalSize: normal transform keeps dimensions', () => {
  const { w, h } = logicalSize(mon(0, 0, 1920, 1080));
  assert.equal(w, 1920);
  assert.equal(h, 1080);
});

// ─── parseOutputs: integration with real clipboard JSON ──────────────────────

const SAMPLE_JSON = JSON.stringify([
  {
    name: 'eDP-1', make: 'BOE', model: 'NE135A1M-NY1', serial: 'Unknown',
    active: true, scale: 2.0, transform: 'normal',
    rect: { x: 0, y: 0, width: 1440, height: 960 },
    current_mode: { width: 2880, height: 1920, refresh: 120000 },
    modes: [{ width: 2880, height: 1920, refresh: 120000 }],
  },
  {
    name: 'DP-9', make: 'Unknown', model: 'Unknown', serial: 'Unknown',
    active: true, scale: 1.0, transform: 'normal',
    rect: { x: 1440, y: 0, width: 640, height: 480 },
    current_mode: { width: 640, height: 480, refresh: 59940 },
    modes: [{ width: 640, height: 480, refresh: 59940 }],
  },
  {
    name: 'DP-8', make: 'LG Electronics', model: 'LG ULTRAWIDE', serial: '206NTSU1Q350',
    active: true, scale: 1.0, transform: 'normal',
    rect: { x: 2080, y: 0, width: 5120, height: 2160 },
    current_mode: { width: 5120, height: 2160, refresh: 71998 },
    modes: [{ width: 5120, height: 2160, refresh: 71998 }],
  },
]);

test('parseOutputs: parses positions and logical sizes from real JSON', () => {
  const ms = parseOutputs(SAMPLE_JSON);
  assert.equal(ms.length, 3);

  assert.equal(ms[0].x, 0);    assert.equal(ms[0].y, 0);
  assert.equal(ms[1].x, 1440); assert.equal(ms[1].y, 0);
  assert.equal(ms[2].x, 2080); assert.equal(ms[2].y, 0);

  assert.deepEqual(logicalSize(ms[0]), { w: 1440, h: 960  });
  assert.deepEqual(logicalSize(ms[1]), { w: 640,  h: 480  });
  assert.deepEqual(logicalSize(ms[2]), { w: 5120, h: 2160 });
});

test('parseOutputs: initial layout from real JSON is already gap-free', () => {
  const ms = parseOutputs(SAMPLE_JSON);
  assert.ok(isTouchingAny(ms, 0), 'eDP-1 touches DP-9');
  assert.ok(isTouchingAny(ms, 1), 'DP-9 touches its neighbours');
  assert.ok(isTouchingAny(ms, 2), 'DP-8 touches DP-9');
});
