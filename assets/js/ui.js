// ui.js: DOM, formatação pt-BR e gráficos uPlot.
// Não contém matemática da simulação. O estado e o laço ficam em app.js.

import { formatarNumero, formatarGanho } from './formato.js';
import { criarTanque } from './tanque.js';

export { formatarNumero };

const uPlot = globalThis.uPlot;

// Metricas exibidas: chave do objeto de MetricasAoVivo.valores(), casas e sufixo.
const METRICAS = [
  { chave: 'IAE', casas: 1, sufixo: '' },
  { chave: 'ITAE', casas: 0, sufixo: '' },
  { chave: 'ISE', casas: 1, sufixo: '' },
  { chave: 'sobressinal', casas: 2, sufixo: '%' },
  { chave: 'tempoSubida', casas: 1, sufixo: ' s' },
  { chave: 'tempoAcomodacao', casas: 1, sufixo: ' s' },
];

// Faixas dos sliders do modo manual. Posição do slider de 0 a 1000.
// Kp e Ki em escala logarítmica; Kd = max * s², com resolução perto de 0.
const FAIXAS = {
  Kp: { tipo: 'log', min: 0.01, max: 5 },
  Ki: { tipo: 'log', min: 0.00001, max: 0.05 },
  Kd: { tipo: 'quad', min: 0, max: 20 },
};
const PASSOS = 1000;

function posParaGanho(nome, pos) {
  const f = FAIXAS[nome];
  const s = pos / PASSOS;
  if (f.tipo === 'log') {
    const a = Math.log10(f.min);
    const b = Math.log10(f.max);
    return 10 ** (a + s * (b - a));
  }
  return f.max * s * s;
}

function ganhoParaPos(nome, v) {
  const f = FAIXAS[nome];
  let s;
  if (f.tipo === 'log') {
    const a = Math.log10(f.min);
    const b = Math.log10(f.max);
    s = (Math.log10(Math.max(f.min, Math.min(f.max, v))) - a) / (b - a);
  } else {
    s = Math.sqrt(Math.max(0, Math.min(f.max, v)) / f.max);
  }
  return Math.round(s * PASSOS);
}

// Escreve texto só quando muda, para não tocar no DOM à toa.
const ultimoTexto = new WeakMap();
function escrever(el, texto) {
  if (!el || ultimoTexto.get(el) === texto) return;
  el.textContent = texto;
  ultimoTexto.set(el, texto);
}

const $ = (id) => document.getElementById(id);

// Referências do DOM, buscadas uma vez.
const dom = {};
function carregarDom() {
  dom.status = $('status');
  dom.setpoint = $('setpoint');
  dom.setpointValor = $('setpoint-valor');
  dom.avisoFaixa = $('aviso-faixa');
  dom.velocidades = $('velocidades');
  dom.btnPausa = $('btn-pausa');
  dom.btnReiniciar = $('btn-reiniciar');
  dom.tempo = $('tempo');
  dom.tempoApresentacao = $('tempo-apresentacao');
  dom.btnsPausa = document.querySelectorAll('[data-pausa]');
  dom.btnExportar = $('btn-exportar');
  dom.exportarStatus = $('exportar-status');
  dom.fps = $('fps');
  dom.carga = $('carga');
  dom.cargaValor = $('carga-valor');
  dom.cargaAplicada = $('carga-aplicada');
  dom.btnCarga = $('btn-carga');
  dom.btnCargaZerar = $('btn-carga-zerar');
  dom.ruido = $('ruido');
  dom.sigma = $('sigma');
  dom.theta = $('theta');
  dom.thetaValor = $('theta-valor');
  dom.manual = $('manual');
  dom.manualControles = $('manual-controles');
  dom.btnGanhosImc = $('btn-ganhos-imc');
  dom.ganhos = {
    Kp: { input: $('kp'), saida: $('kp-valor') },
    Ki: { input: $('ki'), saida: $('ki-valor') },
    Kd: { input: $('kd'), saida: $('kd-valor') },
  };
  dom.dueloManual = $('duelo-manual');
  dom.dueloAg = $('duelo-ag');
  dom.dueloMsg = $('duelo-msg');
  dom.nomesMalha1 = document.querySelectorAll('.nome-malha1');
  dom.metricas = {};
  dom.atuais = {};
  dom.leituras = {};
  for (const ctrl of ['IMC', 'AG']) {
    dom.metricas[ctrl] = {};
    for (const m of METRICAS) dom.metricas[ctrl][m.chave] = $(`m-${ctrl}-${m.chave}`);
    dom.atuais[ctrl] = { y: $(`atual-${ctrl}-y`), u: $(`atual-${ctrl}-u`) };
    dom.leituras[ctrl] = { y: $(`tq-${ctrl}-y`), u: $(`tq-${ctrl}-u`), q: $(`tq-${ctrl}-q`) };
  }
}

