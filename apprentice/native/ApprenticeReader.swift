import AppKit
import ApplicationServices
import CryptoKit

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func element(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

let input = (try? JSONSerialization.jsonObject(with: Data((readLine() ?? "{}").utf8))) as? [String: Any] ?? [:]
let shouldPrompt = input["prompt"] as? Bool == true
let trusted = shouldPrompt
    ? AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    : AXIsProcessTrusted()

guard trusted else {
    emit(["status": "permission"])
    exit(0)
}

guard let front = NSWorkspace.shared.frontmostApplication,
      let bundle = front.bundleIdentifier else {
    emit(["status": "unavailable"])
    exit(0)
}

// How long the hands have been still. It says nothing about what is on screen,
// so it is known for a private surface too.
let idleTypes: [CGEventType] = [.keyDown, .mouseMoved, .leftMouseDown, .rightMouseDown, .scrollWheel]
let idleSeconds = idleTypes.map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }.min() ?? 0

let excluded = Set((input["excludedApps"] as? [String]) ?? [])
let appName = String((front.localizedName ?? bundle).prefix(80))
if excluded.contains(bundle) {
    emit(["status": "excluded", "app": appName, "bundle": bundle, "idleSeconds": idleSeconds])
    exit(0)
}

let app = AXUIElementCreateApplication(front.processIdentifier)
AXUIElementSetMessagingTimeout(app, 0.18)
// Full accessibility makes Chromium and Electron apps build their whole tree,
// which is expensive. The collector asks for it once per process, and only for
// an app where a prompt can be read. Window titles never need it.
if input["enhance"] as? Bool == true {
    if AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue) != .success {
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }
}

guard let window = element(attribute(app, "AXFocusedWindow")) else {
    emit(["status": "waiting", "app": appName, "bundle": bundle])
    exit(0)
}

let rawTitle = attribute(window, "AXTitle") as? String ?? ""
// The site in a browser's front tab, as its host only ("figma.com"): never the
// path or the query, which can say what was read or searched for. A window
// that is not a page on the web has none.
var host = ""
if let document = attribute(window, "AXDocument") {
    let url = (document as? URL) ?? (document as? String).flatMap { URL(string: $0) }
    if let url, let name = url.host, url.scheme == "http" || url.scheme == "https" {
        host = name.lowercased() + (url.port.map { ":\($0)" } ?? "")
    }
}
let defaultPrivateTitleWords = [
    "incognito", "private browsing", "privat surf", "inprivate", "lösenord", "password",
    "gmail", "outlook", "mail", "slack", "messages", "meddelanden", "whatsapp", "signal", "telegram", "discord"
]
let privateTitleWords = (input["privateTitleWords"] as? [String]) ?? defaultPrivateTitleWords
let lowerTitle = rawTitle.lowercased()
// A private word in the address is as private as one in the title.
let privateHits = privateTitleWords.filter { lowerTitle.contains($0) || host.contains($0) }
if !privateHits.isEmpty {
    var refusal: [String: Any] = ["status": "excluded", "app": appName, "bundle": bundle, "idleSeconds": idleSeconds]
    // A chat or mail tab may be named, never read, and only when the collector
    // asks for it: pairs of a word and the service it stands for. The service
    // is known by its address ("discord.com") or, failing that, by being a
    // whole part of the title, as in "Discord | #general". Nothing else in the
    // title or the address may be private. Neither of them leaves this program.
    let named = ((input["namedTitleWords"] as? [[String]]) ?? []).filter { $0.count == 2 }
    let sites = ((input["namedHosts"] as? [[String]]) ?? []).filter { $0.count == 2 }
    if privateHits.allSatisfy({ hit in named.contains { $0[0] == hit } }) {
        let parts = lowerTitle
            .replacingOccurrences(of: #"\s+[-|/·–—]\s+"#, with: "\n", options: .regularExpression)
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: #"^(\(\d+\+?\)|[•*!])\s*"#, with: "", options: .regularExpression) }
        if let site = sites.first(where: { host == $0[0] || host.hasSuffix("." + $0[0]) }) { refusal["service"] = site[1] }
        else if let pair = named.first(where: { parts.contains($0[0]) }) { refusal["service"] = pair[1] }
    }
    emit(refusal)
    exit(0)
}

var result: [String: Any] = [
    "status": "reading",
    "app": appName,
    "bundle": bundle,
    "window": String(rawTitle.prefix(240)),
    "pid": Int(front.processIdentifier),
]
if !host.isEmpty { result["host"] = String(host.prefix(120)) }

let promptApps: Set<String> = ["com.openai.codex", "com.openai.chat", "com.anthropic.claudefordesktop", "com.todesktop.230313mzl4w4u92", "com.todesktop.230313mzl4w4u92.helper"]
let promptWords = ["chatgpt", "claude", "codex", "gemini", "grok", "muse", "lovable", "cursor", "windsurf", "copilot"]
let promptSurface = promptApps.contains(bundle) || promptWords.contains(where: lowerTitle.contains)
result["promptSurface"] = promptSurface

result["idleSeconds"] = idleSeconds

if let focused = element(attribute(app, "AXFocusedUIElement")) {
    let role = attribute(focused, "AXRole") as? String ?? ""
    let subrole = attribute(focused, "AXSubrole") as? String ?? ""
    let allowedRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
    let secure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
    result["focusedRole"] = role
    if allowedRoles.contains(role) && !secure && promptSurface {
        let value = attribute(focused, "AXValue") as? String ?? ""
        if !value.isEmpty && value.count <= 8000 {
            result["focusedText"] = value
            let digest = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
            result["focusedHash"] = digest
        }
    }
}

emit(result)
