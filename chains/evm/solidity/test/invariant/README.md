# Invariant Test Suite

Stateful fuzzing / invariant suite for the Train protocol, run by **Foundry**, **Echidna**, and
**Medusa** against one shared set of handlers and properties. See `PROPERTIES.md` for the spec.

## What is here

- `Base.sol`: shared setup, deployed-contract references, actors, helpers, and ghost state
- `Snapshots.sol`: before/after state capture used by properties
- `Properties.sol`: global and function-specific invariants
- `handlers/`: protocol actions exposed to the fuzzers
- `utils/`: shared helper libraries — assertions, clamping, math, deploy helpers, logging, and mocks
- `FuzzTester.sol`: Echidna/Medusa entry point
- `FoundryTester.sol`: Foundry harness for quick debugging and local repros
- `FoundryInvariant.t.sol`: Foundry `invariant_*` target reusing the same handlers/properties

## Inheritance chain

```
Base (is StringUtils, Clamp, Deployer, Math)
      └─► Snapshots (is Base)
            └─► Properties (is PropertiesAsserts, Snapshots)
                  └─► TrainHandler (is Properties)
                        └─► Handlers (is TrainHandler)         — aggregator + actor switching
                              ├─► FuzzTester (is Handlers)     — Echidna/Medusa entry point
                              └─► FoundryTester (is Test, Handlers) — Foundry quick-debug entry point
```

## Related paths

- `../../echidna.yaml`, `../../medusa.json`: fuzzer configs
- `../../corpus/`: fuzzer corpora, coverage, and logs (regenerated, gitignored)
- `../../slither_results.json`: cached Slither result Medusa reads (so it does not launch a live pass)

## How to run

From the project root:

```bash
forge build
forge test --match-contract FoundryTester         # quick debug / repros
forge test --match-contract FoundryInvariant       # Foundry invariant run
echidna . --contract FuzzTester --config echidna.yaml
medusa fuzz
```
