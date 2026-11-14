# Gêmeo Digital da Planta Multiprocesso (Tanque T2)

Simulação interativa no navegador da malha de nível do Tanque T2 (modelo FOPDT), comparando em paralelo o controlador PI sintonizado por IMC e o PID sintonizado por Algoritmo Genético (AG), com sintonia por AG ao vivo, modo apresentação, análise linear de estabilidade e comparação com os dados experimentais da planta.

> **Créditos:** Os dados experimentais e a identificação do modelo são fruto do Projeto Integrador do 8º semestre (SENAI) desenvolvido pela equipe de 6 integrantes (Murilo Lameira, Murilo Romualdo, Guilherme Freitas, Henry Matheus, Leonardo Apolonio e Matheus Soares) com orientação do Me. Thiago Tadeu Amici.

## Tecnologias Usadas

- **Interface e Estilos:** HTML5 semântico e CSS3 com variáveis CSS (`assets/css/estilo.css`), suporte automático a tema claro/escuro (`prefers-color-scheme`), redução de movimento (`prefers-reduced-motion`), layout responsivo e modo apresentação em tela cheia.
- **Núcleo e Simulação:** JavaScript ES2022+ puro com ES Modules nativos (sem bundler, sem transpiler e sem dependências externas em tempo de execução).
- **Computação em Segundo Plano e Gráficos:** Web Workers de módulo (`ga.worker.js`), gráficos de séries temporais com `uPlot 1.6.31` (MIT, 50 KB) vendorizado localmente em `assets/vendor/uplot/` para funcionar 100% offline, além de animações e diagramas em SVG puro (`tanque.js` e plano `s` em `painelestabilidade.js`).
- **Validação e Pré-processamento:** Python 3 com NumPy e Pandas (`dados/gerar_bloco40.py`, `validacao/paridade.py`, `validacao/fase2.py`) e Node.js 24 com `worker_threads` (`validacao/*.mjs`) para comprovar paridade numérica com os scripts originais do Projeto Integrador.
- **Documentação:** especificação em `ESCOPO.md` e fim de linha LF padronizado em `.gitattributes`.

## Estrutura de Pastas e Arquivos

```text
gemeo-digital-multiprocesso/
├── index.html                  # Página principal (simulação, AG ao vivo, estabilidade e dados reais)
├── ESCOPO.md                   # Especificação matemática, modos e critérios de aceitação
├── README.md                   # Visão geral técnica, arquitetura e execução
├── .gitignore                  # Mantém fora do Git os dados brutos e os arquivos de trabalho locais
├── .gitattributes              # Padroniza quebras de linha LF em código e documentação
├── assets/
│   ├── css/
│   │   └── estilo.css          # Tema claro/escuro, grade responsiva e estilos do modo apresentação
│   ├── js/                     # 18 módulos ES puros organizados por camada e escopo de agente
│   │   ├── sim.js              # Planta FOPDT discreta (ZOH/Euler), buffer circular de atraso e RNG
│   │   ├── pid.js              # Controlador PID paralelo, filtro derivativo, anti-windup e objeto reutilizado
│   │   ├── metricas.js         # IAE, ITAE, ISE, sobressinal, subida, acomodação, R2, RMSE e ao vivo
│   │   ├── ga.js               # Algoritmo genético puro e refinamento local Simplex Nelder-Mead
│   │   ├── ga.worker.js        # Execução assíncrona do AG em Web Worker com fatias de 8 ms
│   │   ├── estabilidade.js     # Polinômio característico, Durand-Kerner, Routh-Hurwitz, Padé e margens
│   │   ├── malhas.js           # Par sincronizado IMC x AG, perturbações (carga, theta, ruído) sem DOM
│   │   ├── exibicaoag.js       # Máquina de estados para dosar a animação da convergência (6 s + 1,6 s)
│   │   ├── textoestabilidade.js# Formatação de polinômios, polos, Routh e avisos de estabilidade
│   │   ├── exportar.js         # Buffer circular de 28.800 linhas e geração de CSV pt-BR com BOM
│   │   ├── formato.js          # Formatadores numéricos pt-BR via Intl.NumberFormat em cache
│   │   ├── app.js              # Estado da UI e laço em requestAnimationFrame (até 100x, 60 fps)
│   │   ├── ui.js               # Controles, tabela de métricas, sliders (log/quadrático) e uPlot
│   │   ├── tanque.js           # Tanque SVG animado com nível, setpoint, Bomba 2 comandada na entrada e válvula FV-02 fixa na saída
│   │   ├── dadosreais.js       # Carregamento único de bloco40.json e gráfico da aba Dados reais
│   │   ├── agaovivo.js         # Orquestração da seção AG ao vivo com fallback local para Worker
│   │   ├── painelestabilidade.js# Painel de estabilidade e plano s em SVG com escala symlog
│   │   └── apresentacao.js     # Roteiro de apresentação em 3 passos com tela cheia e atalhos
│   └── vendor/
│       └── uplot/              # Biblioteca uPlot 1.6.31 (JS, CSS e LICENSE MIT) para uso offline
├── dados/
│   ├── bloco40.json            # Recorte experimental de 4.435 pontos (degrau na Bomba 2 de 30% para 40%)
│   ├── gerar_bloco40.py        # Script de extração e ajuste R2 a partir do CSV experimental
│   └── experimento2.csv        # Dados brutos da planta (fora do Git até autorização formal)
├── validacao/
│   ├── paridade.py             # Orquestrador da suíte de paridade JS x Python (244 verificações)
│   ├── fase2.py                # Grupos 8 a 11 (AG, Worker, estabilidade com numpy, pid.passo)
│   ├── exportar_js.mjs         # Executor Node para cenários dos grupos 1 a 7
│   ├── exportar_fase2.mjs      # Executor Node para cenários da fase 2
│   ├── adaptador_worker.mjs    # Adaptador Web Worker sobre worker_threads do Node
│   ├── cache_ag_python.json    # Referência salva do AG executado em Python
│   └── README.md               # Descrição dos grupos 1 a 11 da suíte de validação
└── bridge/                     # Planejado para Fase 3 (pós-INOVA+): leitura OPC UA para WebSocket
```

