// Niogen Tracker: pricing math. Pure functions, no database or DOM access.
//
//   total cost  = parts + sales tax on parts + labor + auxiliary costs
//   suggested   = (total cost + site fixed fee) / (1 - site fee% - cushion%)
//   profit at P = P - (P * site fee% + site fixed fee) - total cost
//
// The cushion is a share of the selling price, so at the suggested price the
// profit left over equals the cushion.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const sum = (list, fn) => list.reduce((t, x) => t + fn(x), 0);

export function computeCosts({ components = [], aux = [], laborRate = 0, taxPct = 0 }) {
  const parts = round2(sum(components, (c) => num(c.qty) * num(c.unitCost)));
  const tax = round2((parts * num(taxPct)) / 100);
  const labor = round2(num(laborRate));
  const auxTotal = round2(sum(aux, (a) => num(a.amount)));
  const total = round2(parts + tax + labor + auxTotal);
  return { parts, tax, labor, aux: auxTotal, total };
}

export function sellerFee(price, seller) {
  if (!seller) return 0;
  return round2((num(price) * num(seller.feePct)) / 100 + num(seller.fixedFee));
}

// Returns null when fee% + cushion% reaches 100% or more (no price can work).
export function suggestedPrice(totalCost, seller, cushionPct) {
  const feePct = num(seller?.feePct);
  const denominator = 1 - (feePct + num(cushionPct)) / 100;
  if (denominator <= 0) return null;
  const raw = (num(totalCost) + num(seller?.fixedFee)) / denominator;
  return Math.ceil(raw * 100 - 1e-7) / 100; // round up to the next cent
}

export function profitAt(price, totalCost, seller) {
  return round2(num(price) - sellerFee(price, seller) - num(totalCost));
}

export function actualProfit(salePrice, saleFee, totalCost) {
  return round2(num(salePrice) - num(saleFee) - num(totalCost));
}
