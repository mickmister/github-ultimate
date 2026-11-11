package dev.githubultimate.companion.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.*
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import org.json.JSONObject
import java.util.UUID

class CompanionWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CompanionWebView")
    View(CompanionWebView::class) {
      Events("onDocument", "onMessage")
      Prop("entryURL") { view: CompanionWebView, value: String -> view.entry = value }
      Prop("scopeURL") { view: CompanionWebView, value: String -> view.scope = value }
      Prop("bootstrap") { view: CompanionWebView, value: String -> view.runBound(value) }
      Prop("reply") { view: CompanionWebView, value: String -> view.runBound(value) }
      OnViewDidUpdateProps { view: CompanionWebView -> view.loadEntry() }
      OnViewDestroys { view: CompanionWebView -> view.dispose() }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
class CompanionWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onDocument by EventDispatcher()
  private val onMessage by EventDispatcher()
  var entry = ""
  var scope = ""
  private var loadedEntry = ""
  private var documentId = ""
  private var documentURL = ""
  private var ready = false
  private var listenerInstalled = false
  private val web = WebView(context)

  init {
    addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    web.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = true
      userAgentString = "$userAgentString GitHubUltimateCompanion/1"
      allowFileAccess = false; allowContentAccess = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(true)
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
    web.webChromeClient = object : WebChromeClient() {
      override fun onCreateWindow(view: WebView?, dialog: Boolean, gesture: Boolean, message: android.os.Message?): Boolean = false
    }
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return true
        if (!allowed(request.url.toString())) { invalidateDocument(); fail("Navigation outside the deployment was blocked."); return true }
        return false
      }
      override fun onPageStarted(view: WebView, url: String, icon: Bitmap?) {
        invalidateDocument()
        if (!allowed(url)) { view.stopLoading(); fail("Document is outside the deployment."); return }
        // Captured from the native navigation lifecycle, not history-mutated JS.
        documentURL = url
      }
      override fun onPageFinished(view: WebView, url: String) {
        if (!allowed(documentURL) || documentURL.isEmpty() || url != documentURL) return
        ready = true
        onDocument(mapOf("state" to "ready", "documentId" to documentId, "documentURL" to documentURL))
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) { if (request.isForMainFrame) fail("Document load failed; reload to retry.") }
      override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) { if (request.isForMainFrame) fail("Document returned an HTTP error.") }
      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { handler.cancel(); fail("TLS validation failed.") }
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { invalidateDocument(); fail("Web content process stopped; reload to reconnect."); return true }
    }
  }

  private fun allowed(raw: String): Boolean {
    return try {
      val url = Uri.parse(raw); val base = Uri.parse(scope)
      val path = url.encodedPath ?: "/"; val prefix = base.encodedPath ?: "/"
      raw.length <= 4096 && !raw.contains('\\') && !Regex("%2f|%5c|%2e|%25", RegexOption.IGNORE_CASE).containsMatchIn(path) &&
        url.scheme == "https" && url.userInfo == null && url.host == base.host && url.port == base.port && base.scheme == "https" && prefix.endsWith('/') &&
        (path == prefix.dropLast(1) || path.startsWith(prefix))
    } catch (_: Exception) { false }
  }

  fun loadEntry() {
    if (entry == loadedEntry || scope.isEmpty()) return
    loadedEntry = entry
    invalidateDocument()
    if (!allowed(entry)) { fail("Entry is outside the HTTPS deployment."); return }
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { fail("Update Android System WebView: origin-aware messaging is required."); return }
    if (!listenerInstalled) {
      val base = Uri.parse(scope)
      val origin = "https://${base.host}" + if (base.port >= 0) ":${base.port}" else ""
      // Unlike addJavascriptInterface, AndroidX reports native source origin and
      // main-frame identity. There is deliberately no insecure fallback.
      WebViewCompat.addWebMessageListener(web, "companion", setOf(origin)) { _, message, sourceOrigin, isMainFrame, _ ->
        val data = message.data
        val expected = Uri.parse(documentURL)
        if (ready && isMainFrame && allowed(documentURL) && sourceOrigin.scheme == "https" && sourceOrigin.host == expected.host && sourceOrigin.port == expected.port && data != null && data.toByteArray(Charsets.UTF_8).size <= 16384) {
          onMessage(mapOf("documentId" to documentId, "documentURL" to documentURL, "isMainFrame" to true, "data" to data))
        }
      }
      listenerInstalled = true
    }
    web.loadUrl(entry)
  }

  private fun invalidateDocument() {
    ready = false; documentId = UUID.randomUUID().toString(); documentURL = ""
    onDocument(mapOf("state" to "loading", "documentId" to documentId, "documentURL" to ""))
  }
  private fun fail(message: String) {
    ready = false; documentId = UUID.randomUUID().toString(); documentURL = ""
    onDocument(mapOf("state" to "error", "documentId" to documentId, "documentURL" to "", "message" to message))
  }
  fun runBound(input: String) {
    if (!ready || input.isEmpty()) return
    try {
      val data = JSONObject(input)
      if (data.getString("documentId") == documentId) web.evaluateJavascript(data.getString("script"), null)
    } catch (_: Exception) { /* Prop updates from a stale/unmounted view fail closed. */ }
  }
  fun dispose() {
    ready = false
    if (listenerInstalled) WebViewCompat.removeWebMessageListener(web, "companion")
    web.stopLoading(); web.destroy()
  }
}
