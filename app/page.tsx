"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const NX = 180;
const NY = 120;
const PML = 12;
const COURANT = 0.48;

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
          lastUiUpdate = time;
        }
      }
      animationId = requestAnimationFrame(loop);
    };
    if (canvasRef.current) render(engineRef.current, canvasRef.current);
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
            <canvas ref={canvasRef} width={NX} height={NY} aria-label="Animated electric field simulation" />
            <span className="axis axis-y">y</span><span className="axis axis-x">x</span>
            <span className="source-label">source</span>
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
