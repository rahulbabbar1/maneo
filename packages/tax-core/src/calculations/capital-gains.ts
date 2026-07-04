import { TaxYearConfig } from '@uk-sa-app/tax-config';
import { roundDownToPound, roundToNearestPenny } from '../utils/rounding.js';

export interface DisposalInput {
  assetType: 'residential_property' | 'other_property' | 'listed_shares' | 'unlisted_shares' | 'other';
  proceeds: number; // pence
  costs: number;    // pence
  losses: number;   // pence (allowable expenditure/loss recorded against this disposal)
  claimBadr: boolean;
}

export interface CgtInput {
  disposals: DisposalInput[];
  broughtForwardLosses: number; // pence
  unusedBasicRateBand: number;  // pence
}

export interface ComputedCgtBreakdown {
  assetType: string;
  gain: number;
  rate: number;
  taxCharged: number;
}

export interface CgtResult {
  totalGainBeforeLosses: number;
  inYearLossesApplied: number;
  broughtForwardLossesApplied: number;
  lossesApplied: number;
  annualExemptAmountApplied: number;
  taxableGain: number;
  totalCgtDue: number;
  breakdown: ComputedCgtBreakdown[];
}

type Bucket = 'res' | 'other' | 'badr';

/**
 * Capital Gains Tax.
 *
 * HMRC deduction order (fixes the previous "lump all losses then AEA" bug):
 *   1. current-year losses: set against current-year gains in full, even if
 *      this wastes the annual exempt amount;
 *   2. brought-forward losses: used only to reduce net gains down to the AEA
 *      (never wasted below it);
 *   3. the annual exempt amount.
 * Losses and the AEA are applied to the highest-rate gains first (most
 * beneficial): residential, then other, then BADR-eligible.
 */
export function computeCgt(input: CgtInput, config: TaxYearConfig): CgtResult {
  const { disposals, unusedBasicRateBand } = input;
  const bfLosses = roundDownToPound(input.broughtForwardLosses);
  const cgt = config.capitalGains;

  // 1. Split disposals into positive-gain buckets and current-year losses with rounding.
  let resGain = 0, otherGain = 0, badrGain = 0, inYearLosses = 0;
  for (const d of disposals) {
    const proceeds = roundDownToPound(d.proceeds);
    const costs = roundDownToPound(d.costs);
    const losses = roundDownToPound(d.losses);
    const net = proceeds - costs - losses;
    if (net < 0) {
      inYearLosses += -net;
    } else if (d.claimBadr) {
      badrGain += net;
    } else if (d.assetType === 'residential_property') {
      resGain += net;
    } else {
      otherGain += net;
    }
  }
  const totalGainBeforeLosses = resGain + otherGain + badrGain;

  const g: Record<Bucket, number> = { res: resGain, other: otherGain, badr: badrGain };
  const order: Bucket[] = ['res', 'other', 'badr']; // highest rate first

  const deduct = (amount: number): number => {
    let remaining = amount;
    let applied = 0;
    for (const k of order) {
      if (remaining <= 0) break;
      const take = Math.min(g[k], remaining);
      g[k] -= take;
      remaining -= take;
      applied += take;
    }
    return applied;
  };

  // Step 1: current-year losses in full.
  const inYearLossesApplied = deduct(inYearLosses);

  // Step 2: brought-forward losses, restricted so they don't reduce below the AEA.
  const netAfterInYear = g.res + g.other + g.badr;
  const usableBf = Math.max(0, netAfterInYear - cgt.annualExemptAmount);
  const broughtForwardLossesApplied = deduct(Math.min(bfLosses, usableBf));

  // Step 3: annual exempt amount.
  const annualExemptAmountApplied = deduct(cgt.annualExemptAmount);

  const lossesApplied = inYearLossesApplied + broughtForwardLossesApplied;
  const taxableGain = g.res + g.other + g.badr;

  // 4. Tax by tier, consuming the remaining basic-rate band.
  let remainingBasicBand = unusedBasicRateBand;
  let totalCgtDue = 0;
  const breakdown: ComputedCgtBreakdown[] = [];

  // BADR: flat rate, does not use the basic-rate band.
  if (g.badr > 0) {
    const tax = roundToNearestPenny(g.badr * cgt.badrRate);
    totalCgtDue += tax;
    breakdown.push({ assetType: 'badr_eligible_assets', gain: g.badr, rate: cgt.badrRate, taxCharged: tax });
  }

  // Residential property: 18% basic / 24% higher.
  if (g.res > 0) {
    const basicAllocated = Math.min(g.res, remainingBasicBand);
    remainingBasicBand -= basicAllocated;
    const higherAllocated = g.res - basicAllocated;
    if (basicAllocated > 0) {
      const t = roundToNearestPenny(basicAllocated * cgt.basicRateResidential);
      totalCgtDue += t;
      breakdown.push({ assetType: 'residential_property_basic', gain: basicAllocated, rate: cgt.basicRateResidential, taxCharged: t });
    }
    if (higherAllocated > 0) {
      const t = roundToNearestPenny(higherAllocated * cgt.higherRateResidential);
      totalCgtDue += t;
      breakdown.push({ assetType: 'residential_property_higher', gain: higherAllocated, rate: cgt.higherRateResidential, taxCharged: t });
    }
  }

  // Other assets / shares: 10% basic / 20% higher.
  if (g.other > 0) {
    const basicAllocated = Math.min(g.other, remainingBasicBand);
    remainingBasicBand -= basicAllocated;
    const higherAllocated = g.other - basicAllocated;
    if (basicAllocated > 0) {
      const t = roundToNearestPenny(basicAllocated * cgt.basicRate);
      totalCgtDue += t;
      breakdown.push({ assetType: 'other_assets_basic', gain: basicAllocated, rate: cgt.basicRate, taxCharged: t });
    }
    if (higherAllocated > 0) {
      const t = roundToNearestPenny(higherAllocated * cgt.higherRate);
      totalCgtDue += t;
      breakdown.push({ assetType: 'other_assets_higher', gain: higherAllocated, rate: cgt.higherRate, taxCharged: t });
    }
  }

  return {
    totalGainBeforeLosses,
    inYearLossesApplied,
    broughtForwardLossesApplied,
    lossesApplied,
    annualExemptAmountApplied,
    taxableGain,
    totalCgtDue,
    breakdown,
  };
}
