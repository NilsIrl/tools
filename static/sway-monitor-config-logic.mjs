export const COLORS = ['#a8d8ea','#a8e6cf','#ffd3b6','#ffaaa5','#d4a5a5','#b8c0cc','#c9c0d3','#f0d9ff'];

export function logicalSize(mon) {
  const m = mon.modes[mon.selMode];
  const s = mon.scale;
  let w = Math.round(m.width / s);
  let h = Math.round(m.height / s);
  if (mon.transform === '90' || mon.transform === '270' ||
      mon.transform === 'flipped-90' || mon.transform === 'flipped-270') {
    [w, h] = [h, w];
  }
  return { w, h };
}

export function parseOutputs(json) {
  const arr = JSON.parse(json);
  return arr.map((o, i) => {
    const modes = (o.modes || []).map(m => ({
      width: m.width, height: m.height,
      refresh: Math.round(m.refresh / 1000)
    }));
    const seen = new Set();
    const uniqModes = modes.filter(m => {
      const k = `${m.width}x${m.height}@${m.refresh}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).sort((a, b) => (b.width * b.height) - (a.width * a.height) || b.refresh - a.refresh);

    const curW = o.current_mode ? o.current_mode.width : (uniqModes[0] ? uniqModes[0].width : 1920);
    const curH = o.current_mode ? o.current_mode.height : (uniqModes[0] ? uniqModes[0].height : 1080);
    const curR = o.current_mode ? Math.round(o.current_mode.refresh / 1000) : 60;

    let selMode = uniqModes.findIndex(m => m.width === curW && m.height === curH && m.refresh === curR);
    if (selMode < 0) selMode = 0;

    return {
      name: o.name || `output-${i}`,
      make: o.make || 'Unknown',
      model: o.model || 'Unknown',
      serial: o.serial || 'Unknown',
      enabled: o.active !== false,
      modes: uniqModes.length ? uniqModes : [{ width: curW, height: curH, refresh: curR }],
      selMode,
      scale: o.scale || 1,
      transform: o.transform || 'normal',
      x: o.rect ? o.rect.x : i * 400,
      y: o.rect ? o.rect.y : 0,
      color: COLORS[i % COLORS.length],
    };
  });
}

export function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function touches(ax, ay, aw, ah, bx, by, bw, bh) {
  const gapX = Math.max(ax, bx) - Math.min(ax + aw, bx + bw);
  const gapY = Math.max(ay, by) - Math.min(ay + ah, by + bh);
  return (gapX === 0 && gapY <= 0) || (gapY === 0 && gapX <= 0);
}

export function normalizePositions(monitors) {
  const enabled = monitors.filter(m => m.enabled);
  const minX = enabled.length ? Math.min(...enabled.map(m => m.x)) : 0;
  const minY = enabled.length ? Math.min(...enabled.map(m => m.y)) : 0;
  return { minX, minY };
}

export function isTouchingAny(monitors, idx) {
  const { w: mw, h: mh } = logicalSize(monitors[idx]);
  const { x: mx, y: my } = monitors[idx];
  return monitors.some((m, j) => {
    if (j === idx) return false;
    const { w: ow, h: oh } = logicalSize(m);
    return touches(mx, my, mw, mh, m.x, m.y, ow, oh);
  });
}

export function snapToAdjacentEdge(monitors, idx) {
  if (monitors.length < 2) { monitors[idx].x = 0; monitors[idx].y = 0; return; }
  const { w: mw, h: mh } = logicalSize(monitors[idx]);
  const mx = monitors[idx].x, my = monitors[idx].y;
  let bestDist = Infinity, bestX = mx, bestY = my;
  for (let j = 0; j < monitors.length; j++) {
    if (j === idx) continue;
    const { w: ow, h: oh } = logicalSize(monitors[j]);
    const ox = monitors[j].x, oy = monitors[j].y;
    const cy = v => Math.max(oy - mh, Math.min(oy + oh, v));
    const cx = v => Math.max(ox - mw, Math.min(ox + ow, v));
    for (const [nx, ny] of [
      [ox + ow, cy(my)],
      [ox - mw, cy(my)],
      [cx(mx), oy + oh],
      [cx(mx), oy - mh],
    ]) {
      const blocked = monitors.some((m, k) => {
        if (k === idx) return false;
        const { w: kw, h: kh } = logicalSize(m);
        return overlaps(nx, ny, mw, mh, m.x, m.y, kw, kh);
      });
      if (blocked) continue;
      const dist = (nx - mx) ** 2 + (ny - my) ** 2;
      if (dist < bestDist) { bestDist = dist; bestX = nx; bestY = ny; }
    }
  }
  monitors[idx].x = bestX;
  monitors[idx].y = bestY;
}

export function closeGaps(monitors, movedIdx) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < monitors.length; i++) {
      if (i === movedIdx) continue;
      if (!isTouchingAny(monitors, i)) {
        const { x: ox, y: oy } = monitors[i];
        snapToAdjacentEdge(monitors, i);
        if (monitors[i].x !== ox || monitors[i].y !== oy) changed = true;
      }
    }
  }
}
