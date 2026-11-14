// agaovivo.js: seção "Sintonia por AG ao vivo" (item 8 do ESCOPO.md).
// Só interface: o AG é o de ga.js (gemeo_sim), rodando em ga.worker.js.
// O Worker termina em poucas centenas de milissegundos; a tela reproduz a
// convergência em cerca de 6 s (exibicaoag.js), mostra a etapa do
// refinamento local e, no fim, o ITAE da tabela (modo oráculo, dt 0,5 s).

import { LIMITES } from './ga.js';
import { simularOraculo } from './sim.js';
import { calcularIndices } from './metricas.js';
import { GANHOS } from './pid.js';
import { formatarNumero, formatarGanho } from './formato.js';
import { criarExibicao } from './exibicaoag.js';

const uPlot = globalThis.uPlot;
const $ = (id) => document.getElementById(id);

export const PARAMETROS_AG = { nPop: 120, nGen: 150, refinar: true };
export const SEMENTE_PI = 42;
// Tabela do ESCOPO.md (modo oráculo, dt 0,5 s, 1200 s).
export const REFERENCIA = {
  AG: { ITAE: 68265.58, sobressinal: 0 },
  IMC: { ITAE: 1032221.71, sobressinal: 0 },
};
export const ITAE_MAXIMO = 70000;
export const SOBRESSINAL_MAXIMO = 5;

export function sortearSemente() {
  return 1 + Math.floor(Math.random() * 999999);
}

// ITAE e sobressinal da tabela para um conjunto de ganhos.
export function indicesTabela({ K, tau, Kp, Ki, Kd }) {
  const s = simularOraculo({ K, tau, Kp, Ki, Kd, tFinal: 1200, dt: 0.5, setpoint: 50 });
  return calcularIndices(s.t, s.y, s.e, 50);
}

// Executor: o Worker de módulo ou, se ele não carregar, o mesmo AG na
// página em fatias de 8 ms (não trava a tela, só fica mais lento).
function criarExecutor(receber) {
  let worker = null;
  let local = null;
  let algumaMensagem = false;
  let ultimosParametros = null;

  function iniciarLocal(parametros) {
    let parar = false;
    let ativo = true;
    local = {
      parar() { parar = true; },
      encerrar() { ativo = false; },
    };
    import('./ga.js').then(({ criarOtimizador }) => {
      let ot;
      try {
        ot = criarOtimizador(parametros);
      } catch (erro) {
        receber({ tipo: 'erro', mensagem: erro.message });
        return;
      }
      const fatia = () => {
        if (!ativo) return;
        const inicio = performance.now();
        while (!ot.terminado && performance.now() - inicio < 8) {
          receber({ tipo: 'geracao', ...ot.proximaGeracao() });
        }
        if (parar) {
          receber({ tipo: 'parado', resultado: ot.resultado() });
        } else if (ot.terminado) {
          receber({ tipo: 'fim', resultado: ot.resultado() });
        } else {
          setTimeout(fatia, 0);
        }
      };
      setTimeout(fatia, 0);
    }).catch((erro) => receber({ tipo: 'erro', mensagem: erro.message }));
  }

  function aoFalharWorker() {
    if (worker) worker.terminate();
    worker = null;
    console.warn('ga.worker.js não carregou: o AG roda na própria página.');
    iniciarLocal(ultimosParametros);
  }

  return {
    iniciar(parametros) {
      ultimosParametros = parametros;
      try {
        worker = new Worker(new URL('./ga.worker.js', import.meta.url), { type: 'module' });
      } catch {
        worker = null;
      }
      if (!worker) {
        iniciarLocal(parametros);
        return;
      }
      worker.onmessage = (ev) => {
        algumaMensagem = true;
        receber(ev.data);
      };
      worker.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!algumaMensagem) aoFalharWorker();
        else receber({ tipo: 'erro', mensagem: (ev && ev.message) || 'falha no Worker' });
      };
      worker.postMessage({ tipo: 'iniciar', parametros });
    },
    parar() {
      if (worker) worker.postMessage({ tipo: 'parar' });
      if (local) local.parar();
    },
    encerrar() {
      if (worker) worker.terminate();
      if (local) local.encerrar();
      worker = null;
      local = null;
    },
    get naPagina() { return !!local; },
  };
}

