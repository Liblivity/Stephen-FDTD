"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const NX = 180;
const NY = 120;
const PML = 12;
const CFL_SAFETY = 0.96;

type Point = { x: number; y: number; index: number };

type Params = {
  wavelength: number;
  sourceMode: "continuous" | "pulse";
  refractiveIndex: number;
  pillarWidth: number;
  pillarLength: number;
  amplitude: number;
  stepsPerFrame: number;
  windowWidth: number;
  windowHeight: number;
  pillarX: number;
  pillarY: number;
  pillarAngle: number;
  pillarCount: number;
  pillarPitch: number;
  arrayAngle: number;
  sourceX: number;
  sourceY: number;
  sourceAngle: number;
  monitorX: number;
  monitorY: number;
  monitorAngle: number;
};

type Engine = {
  ez: Float32Array;
  hx: Float32Array;
  hy: Float32Array;
  epsilon: Float32Array;
  damping: Float32Array;
  image: ImageData;
  monitorRe: Float64Array;
  monitorIm: Float64Array;
  monitorSamples: number;
  pulseStartStep: number | null;
  step: number;
  periodSteps: number;
  dxNm: number;
  dyNm: number;
  dtNmC: number;
  coefficientX: number;
  coefficientY: number;
  pillarPolygons: Point[][];
  sourcePoints: Point[];
  monitorPoints: Point[];
};

const defaults: Params = {
  wavelength: 850,
  sourceMode: "continuous",
  refractiveIndex: 2,
  pillarWidth: 300,
  pillarLength: 700,
  amplitude: 0.65,
  stepsPerFrame: 3,
  windowWidth: 7.65,
  windowHeight: 5.1,
  pillarX: 4.13,
  pillarY: 2.55,
  pillarAngle: 0,
  pillarCount: 1,
  pillarPitch: 600,
  arrayAngle: 90,
  sourceX: 0.92,
  sourceY: 2.55,
  sourceAngle: 0,
  monitorX: 5.81,
  monitorY: 2.55,
  monitorAngle: 0,
};

function buildLinePoints(
  centerXNm: number,
  centerYNm: number,
  normalAngleDegrees: number,
  widthNm: number,
  heightNm: number,
  dxNm: number,
  dyNm: number,
): Point[] {
  const angle = (normalAngleDegrees * Math.PI) / 180;
  const tangentX = -Math.sin(angle);
  const tangentY = Math.cos(angle);
  const halfSpan = Math.hypot(widthNm, heightNm) * 0.55;
  const points: Point[] = [];
  const seen = new Set<number>();
  const samples = Math.max(NX, NY) * 3;
  for (let sample = 0; sample <= samples; sample++) {
    const distance = -halfSpan + (2 * halfSpan * sample) / samples;
    const x = Math.round((centerXNm + tangentX * distance) / dxNm);
    const y = Math.round((centerYNm + tangentY * distance) / dyNm);
    if (x < PML || x >= NX - PML || y < PML || y >= NY - PML) continue;
    const index = x + y * NX;
    if (!seen.has(index)) {
      points.push({ x, y, index });
      seen.add(index);
    }
  }
  return points;
}

