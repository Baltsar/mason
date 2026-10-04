import AppKit
import WebKit

// Apprentice on the desktop, in three stages:
//   1. the island that hangs from the top of the screen, beside the notch,
//   2. the drop panel with today's numbers in large type,
//   3. the app window with Capture, Map and Teach.
// The island is glass and lives inside the menu bar: it never reaches down over
// a window. It grows to the left of the notch, into the part of the menu bar
// the app in front leaves free, and never over a menu. To the right of the
// notch sits only the eye: one small symbol for whether it is looking. Nothing here animates continuously, so a small still pane of glass
// on top of everything costs next to nothing to draw.

// Opened by a double-click, the app is the whole of Apprentice: it starts the
// local server itself and stops it when it quits. Started by the server (the
// old command file), it is handed the address and only shows what it is told.
let standalone = ProcessInfo.processInfo.environment["APPRENTICE_URL"] == nil
let port = ProcessInfo.processInfo.environment["PORT"] ?? "4317"
let baseURL = ProcessInfo.processInfo.environment["APPRENTICE_URL"] ?? "http://127.0.0.1:\(port)"

enum Palette {
    static let ink = NSColor(srgbRed: 0.043, green: 0.043, blue: 0.047, alpha: 1)
    static let lime = NSColor(srgbRed: 0.843, green: 1.0, blue: 0.259, alpha: 1)
    static let violet = NSColor(srgbRed: 0.663, green: 0.545, blue: 1.0, alpha: 1)
    static let red = NSColor(srgbRed: 1.0, green: 0.42, blue: 0.373, alpha: 1)
    static let grey = NSColor(white: 0.46, alpha: 1)
}

struct IslandState: Equatable {
    var status = "starting"
    var app = ""
    var category = ""
    var work = 0
    var social = 0
    var other = 0
    var totalSeconds = 0
    var question = ""
    var questionId = ""
    var project = ""
    var debriefReady = false
    var returning = ""
    // Goes up each time something new on screen was taken in.
    var seen = 0
    // Something is being worked out right now: a summary, an episode.
    var busy = false
}

// The eye: whether Apprentice is looking, in one small symbol. It blinks now
// and then while it watches, sends out one ripple each time it takes in
// something new on screen, turns while it is working something out, and is
// shut while it looks away. Nothing moves between those moments.
final class EyeView: NSView {
    enum Look { case watching, away, blind, resting }

    private let eye = CALayer()
    private let ring = CAShapeLayer()
    private let pupil = CAShapeLayer()
    private let ripple = CAShapeLayer()
    private let lid = CAShapeLayer()
    private var blinkTimer: Timer?
    private var look = Look.resting
    private var tone = Palette.grey
    private var thinking = false
    private var still: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        let side: CGFloat = 16
        let box = CGRect(x: 0, y: 0, width: side, height: side)
        eye.bounds = box
        for shape in [ripple, ring, pupil, lid] {
            shape.frame = box
            shape.fillColor = nil
            shape.lineWidth = 2
            shape.lineCap = .round
            eye.addSublayer(shape)
        }
        let circle = CGPath(ellipseIn: box.insetBy(dx: 2.5, dy: 2.5), transform: nil)
        ring.path = circle
        ripple.path = circle
        ripple.lineWidth = 1.5
        ripple.opacity = 0
        pupil.path = CGPath(ellipseIn: box.insetBy(dx: 5.8, dy: 5.8), transform: nil)
        pupil.lineWidth = 0
        let line = CGMutablePath()
        line.move(to: CGPoint(x: 2, y: side / 2))
        line.addLine(to: CGPoint(x: side - 2, y: side / 2))
        lid.path = line
        lid.isHidden = true
        layer?.addSublayer(eye)
        paint()
    }

    required init?(coder: NSCoder) { nil }

    // A press here is a press on the island.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        eye.position = CGPoint(x: bounds.midX, y: bounds.midY)
        CATransaction.commit()
    }

    func show(_ next: Look, tone color: NSColor, thinking busy: Bool) {
        guard next != look || color != tone || busy != thinking else { return }
        look = next
        tone = color
        thinking = busy
        paint()
    }

    private func paint() {
        let turning = thinking && look == .watching
        let color = tone.cgColor
        ring.strokeColor = color
        ripple.strokeColor = color
        lid.strokeColor = color
        pupil.fillColor = color
        ring.isHidden = look == .away
        lid.isHidden = look != .away
        pupil.isHidden = look == .away || look == .blind || turning
        ring.lineDashPattern = look == .blind ? [2.2, 3.1] : nil
        ring.strokeEnd = turning ? 0.7 : 1
        ring.removeAnimation(forKey: "turn")
        if turning && !still {
            let turn = CABasicAnimation(keyPath: "transform.rotation.z")
            turn.fromValue = 0
            turn.toValue = -2 * Double.pi
            turn.duration = 0.9
            turn.repeatCount = .infinity
            ring.add(turn, forKey: "turn")
        }
        blinkTimer?.invalidate()
        blinkTimer = nil
        if look == .watching && !thinking && !still { waitToBlink() }
    }

    private func waitToBlink() {
        let timer = Timer(timeInterval: .random(in: 4.5...8), repeats: false) { [weak self] _ in
            guard let self, self.look == .watching, !self.thinking else { return }
            let shut = CAKeyframeAnimation(keyPath: "transform.scale.y")
            shut.values = [1, 0.12, 1]
            shut.keyTimes = [0, 0.45, 1]
            shut.duration = 0.24
            self.eye.add(shut, forKey: "blink")
            self.waitToBlink()
        }
        timer.tolerance = 1
        RunLoop.main.add(timer, forMode: .common)
        blinkTimer = timer
    }

    // Something new on screen was taken in: one ripple, then still again.
    func saw() {
        guard look == .watching, !still else { return }
        let grow = CABasicAnimation(keyPath: "transform.scale")
        grow.fromValue = 1
        grow.toValue = 2.1
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.85
        fade.toValue = 0
        let pulse = CAAnimationGroup()
        pulse.animations = [grow, fade]
        pulse.duration = 0.65
        pulse.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ripple.add(pulse, forKey: "ripple")
    }
}

