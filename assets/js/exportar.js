// exportar.js: histórico da simulação e exportação em CSV para o Excel pt-BR.
// O histórico é um buffer circular pré-alocado (Float64Array), sem alocação
// por passo. A geração do texto não usa DOM e roda em Node para os testes;
// só baixarCsv() precisa do navegador.

export const COLUNAS = [
  'tempo_s',
  'setpoint_pct',
  'nivel_imc_pct',
  'comando_imc_pct',
  'nivel_ag_pct',
  'comando_ag_pct',
  'medicao_imc_pct',
  'medicao_ag_pct',
  'carga_pct',
  'theta_s',
  'controlador_azul',
  'Kp_azul',
  'Ki_azul',
  'Kd_azul',
];

// 4 horas simuladas a 0,5 s.
export const CAPACIDADE_PADRAO = 28800;

const NC = COLUNAS.length;
const COL_CONTROLADOR = 10;

// O Excel em pt-BR só lê os acentos de um CSV UTF-8 com BOM.
export const BOM = '﻿';
const SEP = ';';
const FIM = '\r\n';

export function criarHistorico(capacidade = CAPACIDADE_PADRAO) {
  const dados = new Float64Array(capacidade * NC);
  let inicio = 0;
  let contagem = 0;

  // sis: sistema de malhas.js; manual: malha azul em modo manual;
  // g: ganhos em uso na malha azul ({Kp, Ki, Kd}).
  function registrar(sis, manual, g) {
    let linha;
    if (contagem < capacidade) {
      linha = inicio + contagem;
      if (linha >= capacidade) linha -= capacidade;
      contagem++;
    } else {
      linha = inicio; // cheio: sobrescreve a linha mais antiga
      inicio++;
      if (inicio >= capacidade) inicio = 0;
    }
    const o = linha * NC;
    const imc = sis.imc;
    const ag = sis.ag;
    dados[o] = sis.t;
    dados[o + 1] = sis.setpoint;
    dados[o + 2] = imc.y;
    dados[o + 3] = imc.u;
    dados[o + 4] = ag.y;
    dados[o + 5] = ag.u;
    dados[o + 6] = imc.yMed;
    dados[o + 7] = ag.yMed;
    dados[o + 8] = sis.carga;
    dados[o + 9] = sis.theta;
    dados[o + 10] = manual ? 1 : 0;
    dados[o + 11] = g.Kp;
    dados[o + 12] = g.Ki;
    dados[o + 13] = g.Kd;
  }

  function limpar() {
    inicio = 0;
    contagem = 0;
  }

  // Valor da coluna c na i-ésima linha mais antiga (i de 0 a contagem - 1).
  function valor(i, c) {
    let linha = inicio + i;
    if (linha >= capacidade) linha -= capacidade;
    return dados[linha * NC + c];
  }

  return {
    capacidade,
    registrar,
    limpar,
    valor,
    get contagem() { return contagem; },
  };
}

// Número com vírgula decimal e casas fixas, sem "-0". Nunca escreve
// "Infinity" nem "NaN": infinito vira "infinita" e NaN vira célula vazia.
export function decimal(v, casas) {
  if (!Number.isFinite(v)) {
    if (Number.isNaN(v)) return '';
    return v > 0 ? 'infinita' : '-infinita';
  }
  let s = v.toFixed(casas);
  if (s.charCodeAt(0) === 45 && Number(s) === 0) s = s.slice(1);
  return s.replace('.', ',');
}

// Ganho com 6 algarismos significativos, sem notação científica
// (Ki chega a 0,00001) e sem zeros à direita.
function ganho(v) {
  if (v === 0 || !Number.isFinite(v)) return '0';
  const casas = Math.min(12, Math.max(0, 5 - Math.floor(Math.log10(Math.abs(v)))));
  let s = v.toFixed(casas);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

// Casas decimais por coluna (ganhos e controlador têm formato próprio).
const CASAS = [1, 4, 4, 4, 4, 4, 4, 4, 2, 1];

const dois = (n) => String(n).padStart(2, '0');

export function dataHoraBr(data) {
  return `${dois(data.getDate())}/${dois(data.getMonth() + 1)}/${data.getFullYear()} `
    + `${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

export function nomeArquivo(data = new Date()) {
  return `gemeo-digital-t2-${data.getFullYear()}${dois(data.getMonth() + 1)}${dois(data.getDate())}`
    + `-${dois(data.getHours())}${dois(data.getMinutes())}.csv`;
}

export function comentarioInicial(data) {
  return '# Gêmeo Digital T2. Modelo e dados: Projeto Integrador do 8º semestre (SENAI), '
    + `equipe de 6 integrantes. Exportado em ${dataHoraBr(data)}.`;
}

// Texto do CSV (sem BOM): comentário, cabeçalho e uma linha por passo.
export function gerarCsv(hist, data = new Date()) {
  const n = hist.contagem;
  const linhas = new Array(n + 2);
  linhas[0] = comentarioInicial(data);
  linhas[1] = COLUNAS.join(SEP);
  const campos = new Array(NC);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < CASAS.length; c++) campos[c] = decimal(hist.valor(i, c), CASAS[c]);
    campos[COL_CONTROLADOR] = hist.valor(i, COL_CONTROLADOR) === 1 ? 'Manual' : 'IMC';
    campos[11] = ganho(hist.valor(i, 11));
    campos[12] = ganho(hist.valor(i, 12));
    campos[13] = ganho(hist.valor(i, 13));
    linhas[i + 2] = campos.join(SEP);
  }
  return linhas.join(FIM) + FIM;
}

// Conteúdo do arquivo exportado: o BOM só entra aqui.
export function conteudoArquivo(texto) {
  return BOM + texto;
}

// Navegador: gera o arquivo com Blob e dispara o download.
export function baixarCsv(texto, nome) {
  const blob = new Blob([conteudoArquivo(texto)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