function createEngine(params: Params): Engine {
  const size = NX * NY;
  const widthNm = params.windowWidth * 1000;
  const heightNm = params.windowHeight * 1000;
  const dxNm = widthNm / NX;
  const dyNm = heightNm / NY;
  const dtNmC = CFL_SAFETY / Math.sqrt(dxNm ** -2 + dyNm ** -2);
  const coefficientX = dtNmC / dxNm;
  const coefficientY = dtNmC / dyNm;
  const epsilon = new Float32Array(size).fill(1);
  const damping = new Float32Array(size).fill(1);
  const arrayCenterX = params.pillarX * 1000;
  const arrayCenterY = params.pillarY * 1000;
  const pillarAngle = (params.pillarAngle * Math.PI) / 180;
  const cosPillar = Math.cos(pillarAngle);
  const sinPillar = Math.sin(pillarAngle);
  const arrayAngle = (params.arrayAngle * Math.PI) / 180;
  const pillarCenters = Array.from({ length: params.pillarCount }, (_, index) => {
    const offset = (index - (params.pillarCount - 1) / 2) * params.pillarPitch;
    return {
      x: arrayCenterX + Math.cos(arrayAngle) * offset,
      y: arrayCenterY + Math.sin(arrayAngle) * offset,
    };
  });

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = x + y * NX;
      const insidePillar = pillarCenters.some((center) => {
        const relativeX = (x + 0.5) * dxNm - center.x;
        const relativeY = (y + 0.5) * dyNm - center.y;
        const localX = cosPillar * relativeX + sinPillar * relativeY;
        const localY = -sinPillar * relativeX + cosPillar * relativeY;
        return Math.abs(localX) <= params.pillarLength / 2 && Math.abs(localY) <= params.pillarWidth / 2;
      });
      if (insidePillar) {
        epsilon[i] = params.refractiveIndex ** 2;
      }
      const edge = Math.min(x, y, NX - 1 - x, NY - 1 - y);
      if (edge < PML) {
        const depth = (PML - edge) / PML;
        damping[i] = Math.exp(-0.22 * depth ** 3);
      }
    }
  }

  const pillarPolygons = pillarCenters.map((center) => [
      [-params.pillarLength / 2, -params.pillarWidth / 2],
      [params.pillarLength / 2, -params.pillarWidth / 2],
      [params.pillarLength / 2, params.pillarWidth / 2],
      [-params.pillarLength / 2, params.pillarWidth / 2],
    ].map(([localX, localY]) => {
      const physicalX = center.x + cosPillar * localX - sinPillar * localY;
      const physicalY = center.y + sinPillar * localX + cosPillar * localY;
      const x = physicalX / dxNm;
      const y = physicalY / dyNm;
      return { x, y, index: Math.round(x) + Math.round(y) * NX };
    }));
  const sourcePoints = buildLinePoints(
    params.sourceX * 1000,
    params.sourceY * 1000,
    params.sourceAngle,
    widthNm,
    heightNm,
    dxNm,
    dyNm,
  );
  const monitorPoints = buildLinePoints(
    params.monitorX * 1000,
    params.monitorY * 1000,
    params.monitorAngle,
    widthNm,
    heightNm,
    dxNm,
    dyNm,
  );

  return {
    ez: new Float32Array(size),
    hx: new Float32Array(size),
    hy: new Float32Array(size),
    epsilon,
    damping,
    image: new ImageData(NX, NY),
    monitorRe: new Float64Array(monitorPoints.length),
    monitorIm: new Float64Array(monitorPoints.length),
    monitorSamples: 0,
    pulseStartStep: null,
    step: 0,
    periodSteps: params.wavelength / dtNmC,
    dxNm,
    dyNm,
    dtNmC,
    coefficientX,
    coefficientY,
    pillarPolygons,
    sourcePoints,
    monitorPoints,
  };
}

