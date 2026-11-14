// estabilidade.js: análise linear de estabilidade da malha de nível do T2
// (fase 2, item 10 do ESCOPO.md). Módulo puro (sem DOM), roda em Node e no
// navegador. Modelo FOPDT identificado pela equipe do Projeto Integrador.
//
// Derivação do polinômio característico
// Planta: G(s) = K e^{-θs} / (τs + 1).
// Controlador visto pela malha: C(s) = Kp + Ki/s + D(s), com D(s) = Kd s sem
// filtro ou D(s) = Kd s/(Tf s + 1) com filtro, Tf = Kd/(Kp N). A derivada na
// medição muda os zeros da malha fechada (resposta ao setpoint), não os polos:
// a equação característica continua 1 + C(s) G(s) = 0.
// Escrevendo C = Nc/Dc e G = K Np/((τs + 1) Dp), os polos são as raízes de
//   P(s) = Dc(s) (τs + 1) Dp(s) + K Nc(s) Np(s).
// - sem filtro: Nc = Kd s² + Kp s + Ki, Dc = s;
// - com filtro: Nc = (Kp s + Ki)(Tf s + 1) + Kd s², Dc = s (Tf s + 1);
// - θ = 0: Np = Dp = 1;
// - θ > 0: Padé de 1ª ordem e^{-θs} ≈ (1 - θs/2)/(1 + θs/2), então
//   Np = 1 - θs/2 e Dp = 1 + θs/2 (o grau sobe 1).
// Sem filtro e θ = 0: P(s) = (τ + K Kd) s² + (1 + K Kp) s + K Ki.
// Com filtro e θ = 0: s(τs + 1)(Tf s + 1) + K[(Kp s + Ki)(Tf s + 1) + Kd s²].
// O filtro segue pid.js (modo físico): com Kd = 0 ou Kp = 0 não há termo
// derivativo filtrado, então cai no caso sem filtro (Kp = 0 zera o Kd).
//
// Convenção: polinômios em Float64Array com potências decrescentes de s.

function polyMul(a, b) {
  const r = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  return r;
}

function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const r = new Float64Array(n);
  for (let i = 0; i < a.length; i++) r[n - a.length + i] += a[i];
  for (let i = 0; i < b.length; i++) r[n - b.length + i] += b[i];
  return r;
}

function usaFiltro({ Kp, Kd = 0, filtro = false }) {
  return filtro && Kd !== 0 && Kp !== 0;
}

export function polinomio({ K, tau, Kp, Ki, Kd = 0, N = 10, theta = 0, filtro = false, pade = 1 }) {
  if (pade !== 1) throw new Error('Só a Padé de 1ª ordem está implementada.');
  const comFiltro = usaFiltro({ Kp, Kd, filtro });
  const kd = filtro && Kp === 0 ? 0 : Kd;
  let Nc;
  let Dc;
  if (comFiltro) {
    const Tf = Kd / (Kp * N);
    Nc = polyAdd(polyMul([Kp, Ki], [Tf, 1]), [Kd, 0, 0]);
    Dc = polyMul([1, 0], [Tf, 1]);
  } else {
    Nc = new Float64Array([kd, Kp, Ki]);
    Dc = new Float64Array([1, 0]);
  }
  let Np = new Float64Array([1]);
  let Dp = new Float64Array([1]);
  if (theta > 0) {
    Np = new Float64Array([-theta / 2, 1]);
    Dp = new Float64Array([theta / 2, 1]);
  }
  const P = polyAdd(polyMul(polyMul(Dc, [tau, 1]), Dp), polyMul(polyMul(Nc, Np), [K]));
  return aparar(P);
}

// Remove zeros à esquerda (coeficientes dominantes nulos), mantendo pelo menos um.
function aparar(c) {
  let i = 0;
  while (i < c.length - 1 && c[i] === 0) i++;
  return i === 0 ? Float64Array.from(c) : Float64Array.from(c.subarray(i));
}

// ---------- raízes ----------

function cmul(ar, ai, br, bi) {
  return [ar * br - ai * bi, ar * bi + ai * br];
}

function cdiv(ar, ai, br, bi) {
  const d = br * br + bi * bi;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}

