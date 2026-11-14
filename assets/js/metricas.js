// metricas.js: índices de desempenho e qualidade de ajuste.
// Módulo puro (sem DOM), roda em Node e no navegador.

// Réplica exata de calcular_indices_desempenho (projeto_pid_comparativo.py).
// Somas retangulares vezes dt, sobressinal em % do setpoint (mínimo 0),
// subida de 10% a 90% pelo primeiro índice que cruza (NaN se não cruzar),
// acomodação = t do último índice fora de ±2% do setpoint (0 se nenhum).
export function calcularIndices(t, y, e, setpoint = 50) {
  const n = t.length;
  const dt = t[1] - t[0];
  let sAbs = 0;
  let sTAbs = 0;
  let sQ = 0;
  let yMax = -Infinity;
  let i10 = -1;
  let i90 = -1;
  let ultimoFora = -1;
  const banda = 0.02 * setpoint;
  for (let i = 0; i < n; i++) {
    const ae = Math.abs(e[i]);
    sAbs += ae;
    sTAbs += t[i] * ae;
    sQ += e[i] * e[i];
    if (y[i] > yMax) yMax = y[i];
    if (i10 < 0 && y[i] >= 0.1 * setpoint) i10 = i;
    if (i90 < 0 && y[i] >= 0.9 * setpoint) i90 = i;
    if (Math.abs(y[i] - setpoint) > banda) ultimoFora = i;
  }
  return {
    IAE: sAbs * dt,
    ITAE: sTAbs * dt,
    ISE: sQ * dt,
    sobressinal: Math.max(0, ((yMax - setpoint) / setpoint) * 100),
    tempoSubida: i10 >= 0 && i90 >= 0 ? t[i90] - t[i10] : NaN,
    tempoAcomodacao: ultimoFora >= 0 ? t[ultimoFora] : 0,
  };
}

// Coeficiente de determinação, igual a calcular_metricas do identificacao_fopdt.py.
export function r2(yReal, ySim) {
  const n = yReal.length;
  let media = 0;
  for (let i = 0; i < n; i++) media += yReal[i];
  media /= n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const r = yReal[i] - ySim[i];
    const d = yReal[i] - media;
    ssRes += r * r;
    ssTot += d * d;
  }
  return 1 - ssRes / ssTot;
}

export function rmse(yReal, ySim) {
  const n = yReal.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const r = yReal[i] - ySim[i];
    s += r * r;
  }
  return Math.sqrt(s / n);
}

// Métricas ao vivo relativas ao último degrau de setpoint.
// A cada reiniciar o relógio zera e o degrau passa a ser
// dSP = setpoint - yAtual. O avanço normalizado p = (y - yIni)/dSP vale
// 0 no início e 1 no setpoint, então degraus negativos funcionam igual.
// Subida de p = 0,1 a p = 0,9; sobressinal = (pMax - 1)*100 (mínimo 0),
// ou seja, relativo a |dSP|; banda de ±2% de |dSP|; acomodação = tempo
// relativo da última amostra fora da banda (0 se nenhuma).
export class MetricasAoVivo {
  constructor({ dt }) {
    this.dt = dt;
    this.reiniciar({ tempo: 0, setpoint: 0, yAtual: 0 });
  }

  reiniciar({ tempo, setpoint, yAtual }) {
    this.t0 = tempo;
    this.setpoint = setpoint;
    this.yIni = yAtual;
    this.dSP = setpoint - yAtual;
    this.sAbs = 0;
    this.sTAbs = 0;
    this.sQ = 0;
    this.pMax = -Infinity;
    this.t10 = NaN;
    this.t90 = NaN;
    this.ultimoFora = 0;
  }

  // e é opcional: se omitido, usa setpoint - y.
  adicionar({ tempo, y, e }) {
    const tr = tempo - this.t0;
    const err = e === undefined ? this.setpoint - y : e;
    const ae = Math.abs(err);
    this.sAbs += ae * this.dt;
    this.sTAbs += tr * ae * this.dt;
    this.sQ += err * err * this.dt;
    const amp = Math.abs(this.dSP);
    if (amp > 0) {
      const p = (y - this.yIni) / this.dSP;
      if (p > this.pMax) this.pMax = p;
      if (Number.isNaN(this.t10) && p >= 0.1) this.t10 = tr;
      if (Number.isNaN(this.t90) && p >= 0.9) this.t90 = tr;
      if (Math.abs(y - this.setpoint) > 0.02 * amp) this.ultimoFora = tr;
    }
  }

  valores() {
    const temPico = Math.abs(this.dSP) > 0 && Number.isFinite(this.pMax);
    return {
      IAE: this.sAbs,
      ITAE: this.sTAbs,
      ISE: this.sQ,
      sobressinal: temPico ? Math.max(0, (this.pMax - 1) * 100) : 0,
      tempoSubida: this.t90 - this.t10,
      tempoAcomodacao: this.ultimoFora,
    };
  }
}
