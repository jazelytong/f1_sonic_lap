/* =====================================================================
   F1 Sonic Lap — main.js
   DSC 106 Final Project Prototype
   ===================================================================== */

const DATA_URL = 'data/f1_sonic_lap.json';

// ── Colours ──────────────────────────────────────────────────────────
const COLOR = {
  ver: '#e10600',
  per: '#1e6bff',
  gold: '#f5a623',
  throttle: '#f5a623',
  brake: '#1e6bff',
  rpm: '#e8e8e8',
  gear: '#e10600',
  muted: '#555',
};

// ── State ─────────────────────────────────────────────────────────────
let state = {
  data: null,
  activeDriver: 'VER',
  playbackIndex: 0,
  isPlaying: false,
  playbackRAF: null,
  playbackStartTime: null,
  playbackStartIndex: 0,
  toneStarted: false,
};

// ── Tone.js nodes ─────────────────────────────────────────────────────
let synth = null, rumble = null, masterVol = null;

// ── D3 chart handles ──────────────────────────────────────────────────
let telChart = null, trackChart = null;

// ── Tooltip ───────────────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');

function showTip(x, y, html) {
  tooltip.innerHTML = html;
  tooltip.style.opacity = '1';
  tooltip.style.left = (x + 14) + 'px';
  tooltip.style.top = (y - 10) + 'px';
}
function hideTip() { tooltip.style.opacity = '0'; }

// ── Helpers ───────────────────────────────────────────────────────────
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return `${m}:${sec.padStart(6, '0')}`;
}

// ══════════════════════════════════════════════════════════════════════
//  LOAD DATA
// ══════════════════════════════════════════════════════════════════════
async function loadData() {
  setStatus('Loading telemetry…');
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    state.data = await res.json();
    setStatus('Telemetry loaded. Press Play to start.');
    onDataReady();
  } catch (e) {
    setStatus('⚠ Could not load data/f1_sonic_lap.json — ' + e.message);
    console.error(e);
  }
}

function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function onDataReady() {
  const { drivers } = state.data;

  // Show lap times in tabs
  document.getElementById('ver-time').textContent = fmtTime(drivers.VER.lap_time_s);
  document.getElementById('per-time').textContent = fmtTime(drivers.PER.lap_time_s);

  buildTelemetryChart();
  buildTrackMap();
  buildScatterChart();
  buildDeltaChart();
  initAudio();
  bindButtons();
  bindTabs();
}

