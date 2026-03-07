// Lógica de Detecção de Anomalias no Backend
const detectarAnomaliasEstoque = (registros1310) => {
  const anomalias = [];
  
  registros1310.forEach((reg, index) => {
    const estoqueIni = parseFloat(reg.ESTQ_INI.replace(',', '.'));
    const saida = parseFloat(reg.QTDE_SAIDA.replace(',', '.'));
    const perda = parseFloat(reg.VAL_PERDA.replace(',', '.'));
    
    // 1. Alerta de Estoque Parado (Venda Zero)
    if (estoqueIni > 10 && saida === 0) {
      anomalias.push({
        data: reg.DT_MOV,
        produto: reg.NOME_PRODUTO,
        tipo: "Estoque Parado",
        descricao: "Tanque com saldo, mas nenhuma venda registrada no dia.",
        gravidade: "Alta"
      });
    }

    // 2. Alerta de Quebra Excessiva (> 0.6%)
    if (saida > 0 && (perda / saida) > 0.006) {
      anomalias.push({
        data: reg.DT_MOV,
        produto: reg.NOME_PRODUTO,
        tipo: "Quebra Excessiva",
        descricao: `Perda de ${((perda/saida)*100).toFixed(2)}% acima do limite legal.`,
        gravidade: "Média"
      });
    }
  });

  return anomalias;
};