export function mostrarStatus(mensagem, erro = false) {
  if (!dom.status) carregarDom();
  dom.status.hidden = false;
  dom.status.classList.toggle('erro', erro);
  dom.status.textContent = mensagem;
}

export function esconderStatus() {
  if (!dom.status) carregarDom();
  dom.status.hidden = true;
}

// Liga os controles aos tratadores de app.js.
export function ligarControles(t) {
  if (!dom.status) carregarDom();

  dom.setpoint.addEventListener('input', () => {
    const sp = Number(dom.setpoint.value);
    mostrarSetpoint(sp);
    t.aoMudarSetpoint(sp);
  });

  dom.velocidades.addEventListener('click', (ev) => {
    const botao = ev.target.closest('button[data-velocidade]');
    if (!botao) return;
    const v = Number(botao.dataset.velocidade);
    mostrarVelocidade(v);
    t.aoMudarVelocidade(v);
  });

  dom.btnPausa.addEventListener('click', () => t.aoAlternarPausa());
  dom.btnReiniciar.addEventListener('click', () => t.aoReiniciar());

  // Perturbações
  dom.carga.addEventListener('input', () => mostrarCargaEscolhida(Number(dom.carga.value)));
  dom.btnCarga.addEventListener('click', () => t.aoAplicarCarga(Number(dom.carga.value)));
  dom.btnCargaZerar.addEventListener('click', () => {
    dom.carga.value = '0';
    mostrarCargaEscolhida(0);
    t.aoAplicarCarga(0);
  });
  dom.ruido.addEventListener('change', () => t.aoAlternarRuido(dom.ruido.checked));
  dom.theta.addEventListener('input', () => {
    const th = Number(dom.theta.value);
    mostrarTheta(th);
    t.aoMudarTheta(th);
  });

  // Modo manual
  dom.manual.addEventListener('change', () => {
    dom.manualControles.hidden = !dom.manual.checked;
    t.aoAlternarManual(dom.manual.checked);
  });
  for (const nome of Object.keys(dom.ganhos)) {
    const { input } = dom.ganhos[nome];
    input.addEventListener('input', () => {
      const v = posParaGanho(nome, Number(input.value));
      mostrarGanho(nome, v, false);
      t.aoMudarGanho(nome, v);
    });
  }
  dom.btnGanhosImc.addEventListener('click', () => t.aoGanhosImc());
  dom.btnExportar.addEventListener('click', () => t.aoExportar());

  mostrarCargaEscolhida(Number(dom.carga.value));
  mostrarTheta(Number(dom.theta.value));
  dom.manualControles.hidden = !dom.manual.checked;

  return {
    setpoint: Number(dom.setpoint.value),
    velocidade: lerVelocidadeMarcada(),
    carga: 0,
    ruido: dom.ruido.checked,
    theta: Number(dom.theta.value),
    manual: dom.manual.checked,
  };
}

