// exibicaoag.js: dosagem da exibição do AG ao vivo. Sem DOM (roda em Node).
// O AG inteiro roda em poucas centenas de milissegundos no Worker, rápido
// demais para a banca acompanhar. As mensagens 'geracao' ficam guardadas e a
// tela reproduz a convergência num tempo fixo, independente da velocidade
// real do Worker. Depois vem a etapa do refinamento local e o resultado.
//
// Fases: 'ag' (gerações aparecendo), 'refino' (etapa do Nelder-Mead),
// 'final' (resultado). Os tempos são em segundos de relógio.

export const DURACAO_AG = 6;
export const DURACAO_REFINO = 1.6;

// Quantas gerações aparecem depois de "decorrido" segundos de exibição.
// A primeira aparece logo no início; a última só quando o tempo acaba, então
// o último quadro mostra sempre o valor final do AG.
export function geracoesVisiveis(decorrido, total, duracao = DURACAO_AG) {
  if (!(total > 0)) return 0;
  if (!(duracao > 0) || decorrido >= duracao) return total;
  if (!(decorrido > 0)) return 1;
  const k = Math.ceil((total * decorrido) / duracao);
  return k < 1 ? 1 : k > total - 1 ? total - 1 : k;
}

// Máquina de estados da exibição. total = nGen.
// receberGeracao(g): chegou a mensagem da geração g (1 a total).
// receberFim(): chegou o 'fim' (com o refinamento pronto).
// quadro(agora): chamado a cada requestAnimationFrame com o relógio em
// segundos; devolve o mesmo objeto de estado (sem alocar por quadro).
// pular(): vai direto ao resultado, se o 'fim' já chegou.
export function criarExibicao({ total, duracaoAg = DURACAO_AG, duracaoRefino = DURACAO_REFINO }) {
  let inicio = null;
  let inicioRefino = null;
  let recebidas = 0;
  let fimRecebido = false;
  let pularPedido = false;
  const estado = { fase: 'ag', visiveis: 0, decorrido: 0, progressoRefino: 0, mudouFase: false };

  function mudar(fase) {
    estado.fase = fase;
    estado.mudouFase = true;
  }

  return {
    receberGeracao(g) {
      if (g > recebidas) recebidas = g > total ? total : g;
    },
    receberFim() {
      fimRecebido = true;
      recebidas = total;
    },
    pular() {
      pularPedido = true;
    },
    quadro(agora) {
      estado.mudouFase = false;
      if (inicio === null) inicio = agora;
      estado.decorrido = agora - inicio;
      if (estado.fase === 'ag') {
        const alvo = pularPedido ? total : geracoesVisiveis(estado.decorrido, total, duracaoAg);
        estado.visiveis = alvo < recebidas ? alvo : recebidas;
        const tempoAcabou = pularPedido || estado.decorrido >= duracaoAg;
        if (estado.visiveis === total && tempoAcabou && fimRecebido) {
          inicioRefino = agora;
          mudar('refino');
        }
      } else if (estado.fase === 'refino') {
        const d = agora - inicioRefino;
        estado.progressoRefino = duracaoRefino > 0 ? Math.min(1, d / duracaoRefino) : 1;
        if (pularPedido || d >= duracaoRefino) {
          estado.progressoRefino = 1;
          mudar('final');
        }
      }
      return estado;
    },
    get fase() { return estado.fase; },
    get terminou() { return estado.fase === 'final'; },
    get recebidas() { return recebidas; },
  };
}

// Simula a exibição com quadros regulares (para testes e para estimar a
// duração): devolve quantos quadros cada fase levou e a sequência de gerações
// visíveis por quadro da fase 'ag'.
export function simularQuadros({ total, fps = 60, duracaoAg = DURACAO_AG, duracaoRefino = DURACAO_REFINO }) {
  const ex = criarExibicao({ total, duracaoAg, duracaoRefino });
  for (let g = 1; g <= total; g++) ex.receberGeracao(g);
  ex.receberFim();
  const visiveis = [];
  let quadrosRefino = 0;
  let n = 0;
  const limite = Math.ceil((duracaoAg + duracaoRefino + 2) * fps);
  while (n < limite) {
    const e = ex.quadro(n / fps);
    n++;
    if (e.fase === 'ag') visiveis.push(e.visiveis);
    else if (e.fase === 'refino' && !e.mudouFase) quadrosRefino++;
    if (e.fase === 'refino' && e.mudouFase) visiveis.push(e.visiveis);
    if (e.fase === 'final') break;
  }
  return { quadros: n, segundos: (n - 1) / fps, quadrosAg: visiveis.length, quadrosRefino, visiveis };
}
