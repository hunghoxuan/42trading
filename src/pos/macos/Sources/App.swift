import AppKit
import WebKit
import AVFoundation
import UniformTypeIdentifiers

@main
@MainActor
struct PosMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = PosApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

@MainActor
final class PosApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    private let trusted = try! TrustedOrigin(Bundle.main.object(forInfoDictionaryKey: "POSServerURL") as? String
        ?? "https://hunghx.tail02c7f8.ts.net:8443/admin/pos")
    private var window: NSWindow!
    private var web: WKWebView!
    private var errorPanel: NSStackView!
    private var printWeb: WKWebView?
    private var exitApproved = false
    private var destinations: [ObjectIdentifier: (temporary: URL, destination: URL)] = [:]
    private var activeDownloads: [ObjectIdentifier: WKDownload] = [:]
    private let maxFileBytes = 20 * 1024 * 1024

    func applicationDidFinishLaunching(_ notification: Notification) {
        makeMenu()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.mediaTypesRequiringUserActionForPlayback = []
        let controller = WKUserContentController()
        controller.add(self, name: "posNative")
        let originJSON = String(data: try! JSONSerialization.data(withJSONObject: [trusted.origin]), encoding: .utf8)!
        // Same message contract as Android; no changes to the POS web host are required.
        controller.addUserScript(WKUserScript(source: """
        if (location.origin === \(originJSON)[0]) {
          Object.defineProperty(window, 'PosAndroid', {value: Object.freeze({postMessage: function(value) {
            window.webkit.messageHandlers.posNative.postMessage(value);
          }}), writable: false});
        }
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = controller
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.customUserAgent = nil
        web.allowsBackForwardNavigationGestures = true
        web.underPageBackgroundColor = .clear
        if #available(macOS 13.3, *) { web.isInspectable = false }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "42Trade POS"
        window.minSize = NSSize(width: 420, height: 600)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.backgroundColor = NSColor(red: 16 / 255, green: 24 / 255, blue: 32 / 255, alpha: 1)
        let root = NSView()
        window.contentView = root
        web.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor), web.topAnchor.constraint(equalTo: root.topAnchor),
            web.bottomAnchor.constraint(equalTo: root.bottomAnchor)])
        let label = NSTextField(wrappingLabelWithString: "Chưa kết nối được POS. Bật Tailscale trên máy này, kiểm tra Mac mini và kết nối mạng, rồi thử lại.")
        label.alignment = .center
        label.textColor = .white
        label.font = .systemFont(ofSize: 17)
        let retry = NSButton(title: "Thử kết nối lại", target: self, action: #selector(reloadPOS))
        retry.bezelStyle = .rounded
        errorPanel = NSStackView(views: [label, retry])
        errorPanel.orientation = .vertical
        errorPanel.spacing = 20
        errorPanel.translatesAutoresizingMaskIntoConstraints = false
        errorPanel.isHidden = true
        root.addSubview(errorPanel)
        NSLayoutConstraint.activate([errorPanel.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            errorPanel.centerYAnchor.constraint(equalTo: root.centerYAnchor), errorPanel.widthAnchor.constraint(lessThanOrEqualToConstant: 500),
            errorPanel.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: 24),
            errorPanel.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -24)])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.load(URLRequest(url: trusted.url))
    }

    private func makeMenu() {
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Giới thiệu 42Trade POS", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Thoát 42Trade POS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem(); appItem.submenu = appMenu; menu.addItem(appItem)
        let edit = NSMenu(title: "Sửa")
        for (title, selector, key) in [("Hoàn tác", "undo:", "z"), ("Cắt", "cut:", "x"), ("Sao chép", "copy:", "c"), ("Dán", "paste:", "v"), ("Chọn tất cả", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let editItem = NSMenuItem(); editItem.submenu = edit; menu.addItem(editItem)
        let view = NSMenu(title: "Xem")
        let reload = view.addItem(withTitle: "Tải lại POS", action: #selector(reloadPOS), keyEquivalent: "r"); reload.target = self
        let back = view.addItem(withTitle: "Quay lại", action: #selector(goBack), keyEquivalent: "["); back.target = self
        let browser = view.addItem(withTitle: "Mở POS trên trình duyệt", action: #selector(openBrowser), keyEquivalent: ""); browser.target = self
        let viewItem = NSMenuItem(); viewItem.submenu = view; menu.addItem(viewItem)
        NSApp.mainMenu = menu
    }

    @objc private func reloadPOS() {
        errorPanel.isHidden = true
        web.isHidden = false
        web.load(URLRequest(url: trusted.allows(web.url) ? web.url! : trusted.url))
    }
    @objc private func goBack() { if web.canGoBack { web.goBack() } }
    @objc private func openBrowser() { NSWorkspace.shared.open(trusted.url) }

    private func showConnectionError(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        web.isHidden = true
        errorPanel.isHidden = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === web { showConnectionError(error) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === web { showConnectionError(error) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === web { showConnectionError(NSError(domain: "POS", code: 1)) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if webView === printWeb {
            decisionHandler(url.absoluteString == "about:blank" ? .allow : .cancel)
            return
        }
        if trusted.allows(url) {
            if action.shouldPerformDownload { decisionHandler(.download) }
            else if action.targetFrame == nil { web.load(action.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
            return
        }
        // The print/export helpers can create local blob documents on our trusted page.
        if url.scheme == "blob", trusted.allows(URL(string: String(url.absoluteString.dropFirst(5)))) {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
            return
        }
        if action.navigationType == .linkActivated, action.targetFrame?.isMainFrame != false,
           ["https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if webView === printWeb { decisionHandler(.allow); return }
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
            decisionHandler(.cancel)
            showConnectionError(NSError(domain: "POS", code: http.statusCode))
            return
        }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard trusted.allows(web.url) else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        guard webView === web, trusted.allows(web.url), type == .camera,
              trusted.allows(protocol: origin.protocol, host: origin.host, port: origin.port) else { decisionHandler(.deny); return }
        AVCaptureDevice.requestAccess(for: .video) { allowed in
            DispatchQueue.main.async { decisionHandler(allowed ? .grant : .deny) }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = "42Trade POS"; alert.informativeText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = "42Trade POS"; alert.informativeText = message
        alert.addButton(withTitle: "Đồng ý"); alert.addButton(withTitle: "Hủy")
        alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, trusted.allows(web.url),
              trusted.allows(protocol: origin.protocol, host: origin.host, port: origin.port),
              let raw = message.body as? String, raw.utf8.count <= maxFileBytes * 4 / 3 + 4096,
              let json = raw.data(using: .utf8), let data = try? JSONSerialization.jsonObject(with: json) as? [String: String] else { return }
        if data["type"] == "print", let html = data["html"], html.utf8.count <= 2 * 1024 * 1024 { printInvoice(html) }
        else if data["type"] == "saveFile", let base64 = data["base64"],
                let bytes = Data(base64Encoded: base64), bytes.count <= maxFileBytes {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = TrustedOrigin.safeFilename(data["filename"] ?? "pos-export.xlsx")
            panel.canCreateDirectories = true
            panel.beginSheetModal(for: window) { result in
                guard result == .OK, let url = panel.url else { return }
                do { try bytes.write(to: url, options: .atomic) }
                catch { self.showError("Không lưu được tệp.", error.localizedDescription) }
            }
        }
    }

    private func printInvoice(_ html: String) {
        guard printWeb == nil else { return }
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        let printView = WKWebView(frame: NSRect(x: 0, y: 0, width: 320, height: 600), configuration: config)
        printView.navigationDelegate = self
        printWeb = printView
        printView.loadHTMLString(html, baseURL: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === printWeb {
            let info = NSPrintInfo.shared.copy() as! NSPrintInfo
            let operation = webView.printOperation(with: info)
            operation.showsPrintPanel = true
            operation.showsProgressPanel = true
            operation.runModal(for: window, delegate: self,
                didRun: #selector(printFinished(_:success:contextInfo:)), contextInfo: nil)
        }
    }

    @objc private func printFinished(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        printWeb = nil
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { register(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { register(download) }
    private func register(_ download: WKDownload) {
        activeDownloads[ObjectIdentifier(download)] = download
        download.delegate = self
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = TrustedOrigin.safeFilename(suggestedFilename)
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let destination = panel.url else {
                self.activeDownloads.removeValue(forKey: ObjectIdentifier(download)); completionHandler(nil); return
            }
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            self.destinations[ObjectIdentifier(download)] = (temporary, destination)
            completionHandler(temporary)
        }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(trusted.allows(request.url) ? .allow : .cancel)
    }
    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        activeDownloads.removeValue(forKey: key)
        guard let paths = destinations.removeValue(forKey: key) else { return }
        do {
            if FileManager.default.fileExists(atPath: paths.destination.path) {
                _ = try FileManager.default.replaceItemAt(paths.destination, withItemAt: paths.temporary)
            } else { try FileManager.default.moveItem(at: paths.temporary, to: paths.destination) }
        } catch { showError("Không lưu được tệp tải về.", error.localizedDescription) }
        try? FileManager.default.removeItem(at: paths.temporary)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        activeDownloads.removeValue(forKey: key)
        if let paths = destinations.removeValue(forKey: key) { try? FileManager.default.removeItem(at: paths.temporary) }
        if (error as NSError).code != NSURLErrorCancelled { showError("Không tải được tệp.", error.localizedDescription) }
    }

    private func showError(_ title: String, _ detail: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = detail
        alert.beginSheetModal(for: window)
    }
    private func approveExit() -> Bool {
        if exitApproved { return true }
        let alert = NSAlert(); alert.messageText = "Đóng POS?"
        alert.informativeText = "Hãy hoàn tất hoặc lưu giao dịch đang mở trước khi thoát."
        alert.addButton(withTitle: "Ở lại"); alert.addButton(withTitle: "Đóng POS")
        exitApproved = alert.runModal() == .alertSecondButtonReturn
        return exitApproved
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { approveExit() }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { approveExit() ? .terminateNow : .terminateCancel }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); return true
    }
}
