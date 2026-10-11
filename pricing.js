// Niogen Tracker: pricing math. Pure functions, no database or DOM access.
//
//   total cost  = parts + sales tax on parts + labor + consumables + auxiliary costs
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

export function computeCosts({ components = [], aux = [], laborRate = 0, taxPct = 0, consumables = 0 }) {
  const parts = round2(sum(components, (c) => num(c.qty) * num(c.unitCost)));
  const tax = round2((parts * num(taxPct)) / 100);
  const labor = round2(num(laborRate));
  const cons = round2(num(consumables));
  const auxTotal = round2(sum(aux, (a) => num(a.amount)));
  const total = round2(parts + tax + labor + cons + auxTotal);
  return { parts, tax, labor, consumables: cons, aux: auxTotal, total };
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

// Overall results for sold radios and the shop's own spending.
//
// Each radio's total cost includes its consumables charge, which lowers that radio's profit.
// Shop costs (a polisher, a case of stain) are the real spending behind that charge. Subtracting
// both would count the same money twice, so the charge is added back before shop costs come off:
//
//   net profit = profit on sold radios + consumables charged to them - shop costs spent
//
// sold: [{ salePrice, saleFee, costs }] where costs comes from computeCosts.
export function profitSummary(sold, shopCostsTotal = 0) {
  const revenue = round2(sum(sold, (r) => num(r.salePrice)));
  const fees = round2(sum(sold, (r) => num(r.saleFee)));
  const costOfSold = round2(sum(sold, (r) => r.costs.total));
  const profit = round2(revenue - fees - costOfSold);
  const consumablesCharged = round2(sum(sold, (r) => r.costs.consumables));
  const shop = round2(num(shopCostsTotal));
  const net = round2(profit + consumablesCharged - shop);
  return { revenue, fees, costOfSold, profit, consumablesCharged, shop, net, ahead: round2(consumablesCharged - shop) };
}

// Splits an order's shipping, tariffs and fees across its lines in proportion to what each line
// costs (quantity x price). The shares add up to exactly the total: a leftover cent goes to the
// biggest line. If every price is zero it splits by quantity instead.
export function allocateExtras(lines, total) {
  const n = lines.length;
  total = round2(num(total));
  if (!n || !total) return lines.map(() => 0);
  let w = lines.map((l) => num(l.qty) * num(l.price));
  let sumW = sum(w, (x) => x);
  if (!(sumW > 0)) { w = lines.map((l) => num(l.qty)); sumW = sum(w, (x) => x); }
  if (!(sumW > 0)) { w = lines.map(() => 1); sumW = n; }
  const shares = w.map((x) => round2((total * x) / sumW));
  const diff = round2(total - sum(shares, (x) => x));
  if (diff !== 0) {
    const big = w.indexOf(Math.max(...w));
    shares[big] = round2(shares[big] + diff);
  }
  return shares;
}
