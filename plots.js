/* AERO301 native SVG plots. No network resources or third-party dependencies. */
(function (root) {
  'use strict';

  const PLOTS = {
    thrust: { title: 'Thrust required and available', unit: 'Thrust (N)', signed: false,
      series: [['TR', 'Required thrust', '#183c60', 1], ['TA', 'Available thrust', '#138577', 1]] },
    power: { title: 'Power required and available', unit: 'Power (kW)', signed: false,
      series: [['PR', 'Required power', '#183c60', 0.001], ['PA', 'Available power', '#138577', 0.001]] },
    excessThrust: { title: 'Excess thrust', unit: 'Excess thrust (N)', signed: true,
      series: [['excessThrust', 'Available minus required', '#138577', 1]] },
    excessPower: { title: 'Excess power', unit: 'Excess power (kW)', signed: true,
      series: [['excessPower', 'Available minus required', '#138577', 0.001]] },
    climb: { title: 'Estimated rate of climb', unit: 'Estimated climb rate (m/s)', signed: true,
      series: [['RC', 'Level-flight excess-power estimate', '#138577', 1]] },
    deficit: { title: 'Power deficit', unit: 'Power deficit (kW)', signed: false,
      series: [['deficit', 'Required power shortfall', '#b26425', 0.001]] }
  };
  let serial = 0;

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function clip(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
  function round(value) { return Number(value.toFixed(3)); }
  function tickText(value, step) {
    if (Math.abs(value) < Math.abs(step) * 1e-8) return '0';
    const a = Math.abs(value);
    if (a >= 1e7 || (a > 0 && a < 0.0001)) return value.toExponential(1);
    let decimals = 0;
    while (decimals < 6 && Math.abs(step * Math.pow(10, decimals) - Math.round(step * Math.pow(10, decimals))) > 1e-8) decimals++;
    return Number(value.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals });
  }
  function niceStep(span, target) {
    const raw = span / target;
    if (!(raw > 0) || !finite(raw)) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / magnitude;
    const mantissa = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    return mantissa * magnitude;
  }
  function ticks(lo, hi, step) {
    const out = [];
    let value = Math.ceil((lo - step * 1e-9) / step) * step;
    for (let i = 0; i < 100 && value <= hi + step * 1e-9; i++, value += step) out.push(value);
    return out;
  }
  function short(text, length) {
    text = String(text || '');
    return text.length > length ? text.slice(0, length - 1) + '…' : text;
  }

  function render(config) {
    config = config || {};
    const spec = PLOTS[config.kind] || PLOTS.thrust;
    const id = 'aeroplot-' + (++serial);
    const W = 900, H = 440;
    const box = { x: 88, y: 136, w: 778, h: 222 };
    const lo = Number(config.Vlo), hi = Number(config.Vhi);
    const samples = (Array.isArray(config.samples) ? config.samples : [])
      .filter(s => s && finite(s.V) && s.V >= lo && s.V <= hi)
      .slice().sort((a, b) => a.V - b.V);
    const values = [];
    for (const s of samples) for (const series of spec.series) {
      const value = s[series[0]];
      if (finite(value)) values.push(value * series[3]);
    }
    const commonStart = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="440" viewBox="0 0 900 440" role="img" aria-labelledby="' + id + '-title ' + id + '-desc" style="display:block;width:100%;height:auto;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#18324d">'
      + '<title id="' + id + '-title">' + esc(spec.title) + '</title>'
      + '<desc id="' + id + '-desc">Aircraft performance versus true airspeed. Shaded regions and dashed curves identify mathematical extensions outside the supported stall and Mach limits. Climb is estimated using level-flight drag.</desc>'
      + '<rect width="900" height="440" fill="#fff"/>'
      + '<text x="28" y="31" font-size="19" font-weight="700" fill="#18324d">' + esc(spec.title) + '</text>'
      + '<text x="868" y="31" text-anchor="end" font-size="11" fill="#627386">' + esc(short(config.caseId || '', 42)) + '</text>';
    if (!(finite(lo) && finite(hi) && hi > lo) || samples.length < 2 || values.length === 0) {
      return commonStart + '<text x="450" y="220" text-anchor="middle" font-size="16" fill="#627386">No curve data for this plotting window.</text></svg>';
    }

    let ymin = Math.min(0, ...values), ymax = Math.max(0, ...values);
    if (ymax === ymin) { ymin = spec.signed ? -1 : 0; ymax = 1; }
    const span = ymax - ymin;
    if (ymin < 0) ymin -= span * 0.06;
    ymax += span * 0.08;
    const ystep = niceStep(ymax - ymin, 5);
    ymin = Math.floor(ymin / ystep) * ystep;
    ymax = Math.ceil(ymax / ystep) * ystep;
    if (!(ymax > ymin)) ymax = ymin + 1;
    const xtickStep = niceStep(hi - lo, 7);
    const x = v => box.x + (v - lo) / (hi - lo) * box.w;
    const y = v => box.y + box.h - (v - ymin) / (ymax - ymin) * box.h;
    const domainLo = finite(config.Vs) ? Math.max(1, config.Vs) : lo;
    const domainHi = finite(config.Vcap) ? config.Vcap : hi;
    const below = Math.max(lo, Math.min(hi, domainLo));
    const above = Math.max(lo, Math.min(hi, domainHi));
    const out = [commonStart,
      '<defs><clipPath id="' + id + '-clip"><rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '"/></clipPath></defs>'
    ];

    // A compact legend remains in the exported SVG.
    let legendX = 29;
    for (const series of spec.series) {
      out.push('<line x1="' + legendX + '" x2="' + (legendX + 25) + '" y1="55" y2="55" stroke="' + series[2] + '" stroke-width="2.8"/>',
        '<text x="' + (legendX + 33) + '" y="59" font-size="11.5" fill="#445970">' + esc(series[1]) + '</text>');
      legendX += 48 + series[1].length * 6.05;
    }
    out.push('<line x1="' + legendX + '" x2="' + (legendX + 25) + '" y1="55" y2="55" stroke="#7f8b96" stroke-width="2" stroke-dasharray="5 4"/>',
      '<text x="' + (legendX + 33) + '" y="59" font-size="11.5" fill="#637487">Outside supported domain</text>');

    out.push('<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="#fff"/>');
    if (below > lo) out.push('<rect x="' + box.x + '" y="' + box.y + '" width="' + round(x(below) - box.x) + '" height="' + box.h + '" fill="#fff0da"/>');
    if (above < hi) out.push('<rect x="' + round(x(above)) + '" y="' + box.y + '" width="' + round(box.x + box.w - x(above)) + '" height="' + box.h + '" fill="#edf0f5"/>');

    for (const value of ticks(ymin, ymax, ystep)) {
      const py = round(y(value));
      out.push('<line x1="' + box.x + '" x2="' + (box.x + box.w) + '" y1="' + py + '" y2="' + py + '" stroke="' + (Math.abs(value) < ystep * 1e-8 && spec.signed ? '#8191a2' : '#e4eaf0') + '" stroke-width="' + (Math.abs(value) < ystep * 1e-8 && spec.signed ? '1.3' : '1') + '"/>',
        '<text x="' + (box.x - 11) + '" y="' + (py + 4) + '" text-anchor="end" font-size="11" fill="#586d82">' + esc(tickText(value, ystep)) + '</text>');
    }
    for (const value of ticks(lo, hi, xtickStep)) {
      const px = round(x(value));
      out.push('<line x1="' + px + '" x2="' + px + '" y1="' + box.y + '" y2="' + (box.y + box.h) + '" stroke="#edf1f5"/>',
        '<line x1="' + px + '" x2="' + px + '" y1="' + (box.y + box.h) + '" y2="' + (box.y + box.h + 5) + '" stroke="#a0adbb"/>',
        '<text x="' + px + '" y="' + (box.y + box.h + 22) + '" text-anchor="middle" font-size="11" fill="#586d82">' + esc(tickText(value, xtickStep)) + '</text>');
    }

    // Series paths break at absent values. Supported paths are independently
    // clipped at Vs and Vcap, so they never join across an invalid interval.
    out.push('<g clip-path="url(#' + id + '-clip)">');
    for (const series of spec.series) {
      const key = series[0], scale = series[3];
      let full = '', connected = false, supported = '';
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (!finite(s[key])) { connected = false; continue; }
        full += (connected ? 'L' : 'M') + round(x(s.V)) + ',' + round(y(s[key] * scale));
        connected = true;
      }
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        if (!(finite(a[key]) && finite(b[key])) || b.V <= a.V) continue;
        const va = Math.max(a.V, domainLo), vb = Math.min(b.V, domainHi);
        if (vb <= va) continue;
        // A false validity flag inside the model domain is a real gap.
        if ((a.valid === false && a.V >= domainLo && a.V <= domainHi) ||
            (b.valid === false && b.V >= domainLo && b.V <= domainHi)) continue;
        const ya = (a[key] + (b[key] - a[key]) * (va - a.V) / (b.V - a.V)) * scale;
        const yb = (a[key] + (b[key] - a[key]) * (vb - a.V) / (b.V - a.V)) * scale;
        supported += 'M' + round(x(va)) + ',' + round(y(ya)) + 'L' + round(x(vb)) + ',' + round(y(yb));
      }
      out.push('<path d="' + full + '" fill="none" stroke="' + series[2] + '" stroke-opacity="0.43" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>',
        '<path d="' + supported + '" fill="none" stroke="' + series[2] + '" stroke-width="2.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>');
    }
    out.push('</g>');

    const proposed = [];
    if (finite(config.Vs)) proposed.push({ V: config.Vs, label: 'Stall', color: '#a36720' });
    if (finite(config.Vcap)) proposed.push({ V: config.Vcap, label: 'Mach 0.30', color: '#69758a' });
    for (const marker of Array.isArray(config.markers) ? config.markers : []) {
      if (marker && finite(marker.V)) proposed.push({ V: marker.V, label: String(marker.label || 'Condition'), color: '#4a657c' });
    }
    const markers = [];
    for (const marker of proposed) {
      if (marker.V < lo || marker.V > hi) continue;
      const old = markers.find(m => Math.abs(m.V - marker.V) <= 1e-7 * Math.max(1, Math.abs(marker.V)));
      if (old) {
        if (!old.label.includes(marker.label)) old.label += ' / ' + marker.label;
      } else markers.push(marker);
    }
    markers.sort((a, b) => a.V - b.V);
    const occupied = [[], [], [], []];
    for (const marker of markers.slice(0, 18)) {
      const px = x(marker.V), label = short(marker.label, 20) + ' ' + marker.V.toFixed(3);
      const width = Math.min(box.w, label.length * 5.65 + 12);
      let best = null;
      for (let lane = 0; lane < occupied.length; lane++) {
        const used = occupied[lane].slice().sort((a, b) => a[0] - b[0]);
        let left = box.x;
        for (let gap = 0; gap <= used.length; gap++) {
          const right = gap < used.length ? used[gap][0] - 6 : box.x + box.w;
          if (right - left >= width) {
            const start = clip(px - width / 2, left, right - width);
            const cost = Math.abs(start + width / 2 - px) + lane * 15;
            if (!best || cost < best.cost) best = { lane, start, width, cost };
          }
          if (gap < used.length) left = used[gap][1] + 6;
        }
      }
      if (!best) continue;
      occupied[best.lane].push([best.start, best.start + width]);
      const labelY = 78 + best.lane * 14;
      const center = best.start + width / 2;
      out.push('<g><title>' + esc(marker.label + ': ' + marker.V.toFixed(9) + ' m/s') + '</title>',
        '<line x1="' + round(px) + '" x2="' + round(px) + '" y1="' + box.y + '" y2="' + (box.y + box.h) + '" stroke="' + marker.color + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>',
        '<path d="M' + round(center) + ',' + (labelY + 4) + 'L' + round(px) + ',' + (box.y - 4) + '" fill="none" stroke="' + marker.color + '" stroke-opacity="0.35"/>',
        '<rect x="' + round(best.start) + '" y="' + (labelY - 10) + '" width="' + round(width) + '" height="14" rx="3" fill="#fff"/>',
        '<text x="' + round(center) + '" y="' + labelY + '" text-anchor="middle" font-size="10.5" font-weight="600" fill="' + marker.color + '">' + esc(label) + '</text></g>');
    }

    out.push('<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="none" stroke="#c8d3df"/>',
      '<text x="' + (box.x + box.w / 2) + '" y="405" text-anchor="middle" font-size="12" font-weight="600" fill="#344e68">True airspeed (m/s)</text>',
      '<text transform="translate(22 ' + (box.y + box.h / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" font-weight="600" fill="#344e68">' + esc(spec.unit) + '</text>',
      '<rect x="29" y="423" width="9" height="9" fill="#fff0da" stroke="#d9bc89"/>',
      '<text x="44" y="431" font-size="10.5" fill="#697a89">Below level-flight stall</text>',
      '<rect x="208" y="423" width="9" height="9" fill="#edf0f5" stroke="#c3cad4"/>',
      '<text x="223" y="431" font-size="10.5" fill="#697a89">Above Mach screen</text>',
      '<text x="868" y="431" text-anchor="end" font-size="10.5" fill="#697a89">' + (spec.signed ? 'Positive values indicate available margin.' : 'Markers use solved values, independently of curve sampling.') + '</text>',
      '</svg>');
    return out.join('');
  }

  const api = { render, PLOTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AeroPlots = api;
})(typeof window !== 'undefined' ? window : globalThis);
