import { create } from 'zustand';
import type { Return } from '@uk-sa-app/return-model';
import { authHeaders } from '../lib/authService.js';

interface ReturnStore {
  returnObj: Return;
  computation: any | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  setReturnObj: (newReturn: Return) => void;
  updateField: (path: string, value: any) => void;
  calculateTax: () => Promise<void>;
}

// Initial default blank return object matching ReturnSchema
const initialReturn: Return = {
  id: 'a3f2130f-dd1d-44b0-a5d6-c55b099b8fdb',
  clientId: 'client-99',
  taxYear: '2025-26',
  status: 'draft',
  sa100: {
    taxAlreadyPaid: {
      payeTax: 0,
      taxDeductedFromSavings: 0,
      taxDeductedFromDividends: 0,
      cisDeductions: 0,
      otherTaxPaid: 0,
    },
    reliefs: {
      giftAidGrossedUp: 0,
      relievablePensionContributions: 0,
      blindPersonsAllowance: false,
      marriageAllowanceTransferor: false,
      marriageAllowanceRecipient: false,
    },
  },
  sa102: [],
  updatedAt: new Date().toISOString(),
};

// Helper to set nested object properties by path (e.g. "sa100.reliefs.giftAidGrossedUp")
function setNestedValue(obj: any, path: string, value: any): any {
  const newObj = { ...obj };
  const keys = path.split('.');
  let current = newObj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    // Check if key contains an array index like sa102[0]
    const arrayMatch = key.match(/(\w+)\[(\d+)\]/);
    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      const index = parseInt(arrayMatch[2]);
      current[arrayName] = [...(current[arrayName] || [])];
      current[arrayName][index] = { ...current[arrayName][index] };
      current = current[arrayName][index];
    } else {
      current[key] = { ...current[key] };
      current = current[key];
    }
  }

  const lastKey = keys[keys.length - 1];
  const lastArrayMatch = lastKey.match(/(\w+)\[(\d+)\]/);
  if (lastArrayMatch) {
    const arrayName = lastArrayMatch[1];
    const index = parseInt(lastArrayMatch[2]);
    current[arrayName] = [...(current[arrayName] || [])];
    current[arrayName][index] = value;
  } else {
    current[lastKey] = value;
  }

  return newObj;
}

const API_BASE = import.meta.env.PROD
  ? 'https://uk-sa-orchestrator-1014225777564.europe-west2.run.app'
  : 'http://localhost:3001';

export const useReturnStore = create<ReturnStore>((set, get) => ({
  returnObj: initialReturn,
  computation: null,
  loading: false,
  error: null,

  setReturnObj: (newReturn) => set({ returnObj: newReturn }),

  updateField: (path, value) => {
    set((state) => {
      const updated = setNestedValue(state.returnObj, path, value);
      updated.updatedAt = new Date().toISOString();
      return { returnObj: updated };
    });
    // Trigger recalculation immediately on field updates
    get().calculateTax();
  },

  calculateTax: async () => {
    set({ loading: true, error: null });
    try {
      const headers = await authHeaders();
      const response = await fetch(`${API_BASE}/api/calculate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          returnObj: get().returnObj,
          taxYear: get().returnObj.taxYear,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to run tax calculation on the server');
      }

      const data = await response.json();
      if (data.status === 'success') {
        set({ computation: data.calculation, loading: false });
      } else {
        set({ error: data.message, loading: false });
      }
    } catch (err: any) {
      set({ error: err.message || 'Network calculation error', loading: false });
    }
  },
}));
