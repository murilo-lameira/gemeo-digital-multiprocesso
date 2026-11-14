// dadosreais.js: aba "Dados reais". Carrega dados/bloco40.json (uma vez),
// calcula a curva do modelo e o ajuste, e desenha em uPlot.
// A página nunca lê o experimento2.csv, só o recorte do bloco 40.
// Degrau medido pela equipe do Projeto Integrador (6 integrantes).

import { respostaDegrauFOPDT } from './sim.js';
import { r2, rmse } from './metricas.js';
import { formatarNumero } from './formato.js';

export const CAMINHO_BLOCO40 = 'dados/bloco40.json';

let promessa = null;

// Fetch único, memorizado. Em caso de falha a próxima chamada tenta de novo.
export function carregarBloco40(caminho = CAMINHO_BLOCO40) {
  if (!promessa) {
    promessa = fetch(caminho, { cache: 'no-cache' })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .catch((erro) => {
        promessa = null;
        throw erro;
      });
  }
  return promessa;
}

// Mesmo cálculo do identificacao_fopdt.py: modelo nos tempos reais do
// recorte (t_norm, começa em -6 s), degrau delta_u_p em t = 0.
export function calcularAjuste(d) {
  const t = Float64Array.from(d.t_norm);
  const nivel = Float64Array.from(d.nivel);
  const modelo = respostaDegrauFOPDT(t, d.K, d.tau, d.theta, d.y0, d.delta_u_p);
  return {
    t,
    nivel,
    modelo,
    r2: r2(nivel, modelo),
    rmse: rmse(nivel, modelo),
  };
}

function linhasTabela(d, aj) {
  const n = formatarNumero;
  return [
    ['R²', `${n(aj.r2 * 100, 2)}%`],
    ['RMSE', `${n(aj.rmse, 3)}%`],
    ['Ganho K', `${n(d.K, 4)} %/%`],
    ['Constante de tempo τ', `${n(d.tau, 2)} s`],
    ['Tempo morto θ', `${n(d.theta, 0)} s`],
    ['Comando antes do degrau (FV-02)', `${n(d.u0_p, 1)}% (${n(d.u0_hz, 2)} Hz eq.)`],
    ['Degrau na válvula FV-02', `${n(d.delta_u_p, 3)}% (${n(d.delta_u_hz, 3)} Hz eq.)`],
    ['Nível inicial e final', `${n(d.y0, 2)}% para ${n(d.yf, 2)}%`],
    ['Pontos medidos', n(d.t_norm.length, 0)],
  ];
}

function lerCor(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

// Monta a aba. elGrafico: contêiner do uPlot; elTabela: <tbody>; elStatus:
// parágrafo de mensagens. Devolve { redimensionar } ou null se falhar.
export async function montarDadosReais({ elGrafico, elTabela, elStatus }) {
  const uPlot = globalThis.uPlot;
  elStatus.hidden = false;
  elStatus.classList.remove('erro');
  elStatus.textContent = 'Carregando o degrau do bloco 40.';
  let d;
  try {
    d = await carregarBloco40();
  } catch (erro) {
    console.error(erro);
    elStatus.classList.add('erro');
    elStatus.textContent = 'Não foi possível carregar os dados do bloco 40. Abra a página por um servidor local (por exemplo, python -m http.server 8010) e tente de novo.';
    return null;
  }
  const aj = calcularAjuste(d);

  elTabela.replaceChildren();
  for (const [rotulo, valor] of linhasTabela(d, aj)) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = rotulo;
    const td = document.createElement('td');
    td.textContent = valor;
    tr.append(th, td);
    elTabela.append(tr);
  }

  const celular = window.matchMedia('(max-width: 600px)');
  const escuro = window.matchMedia('(prefers-color-scheme: dark)');
  const altura = () => (celular.matches ? 240 : 340);
  const largura = () => Math.max(200, Math.floor(elGrafico.clientWidth));
  const dados = [aj.t, aj.nivel, aj.modelo];
  let g = null;

  function montar() {
    if (g) g.destroy();
    const eixo = lerCor('--cor-eixo');
    const grade = lerCor('--cor-grade');
    const comum = { stroke: eixo, grid: { stroke: grade, width: 1 }, ticks: { stroke: grade, width: 1 } };
    const fmt = (u, vals) => vals.map((v) => formatarNumero(v, 0));
    g = new uPlot({
      width: largura(),
      height: altura(),
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: [0, 100] } },
      axes: [{ ...comum, values: fmt }, { ...comum, size: 44, values: fmt }],
      series: [
        { label: 'Tempo', value: (u, v) => (v == null ? '' : `${formatarNumero(v, 0)} s`) },
        {
          label: 'Nível medido',
          stroke: lerCor('--cor-medido'),
          width: 0,
          paths: () => null,
          points: { show: true, size: 3, width: 0, fill: lerCor('--cor-medido') },
          value: (u, v) => (v == null ? '' : `${formatarNumero(v, 2)}%`),
        },
        {
          label: 'Modelo FOPDT',
          stroke: lerCor('--cor-imc'),
          width: 2,
          points: { show: false },
          value: (u, v) => (v == null ? '' : `${formatarNumero(v, 2)}%`),
        },
      ],
    }, dados, elGrafico);
  }

  montar();
  elStatus.hidden = true;
  escuro.addEventListener('change', montar);
  const redimensionar = () => g.setSize({ width: largura(), height: altura() });
  celular.addEventListener('change', redimensionar);
  new ResizeObserver(() => requestAnimationFrame(redimensionar)).observe(elGrafico);
  return { redimensionar, ajuste: aj };
}
