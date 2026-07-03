import { TaxYearConfig } from '@uk-sa-app/tax-config';

export interface DisposalInput {
  assetType: 'residential_property' | 'other_property' | 'listed_shares' | 'unlisted_shares' | 'other';
  proceeds: number; // pence
  costs: number;    // pence
  losses: number;   // pence
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
  lossesApplied: number;
  annualExemptAmountApplied: number;
  taxableGain: number;
  totalCgtDue: number;
  breakdown: ComputedCgtBreakdown[];
}

/**
 * Computes Capital Gains Tax (CGT) for a set of disposals.
 * Deducts losses and the Annual Exempt Amount (AEA), then applies
 * the correct rates based on asset type and remaining basic-rate band.
 */
export function computeCgt(input: CgtInput, config: TaxYearConfig): CgtResult {
  const { disposals, broughtForwardLosses, unusedBasicRateBand } = input;
  const cgtConfig = config.capitalGains;

  // 1. Calculate net gain/loss per disposal
  let residentialGains = 0;
  let otherGains = 0;
  let badrGains = 0;
  let totalLosses = 0;

  for (const disp of disposals) {
    const net = disp.proceeds - disp.costs - disp.losses;
    if (net < 0) {
      totalLosses += Math.abs(net);
    } else {
      if (disp.claimBadr) {
        badrGains += net;
      } else if (disp.assetType === 'residential_property') {
        residentialGains += net;
      } else {
        otherGains += net;
      }
    }
  }

  // Net total gains before losses
  const totalGainBeforeLosses = residentialGains + otherGains + badrGains;

  // Apply in-year losses and brought-forward losses
  let remainingLosses = totalLosses + broughtForwardLosses;
  
  // Losses should reduce residential gains first (highest tax rate), then other, then BADR
  let netRes = residentialGains;
  let netOther = otherGains;
  let netBadr = badrGains;

  if (remainingLosses > 0) {
    const resLoss = Math.min(netRes, remainingLosses);
    netRes -= resLoss;
    remainingLosses -= resLoss;
  }
  if (remainingLosses > 0) {
    const otherLoss = Math.min(netOther, remainingLosses);
    netOther -= otherLoss;
    remainingLosses -= otherLoss;
  }
  if (remainingLosses > 0) {
    const badrLoss = Math.min(netBadr, remainingLosses);
    netBadr -= badrLoss;
    remainingLosses -= badrLoss;
  }

  const lossesApplied = totalGainBeforeLosses - (netRes + netOther + netBadr);

  // Apply Annual Exempt Amount (AEA)
  let remainingAea = cgtConfig.annualExemptAmount; // e.g. £3,000
  
  // Deduct AEA from residential gains first, then other, then BADR
  const initialRes = netRes;
  const initialOther = netOther;
  const initialBadr = netBadr;

  if (remainingAea > 0 && netRes > 0) {
    const resAea = Math.min(netRes, remainingAea);
    netRes -= resAea;
    remainingAea -= resAea;
  }
  if (remainingAea > 0 && netOther > 0) {
    const otherAea = Math.min(netOther, remainingAea);
    netOther -= otherAea;
    remainingAea -= otherAea;
  }
  if (remainingAea > 0 && netBadr > 0) {
    const badrAea = Math.min(netBadr, remainingAea);
    netBadr -= badrAea;
    remainingAea -= badrAea;
  }

  const annualExemptAmountApplied = (initialRes + initialOther + initialBadr) - (netRes + netOther + netBadr);
  const taxableGain = netRes + netOther + netBadr;

  // Calculate tax charged based on remaining basic rate band
  let remainingBasicBand = unusedBasicRateBand;
  let totalCgtDue = 0;
  const breakdown: ComputedCgtBreakdown[] = [];

  // BADR gains are taxed flat at 10% and do not use the basic-rate band
  if (netBadr > 0) {
    const cgt = Math.round(netBadr * cgtConfig.badrRate);
    totalCgtDue += cgt;
    breakdown.push({
      assetType: 'badr_eligible_assets',
      gain: netBadr,
      rate: cgtConfig.badrRate,
      taxCharged: cgt,
    });
  }

  // Residential Property (18% basic / 24% higher)
  if (netRes > 0) {
    let basicAllocated = 0;
    let higherAllocated = 0;

    if (remainingBasicBand > 0) {
      basicAllocated = Math.min(netRes, remainingBasicBand);
      remainingBasicBand -= basicAllocated;
    }
    higherAllocated = netRes - basicAllocated;

    const basicCgt = Math.round(basicAllocated * cgtConfig.basicRateResidential);
    const higherCgt = Math.round(higherAllocated * cgtConfig.higherRateResidential);

    if (basicAllocated > 0) {
      breakdown.push({
        assetType: 'residential_property_basic',
        gain: basicAllocated,
        rate: cgtConfig.basicRateResidential,
        taxCharged: basicCgt,
      });
    }
    if (higherAllocated > 0) {
      breakdown.push({
        assetType: 'residential_property_higher',
        gain: higherAllocated,
        rate: cgtConfig.higherRateResidential,
        taxCharged: higherCgt,
      });
    }

    totalCgtDue += basicCgt + higherCgt;
  }

  // Other Property / Listed & Unlisted Shares (10% basic / 20% higher)
  if (netOther > 0) {
    let basicAllocated = 0;
    let higherAllocated = 0;

    if (remainingBasicBand > 0) {
      basicAllocated = Math.min(netOther, remainingBasicBand);
      remainingBasicBand -= basicAllocated;
    }
    higherAllocated = netOther - basicAllocated;

    const basicCgt = Math.round(basicAllocated * cgtConfig.basicRate);
    const higherCgt = Math.round(higherAllocated * cgtConfig.higherRate);

    if (basicAllocated > 0) {
      breakdown.push({
        assetType: 'other_assets_basic',
        gain: basicAllocated,
        rate: cgtConfig.basicRate,
        taxCharged: basicCgt,
      });
    }
    if (higherAllocated > 0) {
      breakdown.push({
        assetType: 'other_assets_higher',
        gain: higherAllocated,
        rate: cgtConfig.higherRate,
        taxCharged: higherCgt,
      });
    }

    totalCgtDue += basicCgt + higherCgt;
  }

  return {
    totalGainBeforeLosses,
    lossesApplied,
    annualExemptAmountApplied,
    taxableGain,
    totalCgtDue,
    breakdown,
  };
}
