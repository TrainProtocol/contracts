# Zcash WASM Module (Work in Progress)

This branch introduces the Zcash implementation for the Train Protocol, using a Rust → WebAssembly architecture.

## Structure

```
chains/zcash/
│
├── zcash-core/     # Pure Rust logic for Zcash + Train Protocol
├── zcash-wasm/     # WASM wrapper exposing selected Rust functions
│   └── pkg/        # Compiled WASM package used by front/back
└── .gitignore      # Ignores Rust targets, keeps pkg tracked
```

## Purpose

- Implement Zcash-side logic required for the Train Protocol
- Compile Rust code to WebAssembly for unified frontend/backend use
- Provide a clean, typed JS/TS interface

## Status

**Work in progress.**

Core logic and WASM interfaces are being added incrementally.

## Building

To build the WASM package:

```bash
cd zcash-wasm
wasm-pack build --target web
```

The compiled package will be available in `zcash-wasm/pkg/`.
