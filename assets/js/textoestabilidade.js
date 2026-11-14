// textoestabilidade.js: textos do painel de estabilidade em pt-BR, a partir
// do resultado de analisar() (estabilidade.js, gemeo_sim). Sem DOM (roda em
// Node). Nenhum texto sai como "Infinity" ou "NaN": margem sem cruzamento
// vira "infinita", atraso sem limite vira "infinito".

import { formatarNumero } from './formato.js';

// Formatadores sem zeros à direita, criados uma vez por número de casas.
const enxutos = new Map();
function enxuto(v, casas) {
  let f = enxutos.get(casas);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
    enxutos.set(casas, f);
  }
  return f.format(v);
}

const SOBRESCRITO = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const MENOS = '−'; // sinal de menos tipográfico (não é travessão)

export function potencia(n) {
  if (n === 0) return '';
  if (n === 1) return 's';
  return `s${String(n).split('').map((d) => SOBRESCRITO[d]).join('')}`;
}

// Número com até "sig" algarismos significativos (sem zeros à direita),
// vírgula decimal e ponto de milhar. Não finito: "infinito" (ou o texto pedido); NaN: "indefinido".
export function formatarSig(v, sig = 4, infinito = 'infinito') {
  if (Number.isNaN(v) || v == null) return 'indefinido';
  if (!Number.isFinite(v)) return v > 0 ? infinito : `${MENOS}${infinito}`;
  if (v === 0) return '0';
  const casas = Math.min(10, Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v)))));
  const t = enxuto(v, casas);
  return t.startsWith('-') ? MENOS + t.slice(1) : t;
}

// Polinômio em potências decrescentes de s: "431,52 s² + 4 s + 0,0069522 = 0".
export function formatarEquacao(coefs, sig = 5) {
  const c = Array.from(coefs);
  const n = c.length - 1;
  const partes = [];
  for (let i = 0; i <= n; i++) {
    const v = c[i];
    if (v === 0) continue;
    const grau = n - i;
    const abs = formatarSig(Math.abs(v), sig);
    const termo = grau === 0 ? abs : `${abs} ${potencia(grau)}`;
    if (partes.length === 0) partes.push(v < 0 ? `${MENOS}${termo}` : termo);
    else partes.push(v < 0 ? `${MENOS} ${termo}` : `+ ${termo}`);
  }
  if (partes.length === 0) partes.push('0');
  return `${partes.join(' ')} = 0`;
}

// Polo: "−0,02707" (real) ou "−0,0198 + 0,03759j" (complexo).
export function formatarPolo(p, sig = 4) {
  const re = formatarSig(p.re, sig);
  if (p.im === 0) return re;
  const im = formatarSig(Math.abs(p.im), sig);
  return `${re} ${p.im < 0 ? MENOS : '+'} ${im}j`;
}

export function textoMargemGanho(db) {
  if (db == null || db === Infinity) return 'infinita';
  if (Number.isNaN(db)) return 'indefinida';
  if (db === -Infinity) return `${MENOS}infinita`;
  const t = formatarNumero(db, 1);
  return `${t.startsWith('-') ? MENOS + t.slice(1) : t} dB`;
}

export function textoMargemFase(graus) {
  if (graus == null || graus === Infinity) return 'infinita';
  if (!Number.isFinite(graus)) return 'indefinida';
  const t = formatarNumero(graus, 1);
  return `${t.startsWith('-') ? MENOS + t.slice(1) : t}°`;
}

// Atraso adicional que a malha tolera antes de instabilizar.
export function textoAtraso(s) {
  if (s == null || s === Infinity) return 'infinito';
  if (!Number.isFinite(s)) return 'indefinido';
  if (s < 0) return 'nenhum: a malha já é instável';
  return `${formatarNumero(s, s < 10 ? 1 : 0)} s`;
}

export function textoFrequencia(w) {
  if (w == null || !Number.isFinite(w)) return 'sem cruzamento';
  return `${formatarSig(w, 3)} rad/s`;
}

export function textoRouth(r) {
  if (r.estavel) {
    return { estavel: true, titulo: 'Estável', detalhe: 'Nenhuma mudança de sinal na primeira coluna: todos os polos no semiplano esquerdo.' };
  }
  if (r.epsilonUsado || r.linhaNula) {
    const m = r.mudancasDeSinal;
    return {
      estavel: false,
      titulo: m > 0 ? 'Instável' : 'Marginal',
      detalhe: m > 0
        ? `${m} ${m === 1 ? 'mudança' : 'mudanças'} de sinal na primeira coluna (com caso especial de Routh).`
        : 'Há polos sobre o eixo imaginário (caso especial de Routh).',
    };
  }
  const m = r.mudancasDeSinal;
  return {
    estavel: false,
    titulo: 'Instável',
    detalhe: `${m} ${m === 1 ? 'mudança' : 'mudanças'} de sinal na primeira coluna: ${m} ${m === 1 ? 'polo' : 'polos'} no semiplano direito.`,
  };
}

// Tabela de Routh formatada: [{ linha: 's³', valores: ['1,295', ...] }].
export function formatarTabelaRouth(tabela, sig = 4) {
  const n = tabela.length - 1;
  return tabela.map((linha, r) => ({
    linha: potencia(n - r) || 's⁰',
    valores: linha.map((v) => formatarSig(v, sig)),
  }));
}

export const TRECHO_DISCORDANCIA = 'atraso exato';

// Resumo completo de uma malha para a interface.
export function resumirAnalise(a) {
  const routh = textoRouth(a.routh);
  const m = a.margens;
  const instavelExato = m.margemGanhoDb < 0 || m.margemFaseGraus < 0;
  const discordancia = a.avisos.find((t) => t.includes(TRECHO_DISCORDANCIA)) || null;
  return {
    equacao: formatarEquacao(a.coefs),
    grau: a.coefs.length - 1,
    polos: a.polos.map((p) => ({
      re: formatarSig(p.re, 4),
      im: p.im === 0 ? '0' : formatarSig(p.im, 4),
      texto: formatarPolo(p),
    })),
    routh,
    tabelaRouth: formatarTabelaRouth(a.routh.tabela),
    margemGanho: textoMargemGanho(m.margemGanhoDb),
    margemFase: textoMargemFase(m.margemFaseGraus),
    atraso: textoAtraso(m.margemAtrasoS),
    frequenciaFase: textoFrequencia(m.frequenciaCruzamentoFase),
    frequenciaGanho: textoFrequencia(m.frequenciaCruzamentoGanho),
    estavelExato: !instavelExato,
    aproximado: a.aproximado,
    discordancia,
    outrosAvisos: a.avisos.filter((t) => t !== discordancia),
  };
}
