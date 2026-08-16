import { TaxYearConfig } from '@uk-sa-app/tax-config';
import { roundDownToPound, roundToNearestPenny } from '../utils/rounding.js';

export interface DisposalInput {
  assetType: 'residential_property' | 'other_property' | 'listed_shares' | 'unlisted_shares' | 'other';
  proceeds: number; // pence
  costs: number;    // pence
  losses: number;   // pence (allowable expenditure/loss recorded against this disposal)
  claimBadr: boolean;
}

// ── Section 104 pooling types (A8) ──────────────────────────────────────────

/**
 * An individual acquisition of shares/securities, used for the matching rules.
 */
export interface AcquisitionDetail {
  /** Date of acquisition (YYYY-MM-DD). */
  date: string;
  /** Number of shares/units acquired. */
  quantity: number;
  /** Total allowable cost of this acquisition, in pence. */
  cost: number;
}

/**
 * Enhanced disposal input with quantity + date data for Section 104 matching.
 * If quantity/date are omitted, the engine falls back to simple proceeds - costs.
 */
export interface EnhancedDisposalInput extends DisposalInput {
  /** Date of disposal (YYYY-MM-DD). Required for matching rules. */
  disposalDate?: string;
  /** Number of shares/units disposed of. */
  quantity?: number;
  /**
   * Acquisitions available for matching against this disposal.
   * The engine applies same-day, 30-day, and Section 104 pool rules in order.
   */
  acquisitions?: AcquisitionDetail[];
}

/**
 * Section 104 pool state: a holding of fungible shares with averaged cost.
 * The pool accumulates acquisitions and is reduced by disposals.
 */
export interface Section104Pool {
  /** Unique identifier for this pool (e.g. company name + share class). */
  poolId: string;
  /** Total quantity of shares in the pool. */
  poolQuantity: number;
  /** Total allowable cost of shares in the pool, in pence. */
  poolCost: number;
}

/**
 * Result of applying matching rules to a single disposal.
 */
export interface MatchingBreakdown {
  sameDayQuantity: number;
  sameDayCost: number;
  bnbQuantity: number;    // bed-and-breakfast (30-day)
  bnbCost: number;
  poolQuantity: number;
  poolCost: number;
}

export interface CgtInput {
  disposals: (DisposalInput | EnhancedDisposalInput)[];
  broughtForwardLosses: number; // pence
  unusedBasicRateBand: number;  // pence
  /** When true, the CGT Annual Exempt Amount is withdrawn (FIG simultaneous withdrawal rule). */
  figRegimeElected?: boolean;
  /** Pre-existing Section 104 pools brought forward from previous years. */
  section104Pools?: Section104Pool[];
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
  /** Section 104 pool states after processing all disposals. */
  section104PoolsAfter?: Section104Pool[];
}

type Bucket = 'res' | 'other' | 'badr';

// ── Section 104 matching helpers (A8) ───────────────────────────────────────

/**
 * Calculate the number of calendar days between two date strings.
 * Positive result means date2 is after date1.
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
}

/**
 * Applies the HMRC share matching rules to an enhanced disposal:
 *   1. Same-day: match against acquisitions on the disposal date.
 *   2. 30-day (bed-and-breakfast): match against acquisitions within 30 days
 *      AFTER the disposal date (FIFO within the 30-day window).
 *   3. Section 104 pool: remaining unmatched shares matched at the pool's
 *      average cost per share.
 *
 * Returns the total allowable cost for the disposal (in pence), and mutates
 * the pool to reflect the shares consumed.
 */
