// exportar_js.mjs: roda os cenários de validação com os módulos JS e imprime JSON.
// Entrada (stdin): { oraculo: [{nome, Kp, Ki, Kd, dt, tFinal, setpoint}] }
// Uso: chamado por validacao/paridade.py (node validacao/exportar_js.mjs < cenarios.json).
// Somente importa os módulos de assets/js, nunca os altera.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PLANTA, simularOraculo, criarPlanta, simularFisico, respostaDegrauFOPDT } from '../assets/js/sim.js';
import { criarPID, GANHOS } from '../assets/js/pid.js';
import { calcularIndices, r2, MetricasAoVivo } from '../assets/js/metricas.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const entrada = JSON.parse(readFileSync(0, 'utf8') || '{}');
const arr = (x) => Array.from(x);
const K = PLANTA.K;
const TAU = PLANTA.tau;
const saida = { planta: PLANTA, ganhos: GANHOS };

// 1 e 2: modo oráculo
saida.oraculo = (entrada.oraculo || []).map((c) => {
  const sp = c.setpoint ?? 50;
  const s = simularOraculo({ K, tau: TAU, Kp: c.Kp, Ki: c.Ki, Kd: c.Kd, tFinal: c.tFinal, dt: c.dt, setpoint: sp });
  return { nome: c.nome, y: arr(s.y), u: arr(s.u), e: arr(s.e), indices: calcularIndices(s.t, s.y, s.e, sp) };
});

// 3: R2 do bloco 40
const b = JSON.parse(readFileSync(join(raiz, 'dados', 'bloco40.json'), 'utf8'));
const yMod = respostaDegrauFOPDT(b.t_norm, 7.7909, 431.52, 0, b.y0, b.delta_u_p);
saida.bloco40 = { n: b.t_norm.length, t_norm: b.t_norm, nivel: b.nivel, r2: r2(b.nivel, yMod), r2_referencia: b.r2_referencia };

// 4 e 5: modo físico
saida.fisico = {};
for (const nome of ['IMC', 'AG']) {
  const s = simularFisico({ ganhos: GANHOS[nome], setpoint: 50, tFinal: 3000, dt: 0.5, theta: 0 });
  const n = s.y.length;
  const s12 = simularFisico({ ganhos: GANHOS[nome], setpoint: 50, tFinal: 1200, dt: 0.5, theta: 0 });
  saida.fisico[nome] = { uFinal: s.u[n - 1], yFinal: s.y[n - 1], y1200: arr(s12.y), u1200: arr(s12.u) };
}

// 6: métricas ao vivo
{
  const g = GANHOS.AG;
  const s = simularOraculo({ K, tau: TAU, Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, tFinal: 1200, dt: 0.5, setpoint: 50 });
  const m = new MetricasAoVivo({ dt: 0.5 });
  m.reiniciar({ tempo: 0, setpoint: 50, yAtual: 0 });
  for (let i = 0; i < s.t.length; i++) m.adicionar({ tempo: s.t[i], y: s.y[i], e: s.e[i] });
  const neg = {};
  for (const nome of ['IMC', 'AG']) {
    const dt = 0.5;
    const tEv = 2000;
    const f = simularFisico({
      ganhos: GANHOS[nome], setpoint: 50, tFinal: 4000, dt,
      eventos: [{ t: tEv, tipo: 'setpoint', valor: 30 }],
    });
    const mm = new MetricasAoVivo({ dt });
    let iEv = f.t.findIndex((t) => t >= tEv);
    mm.reiniciar({ tempo: f.t[iEv], setpoint: 30, yAtual: f.y[iEv - 1] });
    for (let i = iEv; i < f.t.length; i++) mm.adicionar({ tempo: f.t[i], y: f.y[i], e: f.e[i] });
    neg[nome] = { valores: mm.valores(), yIni: f.y[iEv - 1], yFinal: f.y[f.y.length - 1] };
  }
  saida.aoVivo = {
    referencia: calcularIndices(s.t, s.y, s.e, 50),
    vivo: m.valores(),
    degrauNegativo: neg,
  };
}

// 7: desempenho (2 malhas, 200 passos de 0,5 s por quadro, 60 quadros por segundo de relógio)
{
  const DT = 0.5;
  const PASSOS = 200;
  const QUADROS = 60;
  const RODADAS = 30;
  function criarMalha(g, comMetricas) {
    const planta = criarPlanta({ K, tau: TAU, theta: 0, dt: DT, y0: PLANTA.y0, u0: PLANTA.u0 });
    const pid = criarPID({ ...g, bias: PLANTA.u0, modo: 'fisico' });
    const met = new MetricasAoVivo({ dt: DT });
    met.reiniciar({ tempo: 0, setpoint: 50, yAtual: PLANTA.y0 });
    return { planta, pid, met, y: PLANTA.y0, t: 0, comMetricas };
  }
  function quadro(m) {
    for (let k = 0; k < PASSOS; k++) {
      const r = m.pid.passo({ setpoint: 50, y: m.y, dt: DT });
      m.y = m.planta.passo(r.u, 0);
      m.t += DT;
      if (m.comMetricas) m.met.adicionar({ tempo: m.t, y: m.y, e: r.e });
    }
  }
  function medir(comMetricas) {
    const malhas = [criarMalha(GANHOS.IMC, comMetricas), criarMalha(GANHOS.AG, comMetricas)];
    for (let q = 0; q < 200; q++) malhas.forEach(quadro); // aquecimento do JIT
    const tempos = [];
    for (let r = 0; r < RODADAS; r++) {
      for (let q = 0; q < QUADROS; q++) {
        const t0 = performance.now();
        for (const m of malhas) quadro(m);
        tempos.push(performance.now() - t0);
      }
    }
    tempos.sort((a, c) => a - c);
    const media = tempos.reduce((s, x) => s + x, 0) / tempos.length;
    return { media, p99: tempos[Math.floor(tempos.length * 0.99)], max: tempos[tempos.length - 1], quadros: tempos.length };
  }
  saida.desempenho = {
    passosPorQuadro: PASSOS * 2,
    semMetricas: medir(false),
    comMetricas: medir(true),
  };
}

process.stdout.write(JSON.stringify(saida));
