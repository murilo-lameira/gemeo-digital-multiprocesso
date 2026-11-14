// app.js: estado e laço de tempo real do gêmeo digital.
// Duas malhas independentes (IMC e AG) com a mesma entrada de setpoint e as
// mesmas perturbações. A matemática vem de sim.js, pid.js e metricas.js
// (agente gemeo_sim); malhas.js só liga as peças.

import { PLANTA } from './sim.js';
import { GANHOS } from './pid.js';
import { criarSistema, vazaoSaida, DT } from './malhas.js';
import { carregarBloco40, montarDadosReais } from './dadosreais.js';
import * as ui from './ui.js';
import { criarHistorico, gerarCsv, nomeArquivo, baixarCsv } from './exportar.js';
import { ligarApresentacao } from './apresentacao.js';
import { criarAgAoVivo } from './agaovivo.js';
import { criarPainelEstabilidade } from './painelestabilidade.js';

// Parâmetros fixos do laço
const JANELA = 1200;             // janela deslizante do gráfico (s)
const PONTOS = Math.round(JANELA / DT) + 1;
const MAX_PASSOS_QUADRO = 400;   // teto de segurança por quadro
const MAX_DT_REAL = 0.1;         // limita o salto ao voltar de uma aba oculta (s)
const INTERVALO_DOM = 0.2;       // atualização das métricas no DOM (s reais)

// Estado da interface
const estado = {
  velocidade: 10,
  pausado: false,
  acumulado: 0,       // tempo simulado pendente (s)
  ultimoQuadro: 0,
  idQuadro: 0,
  ultimoDom: 0,
  quadrosFps: 0,
  inicioFps: 0,
  aba: 'sim',
  manual: false,
  ganhosManual: { ...GANHOS.IMC },
  ganhosAg: { ...GANHOS.AG },  // ganhos em uso na malha laranja
  origemAg: 'pi',              // 'pi' ou 'aovivo'
  degrauSujo: false,  // ganhos manuais mudaram durante o degrau atual
};

const sis = criarSistema({ dt: DT, setpoint: 50 });

// Histórico para exportar CSV: buffer circular de 4 horas simuladas.
const hist = criarHistorico();

// Ganhos em uso na malha azul (referência, sem alocar por passo).
function ganhosAzul() {
  return estado.manual ? estado.ganhosManual : GANHOS.IMC;
}

function registrarHistorico() {
  hist.registrar(sis, estado.manual, ganhosAzul());
}

// Buffers do gráfico, alocados uma vez. A janela desliza com copyWithin.
const buf = {
  t: new Float64Array(PONTOS),
  yImc: new Float64Array(PONTOS),
  yAg: new Float64Array(PONTOS),
  sp: new Float64Array(PONTOS),
  uImc: new Float64Array(PONTOS),
  uAg: new Float64Array(PONTOS),
};
const LISTA_BUF = [buf.t, buf.yImc, buf.yAg, buf.sp, buf.uImc, buf.uAg];
const dadosNivel = [buf.t, buf.yImc, buf.yAg, buf.sp];
const dadosComando = [buf.t, buf.uImc, buf.uAg];

// Amostras do quadro atual, antes de entrar na janela.
const novo = {
  t: new Float64Array(MAX_PASSOS_QUADRO),
  yImc: new Float64Array(MAX_PASSOS_QUADRO),
  yAg: new Float64Array(MAX_PASSOS_QUADRO),
  sp: new Float64Array(MAX_PASSOS_QUADRO),
  uImc: new Float64Array(MAX_PASSOS_QUADRO),
  uAg: new Float64Array(MAX_PASSOS_QUADRO),
};
const LISTA_NOVO = [novo.t, novo.yImc, novo.yAg, novo.sp, novo.uImc, novo.uAg];

