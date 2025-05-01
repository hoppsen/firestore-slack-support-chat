/**
 * Class for tracking execution timings of operations
 */
export class Timings {
  private timings: { [key: string]: number } = {};
  private startTime: number;
  private stepCounter = 0;

  /**
   * Creates a new Timings instance
   */
  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Starts timing for a specific step
   *
   * @param {string} step - The step name to time
   */
  startTiming(step: string) {
    const numberedStep = `${String(++this.stepCounter).padStart(2, '0')}_${step}`;
    this.timings[numberedStep] = Date.now();
  }

  /**
   * Ends timing for a specific step
   *
   * @param {string} step - The step name to end timing for
   */
  endTiming(step: string) {
    const numberedStep = Object.keys(this.timings).find((key) => key.endsWith(step));
    if (numberedStep && this.timings[numberedStep]) {
      this.timings[numberedStep] = Date.now() - this.timings[numberedStep];
    }
  }

  /**
   * Gets all recorded timings
   *
   * @return {Object.<string, number>} The timings object
   */
  getTimings(): { [key: string]: number } {
    return this.timings;
  }

  /**
   * Gets the total duration since initialization
   *
   * @return {string} The total duration in milliseconds
   */
  getTotalDurationInMs(): string {
    return `${Date.now() - this.startTime}ms`;
  }

  /**
   * Wraps a promise with timing measurements
   *
   * @param {string} name - The name of the timed operation
   * @param {function(): Promise<T>} promise - The promise to time
   * @return {Promise<T>} The result of the promise
   * @template T
   */
  async timedPromise<T>(name: string, promise: () => Promise<T>): Promise<T> {
    this.startTiming(name);
    try {
      return await promise();
    } finally {
      this.endTiming(name);
    }
  }
}