final class IslandView: NSView {
    var state = IslandState() { didSet { if state != oldValue { needsDisplay = true } } }
    var hint = "" { didSet { needsDisplay = true } }
    var barHeight: CGFloat = 32
    var notchWidth: CGFloat = 0
    var onPress: () -> Void = {}
    var onMenu: (NSEvent) -> Void = { _ in }

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onPress() }
    override func rightMouseDown(with event: NSEvent) { onMenu(event) }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        needsDisplay = true
    }

    var tone: NSColor {
        switch state.status {
        case "watching": return state.category == "Social" ? Palette.red : Palette.lime
        case "private", "private-surface", "paused": return Palette.violet
        case "permission": return NSColor.systemOrange
        default: return Palette.grey
        }
    }

    var look: EyeView.Look {
        switch state.status {
        case "watching": return .watching
        case "private", "private-surface", "paused": return .away
        case "permission": return .blind
        default: return .resting
        }
    }

    private var figure: (text: String, color: NSColor) {
        switch state.status {
        case "private", "paused": return ("private", Palette.violet)
        case "permission": return ("access", NSColor.systemOrange)
        default: return state.totalSeconds > 0 ? ("\(state.work)%", Palette.lime) : ("–", Palette.grey)
        }
    }

    // The right end of the view that the row leaves alone: the notch and the eye.
    var trailing: CGFloat = 0
    // What the free part of the menu bar has room for.
    enum Detail { case all, figure, mark, nothing }
    private(set) var shows = Detail.all

    private let edge: CGFloat = 13, markWidth: CGFloat = 13, extraWidth: CGFloat = 22, gap: CGFloat = 14
    // The mark: always there.
    private var lead: CGFloat { edge + markWidth }
    private var hasExtra: Bool { !state.question.isEmpty || state.debriefReady || (state.totalSeconds > 0 && figure.color == Palette.lime) }

    private var label: NSAttributedString {
        let showsWord = !hint.isEmpty
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        return NSAttributedString(string: showsWord ? hint : figure.text, attributes: [
            .font: showsWord ? NSFont.systemFont(ofSize: 12, weight: .semibold) : NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: showsWord ? NSColor(white: 1, alpha: 0.95) : figure.color,
            .paragraphStyle: style,
        ])
    }

    // The width the row takes when `room` is what is free. With less room than
    // it wants it gives up the small bar first, then cuts a word short, then
    // keeps only the mark, and with no room at all it is not there: a browser
    // with ten menus leaves only the eye.
    func fit(room: CGFloat) -> CGFloat {
        let showsWord = !hint.isEmpty
        let text = ceil(label.size().width)
        let plain = lead + gap + text + edge
        let full = plain + (showsWord || !hasExtra ? 0 : extraWidth + 7)
        let before = shows
        var width = lead + edge
        if full <= room { shows = .all; width = full }
        else if plain <= room { shows = .figure; width = plain }
        else if showsWord && room >= lead + gap + 40 + edge { shows = .figure; width = room }
        else if width <= room { shows = .mark }
        else { shows = .nothing; width = 0 }
        if shows != before { needsDisplay = true }
        return width.rounded()
    }

    override func draw(_ dirtyRect: NSRect) {
        let middle = barHeight / 2
        // The row ends where the notch begins.
        let visible = bounds.width - trailing
        guard shows != .nothing else { return }
        drawMark(x: edge, y: middle - 6.5)
        guard shows != .mark else { return }
        let text = label
        let size = text.size()
        let labelWidth = min(ceil(size.width), visible - edge - lead - gap)
        let labelX = visible - edge - labelWidth
        text.draw(with: NSRect(x: labelX, y: middle - size.height / 2, width: labelWidth, height: size.height), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        // While a word is shown the island holds only the word.
        guard hint.isEmpty, shows == .all else { return }
        if !state.question.isEmpty {
            let badge = NSRect(x: labelX - 7 - 15, y: middle - 7.5, width: 15, height: 15)
            Palette.violet.setFill()
            NSBezierPath(ovalIn: badge).fill()
            let mark = NSAttributedString(string: "?", attributes: [.font: NSFont.systemFont(ofSize: 10.5, weight: .bold), .foregroundColor: NSColor.black])
            let markSize = mark.size()
            mark.draw(at: NSPoint(x: badge.midX - markSize.width / 2, y: badge.midY - markSize.height / 2))
        } else if state.debriefReady {
            // A debrief is waiting: one small ring, nothing more.
            let ring = NSBezierPath(ovalIn: NSRect(x: labelX - 7 - 11, y: middle - 5.5, width: 11, height: 11).insetBy(dx: 1, dy: 1))
            ring.lineWidth = 2
            Palette.lime.setStroke()
            ring.stroke()
        } else if state.totalSeconds > 0 && figure.color == Palette.lime {
            drawSplit(in: NSRect(x: labelX - 7 - extraWidth, y: middle - 2, width: extraWidth, height: 4))
        }
    }

    private func drawMark(x: CGFloat, y: CGFloat) {
        let stroke = NSBezierPath()
        stroke.lineWidth = 2.6
        stroke.lineCapStyle = .round
        stroke.lineJoinStyle = .round
        stroke.move(to: NSPoint(x: x + 2, y: y + 1.5))
        stroke.line(to: NSPoint(x: x + 2, y: y + 11))
        stroke.line(to: NSPoint(x: x + 11.5, y: y + 11))
        Palette.lime.setStroke()
        stroke.stroke()
        Palette.violet.setFill()
        NSBezierPath(ovalIn: NSRect(x: x + 8.5, y: y, width: 4.5, height: 4.5)).fill()
    }

    private func drawSplit(in rect: NSRect) {
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(roundedRect: rect, xRadius: 2, yRadius: 2).addClip()
        var x = rect.minX
        for (share, color) in [(state.work, Palette.lime), (state.social, Palette.red), (state.other, Palette.grey)] {
            let part = rect.width * CGFloat(share) / 100
            color.setFill()
            NSRect(x: x, y: rect.minY, width: part, height: rect.height).fill()
            x += part
        }
        NSGraphicsContext.restoreGraphicsState()
    }
}

