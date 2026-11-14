"""Grupos 8 a 11 da validação (fase 2): AG, Worker, estabilidade e pid.passo.

Chamado por validacao/paridade.py. Não roda sozinho. O oráculo do AG
(otimizar_pid_genetico, cerca de 29 s) roda uma vez e fica em
validacao/cache_ag_python.json; use --refazer-python para refazer.
"""
import datetime
import json
import math
import os
import subprocess
import sys

import numpy as np

SEEDS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 42, 43, 47, 53, 59, 61]  # 20 sementes fixas
LIM_ITAE, LIM_SO, LIM_T = 70000.0, 5.0, 3.0
K, TAU = 7.7909, 431.52
KP_IMC = 3.0 / K
G_IMC = (KP_IMC, KP_IMC / TAU, 0.0)
G_AG = (1.4994, 0.003475, 0.0030)


# ---------- conjuntos de estabilidade ----------
def conjuntos():
    c = []

    def add(nome, g, theta, filtro):
        c.append(dict(nome=nome, K=K, tau=TAU, Kp=g[0], Ki=g[1], Kd=g[2], N=10, theta=theta, filtro=filtro))

    add("IMC th0", G_IMC, 0, False)
    add("IMC th30 Pade", G_IMC, 30, False)
    add("AG th0", G_AG, 0, False)
    add("AG th0 filtro", G_AG, 0, True)
    add("AG Kd5 th0", (1.4994, 0.003475, 5.0), 0, False)
    add("AG Kd5 th0 filtro", (1.4994, 0.003475, 5.0), 0, True)
    add("manual Kp3 Ki0,007 th0", (3.0, 0.007, 0.0), 0, False)
    add("manual Kd2 th0 filtro", (3.0, 0.007, 2.0), 0, True)
    add("AG th30 Pade", G_AG, 30, False)
    add("AG th30 Pade filtro", G_AG, 30, True)
    add("AG th55 Pade", G_AG, 55, False)
    add("AG th60 Pade", G_AG, 60, False)
    add("IMC th60 Pade", G_IMC, 60, False)
    rng = np.random.RandomState(20241115)
    lo, hi = np.array([0.05, 0.0005, 0.0]), np.array([1.5, 0.02, 15.0])
    for i, (th, f) in enumerate([(0, True), (30, True), (15, False)], 1):
        g = rng.uniform(lo, hi)
        add(f"aleatorio{i} th{th}" + (" filtro" if f else ""), tuple(float(x) for x in g), th, f)
    return c


# ---------- referência independente em numpy ----------
def poli_numpy(c):
    """P(s) pelas fórmulas do ESCOPO.md item 10 (potências decrescentes)."""
    Kp, Ki, Kd, k, tau, th = c["Kp"], c["Ki"], c["Kd"], c["K"], c["tau"], c["theta"]
    if c["filtro"] and Kd != 0 and Kp != 0:
        tf = Kd / (Kp * c["N"])
        nc = np.polyadd(np.polymul([Kp, Ki], [tf, 1]), [Kd, 0, 0])
        dc = np.polymul([1, 0], [tf, 1])
    else:
        nc, dc = np.array([Kd, Kp, Ki]), np.array([1.0, 0.0])
    if th > 0:
        npd, dpd = np.array([-th / 2, 1.0]), np.array([th / 2, 1.0])
    else:
        npd, dpd = np.array([1.0]), np.array([1.0])
    p = np.polyadd(np.polymul(np.polymul(dc, [tau, 1]), dpd), k * np.polymul(nc, npd))
    return np.trim_zeros(p, "f")


def malha_aberta(c, w):
    """L(jw) = C(jw) G(jw) com o atraso exato."""
    s = 1j * w
    Kp, Ki, Kd = c["Kp"], c["Ki"], c["Kd"]
    if c["filtro"] and Kd != 0 and Kp != 0:
        tf = Kd / (Kp * c["N"])
        d = Kd * s / (tf * s + 1)
    else:
        d = Kd * s
    return (Kp + Ki / s + d) * c["K"] * np.exp(-s * c["theta"]) / (c["tau"] * s + 1)


