import React from 'react';
import type { FullReturnComputation } from '@uk-sa-app/tax-core';

interface TaxComputationPanelProps {
  computation: FullReturnComputation | null;
  loading: boolean;
  onOpenLegalTopic: (topicKey: string) => void;
}

export const TaxComputationPanel: React.FC<TaxComputationPanelProps> = ({
  computation,
  loading,
  onOpenLegalTopic,
}) => {
  if (loading) {
    return (
      <div className="computation-panel loading">
        <div className="skeleton-line title"></div>
        <div className="skeleton-line row"></div>
        <div className="skeleton-line row"></div>
      </div>
    );
  }

  if (!computation) {
    return (
      <div className="computation-panel empty">
        <p>No tax computation available yet. Start by entering your employment or foreign income details in the chat.</p>
      </div>
    );
  }

  const formatPounds = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="computation-panel">
      <div className="computation-header">
        <h3>Tax Calculation Summary</h3>
        <span className="version-badge" title={`Engine v${computation.version.engineVersion}`}>
          Deterministic Engine v{computation.version.engineVersion}
        </span>
      </div>

      <div className="summary-cards-grid">
        <div className="summary-card">
          <span className="card-label">Total Income</span>
          <span className="card-value">{formatPounds(computation.totalIncome)}</span>
        </div>

        <div className="summary-card">
          <span className="card-label">Adjusted Net Income</span>
          <span className="card-value">{formatPounds(computation.adjustedNetIncome)}</span>
        </div>

        <div className="summary-card highlight">
          <span className="card-label">Total Tax Liability</span>
          <span className="card-value">{formatPounds(computation.incomeTax.incomeTaxTotal)}</span>
        </div>

        <div className="summary-card alert">
          <span className="card-label">Balancing Payment Due</span>
          <span className="card-value">{formatPounds(computation.balancingPayment)}</span>
        </div>
      </div>

      <div className="regime-badges">
        <span className="badge">
          Residence: <strong>{computation.residenceStatus}</strong>
          <button className="info-link" onClick={() => onOpenLegalTopic('srt')}>info</button>
        </span>
        {computation.figRegimeElected && (
          <span className="badge warning">
            FIG Regime Elected
            <button className="info-link" onClick={() => onOpenLegalTopic('fig')}>info</button>
          </span>
        )}
      </div>

      {computation.warnings && computation.warnings.length > 0 && (
        <div className="computation-warnings">
          <h4>Calculation Caveats</h4>
          <ul>
            {computation.warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