function lerCores() {
  const css = getComputedStyle(document.body);
  const ler = (n) => css.getPropertyValue(n).trim();
  return {
    ag: ler('--cor-ag'), kp: ler('--cor-kp'), ki: ler('--cor-ki'), kd: ler('--cor-kd'),
    eixo: ler('--cor-eixo'), grade: ler('--cor-grade'),
  };
}

const emApresentacao = () => document.body.classList.contains('modo-apresentacao');
const celular = window.matchMedia('(max-width: 600px)');
const escuro = window.matchMedia('(prefers-color-scheme: dark)');

function eixosAg(cores, formatoY) {
  const comum = { stroke: cores.eixo, grid: { stroke: cores.grade, width: 1 }, ticks: { stroke: cores.grade, width: 1 } };
  if (emApresentacao() && !celular.matches) comum.font = '16px system-ui, sans-serif';
  return [
    { ...comum, values: (u, v) => v.map((x) => formatarNumero(x, 0)) },
    { ...comum, size: 70, values: (u, v) => v.map(formatoY) },
  ];
}

// ctx: { K, tau, aoAplicar(ganhos), aoVoltarPi(), aoFimApresentacao() }
export function criarAgAoVivo(ctx) {
  const dom = {
    secao: $('secao-ag'),
    limite: $('ag-limite-kp'),
    fixa: $('ag-semente-fixa'),
    btnSintonizar: $('btn-ag-sintonizar'),
    btnParar: $('btn-ag-parar'),
    btnPular: $('btn-ag-pular'),
    btnAplicar: $('btn-ag-aplicar'),
    btnVoltar: $('btn-ag-voltar-pi'),
    status: $('ag-status'),
    geracao: $('ag-geracao'),
    semente: $('ag-semente'),
    custo: $('ag-custo'),
    kp: $('ag-kp'),
    ki: $('ag-ki'),
    kd: $('ag-kd'),
    ti: $('ag-ti'),
    tempoWorker: $('ag-tempo-worker'),
    refino: $('ag-refino'),
    refinoTexto: $('ag-refino-texto'),
    refinoBarra: $('ag-refino-barra'),
    final: $('ag-final'),
    finalTabela: $('ag-final-tabela'),
    criterio: $('ag-criterio'),
    malha: $('ag-malha'),
    elCusto: $('grafico-ag-custo'),
    elGanhos: $('grafico-ag-ganhos'),
  };

  const nGen = PARAMETROS_AG.nGen;
  const eixoX = Array.from({ length: nGen }, (_, i) => i + 1);
  const yCusto = new Array(nGen).fill(null);
  const yKp = new Array(nGen).fill(null);
  const yKi = new Array(nGen).fill(null);
  const yKd = new Array(nGen).fill(null);
  const dadosCusto = [eixoX, yCusto];
  const dadosGanhos = [eixoX, yKp, yKi, yKd];
  let gCusto = null;
  let gGanhos = null;

  // Estado da execução corrente.
  let exec = 0;
  let executor = null;
  let exib = null;
  let historico = [];
  let mostradas = 0;
  let resultado = null;
  let indices = null;
  let lim = null;
  let semente = SEMENTE_PI;
  let tInicio = 0;
  let msWorker = 0;
  let idQuadro = 0;
  let autoAplicar = false;
  let rodando = false;

  function largura(el) {
    return Math.max(200, Math.floor(el.clientWidth));
  }

  function alturas() {
    if (emApresentacao() && !celular.matches) return { custo: 240, ganhos: 150 };
    return celular.matches ? { custo: 180, ganhos: 140 } : { custo: 220, ganhos: 160 };
  }

  function montarGraficos() {
    if (typeof uPlot !== 'function') return;
    if (gCusto) gCusto.destroy();
    if (gGanhos) gGanhos.destroy();
    const cores = lerCores();
    const h = alturas();
    const larg = emApresentacao() ? 3 : 2;
    gCusto = new uPlot({
      width: largura(dom.elCusto),
      height: h.custo,
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false, range: [1, nGen] }, y: { distr: 3 } },
      axes: eixosAg(cores, (x) => formatarNumero(x, 0)),
      series: [
        { label: 'Geração', value: (u, v) => (v == null ? '' : formatarNumero(v, 0)) },
        { label: 'Melhor aptidão', stroke: cores.ag, width: larg, value: (u, v) => (v == null ? '' : formatarNumero(v, 0)) },
      ],
    }, dadosCusto, dom.elCusto);
    const pct = (u, v) => (v == null ? '' : `${formatarNumero(v, 0)}%`);
    gGanhos = new uPlot({
      width: largura(dom.elGanhos),
      height: h.ganhos,
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false, range: [1, nGen] }, y: { range: [0, 100] } },
      axes: eixosAg(cores, (x) => `${formatarNumero(x, 0)}%`),
      series: [
        { label: 'Geração', value: (u, v) => (v == null ? '' : formatarNumero(v, 0)) },
        { label: 'Kp', stroke: cores.kp, width: larg, value: pct },
        { label: 'Ki', stroke: cores.ki, width: larg, value: pct },
        { label: 'Kd', stroke: cores.kd, width: larg, dash: [6, 4], value: pct },
      ],
    }, dadosGanhos, dom.elGanhos);
  }

  function redimensionar() {
    if (!gCusto) return;
    const h = alturas();
    gCusto.setSize({ width: largura(dom.elCusto), height: h.custo });
    gGanhos.setSize({ width: largura(dom.elGanhos), height: h.ganhos });
  }

  function texto(el, t) {
    if (el && el.textContent !== t) el.textContent = t;
  }

  function status(t) {
    texto(dom.status, t);
  }

  function limparSeries() {
    yCusto.fill(null);
    yKp.fill(null);
    yKi.fill(null);
    yKd.fill(null);
    mostradas = 0;
    if (gCusto) {
      gCusto.setData(dadosCusto);
      gGanhos.setData(dadosGanhos);
    }
  }

  function pctFaixa(v, faixa) {
    const a = faixa[1] - faixa[0];
    return a > 0 ? ((v - faixa[0]) / a) * 100 : 0;
  }

  function mostrarGanhosTexto(g) {
    texto(dom.kp, formatarGanho(g.Kp));
    texto(dom.ki, `${formatarGanho(g.Ki)} 1/s`);
    texto(dom.kd, `${formatarGanho(g.Kd)} s`);
    texto(dom.ti, g.Ki > 0 ? `${formatarNumero(g.Kp / g.Ki, 1)} s` : 'sem integral');
  }

  // Copia as gerações novas para as séries (sem alocar) e atualiza o texto.
  function revelar(ate) {
    if (ate <= mostradas) return;
    for (let i = mostradas; i < ate; i++) {
      const h = historico[i];
      yCusto[i] = h.melhorCusto;
      yKp[i] = pctFaixa(h.Kp, lim.Kp);
      yKi[i] = pctFaixa(h.Ki, lim.Ki);
      yKd[i] = pctFaixa(h.Kd, lim.Kd);
    }
    mostradas = ate;
    const h = historico[ate - 1];
    texto(dom.geracao, `${formatarNumero(h.geracao, 0)} de ${formatarNumero(nGen, 0)}`);
    texto(dom.custo, formatarNumero(h.melhorCusto, 0));
    mostrarGanhosTexto(h);
    if (gCusto) {
      gCusto.setData(dadosCusto);
      gGanhos.setData(dadosGanhos);
    }
  }

  function botoes(fase) {
    // fase: 'parado', 'rodando', 'final'
    dom.btnSintonizar.disabled = false;
    dom.btnSintonizar.textContent = fase === 'rodando' ? 'Sintonizar de novo' : 'Sintonizar';
    dom.btnParar.disabled = fase !== 'rodando';
    dom.btnPular.disabled = fase !== 'rodando';
    dom.btnAplicar.disabled = fase !== 'final';
  }

  function mostrarRefino(progresso) {
    const r = resultado.refino;
    dom.refino.hidden = false;
    if (dom.refinoBarra) dom.refinoBarra.value = progresso;
    if (!r) {
      texto(dom.refinoTexto, 'Refinamento local desligado nesta execução.');
      return;
    }
    const antes = formatarNumero(r.custoAG, 0);
    const depois = formatarNumero(resultado.custo, 0);
    const melhorou = resultado.custo < r.custoAG;
    texto(dom.refinoTexto, melhorou
      ? `Aptidão no fim do AG: ${antes}. Depois do Nelder-Mead (${formatarNumero(r.avaliacoes, 0)} avaliações): ${depois}.`
      : `Aptidão no fim do AG: ${antes}. O Nelder-Mead (${formatarNumero(r.avaliacoes, 0)} avaliações) não achou nada melhor perto dali.`);
  }

  function celula(t, classe) {
    const td = document.createElement('td');
    td.textContent = t;
    if (classe) td.className = classe;
    return td;
  }

  function linha(rotulo, valores) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = rotulo;
    tr.appendChild(th);
    for (const v of valores) tr.appendChild(celula(v));
    return tr;
  }

  function mostrarFinal() {
    const g = resultado.melhor;
    const pi = GANHOS.AG;
    const imc = GANHOS.IMC;
    const tb = dom.finalTabela;
    tb.replaceChildren(
      linha('ITAE (%·s²)', [formatarNumero(indices.ITAE, 2), formatarNumero(REFERENCIA.AG.ITAE, 2), formatarNumero(REFERENCIA.IMC.ITAE, 2)]),
      linha('Sobressinal', [`${formatarNumero(indices.sobressinal, 2)}%`, '0,00%', '0,00%']),
      linha('Kp', [formatarGanho(g.Kp), formatarGanho(pi.Kp), formatarGanho(imc.Kp)]),
      linha('Ki (1/s)', [formatarGanho(g.Ki), formatarGanho(pi.Ki), formatarGanho(imc.Ki)]),
      linha('Kd (s)', [formatarGanho(g.Kd), formatarGanho(pi.Kd), formatarGanho(imc.Kd)]),
    );
    const ok = indices.ITAE <= ITAE_MAXIMO && indices.sobressinal <= SOBRESSINAL_MAXIMO;
    texto(dom.criterio, ok
      ? `Critério do escopo cumprido: ITAE até ${formatarNumero(ITAE_MAXIMO, 0)} e sobressinal até 5%.`
      : `Critério do escopo não cumprido nesta semente (ITAE até ${formatarNumero(ITAE_MAXIMO, 0)} e sobressinal até 5%). Tente de novo.`);
    dom.criterio.dataset.estado = ok ? 'vitoria' : 'neutro';
    dom.final.hidden = false;
    mostrarGanhosTexto(g);
    texto(dom.custo, formatarNumero(resultado.custo, 0));
    texto(dom.geracao, `${formatarNumero(nGen, 0)} de ${formatarNumero(nGen, 0)}, refinado`);
  }

  function pararQuadros() {
    if (idQuadro) cancelAnimationFrame(idQuadro);
    idQuadro = 0;
  }

  function quadro(agora) {
    idQuadro = requestAnimationFrame(quadro);
    const e = exib.quadro(agora / 1000);
    revelar(e.visiveis);
    if (e.fase === 'refino') {
      if (e.mudouFase) status('Refinamento local (Nelder-Mead): parte do melhor do AG e procura em volta.');
      mostrarRefino(e.progressoRefino);
    } else if (e.fase === 'final') {
      pararQuadros();
      rodando = false;
      mostrarRefino(1);
      mostrarFinal();
      botoes('final');
      const ok = indices.ITAE <= ITAE_MAXIMO;
      status(`Pronto: ITAE ${formatarNumero(indices.ITAE, 0)} na tabela (dt 0,5 s), contra ${formatarNumero(REFERENCIA.AG.ITAE, 0)} do AG do PI e ${formatarNumero(REFERENCIA.IMC.ITAE, 0)} do IMC.${ok ? '' : ' Acima de 70.000: rode de novo.'}`);
      if (autoAplicar) {
        autoAplicar = false;
        aplicar();
        if (ctx.aoFimApresentacao) ctx.aoFimApresentacao();
      }
    }
  }

  function receber(id, msg) {
    if (id !== exec || !msg) return;
    switch (msg.tipo) {
      case 'geracao':
        historico.push(msg);
        exib.receberGeracao(msg.geracao);
        break;
      case 'fim':
        msWorker = performance.now() - tInicio;
        resultado = msg.resultado;
        indices = indicesTabela({ K: ctx.K, tau: ctx.tau, ...resultado.melhor });
        exib.receberFim();
        executor.encerrar();
        texto(dom.tempoWorker, `O AG levou ${formatarNumero(msWorker, 0)} ms ${executor.naPagina ? 'na página' : 'no Worker'}; a tela reproduz a convergência em cerca de 6 s para dar para acompanhar.`);
        break;
      case 'parado':
        executor.encerrar();
        break;
      case 'erro':
        pararQuadros();
        rodando = false;
        executor.encerrar();
        botoes('parado');
        status(`O AG falhou: ${msg.mensagem}`);
        break;
      default:
        break;
    }
  }

  function sintonizar(opcoes = {}) {
    if (executor) executor.encerrar();
    pararQuadros();
    exec++;
    const id = exec;
    autoAplicar = !!opcoes.autoAplicar;
    const limKp = Number(dom.limite.value) || LIMITES.Kp[1];
    lim = { ...LIMITES, Kp: [LIMITES.Kp[0], limKp] };
    semente = dom.fixa.checked ? SEMENTE_PI : sortearSemente();
    historico = [];
    resultado = null;
    indices = null;
    limparSeries();
    dom.refino.hidden = true;
    dom.final.hidden = true;
    texto(dom.semente, dom.fixa.checked ? `${semente} (fixa, a do PI)` : `${semente} (sorteada)`);
    texto(dom.geracao, 'aguardando');
    texto(dom.custo, 'aguardando');
    texto(dom.tempoWorker, '');
    status(`Rodando o AG: população de ${PARAMETROS_AG.nPop}, ${nGen} gerações, Kp até ${formatarNumero(limKp, 1)}, semente ${semente}.`);
    botoes('rodando');
    rodando = true;
    exib = criarExibicao({ total: nGen });
    executor = criarExecutor((msg) => receber(id, msg));
    tInicio = performance.now();
    executor.iniciar({
      ...PARAMETROS_AG,
      seed: semente,
      K: ctx.K,
      tau: ctx.tau,
      limites: { Kp: lim.Kp },
    });
    idQuadro = requestAnimationFrame(quadro);
  }

  function parar() {
    if (!rodando) return;
    rodando = false;
    autoAplicar = false;
    pararQuadros();
    if (executor) executor.parar();
    exec++; // ignora o que ainda chegar desta execução
    const executorAntigo = executor;
    setTimeout(() => executorAntigo && executorAntigo.encerrar(), 500);
    botoes('parado');
    status(mostradas > 0
      ? `Sintonia interrompida na geração ${mostradas} de ${nGen}. Nada foi aplicado à malha laranja.`
      : 'Sintonia interrompida. Nada foi aplicado à malha laranja.');
  }

  function aplicar() {
    if (!resultado) return;
    ctx.aoAplicar({ ...resultado.melhor });
  }

  // Texto sobre os ganhos em uso na malha laranja (chamado por app.js).
  function mostrarMalha(origem, g) {
    const ganhos = `Kp ${formatarGanho(g.Kp)}, Ki ${formatarGanho(g.Ki)} 1/s, Kd ${formatarGanho(g.Kd)} s`;
    texto(dom.malha, origem === 'pi'
      ? `Malha laranja com os ganhos do AG do PI: ${ganhos}.`
      : `Malha laranja com os ganhos do AG ao vivo: ${ganhos}.`);
  }

  dom.btnSintonizar.addEventListener('click', () => sintonizar());
  dom.btnParar.addEventListener('click', parar);
  dom.btnPular.addEventListener('click', () => exib && exib.pular());
  dom.btnAplicar.addEventListener('click', aplicar);
  dom.btnVoltar.addEventListener('click', () => ctx.aoVoltarPi());

  montarGraficos();
  if (typeof ResizeObserver === 'function') {
    let pendente = false;
    new ResizeObserver(() => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => {
        pendente = false;
        redimensionar();
      });
    }).observe(dom.elCusto);
  }
  celular.addEventListener('change', redimensionar);
  escuro.addEventListener('change', montarGraficos);
  botoes('parado');

  return {
    sintonizar,
    parar,
    mostrarMalha,
    remontar: montarGraficos,
    redimensionar,
    get rodando() { return rodando; },
  };
}
