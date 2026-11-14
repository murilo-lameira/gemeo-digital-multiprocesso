// malhas.js: orquestração das duas malhas (IMC e AG) com a mesma entrada.
// Sem DOM: roda em Node para os testes. Não contém matemática nova, só
// liga planta, PID e métricas de sim.js, pid.js e metricas.js (gemeo_sim).
//
// Perturbações (ESCOPO.md item 4):
// - carga d (%): entra em planta.passo(u, d) nas duas malhas; positivo esvazia.
// - ruído de medição: gaussiano com semente fixa, a mesma amostra nas duas
//   malhas a cada passo. O PID e o gráfico recebem a medição com ruído; as
//   métricas usam o nível real.
// - tempo morto theta (s): planta.setTheta nas duas malhas.
// Nenhuma perturbação zera as métricas; só a mudança de setpoint zera.

import { criarPlanta, PLANTA, criarRng, gaussiano } from './sim.js';
import { criarPID, GANHOS } from './pid.js';
import { MetricasAoVivo } from './metricas.js';

export const DT = 0.5;
// Desvio do resíduo do modelo no bloco 40 (bloco40.json, sigma_residuo).
// Valor de partida; app.js troca pelo do arquivo quando ele carrega.
export const SIGMA_PADRAO = 0.280168;
export const SEMENTE_RUIDO = 40;

function criarMalha(ganhos, dt) {
  return {
    planta: criarPlanta({
      K: PLANTA.K,
      tau: PLANTA.tau,
      theta: PLANTA.theta,
      dt,
      y0: PLANTA.y0,
      u0: PLANTA.u0,
      metodo: 'zoh',
    }),
    pid: criarPID({
      Kp: ganhos.Kp,
      Ki: ganhos.Ki,
      Kd: ganhos.Kd,
      N: 10,
      uMin: 0,
      uMax: 100,
      bias: PLANTA.u0,
      modo: 'fisico',
    }),
    metricas: new MetricasAoVivo({ dt }),
    y: PLANTA.y0, // nível real
    yMed: PLANTA.y0, // medição (nível real mais ruído)
    u: PLANTA.u0,
  };
}

export function criarSistema({ dt = DT, setpoint = 50 } = {}) {
  const imc = criarMalha(GANHOS.IMC, dt);
  const ag = criarMalha(GANHOS.AG, dt);

  // Objetos de argumento reaproveitados, para não alocar a cada passo.
  const argPid = { setpoint: 0, y: 0, dt };
  const argMet = { tempo: 0, y: 0 };
  const argReinicio = { tempo: 0, setpoint: 0, yAtual: 0 };

  const s = {
    dt,
    t: 0,
    setpoint,
    carga: 0,
    theta: PLANTA.theta,
    ruido: false,
    sigma: SIGMA_PADRAO,
    rng: criarRng(SEMENTE_RUIDO),
    imc,
    ag,
  };

  function passoMalha(m, ruido, tNovo) {
    argPid.setpoint = s.setpoint;
    argPid.y = m.yMed;
    const r = m.pid.passo(argPid);
    m.u = r.u;
    m.y = m.planta.passo(m.u, s.carga);
    m.yMed = m.y + ruido;
    argMet.tempo = tNovo;
    argMet.y = m.y;
    m.metricas.adicionar(argMet);
  }

  // Avança um passo de dt nas duas malhas.
  function passo() {
    const tNovo = s.t + dt;
    const ruido = s.ruido ? gaussiano(s.sigma, s.rng) : 0;
    passoMalha(imc, ruido, tNovo);
    passoMalha(ag, ruido, tNovo);
    s.t = tNovo;
  }

  function reiniciarMetricas() {
    argReinicio.tempo = s.t;
    argReinicio.setpoint = s.setpoint;
    argReinicio.yAtual = imc.y;
    imc.metricas.reiniciar(argReinicio);
    argReinicio.yAtual = ag.y;
    ag.metricas.reiniciar(argReinicio);
  }

  function definirSetpoint(sp) {
    if (sp === s.setpoint) return false;
    s.setpoint = sp;
    reiniciarMetricas();
    return true;
  }

  function definirTheta(theta) {
    s.theta = theta;
    imc.planta.setTheta(theta);
    ag.planta.setTheta(theta);
  }

  // Volta ao regime no ponto de operação. Mantém theta, ruído e ganhos;
  // a carga volta a 0 (o degrau de carga é um evento, não uma configuração).
  function reiniciar() {
    s.t = 0;
    s.carga = 0;
    s.rng = criarRng(SEMENTE_RUIDO);
    for (const m of [imc, ag]) {
      m.planta.reiniciar();
      m.pid.reiniciar();
      m.y = PLANTA.y0;
      m.yMed = PLANTA.y0;
      m.u = PLANTA.u0;
    }
    reiniciarMetricas();
  }

  s.passo = passo;
  s.reiniciar = reiniciar;
  s.reiniciarMetricas = reiniciarMetricas;
  s.definirSetpoint = definirSetpoint;
  s.definirTheta = definirTheta;
  reiniciarMetricas();
  return s;
}

// Vazão de saída equivalente, em % do comando da válvula FV-02. Do balanço do
// modelo, tau*dy/dt = K*(u - u0 - d) - (y - y0): a saída equivale a
// u0 + d + (y - y0)/K. Só para o indicador visual do tanque.
export function vazaoSaida(y, d) {
  const q = PLANTA.u0 + d + (y - PLANTA.y0) / PLANTA.K;
  return q < 0 ? 0 : q;
}
