// Biblioteca das principais credenciadoras/instituições de pagamento (maquininhas) do Brasil.
// Usada para SEMEAR a tabela cad_credenciadoras: quando o COD_PART de um 1601 bate com um destes
// CNPJs e não há 0150 no arquivo, o export injeta o 0150 completo automaticamente (Fix C), sem o
// usuário precisar digitar. Dados oficiais (Receita/CNPJ público, situação ATIVA — consultado
// 2026-06-15 via BrasilAPI). COD_MUN = código IBGE de 7 dígitos (campo do 0150). IE = ISENTO
// (instituições de pagamento não são contribuintes de ICMS). Semeado com ON CONFLICT DO NOTHING
// → NÃO sobrescreve ajustes que o usuário fizer; é só o padrão de fábrica.
module.exports = [
    { cnpj: '16501555000157', nome: 'STONE INSTITUICAO DE PAGAMENTO S.A', ie: 'ISENTO', cod_mun: '3550308', endereco: 'AVENIDA REBOUCAS', num: '2880', bairro: 'PINHEIROS' },
    { cnpj: '01027058000191', nome: 'CIELO S.A - INSTITUICAO DE PAGAMENTO', ie: 'ISENTO', cod_mun: '3505708', endereco: 'ALAMEDA XINGU', num: '512', bairro: 'ALPHAVILLE CENTRO INDUSTRIAL E EMPRESARIAL' },
    { cnpj: '01425787000104', nome: 'REDECARD INSTITUICAO DE PAGAMENTO S.A.', ie: 'ISENTO', cod_mun: '3550308', endereco: 'RUA TENENTE MAURO DE MIRANDA', num: '36', bairro: 'JABAQUARA' },
    { cnpj: '10440482000154', nome: 'GETNET ADQUIRENCIA E SERVICOS PARA MEIOS DE PAGAMENTO SA', ie: 'ISENTO', cod_mun: '3550308', endereco: 'AVENIDA PRESIDENTE JUSCELINO KUBITSCHEK', num: '2041', bairro: 'VILA NOVA CONCEICAO' },
    { cnpj: '08561701000101', nome: 'PAGSEGURO INTERNET INSTITUICAO DE PAGAMENTO S.A.', ie: 'ISENTO', cod_mun: '3550308', endereco: 'AVENIDA BRIGADEIRO FARIA LIMA', num: '1384', bairro: 'JARDIM PAULISTANO' },
    { cnpj: '10573521000191', nome: 'MERCADO PAGO INSTITUICAO DE PAGAMENTO LTDA', ie: 'ISENTO', cod_mun: '3534401', endereco: 'AVENIDA DAS NACOES UNIDAS', num: '3003', bairro: 'BONFIM' },
];
