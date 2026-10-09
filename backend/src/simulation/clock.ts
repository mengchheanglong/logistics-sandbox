/**
 * @fileoverview SimulationClock manages time advancement in the simulation.
 * It maps real time elapsed to simulated time based on the simulation speed.
 * At 1x speed, 1 real second = 1 simulated minute.
 */

export interface ISimulationClock {
  currentTime: number;
  speed: number;
  isPaused: boolean;
  realTimeStart: number;
  simTimeStart: number;
  tick(deltaRealMs: number): void;
  step(deltaSimMs: number): void;
  pause(): void;
  resume(): void;
  setSpeed(newSpeed: number): void;
  getSimulatedTime(): number;
  getFormattedTime(): string;
  reset(initialSimTime?: number, initialSpeed?: number): void;
}

export class SimulationClock implements ISimulationClock {
  /** Current simulated time in milliseconds */
  public currentTime: number;
  /** Speed multiplier. 0 = pause, 1 = normal, etc. */
  public speed: number;
  public realTimeStart: number;
  public simTimeStart: number;
  public isPaused: boolean = false;
  private lastRealTime: number;

  /**
   * 1 real second = 1 simulated minute at 1x speed.
   * This means the ratio is 60 simulated seconds / 1 real second = 60.
   */
  private readonly SIM_TIME_RATIO = 60;

  constructor(initialSimTime: number = 0, initialSpeed: number = 1) {
    this.currentTime = initialSimTime;
    this.speed = initialSpeed;
    this.simTimeStart = initialSimTime;
    this.realTimeStart = 0;
    this.lastRealTime = 0;
  }

  /**
   * Advances the simulation clock based on real time elapsed.
   * @param deltaRealMs Real time elapsed since last tick in milliseconds
   */
  public tick(deltaRealMs: number): void {
    if (this.isPaused || this.speed === 0 || deltaRealMs <= 0) return;
    const deltaSimMs = deltaRealMs * this.speed * this.SIM_TIME_RATIO;
    this.currentTime += deltaSimMs;
    this.lastRealTime += deltaRealMs;
  }

  /**
   * Advances the simulation clock by a discrete simulated time delta.
   * @param deltaSimMs Simulated time to advance in milliseconds
   */
  public step(deltaSimMs: number): void {
    if (deltaSimMs <= 0) return;
    this.currentTime += deltaSimMs;
  }

  public setSpeed(newSpeed: number): void {
    this.speed = newSpeed;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
  }

  public getSimulatedTime(): number {
    return this.currentTime;
  }

  public getFormattedTime(): string {
    const date = new Date(this.currentTime);
    return date.toISOString();
  }

  public reset(initialSimTime: number = 0, initialSpeed: number = 1): void {
    this.currentTime = initialSimTime;
    this.simTimeStart = initialSimTime;
    this.speed = initialSpeed;
    this.isPaused = false;
    this.realTimeStart = 0;
    this.lastRealTime = 0;
  }
}
