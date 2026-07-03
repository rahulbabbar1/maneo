import { useReturnStore } from '../store/useReturnStore.js';

interface FormRendererProps {
  activeSection: 'SA100' | 'SA102' | 'SA106' | 'SA109';
}

export function FormRenderer({ activeSection }: FormRendererProps) {
  const { returnObj, updateField } = useReturnStore();

  const handleNumberChange = (path: string, valStr: string) => {
    // Convert pounds input to pence integer
    const pounds = parseFloat(valStr) || 0;
    const pence = Math.round(pounds * 100);
    updateField(path, pence);
  };

  const getPoundsValue = (pence: number) => {
    return pence > 0 ? (pence / 100).toString() : '';
  };

  if (activeSection === 'SA100') {
    return (
      <div className="form-panel">
        <h3 className="form-title">SA100 — Core Return & Reliefs</h3>
        
        <div className="form-section">
          <h4>Tax Reliefs</h4>
          <div className="form-group">
            <label>Grossed-up Gift Aid Donations (£)</label>
            <input
              type="number"
              placeholder="e.g. 500"
              value={getPoundsValue(returnObj.sa100.reliefs.giftAidGrossedUp)}
              onChange={(e) => handleNumberChange('sa100.reliefs.giftAidGrossedUp', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Relievable Pension Contributions (£)</label>
            <input
              type="number"
              placeholder="e.g. 1200"
              value={getPoundsValue(returnObj.sa100.reliefs.relievablePensionContributions)}
              onChange={(e) => handleNumberChange('sa100.reliefs.relievablePensionContributions', e.target.value)}
            />
          </div>
          <div className="form-group checkbox-group">
            <input
              type="checkbox"
              id="blind-allowance"
              checked={returnObj.sa100.reliefs.blindPersonsAllowance}
              onChange={(e) => updateField('sa100.reliefs.blindPersonsAllowance', e.target.checked)}
            />
            <label htmlFor="blind-allowance">Claim Blind Person's Allowance</label>
          </div>
        </div>

        <div className="form-section">
          <h4>Tax Already Deducted at Source</h4>
          <div className="form-group">
            <label>Tax Deducted from Savings Interest (£)</label>
            <input
              type="number"
              value={getPoundsValue(returnObj.sa100.taxAlreadyPaid.taxDeductedFromSavings)}
              onChange={(e) => handleNumberChange('sa100.taxAlreadyPaid.taxDeductedFromSavings', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>CIS (Construction Industry) Deductions (£)</label>
            <input
              type="number"
              value={getPoundsValue(returnObj.sa100.taxAlreadyPaid.cisDeductions)}
              onChange={(e) => handleNumberChange('sa100.taxAlreadyPaid.cisDeductions', e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (activeSection === 'SA102') {
    const employments = returnObj.sa102 || [];

    const addEmployment = () => {
      const newEmp = {
        employerName: 'New Employer Ltd',
        grossPay: 0,
        taxDeducted: 0,
        benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
        expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
      };
      updateField(`sa102[${employments.length}]`, newEmp);
    };

    return (
      <div className="form-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 className="form-title" style={{ margin: 0 }}>SA102 — Employments</h3>
          <button className="action-btn secondary" onClick={addEmployment}>+ Add Employer</button>
        </div>

        {employments.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No employments recorded yet. Click Add Employer or upload P60.</p>
        ) : (
          employments.map((emp, index) => (
            <div key={index} className="form-section card-nested">
              <div className="form-group">
                <label>Employer Name</label>
                <input
                  type="text"
                  value={emp.employerName}
                  onChange={(e) => updateField(`sa102[${index}].employerName`, e.target.value)}
                />
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Gross Pay (£)</label>
                  <input
                    type="number"
                    value={getPoundsValue(emp.grossPay)}
                    onChange={(e) => handleNumberChange(`sa102[${index}].grossPay`, e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Tax Deducted (£)</label>
                  <input
                    type="number"
                    value={getPoundsValue(emp.taxDeducted)}
                    onChange={(e) => handleNumberChange(`sa102[${index}].taxDeducted`, e.target.value)}
                  />
                </div>
              </div>

              <h5>Employer Benefits</h5>
              <div className="form-grid">
                <div className="form-group">
                  <label>Company Car Benefit (£)</label>
                  <input
                    type="number"
                    value={getPoundsValue(emp.benefits.companyCars)}
                    onChange={(e) => handleNumberChange(`sa102[${index}].benefits.companyCars`, e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Medical Insurance (£)</label>
                  <input
                    type="number"
                    value={getPoundsValue(emp.benefits.medicalInsurance)}
                    onChange={(e) => handleNumberChange(`sa102[${index}].benefits.medicalInsurance`, e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeSection === 'SA106') {
    const foreignIncome = returnObj.sa106?.foreignIncome || [];

    const addForeignItem = () => {
      const newItem = {
        countryCode: 'IND',
        incomeType: 'dividends' as const,
        grossAmount: 0,
        foreignTaxPaid: 0,
        claimFtcr: true,
      };
      updateField(`sa106.foreignIncome[${foreignIncome.length}]`, newItem);
    };

    return (
      <div className="form-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 className="form-title" style={{ margin: 0 }}>SA106 — Foreign Income</h3>
          <button className="action-btn secondary" onClick={addForeignItem}>+ Add Source</button>
        </div>

        {foreignIncome.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No foreign income sources declared.</p>
        ) : (
          foreignIncome.map((item, index) => (
            <div key={index} className="form-section card-nested">
              <div className="form-grid">
                <div className="form-group">
                  <label>Country Code (ISO 3-Letter)</label>
                  <input
                    type="text"
                    maxLength={3}
                    value={item.countryCode}
                    onChange={(e) => updateField(`sa106.foreignIncome[${index}].countryCode`, e.target.value.toUpperCase())}
                  />
                </div>
                <div className="form-group">
                  <label>Income Type</label>
                  <select
                    value={item.incomeType}
                    onChange={(e) => updateField(`sa106.foreignIncome[${index}].incomeType`, e.target.value)}
                  >
                    <option value="dividends">Dividends</option>
                    <option value="savings">Savings / Interest</option>
                    <option value="employment">Employment</option>
                    <option value="property">Property</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label>Gross Amount (£)</label>
                  <input
                    type="number"
                    value={getPoundsValue(item.grossAmount)}
                    onChange={(e) => handleNumberChange(`sa106.foreignIncome[${index}].grossAmount`, e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Foreign Tax Paid (£)</label>
                  <input
                    type="number"
                    value={getPoundsValue(item.foreignTaxPaid)}
                    onChange={(e) => handleNumberChange(`sa106.foreignIncome[${index}].foreignTaxPaid`, e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group checkbox-group" style={{ marginTop: '8px' }}>
                <input
                  type="checkbox"
                  id={`claim-ftcr-${index}`}
                  checked={item.claimFtcr}
                  onChange={(e) => updateField(`sa106.foreignIncome[${index}].claimFtcr`, e.target.checked)}
                />
                <label htmlFor={`claim-ftcr-${index}`}>Claim Foreign Tax Credit Relief (FTCR)</label>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeSection === 'SA109') {
    // Provide defaults for residence status if missing
    const res = returnObj.sa109?.residenceStatus || {
      daysInUk: 0,
      srtResult: 'non_resident',
      domicileStatus: 'foreign_domiciled',
      figRegimeElected: false,
      overseasWorkdayReliefClaimed: false,
    };

    const updateResidence = (key: string, value: any) => {
      updateField(`sa109.residenceStatus.${key}`, value);
    };

    return (
      <div className="form-panel">
        <h3 className="form-title">SA109 — Residence & Domicile</h3>
        
        <div className="form-section">
          <div className="form-group">
            <label>Days Spent in UK</label>
            <input
              type="number"
              placeholder="e.g. 185"
              value={res.daysInUk || ''}
              onChange={(e) => updateResidence('daysInUk', parseInt(e.target.value) || 0)}
            />
          </div>

          <div className="form-group">
            <label>SRT Determination Result</label>
            <select
              value={res.srtResult}
              onChange={(e) => updateResidence('srtResult', e.target.value)}
            >
              <option value="resident">UK Resident (AUT/STT met)</option>
              <option value="non_resident">Non-Resident (AOT met)</option>
              <option value="split_year">Split Year Treatment</option>
            </select>
          </div>

          <div className="form-group">
            <label>Domicile Status</label>
            <select
              value={res.domicileStatus}
              onChange={(e) => updateResidence('domicileStatus', e.target.value)}
            >
              <option value="uk_domiciled">UK Domiciled</option>
              <option value="foreign_domiciled">Foreign Domiciled (Non-Dom)</option>
            </select>
          </div>

          <div className="form-group checkbox-group" style={{ marginTop: '16px' }}>
            <input
              type="checkbox"
              id="fig-election"
              checked={res.figRegimeElected}
              onChange={(e) => updateResidence('figRegimeElected', e.target.checked)}
            />
            <label htmlFor="fig-election">Elect for new **Foreign Income & Gains (FIG) Regime** (April 2025+ exemption)</label>
          </div>

          <div className="form-group checkbox-group">
            <input
              type="checkbox"
              id="owr-claim"
              checked={res.overseasWorkdayReliefClaimed}
              onChange={(e) => updateResidence('overseasWorkdayReliefClaimed', e.target.checked)}
            />
            <label htmlFor="owr-claim">Claim Overseas Workday Relief (OWR)</label>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
