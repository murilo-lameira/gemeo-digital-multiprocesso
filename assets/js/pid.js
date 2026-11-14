// pid.js: controlador PID paralelo com saturação e anti-windup.
// Módulo puro (sem DOM), roda em Node e no navegador.
//
// Dois modos (ESCOPO.md seção 2.1):
// - 'oraculo': cópia exata do laço de simular_malha_fechada do
//   projeto_pid_comparativo.py (derivada na medição sem filtro, integral
//   somada depois de calcular u, anti-windup sign(e) != sign(uCalc)).
// - 'fisico': bias (ponto de operação), derivada na medição filtrada com
//   Tf = Kd/(Kp*N) e anti-windup assimétrico sign(e) != sign(uCalc - u).
//
// Discretização do filtro derivativo no modo físico: Euler para trás.
//   D[k] = Tf/(Tf+dt) * D[k-1] - Kd/(Tf+dt) * (y[k] - y[k-1])
// Escolha: com os ganhos do AG, Tf = 0,003/(1,4994*10) = 0,0002 s, muito
// menor que dt = 0,5 s. Em Tustin o polo do filtro ficaria em
// (2Tf - dt)/(2Tf + dt), quase -1, e a derivada oscilaria de sinal a cada
// passo. Euler para trás mantém o polo em Tf/(Tf+dt), entre 0 e 1, sem
// oscilação, e tende à derivada pura quando Tf cresce em relação a dt.

// Ganhos de referência do PI (docs/02_ETAPAS_07_A_10_SINTONIA_PID.md).
// IMC calculado com a mesma expressão do script: Kp = tau/(K*tau_mf),
// tau_mf = tau/3, Ki = Kp/tau. Equivale a Kp = 3/K.
const K_REF = 7.7909;
const TAU_REF = 431.52;
const KP_IMC = TAU_REF / (K_REF * (TAU_REF / 3.0));

export const GANHOS = {
  IMC: { Kp: KP_IMC, Ki: KP_IMC / TAU_REF, Kd: 0 },
  AG: { Kp: 1.4994, Ki: 0.003475, Kd: 0.0030 },
};

function clip(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function criarPID({
  Kp,
  Ki,
  Kd,
  N = 10,
  uMin = 0,
  uMax = 100,
  bias = 0,
  modo = 'fisico',
} = {}) {
  const g = { Kp, Ki, Kd };
  const oraculo = modo === 'oraculo';

  // Estado
  let integralE = 0; // modo oráculo: integral do erro (multiplicada por Ki)
  let termoI = 0; // modo físico: contribuição integral já em unidades de u
  let D = 0; // modo físico: termo derivativo filtrado
  let yPrev = 0;
  let primeiro = true;
  let eUlt = 0; // último erro, usado na troca de ganhos sem salto
  let derivUlt = 0; // última derivada crua (modo oráculo)

  // Objeto de resultado reaproveitado: passo() devolve sempre este mesmo
  // objeto, com os campos atualizados, para não alocar a cada passo.
  // Quem chama deve ler u, uCalc e e na hora e não guardar a referência
  // entre passos (o próximo passo sobrescreve os valores).
  const res = { u: 0, uCalc: 0, e: 0 };

  function reiniciar() {
    integralE = 0;
    termoI = 0;
    D = 0;
    yPrev = 0;
    primeiro = true;
    eUlt = 0;
    derivUlt = 0;
  }

  function passoOraculo(setpoint, y, dt) {
    const e = setpoint - y;
    // Derivada na medição, zero no primeiro passo (i == 1 no Python)
    const deriv = primeiro ? 0.0 : -(y - yPrev) / dt;
    yPrev = y;
    primeiro = false;
    const uCalc = g.Kp * e + g.Ki * integralE + g.Kd * deriv;
    const u = clip(uCalc, uMin, uMax);
    if (uCalc === u || Math.sign(e) !== Math.sign(uCalc)) {
      integralE += e * dt;
    }
    eUlt = e;
    derivUlt = deriv;
    res.u = u;
    res.uCalc = uCalc;
    res.e = e;
    return res;
  }

  function passoFisico(setpoint, y, dt) {
    const e = setpoint - y;
    if (primeiro || g.Kd === 0 || g.Kp === 0) {
      D = 0;
    } else {
      const Tf = g.Kd / (g.Kp * N);
      D = (Tf / (Tf + dt)) * D - (g.Kd / (Tf + dt)) * (y - yPrev);
    }
    yPrev = y;
    primeiro = false;
    const uCalc = bias + g.Kp * e + termoI + D;
    const u = clip(uCalc, uMin, uMax);
    // Anti-windup assimétrico: só trava a integral se ela empurra para
    // dentro da saturação.
    if (uCalc === u || Math.sign(e) !== Math.sign(uCalc - u)) {
      termoI += g.Ki * e * dt;
    }
    eUlt = e;
    res.u = u;
    res.uCalc = uCalc;
    res.e = e;
    return res;
  }

  // Devolve o objeto reaproveitado res (ver acima): não guarde a referência.
  function passo({ setpoint, y, dt }) {
    return oraculo ? passoOraculo(setpoint, y, dt) : passoFisico(setpoint, y, dt);
  }

  // Troca de ganhos sem salto (bumpless): mantém o uCalc do último passo
  // ajustando a integral para compensar a mudança dos termos P e D.
  function setGanhos({ Kp: nKp = g.Kp, Ki: nKi = g.Ki, Kd: nKd = g.Kd } = {}) {
    if (oraculo) {
      const antes = g.Kp * eUlt + g.Ki * integralE + g.Kd * derivUlt;
      const semI = nKp * eUlt + nKd * derivUlt;
      if (nKi !== 0) integralE = (antes - semI) / nKi;
    } else {
      // O estado do filtro é proporcional a Kd: reescala para o novo Kd.
      const nD = g.Kd !== 0 && nKp !== 0 ? (D * nKd) / g.Kd : 0;
      termoI += (g.Kp - nKp) * eUlt + (D - nD);
      D = nD;
    }
    g.Kp = nKp;
    g.Ki = nKi;
    g.Kd = nKd;
  }

  return {
    passo,
    reiniciar,
    setGanhos,
    get ganhos() {
      return { ...g };
    },
    modo,
  };
}