// Horner complexo: devolve [p(z), p'(z)] para polinômio monico ou não.
function avaliarComDerivada(c, zr, zi) {
  let pr = c[0];
  let pi = 0;
  let dr = 0;
  let di = 0;
  for (let k = 1; k < c.length; k++) {
    [dr, di] = cmul(dr, di, zr, zi);
    dr += pr;
    di += pi;
    [pr, pi] = cmul(pr, pi, zr, zi);
    pr += c[k];
  }
  return [pr, pi, dr, di];
}

// Raízes de polinômio real de grau até 4 (aceita grau maior, mesmo método).
// Grau 1 e 2: fórmula fechada (a de grau 2 na forma estável, sem
// cancelamento). Grau 3 e 4: Durand-Kerner no polinômio mônico, seguido de
// polimento por Newton no polinômio original. Raízes zero (termo
// independente nulo) saem exatas. Ordem: parte real crescente.
export function raizes(coefs) {
  let c = aparar(Float64Array.from(coefs));
  const out = [];
  while (c.length > 1 && c[c.length - 1] === 0) {
    out.push({ re: 0, im: 0 });
    c = c.subarray(0, c.length - 1);
  }
  const n = c.length - 1;
  if (n === 1) {
    out.push({ re: -c[1] / c[0], im: 0 });
  } else if (n === 2) {
    const [a, b, cc] = c;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
      const r1 = q / a;
      const r2 = q !== 0 ? cc / q : -b / (2 * a);
      out.push({ re: r1, im: 0 }, { re: r2, im: 0 });
    } else {
      const re = -b / (2 * a);
      const im = Math.sqrt(-disc) / (2 * Math.abs(a));
      out.push({ re, im }, { re, im: -im });
    }
  } else if (n >= 3) {
    out.push(...durandKerner(c));
  }
  return out.sort((p, q) => p.re - q.re || q.im - p.im);
}

function durandKerner(c) {
  const n = c.length - 1;
  const m = Array.from(c, (v) => v / c[0]); // mônico
  // Raio inicial pela cota de Cauchy, pontos girados para fugir da simetria.
  let raio = 0;
  for (let k = 1; k <= n; k++) raio = Math.max(raio, Math.abs(m[k]));
  raio = 1 + raio;
  const zr = new Float64Array(n);
  const zi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const ang = (2 * Math.PI * k) / n + 0.4;
    zr[k] = raio * Math.cos(ang);
    zi[k] = raio * Math.sin(ang);
  }
  for (let it = 0; it < 2000; it++) {
    let maxPasso = 0;
    for (let k = 0; k < n; k++) {
      const [pr, pi] = avaliarComDerivada(m, zr[k], zi[k]);
      let dr = 1;
      let di = 0;
      for (let j = 0; j < n; j++) {
        if (j !== k) [dr, di] = cmul(dr, di, zr[k] - zr[j], zi[k] - zi[j]);
      }
      const [wr, wi] = cdiv(pr, pi, dr, di);
      zr[k] -= wr;
      zi[k] -= wi;
      const mod = Math.hypot(zr[k], zi[k]) || 1;
      maxPasso = Math.max(maxPasso, Math.hypot(wr, wi) / mod);
    }
    if (maxPasso < 1e-15) break;
  }
  // Polimento por Newton no polinômio original (sem a divisão por c[0]).
  const res = [];
  for (let k = 0; k < n; k++) {
    let xr = zr[k];
    let xi = zi[k];
    for (let it = 0; it < 5; it++) {
      const [pr, pi, dr, di] = avaliarComDerivada(c, xr, xi);
      if (dr === 0 && di === 0) break;
      const [wr, wi] = cdiv(pr, pi, dr, di);
      xr -= wr;
      xi -= wi;
      if (Math.hypot(wr, wi) <= 1e-16 * Math.hypot(xr, xi)) break;
    }
    // Parte imaginária residual de raiz real vira zero.
    if (Math.abs(xi) <= 1e-12 * Math.hypot(xr, xi)) xi = 0;
    res.push({ re: xr, im: xi });
  }
  return res;
}

// ---------- Routh-Hurwitz ----------

