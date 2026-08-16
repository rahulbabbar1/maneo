import React from 'react';

export const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content legal-document-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Privacy Policy — Maneo</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body legal-text">
          <p><em>Last updated: April 2026</em></p>

          <h3>1. Data Controller & Processor</h3>
          <p>Maneo processes personal data in accordance with UK GDPR and the Data Protection Act 2018. PII is scrubbed before processing through AI models.</p>

          <h3>2. Information We Collect</h3>
          <p>We process identity details (name, UTR, NINO), employment details (P60, P45), foreign income, residence status (SA109), and capital gains for the purpose of preparing Self Assessment tax returns.</p>

          <h3>3. How We Use AI Models</h3>
          <p>All AI orchestration operates under strict Zero Data Retention (ZDR) infrastructure in Google Cloud Vertex AI (europe-west2, London). Prompt and response data is never retained for training.</p>

          <h3>4. Security & Encryption</h3>
          <p>Data at rest is stored in Google Cloud Firestore with client-scoped security rules. Data in transit is encrypted using TLS 1.3. Fraud-prevention headers are collected in compliance with HMRC requirements.</p>

          <h3>5. Data Subject Rights</h3>
          <p>Under UK GDPR, you have the right to access, rectify, or request erasure of your data, subject to statutory tax record-keeping requirements (6 years).</p>
        </div>
        <div className="modal-footer">
          <button className="action-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
