"""Gera dados/bloco40.json a partir de dados/experimento2.csv.

Reproduz o recorte de identificacao_fopdt.carregar_dados_degrau do Projeto
Integrador (equipe de 6 integrantes): df.iloc[10620:15055], degrau no
índice 12 do recorte, filtro t_norm >= -10 e tempos reais de Data_Hora.

Uso (sem -I, o numpy e o pandas estão no site-packages do usuário):
    python dados/gerar_bloco40.py
"""
import json
import os

import numpy as np
import pandas as pd

AQUI = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(AQUI, "experimento2.csv")
SAIDA = os.path.join(AQUI, "bloco40.json")

# Modelo FOPDT identificado pelo AG no PI
K = 7.7909
TAU = 431.52
THETA = 0.0


def carregar_recorte():
    df = pd.read_csv(CSV, dtype=str)
    for c in ["Nível", "DegrauHz", "DegrauP"]:
        df[c] = pd.to_numeric(df[c].astype(str).str.replace(",", "."), errors="coerce")
    df["Data_Hora"] = pd.to_datetime(df["Data_Hora"], errors="coerce")

    sub = df.iloc[10620:15055].copy().reset_index(drop=True)
    t0 = sub["Data_Hora"].iloc[0]
    sub["t"] = (sub["Data_Hora"] - t0).dt.total_seconds()
    idx_degrau = 12
    sub["t_norm"] = sub["t"] - sub["t"].iloc[idx_degrau]
    dados = sub[sub["t_norm"] >= -10].copy().reset_index(drop=True)

    antes = dados[dados["t_norm"] <= 0]
    depois = dados[dados["t_norm"] > 5]
    y0 = antes["Nível"].mean()
    yf = dados.iloc[-100:]["Nível"].mean()
    u0_hz = antes["DegrauHz"].mean()
    u0_p = antes["DegrauP"].mean()
    delta_u_hz = depois["DegrauHz"].iloc[0:50].mean() - u0_hz
    delta_u_p = depois["DegrauP"].iloc[0:50].mean() - u0_p
    return dados, y0, yf, u0_hz, u0_p, delta_u_hz, delta_u_p


def modelo_fopdt(t, k, tau, theta, y0, delta_u):
    y = np.full_like(t, y0, dtype=float)
    mask = t >= theta
    y[mask] = y0 + k * delta_u * (1.0 - np.exp(-(t[mask] - theta) / tau))
    return y


def r2(y_real, y_sim):
    ss_res = np.sum((y_real - y_sim) ** 2)
    ss_tot = np.sum((y_real - np.mean(y_real)) ** 2)
    return 1.0 - ss_res / ss_tot


def main():
    dados, y0, yf, u0_hz, u0_p, du_hz, du_p = carregar_recorte()
    t = dados["t_norm"].values.astype(float)
    y = dados["Nível"].values.astype(float)

    y_sim = modelo_fopdt(t, K, TAU, THETA, y0, du_p)
    r2_ref = r2(y, y_sim)
    sigma = float(np.std(y - y_sim))

    # Conferência com os vetores e escalares arredondados (o que o JS vai ler)
    t_r = np.round(t, 3)
    y_r = np.round(y, 3)
    y0_r, du_r = round(float(y0), 6), round(float(du_p), 6)
    r2_arred = r2(y_r, modelo_fopdt(t_r, K, TAU, THETA, y0_r, du_r))
    if round(r2_arred, 4) != round(r2_ref, 4):
        raise SystemExit(f"R2 arredondado {r2_arred} difere de {r2_ref} em 4 casas")

    saida = {
        "fonte": "Projeto Integrador 8o semestre (equipe de 6 integrantes), bloco 40 de experimento2.csv",
        "t_norm": [float(v) for v in t_r],
        "nivel": [float(v) for v in y_r],
        "y0": y0_r,
        "yf": round(float(yf), 6),
        "delta_u_p": du_r,
        "delta_u_hz": round(float(du_hz), 6),
        "u0_p": round(float(u0_p), 6),
        "u0_hz": round(float(u0_hz), 6),
        "K": K,
        "tau": TAU,
        "theta": THETA,
        "r2_referencia": round(float(r2_ref), 8),
        "sigma_residuo": round(sigma, 6),
    }
    with open(SAIDA, "w", encoding="utf-8", newline="\n") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")

    print(f"pontos: {len(t)}  t: {t[0]:.3f} a {t[-1]:.3f} s")
    print(f"y0 = {y0:.4f}  yf = {yf:.4f}  u0_p = {u0_p:.4f}  du_p = {du_p:.4f}")
    print(f"u0_hz = {u0_hz:.4f}  du_hz = {du_hz:.4f}")
    print(f"R2 = {r2_ref:.6f}  R2 arredondado = {r2_arred:.6f}  sigma = {sigma:.4f}")


if __name__ == "__main__":
    main()
