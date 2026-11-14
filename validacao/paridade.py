"""Paridade da simulação JS com o oráculo Python do Projeto Integrador.

Uso (na raiz do projeto, SEM -I, pois o numpy está no site-packages do usuário):
    python validacao/paridade.py

Código de saída 0 só se todos os testes passarem. O oráculo é importado de
F:\\Faculdade\\Projetos\\Projeto Integrador 8 semestre\\scripts (somente leitura).
"""
import io
import json
import math
import os
import subprocess
import sys
from contextlib import redirect_stdout

sys.dont_write_bytecode = True  # não gerar __pycache__ na pasta do PI
os.environ.setdefault("MPLBACKEND", "Agg")

import numpy as np  # noqa: E402

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PI = r"F:\Faculdade\Projetos\Projeto Integrador 8 semestre\scripts"
sys.path.insert(0, PI)
import projeto_pid_comparativo as pc  # noqa: E402
import identificacao_fopdt as idf  # noqa: E402
sys.path.insert(0, os.path.join(RAIZ, "validacao"))
import fase2  # noqa: E402

K, TAU = 7.7909, 431.52
TOL = 0.01
NOMES = ["IAE", "ITAE", "ISE", "sobressinal", "tempoSubida", "tempoAcomodacao"]
CHAVES_PY = {"IAE": "IAE", "ITAE": "ITAE", "ISE": "ISE", "sobressinal": "Overshoot (%)",
             "tempoSubida": "Rise Time (s)", "tempoAcomodacao": "Settling Time (s)"}
ESCOPO = {  # tabela do ESCOPO.md, seção 2
    "IMC": {"IAE": 7190.31, "ITAE": 1032221.71, "ISE": 180113.03, "sobressinal": 0.0,
            "tempoSubida": 315.5, "tempoAcomodacao": 561.5},
    "AG": {"IAE": 1847.07, "ITAE": 68265.58, "ISE": 46492.83, "sobressinal": 0.0,
           "tempoSubida": 80.5, "tempoAcomodacao": 143.5},
}

linhas = []  # (grupo, teste, obtido, esperado, erro, status)


def reg(grupo, teste, obtido, esperado, erro, ok):
    linhas.append((grupo, teste, obtido, esperado, erro, "PASSOU" if ok else "FALHOU"))


def fmt(v):
    if isinstance(v, str):
        return v
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "NaN"
    return f"{v:.6g}"


def nan(v):
    return float("nan") if v is None else float(v)


def compara_indice(nome, js, ref, tol=TOL):
    """Retorna (erro, ok). Sobressinal: diferença absoluta <= 0,01 ponto. Demais: relativo."""
    js, ref = nan(js), nan(ref)
    if math.isnan(js) and math.isnan(ref):
        return 0.0, True
    if math.isnan(js) or math.isnan(ref):
        return float("nan"), False
    if nome == "sobressinal":
        d = abs(js - ref)
        return d, d <= 0.01
    d = abs(js - ref)
    if ref == 0:
        return d, d <= 1e-9
    return d / abs(ref), d / abs(ref) <= tol


def satura(u):
    """Atuador saturado em algum passo (ignora u[0], que é sempre 0 por construção)."""
    return bool(np.any((u[1:] <= 0.0) | (u[1:] >= 100.0)))


def ganhos_imc():
    tau_mf = TAU / 3.0
    kp = TAU / (K * tau_mf)
    return {"Kp": kp, "Ki": kp / TAU, "Kd": 0.0}


def cenarios_oraculo():
    imc = ganhos_imc()
    ag = {"Kp": 1.4994, "Ki": 0.003475, "Kd": 0.0030}
    cs = [
        {"nome": "IMC", **imc, "dt": 0.5, "tFinal": 1200, "setpoint": 50},
        {"nome": "AG", **ag, "dt": 0.5, "tFinal": 1200, "setpoint": 50},
    ]
    # Ganhos aleatórios com semente fixa, nos limites do AG do PI
    rng = np.random.RandomState(20241114)
    lo, hi = np.array([0.05, 0.0005, 0.0]), np.array([1.5, 0.02, 15.0])
    sorteios, sat = [], None
    for _ in range(200):
        g = rng.uniform(lo, hi)
        d = dict(Kp=float(g[0]), Ki=float(g[1]), Kd=float(g[2]))
        _, _, u, _ = pc.simular_malha_fechada(K, TAU, d["Kp"], d["Ki"], d["Kd"], 1200, 0.5, 50.0)
        if satura(u) and sat is None:
            sat = d
        elif len(sorteios) < 2 and not satura(u):
            sorteios.append(d)
        if sat is not None and len(sorteios) == 2:
            break
    assert sat is not None and len(sorteios) == 2, "não achou conjunto saturante"
    for i, d in enumerate(sorteios, 1):
        cs.append({"nome": f"aleatorio{i}", **d, "dt": 0.5, "tFinal": 1200, "setpoint": 50})
    cs.append({"nome": "aleatorio3_satura", **sat, "dt": 0.5, "tFinal": 1200, "setpoint": 50})
    # dt = 1,0 s (o da aptidão do AG)
    cs.append({"nome": "AG_dt1.0", **ag, "dt": 1.0, "tFinal": 1200, "setpoint": 50})
    cs.append({"nome": "aleatorio1_dt1.0", **sorteios[0], "dt": 1.0, "tFinal": 1200, "setpoint": 50})
    return cs


