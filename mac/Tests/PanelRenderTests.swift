import AppKit
import SwiftUI

/// Renders the panel to PNG (mittag, nacht, plus morgen and abend) into .build/shots.
func runPanelRenderTests() {
    func demoImage(_ top: NSColor, _ bottom: NSColor, face: Bool = false) -> NSImage {
        let img = NSImage(size: NSSize(width: 128, height: 128))
        img.lockFocus()
        NSGradient(starting: top, ending: bottom)!.draw(in: NSRect(x: 0, y: 0, width: 128, height: 128), angle: 270)
        if face {
            NSColor(red: 0.48, green: 0.29, blue: 0.17, alpha: 1).setFill(); NSBezierPath(ovalIn: NSRect(x: 40, y: 58, width: 48, height: 46)).fill()
            NSColor(red: 0.94, green: 0.79, blue: 0.68, alpha: 1).setFill(); NSBezierPath(ovalIn: NSRect(x: 44, y: 50, width: 40, height: 44)).fill()
            NSColor(red: 0.25, green: 0.43, blue: 0.56, alpha: 1).setFill(); NSBezierPath(ovalIn: NSRect(x: 12, y: -40, width: 104, height: 64)).fill()
        }
        img.unlockFocus()
        return img
    }
    let model = PanelModel(
        header: .init(kind: .ok, text: "Alles gesichert"),
        card: .init(title: "Analysiert drei Fotos", thumbs: [
            .init(id: 1, image: demoImage(NSColor(red: 0.31, green: 0.49, blue: 0.47, alpha: 1), NSColor(red: 0.18, green: 0.33, blue: 0.44, alpha: 1)), done: true, current: false),
            .init(id: 2, image: demoImage(NSColor(red: 0.91, green: 0.83, blue: 0.75, alpha: 1), NSColor(red: 0.79, green: 0.66, blue: 0.54, alpha: 1), face: true), done: false, current: true),
            .init(id: 3, image: demoImage(NSColor(red: 0.91, green: 0.71, blue: 0.56, alpha: 1), NSColor(red: 0.31, green: 0.35, blue: 0.52, alpha: 1)), done: false, current: false)],
                    label: "Gesichter im zweiten Foto", progress: 0.54),
        sources: [.init(id: "photos", title: "Fotos-Mediathek", subtitle: "52.310 Objekte, aktuell", on: true, removable: false),
                  .init(id: "/Users/x/Bilder/Kamera", title: "Bilder/Kamera", subtitle: "1.204 Dateien, aktuell", on: true, removable: true)],
        archive: .init(configured: true, name: "Archiv", subtitle: "zuletzt gestern, 23:10", busy: false),
        paused: false)

    Check.suite("panel render") {
        _ = NSApplication.shared
        let dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".build/shots")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for style in Styles.all { for light in Light.allCases {
            MainActor.assumeIsolated {
                let r = ImageRenderer(content: PanelView(model: model, style: style, light: light))
                r.scale = 2
                r.isOpaque = false
                guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    Check.that(false, "render \(light)"); return
                }
                let out = dir.appendingPathComponent("panel-\(style.key)-\(light.rawValue).png")
                try? png.write(to: out)
                Check.equal(rep.pixelsWide, 720, "\(light) is 360 pt at 2x")
                Check.equal(rep.pixelsHigh, 1200, "\(light) is 600 pt at 2x")
            }
        } }
        Check.equal(Styles.of("magritte").brand, "Magritte", "magritte brand")
        Check.equal(Styles.of("picasso").key, "monet", "unknown style is Monet")
        Check.equal(Styles.of(nil).key, "monet", "no style is Monet")
        // The menu bar template image draws something and is a template.
        let icon = StatusIcon.image()
        Check.that(icon.isTemplate, "status icon is a template")
        if let tiff = icon.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) {
            var opaque = 0
            for x in 0..<rep.pixelsWide { for y in 0..<rep.pixelsHigh { if (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.5 { opaque += 1 } } }
            Check.that(opaque > 20, "status icon has ink (\(opaque) px)")
        }
        try? (StatusIcon.image(side: 144).tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) })?.write(to: dir.appendingPathComponent("statusicon.png"))
    }
}
