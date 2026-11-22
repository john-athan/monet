import SwiftUI

/// Reproduces design/project/Mac-Menue.dc.html: 360 x 600, 14 px padding, 14 px gaps.
struct PanelView: View {
    let model: PanelModel
    let style: Style
    let light: Light
    var actions = PanelActions()
    private var palette: Palette { style.palette(light) }

    var body: some View {
        VStack(spacing: 14) {
            header
            card
            sources
            archive
            Spacer(minLength: 0)
            footer
        }
        .padding(14)
        .frame(width: 360, height: 600)
        .background(palette.ground)
        .foregroundStyle(palette.ink)
        .font(Fonts.body())
        .clipShape(boxShape(style, radius: 14))
        .overlay(boxShape(style, radius: 14).strokeBorder(palette.rule, lineWidth: 1))
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            MarkView(style: style, size: 26)
            Text(style.brand).display(22, style)
            Spacer()
            HStack(spacing: 5) {
                Image(systemName: headerSymbol).font(.system(size: 11, weight: .bold)).foregroundStyle(palette.water)
                Text(model.header.text)
            }
            .foregroundStyle(palette.muted)
        }
    }

    private var headerSymbol: String {
        switch model.header.kind {
        case .ok: return "checkmark"
        case .busy: return "arrow.up"
        case .paused: return "pause.fill"
        case .offline: return "wifi.slash"
        case .unpaired: return "link"
        }
    }

    // MARK: Card

    private var card: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.card.title).display(20, style).titleUnderline(style, palette).padding(.bottom, 4)
            if !model.card.thumbs.isEmpty {
                HStack(spacing: 6) { ForEach(model.card.thumbs) { thumb($0) } }
            }
            if model.card.label != nil || model.card.progress != nil {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.card.label ?? " ").foregroundStyle(palette.muted).monospacedDigit().lineLimit(1)
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(palette.surface2)
                            Capsule().fill(palette.sun).frame(width: g.size.width * CGFloat(model.card.progress ?? 0))
                        }
                    }
                    .frame(height: 6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .box(style, palette, fill: palette.surface)
    }

    private func thumb(_ t: PanelModel.Thumb) -> some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let img = t.image { Image(nsImage: img).resizable().scaledToFill() }
                else { palette.surface2 }
            }
            .frame(width: 64, height: 64)
            .clipShape(boxShape(style, radius: 8))
            .overlay { thumbLine }
            if t.done {
                Circle().fill(palette.water).frame(width: 18, height: 18)
                    .overlay(Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(palette.onInk))
                    .padding(4)
            }
        }
        .frame(width: 64, height: 64)
        .background {
            if t.current {
                ZStack {
                    boxShape(style, radius: 12).fill(palette.sun)
                    boxShape(style, radius: 10).fill(palette.ground).padding(2)
                }
                .padding(-4)
            }
        }
    }

    /// The frame line of a photo: none on pebble, a hairline on engraving, the ink border on frame.
    @ViewBuilder private var thumbLine: some View {
        switch style.card {
        case .pebble: EmptyView()
        case .engraving: Rectangle().strokeBorder(palette.paperLine, lineWidth: 1)
        case .frame: Rectangle().strokeBorder(palette.ink, lineWidth: 1)
        }
    }

    // MARK: Quellen

    private var sources: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Quellen").display(17, style).padding(.leading, 2)
            VStack(spacing: 0) {
                ForEach(Array(model.sources.enumerated()), id: \.element.id) { i, s in
                    if i > 0 { palette.rule.frame(height: 1) }
                    sourceRow(s)
                }
                if !model.sources.isEmpty { palette.rule.frame(height: 1) }
                HStack {
                    Button(action: actions.addFolder) {
                        Text("Ordner hinzufügen").fontWeight(.semibold).foregroundStyle(palette.water)
                    }.buttonStyle(.plain)
                    Spacer()
                }
                .padding(.horizontal, 12).padding(.vertical, 4).frame(minHeight: 44)
            }
            .box(style, palette, fill: palette.surface)
        }
    }

    private func sourceRow(_ s: PanelModel.Source) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(s.title).lineLimit(1)
                Text(s.subtitle).foregroundStyle(palette.muted).monospacedDigit().lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Switch(on: s.on, palette: palette) { actions.toggleSource(s.id) }
        }
        .padding(.horizontal, 12).padding(.vertical, 4).frame(minHeight: 44)
        .contentShape(Rectangle())
        .contextMenu { if s.removable { Button("Ordner entfernen") { actions.removeSource(s.id) } } }
    }

    // MARK: Zweite Kopie

    private var archive: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                if model.archive.configured {
                    Text(archiveTitle).lineLimit(1)
                } else {
                    Text("Zweite Kopie")
                }
                Text(model.archive.subtitle).foregroundStyle(palette.muted).monospacedDigit().lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: model.archive.configured ? actions.copyNow : actions.chooseArchive) {
                Text(model.archive.configured ? (model.archive.busy ? "Kopiert" : "Jetzt kopieren") : "Ordner wählen")
                    .fontWeight(.semibold)
                    .padding(.horizontal, 12).frame(height: 30)
                    .box(style, palette, pill: true)
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .box(style, palette, fill: palette.surface)
        .contextMenu { Button("Anderen Ordner wählen") { actions.chooseArchive() } }
    }

    private var archiveTitle: AttributedString {
        var a = AttributedString("Zweite Kopie auf ")
        var b = AttributedString("„\(model.archive.name)“")
        b.inlinePresentationIntent = .stronglyEmphasized
        a.append(b)
        return a
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 8) {
            Button(action: actions.openMonet) {
                Text("Monet öffnen").fontWeight(.semibold)
                    .foregroundStyle(palette.onInk)
                    .frame(maxWidth: .infinity).frame(height: 36)
                    .box(style, palette, fill: palette.ink, pill: true, inner: false)
            }.buttonStyle(.plain)
            Button(action: actions.togglePause) {
                Text(model.paused ? "Fortsetzen" : "Pausieren").fontWeight(.semibold)
                    .padding(.horizontal, 14).frame(height: 36)
                    .box(style, palette, pill: true)
            }.buttonStyle(.plain)
        }
    }
}

/// 34 x 20 switch, drawn by hand so it looks the same in the popover and in a rendered PNG.
struct Switch: View {
    let on: Bool
    let palette: Palette
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack(alignment: on ? .trailing : .leading) {
                Capsule().fill(on ? palette.water : palette.surface3)
                Circle().fill(on ? palette.onInk : palette.ink).frame(width: 16, height: 16).padding(2)
            }
            .frame(width: 34, height: 20)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isToggle)
    }
}
