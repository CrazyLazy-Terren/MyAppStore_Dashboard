import pppTemplate from './pppTemplate.json'

// Standard VAT / GST rate charged on digital services, keyed by App Store territory code.
// App Store prices include this tax everywhere except the US and Canada, where sales tax is added at checkout (rate 0 here).
// Rates change; review this table when rebuilding pppTemplate.json.
export const VAT_RATES = {
  AFG: 0, AGO: 0.14, AIA: 0, ALB: 0.2, ARE: 0.05, ARG: 0.21, ARM: 0.2, ATG: 0.15, AUS: 0.1, AUT: 0.2, AZE: 0.18,
  BEL: 0.21, BEN: 0.18, BFA: 0.18, BGD: 0.15, BGR: 0.2, BHR: 0.1, BHS: 0.1, BIH: 0.17, BLR: 0.2, BLZ: 0.125, BMU: 0,
  BOL: 0.13, BRA: 0.14, BRB: 0.175, BRN: 0, BTN: 0, BWA: 0.14,
  CAN: 0, CHE: 0.081, CHL: 0.19, CHN: 0.06, CIV: 0.18, CMR: 0.1925, COD: 0.16, COG: 0.189, COL: 0.19, CPV: 0.15,
  CRI: 0.13, CYM: 0, CYP: 0.19, CZE: 0.21,
  DEU: 0.19, DMA: 0.15, DNK: 0.25, DOM: 0.18, DZA: 0.19,
  ECU: 0.15, EGY: 0.14, ESP: 0.21, EST: 0.24,
  FIN: 0.255, FJI: 0.125, FRA: 0.2, FSM: 0,
  GAB: 0.18, GBR: 0.2, GEO: 0.18, GHA: 0.15, GMB: 0.15, GNB: 0.19, GRC: 0.24, GRD: 0.15, GTM: 0.12, GUY: 0.14,
  HKG: 0, HND: 0.15, HRV: 0.25, HUN: 0.27,
  IDN: 0.11, IND: 0.18, IRL: 0.23, IRQ: 0, ISL: 0.24, ISR: 0.18, ITA: 0.22,
  JAM: 0.15, JOR: 0.16, JPN: 0.1,
  KAZ: 0.16, KEN: 0.16, KGZ: 0.12, KHM: 0.1, KNA: 0.17, KOR: 0.1, KWT: 0,
  LAO: 0.1, LBN: 0.11, LBR: 0, LBY: 0, LCA: 0.125, LKA: 0.18, LTU: 0.21, LUX: 0.17, LVA: 0.21,
  MAC: 0, MAR: 0.2, MDA: 0.2, MDG: 0.2, MDV: 0.08, MEX: 0.16, MKD: 0.18, MLI: 0.18, MLT: 0.18, MMR: 0.05, MNE: 0.21,
  MNG: 0.1, MOZ: 0.16, MRT: 0.16, MSR: 0, MUS: 0.15, MWI: 0.165, MYS: 0.08,
  NAM: 0.15, NER: 0.19, NGA: 0.075, NIC: 0.15, NLD: 0.21, NOR: 0.25, NPL: 0.13, NRU: 0, NZL: 0.15,
  OMN: 0.05,
  PAK: 0.16, PAN: 0.07, PER: 0.18, PHL: 0.12, PLW: 0.1, PNG: 0.1, POL: 0.23, PRT: 0.23, PRY: 0.1,
  QAT: 0,
  ROU: 0.21, RUS: 0.22, RWA: 0.18,
  SAU: 0.15, SEN: 0.18, SGP: 0.09, SLB: 0, SLE: 0.15, SLV: 0.13, SRB: 0.2, STP: 0, SUR: 0.1, SVK: 0.23, SVN: 0.22,
  SWE: 0.25, SWZ: 0.15, SYC: 0.15,
  TCA: 0, TCD: 0.18, THA: 0.07, TJK: 0.14, TKM: 0.15, TON: 0.15, TTO: 0.125, TUN: 0.19, TUR: 0.2, TWN: 0.05, TZA: 0.18,
  UGA: 0.18, UKR: 0.2, URY: 0.22, USA: 0, UZB: 0.12,
  VCT: 0.16, VEN: 0.16, VGB: 0, VNM: 0.1, VUT: 0.15,
  XKS: 0.18,
  YEM: 0,
  ZAF: 0.15, ZMB: 0.16, ZWE: 0.15,
}

export const PPP_TEMPLATE_INFO = {
  source: pppTemplate.source,
  generatedAt: pppTemplate.generatedAt,
}

export const DEFAULT_PPP_SETTINGS = {
  // 0 = Apple's FX equalization only, 1 = full purchasing-power adjustment. Full PPP is usually too aggressive.
  strength: 0.7,
  // Clamp the PPP multiplier so no territory drops below 25% or rises above 120% of the US net price.
  floor: 0.25,
  cap: 1.2,
}

export function getTerritoryTemplate(territoryId) {
  const ppp = pppTemplate.territories[territoryId]
  const vat = VAT_RATES[territoryId]
  return {
    name: ppp?.name || territoryId,
    plr: ppp?.plr ?? null,
    pppYear: ppp?.year ?? null,
    vat: vat ?? null,
  }
}

export function pppMultiplier(plr, { strength, floor, cap } = DEFAULT_PPP_SETTINGS) {
  if (plr == null) return 1
  const blended = 1 + (plr - 1) * strength
  return Math.min(cap, Math.max(floor, blended))
}

/**
 * Target tax-inclusive local price for one territory.
 *
 *   net USD     = base US price × PPP multiplier
 *   net local   = net USD × FX
 *   target      = net local × (1 + VAT)
 *
 * FX comes from Apple's own equalization: the equalized point's proceeds divided by the US proceeds. Proceeds are
 * net of tax and Apple's commission on both sides, so the ratio is the exchange rate Apple uses. When proceeds are
 * missing, FX falls back to the equalized customer price with the template VAT removed.
 */
export function computeTargetPrice({ basePrice, baseProceeds, equalized, plr, vat, multiplier }) {
  const vatRate = vat ?? 0
  const equalizedPrice = Number(equalized?.customerPrice)
  const equalizedProceeds = Number(equalized?.proceeds)

  let fx = null
  if (baseProceeds > 0 && equalizedProceeds > 0) {
    fx = equalizedProceeds / baseProceeds
  } else if (basePrice > 0 && equalizedPrice > 0) {
    fx = equalizedPrice / (1 + vatRate) / basePrice
  }
  if (!fx) return null

  const factor = multiplier ?? pppMultiplier(plr)
  return basePrice * factor * fx * (1 + vatRate)
}

// Picks the territory price point whose customer price is closest to the target; ties go to the cheaper point.
export function snapToPricePoint(target, pricePoints = []) {
  let best = null
  let bestDistance = Infinity
  for (const point of pricePoints) {
    const price = Number(point.customerPrice)
    if (!Number.isFinite(price) || price <= 0) continue
    const distance = Math.abs(price - target)
    if (distance < bestDistance || (distance === bestDistance && price < Number(best.customerPrice))) {
      best = point
      bestDistance = distance
    }
  }
  return best
}
