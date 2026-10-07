/**
 * @fileoverview In-Memory Scenario Run History Repository.
 */

import { IScenarioRepository, ScenarioRunRecord } from '../types.js';

export class InMemoryScenarioRepository implements IScenarioRepository {
  private runs: ScenarioRunRecord[] = [];

  public async saveScenarioRun(run: ScenarioRunRecord): Promise<void> {
    const existingIdx = this.runs.findIndex(r => r.simulationId === run.simulationId);
    if (existingIdx >= 0) {
      this.runs[existingIdx] = { ...run };
    } else {
      this.runs.push({ ...run });
    }
  }

  public async getScenarioRuns(): Promise<ScenarioRunRecord[]> {
    return [...this.runs];
  }

  public getStatus() {
    return {
      driver: 'in-memory (audit log)',
      healthy: true,
      count: this.runs.length,
    };
  }
}