function lerVelocidadeMarcada() {
  const b = dom.velocidades.querySelector('button[aria-pressed="true"]');
  return b ? Number(b.dataset.velocidade) : 1;
}

function sinal(v, casas) {
  return `${v > 0 ? '+' : ''}${formatarNumero(v, casas)}`;
}

export function mostrarSetpoint(sp) {
  escrever(dom.setpointValor, `${formatarNumero(sp, 0)}%`);
  dom.avisoFaixa.hidden = sp >= 15 && sp <= 75;
}

export function mostrarVelocidade(v) {
  for (const b of dom.velocidades.querySelectorAll('button[data-velocidade]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.velocidade) === v));
  }
}

export function mostrarPausa(pausado) {
  for (const b of dom.btnsPausa) escrever(b, pausado ? 'Continuar' : 'Pausar');
}

export function mostrarTempo(t) {
  const texto = `${formatarNumero(t, 0)} s`;
  escrever(dom.tempo, texto);
  escrever(dom.tempoApresentacao, texto);
}

export function mostrarExportacao(mensagem) {
  escrever(dom.exportarStatus, mensagem);
}

// Ajustes dos controles feitos pelo roteiro da apresentação. Só mexem no
// DOM; app.js chama em seguida o mesmo tratador que o controle chamaria.
export function ajustarSetpoint(sp) {
  dom.setpoint.value = String(sp);
  mostrarSetpoint(sp);
}

export function ajustarCarga(d) {
  dom.carga.value = String(d);
  mostrarCargaEscolhida(d);
}

export function ajustarTheta(th) {
  dom.theta.value = String(th);
  mostrarTheta(th);
}

export function ajustarManual(ligado) {
  dom.manual.checked = ligado;
  dom.manualControles.hidden = !ligado;
}

export function mostrarFps(fps) {
  escrever(dom.fps, fps > 0 ? `(${formatarNumero(fps, 0)} fps)` : '');
}

function mostrarCargaEscolhida(d) {
  const texto = `${sinal(d, 0)}%`;
  escrever(dom.cargaValor, texto);
  dom.carga.setAttribute('aria-valuetext', texto);
}

export function mostrarCargaAplicada(d) {
  escrever(dom.cargaAplicada, `Carga aplicada: ${sinal(d, 0)}%.`);
}

// Usado no reiniciar: slider e texto voltam a 0.
export function zerarCarga() {
  dom.carga.value = '0';
  mostrarCargaEscolhida(0);
  mostrarCargaAplicada(0);
}

function mostrarTheta(th) {
  const texto = `${formatarNumero(th, 0)} s`;
  escrever(dom.thetaValor, texto);
  dom.theta.setAttribute('aria-valuetext', texto);
}

export function mostrarSigma(sigma) {
  escrever(dom.sigma, formatarNumero(sigma, 2));
}

// Mostra um ganho; moverSlider = false quando a mudança veio do próprio slider.
function mostrarGanho(nome, v, moverSlider) {
  const { input, saida } = dom.ganhos[nome];
  const texto = formatarGanho(v);
  escrever(saida, texto);
  input.setAttribute('aria-valuetext', texto);
  if (moverSlider) input.value = String(ganhoParaPos(nome, v));
}

export function mostrarGanhosManual(g) {
  mostrarGanho('Kp', g.Kp, true);
  mostrarGanho('Ki', g.Ki, true);
  mostrarGanho('Kd', g.Kd, true);
}

// Nome da malha azul: 'IMC' ou 'Manual'.
export function nomearMalha1(nome, graficos) {
  for (const el of dom.nomesMalha1) escrever(el, nome);
  if (graficos) graficos.nomearMalha1(nome);
}

// estado: 'vitoria', 'derrota' ou 'neutro'.
export function atualizarDuelo(itaeManual, itaeAg, mensagem, estado) {
  escrever(dom.dueloManual, formatarNumero(itaeManual, 0));
  escrever(dom.dueloAg, formatarNumero(itaeAg, 0));
  escrever(dom.dueloMsg, mensagem);
  if (dom.dueloMsg.dataset.estado !== estado) dom.dueloMsg.dataset.estado = estado;
}

// imc e ag: objetos de MetricasAoVivo.valores().
export function atualizarMetricas(imc, ag) {
  for (let i = 0; i < 2; i++) {
    const ctrl = i === 0 ? 'IMC' : 'AG';
    const valores = i === 0 ? imc : ag;
    if (!valores) continue;
    for (const m of METRICAS) {
      const v = valores[m.chave];
      const texto = v == null || !Number.isFinite(v)
        ? 'em curso'
        : formatarNumero(v, m.casas) + m.sufixo;
      escrever(dom.metricas[ctrl][m.chave], texto);
    }
  }
}

// Valores numéricos da tabela e das leituras dos tanques.
export function atualizarAtuais(ctrl, y, u, q) {
  const ty = `${formatarNumero(y, 2)}%`;
  const tu = `${formatarNumero(u, 2)}%`;
  escrever(dom.atuais[ctrl].y, ty);
  escrever(dom.atuais[ctrl].u, tu);
  escrever(dom.leituras[ctrl].y, ty);
  escrever(dom.leituras[ctrl].u, tu);
  escrever(dom.leituras[ctrl].q, `${formatarNumero(q, 1)}%`);
}

export function criarTanques() {
  return {
    IMC: criarTanque($('tanque-IMC'), { classe: 'imc' }),
    AG: criarTanque($('tanque-AG'), { classe: 'ag' }),
  };
}

// Abas acessíveis (setas esquerda e direita, Home e End).
export function ligarAbas(aoMudarAba) {
  const lista = $('abas');
  const abas = Array.from(lista.querySelectorAll('[role="tab"]'));
  function selecionar(aba, focar) {
    for (const a of abas) {
      const ativa = a === aba;
      a.setAttribute('aria-selected', String(ativa));
      a.tabIndex = ativa ? 0 : -1;
      $(a.getAttribute('aria-controls')).hidden = !ativa;
    }
    if (focar) aba.focus();
    aoMudarAba(aba.id === 'aba-dados' ? 'dados' : 'sim');
  }
  lista.addEventListener('click', (ev) => {
    const aba = ev.target.closest('[role="tab"]');
    if (aba) selecionar(aba, false);
  });
  lista.addEventListener('keydown', (ev) => {
    const i = abas.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (ev.key === 'ArrowRight') j = (i + 1) % abas.length;
    else if (ev.key === 'ArrowLeft') j = (i - 1 + abas.length) % abas.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = abas.length - 1;
    if (j < 0) return;
    ev.preventDefault();
    selecionar(abas[j], true);
  });
}

// Gráficos

function lerCores() {
  const css = getComputedStyle(document.body);
  const ler = (nome) => css.getPropertyValue(nome).trim();
  return {
    imc: ler('--cor-imc'),
    ag: ler('--cor-ag'),
    sp: ler('--cor-sp'),
    eixo: ler('--cor-eixo'),
    grade: ler('--cor-grade'),
  };
}

const celular = window.matchMedia('(max-width: 600px)');
const escuro = window.matchMedia('(prefers-color-scheme: dark)');

const emApresentacao = () => document.body.classList.contains('modo-apresentacao');

function alturas() {
  if (emApresentacao() && !celular.matches) {
    const h = Math.round(Math.min(640, Math.max(320, window.innerHeight * 0.58)));
    return { nivel: h, comando: 200 };
  }
  return celular.matches ? { nivel: 220, comando: 160 } : { nivel: 300, comando: 200 };
}

// Espessura das linhas: mais grossa no projetor.
const larguraLinha = () => (emApresentacao() ? 3.5 : 2);

function eixos(cores) {
  const grande = emApresentacao() && !celular.matches;
  const comum = {
    stroke: cores.eixo,
    grid: { stroke: cores.grade, width: 1 },
    ticks: { stroke: cores.grade, width: 1 },
  };
  if (grande) comum.font = '18px system-ui, sans-serif';
  return [
    { ...comum, size: grande ? 56 : 50, values: (u, vals) => vals.map((v) => formatarNumero(v, 0)) },
    { ...comum, size: grande ? 64 : 44, values: (u, vals) => vals.map((v) => formatarNumero(v, 0)) },
  ];
}

const valorPct = (u, v) => (v == null ? '' : `${formatarNumero(v, 2)}%`);
const valorTempo = (u, v) => (v == null ? '' : `${formatarNumero(v, 1)} s`);

function opcoesNivel(largura, altura, cores, nome1) {
  return {
    width: largura,
    height: altura,
    cursor: { sync: { key: 'gemeo' }, drag: { x: false, y: false } },
    scales: { x: { time: false }, y: { range: [0, 100] } },
    axes: eixos(cores),
    series: [
      { label: 'Tempo', value: valorTempo },
      { label: `Nível ${nome1}`, stroke: cores.imc, width: larguraLinha(), value: valorPct },
      { label: 'Nível AG', stroke: cores.ag, width: larguraLinha(), value: valorPct },
      { label: 'Setpoint', stroke: cores.sp, width: larguraLinha() * 0.75, dash: [6, 4], value: valorPct },
    ],
  };
}

function opcoesComando(largura, altura, cores, nome1) {
  return {
    width: largura,
    height: altura,
    cursor: { sync: { key: 'gemeo' }, drag: { x: false, y: false } },
    scales: { x: { time: false }, y: { range: [0, 100] } },
    axes: eixos(cores),
    series: [
      { label: 'Tempo', value: valorTempo },
      { label: `Comando ${nome1}`, stroke: cores.imc, width: 2, value: valorPct },
      { label: 'Comando AG', stroke: cores.ag, width: 2, value: valorPct },
    ],
  };
}

// dadosNivel = [t, yImc, yAg, sp] e dadosComando = [t, uImc, uAg].
// Os arrays são reaproveitados: app.js altera o conteúdo e chama atualizar().
export function criarGraficos({ elNivel, elComando, dadosNivel, dadosComando }) {
  if (typeof uPlot !== 'function') {
    throw new Error('uPlot não carregou (assets/vendor/uplot/uPlot.iife.min.js).');
  }
  let gNivel = null;
  let gComando = null;
  let nome1 = 'IMC';

  function largura(el) {
    return Math.max(200, Math.floor(el.clientWidth));
  }

  function montar() {
    if (gNivel) gNivel.destroy();
    if (gComando) gComando.destroy();
    const cores = lerCores();
    const h = alturas();
    gNivel = new uPlot(opcoesNivel(largura(elNivel), h.nivel, cores, nome1), dadosNivel, elNivel);
    gComando = new uPlot(opcoesComando(largura(elComando), h.comando, cores, nome1), dadosComando, elComando);
  }

  function redimensionar() {
    const h = alturas();
    gNivel.setSize({ width: largura(elNivel), height: h.nivel });
    gComando.setSize({ width: largura(elComando), height: h.comando });
  }

  montar();

  let pendente = false;
  const observador = new ResizeObserver(() => {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(() => {
      pendente = false;
      redimensionar();
    });
  });
  observador.observe(elNivel);
  celular.addEventListener('change', redimensionar);
  escuro.addEventListener('change', montar);

  return {
    // No máximo uma vez por quadro.
    atualizar() {
      gNivel.setData(dadosNivel);
      gComando.setData(dadosComando);
    },
    redimensionar,
    // Recria com cores e espessuras do modo atual (entrar e sair da apresentação).
    remontar: montar,
    // Troca o rótulo da série azul; recria os gráficos (só em eventos).
    nomearMalha1(nome) {
      if (nome === nome1) return;
      nome1 = nome;
      montar();
    },
  };
}
