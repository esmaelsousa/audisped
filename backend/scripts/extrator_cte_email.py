#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=======================================================================
  EXTRATOR DE CT-e — LEITURA LOCAL VIA THUNDERBIRD (mbox)
  Versão: 3.0 | Compatível com Python 3.8+ | Sem pip install
  Uso: python3 extrator_cte_email.py
=======================================================================
  Lê os e-mails diretamente do disco (arquivos mbox do Thunderbird).
  Não precisa de internet, senha, OAuth2 ou qualquer autenticação.
=======================================================================
"""

import mailbox
import email
import os
import re
import csv
import time
import sys
import zipfile
import io
from pathlib import Path
from email.header import decode_header
from datetime import datetime

# ============================================================
# CONFIGURAÇÕES — EDITE SE NECESSÁRIO
# ============================================================

# Pastas mbox do Thunderbird a varrer (sem extensão = arquivo mbox)
ARQUIVOS_MBOX = [
    os.path.expanduser(
        "~/Library/Thunderbird/Profiles/8t4v17v8.default-release"
        "/ImapMail/outlook.office365.com/INBOX"
    ),
    os.path.expanduser(
        "~/Library/Thunderbird/Profiles/8t4v17v8.default-release"
        "/ImapMail/outlook.office365.com/Sent"
    ),
    os.path.expanduser(
        "~/Library/Thunderbird/Profiles/8t4v17v8.default-release"
        "/ImapMail/outlook.office365.com/Arquivo Morto"
    ),
]

PASTA_SAIDA  = os.path.expanduser("~/Desktop/XMLs_CTE")  # Salva no Desktop
DATA_INICIO  = "2020-01-01"   # Ignora e-mails anteriores a esta data (AAAA-MM-DD)

# ============================================================


def decodificar_cabecalho(valor):
    """Decodifica cabeçalhos de e-mail (base64, quoted-printable, ASCII)."""
    if not valor:
        return ""
    partes = decode_header(valor)
    resultado = []
    for parte, charset in partes:
        if isinstance(parte, bytes):
            try:
                resultado.append(parte.decode(charset or "utf-8", errors="replace"))
            except Exception:
                resultado.append(parte.decode("latin-1", errors="replace"))
        else:
            resultado.append(str(parte))
    return " ".join(resultado)


def decodificar_bytes(conteudo_bytes):
    """Tenta UTF-8, fallback para latin-1."""
    try:
        return conteudo_bytes.decode("utf-8", errors="replace")
    except Exception:
        return conteudo_bytes.decode("latin-1", errors="replace")


def extrair_xmls_do_zip(conteudo_zip_bytes):
    """
    Abre um ZIP em memória e retorna lista de (nome, conteudo_bytes)
    para cada arquivo .xml encontrado dentro.
    """
    xmls = []
    try:
        with zipfile.ZipFile(io.BytesIO(conteudo_zip_bytes)) as z:
            for nome in z.namelist():
                if nome.lower().endswith(".xml"):
                    try:
                        xmls.append((nome, z.read(nome)))
                    except Exception:
                        continue
    except Exception:
        pass
    return xmls


def eh_xml_cte(conteudo_bytes):
    """Verifica se o conteúdo é um XML de CT-e válido."""
    try:
        texto = decodificar_bytes(conteudo_bytes)
        return (
            "<cteProc" in texto or
            "<infCte"  in texto or
            "<CTe "    in texto or
            "<CTe>"    in texto
        )
    except Exception:
        return False


def extrair_dados_cte(conteudo_bytes):
    """Extrai metadados do CT-e via regex: chave, data, CNPJ, razão social, frete."""
    dados = {
        "chave_acesso" : "",
        "ano"          : "",
        "mes"          : "",
        "cnpj_emitente": "",
        "razao_social" : "",
        "valor_frete"  : "",
    }
    try:
        texto = decodificar_bytes(conteudo_bytes)

        # Chave de acesso (44 dígitos)
        m = re.search(r"<chCTe[^>]*>(\d{44})</chCTe>", texto)
        if m:
            dados["chave_acesso"] = m.group(1)

        # Data de emissão
        m = re.search(r"<dhEmi[^>]*>(\d{4})-(\d{2})-\d{2}", texto)
        if m:
            dados["ano"], dados["mes"] = m.group(1), m.group(2)
        else:
            m = re.search(r"<dEmi[^>]*>(\d{4})-(\d{2})-\d{2}", texto)
            if m:
                dados["ano"], dados["mes"] = m.group(1), m.group(2)

        # CNPJ e razão social do emitente
        m = re.search(r"<emit\b[^>]*>(.*?)</emit>", texto, re.DOTALL)
        if m:
            bloco = m.group(1)
            c = re.search(r"<CNPJ[^>]*>(\d{14})</CNPJ>", bloco)
            if c:
                dados["cnpj_emitente"] = c.group(1)
            n = re.search(r"<xNome[^>]*>([^<]+)</xNome>", bloco)
            if n:
                dados["razao_social"] = n.group(1).strip()

        # Valor total do frete
        m = re.search(r"<vTPrest[^>]*>([\d.,]+)</vTPrest>", texto)
        if m:
            dados["valor_frete"] = m.group(1)

    except Exception:
        pass

    return dados


def data_email_valida(msg):
    """
    Verifica se o e-mail é posterior à DATA_INICIO.
    Retorna (True/False, string_data_formatada).
    """
    data_raw = msg.get("Date", "")
    if not data_raw:
        return True, ""  # Sem data: processa mesmo assim

    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(data_raw)
        if dt is None:
            return True, data_raw
        data_str = dt.strftime("%Y-%m-%d %H:%M")
        return dt.strftime("%Y-%m-%d") >= DATA_INICIO, data_str
    except Exception:
        return True, data_raw  # Data inválida: processa mesmo assim


def salvar_xml(conteudo_bytes, chave, ano, mes, pasta_base):
    """
    Salva XML em pasta_base/AAAA/MM/CHAVE.xml
    Retorna caminho salvo ou None se já existia (duplicata).
    """
    nome    = f"{chave}.xml" if chave else f"sem_chave_{int(time.time()*1000)}.xml"
    pasta   = Path(pasta_base) / (ano or "0000") / (mes or "00")
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / nome
    if caminho.exists():
        return None
    caminho.write_bytes(conteudo_bytes)
    return str(caminho)


def barra_progresso(atual, total, salvos, fonte):
    pct = (atual / total * 100) if total > 0 else 0
    sys.stdout.write(
        f"\r[{fonte}] {atual}/{total} ({pct:.1f}%) | CT-e salvos: {salvos}   "
    )
    sys.stdout.flush()


def processar_mbox(caminho_mbox, registros_csv, chaves_salvas):
    """Processa um arquivo mbox e retorna o total de CT-e salvos nele."""

    nome_fonte  = Path(caminho_mbox).name
    salvos_aqui = 0

    print(f"\nAbrindo: {caminho_mbox}")

    try:
        caixa = mailbox.mbox(caminho_mbox)
    except Exception as e:
        print(f"  Erro ao abrir: {e}")
        return 0

    try:
        total = len(caixa)
    except Exception:
        total = 0

    print(f"  {total} e-mails encontrados.")

    for i, msg in enumerate(caixa, start=1):
        barra_progresso(i, total, len(chaves_salvas), nome_fonte)

        try:
            # Filtra por data
            valido, data_str = data_email_valida(msg)
            if not valido:
                continue

            remetente  = decodificar_cabecalho(msg.get("From", ""))
            data_email = data_str

            # Percorre todas as partes do e-mail
            for parte in msg.walk():
                filename_raw = parte.get_filename()
                if not filename_raw:
                    continue

                filename = decodificar_cabecalho(filename_raw).strip()
                fname_lower = filename.lower()

                try:
                    conteudo = parte.get_payload(decode=True)
                    if not conteudo:
                        continue
                except Exception:
                    continue

                # Monta lista de XMLs a processar:
                # - anexo direto .xml
                # - XMLs dentro de .zip
                candidatos = []
                if fname_lower.endswith(".xml"):
                    candidatos.append(conteudo)
                elif fname_lower.endswith(".zip"):
                    for _nome, xml_bytes in extrair_xmls_do_zip(conteudo):
                        candidatos.append(xml_bytes)

                for xml_bytes in candidatos:
                    if not eh_xml_cte(xml_bytes):
                        continue

                    dados = extrair_dados_cte(xml_bytes)
                    chave = dados["chave_acesso"]

                    # Pula duplicata
                    if chave and chave in chaves_salvas:
                        continue

                    caminho_salvo = salvar_xml(
                        xml_bytes, chave, dados["ano"], dados["mes"], PASTA_SAIDA
                    )

                    if caminho_salvo:
                        salvos_aqui += 1
                        if chave:
                            chaves_salvas.add(chave)

                        registros_csv.append({
                            "chave_acesso"   : chave,
                            "ano"            : dados["ano"],
                            "mes"            : dados["mes"],
                            "cnpj_emitente"  : dados["cnpj_emitente"],
                            "razao_social"   : dados["razao_social"],
                            "valor_frete"    : dados["valor_frete"],
                            "data_email"     : data_email,
                            "remetente_email": remetente,
                            "arquivo_salvo"  : caminho_salvo,
                        })

        except Exception:
            continue  # E-mail problemático não para o processo

    caixa.close()
    print()  # quebra de linha após barra de progresso
    return salvos_aqui


def processar_tudo():
    """Função principal."""

    print("=" * 60)
    print("  EXTRATOR DE CT-e — LEITURA LOCAL THUNDERBIRD")
    print("=" * 60)

    # Verifica quais arquivos mbox existem
    arquivos_validos = []
    for arq in ARQUIVOS_MBOX:
        if Path(arq).exists():
            tamanho = Path(arq).stat().st_size / (1024 * 1024)
            print(f"  OK  {Path(arq).name} ({tamanho:.1f} MB)")
            arquivos_validos.append(arq)
        else:
            print(f"  --  {Path(arq).name} (não encontrado, pulando)")

    if not arquivos_validos:
        print("\nNenhum arquivo mbox encontrado. Verifique os caminhos em ARQUIVOS_MBOX.")
        sys.exit(1)

    print(f"\nFiltro de data: e-mails a partir de {DATA_INICIO}")
    print("Iniciando extração...\n")

    Path(PASTA_SAIDA).mkdir(parents=True, exist_ok=True)
    registros_csv = []
    chaves_salvas = set()
    total_geral   = 0

    for arq in arquivos_validos:
        salvos = processar_mbox(arq, registros_csv, chaves_salvas)
        total_geral += salvos

    # Gera chaves_cte.txt
    arq_chaves = Path(os.path.expanduser("~/Desktop/chaves_cte.txt"))
    with arq_chaves.open("w", encoding="utf-8") as f:
        for r in registros_csv:
            if r["chave_acesso"]:
                f.write(r["chave_acesso"] + "\n")

    # Gera relatorio_cte.csv (BOM para abrir no Excel sem distorção)
    arq_csv = Path(os.path.expanduser("~/Desktop/relatorio_cte.csv"))
    campos  = [
        "chave_acesso", "ano", "mes", "cnpj_emitente", "razao_social",
        "valor_frete", "data_email", "remetente_email", "arquivo_salvo"
    ]
    with arq_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        writer.writerows(registros_csv)

    # Resumo
    anos_dist = {}
    for r in registros_csv:
        a = r["ano"] or "desconhecido"
        anos_dist[a] = anos_dist.get(a, 0) + 1

    print("\n" + "=" * 60)
    print("  EXTRACAO CONCLUIDA")
    print("=" * 60)
    print(f"  CT-e extraídos   : {total_geral}")
    print(f"\n  Distribuição por ano:")
    for ano in sorted(anos_dist.keys()):
        print(f"    {ano}: {anos_dist[ano]} CT-e")
    print(f"\n  Arquivos gerados:")
    print(f"    {arq_chaves.resolve()}")
    print(f"    {arq_csv.resolve()}")
    print(f"    XMLs em: {Path(PASTA_SAIDA).resolve()}")
    print("=" * 60)
    print("""
  PRÓXIMOS PASSOS:
  ─────────────────
  1. chaves_cte.txt  → importe no Espião NF-e / SEFAZ Consulta
  2. relatorio_cte.csv → abra no Excel para cruzar com escrituração
  3. XMLs_CTE/       → importe no SPED Fiscal (D100/D110/D190)
""")


if __name__ == "__main__":
    processar_tudo()