// Tabela de Routh. Zero na primeira coluna com linha não nula: troca por
// epsilon (clássico) e informa; a raiz está no eixo imaginário ou à direita,
// então o sistema não é dado como estável. Linha inteira nula: usa a
// derivada do polinômio auxiliar (raízes simétricas) e também informa.
export function routh(coefs) {
  const c = aparar(Float64Array.from(coefs));
  const n = c.length - 1;
  const cols = Math.floor(n / 2) + 1;
  const escala = c.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const EPS = 1e-9 * escala;
  const tabela = [];
  for (let r = 0; r <= n; r++) tabela.push(new Array(cols).fill(0));
  for (let k = 0; k <= n; k++) tabela[k % 2][Math.floor(k / 2)] = c[k];
  let epsilonUsado = false;
  let linhaNula = false;
  const avisos = [];
  for (let r = 2; r <= n + 1; r++) {
    const ant = tabela[r - 1];
    // Trata a linha r - 1 antes de usá-la como pivô.
    const tol = 1e-12 * escala;
    if (ant.every((v) => Math.abs(v) <= tol)) {
      linhaNula = true;
      // Polinômio auxiliar da linha r - 2, de grau gAux = n - (r - 2).
      const gAux = n - (r - 2);
      for (let j = 0; j < cols; j++) ant[j] = tabela[r - 2][j] * (gAux - 2 * j);
      avisos.push(`Linha s^${n - (r - 1)} toda nula: usado o polinômio auxiliar (raízes simétricas em relação à origem).`);
    }
    if (Math.abs(ant[0]) <= tol) {
      epsilonUsado = true;
      ant[0] = EPS;
      avisos.push(`Zero na primeira coluna (linha s^${n - (r - 1)}): trocado por epsilon.`);
    }
    if (r > n) break;
    const piv = tabela[r - 2];
    for (let j = 0; j < cols - 1; j++) {
      tabela[r][j] = (ant[0] * piv[j + 1] - piv[0] * ant[j + 1]) / ant[0];
    }
  }
  let mudancasDeSinal = 0;
  for (let r = 1; r <= n; r++) {
    if (Math.sign(tabela[r][0]) !== Math.sign(tabela[r - 1][0])) mudancasDeSinal++;
  }
  const estavel = mudancasDeSinal === 0 && !epsilonUsado && !linhaNula;
  return { tabela, mudancasDeSinal, estavel, epsilonUsado, linhaNula, avisos };
}

// ---------- margens de ganho e de fase ----------

// Malha aberta L(jω) = C(jω) G(jω) com o atraso exato e^{-jωθ}.
// Devolve módulo e fase contínua (rad): a fase é a soma das parcelas
// arg C - atan(ωτ) - ωθ (+ arg K), então não precisa desenrolar.
function malhaAberta(p, w) {
  const { K, tau, Kp, Ki, theta } = p;
  let cr = Kp;
  let ci = Ki !== 0 ? -Ki / w : 0;
  if (p.comFiltro) {
    const den = 1 + w * w * p.Tf * p.Tf;
    cr += (p.Kd * p.Tf * w * w) / den;
    ci += (p.Kd * w) / den;
  } else {
    ci += p.Kd * w;
  }
  const modulo = (Math.hypot(cr, ci) * Math.abs(K)) / Math.hypot(1, w * tau);
  const fase = Math.atan2(ci, cr) + (K < 0 ? -Math.PI : 0) - Math.atan(w * tau) - w * theta;
  return { modulo, fase };
}

function bissecao(f, a, b, iter = 200) {
  let fa = f(a);
  for (let i = 0; i < iter; i++) {
    const m = Math.sqrt(a * b); // ponto médio em escala logarítmica
    const fm = f(m);
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
    if (b / a - 1 < 1e-13) break;
  }
  return Math.sqrt(a * b);
}

