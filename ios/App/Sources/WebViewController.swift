import UIKit
import WebKit

/// ตัวแอปทั้งหมดคือ WKWebView เต็มจอที่เปิดเว็บ AmPayPay
/// อัปเดตเว็บเมื่อไหร่แอปได้ของใหม่ทันที ไม่ต้องส่งบิลด์ใหม่ขึ้น TestFlight
final class WebViewController: UIViewController {

    /// เปลี่ยนที่เดียวถ้าย้ายโดเมน
    static let siteURL = URL(string: "https://ampaypay.onrender.com/")!

    private var webView: WKWebView!
    private var offlineView: UIStackView!
    private let refresh = UIRefreshControl()

    // MARK: - ตั้งค่า

    override func loadView() {
        let container = UIView()
        container.backgroundColor = UIColor(named: "LaunchBackground")

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()                        // localStorage/IndexedDB อยู่ต่อหลังปิดแอป
        config.allowsInlineMediaPlayback = true                     // กล้องต้องเล่นในหน้า ไม่ใช่เต็มจอ
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never  // ให้ CSS env(safe-area-inset-*) จัดการเอง
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.scrollView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor)
        ])
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        refresh.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        buildOfflineView()
        loadSite()
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        traitCollection.userInterfaceStyle == .dark ? .lightContent : .darkContent
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        if previous?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    // MARK: - โหลดหน้าเว็บ

    @objc private func loadSite() {
        offlineView.isHidden = true
        webView.load(URLRequest(url: Self.siteURL))
    }

    @objc private func pullToRefresh() {
        webView.reload()
    }

    /// กลับเข้าแอปแล้วยังไม่มีหน้าอะไรเลย (ครั้งแรกโหลดไม่ผ่าน) ให้ลองใหม่ให้เอง
    @objc private func appBecameActive() {
        if webView.url == nil { loadSite() }
    }

    // MARK: - หน้าจอตอนเปิดเว็บไม่สำเร็จ

    private func buildOfflineView() {
        let title = UILabel()
        title.text = "เปิดหน้าแอปไม่สำเร็จ"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textAlignment = .center

        let detail = UILabel()
        detail.text = "ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง"
        detail.font = .preferredFont(forTextStyle: .subheadline)
        detail.textColor = .secondaryLabel
        detail.numberOfLines = 0
        detail.textAlignment = .center

        let button = UIButton(type: .system)
        button.setTitle("ลองใหม่", for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.addTarget(self, action: #selector(loadSite), for: .touchUpInside)

        offlineView = UIStackView(arrangedSubviews: [title, detail, button])
        offlineView.axis = .vertical
        offlineView.spacing = 12
        offlineView.alignment = .center
        offlineView.isHidden = true
        offlineView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(offlineView)
        NSLayoutConstraint.activate([
            offlineView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            offlineView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            offlineView.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            offlineView.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32)
        ])
    }

    private func showOffline() {
        /* service worker แคชหน้าแอปไว้ ถ้าเคยเปิดสำเร็จมาก่อนจะยังเปิดได้ทั้งที่ไม่มีเน็ต
           จึงขึ้นหน้านี้เฉพาะตอนที่ยังไม่มีอะไรให้แสดงจริง ๆ */
        guard webView.url == nil else { return }
        offlineView.isHidden = false
        view.bringSubviewToFront(offlineView)
    }
}

// MARK: - ลิงก์ไหนเปิดที่ไหน

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }

        // mailto: / tel: / sms: ส่งต่อให้แอปของระบบ
        if let scheme = url.scheme?.lowercased(), ["mailto", "tel", "sms", "facetime"].contains(scheme) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        // เว็บนอกโดเมนเรา เปิดใน Safari จะได้ไม่พาผู้ใช้หลุดออกจากแอปไปเลย
        if let host = url.host, host != Self.siteURL.host,
           url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refresh.endRefreshing()
        offlineView.isHidden = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        refresh.endRefreshing()
        showOffline()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        refresh.endRefreshing()
        showOffline()
    }
}

// MARK: - กล้อง, alert/confirm/prompt, หน้าต่างใหม่

extension WebViewController: WKUIDelegate {

    /// ผู้ใช้กดปุ่มกล้องในแอปแล้วต้องได้กล้องจริง (iOS ถามสิทธิ์ระดับระบบให้เองอีกชั้น)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == Self.siteURL.host ? .grant : .deny)
    }

    /// target="_blank" ให้เปิดในหน้าเดิม ไม่งั้นกดแล้วเงียบ
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if url.host == Self.siteURL.host {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    /* WKWebView ไม่แสดง alert/confirm/prompt ให้เอง ต้องต่อเองทั้งสามตัว
       แอปใช้ prompt() ตอนพิมพ์ข้อความถึงเพื่อน และ confirm() ตอนเคลียร์ยอด */

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "ตกลง", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "ยกเลิก", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "ตกลง", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "ยกเลิก", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "ตกลง", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        })
        present(alert, animated: true)
    }
}
