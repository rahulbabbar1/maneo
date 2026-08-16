import React from 'react';

interface LegalDefinitionModalProps {
  topic: {
    title: string;
    definition: string;
    hmrcRef: string;
  } | null;
  onClose: () => void;
}

export const LegalDefinitionModal: React.FC<LegalDefinitionModalProps> = ({ topic, onClose }) => {
  if (!topic) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content legal-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📜 Statutory Guidance: {topic.title}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="legal-definition">{topic.definition}</p>
          <div className="hmrc-reference">
            <strong>HMRC Authority / Guidance Reference:</strong>
            <code>{topic.hmrcRef}</code>
          </div>
        </div>
        <div className="modal-footer">
          <button className="action-btn primary" onClick={onClose}>I Understand</button>
        </div>
      </div>
    </div>
  );
};