function advance(engine: Engine, params: Params) {
  const { ez, hx, hy, epsilon, damping, coefficientX, coefficientY } = engine;
  for (let y = 0; y < NY - 1; y++) {
    for (let x = 0; x < NX; x++) {
      const i = x + y * NX;
      hx[i] = (hx[i] - coefficientY * (ez[i + NX] - ez[i])) * damping[i];
    }
  }
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX - 1; x++) {
      const i = x + y * NX;
      hy[i] = (hy[i] + coefficientX * (ez[i + 1] - ez[i])) * damping[i];
    }
  }
  for (let y = 1; y < NY - 1; y++) {
    for (let x = 1; x < NX - 1; x++) {
      const i = x + y * NX;
      const curlX = coefficientX * (hy[i] - hy[i - 1]);
      const curlY = coefficientY * (hx[i] - hx[i - NX]);
      ez[i] = (ez[i] + (curlX - curlY) / epsilon[i]) * damping[i];
    }
  }

  let source = 0;
  if (params.sourceMode === "continuous") {
    const ramp = 1 - Math.exp(-((engine.step / (engine.periodSteps * 3)) ** 2));
    source = params.amplitude * ramp * Math.sin((2 * Math.PI * engine.step) / engine.periodSteps);
  } else if (engine.pulseStartStep !== null) {
    const elapsed = engine.step - engine.pulseStartStep;
    const center = engine.periodSteps * 4;
    const spread = engine.periodSteps * 1.25;
    const envelope = Math.exp(-(((elapsed - center) / spread) ** 2));
    source = params.amplitude * envelope * Math.sin((2 * Math.PI * elapsed) / engine.periodSteps);
    if (elapsed > center + 5 * spread) engine.pulseStartStep = null;
  }
  engine.sourcePoints.forEach((point) => { ez[point.index] += source; });

  // Frequency-domain monitor: accumulate Ez * exp(-i omega t) after transients.
  if (engine.step > engine.periodSteps * 7) {
    const angle = (2 * Math.PI * engine.step) / engine.periodSteps;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    engine.monitorPoints.forEach((point, index) => {
      const value = ez[point.index];
      engine.monitorRe[index] += value * cosine;
      engine.monitorIm[index] -= value * sine;
    });
    engine.monitorSamples += 1;
  }
  engine.step += 1;
}

function fieldColor(value: number): [number, number, number] {
  const v = Math.max(-1, Math.min(1, value));
  if (v < 0) {
    const t = v + 1;
    return [Math.round(20 + 225 * t), Math.round(78 + 167 * t), Math.round(138 + 117 * t)];
  }
  return [Math.round(245 - 119 * v), Math.round(245 - 220 * v), Math.round(245 - 138 * v)];
}

function render(engine: Engine, canvas: HTMLCanvasElement) {
  const data = engine.image.data;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const sourceIndex = x + y * NX;
      const target = (x + (NY - 1 - y) * NX) * 4;
      const [r, g, b] = fieldColor(engine.ez[sourceIndex]);
      data[target] = r;
      data[target + 1] = g;
      data[target + 2] = b;
      data[target + 3] = 255;
    }
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.putImageData(engine.image, 0, 0);

  context.strokeStyle = "#07111f";
  context.lineWidth = 1.2;
  context.beginPath();
  engine.pillarPolygons.forEach((polygon) => {
    context.beginPath();
    polygon.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, NY - point.y);
      else context.lineTo(point.x, NY - point.y);
    });
    context.closePath();
    context.stroke();
  });
  context.strokeStyle = "#5df2c2";
  context.lineWidth = 0.8;
  context.beginPath();
  const sourceStart = engine.sourcePoints[0];
  const sourceEnd = engine.sourcePoints.at(-1);
  if (sourceStart && sourceEnd) {
    context.moveTo(sourceStart.x, NY - sourceStart.y);
    context.lineTo(sourceEnd.x, NY - sourceEnd.y);
  }
  context.stroke();
  context.save();
  context.strokeStyle = "#f2a93b";
  context.lineWidth = 0.8;
  context.setLineDash([2, 2]);
  context.beginPath();
  const monitorStart = engine.monitorPoints[0];
  const monitorEnd = engine.monitorPoints.at(-1);
  if (monitorStart && monitorEnd) {
    context.moveTo(monitorStart.x, NY - monitorStart.y);
    context.lineTo(monitorEnd.x, NY - monitorEnd.y);
  }
  context.stroke();
  context.restore();
}

