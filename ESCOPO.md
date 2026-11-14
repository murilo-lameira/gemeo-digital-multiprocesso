# Escopo: Gêmeo Digital da Planta Multiprocesso (Tanque T2)

Simulação interativa no navegador da malha de nível do Tanque T2 da Planta de Instrumentação Multiprocesso do SENAI. Compara ao vivo o PID clássico (IMC) com o PID sintonizado por algoritmo genético. Usa o modelo FOPDT identificado no Projeto Integrador do 8º semestre.

- **Para quem:** banca do INOVA+ (07/12, 18h30) e o portfólio (murilo-lameira.github.io).
- **Prazos:** MVP (fase 1) até 27/11. Versão da apresentação (fase 2) até 04/12, para sobrar o fim de semana de ensaio.
- **Origem dos dados:** `F:\Faculdade\Projetos\Projeto Integrador 8 semestre` (docs, scripts e gráficos). O CSV bruto foi copiado para `dados/experimento2.csv`.
- **Revisado em 14/11** com revisão cruzada do Gemini, conferida contra o código e o CSV.

---

## 1. Por que este projeto

- O modelo e os ganhos já existem e estão validados ($R^2 = 99{,}96\%$). O trabalho novo é a experiência interativa, não a pesquisa.
- Na banca, a pessoa mexe num controle e vê a resposta na hora, em vez de olhar um gráfico parado.
- No portfólio, é o primeiro projeto que roda no navegador sem instalar nada.

## 2. Base técnica (fonte da verdade)

| Item | Valor | Onde está no PI |
|---|---|---|
| Modelo | $G(s) = \dfrac{K e^{-\theta s}}{\tau s + 1}$ | `docs/01_ETAPAS_01_A_06_IDENTIFICACAO.md` |
| Ganho $K$ | $7{,}7909$ %/% (ajuste do AG). A razão direta do degrau dá $7{,}7916$ %/% e $11{,}1948$ %/Hz | idem |
| Constante de tempo $\tau$ | $431{,}52$ s | idem |
| Tempo morto $\theta$ | $0$ s | idem |
| Degrau de identificação | Degrau na Bomba 2 (`DegrauP` de 30% para 40%, `DegrauHz` de 17,6 Hz para 23,4 Hz), com a válvula FV-02 fixa. O script calcula $\Delta U$ = 7,692% (5,354 Hz) porque a média antes do degrau pega 3 amostras já em 40%. Nível de 15,71% para 75,65% | `scripts/identificacao_fopdt.py` |
| Atuador | Bomba 2 por inversor (0 a 100% de comando, Hz = 0,585 × DegrauP) alimentando o tanque; válvula FV-02 na saída em abertura fixa | Bancada VTB SENAI e `docs/02_ETAPAS_07_A_10_SINTONIA_PID.md` |
| PI por IMC | $K_p = 0{,}3851$, $K_i = 0{,}000892$ s⁻¹, $K_d = 0$ ($\tau_{mf} = \tau/3$) | idem |
| PID por AG (ITAE) | $K_p = 1{,}4994$, $K_i = 0{,}003475$ s⁻¹, $K_d = 0{,}0030$ s | idem |
| Simulação de referência | degrau de setpoint de 0 para 50%, com anti-reset windup | `scripts/projeto_pid_comparativo.py` |

Nota: no CSV, `DegrauP` só assume valores inteiros (0, 10, 20, 30, 40 e 50%) e `DegrauHz` acompanha uma a duas amostras depois, com Hz = 0,585 × DegrauP. As duas colunas são da Bomba 2, como diz `docs/01_ETAPAS_01_A_06_IDENTIFICACAO.md`. Com o degrau real de 10%, o ganho por unidade seria K ≈ 5,99 %/%; o produto K × $\Delta U$ e o R² não mudam. Em discussão com a equipe e o orientador; o gêmeo mantém os valores do PI.

Métricas que a simulação nova precisa reproduzir (tolerância de 1%, modo oráculo, $dt$ = 0,5 s, 1200 s):

| Índice | IMC | AG |
|---|---|---|
| IAE | 7.190,31 | 1.847,07 |
| ITAE | 1.032.221,71 | 68.265,58 |
| ISE | 180.113,03 | 46.492,83 |
| Sobressinal | 0,00% | 0,00% |
| Tempo de subida | 315,5 s | 80,5 s |
| Tempo de acomodação (±2%) | 561,5 s | 143,5 s |

