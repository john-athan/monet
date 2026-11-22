import AppKit
import WebKit

/// The hidden WebView that runs the web client's Dunkelkammer (the ML loop) for this Mac.
/// It has a device session cookie (from the bearer token) and lives in an offscreen window so
/// WebKit does not throttle it as an occluded page. Status comes from `window.monetDarkroom?.status`.
@MainActor
final class Indexer: NSObject, WKNavigationDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var poll: Timer?
    private var activity: NSObjectProtocol?
    private var api: Api?
    private var cookieSetAt = Date.distantPast
    var onStatus: (DarkroomStatus?) -> Void = { _ in }

    func start(api: Api) {
        stop()
        self.api = api
        // Do not let App Nap suspend the model loop.
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated],
                                                         reason: "Monet analysiert Fotos")
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = WKWebsiteDataStore.default()
        let wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 256, height: 256), configuration: cfg)
        wv.navigationDelegate = self
        wv.setValue(false, forKey: "drawsBackground")
        let w = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 256, height: 256),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentView = wv
        w.ignoresMouseEvents = true
        w.hasShadow = false
        w.collectionBehavior = [.transient, .ignoresCycle, .stationary, .canJoinAllSpaces]
        w.orderBack(nil)
        window = w; webView = wv
        Task { await load() }
        poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.pollStatus() }
        }
    }

    func stop() {
        poll?.invalidate(); poll = nil
        if let a = activity { ProcessInfo.processInfo.endActivity(a); activity = nil }
        webView?.stopLoading(); webView = nil
        window?.orderOut(nil); window = nil
        onStatus(nil)
    }

    private func load() async {
        guard let api, let wv = webView else { return }
        do {
            let cookie = try await api.deviceSession()
            await wv.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
            cookieSetAt = Date()
            var c = URLComponents(url: api.base, resolvingAgainstBaseURL: false)!
            c.path = "/geraete"; c.queryItems = [URLQueryItem(name: "darkroom", value: "always")]
            wv.load(URLRequest(url: c.url!))
        } catch {
            // Server unreachable: try again in a minute.
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            if self.webView != nil { await load() }
        }
    }

    private func pollStatus() async {
        guard let wv = webView else { return }
        // A session lives 30 days, sliding; renew the cookie daily and reload so the page uses it.
        if Date().timeIntervalSince(cookieSetAt) > 24 * 3600 { await load() }
        do {
            let v = try await wv.evaluateJavaScript("JSON.stringify(window.monetDarkroom?.status ?? null)")
            onStatus(DarkroomStatus.parse(v as? String))
        } catch { onStatus(nil) }
    }

    // MARK: Navigation

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Task { await load() }
    }

    /// The page never leaves the Monet origin.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let ok = action.request.url?.host == api?.base.host || action.request.url?.scheme == "about"
        decisionHandler(ok ? .allow : .cancel)
    }
}
