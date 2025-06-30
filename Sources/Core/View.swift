public protocol View {
    var body: String { get }
}

public struct AnyView: View {
    private let content: String

    public init<V: View>(_ view: V) {
        if let deferredView = view as? DeferredRender {
            self.content = deferredView.bodyDeferred
        } else {
            self.content = view.body
        }
    }

    public var body: String {
        content
    }
}

public struct Window: View {
    public var body: String {
        "<p style='color: red'>\(String(describing: self)) does NOT conform to DeferredRender protocol!</p"
    }

    public init() {}
}

public protocol DeferredRender {
    var bodyDeferred: String { get }
}