Colunas do CSV: `codepk`, `Data_Hora`, `Nível` (0 a 100%), `DegrauHz` (escala em Hz registrada no supervisório), `DegrauP` (0 a 100% de comando da Bomba 2). O degrau usado na identificação é o bloco 40: `iloc[10620:15055]`, degrau no índice 12, recorte com `t_norm >= -10` (na prática começa em -6 s, 4.435 pontos com os tempos reais de `Data_Hora`).

### 2.1 Modos de simulação

- **Modo oráculo (paridade com o PI):** cópia exata do script Python. Variáveis de desvio com nível inicial 0, Euler explícito `y += (K*u - y)*dt/tau`, derivada na medição sem filtro, integral somada depois de calcular `u` e anti-windup `u_calc == u_sat` ou `sign(e) != sign(u_calc)`. Simulação com $dt$ = 0,5 s; a aptidão do AG usa $dt$ = 1,0 s e 1200 s, como no script.
- **Modo físico (interface):** em torno do ponto de operação $u_0$ = 32,3% e $y_0$ = 15,71%. Nível $y = y_0 + \Delta y$ e comando $u = \text{clip}(u_0 + \Delta u, 0, 100)$, então a margem até a saturação é de 67,7% para cima e 32,3% para baixo. Discretização exata (ZOH), tempo morto com buffer circular, filtro na derivada com $N = 10$ e anti-windup por clamping assimétrico: integra se `u_calc == u_sat` ou `sign(e) != sign(u_calc - u_sat)`.

## 3. Stack

- **Página estática:** HTML, CSS e JavaScript puro, sem build. Repositório próprio, publicado por GitHub Pages como subpágina do portfólio.
- **Gráficos:** uPlot, copiado para `assets/vendor/` (sem CDN obrigatória).
- **Simulação:** módulos puros, testáveis em Node, com os dois modos da seção 2.1.
- **Validação:** scripts em `validacao/` comparam a saída do JS com `projeto_pid_comparativo.py` e `identificacao_fopdt.py`, que são o oráculo de teste.
- **AG no navegador (fase 2):** roda num Web Worker. O JS não tem o gerador do NumPy (`seed 42`), então o resultado não é idêntico ao do PI; o critério é de qualidade (seção 7).

## 4. Funcionalidades

### Fase 1: MVP (até 27/11)
1. Tanque animado com nível, Bomba 2 comandada na entrada, válvula FV-02 fixa na saída e setpoint, e gráfico de nível e comando da bomba ao lado.
2. Os dois controladores lado a lado na mesma tela (IMC e AG), com a mesma entrada.
3. Controles: setpoint, velocidade da simulação (1x a 100x), pausar, reiniciar.
4. Perturbações:
   - Carga: degrau na vazão de saída, modelado como $\tau \dot{y} + y = K (u - d)$, com $d$ de -20% a +20% (valor positivo esvazia o tanque).
   - Ruído de medição gaussiano, liga e desliga. O desvio padrão vem do resíduo do modelo no bloco 40.
   - Tempo morto ajustável ($\theta$ de 0 a 60 s) para mostrar o limite do modelo.
5. Métricas ao vivo: IAE, ITAE, ISE, sobressinal, tempo de subida e de acomodação. A cada mudança de setpoint o relógio das métricas zera e tudo passa a ser relativo ao novo degrau $\Delta SP = SP_{novo} - y$ naquele instante (subida de 10% a 90% de $\Delta SP$, sobressinal relativo a $|\Delta SP|$, banda de ±2% de $|\Delta SP|$). Vale também para degraus negativos.
6. Modo manual: sliders de $K_p$, $K_i$, $K_d$ para a pessoa tentar bater o AG.
7. Aba "Dados reais": sobrepõe o degrau do bloco 40 com a resposta do modelo e mostra o $R^2$. A página lê só `dados/bloco40.json`, nunca o CSV completo.

### Fase 2: apresentação (até 04/12)
8. AG ao vivo: botão "Sintonizar" que roda o algoritmo genético no Worker e mostra a convergência (melhor ITAE por geração e ganhos evoluindo).
9. Modo apresentação: tela cheia, fonte grande, roteiro em 3 cliques para a banca (degrau, perturbação, AG ao vivo).
10. Estabilidade, recalculada a cada mudança de ganho:
    - Sem filtro e com $\theta = 0$: $(\tau + K K_d)s^2 + (1 + K K_p)s + K K_i = 0$. A derivada na medição muda os zeros, não os polos.
    - Com filtro $T_f = K_d/(K_p N)$: $s(\tau s + 1)(T_f s + 1) + K[(K_p s + K_i)(T_f s + 1) + K_d s^2] = 0$, de 3ª ordem.
    - Com $\theta > 0$: Routh sobre a aproximação de Padé de 1ª ordem, mais margens de ganho e de fase pela resposta em frequência. A página avisa que é aproximação e que a saturação não entra na análise linear.
