// sim.js: planta FOPDT do Tanque T2 e simulações de malha fechada.
// Módulo puro (sem DOM), roda em Node e no navegador.
// Modelo e dados identificados pela equipe do Projeto Integrador (6 integrantes).

import { criarPID } from './pid.js';

// Ponto de operação do bloco 40 (dados/gerar_bloco40.py): u0 = média de
// DegrauP antes do degrau (32,3077%), y0 = nível médio antes do degrau
// (15,7115%). K e tau do ajuste por AG no PI.
export const PLANTA = { K: 7.7909, tau: 431.52, theta: 0, u0: 32.308, y0: 15.712 };

// Réplica exata de simular_malha_fechada (projeto_pid_comparativo.py):
// variáveis de desvio, nível inicial 0, Euler explícito, índice 0 nulo.
export function simularOraculo({ K, tau, Kp, Ki, Kd, tFinal = 1200, dt = 0.5, setpoint = 50 }) {
  // n = len(np.arange(0, tFinal, dt))
  const n = Math.max(0, Math.ceil(tFinal / dt));
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  const u = new Float64Array(n);
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i * dt;

  const pid = criarPID({ Kp, Ki, Kd, uMin: 0, uMax: 100, modo: 'oraculo' });
  const fator = dt / tau;
  for (let i = 1; i < n; i++) {
    const r = pid.passo({ setpoint, y: y[i - 1], dt });
    e[i] = r.e;
    u[i] = r.u;
    y[i] = y[i - 1] + (K * u[i] - y[i - 1]) * fator;
  }
  return { t, y, u, e };
}

// Planta FOPDT discreta em variáveis absolutas:
//   y = y0 + dy,  tau * d(dy)/dt + dy = K * ((u(t - theta) - u0) - d)
// O atraso theta age só sobre o comando u (transporte), via buffer
// circular em amostras (round(theta/dt)). A carga d age sem atraso.
// metodo 'zoh': dy[k] = a*dy[k-1] + K*(1-a)*v, a = exp(-dt/tau).
// metodo 'euler': dy[k] = dy[k-1] + (K*v - dy[k-1])*dt/tau (igual ao PI).
const THETA_MAX = 60;

export function criarPlanta({ K, tau, theta = 0, dt, y0 = 0, u0 = 0, metodo = 'zoh' }) {
  const a = Math.exp(-dt / tau);
  const fator = dt / tau;
  const zoh = metodo !== 'euler';

  let capacidade = Math.ceil(Math.max(THETA_MAX, theta) / dt) + 2;
  let hist = new Float64Array(capacidade); // desvios u - u0 (0 = regime)
  let escrita = 0;
  let atraso = 0;
  let dy = 0;

  function setTheta(novoTheta) {
    const th = Math.max(0, novoTheta || 0);
    const amostras = Math.round(th / dt);
    if (amostras + 2 > capacidade) {
      // Cresce o buffer preservando a história na ordem certa
      const nova = new Float64Array(amostras + 2);
      for (let k = 0; k < capacidade; k++) {
        nova[nova.length - capacidade + k] = hist[(escrita + k) % capacidade];
      }
      hist = nova;
      capacidade = nova.length;
      escrita = 0;
    }
    atraso = amostras;
  }

  function reiniciar() {
    hist.fill(0);
    escrita = 0;
    dy = 0;
  }

  function passo(u, d = 0) {
    hist[escrita] = u - u0;
    const v = hist[(escrita - atraso + capacidade) % capacidade] - d;
    escrita = (escrita + 1) % capacidade;
    dy = zoh ? a * dy + K * (1 - a) * v : dy + (K * v - dy) * fator;
    return y0 + dy;
  }

  setTheta(theta);
  return {
    passo,
    reiniciar,
    setTheta,
    get y() {
      return y0 + dy;
    },
  };
}

// Simulação no modo físico: planta ZOH em torno de (u0, y0), PID modo
// 'fisico' com bias = u0, partindo do regime. Mesma ordem do oráculo:
// no índice i o PID lê y[i-1] e a planta produz y[i] com u[i].
// eventos: [{t, tipo: 'setpoint' | 'carga', valor}], aplicados quando t[i] >= t.
export function simularFisico({
  ganhos,
  planta = PLANTA,
  setpoint = 50,
  tFinal = 1200,
  dt = 0.5,
  theta = 0,
  eventos = [],
}) {
  const n = Math.max(0, Math.ceil(tFinal / dt));
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  const u = new Float64Array(n);
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = i * dt;

  const p = criarPlanta({ K: planta.K, tau: planta.tau, theta, dt, y0: planta.y0, u0: planta.u0 });
  const pid = criarPID({ ...ganhos, bias: planta.u0, modo: 'fisico' });
  const fila = [...eventos].sort((x, z) => x.t - z.t);
  let prox = 0;
  let sp = setpoint;
  let carga = 0;

  if (n > 0) {
    y[0] = planta.y0;
    u[0] = planta.u0;
  }
  for (let i = 1; i < n; i++) {
    while (prox < fila.length && fila[prox].t <= t[i]) {
      const ev = fila[prox++];
      if (ev.tipo === 'setpoint') sp = ev.valor;
      else if (ev.tipo === 'carga') carga = ev.valor;
    }
    const r = pid.passo({ setpoint: sp, y: y[i - 1], dt });
    e[i] = r.e;
    u[i] = r.u;
    y[i] = p.passo(u[i], carga);
  }
  return { t, y, u, e };
}

// Réplica de modelo_fopdt (identificacao_fopdt.py): resposta ao degrau du
// aplicado em t = 0, com atraso theta.
export function respostaDegrauFOPDT(t, K, tau, theta, y0, du) {
  const n = t.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = t[i] >= theta ? y0 + K * du * (1.0 - Math.exp(-(t[i] - theta) / tau)) : y0;
  }
  return y;
}

// Gerador pseudoaleatório com semente (mulberry32), saída em [0, 1).
export function criarRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// Amostra gaussiana de média 0 e desvio sigma (Box-Muller).
export function gaussiano(sigma, rng = Math.random) {
  let u1 = rng();
  while (u1 <= Number.MIN_VALUE) u1 = rng();
  const u2 = rng();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
