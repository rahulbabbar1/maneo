export type PhaseKey = 'onboard' | 'residence' | 'income' | 'reliefs' | 'review' | 'declare' | 'submit';

export interface PhaseTransition {
  from: PhaseKey;
  to: PhaseKey;
  trigger: string;
  timestamp: string;
}

export class StateMachine {
  private currentPhase: PhaseKey = 'onboard';
  private transitions: PhaseTransition[] = [];

  constructor(initialPhase?: PhaseKey) {
    if (initialPhase) {
      this.currentPhase = initialPhase;
    }
  }

  getCurrentPhase(): PhaseKey {
    return this.currentPhase;
  }

  getTransitionHistory(): PhaseTransition[] {
    return this.transitions;
  }

  transitionTo(nextPhase: PhaseKey, trigger: string): boolean {
    const validTransitions: Record<PhaseKey, PhaseKey[]> = {
      onboard: ['residence'],
      residence: ['onboard', 'income'],
      income: ['residence', 'reliefs'],
      reliefs: ['income', 'review'],
      review: ['reliefs', 'declare'],
      declare: ['review', 'submit'],
      submit: [],
    };

    const allowed = validTransitions[this.currentPhase];
    if (allowed && allowed.includes(nextPhase)) {
      const transition: PhaseTransition = {
        from: this.currentPhase,
        to: nextPhase,
        trigger,
        timestamp: new Date().toISOString(),
      };
      this.transitions.push(transition);
      this.currentPhase = nextPhase;
      return true;
    }

    return false;
  }

  // Heuristic phase determination based on LLM response or user inputs
  determineNextPhase(userInput: string, assistantReply: string): PhaseKey | null {
    const text = (userInput + ' ' + assistantReply).toLowerCase();
    
    if (this.currentPhase === 'onboard' && (text.includes('residence') || text.includes('days in the uk') || text.includes('srt'))) {
      return 'residence';
    }
    if (this.currentPhase === 'residence' && (text.includes('income') || text.includes('employment') || text.includes('employer') || text.includes('p60'))) {
      return 'income';
    }
    if (this.currentPhase === 'income' && (text.includes('relief') || text.includes('gift aid') || text.includes('pension') || text.includes('ftcr'))) {
      return 'reliefs';
    }
    if (this.currentPhase === 'reliefs' && (text.includes('review') || text.includes('computation') || text.includes('summary'))) {
      return 'review';
    }
    if (this.currentPhase === 'review' && (text.includes('declare') || text.includes('declaration') || text.includes('confirm'))) {
      return 'declare';
    }
    if (this.currentPhase === 'declare' && (text.includes('submit') || text.includes('file') || text.includes('gateway'))) {
      return 'submit';
    }

    return null;
  }
}
