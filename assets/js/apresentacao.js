// apresentacao.js: modo apresentação para a banca (tela cheia, fonte grande,
// roteiro em 3 passos e atalhos de teclado). Só DOM: as ações do roteiro
// vêm de app.js e usam os mesmos tratadores dos controles normais.

import { formatarNumero } from './formato.js';

// Passo 3 do roteiro: AG ao vivo. A ação vem de app.js (acoes.agAoVivo),
// que roda o AG no Worker, mostra a convergência e aplica os ganhos na
// malha laranja. O botão fica desabilitado até app.js chamar
// habilitarAgAoVivo().
let acaoAgAoVivo = null;

export function iniciarAgAoVivo() {
  if (acaoAgAoVivo) acaoAgAoVivo();
}

const CLASSE = 'modo-apresentacao';
const $ = (id) => document.getElementById(id);

function legendas(y0) {
  const deY0 = formatarNumero(y0, 1);
  return [
    `Degrau de setpoint de ${deY0}% para 50%. Olhe o gráfico de nível: o AG (laranja) chega ao setpoint cerca de 4 vezes mais rápido que o IMC (azul), e nenhum dos dois passa do alvo.`,
    'Carga de +10% na vazão de saída: o tanque começa a esvaziar. As duas malhas atuam na válvula FV-02 na saída e voltam ao setpoint; o AG desvia menos e se recupera antes.',
    'O algoritmo genético busca os ganhos sozinho, aqui no navegador: a curva cai a cada geração. Um refinamento local fecha a busca e, no fim, os ganhos vão para a malha laranja com um novo degrau.',
  ];
}

function pedirTelaCheia() {
  const el = document.documentElement;
  const pedir = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!pedir) return Promise.reject(new Error('sem Fullscreen API'));
  try {
    return Promise.resolve(pedir.call(el));
  } catch (erro) {
    return Promise.reject(erro);
  }
}

function elementoTelaCheia() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function sairTelaCheia() {
  const sair = document.exitFullscreen || document.webkitExitFullscreen;
  if (sair && elementoTelaCheia()) {
    try {
      const p = sair.call(document);
      if (p && p.catch) p.catch(() => {});
    } catch { /* já saiu */ }
  }
}

// acoes: { degrau(), perturbacao(), agAoVivo(), alternarPausa(),
//          reiniciar(), aoEntrar(), aoSair() }; y0 para o texto da legenda.
export function ligarApresentacao(acoes, { y0 }) {
  acaoAgAoVivo = acoes.agAoVivo || null;
  const btnModo = $('btn-apresentacao');
  const btnSair = $('btn-apresentacao-sair');
  const btnPausa = $('btn-pausa-apresentacao');
  const btnReiniciar = $('btn-reiniciar-apresentacao');
  const elLegenda = $('roteiro-legenda');
  const elAviso = $('roteiro-aviso');
  const botoes = [$('passo-1'), $('passo-2'), $('passo-3')];
  const textos = legendas(y0);
  const execucoes = [acoes.degrau, acoes.perturbacao, iniciarAgAoVivo];

  let ativo = false;
  let telaCheiaPropria = false;

  function marcar(i) {
    botoes.forEach((b, j) => {
      if (j === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    elLegenda.textContent = textos[i];
  }

  function executar(i) {
    marcar(i);
    execucoes[i]();
  }

  function aviso(texto) {
    elAviso.textContent = texto;
    elAviso.hidden = !texto;
  }

  function entrar() {
    if (ativo) return;
    ativo = true;
    document.documentElement.classList.add(CLASSE);
    document.body.classList.add(CLASSE);
    btnModo.setAttribute('aria-pressed', 'true');
    btnModo.textContent = 'Sair do modo apresentação';
    aviso('');
    acoes.aoEntrar();
    pedirTelaCheia()
      .then(() => { telaCheiaPropria = ativo && !!elementoTelaCheia(); })
      .catch(() => {
        telaCheiaPropria = false;
        if (ativo) aviso('O navegador não liberou a tela cheia. Use F11 para ocupar a tela toda.');
      });
    botoes[0].focus();
  }

  function sair() {
    if (!ativo) return;
    ativo = false;
    document.documentElement.classList.remove(CLASSE);
    document.body.classList.remove(CLASSE);
    btnModo.setAttribute('aria-pressed', 'false');
    btnModo.textContent = 'Modo apresentação';
    if (telaCheiaPropria) sairTelaCheia();
    telaCheiaPropria = false;
    aviso('');
    acoes.aoSair();
    btnModo.focus();
  }

  btnModo.addEventListener('click', () => (ativo ? sair() : entrar()));
  btnSair.addEventListener('click', sair);
  btnPausa.addEventListener('click', () => acoes.alternarPausa());
  btnReiniciar.addEventListener('click', () => acoes.reiniciar());
  botoes.forEach((b, i) => b.addEventListener('click', () => executar(i)));

  // Esc em tela cheia é tratado pelo navegador: ele sai da tela cheia e
  // aqui o modo apresentação acompanha.
  function aoMudarTelaCheia() {
    if (!elementoTelaCheia() && ativo && telaCheiaPropria) {
      telaCheiaPropria = false;
      sair();
    }
  }
  document.addEventListener('fullscreenchange', aoMudarTelaCheia);
  document.addEventListener('webkitfullscreenchange', aoMudarTelaCheia);

  function ignorar(ev) {
    if (!ativo || ev.ctrlKey || ev.altKey || ev.metaKey) return true;
    const alvo = ev.target;
    return alvo && (alvo.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(alvo.tagName));
  }

  document.addEventListener('keydown', (ev) => {
    if (ignorar(ev) && ev.key !== 'Escape') return;
    if (!ativo) return;
    switch (ev.key) {
      case '1':
      case '2':
      case '3': {
        const i = Number(ev.key) - 1;
        if (botoes[i].disabled) marcar(i);
        else executar(i);
        break;
      }
      case ' ':
      case 'Spacebar':
        if (ev.repeat) break;
        acoes.alternarPausa();
        break;
      case 'r':
      case 'R':
        acoes.reiniciar();
        break;
      case 'Escape':
        sair();
        break;
      default:
        return;
    }
    ev.preventDefault();
  });

  // Espaço num botão focado também dispararia o clique no keyup.
  document.addEventListener('keyup', (ev) => {
    if (!ignorar(ev) && ev.key === ' ') ev.preventDefault();
  });

  // Chamado por app.js quando a seção do AG ao vivo estiver pronta.
  function habilitarAgAoVivo(texto = '3. AG ao vivo') {
    botoes[2].disabled = false;
    botoes[2].textContent = texto;
  }

  return {
    entrar,
    sair,
    habilitarAgAoVivo,
    get ativo() { return ativo; },
  };
}
