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

import Foundation

extension String {
  public var isAbsolutePath: Bool { first == "/" }
}

extension FileManager {
  public func traverseRecursively(_ traversalRoot: URL) throws -> [URL] {
    var isDirectory: ObjCBool = false
    guard
      FileManager.default.fileExists(atPath: traversalRoot.path, isDirectory: &isDirectory)
    else {
      return []
    }

    var result = [traversalRoot]

    guard isDirectory.boolValue else {
      return result
    }

    let enumerator = FileManager.default.enumerator(atPath: traversalRoot.path)

    while let element = enumerator?.nextObject() as? String {
        let path = traversalRoot.appendingPathComponent(element)
      result.append(path)
    }

    return result
  }

  public func resourcesDirectoryNames(relativeTo buildDirectory: URL) throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: buildDirectory.path).filter {
      $0.hasSuffix(".resources")
    }
  }
}
