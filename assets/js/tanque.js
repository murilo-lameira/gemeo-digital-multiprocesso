// tanque.js: Tanque T2 animado em SVG, um por controlador.
// O SVG é criado uma vez; cada quadro só altera atributos.
// Desenho esquemático: a Bomba 2 à esquerda, comandada pelo controlador, alimenta
// o tanque pelo topo. A válvula FV-02 na saída à direita fica numa abertura fixa,
// como no degrau do bloco 40 (bomba de 30% para 40%).

const NS = 'http://www.w3.org/2000/svg';

// Geometria (viewBox 0 0 240 250)
const TQ_X = 80;
const TQ_Y = 20;
const TQ_L = 110;
const TQ_A = 190; // altura útil: 0% em TQ_Y + TQ_A, 100% em TQ_Y
const BOMBA_X = 38;
const BOMBA_Y = 226;
const BOMBA_R = 17;
const SAIDA_Y = TQ_Y + TQ_A - 10;
const VALV_X = 215;
const VALV_Y = SAIDA_Y;

function el(nome, attrs, pai) {
  const n = document.createElementNS(NS, nome);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (pai) pai.appendChild(n);
  return n;
}

const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');

// el: contêiner; classe: 'imc' ou 'ag' (define a cor pelo CSS).
export function criarTanque(container, { classe }) {
  const svg = el('svg', {
    viewBox: '0 0 240 250',
    class: `tanque-svg ${classe}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });

  // Tubulação de entrada: bomba, sobe e entra pelo topo
  el('path', {
    d: `M${BOMBA_X} ${BOMBA_Y - BOMBA_R} V8 H${TQ_X + 30} V${TQ_Y + 4}`,
    class: 'tubo',
  }, svg);
  const fluxoEntrada = el('path', {
    d: `M${BOMBA_X} ${BOMBA_Y - BOMBA_R} V8 H${TQ_X + 30} V${TQ_Y + 4}`,
    class: 'fluxo',
  }, svg);

  // Tubulação de saída, no fundo à direita
  el('path', { d: `M${TQ_X + TQ_L} ${SAIDA_Y} H238`, class: 'tubo' }, svg);
  const fluxoSaida = el('path', { d: `M${TQ_X + TQ_L} ${SAIDA_Y} H238`, class: 'fluxo' }, svg);

  // Válvula FV-02 na tubulação de saída à direita, em abertura fixa
  el('line', {
    x1: VALV_X,
    y1: VALV_Y,
    x2: VALV_X,
    y2: VALV_Y - 13,
    class: 'valvula-haste',
  }, svg);
  el('path', {
    d: `M${VALV_X - 8} ${VALV_Y - 13} A8 8 0 0 1 ${VALV_X + 8} ${VALV_Y - 13} Z`,
    class: 'valvula-atuador',
  }, svg);
  el('path', {
    d: `M${VALV_X - 8} ${VALV_Y - 7} V${VALV_Y + 7} L${VALV_X} ${VALV_Y} Z M${VALV_X + 8} ${VALV_Y - 7} V${VALV_Y + 7} L${VALV_X} ${VALV_Y} Z`,
    class: 'valvula-controle',
  }, svg);
  el('rect', {
    x: VALV_X - 4,
    y: VALV_Y - 6,
    width: 8,
    height: 12,
    rx: 1,
    class: 'valvula-abertura',
  }, svg);
  const txValv = el('text', {
    x: VALV_X,
    y: VALV_Y + 18,
    class: 'valvula-texto',
  }, svg);
  txValv.textContent = 'FV-02 fixa';

  // Corpo do tanque e nível
  el('rect', { x: TQ_X, y: TQ_Y, width: TQ_L, height: TQ_A, rx: 4, class: 'corpo' }, svg);
  const liquido = el('rect', {
    x: TQ_X + 2, y: TQ_Y + TQ_A, width: TQ_L - 4, height: 0, class: 'liquido',
  }, svg);

  // Faixa linear do modelo (15% a 75%), barra fina à direita, e escala
  el('rect', {
    x: TQ_X + TQ_L + 3,
    y: TQ_Y + TQ_A * 0.25,
    width: 4,
    height: TQ_A * 0.6,
    rx: 2,
    class: 'faixa',
  }, svg);
  for (const pct of [0, 25, 50, 75, 100]) {
    const yy = TQ_Y + TQ_A * (1 - pct / 100);
    el('line', { x1: TQ_X - 6, x2: TQ_X, y1: yy, y2: yy, class: 'escala' }, svg);
    const tx = el('text', { x: TQ_X - 9, y: yy + 3.5, class: 'escala-texto' }, svg);
    tx.textContent = `${pct}`;
  }

  // Linha do setpoint
  const linhaSp = el('line', { x1: TQ_X - 2, x2: TQ_X + TQ_L + 2, y1: 0, y2: 0, class: 'sp' }, svg);
  const spTexto = el('text', { x: TQ_X + TQ_L - 4, y: 0, class: 'sp-texto' }, svg);
  spTexto.textContent = 'SP';

  // Bomba com rotor
  el('circle', { cx: BOMBA_X, cy: BOMBA_Y, r: BOMBA_R, class: 'bomba' }, svg);
  const rotor = el('g', { class: 'rotor' }, svg);
  for (let i = 0; i < 3; i++) {
    const ang = (i * 2 * Math.PI) / 3;
    el('line', {
      x1: BOMBA_X,
      y1: BOMBA_Y,
      x2: (BOMBA_X + Math.cos(ang) * (BOMBA_R - 4)).toFixed(2),
      y2: (BOMBA_Y + Math.sin(ang) * (BOMBA_R - 4)).toFixed(2),
    }, rotor);
  }
  el('circle', { cx: BOMBA_X, cy: BOMBA_Y, r: 3, class: 'eixo' }, rotor);

  container.appendChild(svg);

  let angulo = 0;
  let deslocEntrada = 0;
  let deslocSaida = 0;
  let ultY = NaN;
  let ultSp = NaN;

  // y, sp: nível real e setpoint (%); u: comando da Bomba 2 (%); q: vazão
  // de saída equivalente (% do comando da bomba); dtReal: segundos reais desde o último quadro.
  function atualizar(y, sp, u, q, dtReal) {
    const yc = y < 0 ? 0 : y > 100 ? 100 : y;
    // Negação de <= para que o NaN inicial também desenhe
    if (!(Math.abs(yc - ultY) <= 0.01)) {
      ultY = yc;
      const h = (TQ_A - 2) * (yc / 100);
      liquido.setAttribute('y', (TQ_Y + TQ_A - 1 - h).toFixed(2));
      liquido.setAttribute('height', h.toFixed(2));
    }
    if (sp !== ultSp) {
      ultSp = sp;
      const ys = (TQ_Y + TQ_A * (1 - sp / 100)).toFixed(2);
      linhaSp.setAttribute('y1', ys);
      linhaSp.setAttribute('y2', ys);
      spTexto.setAttribute('y', (Number(ys) - 3).toFixed(2));
    }
    if (movimentoReduzido.matches || dtReal <= 0) return;
    // Rotor da bomba: rotação proporcional ao comando
    const uc = u < 0 ? 0 : u > 100 ? 100 : u;
    angulo = (angulo + uc * 7.2 * dtReal) % 360;
    rotor.setAttribute('transform', `rotate(${angulo.toFixed(1)} ${BOMBA_X} ${BOMBA_Y})`);
    // Tracejado andando na tubulação: entrada proporcional a u, saída proporcional a q
    deslocEntrada = (deslocEntrada - uc * 0.6 * dtReal) % 100;
    deslocSaida = (deslocSaida - q * 0.6 * dtReal) % 100;
    fluxoEntrada.setAttribute('stroke-dashoffset', deslocEntrada.toFixed(1));
    fluxoSaida.setAttribute('stroke-dashoffset', deslocSaida.toFixed(1));
  }

  return { atualizar };
}
