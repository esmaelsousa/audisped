#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrai chaves de acesso (44 dígitos) dos DACTEs em PDF.
Uso: python3 extrair_chaves_dacte.py
Saída: ~/Desktop/chaves_cte.txt  +  ~/Desktop/relatorio_chaves.csv
"""

import os
import re
import csv
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("Execute primeiro: pip3 install pdfplumber")
    sys.exit(1)

# ============================================================
PASTA_PDFS  = os.path.expanduser("~/Desktop/DACTEs_CTE")
ARQ_CHAVES  = os.path.expanduser("~/Desktop/chaves_cte.txt")
ARQ_CSV     = os.path.expanduser("~/Desktop/relatorio_chaves.csv")
# ============================================================

# Chave de acesso: 44 dígitos seguidos
# ou agrupados em blocos de 4 separados por espaço
REGEX_CHAVE_COMPACTA = re.compile(r'\b(\d{44})\b')
REGEX_CHAVE_GRUPOS   = re.compile(
    r'(\d{4}[\s\-]){10}\d{4}'  # 11 grupos de 4 dígitos
)


def normalizar_chave(texto):
    """Remove espaços/hífens e retorna só os 44 dígitos."""
    return re.sub(r'[\s\-]', '', texto)


def extrair_chaves_do_texto(texto):
    """Busca todas as chaves de acesso num texto."""
    chaves = set()

    # Formato compacto: 44 dígitos juntos
    for m in REGEX_CHAVE_COMPACTA.finditer(texto):
        chaves.add(m.group(1))

    # Formato agrupado: 4444 4444 4444 ... (11 grupos)
    for m in REGEX_CHAVE_GRUPOS.finditer(texto):
        c = normalizar_chave(m.group(0))
        if len(c) == 44:
            chaves.add(c)

    # Valida: chave de CT-e tem modelo 57 na posição 20-21
    # chave de NF-e tem modelo 55 — incluímos ambos por segurança
    return chaves


def extrair_chave_pdf(caminho_pdf):
    """Abre o PDF e retorna set de chaves encontradas."""
    chaves = set()
    try:
        with pdfplumber.open(caminho_pdf) as pdf:
            for pagina in pdf.pages:
                texto = pagina.extract_text() or ""
                chaves |= extrair_chaves_do_texto(texto)
    except Exception as e:
        pass
    return chaves


def processar():
    pasta = Path(PASTA_PDFS)
    if not pasta.exists():
        print(f"Pasta não encontrada: {PASTA_PDFS}")
        sys.exit(1)

    # Coleta todos os PDFs recursivamente
    pdfs = sorted(pasta.rglob("*.pdf"))
    total = len(pdfs)

    print("=" * 60)
    print("  EXTRATOR DE CHAVES DE ACESSO — DACTEs PDF")
    print("=" * 60)
    print(f"  PDFs encontrados: {total}")
    print(f"  Pasta: {PASTA_PDFS}\n")

    todas_chaves = set()
    registros    = []
    sem_chave    = []

    for i, pdf in enumerate(pdfs, 1):
        pct = i / total * 100
        sys.stdout.write(f"\r{i}/{total} ({pct:.1f}%) | Chaves: {len(todas_chaves)}   ")
        sys.stdout.flush()

        chaves = extrair_chave_pdf(pdf)

        # Caminho relativo para o relatório (ex: 2024/03/00005161.pdf)
        try:
            relativo = str(pdf.relative_to(pasta))
        except Exception:
            relativo = str(pdf)

        if chaves:
            for c in chaves:
                todas_chaves.add(c)
                registros.append({
                    "chave_acesso": c,
                    "modelo"      : "CT-e" if c[20:22] == "57" else "NF-e" if c[20:22] == "55" else "?",
                    "uf"          : c[0:2],
                    "ano_mes"     : c[2:6],
                    "arquivo_pdf" : relativo,
                })
        else:
            sem_chave.append(relativo)

    print()

    # Filtra só CT-e (modelo 57)
    registros_cte = [r for r in registros if r["modelo"] == "CT-e"]
    chaves_cte    = [r["chave_acesso"] for r in registros_cte]

    # Salva chaves_cte.txt (só CT-e)
    with open(ARQ_CHAVES, "w", encoding="utf-8") as f:
        for c in sorted(set(chaves_cte)):
            f.write(c + "\n")

    # Salva CSV completo (CT-e + NF-e)
    campos = ["chave_acesso", "modelo", "uf", "ano_mes", "arquivo_pdf"]
    with open(ARQ_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        writer.writerows(sorted(registros, key=lambda x: x["chave_acesso"]))

    # Resumo
    ct_e = len(set(chaves_cte))
    nfe  = len([r for r in registros if r["modelo"] == "NF-e"])

    print("\n" + "=" * 60)
    print("  CONCLUÍDO")
    print("=" * 60)
    print(f"  PDFs processados      : {total}")
    print(f"  Chaves CT-e extraídas : {ct_e}")
    print(f"  Chaves NF-e extraídas : {nfe}")
    print(f"  PDFs sem chave        : {len(sem_chave)}")
    if sem_chave:
        print(f"\n  PDFs sem chave encontrada:")
        for s in sem_chave[:10]:
            print(f"    {s}")
        if len(sem_chave) > 10:
            print(f"    ... e mais {len(sem_chave)-10}")
    print(f"\n  Arquivos gerados:")
    print(f"    {ARQ_CHAVES}")
    print(f"    {ARQ_CSV}")
    print("=" * 60)
    print("""
  PRÓXIMOS PASSOS:
  ─────────────────
  1. chaves_cte.txt → importe no Espião NF-e ou SEFAZ Consulta
  2. relatorio_chaves.csv → abra no Excel para auditar
  3. Com as chaves, baixe os XMLs oficiais na SEFAZ pelo CNPJ
""")


if __name__ == "__main__":
    processar()
