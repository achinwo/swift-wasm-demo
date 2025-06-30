# Swift WASM Conformance Bug Demo

This repo reproduces an issue where conformance appears to be getting dropped across SwiftPM module boundaries.

To run, ensure you have `swiftly` and swift version `6.2-snapshot-2025-06-27` as `--global-default` as well as SDK `swift-6.2-DEVELOPMENT-SNAPSHOT-2025-06-27-a_wasm`, then use VS Code task runner; 
```
Run Task > carton dev
```