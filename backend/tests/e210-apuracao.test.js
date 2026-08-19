// backend/tests/e210-apuracao.test.js
//   node backend/tests/e210-apuracao.test.js     (T1: unitário, não precisa de DB)
//
// T1 — aritmética do E210, caso a caso, asserção sobre a LINHA INTEIRA (não só o campo em foco:
// um recálculo que acerta o f[13] e estraga o f[14] tem que falhar aqui).
// O teste de corpus sobre arquivos reais está em e210-corpus.test.js.
const assert = require('assert');
const { apurarE210 } = require('../services/export/e210Apuracao');

const L = s => s.split('|');
const S = f => f.join('|');

let ok = 0;
function caso(nome, entrada, esperado, opts) {
  const got = S(apurarE210(L(entrada), opts));
  assert.equal(got, esperado, `${nome}\n  esperado: ${esperado}\n  obtido:   ${got}`);
  console.log('  ok —', nome);
  ok++;
}

console.log('e210-apuracao (T1):');

// 1. O caso real que motivou a correção (POSTO FREITAS 10/2025).
//    Declarado: retenção 885,47 e a recolher 885,47. A fórmula legada devolvia 1770,94.
caso('retenção 885,47 com f11 espelhando f8 → a recolher = 885,47 (não dobra)',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|885,47|0,00|0,00|885,47|0,00|885,47|2656,41|2656,41|',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|885,47|0,00|0,00|885,47|0,00|885,47|0,00|2656,41|');

// 2. A prova do bug: a fórmula legada, no MESMO dado, dobra.
caso('modo legado reproduz a duplicação (1770,94) — é o que produção fazia',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|885,47|0,00|0,00|885,47|0,00|885,47|2656,41|2656,41|',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|885,47|0,00|0,00|885,47|0,00|1770,94|0,00|2656,41|',
  { modo: 'legado' });

// 3. Linha sem movimento nenhum: IND_MOV_ST tem que cair para 0 e nada pode ser fabricado.
caso('tudo zero → IND_MOV_ST=0 e derivados zerados',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  '|E210|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|');

// 4. Só crédito (saldo credor do mês anterior): nada a recolher, tudo vai para transportar.
caso('crédito 500 sem débito → recolher 0, transportar 500',
  '|E210|0|500,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  '|E210|1|500,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|500,00|0,00|');

// 5. Crédito MAIOR que o débito: não pode sobrar valor a recolher nem saldo devedor.
caso('crédito 1000 x débito 300 → recolher 0, saldo devedor 0, transportar 700',
  '|E210|1|1000,00|0,00|0,00|0,00|0,00|300,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  '|E210|1|1000,00|0,00|0,00|0,00|0,00|300,00|0,00|0,00|0,00|0,00|0,00|700,00|0,00|');

// 6. Deduções abatem o que se recolhe, mas NÃO o saldo devedor (que é "antes das deduções").
caso('débito 1000, deduções 400 → saldo devedor 1000 e a recolher 600',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|1000,00|0,00|0,00|0,00|400,00|0,00|0,00|0,00|',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|1000,00|0,00|0,00|1000,00|400,00|600,00|0,00|0,00|');

// 7. Deduções maiores que o devido não podem gerar valor negativo a recolher.
caso('deduções (900) maiores que o débito (500) → a recolher 0, nunca negativo',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|500,00|0,00|0,00|0,00|900,00|0,00|0,00|0,00|',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|500,00|0,00|0,00|500,00|900,00|0,00|0,00|0,00|');

// 8. Os três débitos somam; o f[15] (débito especial) é preservado, não entra na conta.
caso('f8+f9+f10 somam e DEB_ESP_ST (f15) é preservado fora da apuração',
  '|E210|1|100,00|0,00|0,00|0,00|0,00|300,00|50,00|25,00|0,00|0,00|0,00|0,00|777,77|',
  '|E210|1|100,00|0,00|0,00|0,00|0,00|300,00|50,00|25,00|275,00|0,00|275,00|0,00|777,77|');

// 9. somaRetST do bloco C sobrescreve o f[8] e a apuração segue a partir dele.
caso('somaRetST grava f8 e a apuração deriva do novo valor',
  '|E210|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  '|E210|1|0,00|0,00|0,00|0,00|0,00|1234,56|0,00|0,00|1234,56|0,00|1234,56|0,00|0,00|',
  { somaRetST: 1234.56 });

// 10. Contrato de pureza: a função não pode mutar o array recebido (o export reusa a linha).
{
  const orig = L('|E210|1|0,00|0,00|0,00|0,00|0,00|885,47|0,00|0,00|885,47|0,00|885,47|0,00|0,00|');
  const copia = orig.slice();
  apurarE210(orig, {});
  assert.deepEqual(orig, copia, 'apurarE210 não pode mutar a entrada');
  console.log('  ok — não muta o array de entrada');
  ok++;
}

console.log(`e210-apuracao (T1): OK — ${ok} casos`);
