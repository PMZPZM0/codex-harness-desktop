// RPA keyboard/mouse recorder + player for macOS. ASCII only.
// Usage:
//   rpa-input-mac record -out <file> -stop <file> [-interval 25]
//   rpa-input-mac play -input <json> -stop <file> [-recipe-width W -recipe-height H]
// Record writes NDJSON. Play reads {actions:[...], screen:{width,height}}.
// Exit codes: 0 ok, 2 stopped by user, 3 missing Input Monitoring, 4 missing Accessibility, 1 other.

import Foundation
import AppKit
import CoreGraphics
import ApplicationServices
import Darwin

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("usage: rpa-input-mac record|play ...\n", stderr)
    exit(1)
}
let mode = args[1]

func opt(_ name: String) -> String? {
    var i = 2
    while i + 1 < args.count {
        if args[i] == "-" + name { return args[i + 1] }
        i += 1
    }
    return nil
}

func optInt(_ name: String, _ fallback: Int) -> Int {
    if let raw = opt(name), let value = Int(raw) { return value }
    return fallback
}

func stopRequested(_ path: String) -> Bool {
    return FileManager.default.fileExists(atPath: path)
}

func screenSize() -> CGSize {
    return CGDisplayBounds(CGMainDisplayID()).size
}

func jsonData(_ object: [String: Any]) -> Data {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: []) { return data }
    return Data("{}".utf8)
}

func writeStatus(_ path: String?, _ object: [String: Any]) {
    guard let path = path else { return }
    FileManager.default.createFile(atPath: path, contents: jsonData(object))
}

func currentFlags() -> CGEventFlags {
    return CGEventSource.flagsState(.combinedSessionState)
}

func frontApp() -> (String, String) {
    guard let app = NSWorkspace.shared.frontmostApplication else { return ("", "") }
    return (app.localizedName ?? "", app.bundleIdentifier ?? "")
}

var outHandle: FileHandle?

func writeEvent(_ object: [String: Any]) {
    guard let handle = outHandle else { return }
    var line = jsonData(object)
    line.append(Data("\n".utf8))
    handle.seekToEndOfFile()
    handle.write(line)
}

func permissionOK(needsPost: Bool) -> Bool {
    if !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
    if needsPost && !CGPreflightPostEventAccess() { _ = CGRequestPostEventAccess() }
    return CGPreflightListenEventAccess() && (!needsPost || CGPreflightPostEventAccess())
}

// ---------------- record ----------------

func record() -> Int32 {
    guard let out = opt("out"), let stopFile = opt("stop") else {
        fputs("record needs -out and -stop\n", stderr)
        return 1
    }
    let interval = optInt("interval", 25)
    let listen = permissionOK(needsPost: false)
    let postOK = CGPreflightPostEventAccess()
    let trusted = AXIsProcessTrusted()

    FileManager.default.createFile(atPath: out, contents: nil)
    outHandle = FileHandle(forWritingAtPath: out)
    let size = screenSize()
    writeEvent([
        "type": "meta", "t": 0, "width": Int(size.width), "height": Int(size.height),
        "os": "darwin", "listen": listen, "post": postOK, "trusted": trusted,
        "at": Int(Date().timeIntervalSince1970 * 1000),
    ])
    if !listen {
        fputs("Input Monitoring permission is required for recording.\n", stderr)
        return 3
    }

    var keyStates = [Bool](repeating: false, count: 128)
    for code in 0..<128 { keyStates[code] = CGEventSource.keyState(.hidSystemState, key: CGKeyCode(code)) }
    var mouseStates: [String: Bool] = [
        "left": CGEventSource.buttonState(.combinedSessionState, button: .left),
        "right": CGEventSource.buttonState(.combinedSessionState, button: .right),
        "middle": CGEventSource.buttonState(.combinedSessionState, button: .center),
    ]

    let start = DispatchTime.now().uptimeNanoseconds
    func nowMs() -> Int { return Int((DispatchTime.now().uptimeNanoseconds - start) / 1_000_000) }
    var lastTitle = ""
    var lastX = -100000
    var lastY = -100000
    var lastMoveAt = 0

    while !stopRequested(stopFile) {
        if nowMs() > 30 * 60 * 1000 { break }
        let t = nowMs()
        let (title, bundle) = frontApp()
        if title != lastTitle {
            writeEvent(["type": "focus", "t": t, "title": title, "bundle": bundle])
            lastTitle = title
        }
        if let event = CGEvent(source: nil) {
            let point = event.location
            let dx = Int(point.x) - lastX
            let dy = Int(point.y) - lastY
            if dx * dx + dy * dy > 36 && t - lastMoveAt > 70 {
                writeEvent(["type": "move", "t": t, "x": Int(point.x), "y": Int(point.y)])
                lastX = Int(point.x)
                lastY = Int(point.y)
                lastMoveAt = t
            }
        }
        let flags = currentFlags()
        let shift = flags.contains(.maskShift)
        let ctrl = flags.contains(.maskControl)
        let alt = flags.contains(.maskAlternate)
        let cmd = flags.contains(.maskCommand)
        let caps = flags.contains(.maskAlphaShift)
        for code in 0..<128 {
            let down = CGEventSource.keyState(.hidSystemState, key: CGKeyCode(code))
            if down != keyStates[code] {
                writeEvent([
                    "type": down ? "keydown" : "keyup", "t": t, "vk": code,
                    "shift": shift, "ctrl": ctrl, "alt": alt, "win": cmd, "caps": caps,
                ])
                keyStates[code] = down
            }
        }
        let buttons: [(String, CGMouseButton)] = [
            ("left", .left), ("right", .right), ("middle", .center),
        ]
        for (name, button) in buttons {
            let down = CGEventSource.buttonState(.combinedSessionState, button: button)
            if down != (mouseStates[name] ?? false) {
                let point = CGEvent(source: nil)?.location ?? .zero
                writeEvent([
                    "type": down ? "down" : "up", "t": t, "button": name,
                    "x": Int(point.x), "y": Int(point.y),
                ])
                mouseStates[name] = down
            }
        }
        usleep(useconds_t(max(5, interval) * 1000))
    }
    writeEvent(["type": "end", "t": nowMs()])
    outHandle?.closeFile()
    return 0
}