def rodar_js(cenarios):
    p = subprocess.run(["node", os.path.join(RAIZ, "validacao", "exportar_js.mjs")],
                       input=json.dumps({"oraculo": cenarios}), capture_output=True,
                       text=True, encoding="utf-8", cwd=RAIZ)
    if p.returncode != 0:
        print(p.stderr)
        sys.exit(2)
    return json.loads(p.stdout)


def teste_oraculo(cenarios, js):
    for c, r in zip(cenarios, js["oraculo"]):
        nome = c["nome"]
        t, y, u, e = pc.simular_malha_fechada(K, TAU, c["Kp"], c["Ki"], c["Kd"],
                                              c["tFinal"], c["dt"], c["setpoint"])
        ref = pc.calcular_indices_desempenho(t, y, e, c["setpoint"])
        sat = " (satura)" if satura(u) else ""
        if len(y) != len(r["y"]):
            reg("1/2", f"{nome}: tamanho da série", len(r["y"]), len(y), "", False)
            continue
        for n in NOMES:
            erro, ok = compara_indice(n, r["indices"][n], ref[CHAVES_PY[n]])
            reg("1/2", f"{nome}{sat}: {n} (JS x Python)", r["indices"][n], float(ref[CHAVES_PY[n]]),
                f"{erro:.2e}" + (" pp" if n == "sobressinal" else ""), ok)
        ey = float(np.max(np.abs(np.array(r["y"]) - y)))
        eu = float(np.max(np.abs(np.array(r["u"]) - u)))
        reg("1/2", f"{nome}: erro máx. abs. série y", ey, 0.0, f"{ey:.2e}", ey <= 1e-9)
        reg("1/2", f"{nome}: erro máx. abs. série u", eu, 0.0, f"{eu:.2e}", eu <= 1e-9)
        if nome in ESCOPO:
            for n in NOMES:
                erro, ok = compara_indice(n, r["indices"][n], ESCOPO[nome][n])
                reg("1", f"{nome}: {n} (JS x tabela ESCOPO)", r["indices"][n], ESCOPO[nome][n],
                    f"{erro:.2e}" + (" pp" if n == "sobressinal" else ""), ok)
    g = js["ganhos"]
    im = ganhos_imc()
    for k in ("Kp", "Ki", "Kd"):
        d = abs(g["IMC"][k] - im[k])
        reg("1", f"GANHOS.IMC.{k} (pid.js x fórmula do PI)", g["IMC"][k], im[k], f"{d:.2e}", d <= 1e-12)


def teste_r2(js):
    dados_dir = os.path.join(RAIZ, "dados")
    cwd = os.getcwd()
    os.chdir(dados_dir)  # experimento2.csv é lido por caminho relativo
    try:
        with redirect_stdout(io.StringIO()):
            dd, y0, yf, dy, duhz, dup, khz, kp = idf.carregar_dados_degrau()
    finally:
        os.chdir(cwd)
    t = dd["t_norm"].values
    yr = dd["Nível"].values
    ym = idf.modelo_fopdt(t, 7.7909, 431.52, 0.0, y0, dup)
    _, _, r2_py = idf.calcular_metricas(yr, ym)
    b = js["bloco40"]
    d = abs(b["r2"] - r2_py)
    reg("3", "R2 bloco 40: JS x Python (4 casas)", round(b["r2"], 4), round(float(r2_py), 4),
        f"{d:.2e}", round(b["r2"], 4) == round(float(r2_py), 4))
    reg("3", "R2 bloco 40: JS x Python (precisão total)", b["r2"], float(r2_py), f"{d:.2e}", d <= 1e-6)
    reg("3", "R2 bloco 40 em % com 2 casas", round(b["r2"] * 100, 2), 99.96, "",
        round(b["r2"] * 100, 2) == 99.96 and round(float(r2_py) * 100, 2) == 99.96)
    reg("3", "bloco40.json: contagem de pontos", b["n"], len(t), "", b["n"] == len(t))
    if b["n"] == len(t):
        dt_ = float(np.max(np.abs(np.array(b["t_norm"]) - t)))
        dn = float(np.max(np.abs(np.array(b["nivel"]) - yr)))
        reg("3", "bloco40.json: t_norm igual ao recorte", dt_, 0.0, f"{dt_:.2e}", dt_ <= 1e-5)
        # o JSON guarda o nível com 3 casas decimais (erro máximo de arredondamento 5e-4)
        reg("3", "bloco40.json: nível igual ao recorte (3 casas)", dn, 0.0, f"{dn:.2e}", dn <= 5.0e-4 + 1e-9)


