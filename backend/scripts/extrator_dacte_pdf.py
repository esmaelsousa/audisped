#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrai todos os PDFs (DACTE) e XMLs de CT-e do Thunderbird.
Salva em: ~/Desktop/DACTEs_CTE/AAAA/MM/
Uso: python3 extrator_dacte_pdf.py
"""

import mailbox
import os
import sys
import time
from pathlib import Path
from email.header import decode_header
from email.utils import parsedate_to_datetime

# ============================================================
ARQUIVO_MBOX = os.path.expanduser(
    "~/Library/Thunderbird/Profiles/8t4v17v8.default-release"
    "/ImapMail/outlook.office365.com/INBOX"
)
PASTA_SAIDA  = os.path.expanduser("~/Desktop/DACTEs_CTE")
DATA_INICIO  = "2020-01-01"
# ============================================================

# Palavras-chave no assunto que identificam e-mails de CT-e
PALAVRAS_CHAVE = ["ct-e", "cte", "carregamento", "dacte"]


def dec(v):
    if not v:
        return ""
    try:
        partes = decode_header(v)
        r = []
        for p, c in partes:
            if isinstance(p, bytes):
                try:
                    r.append(p.decode(c or "utf-8", errors="replace"))
                except Exception:
                    r.append(p.decode("latin-1", errors="replace"))
            else:
                r.append(str(p))
        return " ".join(r)
    except Exception:
        return str(v)


def data_email(msg):
    """Retorna (ano, mes, data_str) do e-mail."""
    try:
        dt = parsedate_to_datetime(str(msg.get("Date", "")))
        if dt:
            return dt.strftime("%Y"), dt.strftime("%m"), dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return "0000", "00", ""


def data_valida(msg):
    """Verifica se o e-mail é posterior a DATA_INICIO."""
    try:
        dt = parsedate_to_datetime(str(msg.get("Date", "")))
        if dt and dt.strftime("%Y-%m-%d") >= DATA_INICIO:
            return True
        return False
    except Exception:
        return True


def eh_email_cte(assunto):
    """Verifica se o assunto indica um e-mail de CT-e."""
    a = assunto.lower()
    return any(p in a for p in PALAVRAS_CHAVE)


def salvar_arquivo(conteudo, nome, ano, mes, pasta_base):
    """Salva arquivo em pasta_base/AAAA/MM/nome. Retorna caminho ou None se já existe."""
    # Limpa caracteres inválidos no nome
    nome_limpo = nome.replace("/", "-").replace("\\", "-").replace("'", "").strip()
    pasta = Path(pasta_base) / ano / mes
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / nome_limpo
    if caminho.exists():
        return None
    caminho.write_bytes(conteudo)
    return str(caminho)


def processar():
    print("=" * 60)
    print("  EXTRATOR DE DACTEs (PDF) DE CT-e — THUNDERBIRD")
    print("=" * 60)

    if not Path(ARQUIVO_MBOX).exists():
        print(f"Arquivo não encontrado: {ARQUIVO_MBOX}")
        sys.exit(1)

    tam = Path(ARQUIVO_MBOX).stat().st_size / (1024 * 1024)
    print(f"  INBOX: {tam:.0f} MB")
    print(f"  Saída: {PASTA_SAIDA}")
    print(f"  Filtro: a partir de {DATA_INICIO}\n")

    caixa   = mailbox.mbox(ARQUIVO_MBOX)
    total   = len(caixa)
    salvos  = 0
    emails_cte = 0
    registros  = []

    print(f"  {total} e-mails no INBOX. Processando...\n")

    for i, msg in enumerate(caixa, start=1):
        # Barra de progresso
        pct = i / total * 100
        sys.stdout.write(f"\r{i}/{total} ({pct:.1f}%) | PDFs salvos: {salvos}   ")
        sys.stdout.flush()

        try:
            assunto = dec(msg.get("Subject", ""))
            if not eh_email_cte(assunto):
                continue

            if not data_valida(msg):
                continue

            emails_cte += 1
            remetente  = dec(msg.get("From", ""))
            ano, mes, data_str = data_email(msg)

            for parte in msg.walk():
                fn_raw = parte.get_filename()
                if not fn_raw:
                    continue

                fn = dec(fn_raw).strip()
                fn_lower = fn.lower()

                # Salva PDF e XML
                if not (fn_lower.endswith(".pdf") or fn_lower.endswith(".xml")):
                    continue

                try:
                    conteudo = parte.get_payload(decode=True)
                    if not conteudo:
                        continue
                except Exception:
                    continue

                caminho = salvar_arquivo(conteudo, fn, ano, mes, PASTA_SAIDA)
                if caminho:
                    salvos += 1
                    registros.append({
                        "arquivo"   : fn,
                        "tipo"      : "XML" if fn_lower.endswith(".xml") else "PDF",
                        "data_email": data_str,
                        "assunto"   : assunto,
                        "remetente" : remetente,
                        "caminho"   : caminho,
                    })

        except Exception:
            continue

    caixa.close()
    print()

    # Resumo
    anos = {}
    for r in registros:
        a = r["data_email"][:4] if r["data_email"] else "?"
        anos[a] = anos.get(a, 0) + 1

    print("\n" + "=" * 60)
    print("  EXTRAÇÃO CONCLUÍDA")
    print("=" * 60)
    print(f"  E-mails de CT-e encontrados : {emails_cte}")
    print(f"  Arquivos salvos (PDF + XML) : {salvos}")
    print(f"\n  Por ano:")
    for a in sorted(anos):
        print(f"    {a}: {anos[a]} arquivos")
    print(f"\n  Pasta: {Path(PASTA_SAIDA).resolve()}")
    print("=" * 60)


if __name__ == "__main__":
    processar()
