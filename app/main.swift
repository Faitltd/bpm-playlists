import Cocoa
import WebKit

// Bridge between the Svelte UI and macOS.
// UI sends: window.webkit.messageHandlers.bridge.postMessage({ id, cmd, args })
// App replies: window.__bridgeReply(id, { ok, data | error })
final class Bridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    let backendPath: String
    let defaultsKey = "settings"

    init(backendPath: String) {
        self.backendPath = backendPath
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let cmd = body["cmd"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]

        DispatchQueue.global(qos: .userInitiated).async {
            var reply: [String: Any]
            do {
                reply = ["ok": true, "data": try self.handle(cmd: cmd, args: args)]
            } catch {
                reply = ["ok": false, "error": error.localizedDescription]
            }
            DispatchQueue.main.async { self.send(id: id, reply: reply) }
        }
    }

    private func send(id: Int, reply: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: reply, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__bridgeReply(\(id), \(json));", completionHandler: nil)
    }

    private func handle(cmd: String, args: [String: Any]) throws -> Any {
        switch cmd {
        case "music":
            let op = args["op"] as? String ?? ""
            let data = args["data"] ?? [String: Any]()
            return try runBackend(op: op, data: data)
        case "http":
            guard let url = args["url"] as? String else { throw BridgeError("Missing URL") }
            return try httpGet(url)
        case "open":
            guard let s = args["url"] as? String, let url = URL(string: s) else { throw BridgeError("Bad URL") }
            DispatchQueue.main.async { NSWorkspace.shared.open(url) }
            return true
        case "getSettings":
            return UserDefaults.standard.string(forKey: defaultsKey) ?? "{}"
        case "setSettings":
            let s = args["json"] as? String ?? "{}"
            UserDefaults.standard.set(s, forKey: defaultsKey)
            return true
        case "analyze":
            // Download a preview clip and get audio features from ReccoBeats (free, no key).
            guard let s = args["url"] as? String, let url = URL(string: s) else { throw BridgeError("Bad URL") }
            let audio = try download(url)
            return try reccobeats(audio)
        case "loadStore":
            guard let d = try? Data(contentsOf: storeURL()), let s = String(data: d, encoding: .utf8) else { return "{}" }
            return s
        case "saveStore":
            let s = args["json"] as? String ?? "{}"
            let p = storeURL()
            try FileManager.default.createDirectory(at: p.deletingLastPathComponent(), withIntermediateDirectories: true)
            try (s.data(using: .utf8) ?? Data()).write(to: p, options: .atomic)
            return true
        default:
            throw BridgeError("Unknown command: \(cmd)")
        }
    }

    private func runBackend(op: String, data: Any) throws -> Any {
        let argData = try JSONSerialization.data(withJSONObject: data, options: [.fragmentsAllowed])
        let argJSON = String(data: argData, encoding: .utf8) ?? "{}"

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-l", "JavaScript", backendPath, op, argJSON]
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()

        if p.terminationStatus != 0 {
            var msg = String(data: errData, encoding: .utf8) ?? "Music script failed"
            if let r = msg.range(of: "Error: ") { msg = String(msg[r.upperBound...]) }
            msg = msg.trimmingCharacters(in: .whitespacesAndNewlines)
            if msg.contains("-1743") || msg.contains("Not authorized") {
                msg = "BPM Playlists needs permission to control Music. Open System Settings > Privacy & Security > Automation and turn on Music under BPM Playlists."
            }
            throw BridgeError(msg)
        }
        let text = (String(data: outData, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let json = text.data(using: .utf8) else { return NSNull() }
        return try JSONSerialization.jsonObject(with: json, options: [.fragmentsAllowed])
    }

    private func storeURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("BPM Playlists").appendingPathComponent("analysis.json")
    }

    private func send(_ req: URLRequest) throws -> (Int, Data, HTTPURLResponse?) {
        let sem = DispatchSemaphore(value: 0)
        var result: (Data?, URLResponse?, Error?) = (nil, nil, nil)
        URLSession.shared.dataTask(with: req) { d, r, e in
            result = (d, r, e)
            sem.signal()
        }.resume()
        sem.wait()
        if let e = result.2 { throw e }
        let http = result.1 as? HTTPURLResponse
        return (http?.statusCode ?? 0, result.0 ?? Data(), http)
    }

    private func httpGet(_ urlString: String) throws -> Any {
        guard let url = URL(string: urlString) else { throw BridgeError("Bad URL") }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue("BPMPlaylists/1.0 (+https://github.com/Faitltd/bpm-playlists)", forHTTPHeaderField: "User-Agent")
        let (status, data, _) = try send(req)
        return ["status": status, "body": String(data: data, encoding: .utf8) ?? ""]
    }

    private func download(_ url: URL) throws -> Data {
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.setValue("BPMPlaylists/1.0", forHTTPHeaderField: "User-Agent")
        let (status, data, _) = try send(req)
        guard status == 200, data.count > 1000 else { throw BridgeError("Could not download preview (\(status)).") }
        guard data.count < 5_000_000 else { throw BridgeError("Preview too large.") }
        return data
    }

    private func reccobeats(_ audio: Data) throws -> Any {
        let boundary = "----BPMPlaylists\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audioFile\"; filename=\"preview.mp3\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/mpeg\r\n\r\n".data(using: .utf8)!)
        body.append(audio)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var attempt = 0
        while true {
            attempt += 1
            var req = URLRequest(url: URL(string: "https://api.reccobeats.com/v1/analysis/audio-features")!, timeoutInterval: 90)
            req.httpMethod = "POST"
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.setValue("BPMPlaylists/1.0 (+https://github.com/Faitltd/bpm-playlists)", forHTTPHeaderField: "User-Agent")
            req.httpBody = body
            let (status, data, http) = try send(req)
            if status == 200 {
                return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            }
            if (status == 429 || status >= 500) && attempt < 4 {
                let retry = Double(http?.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 3
                Thread.sleep(forTimeInterval: min(max(retry, 1), 15))
                continue
            }
            let msg = String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw BridgeError("Analysis service returned \(status). \(msg)")
        }
    }
}

struct BridgeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var bridge: Bridge!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let res = Bundle.main.resourceURL!
        bridge = Bridge(backendPath: res.appendingPathComponent("backend.js").path)

        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "bridge")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        bridge.webView = webView

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "BPM Playlists"
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MainWindow")
        window.makeKeyAndOrderFront(nil)

        webView.loadFileURL(res.appendingPathComponent("index.html"), allowingReadAccessTo: res)
        buildMenu()
        NSApp.activate(ignoringOtherApps: true)
    }

    // Open external links (target=_blank or http links) in the default app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme != "file", action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About BPM Playlists", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide BPM Playlists", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit BPM Playlists", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = winMenu
        main.addItem(winItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = winMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