// ---------------- play ----------------

func mouseType(_ button: String, down: Bool) -> CGEventType {
    switch button {
    case "right": return down ? .rightMouseDown : .rightMouseUp
    case "middle", "x1", "x2": return down ? .otherMouseDown : .otherMouseUp
    default: return down ? .leftMouseDown : .leftMouseUp
    }
}

func mouseButton(_ button: String) -> CGMouseButton {
    switch button {
    case "right": return .right
    case "middle", "x1", "x2": return .center
    default: return .left
    }
}

func play() -> Int32 {
    guard let input = opt("input"), let stopFile = opt("stop") else {
        fputs("play needs -input and -stop\n", stderr)
        return 1
    }
    if !CGPreflightPostEventAccess() { _ = CGRequestPostEventAccess() }
    let postOK = CGPreflightPostEventAccess()
    writeStatus(opt("status"), ["type": "meta", "post": postOK])
    if !postOK {
        fputs("Accessibility permission is required for playback.\n", stderr)
        return 4
    }
    guard let data = FileManager.default.contents(atPath: input),
          let object = try? JSONSerialization.jsonObject(with: data),
          let doc = object as? [String: Any],
          let actions = doc["actions"] as? [[String: Any]] else {
        fputs("invalid input json\n", stderr)
        return 1
    }
    var scaleX = 1.0
    var scaleY = 1.0
    if let screen = doc["screen"] as? [String: Any],
       let rw = screen["width"] as? Int, let rh = screen["height"] as? Int,
       rw > 0, rh > 0 {
        let size = screenSize()
        if size.width > 0 && size.height > 0 {
            scaleX = Double(size.width) / Double(rw)
            scaleY = Double(size.height) / Double(rh)
        }
    }
    var lastT = 0
    usleep(350_000)
    for action in actions {
        if stopRequested(stopFile) { return 2 }
        let type = action["type"] as? String ?? ""
        let t = action["t"] as? Int ?? 0
        var delay = t - lastT
        if delay > 0 {
            if delay > 3000 { delay = 3000 }
            usleep(useconds_t(delay * 1000))
        }
        lastT = t
        if type == "focus" {
            let bundle = action["bundle"] as? String ?? ""
            let title = action["title"] as? String ?? ""
            if !bundle.isEmpty || !title.isEmpty {
                if let app = NSWorkspace.shared.runningApplications.first(where: {
                    (!bundle.isEmpty && $0.bundleIdentifier == bundle) || (!title.isEmpty && $0.localizedName == title)
                }) {
                    app.activate(options: [.activateIgnoringOtherApps])
                    usleep(120_000)
                }
            }
        } else if type == "move" {
            let x = Double(action["x"] as? Int ?? 0) * scaleX
            let y = Double(action["y"] as? Int ?? 0) * scaleY
            CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
            let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                                mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
            event?.post(tap: .cghidEventTap)
        } else if type == "down" || type == "up" {
            let name = action["button"] as? String ?? "left"
            let x = Double(action["x"] as? Int ?? 0) * scaleX
            let y = Double(action["y"] as? Int ?? 0) * scaleY
            let point = CGPoint(x: x, y: y)
            CGWarpMouseCursorPosition(point)
            let event = CGEvent(mouseEventSource: nil, mouseType: mouseType(name, down: type == "down"),
                                mouseCursorPosition: point, mouseButton: mouseButton(name))
            event?.post(tap: .cghidEventTap)
        } else if type == "keydown" || type == "keyup" {
            let code = action["vk"] as? Int ?? 0
            let event = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(max(0, min(127, code))),
                                keyDown: type == "keydown")
            var flags: CGEventFlags = []
            if action["shift"] as? Bool == true { flags.insert(.maskShift) }
            if action["ctrl"] as? Bool == true { flags.insert(.maskControl) }
            if action["alt"] as? Bool == true { flags.insert(.maskAlternate) }
            if action["win"] as? Bool == true { flags.insert(.maskCommand) }
            event?.flags = flags
            event?.post(tap: .cghidEventTap)
            usleep(10_000)
        }
    }
    return 0
}

switch mode {
case "record":
    exit(record())
case "play":
    exit(play())
default:
    fputs("unknown mode\n", stderr)
    exit(1)
}