// ══════════════════════════════════════════════════════════════════════
//  TELEMETRY CHART (Section 1)
// ══════════════════════════════════════════════════════════════════════
function buildTelemetryChart() {
  const container = document.getElementById('telemetry-chart');
  container.innerHTML = '';

  const tel = getTel();
  if (!tel || tel.length === 0) return;

  const W = container.clientWidth || 900;
  const laneH = 80;
  const laneGap = 6;
  const marginL = 56, marginR = 16, marginT = 10, marginB = 36;
  const lanes = [
    { key: 'rpm',      label: 'RPM',      color: COLOR.rpm,       fill: false },
    { key: 'throttle', label: 'Throttle %', color: COLOR.throttle, fill: true },
    { key: 'brakePct', label: 'Brake',    color: COLOR.brake,    fill: true },
    { key: 'gear',     label: 'Gear',     color: COLOR.gear,     fill: false, step: true },
  ];

  const totalH = lanes.length * (laneH + laneGap) + marginT + marginB;
  const innerW = W - marginL - marginR;

  const xExtent = d3.extent(tel, d => d.t);
  const xScale = d3.scaleLinear().domain(xExtent).range([0, innerW]);

  const svg = d3.select(container)
    .append('svg')
    .attr('class', 'tel-svg')
    .attr('viewBox', `0 0 ${W} ${totalH}`)
    .attr('width', '100%');

  const g = svg.append('g').attr('transform', `translate(${marginL},${marginT})`);

  // X axis (shared at bottom)
  const xAxis = d3.axisBottom(xScale).ticks(10).tickFormat(d => d + 's');
  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${totalH - marginT - marginB})`)
    .call(xAxis);

  lanes.forEach((lane, i) => {
    const y0 = i * (laneH + laneGap);
    const lg = g.append('g').attr('transform', `translate(0,${y0})`);

    const vals = tel.map(d => +d[lane.key]);
    const [vMin, vMax] = lane.key === 'gear' ? [0, 9] : d3.extent(vals);
    const yScale = d3.scaleLinear().domain([vMin, vMax]).range([laneH, 0]).nice();

    // Y axis (left)
    lg.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(yScale).ticks(3));

    // Lane label
    lg.append('text')
      .attr('class', 'lane-label')
      .attr('x', -marginL + 2)
      .attr('y', laneH / 2)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', 'start')
      .text(lane.label);

    // Background
    lg.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', innerW).attr('height', laneH)
      .attr('fill', 'rgba(255,255,255,0.015)')
      .attr('rx', 4);

    if (lane.fill) {
      const area = d3.area()
        .x(d => xScale(d.t))
        .y0(laneH)
        .y1(d => yScale(+d[lane.key]))
        .curve(d3.curveMonotoneX);

      lg.append('path')
        .datum(tel)
        .attr('fill', lane.color)
        .attr('opacity', 0.25)
        .attr('d', area);
    }

    const lineGen = lane.step
      ? d3.line().x(d => xScale(d.t)).y(d => yScale(+d[lane.key])).curve(d3.curveStepAfter)
      : d3.line().x(d => xScale(d.t)).y(d => yScale(+d[lane.key])).curve(d3.curveMonotoneX);

    lg.append('path')
      .datum(tel)
      .attr('fill', 'none')
      .attr('stroke', lane.color)
      .attr('stroke-width', 1.5)
      .attr('d', lineGen);
  });

  // Playhead group
  const playheadG = g.append('g').attr('class', 'playhead-g').style('pointer-events', 'none');
  playheadG.append('line')
    .attr('class', 'playhead-line')
    .attr('y1', 0)
    .attr('y2', totalH - marginT - marginB);
  playheadG.attr('transform', 'translate(-9999,0)');

  // Hover overlay (full chart height)
  const overlay = g.append('rect')
    .attr('class', 'hover-overlay')
    .attr('x', 0).attr('y', 0)
    .attr('width', innerW)
    .attr('height', totalH - marginT - marginB);

  function getIndexAtX(px) {
    const tVal = xScale.invert(px);
    let best = 0, bestDist = Infinity;
    tel.forEach((d, i) => {
      const dist = Math.abs(d.t - tVal);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  overlay.on('mousemove', function (event) {
    const [px] = d3.pointer(event, this);
    const idx = getIndexAtX(px);
    movePlayhead(idx);
    updateReadout(idx);
  });

  overlay.on('click', function (event) {
    const [px] = d3.pointer(event, this);
    const idx = getIndexAtX(px);
    state.playbackIndex = idx;
    movePlayhead(idx);
    updateReadout(idx);
  });

  telChart = { xScale, playheadG, innerW, totalH, marginT, marginB };
}

function movePlayhead(idx) {
  if (!telChart) return;
  const tel = getTel();
  if (!tel || idx >= tel.length) return;
  const x = telChart.xScale(tel[idx].t);
  telChart.playheadG.attr('transform', `translate(${x},0)`);
}

function updateReadout(idx) {
  const tel = getTel();
  if (!tel || idx >= tel.length) return;
  const d = tel[idx];
  document.getElementById('r-rpm').textContent = Math.round(d.rpm).toLocaleString();
  document.getElementById('r-speed').textContent = Math.round(d.speed) + ' km/h';
  document.getElementById('r-gear').textContent = d.gear;
  document.getElementById('r-throttle').textContent = Math.round(d.throttle) + ' %';
  document.getElementById('r-brake').textContent = Math.round(d.brakePct) + ' %';
}

function getTel() {
  if (!state.data) return null;
  return state.data.drivers[state.activeDriver]?.telemetry ?? null;
}
function getPos() {
  if (!state.data) return null;
  return state.data.drivers[state.activeDriver]?.position ?? null;
}

// ══════════════════════════════════════════════════════════════════════
//  TRACK MAP (Section 2)
// ══════════════════════════════════════════════════════════════════════
function buildTrackMap() {
  const container = document.getElementById('track-map');
  container.innerHTML = '';

  const pos = state.data.drivers[state.activeDriver].position;
  const tel = state.data.drivers[state.activeDriver].telemetry;
  if (!pos || pos.length === 0) return;

  const xs = pos.map(d => d.x), ys = pos.map(d => d.y);
  const [xMin, xMax] = d3.extent(xs);
  const [yMin, yMax] = d3.extent(ys);
  const W = container.clientWidth || 200; // Use container width
  const PAD = 16, LEGEND_PAD = 18;
  const scale = Math.min((W - PAD * 2) / (xMax - xMin), (W - PAD * 2) / (yMax - yMin));
  const H = Math.round((yMax - yMin) * scale + PAD * 2 + LEGEND_PAD);

  const toX = x => (x - xMin) * scale + PAD;
  const toY = y => H - ((y - yMin) * scale + PAD); // flip Y

  // Build speed lookup by time
  const speedByT = {};
  tel.forEach(d => { speedByT[d.t.toFixed(2)] = d.speed; });
  const speeds = pos.map(p => {
    const key = p.t.toFixed(2);
    return speedByT[key] ?? 200;
  });
  const [sMin, sMax] = d3.extent(speeds);
  const colorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([sMin, sMax]);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('width', '100%');

  // Track background
  const lineGen = d3.line().x(d => toX(d.x)).y(d => toY(d.y)).curve(d3.curveCatmullRom.alpha(0.5));
  svg.append('path')
    .datum(pos)
    .attr('fill', 'none')
    .attr('stroke', '#333')
    .attr('stroke-width', 7)
    .attr('stroke-linecap', 'round')
    .attr('d', lineGen);

  // Coloured segments
  for (let i = 0; i < pos.length - 1; i++) {
    svg.append('line')
      .attr('x1', toX(pos[i].x)).attr('y1', toY(pos[i].y))
      .attr('x2', toX(pos[i + 1].x)).attr('y2', toY(pos[i + 1].y))
      .attr('stroke', colorScale(speeds[i]))
      .attr('stroke-width', 3)
      .attr('stroke-linecap', 'round');
  }

  // Moving dot
  const dot = svg.append('circle')
    .attr('class', 'track-dot')
    .attr('r', 6)
    .attr('cx', toX(pos[0].x))
    .attr('cy', toY(pos[0].y));

  // Speed legend
  const legendW = 80, legendH = 8, legendX = PAD, legendY = H - PAD + 2;
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'speed-grad');
  const nStops = 6;
  d3.range(nStops).forEach(i => {
    grad.append('stop')
      .attr('offset', `${(i / (nStops - 1)) * 100}%`)
      .attr('stop-color', colorScale(sMin + (i / (nStops - 1)) * (sMax - sMin)));
  });
  svg.append('rect')
    .attr('x', legendX).attr('y', legendY)
    .attr('width', legendW).attr('height', legendH)
    .attr('fill', 'url(#speed-grad)').attr('rx', 2);
  svg.append('text').attr('x', legendX).attr('y', legendY - 2)
    .attr('fill', '#888').attr('font-size', 8)
    .attr('font-family', "'Barlow Condensed', sans-serif")
    .text(`${Math.round(sMin)} km/h`);
  svg.append('text').attr('x', legendX + legendW).attr('y', legendY - 2)
    .attr('fill', '#888').attr('font-size', 8).attr('text-anchor', 'end')
    .attr('font-family', "'Barlow Condensed', sans-serif")
    .text(`${Math.round(sMax)} km/h`);

  trackChart = { pos, dot, toX, toY };
}

function updateTrackDot(idx) {
  if (!trackChart) return;
  const posData = getPos();
  if (!posData) return;

  const tel = getTel();
  if (!tel || idx >= tel.length) return;
  const t = tel[idx].t;

  // Find nearest position sample
  let best = 0, bestDist = Infinity;
  posData.forEach((p, i) => {
    const d = Math.abs(p.t - t);
    if (d < bestDist) { bestDist = d; best = i; }
  });

  const p = posData[best];
  trackChart.dot
    .attr('cx', trackChart.toX(p.x))
    .attr('cy', trackChart.toY(p.y));
}

// ══════════════════════════════════════════════════════════════════════
//  SCATTER CHART (Section 3)
// ══════════════════════════════════════════════════════════════════════
function buildScatterChart() {
  const container = document.getElementById('scatter-chart');
  container.innerHTML = '';

  const all = state.data.allDrivers;
  if (!all || all.length === 0) return;

  const W = container.clientWidth || 480;
  const H = 320;
  const marginL = 60, marginR = 24, marginT = 45, marginB = 48;
  const innerW = W - marginL - marginR;
  const innerH = H - marginT - marginB;

  const xScale = d3.scaleLinear()
    .domain(d3.extent(all, d => d.smoothness)).nice()
    .range([0, innerW]);
  const yScale = d3.scaleLinear()
    .domain(d3.extent(all, d => d.lap_time_s)).nice()
    .range([innerH, 0]);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('width', '100%');

  const g = svg.append('g').attr('transform', `translate(${marginL},${marginT})`);

  // Axes
  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.format('.3f')));
  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => fmtTime(d)));

  // Axis labels
  g.append('text').attr('x', innerW / 2).attr('y', innerH + 40)
    .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', 12)
    .text('Input Smoothness Score (lower = smoother)');
  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2).attr('y', -50)
    .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', 12)
    .text('Fastest Q Lap Time');

  // Dots
  const featured = new Set(['VER', 'PER']);

  const dots = g.selectAll('.scatter-dot')
    .data(all)
    .join('circle')
    .attr('class', 'scatter-dot')
    .attr('cx', d => xScale(d.smoothness))
    .attr('cy', d => yScale(d.lap_time_s))
    .attr('r', d => featured.has(d.driver) ? 8 : 5)
    .attr('fill', d => featured.has(d.driver) ? COLOR.gold : COLOR.ver)
    .attr('opacity', d => featured.has(d.driver) ? 1 : 0.55)
    .attr('stroke', d => featured.has(d.driver) ? '#fff' : 'none')
    .attr('stroke-width', 1.5);

  // Labels for VER and PER
  all.forEach(d => {
    if (featured.has(d.driver)) {
      g.append('text')
        .attr('x', xScale(d.smoothness) + 10)
        .attr('y', yScale(d.lap_time_s) + 4)
        .attr('fill', COLOR.gold)
        .attr('font-family', "'Barlow Condensed', sans-serif")
        .attr('font-weight', 700)
        .attr('font-size', 12)
        .text(d.driver);
    }
  });

  // Tooltip on hover
  dots.on('mousemove', function (event, d) {
    d3.select(this).attr('r', 8);
    showTip(event.clientX, event.clientY,
      `<strong>${d.driver}</strong><br>Lap: ${fmtTime(d.lap_time_s)}<br>Smoothness: ${d.smoothness.toFixed(4)}`);
  }).on('mouseleave', function (event, d) {
    d3.select(this).attr('r', featured.has(d.driver) ? 8 : 5);
    hideTip();
  });
}

// ══════════════════════════════════════════════════════════════════════
//  DELTA CHART (Section 4)
// ══════════════════════════════════════════════════════════════════════
function buildDeltaChart() {
  const container = document.getElementById('delta-chart');
  container.innerHTML = '';

  const telA = state.data.drivers.VER.telemetry;
  const telB = state.data.drivers.PER.telemetry;
  if (!telA || !telB) return;

  const W = container.clientWidth || 450;
  const H = 320;
  const marginL = 56, marginR = 16, marginT = 45, marginB = 40;
  const innerW = W - marginL - marginR;
  const innerH = H - marginT - marginB;

  // Interpolate B onto A's distance axis
  const distA = telA.map(d => d.distance);
  const distB = telB.map(d => d.distance);
  const tA = telA.map(d => d.t);
  const tB = telB.map(d => d.t);

  const maxDist = Math.min(d3.max(distA), d3.max(distB));
  const nPoints = 600;
  const distCommon = d3.range(nPoints).map(i => (i / (nPoints - 1)) * maxDist);

  function interpTime(dist, distArr, tArr) {
    if (dist <= distArr[0]) return tArr[0];
    if (dist >= distArr[distArr.length - 1]) return tArr[tArr.length - 1];
    let lo = 0, hi = distArr.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; distArr[mid] < dist ? lo = mid : hi = mid; }
    const frac = (dist - distArr[lo]) / (distArr[hi] - distArr[lo]);
    return tArr[lo] + frac * (tArr[hi] - tArr[lo]);
  }

  const deltaData = distCommon.map(d => {
    const tA_at = interpTime(d, distA, tA);
    const tB_at = interpTime(d, distB, tB);
    return { dist: d, delta: (tA_at - tA[0]) - (tB_at - tB[0]) };
  });

  const xScale = d3.scaleLinear().domain([0, maxDist / 1000]).range([0, innerW]);
  const yExtent = d3.extent(deltaData, d => d.delta);
  const yScale = d3.scaleLinear().domain(yExtent).nice().range([innerH, 0]);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('width', '100%');

  const g = svg.append('g').attr('transform', `translate(${marginL},${marginT})`);

  // Axes
  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(8).tickFormat(d => d + ' km'));
  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => (d >= 0 ? '+' : '') + d.toFixed(2) + 's'));

  // Zero line
  g.append('line')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', yScale(0)).attr('y2', yScale(0))
    .attr('stroke', '#444').attr('stroke-dasharray', '4 4');

  // VER ahead fill (delta < 0)
  const areaVER = d3.area()
    .x(d => xScale(d.dist / 1000))
    .y0(yScale(0))
    .y1(d => d.delta < 0 ? yScale(d.delta) : yScale(0))
    .curve(d3.curveMonotoneX);

  // PER ahead fill (delta > 0)
  const areaPER = d3.area()
    .x(d => xScale(d.dist / 1000))
    .y0(yScale(0))
    .y1(d => d.delta > 0 ? yScale(d.delta) : yScale(0))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(deltaData).attr('fill', COLOR.ver).attr('opacity', 0.35).attr('d', areaVER);
  g.append('path').datum(deltaData).attr('fill', COLOR.per).attr('opacity', 0.35).attr('d', areaPER);

  // Delta line
  const lineGen = d3.line()
    .x(d => xScale(d.dist / 1000))
    .y(d => yScale(d.delta))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(deltaData)
    .attr('fill', 'none').attr('stroke', '#ccc').attr('stroke-width', 1.5).attr('d', lineGen);

  // Legend
  const leg = g.append('g').attr('transform', `translate(${innerW - 105}, -40)`);
  
  // Legend background
  leg.append('rect')
    .attr('x', -8).attr('y', -8)
    .attr('width', 110).attr('height', 42)
    .attr('fill', 'rgba(0,0,0,0.3)')
    .attr('rx', 4);

  [['VER ahead', COLOR.ver], ['PER ahead', COLOR.per]].forEach(([label, color], i) => {
    leg.append('rect').attr('x', 0).attr('y', i * 18).attr('width', 12).attr('height', 12)
      .attr('fill', color).attr('opacity', 0.9).attr('rx', 2);
    leg.append('text').attr('x', 18).attr('y', i * 18 + 10)
      .attr('fill', '#eee').attr('font-size', 11)
      .attr('font-family', "'Barlow Condensed', sans-serif")
      .attr('font-weight', 500)
      .text(label);
  });

  // Tooltip & Hover Overlay
  const tooltipLine = g.append('line')
    .attr('stroke', 'rgba(255,255,255,0.4)')
    .attr('stroke-width', 1)
    .attr('y1', 0)
    .attr('y2', innerH)
    .style('opacity', 0);

  const overlay = g.append('rect')
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'transparent');

  overlay.on('mousemove', function(event) {
    const [mx] = d3.pointer(event);
    const distVal = xScale.invert(mx);
    
    // Find nearest data point
    let best = deltaData[0], minDiff = Infinity;
    deltaData.forEach(d => {
      const diff = Math.abs(d.dist/1000 - distVal);
      if (diff < minDiff) { minDiff = diff; best = d; }
    });

    const x = xScale(best.dist/1000);
    tooltipLine.attr('x1', x).attr('x2', x).style('opacity', 1);
    
    const driver = best.delta < 0 ? 'VER' : 'PER';
    const absDelta = Math.abs(best.delta).toFixed(3);
    
    showTip(event.clientX, event.clientY, 
      `<strong>Dist:</strong> ${(best.dist/1000).toFixed(2)} km<br>` +
      `<strong>Gap:</strong> ${absDelta}s ${driver} leads`);
  });

  overlay.on('mouseleave', () => {
    tooltipLine.style('opacity', 0);
    hideTip();
  });

  // Axis labels
  g.append('text').attr('x', innerW / 2).attr('y', innerH + 36)
    .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', 12)
    .text('Distance around lap (km)');
  g.append('text').attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2).attr('y', -48)
    .attr('text-anchor', 'middle').attr('fill', '#666').attr('font-size', 12)
    .text('Gap (s), VER − PER');
}

// ══════════════════════════════════════════════════════════════════════
//  AUDIO ENGINE
// ══════════════════════════════════════════════════════════════════════
function initAudio() {
  masterVol = new Tone.Volume(-6).toDestination();

  synth = new Tone.Oscillator({
    type: 'sawtooth',
    frequency: 220,
  }).connect(masterVol);

  rumble = new Tone.Oscillator({
    type: 'sine',
    frequency: 50,
  });

  // Rumble gain — connects rumble through a controllable gain before masterVol
  const rumbleGain = new Tone.Gain(0).connect(masterVol);
  rumble.connect(rumbleGain);
  state.rumbleGain = rumbleGain;
}

async function ensureToneStarted() {
  if (!state.toneStarted) {
    await Tone.start();
    state.toneStarted = true;
    synth.start();
    rumble.start();
  }
}

function setAudioFromIndex(idx) {
  const tel = getTel();
  if (!tel || idx >= tel.length || !synth) return;
  const d = tel[idx];

  // RPM → pitch (110–440 Hz, log scale feels more natural)
  const rpmNorm = Math.max(0, Math.min(1, (d.rpm - 5000) / (15000 - 5000)));
  const freq = 110 * Math.pow(4, rpmNorm); // 110 to 440
  synth.frequency.rampTo(freq, 0.05);

  // Throttle → volume
  const thrNorm = d.throttle / 100;
  masterVol.volume.rampTo(thrNorm * 12 - 20, 0.05); // -20 to -8 dB

  // Brake → rumble gain
  if (state.rumbleGain) {
    state.rumbleGain.gain.rampTo(d.brake ? 0.3 : 0, 0.05);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  PLAYBACK LOOP
// ══════════════════════════════════════════════════════════════════════
function startPlayback() {
  if (state.isPlaying) stopPlayback();
  const tel = getTel();
  if (!tel) return;

  state.isPlaying = true;
  state.playbackStartTime = performance.now();
  state.playbackStartIndex = state.playbackIndex;

  const startT = tel[state.playbackIndex].t;
  const endT = tel[tel.length - 1].t;

  updateButtonUI();

  function frame() {
    if (!state.isPlaying) return;

    const elapsed = (performance.now() - state.playbackStartTime) / 1000;
    const t = startT + elapsed;

    if (t >= endT) {
      stopPlayback();
      state.playbackIndex = 0;
      movePlayhead(0);
      updateTrackDot(0);
      setStatus('Playback complete. Press play to replay.');
      return;
    }

    // Find index for t (always search full array so replay/seek works)
    let lo = 0, hi = tel.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      tel[mid].t < t ? lo = mid : hi = mid;
    }

    state.playbackIndex = lo;
    movePlayhead(lo);
    updateReadout(lo);
    updateTrackDot(lo);
    setAudioFromIndex(lo);

    state.playbackRAF = requestAnimationFrame(frame);
  }

  state.playbackRAF = requestAnimationFrame(frame);
}

function stopPlayback() {
  state.isPlaying = false;
  if (state.playbackRAF) cancelAnimationFrame(state.playbackRAF);
  if (masterVol) masterVol.volume.rampTo(-60, 0.3);
  updateButtonUI();
  setStatus('Stopped.');
}

function updateButtonUI() {
  const pPlay = document.getElementById('player-play');
  if (pPlay) pPlay.textContent = state.isPlaying ? '■' : '▶';

  const btnA = document.getElementById('playA');
  const btnB = document.getElementById('playB');
  
  if (btnA && btnB) {
    btnA.textContent = (state.isPlaying && state.activeDriver === 'VER') ? '■ Verstappen' : '▶ Verstappen';
    btnB.textContent = (state.isPlaying && state.activeDriver === 'PER') ? '■ Perez' : '▶ Perez';
    
    btnA.classList.toggle('playing', state.isPlaying && state.activeDriver === 'VER');
    btnB.classList.toggle('playing', state.isPlaying && state.activeDriver === 'PER');
  }
}

// ══════════════════════════════════════════════════════════════════════
//  BUTTONS & TABS
// ══════════════════════════════════════════════════════════════════════
function setActiveDriver(driver) {
  stopPlayback();
  state.activeDriver = driver;
  state.playbackIndex = 0;
  updateTabs();
  rebuildTelemetry();
  updateTrackDot(0);
}

function bindButtons() {
  const handleToggle = async (driver) => {
    // If switching to a different driver, always stop then start fresh
    if (driver && driver !== state.activeDriver) {
      await ensureToneStarted();
      setActiveDriver(driver);
      setStatus(`Playing ${driver === 'VER' ? 'Verstappen' : 'Perez'}…`);
      startPlayback();
      return;
    }
    // Same driver (or no driver arg = in-card play button): toggle play/pause
    if (state.isPlaying) {
      stopPlayback();
    } else {
      await ensureToneStarted();
      if (driver) setStatus(`Playing ${driver === 'VER' ? 'Verstappen' : 'Perez'}…`);
      else setStatus(`Playing ${state.activeDriver}…`);
      startPlayback();
    }
  };

  document.getElementById('playA').addEventListener('click', () => handleToggle('VER'));
  document.getElementById('playB').addEventListener('click', () => handleToggle('PER'));
  
  const pPlay = document.getElementById('player-play');
  if (pPlay) pPlay.addEventListener('click', () => handleToggle(null));

  const pReset = document.getElementById('player-reset');
  if (pReset) pReset.addEventListener('click', () => {
    stopPlayback();
    state.playbackIndex = 0;
    movePlayhead(0);
    updateReadout(0);
    updateTrackDot(0);
    setStatus('Reset to start.');
  });
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setActiveDriver(tab.dataset.driver);
    });
  });
}

function updateTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.driver === state.activeDriver);
  });
}

function rebuildTelemetry() {
  buildTelemetryChart();
  buildTrackMap();
}

// ══════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════
loadData();

