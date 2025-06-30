// Copyright 2020 Carton contributors
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
//
//  Created by Cavelle Benjamin on Dec/20/20.
//

import CartonHelpers
import Foundation

/// Returns path to the built products directory.
public var productsDirectory: AbsolutePath {
  get throws {
    #if os(macOS)
      for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
        return try AbsolutePath(validating: bundle.bundleURL.deletingLastPathComponent().path)
      }
      fatalError("couldn't find the products directory")
    #else
      return try AbsolutePath(validating: Bundle.main.bundleURL.path)
    #endif
  }
}

public var testFixturesDirectory: AbsolutePath {
  get throws {
    try packageDirectory.appending(components: "Tests", "Fixtures")
  }
}

public var packageDirectory: AbsolutePath {
  get throws {
    try AbsolutePath(validating: #filePath)
      .parentDirectory
      .parentDirectory
      .parentDirectory
  }
}

func withFixture(_ name: String, _ body: (AbsolutePath) throws -> Void) throws {
  let fixtureDir = try testFixturesDirectory.appending(component: name)
  try body(fixtureDir)
}

func withFixture(_ name: String, _ body: (AbsolutePath) async throws -> Void) async throws {
  let fixtureDir = try testFixturesDirectory.appending(component: name)
  try await body(fixtureDir)
}