// Busca em grade logarítmica (300 pontos por década) + bissecção.
// Faixa: de 1e-6 rad/s a 100 rad/s (16 vezes a frequência de Nyquist de
// dt = 0,5 s); com θ = 0 a faixa vai até 1000/Tf para cobrir o filtro.
// Margem de ganho: menor margem entre todos os cruzamentos de fase em
// -180° - k·360°; Infinity se a fase nunca cruza. Margem de fase: menor
// 180° + fase (reduzida a (-180°, 180°]) entre os cruzamentos de |L| = 1;
// Infinity se |L| nunca cruza 1. Frequências em rad/s (null sem cruzamento).
// Extra: margemAtrasoS = MF (rad) / ωgc, o atraso adicional que a malha
// tolera antes de instabilizar (Infinity sem cruzamento de ganho; com MF
// negativa a malha já é instável e o valor vem negativo).
export function margens({ K, tau, Kp, Ki, Kd = 0, N = 10, theta = 0, filtro = false }) {
  const comFiltro = usaFiltro({ Kp, Kd, filtro });
  const p = {
    K,
    tau,
    Kp,
    Ki,
    Kd: filtro && Kp === 0 ? 0 : Kd,
    theta,
    comFiltro,
    Tf: comFiltro ? Kd / (Kp * N) : 0,
  };
  const wMin = 1e-6;
  const wMax = theta > 0 ? 100 : Math.max(100, comFiltro ? 1000 / p.Tf : 100);
  const porDecada = 300;
  const nPts = Math.ceil(Math.log10(wMax / wMin) * porDecada) + 1;
  const passo = Math.pow(wMax / wMin, 1 / (nPts - 1));

  let mgDb = Infinity;
  let wpc = null;
  let mfGraus = Infinity;
  let wgc = null;

  let wa = wMin;
  let La = malhaAberta(p, wa);
  for (let i = 1; i < nPts; i++) {
    const wb = i === nPts - 1 ? wMax : wMin * Math.pow(passo, i);
    const Lb = malhaAberta(p, wb);
    // Cruzamentos de fase nos níveis -π(2k+1) entre as duas fases.
    const kA = Math.floor((-La.fase - Math.PI) / (2 * Math.PI));
    const kB = Math.floor((-Lb.fase - Math.PI) / (2 * Math.PI));
    if (kA !== kB) {
      const k0 = Math.min(kA, kB) + 1;
      const k1 = Math.max(kA, kB);
      for (let k = Math.max(0, k0); k <= k1; k++) {
        const nivel = -Math.PI * (2 * k + 1);
        const w = bissecao((x) => malhaAberta(p, x).fase - nivel, wa, wb);
        const mg = -20 * Math.log10(malhaAberta(p, w).modulo);
        if (mg < mgDb) {
          mgDb = mg;
          wpc = w;
        }
      }
    }
    // Cruzamento de ganho |L| = 1.
    const ga = Math.log(La.modulo);
    const gb = Math.log(Lb.modulo);
    if ((ga > 0 && gb <= 0) || (ga <= 0 && gb > 0)) {
      const w = bissecao((x) => Math.log(malhaAberta(p, x).modulo), wa, wb);
      const f = malhaAberta(p, w).fase + Math.PI;
      let mf = f - 2 * Math.PI * Math.ceil((f - Math.PI) / (2 * Math.PI));
      mf = (mf * 180) / Math.PI;
      if (mf < mfGraus) {
        mfGraus = mf;
        wgc = w;
      }
    }
    wa = wb;
    La = Lb;
  }
  return {
    margemGanhoDb: mgDb,
    frequenciaCruzamentoFase: wpc,
    margemFaseGraus: mfGraus,
    frequenciaCruzamentoGanho: wgc,
    margemAtrasoS: wgc === null ? Infinity : ((mfGraus * Math.PI) / 180) / wgc,
  };
}

// Análise completa para a interface. Polos e Routh usam a Padé quando θ > 0;
// as margens usam o atraso exato.
export function analisar(params) {
  const { theta = 0, filtro = false, Kp, Kd = 0 } = params;
  const coefs = polinomio(params);
  const polos = raizes(coefs);
  const tabelaRouth = routh(coefs);
  const mg = margens(params);
  const avisos = [];
  if (theta > 0) avisos.push('Padé de 1ª ordem, aproximação');
  avisos.push('A análise linear não considera a saturação da válvula FV-02');
  if (filtro && Kp === 0 && Kd !== 0) {
    avisos.push('Com Kp = 0 o filtro Tf = Kd/(Kp N) não existe: o termo derivativo foi ignorado, como no pid.js');
  }
  avisos.push(...tabelaRouth.avisos);
  const instavelExato = mg.margemGanhoDb < 0 || mg.margemFaseGraus < 0;
  if (theta > 0 && tabelaRouth.estavel && instavelExato) {
    avisos.push('As margens com o atraso exato indicam instabilidade, mas a Padé de 1ª ordem não: vale a resposta em frequência');
  }
  return { coefs, polos, routh: tabelaRouth, margens: mg, aproximado: theta > 0, avisos };
}
