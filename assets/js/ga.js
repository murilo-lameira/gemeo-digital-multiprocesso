// ga.js: sintonia do PID por algoritmo genético (fase 2, item 8 do ESCOPO.md).
// Módulo puro (sem DOM), roda em Node, no navegador e no Web Worker.
// Réplica do algoritmo de otimizar_pid_genetico (projeto_pid_comparativo.py,
// Projeto Integrador da equipe). O gerador é o mulberry32 de sim.js, não o do
// NumPy, então os números não repetem os do PI: o critério é de qualidade.
//
// Algoritmo (igual ao Python):
// - população inicial uniforme nos limites;
// - aptidão = ITAE (simulação do modo oráculo com dtAptidao e tFinal) mais
//   (sobressinal - 5) * 10000 se o sobressinal passar de 5%;
// - elitismo de 1: o melhor de todas as gerações entra na população nova;
// - cada pai sai de um torneio de 3 sorteados com reposição;
// - crossover aritmético com alpha sorteado por gene;
// - mutação com probabilidade 0,3: soma gaussiana de desvio
//   0,08 * (max - min) em cada gene;
// - clip nos limites.
// Diferença sem efeito no resultado: o Python ainda gera uma população depois
// da última avaliação e a descarta; aqui essa última reprodução é pulada.
//
// Refinamento (refinar = true, padrão): depois da última geração, um
// Nelder-Mead com projeção nos limites parte do melhor do AG. Motivo,
// medido em 200 sementes com 60 x 80: o AG puro termina acima de ITAE 70.000
// (modo oráculo, dt 0,5 s) em 87 delas. A aptidão tem um vale estreito e
// diagonal (Ki precisa acompanhar Kd para manter Ti perto de tau) e o AG para
// na encosta com Kd alto. O refinamento leva as falhas a 5 de 200 com cerca
// de 400 avaliações a mais. O seed 42 do PI teve sorte com o gerador do
// NumPy. Com refinar = false o algoritmo é só o do Python.

import { criarRng, gaussiano } from './sim.js';

// Limites de busca do PI: [mínimo, máximo] de cada ganho.
export const LIMITES = { Kp: [0.05, 1.5], Ki: [0.0005, 0.02], Kd: [0, 15] };

const GENES = ['Kp', 'Ki', 'Kd'];

// Mesma conta de simularOraculo + calcularIndices (pid.js modo 'oraculo'),
// mas sem alocar vetores: devolve só ITAE e sobressinal. Mantém a ordem das
// operações do Python para dar os mesmos números de ponto flutuante.
// out é um objeto reaproveitado {itae, sobressinal}.
export function avaliarOraculo(K, tau, Kp, Ki, Kd, setpoint, dt, tFinal, out) {
  const n = Math.max(0, Math.ceil(tFinal / dt));
  const fator = dt / tau;
  let y = 0; // y[i-1]
  let yPrev = 0;
  let integralE = 0;
  let somaTAbs = 0;
  let yMax = n > 0 ? 0 : -Infinity; // y[0] = 0 entra no máximo
  for (let i = 1; i < n; i++) {
    const e = setpoint - y;
    const deriv = i > 1 ? -(y - yPrev) / dt : 0.0;
    yPrev = y;
    const uCalc = Kp * e + Ki * integralE + Kd * deriv;
    const u = uCalc < 0 ? 0 : uCalc > 100 ? 100 : uCalc;
    if (uCalc === u || Math.sign(e) !== Math.sign(uCalc)) integralE += e * dt;
    y = y + (K * u - y) * fator;
    if (y > yMax) yMax = y;
    somaTAbs += i * dt * Math.abs(e);
  }
  out.itae = somaTAbs * dt;
  out.sobressinal = Math.max(0, ((yMax - setpoint) / setpoint) * 100);
  return out;
}

