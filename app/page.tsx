"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const NX = 180;
const NY = 120;
const PML = 12;
const COURANT = 0.48;
const MONITOR_X = Math.round(NX * 0.76);

type Params = {
  wavelength: number;
  refractiveIndex: number;
  pillarWidth: number;
  pillarLength: number;
  amplitude: number;
  stepsPerFrame: number;
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
  step: number;
  periodSteps: number;
  dxNm: number;
  pillar: { x1: number; x2: number; y1: number; y2: number };
};

const defaults: Params = {
  wavelength: 850,
  refractiveIndex: 2,
  pillarWidth: 300,
  pillarLength: 700,
  amplitude: 0.65,
  stepsPerFrame: 3,
};

function createEngine(params: Params): Engine {
  const size = NX * NY;
  const dxNm = params.wavelength / 20;
  const epsilon = new Float32Array(size).fill(1);
  const damping = new Float32Array(size).fill(1);
  const widthCells = Math.max(1, Math.round(params.pillarWidth / dxNm));
  const lengthCells = Math.max(1, Math.round(params.pillarLength / dxNm));
  const x1 = Math.round(NX * 0.54 - lengthCells / 2);
  const x2 = x1 + lengthCells;
  const y1 = Math.round(NY / 2 - widthCells / 2);
  const y2 = y1 + widthCells;

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = x + y * NX;
      if (x >= x1 && x < x2 && y >= y1 && y < y2) {
        epsilon[i] = params.refractiveIndex ** 2;
      }
      const edge = Math.min(x, y, NX - 1 - x, NY - 1 - y);
      if (edge < PML) {
        const depth = (PML - edge) / PML;
        damping[i] = Math.exp(-0.22 * depth ** 3);
      }
    }
  }

  return {
    ez: new Float32Array(size),
    hx: new Float32Array(size),
    hy: new Float32Array(size),
    epsilon,
    damping,
    image: new ImageData(NX, NY),
    monitorRe: new Float64Array(NY),
    monitorIm: new Float64Array(NY),
    monitorSamples: 0,
    step: 0,
    periodSteps: 20 / COURANT,
    dxNm,
    pillar: { x1, x2, y1, y2 },
  };
}