def margens_numpy(c):
    """Margens por varredura densa (2 milhões de pontos log) com fase desenrolada."""
    tf = c["Kd"] / (c["Kp"] * c["N"]) if (c["filtro"] and c["Kd"] != 0 and c["Kp"] != 0) else 0.0
    wmax = 100.0 if c["theta"] > 0 else max(100.0, 1000.0 / tf if tf > 0 else 100.0)
    w = np.logspace(-6, math.log10(wmax), 2_000_000)
    L = malha_aberta(c, w)
    ph = np.unwrap(np.angle(L))
    lg = np.log(np.abs(L))
    lw = np.log(w)
    mg, mf, wgc = math.inf, math.inf, None
    # cruzamentos de fase: o índice kk = floor((-fase - pi)/(2 pi)) muda ao cruzar -pi(2k+1)
    kk = np.floor((-ph - math.pi) / (2 * math.pi))
    for j in np.nonzero(kk[:-1] != kk[1:])[0]:
        for k in range(int(min(kk[j], kk[j + 1])) + 1, int(max(kk[j], kk[j + 1])) + 1):
            if k < 0:
                continue
            nivel = -math.pi * (2 * k + 1)
            f = (ph[j] - nivel) / (ph[j] - ph[j + 1])
            wc = math.exp(lw[j] + f * (lw[j + 1] - lw[j]))
            mg = min(mg, -20 * math.log10(abs(malha_aberta(c, np.array([wc]))[0])))
    i = np.nonzero((lg[:-1] > 0) != (lg[1:] > 0))[0]
    for j in i:
        f = lg[j] / (lg[j] - lg[j + 1])
        wc = math.exp(lw[j] + f * (lw[j + 1] - lw[j]))
        fase = ph[j] + f * (ph[j + 1] - ph[j]) + math.pi
        m = (fase - 2 * math.pi * math.ceil((fase - math.pi) / (2 * math.pi))) * 180 / math.pi
        if m < mf:
            mf, wgc = m, wc
    atraso = math.inf if wgc is None else mf * math.pi / 180 / wgc
    return mg, mf, atraso


