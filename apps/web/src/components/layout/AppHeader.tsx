import React from 'react';

interface AppHeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  username: string;
  userRole: string;
  onLogout: () => void;
  onDownloadPdf: () => void;
  onSubmitFiling: () => void;
  submitting: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  theme,
  onToggleTheme,
  username,
  userRole,
  onLogout,
  onDownloadPdf,
  onSubmitFiling,
  submitting,
}) => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <span className="brand-logo">🇬🇧 Maneo</span>
        <span className="brand-tagline">AI-Native UK Self Assessment Platform</span>
      </div>

      <div className="header-actions">
        <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>

        <button className="action-btn secondary" onClick={onDownloadPdf}>
          📄 Export PDF
        </button>

        <button className="action-btn primary" onClick={onSubmitFiling} disabled={submitting}>
          {submitting ? 'Submitting...' : '🚀 Submit to HMRC'}
        </button>

        <div className="user-profile">
          <div className="user-info">
            <span className="user-name">{username}</span>
            <span className="user-role">{userRole}</span>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Sign out">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
};
