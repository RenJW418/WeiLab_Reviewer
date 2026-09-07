const effect = 12;
const standardError = 6.087;

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

const z = effect / standardError;
const p = 1 - erf(Math.abs(z) / Math.sqrt(2));
console.log(JSON.stringify({ data_origin: 'synthetic_demo', effect, standard_error: standardError, z, two_sided_p: p }, null, 2));
