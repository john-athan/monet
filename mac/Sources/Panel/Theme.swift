import SwiftUI
import AppKit

enum Fonts {
    /// The style's first installed heading family, else the system serif; italic and tracking as the style says.
    static func display(_ size: CGFloat, _ style: Style = Styles.monet) -> Font {
        let installed = Set(NSFontManager.shared.availableFontFamilies)
        var f: Font = style.fonts.first(where: installed.contains).map { .custom($0, size: size) } ?? .system(size: size, design: .serif)
        if style.italic { f = f.italic() }
        return f
    }
    static func body(_ weight: Font.Weight = .regular) -> Font { .system(size: 13, weight: weight) }
}

extension View {
    /// A heading in the style's display font with its tracking (em).
    func display(_ size: CGFloat, _ style: Style) -> some View { font(Fonts.display(size, style)).tracking(style.tracking * size) }
}

/// The mark: the Japanese bridge over the lily pond, painted in touches (MarkArt.swift, generated with
/// app/client/icons/icon.svg). viewBox 40x40, y down. Shared by the coloured header mark and the menu bar template.
enum Mark {
    struct Touch { let color: CGColor; let width: CGFloat; let silhouette: Bool; let path: CGPath }

    static let touches: [Touch] = art.split(separator: "\n").compactMap { line in
        let f = line.split(separator: " ", maxSplits: 3)
        guard f.count == 4, let c = UInt32(f[0], radix: 16), let w = Double(f[1]) else { return nil }
        let rgb = CGColor(srgbRed: CGFloat((c >> 16) & 255) / 255, green: CGFloat((c >> 8) & 255) / 255, blue: CGFloat(c & 255) / 255, alpha: 1)
        return Touch(color: rgb, width: CGFloat(w), silhouette: f[2] == "1", path: path(String(f[3])))
    }

    /// Reads the generated path data: absolute M, L, Q and Z with comma or space separated numbers.
    static func path(_ d: String) -> CGPath {
        let p = CGMutablePath()
        var cmd: Character = "M", nums: [CGFloat] = [], num = ""
        func flush() { if let v = Double(num) { nums.append(CGFloat(v)) }; num = "" }
        func emit() {
            switch cmd {
            case "M" where nums.count >= 2: p.move(to: CGPoint(x: nums[0], y: nums[1]))
            case "L" where nums.count >= 2: p.addLine(to: CGPoint(x: nums[0], y: nums[1]))
            case "Q" where nums.count >= 4: p.addQuadCurve(to: CGPoint(x: nums[2], y: nums[3]), control: CGPoint(x: nums[0], y: nums[1]))
            case "Z": p.closeSubpath()
            default: break
            }
            nums = []
        }
        for ch in d {
            if "MLQZ".contains(ch) { flush(); emit(); cmd = ch }
            else if ch == "," || ch == " " { flush() }
            else if ch == "-" && !num.isEmpty { flush(); num = "-" }
            else { num.append(ch) }
        }
        flush(); emit()
        return p
    }

    /// Paints the touches into a context already scaled to the 40 unit box.
    static func draw(_ g: CGContext, silhouetteIn color: CGColor? = nil) {
        g.setLineCap(.round)
        g.saveGState()
        if color == nil {
            g.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 40, height: 40), cornerWidth: 9, cornerHeight: 9, transform: nil))
            g.clip()
        }
        for t in touches where color == nil || t.silhouette {
            let c = color ?? t.color
            g.addPath(t.path)
            if t.width > 0 { g.setStrokeColor(c); g.setLineWidth(t.width); g.strokePath() }
            else { g.setFillColor(c); g.fillPath() }
        }
        g.restoreGState()
    }
}

/// The style's sign from the app bundle. Tests have no bundle, so Resources/ next to the working directory is tried
/// before falling back to the drawn bridge; a missing file never crashes.
enum StyleMark {
    static func image(_ style: Style) -> NSImage? {
        if let u = Bundle.main.url(forResource: style.mark, withExtension: "png"), let i = NSImage(contentsOf: u) { return i }
        let dev = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("Resources/\(style.mark).png")
        return NSImage(contentsOf: dev)
    }
}

struct MarkView: View {
    var style: Style = Styles.monet
    var size: CGFloat = 26
    var body: some View {
        if let img = StyleMark.image(style) {
            Image(nsImage: img).resizable().interpolation(.high).frame(width: size, height: size)
        } else {
            Canvas { ctx, sz in
                let s = sz.width / 40
                ctx.withCGContext { g in
                    g.scaleBy(x: s, y: s)
                    Mark.draw(g)
                }
            }
            .frame(width: size, height: size)
        }
    }
}

#if canImport(AppKit)
import AppKit
enum StatusIcon {
    /// Template image for the menu bar, drawn in code. `dimmed` is used while paused.
    static func image(dimmed: Bool = false, side: CGFloat = 18) -> NSImage {
        let img = NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
            guard let g = NSGraphicsContext.current?.cgContext else { return false }
            let s = rect.width / 40
            g.scaleBy(x: s, y: s)
            Mark.draw(g, silhouetteIn: NSColor.black.withAlphaComponent(dimmed ? 0.45 : 1).cgColor)
            return true
        }
        img.isTemplate = true
        return img
    }
}
#endif
