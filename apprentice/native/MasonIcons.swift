import AppKit

// The icons of the apps a day was spent in, as macOS draws them. Given names,
// it finds each app and writes its icon as a small picture. Nothing else is read.

struct Request: Decodable {
    struct App: Decodable {
        let name: String
        let file: String
    }
    let folder: String
    let apps: [App]
}

guard let line = readLine(), let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else {
    exit(1)
}

let places = [
    "/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities",
    NSHomeDirectory() + "/Applications", "/System/Library/CoreServices", "/System/Library/CoreServices/Applications",
]

// A name in one spelling. The file system spells "ä" as two characters, and
// some apps put a mark for the direction of writing in front of their name.
func plain(_ name: String) -> String {
    name.precomposedStringWithCanonicalMapping.replacingOccurrences(of: "\u{200E}", with: "").replacingOccurrences(of: "\u{200F}", with: "")
}

// Every app in the usual folders, under each name it goes by. The folders are
// read once: a day can have been spent in forty tools, and most are sites.
let installed: [String: URL] = {
    var apps: [String: URL] = [:]
    for place in places {
        for item in (try? FileManager.default.contentsOfDirectory(atPath: place)) ?? [] where item.hasSuffix(".app") {
            let path = place + "/" + item
            // Spotlight knows an app by the name it has in the owner's language.
            let listed = NSMetadataItem(url: URL(fileURLWithPath: path))?.value(forAttribute: NSMetadataItemDisplayNameKey) as? String
            for shown in [listed ?? FileManager.default.displayName(atPath: path), item] {
                let spelled = plain(shown)
                let name = spelled.hasSuffix(".app") ? String(spelled.dropLast(4)) : spelled
                if apps[name] == nil { apps[name] = URL(fileURLWithPath: path) }
            }
        }
    }
    return apps
}()

// Where the app of this name lives: one that is running first, then the usual
// folders. The name is the one macOS shows, which on a Swedish Mac is "Kalender".
func locate(_ wanted: String) -> URL? {
    let name = plain(wanted)
    if let running = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName.map(plain) == name }), let url = running.bundleURL {
        return url
    }
    return installed[name]
}

func write(_ icon: NSImage, to url: URL, side: Int = 128) -> Bool {
    guard let picture = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return false }
    picture.size = NSSize(width: side, height: side)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: picture)
    icon.draw(in: NSRect(x: 0, y: 0, width: side, height: side), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = picture.representation(using: .png, properties: [:]) else { return false }
    return (try? png.write(to: url)) != nil
}

try? FileManager.default.createDirectory(atPath: request.folder, withIntermediateDirectories: true)
var found: [String] = []
for app in request.apps {
    guard let home = locate(app.name) else { continue }
    let target = URL(fileURLWithPath: request.folder).appendingPathComponent(app.file)
    if write(NSWorkspace.shared.icon(forFile: home.path), to: target) { found.append(app.name) }
}

if let data = try? JSONSerialization.data(withJSONObject: ["found": found]) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