// The shape glass is cut to. Hanging from the top edge it is square above and
// round below; a panel or a pill is round all the way.
func glassMask(radius: CGFloat, hanging: Bool) -> NSImage {
    let side = radius * 2 + 2
    let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
        NSColor.black.setFill()
        if hanging {
            let path = NSBezierPath()
            path.move(to: NSPoint(x: 0, y: side))
            path.line(to: NSPoint(x: side, y: side))
            path.line(to: NSPoint(x: side, y: radius))
            path.appendArc(withCenter: NSPoint(x: side - radius, y: radius), radius: radius, startAngle: 0, endAngle: 270, clockwise: true)
            path.line(to: NSPoint(x: radius, y: 0))
            path.appendArc(withCenter: NSPoint(x: radius, y: radius), radius: radius, startAngle: 270, endAngle: 180, clockwise: true)
            path.close()
            path.fill()
        } else {
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
        }
        return true
    }
    image.capInsets = NSEdgeInsets(top: hanging ? 1 : radius, left: radius, bottom: radius, right: radius)
    image.resizingMode = .stretch
    return image
}

// A pane of dark glass. The tint keeps text readable when what is behind the
// glass is a white page; it is part of the pane, so the whole surface (a title
// bar included) has one tone.
func glass(frame: NSRect, radius: CGFloat, hanging: Bool = false, tint: CGFloat) -> NSVisualEffectView {
    let view = NSVisualEffectView(frame: frame)
    view.material = .hudWindow
    view.blendingMode = .behindWindow
    view.state = .active
    view.appearance = NSAppearance(named: .darkAqua)
    view.autoresizingMask = [.width, .height]
    view.wantsLayer = true
    if radius > 0 {
        view.maskImage = glassMask(radius: radius, hanging: hanging)
        view.layer?.cornerRadius = radius
        view.layer?.maskedCorners = hanging ? [.layerMinXMinYCorner, .layerMaxXMinYCorner] : [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
        view.layer?.masksToBounds = true
    }
    let shade = NSView(frame: view.bounds)
    shade.wantsLayer = true
    shade.layer?.backgroundColor = NSColor(srgbRed: 0.043, green: 0.043, blue: 0.047, alpha: tint).cgColor
    shade.autoresizingMask = [.width, .height]
    view.addSubview(shade)
    return view
}

final class DropPanel: NSPanel {
    // Key without activating the app: an answer can be typed without leaving the work.
    override var canBecomeKey: Bool { true }
}

final class PanelWebView: WKWebView {
    // The question panel is never the key window when it arrives. The first
    // press on the microphone must still count, not just wake the panel.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var island: NSPanel!
    private var islandView: IslandView!
    private var eyeView: EyeView!
    private let eyeWidth: CGFloat = 30
    private var drop: DropPanel?
    private var dropWeb: WKWebView?
    private var main: NSWindow?
    private var mainWeb: WKWebView?
    private var timer: Timer?
    private var hintWork: DispatchWorkItem?
    private var outsideMonitor: Any?
    private var keyMonitor: Any?
    private var failures = 0
    private var connected = false
    private var dropHeight: CGFloat = 500
    // "full" is today's numbers, opened from the island. "ask" is a question
    // that arrived by itself: it never takes the keyboard and leaves on a timer.
    private var dropMode = "full"
    private var askedId = ""
    // Whether the panel is meant to be on screen. It fades out for a moment
    // after it is put away, so its own visibility cannot answer that.
    private var dropShown = false
    private var dropGeneration = 0
    private var server: Process?
    private var serverStarts = 0
    private var quitting = false
    private var signals: [DispatchSourceSignal] = []
    // Where the menus of the app in front end, in points from the left of the
    // screen. Unknown until Accessibility is given.
    private var menusEdge: CGFloat?
    private var measuring = false
    private var loadRetries = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = appIcon()
        buildMenu()
        buildIsland()
        refresh()
        let poll = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in self?.refresh() }
        poll.tolerance = 0.5
        timer = poll
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        // Another app in front has other menus: the free part of the menu bar changes with it.
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in
            self?.measureMenus()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self?.measureMenus() }
        }
        measureMenus()
        setHint("Apprentice", for: 3)
        // The server nudges with USR1 the moment something changed, so a question
        // shows at once instead of at the next poll. USR2 opens the window.
        listen(SIGUSR1) { [weak self] in self?.refresh() }
        listen(SIGUSR2) { [weak self] in self?.openMain(view: "capture") }
        listen(SIGINFO) { [weak self] in self?.toggleDrop() }
        // Asked to stop from outside: quit properly, so the server stops too.
        listen(SIGTERM) { NSApp.terminate(nil) }
        if standalone {
            startServer()
            // The small panel drops once, so a double-click visibly did something.
            // The window itself is one press on the Dock icon away.
            whenServerAnswers { [weak self] in self?.showDrop(mode: "full") }
        } else if ProcessInfo.processInfo.environment["APPRENTICE_OPEN"] == "1" {
            openMain(view: "capture")
        }
    }

    private func listen(_ number: Int32, _ handler: @escaping () -> Void) {
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler(handler: handler)
        source.resume()
        signals.append(source)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        server?.terminate()
    }

    // MARK: The local server

    private func nodePath() -> String? {
        let manager = FileManager.default
        let home = manager.homeDirectoryForCurrentUser.path
        var candidates = [Bundle.main.object(forInfoDictionaryKey: "ApprenticeNode") as? String ?? "", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        let versions = (try? manager.contentsOfDirectory(atPath: home + "/.nvm/versions/node"))?.sorted() ?? []
        candidates += versions.reversed().map { home + "/.nvm/versions/node/" + $0 + "/bin/node" }
        return candidates.first { !$0.isEmpty && manager.isExecutableFile(atPath: $0) }
    }

    private func startServer() {
        guard server == nil, let root = Bundle.main.object(forInfoDictionaryKey: "ApprenticeRoot") as? String else { return }
        guard let node = nodePath() else {
            setHint("Node.js not found", for: 0)
            return
        }
        serverStarts += 1
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [root + "/src/server.mjs"]
        process.currentDirectoryURL = URL(fileURLWithPath: root)
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = port
        // The server must not start a second island, and it nudges this one by its process id.
        environment["APPRENTICE_OVERLAY"] = "0"
        environment["APPRENTICE_DESKTOP_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        environment["PATH"] = [URL(fileURLWithPath: node).deletingLastPathComponent().path, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].joined(separator: ":")
        process.environment = environment
        let log = root + "/.runtime/server.log"
        FileManager.default.createFile(atPath: log, contents: nil)
        if let handle = FileHandle(forWritingAtPath: log) {
            process.standardOutput = handle
            process.standardError = handle
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.server = nil
                // It should never stop by itself. Start it again, a few times at most.
                if self.serverStarts < 4 { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startServer() } }
            }
        }
        do { try process.run(); server = process } catch { setHint("Could not start", for: 0) }
    }

    private func whenServerAnswers(attempt: Int = 0, _ done: @escaping () -> Void) {
        guard attempt < 60, let url = URL(string: baseURL + "/api/island") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                if data != nil { done() } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.whenServerAnswers(attempt: attempt + 1, done) }
                }
            }
        }.resume()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openMain(view: "capture")
        return false
    }

    // MARK: Geometry

    private struct Geometry {
        let screen: NSScreen
        let top: CGFloat
        let notch: CGFloat
    }

    private func geometry() -> Geometry {
        let screen = NSScreen.screens.first ?? NSScreen.main!
        let safeTop = screen.safeAreaInsets.top
        let menuBar = screen.frame.maxY - screen.visibleFrame.maxY
        let left = screen.auxiliaryTopLeftArea?.width ?? 0
        let right = screen.auxiliaryTopRightArea?.width ?? 0
        let notch = safeTop > 0 && left > 0 && right > 0 ? screen.frame.width - left - right : 0
        return Geometry(screen: screen, top: notch > 0 ? safeTop : max(menuBar, 24), notch: notch)
    }

    // The right edge of the last menu of the app in front. Read through
    // Accessibility, off the main thread, with a short patience for an app
    // that does not answer.
    private func measureMenus() {
        let g = geometry()
        guard !measuring, g.notch > 0, AXIsProcessTrusted(), let front = NSWorkspace.shared.frontmostApplication else { return }
        measuring = true
        let pid = front.processIdentifier
        let screen = g.screen.frame
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let app = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(app, 0.4)
            var found: CGFloat?
            var bar: CFTypeRef?
            var items: CFTypeRef?
            if AXUIElementCopyAttributeValue(app, kAXMenuBarAttribute as CFString, &bar) == .success, let bar,
               AXUIElementCopyAttributeValue(bar as! AXUIElement, kAXChildrenAttribute as CFString, &items) == .success {
                for item in (items as? [AXUIElement]) ?? [] {
                    var position: CFTypeRef?
                    var size: CFTypeRef?
                    guard AXUIElementCopyAttributeValue(item, kAXPositionAttribute as CFString, &position) == .success, let position,
                          AXUIElementCopyAttributeValue(item, kAXSizeAttribute as CFString, &size) == .success, let size else { continue }
                    var point = CGPoint.zero
                    var extent = CGSize.zero
                    AXValueGetValue(position as! AXValue, .cgPoint, &point)
                    AXValueGetValue(size as! AXValue, .cgSize, &extent)
                    // A menu bar on another display says nothing about this one.
                    guard point.x >= screen.minX, point.x < screen.maxX else { continue }
                    found = max(found ?? 0, point.x + extent.width - screen.minX)
                }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.measuring = false
                guard let found, found != self.menusEdge else { return }
                self.menusEdge = found
                self.layoutIsland()
            }
        }
    }

    // What is free between the menus and the notch, with air on the menu side.
    private func room(_ g: Geometry) -> CGFloat {
        guard g.notch > 0 else { return 320 }
        // Not measured yet: most apps leave at least this much.
        guard let menusEdge else { return 190 }
        return max(0, (g.screen.frame.width - g.notch) / 2 - menusEdge - 14)
    }

    // Never taller than the menu bar: the island does not cover any window.
    // One pane runs under the notch: the row grows to the left of it, the eye
    // sits to the right of it. Without a notch it is a pill at the top centre.
    private func islandFrame() -> NSRect {
        let g = geometry()
        let width = islandView?.fit(room: room(g)) ?? 120
        let y = g.screen.frame.maxY - g.top
        guard g.notch > 0 else { return NSRect(x: (g.screen.frame.midX - (width + eyeWidth) / 2).rounded(), y: y, width: width + eyeWidth, height: g.top) }
        let notchLeft = g.screen.frame.minX + (g.screen.frame.width - g.notch) / 2
        return NSRect(x: (notchLeft - width).rounded(), y: y, width: width + g.notch + eyeWidth, height: g.top)
    }

    private func trailing(_ g: Geometry) -> CGFloat { g.notch + eyeWidth }

    private func layoutIsland() {
        let target = islandFrame()
        guard island.frame != target else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            island.animator().setFrame(target, display: true)
        }
    }

    private func dropFrame() -> NSRect {
        let g = geometry()
        let width: CGFloat = 460
        let height = min(dropHeight, g.screen.frame.height - g.top - 60)
        return NSRect(x: (g.screen.frame.midX - width / 2).rounded(), y: g.screen.frame.maxY - g.top - 10 - height, width: width, height: height)
    }

    @objc private func screensChanged() {
        let g = geometry()
        islandView.barHeight = g.top
        islandView.notchWidth = g.notch
        islandView.trailing = trailing(g)
        island.setFrame(islandFrame(), display: true)
        if dropShown { drop?.setFrame(dropFrame(), display: true) }
        measureMenus()
    }

    // MARK: Stage 1 · island

    private func buildIsland() {
        let g = geometry()
        island = NSPanel(contentRect: islandFrame(), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        island.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 2)
        island.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        island.isOpaque = false
        island.backgroundColor = .clear
        island.hasShadow = false
        island.hidesOnDeactivate = false
        island.isMovable = false

        let pane = glass(frame: NSRect(origin: .zero, size: island.frame.size), radius: 12, hanging: true, tint: 0.34)
        islandView = IslandView(frame: pane.bounds)
        islandView.autoresizingMask = [.width, .height]
        islandView.barHeight = g.top
        islandView.notchWidth = g.notch
        islandView.trailing = trailing(g)
        islandView.toolTip = "Apprentice · press for today"
        islandView.onPress = { [weak self] in self?.toggleDrop() }
        islandView.onMenu = { [weak self] event in self?.showContextMenu(event) }
        pane.addSubview(islandView)
        eyeView = EyeView(frame: NSRect(x: pane.bounds.width - eyeWidth, y: 0, width: eyeWidth, height: pane.bounds.height))
        eyeView.autoresizingMask = [.minXMargin, .height]
        pane.addSubview(eyeView)
        island.contentView = pane
        island.setFrame(islandFrame(), display: true)
        island.orderFrontRegardless()
    }

    private func setHint(_ text: String, for seconds: TimeInterval) {
        hintWork?.cancel()
        islandView.hint = text
        layoutIsland()
        guard !text.isEmpty else { return }
        let work = DispatchWorkItem { [weak self] in self?.setHint("", for: 0) }
        hintWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (seconds > 0 ? seconds : 4), execute: work)
    }

    private func statusLine(_ state: IslandState) -> String {
        switch state.status {
        case "watching":
            // The project when it is known, otherwise the kind of activity.
            return state.project.isEmpty ? state.app : state.project
        case "private-surface": return "Private"
        case "private": return "Looking away"
        case "paused": return "Paused"
        case "idle": return "Idle"
        case "permission": return "Needs Accessibility"
        default: return "Starting"
        }
    }

    private func refresh() {
        measureMenus()
        guard let url = URL(string: baseURL + "/api/island") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            let root = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async { self?.apply(root) }
        }.resume()
    }

    private func apply(_ root: [String: Any]?) {
        guard let root else {
            failures += 1
            // The server is gone: leave, but not with the exit code of a real quit.
            if !standalone && connected && failures >= 6 { exit(3) }
            return
        }
        failures = 0
        connected = true
        var next = IslandState()
        next.status = root["status"] as? String ?? "starting"
        next.app = root["app"] as? String ?? ""
        next.category = root["category"] as? String ?? ""
        next.work = root["work"] as? Int ?? 0
        next.social = root["social"] as? Int ?? 0
        next.other = root["other"] as? Int ?? 0
        next.totalSeconds = root["totalSeconds"] as? Int ?? 0
        let question = root["question"] as? [String: Any]
        next.question = question?["text"] as? String ?? ""
        next.questionId = question?["id"] as? String ?? ""
        next.project = root["project"] as? String ?? ""
        next.debriefReady = root["debriefReady"] as? Bool ?? false
        next.returning = root["returning"] as? String ?? ""
        next.seen = root["seen"] as? Int ?? 0
        next.busy = root["busy"] as? Bool ?? false
        let previous = islandView.state
        islandView.state = next
        eyeView.show(islandView.look, tone: islandView.tone, thinking: next.busy)
        if previous.seen != 0 && next.seen != previous.seen { eyeView.saw() }
        // Another figure is another width.
        layoutIsland()
        // A new question drops its own small panel, once. Ignored, it leaves by
        // itself and the island keeps a "?" until it is answered or parked.
        if !next.questionId.isEmpty && next.questionId != askedId {
            askedId = next.questionId
            if !dropShown { showDrop(mode: "ask") }
            return
        }
        guard !dropShown else { return }
        // Back in a project after hours or days: one line, there for a while, then gone.
        if !next.returning.isEmpty {
            setHint(next.returning, for: 6)
            return
        }
        // A debrief that is ready never rings: a word for a moment, then a ring.
        if next.debriefReady && !previous.debriefReady {
            setHint("Debrief ready", for: 4)
            return
        }
        if next.question.isEmpty {
            if next.status != previous.status {
                setHint(statusLine(next), for: next.status == "permission" ? 0 : 3)
            } else if next.status == "watching" && (next.app != previous.app || next.project != previous.project) {
                setHint(statusLine(next), for: 2.4)
            }
        }
    }

    // MARK: Stage 2 · drop panel

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // The spoken answer starts on a press inside the page, not on a system gesture.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(self, name: "apprentice")
        configuration.userContentController.addUserScript(WKUserScript(source: "document.documentElement.dataset.shell = 'desktop';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = PanelWebView(frame: .zero, configuration: configuration)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.autoresizingMask = [.width, .height]
        return web
    }

    @objc private func toggleDrop() {
        // A call is never interrupted by a press on the island.
        if dropShown && dropMode != "full" && dropMode != "ask" { return }
        // Pressing the island while a question is showing opens the whole day around it.
        if dropShown && dropMode == "full" { hideDrop() } else { showDrop(mode: "full") }
    }

    private func showDrop(mode: String) {
        setHint("", for: 0)
        removeMonitors()
        dropMode = mode
        if mode == "ask" { dropHeight = 236 }
        if mode != "full" && mode != "ask" { dropHeight = 250 }
        if drop == nil {
            let panel = DropPanel(contentRect: dropFrame(), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.level = island.level
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = true
            panel.hidesOnDeactivate = false
            let card = glass(frame: NSRect(origin: .zero, size: panel.frame.size), radius: 24, tint: 0.52)
            card.layer?.borderWidth = 1
            card.layer?.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
            let web = makeWebView()
            web.frame = card.bounds
            card.addSubview(web)
            panel.contentView = card
            web.load(URLRequest(url: URL(string: baseURL + "/overview?mode=" + mode)!))
            drop = panel
            dropWeb = web
        } else {
            dropWeb?.evaluateJavaScript("window.apprenticeShow && window.apprenticeShow('\(mode)')")
        }
        guard let drop else { return }
        let wasShown = dropShown
        let target = dropFrame()
        dropShown = true
        dropGeneration += 1
        // It comes down out of the island: a short drop and a fade, once.
        if wasShown {
            drop.setFrame(target, display: true)
        } else {
            drop.alphaValue = 0
            drop.setFrame(target.offsetBy(dx: 0, dy: 14), display: true)
        }
        if mode != "full" {
            // Shown, never focused: whatever is being typed elsewhere keeps the keyboard.
            drop.becomesKeyOnlyIfNeeded = true
            drop.orderFrontRegardless()
        } else {
            drop.becomesKeyOnlyIfNeeded = false
            drop.makeKeyAndOrderFront(nil)
            outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in self?.hideDrop() }
        }
        drop.invalidateShadow()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.24
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.8, 0.2, 1)
            drop.animator().alphaValue = 1
            drop.animator().setFrame(target, display: true)
        }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53, self?.drop?.isKeyWindow == true else { return event }
            self?.hideDrop()
            return nil
        }
    }

    private func removeMonitors() {
        if let outsideMonitor { NSEvent.removeMonitor(outsideMonitor) }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        outsideMonitor = nil
        keyMonitor = nil
    }

    private func hideDrop() {
        removeMonitors()
        guard let drop, dropShown else { return }
        dropShown = false
        dropGeneration += 1
        let generation = dropGeneration
        dropWeb?.evaluateJavaScript("window.apprenticeHide && window.apprenticeHide()")
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.12
            drop.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            // Shown again before the fade ended: leave it on screen.
            guard let self, self.dropGeneration == generation else { return }
            drop.orderOut(nil)
        })
        refresh()
    }

    // MARK: Stage 3 · app window

    private func openMain(view: String) {
        let safe = view.filter { $0.isLetter || $0 == "/" || $0 == "-" }
        if main == nil {
            let visible = geometry().screen.visibleFrame
            let size = NSSize(width: min(1060, visible.width - 160), height: min(740, visible.height - 72))
            let frame = NSRect(x: visible.midX - size.width / 2, y: visible.midY - size.height / 2, width: size.width, height: size.height)
            let window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "Apprentice"
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.isOpaque = false
            window.backgroundColor = .clear
            window.appearance = NSAppearance(named: .darkAqua)
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 780, height: 560)
            window.delegate = self
            let pane = glass(frame: NSRect(origin: .zero, size: frame.size), radius: 0, tint: 0.58)
            let web = makeWebView()
            // The page starts below the title bar, so the bar stays glass and can be dragged.
            web.frame = NSRect(x: 0, y: 0, width: frame.width, height: window.contentLayoutRect.height)
            pane.addSubview(web)
            window.contentView = pane
            web.load(URLRequest(url: URL(string: "\(baseURL)/#\(safe)")!))
            main = window
            mainWeb = web
        } else {
            mainWeb?.evaluateJavaScript("window.apprenticeGo && window.apprenticeGo('\(safe)')")
        }
        NSApp.setActivationPolicy(.regular)
        main?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        // Closing the window is not quitting: the island keeps watching, and
        // the Dock icon stays as the way back in.
    }

    // MARK: Page bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "height":
            guard let value = body["value"] as? Double else { return }
            dropHeight = max(220, CGFloat(value))
            if dropShown {
                drop?.setFrame(dropFrame(), display: true)
                drop?.invalidateShadow()
            }
        case "open":
            hideDrop()
            openMain(view: body["view"] as? String ?? "capture")
        case "close":
            hideDrop()
        case "hold":
            // A call started from the open panel: it stays until the call is over.
            removeMonitors()
            dropMode = "call"
        case "call":
            // "call" is the debrief; any other kind (the tutor) is a call too.
            let kind = (body["kind"] as? String ?? "call").filter { $0.isLetter }
            showDrop(mode: kind.isEmpty || kind == "full" || kind == "ask" ? "call" : kind)
        case "key":
            // The answer is being typed: now, and only now, the panel takes the keyboard.
            drop?.makeKey()
        case "browser":
            if let url = URL(string: baseURL + "/") { NSWorkspace.shared.open(url) }
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString.hasPrefix(baseURL) || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // A page that did not load (the server was still starting, or macOS was
    // still asking about the folder) is asked for again, not left blank.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard loadRetries < 25, let url = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL else { return }
        loadRetries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak webView] in webView?.load(URLRequest(url: url)) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loadRetries = 0 }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    // MARK: Menus

    private func post(_ path: String, _ body: [String: Any]) {
        guard let url = URL(string: baseURL + path), let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = data
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.refresh() }
        }.resume()
    }

    @objc private func openApprentice() { openMain(view: "capture") }
    @objc private func togglePrivate() {
        post("/api/control", ["action": islandView.state.status == "private" ? "on-the-record" : "off-the-record"])
    }

    private func privateItem() -> NSMenuItem {
        let item = NSMenuItem(title: islandView?.state.status == "private" ? "Resume Observing" : "Go Private", action: #selector(togglePrivate), keyEquivalent: "")
        item.target = self
        return item
    }

    private func showContextMenu(_ event: NSEvent) {
        let menu = NSMenu()
        let open = NSMenuItem(title: "Open Apprentice", action: #selector(openApprentice), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        menu.addItem(privateItem())
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Apprentice", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
        NSMenu.popUpContextMenu(menu, with: event, for: islandView)
    }

    private func buildMenu() {
        let bar = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        let open = NSMenuItem(title: "Open Apprentice", action: #selector(openApprentice), keyEquivalent: "o")
        open.target = self
        appMenu.addItem(open)
        let away = NSMenuItem(title: "Go Private / Resume", action: #selector(togglePrivate), keyEquivalent: "p")
        away.keyEquivalentModifierMask = [.command, .shift]
        away.target = self
        appMenu.addItem(away)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Apprentice", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu
        bar.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        edit.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        edit.addItem(.separator())
        edit.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        edit.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        edit.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        edit.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = edit
        bar.addItem(editItem)

        let windowItem = NSMenuItem()
        let window = NSMenu(title: "Window")
        window.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        window.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowItem.submenu = window
        bar.addItem(windowItem)
        NSApp.mainMenu = bar
    }

    private func appIcon() -> NSImage { drawIcon(side: 256) }
}

// The mark, at any size: the same drawing is the Dock icon and the file icon.
func drawIcon(side: CGFloat) -> NSImage {
    NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
        let unit = side / 256
        Palette.ink.setFill()
        NSBezierPath(roundedRect: rect.insetBy(dx: 20 * unit, dy: 20 * unit), xRadius: 50 * unit, yRadius: 50 * unit).fill()
        let stroke = NSBezierPath()
        stroke.lineWidth = 26 * unit
        stroke.lineCapStyle = .round
        stroke.lineJoinStyle = .round
        stroke.move(to: NSPoint(x: 86 * unit, y: 180 * unit))
        stroke.line(to: NSPoint(x: 86 * unit, y: 86 * unit))
        stroke.line(to: NSPoint(x: 180 * unit, y: 86 * unit))
        Palette.lime.setStroke()
        stroke.stroke()
        Palette.violet.setFill()
        NSBezierPath(ovalIn: NSRect(x: 150 * unit, y: 148 * unit, width: 42 * unit, height: 42 * unit)).fill()
        return true
    }
}

// `Apprentice --icon <file.png>` writes the icon and exits. The build uses it
// to make the file icon, so the mark is drawn in one place only.
if let flag = CommandLine.arguments.firstIndex(of: "--icon"), CommandLine.arguments.count > flag + 1 {
    let image = drawIcon(side: 1024)
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    image.draw(in: NSRect(x: 0, y: 0, width: 1024, height: 1024))
    NSGraphicsContext.restoreGraphicsState()
    try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1]))
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// An ordinary app with a Dock icon: that is where it is found again.
app.setActivationPolicy(.regular)
app.run()