# ---------- AG em Python (uma vez, com cache) ----------
def ag_python(pc, raiz, refazer):
    caminho = os.path.join(raiz, "validacao", "cache_ag_python.json")
    if not refazer and os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            d = json.load(f)
        return d, f"cache de {d['data']}"
    kp, ki, kd = pc.otimizar_pid_genetico(K, TAU)
    d = {"data": datetime.date.today().isoformat(), "Kp": float(kp), "Ki": float(ki), "Kd": float(kd),
         "origem": "projeto_pid_comparativo.otimizar_pid_genetico(K, tau), seed 42, 60 x 80"}
    with open(caminho, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return d, "rodado agora"


def indices_python(pc, g):
    t, y, u, e = pc.simular_malha_fechada(K, TAU, g[0], g[1], g[2], 1200, 0.5, 50.0)
    return pc.calcular_indices_desempenho(t, y, e, 50.0)


# ---------- execução ----------
def rodar_node(raiz, entrada):
    p = subprocess.run(["node", os.path.join(raiz, "validacao", "exportar_fase2.mjs")],
                       input=json.dumps(entrada), capture_output=True, text=True, encoding="utf-8", cwd=raiz)
    if p.returncode != 0:
        print(p.stderr)
        sys.exit(2)
    return json.loads(p.stdout)


def executar(reg, pc, raiz, refazer):
    cs = conjuntos()
    js = rodar_node(raiz, {"seeds": SEEDS, "estab": cs, "thetasFisico": [55, 60]})
    grupo8(reg, pc, raiz, refazer, js["ag"])
    grupo9(reg, js["worker"])
    grupo10(reg, cs, js)
    grupo11(reg, js["pid"])


def cabe(x, lim):
    return x <= lim


def grupo8(reg, pc, raiz, refazer, ag):
    p = ag["padrao"]
    ok = p["indices"]["ITAE"] <= LIM_ITAE
    reg("8", "AG padrão, seed 42 (refino): ITAE oráculo 0,5 s <= 70.000", p["indices"]["ITAE"], LIM_ITAE, "", ok)
    reg("8", "AG padrão, seed 42: sobressinal <= 5%", p["indices"]["sobressinal"], LIM_SO, "",
        p["indices"]["sobressinal"] <= LIM_SO)
    reg("8", "AG padrão, seed 42: tempo (s) <= 3", p["ms"] / 1000, LIM_T, "", p["ms"] / 1000 <= LIM_T)
    ss = ag["sementes"]
    pass_ = [s for s in ss if s["indices"]["ITAE"] <= LIM_ITAE and s["indices"]["sobressinal"] <= LIM_SO
             and s["ms"] / 1000 <= LIM_T]
    reg("8", f"AG 120 x 150, {len(ss)} sementes: todas passam (ITAE, sobressinal, tempo)", len(pass_), len(ss), "",
        len(pass_) == len(ss))
    pior = max(s["indices"]["ITAE"] for s in ss)
    reg("8", "AG 120 x 150: pior ITAE entre as sementes", pior, LIM_ITAE, "", pior <= LIM_ITAE)
    reg("8", "AG 120 x 150: sobressinal máximo (%)", max(s["indices"]["sobressinal"] for s in ss), LIM_SO, "",
        max(s["indices"]["sobressinal"] for s in ss) <= LIM_SO)
    tmax = max(s["ms"] for s in ss) / 1000
    reg("8", "AG 120 x 150: tempo máximo (s)", tmax, LIM_T, "", tmax <= LIM_T)
    # limites respeitados
    lim = ag["limites"]
    dentro = all(lim[n][0] <= s["melhor"][n] <= lim[n][1] for s in ss for n in ("Kp", "Ki", "Kd"))
    reg("8", "AG: ganhos dentro dos limites de busca (20 sementes)", int(dentro), 1, "", dentro)
    # refino nunca piora
    nunca = all(s["refino"] is not None and s["custo"] <= s["refino"]["custoAG"] + 1e-9 for s in ss)
    reg("8", "AG: refinamento nunca piora o custo do AG puro", int(nunca), 1, "", nunca)
    # elitismo
    for rot, h in (("60 x 80", ag["padraoSemRefino"]), ("120 x 150", ag["grandeSemRefino"])):
        n_esp = 80 if rot == "60 x 80" else 150
        mono = all(h["historico"][i + 1] <= h["historico"][i] for i in range(len(h["historico"]) - 1))
        reg("8", f"histórico sem refino ({rot}): {n_esp} entradas", len(h["historico"]), n_esp, "",
            len(h["historico"]) == n_esp)
        reg("8", f"histórico sem refino ({rot}): não crescente (elitismo)", int(mono), 1, "", mono)
    # comparação com o Python
    py, origem = ag_python(pc, raiz, refazer)
    gpy = (py["Kp"], py["Ki"], py["Kd"])
    ipy = indices_python(pc, gpy)
    itae_py = float(ipy["ITAE"])
    tipy = py["Kp"] / py["Ki"]
    reg("8", f"Python AG ({origem}): Ti = Kp/Ki dentro de 2% de tau", tipy, TAU, f"{abs(tipy - TAU) / TAU:.2e}",
        abs(tipy - TAU) / TAU <= 0.02)
    reg("8", "Python AG: ITAE (oráculo 0,5 s)", itae_py, 68265.58, f"{abs(itae_py - 68265.58) / 68265.58:.2e}",
        abs(itae_py - 68265.58) / 68265.58 <= 0.01)
    for rot, r in [("seed 42 padrão", p)] + [(f"seed {s['seed']}", s) for s in ss]:
        m = r["melhor"]
        ti = m["Kp"] / m["Ki"]
        if rot not in ("seed 42 padrão", "seed 1", "seed 61"):
            continue  # mostra 3 linhas; as 20 sementes entram nas linhas agregadas abaixo
        reg("8", f"JS ({rot}) x Python: Kp dentro de 1%", m["Kp"], py["Kp"], f"{abs(m['Kp'] - py['Kp']) / py['Kp']:.2e}",
            abs(m["Kp"] - py["Kp"]) / py["Kp"] <= 0.01)
        reg("8", f"JS ({rot}): Ti = Kp/Ki dentro de 2% de tau", ti, TAU, f"{abs(ti - TAU) / TAU:.2e}",
            abs(ti - TAU) / TAU <= 0.02)
        reg("8", f"JS ({rot}) x Python: ITAE igual ou melhor (<= +1%)", r["indices"]["ITAE"], itae_py,
            f"{(r['indices']['ITAE'] - itae_py) / itae_py:+.2e}", r["indices"]["ITAE"] <= itae_py * 1.01)
    todos = [p] + ss
    tis = [abs(r["melhor"]["Kp"] / r["melhor"]["Ki"] - TAU) / TAU for r in todos]
    reg("8", "JS (21 execuções): pior desvio de Ti em relação a tau", max(tis), 0.02, f"{max(tis):.2e}", max(tis) <= 0.02)
    kps = [abs(r["melhor"]["Kp"] - py["Kp"]) / py["Kp"] for r in todos]
    reg("8", "JS (21 execuções): pior desvio de Kp em relação ao Python", max(kps), 0.01, f"{max(kps):.2e}",
        max(kps) <= 0.01)
    pi = max(r["indices"]["ITAE"] for r in todos)
    reg("8", "JS (21 execuções): pior ITAE x ITAE do Python (<= +1%)", pi, itae_py, f"{(pi - itae_py) / itae_py:+.2e}",
        pi <= itae_py * 1.01)


def grupo9(reg, w):
    c = w["completo"]
    reg("9", "Worker completo: mensagens 'geracao' = nGen (80)", c["nGeracao"], 80, "", c["nGeracao"] == 80)
    reg("9", "Worker completo: gerações numeradas de 1 a 80", int(c["geracoes"] == list(range(1, 81))), 1, "",
        c["geracoes"] == list(range(1, 81)))
    ok_fim = c["tipos"].count("fim") == 1 and c["tipos"][-1] == "fim" and "parado" not in c["tipos"]
    reg("9", "Worker completo: um único 'fim' no final, sem 'parado'", int(ok_fim), 1, "", ok_fim)
    mono = all(c["custos"][i + 1] <= c["custos"][i] for i in range(len(c["custos"]) - 1))
    reg("9", "Worker completo: melhorCusto não crescente", int(mono), 1, "", mono)
    fim, dr = c["ultimo"]["resultado"], c["direto"]
    igual = fim["melhor"] == dr["melhor"] and fim["custo"] == dr["custo"]
    reg("9", "Worker completo: resultado igual ao otimizarPID direto (mesma semente)", int(igual), 1, "", igual)
    reg("9", "Worker completo: 'fim' traz o refino (custo <= último melhorCusto)", fim["custo"], c["custos"][-1], "",
        fim["custo"] <= c["custos"][-1] and "refino" in fim)
    pa = w["parar"]
    reg("9", "Worker parar no meio: termina em 'parado'", pa["tipos"][-1], "parado", "", pa["tipos"][-1] == "parado")
    reg("9", "Worker parar no meio: não envia 'fim' e para antes de nGen (5000)", pa["nGeracao"], "< 5000", "",
        "fim" not in pa["tipos"] and 0 < pa["nGeracao"] < 5000)
    res = pa["ultimo"].get("resultado")
    reg("9", "Worker parar no meio: resultado parcial com ganhos", int(bool(res and "melhor" in res)), 1, "",
        bool(res and "melhor" in res and len(res["historico"]) >= 1))
    oc = w["pararOcioso"]
    reg("9", "Worker 'parar' sem execução: 'parado' com resultado nulo", int(oc["ultimo"].get("resultado") is None), 1,
        "", oc["tipos"][-1] == "parado" and oc["ultimo"].get("resultado") is None)
    er = w["erroLimites"]
    reg("9", "Worker com limites inválidos: mensagem 'erro'", er["tipos"][-1], "erro", "",
        er["tipos"][-1] == "erro" and "inválido" in er["ultimo"].get("mensagem", ""))
    reg("9", "Worker com limites inválidos: sem gerações nem 'fim'", er["nGeracao"], 0, "",
        er["nGeracao"] == 0 and "fim" not in er["tipos"])
    em = w["erroMensagem"]
    reg("9", "Worker com mensagem desconhecida: 'erro'", em["tipos"][-1], "erro", "",
        em["tipos"][-1] == "erro" and "desconhecida" in em["ultimo"].get("mensagem", ""))
    sb = w["substituir"]
    reg("9", "Worker: novo 'iniciar' substitui o anterior (termina em 'fim' de 10 gerações, sem 'parado')",
        len(sb["ultimo"].get("resultado", {}).get("historico", [])), 10, "",
        sb["tipos"][-1] == "fim" and "parado" not in sb["tipos"]
        and len(sb["ultimo"]["resultado"]["historico"]) == 10 and sb["geracoesMax"] < 3000)


def grupo10(reg, cs, js):
    ests = js["estab"]
    for c, e in zip(cs, ests):
        nome = c["nome"]
        ref = poli_numpy(c)
        got = np.array(e["coefs"])
        if len(ref) != len(got):
            reg("10", f"{nome}: coeficientes (grau)", len(got), len(ref), "", False)
            continue
        er = float(np.max(np.abs(got - ref) / np.where(ref == 0, 1.0, np.abs(ref))))
        reg("10", f"{nome}: coeficientes de P(s) x numpy.polymul", er, 0.0, f"{er:.2e}", er <= 1e-12)
        rr = np.roots(ref)
        pj = np.array([complex(p["re"], p["im"]) for p in e["polos"]])
        if len(pj) != len(rr):
            reg("10", f"{nome}: polos", len(pj), len(rr), "", False)
        else:
            lacos, livre = [], list(rr)
            for p in pj:
                d = [abs(p - r) for r in livre]
                j = int(np.argmin(d))
                lacos.append(d[j] / max(abs(livre[j]), 1e-300))
                livre.pop(j)
            ep = max(lacos)
            reg("10", f"{nome}: polos x numpy.roots (relativo)", ep, 0.0, f"{ep:.2e}", ep <= 1e-9)
        est_np = bool(np.all(rr.real < 0))
        reg("10", f"{nome}: Routh estável = todos os polos com Re < 0", int(e["routhEstavel"]), int(est_np), "",
            e["routhEstavel"] == est_np)
        mg, mf, at = margens_numpy(c)
        m = {k: (math.inf if v is None else v) for k, v in e["margens"].items()}  # JSON troca Infinity por null
        reg("10", f"{nome}: margem de ganho (dB) x varredura densa", m["margemGanhoDb"] if math.isfinite(m["margemGanhoDb"]) else "inf",
            mg if math.isfinite(mg) else "inf", "", igual3(m["margemGanhoDb"], mg))
        reg("10", f"{nome}: margem de fase (graus) x varredura densa", m["margemFaseGraus"] if math.isfinite(m["margemFaseGraus"]) else "inf",
            mf if math.isfinite(mf) else "inf", "", igual3(m["margemFaseGraus"], mf))
        c["_np"] = dict(mg=mg, mf=mf, at=at, estavel_np=est_np, routh=e["routhEstavel"])
    por = {c["nome"]: c for c in cs}
    # valores citados nas notas, conferidos com o Python (varredura densa)
    fatos = [("AG th0", 90.0, math.inf, 58.0), ("AG th30 Pade", 43.47, 5.73, None), ("IMC th30 Pade", 78.05, 17.54, None)]
    for nome, mf, mg, at in fatos:
        n = por[nome]["_np"]
        reg("10", f"{nome}: MF numpy x valor das notas ({mf}°)", n["mf"], mf, "", abs(n["mf"] - mf) <= 0.05)
        reg("10", f"{nome}: MG numpy x valor das notas ({'inf' if mg == math.inf else mg} dB)",
            n["mg"] if math.isfinite(n["mg"]) else "inf", mg if math.isfinite(mg) else "inf", "",
            (mg == math.inf and n["mg"] == math.inf) or abs(n["mg"] - mg) <= 0.01)
        if at:
            reg("10", f"{nome}: atraso tolerado (s) x valor das notas", n["at"], at, "", abs(n["at"] - at) <= 0.5)
    n60 = por["AG th60 Pade"]["_np"]
    reg("10", "AG th60: Padé diz estável (Routh)", int(n60["routh"]), 1, "", n60["routh"] and n60["estavel_np"])
    reg("10", "AG th60: MG exata negativa (numpy, -0,29 dB)", n60["mg"], -0.29, "", abs(n60["mg"] + 0.29) <= 0.01)
    reg("10", "AG th60: MF exata negativa (numpy, -3,06°)", n60["mf"], -3.06, "", abs(n60["mf"] + 3.06) <= 0.01)
    ft = js["fisicoTheta"]
    a60, a55 = ft["60"], ft["55"]
    div = a60["amp3"] >= 0.9 * a60["amp1"] and a60["amp3"] > 5
    reg("10", "simularFisico th60: oscila sem decair (erro 10500-12000 s x 3000-4500 s)", a60["amp3"], a60["amp1"], "", div)
    dec = a55["amp3"] < a55["amp1"] and a55["amp3"] < 0.5
    reg("10", "simularFisico th55: erro decai (amplitude final < 0,5 e < inicial)", a55["amp3"], a55["amp1"], "", dec)
    n55 = por["AG th55 Pade"]["_np"]
    reg("10", "AG th55: margens exatas positivas (coerente com decaimento)", min(n55["mg"], n55["mf"]), 0.0, "",
        n55["mg"] > 0 and n55["mf"] > 0)


def igual3(a, b):
    """Iguais até 3 casas (1e-3), ou os dois infinitos."""
    if not math.isfinite(a) or not math.isfinite(b):
        return (not math.isfinite(a)) and (not math.isfinite(b)) and (a > 0) == (b > 0)
    return abs(a - b) <= 1e-3


def grupo11(reg, pid):
    for modo, d in pid.items():
        reg("11", f"pid.passo ({modo}): mesma referência em 5 chamadas", int(d["mesmaRef"]), 1, "", d["mesmaRef"])
        reg("11", f"pid.passo ({modo}): valores novos a cada passo (u, uCalc, e finitos)", int(d["valoresMudam"] and d["camposOk"]), 1,
            "", d["valoresMudam"] and d["camposOk"])
        reg("11", f"pid.passo ({modo}): a referência guarda só o último passo", int(d["ultimoIgual"]), 1, "", d["ultimoIgual"])
        reg("11", f"pid.passo ({modo}): instâncias distintas não dividem o objeto", int(d["instanciasIndependentes"]), 1,
            "", d["instanciasIndependentes"])