// Histórico inicial: planta em repouso no ponto de operação antes de t = 0.
function preencherHistorico() {
  for (let i = 0; i < PONTOS; i++) {
    buf.t[i] = -(PONTOS - 1 - i) * DT;
    buf.yImc[i] = PLANTA.y0;
    buf.yAg[i] = PLANTA.y0;
    buf.sp[i] = PLANTA.y0;
    buf.uImc[i] = PLANTA.u0;
    buf.uAg[i] = PLANTA.u0;
  }
}

function reiniciarTudo() {
  estado.acumulado = 0;
  estado.degrauSujo = false;
  sis.reiniciar();
  preencherHistorico();
  hist.limpar();
  registrarHistorico(); // linha de t = 0
}

// Avança n passos e grava as amostras em "novo". O gráfico de nível
// mostra a medição (com ruído, se ligado).
function avancar(n) {
  const imc = sis.imc;
  const ag = sis.ag;
  for (let k = 0; k < n; k++) {
    sis.passo();
    registrarHistorico();
    novo.t[k] = sis.t;
    novo.yImc[k] = imc.yMed;
    novo.yAg[k] = ag.yMed;
    novo.sp[k] = sis.setpoint;
    novo.uImc[k] = imc.u;
    novo.uAg[k] = ag.u;
  }
}

// Desliza a janela e copia as n amostras novas para o fim.
function empurrarJanela(n) {
  const inicio = PONTOS - n;
  for (let j = 0; j < LISTA_BUF.length; j++) {
    const destino = LISTA_BUF[j];
    const origem = LISTA_NOVO[j];
    destino.copyWithin(0, n);
    for (let k = 0; k < n; k++) destino[inicio + k] = origem[k];
  }
}

// Disputa do modo manual: compara o ITAE só quando as duas malhas já
// subiram e estão dentro da banda de ±2% do degrau atual.
function acomodada(m) {
  const amp = Math.abs(m.metricas.dSP);
  return Math.abs(m.y - sis.setpoint) <= 0.02 * amp;
}

function avaliarDuelo(vMan, vAg) {
  let msg;
  let tipo = 'neutro';
  if (Math.abs(sis.imc.metricas.dSP) < 0.5) {
    msg = 'Mude o setpoint para começar uma disputa com o AG.';
  } else if (estado.degrauSujo) {
    msg = 'Os ganhos mudaram no meio deste degrau. Mude o setpoint para uma disputa justa.';
  } else if (!Number.isFinite(vMan.tempoSubida) || !Number.isFinite(vAg.tempoSubida)
    || !acomodada(sis.imc) || !acomodada(sis.ag)) {
    msg = 'Disputa em andamento: aguarde as duas malhas acomodarem no setpoint.';
  } else if (vMan.ITAE < vAg.ITAE) {
    msg = 'Você ganhou do AG neste degrau: o ITAE do manual é menor.';
    tipo = 'vitoria';
  } else {
    msg = 'O AG está na frente neste degrau. Ajuste os ganhos e mude o setpoint para tentar de novo.';
    tipo = 'derrota';
  }
  ui.atualizarDuelo(vMan.ITAE, vAg.ITAE, msg, tipo);
}

function atualizarPainel() {
  ui.mostrarTempo(sis.t);
  const vImc = sis.imc.metricas.valores();
  const vAg = sis.ag.metricas.valores();
  ui.atualizarMetricas(vImc, vAg);
  ui.atualizarAtuais('IMC', sis.imc.y, sis.imc.u, vazaoSaida(sis.imc.y, sis.carga));
  ui.atualizarAtuais('AG', sis.ag.y, sis.ag.u, vazaoSaida(sis.ag.y, sis.carga));
  if (estado.manual) avaliarDuelo(vImc, vAg);
}

let graficos = null;
let tanques = null;

function desenharTanques(dtReal) {
  const sp = sis.setpoint;
  const d = sis.carga;
  const imc = sis.imc;
  const ag = sis.ag;
  tanques.IMC.atualizar(imc.y, sp, imc.u, vazaoSaida(imc.y, d), dtReal);
  tanques.AG.atualizar(ag.y, sp, ag.u, vazaoSaida(ag.y, d), dtReal);
}

