// backend/tests/c190-realinhar.test.js
//   node backend/tests/c190-realinhar.test.js   (unitário, sem DB)
//
// DOC-C190-01 — "Combinação CST/CFOP/ALIQ do C190 sem item (C170) correspondente".
// Caso real: POSTO PREÇO BOM (50922123000158) 03/2026, NFs 396823/396439. O .txt trazia
// C170 060/1102 casado com C190 060/1102; o export reescreve o C170 a partir de
// documentos_itens_c170 (1655 → 1652 pela CFOP_ENTRADA_CORRIGIR) e deixava o C190 em 1102
// → C190 órfão. O realinhamento renomeia a CHAVE do C190 (nunca os VALORES) para acompanhar
// os itens, e funde C190 que passem a colidir.
const assert = require('assert');
const { realinharC190ComC170 } = require('../services/spedCostureiraService');

let ok = 0;
function caso(nome, entrada, esperado) {
  const got = realinharC190ComC170(entrada.slice());
  assert.deepStrictEqual(got, esperado, `${nome}\n  esperado: ${JSON.stringify(esperado, null, 1)}\n  obtido:   ${JSON.stringify(got, null, 1)}`);
  console.log('  ok —', nome);
  ok++;
}

const C100 = (n) => `|C100|0|1|14076889000952|55|00|1|${n}|2926031407688900095255001000396823185196801${n % 10}|31032026|01042026|684,96|0|0,00|0,00|684,96|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|11,30|52,06|0,00||`;
const C170 = (item, cst, cfop, aliq = '0,00') => `|C170|${item}|7305||24,00000|UN|684,96|0,00|0|${cst}|${cfop}||0,00|${aliq}|0,00|0,00|0,00|0,00|0|49||0,00|0,00|0,00|04|684,96|1,65|0,00|0,00|11,30|04|684,96|7,60|0,00|0,00|52,06||0,00|`;
const C190 = (cst, cfop, aliq, vlOpr) => `|C190|${cst}|${cfop}|${aliq}|${vlOpr}|0,00|0,00|0,00|0,00|0,00|0,00||`;

console.log('c190-realinhar:');

// 1. O caso que motivou a correção: 1 órfão ↔ 1 faltante → renomeia a chave do C190.
caso('C190 órfão 060/1102 com item 060/1652 → C190 passa a 060/1652 (valores intactos)',
  [C100(396439), C170(1, '060', '1652'), C190('060', '1102', '0,00', '684,96')],
  [C100(396439), C170(1, '060', '1652'), C190('060', '1652', '0,00', '684,96')]);

// 2. NF com 2 combinações, só uma órfã → a casada não pode ser tocada.
caso('só a combinação órfã é realinhada; a que já casa fica byte-idêntica',
  [C100(396823), C170(1, '060', '1652'), C170(8, '040', '1556'),
   C190('060', '1102', '0,00', '11364,72'), C190('040', '1556', '0,00', '6470,88')],
  [C100(396823), C170(1, '060', '1652'), C170(8, '040', '1556'),
   C190('060', '1652', '0,00', '11364,72'), C190('040', '1556', '0,00', '6470,88')]);

// 3. Renomear criando colisão → funde os dois C190 somando VL_OPR..VL_IPI (f5..f11).
caso('renomeação que colide com C190 existente → funde somando os valores',
  [C100(1), C170(1, '060', '1652'), C170(2, '060', '1652'),
   C190('060', '1102', '0,00', '100,00'), C190('060', '1652', '0,00', '50,00')],
  [C100(1), C170(1, '060', '1652'), C170(2, '060', '1652'),
   C190('060', '1652', '0,00', '150,00')]);

// 4. NADA órfão → array byte-idêntico (garantia p/ o golden export).
caso('sem órfão → byte-idêntico',
  [C100(1), C170(1, '060', '1652'), C190('060', '1652', '0,00', '684,96')],
  [C100(1), C170(1, '060', '1652'), C190('060', '1652', '0,00', '684,96')]);

// 5. Ambíguo (2 órfãos e 2 faltantes sem par único em nenhum critério) → NÃO adivinha.
caso('ambiguidade sem par único → não mexe (detecção continua reportando)',
  [C100(1), C170(1, '010', '1401'), C170(2, '020', '1402'),
   C190('030', '1403', '0,00', '10,00'), C190('040', '1404', '0,00', '20,00')],
  [C100(1), C170(1, '010', '1401'), C170(2, '020', '1402'),
   C190('030', '1403', '0,00', '10,00'), C190('040', '1404', '0,00', '20,00')]);

// 6. 2 órfãos / 2 faltantes, mas cada par é único por CST → resolve pelo CST.
caso('dois órfãos resolvidos por CST idêntico (só a CFOP mudou)',
  [C100(1), C170(1, '060', '1652'), C170(2, '040', '1556'),
   C190('060', '1102', '0,00', '10,00'), C190('040', '1407', '0,00', '20,00')],
  [C100(1), C170(1, '060', '1652'), C170(2, '040', '1556'),
   C190('060', '1652', '0,00', '10,00'), C190('040', '1556', '0,00', '20,00')]);

// 7. NF sem C170 (perfil B / NFC-e) → não inventa item, não mexe.
caso('C190 sem nenhum C170 na NF → intocado',
  [C100(1), C190('061', '5656', '0', '50')],
  [C100(1), C190('061', '5656', '0', '50')]);

// 8. ALIQ diferente não casa (0 vs 18) → sem par, não mexe.
caso('alíquota divergente não é tratada como par',
  [C100(1), C170(1, '000', '1102', '18,00'), C190('000', '1102', '0,00', '10,00')],
  [C100(1), C170(1, '000', '1102', '18,00'), C190('000', '1102', '0,00', '10,00')]);

console.log(`\n${ok} casos ok`);

// 9. Assinatura do C170 contaminado pelo sync de XML (CSOSN como CST + CFOP de saída flipada:
//    5929→1929): CST E CFOP mudaram por inteiro → NÃO realinha, o órfão fica visível.
//    Caso real: NF 308 de 03/2026 do POSTO PREÇO BOM (banco: cst=400 / cfop=1929).
caso('CST e CFOP ambos divergentes (lixo do sync de XML) → não propaga para o C190',
  [C100(308), C170(1, '400', '1929'), C190('041', '1102', '0,00', '50,00')],
  [C100(308), C170(1, '400', '1929'), C190('041', '1102', '0,00', '50,00')]);

console.log(`${ok} casos ok (final)`);
