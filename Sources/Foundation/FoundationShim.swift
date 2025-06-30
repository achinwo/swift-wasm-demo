
@_exported import FoundationEssentials

public struct Bundle: Sendable {
    public static let main = Bundle(path: FileManager.default.currentDirectoryPath)!

    public init?(path: String) {
        self.bundlePath = path
    }

    public func path(forResource name: String, ofType ext: String? = nil) -> String? {
        // This is a stub implementation for the sake of compatibility.
        return nil
    }

    public var bundlePath: String

}
