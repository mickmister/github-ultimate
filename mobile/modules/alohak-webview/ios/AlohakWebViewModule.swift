import ExpoModulesCore
import WebKit

private final class WeakMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
  weak var target: AlohakWebView?
  init(_ target: AlohakWebView) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard let target = target else { replyHandler(nil, "WebView was disposed."); return }
    target.userContentController(controller, didReceive: message, replyHandler: replyHandler)
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
      AsyncFunction("respond") { (view: AlohakWebView, replyId: String, data: String) in view.respond(replyId, data: data) }
      OnViewDidUpdateProps { (view: AlohakWebView) in view.loadEntry() }
    }
  }
}

final class AlohakWebView: ExpoView, WKNavigationDelegate, WKUIDelegate {
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
  private var pending: [String: (String, (Any?, String?) -> Void)] = [:]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let configuration = WKWebViewConfiguration()
    configuration.applicationNameForUserAgent = "Alohak/1"
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    // The handler checks WKScriptMessage.frameInfo, not a URL sent by JS.
    configuration.userContentController.addScriptMessageHandler(WeakMessageHandler(self), contentWorld: .page, name: "alohak")
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
    cancelReplies()
    ready = false; documentId = UUID().uuidString; documentURL = ""; responseURL = ""
    onDocument(["state": "loading", "documentId": documentId, "documentURL": ""])
  }
  private func fail(_ message: String) {
    cancelReplies()
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
    guard response.isForMainFrame else { decisionHandler(.cancel); return }
    guard let url = response.response.url, allowed(url.absoluteString), response.canShowMIMEType,
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
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if navigation === currentNavigation { fail("Document load failed; reload to retry.") } }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if navigation === currentNavigation { fail("Document load failed; reload to retry.") } }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { invalidate(); fail("Web content process stopped; reload to reconnect.") }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    guard ready, message.frameInfo.isMainFrame, message.webView === webView, allowed(documentURL),
      message.frameInfo.securityOrigin.protocol == "https",
      message.frameInfo.securityOrigin.host == URL(string: documentURL)?.host,
      (message.frameInfo.securityOrigin.port == 0 || message.frameInfo.securityOrigin.port == 443),
      let data = message.body as? String, data.utf8.count <= 16384, pending.count < 8 else { replyHandler(nil, "Native document or request unavailable."); return }
    let replyId = UUID().uuidString
    pending[replyId] = (documentId, replyHandler)
    onMessage(["documentId": documentId, "documentURL": documentURL, "isMainFrame": true, "data": data, "replyId": replyId])
  }

  func respond(_ replyId: String, data: String) {
    guard let request = pending.removeValue(forKey: replyId) else { return }
    guard ready, request.0 == documentId else { request.1(nil, "Document changed."); return }
    // Resolve the original script message's Promise, not code in whichever
    // document happens to be current when asynchronous evaluation executes.
    request.1(data, nil)
  }
  private func cancelReplies() {
    let requests = pending; pending.removeAll()
    for (_, request) in requests { request.1(nil, "Document changed.") }
  }
  deinit { cancelReplies() }

  func runBound(_ input: String) {
    guard ready, let bytes = input.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: String],
      object["documentId"] == documentId, let script = object["script"] else { return }
    webView.evaluateJavaScript(script, completionHandler: nil)
  }

  // Explicitly reject popups, even those targeting an approved URL.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}
