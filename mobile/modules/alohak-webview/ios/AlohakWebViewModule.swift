import ExpoModulesCore
import WebKit

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ target: WKScriptMessageHandler) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}

public class AlohakWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AlohakWebView")
    View(AlohakWebView.self) {
      Events("onDocument", "onMessage")
      Prop("entryURL") { (view: AlohakWebView, value: String) in view.entry = value }
      Prop("scopeURL") { (view: AlohakWebView, value: String) in view.scope = value }
      Prop("bootstrap") { (view: AlohakWebView, value: String) in view.runBound(value) }
      Prop("reply") { (view: AlohakWebView, value: String) in view.runBound(value) }
      OnViewDidUpdateProps { (view: AlohakWebView) in view.loadEntry() }
    }
  }
}

final class AlohakWebView: ExpoView, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  let onDocument = EventDispatcher()
  let onMessage = EventDispatcher()
  var entry = ""
  var scope = ""
  private var loadedEntry = ""
  private var documentId = ""
  private var documentURL = ""
  private var responseURL = ""
  private var ready = false
  private var currentNavigation: WKNavigation?
  private var webView: WKWebView!

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let configuration = WKWebViewConfiguration()
    configuration.applicationNameForUserAgent = "Alohak/1"
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    // The handler checks WKScriptMessage.frameInfo, not a URL sent by JS.
    configuration.userContentController.add(WeakMessageHandler(self), name: "alohak")
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    addSubview(webView)
  }

  override func layoutSubviews() { super.layoutSubviews(); webView.frame = bounds }

  private func allowed(_ raw: String) -> Bool {
    guard raw.count <= 4096, !raw.contains("\\"),
      raw.components(separatedBy: CharacterSet(charactersIn: "?#")).first?.range(of: "%2f|%5c|%2e|%25", options: [.regularExpression, .caseInsensitive]) == nil,
      let url = URLComponents(string: raw), let base = URLComponents(string: scope),
      url.scheme == "https", url.user == nil, url.password == nil,
      url.host == base.host, url.port == base.port, base.scheme == "https", base.path.hasSuffix("/")
    else { return false }
    return url.percentEncodedPath == String(base.percentEncodedPath.dropLast()) || url.percentEncodedPath.hasPrefix(base.percentEncodedPath)
  }

  func loadEntry() {
    guard entry != loadedEntry, !scope.isEmpty else { return }
    loadedEntry = entry
    invalidate()
    guard allowed(entry), let url = URL(string: entry) else { fail("Entry is outside the HTTPS deployment."); return }
    webView.load(URLRequest(url: url))
  }

  private func invalidate() {
    ready = false; documentId = UUID().uuidString; documentURL = ""; responseURL = ""
    onDocument(["state": "loading", "documentId": documentId, "documentURL": ""])
  }
  private func fail(_ message: String) {
    ready = false; documentId = UUID().uuidString
    onDocument(["state": "error", "documentId": documentId, "documentURL": documentURL, "message": message])
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard action.targetFrame?.isMainFrame == true, let url = action.request.url, allowed(url.absoluteString) else {
      // Never place external pages/popups in the bridged view. Native user UI
      // can later offer an explicit system-browser action; no auto-open redirect.
      decisionHandler(.cancel); return
    }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { invalidate(); currentNavigation = navigation }
  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    guard response.isForMainFrame, let url = response.response.url, allowed(url.absoluteString), response.canShowMIMEType,
      let http = response.response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { decisionHandler(.cancel); fail("Unsupported or denied document response."); return }
    // Response identity precedes page execution; history.replaceState cannot
    // promote an initially denied path into an authorized document.
    responseURL = url.absoluteString
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { if navigation === currentNavigation { documentURL = responseURL } }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard navigation === currentNavigation else { return }
    guard allowed(documentURL) else { fail("Missing native document identity."); return }
    ready = true
    onDocument(["state": "ready", "documentId": documentId, "documentURL": documentURL])
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("Document load failed; reload to retry.") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("Document load failed; reload to retry.") }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { invalidate(); fail("Web content process stopped; reload to reconnect.") }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard ready, message.frameInfo.isMainFrame, message.webView === webView, allowed(documentURL),
      message.frameInfo.securityOrigin.protocol == "https",
      message.frameInfo.securityOrigin.host == URL(string: documentURL)?.host,
      let data = message.body as? String, data.utf8.count <= 16384 else { return }
    onMessage(["documentId": documentId, "documentURL": documentURL, "isMainFrame": true, "data": data])
  }

  func runBound(_ input: String) {
    guard ready, let bytes = input.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: String],
      object["documentId"] == documentId, let script = object["script"] else { return }
    webView.evaluateJavaScript(script, completionHandler: nil)
  }

  // Explicitly reject popups, even those targeting an approved URL.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}
