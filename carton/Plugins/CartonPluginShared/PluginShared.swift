// Copyright 2024 Carton contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Foundation
import PackagePlugin

struct CartonPluginError: Swift.Error, CustomStringConvertible {
  let description: String

  init(_ message: String) {
    self.description = "Error: " + message
  }
}

/// Derive default product from the package
internal func deriveDefaultProduct(package: Package) throws -> String {
  let executableProducts = package.products(ofType: ExecutableProduct.self)
  guard !executableProducts.isEmpty else {
    throw CartonPluginError(
      "Make sure there's at least one executable product in your Package.swift")
  }
  guard executableProducts.count == 1 else {
    throw CartonPluginError(
      "Failed to disambiguate the product. Pass one of \(executableProducts.map(\.name).joined(separator: ", ")) to the --product option"
    )

  }
  return executableProducts[0].name
}

/// Returns the list of resource bundle paths for the given targets
internal func deriveResourcesPaths(
  productArtifactPath: Path,
  sourceTargets: [any PackagePlugin.Target],
  package: Package
) -> [Path] {
  return deriveResourcesPaths(
    buildDirectory: productArtifactPath.removingLastComponent(),
    sourceTargets: sourceTargets, package: package
  )
}

internal func deriveResourcesPaths(
  buildDirectory: Path,
  sourceTargets: [any PackagePlugin.Target],
  package: Package
) -> [Path] {
  sourceTargets.compactMap { target -> Path? in
    // NOTE: The resource bundle file name is constructed from `displayName` instead of `id` for some reason
    // https://github.com/apple/swift-package-manager/blob/swift-5.9.2-RELEASE/Sources/PackageLoading/PackageBuilder.swift#L908
    let bundleName = package.displayName + "_" + target.name + ".resources"
    let resourcesPath = buildDirectory.appending(subpath: bundleName)
    guard FileManager.default.fileExists(atPath: resourcesPath.string) else { return nil }
    return resourcesPath
  }
}

extension Environment {
  static func parse(from extractor: inout ArgumentExtractor) throws -> Environment {
    guard let rawValue = extractor.extractOption(named: "environment").last else {
      return Environment.command
    }
    let (parsed, diagnostic) = Environment.parse(rawValue)
    if let diagnostic {
      Diagnostics.warning(diagnostic)
    }
    guard let parsed else {
      throw CartonPluginError(
        "Environment '\(rawValue)' is not recognized. Use one of \(Environment.allCases.map(\.rawValue).joined(separator: ", "))"
      )
    }
    return parsed
  }

  func applyBuildParameters(_ parameters: inout PackageManager.BuildParameters) {
    var output = Environment.Parameters()
    applyBuildParameters(&output)
    parameters.otherSwiftcFlags += output.otherSwiftcFlags
    parameters.otherLinkerFlags += output.otherLinkerFlags
  }
}

func applyExtraBuildFlags(from extractor: inout ArgumentExtractor, parameters: inout PackageManager.BuildParameters) {
  parameters.otherCFlags += extractor.extractSingleDashOption(named: "Xcc")
  parameters.otherCxxFlags += extractor.extractSingleDashOption(named: "Xcxx")
  parameters.otherSwiftcFlags += extractor.extractSingleDashOption(named: "Xswiftc")
  parameters.otherLinkerFlags += extractor.extractSingleDashOption(named: "Xlinker")
}

extension ArgumentExtractor {
  fileprivate mutating func extractSingleDashOption(named name: String) -> [String] {
    let parts = remainingArguments.split(separator: "--", maxSplits: 1, omittingEmptySubsequences: false)
    var args = Array(parts[0])
    let literals = Array(parts.count == 2 ? parts[1] : [])

    var values: [String] = []
    var idx = 0
    while idx < args.count {
      var arg = args[idx]
      if arg == "-\(name)" {
        args.remove(at: idx)
        if idx < args.count {
          let val = args[idx]
          values.append(val)
          args.remove(at: idx)
        }
      }
      else if arg.starts(with: "-\(name)=") {
        arg.removeFirst(2 + name.count + 1)
        values.append(arg)
        args.remove(at: idx)
      }
      else {
        idx += 1
      }
    }

    self = ArgumentExtractor(args + literals)
    return values
  }
}

extension PackageManager.BuildResult {
  /// Find `.wasm` executable artifact
  internal func findWasmArtifact(for product: String) throws
    -> PackageManager.BuildResult.BuiltArtifact
  {
    let executables = self.builtArtifacts.filter {
      $0.kind == .executable && $0.path.lastComponent == "\(product).wasm"
    }
    guard !executables.isEmpty else {
      throw CartonPluginError(
        "Failed to find '\(product).wasm' from executable artifacts of product '\(product)'")
    }
    guard executables.count == 1, let executable = executables.first else {
      throw CartonPluginError(
        "Failed to disambiguate executable product artifacts from \(executables.map(\.path.string).joined(separator: ", "))"
      )
    }
    return executable
  }
}

internal func checkSwiftVersion() throws {
  var doesSwiftPMSupportXCompilationWithPlugin: Bool {
    #if swift(>=5.9.2)
      return true
    #else
      return false
    #endif
  }

  let magicEnvVar = "CARTON_SKIP_SWIFTPM_VERSION_CHECK"
  guard ProcessInfo.processInfo.environment[magicEnvVar] == nil else {
    // Skip SwiftPM version check
    return
  }

  guard doesSwiftPMSupportXCompilationWithPlugin else {
    throw CartonPluginError(
      """
      SwiftPM version below 5.9.2 is not supported by carton plugin due to the lack of cross-compilation support \
      with SwiftPM plugins.
      You can skip this check by setting the environment variable \(magicEnvVar) to any value \
      if you are sure that your SwiftPM version supports cross-compilation with plugins.
      """)
  }
}

internal func checkHelpFlag(_ arguments: [String], frontend: String = "carton-frontend", subcommand: String, context: PluginContext)
  throws
{
  if arguments.contains("--help") || arguments.contains("-h") {
    let frontend = try makeCartonFrontendProcess(
      context: context, frontend: frontend, arguments: [subcommand, "--help"])
    try frontend.checkRun(printsLoadingMessage: false, forwardExit: true)
  }
}

internal func makeCartonFrontendProcess(context: PluginContext, frontend: String = "carton-frontend", arguments: [String]) throws
  -> Process
{
  let frontend = try context.tool(named: frontend)

  Diagnostics.remark(
    "Running " + ([frontend.path.string] + arguments).map { "\"\($0)\"" }.joined(separator: " "))
  let process = Process()
  process.executableURL = URL(fileURLWithPath: frontend.path.string)
  process.arguments = arguments
  return process
}
