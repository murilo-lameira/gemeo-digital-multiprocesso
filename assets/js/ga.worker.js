// ga.worker.js: roda o algoritmo genético (ga.js) num Web Worker de módulo.
// Uso na página:
//   const w = new Worker(new URL('./ga.worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ tipo: 'iniciar', parametros: { nPop: 60, nGen: 80 } });
//   w.postMessage({ tipo: 'parar' });
// Mensagens enviadas:
//   { tipo: 'geracao', geracao, melhorCusto, Kp, Ki, Kd } a cada geração;
//   { tipo: 'fim', resultado } ao terminar (já com o refinamento, ver ga.js);
//   { tipo: 'parado', resultado } se recebeu 'parar' (parcial, sem refinamento);
//   { tipo: 'erro', mensagem } se falhar.
// Um 'iniciar' durante uma execução cancela a anterior (sem enviar 'parado'
// dela) e começa outra. 'parar' sem execução responde parado com resultado null.
//
// Cessão da vez: o laço roda gerações em fatias de até FATIA_MS e, entre
// fatias, cede com setTimeout 0 para a mensagem 'parar' ser entregue. Ceder a
// cada geração custaria o atraso mínimo do setTimeout (4 ms nos navegadores,
// cerca de 15 ms no Windows) 80 vezes. MessageChannel foi testado e descartado:
// no Node a porta interna monopoliza a fila e o 'parar' não chega.

import { criarOtimizador } from './ga.js';

const FATIA_MS = 8;

let execucao = 0; // identifica a execução corrente
let pararPedido = false;
let otAtual = null;

const agora = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

function ceder() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function rodar(parametros) {
  const minha = ++execucao;
  pararPedido = false;
  try {
    // aoGerar não atravessa postMessage; ignora se vier.
    const { aoGerar, ...p } = parametros || {};
    const ot = criarOtimizador(p);
    otAtual = ot;
    let inicioFatia = agora();
    while (!ot.terminado) {
      const info = ot.proximaGeracao();
      self.postMessage({ tipo: 'geracao', ...info });
      if (agora() - inicioFatia >= FATIA_MS) {
        await ceder();
        inicioFatia = agora();
        if (minha !== execucao) return; // substituída por outro 'iniciar'
        if (pararPedido) {
          otAtual = null;
          self.postMessage({ tipo: 'parado', resultado: ot.resultado() });
          return;
        }
      }
    }
    otAtual = null;
    self.postMessage({ tipo: 'fim', resultado: ot.resultado() });
  } catch (err) {
    if (minha === execucao) otAtual = null;
    self.postMessage({ tipo: 'erro', mensagem: String(err && err.message ? err.message : err) });
  }
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  if (msg.tipo === 'iniciar') {
    rodar(msg.parametros);
  } else if (msg.tipo === 'parar') {
    if (otAtual) pararPedido = true;
    else self.postMessage({ tipo: 'parado', resultado: null });
  } else {
    self.postMessage({ tipo: 'erro', mensagem: `Mensagem desconhecida: ${msg.tipo}` });
  }
};
