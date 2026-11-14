// exportar_fase2.mjs: roda os cenários da fase 2 (AG, Worker, estabilidade, pid.passo)
// com os módulos JS e imprime JSON. Chamado por validacao/paridade.py.
// Entrada (stdin): { estab: [{nome, K, tau, Kp, Ki, Kd, N, theta, filtro}], seeds: [...] }
// Somente importa os módulos de assets/js, nunca os altera.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PLANTA, simularOraculo, simularFisico } from '../assets/js/sim.js';
import { criarPID, GANHOS } from '../assets/js/pid.js';
import { calcularIndices } from '../assets/js/metricas.js';
import { otimizarPID, LIMITES } from '../assets/js/ga.js';
import { polinomio, raizes, routh, margens, analisar } from '../assets/js/estabilidade.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const entrada = JSON.parse(readFileSync(0, 'utf8') || '{}');
const arr = (x) => Array.from(x);
const { K, tau } = PLANTA;
const saida = {};

// ---------- 8: AG ----------
function avaliar(g) {
  const s = simularOraculo({ K, tau, Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, tFinal: 1200, dt: 0.5, setpoint: 50 });
  return calcularIndices(s.t, s.y, s.e, 50);
}
function rodarAG(params) {
  const t0 = performance.now();
  const r = otimizarPID(params);
  const ms = performance.now() - t0;
  return { melhor: r.melhor, custo: r.custo, ms, indices: avaliar(r.melhor), historico: r.historico.map((h) => h.melhorCusto), refino: r.refino ?? null };
}
saida.ag = {
  padrao: rodarAG({ seed: 42 }),
  padraoSemRefino: rodarAG({ seed: 42, refinar: false }),
  grande: rodarAG({ seed: 42, nPop: 120, nGen: 150 }),
  grandeSemRefino: rodarAG({ seed: 42, nPop: 120, nGen: 150, refinar: false }),
  sementes: (entrada.seeds || []).map((seed) => ({ seed, ...rodarAG({ seed, nPop: 120, nGen: 150 }) })),
  limites: LIMITES,
};

// ---------- 9: Worker (worker_threads com adaptador) ----------
function sessaoWorker(passos) {
  // passos(w, msgs, fim): reage a cada mensagem; chama fim() ao concluir.
  return new Promise((resolve) => {
    const w = new Worker(join(aqui, 'adaptador_worker.mjs'));
    const msgs = [];
    const limite = setTimeout(() => { msgs.push({ tipo: 'TEMPO_ESGOTADO' }); w.terminate(); resolve(msgs); }, 30000);
    const fim = () => { clearTimeout(limite); w.terminate().then(() => resolve(msgs)); };
    w.on('message', (m) => { msgs.push(m); passos(w, m, msgs, fim); });
    w.on('error', (e) => { msgs.push({ tipo: 'FALHA_THREAD', mensagem: String(e) }); fim(); });
  });
}
const resumo = (msgs) => ({
  tipos: msgs.map((m) => m.tipo),
  nGeracao: msgs.filter((m) => m.tipo === 'geracao').length,
  geracoes: msgs.filter((m) => m.tipo === 'geracao').map((m) => m.geracao),
  custos: msgs.filter((m) => m.tipo === 'geracao').map((m) => m.melhorCusto),
  ultimo: msgs[msgs.length - 1],
});
saida.worker = {};
{
  const params = { seed: 7, nPop: 60, nGen: 80 };
  let ini = 0;
  const msgs = await sessaoWorker((w, m, ms, fim) => {
    if (m.tipo === 'pronto') { ini = performance.now(); w.postMessage({ tipo: 'iniciar', parametros: params }); }
    if (m.tipo === 'fim') fim();
  });
  saida.worker.completo = { ...resumo(msgs), ms: performance.now() - ini, direto: otimizarPID(params) };
}
{
  let parou = false;
  const msgs = await sessaoWorker((w, m, ms, fim) => {
    if (m.tipo === 'pronto') w.postMessage({ tipo: 'iniciar', parametros: { seed: 7, nPop: 120, nGen: 5000 } });
    if (m.tipo === 'geracao' && !parou && m.geracao >= 3) { parou = true; w.postMessage({ tipo: 'parar' }); }
    if (m.tipo === 'parado' || m.tipo === 'fim') fim();
  });
  saida.worker.parar = resumo(msgs);
}
{
  const msgs = await sessaoWorker((w, m, ms, fim) => {
    if (m.tipo === 'pronto') w.postMessage({ tipo: 'parar' });
    if (m.tipo === 'parado') fim();
  });
  saida.worker.pararOcioso = resumo(msgs);
}
{
  const msgs = await sessaoWorker((w, m, ms, fim) => {
    if (m.tipo === 'pronto') w.postMessage({ tipo: 'iniciar', parametros: { limites: { Kp: [2, 1] } } });
    if (m.tipo === 'erro') fim();
  });
  saida.worker.erroLimites = resumo(msgs);
}
{
  const msgs = await sessaoWorker((w, m, ms, fim) => {
    if (m.tipo === 'pronto') w.postMessage({ tipo: 'dancar' });
    if (m.tipo === 'erro') fim();
  });
  saida.worker.erroMensagem = resumo(msgs);
}
{
  // reiniciar durante a execução: o segundo iniciar substitui o primeiro
  let enviado = false;
  const msgs = await sessaoWorker((w, m, ms, fim) => {
    if (m.tipo === 'pronto') w.postMessage({ tipo: 'iniciar', parametros: { seed: 1, nPop: 120, nGen: 3000 } });
    if (m.tipo === 'geracao' && !enviado && m.geracao >= 3) {
      enviado = true;
      w.postMessage({ tipo: 'iniciar', parametros: { seed: 2, nPop: 20, nGen: 10 } });
    }
    if (m.tipo === 'fim' || m.tipo === 'parado' || m.tipo === 'erro') fim();
  });
  saida.worker.substituir = { ...resumo(msgs), geracoesMax: Math.max(...msgs.filter((m) => m.tipo === 'geracao').map((m) => m.geracao)) };
}

