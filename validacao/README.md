# Validação: paridade com o oráculo Python do PI

Prova que a simulação em JS (`assets/js`) reproduz o Projeto Integrador (equipe de 6 integrantes) com erro de no máximo 1%.

## Como rodar
Na raiz do projeto, **sem `-I`** (o numpy está no site-packages do usuário):

```
python validacao/paridade.py
```

Precisa de Node 22+ (usa Node 24) e do oráculo em `F:\Faculdade\Projetos\Projeto Integrador 8 semestre\scripts` (somente leitura, nada é copiado para lá). Imprime a tabela PASSOU/FALHOU e sai com código 0 só se tudo passar.

## Arquivos
- `exportar_js.mjs`: roda os cenários nos módulos JS e imprime JSON. Recebe os ganhos por stdin.
- `paridade.py`: gera os cenários, chama o Node, roda o Python do PI e compara.
- `fase2.py`: grupos 8 a 11 (AG, Worker, estabilidade, pid.passo), chamado por `paridade.py`.
- `exportar_fase2.mjs`: roda AG, Worker, estabilidade e pid.passo nos módulos JS e imprime JSON.
- `adaptador_worker.mjs`: simula `self` do Web Worker sobre `worker_threads` para testar `ga.worker.js`.
- `cache_ag_python.json`: ganhos do `otimizar_pid_genetico` (cerca de 29 s), com a data. Refazer: `python validacao/paridade.py --refazer-python`.

## O que cada grupo prova
- **1 e 2 (oráculo):** IMC, AG, 3 ganhos aleatórios (semente fixa, limites do AG, um satura o atuador) e dt = 1,0 s. Os 6 índices batem com `calcular_indices_desempenho` (1%; sobressinal em 0,01 ponto) e as séries y e u ponto a ponto. IMC e AG também contra a tabela do ESCOPO.md.
- **3 (R² do bloco 40):** R² em JS igual ao do Python (4 casas, 99,96%). `bloco40.json` tem a mesma contagem e os mesmos `t_norm` do recorte `iloc[10620:15055]`. O CSV é lido de `dados/` com `os.chdir` temporário.
- **4 (físico, regime):** u final = u0 + (50 - y0)/K (± 0,1) e y final = 50 (± 0,05).
- **5 (físico x oráculo deslocado):** com theta 0 e comando sem saturar, diferença de até 1% do degrau.
- **6 (métricas ao vivo):** `MetricasAoVivo` igual a `calcularIndices` (1e-6); degrau de 50 para 30 dá subida e acomodação finitas e positivas.
- **7 (desempenho):** 2 malhas, 400 passos por quadro, 60 quadros por segundo de relógio a 100x. Passa com média abaixo de 2 ms e máximo abaixo de 16 ms. É uma aproximação em Node, sem render.
- **8 (AG, critério da seção 7):** seed 42 com os padrões e refino, e 20 sementes fixas com nPop 120 e nGen 150: ITAE <= 70.000 (oráculo, dt 0,5 s), sobressinal <= 5%, tempo <= 3 s. Compara com o Python do PI: Kp (1%), Ti = Kp/Ki dentro de 2% de tau e ITAE igual ou melhor (+1%). Sem refino, o histórico tem nGen entradas não crescentes (elitismo).
- **9 (Worker):** `ga.worker.js` em `worker_threads`: início completo (nGen mensagens `geracao` e um `fim`, igual ao `otimizarPID`), `parar` no meio (`parado` parcial), `parar` ocioso, limites inválidos e mensagem desconhecida (`erro`) e novo `iniciar` que substitui o anterior.
- **10 (estabilidade x numpy):** 16 conjuntos (IMC, AG, AG com Kd 5, manual Kp 3 e Ki 0,007, 3 aleatórios, com e sem filtro, theta 0, 15, 30, 55 e 60 com Padé). Coeficientes montados com `numpy.polymul` pelas fórmulas do ESCOPO (erro relativo <= 1e-12), polos contra `numpy.roots` (<= 1e-9), Routh igual a "todos os polos com Re < 0" e margens contra varredura densa de 2 milhões de pontos (1e-3). Reproduz o caso AG theta 60 s: Padé estável, MG -0,29 dB e MF -3,06 graus, e `simularFisico` oscila sem decair, enquanto theta 55 s decai.
- **11 (pid.passo reaproveitado):** a mesma referência volta em chamadas sucessivas (oráculo e físico) e os grupos 1 a 7 seguem sem falha.

## Observações
- Sem `control` instalado, as margens usam varredura densa em numpy (fase desenrolada, interpolação nos cruzamentos).
- O JSON troca `Infinity` por `null`: `fase2.py` converte de volta (margem de ganho infinita com theta 0 e sem filtro).
- O AG com refino acaba em Kp 1,5 (teto) e Kd perto de 0: Ti fica em 431,5 s, igual ao tau.

## Observação
O `bloco40.json` guarda o nível com 3 casas, então o teste aceita erro de 5e-4 no nível. O R² não é afetado (diferença de 2e-8).
