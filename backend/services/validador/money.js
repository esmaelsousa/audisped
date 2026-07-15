// services/validador/money.js — aritmética monetária em CENTAVOS inteiros com HALF-UP
// (padrão fiscal / catálogo de referência). Evita o erro de ponto flutuante do round() nativo, que usa
// banker's rounding e perde a diferença de 1 centavo em subtrações de float.
function toCents(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    const neg = /^-/.test(s);
    const clean = s.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'); // "1.234,56"->"1234.56"
    const f = parseFloat(clean);
    if (!isFinite(f)) return 0;
    const c = Math.round(Math.abs(f) * 100);
    return neg ? -c : c;
}
function fromCents(c) {
    const n = Math.round(Number(c) || 0);
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    return sign + Math.floor(a / 100) + ',' + String(a % 100).padStart(2, '0');
}
// alíquota "20,50" -> basis points inteiros 2050 (2 casas). Evita float no produto BC×alíq.
function aliqBp(v) {
    const s = String(v == null ? '' : v).trim().replace(/\./g, '').replace(',', '.');
    const f = parseFloat(s);
    return isFinite(f) ? Math.round(f * 100) : 0;
}
// VL_ICMS apurado (centavos) = BC(centavos) × alíq / 100, HALF-UP. bcCents×bp/10000.
function icmsCents(bcCents, aliqBpVal) {
    return Math.round((bcCents * aliqBpVal) / 10000);
}
module.exports = { toCents, fromCents, aliqBp, icmsCents };