## Arquitetura em 4 Camadas

1. **Camada 1, Núcleo Matemático Puro (`gemeo_sim`, sem DOM):** `sim.js`, `pid.js`, `metricas.js`, `ga.js`, `ga.worker.js` e `estabilidade.js` implementam toda a matemática da planta, do controle, da otimização e da análise em frequência sem depender de navegador.
2. **Camada 2, Orquestração e Formatação sem DOM (`gemeo_frontend`, testável em Node):** `malhas.js`, `exibicaoag.js`, `textoestabilidade.js`, `exportar.js` e `formato.js` coordenam as duas malhas, preparam séries e formatam saídas mantendo a lógica separada da renderização.
3. **Camada 3, Interface e Renderização (`gemeo_frontend`, DOM/SVG/uPlot):** `app.js`, `ui.js`, `tanque.js`, `dadosreais.js`, `agaovivo.js`, `painelestabilidade.js` e `apresentacao.js` consomem as camadas inferiores via laço `requestAnimationFrame` (`JANELA = 1200 s`, atualização de DOM a cada `0,2 s`) mantendo a matemática isolada.
4. **Camada 4, Validação Cruzada (`gemeo_qa`):** `paridade.py` e `fase2.py` executam cenários nos módulos JS via Node (`*.mjs`) e comparam os resultados ponto a ponto contra os scripts em Python e o `numpy`.

## Estruturas de Dados Principais

- **Atraso de Transporte (`sim.js`):** buffer circular pré-alocado em `Float64Array` (`hist`) armazenando desvios `u - u0`, com redimensionamento preservando a ordem temporal apenas se `theta` ultrapassar a capacidade inicial (`THETA_MAX = 60 s`).
- **Controle e Zero-Alocação (`pid.js`, `malhas.js`):** cada controlador reutiliza um único objeto de saída `res = { u, uCalc, e }`, e `criarSistema` reutiliza `argPid`, `argMet` e `argReinicio` para sustentar 100x sem pressão no coletor de lixo.
- **Otimização Genética (`ga.js`, `ga.worker.js`):** populações planas em `Float64Array(nPop * 3)`, objeto `aval` único em `avaliarOraculo`, refinamento local Simplex Nelder-Mead e execução no Worker em fatias de `8 ms` com `setTimeout(0)` para responder ao comando `parar`.
- **Estabilidade Linear (`estabilidade.js`):** polinômios característicos em `Float64Array` (potências decrescentes), raízes via fórmula fechada (graus 1 e 2) ou Durand-Kerner com polimento de Newton (grau >= 3), tabela de Routh-Hurwitz e varredura logarítmica de margens exatas em `L(jw)`.
- **Histórico CSV (`exportar.js`):** matriz circular plana em `Float64Array` com capacidade de `28.800` linhas (4 horas a `0,5 s`) por `14` colunas, gerando CSV pt-BR (`;`, vírgula decimal, BOM UTF-8 no download).

## Como Executar e Validar

### Servir a página localmente
ES Modules não carregam via protocolo `file://`. Na raiz do projeto, execute:

```bash
python -m http.server 8010
```

Depois acesse `http://localhost:8010/`.

### Rodar a suíte de paridade (244 verificações)
Requer Node.js 22+ (validado em Node 24) e Python com `numpy` no ambiente do usuário (sem `-I`):

```bash
python validacao/paridade.py
```