function applyMatchingRules(
  disposal: EnhancedDisposalInput,
  pool: Section104Pool,
): { allowableCost: number; matching: MatchingBreakdown } {
  const disposalDate = disposal.disposalDate!;
  let remainingQty = disposal.quantity!;
  let allowableCost = 0;

  const matching: MatchingBreakdown = {
    sameDayQuantity: 0, sameDayCost: 0,
    bnbQuantity: 0, bnbCost: 0,
    poolQuantity: 0, poolCost: 0,
  };

  // Build a mutable copy of acquisitions sorted by date
  const acquisitions = (disposal.acquisitions || []).map(a => ({ ...a }));

  // ── Pre-disposal acquisitions: Add to pool first! ───────────────────────
  // Under HMRC rules, acquisitions before the disposal date must go into the S104 pool
  // before we perform matching against the pool.
  for (const acq of acquisitions) {
    if (daysBetween(acq.date, disposalDate) > 0 && acq.quantity > 0) {
      pool.poolQuantity += acq.quantity;
      pool.poolCost += acq.cost;
      acq.quantity = 0;
      acq.cost = 0;
    }
  }

  // ── Step 1: Same-day rule ──────────────────────────────────────────────
  // Match against acquisitions on the SAME day as the disposal.
  for (const acq of acquisitions) {
    if (remainingQty <= 0) break;
    if (acq.date === disposalDate && acq.quantity > 0) {
      const matched = Math.min(remainingQty, acq.quantity);
      const costPerShare = acq.quantity > 0 ? acq.cost / acq.quantity : 0;
      const matchedCost = roundDownToPound(costPerShare * matched);
      allowableCost += matchedCost;
      matching.sameDayQuantity += matched;
      matching.sameDayCost += matchedCost;
      acq.quantity -= matched;
      acq.cost -= matchedCost;
      remainingQty -= matched;
    }
  }

  // ── Step 2: 30-day (bed-and-breakfast) rule ────────────────────────────
  // Match against acquisitions within 30 days AFTER the disposal date (FIFO).
  // Sort candidate acquisitions by date (earliest first).
  const bnbCandidates = acquisitions
    .filter(a => a.quantity > 0)
    .filter(a => {
      const gap = daysBetween(disposalDate, a.date);
      return gap > 0 && gap <= 30;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const acq of bnbCandidates) {
    if (remainingQty <= 0) break;
    const matched = Math.min(remainingQty, acq.quantity);
    const costPerShare = acq.quantity > 0 ? acq.cost / acq.quantity : 0;
    const matchedCost = roundDownToPound(costPerShare * matched);
    allowableCost += matchedCost;
    matching.bnbQuantity += matched;
    matching.bnbCost += matchedCost;
    acq.quantity -= matched;
    acq.cost -= matchedCost;
    remainingQty -= matched;
  }

  // ── Step 3: Section 104 pool ───────────────────────────────────────────
  // Remaining unmatched shares are matched against the pool at average cost.
  if (remainingQty > 0 && pool.poolQuantity > 0) {
    const poolMatched = Math.min(remainingQty, pool.poolQuantity);
    const avgCostPerShare = pool.poolQuantity > 0 ? pool.poolCost / pool.poolQuantity : 0;
    const poolCostUsed = roundDownToPound(avgCostPerShare * poolMatched);
    allowableCost += poolCostUsed;
    matching.poolQuantity += poolMatched;
    matching.poolCost += poolCostUsed;
    pool.poolQuantity -= poolMatched;
    pool.poolCost -= poolCostUsed;
    remainingQty -= poolMatched;
  }

  // Add unmatched acquisitions (those not consumed by same-day or 30-day)
  // back into the Section 104 pool.
  for (const acq of acquisitions) {
    if (acq.quantity > 0) {
      // Only add acquisitions that are NOT within the 30-day B&B window
      // (B&B acquisitions that weren't matched are still regular acquisitions
      // that should go into the pool)
      pool.poolQuantity += acq.quantity;
      pool.poolCost += acq.cost;
    }
  }

  return { allowableCost, matching };
}

/**
 * Check if a disposal has enhanced matching data (quantity + acquisitions).
 */
function isEnhancedDisposal(d: DisposalInput | EnhancedDisposalInput): d is EnhancedDisposalInput {
  return 'quantity' in d && typeof (d as EnhancedDisposalInput).quantity === 'number'
    && (d as EnhancedDisposalInput).quantity! > 0
    && 'acquisitions' in d;
}

/**
 * Capital Gains Tax.
 *
 * HMRC deduction order:
 *   1. current-year losses: set against current-year gains in full, even if
 *      this wastes the annual exempt amount;
 *   2. brought-forward losses: used only to reduce net gains down to the AEA
 *      (never wasted below it);
 *   3. the annual exempt amount.
 * Losses and the AEA are applied to the highest-rate gains first:
 * residential, then other, then BADR-eligible.
 *
 * Section 104 pooling (A8):
 *   When disposals carry quantity + acquisitions data, the engine applies
 *   the statutory matching rules: same-day → 30-day B&B → Section 104 pool.
 *   Otherwise, it falls back to simple proceeds - costs.
 */
export function computeCgt(input: CgtInput, config: TaxYearConfig): CgtResult {
  const { disposals, unusedBasicRateBand } = input;
  const bfLosses = roundDownToPound(input.broughtForwardLosses);
  const cgt = config.capitalGains;

  // FIG simultaneous withdrawal: if FIG is elected, AEA is forfeited to 0.
  const effectiveAEA = input.figRegimeElected ? 0 : cgt.annualExemptAmount;

  // Initialize Section 104 pools from brought-forward state
  const pools = new Map<string, Section104Pool>();
  if (input.section104Pools) {
    for (const p of input.section104Pools) {
      pools.set(p.poolId, { ...p });
    }
  }

  // Sort disposals chronologically if they have disposalDate
  const sortedDisposals = [...disposals].sort((a, b) => {
    const dateA = ('disposalDate' in a && a.disposalDate) || '';
    const dateB = ('disposalDate' in b && b.disposalDate) || '';
    return dateA.localeCompare(dateB);
  });

  // 1. Split disposals into positive-gain buckets and current-year losses with rounding.
  let resGain = 0, otherGain = 0, badrGain = 0, inYearLosses = 0;
  for (const d of sortedDisposals) {
    let net: number;

    if (isEnhancedDisposal(d) && d.disposalDate) {
      // ── Section 104 matching path ──────────────────────────────────────
      const poolId = `${d.assetType}_default`;
      if (!pools.has(poolId)) {
        pools.set(poolId, { poolId, poolQuantity: 0, poolCost: 0 });
      }
      const pool = pools.get(poolId)!;

      const { allowableCost } = applyMatchingRules(d, pool);
      const proceeds = roundDownToPound(d.proceeds);
      const losses = roundDownToPound(d.losses);
      net = proceeds - allowableCost - losses;
    } else {
      // ── Simple path (backward compatible) ──────────────────────────────
      const proceeds = roundDownToPound(d.proceeds);
      const costs = roundDownToPound(d.costs);
      const losses = roundDownToPound(d.losses);
      net = proceeds - costs - losses;
    }

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
  const usableBf = Math.max(0, netAfterInYear - effectiveAEA);
  const broughtForwardLossesApplied = deduct(Math.min(bfLosses, usableBf));

  // Step 3: annual exempt amount.
  const annualExemptAmountApplied = deduct(effectiveAEA);

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

  // Collect final pool states
  const section104PoolsAfter = Array.from(pools.values());

  return {
    totalGainBeforeLosses,
    inYearLossesApplied,
    broughtForwardLossesApplied,
    lossesApplied,
    annualExemptAmountApplied,
    taxableGain,
    totalCgtDue,
    breakdown,
    section104PoolsAfter,
  };
}
