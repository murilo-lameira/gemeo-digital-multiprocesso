// formato.js: formatação de números em pt-BR, sem DOM (roda em Node).

// Formatadores criados uma vez (Intl é caro de construir).
const formatadores = new Map();
function formatador(casas) {
  let f = formatadores.get(casas);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
    formatadores.set(casas, f);
  }
  return f;
}

export function formatarNumero(valor, casas = 2) {
  if (valor == null || !Number.isFinite(valor)) return 'em curso';
  return formatador(casas).format(valor);
}

// Ganhos pequenos (Ki da ordem de 0,001) precisam de algarismos
// significativos, não de casas fixas.
export function formatarGanho(valor) {
  if (!Number.isFinite(valor)) return 'em curso';
  if (valor === 0) return '0';
  const a = Math.abs(valor);
  const casas = a >= 1 ? 3 : Math.min(8, Math.ceil(-Math.log10(a)) + 3);
  return formatador(casas).format(valor);
}
