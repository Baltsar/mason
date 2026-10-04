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

let excluded = Set((input["excludedApps"] as? [String]) ?? [])
let appName = String((front.localizedName ?? bundle).prefix(80))
if excluded.contains(bundle) {
    emit(["status": "excluded", "app": appName, "bundle": bundle])
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
let defaultPrivateTitleWords = [
    "incognito", "private browsing", "privat surf", "inprivate", "lösenord", "password",
    "gmail", "outlook", "mail", "slack", "messages", "meddelanden", "whatsapp", "signal", "telegram", "discord"
]
let privateTitleWords = (input["privateTitleWords"] as? [String]) ?? defaultPrivateTitleWords
if privateTitleWords.contains(where: rawTitle.lowercased().contains) {
    emit(["status": "excluded", "app": appName, "bundle": bundle])
    exit(0)
}

var result: [String: Any] = [
    "status": "reading",
    "app": appName,
    "bundle": bundle,
    "window": String(rawTitle.prefix(240)),
    "pid": Int(front.processIdentifier),
]

let lowerTitle = rawTitle.lowercased()
let promptApps: Set<String> = ["com.openai.codex", "com.openai.chat", "com.anthropic.claudefordesktop", "com.todesktop.230313mzl4w4u92", "com.todesktop.230313mzl4w4u92.helper"]
let promptWords = ["chatgpt", "claude", "codex", "gemini", "grok", "muse", "lovable", "cursor", "windsurf", "copilot"]
let promptSurface = promptApps.contains(bundle) || promptWords.contains(where: lowerTitle.contains)
result["promptSurface"] = promptSurface

let idleTypes: [CGEventType] = [.keyDown, .mouseMoved, .leftMouseDown, .rightMouseDown, .scrollWheel]
let idleSeconds = idleTypes.map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }.min() ?? 0
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