function normalizarLimites(limites) {
  const lim = { ...LIMITES, ...(limites || {}) };
  const lo = new Float64Array(3);
  const hi = new Float64Array(3);
  for (let g = 0; g < 3; g++) {
    const par = lim[GENES[g]];
    const a = Number(par?.[0]);
    const b = Number(par?.[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) {
      throw new Error(`Limite inválido para ${GENES[g]}: use [mínimo, máximo] com mínimo <= máximo.`);
    }
    lo[g] = a;
    hi[g] = b;
  }
  return { lo, hi };
}

// Otimizador passo a passo: cada chamada de proximaGeracao() avalia a
// população atual, atualiza o melhor e gera a população seguinte. Serve ao
// Worker, que precisa ceder a vez entre gerações para receber 'parar'.
export function criarOtimizador({
  K = 7.7909,
  tau = 431.52,
  setpoint = 50,
  nPop = 60,
  nGen = 80,
  limites = LIMITES,
  seed = 42,
  dtAptidao = 1.0,
  tFinal = 1200,
  refinar = true,
  avaliacoesRefino = 400,
} = {}) {
  nPop = Math.floor(nPop);
  nGen = Math.floor(nGen);
  if (!(nPop >= 2)) throw new Error('nPop precisa ser pelo menos 2.');
  if (!(nGen >= 1)) throw new Error('nGen precisa ser pelo menos 1.');
  if (!(dtAptidao > 0) || !(tFinal > dtAptidao)) throw new Error('dtAptidao e tFinal inválidos.');
  if (!(tau > 0)) throw new Error('tau precisa ser positivo.');
  if (setpoint === 0) throw new Error('setpoint não pode ser zero (sobressinal relativo).');

  const { lo, hi } = normalizarLimites(limites);
  const sigma = new Float64Array(3);
  for (let g = 0; g < 3; g++) sigma[g] = 0.08 * (hi[g] - lo[g]);

  const rng = criarRng(seed);
  // Populações em vetores planos [Kp0, Ki0, Kd0, Kp1, ...], trocados a cada geração.
  let pop = new Float64Array(nPop * 3);
  let nova = new Float64Array(nPop * 3);
  const custos = new Float64Array(nPop);
  const melhor = new Float64Array(3);
  let melhorCusto = Infinity;
  let geracao = 0;
  const historico = [];
  const aval = { itae: 0, sobressinal: 0 };

  for (let i = 0; i < nPop; i++) {
    for (let g = 0; g < 3; g++) pop[i * 3 + g] = lo[g] + (hi[g] - lo[g]) * rng();
  }

  function custoDe(kp, ki, kd) {
    avaliarOraculo(K, tau, kp, ki, kd, setpoint, dtAptidao, tFinal, aval);
    return aval.sobressinal > 5.0 ? aval.itae + (aval.sobressinal - 5.0) * 10000.0 : aval.itae;
  }

  function torneio() {
    // Três sorteios com reposição; vence o menor custo (o primeiro em empate).
    let venc = Math.floor(rng() * nPop);
    for (let k = 1; k < 3; k++) {
      const c = Math.floor(rng() * nPop);
      if (custos[c] < custos[venc]) venc = c;
    }
    return venc;
  }

  function proximaGeracao() {
    if (geracao >= nGen) return null;
    let iMin = 0;
    for (let i = 0; i < nPop; i++) {
      custos[i] = custoDe(pop[i * 3], pop[i * 3 + 1], pop[i * 3 + 2]);
      if (custos[i] < custos[iMin]) iMin = i;
    }
    if (custos[iMin] < melhorCusto) {
      melhorCusto = custos[iMin];
      for (let g = 0; g < 3; g++) melhor[g] = pop[iMin * 3 + g];
    }
    geracao++;
    const info = { geracao, melhorCusto, Kp: melhor[0], Ki: melhor[1], Kd: melhor[2] };
    historico.push(info);

    if (geracao < nGen) {
      // Elitismo de 1, depois filhos por torneio, crossover e mutação.
      for (let g = 0; g < 3; g++) nova[g] = melhor[g];
      for (let i = 1; i < nPop; i++) {
        const p1 = torneio() * 3;
        const p2 = torneio() * 3;
        const o = i * 3;
        for (let g = 0; g < 3; g++) {
          const alpha = rng();
          nova[o + g] = alpha * pop[p1 + g] + (1 - alpha) * pop[p2 + g];
        }
        if (rng() < 0.3) {
          for (let g = 0; g < 3; g++) nova[o + g] += gaussiano(sigma[g], rng);
        }
        for (let g = 0; g < 3; g++) {
          const v = nova[o + g];
          nova[o + g] = v < lo[g] ? lo[g] : v > hi[g] ? hi[g] : v;
        }
      }
      const tmp = pop;
      pop = nova;
      nova = tmp;
    }
    return info;
  }

  // Nelder-Mead em coordenadas normalizadas z = (x - min)/(max - min), com
  // cada vértice projetado em [0, 1]. Coeficientes clássicos: reflexão 1,
  // expansão 2, contração 0,5, encolhimento 0,5. Começa no melhor do AG,
  // então nunca piora o resultado.
  let refino = null;
  function refinarMelhor() {
    const amp = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const f = (z) => custoDe(lo[0] + z[0] * amp[0], lo[1] + z[1] * amp[1], lo[2] + z[2] * amp[2]);
    const proj = (z) => {
      for (let g = 0; g < 3; g++) z[g] = amp[g] > 0 ? (z[g] < 0 ? 0 : z[g] > 1 ? 1 : z[g]) : 0;
      return z;
    };
    const z0 = proj([0, 1, 2].map((g) => (amp[g] > 0 ? (melhor[g] - lo[g]) / amp[g] : 0)));
    const S = [z0];
    for (let g = 0; g < 3; g++) {
      const z = z0.slice();
      z[g] += z[g] > 0.5 ? -0.05 : 0.05;
      S.push(proj(z));
    }
    const F = S.map(f);
    let n = 4;
    const ordem = [0, 1, 2, 3];
    const ponto = (c, pior, t) => proj([0, 1, 2].map((g) => c[g] + t * (pior[g] - c[g])));
    while (n < avaliacoesRefino) {
      ordem.sort((a, b) => F[a] - F[b]);
      const Sa = ordem.map((i) => S[i]);
      const Fa = ordem.map((i) => F[i]);
      for (let k = 0; k < 4; k++) {
        S[k] = Sa[k];
        F[k] = Fa[k];
        ordem[k] = k;
      }
      let diam = 0;
      for (let k = 1; k < 4; k++) {
        for (let g = 0; g < 3; g++) diam = Math.max(diam, Math.abs(S[k][g] - S[0][g]));
      }
      if (diam < 1e-9) break;
      const c = [0, 1, 2].map((g) => (S[0][g] + S[1][g] + S[2][g]) / 3);
      const xr = ponto(c, S[3], -1);
      const fr = f(xr);
      n++;
      if (fr < F[0]) {
        const xe = ponto(c, S[3], -2);
        const fe = f(xe);
        n++;
        if (fe < fr) {
          S[3] = xe;
          F[3] = fe;
        } else {
          S[3] = xr;
          F[3] = fr;
        }
      } else if (fr < F[2]) {
        S[3] = xr;
        F[3] = fr;
      } else {
        const xc = fr < F[3] ? ponto(c, S[3], -0.5) : ponto(c, S[3], 0.5);
        const fc = f(xc);
        n++;
        if (fc < Math.min(fr, F[3])) {
          S[3] = xc;
          F[3] = fc;
        } else {
          for (let k = 1; k < 4; k++) {
            S[k] = proj(S[k].map((v, g) => S[0][g] + 0.5 * (v - S[0][g])));
            F[k] = f(S[k]);
            n++;
          }
        }
      }
    }
    let kMin = 0;
    for (let k = 1; k < 4; k++) if (F[k] < F[kMin]) kMin = k;
    const custoAG = melhorCusto;
    const melhorAG = { Kp: melhor[0], Ki: melhor[1], Kd: melhor[2] };
    if (F[kMin] < melhorCusto) {
      melhorCusto = F[kMin];
      for (let g = 0; g < 3; g++) melhor[g] = lo[g] + S[kMin][g] * amp[g];
    }
    refino = { avaliacoes: n, custoAG, melhorAG };
  }

  function resultado() {
    if (refinar && geracao >= nGen && !refino) refinarMelhor();
    const r = {
      melhor: { Kp: melhor[0], Ki: melhor[1], Kd: melhor[2] },
      custo: melhorCusto,
      historico: historico.slice(),
    };
    // Só quando o AG terminou e refinou: custo e ganhos antes do refino.
    if (refino) r.refino = { ...refino };
    return r;
  }

  return {
    proximaGeracao,
    resultado,
    get geracao() {
      return geracao;
    },
    get terminado() {
      return geracao >= nGen;
    },
    nGen,
  };
}

// Roda o AG inteiro de forma síncrona. aoGerar(info) recebe
// {geracao, melhorCusto, Kp, Ki, Kd} a cada geração (geracao de 1 a nGen).
// O refinamento roda depois da última geração, dentro de resultado(): os
// ganhos finais estão em resultado.melhor (o historico fica só com o AG).
export function otimizarPID({ aoGerar, ...parametros } = {}) {
  const ot = criarOtimizador(parametros);
  while (!ot.terminado) {
    const info = ot.proximaGeracao();
    if (aoGerar) aoGerar(info);
  }
  return ot.resultado();
}