function advance(engine: Engine, params: Params) {
  const { ez, hx, hy, epsilon, damping } = engine;
  for (let y = 0; y < NY - 1; y++) {
    for (let x = 0; x < NX; x++) {
      const i = x + y * NX;
      hx[i] = (hx[i] - COURANT * (ez[i + NX] - ez[i])) * damping[i];
    }
  }
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX - 1; x++) {
      const i = x + y * NX;
      hy[i] = (hy[i] + COURANT * (ez[i + 1] - ez[i])) * damping[i];
    }
  }
  for (let y = 1; y < NY - 1; y++) {
    for (let x = 1; x < NX - 1; x++) {
      const i = x + y * NX;
      const curl = hy[i] - hy[i - 1] - hx[i] + hx[i - NX];
      ez[i] = (ez[i] + (COURANT / epsilon[i]) * curl) * damping[i];
    }
  }

  const sourceX = PML + 5;
  const ramp = 1 - Math.exp(-((engine.step / (engine.periodSteps * 3)) ** 2));
  const source =
    params.amplitude * ramp * Math.sin((2 * Math.PI * engine.step) / engine.periodSteps);
  for (let y = PML + 2; y < NY - PML - 2; y++) {
    ez[sourceX + y * NX] += source;
  }

  // Frequency-domain monitor: accumulate Ez * exp(-i omega t) after transients.
  if (engine.step > engine.periodSteps * 7) {
    const angle = (2 * Math.PI * engine.step) / engine.periodSteps;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let y = PML; y < NY - PML; y++) {
      const value = ez[MONITOR_X + y * NX];
      engine.monitorRe[y] += value * cosine;
      engine.monitorIm[y] -= value * sine;
    }
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

  const p = engine.pillar;
  context.strokeStyle = "#07111f";
  context.lineWidth = 1.2;
  context.strokeRect(p.x1, NY - p.y2, p.x2 - p.x1, p.y2 - p.y1);
  context.strokeStyle = "#5df2c2";
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(PML + 5, PML + 2);
  context.lineTo(PML + 5, NY - PML - 2);
  context.stroke();
  context.save();
  context.strokeStyle = "#f2a93b";
  context.lineWidth = 0.8;
  context.setLineDash([2, 2]);
  context.beginPath();
  context.moveTo(MONITOR_X, PML);
  context.lineTo(MONITOR_X, NY - PML);
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
  context.fillText("transverse position y", (left + width - right) / 2, height - 8);

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
  for (let y = PML; y < NY - PML; y++) {
    const re = engine.monitorRe[y] / engine.monitorSamples;
    const im = engine.monitorIm[y] / engine.monitorSamples;
    const value = re * re + im * im;
    intensity.push(value);
    peak = Math.max(peak, value);
  }
  const scale = peak || 1;
  for (let index = 0; index < intensity.length; index++) {
    intensity[index] /= scale;
    const y = index + PML;
    phase.push(intensity[index] < 0.01 ? Number.NaN : Math.atan2(engine.monitorIm[y], engine.monitorRe[y]));
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
  const timeFs = displayStep * COURANT * engine.dxNm / 299.792458;

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
          <h2>See light interact<br />with a nanopillar.</h2>
        </div>
        <p className="lede">Adjust the structure and source in real time. The field is recomputed on a Yee grid directly in your browser.</p>
      </section>

      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="panel-heading">
            <div><span className="section-number">01</span><h3>Parameters</h3></div>
            <button className="text-button" onClick={() => { paramsRef.current = defaults; setParams(defaults); reset(defaults); }}>Defaults</button>
          </div>
          <div className="control-group">
            <p className="group-label">Incident wave</p>
            <Slider label="Wavelength" value={params.wavelength} min={500} max={1200} step={10} unit=" nm" onChange={(v) => changeParam("wavelength", v)} />
            <Slider label="Source amplitude" value={params.amplitude} min={0.1} max={1} step={0.05} unit="" onChange={(v) => changeParam("amplitude", v, false)} />
          </div>
          <div className="control-group">
            <p className="group-label">Nanopillar</p>
            <Slider label="Refractive index" value={params.refractiveIndex} min={1} max={4} step={0.1} unit="" onChange={(v) => changeParam("refractiveIndex", v)} />
            <Slider label="Width" value={params.pillarWidth} min={100} max={800} step={25} unit=" nm" onChange={(v) => changeParam("pillarWidth", v)} />
            <Slider label="Length" value={params.pillarLength} min={200} max={1600} step={50} unit=" nm" onChange={(v) => changeParam("pillarLength", v)} />
          </div>
          <div className="control-group last">
            <p className="group-label">Playback</p>
            <Slider label="Steps per frame" value={params.stepsPerFrame} min={1} max={8} step={1} unit="×" onChange={(v) => changeParam("stepsPerFrame", v, false)} />
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
            <canvas className="field-canvas" ref={canvasRef} width={NX} height={NY} aria-label="Animated electric field simulation" />
            <span className="axis axis-y">y</span><span className="axis axis-x">x</span>
            <span className="source-label">source</span>
            <span className="monitor-label">DFT monitor</span>
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
      </section>

      <section className="panel analysis-panel">
        <div className="analysis-head">
          <div><span className="section-number">03</span><h3>Frequency-domain monitor</h3></div>
          <p>Complex field sampled behind the pillar at x = {(MONITOR_X * engine.dxNm / 1000).toFixed(2)} µm</p>
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
        <article><span>Cell size</span><strong>{engine.dxNm.toFixed(1)} nm</strong><small>λ / 20</small></article>
        <article><span>Boundary</span><strong>{PML} cells</strong><small>graded absorber</small></article>
        <article><span>Polarization</span><strong>TM<sub>z</sub></strong><small>E<sub>z</sub>, H<sub>x</sub>, H<sub>y</sub></small></article>
      </section>

      <footer><span>FDTD Nanopillar Explorer</span><span>Fields are shown in normalized units · Results are educational, not design-certified.</span></footer>
    </main>
  );
}