function drawProfile(
  canvas: HTMLCanvasElement,
  values: number[],
  minimum: number,
  maximum: number,
  color: string,
  emptyMessage: string,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const left = 42;
  const right = 14;
  const top = 15;
  const bottom = 28;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbfaf6";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#d9d7d0";
  context.lineWidth = 1;
  context.font = "10px ui-monospace, monospace";
  context.fillStyle = "#77808a";
  context.textAlign = "right";
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + ((height - top - bottom) * tick) / 4;
    const value = maximum - ((maximum - minimum) * tick) / 4;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    context.fillText(value.toFixed(maximum <= 1.01 ? 2 : 1), left - 7, y + 3);
  }
  context.strokeStyle = "#7c817f";
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, height - bottom);
  context.lineTo(width - right, height - bottom);
  context.stroke();
  context.textAlign = "center";
  context.fillText("position along monitor", (left + width - right) / 2, height - 8);

  if (!values.length) {
    context.fillStyle = "#8b918f";
    context.font = "12px ui-sans-serif, system-ui";
    context.fillText(emptyMessage, (left + width - right) / 2, height / 2 + 3);
    return;
  }

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  let drawing = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = left + ((width - left - right) * index) / Math.max(1, values.length - 1);
    const y = top + (height - top - bottom) * (1 - (value - minimum) / (maximum - minimum));
    if (!drawing) context.moveTo(x, y);
    else context.lineTo(x, y);
    drawing = true;
  });
  context.stroke();
}

