import Core
import JavaScriptKit



extension Window: DeferredRender {
    /// A view that defers rendering its body until it is needed.
    ///
    /// This is useful for optimizing performance by avoiding unnecessary rendering
    /// of views that may not be immediately visible or needed.
    public var bodyDeferred: String {
        "<p style='color: green'>\(String(describing: self)) conforms to DeferredRender protocol!</p"
    }
}