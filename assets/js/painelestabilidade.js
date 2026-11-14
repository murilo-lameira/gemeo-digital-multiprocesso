// painelestabilidade.js: painel de estabilidade (item 10 do ESCOPO.md).
// Só interface: a análise vem de analisar() em estabilidade.js (gemeo_sim) e
// os textos de textoestabilidade.js. Recalcula com debounce (cerca de 2 ms
// por malha), nunca a cada quadro.

import { analisar } from './estabilidade.js';
import { resumirAnalise, formatarSig, formatarPolo } from './textoestabilidade.js';
import { formatarNumero } from './formato.js';

const $ = (id) => document.getElementById(id);
export const ESPERA_MS = 150;
export const N_FILTRO = 10;

// Escala logarítmica simétrica para o plano s: os polos vão de 0,002 a
// 5.000 rad/s (filtro derivativo), então uma escala linear esconderia quase todos.
const L = 1e-4;
export function symlog(x) {
  return Math.sign(x) * Math.log10(1 + Math.abs(x) / L);
}

function el(tag, classe, textoInicial) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (textoInicial != null) e.textContent = textoInicial;
  return e;
}

// Esqueleto de uma malha, montado uma vez.
function montarMalha(container, classe) {
  const art = el('article', `estab-malha ${classe}`);
  const titulo = el('h3', 'estab-titulo');
  const ganhos = el('p', 'nota estab-ganhos');
  const eqRotulo = el('p', 'estab-rotulo', 'Equação característica');
  const eq = el('p', 'equacao');
  const resumo = el('dl', 'estab-resumo');
  const itens = {};
  for (const [chave, rotulo] of [
    ['routh', 'Routh-Hurwitz'],
    ['mg', 'Margem de ganho'],
    ['mf', 'Margem de fase'],
    ['atraso', 'Atraso máximo tolerado'],
  ]) {
    const div = el('div');
    div.append(el('dt', null, rotulo));
    const dd = el('dd');
    div.append(dd);
    resumo.append(div);
    itens[chave] = dd;
  }
  const detalheRouth = el('p', 'nota');
  const frequencias = el('p', 'nota');
  const tabPolos = el('table', 'metricas estab-polos');
  tabPolos.innerHTML = '<caption class="nota">Polos de malha fechada</caption>'
    + '<thead><tr><th scope="col">Parte real (1/s)</th><th scope="col">Parte imaginária (rad/s)</th></tr></thead>';
  const corpoPolos = el('tbody');
  tabPolos.append(corpoPolos);
  const det = el('details', 'estab-routh');
  const sum = el('summary', null, 'Tabela de Routh');
  const tabRouth = el('table', 'metricas');
  const corpoRouth = el('tbody');
  tabRouth.append(corpoRouth);
  const rolagem = el('div', 'tabela-rolagem');
  rolagem.append(tabRouth);
  det.append(sum, rolagem);
  const rolPolos = el('div', 'tabela-rolagem');
  rolPolos.append(tabPolos);
  art.append(titulo, ganhos, eqRotulo, eq, resumo, detalheRouth, frequencias, rolPolos, det);
  container.append(art);
  return { art, titulo, ganhos, eq, itens, detalheRouth, frequencias, corpoPolos, corpoRouth };
}

function preencherMalha(v, m, r) {
  v.titulo.textContent = m.nome;
  v.ganhos.textContent = `Kp ${formatarSig(m.ganhos.Kp, 4)}, Ki ${formatarSig(m.ganhos.Ki, 4)} 1/s, Kd ${formatarSig(m.ganhos.Kd, 4)} s.`;
  v.eq.textContent = r.equacao;
  v.itens.routh.textContent = `${r.routh.titulo}${r.aproximado ? ' (com Padé)' : ''}`;
  v.itens.routh.dataset.estado = r.routh.estavel ? 'estavel' : 'instavel';
  v.itens.mg.textContent = r.margemGanho;
  v.itens.mf.textContent = r.margemFase;
  v.itens.atraso.textContent = r.atraso;
  for (const chave of ['mg', 'mf', 'atraso']) v.itens[chave].dataset.estado = r.estavelExato ? 'estavel' : 'instavel';
  v.detalheRouth.textContent = r.routh.detalhe;
  v.frequencias.textContent = `Cruzamento de fase: ${r.frequenciaFase}. Cruzamento de ganho: ${r.frequenciaGanho}.`;
  v.corpoPolos.replaceChildren(...r.polos.map((p) => {
    const tr = el('tr');
    tr.append(el('td', null, p.re), el('td', null, p.im));
    return tr;
  }));
  v.corpoRouth.replaceChildren(...r.tabelaRouth.map((l) => {
    const tr = el('tr');
    const th = el('th', null, l.linha);
    th.scope = 'row';
    tr.append(th, ...l.valores.map((x) => el('td', null, x)));
    return tr;
  }));
}