// ---------- 10: estabilidade ----------
saida.estab = (entrada.estab || []).map((c) => {
  const p = { K: c.K, tau: c.tau, Kp: c.Kp, Ki: c.Ki, Kd: c.Kd, N: c.N ?? 10, theta: c.theta, filtro: c.filtro };
  const coefs = polinomio(p);
  const polos = raizes(coefs);
  const r = routh(coefs);
  const mg = margens(p);
  const an = analisar(p);
  return {
    nome: c.nome, coefs: arr(coefs), polos, routhEstavel: r.estavel, routhAvisos: r.avisos,
    margens: mg, analisarEstavel: an.routh.estavel, avisos: an.avisos,
  };
});
// Simulação física com o atraso exato (AG): decaimento do erro em janelas.
saida.fisicoTheta = {};
for (const th of entrada.thetasFisico || []) {
  const s = simularFisico({ ganhos: GANHOS.AG, setpoint: 50, tFinal: 12000, dt: 0.5, theta: th });
  const amp = (a, b) => {
    let m = 0;
    for (let i = Math.round(a / 0.5); i < Math.round(b / 0.5); i++) m = Math.max(m, Math.abs(s.y[i] - 50));
    return m;
  };
  saida.fisicoTheta[th] = { amp1: amp(3000, 4500), amp2: amp(6000, 7500), amp3: amp(10500, 12000), yMin: Math.min(...s.y), yMax: Math.max(...s.y) };
}

// ---------- 11: pid.passo reaproveitado ----------
saida.pid = {};
for (const modo of ['oraculo', 'fisico']) {
  const pid = criarPID({ ...GANHOS.AG, bias: modo === 'fisico' ? PLANTA.u0 : 0, modo });
  const refs = [];
  const valores = [];
  let y = modo === 'fisico' ? PLANTA.y0 : 0;
  for (let i = 0; i < 5; i++) {
    const r = pid.passo({ setpoint: 50, y, dt: 0.5 });
    refs.push(r);
    valores.push({ u: r.u, uCalc: r.uCalc, e: r.e });
    y += 1.5;
  }
  const outro = criarPID({ ...GANHOS.IMC, bias: 0, modo });
  const ro = outro.passo({ setpoint: 50, y: 0, dt: 0.5 });
  saida.pid[modo] = {
    mesmaRef: refs.every((r) => r === refs[0]),
    valoresMudam: new Set(valores.map((v) => v.e)).size === 5,
    ultimoIgual: refs[0].e === valores[4].e && refs[0].u === valores[4].u,
    camposOk: ['u', 'uCalc', 'e'].every((k) => Number.isFinite(refs[0][k])),
    instanciasIndependentes: ro !== refs[0],
  };
}

process.stdout.write(JSON.stringify(saida));
