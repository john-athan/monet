import SwiftUI

/// The small first-launch window: server address and the 8-character code from the Geräte page.
struct PairingView: View {
    @ObservedObject var engine: Engine
    var onDone: () -> Void = {}
    @State private var server = "https://monet.kaleve.dev"
    @State private var code = ""
    @State private var busy = false

    var body: some View {
        let p = engine.style.palette(engine.light)
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                MarkView(style: engine.style, size: 26)
                Text("Monet verbinden").display(22, engine.style)
            }
            Text("Öffne in Monet die Seite „Geräte“ und erzeuge dort einen Code. Er gilt zehn Minuten.")
                .foregroundStyle(p.muted).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Server").foregroundStyle(p.muted)
                field($server, prompt: "https://monet.kaleve.dev", mono: false)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Code").foregroundStyle(p.muted)
                field($code, prompt: "ABCD2345", mono: true)
                    .onChange(of: code) { _, v in
                        let c = String(v.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(8))
                        if c != v { code = c }
                    }
            }
            if let e = engine.pairingError { Text(e).foregroundStyle(p.sun) }
            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button {
                    busy = true
                    Task { if await engine.pair(server: server, code: code) { onDone() }; busy = false }
                } label: {
                    Text(busy ? "Verbindet" : "Verbinden").fontWeight(.semibold).foregroundStyle(p.onInk)
                        .padding(.horizontal, 22).frame(height: 36).background(p.ink, in: Capsule())
                }
                .buttonStyle(.plain).disabled(busy || PairingCode.normalize(code) == nil)
                .keyboardShortcut(.defaultAction)
            }
        }
        .font(Fonts.body())
        .foregroundStyle(p.ink)
        .padding(20)
        .frame(width: 380, height: 330)
        .background(p.ground)
        .onAppear { server = engine.config.serverURL }
    }

    private func field(_ text: Binding<String>, prompt: String, mono: Bool) -> some View {
        let p = engine.style.palette(engine.light)
        return TextField(prompt, text: text)
            .textFieldStyle(.plain)
            .font(mono ? .system(size: 15, design: .monospaced) : Fonts.body())
            .padding(.horizontal, 10).frame(height: 34)
            .background(p.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(p.rule, lineWidth: 1))
            .autocorrectionDisabled()
    }
}

struct PanelHost: View {
    @ObservedObject var engine: Engine
    var actions: PanelActions
    var body: some View {
        PanelView(model: engine.model, style: engine.style, light: engine.light, actions: actions)
    }
}
