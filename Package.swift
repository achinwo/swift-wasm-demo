// swift-tools-version: 6.2
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "swift-wasm-demo",
    platforms: [
        // The platforms that this package supports.
        .macOS(.v15)
    ],
    products: [
        // Products define the executables and libraries a package produces, making them visible to other packages.
        .executable(
            name: "WasmDemo",
            targets: ["WasmDemo"])

    ],
    dependencies: [
        // Dependencies declare other packages that this package depends on.
        .package(path: "./carton"),
        .package(url: "https://github.com/swiftwasm/JavaScriptKit.git", from: "0.31.1"),
        .package(url: "https://github.com/swiftlang/swift-foundation.git", branch: "main"),
    ],
    targets: [
        // Targets are the basic building blocks of a package, defining a module or a test suite.
        // Targets can depend on other targets in this package and products from dependencies.
        .target(
            name: "Foundation",
            dependencies: [
                .product(
                    name: "FoundationEssentials",
                    package: "swift-foundation"
                )
            ],
        ),
        .executableTarget(
            name: "WasmDemo", dependencies: [.target(name: "StaticHTML")],
            resources: [.copy("../../JavaScriptKit_JavaScriptKit.resources")],
            swiftSettings: [
                .defaultIsolation(MainActor.self)
            ]
        ),
        .target(
            name: "StaticHTML",
            dependencies: [
                .target(name: "Core"),
                .product(name: "JavaScriptKit", package: "JavaScriptKit"),
            ],
            swiftSettings: [
                .defaultIsolation(MainActor.self)
            ]
            ),
        .target(
            name: "Core",
            dependencies: [
                .target(
                    name: "Foundation",
                    condition: .when(platforms: [.wasi])
                )
            ],
            swiftSettings: [
                .defaultIsolation(MainActor.self)
            ]
            ),
    ]
)