// Laço de tempo real. A velocidade multiplica o tempo real decorrido:
// a 100x e 60 fps são cerca de 3 passos de 0,5 s por quadro.
function quadro(agora) {
  estado.idQuadro = requestAnimationFrame(quadro);
  const seg = agora / 1000;
  const dtReal = Math.min(MAX_DT_REAL, Math.max(0, seg - estado.ultimoQuadro));
  estado.ultimoQuadro = seg;

  estado.acumulado += dtReal * estado.velocidade;
  let n = Math.floor(estado.acumulado / DT);
  if (n > MAX_PASSOS_QUADRO) n = MAX_PASSOS_QUADRO;
  if (n > 0) {
    estado.acumulado -= n * DT;
    avancar(n);
    empurrarJanela(n);
    if (estado.aba === 'sim') graficos.atualizar();
  }
  if (estado.aba === 'sim') desenharTanques(dtReal);

  if (seg - estado.ultimoDom >= INTERVALO_DOM) {
    estado.ultimoDom = seg;
    atualizarPainel();
  }

  estado.quadrosFps++;
  if (seg - estado.inicioFps >= 1) {
    ui.mostrarFps(estado.quadrosFps / (seg - estado.inicioFps));
    estado.quadrosFps = 0;
    estado.inicioFps = seg;
  }
}

function iniciarLaco() {
  const seg = performance.now() / 1000;
  estado.ultimoQuadro = seg;
  estado.inicioFps = seg;
  estado.quadrosFps = 0;
  estado.idQuadro = requestAnimationFrame(quadro);
}

function pararLaco() {
  cancelAnimationFrame(estado.idQuadro);
  estado.idQuadro = 0;
  ui.mostrarFps(0);
}

// Ganhos da malha azul: os do IMC, ou os manuais se o modo estiver ligado.
function aplicarGanhosMalha1() {
  sis.imc.pid.setGanhos(ganhosAzul());
  if (painelEstab) painelEstab.agendar();
}

// Ganhos da malha laranja: os do AG do PI ou os do AG ao vivo. A troca é
// sem salto (setGanhos); os valores são copiados para o objeto do estado.
function aplicarGanhosAg(g, origem) {
  estado.ganhosAg.Kp = g.Kp;
  estado.ganhosAg.Ki = g.Ki;
  estado.ganhosAg.Kd = g.Kd;
  estado.origemAg = origem;
  sis.ag.pid.setGanhos(estado.ganhosAg);
  estado.degrauSujo = true;
  if (agAoVivo) agAoVivo.mostrarMalha(origem, estado.ganhosAg);
  if (painelEstab) painelEstab.agendar();
}

let agAoVivo = null;
let painelEstab = null;

function redesenharTudo() {
  graficos.atualizar();
  desenharTanques(0);
  atualizarPainel();
}

let dadosMontados = null;

