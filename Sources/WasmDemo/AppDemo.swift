// The Swift Programming Language
// https://docs.swift.org/swift-book
import StaticHTML
import Core

import JavaScriptKit

@main
struct AppDemo: View {

    public var body: String {
        AnyView(Window()).body
    }

    public init() {}

    static func main() {
        let app = AppDemo()
        print("Welcome to the Wasm Demo! -- \(app.body)")

#if os(WASI)
        let document = JSObject.global.document
        document.body.innerHTML = JSValue(stringLiteral: """
        <h1>Welcome to Swift Wasm Demo!</h1>
        <p>This is a bug reproducer for loss of conformance issue across module boundary:</p>
        \(app.body)
        """)
#endif
        
    }
}