def teste_fisico(js):
    pl = js["planta"]
    alvo_u = pl["u0"] + (50 - pl["y0"]) / pl["K"]
    for nome in ("IMC", "AG"):
        f = js["fisico"][nome]
        du, dy = abs(f["uFinal"] - alvo_u), abs(f["yFinal"] - 50)
        reg("4", f"{nome}: u final (3000 s)", f["uFinal"], alvo_u, f"{du:.2e}", du <= 0.1)
        reg("4", f"{nome}: y final (3000 s)", f["yFinal"], 50.0, f"{dy:.2e}", dy <= 0.05)
    # Teste 5: físico contra oráculo deslocado
    ganhos = {"IMC": ganhos_imc(), "AG": {"Kp": 1.4994, "Ki": 0.003475, "Kd": 0.0030}}
    degrau = 50 - pl["y0"]
    for nome, g in ganhos.items():
        _, yo, uo, _ = pc.simular_malha_fechada(K, TAU, g["Kp"], g["Ki"], g["Kd"], 1200, 0.5, degrau)
        yf = np.array(js["fisico"][nome]["y1200"]) - pl["y0"]
        uf = np.array(js["fisico"][nome]["u1200"])
        nao_satura = bool(np.all((uf > 0) & (uf < 100)))
        reg("5", f"{nome}: comando físico não satura", f"[{uf.min():.2f}, {uf.max():.2f}]", "(0, 100)",
            "", nao_satura)
        d = float(np.max(np.abs(yf - yo)) / degrau)
        reg("5", f"{nome}: max|y_fis - y0 - y_orac| / degrau", d, 0.0, f"{d:.2e}", d <= TOL)
        du_ = float(np.max(np.abs((uf - pl["u0"]) - uo)) / degrau)
        reg("5", f"{nome}: max|u_fis - u0 - u_orac| / degrau (informativo)", du_, 0.0, f"{du_:.2e}", du_ <= TOL)


def teste_ao_vivo(js):
    av = js["aoVivo"]
    for n in NOMES:
        a, b = nan(av["vivo"][n]), nan(av["referencia"][n])
        d = abs(a - b)
        erro = d / abs(b) if b != 0 else d
        reg("6", f"ao vivo x calcularIndices: {n}", a, b, f"{erro:.2e}", erro <= 1e-6)
    for nome in ("IMC", "AG"):
        v = av["degrauNegativo"][nome]["valores"]
        for n in ("tempoSubida", "tempoAcomodacao"):
            x = nan(v[n])
            reg("6", f"degrau 50 para 30 ({nome}): {n} finito e > 0", x, "> 0 finito", "",
                math.isfinite(x) and x > 0)


def teste_desempenho(js):
    d = js["desempenho"]
    for chave, rot in (("semMetricas", "planta + PID"), ("comMetricas", "planta + PID + métricas")):
        m = d[chave]
        reg("7", f"ms/quadro, 2 malhas, {d['passosPorQuadro']} passos ({rot}): média", m["media"],
            "< 2 (meta)", "", m["media"] < 2.0 and m["max"] < 16.0)
        reg("7", f"ms/quadro ({rot}): p99 / máx", f"{m['p99']:.3f} / {m['max']:.3f}", "< 16", "",
            m["max"] < 16.0)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cenarios = cenarios_oraculo()
    js = rodar_js(cenarios)
    teste_oraculo(cenarios, js)
    teste_r2(js)
    teste_fisico(js)
    teste_ao_vivo(js)
    teste_desempenho(js)
    fase2.executar(reg, pc, RAIZ, "--refazer-python" in sys.argv)
    antigos = [l for l in linhas if l[0] in ("1", "2", "1/2", "3", "4", "5", "6", "7")]
    falhou = [l for l in antigos if l[5] == "FALHOU"]
    reg("11", "paridade (grupos 1 a 7) continua igual: verificações sem falha", len(antigos) - len(falhou),
        len(antigos), "", not falhou)

    w = max(len(l[1]) for l in linhas)
    print(f"{'Gr':<4} {'Teste':<{w}} | {'Obtido':>14} | {'Esperado':>14} | {'Erro':>10} | Status")
    print("-" * (w + 60))
    for g, teste, ob, es, er, st in linhas:
        print(f"{g:<4} {teste:<{w}} | {fmt(ob):>14} | {fmt(es):>14} | {er:>10} | {st}")
    falhas = [l for l in linhas if l[5] == "FALHOU"]
    print("-" * (w + 60))
    print(f"Total: {len(linhas)} verificações, {len(linhas) - len(falhas)} passaram, {len(falhas)} falharam.")
    sys.exit(0 if not falhas else 1)


if __name__ == "__main__":
    main()