// Plano s em SVG: polos das duas malhas, semiplano direito sombreado.
export function desenharPlano(analises) {
  const W = 360;
  const H = 210;
  const M = { e: 14, d: 14, t: 14, b: 30 };
  const todos = analises.flatMap((a) => a.polos);
  let xMin = symlog(-0.1);
  let xMax = symlog(0.001);
  let yMax = symlog(0.01);
  for (const p of todos) {
    const x = symlog(p.re);
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    const y = Math.abs(symlog(p.im));
    if (y > yMax) yMax = y;
  }
  xMin *= 1.08;
  xMax = Math.max(xMax * 1.15, -xMin * 0.18);
  yMax *= 1.15;
  const px = (x) => M.e + ((x - xMin) / (xMax - xMin)) * (W - M.e - M.d);
  const py = (y) => M.t + ((yMax - y) / (2 * yMax)) * (H - M.t - M.b);
  const x0 = px(0);
  const y0 = py(0);
  const partes = [];
  partes.push(`<rect class="sp-direito" x="${x0}" y="${M.t}" width="${W - M.d - x0}" height="${H - M.t - M.b}"/>`);
  partes.push(`<line class="sp-eixo" x1="${M.e}" y1="${y0}" x2="${W - M.d}" y2="${y0}"/>`);
  partes.push(`<line class="sp-eixo" x1="${x0}" y1="${M.t}" x2="${x0}" y2="${H - M.b}"/>`);
  for (const d of [-1000, -10, -0.1, -0.001]) {
    const x = px(symlog(d));
    if (x < M.e) continue;
    partes.push(`<line class="sp-marca" x1="${x}" y1="${y0 - 4}" x2="${x}" y2="${y0 + 4}"/>`);
    partes.push(`<text class="sp-texto" x="${x}" y="${H - 12}" text-anchor="middle">${formatarSig(d, 1)}</text>`);
  }
  partes.push(`<text class="sp-texto" x="${W - M.d}" y="${y0 - 6}" text-anchor="end">Re</text>`);
  partes.push(`<text class="sp-texto" x="${x0 + 4}" y="${M.t + 10}">Im</text>`);
  partes.push(`<text class="sp-texto" x="${W - M.d - 2}" y="${M.t + 10}" text-anchor="end">instável</text>`);
  analises.forEach((a, i) => {
    for (const p of a.polos) {
      const x = px(symlog(p.re));
      const y = py(symlog(p.im));
      const titulo = `<title>${a.nome}: ${formatarPolo(p)}</title>`;
      if (i === 0) {
        partes.push(`<circle class="sp-polo imc" cx="${x}" cy="${y}" r="6">${titulo}</circle>`);
      } else {
        partes.push(`<path class="sp-polo ag" d="M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x - 5} ${y + 5}L${x + 5} ${y - 5}">${titulo}</path>`);
      }
    }
  });
  return { viewBox: `0 0 ${W} ${H}`, conteudo: partes.join('') };
}

// obterMalhas(): [{ nome, classe: 'imc' | 'ag', ganhos }] (azul, laranja).
// obterTheta(): θ atual em segundos.
export function criarPainelEstabilidade({ K, tau, obterMalhas, obterTheta }) {
  const dom = {
    secao: $('secao-estabilidade'),
    filtro: $('estab-filtro'),
    theta: $('estab-theta'),
    malhas: $('estab-malhas'),
    avisos: $('estab-avisos'),
    discordancia: $('estab-discordancia'),
    plano: $('estab-plano'),
    legendaPlano: $('estab-legenda-plano'),
  };
  const vistas = [montarMalha(dom.malhas, 'imc'), montarMalha(dom.malhas, 'ag')];
  let id = 0;

  function calcularAgora() {
    id = 0;
    const theta = obterTheta();
    const filtro = dom.filtro.checked;
    const malhas = obterMalhas();
    const analises = malhas.map((m) => {
      const a = analisar({ K, tau, ...m.ganhos, N: N_FILTRO, theta, filtro });
      return { ...a, nome: m.nome, resumo: resumirAnalise(a) };
    });
    dom.theta.textContent = `${formatarNumero(theta, 0)} s`;
    analises.forEach((a, i) => preencherMalha(vistas[i], malhas[i], a.resumo));

    // Avisos comuns uma vez só; a discordância Padé x margens em destaque,
    // com o nome da malha.
    const comuns = new Set();
    const fortes = [];
    for (const a of analises) {
      for (const t of a.resumo.outrosAvisos) comuns.add(t);
      if (a.resumo.discordancia) fortes.push(`${a.nome}: ${a.resumo.discordancia}.`);
    }
    dom.avisos.replaceChildren(...[...comuns].map((t) => el('li', null, `${t}.`)));
    dom.discordancia.textContent = fortes.join(' ');
    dom.discordancia.hidden = fortes.length === 0;

    const plano = desenharPlano(analises);
    dom.plano.setAttribute('viewBox', plano.viewBox);
    dom.plano.innerHTML = plano.conteudo;
    dom.legendaPlano.textContent = `Polos no plano s (escala logarítmica simétrica): círculos para ${malhas[0].nome}, xis para ${malhas[1].nome}.${theta > 0 ? ' Com θ > 0 os polos vêm da Padé de 1ª ordem.' : ''}`;
    return analises;
  }

  function agendar() {
    if (id) clearTimeout(id);
    id = setTimeout(calcularAgora, ESPERA_MS);
  }

  dom.filtro.addEventListener('change', agendar);
  return { agendar, calcularAgora };
}
