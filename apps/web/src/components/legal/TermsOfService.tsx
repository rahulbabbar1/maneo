import React from 'react';

export const TermsOfService: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content legal-document-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Terms of Service — Maneo</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body legal-text">
          <p><em>Last updated: April 2026</em></p>

          <h3>1. Scope of Service</h3>
          <p>Maneo provides AI-native tax software designed to assist UK Self Assessment tax return preparation and filing for individuals and agents. All tax computations are calculated deterministically by our engine in accordance with HMRC guidance.</p>

          <h3>2. User Responsibilities & Data Accuracy</h3>
          <p>You remain solely responsible for the accuracy and completeness of all data supplied to the platform. Maneo relies on deterministic calculation core exposed via Model Context Protocol (MCP); however, the final review and declaration of the return remain the statutory responsibility of the taxpayer or agent.</p>

          <h3>3. Zero-Data-Retention & Privacy</h3>
          <p>Your tax information is processed under zero-data-retention AI processing agreements (Vertex AI europe-west2). No customer tax data is used for model training.</p>

          <h3>4. HMRC Submission</h3>
          <p>Submissions to HMRC require explicit taxpayer declaration and agent authorisation. Maneo is not liable for HMRC penalties arising from late filing or inaccurate user-supplied data.</p>
        </div>
        <div className="modal-footer">
          <button className="action-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
