/* AERO301 performance calculations. Implements supplied Theory and PRD v3.0, Parts A/B.
 * All calculations use SI units. Display/input power is converted from kW once.
 * Browser global plus CommonJS export; no network or runtime dependencies.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AeroCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.1.0';
  const CONSTANTS = Object.freeze({ T0: 288.15, p0: 101325, g0: 9.80665, R: 287.05287,
    lapseRate: -0.0065, gamma: 1.4, earthRadius: 6356800, machLimit: 0.30,
    minimumSpeed: 1, climbAngleWarningDeg: 10 });
  const TOLERANCES = Object.freeze({ rootSpeed: 1e-8, rootPower: 1e-5,
    glideCoefficient: 1e-10, glideSpeed: 1e-6, boundaryRelative: 1e-8 });
  const PRESETS = Object.freeze({
    V01: Object.freeze({ caseId: 'V01', mode: 'propeller', weightMode: 'weight', W: 11343,
      m: 11343 / CONSTANTS.g0, geometryMode: 'ar', S: 16.165,
      AR: 1 / (Math.PI * 0.80 * 0.055), b: Math.sqrt(16.165 / (Math.PI * 0.80 * 0.055)),
      e: 0.80, CD0: 0.031, CLmax: 1.48, h: 0, supply: 75,
      supplyMode: 'altitude', Vlo: 20, Vhi: 100, Vop: 40 }),
    V02: Object.freeze({ caseId: 'V02', mode: 'jet', weightMode: 'weight', W: 47151,
      m: 47151 / CONSTANTS.g0, geometryMode: 'ar', S: 22.297,
      AR: 1 / (Math.PI * 0.80 * 0.048), b: Math.sqrt(22.297 / (Math.PI * 0.80 * 0.048)),
      e: 0.80, CD0: 0.023, CLmax: 1.55, h: 0, supply: 3800,
      supplyMode: 'altitude', Vlo: 40, Vhi: 100, Vop: 80 })
  });

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string' || !value.trim()) return NaN;
    const s = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function atmosphereAt(h) {
    const c = CONSTANTS;
    const T = c.T0 + c.lapseRate * h;
    const p = c.p0 * Math.pow(T / c.T0, -c.g0 / (c.lapseRate * c.R));
    const rho = p / (c.R * T);
    const rho0 = c.p0 / (c.R * c.T0);
    const soundSpeed = Math.sqrt(c.gamma * c.R * T);
    return { T, p, rho, rho0, sigma: rho / rho0, soundSpeed, Vcap: c.machLimit * soundSpeed };
  }

  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const errors = [], warnings = [];
    const input = { caseId: typeof raw.caseId === 'string' && raw.caseId.trim() ? raw.caseId.trim() : 'Custom',
      mode: raw.mode, weightMode: raw.weightMode || 'weight', geometryMode: raw.geometryMode || 'ar',
      supplyMode: raw.supplyMode || 'altitude' };
    function read(key, label, min, max) {
      const v = finiteNumber(raw[key]);
      input[key] = v;
      if (!Number.isFinite(v)) errors.push(label + ': enter a finite number.');
      else if (v < min || v > max) errors.push(label + ': allowed range is ' + min + ' to ' + max + '.');
      return v;
    }
    if (!['propeller', 'jet'].includes(input.mode)) errors.push('Propulsion mode: select propeller or jet.');
    if (!['weight', 'mass'].includes(input.weightMode)) errors.push('Weight input mode: select weight or mass.');
    if (!['ar', 'span'].includes(input.geometryMode)) errors.push('Geometry input mode: select aspect ratio or span.');
    if (!['altitude', 'piston'].includes(input.supplyMode)) errors.push('Supply mode: select available at altitude or optional piston lapse.');
    if (input.mode === 'jet' && input.supplyMode === 'piston') errors.push('The optional piston density-lapse model is available only in propeller mode.');
    read('S', 'Wing area S (m²)', 0.1, 500);
    if (input.weightMode === 'mass') {
      read('m', 'Mass (kg)', 10 / CONSTANTS.g0, 2000000 / CONSTANTS.g0);
      input.W = input.m * CONSTANTS.g0;
    } else {
      read('W', 'Weight W (N)', 10, 2000000);
      input.m = input.W / CONSTANTS.g0;
    }
    if (input.geometryMode === 'span') {
      input.b = finiteNumber(raw.b);
      if (!Number.isFinite(input.b) || input.b <= 0) errors.push('Wing span b (m): enter a positive finite number.');
      input.AR = input.b * input.b / input.S;
      if (Number.isFinite(input.AR) && (input.AR < 2 || input.AR > 30)) errors.push('Wing span: derived aspect ratio must be between 2 and 30.');
    } else {
      read('AR', 'Aspect ratio AR', 2, 30);
      input.b = Math.sqrt(input.AR * input.S);
    }
    read('e', 'Oswald factor e', 0.3, 1);
    read('CD0', 'Zero-lift drag coefficient CD0', 0.005, 0.15);
    read('CLmax', 'Maximum lift coefficient CLmax', 0.5, 3);
    read('h', 'Geopotential altitude h (m)', 0, 11000);
    read('Vlo', 'Plot minimum speed (m/s)', 1, 250);
    read('Vhi', 'Plot maximum speed (m/s)', 1, 250);
    if (Number.isFinite(input.Vlo) && Number.isFinite(input.Vhi) && input.Vlo >= input.Vhi) {
      errors.push('Speed range: the plot minimum must be less than the plot maximum.');
    }
    read('Vop', 'Operating true airspeed (m/s)', 1, 250);
    read('supply', input.mode === 'jet' ? 'Available thrust (N)' : 'Useful available power (kW)', 0,
      input.mode === 'jet' ? 500000 : 20000);
    if (input.S < 1 || input.S > 150) warnings.push('Wing area is in the specification\'s unusual-value warning band.');
    if (input.W < 100 || input.W > 1000000) warnings.push('Weight is in the specification\'s unusual-value warning band.');
    if (input.AR < 4 || input.AR > 20) warnings.push('Aspect ratio is in the specification\'s unusual-value warning band.');
    if (input.e < 0.5) warnings.push('Oswald factor below 0.5: review the chosen configuration.');
    if (input.CD0 > 0.08) warnings.push('CD0 above 0.08: review the chosen high-drag configuration.');
    if (input.CLmax > 2.5) warnings.push('CLmax above 2.5: document the high-lift configuration.');
    if (input.supply === 0) warnings.push('Available propulsion is zero; no powered steady-level flight is predicted.');
    return { input, errors, warnings };
  }

  function stateAt(input, atmosphere, model, V) {
    const q = 0.5 * atmosphere.rho * V * V;
    const CL = input.W / (q * input.S);
    const CD = input.CD0 + model.K * CL * CL;
    const D0 = q * input.S * input.CD0;
    const Di = q * input.S * model.K * CL * CL;
    const TR = D0 + Di;
    const PR = TR * V;
    const PA = input.mode === 'propeller' ? model.availablePower : model.availableThrust * V;
    const TA = input.mode === 'jet' ? model.availableThrust : model.availablePower / V;
    const excessThrust = TA - TR, excessPower = PA - PR;
    const RC = excessPower / input.W, ratio = RC / V;
    const mach = V / atmosphere.soundSpeed;
    const eps = TOLERANCES.boundaryRelative;
    const belowStall = V < model.Vs * (1 - eps);
    const aboveMach = mach > CONSTANTS.machLimit * (1 + eps);
    const finite = [V, q, CL, CD, TR, PR, TA, PA, RC].every(Number.isFinite);
    const usable = finite && V >= CONSTANTS.minimumSpeed * (1 - eps) && !belowStall && !aboveMach;
    const levelFeasible = usable && excessPower >= -TOLERANCES.rootPower;
    const climbValid = usable && Math.abs(ratio) <= 1;
    const angleDeg = Math.abs(ratio) <= 1 ? Math.asin(ratio) * 180 / Math.PI : null;
    const flags = [];
    if (belowStall) flags.push('Below level-flight stall boundary');
    if (aboveMach) flags.push('Above Mach 0.30 model boundary');
    if (excessPower < -TOLERANCES.rootPower) flags.push('Insufficient propulsion at this speed');
    if (Math.abs(ratio) > 1) flags.push('Climb estimate outside kinematic applicability; angle unavailable');
    else if (Math.abs(ratio) > Math.sin(CONSTANTS.climbAngleWarningDeg * Math.PI / 180)) {
      flags.push('Estimated climb/descent angle exceeds the 10° accuracy screen');
    }
    if (!finite) flags.push('Nonfinite mathematical result');
    return { V, q, CL, CD, D0, Di, TR, PR, TA, PA, excessThrust, excessPower,
      powerDeficit: Math.max(PR - PA, 0), RC, mach, angleDeg, belowStall, aboveMach,
      usable, levelFeasible, climbValid, flags };
  }

  function bisect(fn, lo, hi, xtol, ftol, maxIterations) {
    let a = lo, b = hi, fa = fn(a), fb = fn(b);
    const fail = (reason, iterations, x, residual) => ({ converged: false, reason, iterations,
      speed: null, candidate: x, residual, bracket: [a, b] });
    if (![fa, fb].every(Number.isFinite)) return fail('Nonfinite bracket evaluation', 0, null, null);
    if (Math.abs(fa) <= ftol) return { converged: true, speed: a, residual: fa, iterations: 0, bracket: [a, a] };
    if (Math.abs(fb) <= ftol) return { converged: true, speed: b, residual: fb, iterations: 0, bracket: [b, b] };
    if (Math.sign(fa) === Math.sign(fb)) return fail('No sign-changing bracket', 0, null, null);
    let mid = null, fm = null;
    for (let n = 1; n <= maxIterations; n++) {
      mid = a + (b - a) / 2;
      fm = fn(mid);
      if (!Number.isFinite(fm)) return fail('Nonfinite midpoint evaluation', n, mid, fm);
      if (fm === 0) return { converged: true, speed: mid, residual: fm, iterations: n, bracket: [mid, mid] };
      if (b - a <= xtol && Math.abs(fm) <= ftol) {
        return { converged: true, speed: mid, residual: fm, iterations: n, bracket: [a, b] };
      }
      if (mid === a || mid === b) return fail('Representable arithmetic prevents further convergence', n, mid, fm);
      if (Math.sign(fa) === Math.sign(fm)) { a = mid; fa = fm; }
      else { b = mid; fb = fm; }
    }
    return fail('Numerical solver did not converge within the iteration limit', maxIterations, mid, fm);
  }

  function solveFlight(input, atmosphere, model, peakSpeed, unrestrictedPeakSpeed, maxIterations) {
    const lo = model.domain.lo, hi = model.domain.hi;
    const eps = TOLERANCES.rootPower;
    const F = v => stateAt(input, atmosphere, model, v).excessPower;
    const solver = { status: 'ok', roots: [], failures: [], tolerances: { ...TOLERANCES }, maxIterations };
    const sustainable = { exists: false, lo: null, hi: null, tangent: false, upperLimited: false };
    let maxSpeed = { value: null, status: 'no-solution', message: 'No supported steady-level-flight solution.' };
    if (model.domain.empty) { solver.status = 'no-domain'; return { solver, sustainable, maxSpeed }; }
    const flo = F(lo), fhi = F(hi), fp = F(peakSpeed);
    solver.peakSpeed = peakSpeed; solver.peakExcessPower = fp;
    if (fp < -eps) { solver.status = 'no-solution'; return { solver, sustainable, maxSpeed }; }
    sustainable.exists = true;
    function endpoint(v, kind) {
      const record = { speed: v, residual: F(v), iterations: 0, bracket: [v, v], kind, converged: true };
      const prior = solver.roots.find(r => Math.abs(r.speed - v) <= TOLERANCES.rootSpeed);
      if (!prior) solver.roots.push(record);
      return prior || record;
    }
    function findRoot(a, b, kind) {
      const r = bisect(F, a, b, TOLERANCES.rootSpeed, eps, maxIterations);
      r.kind = kind;
      if (r.converged) solver.roots.push(r);
      else { solver.failures.push(r); solver.status = 'failed'; }
      return r.converged ? r : null;
    }
    const stationaryInDomain = unrestrictedPeakSpeed >= lo && unrestrictedPeakSpeed <= hi;
    if (Math.abs(fp) <= eps) {
      const kind = stationaryInDomain ? 'tangent' : unrestrictedPeakSpeed < lo ? 'high' : 'low';
      endpoint(peakSpeed, kind);
      sustainable.lo = peakSpeed; sustainable.hi = peakSpeed;
      sustainable.tangent = kind === 'tangent';
      sustainable.upperLimited = kind === 'low';
      maxSpeed = kind === 'low'
        ? { value: null, status: 'outside-model', message: 'Vmax not determined within supported model; the high-speed crossing lies beyond the model boundary.' }
        : { value: peakSpeed, status: kind === 'tangent' ? 'tangent' : 'available', message: kind === 'tangent' ? 'Single limiting equilibrium (tangent); no finite sustainable speed band.' : 'Limiting equilibrium at the supported speed boundary.' };
      return { solver, sustainable, maxSpeed };
    }
    let lowRoot = null, highRoot = null;
    if (Math.abs(flo) <= eps) lowRoot = endpoint(lo, peakSpeed === lo ? 'high' : 'low');
    else if (flo < -eps && peakSpeed > lo) lowRoot = findRoot(lo, peakSpeed, 'low');
    if (Math.abs(fhi) <= eps) highRoot = endpoint(hi, peakSpeed === hi ? 'low' : 'high');
    else if (fhi < -eps && peakSpeed < hi) highRoot = findRoot(peakSpeed, hi, 'high');
    sustainable.lo = flo >= -eps ? lo : lowRoot ? lowRoot.speed : null;
    sustainable.hi = fhi >= -eps ? hi : highRoot ? highRoot.speed : null;
    sustainable.upperLimited = fhi > eps || (Math.abs(fhi) <= eps && unrestrictedPeakSpeed > hi);
    const high = solver.roots.find(r => r.kind === 'high' || r.kind === 'tangent');
    if (high) maxSpeed = { value: high.speed, status: 'available', message: 'High-speed equilibrium within the supported model.' };
    else if (solver.failures.some(r => r.kind === 'high')) {
      maxSpeed = { value: null, status: 'solver-failure', message: 'Numerical solver did not converge; maximum speed is unavailable.' };
    } else {
      maxSpeed = { value: null, status: 'outside-model', message: 'Vmax not determined within supported model; available propulsion remains sufficient at the upper model boundary.' };
    }
    solver.roots.sort((a, b) => a.speed - b.speed);
    return { solver, sustainable, maxSpeed };
  }

  function solveGlide(input, atmosphere, model, maxIterations) {
    const unrestrictedCL = Math.sqrt(input.CD0 / model.K);
    const unrestrictedLD = 1 / (2 * Math.sqrt(input.CD0 * model.K));
    const base = { ok: false, status: 'no-domain', CL: null, CD: null, LD: null, speed: null,
      angleDeg: null, sink: null, horizontalSpeed: null, lift: null, drag: null,
      unrestrictedCL, unrestrictedLD, constrained: false, flags: [], boundarySolves: [] };
    const coefficientScale = 2 * input.W / (atmosphere.rho * input.S);
    const speedAtCL = cl => Math.sqrt(coefficientScale / Math.hypot(cl, input.CD0 + model.K * cl * cl));
    const atZero = speedAtCL(0), atMax = speedAtCL(input.CLmax);
    const speedMin = CONSTANTS.minimumSpeed, speedMax = atmosphere.Vcap;
    if (atZero <= speedMin || atMax > speedMax * (1 + TOLERANCES.boundaryRelative)) {
      base.flags.push('No glide condition satisfies the lift-coefficient and speed limits.');
      return base;
    }
    let clLo = 0, clHi = input.CLmax;
    function boundary(target) {
      const r = bisect(cl => speedAtCL(cl) - target, 0, input.CLmax,
        TOLERANCES.glideCoefficient, TOLERANCES.glideSpeed, maxIterations);
      base.boundarySolves.push({ ...r, targetSpeed: target, coefficient: r.speed });
      return r;
    }
    if (atZero > speedMax) {
      const r = boundary(speedMax);
      if (!r.converged) { base.status = 'solver-failure'; base.flags.push('Numerical solver did not converge for the glide upper-speed boundary.'); return base; }
      clLo = r.speed;
    }
    if (atMax < speedMin) {
      const r = boundary(speedMin);
      if (!r.converged) { base.status = 'solver-failure'; base.flags.push('Numerical solver did not converge for the glide lower-speed boundary.'); return base; }
      clHi = r.speed;
    }
    if (!(clHi > 0) || clLo > clHi + TOLERANCES.glideCoefficient) {
      base.flags.push('No glide condition satisfies the lift-coefficient and speed limits.'); return base;
    }
    const CL = clamp(unrestrictedCL, clLo, clHi);
    const CD = input.CD0 + model.K * CL * CL;
    const angle = Math.atan2(CD, CL), speed = speedAtCL(CL);
    const constrained = Math.abs(CL - unrestrictedCL) > TOLERANCES.boundaryRelative * Math.max(1, unrestrictedCL);
    const flags = constrained ? ['Best glide is constrained by the supported lift-coefficient or speed limits.'] : [];
    return { ...base, ok: true, status: constrained ? 'constrained' : 'available', CL, CD,
      LD: CL / CD, speed, angleDeg: angle * 180 / Math.PI, sink: speed * Math.sin(angle),
      horizontalSpeed: speed * Math.cos(angle), lift: input.W * Math.cos(angle),
      drag: input.W * Math.sin(angle), constrained, flags, coefficientDomain: { lo: clLo, hi: clHi } };
  }

  function calculate(raw, options) {
    options = options || {};
    const normalized = normalize(raw);
    const { input, errors, warnings } = normalized;
    const result = { ok: false, errors, warnings, input, atmosphere: null, model: null,
      operating: null, summary: null, curves: [], solver: null, version: VERSION };
    if (errors.length) return result;
    const atmosphere = atmosphereAt(input.h);
    result.atmosphere = atmosphere;
    if (![atmosphere.T, atmosphere.p, atmosphere.rho, atmosphere.soundSpeed].every(v => Number.isFinite(v) && v > 0)) {
      errors.push('Atmosphere model-computation error: density and other atmospheric quantities must be positive and finite.'); return result;
    }
    if (input.Vop > atmosphere.Vcap * (1 + TOLERANCES.boundaryRelative)) {
      errors.push('Operating true airspeed: allowed range at this altitude is 1 to ' + atmosphere.Vcap.toFixed(6) + ' m/s (Mach 0.30).'); return result;
    }
    const K = 1 / (Math.PI * input.e * input.AR);
    const A = 0.5 * atmosphere.rho * input.S * input.CD0;
    const B = 2 * K * input.W * input.W / (atmosphere.rho * input.S);
    const Vs = Math.sqrt(2 * input.W / (atmosphere.rho * input.S * input.CLmax));
    const lo = Math.max(CONSTANTS.minimumSpeed, Vs), hi = atmosphere.Vcap;
    const availablePower = input.mode === 'propeller'
      ? input.supply * 1000 * (input.supplyMode === 'piston' ? atmosphere.sigma : 1) : null;
    const availableThrust = input.mode === 'jet' ? input.supply : null;
    const model = { K, A, B, Vs, domain: { lo, hi, empty: lo > hi }, availablePower, availableThrust,
      atmosphereName: '1976 U.S. Standard Atmosphere troposphere', altitudeConvention: 'geopotential',
      propulsionInterpretation: input.mode === 'propeller' ? 'constant useful propulsive power' : 'constant available thrust',
      machLimit: CONSTANTS.machLimit, assumptionsVersion: 'Student 1 Theory and PRD v3.0' };
    result.model = model;
    if (!model.domain.empty && (input.Vhi < lo || input.Vlo > hi)) {
      errors.push('Plot speed range has no overlap with the supported unstalled interval (' + lo.toFixed(3) + ' to ' + hi.toFixed(3) + ' m/s). Change the plotting window; this is not proof of no physical solution.');
      return result;
    }
    const maxIterations = Number.isInteger(options.maxIterations) && options.maxIterations >= 0
      ? Math.min(200, options.maxIterations) : 200;
    const samples = Number.isInteger(options.samples) ? clamp(options.samples, 501, 10001) : 501;
    const uMinT = Math.pow(B / A, 0.25), uMinP = Math.pow(B / (3 * A), 0.25);
    const uPeak = input.mode === 'propeller' ? uMinP
      : Math.sqrt((availableThrust + Math.sqrt(availableThrust * availableThrust + 12 * A * B)) / (6 * A));
    function minimum(theoreticalSpeed, key, theoreticalValue) {
      const speed = model.domain.empty ? null : clamp(theoreticalSpeed, lo, hi);
      const point = speed === null ? null : stateAt(input, atmosphere, model, speed);
      return { speed, value: point ? point[key] : null, unrestrictedSpeed: theoreticalSpeed,
        unrestrictedValue: theoreticalValue, constrained: speed !== null && Math.abs(speed - theoreticalSpeed) > 1e-8 * Math.max(1, theoreticalSpeed),
        propulsionSufficient: point ? point.levelFeasible : false };
    }
    const minThrust = minimum(uMinT, 'TR', 2 * Math.sqrt(A * B));
    const minPower = minimum(uMinP, 'PR', 4 * A * uMinP * uMinP * uMinP);
    const peakSpeed = model.domain.empty ? null : clamp(uPeak, lo, hi);
    const peak = peakSpeed === null ? null : stateAt(input, atmosphere, model, peakSpeed);
    const flight = solveFlight(input, atmosphere, model, peakSpeed, uPeak, maxIterations);
    const glide = solveGlide(input, atmosphere, model, maxIterations);
    const summary = { stallSpeed: Vs, minThrust, minPower,
      maxLevelLD: { value: minThrust.value === null ? null : input.W / minThrust.value,
        speed: minThrust.speed, propulsionSufficient: minThrust.propulsionSufficient,
        unrestrictedValue: 1 / (2 * Math.sqrt(K * input.CD0)) },
      maxExcessPower: { speed: peakSpeed, value: peak ? peak.excessPower : null, RC: peak ? peak.RC : null,
        angleDeg: peak ? peak.angleDeg : null, flags: peak ? peak.flags.slice() : ['No supported unstalled domain'],
        climbValid: peak ? peak.climbValid : false },
      maxRC: peak ? peak.RC : null, bestClimbSpeed: peakSpeed,
      maxSpeed: flight.maxSpeed, sustainable: flight.sustainable, glide };
    result.summary = summary;
    result.solver = flight.solver;
    result.solver.glide = { status: glide.status, boundarySolves: glide.boundarySolves };
    result.operating = stateAt(input, atmosphere, model, input.Vop);
    for (let i = 0; i < samples; i++) {
      const V = i === samples - 1 ? input.Vhi : input.Vlo + (input.Vhi - input.Vlo) * i / (samples - 1);
      result.curves.push(stateAt(input, atmosphere, model, V));
    }
    if (input.Vlo < Vs) warnings.push('The plotting window includes below-stall mathematical values; these are excluded from usable level-flight results.');
    if (input.Vhi > atmosphere.Vcap) warnings.push('The plotting window extends beyond Mach 0.30; those values are mathematical extensions outside the supported model.');
    if (model.domain.empty) warnings.push('No supported unstalled domain: the level-flight stall boundary exceeds the model speed cap.');
    if (!flight.sustainable.exists) warnings.push('No supported steady-level-flight solution.');
    if (flight.maxSpeed.status === 'outside-model') warnings.push(flight.maxSpeed.message);
    if (flight.solver.failures.length) warnings.push('Numerical solver did not converge; affected intersections are unavailable.');
    if (!glide.ok) warnings.push(glide.flags.join(' '));
    if (minThrust.constrained) warnings.push('Minimum thrust is constrained to the supported speed interval.');
    if (minPower.constrained) warnings.push('Minimum power is constrained to the supported speed interval.');
    if (peak && !peak.climbValid) warnings.push('The maximum excess-power estimate is outside climb kinematic applicability; do not interpret it as achievable climb.');
    else if (peak && Math.abs(peak.RC / peak.V) > Math.sin(CONSTANTS.climbAngleWarningDeg * Math.PI / 180)) {
      warnings.push('The maximum climb/descent estimate exceeds the 10° accuracy screen.');
    }
    for (const f of result.operating.flags) warnings.push('Operating point: ' + f + '.');
    const characteristics = [['Minimum-thrust speed', minThrust.speed], ['Minimum-power speed', minPower.speed],
      ['Maximum excess-power speed', peakSpeed], ['Maximum speed', flight.maxSpeed.value],
      ['Best-glide speed', glide.speed]];
    for (const [label, speed] of characteristics) {
      if (Number.isFinite(speed) && (speed < input.Vlo || speed > input.Vhi)) {
        warnings.push(label + ' is outside the plotting window; its value is calculated over the full supported model domain.');
      }
    }
    result.warnings = Array.from(new Set(warnings.filter(Boolean)));
    result.ok = true;
    return result;
  }

  return Object.freeze({ VERSION, CONSTANTS, TOLERANCES, PRESETS, calculate, atmosphereAt, stateAt });
});
