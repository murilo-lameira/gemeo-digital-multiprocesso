// adaptador_worker.mjs: roda assets/js/ga.worker.js dentro de um worker_threads do Node.
// O ga.worker.js usa self.postMessage e self.onmessage (API do Web Worker). Aqui
// self é simulado sobre o parentPort, sem alterar o módulo testado.
// Uso: new Worker('validacao/adaptador_worker.mjs') e worker.postMessage({tipo, ...}).

import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

globalThis.self = {
  postMessage: (m) => parentPort.postMessage(m),
  onmessage: null,
};

await import(pathToFileURL(join(raiz, 'assets', 'js', 'ga.worker.js')).href);

parentPort.on('message', (data) => {
  globalThis.self.onmessage({ data });
});
parentPort.postMessage({ tipo: 'pronto' });
