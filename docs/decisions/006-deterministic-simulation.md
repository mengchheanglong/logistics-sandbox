# ADR-006: Deterministic Simulation

## Status

Accepted

## Context

The logistics sandbox is intended to be an **engineering test bench**, not just a visual demo. To meaningfully compare routing algorithms, dispatch strategies, or infrastructure configurations, we need to run the exact same scenario multiple times with different parameters and get reproducible results.

Non-deterministic simulations (using `Math.random()`, system clocks, or uncontrolled concurrency) make A/B comparison impossible because differences in results could be caused by random variation rather than the algorithm change.

## Decision

The simulation uses a **seeded pseudo-random number generator (PRNG)** for all stochastic processes:

- Order generation timing and locations
- Customer positions
- Traffic fluctuations
- Vehicle initial positions
- Incident timing

The PRNG uses the **mulberry32** algorithm, which is fast and provides good statistical properties for simulation use.

```
same seed + same scenario + same algorithm/config = same simulated world
```

The simulation clock is decoupled from wall-clock time, advancing in discrete ticks. All time-dependent logic uses simulation time, never `Date.now()`.

## Consequences

**Positive:**
- Perfect reproducibility for algorithm comparison experiments
- Debugging: replay the exact sequence of events that led to a bug
- Fair benchmarks: run the same orders/traffic/incidents with different dispatchers
- Scenario serialization: share a seed + config to reproduce any experiment

**Negative:**
- Cannot use `Math.random()` anywhere in simulation logic
- Async operations (routing API calls) must be carefully ordered
- Real-world randomness (network latency, OS scheduling) can affect routing request timing

**Mitigation:**
- All random values flow through the SeededRandom utility
- Routing results are cached by O-D pair to reduce timing sensitivity
- Determinism verification: run same scenario twice, assert identical event sequences