11. Exportar CSV da simulação.

### Fase 3: depois do INOVA+
12. Ponte com a planta real: Python com `asyncua` lê o servidor OPC UA do SENAI (só leitura) e envia por WebSocket. A página mostra planta real e gêmeo lado a lado.
13. Post no portfólio: "Um gêmeo digital do tanque que a gente sintonizou".

## 5. Fora do escopo
- Escrever na planta real (só leitura, sempre).
- Modelo não linear do tanque ou outras malhas da planta (vazão, pressão, temperatura).
- Backend, login ou banco de dados.

## 6. Estrutura

```
gemeo-digital-multiprocesso/
├── ESCOPO.md, AGENTS.md, MEMORY.md, CLAUDE.md
├── index.html
├── assets/
│   ├── css/
│   ├── js/       sim.js, pid.js, metricas.js, estabilidade.js, ga.worker.js, ui.js, app.js
│   ├── vendor/   uPlot
│   └── img/
├── dados/        bloco40.json (público) e experimento2.csv (no .gitignore até autorização)
├── validacao/    scripts de paridade com o PI
├── bridge/       fase 3: OPC UA (só leitura) para WebSocket
├── Gemeo-Digital-Obsidian/   cofre do projeto, ligado ao Big Brain
└── .claude/agents/           squad (ver AGENTS.md)
```

## 7. Critérios de aceite
- No modo oráculo, a simulação reproduz a tabela da seção 2 com erro de no máximo 1% em todos os índices.
- O $R^2$ do modelo contra o bloco 40, com o mesmo recorte do script ($t_{norm} \ge -10$ s, tempos reais), confere com o do PI (99,96%).
- No modo físico, com $\theta = 0$ e sem perturbação, o regime para $SP$ = 50% tem $u = u_0 + (50 - y_0)/K$ ± 0,1%.
- No modo físico, a resposta ao degrau difere do modo oráculo deslocado para o ponto de operação em no máximo 1% enquanto o comando não satura.
- O polinômio característico confere com `numpy.roots` para 5 conjuntos de ganhos, incluindo $K_d > 0$.
- AG no Worker: termina em até 3 s no notebook da apresentação, com ITAE (modo oráculo, $dt$ = 0,5 s) de no máximo 70.000 e sobressinal de até 5%.
- Funciona offline (sem CDN obrigatória), no notebook da apresentação e no celular.
- Roda a 60 fps a 100x de velocidade num notebook comum.
- Textos em português, sem travessão, com o crédito da equipe visível.

## 8. Riscos e cuidados
- **Crédito da equipe:** o PI é de 6 integrantes (Murilo Lameira, Murilo Romualdo, Guilherme Freitas, Henry Matheus, Leonardo Apolonio e Matheus Soares) com orientação do Me. Thiago Tadeu Amici. A página e o post precisam deixar isso claro: os dados e a identificação são da equipe, e o gêmeo digital interativo é o projeto novo.
- **Publicar os dados:** confirmar com a equipe e o orientador antes de colocar o CSV no GitHub público. Prazo para a resposta: 27/11. A página não depende do CSV, só do `bloco40.json`; se nem o recorte for autorizado, a aba "Dados reais" fica só no notebook da apresentação.
- **Validade do modelo:** o FOPDT é linear em torno do ponto de operação (nível de 15% a 75%). A página deve avisar quando o setpoint sair dessa faixa.
- **Tempo morto:** o modelo identificou $\theta = 0$. Na planta real há algum atraso, e o slider de $\theta$ mostra o efeito disso no AG, que é mais agressivo.
- **Leitura do resultado IMC x AG:** o AG chegou a $T_i = K_p/K_i$ = 431,5 s, praticamente o $\tau$ da planta: ele redescobriu o cancelamento de polo do IMC. O $K_d$ de 0,003 s não tem efeito prático ($T_d$ = 0,002 s), e o doc 03 do PI recomenda $K_d = 0$ no CLP. O $K_p$ ficou no teto da busca (1,5), e um IMC com $\tau_{mf}$ = 36,9 s ($\tau/11{,}7$) daria os mesmos ganhos. A vantagem de 4x vem da escolha de $\tau_{mf}$, não do método. Alinhar com a equipe como apresentar isso; o slider de $\theta$ mostra o preço desse ganho alto.

## 9. Decisões tomadas (14/11)
- Gráficos: uPlot.
- Repositório próprio, publicado por GitHub Pages como subpágina do portfólio.
- Fase 3 (OPC UA) depois do INOVA+.
- Dois modos de simulação: oráculo para validar, físico para a interface (seção 2.1).