function renderProfiles(engine: Engine, intensityCanvas: HTMLCanvasElement, phaseCanvas: HTMLCanvasElement) {
  if (engine.monitorSamples < 10) {
    const wait = `Collecting after ${Math.ceil(engine.periodSteps * 7)} steps`;
    drawProfile(intensityCanvas, [], 0, 1, "#19785e", wait);
    drawProfile(phaseCanvas, [], -Math.PI, Math.PI, "#b2233a", wait);
    return;
  }
  const intensity: number[] = [];
  const phase: number[] = [];
  let peak = 0;
  for (let index = 0; index < engine.monitorPoints.length; index++) {
    const re = engine.monitorRe[index] / engine.monitorSamples;
    const im = engine.monitorIm[index] / engine.monitorSamples;
    const value = re * re + im * im;
    intensity.push(value);
    peak = Math.max(peak, value);
  }
  const scale = peak || 1;
  for (let index = 0; index < intensity.length; index++) {
    intensity[index] /= scale;
    phase.push(intensity[index] < 0.01 ? Number.NaN : Math.atan2(engine.monitorIm[index], engine.monitorRe[index]));
  }
  drawProfile(intensityCanvas, intensity, 0, 1, "#19785e", "Collecting field samples");
  drawProfile(phaseCanvas, phase, -Math.PI, Math.PI, "#b2233a", "Collecting field samples");
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control">
      <span className="control-label">
        <span>{label}</span>
        <output>{value}{unit}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="range-labels"><span>{min}{unit}</span><span>{max}{unit}</span></span>
    </label>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<HTMLCanvasElement>(null);
  const paramsRef = useRef(defaults);
  const engineRef = useRef<Engine>(createEngine(defaults));
  const runningRef = useRef(true);
  const [params, setParams] = useState(defaults);
  const [running, setRunning] = useState(true);
  const [displayStep, setDisplayStep] = useState(0);

  const reset = useCallback((next = paramsRef.current) => {
    engineRef.current = createEngine(next);
    setDisplayStep(0);
    if (canvasRef.current) render(engineRef.current, canvasRef.current);
    if (intensityRef.current && phaseRef.current) renderProfiles(engineRef.current, intensityRef.current, phaseRef.current);
  }, []);

  const changeParam = (key: keyof Params, value: number, resetField = true) => {
    const next = { ...paramsRef.current, [key]: value };
    if (key === "windowWidth") {
      const margin = value * PML / NX;
      (["pillarX", "sourceX", "monitorX"] as const).forEach((positionKey) => {
        next[positionKey] = Number(Math.min(value - margin, Math.max(margin, next[positionKey])).toFixed(2));
      });
    }
    if (key === "windowHeight") {
      const margin = value * PML / NY;
      (["pillarY", "sourceY", "monitorY"] as const).forEach((positionKey) => {
        next[positionKey] = Number(Math.min(value - margin, Math.max(margin, next[positionKey])).toFixed(2));
      });
    }
    paramsRef.current = next;
    setParams(next);
    if (resetField) reset(next);
  };

  const singleStep = () => {
    const engine = engineRef.current;
    advance(engine, paramsRef.current);
    if (canvasRef.current) render(engine, canvasRef.current);
    if (intensityRef.current && phaseRef.current) renderProfiles(engine, intensityRef.current, phaseRef.current);
    setDisplayStep(engine.step);
  };

  const selectSourceMode = (sourceMode: Params["sourceMode"]) => {
    const next = { ...paramsRef.current, sourceMode };
    paramsRef.current = next;
    setParams(next);
    reset(next);
  };

  const firePulse = () => {
    let next = paramsRef.current;
    if (next.sourceMode !== "pulse") {
      next = { ...next, sourceMode: "pulse" };
      paramsRef.current = next;
      setParams(next);
      reset(next);
    }
    engineRef.current.pulseStartStep = engineRef.current.step;
  };

  useEffect(() => {
    let animationId = 0;
    let lastUiUpdate = 0;
    const loop = (time: number) => {
      const engine = engineRef.current;
      if (runningRef.current) {
        for (let i = 0; i < paramsRef.current.stepsPerFrame; i++) {
          advance(engine, paramsRef.current);
        }
        if (canvasRef.current) render(engine, canvasRef.current);
        if (time - lastUiUpdate > 120) {
          setDisplayStep(engine.step);
          if (intensityRef.current && phaseRef.current) renderProfiles(engine, intensityRef.current, phaseRef.current);
          lastUiUpdate = time;
        }
      }
      animationId = requestAnimationFrame(loop);
    };
    if (canvasRef.current) render(engineRef.current, canvasRef.current);
    if (intensityRef.current && phaseRef.current) renderProfiles(engineRef.current, intensityRef.current, phaseRef.current);
    animationId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationId);
  }, []);

  const toggleRunning = () => {
    const next = !runningRef.current;
    runningRef.current = next;
    setRunning(next);
  };

  const engine = engineRef.current;
  const timeFs = displayStep * engine.dtNmC / 299.792458;
  const cellsPerWavelength = params.wavelength / Math.max(engine.dxNm, engine.dyNm);
  const xMargin = Number((params.windowWidth * PML / NX).toFixed(2));
  const yMargin = Number((params.windowHeight * PML / NY).toFixed(2));
  const xMaximum = Number((params.windowWidth - xMargin).toFixed(2));
  const yMaximum = Number((params.windowHeight - yMargin).toFixed(2));

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
        <div>
          <p className="eyebrow">Computational photonics lab</p>
          <h1>Wavefront Studio</h1>
        </div>
        <div className="status"><span /> Browser simulation</div>
      </header>

      <section className="intro">
        <div>
          <p className="kicker">2D · TM<sub>z</sub> · FDTD</p>
          <h2>Build a nanopillar array<br />and shape the wave.</h2>
        </div>
        <p className="lede">Adjust the structure and source in real time. The field is recomputed on a Yee grid directly in your browser.</p>
      </section>

      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="panel-heading">
            <div><span className="section-number">01</span><h3>Field &amp; material</h3></div>
            <button className="text-button" onClick={() => { paramsRef.current = defaults; setParams(defaults); reset(defaults); }}>Defaults</button>
          </div>
          <p className="coordinate-help">x/y coordinates are measured from the lower-left corner.</p>
          <div className="control-group">
            <p className="group-label">Incident wave</p>
            <div className="source-mode" role="group" aria-label="Source waveform">
              <button className={params.sourceMode === "continuous" ? "active" : ""} onClick={() => selectSourceMode("continuous")}>Continuous</button>
              <button className={params.sourceMode === "pulse" ? "active" : ""} onClick={() => selectSourceMode("pulse")}>Single pulse</button>
            </div>
            <button className="fire-pulse" onClick={firePulse} disabled={params.sourceMode !== "pulse"}>Fire pulse</button>
            <Slider label="Wavelength" value={params.wavelength} min={500} max={1200} step={10} unit=" nm" onChange={(v) => changeParam("wavelength", v)} />
            <Slider label="Source amplitude" value={params.amplitude} min={0.1} max={1} step={0.05} unit="" onChange={(v) => changeParam("amplitude", v, false)} />
          </div>
          <div className="control-group">
            <p className="group-label">Simulation window</p>
            <Slider label="Window width" value={params.windowWidth} min={5} max={18} step={0.25} unit=" µm" onChange={(v) => changeParam("windowWidth", v)} />
            <Slider label="Window height" value={params.windowHeight} min={3} max={12} step={0.25} unit=" µm" onChange={(v) => changeParam("windowHeight", v)} />
          </div>
          <div className="control-group">
            <p className="group-label">Pillar geometry</p>
            <Slider label="Refractive index" value={params.refractiveIndex} min={1} max={4} step={0.1} unit="" onChange={(v) => changeParam("refractiveIndex", v)} />
            <Slider label="Width" value={params.pillarWidth} min={100} max={800} step={25} unit=" nm" onChange={(v) => changeParam("pillarWidth", v)} />
            <Slider label="Length" value={params.pillarLength} min={200} max={1600} step={50} unit=" nm" onChange={(v) => changeParam("pillarLength", v)} />
            <Slider label="Array center x" value={params.pillarX} min={xMargin} max={xMaximum} step={0.05} unit=" µm" onChange={(v) => changeParam("pillarX", v)} />
            <Slider label="Array center y" value={params.pillarY} min={yMargin} max={yMaximum} step={0.05} unit=" µm" onChange={(v) => changeParam("pillarY", v)} />
            <Slider label="Pillar orientation" value={params.pillarAngle} min={-90} max={90} step={5} unit="°" onChange={(v) => changeParam("pillarAngle", v)} />
          </div>
        </aside>

        <section className="panel viewer-panel">
          <div className="viewer-head">
            <div>
              <span className="section-number">02</span>
              <h3>Electric field <em>E<sub>z</sub></em></h3>
            </div>
            <div className="legend"><span className="negative" /> −1 <span className="gradient" /> +1</div>
          </div>
          <div className="canvas-wrap">
            <canvas
              className="field-canvas"
              ref={canvasRef}
              width={NX}
              height={NY}
              style={{ aspectRatio: `${params.windowWidth} / ${params.windowHeight}` }}
              aria-label="Animated electric field simulation"
            />
            <span className="axis axis-y">y</span><span className="axis axis-x">x</span>
            <span className="scale-label scale-origin">0</span>
            <span className="scale-label scale-x-max">{params.windowWidth} µm</span>
            <span className="scale-label scale-y-max">{params.windowHeight} µm</span>
          </div>
          <div className="transport">
            <div className="buttons">
              <button className="primary-button" onClick={toggleRunning}>{running ? "Ⅱ  Pause" : "▶  Run"}</button>
              <button onClick={singleStep} disabled={running}>Step</button>
              <button onClick={() => reset()}>Reset field</button>
            </div>
            <div className="readout"><span>Step <strong>{displayStep.toLocaleString()}</strong></span><span>Time <strong>{timeFs.toFixed(2)} fs</strong></span></div>
          </div>
        </section>

        <aside className="panel placement-panel">
          <div className="panel-heading">
            <div><span className="section-number">03</span><h3>Placement</h3></div>
          </div>
          <p className="coordinate-help">Source and monitor centers use the same µm coordinate system.</p>
          <div className="control-group">
            <p className="group-label">Pillar array</p>
            <Slider label="Pillar count" value={params.pillarCount} min={1} max={12} step={1} unit="" onChange={(v) => changeParam("pillarCount", v)} />
            <Slider label="Center-to-center pitch" value={params.pillarPitch} min={200} max={1600} step={25} unit=" nm" onChange={(v) => changeParam("pillarPitch", v)} />
            <Slider label="Array-axis angle" value={params.arrayAngle} min={-90} max={90} step={5} unit="°" onChange={(v) => changeParam("arrayAngle", v)} />
            <p className="coordinate-help">First-to-last center span: {((Math.max(0, params.pillarCount - 1) * params.pillarPitch) / 1000).toFixed(2)} µm</p>
          </div>
          <div className="control-group">
            <p className="group-label"><span className="geometry-dot source-dot" />Source geometry</p>
            <Slider label="Center x" value={params.sourceX} min={xMargin} max={xMaximum} step={0.05} unit=" µm" onChange={(v) => changeParam("sourceX", v)} />
            <Slider label="Center y" value={params.sourceY} min={yMargin} max={yMaximum} step={0.05} unit=" µm" onChange={(v) => changeParam("sourceY", v)} />
            <Slider label="Propagation angle" value={params.sourceAngle} min={-75} max={75} step={5} unit="°" onChange={(v) => changeParam("sourceAngle", v)} />
          </div>
          <div className="control-group">
            <p className="group-label"><span className="geometry-dot monitor-dot" />Monitor geometry</p>
            <Slider label="Center x" value={params.monitorX} min={xMargin} max={xMaximum} step={0.05} unit=" µm" onChange={(v) => changeParam("monitorX", v)} />
            <Slider label="Center y" value={params.monitorY} min={yMargin} max={yMaximum} step={0.05} unit=" µm" onChange={(v) => changeParam("monitorY", v)} />
            <Slider label="Normal angle" value={params.monitorAngle} min={-90} max={90} step={5} unit="°" onChange={(v) => changeParam("monitorAngle", v)} />
          </div>
          <div className="control-group last">
            <p className="group-label">Playback</p>
            <Slider label="Steps per frame" value={params.stepsPerFrame} min={1} max={8} step={1} unit="×" onChange={(v) => changeParam("stepsPerFrame", v, false)} />
          </div>
        </aside>
      </section>

      <section className="panel analysis-panel">
        <div className="analysis-head">
          <div><span className="section-number">04</span><h3>Frequency-domain monitor</h3></div>
          <p>Monitor center: ({params.monitorX} µm, {params.monitorY} µm) · normal {params.monitorAngle}°</p>
        </div>
        <div className="charts-grid">
          <article className="chart-card">
            <div><div><span className="chart-dot intensity-dot" /><h4>Intensity distribution</h4></div><code>|Ẽ<sub>z</sub>|² / max</code></div>
            <canvas ref={intensityRef} width={520} height={205} aria-label="Normalized intensity distribution across the monitor plane" />
          </article>
          <article className="chart-card">
            <div><div><span className="chart-dot phase-dot" /><h4>Phase distribution</h4></div><code>arg(Ẽ<sub>z</sub>) [rad]</code></div>
            <canvas ref={phaseRef} width={520} height={205} aria-label="Wrapped phase distribution across the monitor plane" />
          </article>
        </div>
        <p className="analysis-note">The monitor extracts the 850 nm complex component using Ẽ<sub>z</sub>(y) = Σ E<sub>z</sub>(y,t) e<sup>−iωt</sup>. Phase is hidden where intensity is below 1% of the peak.</p>
      </section>

      <section className="metrics">
        <article><span>Grid</span><strong>{NX} × {NY}</strong><small>Yee cells</small></article>
        <article><span>Cell size</span><strong>{engine.dxNm.toFixed(1)} × {engine.dyNm.toFixed(1)} nm</strong><small>{cellsPerWavelength.toFixed(1)} cells / λ minimum</small></article>
        <article><span>Boundary</span><strong>{PML} cells</strong><small>graded absorber</small></article>
        <article><span>Polarization</span><strong>TM<sub>z</sub></strong><small>E<sub>z</sub>, H<sub>x</sub>, H<sub>y</sub></small></article>
      </section>

      <footer><span>FDTD Nanopillar Explorer</span><span>Fields are shown in normalized units · Results are educational, not design-certified.</span></footer>
    </main>
  );
}
