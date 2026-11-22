import SwiftUI

/// The shapes a style draws with. Switches on technique enums only, never on a style's name, so a new style needs
/// no edit here once Styles.swift is regenerated.

/// The outline of a card-like box: pebble rounds, engraving and frame are square. Insettable so strokeBorder works.
struct BoxShape: InsettableShape {
    var radius: CGFloat
    var pill = false
    var square = false
    var inset: CGFloat = 0
    func path(in r: CGRect) -> Path {
        let q = r.insetBy(dx: inset, dy: inset)
        if square { return Path(q) }
        return Path(roundedRect: q, cornerRadius: pill ? q.height / 2 : max(0, radius - inset), style: .continuous)
    }
    func inset(by amount: CGFloat) -> BoxShape { var s = self; s.inset += amount; return s }
}

func boxShape(_ style: Style, radius: CGFloat, pill: Bool = false) -> BoxShape {
    switch style.card {
    case .pebble: return BoxShape(radius: radius, pill: pill)
    case .engraving, .frame: return BoxShape(radius: 0, square: true)
    }
}

/// A card, row group or button body. `fill` nil draws an outlined button without a body.
struct Box: ViewModifier {
    let style: Style
    let palette: Palette
    var fill: Color? = nil
    var radius: CGFloat = 12
    var pill = false
    /// the second, inner line of the frame; off for small solid buttons
    var inner = true

    func body(content: Content) -> some View {
        let shape = boxShape(style, radius: radius, pill: pill)
        switch style.card {
        case .pebble:
            content
                .background { if let f = fill { shape.fill(f) } }
                .overlay { if fill == nil { shape.strokeBorder(palette.rule, lineWidth: 1) } }
                .contentShape(shape)
        case .engraving:
            // hard offset shadow, no blur: a pasted-in engraving
            content
                .background {
                    if let f = fill {
                        ZStack { Rectangle().fill(Color.black.opacity(0.10)).offset(x: 3, y: 3); Rectangle().fill(f) }
                    }
                }
                .overlay { Rectangle().strokeBorder(palette.paperLine, lineWidth: 1) }
                .contentShape(shape)
        case .frame:
            content
                .background { if let f = fill { Rectangle().fill(f) } }
                .overlay { Rectangle().strokeBorder(palette.ink, lineWidth: 1) }
                .overlay { if inner && fill != nil { Rectangle().strokeBorder(palette.rule, lineWidth: 1).padding(4) } }
                .contentShape(shape)
        }
    }
}

extension View {
    func box(_ style: Style, _ palette: Palette, fill: Color? = nil, radius: CGFloat = 12, pill: Bool = false, inner: Bool = true) -> some View {
        modifier(Box(style: style, palette: palette, fill: fill, radius: radius, pill: pill, inner: inner))
    }
}

/// Small deterministic noise (xorshift) so a torn edge looks the same on every redraw.
private struct Noise {
    var s: UInt32
    mutating func next() -> CGFloat {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5
        return CGFloat(s % 1000) / 1000
    }
}

/// The strip under a title, in the style's technique.
struct TitleUnderline: View {
    let style: Style
    let palette: Palette

    var body: some View {
        Canvas { ctx, sz in
            switch style.underline {
            case .dabs: dabs(&ctx, sz)
            case .rubbing: rubbing(&ctx, sz)
            case .sky: sky(&ctx, sz)
            }
        }
        .allowsHitTesting(false)
    }

    /// Two dabs of colour, the second shorter and offset, like the web's pair.
    private func dabs(_ c: inout GraphicsContext, _ sz: CGSize) {
        let a = CGRect(x: 0, y: sz.height * 0.1, width: sz.width * 0.72, height: sz.height * 0.6)
        let b = CGRect(x: sz.width * 0.3, y: sz.height * 0.4, width: sz.width * 0.5, height: sz.height * 0.55)
        c.fill(Path(roundedRect: a, cornerRadius: a.height / 2), with: .color(palette.sun.opacity(0.75)))
        c.fill(Path(roundedRect: b, cornerRadius: b.height / 2), with: .color(palette.water.opacity(0.6)))
    }

    /// Torn paper in `wood`: ragged top and bottom, a few thin grain lines along it.
    private func rubbing(_ c: inout GraphicsContext, _ sz: CGSize) {
        var n = Noise(s: 2463534242)
        let step: CGFloat = 4, cols = max(2, Int(sz.width / step))
        var p = Path()
        p.move(to: CGPoint(x: 0, y: n.next() * 1.5))
        for i in 1...cols { p.addLine(to: CGPoint(x: CGFloat(i) / CGFloat(cols) * sz.width, y: n.next() * 1.5)) }
        for i in stride(from: cols, through: 0, by: -1) {
            p.addLine(to: CGPoint(x: CGFloat(i) / CGFloat(cols) * sz.width, y: sz.height - n.next() * 1.5))
        }
        p.closeSubpath()
        c.fill(p, with: .color(palette.wood))
        c.clip(to: p)
        for k in 0..<4 {
            let y = sz.height * (CGFloat(k) + 1) / 5
            var g = Path()
            g.move(to: CGPoint(x: 0, y: y))
            for i in 1...cols { g.addLine(to: CGPoint(x: CGFloat(i) / CGFloat(cols) * sz.width, y: y + (n.next() - 0.5) * 0.8)) }
            c.stroke(g, with: .color(palette.scratch), lineWidth: 0.4)
        }
    }

    /// A strip of day sky with small cumulus clouds, outlined in ink.
    private func sky(_ c: inout GraphicsContext, _ sz: CGSize) {
        let r = CGRect(origin: .zero, size: sz)
        c.fill(Path(r), with: .linearGradient(Gradient(colors: [palette.skyTop, palette.skyLow]), startPoint: .zero, endPoint: CGPoint(x: 0, y: sz.height)))
        var clipped = c
        clipped.clip(to: Path(r))
        for fx in [0.2, 0.5, 0.8] as [CGFloat] {
            let cx = sz.width * fx, w = sz.height * 1.5, h = sz.height * 0.55
            let puffs = [CGRect(x: cx - w / 2, y: sz.height * 0.38, width: w, height: h),
                         CGRect(x: cx - w * 0.3, y: sz.height * 0.12, width: w * 0.6, height: h),
                         CGRect(x: cx, y: sz.height * 0.3, width: w * 0.55, height: h * 0.8)]
            // underside first, shifted down, so the shade shows along the bottom
            for q in puffs { clipped.fill(Path(ellipseIn: q.offsetBy(dx: 0, dy: 0.7)), with: .color(palette.cloudShade)) }
            for q in puffs { clipped.fill(Path(ellipseIn: q), with: .color(palette.cloud)) }
        }
        c.stroke(Path(r.insetBy(dx: 0.5, dy: 0.5)), with: .color(palette.ink), lineWidth: 1)
    }
}

extension View {
    /// The style's strip under a heading, about 60 % of its width, 6 pt high, just below the baseline.
    func titleUnderline(_ style: Style, _ palette: Palette) -> some View {
        background(alignment: .topLeading) {
            GeometryReader { g in
                TitleUnderline(style: style, palette: palette)
                    .frame(width: g.size.width * 0.6, height: 6)
                    .offset(y: g.size.height - 3)
            }
        }
    }
}