// Tratadores dos controles
const tratadores = {
  aoMudarSetpoint(sp) {
    if (sis.definirSetpoint(sp)) estado.degrauSujo = false;
  },
  aoMudarVelocidade(v) {
    estado.velocidade = v;
  },
  aoAlternarPausa() {
    estado.pausado = !estado.pausado;
    ui.mostrarPausa(estado.pausado);
    if (estado.pausado) pararLaco();
    else iniciarLaco();
  },
  aoReiniciar() {
    reiniciarTudo();
    ui.zerarCarga();
    redesenharTudo();
  },
  aoAplicarCarga(d) {
    sis.carga = d;
    ui.mostrarCargaAplicada(d);
    if (estado.pausado) atualizarPainel();
  },
  aoAlternarRuido(ligado) {
    sis.ruido = ligado;
  },
  aoMudarTheta(theta) {
    sis.definirTheta(theta);
    if (painelEstab) painelEstab.agendar();
  },
  aoAlternarManual(ligado) {
    estado.manual = ligado;
    ui.nomearMalha1(ligado ? 'Manual' : 'IMC', graficos);
    if (ligado) ui.mostrarGanhosManual(estado.ganhosManual);
    aplicarGanhosMalha1(); // também agenda o painel de estabilidade
    if (estado.pausado) redesenharTudo();
    else atualizarPainel();
  },
  aoMudarGanho(nome, valor) {
    estado.ganhosManual[nome] = valor;
    estado.degrauSujo = true;
    aplicarGanhosMalha1();
  },
  aoGanhosImc() {
    estado.ganhosManual.Kp = GANHOS.IMC.Kp;
    estado.ganhosManual.Ki = GANHOS.IMC.Ki;
    estado.ganhosManual.Kd = GANHOS.IMC.Kd;
    estado.degrauSujo = true;
    ui.mostrarGanhosManual(estado.ganhosManual);
    aplicarGanhosMalha1();
  },
  aoExportar() {
    const agora = new Date();
    const n = hist.contagem;
    try {
      baixarCsv(gerarCsv(hist, agora), nomeArquivo(agora));
      const cheio = n >= hist.capacidade ? ' (limite de 4 horas: as linhas mais antigas ficaram de fora)' : '';
      ui.mostrarExportacao(`CSV exportado com ${ui.formatarNumero(n, 0)} linhas${cheio}.`);
    } catch (erro) {
      console.error(erro);
      ui.mostrarExportacao(`Não foi possível exportar o CSV: ${erro.message}`);
    }
  },
};

// Roteiro do modo apresentação. Cada passo usa os mesmos tratadores dos
// controles normais; ui.ajustar* só deixa os controles coerentes na tela.
function continuarSePausado() {
  if (estado.pausado) tratadores.aoAlternarPausa();
}

function definirVelocidade(v) {
  ui.mostrarVelocidade(v);
  tratadores.aoMudarVelocidade(v);
}

// Degrau de demonstração: reinicia a 50x com setpoint de y0 para 50%.
// Não mexe no modo manual nem em θ. Reiniciar põe as duas malhas em y0 e
// zera as métricas com o setpoint em 50%: o degrau começa em t = 0.
function degrauDemonstracao() {
  continuarSePausado();
  definirVelocidade(50);
  ui.ajustarSetpoint(50);
  tratadores.aoMudarSetpoint(50);
  tratadores.aoReiniciar();
}

function rolarPara(el) {
  if (!el) return;
  const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
}

const roteiro = {
  // 1. Degrau: volta ao IMC e a θ = 0 para o resultado da banca ser o do
  // modelo identificado, e faz o degrau de demonstração.
  degrau() {
    if (estado.manual) {
      ui.ajustarManual(false);
      tratadores.aoAlternarManual(false);
    }
    if (sis.theta !== 0) {
      ui.ajustarTheta(0);
      tratadores.aoMudarTheta(0);
    }
    degrauDemonstracao();
  },
  // 2. Perturbação: degrau de carga de +10% na vazão de saída.
  perturbacao() {
    continuarSePausado();
    ui.ajustarCarga(10);
    tratadores.aoAplicarCarga(10);
  },
  // 3. AG ao vivo: roda o AG, mostra a convergência e, no fim, aplica os
  // ganhos na malha laranja com um degrau novo (ver aoAplicarAg).
  agAoVivo() {
    continuarSePausado();
    rolarPara(document.getElementById('secao-ag'));
    agAoVivo.sintonizar({ autoAplicar: true });
  },
};

// Ganhos do AG ao vivo na malha laranja, com um degrau para mostrar o efeito.
function aoAplicarAg(g) {
  aplicarGanhosAg(g, 'aovivo');
  degrauDemonstracao();
}

function aoVoltarPi() {
  aplicarGanhosAg(GANHOS.AG, 'pi');
  if (estado.pausado) atualizarPainel();
}

function aoEntrarApresentacao() {
  if (estado.aba !== 'sim') document.getElementById('aba-sim').click();
  graficos.remontar();
  agAoVivo.remontar();
  redesenharTudo();
}

function aoSairApresentacao() {
  graficos.remontar();
  agAoVivo.remontar();
  redesenharTudo();
}

function aoMudarAba(aba) {
  estado.aba = aba;
  if (aba === 'sim') {
    graficos.redimensionar();
    agAoVivo.redimensionar();
    redesenharTudo();
    return;
  }
  if (!dadosMontados) {
    dadosMontados = montarDadosReais({
      elGrafico: document.getElementById('grafico-dados'),
      elTabela: document.getElementById('tabela-ajuste'),
      elStatus: document.getElementById('dados-status'),
    }).then((r) => {
      if (!r) dadosMontados = null; // falhou: tenta de novo na próxima abertura
      return r;
    });
  } else {
    dadosMontados.then((r) => r && r.redimensionar());
  }
}

function iniciar() {
  const inicial = ui.ligarControles(tratadores);
  estado.velocidade = inicial.velocidade;
  estado.manual = inicial.manual;
  sis.setpoint = inicial.setpoint;
  sis.ruido = inicial.ruido;
  sis.definirTheta(inicial.theta);
  ui.mostrarSetpoint(sis.setpoint);
  ui.mostrarPausa(false);
  ui.mostrarSigma(sis.sigma);
  ui.zerarCarga();

  reiniciarTudo();
  graficos = ui.criarGraficos({
    elNivel: document.getElementById('grafico-nivel'),
    elComando: document.getElementById('grafico-comando'),
    dadosNivel,
    dadosComando,
  });
  tanques = ui.criarTanques();
  agAoVivo = criarAgAoVivo({
    K: PLANTA.K,
    tau: PLANTA.tau,
    aoAplicar: aoAplicarAg,
    aoVoltarPi,
    aoFimApresentacao: () => {
      if (document.body.classList.contains('modo-apresentacao')) {
        rolarPara(document.getElementById('roteiro'));
      }
    },
  });
  agAoVivo.mostrarMalha(estado.origemAg, estado.ganhosAg);
  painelEstab = criarPainelEstabilidade({
    K: PLANTA.K,
    tau: PLANTA.tau,
    obterTheta: () => sis.theta,
    obterMalhas: () => [
      { nome: estado.manual ? 'Manual (azul)' : 'IMC (azul)', classe: 'imc', ganhos: ganhosAzul() },
      { nome: estado.origemAg === 'pi' ? 'AG do PI (laranja)' : 'AG ao vivo (laranja)', classe: 'ag', ganhos: estado.ganhosAg },
    ],
  });
  if (estado.manual) tratadores.aoAlternarManual(true);
  painelEstab.calcularAgora();
  ui.ligarAbas(aoMudarAba);
  const apresentacao = ligarApresentacao({
    degrau: roteiro.degrau,
    perturbacao: roteiro.perturbacao,
    agAoVivo: roteiro.agAoVivo,
    alternarPausa: tratadores.aoAlternarPausa,
    reiniciar: tratadores.aoReiniciar,
    aoEntrar: aoEntrarApresentacao,
    aoSair: aoSairApresentacao,
  }, { y0: PLANTA.y0 });
  apresentacao.habilitarAgAoVivo();
  redesenharTudo();
  ui.esconderStatus();
  iniciarLaco();

  // O desvio do ruído vem do resíduo do modelo no bloco 40. Se o arquivo
  // não carregar, fica o valor de partida de malhas.js (o mesmo número).
  carregarBloco40()
    .then((d) => {
      if (Number.isFinite(d.sigma_residuo)) {
        sis.sigma = d.sigma_residuo;
        ui.mostrarSigma(sis.sigma);
      }
    })
    .catch((erro) => console.warn('bloco40.json não carregou:', erro));
}

try {
  iniciar();
} catch (erro) {
  console.error(erro);
  ui.mostrarStatus(`Não foi possível iniciar a simulação: ${erro.message}`, true);
}
